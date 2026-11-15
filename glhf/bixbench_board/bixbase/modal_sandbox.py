"""Code cells on Modal: one Modal sandbox for each run (episode), with the local sandbox's interface.

`run.py --sandbox modal` gives each run a `ModalSandbox` in place of `bixbase.sandbox.Sandbox`.
The solvers do not change: they call `run_code`, `list_dir` and `read_file` as before, and
the tool output has the same form. The machine then only waits on the model, so more runs fit
on it at once (`--workers`).

Each run's sandbox:
  - is made from the image `bixbench-board-env:1`, built from this folder's own pins: Python 3.11
    with `requirements.txt`, and R from `r-environment.lock.txt` (the files `setup_cloud.sh`
    installs on a VM). When it starts, the installed packages are compared with those two
    files, and the sandbox is refused if they differ (`environment_problems`);
  - has no network (`block_network=True`);
  - gets the study's data from a Volume (uploaded once per study, named by a hash of its
    files), copied to /data, owned by root and not writable. The code runs as the user
    `agent`, so the data is read-only for it, as bubblewrap makes it on a VM;
  - runs every cell with `bixbase/cellrun.py`, the same code as the local sandbox: a cell's
    own process group is killed when the cell ends or its time is up;
  - is terminated when the run ends, and its work folder is copied back to the run's local
    `work/` folder (at most 50 MB).

Money. Every Modal step is a paid call: `ModalSession` refuses unless NO_PAID_CALLS is "0".
A run reserves its worst case (its sandbox alive until its timeout) before its sandbox is
made; a run waits while the reservations of the running runs would pass `--modal-usd-cap`,
and is refused when nothing runs and it still does not fit. Every sandbox gets one line in
`<out>/modal_ledger.jsonl`. Ctrl+C terminates every sandbox (`ModalSession.abort`).

    python -m bixbase.modal_sandbox build     # build and publish the image (billed, once)
    python -m bixbase.modal_sandbox verify    # one sandbox: the environment check, a Python
                                              # cell and an R cell (billed, small)
    python -m bixbase.modal_sandbox list      # sandboxes of this app still running
    python -m bixbase.modal_sandbox terminate # end them (after a crash)
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import secrets
import sys
import tarfile
import tempfile
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from . import cellrun
from .paid import refuse_paid
from .sandbox import DEFAULT_TIMEOUT_S, ExecResult, _truncate

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent  # glhf/bixbench_board
LOCK_FILE = ROOT / "r-environment.lock.txt"
REQUIREMENTS = ROOT / "requirements.txt"
CELLRUN = HERE / "cellrun.py"

APP_NAME = "bixbench-board"
IMAGE_NAME = "bixbench-board-env"
IMAGE_TAG = "1"
PUBLISHED = f"{IMAGE_NAME}:{IMAGE_TAG}"
VOLUME_NAME = "bixbench-board-data"
PYTHON_VERSION = "3.11"  # setup_cloud.sh: uv venv -p 3.11
# Modal's image builder version changes how each step is built; without a pin, a build uses
# the workspace's default, which differs between accounts.
IMAGE_BUILDER_VERSION = "2025.06"

# Modal's sandbox prices, read with `modal billing rates` on 2026-11-15 (the same numbers as
# glhf/bixbench_v1/src/bixbench_v1/modal_cost.py).
PRICES_READ = "modal billing rates, 2026-11-15"
CPU_CORE_HOUR = 0.1419
MEMORY_GIB_HOUR = 0.024
DEFAULT_CPU = 2.0
DEFAULT_MEMORY_MIB = 8192
DEFAULT_CAP_USD = 10.0  # per --out folder; see ModalSession._reserve
DEFAULT_RUN_SECONDS = 3600  # a run's time when the command has no --budget-seconds
SETUP_SECONDS = 900  # added to a run's time: start, data copy, the last cell, copy-back
MAX_COPY_BACK_BYTES = 50 * 1024 * 1024
MAX_COPY_BACK_FILES = 5000
LEDGER_NAME = "modal_ledger.jsonl"


class ModalCapReached(RuntimeError):
    """The next run could take this folder's Modal spend past --modal-usd-cap."""


class EnvironmentMismatch(RuntimeError):
    """The sandbox's packages are not the ones pinned in this folder."""


class SandboxGone(RuntimeError):
    """The Modal sandbox did not answer (it ended, or Modal failed)."""


@dataclass(frozen=True)
class Layout:
    """Where things are inside a sandbox. Tests use local folders and no separate user."""

    data: str = "/data"
    work: str = "/work"
    mount: str = "/mnt/bixdata"
    helper: str = "/opt/bix/cellrun.py"
    specs: str = "/tmp/bix"
    python: str = "/usr/local/bin/python3"
    rscript: str | None = "/opt/renv/bin/Rscript"
    renv: str = "/opt/renv"
    user: str | None = "agent"


REMOTE = Layout()


# --- The environment check ----------------------------------------------------------------------


def expected_conda(lock: Path = LOCK_FILE) -> dict[str, str | None]:
    """File name -> md5 of every package in the explicit lock (URL#md5 lines)."""
    found: dict[str, str | None] = {}
    for line in lock.read_text().splitlines():
        if line.startswith(("http://", "https://")):
            url, _, md5 = line.partition("#")
            found[url.rsplit("/", 1)[1]] = md5 or None
    return found


def expected_python(requirements: Path = REQUIREMENTS) -> dict[str, str]:
    """Package -> version of every `name==version` line."""
    found: dict[str, str] = {}
    for line in requirements.read_text().splitlines():
        name, sep, version = line.strip().partition("==")
        if sep and name and not name.startswith("#"):
            found[cellrun.normalize(name)] = version.strip()
    return found


def environment_problems(
    found: dict[str, Any], lock: Path = LOCK_FILE, requirements: Path = REQUIREMENTS
) -> list[str]:
    """What differs between a sandbox's packages and this folder's pins (empty = the same)."""
    problems = []
    want_r = expected_conda(lock)
    have_r = {name: md5 for name, md5 in found.get("conda") or []}
    missing = sorted(set(want_r) - set(have_r))
    extra = sorted(set(have_r) - set(want_r))
    changed = sorted(
        n for n in set(want_r) & set(have_r) if want_r[n] and have_r[n] and want_r[n] != have_r[n]
    )
    if missing:
        problems.append(f"R environment: {len(missing)} locked package(s) missing, e.g. {missing[:3]}")
    if extra:
        problems.append(f"R environment: {len(extra)} package(s) not in the lock, e.g. {extra[:3]}")
    if changed:
        problems.append(f"R environment: {len(changed)} package(s) with another md5, e.g. {changed[:3]}")
    have_py = found.get("python") or {}
    wrong = sorted(n for n, v in expected_python(requirements).items() if have_py.get(n) != v)
    if wrong:
        shown = [f"{n} {have_py.get(n)} (want {expected_python(requirements)[n]})" for n in wrong[:3]]
        problems.append(f"Python: {len(wrong)} package(s) not at the pinned version, e.g. {shown}")
    if not str(found.get("python_version", "")).startswith(PYTHON_VERSION + "."):
        problems.append(f"Python {found.get('python_version')}, not {PYTHON_VERSION}")
    return problems


# --- Modal itself (replaced by a fake in modal_selftest.py) --------------------------------------


class RealModal:
    """The few Modal calls this module makes. Imported only when a session starts."""

    def __init__(self, image_name: str = PUBLISHED) -> None:
        import modal

        self.modal = modal
        self.app = modal.App.lookup(APP_NAME, create_if_missing=True)
        self.image = modal.Image.from_name(image_name)
        self.volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)

    def read(self, path: str) -> bytes | None:
        try:
            return b"".join(self.volume.read_file(path))
        except Exception:  # noqa: BLE001 - absent (NotFoundError) or unreadable: upload again
            return None

    def upload(self, files: list[tuple[Path, str]]) -> None:
        with self.volume.batch_upload(force=True) as batch:
            for local, remote in files:
                batch.put_file(str(local), remote)

    def upload_bytes(self, data: bytes, remote: str) -> None:
        with self.volume.batch_upload(force=True) as batch:
            batch.put_file(io.BytesIO(data), remote)

    def create(
        self, *, mount: str, sub_path: str, cpu: float, memory_mib: int, timeout: int,
        tags: dict[str, str],
    ) -> Any:  # fmt: skip
        volume = self.volume.with_mount_options(read_only=True, sub_path=sub_path)
        return self.modal.Sandbox.create(
            "sleep", "infinity", app=self.app, image=self.image, timeout=timeout,
            cpu=(cpu, cpu), memory=(memory_mib, memory_mib), block_network=True,
            volumes={mount: volume}, tags=tags,
        )  # fmt: skip

    def image_id(self) -> str | None:
        return getattr(self.image, "object_id", None)

    def live(self, tags: dict[str, str] | None = None) -> list[Any]:
        return list(self.modal.Sandbox.list(app_id=self.app.app_id, tags=tags))


def _exec(sandbox: Any, cmd: list[str], timeout: int) -> tuple[int, str, str]:
    try:
        process = sandbox.exec(*cmd, timeout=timeout)
        out, err = process.stdout.read(), process.stderr.read()
        process.wait()
        return int(process.returncode or 0), out, err
    except Exception as error:  # noqa: BLE001
        raise SandboxGone(f"the Modal sandbox did not answer: {type(error).__name__}: {error}") from error


def _json_line(text: str) -> dict[str, Any]:
    for line in reversed(text.strip().splitlines()):
        try:
            document = json.loads(line)
        except ValueError:
            continue
        if isinstance(document, dict):
            return document
    raise SandboxGone(f"the sandbox printed no result: {text[-300:]!r}")


# --- One session: all the runs of one command ----------------------------------------------------


class ModalSession:
    def __init__(
        self,
        out_dir: Path,
        *,
        cpu: float = DEFAULT_CPU,
        memory_mib: int = DEFAULT_MEMORY_MIB,
        usd_cap: float | None = DEFAULT_CAP_USD,
        image: str = PUBLISHED,
        api: Any = None,
        layout: Layout | Callable[[str], Layout] = REMOTE,
        check_environment: bool = True,
    ) -> None:
        refuse_paid("Modal sandboxes for the code cells (--sandbox modal)")
        self.api = api if api is not None else RealModal(image)
        self.image = image
        self.cpu, self.memory_mib, self.usd_cap = cpu, memory_mib, usd_cap
        self.layout_for = layout if callable(layout) else (lambda name, _l=layout: _l)
        self.check_environment = check_environment
        self.tag = secrets.token_hex(8)  # on every sandbox of this session
        Path(out_dir).mkdir(parents=True, exist_ok=True)
        self.ledger = Path(out_dir) / LEDGER_NAME
        self._cond = threading.Condition()
        self._held: dict[str, float] = {}
        self._live: dict[str, Any] = {}
        self._keys: dict[Path, str] = {}
        self._uploading: dict[str, threading.Lock] = {}
        self.aborted = False

    # Money -------------------------------------------------------------------------------------
    @property
    def rate(self) -> float:
        """USD per second of one sandbox of this size."""
        return (self.cpu * CPU_CORE_HOUR + self.memory_mib / 1024 * MEMORY_GIB_HOUR) / 3600

    def worst_case_usd(self, timeout_s: int) -> float:
        return timeout_s * self.rate

    def spent(self) -> float:
        if not self.ledger.exists():
            return 0.0
        total = 0.0
        for line in self.ledger.read_text().splitlines():
            try:
                total += float(json.loads(line).get("usd") or 0)
            except ValueError:
                continue
        return total

    def _reserve(self, name: str, usd: float) -> None:
        """Hold a run's worst case. Waits while running runs hold too much; refuses when
        nothing runs and it still does not fit."""
        with self._cond:
            while True:
                if self.aborted:
                    raise SandboxGone("the session was stopped (Ctrl+C)")
                so_far, held = self.spent(), sum(self._held.values())
                if self.usd_cap is None or so_far + held + usd <= self.usd_cap + 1e-9:
                    self._held[name] = usd
                    return
                if not self._held:
                    raise ModalCapReached(
                        f"Modal sandbox cap: {so_far:.4f} USD already in {self.ledger}, this run "
                        f"could cost up to {usd:.4f} USD, cap {self.usd_cap:.2f} USD "
                        "(--modal-usd-cap)"
                    )
                self._cond.wait(5)

    def _settle(self, name: str) -> None:
        with self._cond:
            self._held.pop(name, None)
            self._cond.notify_all()

    def _record(self, line: dict[str, Any]) -> None:
        with self._cond:
            with self.ledger.open("a") as fh:
                fh.write(json.dumps(line) + "\n")

    # Data ----------------------------------------------------------------------------------------
    def data_key(self, data_dir: Path) -> str:
        """A hash of every file's path, size and content: the study's folder on the Volume."""
        data_dir = Path(data_dir).resolve()
        with self._cond:
            if data_dir in self._keys:
                return self._keys[data_dir]
        digest = hashlib.sha256()
        for path in sorted(p for p in data_dir.rglob("*") if p.is_file()):
            content = hashlib.sha256()
            with path.open("rb") as fh:
                for block in iter(lambda: fh.read(1 << 20), b""):
                    content.update(block)
            rel = path.relative_to(data_dir).as_posix()
            digest.update(f"{rel}\t{path.stat().st_size}\t{content.hexdigest()}\n".encode())
        key = digest.hexdigest()[:32]
        with self._cond:
            self._keys[data_dir] = key
        return key

    def ensure_data(self, data_dir: Path) -> str:
        """Upload the study's data once (the runs of one study share it). Returns the Volume
        sub-path that holds it."""
        data_dir = Path(data_dir).resolve()
        key = self.data_key(data_dir)
        with self._cond:
            lock = self._uploading.setdefault(key, threading.Lock())
        with lock:
            marker = f"/{key}/complete.json"
            if self.api.read(marker) is None:
                files = [
                    (p, f"/{key}/data/{p.relative_to(data_dir).as_posix()}")
                    for p in sorted(data_dir.rglob("*"))
                    if p.is_file()
                ]
                self.api.upload(files)
                document = {"files": len(files), "key": key, "made": time.time()}
                self.api.upload_bytes(json.dumps(document).encode(), marker)
        return f"/{key}/data"

    # Runs ----------------------------------------------------------------------------------------
    def open(
        self, data_dir: Path, work_dir: Path, *, name: str, seconds: float | None = None
    ) -> ModalSandbox:
        box = ModalSandbox(self, data_dir, work_dir, name=name, seconds=seconds)
        box.start()
        return box

    def abort(self) -> list[str]:
        """Ctrl+C: no new sandbox starts, and every running one is terminated."""
        with self._cond:
            self.aborted = True
            self._cond.notify_all()
        return self.close()

    def close(self) -> list[str]:
        """Terminate every sandbox of this session that is still alive. Returns their ids."""
        with self._cond:
            live = list(self._live.items())
        ended = []
        for sandbox_id, sandbox in live:
            try:
                sandbox.terminate()
                ended.append(sandbox_id)
            except Exception:  # noqa: BLE001 - the list/terminate commands look again
                pass
        return ended


# --- One run's sandbox ---------------------------------------------------------------------------


def _start_script(layout: Layout) -> str:
    """As root, once: copy the data to a real folder that only root may change, make the work
    folder, and the user the code runs as."""
    lines = [
        "set -e",
        f"mkdir -p {layout.data} {layout.work} {layout.specs} {PurePosixPath(layout.helper).parent}",
        f"cp -a {layout.mount}/. {layout.data}/",
        f"chmod -R a-w,a+rX {layout.data}",
    ]
    if layout.user:
        lines += [
            f"chown -R root:root {layout.data}",
            f"id -u {layout.user} >/dev/null 2>&1 || useradd -M -d {layout.work} -s /bin/sh {layout.user}",
            f"chown {layout.user} {layout.work}",
            "chmod 700 /__modal 2>/dev/null || true",  # the Volume's own path: root only
        ]
    return "\n".join(lines) + "\n"


def _safe_members(payload: bytes) -> list[tuple[str, bytes]]:
    """Regular files of a gzipped tar from the sandbox, inside the target, within the limits."""
    out: list[tuple[str, bytes]] = []
    total = 0
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as tar:
        for member in tar:
            if not member.isfile():
                continue
            name = PurePosixPath(member.name)
            parts = [p for p in name.parts if p not in ("", ".")]
            if name.is_absolute() or ".." in parts or not parts:
                continue
            total += member.size
            if len(out) >= MAX_COPY_BACK_FILES or total > MAX_COPY_BACK_BYTES:
                break
            handle = tar.extractfile(member)
            if handle is not None:
                out.append(("/".join(parts), handle.read()))
    return out


class ModalSandbox:
    """The interface of bixbase.sandbox.Sandbox, on a Modal sandbox. `data_dir` and `work_dir`
    are the local folders (the board's data overview reads the local copy, which is the same
    data); the code sees the sandbox's own folders (Layout)."""

    def __init__(
        self,
        session: ModalSession,
        data_dir: Path,
        work_dir: Path,
        *,
        name: str,
        seconds: float | None = None,
    ) -> None:
        self.session = session
        self.data_dir = Path(data_dir).resolve()
        self.work_dir = Path(work_dir).resolve()
        self.work_dir.mkdir(parents=True, exist_ok=True)
        self.name = name
        self.layout = session.layout_for(name)
        self.timeout = int((seconds or DEFAULT_RUN_SECONDS) + SETUP_SECONDS)
        self.sandbox: Any = None
        self.started: float | None = None
        self.environment: dict[str, Any] | None = None
        self.environment_check = "not run"
        self._cell = 0
        self._closed = False

    # Start ---------------------------------------------------------------------------------------
    def start(self) -> None:
        session, layout = self.session, self.layout
        session._reserve(self.name, session.worst_case_usd(self.timeout))
        try:
            sub_path = session.ensure_data(self.data_dir)
            self.started = time.time()
            self.sandbox = session.api.create(
                mount=layout.mount, sub_path=sub_path, cpu=session.cpu,
                memory_mib=session.memory_mib, timeout=self.timeout,
                tags={"bixboard_session": session.tag, "bixboard_run": self.name[:60]},
            )  # fmt: skip
            with session._cond:
                session._live[self.sandbox.object_id] = self.sandbox
            code, _, err = _exec(self.sandbox, ["sh", "-c", _start_script(layout)], 900)
            if code != 0:
                raise SandboxGone(f"preparing the sandbox failed: {err[-300:]}")
            self.sandbox.filesystem.write_text(CELLRUN.read_text(), layout.helper)
            if session.check_environment:
                self._check_environment()
        except BaseException as error:
            self.close(ok=False, what=f"refused at start: {type(error).__name__}")
            raise

    def _check_environment(self) -> None:
        code, out, err = _exec(
            self.sandbox, [self.layout.python, self.layout.helper, "env", self.layout.renv], 300
        )
        if code != 0:
            raise SandboxGone(f"the environment check failed: {err[-300:]}")
        self.environment = _json_line(out)
        problems = environment_problems(self.environment)
        if problems:
            self.environment_check = "failed"
            raise EnvironmentMismatch(
                "Modal sandbox refused: its packages are not this folder's pins "
                "(requirements.txt, r-environment.lock.txt): " + "; ".join(problems)
                + ". Rebuild the image: python -m bixbase.modal_sandbox build"
            )
        self.environment_check = "passed"

    # The three tools -----------------------------------------------------------------------------
    def _as_user(self, cmd: list[str]) -> list[str]:
        return ["runuser", "-u", self.layout.user, "--", *cmd] if self.layout.user else cmd

    def _cell_env(self) -> dict[str, str]:
        work = self.layout.work
        return {
            "PATH": os.environ.get("BIXBASE_SANDBOX_PATH", "/usr/local/bin:/usr/bin:/bin"),
            "LANG": "C.UTF-8",
            "DATA_DIR": self.layout.data,
            "MPLBACKEND": "Agg",  # headless figures
            "OMP_NUM_THREADS": str(max(1, int(self.session.cpu))),
            "HOME": work,
            "MPLCONFIGDIR": f"{work}/.matplotlib",
            "TMPDIR": "/tmp",
        }

    def run_code(
        self, code: str, timeout_s: int = DEFAULT_TIMEOUT_S, language: str = "python"
    ) -> ExecResult:
        if self._closed or self.sandbox is None:
            raise SandboxGone("this run's Modal sandbox has ended")
        if language == "r":
            if not self.layout.rscript:
                raise RuntimeError("R requested but Rscript is not installed")
            interpreter, ext = self.layout.rscript, "R"
        else:
            interpreter, ext = self.layout.python, "py"
        idx = self._cell
        self._cell += 1
        cell_name = f"cell_{idx:03d}.{ext}"
        (self.work_dir / cell_name).write_text(code)  # a local copy, as the local sandbox keeps
        spec = {
            "code": code, "cell_name": cell_name, "interpreter": interpreter,
            "work_dir": self.layout.work, "env": self._cell_env(), "timeout_s": timeout_s,
        }  # fmt: skip
        spec_path = f"{self.layout.specs}/spec_{idx:03d}.json"
        try:
            self.sandbox.filesystem.write_text(json.dumps(spec), spec_path)
        except Exception as error:  # noqa: BLE001
            raise SandboxGone(f"the Modal sandbox did not answer: {error}") from error
        runner = [self.layout.python, self.layout.helper, "run", spec_path]
        if self.layout.user:
            # The spec is written by root; the user that runs the cell must be able to read it.
            cmd = ["sh", "-c", 'chmod 0644 "$1" && shift && exec "$@"', "sh", spec_path,
                   *self._as_user(runner)]  # fmt: skip
        else:
            cmd = runner
        code_, out, err = _exec(self.sandbox, cmd, int(timeout_s + cellrun.DRAIN_SECONDS + 60))
        if code_ != 0:
            raise SandboxGone(f"the cell runner failed (exit {code_}): {err[-300:]}")
        done = _json_line(out)
        return ExecResult(
            cell_index=idx,
            code=code,
            stdout=_truncate(done["stdout"]),
            stderr=_truncate(done["stderr"]),
            exit_code=done["exit_code"],
            timed_out=bool(done["timed_out"]),
            duration_s=float(done["duration_s"]),
            new_files=list(done.get("new_files") or []),
        )

    def _helper(self, *args: str) -> str:
        if self._closed or self.sandbox is None:
            raise SandboxGone("this run's Modal sandbox has ended")
        env = ["/usr/bin/env", f"WORK_DIR={self.layout.work}", f"DATA_DIR={self.layout.data}"]
        cmd = self._as_user([*env, self.layout.python, self.layout.helper, *args])
        code, out, err = _exec(self.sandbox, cmd, 120)
        if code != 0:
            raise SandboxGone(f"the sandbox helper failed (exit {code}): {err[-300:]}")
        done = _json_line(out)
        if not done.get("ok"):
            if done.get("kind") == "PermissionError":
                raise PermissionError(done.get("error"))
            raise RuntimeError(str(done.get("error")))
        return str(done["text"])

    def list_dir(self, path: str = ".") -> str:
        return self._helper("ls", path)

    def read_file(self, path: str, offset: int = 0, limit: int = 200) -> str:
        return self._helper("read", path, str(int(offset)), str(int(limit)))

    # End -----------------------------------------------------------------------------------------
    def _copy_back(self) -> str:
        archive = f"{self.layout.specs}/work.tgz"
        code, out, err = _exec(
            self.sandbox,
            ["sh", "-c", f"tar -C {self.layout.work} -czf {archive} . && stat -c %s {archive} 2>/dev/null || wc -c < {archive}"],
            300,
        )  # fmt: skip
        if code != 0:
            return f"copy-back failed: {err[-200:]}"
        size = int((out.strip().splitlines() or ["0"])[-1].strip() or 0)
        if size > MAX_COPY_BACK_BYTES:
            return f"work folder not copied back: {size} bytes (limit {MAX_COPY_BACK_BYTES})"
        members = _safe_members(bytes(self.sandbox.filesystem.read_bytes(archive)))
        for rel, data in members:
            target = self.work_dir / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        return f"{len(members)} file(s) copied back"

    def close(self, ok: bool = True, what: str = "ended") -> dict[str, Any]:
        """Copy the work folder back, terminate the sandbox and write its ledger line. Never
        raises; safe to call twice."""
        if self._closed:
            return {}
        self._closed = True
        session = self.session
        line: dict[str, Any] = {}
        try:
            if self.sandbox is None:
                return {}
            note = ""
            if ok:
                try:
                    note = self._copy_back()
                except Exception as error:  # noqa: BLE001
                    note = f"copy-back failed: {type(error).__name__}: {error}"[:300]
            try:
                self.sandbox.terminate()
            except Exception as error:  # noqa: BLE001 - `terminate` looks again
                note += f"; terminate failed: {error}"[:200]
                ok = False
            seconds = max(0.0, time.time() - (self.started or time.time()))
            line = {
                "when": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "session": session.tag,
                "run": self.name,
                "sandbox_id": self.sandbox.object_id,
                "image": session.image,
                "cpu": session.cpu,
                "memory_mib": session.memory_mib,
                "seconds": round(seconds, 1),
                "usd": round(seconds * session.rate, 6),
                "prices_read": PRICES_READ,
                "ok": ok,
                "what": what,
                "environment_check": self.environment_check,
                "note": note,
            }
            session._record(line)
            with session._cond:
                session._live.pop(self.sandbox.object_id, None)
        finally:
            session._settle(self.name)
        return line

    def settings(self) -> dict[str, Any]:
        """What result.json records about this run's sandbox."""
        return {
            "sandbox": "modal",
            "image": self.session.image,
            "image_id": getattr(self.session.api, "image_id", lambda: None)(),
            "sandbox_id": getattr(self.sandbox, "object_id", None),
            "cpu": self.session.cpu,
            "memory_mib": self.session.memory_mib,
            "timeout_seconds": self.timeout,
            "network": "blocked",
            "environment_check": self.environment_check,
        }


# --- The image, and the commands ------------------------------------------------------------------


def definition() -> Any:
    """The image: this folder's pins, installed the way setup_cloud.sh installs them on a VM."""
    import modal

    return (
        modal.Image.debian_slim(python_version=PYTHON_VERSION)
        .apt_install("curl", "bzip2", "ca-certificates")
        .pip_install_from_requirements(str(REQUIREMENTS))
        .add_local_file(LOCK_FILE, "/tmp/bix-build/r-environment.lock.txt", copy=True)
        .run_commands(
            "curl -Ls https://micro.mamba.pm/api/micromamba/linux-64/latest"
            " | tar -xj -C /usr/local bin/micromamba",
            "MAMBA_ROOT_PREFIX=/opt/micromamba micromamba create -y -p /opt/renv"
            " --file /tmp/bix-build/r-environment.lock.txt",
            "/opt/renv/bin/Rscript -e 'suppressMessages({library(DESeq2); "
            'library(clusterProfiler); library(edgeR)}); cat("R OK\\n")\'',
            "rm -rf /tmp/bix-build /opt/micromamba/pkgs",
        )
    )


def build() -> str:
    refuse_paid(f"building the Modal image {PUBLISHED}")
    chosen = os.environ.get("MODAL_IMAGE_BUILDER_VERSION")
    if chosen not in (None, IMAGE_BUILDER_VERSION):
        sys.exit(
            f"MODAL_IMAGE_BUILDER_VERSION is {chosen}; this image is built with "
            f"{IMAGE_BUILDER_VERSION}. Unset it, or change IMAGE_BUILDER_VERSION and run verify."
        )
    os.environ["MODAL_IMAGE_BUILDER_VERSION"] = IMAGE_BUILDER_VERSION
    import modal

    app = modal.App.lookup(APP_NAME, create_if_missing=True)
    image = definition()
    with modal.enable_output():
        image.build(app)
    image.publish(PUBLISHED)
    return str(image.object_id)


def verify(image: str = PUBLISHED) -> int:
    """One small sandbox: the environment check, a Python cell and an R cell."""
    with tempfile.TemporaryDirectory(prefix="bixboard-verify-") as tmp:
        data = Path(tmp) / "data"
        data.mkdir()
        (data / "values.csv").write_text("x\n1\n2\n3\n4\n")
        session = ModalSession(Path(tmp) / "out", image=image, cpu=1.0, memory_mib=2048, usd_cap=1.0)
        box = session.open(data, Path(tmp) / "work", name="verify", seconds=60)
        try:
            print(f"environment check: {box.environment_check}")
            py = box.run_code(
                "import os, pandas as pd\n"
                "print(pd.read_csv(os.environ['DATA_DIR'] + '/values.csv').x.mean())\n"
                "try:\n    open(os.environ['DATA_DIR'] + '/w', 'w')\n    print('WRITE_OK')\n"
                "except OSError:\n    print('WRITE_DENIED')\n"
            )
            r = box.run_code(
                "x <- read.csv(file.path(Sys.getenv('DATA_DIR'), 'values.csv'))$x\n"
                "cat('R mean', mean(x), '\\n')\n", language="r",
            )  # fmt: skip
            print(f"python cell: {py.stdout.strip()!r}  R cell: {r.stdout.strip()!r}")
            ok = "2.5" in py.stdout and "WRITE_DENIED" in py.stdout and "R mean 2.5" in r.stdout
        finally:
            line = box.close()
        print(f"{line.get('seconds')} s, {line.get('usd', 0):.4f} USD")
        print("OK: the image runs the board's cells" if ok else "FAILED: see the cells above")
        return 0 if ok else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("build", help="build and publish the image (billed)")
    sub = commands.add_parser("verify", help="check the published image (billed, small)")
    sub.add_argument("--image", default=PUBLISHED)
    commands.add_parser("list", help="sandboxes of this app still running")
    commands.add_parser("terminate", help="end every sandbox of this app")
    arguments = parser.parse_args(argv)
    if arguments.command == "build":
        print(f"built {PUBLISHED}: {build()}\nnow check it: python -m bixbase.modal_sandbox verify")
        return 0
    if arguments.command == "verify":
        return verify(arguments.image)
    refuse_paid("listing or terminating Modal sandboxes")
    api = RealModal()
    alive = api.live()
    if arguments.command == "terminate":
        for sandbox in alive:
            sandbox.terminate()
        print(f"terminated {len(alive)} sandbox(es)")
        return 0
    print(f"{len(alive)} sandbox(es) running in app {APP_NAME}: "
          + " ".join(s.object_id for s in alive))  # fmt: skip
    return 1 if alive else 0


if __name__ == "__main__":
    raise SystemExit(main())
