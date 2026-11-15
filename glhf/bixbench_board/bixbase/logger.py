"""Run logging: JSONL transcript + reproducible final script.

Every run writes <run_dir>/transcript.jsonl with one event per line:
  run_start, message, member_input, member_output, tool_call, tool_result, cell,
  final_answer, budget, run_end
Every line has `t` (Unix time, seconds) and `event`, and is flushed as it is written, so the
file can be followed while the run goes on. Lines from members that work at the same time
never mix: writes take a lock. The fields are described for readers in
docs/proposals/concurrent-board-runs-ui.md.
All code cells also accumulate into <run_dir>/final_script.py so the analysis
is reproducible outside the agent loop.

Never log secrets: this module only records payloads it is explicitly given;
env vars and client internals are never serialized.
"""

from __future__ import annotations

import json
import platform
import subprocess
import threading
import time
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

_TRACKED_PKGS = [
    "anthropic", "openai", "pandas", "numpy", "scipy",
    "statsmodels", "matplotlib", "datasets", "bixbase",
]


class RunLogger:
    def __init__(self, run_dir: Path):
        self.run_dir = Path(run_dir)
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self._fh = open(  # noqa: SIM115 - closed in close()
            self.run_dir / "transcript.jsonl", "w", buffering=1
        )
        self._script = self.run_dir / "final_script.py"
        self._script.unlink(missing_ok=True)
        self._cell = 0
        self._lock = threading.Lock()  # members can log at the same time

    def log(self, event: str, **payload: Any) -> None:
        line = json.dumps({"t": round(time.time(), 3), "event": event, **payload}) + "\n"
        with self._lock:
            self._fh.write(line)

    # -- convenience wrappers ------------------------------------------------

    def log_run_start(self, **meta: Any) -> None:
        self.log("run_start", env=self._env_meta(), **meta)

    def log_message(self, role: str, content: Any) -> None:
        self.log("message", role=role, content=content)

    def log_tool_call(
        self, name: str, call_id: str, tool_input: dict, member: str | None = None
    ) -> None:
        extra = {"member": member} if member else {}
        self.log("tool_call", name=name, id=call_id, input=tool_input, **extra)

    def log_tool_result(
        self, call_id: str, name: str, result: str, member: str | None = None
    ) -> None:
        extra = {"member": member} if member else {}
        self.log("tool_result", id=call_id, name=name, result=result, **extra)

    def log_cell(
        self, member: str, call_id: str | None, result: Any, language: str, where: str
    ) -> None:
        """One code cell has ended. It started at the `tool_call` with the same `id`."""
        self.log(
            "cell",
            member=member,
            id=call_id,
            cell=result.cell_index,
            language=language,
            where=where,
            exit_code=result.exit_code,
            timed_out=result.timed_out,
            duration_s=result.duration_s,
            new_files=sorted(result.new_files),
        )

    def log_code_cell(self, code: str, result: Any) -> None:
        """Append a run_code cell to the reproducible script."""
        with self._lock:
            with open(self._script, "a") as f:
                f.write(f"\n# %% cell {self._cell}\n{code}\n")
            self._cell += 1

    def log_final_answer(self, answers: dict, forced: bool, reason: str) -> None:
        self.log("final_answer", answers=answers, forced=forced, reason=reason)

    def log_budget(self, snapshot: dict) -> None:
        self.log("budget", **snapshot)

    def log_run_end(self, **summary: Any) -> None:
        self.log("run_end", **summary)

    def close(self) -> None:
        self._fh.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    # -- provenance -----------------------------------------------------------

    @staticmethod
    def _env_meta() -> dict:
        pkgs = {}
        for p in _TRACKED_PKGS:
            try:
                pkgs[p] = version(p)
            except PackageNotFoundError:
                pass
        try:
            git = subprocess.run(
                ["git", "rev-parse", "--short", "HEAD"],
                capture_output=True, text=True, timeout=5,
            )
            git_sha = git.stdout.strip() or None
        except Exception:  # noqa: BLE001
            git_sha = None
        return {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "packages": pkgs,
            "git_sha": git_sha,
        }
