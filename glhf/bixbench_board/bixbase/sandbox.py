"""Sandboxed code execution for agent runs.

Each study gets an isolated working directory. Code runs as a subprocess with:
  - cwd = the study's work dir (files the agent writes land here)
  - DATA_DIR env var pointing at the study's read-only data
  - on macOS, `sandbox-exec` denies writes outside the work dir + tmp, giving
    genuine read-only access to the data dir; elsewhere we fall back to a soft
    contract (documented + enforced by prompt) since POSIX has no cheap way to
    make a subtree read-only for a child of the same user.

Every run_code call is logged: the cell source, stdout, stderr, exit status,
timeout flag, and the list of files created/modified in the work dir.

A cell runs in its own process group, and the whole group is killed when the cell ends or its
time is up (bixbase/cellrun.py), so nothing a cell starts outlives it.
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
import threading
from dataclasses import dataclass, field
from pathlib import Path

from . import cellrun

DEFAULT_TIMEOUT_S = 120
MAX_OUTPUT_CHARS = 20_000

_SANDBOX_EXEC = shutil.which("sandbox-exec")
# Linux: bubblewrap re-mounts the data dir read-only for the child process.
_BWRAP = shutil.which("bwrap")
_RSCRIPT = os.environ.get("BIXBASE_RSCRIPT") or shutil.which("Rscript")

# macOS seatbelt profile: allow everything by default, deny writes except in
# the work dir, system temp dirs, and /dev/null. This makes the study data dir
# genuinely read-only without copying it.
_SB_PROFILE_TEMPLATE = """\
(version 1)
(allow default)
(deny file-write*)
(allow file-write*
    (subpath (param "WORK_DIR"))
    (subpath (param "TMP_DIR"))
    (literal "/dev/null")
    (subpath "/dev"))
"""


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
    ):
        self.data_dir = Path(data_dir).resolve()
        self.work_dir = Path(work_dir).resolve()
        self.work_dir.mkdir(parents=True, exist_ok=True)
        self.python = python or sys.executable
        self._cell = 0
        # Members can run code at the same time (parallel rounds): each cell gets its own number.
        self._cell_lock = threading.Lock()
        self._profile_path: Path | None = None

        self.use_sandbox_exec = enforce_readonly and _SANDBOX_EXEC is not None
        if enforce_readonly and _SANDBOX_EXEC is None and sys.platform == "darwin":
            raise RuntimeError("sandbox-exec requested but not found on PATH")
        self.use_bwrap = (
            enforce_readonly and not self.use_sandbox_exec and _BWRAP is not None
        )
        if self.use_sandbox_exec:
            self._profile_path = self.work_dir / ".seatbelt.sb"
            self._profile_path.write_text(_SB_PROFILE_TEMPLATE)

    def _listing(self) -> dict[str, float]:
        return cellrun.listing(self.work_dir)

    def _wrap_cmd(self, cmd: list[str]) -> list[str]:
        if self.use_bwrap:
            return [
                _BWRAP, "--dev-bind", "/", "/",
                "--ro-bind", str(self.data_dir), str(self.data_dir),
                "--die-with-parent", *cmd,
            ]
        if not self.use_sandbox_exec or self._profile_path is None:
            return cmd
        return [
            _SANDBOX_EXEC,
            "-D",
            f"WORK_DIR={self.work_dir}",
            "-D",
            f"TMP_DIR={Path(tempfile.gettempdir()).resolve()}",
            "-f",
            str(self._profile_path),
            *cmd,
        ]

    def run_code(
        self, code: str, timeout_s: int = DEFAULT_TIMEOUT_S, language: str = "python"
    ) -> ExecResult:
        """Execute a python (or R) cell in the work dir; capture outputs."""
        if language == "r":
            if not _RSCRIPT:
                raise RuntimeError("R requested but Rscript is not installed")
            interpreter, ext = _RSCRIPT, "R"
        else:
            interpreter, ext = self.python, "py"
        with self._cell_lock:
            idx = self._cell
            self._cell += 1
        cell_path = self.work_dir / f"cell_{idx:03d}.{ext}"
        cell_path.write_text(code)

        env = dict(os.environ)
        env["DATA_DIR"] = str(self.data_dir)
        env["MPLBACKEND"] = "Agg"  # headless figures
        env.setdefault("OMP_NUM_THREADS", "4")
        # keep all scratch writes inside the work dir (caches, tempfiles)
        env["HOME"] = str(self.work_dir)
        env["MPLCONFIGDIR"] = str(self.work_dir / ".matplotlib")
        env["TMPDIR"] = tempfile.gettempdir()

        before = self._listing()
        done = cellrun.run_cell(
            self._wrap_cmd([interpreter, str(cell_path.name)]),
            cwd=str(self.work_dir),
            env=env,
            timeout_s=timeout_s,
        )
        stdout, stderr = done["stdout"], done["stderr"]
        exit_code, timed_out, duration = done["exit_code"], done["timed_out"], done["duration_s"]
        new_files = cellrun.new_files(before, self._listing(), cell_path.name)
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
        return cellrun.resolve_in_scope(path, self.work_dir, self.data_dir, base)

    def list_dir(self, path: str = ".") -> str:
        return cellrun.list_text(self.resolve_in_scope(path), path)

    def read_file(self, path: str, offset: int = 0, limit: int = 200) -> str:
        return cellrun.read_text(self.resolve_in_scope(path), path, offset, limit)
