#!/usr/bin/env python3
"""board_selftest.py: no-API test of the board solver (bixbase/board.py).

Checks, with a scripted model and no tokens spent:
  1. full order: proposer -> experimenter (Python + R) -> auditor + critic
     -> experimenter revise -> reporter submit_answer; one shared Budget
  2. the data dir is read-only for code cells
  3. budget exhaustion skips review and still gets a final answer
  4. run.py refuses to start while NO_PAID_CALLS is not "0"

Run: BIXBASE_RSCRIPT=~/renv/bin/Rscript .venv/bin/python board_selftest.py
"""

from __future__ import annotations

import json
import tempfile
import threading
from pathlib import Path

from bixbase import board
from bixbase.budget import Budget, BudgetCaps
from bixbase.llm import LLMResponse, ToolCall
from selftest import make_study


class ScriptedBoardLLM:
    """Answers by member, keyed on the system prompt's purpose line."""

    provider, model, seed = "fake", "scripted-fake", 0

    def __init__(self, exp_steps):
        self.exp_steps = list(exp_steps)
        self.lock = threading.Lock()
        self.seen: list[str] = []
        self.n = 0

    def _member(self, system):
        for m, key in [("experimenter", "Run the analysis for each claim"),
                       ("proposer", "Decide how to approach"),
                       ("reporter", "draft the final report"),
                       ("critic", "Check whether the conclusions are true"),
                       ("methods-auditor", "Check that the methods were right")]:
            if key.lower() in system.lower():
                return m
        return "?"

    def chat(self, messages, *, system=None, tools=None, budget,
             enforce_budget=True):
        if enforce_budget:
            budget.raise_if_exhausted()
        budget.record_usage(10, 20)
        with self.lock:
            self.n += 1
            n = self.n
            member = self._member(system or "")
            self.seen.append(member)
            if member == "experimenter":
                step = self.exp_steps.pop(0) if self.exp_steps else {
                    "tool_calls": [{"name": "record_draft",
                                    "input": {"answers": {"selftest-q1": "2.5"}}}]}
            elif member == "reporter":
                step = {"tool_calls": [{"name": "submit_answer",
                                        "input": {"answers": {"selftest-q1": "2.5"}}}]}
            elif member == "critic":
                step = {"text": "[selftest-q1] FLAG: confirm in R.\nFLAGGED: selftest-q1"}
            elif member == "methods-auditor":
                step = {"text": "[selftest-q1] OK\nFLAGGED: none"}
            else:
                step = {"text": "Claim q1: mean of x from values.csv."}
        calls = [ToolCall(id=f"c{n}_{j}", name=c["name"], input=c["input"])
                 for j, c in enumerate(step.get("tool_calls", []))]
        return LLMResponse(text=step.get("text", ""), tool_calls=calls,
                           stop_reason="end_turn", input_tokens=10,
                           output_tokens=20)


def test_full_order(tmp: Path):
    study = make_study(tmp)
    llm = ScriptedBoardLLM([
        {"tool_calls": [{"name": "run_code", "input": {"code": (
            "import os, pandas as pd\n"
            "print(pd.read_csv(os.environ['DATA_DIR']+'/values.csv').x.mean())\n"
            "try:\n"
            "    open(os.environ['DATA_DIR']+'/hack.txt','w').write('x')\n"
            "    print('WRITE_OK')\n"
            "except OSError:\n"
            "    print('WRITE_DENIED')")}}]},
        {"tool_calls": [{"name": "record_draft", "input": {
            "answers": {"selftest-q1": "2.5"},
            "evidence": {"selftest-q1": "pandas mean"}}}]},
        {"tool_calls": [{"name": "run_code", "input": {"language": "r", "code": (
            "x <- read.csv(file.path(Sys.getenv('DATA_DIR'), 'values.csv'))$x\n"
            "cat('R mean', mean(x), '\\n')")}}]},
        {"tool_calls": [{"name": "record_draft", "input": {
            "answers": {"selftest-q1": "2.5"}}}]},
    ])
    budget = Budget(BudgetCaps(max_total_tokens=500_000, max_tool_calls=90,
                               max_seconds=600))
    res = board.solve(study, budget, llm=llm, run_dir=tmp / "full")
    events = [json.loads(ln) for ln in res.transcript.read_text().splitlines()]
    outs = [e["result"] for e in events if e["event"] == "tool_result"
            and e["name"] == "run_code"]
    end = events[-1]
    assert res.answers == {"selftest-q1": "2.5"}, res.answers
    assert res.submitted and not res.forced, res.stop_reason
    assert "WRITE_DENIED" in outs[0] and "2.5" in outs[0], outs[0]
    assert "R mean 2.5" in outs[1], outs[1]
    assert end["phases"] == ["proposer", "experimenter:full", "methods-auditor",
                             "critic", "experimenter:revise", "reporter"], end
    assert not (study.data_dir / "hack.txt").exists()
    assert budget.tool_calls == 5 and budget.model_calls == 8, budget.snapshot()
    print("test 1 OK: board order, Python + R, read-only data, shared budget",
          budget.snapshot()["used"])


def test_exhaustion(tmp: Path):
    study = make_study(tmp)
    llm = ScriptedBoardLLM([{"tool_calls": [{"name": "list_dir",
                                             "input": {"path": "DATA_DIR"}}]}] * 10)
    budget = Budget(BudgetCaps(max_tool_calls=2))
    res = board.solve(study, budget, llm=llm, run_dir=tmp / "exhaust")
    end = json.loads(res.transcript.read_text().splitlines()[-1])
    assert res.forced and res.answers == {"selftest-q1": "2.5"}, res
    assert "methods-auditor" not in end["phases"], end["phases"]
    print("test 2 OK: exhaustion skips review, forced final answer:",
          res.stop_reason)


def test_paid_switch():
    import os

    import run
    from bixbase.paid import PaidCallsOff

    old = os.environ.get("NO_PAID_CALLS")
    os.environ["NO_PAID_CALLS"] = "1"
    try:
        run.main(["--studies", "bix-1", "--solver", "board"])
    except PaidCallsOff:
        print("test 3 OK: run.py refuses while paid calls are off")
    else:
        raise AssertionError("run.py started with paid calls off")
    finally:
        if old is None:
            os.environ.pop("NO_PAID_CALLS", None)
        else:
            os.environ["NO_PAID_CALLS"] = old


if __name__ == "__main__":
    tmp = Path(tempfile.mkdtemp(prefix="board-selftest-"))
    test_full_order(tmp)
    test_exhaustion(tmp)
    test_paid_switch()
    print(f"\nall board self-tests passed (artifacts in {tmp})")
