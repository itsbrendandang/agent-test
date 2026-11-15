"""The NO_PAID_CALLS switch for this package. Same rule as the rest of the repository
(glhf/bixbench/src/bixbench3/paid.py, engine/src/paid.ts): paid calls are OFF unless
NO_PAID_CALLS is exactly "0", read from the process environment first, then from the nearest
.env above the working folder, then from the repository's .env. Only that one line is read,
and no value from .env is ever printed.

run.py and regrade.py call refuse_paid() before any model call. selftest.py and
board_selftest.py use a scripted model and need no switch.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

SWITCH = "NO_PAID_CALLS"
HOW_TO_ALLOW = (
    "Paid calls are off (NO_PAID_CALLS). Only the person who pays may turn them on: "
    "set NO_PAID_CALLS=0 in .env."
)
REPO_ENV = Path(__file__).resolve().parents[3] / ".env"


class PaidCallsOff(RuntimeError):
    def __init__(self, what: str) -> None:
        super().__init__(f"{what}: refused. {HOW_TO_ALLOW}")


def _dotenv_files() -> list[Path]:
    found: list[Path] = []
    here = Path.cwd().resolve()
    for folder in (here, *here.parents):
        if (folder / ".env").is_file():
            found.append(folder / ".env")
            break
    if REPO_ENV.is_file() and REPO_ENV not in found:
        found.append(REPO_ENV)
    return found


def _from_file(path: Path) -> str | None:
    line_of = re.compile(rf"^\s*(?:export\s+)?{SWITCH}\s*=\s*(.*)$")
    value = None
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    for line in lines:
        m = line_of.match(line)
        if not m:
            continue
        raw = m.group(1).strip()
        quoted = re.match(r"""^(["'])(.*)\1""", raw)
        text = quoted.group(2) if quoted else re.sub(r"(^|\s)#.*$", "", raw).strip()
        if text:
            value = text
    return value


def switch_value() -> str | None:
    if os.environ.get(SWITCH, "").strip():
        return os.environ[SWITCH].strip()
    for path in _dotenv_files():
        value = _from_file(path)
        if value is not None:
            return value
    return None


def paid_calls_off() -> bool:
    return switch_value() != "0"


def refuse_paid(what: str) -> None:
    """Call right before a paid step."""
    if paid_calls_off():
        raise PaidCallsOff(what)
