#!/usr/bin/env python3
"""sandbox_selftest.py: nothing a code cell starts outlives the cell. No model, no network.

  1. a cell whose time is up: the cell and its child are killed at the limit
  2. a cell that ends but leaves a child holding its output open: it returns at once (not
     after its whole timeout) and the child is stopped
  3. an ordinary cell: output, exit code and new files as before

Each check runs with and without the read-only wrapper (bubblewrap on Linux, sandbox-exec on
macOS) when that wrapper is installed.

Run: .venv/bin/python sandbox_selftest.py
"""

from __future__ import annotations

import os
import tempfile
import time
from pathlib import Path

from bixbase import cellrun
from bixbase.sandbox import Sandbox

CHILD = (
    "import subprocess, sys, time\n"
    "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\n"
    "open('child.pid', 'w').write(str(child.pid))\n"
)


def _gone(pid: int, seconds: float = 5.0) -> bool:
    """The process no longer exists (a killed orphan is reaped by init within moments)."""
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True
        except PermissionError:
            return False
        time.sleep(0.1)
    return False


def _boxes(tmp: Path) -> list[tuple[str, Sandbox]]:
    data = tmp / "data"
    data.mkdir(exist_ok=True)
    boxes = [("plain", Sandbox(data, tmp / "work-plain", enforce_readonly=False))]
    guarded = Sandbox(data, tmp / "work-guarded", enforce_readonly=True)
    if guarded.use_bwrap or guarded.use_sandbox_exec:
        boxes.append(("read-only wrapper", guarded))
    return boxes


def test_timeout_kills_the_cell_and_its_children(tmp: Path) -> None:
    for label, box in _boxes(tmp):
        started = time.monotonic()
        res = box.run_code(CHILD + "time.sleep(60)\n", timeout_s=2)
        took = time.monotonic() - started
        pid = int((box.work_dir / "child.pid").read_text())
        assert res.timed_out and res.exit_code is None, res
        assert took < 2 + cellrun.DRAIN_SECONDS, f"{label}: took {took:.1f} s"
        assert _gone(pid), f"{label}: the cell's child {pid} is still running"
        print(f"test 1 OK ({label}): killed at {took:.1f} s for a 2 s limit, child stopped")


def test_a_finished_cell_returns_at_once_and_its_children_stop(tmp: Path) -> None:
    for label, box in _boxes(tmp):
        started = time.monotonic()
        res = box.run_code(CHILD + "print('done')\n", timeout_s=30)
        took = time.monotonic() - started
        pid = int((box.work_dir / "child.pid").read_text())
        assert not res.timed_out and res.exit_code == 0, res
        assert "done" in res.stdout and cellrun.LEFTOVER_NOTE in res.stderr, res
        assert took < 10, f"{label}: a finished cell took {took:.1f} s (waited for its child)"
        assert _gone(pid), f"{label}: the cell's child {pid} is still running"
        print(f"test 2 OK ({label}): returned in {took:.1f} s, child stopped")


def test_an_ordinary_cell_is_unchanged(tmp: Path) -> None:
    for label, box in _boxes(tmp):
        res = box.run_code("open('out.txt', 'w').write('x')\nprint(6 * 7)\n", timeout_s=30)
        assert res.exit_code == 0 and not res.timed_out, res
        assert res.stdout.strip() == "42" and cellrun.LEFTOVER_NOTE not in res.stderr, res
        assert "out.txt" in res.new_files, res.new_files
        bad = box.run_code("raise SystemExit(3)\n", timeout_s=30)
        assert bad.exit_code == 3 and "ERROR: exited with code 3" in bad.tool_result_text()
        print(f"test 3 OK ({label}): output, exit codes and new files as before")


if __name__ == "__main__":
    tmp = Path(tempfile.mkdtemp(prefix="sandbox-selftest-"))
    test_timeout_kills_the_cell_and_its_children(tmp)
    test_a_finished_cell_returns_at_once_and_its_children_stop(tmp)
    test_an_ordinary_cell_is_unchanged(tmp)
    print("\nall sandbox self-tests passed")
