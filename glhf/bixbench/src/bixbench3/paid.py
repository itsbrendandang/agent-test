"""The kill switch for everything that costs money: NO_PAID_CALLS.

The same switch as the engine's (engine/src/paid.ts), for someone who runs this package directly
instead of through the engine. It is ON unless NO_PAID_CALLS is exactly "0". While it is on:

- a run with a paid model is refused; the scripted model and a local model may run (glhf_local.py).
  A local model is `ollama/<name>` served from this machine: see "Local models" below
- a cloud launch is refused: `bixbench3 run`, `bixbench3 setup-runtime` (cli.py)
- Exa documentation search is refused                                 (swarm/tools.py, glhf_local.py)
- past.dev recall and ingest are refused                              (swarm/past_memory.py, swarm/memory.py)
- the provider keys are blank in this process, so Inspect, the sandbox it starts and anything
  further down have no key to spend with                              (`enforce`)

Scripted runs (`--model mock`), local-model runs (`--model ollama/qwen2.5:14b`), grading, and `status`, `complete` and `cancel` of a cloud run that
already exists keep working.

The switch is read from the process environment, and when it is not set there, from the .env file
that the run would load anyway: the nearest .env above the working folder (this is what Inspect
loads) and then the repository's .env (this is what bixbench_v1 loads). Only this one line of
.env is read here (and, for a local model, the lines LOCAL_MODEL_URL, OLLAMA_BASE_URL and
LOCAL_MODEL_ALLOW_REMOTE), and no value from .env is ever printed.

Local models. One definition, the same as the engine's (engine/src/local.ts):

- the id is `ollama/<name>`, where <name> is an Ollama model name (`qwen2.5:14b`, `user/model:tag`)
  and not one of Ollama's cloud models (`...:cloud`, `...-cloud`), which the local server forwards
  to ollama.com;
- and the server it is sent to is on this machine: LOCAL_MODEL_URL, else OLLAMA_BASE_URL, else
  http://127.0.0.1:11434, must name a loopback address (localhost, 127.x.x.x, ::1).

An address on another machine is not free and private by assumption (it may be someone's paid or
logging endpoint, and Ollama on a network has no authentication), so it is refused unless
LOCAL_MODEL_ALLOW_REMOTE=1 says the person owns that host. The checked address is then written to
OLLAMA_BASE_URL (and INSPECT_EVAL_MODEL_BASE_URL is removed), so Inspect's ollama provider can
only reach the address that was checked. The provider keys stay blank during a local-model run.

Not covered: code that does not go through one of the entry points above, for example
`inspect eval` on the task file, a script that calls the cloud runner class itself, or a key that
is not in PAID_KEYS.
"""

from __future__ import annotations

import ipaddress
import os
import re
from collections.abc import Iterable, Mapping, MutableMapping
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

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

# Local models (see the module text). Keep in step with engine/src/local.ts.
LOCAL_PREFIX = "ollama/"
LOCAL_URL = "LOCAL_MODEL_URL"  # ours: the server, with or without /v1
OLLAMA_URL = "OLLAMA_BASE_URL"  # Inspect's ollama provider reads this one
ALLOW_REMOTE = "LOCAL_MODEL_ALLOW_REMOTE"
DEFAULT_LOCAL_URL = "http://127.0.0.1:11434"
_PART = r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}"
_LOCAL_NAME = re.compile(rf"^(?:{_PART}/)?{_PART}(?::{_PART})?$")
_CLOUD = re.compile(r"(?:^|[:-])cloud$", re.IGNORECASE)
ModelClass = Literal["scripted", "local", "paid"]


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


def _from_file(path: Path, name: str = SWITCH) -> str | None:
    """The value of `name` (the switch, unless given) in a .env file, or None when the file does
    not set it. Reads that line only: quotes are removed, and an unquoted value ends at " #"."""
    line_of = re.compile(rf"^\s*(?:export\s+)?{name}\s*=\s*(.*)$")
    value: str | None = None
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    for line in lines:
        match = line_of.match(line)
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


class LocalModelRefused(PaidCallsOff):
    """An `ollama/...` model was refused: its server is not on this machine, or it is a cloud
    model. Not something NO_PAID_CALLS=0 is the answer to, so the message says what is."""

    def __init__(self, why: str) -> None:
        RuntimeError.__init__(self, why)


def _setting(
    name: str, environ: Mapping[str, str] | None, files: Iterable[Path] | None
) -> str | None:
    """A setting from the environment, else from the .env files a run would load."""
    env = os.environ if environ is None else environ
    if env.get(name, "").strip():
        return env[name].strip()
    for path in dotenv_files() if files is None else files:
        value = _from_file(path, name)
        if value is not None:
            return value
    return None


def local_name(model: str) -> str | None:
    """The Ollama name in `ollama/<name>`, or None when the id is not of that form. Only the
    form is checked here: `ollama/qwen2.5:14b`, `ollama/user/model:tag`. Not `openai/ollama`,
    not `ollama/../openai/gpt`, nothing with spaces, and not a cloud model."""
    if not isinstance(model, str) or not model.startswith(LOCAL_PREFIX):
        return None
    name = model[len(LOCAL_PREFIX) :]
    if not _LOCAL_NAME.fullmatch(name) or ".." in name or _CLOUD.search(name):
        return None
    return name


def is_loopback(url: str) -> bool:
    """Does this http(s) URL name this machine: localhost, 127.x.x.x or ::1, written plainly."""
    try:
        parts = urlsplit(url)
        host = parts.hostname or ""
        _ = parts.port  # a bad port raises
    except ValueError:
        return False
    if parts.scheme not in ("http", "https") or parts.username or parts.password:
        return False
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def local_server(
    environ: Mapping[str, str] | None = None, files: Iterable[Path] | None = None
) -> tuple[str, bool]:
    """Where a local model is served: (address without a trailing /v1, whether it is on another
    machine). LOCAL_MODEL_URL, else OLLAMA_BASE_URL, else this machine's port 11434. Raises
    LocalModelRefused for an address on another machine without LOCAL_MODEL_ALLOW_REMOTE=1."""
    files = list(dotenv_files() if files is None else files)
    for name in (LOCAL_URL, OLLAMA_URL):
        raw = _setting(name, environ, files)
        if raw:
            break
    else:
        name, raw = "", DEFAULT_LOCAL_URL
    url = re.sub(r"(/v1)?/*$", "", raw)
    if is_loopback(url):
        return url, False
    try:
        parts = urlsplit(url)
        host = parts.hostname
    except ValueError:
        host = None
    if not host or parts.scheme not in ("http", "https") or parts.username or parts.password:
        raise LocalModelRefused(
            f"{name} is not a plain http address of a model server (no user name or password): "
            "refused."
        )
    if _setting(ALLOW_REMOTE, environ, files) == "1":
        return url, True
    raise LocalModelRefused(
        f"a local model served from {host} ({name}): refused. That address is not this "
        "machine, so the model is not known to be free or private. Reach the other machine "
        "through an SSH tunnel to its 127.0.0.1:11434 (docs/local-model.md), or set "
        f"{ALLOW_REMOTE}=1 if the host is yours and the network between is private."
    )


def is_local(
    model: str, environ: Mapping[str, str] | None = None, files: Iterable[Path] | None = None
) -> bool:
    """A local model: `ollama/<name>` and a server that passes `local_server`."""
    if local_name(model) is None:
        return False
    try:
        local_server(environ, files)
    except LocalModelRefused:
        return False
    return True


def model_class(
    model: str, environ: Mapping[str, str] | None = None, files: Iterable[Path] | None = None
) -> ModelClass:
    """ "scripted" (no model is called), "local" (a real model on this machine, free, nothing
    leaves it) or "paid" (everything else, also an ollama id whose server was refused)."""
    if is_mock(model):
        return "scripted"
    return "local" if is_local(model, environ, files) else "paid"


def model_label(
    model: str, environ: Mapping[str, str] | None = None, files: Iterable[Path] | None = None
) -> str:
    """How a run with this model is named to a reader: "scripted model", "local model
    (qwen2.5:14b)", "paid model (openai/gpt-5.5)". A local model on another machine names it."""
    kind = model_class(model, environ, files)
    if kind == "scripted":
        return "scripted model"
    if kind == "paid":
        return f"paid model ({model})"
    url, remote = local_server(environ, files)
    where = f" at {urlsplit(url).hostname}" if remote else ""
    return f"local model ({local_name(model)}{where})"


def use_local(environ: MutableMapping[str, str] | None = None) -> str:
    """Before a run with a local model: check the server's address and make it the only one
    Inspect's ollama provider can use. Returns the address. Raises LocalModelRefused."""
    env = os.environ if environ is None else environ
    url, _remote = local_server(env if environ is not None else None)
    env[OLLAMA_URL] = f"{url}/v1"
    env.pop("INSPECT_EVAL_MODEL_BASE_URL", None)
    return url


def refuse_models(*models: str) -> None:
    """While the switch is on, refuse any model that is neither the scripted one nor a local
    one. An `ollama/...` id that fails the local test is refused with the reason."""
    if not paid_calls_off():
        return
    for model in models:
        if not is_mock(model) and model.startswith(LOCAL_PREFIX):
            if local_name(model) is None:
                raise LocalModelRefused(
                    f"{model}: refused. It is not a local model id (ollama/<name>, and not one "
                    f"of Ollama's cloud models), and other models are paid. {HOW_TO_ALLOW}"
                )
            local_server()  # raises with the reason when the server is on another machine
    real = [m for m in models if not is_mock(m) and not is_local(m)]
    if real:
        refuse_paid(f"a run with a paid model ({', '.join(real)})")


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
    only the scripted model and local models (ollama/<name> on this machine), without Exa search,
    may run. With a local model among them, its checked address is pinned (`use_local`)."""
    models = [model, *role_models]
    off = enforce()
    if off:
        refuse_models(*models)
    if any(is_local(m) for m in models):
        use_local()
    if not off:
        return
    if exa:
        refuse_paid("Exa documentation search (--exa)")
