"""The kill switch for everything that costs money: NO_PAID_CALLS.

The same switch as the engine's (engine/src/paid.ts), for someone who runs this package directly
instead of through the engine. It is ON unless NO_PAID_CALLS is exactly "0". While it is on:

- a run with any model other than the scripted one is refused        (glhf_local.py)
- a cloud launch is refused: `bixbench3 run`, `bixbench3 setup-runtime` (cli.py)
- Exa documentation search is refused                                 (swarm/tools.py, glhf_local.py)
- past.dev recall and ingest are refused                              (swarm/past_memory.py, swarm/memory.py)
- the provider keys are blank in this process, so Inspect, the sandbox it starts and anything
  further down have no key to spend with                              (`enforce`)

Scripted runs (`--model mock`), grading, and `status`, `complete` and `cancel` of a cloud run that
already exists keep working.

The switch is read from the process environment, and when it is not set there, from the .env file
that the run would load anyway: the nearest .env above the working folder (this is what Inspect
loads) and then the repository's .env (this is what bixbench_v1 loads). Only this one line of
.env is read here, and no value is ever printed.

Not covered: code that does not go through one of the entry points above, for example
`inspect eval` on the task file, a script that calls the cloud runner class itself, or a key that
is not in PAID_KEYS.
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
# The keys that can spend, or that open a paid or gated service. The engine blanks the same ones.
PAID_KEYS = (
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "EXA_API_KEY",
    "PAST_API_KEY",
    "HF_TOKEN",
    "TINKER_API_KEY",
)
# Inside VS Code, Inspect loads .env over variables that are already set, which would put the
# keys back. These are what make it think it is in VS Code.
_VSCODE = ("VSCODE_IPYTHON_KERNEL", "VSCODE_CLI_REQUIRE_TOKEN", "VSCODE_PID", "VSCODE_CWD")
REPO_ENV = Path(__file__).resolve().parents[4] / ".env"
_LINE = re.compile(rf"^\s*(?:export\s+)?{SWITCH}\s*=\s*(.*)$")


class PaidCallsOff(RuntimeError):
    """A paid step was refused because the switch is on."""

    def __init__(self, what: str) -> None:
        super().__init__(f"{what}: refused. {HOW_TO_ALLOW}")


def dotenv_files() -> list[Path]:
    """The .env files a run would read, nearest first: the first one found going up from the
    working folder (Inspect's rule), then the repository's (bixbench_v1's rule)."""
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
    """The value of the switch in a .env file, or None when the file does not set it. Reads that
    line only: quotes are removed, and an unquoted value ends at " #"."""
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
    """What NO_PAID_CALLS is set to: the environment first, then the .env files. None if unset."""
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
    """True unless NO_PAID_CALLS is exactly "0". Unset, empty, "1", "false" or a typo all mean:
    no paid calls."""
    return switch_value(environ, files) != "0"


def refuse_paid(what: str) -> None:
    """Call right before anything that spends. Raises PaidCallsOff while the switch is on."""
    if paid_calls_off():
        raise PaidCallsOff(what)


def is_mock(model: str) -> bool:
    """The scripted model, which makes no call: `mock`, or Inspect's own `mockllm/...`."""
    return model == "mock" or model.startswith("mockllm/")


def refuse_models(*models: str) -> None:
    """Refuse any model that is not the scripted one while the switch is on."""
    real = [m for m in models if not is_mock(m)]
    if real:
        refuse_paid(f"a run with a real model ({', '.join(real)})")


def enforce(environ: MutableMapping[str, str] | None = None) -> bool:
    """Run at every entry point. While the switch is on: blank the provider keys in this process
    (blank, not removed, because .env loaders leave a variable that is set alone and would read a
    removed key back), pass NO_PAID_CALLS=1 on to child processes, and drop the VS Code markers.
    Returns whether paid calls are off."""
    env = os.environ if environ is None else environ
    if not paid_calls_off(env if environ is not None else None):
        return False
    env[SWITCH] = "1"
    for key in PAID_KEYS:
        env[key] = ""
    for key in _VSCODE:
        env.pop(key, None)
    if env.get("TERM_PROGRAM") == "vscode":
        del env["TERM_PROGRAM"]
    return True


def refuse_run(model: str, role_models: Iterable[str] = (), *, exa: bool = False) -> None:
    """The check of a local run before anything is started: keys blanked, and with the switch on
    only the scripted model, without Exa search, may run."""
    if not enforce():
        return
    refuse_models(model, *role_models)
    if exa:
        refuse_paid("Exa documentation search (--exa)")
