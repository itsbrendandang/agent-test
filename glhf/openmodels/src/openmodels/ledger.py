"""The Modal cost ledger and the spending cap.

One JSON line per Modal session, appended to the cumulative file
(glhf/bixbench_v1/runs/modal_ledger.jsonl) and to a copy in the run folder. The format is shared
with the Modal sandbox option of bixbench_v1; a reader accepts both sets of key names that the
two were written with and skips a line it cannot parse.

Dollars are an estimate: seconds times the rate of the container (GPU + reserved CPU + reserved
memory, from models.yaml). `seconds_source` says where the seconds came from. Modal's own
figure, when wanted, is `modal billing report --for today -r h --json`."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .registry import Model, Prices

RUNS = Path(__file__).resolve().parents[3] / "bixbench_v1" / "runs"
CUMULATIVE = RUNS / "modal_ledger.jsonl"
OPEN_SESSIONS = RUNS / "modal_open_sessions.json"
WHO = "modal-bench"
CAP_USD = 20.0  # this job's hard limit


class CapExceeded(RuntimeError):
    """Starting would let the estimate pass the cap."""


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def dollars(seconds: float, rate_per_second: float) -> float:
    return round(max(0.0, seconds) * rate_per_second, 4)


def entry(
    model: Model,
    prices: Prices,
    *,
    seconds: float,
    seconds_source: str,
    run: str | None,
    note: str,
    app_id: str | None = None,
) -> dict[str, Any]:
    """One ledger line for a serving session of `model`."""
    rate = prices.per_second(str(model.gpu), model.gpu_count, model.cpu, model.memory_gib)
    return {
        "ts": now(),
        "kind": "gpu_endpoint",
        "who": WHO,
        "run": run,
        "capsule": None,
        "solver": None,
        "resource": {
            "cpu": model.cpu,
            "memory_gib": model.memory_gib,
            "gpu": f"{model.gpu} x{model.gpu_count}",
        },
        "seconds": round(seconds, 1),
        "seconds_source": seconds_source,
        "usd": dollars(seconds, rate),
        "price": {
            "cpu_core_s": prices.cpu_core_per_hour / 3600,
            "mem_gib_s": prices.memory_gib_per_hour / 3600,
            "gpu_s": prices.gpu_per_hour[str(model.gpu)] / 3600,
            "container_s": rate,
            "read_from": prices.read_from,
        },
        "modal_ids": {"app": app_id or model.app_name},
        "note": note,
    }


def append(line: dict[str, Any], *paths: Path) -> None:
    """Append one line to each file with a single write on an append-only descriptor, so two
    writers cannot interleave inside a line."""
    data = (json.dumps(line, sort_keys=True) + "\n").encode()
    for path in paths:
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
        try:
            os.write(descriptor, data)
        finally:
            os.close(descriptor)


def read(path: Path = CUMULATIVE) -> list[dict[str, Any]]:
    """Every readable line. A line that is not a JSON object is skipped, not fatal."""
    if not path.exists():
        return []
    lines: list[dict[str, Any]] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        try:
            item = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(item, dict):
            lines.append(item)
    return lines


def total(path: Path = CUMULATIVE, who: str | None = WHO) -> float:
    """The sum of `usd` over the cumulative file, for one writer (`who`) or for all (None)."""
    spent = 0.0
    for line in read(path):
        writer = line.get("who", line.get("job"))
        usd = line.get("usd")
        if (who is None or writer == who) and isinstance(usd, int | float) and usd > 0:
            spent += float(usd)
    return round(spent, 4)


def worst_case_seconds(
    model: Model, *, runs: int, time_limit_seconds: int, backstop_seconds: int = 300
) -> float:
    """The longest a serving session of `runs` harness runs can keep the container up: the cold
    start, each run to its time limit plus the harness's backstop and overhead, the checks, and
    one scaledown window in case the stop is late."""
    per_run = time_limit_seconds + backstop_seconds + 120
    return model.startup_timeout_seconds + 300 + runs * per_run + model.scaledown_seconds


@dataclass(frozen=True)
class Guard:
    """Refuses a start when what is already on the ledger plus the worst case of the new session
    would pass the cap."""

    cap_usd: float = CAP_USD
    path: Path = CUMULATIVE
    who: str | None = WHO

    def check(self, worst_case_usd: float, what: str) -> float:
        spent = total(self.path, self.who)
        if spent + worst_case_usd > self.cap_usd + 1e-9:
            raise CapExceeded(
                f"{what}: refused. Ledger estimate so far {spent:.2f} USD, worst case of this "
                f"start {worst_case_usd:.2f} USD, cap {self.cap_usd:.2f} USD "
                f"({self.path})."
            )
        return spent


# --- Sessions that were opened and not closed (the process was killed) -------------------------


def _load_open(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def open_session(app_name: str, record: dict[str, Any], path: Path = OPEN_SESSIONS) -> None:
    data = _load_open(path)
    data[app_name] = record
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2))


def close_session(app_name: str, path: Path = OPEN_SESSIONS) -> None:
    data = _load_open(path)
    if data.pop(app_name, None) is not None:
        path.write_text(json.dumps(data, indent=2))


def open_sessions(path: Path = OPEN_SESSIONS) -> dict[str, Any]:
    return _load_open(path)
