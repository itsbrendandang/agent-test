"""Several runs at once (`bixbench-v1 run --jobs N`): one child process per run.

Inspect allows one eval per process, so each run is a child: `bixbench-v1 solve-one <spec>`.
The child only solves (`run_capsule`). The parent alone grades, writes budget.json and writes
the report, so every shared file has one writer.

A run starts only when the caps still cover the most that it and every running run can spend:

    tokens:  spent + reserved by running runs + this run's worst case <= --total-token-cap
    Modal:   ledger spend + reserved by running runs + this run's worst case <= --modal-usd-cap

A run that does not fit waits for the running ones. STOP is said only when nothing is running
and the next run still does not fit, so `--jobs 1` stops exactly where the serial loop stops.
Runs start in the serial loop's order. The one exception is on Modal: the first run of a
capsule uploads its data to the Volume, so other runs of that capsule wait until it has ended,
and a later run of another capsule may start first.

Nothing here makes a paid call. The child goes through `cli.main`, so the NO_PAID_CALLS switch
is enforced there again.
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import IO, Any, Protocol

# Seconds a child is given to end after Ctrl+C (Modal terminates its sandboxes and the outputs
# are copied back), then after SIGTERM, before it is killed.
INTERRUPT_GRACE_SECONDS = 120
TERMINATE_GRACE_SECONDS = 15
JOBS_DIR = "_jobs"  # under --out: specs, child logs, results; no run.json, so no report reads it


@dataclass
class Unit:
    """One run: a capsule (or one question of it), one solver, one repeat."""

    name: str  # the run folder relative to --out, e.g. "bix-26_abc/single"
    capsule_uuid: str
    run_dir: Path
    worst_tokens: int  # reserved while it runs: the token backstop plus the judge reserve
    backstop_tokens: int  # charged when what it spent is unknown
    worst_usd: float = 0.0  # Modal: every sandbox alive until its timeout; 0 for Docker
    questions: int = 0  # how many questions the run is asked
    run: dict[str, Any] = field(default_factory=dict)  # run_capsule's keyword arguments

    @property
    def slug(self) -> str:
        return self.name.replace("/", "__")


@dataclass
class Caps:
    tokens: int | None  # --total-token-cap
    usd: float | None  # --modal-usd-cap; None when the sandbox is Docker
    usd_spent: Callable[[], float] = lambda: 0.0  # what the --out folder's Modal ledger holds
    upload_first: bool = False  # Modal: a capsule's first run ends before its others start


class Handle(Protocol):
    def poll(self) -> int | None: ...
    def interrupt(self) -> None: ...
    def terminate(self) -> None: ...
    def kill(self) -> None: ...


def next_start(
    pending: list[Unit],
    running: list[Unit],
    *,
    jobs: int,
    spent: int,
    caps: Caps,
    ready: set[str],
) -> tuple[int | None, str | None]:
    """Which pending run to start now (its index), or None to wait. The second value is a STOP
    message: nothing is running and the next run does not fit a cap."""
    if len(running) >= jobs or not pending:
        return None, None
    busy = {u.capsule_uuid for u in running}
    for index, unit in enumerate(pending):
        if caps.upload_first and unit.capsule_uuid not in ready and unit.capsule_uuid in busy:
            continue  # its capsule's first run is still uploading the data; look further
        reserved = sum(u.worst_tokens for u in running)
        if caps.tokens and spent + reserved + unit.worst_tokens > caps.tokens:
            if running:
                return None, None
            return None, (
                f"STOP before {unit.run_dir}: {spent:,} tokens spent, this run could use "
                f"{unit.worst_tokens:,}, cap {caps.tokens:,}"
            )
        if caps.usd is not None and unit.worst_usd:
            so_far = caps.usd_spent()
            held = sum(u.worst_usd for u in running)
            if so_far + held + unit.worst_usd > caps.usd:
                if running:
                    return None, None
                return None, (
                    f"STOP before {unit.run_dir}: Modal sandbox cap: {so_far:.4f} USD already "
                    f"in the ledger, this run could cost up to {unit.worst_usd:.4f} USD, cap "
                    f"{caps.usd:.2f} USD (--modal-usd-cap)"
                )
        return index, None
    return None, None


def run_all(
    units: list[Unit],
    *,
    jobs: int,
    caps: Caps,
    spent: Callable[[], int],
    launch: Callable[[Unit], Handle],
    finished: Callable[[Unit, int], str | None],
    abandoned: Callable[[Unit], None],
    say: Callable[[str], None] = print,
    poll_seconds: float = 1.0,
    sleep: Callable[[float], None] | None = None,
    grace: tuple[float, float] = (INTERRUPT_GRACE_SECONDS, TERMINATE_GRACE_SECONDS),
) -> str | None:
    """Run every unit, at most `jobs` at once. `finished(unit, exit_code)` is called in the
    parent for each run that ended; it grades and charges, and returns a STOP message if no
    more runs may start. `abandoned(unit)` charges a run that was interrupted. Returns the STOP
    message, or None when every unit ran. Ctrl+C is passed on to the children, and
    KeyboardInterrupt is raised again once they have ended."""
    sleep = sleep or time.sleep
    pending = list(units)
    running: list[tuple[Unit, Handle]] = []
    ready: set[str] = set()
    stop: str | None = None
    try:
        while pending or running:
            for unit, handle in list(running):
                code = handle.poll()
                if code is None:
                    continue
                running.remove((unit, handle))
                ready.add(unit.capsule_uuid)
                reason = finished(unit, code)
                if reason and stop is None:
                    stop = reason
            while stop is None:
                index, reason = next_start(
                    pending,
                    [u for u, _ in running],
                    jobs=jobs,
                    spent=spent(),
                    caps=caps,
                    ready=ready,
                )
                if reason:
                    stop = reason
                if index is None:
                    break
                unit = pending.pop(index)
                running.append((unit, launch(unit)))
            if stop is not None:
                pending.clear()  # start nothing more; let the running runs end
            if running:
                sleep(poll_seconds)
    except KeyboardInterrupt:
        say(f"interrupted: ending {len(running)} running run(s)")
        _end_all(running, grace, poll_seconds, sleep)
        for unit, _ in running:
            abandoned(unit)
        raise
    if stop:
        say(stop)
    return stop


def _end_all(
    running: list[tuple[Unit, Handle]],
    grace: tuple[float, float],
    poll_seconds: float,
    sleep: Callable[[float], None],
) -> None:
    """Ctrl+C to each child, then SIGTERM, then SIGKILL, each after its grace period. A second
    Ctrl+C skips to SIGKILL."""
    steps: list[tuple[Callable[[Handle], None], float]] = [
        (lambda h: h.interrupt(), grace[0]),
        (lambda h: h.terminate(), grace[1]),
    ]
    try:
        for send, seconds in steps:
            alive = [h for _, h in running if h.poll() is None]
            if not alive:
                return
            for handle in alive:
                send(handle)
            waited = 0.0
            while waited < seconds and any(h.poll() is None for h in alive):
                sleep(poll_seconds)
                waited += poll_seconds
    except KeyboardInterrupt:
        pass
    for _, handle in running:
        if handle.poll() is None:
            handle.kill()


class Child:
    """A child process in its own session: the terminal's Ctrl+C reaches only the parent, which
    passes it on, so every child gets it exactly once."""

    def __init__(self, argv: list[str], log: Path) -> None:
        log.parent.mkdir(parents=True, exist_ok=True)
        self._log: IO[bytes] | None = log.open("ab")
        self.proc = subprocess.Popen(
            argv,
            stdin=subprocess.DEVNULL,
            stdout=self._log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )

    def poll(self) -> int | None:
        code = self.proc.poll()
        if code is not None and self._log is not None:
            self._log.close()
            self._log = None
        return code

    def _send(self, sig: signal.Signals) -> None:
        try:
            os.killpg(self.proc.pid, sig)
        except (ProcessLookupError, PermissionError):
            pass

    def interrupt(self) -> None:
        self._send(signal.SIGINT)

    def terminate(self) -> None:
        self._send(signal.SIGTERM)

    def kill(self) -> None:
        self._send(signal.SIGKILL)


# --- The spec a child reads, and the result it writes -------------------------------------------

PATH_ARGUMENTS = ("hub_dir", "staged_root", "out_dir")


def spec_paths(out: Path, unit: Unit) -> tuple[Path, Path, Path]:
    """(spec, result, log) of a unit, under --out/_jobs/."""
    folder = out / JOBS_DIR
    return (
        folder / f"{unit.slug}.json",
        folder / f"{unit.slug}.result.json",
        folder / f"{unit.slug}.log",
    )


def write_spec(path: Path, unit: Unit, result: Path, checks: dict[str, Any]) -> None:
    """What the child needs: the capsule by uuid (never the Capsule, which holds the answers),
    run_capsule's arguments, and the models and sandbox it checks against NO_PAID_CALLS."""
    run = dict(unit.run)
    for name in PATH_ARGUMENTS:
        run[name] = str(run[name])
    run["modal_ledgers"] = [str(p) for p in run.get("modal_ledgers") or []]
    document = {
        "capsule_uuid": unit.capsule_uuid,
        "result": str(result),
        "checks": checks,
        "run": run,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    write_json(path, document)


def read_spec(path: Path) -> dict[str, Any]:
    document: dict[str, Any] = json.loads(path.read_text())
    run = document["run"]
    for name in PATH_ARGUMENTS:
        run[name] = Path(run[name])
    run["modal_ledgers"] = [Path(p) for p in run.get("modal_ledgers") or []]
    return document


def read_result(path: Path) -> dict[str, Any]:
    try:
        document = json.loads(path.read_text())
    except (OSError, ValueError):
        return {"ok": False, "kind": "error", "error": "the child wrote no result"}
    return document if isinstance(document, dict) else {"ok": False, "kind": "error"}


def write_json(path: Path, document: Any) -> None:
    """Write in one step (a temporary file, then a rename), so a reader never sees half a file."""
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(document, indent=2))
    os.replace(temporary, path)
