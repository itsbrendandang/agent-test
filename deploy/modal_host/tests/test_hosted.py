"""End to end on this machine, with a folder in place of the Volume: the real engine (scripted models only), the
real front door, a practice review, a hard stop in the middle, and a new "container" that continues it.

Needs Node 24+ and engine/node_modules (npm ci in engine/). Skipped when they are missing. No paid call can
happen: engine_env gives the engine NO_PAID_CALLS=1, PAID_SWITCH_LOCKED=1 and no key, and the app root built here
has no .env. Ports 18000-18999 are used; the engine on 8787 is never touched.
"""
from __future__ import annotations

import hashlib
import http.cookiejar
import json
import os
import shutil
import signal
import socket
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(HERE.parent))
import hosted  # noqa: E402
from hosted import HostedApp, Refused, engine_env, front_env  # noqa: E402

CODE = "local-test-code-0123456789abcdef"
ACCESS = {"ASB_ACCESS_HASHES": json.dumps({"tester": hashlib.sha256(CODE.encode()).hexdigest()}), "ASB_COOKIE_KEY": "5a" * 32, "ASB_INSECURE_COOKIE": "1"}
BRIEF = "kras-g12c-hit-to-lead.md"

needs_engine = pytest.mark.skipif(shutil.which("node") is None or not (REPO / "engine/node_modules/@earendil-works").is_dir(), reason="needs node and engine/node_modules")


# ---- the environment rules (no process is started) ----------------------------------------------------------

def test_demo_engine_environment_has_the_two_switches_and_no_key() -> None:
    env = engine_env("demo", {"PATH": "/bin", "HOME": "/root", "MODAL_TOKEN_ID": "x", "ASB_COOKIE_KEY": "k", "DRUG_BOARD_MOCK_TPS": "30", "NO_PAID_CALLS": "0", "PAID_SWITCH_LOCKED": "0", "DASHBOARD_ORIGINS": "https://evil.example", "ENGINE_HOSTS": "evil.example"}, port=8787)
    assert env["NO_PAID_CALLS"] == "1" and env["PAID_SWITCH_LOCKED"] == "1" and env["HOST"] == "127.0.0.1"  # the container's own values do not win
    assert not set(env) & set(hosted.PROVIDER_KEYS)
    assert set(env) == {"PATH", "HOME", "LANG", "NODE_ENV", "HOST", "DRUG_BOARD_PORT", "NO_PAID_CALLS", "PAID_SWITCH_LOCKED", "DRUG_BOARD_MOCK_TPS"}  # nothing else gets through: no Modal token, no access setting, no wider origin


@pytest.mark.parametrize("key", hosted.PROVIDER_KEYS)
def test_a_demo_deployment_that_holds_a_provider_key_refuses_to_start(key: str) -> None:
    with pytest.raises(Refused, match="demo deployment"):
        engine_env("demo", {key: "sk-fake"}, port=8787)
    assert key not in engine_env("demo", {key: "  "}, port=8787)  # blank is not a key


def test_real_engine_environment_starts_in_demo_with_the_keys_and_an_unlocked_switch() -> None:
    env = engine_env("real", {"ANTHROPIC_API_KEY": "fake-a", "OPENAI_API_KEY": "fake-o", "EXA_API_KEY": "fake-e", "OPENROUTER_API_KEY": "fake-r", "NO_PAID_CALLS": "0"}, port=8787)
    assert env["NO_PAID_CALLS"] == "1" and "PAID_SWITCH_LOCKED" not in env  # boots in Demo; a person turns Real on in the app
    assert (env["ANTHROPIC_API_KEY"], env["OPENAI_API_KEY"], env["EXA_API_KEY"]) == ("fake-a", "fake-o", "fake-e") and "OPENROUTER_API_KEY" not in env
    with pytest.raises(Refused):
        engine_env("Real", {}, port=8787)


def test_the_front_door_never_gets_a_provider_key() -> None:
    env = front_env({**ACCESS, "ANTHROPIC_API_KEY": "fake", "EXA_API_KEY": "fake", "PATH": "/bin"}, port=8000, engine_port=8787, dashboard_dir=Path("/srv/dashboard"))
    assert not set(env) & set(hosted.PROVIDER_KEYS) and env["ASB_COOKIE_KEY"] == ACCESS["ASB_COOKIE_KEY"]


# ---- the real thing, locally --------------------------------------------------------------------------------

def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def app_root(base: Path) -> Path:
    """What the image holds: the engine and the board's read-only files as links, and empty folders for runs."""
    root = base / "app"
    (root / "board").mkdir(parents=True)
    (root / "glhf").mkdir()
    os.symlink(REPO / "engine", root / "engine")
    for name in ("config.yaml", "agents", "context", "briefs"):
        os.symlink(REPO / "board" / name, root / "board" / name)
    shutil.copytree(REPO / "board" / "expertise", root / "board" / "expertise")
    os.symlink(REPO / "glhf" / "specialists", root / "glhf" / "specialists")
    dash = base / "dashboard"
    dash.mkdir()
    (dash / "index.html").write_text("<!doctype html><title>app shell</title>")
    return root


class Browser:
    def __init__(self, port: int) -> None:
        self.base = f"http://127.0.0.1:{port}"
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(self, path: str, body: dict | None = None, form: dict | None = None) -> tuple[int, str]:
        data = json.dumps(body).encode() if body is not None else urllib.parse.urlencode(form).encode() if form is not None else None
        headers = {"content-type": "application/json"} if body is not None else {"content-type": "application/x-www-form-urlencoded"} if form is not None else {}
        try:
            with self.opener.open(urllib.request.Request(self.base + path, data=data, headers=headers), timeout=10) as answer:
                return answer.status, answer.read().decode()
        except urllib.error.HTTPError as error:
            return error.code, error.read().decode()

    def sign_in(self) -> None:
        deadline = time.time() + 15
        while True:  # the front door needs a moment to listen
            try:
                status, _ = self.call("/login", form={"code": CODE})
                break
            except OSError:
                assert time.time() < deadline
                time.sleep(0.1)
        assert status == 200  # followed the redirect to the app shell

    def runs(self) -> dict[str, dict]:
        status, text = self.call("/api/runs")
        assert status == 200, text
        return {run["id"]: run for run in json.loads(text)}


def start(base: Path, volume: Path, tps: str) -> tuple[HostedApp, Browser, list[str]]:
    lines: list[str] = []
    root = app_root(base)
    host = HostedApp(app_root=root, volume_root=volume, dashboard_dir=base / "dashboard", front_script=HERE.parent / "front.mjs", mode="demo",
                     port=free_port(), engine_port=free_port(), environ={**ACCESS, "PATH": os.environ["PATH"], "HOME": str(base), "DRUG_BOARD_MOCK_TPS": tps},
                     snapshot_seconds=0.5, node_args=("--preserve-symlinks", "--preserve-symlinks-main"), log=lines.append)
    host.start()
    browser = Browser(host.port)
    browser.sign_in()
    return host, browser, lines


def hard_kill(host: HostedApp) -> None:
    """The container is gone without warning: no SIGTERM, no last snapshot."""
    host._stopping.set()
    host._loop.join(10)
    for process in (host.engine, host.front):
        os.kill(process.pid, signal.SIGKILL)
        process.wait(5)


def digest(folder: Path) -> dict[str, str]:
    """Every file by its bytes; a database by its rows (a backup packs the same rows into different pages)."""
    out: dict[str, str] = {}
    for f in sorted(folder.rglob("*")):
        if not f.is_file() or f.name.endswith(("-wal", "-shm")) or f.name == "run.lock":
            continue
        if f.suffix == ".sqlite":
            db = sqlite3.connect(f"file:{f}?mode=ro", uri=True)
            try:
                assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
                data = "\n".join(db.iterdump()).encode()
            finally:
                db.close()
        else:
            data = f.read_bytes()
        out[str(f.relative_to(folder))] = hashlib.sha256(data).hexdigest()
    return out


def events_of(root: Path, run: str) -> list[dict]:
    return [json.loads(line) for line in (root / "board/runs" / run / "events.jsonl").read_text().splitlines()]


@needs_engine
def test_practice_review_survives_a_hard_stop_and_finished_runs_stay_intact(tmp_path: Path) -> None:
    volume = tmp_path / "volume" / "v1"

    # Container 1: one review runs to the end, a second one is cut off in the middle.
    host1, browser, _ = start(tmp_path / "c1", volume, tps="4000")
    status, text = browser.call("/api/status")
    state = json.loads(text)
    assert status == 200 and state["mock"] is True and state["paidCalls"] is False and state["paidLocked"] is True and not any(state["keys"].values())
    assert browser.runs() == {}  # this engine's own data folder, not the repository's
    status, text = browser.call("/api/runs", body={"brief": BRIEF})
    assert status == 201 and json.loads(text)["mode"] == "scripted", text
    first = json.loads(text)["runId"]
    deadline = time.time() + 60
    while browser.runs()[first]["status"] != "done":
        assert time.time() < deadline
        time.sleep(0.2)
    status, memo = browser.call(f"/api/runs/{first}/memo")
    assert status == 200 and "## Decision" in memo
    time.sleep(1.5)  # two snapshot rounds
    finished = digest(host1.app_root / "board/runs" / first)

    hard_kill(host1)

    # Container 2: slow replies, so that the stop lands in the middle of a review.
    host2, browser, _ = start(tmp_path / "c2", volume, tps="25")
    assert digest(host2.app_root / "board/runs" / first) == finished  # the finished review came back byte for byte
    assert browser.runs()[first]["status"] == "done"
    status, text = browser.call("/api/runs", body={"brief": BRIEF})
    second = json.loads(text)["runId"]
    deadline = time.time() + 60
    while len(events_of(host2.app_root, second)) < 8:
        assert time.time() < deadline
        time.sleep(0.2)
    time.sleep(1.2)  # at least one snapshot holds part of the run
    assert browser.runs()[second]["status"] == "running"
    before = events_of(host2.app_root, second)
    assert not any(e["type"] == "run.finished" for e in before)
    hard_kill(host2)

    # Container 3: the review is found unfinished and the engine continues it by itself.
    host3, browser, lines = start(tmp_path / "c3", volume, tps="4000")
    restored = events_of(host3.app_root, second)
    assert 0 < len(restored) <= len(before) + 2  # what the last snapshot held: at most a few seconds behind
    deadline = time.time() + 90
    while browser.runs()[second]["status"] != "done":
        assert browser.runs()[second]["status"] in ("running", "paused"), browser.runs()[second]
        assert time.time() < deadline
        time.sleep(0.3)
    after = events_of(host3.app_root, second)
    assert sum(e["type"] == "run.started" for e in after) == 1 and sum(e["type"] == "run.finished" for e in after) == 1
    status, memo = browser.call(f"/api/runs/{second}/memo")
    assert status == 200 and "## Decision" in memo
    assert digest(host3.app_root / "board/runs" / first) == finished
    host3.stop()  # the ordinary stop: SIGTERM, then the last snapshot
    assert host3.engine.poll() is not None and host3.front.poll() is not None
    assert any("last snapshot" in line for line in lines)

    # Container 4: everything is there after an ordinary stop too, and nothing was restored from a broken snapshot.
    host4, browser, lines = start(tmp_path / "c4", volume, tps="4000")
    runs = browser.runs()
    assert runs[first]["status"] == "done" and runs[second]["status"] == "done"
    assert digest(host4.app_root / "board/runs" / first) == finished
    assert digest(host4.app_root / "board/runs" / second) == digest(host3.app_root / "board/runs" / second)
    assert not any("rejected" in line or "lost" in line for line in lines)
    assert not list(volume.rglob(".token")) and not list(volume.rglob("*-wal"))
    host4.stop()


@needs_engine
def test_the_container_refuses_to_start_with_a_dot_env_or_a_key(tmp_path: Path) -> None:
    root = app_root(tmp_path / "c")
    common = dict(app_root=root, volume_root=tmp_path / "v", dashboard_dir=tmp_path / "c/dashboard", front_script=HERE.parent / "front.mjs", port=free_port(), engine_port=free_port(), log=lambda _l: None)
    with pytest.raises(Refused, match="demo deployment"):
        HostedApp(**common, environ={**ACCESS, "PATH": os.environ["PATH"], "OPENAI_API_KEY": "sk-fake"}).start()
    (root / ".env").write_text("NO_PAID_CALLS=0\n")
    with pytest.raises(Refused, match=".env"):
        HostedApp(**common, environ={**ACCESS, "PATH": os.environ["PATH"]}).start()
