"""Runs the engine and the front door inside one container, and keeps the run folders on the Volume.

Standard library only, and nothing here imports Modal: app.py passes the Volume's `commit` in. That is what lets
tests/test_hosted.py run the same code on a laptop, with a folder in place of the Volume.

Start:  restore the newest good snapshot of every run from the Volume -> start the engine on 127.0.0.1 ->
        wait until it answers -> start the front door on the public port -> start the snapshot loop.
Stop:   stop the front door -> ask the engine to stop (SIGTERM; it releases its run locks) -> last snapshot.

The engine's environment is built from nothing (engine_env): it gets only the variables listed there. In demo
mode that list has no provider key, and the container refuses to start if a provider key is present at all.
"""
from __future__ import annotations

import contextlib
import os
import signal
import subprocess
import threading
import time
import urllib.request
from collections.abc import Callable, Iterator, Mapping
from pathlib import Path

from persist import Persister

# The same list as PAID_KEYS in engine/src/paid.ts: the keys that can spend, or that open a paid or gated service.
PROVIDER_KEYS = ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "EXA_API_KEY", "PAST_API_KEY", "HF_TOKEN", "TINKER_API_KEY", "OPENROUTER_API_KEY", "TYPESAFE_API_KEY")
# What a real-mode deployment hands to the engine, from the Modal Secret `asb-keys`.
REAL_KEYS = ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "EXA_API_KEY", "HF_TOKEN", "PAST_API_KEY")
MODES = ("demo", "real")
# Settings of the engine a deployment may pass on (none of them is a key, none loosens a check).
ENGINE_PASS = ("DRUG_BOARD_MOCK_TPS", "ASK_DAILY_CAP", "ASK_MODEL", "TZ")
FRONT_PASS = ("ASB_ACCESS_HASHES", "ASB_COOKIE_KEY", "ASB_SESSION_DAYS", "ASB_PUBLIC_ORIGIN", "ASB_INSECURE_COOKIE")


class Refused(RuntimeError):
    """The container must not start like this."""


def engine_env(mode: str, environ: Mapping[str, str], *, port: int) -> dict[str, str]:
    """The whole environment of the engine process. Nothing else is inherited.

    demo: NO_PAID_CALLS=1 and PAID_SWITCH_LOCKED=1, and no provider key. If the container holds one anyway (a key
          Secret attached to a demo deployment by mistake), this raises instead of starting.
    real: the keys of REAL_KEYS, NO_PAID_CALLS=1 (the engine starts in Demo) and the switch not locked, so a
          person with the session token can turn Real on in the app.
    """
    if mode not in MODES:
        raise Refused(f"unknown mode {mode!r}: use demo or real")
    env = {
        "PATH": environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "HOME": environ.get("HOME", "/root"),
        "LANG": "C.UTF-8",
        "NODE_ENV": "production",
        "HOST": "127.0.0.1",  # the engine is reachable only from inside the container; the front door is the way in
        "DRUG_BOARD_PORT": str(port),
        "NO_PAID_CALLS": "1",
    }
    for name in ENGINE_PASS:
        if environ.get(name):
            env[name] = environ[name]
    present = [name for name in PROVIDER_KEYS if (environ.get(name) or "").strip()]
    if mode == "demo":
        if present:
            raise Refused(f"this is a demo deployment, but the container holds {', '.join(present)}. A demo deployment must have no provider key: detach the Secret, or deploy with ASB_HOST_MODE=real on purpose.")
        env["PAID_SWITCH_LOCKED"] = "1"
    else:
        for name in REAL_KEYS:
            if (environ.get(name) or "").strip():
                env[name] = environ[name]
    return env


def front_env(environ: Mapping[str, str], *, port: int, engine_port: int, dashboard_dir: Path) -> dict[str, str]:
    """The front door's environment: the access settings, and never a provider key."""
    env = {"PATH": environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"), "HOME": environ.get("HOME", "/root"), "NODE_ENV": "production",
           "PORT": str(port), "ENGINE_PORT": str(engine_port), "DASHBOARD_DIR": str(dashboard_dir)}
    for name in FRONT_PASS:
        if environ.get(name):
            env[name] = environ[name]
    return env


class HostedApp:
    def __init__(self, *, app_root: Path, volume_root: Path, dashboard_dir: Path, front_script: Path, mode: str = "demo",
                 port: int = 8000, engine_port: int = 8787, environ: Mapping[str, str] | None = None,
                 commit: Callable[[], None] = lambda: None, snapshot_seconds: float = 5.0, node_args: tuple[str, ...] = (),
                 log: Callable[[str], None] = lambda line: print(line, flush=True)) -> None:
        self.app_root, self.dashboard_dir, self.front_script = Path(app_root), Path(dashboard_dir), Path(front_script)
        self.mode, self.port, self.engine_port = mode, port, engine_port
        self.environ = dict(os.environ if environ is None else environ)
        self.snapshot_seconds, self.node_args, self.log = snapshot_seconds, node_args, log
        self.engine: subprocess.Popen[bytes] | None = None
        self.front: subprocess.Popen[bytes] | None = None
        self.restarts = 0
        self._stopping = threading.Event()
        self._loop: threading.Thread | None = None
        collections = {
            "board-runs": self.app_root / "board" / "runs",  # one folder per board review, the Exa ledger, the paid-switch audit, plans
            "board-research": self.app_root / "board" / "runs" / ".research",  # one folder per research answer (engine/src/research)
            "board-expertise": self.app_root / "board" / "expertise",  # the members' notes from earlier reviews
            "glhf-runs": self.app_root / "glhf" / "runs",  # the run tracker's database
        }
        self.persister = Persister(collections, Path(volume_root), commit=commit, freeze=self._freeze, staging=self.app_root.parent / f".asb-staging-{os.getpid()}", log=log)

    # ---- processes -------------------------------------------------------------------------------------------

    @contextlib.contextmanager
    def _freeze(self) -> Iterator[None]:
        """Pause the engine while a snapshot reads its files. It always resumes."""
        engine = self.engine
        if engine is None or engine.poll() is not None:
            yield
            return
        os.kill(engine.pid, signal.SIGSTOP)
        try:
            yield
        finally:
            with contextlib.suppress(ProcessLookupError):
                os.kill(engine.pid, signal.SIGCONT)

    def _start_engine(self) -> None:
        if (self.app_root / ".env").exists():
            raise Refused("a .env file is inside the deployed app. It must never be: the engine would read keys from it.")
        env = engine_env(self.mode, self.environ, port=self.engine_port)
        self.engine = subprocess.Popen(["node", *self.node_args, "engine/src/server.ts"], cwd=self.app_root, env=env, start_new_session=True)
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if self.engine.poll() is not None:
                raise Refused(f"the engine stopped while starting (exit status {self.engine.returncode})")
            try:
                request = urllib.request.Request(f"http://127.0.0.1:{self.engine_port}/api/status")
                with urllib.request.urlopen(request, timeout=2) as answer:  # noqa: S310 - this machine only
                    if answer.status == 200:
                        return
            except OSError:
                time.sleep(0.1)
        raise Refused("the engine did not answer within 90 seconds")

    def _start_front(self) -> None:
        env = front_env(self.environ, port=self.port, engine_port=self.engine_port, dashboard_dir=self.dashboard_dir)
        self.front = subprocess.Popen(["node", "--max-old-space-size=128", str(self.front_script)], env=env, start_new_session=True)

    @staticmethod
    def _end(process: subprocess.Popen[bytes] | None, grace: float) -> None:
        if process is None or process.poll() is not None:
            return
        with contextlib.suppress(ProcessLookupError):
            os.kill(process.pid, signal.SIGCONT)  # in case it was paused for a snapshot
            process.terminate()
        try:
            process.wait(grace)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(5)

    # ---- life ------------------------------------------------------------------------------------------------

    def start(self) -> dict[str, list[str]]:
        started = time.monotonic()
        for folder in self.persister.collections.values():
            folder.mkdir(parents=True, exist_ok=True)
        restored = self.persister.restore()
        t_restore = time.monotonic() - started
        self._start_engine()
        t_engine = time.monotonic() - started
        self._start_front()
        self._loop = threading.Thread(target=self._run_loop, name="asb-snapshots", daemon=True)
        self._loop.start()
        build = self.app_root / "BUILD.json"
        self.log(f"hosted: mode {self.mode}; restore {t_restore:.1f} s, engine ready after {t_engine:.1f} s; built from {build.read_text().replace(chr(10), '') if build.exists() else 'an unrecorded tree'}")
        return restored

    def _run_loop(self) -> None:
        while not self._stopping.wait(self.snapshot_seconds):
            try:
                self.persister.snapshot()
            except Exception as error:  # noqa: BLE001 - the loop must go on; the next round tries again
                self.log(f"hosted: snapshot failed: {error}")
            engine = self.engine
            if engine is not None and engine.poll() is not None and not self._stopping.is_set() and self.restarts < 5:
                self.restarts += 1
                self.log(f"hosted: the engine stopped (exit status {engine.returncode}); starting it again ({self.restarts} of 5)")
                try:
                    self._start_engine()
                except Refused as error:
                    self.log(f"hosted: {error}")

    def stop(self) -> None:
        """Called when the container is told to stop. Must finish well inside Modal's 30 seconds."""
        started = time.monotonic()
        self._stopping.set()
        if self._loop is not None:
            self._loop.join(8)
        self._end(self.front, 2)
        self._end(self.engine, 8)
        try:
            result = self.persister.snapshot()
            self.log(f"hosted: last snapshot {result['written'] or 'nothing new'}{' FAILED ' + str(result['failed']) if result['failed'] else ''}; stopped in {time.monotonic() - started:.1f} s")
        except Exception as error:  # noqa: BLE001
            self.log(f"hosted: the last snapshot failed: {error}")
