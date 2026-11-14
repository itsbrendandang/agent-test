from __future__ import annotations

import json
import random

import pytest

from bixbench3.inspect_harness.swarm.ledger import ALPHA, KAPPA, MAX_TESTS, Ledger, p_to_e


def _claim(ledger: Ledger):
    return ledger.add_claim(
        "C10 down-regulates REST targets", ["degs"], "no change in REST targets", "planner"
    )


def test_calibrator_is_a_valid_e_value() -> None:
    # E[p_to_e(U)] for U ~ Uniform(0,1) must be <= 1 (it equals 1 for kappa in (0,1)).
    grid = [(i + 0.5) / 200_000 for i in range(200_000)]
    assert sum(p_to_e(p) for p in grid) / len(grid) == pytest.approx(1.0, rel=0.02)
    assert p_to_e(1.0) == 0.5


def test_untested_claim_is_never_a_finding() -> None:
    ledger = Ledger()
    assert _claim(ledger).verdict == "untested"


def test_strong_evidence_supports_and_weak_does_not() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    ledger.record_test(c.id, "label permutation", 0.2, False, "", "critic")
    assert c.verdict == "insufficient"
    ledger.record_test(c.id, "held-out replicate", 0.0005, False, "", "critic")
    assert c.e_value >= 1 / ALPHA
    assert c.verdict == "supported"


def test_contradiction_refutes_even_with_support() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    ledger.record_test(c.id, "permutation", 1e-6, False, "", "critic")
    ledger.record_test(c.id, "marker direction", 0.01, True, "marker went up", "critic")
    assert c.verdict == "refuted"


def test_failed_replication_refutes() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    ledger.fail_replication(c.id, "edgeR finds 12 DEGs vs 480", "critic")
    assert c.verdict == "refuted"


def _false_support_rate(tests: int, mode: str, claims: int = 1, trials: int = 20_000) -> float:
    """Share of true-null claims that end "supported", going through record_test and verdict.

    Under the null a p-value is uniform. `mode`: "independent" draws a new p per test; "same"
    records one p again and again under new names (fully dependent tests); "contradicts" marks
    every test with p > 0.5 as contradicting, which used to hide unfavourable evidence."""
    rng = random.Random(0)
    supported = 0
    for _ in range(trials):
        ledger = Ledger()
        claim, *_ = [_claim(ledger) for _ in range(claims)]
        first = rng.random()
        for i in range(tests):
            p = first if mode == "same" else rng.random()
            try:
                ledger.record_test(
                    claim.id, f"test {i}", p, mode == "contradicts" and p > 0.5, "", "critic"
                )
            except ValueError:
                break  # the cap on tests per claim
        supported += claim.verdict == "supported"
    return supported / trials


@pytest.mark.parametrize("mode", ["independent", "same", "contradicts"])
@pytest.mark.parametrize("tests", [1, 5, 10, 20])
def test_type_one_error_is_controlled_through_the_ledger(mode: str, tests: int) -> None:
    # The scenarios of the code review: repeated tests reached 15.6-19.8% and selective
    # "contradicts" 28.8% false support before the fix. All must stay within alpha.
    assert _false_support_rate(tests, mode) <= ALPHA


@pytest.mark.parametrize("mode", ["independent", "same", "contradicts"])
def test_type_one_error_is_split_across_claims(mode: str) -> None:
    # Bonferroni: with m claims each may be falsely supported with probability alpha / m.
    for claims in (3, 6):
        assert _false_support_rate(10, mode, claims=claims) <= ALPHA / claims


def test_every_test_counts_and_a_contradiction_counts_against() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    ledger.record_test(c.id, "direction", 0.4, True, "went the other way", "critic")
    assert c.tests[0].e_value == KAPPA  # not 1.0: unfavourable evidence is not censored
    assert c.verdict == "insufficient"  # p >= alpha, so not refuted either
    ledger.record_test(c.id, "permutation", 0.9, False, "", "critic")
    assert c.e_value == pytest.approx(KAPPA * p_to_e(0.9))


def test_a_test_name_is_accepted_once_and_tests_are_capped() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    ledger.record_test(c.id, "Label permutation", 0.3, False, "", "critic")
    with pytest.raises(ValueError, match="already has a result"):
        ledger.record_test(c.id, "label-permutation ", 0.0001, False, "", "critic")
    assert len(c.tests) == 1 and c.tests[0].p_value == 0.3  # the first result stands
    for i in range(MAX_TESTS - 1):
        ledger.record_test(c.id, f"other {i}", 0.5, False, "", "critic")
    with pytest.raises(ValueError, match="most a claim may have"):
        ledger.record_test(c.id, "one more", 0.0001, False, "", "critic")


def test_thresholds_tighten_with_the_number_of_claims() -> None:
    ledger = Ledger()
    a = _claim(ledger)
    ledger.record_test(a.id, "permutation", 0.001, False, "", "critic")  # e = 15.8
    assert a.verdict == "supported"  # one claim: threshold 10
    b = _claim(ledger)
    assert a.threshold == 20 and a.verdict == "insufficient"  # two claims: threshold 20
    ledger.record_test(b.id, "direction", 0.07, True, "", "critic")
    assert b.verdict == "insufficient"  # 0.07 is not below alpha / 2
    data = json.loads(ledger.to_json())
    assert data["claims_in_family"] == 2 and data["support_threshold"] == 20


def test_a_single_zero_p_value_is_bounded() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    ledger.record_test(c.id, "too good", 0.0, False, "", "critic")
    assert c.e_value == pytest.approx(500.0)


def test_findings_state_the_independence_assumption_and_unchecked_fixes() -> None:
    ledger = Ledger()
    _claim(ledger)
    first = ledger.raise_issue("major", ["degs"], "wrong threshold", "grep", "critic")
    ledger.resolve_issue(first.id, "fixed", "set padj < 0.05", "experimenter")
    assert ledger.mark_rechecked() == [first.id]  # a critic round completed after the fix
    second = ledger.raise_issue("major", ["degs"], "wrong sort", "head", "critic")
    ledger.resolve_issue(second.id, "fixed", "sorted by padj", "experimenter")
    md = ledger.findings_markdown()
    assert "tests on one claim are independent" in md
    assert md.count("fixed, not re-checked by the critic") == 1
    assert "sorted by padj (fixed, not re-checked by the critic)" in md


def test_rejects_invalid_p_values() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    with pytest.raises(ValueError):
        ledger.record_test(c.id, "bad", 1.5, False, "", "critic")


def test_reports_list_rejections_and_fixed_issues() -> None:
    ledger = Ledger()
    a, b = _claim(ledger), _claim(ledger)
    ledger.record_test(a.id, "perm", 1e-5, False, "", "critic")
    ledger.record_test(b.id, "direction", 0.001, True, "", "critic")
    issue = ledger.raise_issue(
        "blocking", ["degs"], "contrast reversed", "log2FC sign flipped", "critic"
    )
    ledger.resolve_issue(
        issue.id, "fixed", "swapped reference level, reran 03_deseq2.R", "experimenter"
    )
    md = ledger.findings_markdown()
    assert "Supported findings (1)" in md and "Rejected claims (1)" in md
    assert "critic issues fixed before reporting (1)" in md and "contrast reversed" in md
    data = json.loads(ledger.to_json())
    assert [c["verdict"] for c in data["claims"]] == ["supported", "refuted"]
    assert ledger.open_issues() == []
