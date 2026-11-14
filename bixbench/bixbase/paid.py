"""The kill switch for everything that costs money: NO_PAID_CALLS.

Same rule and wording as glhf/bixbench/src/bixbench3/paid.py and the engine's
engine/src/paid.ts (copied, not imported: this folder has its own virtualenv).
The switch is ON unless NO_PAID_CALLS is exactly "0". While it is on:

- LLMClient refuses to be built, so run.py, regrade.py and any script that
  uses the client directly cannot call a model                (llm.py)
- the provider keys are blank in this process, before any .env is loaded, so
  nothing further down has a key to spend with                (`enforce`)

selftest.py and the pytest suite use a scripted model and keep working.

The switch is read from the process environment, and when it is not set
there, from the nearest .env above the working folder and then the
repository's .env. Only this one line of .env is read here, and no value is
ever printed.
"""

from __future__ import annotations

import os
import re
from collections.abc import Iterable, Mapping, MutableMapping
from pathlib import Path

SWITCH = "NO_PAID_CALLS"
HOW_TO_ALLOW = (
    "Paid calls are off (NO_PAID_CALLS). Only the person who pays may turn them on: "
    "set NO_PAID_CALLS=0 in .env."
)
# The keys that can spend, or that open a paid or gated service.
PAID_KEYS = (
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "EXA_API_KEY",
    "PAST_API_KEY",
    "HF_TOKEN",
    "TINKER_API_KEY",
)
REPO_ENV = Path(__file__).resolve().parents[2] / ".env"
_LINE = re.compile(rf"^\s*(?:export\s+)?{SWITCH}\s*=\s*(.*)$")


class PaidCallsOff(RuntimeError):
    """A paid step was refused because the switch is on."""

    def __init__(self, what: str) -> None:
        super().__init__(f"{what}: refused. {HOW_TO_ALLOW}")


def dotenv_files() -> list[Path]:
    """The .env files a run would read, nearest first: the first one found
    going up from the working folder, then the repository's."""
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
    """The value of the switch in a .env file, or None when the file does not
    set it. Uses that line only: quotes are removed, and an unquoted value
    ends at " #"."""
    value: str | None = None
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    for line in lines:
        match = _LINE.match(line)
        if not match:
            continue
        raw = match.group(1).strip()
        quoted = re.match(r"""^(["'])(.*)\1""", raw)
        text = quoted.group(2) if quoted else re.sub(r"(^|\s)#.*$", "", raw).strip()
        if text:
            value = text  # the last line wins, as in dotenv
    return value


def switch_value(
    environ: Mapping[str, str] | None = None, files: Iterable[Path] | None = None
) -> str | None:
    """What NO_PAID_CALLS is set to: the environment first, then the .env
    files. None if unset."""
    env = os.environ if environ is None else environ
    if env.get(SWITCH, "").strip():
        return env[SWITCH].strip()
    for path in dotenv_files() if files is None else files:
        value = _from_file(path)
        if value is not None:
            return value
    return None


def paid_calls_off(
    environ: Mapping[str, str] | None = None, files: Iterable[Path] | None = None
) -> bool:
    """True unless NO_PAID_CALLS is exactly "0". Unset, empty, "1", "false"
    or a typo all mean: no paid calls."""
    return switch_value(environ, files) != "0"


def refuse_paid(what: str) -> None:
    """Call right before anything that spends. Raises PaidCallsOff while the
    switch is on."""
    if paid_calls_off():
        raise PaidCallsOff(what)


def enforce(environ: MutableMapping[str, str] | None = None) -> bool:
    """Run at every entry point, before load_dotenv. While the switch is on:
    blank the provider keys in this process (blank, not removed, because
    load_dotenv leaves a variable that is set alone and would read a removed
    key back) and pass NO_PAID_CALLS=1 on to child processes. Returns whether
    paid calls are off."""
    env = os.environ if environ is None else environ
    if not paid_calls_off(env if environ is not None else None):
        return False
    env[SWITCH] = "1"
    for key in PAID_KEYS:
        env[key] = ""
    return True
