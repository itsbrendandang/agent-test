"""Run one code cell, list a folder, read a file: the parts of the sandbox that run where the
code runs. Standard library only, because the same file runs in two places:

  - on the machine, imported by `bixbase/sandbox.py` (the local sandbox);
  - inside a Modal sandbox, uploaded as /opt/bix/cellrun.py and run as a command
    (`python cellrun.py run|ls|read ...`) by `bixbase/modal_sandbox.py`.

A cell runs in its own process group. When the cell ends, or when its time is up, the whole
group is killed: the cell's own process and every process it started. Before this, the
timeout killed only the cell's own process, and its children (R helpers, multiprocessing
workers, a shell pipeline) kept running. They took CPU and memory from every other run on
the machine, and a child that held the cell's output open made a finished cell wait for its
whole timeout.
"""

from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

# Bytes kept of each stream; the sandbox cuts what the model sees much shorter (20,000 chars).
MAX_CAPTURE_BYTES = 4 * 1024 * 1024
# After the group is killed, how long the output readers may take to finish.
DRAIN_SECONDS = 10.0
LEFTOVER_NOTE = "[processes the cell left running were stopped]"


def _reader(stream: Any, sink: bytearray) -> None:
    """Read a stream to its end, keeping at most MAX_CAPTURE_BYTES."""
    try:
        while True:
            chunk = stream.read(65536)
            if not chunk:
                break
            room = MAX_CAPTURE_BYTES - len(sink)
            if room > 0:
                sink.extend(chunk[:room])
    except (OSError, ValueError):
        pass


def _group_alive(pgid: int) -> bool:
    try:
        os.killpg(pgid, 0)
    except (ProcessLookupError, PermissionError):
        return False
    return True


def _kill_group(pgid: int) -> bool:
    """SIGKILL every process of the group. Returns whether any was still alive."""
    if not _group_alive(pgid):
        return False
    try:
        os.killpg(pgid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        return False
    return True


def run_cell(
    argv: list[str], *, cwd: str, env: dict[str, str], timeout_s: float
) -> dict[str, Any]:
    """Run `argv` in its own process group with a time limit. Returns stdout, stderr, the exit
    code (None when killed for time), whether it timed out, the seconds it took, and whether
    processes it left behind were stopped."""
    started = time.monotonic()
    proc = subprocess.Popen(
        argv,
        cwd=cwd,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,  # its own session and process group: pgid == proc.pid
    )
    out, err = bytearray(), bytearray()
    readers = [
        threading.Thread(target=_reader, args=(proc.stdout, out), daemon=True),
        threading.Thread(target=_reader, args=(proc.stderr, err), daemon=True),
    ]
    for reader in readers:
        reader.start()
    timed_out = False
    try:
        proc.wait(timeout=timeout_s)
    except subprocess.TimeoutExpired:
        timed_out = True
    # The cell has ended or its time is up: nothing it started may keep running.
    leftovers = _kill_group(proc.pid)
    proc.wait()
    for reader in readers:
        reader.join(DRAIN_SECONDS)  # a process that left the group could hold a pipe open
    stdout = out.decode("utf-8", "replace")
    stderr = err.decode("utf-8", "replace")
    if timed_out:
        stderr += f"\n[killed after {timeout_s:g}s timeout]"
    elif leftovers:
        stderr += f"\n{LEFTOVER_NOTE}"
    return {
        "stdout": stdout,
        "stderr": stderr,
        "exit_code": None if timed_out else proc.returncode,
        "timed_out": timed_out,
        "duration_s": round(time.monotonic() - started, 3),
        "leftovers_stopped": leftovers and not timed_out,
    }


# --- The work folder and the data folder -----------------------------------------------------


def listing(work_dir: Path, skip: tuple[str, ...] = (".seatbelt.sb",)) -> dict[str, float]:
    """Every file under the work folder with its modification time."""
    return {
        str(p.relative_to(work_dir)): p.stat().st_mtime
        for p in work_dir.rglob("*")
        if p.is_file() and p.name not in skip
    }


def new_files(before: dict[str, float], after: dict[str, float], cell_name: str) -> list[str]:
    return [
        name
        for name in after
        if name != cell_name and (name not in before or after[name] != before[name])
    ]


def resolve_in_scope(path: str, work_dir: Path, data_dir: Path, base: Path | None = None) -> Path:
    """Resolve a model-provided path, confined to the work folder, the data folder or tmp."""
    base = base or work_dir
    p = Path(path)
    if not p.is_absolute():
        if p.parts and p.parts[0] == "DATA_DIR":
            p = data_dir.joinpath(*p.parts[1:])
        elif p.parts and p.parts[0] == "WORK_DIR":
            p = work_dir.joinpath(*p.parts[1:])
        else:
            p = base / p
    p = p.resolve()
    allowed = (work_dir, data_dir, Path(tempfile.gettempdir()).resolve())
    if not any(p == a or a in p.parents for a in allowed):
        raise PermissionError(
            f"path {p} is outside the allowed dirs (WORK_DIR={work_dir}, DATA_DIR={data_dir})"
        )
    return p


def list_text(target: Path, path: str) -> str:
    if not target.is_dir():
        return f"ERROR: {path} is not a directory"
    rows = []
    for p in sorted(target.iterdir()):
        kind = "dir " if p.is_dir() else "file"
        size = "-" if p.is_dir() else str(p.stat().st_size)
        rows.append(f"{kind}\t{size}\t{p.name}")
    header = f"listing of {target}:"
    return header + ("\n" + "\n".join(rows) if rows else "\n(empty)")


MAX_READ_CHARS = 20_000  # same as a cell's output limit (sandbox.MAX_OUTPUT_CHARS)


def read_text(target: Path, path: str, offset: int = 0, limit: int = 200) -> str:
    if not target.is_file():
        return f"ERROR: {path} is not a file"
    try:
        lines = target.read_text(errors="replace").splitlines()
    except OSError as e:
        return f"ERROR: could not read {path}: {e}"
    sliced = lines[offset : offset + limit]
    body = "\n".join(f"{offset + i + 1}\t{line}" for i, line in enumerate(sliced))
    footer = ""
    if offset + limit < len(lines):
        footer = f"\n...[{len(lines) - offset - limit} more lines]"
    if len(body) > MAX_READ_CHARS:  # a few very long lines can still be megabytes
        footer = f"\n...[cut at {MAX_READ_CHARS} of {len(body)} characters; use run_code to read it]" + footer
        body = body[:MAX_READ_CHARS]
    return f"{target} ({len(lines)} lines)\n{body}{footer}"


# --- Inside a Modal sandbox: one command, one JSON line ------------------------------------------


def _remote_run(spec_file: str) -> dict[str, Any]:
    """Write the cell into the work folder and run it. The spec (written by the host) holds the
    code, the interpreter, the folders, the environment and the time limit."""
    spec = json.loads(Path(spec_file).read_text())
    work = Path(spec["work_dir"])
    cell = work / spec["cell_name"]
    before = listing(work)
    cell.write_text(spec["code"])
    result = run_cell(
        [spec["interpreter"], spec["cell_name"]],
        cwd=str(work),
        env=spec["env"],
        timeout_s=float(spec["timeout_s"]),
    )
    result["new_files"] = new_files(before, listing(work), spec["cell_name"])
    return result


def normalize(name: str) -> str:
    """A Python package name as pip compares them."""
    return re.sub(r"[-_.]+", "-", name).lower()


def environment(renv: str) -> dict[str, Any]:
    """What is installed: every conda package of the R environment (file name and md5, from its
    conda-meta records) and every Python distribution of this interpreter."""
    conda = []
    for record in sorted((Path(renv) / "conda-meta").glob("*.json")):
        try:
            meta = json.loads(record.read_text())
        except (OSError, ValueError):
            continue
        name = meta.get("fn") or Path(str(meta.get("url", ""))).name
        conda.append([name, meta.get("md5")])
    from importlib import metadata

    python = {}
    for dist in metadata.distributions():
        name = dist.metadata["Name"]
        if name:
            python[normalize(name)] = dist.version
    return {"conda": conda, "python": python, "python_version": sys.version.split()[0]}


def _remote(argv: list[str]) -> dict[str, Any]:
    command = argv[0]
    if command == "run":
        return {"ok": True, **_remote_run(argv[1])}
    if command == "env":
        return {"ok": True, **environment(argv[1])}
    work = Path(os.environ["WORK_DIR"]).resolve()
    data = Path(os.environ["DATA_DIR"]).resolve()
    try:
        if command == "ls":
            target = resolve_in_scope(argv[1], work, data)
            return {"ok": True, "text": list_text(target, argv[1])}
        if command == "read":
            target = resolve_in_scope(argv[1], work, data)
            return {"ok": True, "text": read_text(target, argv[1], int(argv[2]), int(argv[3]))}
    except PermissionError as error:
        return {"ok": False, "kind": "PermissionError", "error": str(error)}
    return {"ok": False, "kind": "ValueError", "error": f"unknown command {command!r}"}


if __name__ == "__main__":
    print(json.dumps(_remote(sys.argv[1:])))
