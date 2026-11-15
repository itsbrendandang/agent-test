#!/usr/bin/env python3
"""modal_selftest.py: code cells on Modal (bixbase/modal_sandbox.py), with a fake Modal.

The fake runs every sandbox command on this machine, in folders of its own, so the real cell
runner, data copy, read-only data, environment check, copy-back, ledger and cap all run;
only Modal's API is replaced. No model, no network, nothing billed. Paid calls are turned on
inside these tests only (NO_PAID_CALLS=0), as AGENTS.md allows for fakes.

  1. a whole board run (five members) with its cells on the fake Modal; and run.py's run_one.
     In it: the data is read-only, no key reaches a cell, the work folder comes back
  3. a cell whose time is up is killed with its children; cells at the same time get their own numbers
  4. list_dir and read_file answer as the local sandbox does; paths outside are refused
  5. the runs of one study upload its data once
  6. a sandbox whose packages differ from the pins is refused and terminated
  7. the Modal cap: a run waits for running runs, and is refused when nothing runs
  8. Ctrl+C (abort) terminates every sandbox and starts no new one
  9. paid calls off: no session starts

Run: .venv/bin/python modal_selftest.py
"""

from __future__ import annotations

import contextlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from board_selftest import ScriptedBoardLLM
from selftest import make_study

from bixbase import board, modal_sandbox
from bixbase.budget import Budget, BudgetCaps
from bixbase.modal_sandbox import (
    EnvironmentMismatch,
    Layout,
    ModalCapReached,
    ModalSession,
    SandboxGone,
)
from bixbase.paid import PaidCallsOff
from bixbase.sandbox import Sandbox


@contextlib.contextmanager
def paid(value: str) -> Iterator[None]:
    old = os.environ.get("NO_PAID_CALLS")
    os.environ["NO_PAID_CALLS"] = value
    try:
        yield
    finally:
        if old is None:
            os.environ.pop("NO_PAID_CALLS", None)
        else:
            os.environ["NO_PAID_CALLS"] = old


# --- The fake Modal -------------------------------------------------------------------------------


class Stream:
    def __init__(self, text: str) -> None:
        self.text = text

    def read(self) -> str:
        return self.text


class Proc:
    def __init__(self, done: subprocess.CompletedProcess[str]) -> None:
        self.returncode = done.returncode
        self.stdout, self.stderr = Stream(done.stdout), Stream(done.stderr)

    def wait(self) -> int:
        return self.returncode


class FS:
    def write_text(self, data: str, path: str) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(data)

    def read_bytes(self, path: str) -> bytes:
        return Path(path).read_bytes()


class FakeSandbox:
    count = 0

    def __init__(self) -> None:
        FakeSandbox.count += 1
        self.object_id = f"sb-fake-{FakeSandbox.count}"
        self.alive = True
        self.filesystem = FS()

    def exec(self, *cmd: str, timeout: int | None = None) -> Proc:
        if not self.alive:
            raise RuntimeError("exec on a terminated sandbox")
        return Proc(subprocess.run(list(cmd), capture_output=True, text=True, timeout=timeout))

    def terminate(self) -> None:
        self.alive = False


class FakeModal:
    def __init__(self, root: Path) -> None:
        self.volume = root / "volume"
        self.volume.mkdir(parents=True)
        self.uploaded: list[str] = []
        self.created: list[dict[str, Any]] = []
        self.sandboxes: list[FakeSandbox] = []
        self.lock = threading.Lock()

    def read(self, path: str) -> bytes | None:
        target = self.volume / path.lstrip("/")
        return target.read_bytes() if target.is_file() else None

    def upload(self, files: list[tuple[Path, str]]) -> None:
        for local, remote in files:
            target = self.volume / remote.lstrip("/")
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(local, target)
            with self.lock:
                self.uploaded.append(remote)

    def upload_bytes(self, data: bytes, remote: str) -> None:
        target = self.volume / remote.lstrip("/")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def create(self, *, mount: str, sub_path: str, **kwargs: Any) -> FakeSandbox:
        shutil.copytree(self.volume / sub_path.lstrip("/"), mount)  # the mounted Volume
        sandbox = FakeSandbox()
        with self.lock:
            self.created.append({"mount": mount, "sub_path": sub_path, **kwargs})
            self.sandboxes.append(sandbox)
        return sandbox

    def image_id(self) -> str:
        return "im-fake"


def fake_renv(root: Path, change_one: bool = False) -> Path:
    """conda-meta records for every package of the real lock (one md5 changed on request)."""
    renv = root / ("renv-changed" if change_one else "renv")
    meta = renv / "conda-meta"
    meta.mkdir(parents=True)
    for i, (name, md5) in enumerate(modal_sandbox.expected_conda().items()):
        if change_one and i == 0:
            md5 = "0" * 32
        (meta / f"{name}.json").write_text(json.dumps({"fn": name, "md5": md5}))
    return renv


def session(root: Path, *, renv: Path | None = None, **kwargs: Any) -> tuple[ModalSession, FakeModal]:
    api = FakeModal(root)
    renv = renv or fake_renv(root)

    made_count = iter(range(1, 10_000))

    def layout(name: str) -> Layout:
        # A fresh set of folders for every sandbox, as a new Modal sandbox starts empty.
        base = root / "sandboxes" / f"{name.replace('/', '__')}-{next(made_count)}"
        return Layout(
            data=str(base / "data"), work=str(base / "work"), mount=str(base / "mnt"),
            helper=str(base / "opt" / "cellrun.py"), specs=str(base / "tmp"),
            python=sys.executable, rscript=None, renv=str(renv), user=None,
        )  # fmt: skip

    with paid("0"):
        made = ModalSession(root / "out", api=api, layout=layout, **kwargs)
    return made, api


def _gone(pid: int, seconds: float = 5.0) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True
        time.sleep(0.1)
    return False


def _python_steps() -> list[dict[str, Any]]:
    """The board self-test's experimenter steps, with the R cell in Python (no R here)."""
    return [
        {"tool_calls": [{"name": "run_code", "input": {"code": (
            "import os, pandas as pd\n"
            "print(pd.read_csv(os.environ['DATA_DIR']+'/values.csv').x.mean())\n"
            "open('notes.txt', 'w').write('kept')\n"
            "try:\n"
            "    open(os.environ['DATA_DIR']+'/hack.txt','w').write('x')\n"
            "    print('WRITE_OK')\n"
            "except OSError:\n"
            "    print('WRITE_DENIED')\n"
            "print('KEY', os.environ.get('OPENAI_API_KEY'))")}}]},
        {"tool_calls": [{"name": "record_draft", "input": {
            "answers": {"selftest-q1": "2.5"}, "evidence": {"selftest-q1": "pandas mean"}}}]},
        {"tool_calls": [{"name": "run_code", "input": {"code": "print('revise', 2.5)"}}]},
        {"tool_calls": [{"name": "record_draft", "input": {"answers": {"selftest-q1": "2.5"}}}]},
    ]  # fmt: skip


# --- The tests ------------------------------------------------------------------------------------


def test_a_board_run_on_modal(tmp: Path) -> None:
    os.environ["OPENAI_API_KEY"] = "sk-selftest-not-a-key"  # must not reach a cell
    s, api = session(tmp / "t1")
    study = make_study(tmp / "t1")
    box = s.open(study.data_dir, tmp / "t1" / "run" / "work", name="selftest/rep0", seconds=600)
    budget = Budget(BudgetCaps(max_total_tokens=500_000, max_tool_calls=90, max_seconds=600))
    try:
        res = board.solve(study, budget, llm=ScriptedBoardLLM(_python_steps()),
                          run_dir=tmp / "t1" / "run", sandbox=box)  # fmt: skip
    finally:
        line = box.close()
    events = [json.loads(ln) for ln in res.transcript.read_text().splitlines()]
    outs = [e["result"] for e in events if e["event"] == "tool_result" and e["name"] == "run_code"]
    assert res.answers == {"selftest-q1": "2.5"} and res.submitted, res
    assert "2.5" in outs[0] and "WRITE_DENIED" in outs[0], outs[0]
    assert "KEY None" in outs[0], "an API key reached a code cell"
    assert events[-1]["phases"] == ["proposer", "experimenter:full", "methods-auditor",
                                    "critic", "experimenter:revise", "reporter"], events[-1]
    assert (tmp / "t1" / "run" / "work" / "notes.txt").read_text() == "kept"  # copied back
    assert line["ok"] and line["environment_check"] == "passed" and line["usd"] >= 0, line
    assert api.sandboxes[0].alive is False and not s._held and not s._live
    created = api.created[0]
    assert created["cpu"] == 2.0 and created["timeout"] == 600 + modal_sandbox.SETUP_SECONDS
    print("test 1 OK: a board run (5 members) with its cells on Modal; data read-only, "
          "no key in cells, work folder copied back")

    # run.py's run_one, with the same fake session.
    import run

    args = run.parse_args(["--solver", "board", "--no-grade", "--budget-seconds", "600",
                           "--budget-tokens", "500000", "--sandbox", "modal"])  # fmt: skip
    old_llm, old_prepare = run.LLMClient, run.prepare_study_data
    run.LLMClient = lambda **kw: ScriptedBoardLLM(_python_steps())  # type: ignore[assignment]
    run.prepare_study_data = lambda study, cache: None  # type: ignore[assignment]
    try:
        row = run.run_one(study, 0, args, tmp / "t1" / "runs", s)
    finally:
        run.LLMClient, run.prepare_study_data = old_llm, old_prepare
    assert row["sandbox"]["sandbox"] == "modal" and row["sandbox"]["network"] == "blocked"
    assert row["sandbox"]["environment_check"] == "passed" and row["answers"]
    assert json.loads((tmp / "t1" / "runs" / "selftest" / "rep0" / "result.json").read_text())
    print("test 1 OK: run.py run_one opens and closes one Modal sandbox per run")


def test_timeout_kills_the_cell_and_its_children(tmp: Path) -> None:
    s, _ = session(tmp / "t3")
    study = make_study(tmp / "t3")
    box = s.open(study.data_dir, tmp / "t3" / "work", name="t3", seconds=60)
    try:
        started = time.monotonic()
        res = box.run_code(
            "import subprocess, sys, time\n"
            "c = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\n"
            "open('child.pid', 'w').write(str(c.pid))\n"
            "time.sleep(60)\n",
            timeout_s=2,
        )
        took = time.monotonic() - started
        pid = int((Path(box.layout.work) / "child.pid").read_text())
    finally:
        box.close()
    assert res.timed_out and res.exit_code is None and took < 15, (res, took)
    assert _gone(pid), "the cell's child is still running"
    print(f"test 3 OK: a cell over its time is killed with its child ({took:.1f} s)")


def test_cells_at_the_same_time_on_modal(tmp: Path) -> None:
    s, _ = session(tmp / "t3b")
    study = make_study(tmp / "t3b")
    box = s.open(study.data_dir, tmp / "t3b" / "work", name="t3b", seconds=60)
    results: list[Any] = []
    try:
        threads = [threading.Thread(target=lambda k=k: results.append(box.run_code(
            f"import time; time.sleep(0.5); print('cell', {k})", timeout_s=30)))
            for k in range(6)]  # fmt: skip
        for t in threads:
            t.start()
        for t in threads:
            t.join()
    finally:
        box.close()
    assert len({r.cell_index for r in results}) == 6, [r.cell_index for r in results]
    assert sorted(r.stdout.strip() for r in results) == [f"cell {k}" for k in range(6)]
    print("test 3 OK: 6 cells at once in one sandbox, 6 numbers, 6 outputs")


def test_list_and_read_answer_as_the_local_sandbox(tmp: Path) -> None:
    s, _ = session(tmp / "t4")
    study = make_study(tmp / "t4")
    (study.data_dir / "sub").mkdir()
    (study.data_dir / "sub" / "a.txt").write_text("one\ntwo\nthree\n")
    box = s.open(study.data_dir, tmp / "t4" / "work", name="t4", seconds=60)
    local = Sandbox(study.data_dir, tmp / "t4" / "local-work", enforce_readonly=False)
    try:
        for call in (lambda b: b.list_dir("DATA_DIR"), lambda b: b.read_file("DATA_DIR/sub/a.txt", 1, 1),
                     lambda b: b.list_dir("."), lambda b: b.read_file("DATA_DIR/missing.txt")):  # fmt: skip
            ours, theirs = call(box), call(local)
            ours = ours.replace(str(Path(box.layout.data).resolve()), "<data>").replace(
                str(Path(box.layout.work).resolve()), "<work>")
            theirs = theirs.replace(str(local.data_dir), "<data>").replace(
                str(local.work_dir), "<work>")
            assert ours == theirs, (ours, theirs)
        for bad in ("/etc/passwd", "DATA_DIR/" + "../" * 30 + "etc/passwd"):
            try:
                box.read_file(bad)
            except PermissionError:
                continue
            raise AssertionError(f"{bad} was not refused")
    finally:
        box.close()
    print("test 4 OK: list_dir and read_file answer as the local sandbox; outside paths refused")


def test_the_runs_of_one_study_upload_its_data_once(tmp: Path) -> None:
    s, api = session(tmp / "t5", usd_cap=None)
    study = make_study(tmp / "t5")
    boxes: list[Any] = []

    def one(k: int) -> None:
        boxes.append(s.open(study.data_dir, tmp / "t5" / f"w{k}", name=f"t5/rep{k}", seconds=60))

    threads = [threading.Thread(target=one, args=(k,)) for k in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    for b in boxes:
        b.close()
    assert len(boxes) == 3 and len(api.created) == 3
    assert len(api.uploaded) == 1, api.uploaded  # values.csv, once
    assert len({c["sub_path"] for c in api.created}) == 1
    print("test 5 OK: three runs of one study, one upload")


def test_other_packages_are_refused(tmp: Path) -> None:
    s, api = session(tmp / "t6", renv=fake_renv(tmp / "t6", change_one=True))
    study = make_study(tmp / "t6")
    try:
        s.open(study.data_dir, tmp / "t6" / "work", name="t6", seconds=60)
    except EnvironmentMismatch as error:
        assert "another md5" in str(error), error
    else:
        raise AssertionError("a sandbox with other packages was used")
    line = json.loads(s.ledger.read_text().splitlines()[-1])
    assert api.sandboxes[0].alive is False and not s._held
    assert line["ok"] is False and line["environment_check"] == "failed", line
    problems = modal_sandbox.environment_problems(
        {"conda": [], "python": {"pandas": "0.0"}, "python_version": "3.12.1"})
    assert len(problems) == 3, problems  # R packages missing, Python pins, Python version
    print("test 6 OK: other packages: refused, terminated, recorded")


def test_the_cap_waits_then_refuses(tmp: Path) -> None:
    # One run's worst case with 2 cores, 8 GiB, 60 s + setup: about 0.127 USD.
    s, _ = session(tmp / "t7", usd_cap=0.2)
    study = make_study(tmp / "t7")
    first = s.open(study.data_dir, tmp / "t7" / "w1", name="t7/a", seconds=60)
    opened: list[Any] = []
    waiter = threading.Thread(target=lambda: opened.append(
        s.open(study.data_dir, tmp / "t7" / "w2", name="t7/b", seconds=60)))
    waiter.start()
    time.sleep(1.0)
    assert not opened, "the second run started although the cap holds only one"
    first.close()
    waiter.join(15)
    assert opened, "the second run did not start after the first ended"
    opened[0].close()
    tight, _ = session(tmp / "t7b", usd_cap=0.1)
    try:
        tight.open(study.data_dir, tmp / "t7b" / "w", name="t7/c", seconds=60)
    except ModalCapReached as error:
        assert "--modal-usd-cap" in str(error)
    else:
        raise AssertionError("a run over the cap started")
    print("test 7 OK: a run waits for the cap, and is refused when nothing runs")


def test_abort_terminates_everything(tmp: Path) -> None:
    s, api = session(tmp / "t8", usd_cap=None)
    study = make_study(tmp / "t8")
    box = s.open(study.data_dir, tmp / "t8" / "w", name="t8", seconds=60)
    ended = s.abort()
    assert ended == [box.sandbox.object_id] and api.sandboxes[0].alive is False
    try:
        s.open(study.data_dir, tmp / "t8" / "w2", name="t8b", seconds=60)
    except SandboxGone:
        pass
    else:
        raise AssertionError("a sandbox started after abort")
    try:
        box.run_code("print(1)")
    except SandboxGone:
        pass
    else:
        raise AssertionError("a terminated sandbox ran a cell")
    box.close()
    print("test 8 OK: abort ends every sandbox and starts no new one")


def test_paid_calls_off(tmp: Path) -> None:
    with paid("1"):
        try:
            ModalSession(tmp / "t9", api=FakeModal(tmp / "t9"))
        except PaidCallsOff:
            pass
        else:
            raise AssertionError("a Modal session started with paid calls off")
        for command in (["build"], ["verify"], ["list"], ["terminate"]):
            try:
                modal_sandbox.main(command)
            except PaidCallsOff:
                continue
            raise AssertionError(f"modal_sandbox {command} ran with paid calls off")
    print("test 9 OK: with paid calls off, no session and no command starts")


if __name__ == "__main__":
    tmp = Path(tempfile.mkdtemp(prefix="modal-selftest-"))
    test_a_board_run_on_modal(tmp)
    test_timeout_kills_the_cell_and_its_children(tmp)
    test_cells_at_the_same_time_on_modal(tmp)
    test_list_and_read_answer_as_the_local_sandbox(tmp)
    test_the_runs_of_one_study_upload_its_data_once(tmp)
    test_other_packages_are_refused(tmp)
    test_the_cap_waits_then_refuses(tmp)
    test_abort_terminates_everything(tmp)
    test_paid_calls_off(tmp)
    print(f"\nall Modal self-tests passed (fake Modal; artifacts in {tmp})")
