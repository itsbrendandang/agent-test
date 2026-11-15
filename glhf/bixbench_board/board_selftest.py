#!/usr/bin/env python3
"""board_selftest.py: no-API test of the board solver (bixbase/board.py), the app's board.

Checks, with a scripted model and no tokens spent:
  1. the board is the app's: the Lead Scientist plus the `board:` list of board/config.yaml, each
     member on its model tier; the lead runs rounds with converse (pilot, full, final) and submits
  2. round rules: the scout replies first; round 1 is blind; later rounds carry the digest; the
     scout's data report reaches the others; only the experimenter has run_code; the data is
     read-only for code cells (and an R cell runs when R is installed)
  3. the lead's limits: a bad mode is refused and not counted; past max_rounds only a final round
     runs; after the final round no round runs
  4. budget exhaustion: the lead still submits a forced final answer
  5. run.py refuses to start while NO_PAID_CALLS is not "0"

Run: .venv/bin/python board_selftest.py   (BIXBASE_RSCRIPT=~/renv/bin/Rscript for the R cell)
"""

from __future__ import annotations

import json
import tempfile
import threading
from pathlib import Path
from typing import Any

from selftest import make_study

from bixbase import board
from bixbase.budget import Budget, BudgetCaps
from bixbase.llm import LLMResponse, ToolCall
from bixbase.sandbox import _RSCRIPT

ANSWER = {"selftest-q1": "2.5"}
PY_CELL = (
    "import os, pandas as pd\n"
    "print(pd.read_csv(os.environ['DATA_DIR']+'/values.csv').x.mean())\n"
    "open('notes.txt', 'w').write('kept')\n"
    "try:\n"
    "    open(os.environ['DATA_DIR']+'/hack.txt','w').write('x')\n"
    "    print('WRITE_OK')\n"
    "except OSError:\n"
    "    print('WRITE_DENIED')\n"
    "print('KEY', os.environ.get('OPENAI_API_KEY'))"
)
R_CELL = "x <- read.csv(file.path(Sys.getenv('DATA_DIR'), 'values.csv'))$x\ncat('R mean', mean(x), '\\n')"
LEAD_PLAN = [
    {"name": "converse", "input": {"message": "Scout: inspect the data. Proposer: one claim per "
     "question. Experimenter: pilot.", "modes": {"experimenter": "pilot"}}},
    {"name": "converse", "input": {"message": "Experimenter: full run. Auditor, Critic: review.",
     "modes": {"experimenter": "full"}}},
    {"name": "converse", "input": {"message": "Final positions.", "final": True}},
    {"name": "submit_answer", "input": {"answers": ANSWER}},
]  # fmt: skip


class ScriptedBoardLLM:
    """Answers by member, recognised by its prompt file in the system prompt. The lead follows
    `lead_plan`; a member with tools uses one tool on a new round's input and then replies."""

    provider, model, seed = "fake", "scripted-fake", 0

    def __init__(self, lead_plan: list[dict] | None = None, r_cell: bool = False) -> None:
        self.lead_plan = list(LEAD_PLAN if lead_plan is None else lead_plan)
        self.r_cell = r_cell
        self.lock = threading.Lock()
        self.n = 0
        b = board.load_board()
        self.keys = {a.name: a.prompt[:300] for a in b.roster}
        self.keys[b.lead.name] = b.lead.prompt[:300]
        self.seen: list[str] = []

    def member(self, system: str) -> str:
        for name, key in self.keys.items():
            if system.startswith(key):
                return name
        return "?"

    def chat(self, messages, *, system=None, tools=None, budget, enforce_budget=True):
        if enforce_budget:
            budget.raise_if_exhausted()
        budget.record_usage(10, 20)
        with self.lock:
            self.n += 1
            n = self.n
            member = self.member(system or "")
            self.seen.append(member)
        names = {t["name"] for t in tools or []}
        fresh = isinstance(messages[-1]["content"], str)  # a new round's input, not tool results
        calls: list[dict] = []
        text = ""
        if member == "lead-scientist":
            if names == {"submit_answer"}:
                calls = [{"name": "submit_answer", "input": {"answers": ANSWER}}]
            elif self.lead_plan:
                calls = [self.lead_plan.pop(0)]
            text = "The question is a mean; a supported answer is computed from values.csv."
        elif member in ("scout", "evidence-verifier") and fresh:
            calls = [{"name": "list_dir", "input": {"path": "DATA_DIR"}}]
        elif member == "experimenter" and fresh:
            code = R_CELL if self.r_cell and "(full)" in messages[-1]["content"] else PY_CELL
            lang = "r" if code is R_CELL else "python"
            calls = [{"name": "run_code", "input": {"code": code, "language": lang}}]
        else:
            text = {
                "scout": "values.csv: one column x, 4 rows, nothing missing.",
                "evidence-verifier": "Scout's report: confirmed against values.csv.",
                "experimenter": "selftest-q1: 2.5 (mean of x, computed).",
                "proposer": "Claim selftest-q1: the mean of x in values.csv. Priority 1.",
                "methods-auditor": "[selftest-q1] OK.",
                "critic": "[selftest-q1] Holds: recomputed from the cell output.",
                "reporter": "selftest-q1: 2.5.",
            }.get(member, "No task.")
        tcs = [ToolCall(id=f"c{n}_{j}", name=c["name"], input=c["input"]) for j, c in enumerate(calls)]
        return LLMResponse(text=text, tool_calls=tcs, stop_reason="end_turn",
                           input_tokens=10, output_tokens=20)  # fmt: skip


def events(run_dir: Path) -> list[dict[str, Any]]:
    return [json.loads(ln) for ln in (run_dir / "transcript.jsonl").read_text().splitlines()]


def big_budget() -> Budget:
    return Budget(BudgetCaps(max_total_tokens=500_000, max_tool_calls=90, max_seconds=600))


def test_the_apps_board(tmp: Path) -> None:
    import os

    os.environ["OPENAI_API_KEY"] = "sk-selftest-not-a-key"  # must not reach a cell
    study = make_study(tmp)
    llm = ScriptedBoardLLM(r_cell=bool(_RSCRIPT))
    res = board.solve(study, big_budget(), llm=llm, run_dir=tmp / "full", run_id="selftest/rep0")
    ev = events(tmp / "full")
    start, end = ev[0], ev[-1]
    b = board.load_board()

    # 1. the app's board, each member on its tier
    assert start["members"] == ["lead-scientist", *(a.name for a in b.roster)], start["members"]
    assert len(start["members"]) == 1 + len(b.roster) and start["members"][1] == "scout"
    assert start["member_models"]["critic"] == b.models["rival"]
    assert start["member_models"]["lead-scientist"] == b.models["lead"]
    assert start["member_models"]["scout"] == b.models[b.roster[0].tier]
    assert set(start["prompt_sha256"]) == set(start["members"])
    assert res.answers == ANSWER and res.submitted and not res.forced, res
    assert end["rounds"] == 3 and end["phases"] == ["round 1", "round 2", "round 3 (final)"], end
    starts = [e for e in ev if e["event"] == "round_start"]
    assert [s["modes"] for s in starts] == [{"experimenter": "pilot"}, {"experimenter": "full"}, {}]
    print(f"test 1 OK: the app's board ({len(start['members'])}: lead + board: list), each on its tier; 3 rounds; submitted")

    # 2. round rules
    for r in (1, 2, 3):
        inputs = [e for e in ev if e["event"] == "member_input" and e.get("round") == r and e["member"] != "lead-scientist"]
        replies = [e for e in ev if e["event"] == "member_reply" and e.get("round") == r and e["member"] != "lead-scientist"]
        assert inputs[0]["member"] == "scout", inputs[0]
        scout_done = next(e["t"] for e in replies if e["member"] == "scout")
        assert all(e["t"] >= scout_done for e in inputs if e["member"] != "scout"), "a member started before the scout's report"
        assert len(replies) == len(b.roster), [e["member"] for e in replies]
        others = [e for e in inputs if e["member"] != "scout"]
        assert all("Scout (Data and Evidence)'s data report" in e["content"] for e in others), r
        readers = [a.name for a in b.roster if a.name in board.DATA_READERS]
        for prev, nxt in zip(readers, readers[1:], strict=False):  # readers in order, each after the one before
            done = next(e["t"] for e in replies if e["member"] == prev)
            assert next(e["t"] for e in inputs if e["member"] == nxt) >= done, (prev, nxt)
        last = max(e["t"] for e in replies if e["member"] in readers)
        assert all(e["t"] >= last for e in inputs if e["member"] not in readers), "a member started before the data reports"
        if r == 1:
            assert all("Work independently" in e["content"] for e in inputs)
        else:
            assert all("What the board said last round" in e["content"] for e in inputs)
    tools = [e for e in ev if e["event"] == "tool_call" and e["member"] != "lead-scientist"]
    assert {e["member"] for e in tools if e["name"] == "run_code"} == {"experimenter"}
    assert {e["name"] for e in tools if e["member"] == "scout"} == {"list_dir"}
    assert not {e["name"] for e in tools} - {"run_code", "list_dir", "read_file"}, "a search tool was used"
    cells = [e for e in ev if e["event"] == "tool_result" and e["name"] == "run_code"]
    assert "2.5" in cells[0]["result"] and "WRITE_DENIED" in cells[0]["result"], cells[0]["result"]
    assert "KEY None" in cells[0]["result"] or "sk-selftest" not in cells[0]["result"]
    if _RSCRIPT:
        assert any("R mean 2.5" in c["result"] for c in cells), [c["result"] for c in cells]
    assert not (study.data_dir / "hack.txt").exists()
    print("test 2 OK: data readers first and in order, round 1 blind, digest after, reports shared, "
          f"only the experimenter runs code, data read-only{', R cell ran' if _RSCRIPT else ''}")


def test_the_leads_limits(tmp: Path) -> None:
    study = make_study(tmp)
    b = board.load_board()
    bad = {"name": "converse", "input": {"message": "x", "modes": {"critic": "pilot"}}}
    plain = {"name": "converse", "input": {"message": "Next round."}}
    plan = [bad] + [plain] * (b.max_rounds + 1) + [
        {"name": "converse", "input": {"message": "Final.", "final": True}},
        plain,
        {"name": "submit_answer", "input": {"answers": ANSWER}},
    ]
    llm = ScriptedBoardLLM(lead_plan=plan)
    res = board.solve(study, big_budget(), llm=llm, run_dir=tmp / "limits", board=b)
    ev = events(tmp / "limits")
    results = [e["result"] for e in ev if e["event"] == "tool_result" and e["member"] == "lead-scientist"]
    assert results[0].startswith("Round not run, and not counted") and "critic has no modes" in results[0]
    assert any(r.startswith("WRAP UP") for r in results), results
    assert any(r.startswith("Final positions are in") for r in results), results
    assert ev[-1]["rounds"] == b.max_rounds + 1 and res.submitted, ev[-1]
    print(f"test 3 OK: bad mode refused, wrap-up after {b.max_rounds} rounds, nothing after the final round")


def test_exhaustion(tmp: Path) -> None:
    study = make_study(tmp)
    res = board.solve(study, Budget(BudgetCaps(max_tool_calls=3)), llm=ScriptedBoardLLM(),
                      run_dir=tmp / "exhaust")  # fmt: skip
    assert res.forced and res.answers == ANSWER, res
    print("test 4 OK: exhaustion: a forced final answer:", res.stop_reason)


def test_paid_switch() -> None:
    import os

    import run
    from bixbase.paid import PaidCallsOff

    old = os.environ.get("NO_PAID_CALLS")
    os.environ["NO_PAID_CALLS"] = "1"
    try:
        run.main(["--studies", "bix-1", "--solver", "board"])
    except PaidCallsOff:
        print("test 5 OK: run.py refuses while paid calls are off")
    else:
        raise AssertionError("run.py started with paid calls off")
    finally:
        if old is None:
            os.environ.pop("NO_PAID_CALLS", None)
        else:
            os.environ["NO_PAID_CALLS"] = old


if __name__ == "__main__":
    tmp = Path(tempfile.mkdtemp(prefix="board-selftest-"))
    test_the_apps_board(tmp / "a")
    test_the_leads_limits(tmp / "b")
    test_exhaustion(tmp / "c")
    test_paid_switch()
    print(f"\nall board self-tests passed (artifacts in {tmp})")
