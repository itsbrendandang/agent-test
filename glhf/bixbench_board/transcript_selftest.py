#!/usr/bin/env python3
"""transcript_selftest.py: the transcript events a reader (the dashboard) relies on.

The contract is described in docs/proposals/concurrent-board-runs-ui.md. No model, no network.

  1. lines written from 8 threads at once: every line is whole, valid JSON
  2. a board run (local sandbox): run_start names the run, the members and the sandbox; every
     turn and tool line names its member; rounds start and end; every member_input has its
     member_reply; one `cell` per run_code; the experimenter's mode is the lead's
  3. the same board run with its cells on a fake Modal: `where` is "modal"
  4. the single agent: member "agent" on tool lines and cells

Run: .venv/bin/python transcript_selftest.py
"""

from __future__ import annotations

import json
import tempfile
import threading
from pathlib import Path
from typing import Any

from board_selftest import ScriptedBoardLLM
from modal_selftest import session
from selftest import ScriptedLLM, make_study

from bixbase import agent, board
from bixbase.budget import Budget, BudgetCaps
from bixbase.logger import RunLogger
from bixbase.sandbox import Sandbox


def events(run_dir: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in (run_dir / "transcript.jsonl").read_text().splitlines()]


def test_parallel_writes_keep_lines_whole(tmp: Path) -> None:
    logger = RunLogger(tmp / "t1")
    big = "x" * 20_000  # long lines are where interleaving shows

    def write(k: int) -> None:
        for i in range(50):
            logger.log("member_output", member=f"m{k}", content=big, i=i)

    threads = [threading.Thread(target=write, args=(k,)) for k in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    logger.close()
    lines = events(tmp / "t1")
    assert len(lines) == 400 and all(e["content"] == big for e in lines)
    print("test 1 OK: 400 lines from 8 threads, every line whole")


def check_board_contract(run: list[dict[str, Any]], where: str, run_id: str) -> None:
    start = run[0]
    assert start["event"] == "run_start" and start["run"] == run_id, start.get("run")
    members = board.load_board().members
    assert start["members"] == members and start["solver"] == "board"
    assert start["sandbox"]["sandbox"] == where, start["sandbox"]
    assert all("t" in e for e in run)
    for e in run:
        if e["event"] in ("member_input", "member_output", "tool_call", "tool_result", "cell"):
            assert e.get("member") in members, e
    calls = [e for e in run if e["event"] == "tool_call" and e["name"] == "run_code"]
    cells = [e for e in run if e["event"] == "cell"]
    assert calls and [c["id"] for c in calls] == [c["id"] for c in cells], (calls, cells)
    for c in cells:
        assert c["where"] == where and c["language"] in ("python", "r"), c
        assert {"cell", "exit_code", "timed_out", "duration_s", "new_files"} <= set(c), c
    modes = [e.get("mode") for e in run if e["event"] == "member_input" and e["member"] == "experimenter"]
    assert modes == ["pilot", "full", None], modes  # the lead names the mode; none in the final round
    rounds = [e["round"] for e in run if e["event"] == "round_start"]
    assert rounds == [1, 2, 3] and [e["round"] for e in run if e["event"] == "round_end"] == rounds
    for m in members:  # every turn that starts also ends
        starts = [e for e in run if e["event"] == "member_input" and e["member"] == m]
        ends = [e for e in run if e["event"] == "member_reply" and e["member"] == m]
        assert starts and len(starts) == len(ends), (m, len(starts), len(ends))
    assert run[-1]["event"] == "run_end" and run[-1]["phases"]


def test_board_run_local(tmp: Path) -> None:
    study = make_study(tmp / "t2")
    box = Sandbox(study.data_dir, tmp / "t2" / "run" / "work", enforce_readonly=False)
    budget = Budget(BudgetCaps(max_total_tokens=500_000, max_tool_calls=90, max_seconds=600))
    board.solve(study, budget, llm=ScriptedBoardLLM(), run_dir=tmp / "t2" / "run",
                sandbox=box, run_id="selftest/rep0")  # fmt: skip
    check_board_contract(events(tmp / "t2" / "run"), "local", "selftest/rep0")
    print("test 2 OK: board run (local): run, members, sandbox, rounds, turns, cells, modes")


def test_board_run_modal(tmp: Path) -> None:
    s, _ = session(tmp / "t3")
    study = make_study(tmp / "t3")
    box = s.open(study.data_dir, tmp / "t3" / "run" / "work", name="selftest/rep1", seconds=600)
    budget = Budget(BudgetCaps(max_total_tokens=500_000, max_tool_calls=90, max_seconds=600))
    try:
        board.solve(study, budget, llm=ScriptedBoardLLM(),
                    run_dir=tmp / "t3" / "run", sandbox=box, run_id="selftest/rep1")  # fmt: skip
    finally:
        box.close()
    run = events(tmp / "t3" / "run")
    check_board_contract(run, "modal", "selftest/rep1")
    assert run[0]["sandbox"]["sandbox_id"] and run[0]["sandbox"]["environment_check"] == "passed"
    print("test 3 OK: board run (fake Modal): where = modal, sandbox id in run_start")


def test_single_agent(tmp: Path) -> None:
    study = make_study(tmp / "t4")
    llm = ScriptedLLM([
        {"tool_calls": [{"name": "run_code", "input": {"code": "print(1)"}}]},
        {"tool_calls": [{"name": "submit_answer", "input": {"answers": {"selftest-q1": "2.5"}}}]},
    ])  # fmt: skip
    agent.solve(study, Budget(BudgetCaps(max_total_tokens=10_000, max_tool_calls=10)), llm=llm,
                run_dir=tmp / "t4" / "run", run_id="selftest/rep0")  # fmt: skip
    run = events(tmp / "t4" / "run")
    assert run[0]["members"] == ["agent"] and run[0]["run"] == "selftest/rep0"
    tools = [e for e in run if e["event"] in ("tool_call", "tool_result", "cell")]
    assert tools and all(e["member"] == "agent" for e in tools), tools
    assert [e["event"] for e in tools if e.get("name") == "run_code" or e["event"] == "cell"] == [
        "tool_call", "cell", "tool_result"]
    print("test 4 OK: single agent: member 'agent', a cell between call and result")


if __name__ == "__main__":
    tmp = Path(tempfile.mkdtemp(prefix="transcript-selftest-"))
    test_parallel_writes_keep_lines_whole(tmp)
    test_board_run_local(tmp)
    test_board_run_modal(tmp)
    test_single_agent(tmp)
    print("\nall transcript self-tests passed")
