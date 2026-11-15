"""The swarm's rules end to end: a scripted model in a real Docker sandbox, no paid call.
Each test fails if the rule it names is removed. Skipped when Docker is not running."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from conftest import Synthetic, docker_running
from inspect_ai.log import read_eval_log
from inspect_ai.model import ModelOutput, ModelUsage
from test_e2e import ATTACK, AWK, DONE, PANDAS, SUM_A, rederive, run, sanswer, shell, write

from bixbench_v1 import solvers
from bixbench_v1.runner import grade_run
from bixbench_v1.solvers import BudgetError

pytestmark = pytest.mark.skipif(not docker_running(), reason="Docker is not running")
Q1 = ["syn-1-q1"]


def costing(tokens: int, outputs: list[ModelOutput]) -> list[ModelOutput]:
    outputs = [o.model_copy(deep=True) for o in outputs]  # never mark the shared DONE
    for output in outputs:
        output.usage = ModelUsage(input_tokens=tokens - 1, output_tokens=1, total_tokens=tokens)
    return outputs


def transcript(out: Path) -> list[str]:
    log = read_eval_log(str(next((out / "logs").glob("*.eval"))))
    assert log.samples is not None
    return [
        str(m.content) + (f"\nTOOL ERROR: {error.message}" if error else "")
        for m in log.samples[0].messages
        for error in [getattr(m, "error", None)]
    ]


def phases(summary: dict, kind: str) -> dict[str, dict]:  # type: ignore[type-arg]
    return {p["phase"]: p for p in summary["phases"] if p["kind"] == f"phase.{kind}"}


def test_a_role_that_hits_its_limit_still_records_its_best_answers(
    synthetic: Synthetic, tmp_path: Path
) -> None:
    # Floors 6,000 / 6,000 / 1,000 of 16,000: the analyst may spend 9,000, of which 3,500 is
    # the reserve for its final turn, so it works up to 5,500. Every call costs 1,000.
    policy = {
        "derivation_base": 6000,
        "derivation_per_question": 0,
        "reconciler_base": 1000,
        "reconciler_per_question": 0,
        "final_reserve": 3500,
    }
    script = [
        # analyst: explores, never submits, and its sixth call takes it over its limit
        *costing(
            1000,
            [
                shell("echo CANDIDATE sum of a is 4"),
                shell("echo CANDIDATE mean of b is 3"),
                shell("echo two genes"),
                shell("echo still thinking"),
                shell("echo still thinking"),
                shell("echo this call goes over the limit and never runs"),
            ],
        ),
        # its forced final turn: no tools but submit_answer, a short prompt
        *costing(
            1000,
            [
                sanswer(1, "4", PANDAS),
                sanswer(2, "3", "data=counts.csv b; subset=all; procedure=mean; tool=pandas.mean"),
                sanswer(3, "two genes", "estimate: no finished computation in the work log"),
            ],
        ),
        # critic: finishes inside its budget
        *costing(
            500,
            [
                sanswer(1, "4", AWK),
                sanswer(
                    2, "3", "data=counts.csv field 3; subset=two lines; procedure=average; tool=awk"
                ),
                sanswer(
                    3, "two genes", "data=counts.csv; subset=whole file; procedure=count; tool=wc"
                ),
                DONE,
            ],
        ),
        *costing(500, [DONE]),  # reconciler
    ]
    out = tmp_path / "run"
    summary = run(synthetic, out, "glhf", script, max_tokens=16_000, budget_policy=policy)
    assert summary["status"] == "done", summary["error"]
    started, finished = phases(summary, "started"), phases(summary, "finished")
    assert started["analyst"]["tokens_allowed"] == 9000
    assert started["analyst"]["tokens_working"] == 5500
    assert finished["analyst"]["limit"] == "token"
    # Cut off with nothing recorded, the analyst still answered everything in its final turn...
    assert finished["analyst"]["forced_answers"] == ["syn-1-q1", "syn-1-q2", "syn-1-q3"]
    assert finished["analyst"]["unanswered"] == []
    assert finished["analyst"]["phase_tokens"] == 9000  # 6 calls + 3 in the reserve
    assert summary["budget"]["forced_answers"] == {"analyst": ["syn-1-q1", "syn-1-q2", "syn-1-q3"]}
    # ...so its answers exist and were compared, instead of the capsule falling back to the critic.
    assert summary["answer_statuses"] == dict.fromkeys(
        ["syn-1-q1", "syn-1-q2", "syn-1-q3"], "replicated"
    )
    rows = {r["question_id"]: r for r in summary["questions"]}
    assert all(r["analyst_forced"] and not r["critic_forced"] for r in rows.values())
    assert rows["syn-1-q1"]["analyst_answer"] == "4" and rows["syn-1-q1"]["agreed"] is True
    assert "forced estimate" in rows["syn-1-q1"]["note"]
    # The forced turn was given the role's own work log, in a prompt of its own.
    messages = transcript(out)
    forced = messages[messages.index("=== GLHF forced final turn: analyst ===") + 1]
    assert "CANDIDATE sum of a is 4" in forced and "Record an answer for: syn-1-q1" in forced
    assert len(forced) < 30_000
    # The reconciler is told that these agreements rest on a forced estimate.
    review = next(m for m in messages if "## 2. Agreements that are not independent" in m)
    assert "forced estimate at its budget limit" in review
    # Roll forward: the critic got what was left minus the reconciler's floor.
    assert started["critic"]["tokens_allowed"] == 16_000 - 9000 - 1000
    assert started["reconciler"]["tokens_allowed"] == 16_000 - 11_000
    assert summary["total_tokens"] == 11_500 <= 16_000
    ledger = json.loads((out / "outputs" / "glhf" / "ledger.json").read_text())
    kinds = [e["kind"] for e in ledger["events"]]
    assert kinds.count("answer.forced") == 3 and "forced_final.finished" in kinds


def test_the_reconciler_must_rederive_a_disagreement_by_running_code(
    synthetic: Synthetic, tmp_path: Path
) -> None:
    derivations = [sanswer(1, "5", PANDAS), DONE, sanswer(1, "4", AWK), DONE]
    # A reconciler that records nothing by script settles nothing: no vote, no deferring.
    idle = run(synthetic, tmp_path / "idle", "glhf", [*derivations, DONE], question_ids=Q1)
    assert idle["answer_statuses"] == {"syn-1-q1": "disputed"}
    assert idle["questions"][0]["reconciler_answer"] is None
    script = [
        *derivations,
        rederive(1, "/root/reconcile/missing.py", "4", "c"),  # no script at all
        write("/root/reconcile/vote.sh", "echo 4"),  # asserts a value, computes nothing
        rederive(1, "/root/reconcile/vote.sh", "4", "B looks right"),
        write("/root/reconcile/copy.sh", "ls /data; cat /home/deriv_b/work/out.txt; echo 4"),
        rederive(1, "/root/reconcile/copy.sh", "4", "B looks right"),  # defers to B's files
        write("/root/reconcile/q1.py", SUM_A),
        rederive(1, "/root/reconcile/q1.py", "5", "A looks right"),  # not what its script printed
        rederive(1, "/root/reconcile/q1.py", "4", "A added the header row index"),
        DONE,
    ]
    out = tmp_path / "run"
    summary = run(synthetic, out, "glhf", script, question_ids=Q1)
    assert summary["status"] == "done", summary["error"]
    text = "\n".join(transcript(out))
    for refusal in (
        "cannot read /root/reconcile/missing.py",
        "the script must compute the value from the files in /data",
        "the script must not read the analysts' directories",
        "the last line your script printed is '4'; the answer '5' is not that value",
    ):
        assert refusal in text, refusal
    row = summary["questions"][0]
    assert (row["analyst_answer"], row["critic_answer"], row["agreed"]) == ("5", "4", False)
    assert (row["reconciler_answer"], row["reconciler_printed"]) == ("4", "4")
    assert row["reconciler_action"] == "rederived" and row["reconciler_changed"] is True
    assert (row["final_answer"], row["status"]) == ("4", "reconciled")
    # Which side the value supports was worked out by code, from the value the script printed.
    ledger = json.loads((out / "outputs" / "glhf" / "ledger.json").read_text())
    assert [r["keep"] for r in ledger["resolutions"]] == ["B"]
    assert "printed '4' when run by the harness" in ledger["resolutions"][0]["evidence"]
    # The reconciler was shown the commands, not the roles' prose.
    review = next(m for m in transcript(out) if "## 1. Disagreements" in m)
    assert "A answered: 5" in review and "B answered: 4" in review and "work/s.py" not in review


def test_same_method_agreement_is_flagged_and_can_be_overturned_by_a_rederivation(
    synthetic: Synthetic, tmp_path: Path
) -> None:
    b_mean = (
        "data=counts.csv column b; subset=all rows; procedure=sum of the column; tool=pandas.sum"
    )
    script = [
        # Both sides agree on both questions, and both answers are wrong.
        sanswer(1, "5", PANDAS),
        sanswer(2, "9", b_mean),
        DONE,
        sanswer(1, "5", PANDAS + " (pandas 2)"),  # the same method as the analyst
        sanswer(
            2,
            "9",
            "data=second file field; subset=after header; procedure=awk average over lines; tool=awk",
        ),
        DONE,
        write("/root/reconcile/q1.py", SUM_A),
        rederive(
            1,
            "/root/reconcile/q1.py",
            "4",
            "both counted the header row",
            same_method=True,
            overturn=True,
        ),
        write("/root/reconcile/q2.py", SUM_A.replace("[1]", "[2]").replace("sum(", "0.5*sum(")),
        rederive(
            2, "/root/reconcile/q2.py", "3", "they summed instead of averaging", overturn=True
        ),
        DONE,
    ]
    out = tmp_path / "run"
    summary = run(synthetic, out, "glhf", script, question_ids=["syn-1-q1", "syn-1-q2"])
    assert summary["status"] == "done", summary["error"]
    rows = {r["question_id"]: r for r in summary["questions"]}
    q1, q2 = rows["syn-1-q1"], rows["syn-1-q2"]
    # q1: agreed by the same method -> weak; the reconciler's own derivation replaces it.
    assert (q1["agreed"], q1["same_method"], q1["same_method_by_code"]) == (True, True, True)
    assert (q1["reconciler_answer"], q1["reconciler_action"]) == ("4", "overturned")
    assert (q1["reconciler_changed"], q1["final_answer"], q1["status"]) == (True, "4", "reconciled")
    # q2: agreed by different methods -> two derivations outweigh the reconciler's one, even
    # though it asked to overturn; its differing value is recorded and the answer flagged.
    assert (q2["agreed"], q2["same_method"]) == (True, False)
    assert (q2["reconciler_answer"], q2["reconciler_action"]) == ("3", "differs_kept")
    assert (q2["reconciler_changed"], q2["final_answer"], q2["status"]) == (
        False,
        "9",
        "replicated",
    )
    assert "the agreed answer is kept" in q2["note"]
    review = next(m for m in transcript(out) if "## 2. Agreements that are not independent" in m)
    assert "Code finds the two method lines to be the SAME method." in review
    assert review.index("### syn-1-q1") < review.index("## 3.") < review.index("### syn-1-q2")
    # What is graded is the overturned answer.
    answers = json.loads((out / "outputs" / "answers.json").read_text())["answers"]
    assert answers["syn-1-q1"] == {"answer": "4", "status": "reconciled", "note": q1["note"]}
    graded = grade_run(out, synthetic.capsule, None)
    grades = {g["question_id"]: g["correct"] for g in graded["profiles"]["per-mode"]["grades"]}
    assert grades == {"syn-1-q1": True, "syn-1-q2": False}
    assert "## Cross-check record" in (out / "outputs" / "glhf" / "FINDINGS.md").read_text()


def test_the_critic_does_not_run_if_the_sandbox_is_not_blind(
    synthetic: Synthetic, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(solvers, "_BLIND", "true")  # the sealing step does nothing
    script = [shell("echo four > /tmp/scratch_a.txt"), sanswer(1, "4", PANDAS), DONE]
    summary = run(synthetic, tmp_path / "run", "glhf", script, question_ids=Q1)
    assert summary["status"] == "done", summary["error"]
    assert list(phases(summary, "started")) == ["analyst"]
    skipped = [p for p in summary["phases"] if p["kind"] == "phase.skipped"]
    assert [(p["phase"], p["reason"]) for p in skipped] == [("critic", "not blind")]
    assert "/tmp/scratch_a.txt" in summary["blind_check"]["visible_to_critic"]
    assert summary["answer_statuses"] == {"syn-1-q1": "unchecked"}


def test_a_surviving_process_queue_or_ipc_object_stops_the_critic(
    synthetic: Synthetic, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The seal as it was before the red-team: files only, and processes killed by name (the
    # upstream helper, which spares anything called inspect-sandbox-tools).
    real = solvers.user_processes

    async def list_only(users: list[str], kill: bool, user: str = "root") -> list[dict]:  # type: ignore[type-arg]
        return [] if kill else await real(users, False, user)

    monkeypatch.setattr(solvers, "user_processes", list_only)
    monkeypatch.setattr(solvers, "_BLIND", "true")
    monkeypatch.setattr(solvers, "_IPC_REMOVE", "true")
    script = [ATTACK, sanswer(1, "5", PANDAS), DONE]
    summary = run(synthetic, tmp_path / "run", "glhf", script, question_ids=Q1)
    assert summary["status"] == "done", summary["error"]
    # All three channels are in the blind check, so the critic does not run on any of them.
    visible = summary["blind_check"]["visible_to_critic"]
    assert "message queue: /dev/mqueue/A-ANSWER_q1_is_five" in visible
    assert any(v.startswith("sysv ipc: shm id ") for v in visible)
    assert any(v.startswith("sysv ipc: msg id ") for v in visible)
    assert any(v.startswith("process of deriv_a: pid ") for v in visible), visible
    assert list(phases(summary, "started")) == ["analyst"]
    assert summary["answer_statuses"] == {"syn-1-q1": "unchecked"}


def test_an_answer_submitted_in_the_call_that_crosses_a_swarm_limit_is_kept(
    synthetic: Synthetic, tmp_path: Path
) -> None:
    policy = {
        "derivation_base": 6000,
        "derivation_per_question": 0,
        "reconciler_base": 1000,
        "reconciler_per_question": 0,
        "final_reserve": 3500,
    }
    script = [
        # analyst works up to 5,500: its sixth call crosses the limit, and it is its answer
        *costing(1000, [*[shell("echo working")] * 5, sanswer(1, "4", PANDAS)]),
        *costing(500, [sanswer(1, "4", AWK), DONE]),  # critic
        *costing(500, [DONE]),  # reconciler
    ]
    out = tmp_path / "run"
    summary = run(
        synthetic, out, "glhf", script, max_tokens=16_000, budget_policy=policy, question_ids=Q1
    )
    assert summary["status"] == "done", summary["error"]
    finished = phases(summary, "finished")
    assert finished["analyst"]["limit"] == "token" and finished["analyst"]["phase_tokens"] == 6000
    # Recorded as the analyst's own finished answer: no forced turn, not a forced estimate.
    assert finished["analyst"]["forced_answers"] == [] and finished["analyst"]["unanswered"] == []
    row = summary["questions"][0]
    assert (row["analyst_answer"], row["analyst_forced"], row["analyst_method"]) == (
        "4",
        False,
        PANDAS,
    )
    assert summary["answer_statuses"] == {"syn-1-q1": "replicated"}
    ledger = json.loads((out / "outputs" / "glhf" / "ledger.json").read_text())
    kinds = [e["kind"] for e in ledger["events"]]
    assert "pending_submits.executed" in kinds and "forced_final.started" not in kinds


def test_equal_and_extended_swarm_budgets_are_recorded(
    synthetic: Synthetic, tmp_path: Path
) -> None:
    script = [sanswer(1, "4", PANDAS), DONE, sanswer(1, "4", AWK), DONE, DONE]
    # One question needs 85,000 + 85,000 + 40,000. At the single agent's 200,000 the swarm is
    # refused up front in equal mode...
    with pytest.raises(BudgetError):
        run(synthetic, tmp_path / "equal", "glhf", script, max_tokens=200_000, question_ids=Q1)
    assert not (tmp_path / "equal" / "run.json").exists()
    # ...and runs in extended mode, where the analyst gets the single agent's whole budget and
    # the run is labelled as having had more.
    summary = run(
        synthetic,
        tmp_path / "extended",
        "glhf",
        script,
        max_tokens=200_000,
        question_ids=Q1,
        swarm_budget="extended",
    )
    assert summary["status"] == "done", summary["error"]
    settings = summary["settings"]
    assert (
        settings["single_budget_tokens"] == 200_000 and settings["total_budget_tokens"] == 450_000
    )
    assert settings["budget_reading"] == "more budget" and settings["token_backstop"] == 562_500
    assert phases(summary, "started")["analyst"]["tokens_allowed"] == 200_000
    assert summary["budget"]["reading"] == "more budget"
    assert summary["budget"]["tokens_used"] == summary["total_tokens"]
