"""The swarm's rules that are plain code: the token plan, the critic's prompt, the method
comparison, what the reconciler is shown and how its own derivation is applied. No Docker and
no model. Each test fails if the rule it names is removed. The end-to-end versions, with a
scripted model in a real sandbox, are in test_swarm_e2e.py."""

from __future__ import annotations

from pathlib import Path

import pytest
from conftest import Synthetic
from inspect_ai.model import ChatMessageAssistant, ChatMessageTool, ChatMessageUser
from inspect_ai.tool import ToolCall

from bixbench_v1 import roles
from bixbench_v1.answers import AnswerLedger
from bixbench_v1.runner import run_capsule
from bixbench_v1.solvers import (
    SWARM_BUDGET_ENV,
    BudgetError,
    BudgetPolicy,
    Check,
    CrossCheck,
    Execution,
    assert_blind_prompt,
    critic_prompt,
    evidence_for,
    executions,
    final_answers,
    method_similarity,
    plan_budget,
    printed_matches,
    question_records,
    review_text,
    swarm_budget_mode,
    work_log,
)
from bixbench_v1.task import backstop_tokens, bixbench_v1, swarm_total_tokens

A_METHOD = "data=AE.csv AESEV, DM.csv; subset=patients with a COVID AE; procedure=ordered logit of max AESEV on BCG, MH count, patients_seen; tool=statsmodels.OrderedModel"
B_SAME = "data=AE.csv AESEV and DM.csv; subset=patients with COVID AE (n=151); procedure=ordered logit, max AESEV per patient ~ BCG + MH count + patients_seen; tool=statsmodels OrderedModel"
B_OTHER = "data=MH.xlsx sheet 1; subset=all 1000 randomised participants; procedure=cumulative link model on AEHS with treatment by history interaction; tool=R MASS::polr"


def ledger(*questions: str) -> AnswerLedger:
    return AnswerLedger({q: f"text of {q}" for q in questions or ("q1", "q2")}, "glhf")


# A. Budget ------------------------------------------------------------------------------------
def test_the_analyst_gets_at_least_its_floor_and_not_a_fixed_fraction() -> None:
    # Pilot 1, bix-2: 2 questions, 320,000 tokens; the analyst got 42% = 134,400 and was cut
    # off with no answer, on a capsule where one full analysis took about 151,000.
    plan = plan_budget(320_000, 2, "equal")
    floors = BudgetPolicy().floors(2)
    assert plan.allowance("analyst", 0) == 320_000 - floors["critic"] - floors["reconciler"]
    assert plan.allowance("analyst", 0) >= floors["analyst"] > 0
    assert plan.allowance("analyst", 0) > 0.42 * 320_000
    # The floor grows with the number of questions.
    assert BudgetPolicy().floors(4)["analyst"] > floors["analyst"]
    # Extended: the analyst gets exactly what the single agent gets for the capsule.
    assert plan_budget(320_000, 2, "extended").allowance("analyst", 0) == 320_000


def test_unused_budget_rolls_forward_to_the_later_roles() -> None:
    plan = plan_budget(320_000, 2, "equal")
    floors = plan.floors
    frugal, heavy = 40_000, plan.allowance("analyst", 0)
    # What the analyst did not use goes to the critic; only the reconciler's floor is held back.
    assert plan.allowance("critic", frugal) == 320_000 - frugal - floors["reconciler"]
    assert plan.allowance("critic", frugal) - plan.allowance("critic", heavy) == heavy - frugal
    # And what both left goes to the reconciler.
    assert plan.allowance("reconciler", 90_000) == 230_000
    # A later role never drops under its floor, even if an earlier one ran over by a call.
    assert plan.allowance("critic", 300_000) == floors["critic"]
    assert plan.allowance("reconciler", 330_000) == floors["reconciler"]


def test_a_budget_that_cannot_hold_the_floors_is_refused_up_front(
    synthetic: Synthetic, tmp_path: Path
) -> None:
    need = sum(BudgetPolicy().floors(3).values())
    with pytest.raises(BudgetError, match="cannot cover the role floors for 3 question"):
        plan_budget(need - 1, 3, "equal")
    assert plan_budget(need, 3, "equal").total == need
    # The task refuses before a sandbox exists...
    questions = [{"question_id": "q1", "question": "?", "options": None}]
    with pytest.raises(BudgetError):
        bixbench_v1(questions=questions, sample_id="s", solver="glhf", max_tokens=50_000)
    bixbench_v1(questions=questions, sample_id="s", solver="single", max_tokens=50_000)
    # ...and so does the runner: before staging, before run.json, with no container or model.
    out = tmp_path / "run"
    with pytest.raises(BudgetError, match="Raise the run's token budget to at least"):
        run_capsule(
            synthetic.capsule,
            hub_dir=synthetic.hub,
            staged_root=synthetic.staged,
            out_dir=out,
            solver="glhf",
            model="mock",
            max_tokens=need - 1,
        )
    assert not (out / "run.json").exists() and not synthetic.staged.exists()


def test_the_equal_budget_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(SWARM_BUDGET_ENV, raising=False)
    equal, extended = plan_budget(400_000, 2, "equal"), plan_budget(400_000, 2, "extended")
    # Equal: the swarm's total is the single agent's budget, and the result reads "same budget".
    assert (equal.total, equal.single_budget, equal.reading) == (400_000, 400_000, "same budget")
    assert sum(equal.allowance(p, 0) for p in ("analyst",)) < 400_000
    worst = equal.allowance("analyst", 0)
    assert worst + equal.allowance("critic", worst) + equal.floors["reconciler"] == 400_000
    # Extended: more than the single agent gets, and the result says so.
    assert extended.total == 900_000 and extended.reading == "more budget"
    assert extended.describe()["single_budget_tokens"] == 400_000
    # The default is equal; the flag is an argument or the environment variable.
    assert swarm_budget_mode() == "equal" and swarm_total_tokens(400_000) == 400_000
    assert backstop_tokens(400_000) == 500_000
    monkeypatch.setenv(SWARM_BUDGET_ENV, "extended")
    assert swarm_budget_mode() == "extended" and swarm_budget_mode("equal") == "equal"
    # The command line's cap check asks for the worst case without naming a solver: it must
    # cover an extended swarm, while the single agent's own backstop is unchanged.
    assert backstop_tokens(400_000) == int(900_000 * 1.25)
    assert backstop_tokens(400_000, "single") == 500_000
    with pytest.raises(ValueError):
        swarm_budget_mode("double")


# B. Independence ------------------------------------------------------------------------------
def test_the_critic_prompt_holds_nothing_of_the_analyst() -> None:
    book, cross = ledger(), CrossCheck()
    book.submit(
        "q1", "ANSWER-166", "ROUTE count rows of res.csv", "EVIDENCE a.py line 3", "analyst"
    )
    cross.methods[("analyst", "q1")] = A_METHOD
    brief = "## Question q1\ntext of q1\n"
    prompt = critic_prompt(brief, "\n\nYour budget: 5 minutes.")
    assert_blind_prompt(prompt, book, cross, brief)  # the real prompt passes
    for leaked in ("ROUTE count rows of res.csv", "EVIDENCE a.py line 3", A_METHOD, "ANSWER-166"):
        with pytest.raises(RuntimeError, match="analyst produced"):
            assert_blind_prompt(
                f"{prompt}\nRoute of the first derivation: {leaked}", book, cross, brief
            )
    with pytest.raises(RuntimeError):
        assert_blind_prompt(prompt + f"\nsee {roles.HOME_A}/work", book, cross, brief)
    # The critic's standing instructions name no analyst path and promise no hint.
    for text in (roles.CRITIC, roles.METHOD_LINE):
        assert roles.HOME_A not in text and "route of the first" not in text.lower()


def test_same_method_is_decided_from_the_two_method_lines() -> None:
    assert (method_similarity(A_METHOD, B_SAME) or 0) >= 0.5
    assert (method_similarity(A_METHOD, B_OTHER) or 1) < 0.5
    assert method_similarity(A_METHOD, "") is None
    book, cross = ledger(), CrossCheck()
    for q in ("q1", "q2"):
        book.submit(q, "1.04", "r", "e", "analyst")
        book.submit(q, "1.04", "r", "e", "critic")
        cross.methods[("analyst", q)] = A_METHOD
    cross.methods[("critic", "q1")] = B_SAME
    cross.methods[("critic", "q2")] = B_OTHER
    assert cross.same_method(book, "q1") is True and cross.same_method(book, "q2") is False
    assert cross.weak_agreement(book, "q1") and not cross.weak_agreement(book, "q2")
    answers = final_answers(book, cross)["answers"]
    # Both are "replicated" for the ledger; the same-method one is flagged as weaker.
    assert answers["q1"]["status"] == answers["q2"]["status"] == "replicated"
    assert (
        "same-method agreement: weaker evidence, not independently checked" in answers["q1"]["note"]
    )
    assert answers["q2"]["note"] == ""
    rows = {r["question_id"]: r for r in question_records(book, cross)}
    assert rows["q1"]["agreed"] and rows["q1"]["same_method"] is True
    assert rows["q2"]["agreed"] and rows["q2"]["same_method"] is False
    assert rows["q1"]["reconciler_answer"] is None and rows["q1"]["reconciler_changed"] is False
    # The reconciler is told which agreements are not independent, and to check those.
    text = review_text(book, cross)
    assert "## 2. Agreements that are not independent" in text and "### q1" in text
    assert (
        text.index("### q1")
        < text.index("## 3. Agreements by different methods")
        < text.index("### q2")
    )


def test_an_overturned_same_method_agreement_reports_the_reconcilers_value() -> None:
    book, cross = ledger(), CrossCheck()
    for q in ("q1", "q2"):
        book.submit(q, "5", "r", "e", "analyst")
        book.submit(q, "5", "r", "e", "critic")
        cross.methods[("analyst", q)] = A_METHOD
        cross.methods[("critic", q)] = B_SAME
    cross.checks["q1"] = Check(
        "q1", "/root/reconcile/a.py", "4", "4", "overturned", "header row", True
    )
    cross.checks["q2"] = Check("q2", "/root/reconcile/b.py", "5", "5", "confirmed", "none", True)
    answers = final_answers(book, cross)["answers"]
    assert (answers["q1"]["answer"], answers["q1"]["status"]) == ("4", "reconciled")
    assert "header row" in answers["q1"]["note"]
    assert (answers["q2"]["answer"], answers["q2"]["status"]) == ("5", "replicated")
    assert "confirmed by the reconciler's own derivation" in answers["q2"]["note"]
    rows = {r["question_id"]: r for r in question_records(book, cross)}
    assert rows["q1"]["reconciler_changed"] is True and rows["q1"]["final_answer"] == "4"
    assert rows["q2"]["reconciler_changed"] is False and rows["q2"]["reconciler_answer"] == "5"
    for name in (
        "analyst_answer",
        "critic_answer",
        "agreed",
        "same_method",
        "reconciler_answer",
        "reconciler_changed",
    ):
        assert name in rows["q1"]


def _transcript() -> list:  # type: ignore[type-arg]
    def ran(i: int, tool: str, **arguments: object) -> ChatMessageAssistant:
        return ChatMessageAssistant(
            content="PERSUASIVE PROSE: I am certain.",
            tool_calls=[ToolCall(id=f"c{i}", function=tool, arguments=dict(arguments))],
        )

    return [
        ChatMessageUser(content="task"),
        ran(1, "bash_session", action="type_submit", input="ls /data"),
        ChatMessageTool(content="counts.csv", tool_call_id="c1"),
        ran(2, "python", code="print(df.a.sum())"),
        ChatMessageTool(content="total 166 genes", tool_call_id="c2"),
        ran(3, "python", code="print(df.b.mean())"),
        ChatMessageTool(content="mean 3.0", tool_call_id="c3"),
        ran(4, "submit_answer", question_id="q1", answer="166", method="m"),
        ChatMessageTool(content="ok", tool_call_id="c4"),
        ran(5, "python", code="print('later')"),
        ChatMessageTool(content="later", tool_call_id="c5"),
    ]


def test_the_reconciler_is_shown_commands_and_outputs_not_prose() -> None:
    found, submitted = executions(_transcript(), "A")
    assert [e.id for e in found] == ["A1", "A2", "A3", "A4"] and submitted == {"q1": 3}
    # The commands behind an answer: the last ones before it, and the one that printed it.
    assert [e.id for e in evidence_for(found[:3], "166", keep=1)] == ["A2", "A3"]
    book, cross = ledger(), CrossCheck()
    book.submit("q1", "166", "ROUTE PROSE trust me", "EVIDENCE PROSE obviously right", "analyst")
    book.submit("q1", "167", "ROUTE PROSE other", "EVIDENCE PROSE other", "critic")
    cross.methods[("analyst", "q1")] = A_METHOD
    cross.evidence[("analyst", "q1")] = evidence_for(found[:3], "166")
    cross.evidence[("critic", "q1")] = [Execution("B1", "python", "print(len(df))", "167")]
    text = review_text(book, cross)
    assert "## 1. Disagreements: re-derive every one" in text
    assert "print(df.a.sum())" in text and "total 166 genes" in text and "print(len(df))" in text
    assert "A ran: A2, A3" in text and A_METHOD in text
    assert "PROSE" not in text and "later" not in text
    # The forced final turn works from the same log, clipped.
    log = work_log(_transcript())
    assert "print(df.a.sum())" in log and "total 166 genes" in log and len(log) < 30_000


def test_the_recorded_value_must_be_what_the_reconcilers_script_printed() -> None:
    assert printed_matches("4", "4") and printed_matches("1.07", "1.0713")
    assert printed_matches("18", "17.96") and printed_matches("CDKN1A", "top gene: CDKN1A")
    assert not printed_matches("5", "4") and not printed_matches("1.07", "1.25")
    assert not printed_matches("4", "") and not printed_matches("TP53", "top gene: CDKN1A")
