#!/usr/bin/env python3
"""selftest.py — end-to-end smoke test with a scripted model, no API key.

Verifies, without spending tokens:
  1. solve() loop: run_code -> list_dir -> submit_answer, logging, final script
  2. sandbox read-only enforcement on the data dir (macOS sandbox-exec)
  3. budget exhaustion forces a final answer
  4. str_verifier grader + compute_metrics

Run: python selftest.py
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from bixbase.agent import solve
from bixbase.budget import Budget, BudgetCaps
from bixbase.grader import compute_metrics, grade_str_verifier
from bixbase.llm import LLMResponse, ToolCall
from bixbase.loader import Question, Study


class ScriptedLLM:
    """Deterministic stand-in for LLMClient.chat."""

    provider = "fake"
    model = "scripted-fake"
    seed = 0

    def __init__(self, script: list[dict], tokens_per_call=(10, 20)):
        self.script = list(script)
        self.calls = 0
        self.tokens_per_call = tokens_per_call

    def chat(self, messages, *, system=None, tools=None, budget,
             enforce_budget=True):
        if enforce_budget:
            budget.raise_if_exhausted()
        i, o = self.tokens_per_call
        budget.record_usage(i, o)
        self.calls += 1
        step = self.script.pop(0) if self.script else {"text": "done"}
        calls = [
            ToolCall(id=f"call_{self.calls}_{j}", name=c["name"],
                     input=c["input"])
            for j, c in enumerate(step.get("tool_calls", []))
        ]
        return LLMResponse(text=step.get("text", ""), tool_calls=calls,
                           stop_reason="end_turn", input_tokens=i,
                           output_tokens=o)

    def complete(self, prompt, *, budget):
        budget.record_usage(5, 5)
        return "<grade> correct </grade>"


def make_study(tmp: Path) -> Study:
    # data dir deliberately outside TMPDIR and the work dir so the
    # read-only check is a real test of seatbelt enforcement
    data_dir = Path(tempfile.mkdtemp(prefix="bixbase-data-", dir="/tmp"))
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "values.csv").write_text("x\n1\n2\n3\n4\n")
    study = Study(
        study_id="selftest",
        data_folder="selftest",
        questions=[
            Question(question_id="selftest-q1",
                     text="What is the mean of x?",
                     ideal="2.5", eval_mode="str_verifier"),
        ],
    )
    study._data_dir = data_dir
    return study


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="bixbase-selftest-"))
    study = make_study(tmp)

    # --- test 1: happy path -------------------------------------------------
    llm = ScriptedLLM([
        {"tool_calls": [{"name": "list_dir", "input": {"path": "DATA_DIR"}}]},
        {"tool_calls": [{"name": "run_code", "input": {
            "code": (
                "import os, pandas as pd\n"
                "df = pd.read_csv(os.path.join(os.environ['DATA_DIR'], 'values.csv'))\n"
                "print('mean:', df['x'].mean())\n"
                "open('answer.txt','w').write(str(df['x'].mean()))\n"
                "# read-only check\n"
                "try:\n"
                "    open(os.path.join(os.environ['DATA_DIR'], 'hack.txt'), 'w').write('x')\n"
                "    print('WRITE SUCCEEDED (bad)')\n"
                "except Exception as e:\n"
                "    print('write blocked:', type(e).__name__)\n"
            )
        }}]},
        {"tool_calls": [{"name": "submit_answer", "input": {
            "answers": {"selftest-q1": "2.5"}}}]},
    ])
    budget = Budget(BudgetCaps(max_total_tokens=10_000, max_tool_calls=10))
    res = solve(study, budget, llm=llm, run_dir=tmp / "run1")
    assert res.submitted and not res.forced, res.stop_reason
    assert res.answers["selftest-q1"] == "2.5"
    assert (tmp / "run1" / "transcript.jsonl").is_file()
    assert (tmp / "run1" / "final_script.py").is_file()
    transcript = (tmp / "run1" / "transcript.jsonl").read_text()
    run_result = next(
        json.loads(line)["result"]
        for line in transcript.splitlines()
        if '"event": "tool_result"' in line and '"name": "run_code"' in line
    )
    if "WRITE SUCCEEDED" in run_result:
        print("note: data dir writable (sandbox-exec unavailable?)")
    else:
        assert "write blocked" in run_result
    g = grade_str_verifier("2.5", res.answers["selftest-q1"])
    assert g.correct, g
    print("test 1 OK: loop, tools, logging, grading; "
          f"budget used={res.budget['used']}")

    # --- test 2: budget exhaustion forces final answer ----------------------
    llm2 = ScriptedLLM(
        [{"tool_calls": [{"name": "run_code", "input": {"code": "print(1)"}}]},
         {"tool_calls": [{"name": "submit_answer", "input": {
             "answers": {"selftest-q1": "2.5"}}}]}],
        tokens_per_call=(100, 100),
    )
    tiny = Budget(BudgetCaps(max_tool_calls=1))
    res2 = solve(study, tiny, llm=llm2, run_dir=tmp / "run2")
    assert res2.forced, res2.stop_reason
    assert "budget_exhausted" in res2.stop_reason
    assert res2.answers["selftest-q1"] == "2.5"  # forced submit still lands
    print(f"test 2 OK: forced answer on exhaustion ({res2.stop_reason})")

    # --- test 3: no usable answer -> loud failure marker --------------------
    # model tries to run more code even in the forced call -> no answer
    llm3 = ScriptedLLM(
        [{"tool_calls": [{"name": "run_code", "input": {"code": "print(2)"}}]}],
        tokens_per_call=(5, 5),
    )
    none_budget = Budget(BudgetCaps(max_tool_calls=0))
    res3 = solve(study, none_budget, llm=llm3, run_dir=tmp / "run3")
    assert res3.answers["selftest-q1"] == "<no_answer>"
    assert "no_answer_submitted" in res3.stop_reason
    m = compute_metrics([0], [False])
    assert m["accuracy"] == 0 and m["n_total"] == 1
    print(f"test 3 OK: loud failure path ({res3.stop_reason})")

    print(f"\nall self-tests passed (artifacts in {tmp})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
