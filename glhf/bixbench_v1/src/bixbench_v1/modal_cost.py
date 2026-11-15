"""Cost of Modal sandboxes: prices, one ledger line per sandbox, sums and a cap.

Prices are the "Sandbox" rows of `modal billing rates` (the same numbers as modal.com/pricing),
read on the date in `PRICES_READ`. A sandbox is charged per second for the CPU cores and the
memory it holds. We ask for a fixed size (request = limit), so

    dollars = seconds x (cores x CPU price + GiB x memory price)

and `seconds` is wall-clock from the moment the sandbox was asked for to the moment it was
terminated, measured on the machine that runs the command. That is our estimate, not Modal's
bill: Modal's own report (`modal billing report`) is the authority and may differ by a few
seconds per sandbox. Image builds and volume storage are separate lines.

The ledger is JSON Lines, one line per sandbox, appended to `<run folder>/modal_ledger.jsonl`
and to the cumulative `glhf/bixbench_v1/runs/modal_ledger.jsonl` (both gitignored). The format
is shared with glhf/openmodels (GPU endpoints). Two agents wrote the two halves at the same
time, so every line carries both spellings of the common keys (ts/at, kind/source, who/job,
seconds_source/seconds_from, price/rates) and a reader must accept either and skip a line it
cannot parse.

This module imports nothing from Modal.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

PRICES_READ = "modal billing rates, 2026-11-15"
# Sandbox prices, USD. Per hour as Modal prints them; per second as used here.
SANDBOX_CPU_CORE_HOUR = 0.1419
SANDBOX_MEMORY_GIB_HOUR = 0.024
VOLUME_GIB_MONTH = 0.09
SANDBOX_CPU_CORE_SECOND = SANDBOX_CPU_CORE_HOUR / 3600
SANDBOX_MEMORY_GIB_SECOND = SANDBOX_MEMORY_GIB_HOUR / 3600

WHO = "modal-sandbox"
LEDGER_NAME = "modal_ledger.jsonl"
DEFAULT_CAP_USD = 5.0  # per --out folder; see `check_cap`


def sandbox_rate(cpu: float, memory_mib: int) -> float:
    """USD per second of one sandbox of this size."""
    return cpu * SANDBOX_CPU_CORE_SECOND + (memory_mib / 1024) * SANDBOX_MEMORY_GIB_SECOND


def sandbox_usd(seconds: float, cpu: float, memory_mib: int) -> float:
    return max(0.0, seconds) * sandbox_rate(cpu, memory_mib)


def sandbox_line(
    *,
    seconds: float,
    cpu: float,
    memory_mib: int,
    what: str,
    run: str | None = None,
    capsule: str | None = None,
    solver: str | None = None,
    sandbox_id: str | None = None,
    app: str | None = None,
    ok: bool = True,
    note: str = "",
    kind: str = "sandbox",
    seconds_source: str = "wall-clock, create to terminate, measured by the client",
    usd: float | None = None,
) -> dict[str, Any]:
    """One ledger line. `usd` is computed from the size and the seconds unless given."""
    now = datetime.now(UTC).isoformat(timespec="seconds")
    cost = round(sandbox_usd(seconds, cpu, memory_mib) if usd is None else usd, 6)
    memory_gib = round(memory_mib / 1024, 3)
    price = {
        "cpu_core_s": SANDBOX_CPU_CORE_SECOND,
        "mem_gib_s": SANDBOX_MEMORY_GIB_SECOND,
        "gpu_s": None,
        "read_from": PRICES_READ,
    }
    return {
        "ts": now,
        "kind": kind,
        "who": WHO,
        "run": run,
        "capsule": capsule,
        "solver": solver,
        "resource": {"cpu": cpu, "memory_gib": memory_gib, "gpu": None},
        "seconds": round(seconds, 1),
        "seconds_source": seconds_source,
        "usd": cost,
        "price": price,
        "modal_ids": {"app": app, "sandbox": sandbox_id},
        "note": note,
        # The same facts under the other spelling of the shared format.
        "at": now,
        "source": kind,
        "job": WHO,
        "what": what,
        "seconds_from": "wall-clock",
        "rates": {
            "sandbox_cpu_core_s": price["cpu_core_s"],
            "sandbox_mem_gib_s": price["mem_gib_s"],
        },
        "ok": ok,
        "cpu": cpu,
        "memory_gib": memory_gib,
        "sandbox_id": sandbox_id,
    }


def append(paths: Iterable[Path], line: dict[str, Any]) -> None:
    """Append one line to each ledger file: one write on an O_APPEND descriptor, so lines from
    two processes do not interleave."""
    data = (json.dumps(line, sort_keys=True) + "\n").encode("utf-8")
    for path in paths:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
        try:
            os.write(fd, data)
        finally:
            os.close(fd)


def read(path: Path) -> list[dict[str, Any]]:
    """Every parsable line of a ledger file. A bad line is skipped, never an error."""
    lines: list[dict[str, Any]] = []
    if not path.exists():
        return lines
    for raw in path.read_text(encoding="utf-8").splitlines():
        try:
            row = json.loads(raw)
        except ValueError:
            continue
        if isinstance(row, dict):
            lines.append(row)
    return lines


def _who(row: dict[str, Any]) -> str | None:
    value = row.get("who", row.get("job"))
    return str(value) if value is not None else None


def spent(rows: Iterable[dict[str, Any]], who: str | None = WHO) -> float:
    """Sum of `usd` over the lines of one writer (`who=None`: everyone)."""
    total = 0.0
    for row in rows:
        if who is not None and _who(row) != who:
            continue
        try:
            total += float(row.get("usd") or 0.0)
        except (TypeError, ValueError):
            continue
    return total


def per_capsule(rows: Iterable[dict[str, Any]]) -> dict[str, dict[str, float]]:
    """Sandbox seconds and dollars per capsule, over this writer's sandbox lines."""
    out: dict[str, dict[str, float]] = {}
    for row in rows:
        if _who(row) != WHO or row.get("kind", row.get("source")) != "sandbox":
            continue
        capsule = str(row.get("capsule") or "unknown")
        cell = out.setdefault(capsule, {"sandboxes": 0, "seconds": 0.0, "usd": 0.0})
        cell["sandboxes"] += 1
        cell["seconds"] = round(cell["seconds"] + float(row.get("seconds") or 0.0), 1)
        cell["usd"] = round(cell["usd"] + float(row.get("usd") or 0.0), 6)
    return out


class ModalCapReached(RuntimeError):
    """The next run could pass the Modal spending cap of this run folder."""


def worst_case_usd(timeout_seconds: int, cpu: float, memory_mib: int, sandboxes: int) -> float:
    """The most one run can cost: every sandbox of it alive until its own timeout."""
    return sandboxes * sandbox_usd(timeout_seconds, cpu, memory_mib)


def check_cap(ledger: Path, cap_usd: float | None, worst_case: float) -> float:
    """Refuse to start a run when what this folder's ledger already holds, plus the most the
    run could cost, would pass the cap. Returns what is spent so far."""
    so_far = spent(read(ledger))
    if cap_usd is not None and so_far + worst_case > cap_usd:
        raise ModalCapReached(
            f"Modal sandbox cap: {so_far:.4f} USD already in {ledger}, this run could cost up to "
            f"{worst_case:.4f} USD, cap {cap_usd:.2f} USD (--modal-usd-cap)"
        )
    return so_far
