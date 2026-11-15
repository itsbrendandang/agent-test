"""The research engine's analyses on Modal: `--sandbox modal` of the swarm's local runner.

The engine starts swarm runs with glhf/bixbench's local runner (`bixbench3.glhf_local`). Every
piece of analysis code of such a run executes in one sandbox: the commands the roles run (bash,
Python, R), the shape checks, and the registered falsification tests the harness itself runs to
decide a claim's verdict. By default that sandbox is a Docker container on this machine. With
`ANALYSIS_BACKEND=modal` in the engine (or `--sandbox modal` on the runner) it is a Modal Sandbox
made here, from PR #32's code and nothing else:

  modal_run.prepare            the NO_PAID_CALLS switch, the run's dollar cap (its worst case,
                               every sandbox alive until its timeout, must fit), the case's
                               data files on the Volume (once, by content hash), the config
  modal_sandbox.BixModalSandbox  the plan (our checked image, no network, one read-only data
                               folder, fixed CPU and memory, a timeout), the probe, the check of
                               the environment against modal_env/expected-env.json, /outputs
                               copied back, every sandbox terminated with a cost-ledger line
  modal_sandbox.terminate_run  the last net, after the run, also after an error or Ctrl+C

What this module adds: the case's data folder as a staging manifest (`case_manifest`), the
runner's backend (`ModalAnalyses`), a marker file in the run folder that the engine reads to
find and terminate this run's sandboxes after it had to kill the runner (`terminate`, also a
command), and, in glhf_modal_sandbox.py, the provider: /workspace for the swarm, and
`analysis_backend()`, which the harness writes into every `test.executed` event.

What goes to Modal: the regular files of the case's data/ folder, each an accepted data type
(`staging.file_type_problem`: no notebook, report or script). Never the grader, the prompt, the
run folder or a key. What comes back: /outputs, through `safe_members`. The workspace stays in
the sandbox and ends with it.

Only `ModalAnalyses.prepare` and `terminate` reach Modal, and they import it when called.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import modal_cost, modal_run, staging

MARKER = "modal_run.json"  # in the run folder: what the engine needs to find this run's sandboxes
DEFAULT_USD_CAP = 2.0  # per run; the engine passes GLHF_MODAL_MAX_USD
# The swarm's time limit is Inspect's own: no extra backstop beyond the sandbox's start-up time
# (modal_boundary.SETUP_SECONDS), which `sandbox_timeout` adds.
BACKSTOP_SECONDS = 0
SANDBOXES = 1  # the BixBench3 swarm uses one sandbox for all its roles


def case_manifest(data_dir: Path) -> staging.Manifest:
    """The case's data folder as a staging manifest: every regular file and its size. Refused
    with `staging.IntegrityError`: a symbolic link, anything that is not a file or a folder, a
    file whose type is not an accepted data file (the rule PR #32 applies to every upload)."""
    if not data_dir.is_dir() or data_dir.is_symlink():
        raise staging.IntegrityError(f"{data_dir} is not a folder of data files")
    included: list[dict[str, object]] = []
    for path in sorted(data_dir.rglob("*")):
        relative = path.relative_to(data_dir).as_posix()
        if path.is_symlink():
            raise staging.IntegrityError(f"not uploading {relative}: a symbolic link")
        if path.is_dir():
            continue
        if not path.is_file():
            raise staging.IntegrityError(f"not uploading {relative}: not a regular file")
        problem = staging.file_type_problem(relative)
        if problem is not None:
            raise staging.IntegrityError(f"not uploading {relative}: {problem}")
        included.append({"path": relative, "bytes": path.stat().st_size})
    if not included:
        raise staging.IntegrityError(f"{data_dir} holds no data file to upload")
    return staging.Manifest(
        zip_name="glhf case data folder",
        zip_sha256="",
        included=included,
        data_folder=data_dir.name,
        rules_version=staging.RULES_VERSION,
    )


@dataclass
class ModalAnalyses:
    """The runner's Modal backend (`bixbench3.glhf_local.AnalysisBackend`). `prepare` before the
    run returns the Inspect sandbox; `finish` after it, also after an error or Ctrl+C, terminates
    whatever is still alive and returns what run.json records. `volume` replaces the real Modal
    Volume in tests."""

    usd_cap: float = DEFAULT_USD_CAP
    cpu: float = 4.0
    memory_mib: int = 16384
    image: str | None = None
    volume: Any = None
    name: str = "modal"
    run: modal_run.ModalRun | None = field(default=None, init=False)

    def prepare(
        self,
        *,
        data_dir: Path,
        outputs_dir: Path,
        run_dir: Path,
        task: str,
        solver: str,
        time_limit_seconds: int,
    ) -> tuple[str, dict[str, Any]]:
        manifest = case_manifest(data_dir)
        self.run = modal_run.prepare(
            data_dir=data_dir,
            manifest=manifest,
            outputs_dir=outputs_dir,
            run_dir=run_dir,
            run_name=f"{task}/{run_dir.name}",
            capsule=task,
            solver=solver,
            time_limit_seconds=time_limit_seconds,
            backstop_seconds=BACKSTOP_SECONDS,
            image=self.image,
            cpu=self.cpu,
            memory_mib=self.memory_mib,
            usd_cap=self.usd_cap,
            volume=self.volume,
            sandboxes=SANDBOXES,
        )
        config = self.run.config
        _write_json(
            run_dir / MARKER,
            {
                "run_tag": config.run_tag,
                "app": config.app,
                "image": config.image,
                "cpu": config.cpu,
                "memory_mib": config.memory_mib,
                "timeout_seconds": config.timeout_seconds,
                "worst_case_usd": round(self.run.worst_case_usd, 4),
                "usd_cap": self.usd_cap,
                "prepared_at": self.run.started,
                "pid": os.getpid(),
            },
        )
        from .glhf_modal_sandbox import PROVIDER  # registers the provider with Inspect

        return PROVIDER, config.model_dump()

    def finish(self) -> dict[str, Any]:
        if self.run is None:
            return {}
        leftover = self.run.finish()
        settings = self.run.settings(leftover)
        settings["usd_cap"] = self.usd_cap
        return settings


def _write_json(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value, indent=2))
    os.replace(temporary, path)


def terminate(run_dir: Path, *, now: float | None = None) -> dict[str, Any]:
    """The engine's last net, after it had to stop the runner of `run_dir` (a runner that is killed
    cannot terminate its own sandboxes): terminate every sandbox of the app that carries this
    run's tag and is still alive, and give each a ledger line (seconds counted from when the run
    was prepared: an upper bound). Returns {"terminated": [ids], "errors": [...]}; never raises
    for a Modal error. Not refused while paid calls are off: it creates nothing and only ends
    billing."""
    marker = json.loads((run_dir / MARKER).read_text(encoding="utf-8"))
    tag, app = str(marker["run_tag"]), str(marker["app"])
    ended: list[str] = []
    errors: list[str] = []
    try:
        import modal

        from . import modal_sandbox
    except ImportError as error:
        return {"terminated": [], "errors": [f"the modal group is not installed: {error}"]}
    try:
        alive = modal_sandbox.live_sandboxes(app, tag)
    except Exception as error:
        return {"terminated": [], "errors": [f"listing this run's sandboxes failed: {error}"[:300]]}
    began = float(marker.get("prepared_at") or 0.0)
    for sandbox_id in alive:
        note = ""
        try:
            modal.Sandbox.from_id(sandbox_id).terminate()
            ended.append(sandbox_id)
        except Exception as error:
            note = f"terminate failed: {error}"[:200]
            errors.append(f"{sandbox_id}: {note}")
        line = modal_cost.sandbox_line(
            seconds=max(0.0, (now or time.time()) - began) if began else 0.0,
            cpu=float(marker.get("cpu") or 4.0),
            memory_mib=int(marker.get("memory_mib") or 16384),
            what="left over after the runner was stopped; terminated by the engine",
            run=run_dir.name,
            sandbox_id=sandbox_id,
            app=app,
            ok=False,
            note=note,
            seconds_source="wall-clock, run prepared to the engine's check (upper bound)",
        )
        try:
            modal_cost.append([run_dir / modal_cost.LEDGER_NAME], line)
        except OSError as error:
            errors.append(f"ledger write failed: {error}"[:200])
    return {"terminated": ended, "errors": errors}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m bixbench_v1.glhf_modal",
        description="Terminate the Modal sandboxes a stopped glhf_local run left (the engine's "
        "last net). Prints one JSON object.",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    stop = sub.add_parser("terminate", help="terminate this run's sandboxes that are still alive")
    stop.add_argument("--run-dir", type=Path, required=True)
    arguments = parser.parse_args(argv)
    if not (arguments.run_dir / MARKER).is_file():
        print(json.dumps({"terminated": [], "errors": [], "note": f"no {MARKER}: nothing ran"}))
        return 0
    result = terminate(arguments.run_dir)
    print(json.dumps(result))
    return 0 if not result["errors"] else 1


if __name__ == "__main__":
    sys.exit(main())
