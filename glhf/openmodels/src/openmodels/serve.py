"""Start, find and stop a model's Modal app, through the `modal` command line.

Everything that can cost money or reach Modal's servers passes `paid.refuse_modal` first, so with
NO_PAID_CALLS on (the default) nothing here deploys or sends a request. Stopping is never
refused: it only ends spending. The command runner and the HTTP function are parameters, so the
tests replace both and never reach the network.

The endpoint key is a Modal proxy token. Modal's own proxy checks it on every path before a
request reaches the container, so a request without the key gets 401 and does not wake the GPU.
The key is kept in .secrets/endpoint.json (mode 600, not in git) and is never printed."""

from __future__ import annotations

import json
import os
import re
import stat
import subprocess
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
from bixbench_v1 import paid

from .registry import ROOT, Model

KEY_FILE = ROOT / ".secrets" / "endpoint.json"
APP_PREFIX = "openmodels-"
SERVER_CLASS = "Server"


@dataclass(frozen=True)
class Done:
    """What a command returned."""

    code: int
    out: str
    err: str = ""


Shell = Callable[[Sequence[str]], Done]
# (method, url, headers, json body or None, timeout seconds) -> (status, parsed body or text)
Http = Callable[[str, str, dict[str, str], Any, float], tuple[int, Any]]


class ServeError(RuntimeError):
    """Modal did not do what was asked. The message never holds the key."""


def shell(command: Sequence[str]) -> Done:
    result = subprocess.run(list(command), capture_output=True, text=True, check=False)
    return Done(result.returncode, result.stdout, result.stderr)


def http(
    method: str, url: str, headers: dict[str, str], body: Any, timeout: float
) -> tuple[int, Any]:
    paid.refuse_modal("a request to a served model")  # NO_PAID_CALLS
    response = httpx.request(method, url, headers=headers, json=body, timeout=timeout)
    try:
        return response.status_code, response.json()
    except ValueError:
        return response.status_code, response.text[:500]


# --- the key -----------------------------------------------------------------------------------


def load_key(path: Path = KEY_FILE) -> str:
    """The bearer key of our endpoints. Refuses a key file that others can read."""
    if not path.is_file():
        raise ServeError(f"no endpoint key at {path}; run `openmodels key` once")
    if stat.S_IMODE(path.stat().st_mode) & 0o077:
        raise ServeError(f"{path} is readable by others; run `chmod 600` on it")
    return str(json.loads(path.read_text(encoding="utf-8"))["key"])


def create_key(run: Shell = shell, path: Path = KEY_FILE, name: str = "openmodels-bench") -> str:
    """Make a Modal proxy token and keep it in the key file (mode 600). Returns the token ID, which
    is not secret. The secret goes from the command's output into the file and nowhere else."""
    paid.refuse_modal("create a proxy token")  # NO_PAID_CALLS
    if path.exists():
        raise ServeError(f"{path} already exists; delete the old token in Modal first")
    done = run(["modal", "workspace", "proxy-tokens", "create", "--name", name, "--json"])
    token_id = re.search(r"wk-[A-Za-z0-9_-]+", done.out)
    secret = re.search(r"ws-[A-Za-z0-9_-]+", done.out)
    if done.code != 0 or not token_id or not secret:
        raise ServeError(
            "modal did not return a proxy token (output not shown: it may hold a secret)"
        )
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(
            {
                "key": f"{token_id.group(0)}.{secret.group(0)}",
                "token_id": token_id.group(0),
                "name": name,
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            },
            handle,
        )
    return token_id.group(0)


# --- apps --------------------------------------------------------------------------------------


def _json(text: str) -> Any:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def deploy(model: Model, run: Shell = shell) -> str:
    """Deploy the model's app and return the base URL of its server (no /v1)."""
    paid.refuse_modal(f"deploy {model.app_name}")  # NO_PAID_CALLS
    done = run(["modal", "deploy", str(ROOT / str(model.app_file))])
    if done.code != 0:
        raise ServeError(
            f"modal deploy failed for {model.app_name}: {(done.err or done.out)[-800:]}"
        )
    return server_url(model, run)


def server_url(model: Model, run: Shell = shell) -> str:
    done = run(["modal", "server", "info", f"{model.app_name}/{SERVER_CLASS}", "--json"])
    found = re.search(r"https://[A-Za-z0-9.-]+\.modal\.(?:direct|run)", done.out)
    if done.code != 0 or not found:
        raise ServeError(f"no server URL for {model.app_name}: {(done.err or done.out)[-400:]}")
    return found.group(0)


def apps(run: Shell = shell) -> list[dict[str, Any]]:
    """Every app Modal lists, as dictionaries with lower-case keys."""
    done = run(["modal", "app", "list", "--json"])
    if done.code != 0:
        raise ServeError(f"modal app list failed: {(done.err or done.out)[-400:]}")
    listed = _json(done.out)
    if not isinstance(listed, list):
        raise ServeError("modal app list did not return a list")
    return [
        {str(k).lower(): v for k, v in item.items()} for item in listed if isinstance(item, dict)
    ]


def _name(app: dict[str, Any]) -> str:
    return str(app.get("description") or app.get("name") or "")


def live(run: Shell = shell, prefix: str = APP_PREFIX) -> list[str]:
    """Names of our apps that Modal does not list as stopped (deployed, running, starting)."""
    return sorted(
        {
            _name(app)
            for app in apps(run)
            if _name(app).startswith(prefix) and "stopped" not in str(app.get("state", "")).lower()
        }
    )


def stop(
    app_name: str,
    run: Shell = shell,
    *,
    tries: int = 8,
    sleep: Callable[[float], None] = time.sleep,
) -> bool:
    """Stop an app and check that Modal no longer lists it as live. True when it is gone.
    Modal can list an app as "stopping" for a few seconds, so the list is read up to `tries`
    times, 5 seconds apart. Never refused by the paid switch: stopping ends spending."""
    run(["modal", "app", "stop", "-y", app_name])
    for attempt in range(tries):
        if app_name not in live(run):
            return True
        if attempt < tries - 1:
            sleep(5.0)
    return False


def wake(
    url: str,
    key: str,
    *,
    timeout_seconds: float,
    request: Http = http,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> float:
    """Ask the server for its model list until it answers 200. The first request starts the
    container; while it starts, Modal answers 503. Returns the seconds it took."""
    started = clock()
    last: Any = None
    while clock() - started < timeout_seconds:
        try:
            status, last = request(
                "GET", f"{url}/v1/models", {"Authorization": f"Bearer {key}"}, None, 30.0
            )
        except httpx.HTTPError as error:
            status, last = 0, type(error).__name__
        if status == 200:
            return clock() - started
        if status in (401, 403):
            raise ServeError(f"the endpoint refused our key ({status})")
        sleep(5.0)
    raise ServeError(
        f"the server did not answer within {timeout_seconds:.0f} s (last: {str(last)[:200]})"
    )
