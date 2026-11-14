"""Sandboxed code execution for agent runs.

Each study gets an isolated working directory. Code runs as a subprocess with:
  - cwd = the study's work dir (files the agent writes land here)
  - an allow-listed environment only (see `Sandbox.cell_env`): no provider
    keys, tokens, HF_*, cloud variables or anything else from the parent
  - on macOS, a deny-by-default `sandbox-exec` profile (see `build_profile`):
    no network, reads only from the work dir, the prepared data dir, the
    Python installation and system libraries; writes only to the work dir
  - elsewhere there is no sandbox, so cells are refused unless the caller
    passes unsafe_no_sandbox=True (run.py: --unsafe-no-sandbox)

Every run_code call is logged: the cell source, stdout, stderr, exit status,
timeout flag, and the list of files created/modified in the work dir.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_TIMEOUT_S = 120
MAX_OUTPUT_CHARS = 20_000

_SANDBOX_EXEC = shutil.which("sandbox-exec") if sys.platform == "darwin" else None

NO_SANDBOX_MESSAGE = (
    "refusing to run model-written code without a sandbox: the cell sandbox "
    "is macOS sandbox-exec, which is not available here. Without it a cell "
    "can read any file of this user (the answers in the dataset cache and "
    "capsule zips, earlier results, .env, ssh keys) and use the network. "
    "Run on macOS, or inside a container/VM you are willing to expose and "
    "pass --unsafe-no-sandbox (Sandbox(unsafe_no_sandbox=True))."
)


class SandboxUnavailable(RuntimeError):
    """No OS sandbox on this machine and the caller did not opt out."""


def sandbox_available() -> bool:
    return _SANDBOX_EXEC is not None


# System locations the interpreter and compiled extensions load from. Nothing
# under /Users, no /etc, no /Library/Preferences, no keychains.
_SYSTEM_READ = (
    "/usr/lib", "/usr/share", "/usr/bin", "/bin",
    "/System/Library", "/System/Volumes/Preboot/Cryptexes",
    "/System/Cryptexes", "/Library/Apple", "/Library/Frameworks",
    "/Library/Developer/CommandLineTools/Library/Frameworks",
    "/Library/Developer/CommandLineTools/usr/lib",
    "/opt/homebrew/Cellar", "/opt/homebrew/opt", "/opt/homebrew/lib",
    "/opt/homebrew/Frameworks",
    "/usr/local/Cellar", "/usr/local/opt", "/usr/local/lib",
    "/usr/local/Frameworks",
    "/private/var/db/timezone", "/private/etc/localtime",
)
# "/" itself: dyld opens the root folder at start-up (names only, no subtree)
_DEV_READ = ("/", "/dev/null", "/dev/zero", "/dev/random", "/dev/urandom")
_CELL_PATH = "/usr/bin:/bin"


def _q(path) -> str:
    """A path as a seatbelt string literal."""
    return '"' + str(path).replace("\\", "\\\\").replace('"', '\\"') + '"'


def _ancestors(paths) -> list[str]:
    out: set[str] = set()
    for p in paths:
        out.update(str(a) for a in Path(p).parents)
    return sorted(out)


def symlink_hops(path: str) -> list[str]:
    """Every symlink met while resolving `path` (a venv's python is a link to
    the base interpreter, often through a linked folder). The sandbox must be
    able to read these links themselves."""
    hops: list[str] = []
    todo = [os.path.abspath(path)]
    while todo and len(hops) < 40:
        parts = Path(todo.pop()).parts
        cur = Path(parts[0])
        for i, part in enumerate(parts[1:], start=1):
            cur = cur / part
            if cur.is_symlink():
                hops.append(str(cur))
                target = os.path.join(cur.parent, os.readlink(cur))
                todo.append(os.path.normpath(os.path.join(target, *parts[i + 1:])))
                break
    return hops


def build_profile(
    work_dir: Path, data_dir: Path, python_roots: list[str],
    links: list[str] = (),
) -> str:
    """The seatbelt profile for one run. Deny by default; later rules win.

    Readable: work_dir, data_dir, the Python installation (python_roots),
    system libraries. Path lookups (stat only, no listing, no contents) are
    allowed on the parent folders of those. Writable: work_dir, /dev/null.
    Network: none. Everything else, including the rest of the repository,
    the home folder, the dataset cache, capsule zips and other runs'
    results, is denied.
    """
    work, data = str(work_dir), str(data_dir)
    roots = [work, data, *python_roots]
    lines = [
        "(version 1)",
        "(deny default)",
        "(allow process-fork)",
        "(allow signal (target same-sandbox))",
        "(allow sysctl-read)",
        "(allow ipc-posix-sem)",
        '(allow ipc-posix-shm-read-data (ipc-posix-name "apple.shm.notification_center"))',
        "(allow mach-lookup"
        ' (global-name "com.apple.system.opendirectoryd.libinfo")'
        ' (global-name "com.apple.system.notification_center"))',
        "(allow process-exec",
        *[f"    (subpath {_q(p)})" for p in (*python_roots, "/usr/bin", "/bin")],
        ")",
        "(allow file-read-metadata",
        *[f"    (literal {_q(p)})" for p in _ancestors([*roots, *links])],
        '    (literal "/tmp") (literal "/var") (literal "/etc"))',
        "(allow file-read*",
        *[f"    (subpath {_q(p)})" for p in (*roots, *_SYSTEM_READ)],
        *[f"    (literal {_q(p)})" for p in (*links, *_DEV_READ)],
        '    (subpath "/dev/fd"))',
        "(allow file-write*",
        f"    (subpath {_q(work)})",
        '    (literal "/dev/null"))',
        "(deny network*)",
        "",
    ]
    return "\n".join(lines)


def python_roots(python: str) -> list[str]:
    """Folders the given interpreter needs to read: its prefix, base prefix,
    standard library and site-packages (asked from the interpreter itself)."""
    probe = (
        "import json,site,sys,sysconfig\n"
        "p=[sys.prefix,sys.base_prefix,sys.exec_prefix,sys.base_exec_prefix]\n"
        "p+=[sysconfig.get_path(k) for k in ('stdlib','platstdlib','purelib','platlib')]\n"
        "p+=site.getsitepackages()\n"
        "print(json.dumps([x for x in p if x]))\n"
    )
    out = subprocess.run(
        [python, "-I", "-c", probe], capture_output=True, text=True, timeout=60,
        env={"PATH": _CELL_PATH}, check=True,
    ).stdout
    found = {os.path.realpath(x) for x in json.loads(out.strip().splitlines()[-1])}
    found.add(os.path.dirname(os.path.realpath(python)))
    # drop anything nested in another root, and never a filesystem root or /usr
    keep = []
    for p in sorted(found, key=len):
        if p in ("/", "/usr", str(Path.home())):
            continue
        if not any(p == k or p.startswith(k + os.sep) for k in keep):
            keep.append(p)
    return keep


@dataclass
class ExecResult:
    cell_index: int
    code: str
    stdout: str
    stderr: str
    exit_code: int | None  # None when the process was killed for timeout
    timed_out: bool
    duration_s: float
    new_files: list[str] = field(default_factory=list)

    def tool_result_text(self) -> str:
        """Compact text returned to the model for a run_code tool call."""
        parts = []
        if self.stdout:
            parts.append(f"stdout:\n{self.stdout}")
        if self.stderr:
            parts.append(f"stderr:\n{self.stderr}")
        if self.timed_out:
            parts.append("ERROR: execution timed out and was killed.")
        elif self.exit_code != 0:
            parts.append(f"ERROR: exited with code {self.exit_code}.")
        if self.new_files:
            parts.append("files written: " + ", ".join(sorted(self.new_files)))
        if not parts:
            parts.append("(no output)")
        return "\n".join(parts)


def _truncate(s: str, limit: int = MAX_OUTPUT_CHARS) -> str:
    if len(s) <= limit:
        return s
    head = limit // 2
    return s[:head] + f"\n...[truncated {len(s) - limit} chars]...\n" + s[-head:]


class Sandbox:
    """Per-study execution environment.

    data_dir: read-only study data (exposed to code as $DATA_DIR).
    work_dir: writable scratch dir owned by this run.
    """

    def __init__(
        self,
        data_dir: Path,
        work_dir: Path,
        *,
        python: str | None = None,
        enforce_readonly: bool = True,
        unsafe_no_sandbox: bool = False,
    ):
        self.data_dir = Path(data_dir).resolve()
        self.work_dir = Path(work_dir).resolve()
        self.work_dir.mkdir(parents=True, exist_ok=True)
        self.tmp_dir = self.work_dir / ".tmp"
        self.tmp_dir.mkdir(exist_ok=True)
        self.python = os.path.abspath(python or sys.executable)
        self._cell = 0
        self.profile: str | None = None

        self.use_sandbox_exec = enforce_readonly and sandbox_available()
        if not self.use_sandbox_exec:
            if not unsafe_no_sandbox:
                raise SandboxUnavailable(NO_SANDBOX_MESSAGE)
            print("WARNING: --unsafe-no-sandbox: model-written code runs "
                  "with no file or network isolation", file=sys.stderr, flush=True)
        else:
            # kept in memory and passed with -p: a profile file inside the
            # work dir could be rewritten by a cell for the next cell
            self.profile = build_profile(
                self.work_dir, self.data_dir, python_roots(self.python),
                symlink_hops(self.python),
            )

    def cell_env(self) -> dict[str, str]:
        """The whole environment of a cell. Nothing is inherited except LANG
        and a numeric OMP_NUM_THREADS."""
        threads = os.environ.get("OMP_NUM_THREADS", "")
        return {
            "PATH": f"{os.path.dirname(self.python)}:{_CELL_PATH}",
            "HOME": str(self.work_dir),
            "TMPDIR": str(self.tmp_dir),
            "DATA_DIR": str(self.data_dir),
            "MPLBACKEND": "Agg",  # headless figures
            "LANG": os.environ.get("LANG") or "en_US.UTF-8",
            "OMP_NUM_THREADS": threads if threads.isdigit() else "4",
        }

    def _listing(self) -> dict[str, float]:
        return {
            str(p.relative_to(self.work_dir)): p.stat().st_mtime
            for p in self.work_dir.rglob("*")
            if p.is_file() and self.tmp_dir not in p.parents
        }

    def _wrap_cmd(self, cmd: list[str]) -> list[str]:
        if not self.use_sandbox_exec or self.profile is None:
            return cmd
        return [_SANDBOX_EXEC, "-p", self.profile, *cmd]

    def run_code(self, code: str, timeout_s: int = DEFAULT_TIMEOUT_S) -> ExecResult:
        """Execute a python cell in the work dir; capture outputs."""
        idx = self._cell
        self._cell += 1
        cell_path = self.work_dir / f"cell_{idx:03d}.py"
        cell_path.write_text(code)

        env = self.cell_env()
        self.tmp_dir.mkdir(exist_ok=True)

        before = self._listing()
        t0 = time.monotonic()
        timed_out = False
        try:
            proc = subprocess.run(
                self._wrap_cmd([self.python, str(cell_path.name)]),
                cwd=self.work_dir,
                env=env,
                capture_output=True,
                text=True,
                timeout=timeout_s,
            )
            stdout, stderr, exit_code = proc.stdout, proc.stderr, proc.returncode
        except subprocess.TimeoutExpired as e:
            timed_out = True
            stdout = (e.stdout or b"").decode("utf-8", "replace") if isinstance(
                e.stdout, bytes
            ) else (e.stdout or "")
            stderr = (e.stderr or b"").decode("utf-8", "replace") if isinstance(
                e.stderr, bytes
            ) else (e.stderr or "")
            stderr += f"\n[killed after {timeout_s}s timeout]"
            exit_code = None
        duration = time.monotonic() - t0

        after = self._listing()
        new_files = [
            name for name in after
            if name != cell_path.name
            and (name not in before or after[name] != before[name])
        ]
        return ExecResult(
            cell_index=idx,
            code=code,
            stdout=_truncate(stdout),
            stderr=_truncate(stderr),
            exit_code=exit_code,
            timed_out=timed_out,
            duration_s=round(duration, 3),
            new_files=new_files,
        )

    def resolve_in_scope(self, path: str, base: Path | None = None) -> Path:
        """Resolve a model-provided path, confined to work_dir or data_dir."""
        base = base or self.work_dir
        p = Path(path)
        if not p.is_absolute():
            if p.parts and p.parts[0] == "DATA_DIR":
                p = self.data_dir.joinpath(*p.parts[1:])
            elif p.parts and p.parts[0] == "WORK_DIR":
                p = self.work_dir.joinpath(*p.parts[1:])
            else:
                p = base / p
        p = p.resolve()
        allowed = (self.work_dir, self.data_dir)
        if not any(p == a or a in p.parents for a in allowed):
            raise PermissionError(
                f"path {p} is outside the allowed dirs "
                f"(WORK_DIR={self.work_dir}, DATA_DIR={self.data_dir})"
            )
        return p

    def list_dir(self, path: str = ".") -> str:
        target = self.resolve_in_scope(path)
        if not target.is_dir():
            return f"ERROR: {path} is not a directory"
        rows = []
        for p in sorted(target.iterdir()):
            kind = "dir " if p.is_dir() else "file"
            size = "-" if p.is_dir() else str(p.stat().st_size)
            rows.append(f"{kind}\t{size}\t{p.name}")
        header = f"listing of {target}:"
        return header + ("\n" + "\n".join(rows) if rows else "\n(empty)")

    def read_file(
        self, path: str, offset: int = 0, limit: int = 200
    ) -> str:
        target = self.resolve_in_scope(path)
        if not target.is_file():
            return f"ERROR: {path} is not a file"
        try:
            lines = target.read_text(errors="replace").splitlines()
        except OSError as e:
            return f"ERROR: could not read {path}: {e}"
        sliced = lines[offset : offset + limit]
        body = "\n".join(
            f"{offset + i + 1}\t{line}" for i, line in enumerate(sliced)
        )
        footer = ""
        if offset + limit < len(lines):
            footer = f"\n...[{len(lines) - offset - limit} more lines]"
        return f"{target} ({len(lines)} lines)\n{body}{footer}"
