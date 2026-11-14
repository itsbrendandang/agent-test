"""The answer ledger: statuses are computed by code from what the roles recorded."""

from __future__ import annotations

import json

import pytest

from bixbench_v1.answers import AnswerLedger, compare
from bixbench_v1.solvers import (
    DERIVATION_SHARE,
    RECONCILE_RESERVE,
    allowance,
    dispute_text,
    route_hints,
    route_reveals,
)


@pytest.mark.parametrize(
    ("a", "b", "expected"),
    [
        ("166", "166", "agree"),
        ("166", "167", "differ"),  # counts must match exactly
        ("82000", "82134", "differ"),
        ("0.0002", "0.00018", "agree"),  # one is the other rounded
        ("0.00018", "0.0002", "agree"),
        ("0.0002", "0.0003", "differ"),
        ("1.52", "1.5249", "agree"),
        ("1.52", "1.526", "agree"),  # within 1%
        ("1.52", "1.56", "differ"),
        ("10.6%", "10.6", "agree"),
        ("10.6%", "0.106", "differ"),
        ("1.9E-05", "0.000019", "agree"),
        ("3", "3.0", "agree"),
        ("CDKN1A", "cdkn1a ", "agree"),
        ("CDKN1A", "TP53", "unclear"),
        ("Canonical glycolysis", "glycolysis", "unclear"),
        ("B", "b", "agree"),
        ("B", "C", "unclear"),
        ("3 genes", "3", "unclear"),
    ],
)
def test_compare(a: str, b: str, expected: str) -> None:
    assert compare(a, b) == expected
    assert compare(b, a) == expected


def ledger() -> AnswerLedger:
    return AnswerLedger(
        {"q1": "Count?", "q2": "Mean?", "q3": "Which gene?", "q4": "Other?"}, "glhf"
    )


def test_statuses_follow_the_recorded_derivations() -> None:
    book = ledger()
    assert book.final("q1").status == "missing" and book.final("q1").answer == ""
    book.submit("q1", "166", "count rows", "s.py: 166", "analyst")
    assert book.final("q1").status == "unchecked"
    book.submit("q1", "166", "count in R", "s.R: 166", "critic")
    book.submit("q2", "0.0002", "t-test", "s.py", "analyst")
    book.submit("q2", "0.0003", "Welch test", "s.R", "critic")
    book.submit("q3", "CDKN1A", "top gene", "s.py", "critic")  # the analyst never answered q3
    assert {q: book.final(q).status for q in book.questions} == {
        "q1": "replicated",
        "q2": "disputed",
        "q3": "unchecked",
        "q4": "missing",
    }
    assert book.final("q2").answer == "0.0002"  # the first derivation stands, flagged
    assert book.final("q3").answer == "CDKN1A"  # the critic's answer fills the gap
    assert book.disputes() == ["q2"]
    assert book.rejected() == []


def test_reconciliation_records_what_was_rejected_and_why() -> None:
    book = ledger()
    book.submit("q2", "0.0002", "t-test", "a.py", "analyst")
    book.submit("q2", "0.0003", "Welch test", "b.R", "critic")
    with pytest.raises(ValueError, match="differs from the derivation you keep"):
        book.resolve("q2", "A", "0.0003", "typo", "x", "reconciler")
    with pytest.raises(ValueError, match="differs from the derivation you keep"):
        book.resolve("q2", "both", "0.0002", "same", "x", "reconciler")
    with pytest.raises(ValueError, match="required"):
        book.resolve("q2", "B", "0.0003", " ", "x", "reconciler")
    book.resolve("q2", "B", "0.0003", "A pooled the variances", "check.R: 0.0003", "reconciler")
    final = book.final("q2")
    assert (final.status, final.answer) == ("reconciled", "0.0003")
    verdicts = {d.by: book.verdict(d) for d in book.derivations}
    assert verdicts == {"analyst": "rejected", "critic": "upheld"}
    rejected = book.rejected()
    assert len(rejected) == 1 and rejected[0]["answer"] == "0.0002"
    assert (
        rejected[0]["cause"] == "A pooled the variances" and rejected[0]["replaced_by"] == "0.0003"
    )
    assert book.disputes() == []
    assert "Rejected derivations (1)" in book.findings_markdown()
    assert json.loads(book.to_json())["rejected"] == rejected
    assert book.answers()["answers"]["q2"] == {
        "answer": "0.0003",
        "status": "reconciled",
        "note": "kept B: A pooled the variances",
    }


def test_neither_and_both() -> None:
    book = ledger()
    book.submit("q1", "166", "r1", "e", "analyst")
    book.submit("q1", "170", "r2", "e", "critic")
    book.resolve("q1", "neither", "168", "both filtered wrongly", "fix.py: 168", "reconciler")
    assert book.final("q1").answer == "168"
    assert [r["derivation"] for r in book.rejected()] == ["D1", "D2"]
    book.submit("q3", "Canonical glycolysis", "r1", "e", "analyst")
    book.submit("q3", "glycolysis", "r2", "e", "critic")
    assert book.comparison("q3") == "unclear" and "q3" in book.disputes()
    book.resolve("q3", "both", "Canonical glycolysis", "same term, shorter name", "e", "reconciler")
    assert book.final("q3").status == "reconciled"
    assert {book.verdict(d) for d in book.derivations if d.question_id == "q3"} == {"replicated"}


def test_resolution_needs_an_open_dispute_and_goes_stale_if_an_answer_changes() -> None:
    book = ledger()
    book.submit("q1", "166", "r", "e", "analyst")
    with pytest.raises(ValueError, match="no open dispute"):
        book.resolve("q1", "A", "166", "c", "e", "reconciler")
    book.submit("q1", "166", "r", "e", "critic")
    with pytest.raises(ValueError, match="no open dispute"):
        book.resolve("q1", "A", "166", "c", "e", "reconciler")
    book.submit("q2", "1.0", "r", "e", "analyst")
    book.submit("q2", "2.0", "r", "e", "critic")
    book.resolve("q2", "A", "1.0", "c", "e", "reconciler")
    book.submit("q2", "3.0", "r", "e", "critic")  # a new derivation after the resolution
    assert book.final("q2").status == "disputed"  # the old resolution no longer applies


def test_resubmission_supersedes_and_bad_input_is_refused() -> None:
    book = ledger()
    first = book.submit("q1", "1", "r", "e", "analyst")
    second = book.submit("q1", "2", "r", "e", "analyst")
    assert first.superseded_by == second.id and book.verdict(first) == "superseded"
    assert book.current("q1", "analyst") is second and book.unanswered("analyst") == [
        "q2",
        "q3",
        "q4",
    ]
    with pytest.raises(ValueError, match="unknown question"):
        book.submit("q9", "1", "r", "e", "analyst")
    with pytest.raises(ValueError, match="empty"):
        book.submit("q1", "  ", "r", "e", "analyst")


def test_single_agent_answers_are_all_unchecked() -> None:
    book = AnswerLedger({"q1": "?"}, "single", primary="single", checker=None)
    book.submit("q1", "5", "r", "e", "single")
    assert book.final("q1").status == "unchecked" and book.disputes() == []
    methods = book.methods_markdown({"max_tokens": 1000})
    assert "Solver: single" in methods and "`5` (status: unchecked)" in methods


def test_the_critic_is_shown_routes_never_results() -> None:
    book = ledger()
    book.submit("q1", "166", "count rows with padj < 0.05 in res.csv", "e", "analyst")
    book.submit("q2", "0.05", "t-test at alpha 0.05 gave the value", "e", "analyst")
    book.submit("q3", "CDKN1A", "the top gene by log2FC was CDKN1A", "e", "analyst")
    hints = route_hints(book)
    assert "- q1: count rows with padj < 0.05 in res.csv" in hints
    assert "- q2: (withheld)" in hints and "- q3: (withheld)" in hints
    assert "- q4: (no first derivation recorded)" in hints
    assert "166" not in hints and "CDKN1A" not in hints
    assert route_reveals("found 166 genes", "166") and route_reveals("p = 1.9e-5", "1.9E-05")
    assert not route_reveals("DESeq2, padj < 0.05, lfc > 1", "166")
    assert route_reveals("picked option B", "B") and not route_reveals("Bonferroni by gene", "B")


def test_the_reconciler_sees_both_derivations_under_neutral_labels() -> None:
    book = ledger()
    book.submit("q2", "0.0002", "t-test", "a.py", "analyst")
    book.submit("q2", "0.0003", "Welch test", "b.R", "critic")
    text = dispute_text(book)
    assert "A answered: 0.0002" in text and "B answered: 0.0003" in text
    assert "analyst" not in text and "critic" not in text


def test_phase_budgets() -> None:
    total = 1_000_000
    assert allowance("analyst", total, 0) == total * DERIVATION_SHARE
    spent = int(total * DERIVATION_SHARE)
    # The two derivations get the same cap, and reconciliation keeps its reserve.
    assert allowance("critic", total, spent) == pytest.approx(total * DERIVATION_SHARE)
    assert allowance("critic", total, 100_000) == pytest.approx(total * DERIVATION_SHARE)
    overspent = spent + 100_000  # the analyst ran over (limits are checked after each call)
    assert allowance("critic", total, overspent) == pytest.approx(
        total - overspent - total * RECONCILE_RESERVE
    )
    assert allowance("reconciler", total, 2 * spent) == pytest.approx(total - 2 * spent)
    assert allowance("reconciler", total, 2 * spent) >= total * RECONCILE_RESERVE - 1
    assert allowance("critic", total, total) < 0  # nothing left: the phase is skipped
