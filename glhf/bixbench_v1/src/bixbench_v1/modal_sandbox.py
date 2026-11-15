"""`--sandbox modal`: the analysis sandbox of a run as a Modal Sandbox.

A thin subclass of the published `inspect-sandboxes` Modal provider (0.6.1). That provider
already does exec with `user=` (through `su`), file reads and writes, retries and termination.
This subclass adds what the adapter's integrity rules need:

  - the sandbox is made from `modal_boundary.sandbox_plan` and nothing else: our published
    image, network blocked, one read-only Volume folder, fixed CPU and memory, a timeout;
  - before the solver runs, a probe inside the sandbox must show: no network, no secret-like
    variable, no answer file, and /data byte-identical with the staged files on the host.
    Otherwise the sandbox is terminated and the run stops with `staging.IntegrityError`;
  - `exec(user=...)` sets HOME to that user's home, as `docker exec --user` does (plain
    `su -p` keeps root's HOME), and every command runs without the variables Modal adds to
    a container (PYTHONHASHSEED=0, PYTHONPATH, MODAL_* and others), so a command sees the
    environment the official image gives it;
  - the swarm's critic gets its own, new sandbox (`fresh_sandbox`). Under Modal's runtime
    (gVisor) the in-container blind check cannot see System V IPC objects or message queues
    (there is no /proc/sysvipc and no /dev/mqueue), so one sandbox for both roles cannot be
    shown to be blind. Two sandboxes can: nothing is shared but the read-only data;
  - /outputs is a plain directory in the sandbox; it is copied to the host when the sample
    ends, also after an error or an interrupt, and unpacked with `safe_members`;
  - every sandbox is terminated and gets one line in the cost ledger. `terminate_run` is the
    last net: it finds this run's sandboxes by tag and terminates any that is still there.

Host paths (the outputs folder, the ledger files) are kept in `RUNS`, in this process, not in
the sandbox config: the config is written to the eval log.
"""

from __future__ import annotations

import asyncio
import contextlib
import time
import warnings
from collections.abc import Iterator
from dataclasses import dataclass, field
from logging import getLogger
from pathlib import Path
from typing import Any, override

import modal
from inspect_ai.util import (
    ExecResult,
    SandboxEnvironment,
    SandboxEnvironmentConfigType,
    sandboxenv,
)
from inspect_sandboxes.modal import _modal as upstream
from inspect_sandboxes.modal._modal import (
    ModalSandboxEnvironment,
    running_sandboxes,
)
from pydantic import BaseModel

from . import modal_boundary as boundary
from . import modal_cost, staging
from .modal_boundary import BixModalConfig, FreshSandbox

logger = getLogger(__name__)

PROVIDER = "bixbench_modal"
# `docker exec --user NAME` sets HOME from the image's passwd file and nothing else. The
# provider's `su -p` keeps the caller's (root's) HOME, so it is set here, inside the `su`.
_AS_USER = (
    'h=$(getent passwd "$1" 2>/dev/null | cut -d: -f6); [ -n "$h" ] && HOME="$h" && export HOME; '
    'shift; exec "$@"'
)


@dataclass
class RunContext:
    """Host-side state of one run: where its outputs and ledger lines go, what was measured."""

    outputs_dir: Path
    ledgers: list[Path]
    run: str | None = None
    capsule: str | None = None
    solver: str | None = None
    records: list[dict[str, Any]] = field(default_factory=list)  # one per sandbox
    created: dict[str, float] = field(default_factory=dict)  # sandbox id -> when it was asked for
    held: list[tuple[str, bytes]] = field(default_factory=list)  # carried over by fresh_sandbox
    probes: list[dict[str, Any]] = field(default_factory=list)
    image_id: str | None = None
    copied_out: bool = False
    errors: list[str] = field(default_factory=list)


RUNS: dict[str, RunContext] = {}


def register_run(run_tag: str, context: RunContext) -> None:
    RUNS[run_tag] = context


def _config(config: SandboxEnvironmentConfigType | None) -> BixModalConfig:
    if isinstance(config, BixModalConfig):
        return config
    raise ValueError(f"the {PROVIDER} sandbox needs a BixModalConfig, got {type(config).__name__}")


@sandboxenv(name=PROVIDER)
class BixModalSandbox(ModalSandboxEnvironment, FreshSandbox):
    """One run's sandbox. `self.sandbox` is the current Modal sandbox; `fresh_sandbox`
    replaces it."""

    def __init__(self, sandbox: modal.Sandbox, config: BixModalConfig, started: float) -> None:
        super().__init__(sandbox, has_tunnels=False, working_dir="/home")
        self.bix = config
        self._started = started
        self._closed = False

    @classmethod
    def config_files(cls) -> list[str]:
        return []  # never discovered from a compose file: only from a BixModalConfig

    @classmethod
    def config_deserialize(cls, config: dict[str, Any]) -> BaseModel:
        return BixModalConfig(**config)

    @override
    @classmethod
    async def task_init(cls, task_name: str, config: SandboxEnvironmentConfigType | None) -> None:
        await super().task_init(task_name, config)

    # Creation -----------------------------------------------------------------------------
    @classmethod
    async def _start(cls, config: BixModalConfig) -> tuple[modal.Sandbox, float, dict[str, Any]]:
        """Create one sandbox from the plan, place the data, run the probe. Terminates the
        sandbox and raises `staging.IntegrityError` if the probe finds anything."""
        plan = boundary.sandbox_plan(config)
        app = await cls._lookup_app(plan["app"])
        image = modal.Image.from_name(plan["image"])
        volume = modal.Volume.from_name(plan["volume"]["name"]).with_mount_options(
            read_only=plan["volume"]["read_only"], sub_path=plan["volume"]["sub_path"]
        )
        kwargs: dict[str, Any] = {
            "app": app,
            "image": image,
            "workdir": plan["workdir"],
            "block_network": plan["block_network"],
            "volumes": {plan["volume"]["mount"]: volume},
            "cpu": plan["cpu"],
            "memory": plan["memory"],
            "timeout": plan["timeout"],
        }
        boundary.check_create_kwargs(kwargs)
        started = time.time()
        sandbox = await cls._create_sandbox(plan["command"], kwargs)
        running_sandboxes().append(sandbox.object_id)
        context = RUNS.get(config.run_tag)
        if context is not None:
            context.created[sandbox.object_id] = started
        try:
            await sandbox.set_tags.aio(plan["tags"])
            if context is not None and context.image_id is None:
                context.image_id = getattr(image, "object_id", None)
            placed = await _raw_exec(sandbox, ["bash", "-c", boundary.PLACE_DATA], timeout=900)
            if placed[0] != 0:
                raise staging.IntegrityError(f"placing /data failed: {placed[2][-300:]}")
            probed = await _raw_exec(sandbox, ["python3", "-c", boundary.PROBE], timeout=300)
            if probed[0] != 0:
                raise staging.IntegrityError(f"the sandbox probe failed: {probed[2][-300:]}")
            result = boundary.parse_probe(probed[1])
            problems = boundary.probe_problems(result, config)
            if problems:
                raise staging.IntegrityError("Modal sandbox refused: " + "; ".join(problems))
        except BaseException:
            cls._finish(sandbox, config, started, "refused at start", ok=False)
            raise
        if context is not None:
            context.probes.append({"sandbox": sandbox.object_id, **result})
        return sandbox, started, result

    @classmethod
    def _finish(
        cls,
        sandbox: modal.Sandbox,
        config: BixModalConfig,
        started: float,
        what: str,
        ok: bool = True,
    ) -> None:
        """Terminate one sandbox and write its ledger line. Never raises.

        Blocking on purpose (Modal's synchronous API, which runs on its own thread): after
        Ctrl+C the sample's task is cancelled, and an awaited call here would be cancelled
        with it, leaving the sandbox to its timeout and its cost unrecorded."""
        note = ""
        try:
            with _quiet():
                sandbox.terminate()
                if sandbox.poll() is None:
                    raise RuntimeError("still running after terminate()")
        except Exception as error:  # the run-level net (terminate_run) looks again
            note = f"terminate failed: {error}"[:200]
            ok = False
        seconds = time.time() - started
        try:
            ids = running_sandboxes()
            if sandbox.object_id in ids and not note:
                ids.remove(sandbox.object_id)
        except LookupError:
            pass
        context = RUNS.get(config.run_tag)
        line = modal_cost.sandbox_line(
            seconds=seconds,
            cpu=config.cpu,
            memory_mib=config.memory_mib,
            what=what,
            run=context.run if context else None,
            capsule=context.capsule if context else None,
            solver=context.solver if context else None,
            sandbox_id=sandbox.object_id,
            app=config.app,
            ok=ok,
            note=note,
        )
        if context is not None:
            context.records.append(line)
            try:
                modal_cost.append(context.ledgers, line)
            except OSError as error:
                context.errors.append(f"ledger write failed: {error}"[:200])

    @override
    @classmethod
    async def sample_init(
        cls,
        task_name: str,
        config: SandboxEnvironmentConfigType | None,
        metadata: dict[str, str],
    ) -> dict[str, SandboxEnvironment]:
        chosen = _config(config)
        sandbox, started, _ = await cls._start(chosen)
        return {"default": cls(sandbox, chosen, started)}

    # The critic's own sandbox -----------------------------------------------------------------
    @override
    async def fresh_sandbox(self, keep: list[str]) -> None:
        """Replace this run's sandbox with a new one from the same plan. The files under `keep`
        are carried on the host and added to the outputs at the end; the old sandbox, with
        everything in it, is terminated before the new one is used."""
        context = RUNS.get(self.bix.run_tag)
        old, old_started = self.sandbox, self._started
        if context is not None:
            for path in keep:
                try:
                    context.held += [
                        (
                            f"{path.removeprefix(boundary.OUTPUTS_DIR).strip('/')}/{name}".strip(
                                "/"
                            ),
                            data,
                        )
                        for name, data in await _archive(old, path)
                    ]
                except Exception as error:
                    context.errors.append(f"could not keep {path}: {error}"[:200])
        new, started, _ = await self._start(self.bix)  # raises if the new sandbox is not clean
        self.sandbox, self._started = new, started
        self._tools_user = None  # the tool helper is injected again, into the new sandbox
        self._finish(old, self.bix, old_started, "analyst's sandbox, replaced for the critic")

    # Exec -----------------------------------------------------------------------------------
    @override
    async def exec(
        self,
        cmd: list[str],
        input: str | bytes | None = None,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        user: str | None = None,
        timeout: int | None = None,
        timeout_retry: bool = True,
        concurrency: bool = True,
    ) -> ExecResult[str]:
        if user is not None and user != "root" and not (env and "HOME" in env):
            cmd = ["/bin/sh", "-c", _AS_USER, "sh", user, *cmd]
        cmd = boundary.clean_env_command(cmd, env)
        return await super().exec(
            cmd,
            input=input,
            cwd=cwd,
            env=env,
            user=user,
            timeout=timeout,
            timeout_retry=timeout_retry,
            concurrency=concurrency,
        )

    # Cleanup ----------------------------------------------------------------------------------
    def close(self, reason: str) -> None:
        """Copy /outputs to the host, then terminate. Safe to call twice. Blocking, for the
        reason given in `_finish`: it must also work when the sample has been cancelled."""
        if self._closed:
            return
        self._closed = True
        context = RUNS.get(self.bix.run_tag)
        try:
            if context is not None:
                try:
                    files = _archive_blocking(self.sandbox, boundary.OUTPUTS_DIR)
                    boundary.write_members(files, context.outputs_dir)
                    context.copied_out = True
                except Exception as error:
                    context.errors.append(f"copying /outputs out failed: {error}"[:300])
                try:  # the analyst's scripts, carried on the host since the critic's sandbox
                    boundary.write_members(context.held, context.outputs_dir, overwrite=False)
                except Exception as error:
                    context.errors.append(f"adding kept files failed: {error}"[:300])
        finally:
            self._finish(self.sandbox, self.bix, self._started, reason)

    @override
    @classmethod
    async def sample_cleanup(
        cls,
        task_name: str,
        config: SandboxEnvironmentConfigType | None,
        environments: dict[str, SandboxEnvironment],
        interrupted: bool,
    ) -> None:
        # The parent leaves an interrupted sample's sandbox to task_cleanup. Here it is closed
        # in both cases: the outputs of a cut run are still wanted, and a sandbox costs money.
        for env in environments.values():
            try:
                mine = env.as_type(BixModalSandbox)
            except TypeError:
                continue
            try:
                mine.close("interrupted" if interrupted else "run ended")
            except Exception as error:
                logger.warning(f"closing Modal sandbox failed: {error}")


async def _raw_exec(sandbox: modal.Sandbox, cmd: list[str], timeout: int) -> tuple[int, str, str]:
    """(exit code, stdout, stderr) of a root command, straight through Modal's API."""

    async def run() -> tuple[int, str, str]:
        process = await sandbox.exec.aio(*cmd)
        stdout = await process.stdout.read.aio()
        stderr = await process.stderr.read.aio()
        await process.wait.aio()
        return int(process.returncode or 0), stdout, stderr

    return await asyncio.wait_for(run(), timeout=timeout)


@contextlib.contextmanager
def _quiet() -> Iterator[None]:
    """Modal warns when its blocking API is called from a running event loop. Here that is
    intended (see `_finish`), so the warning is not shown."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        yield


def _archive_blocking(sandbox: modal.Sandbox, source: str) -> list[tuple[str, bytes]]:
    """`_archive` through Modal's blocking API (used at cleanup, see `_finish`)."""
    script = f"[ -d {source} ] || exit 3; " + boundary.ARCHIVE_COMMAND.format(source=source)
    with _quiet():
        process = sandbox.exec("bash", "-c", script, timeout=300)
        stdout = process.stdout.read()
        stderr = process.stderr.read()
        process.wait()
        code = int(process.returncode or 0)
        if code == 3:
            return []
        if code != 0:
            raise RuntimeError(f"archiving {source} failed: {stderr[-200:]}")
        size = int(stdout.strip().splitlines()[-1])
        if size > boundary.MAX_ARCHIVE_BYTES:
            raise boundary.UnsafeArchive(f"{source} archives to {size:,} bytes; the limit is 50 MB")
        payload = sandbox.filesystem.read_bytes(boundary.ARCHIVE_PATH)
    return boundary.safe_members(payload)


async def _archive(sandbox: modal.Sandbox, source: str) -> list[tuple[str, bytes]]:
    """The regular files under `source` in the sandbox, read safely (see `safe_members`)."""
    code, stdout, stderr = await _raw_exec(
        sandbox,
        [
            "bash",
            "-c",
            f"[ -d {source} ] || exit 3; " + boundary.ARCHIVE_COMMAND.format(source=source),
        ],
        300,
    )
    if code == 3:
        return []
    if code != 0:
        raise RuntimeError(f"archiving {source} failed: {stderr[-200:]}")
    size = int(stdout.strip().splitlines()[-1])
    if size > boundary.MAX_ARCHIVE_BYTES:
        raise boundary.UnsafeArchive(f"{source} archives to {size:,} bytes; the limit is 50 MB")
    payload = await sandbox.filesystem.read_bytes.aio(boundary.ARCHIVE_PATH)
    return boundary.safe_members(payload)


# The last net -------------------------------------------------------------------------------------
def _tagged_alive(run_tag: str, app_name: str) -> list[Any]:
    app = modal.App.lookup(app_name, create_if_missing=True)
    return [
        sandbox
        for sandbox in modal.Sandbox.list(app_id=app.app_id, tags={boundary.RUN_TAG: run_tag})
        if sandbox.poll() is None
    ]


def terminate_run(run_tag: str, config: BixModalConfig, started: float) -> list[str]:
    """Make sure no sandbox of this run is alive and each has a ledger line. Called by
    runner.py in a `finally`, so it runs after a normal end (finds nothing), after an error and
    after Ctrl+C. Two kinds are handled: a sandbox still alive (found on Modal by the run's
    tag), which is terminated here, and a sandbox this process created that has no ledger
    line yet (for example one that Inspect's own task cleanup terminated). Returns the ids."""
    context = RUNS.get(run_tag)
    recorded = {r["sandbox_id"] for r in context.records} if context else set()
    handled: list[str] = []
    try:
        alive = _tagged_alive(run_tag, config.app)
    except Exception as error:
        alive = []
        if context is not None:
            context.errors.append(f"listing this run's sandboxes failed: {error}"[:200])
    candidates: dict[str, Any] = {sandbox.object_id: sandbox for sandbox in alive}
    if context is not None:
        for sandbox_id in context.created:
            if sandbox_id not in recorded and sandbox_id not in candidates:
                candidates[sandbox_id] = None  # ours, no ledger line: look it up by id
    for sandbox_id, sandbox in candidates.items():
        was_alive, note = sandbox is not None, ""
        try:
            target = sandbox if sandbox is not None else modal.Sandbox.from_id(sandbox_id)
            if target.poll() is None:
                was_alive = True
                target.terminate()
        except Exception as error:
            note = f"terminate failed: {error}"[:200]
        began = context.created.get(sandbox_id, started) if context else started
        line = modal_cost.sandbox_line(
            seconds=time.time() - began,  # an upper bound: until now
            cpu=config.cpu,
            memory_mib=config.memory_mib,
            what="left over after the run; terminated by the run-level net"
            if was_alive
            else "ended without a ledger line (terminated by Inspect's task cleanup)",
            run=context.run if context else None,
            capsule=context.capsule if context else None,
            solver=context.solver if context else None,
            sandbox_id=sandbox_id,
            app=config.app,
            ok=False,
            note=note,
            seconds_source="wall-clock, create to the run-level check (upper bound)",
        )
        if context is not None:
            context.records.append(line)
            modal_cost.append(context.ledgers, line)
        handled.append(sandbox_id)
    return handled


def live_sandboxes(app_name: str, run_tag: str | None = None) -> list[str]:
    """Ids of sandboxes of the app that are still running (optionally of one run)."""
    app = modal.App.lookup(app_name, create_if_missing=True)
    tags = {boundary.RUN_TAG: run_tag} if run_tag else None
    return [
        sandbox.object_id
        for sandbox in modal.Sandbox.list(app_id=app.app_id, tags=tags)
        if sandbox.poll() is None
    ]


def terminate_all(app_name: str) -> list[str]:
    """Terminate every running sandbox of the app (for `bixbench-v1 modal-sandboxes
    --terminate`): the way to clean up after a process that was killed outright."""
    app = modal.App.lookup(app_name, create_if_missing=True)
    ended: list[str] = []
    for sandbox in modal.Sandbox.list(app_id=app.app_id):
        if sandbox.poll() is None:
            sandbox.terminate()
            ended.append(sandbox.object_id)
    return ended


def summary(run_tag: str) -> dict[str, Any]:
    """What run.json records about the Modal side of a run."""
    context = RUNS.get(run_tag)
    if context is None:
        return {}
    return {
        "image_id": context.image_id,
        "sandboxes": len(context.records),
        "sandbox_seconds": round(sum(float(r["seconds"]) for r in context.records), 1),
        "sandbox_usd": round(sum(float(r["usd"]) for r in context.records), 6),
        "sandbox_ids": [r["sandbox_id"] for r in context.records],
        "probes": context.probes,
        "outputs_copied": context.copied_out,
        "errors": context.errors,
    }


__all__ = [
    "PROVIDER",
    "RUNS",
    "BixModalConfig",
    "BixModalSandbox",
    "RunContext",
    "live_sandboxes",
    "register_run",
    "summary",
    "terminate_all",
    "terminate_run",
    "upstream",
]
