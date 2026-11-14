from __future__ import annotations

import json
import random

import pytest

from bixbench3.inspect_harness.swarm.ledger import (
    ALPHA,
    KAPPA,
    MAX_TESTS,
    Claim,
    Ledger,
    p_to_e,
)


def _claim(ledger: Ledger) -> Claim:
    return ledger.add_claim(
        "C10 down-regulates REST targets", ["degs"], "no change in REST targets", "planner"
    )


def _test(ledger: Ledger, claim: Claim, name: str, p: float, contradicts: bool = False) -> Claim:
    """Register a test, then record its result: the only way a favourable result is accepted."""
    ledger.register_test(claim.id, name, "what is run and what would contradict", "critic")
    return ledger.record_test(claim.id, name, p, contradicts, "", "critic")


def test_calibrator_is_a_valid_e_value() -> None:
    # E[p_to_e(U)] for U ~ Uniform(0,1) must be <= 1 (it equals 1 for kappa in (0,1)).
    grid = [(i + 0.5) / 200_000 for i in range(200_000)]
    assert sum(p_to_e(p) for p in grid) / len(grid) == pytest.approx(1.0, rel=0.02)
    assert p_to_e(1.0) == 0.5


def test_untested_claim_is_never_a_finding() -> None:
    ledger = Ledger()
    claim = _claim(ledger)
    assert claim.verdict == "untested"
    ledger.register_test(claim.id, "permutation", "permute labels", "critic")
    assert claim.verdict == "untested" and claim.pending == ["permutation"]


def test_strong_evidence_supports_and_weak_does_not() -> None:
    ledger = Ledger()
    weak, strong = _claim(ledger), _claim(ledger)
    _test(ledger, weak, "label permutation", 0.2)
    assert weak.verdict == "insufficient"
    _test(ledger, strong, "held-out replicate", 0.0005)  # e = 22.4 against a threshold of 20
    assert strong.e_value >= 2 / ALPHA and strong.verdict == "supported"


def test_evidence_is_the_mean_of_the_registered_tests_not_the_product() -> None:
    # Three copies of one result must be worth exactly one result. Under a product,
    # p = 0.02 three times gave e = 44 and "supported"; the mean stays at 3.5.
    ledger = Ledger()
    c = _claim(ledger)
    for name in ("a", "b", "c"):
        ledger.register_test(c.id, name, "m", "critic")
    for name in ("a", "b", "c"):
        ledger.record_test(c.id, name, 0.02, False, "", "critic")
    assert c.e_value == pytest.approx(p_to_e(0.02))
    assert c.verdict == "insufficient"


def test_a_favourable_result_needs_a_test_registered_before_any_result() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    with pytest.raises(ValueError, match="register it first"):
        ledger.record_test(c.id, "permutation", 1e-6, False, "", "critic")
    assert c.tests == [] and c.verdict == "untested"
    _test(ledger, c, "permutation", 0.3)
    # Registration closes at the first result: no test can be added once outcomes are known.
    with pytest.raises(ValueError, match="registration for C1 is closed"):
        ledger.register_test(c.id, "a better test", "m", "critic")
    with pytest.raises(ValueError, match="registration is closed"):
        ledger.record_test(c.id, "a better test", 1e-6, False, "", "critic")
    assert len(c.tests) == 1 and c.verdict == "insufficient"


def test_a_registered_test_without_a_result_counts_as_zero_and_blocks_support() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    ledger.register_test(c.id, "permutation", "m", "critic")
    ledger.register_test(c.id, "held-out replicate", "m", "critic")
    ledger.record_test(c.id, "permutation", 1e-6, False, "", "critic")  # e = 500
    # The unfavourable test cannot be dropped: the mean is 250, above the threshold of 10,
    # and the claim is still not supported until the second registered test has a result.
    assert c.pending == ["held-out replicate"]
    assert c.e_value == pytest.approx(250.0) and c.verdict == "insufficient"
    ledger.record_test(c.id, "Held-out  replicate", 0.9, False, "", "critic")
    assert c.pending == [] and c.verdict == "supported"
    assert c.e_value == pytest.approx((500 + p_to_e(0.9)) / 2)


def test_contradiction_refutes_even_with_support() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    _test(ledger, c, "permutation", 1e-6)
    ledger.record_test(c.id, "marker direction", 0.01, True, "marker went up", "critic")
    assert c.verdict == "refuted"


def test_a_contradicting_result_is_never_refused() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    for i in range(MAX_TESTS):
        ledger.register_test(c.id, f"test {i}", "m", "critic")
    with pytest.raises(ValueError, match="most a claim may have"):
        ledger.register_test(c.id, "one more", "m", "critic")
    for i in range(MAX_TESTS):
        ledger.record_test(c.id, f"test {i}", 1e-6, False, "", "critic")
    assert c.verdict == "supported"
    # Over the cap, unregistered, after registration closed: still accepted, and it refutes.
    ledger.record_test(c.id, "late direction check", 1e-9, True, "went the other way", "critic")
    assert c.verdict == "refuted" and c.tests[-1].registered is False
    # Even under a name that already has a result.
    ledger.record_test(c.id, "test 0", 0.5, True, "rerun went the other way", "critic")
    assert c.tests[-1].name == "test 0 (repeat 2)" and len(c.tests) == MAX_TESTS + 2
    # A weak contradiction does not refute, but it lowers the mean.
    other = _claim(ledger)
    _test(ledger, other, "permutation", 1e-6)
    before = other.e_value
    ledger.record_test(other.id, "direction", 0.4, True, "", "critic")
    assert other.verdict != "refuted" and other.e_value == pytest.approx((before + KAPPA) / 2)


def test_failed_replication_refutes() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    ledger.fail_replication(c.id, "edgeR finds 12 DEGs vs 480", "critic")
    assert c.verdict == "refuted"


# --- Type-I error, measured through register_test, record_test and Claim.verdict ------------


def _trial(rng: random.Random, mode: str, claims: int) -> bool:
    """One run with `claims` true-null claims; True if any of them ends "supported".

    Under the null a p-value is uniform. Modes (the critic's behaviour):
      independent  three registered tests per claim, each with its own p;
      same         one test registered three times under different names (fully dependent);
      best-of-100  the critic runs a hundred tests in private and tries to record the best one.
                   A favourable result is accepted only under a name registered before any
                   result, so what counts is the registered test: one draw, not the best;
      drop         the critic records only the registered tests that came out favourable.
    """
    ledger = Ledger()
    family = [_claim(ledger) for _ in range(claims)]
    for claim in family:
        names = [f"test {i}" for i in range(1 if mode == "best-of-100" else MAX_TESTS)]
        for name in names:
            ledger.register_test(claim.id, name, "m", "critic")
        if mode == "same":
            draws = [rng.random()] * MAX_TESTS
        elif mode == "best-of-100":
            private = [rng.random() for _ in range(100)]
            with pytest.raises(ValueError):  # an unregistered favourable result is refused
                ledger.record_test(claim.id, "the best one", min(private), False, "", "critic")
            draws = private[:1]
        else:
            draws = [rng.random() for _ in range(MAX_TESTS)]
        for name, p in zip(names, draws, strict=True):
            if mode == "drop" and p > 0.05:
                continue
            ledger.record_test(claim.id, name, p, False, "", "critic")
    return any(c.verdict == "supported" for c in family)


def _family_error(mode: str, claims: int, trials: int) -> float:
    rng = random.Random(claims * 7919 + len(mode))
    return sum(_trial(rng, mode, claims) for _ in range(trials)) / trials


@pytest.mark.parametrize("mode", ["independent", "same", "best-of-100", "drop"])
@pytest.mark.parametrize(("claims", "trials"), [(1, 20_000), (8, 6_000), (20, 3_000)])
def test_type_one_error_is_controlled_through_the_ledger(
    mode: str, claims: int, trials: int
) -> None:
    # The scenarios of the two code reviews. With a product of e-values, the same test recorded
    # three times reached 10-18% and the best 3 of 20 reached 12-38% false support. With the mean
    # over pre-registered tests, P(any of the m true-null claims is supported) stays within
    # alpha for every m, whatever the dependence between a claim's tests.
    assert _family_error(mode, claims, trials) <= ALPHA


def test_selecting_the_best_test_would_break_the_bound_without_registration() -> None:
    # What pre-registration prevents, shown by computing what the ledger refuses to record:
    # the best of a hundred null p-values passes the threshold far more often than alpha.
    rng = random.Random(1)
    passed = sum(p_to_e(min(rng.random() for _ in range(100))) >= 1 / ALPHA for _ in range(4_000))
    assert passed / 4_000 > ALPHA


def test_every_test_counts_and_a_contradiction_counts_against() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    ledger.register_test(c.id, "direction", "m", "critic")
    ledger.register_test(c.id, "permutation", "m", "critic")
    ledger.record_test(c.id, "direction", 0.4, True, "went the other way", "critic")
    assert c.tests[0].e_value == KAPPA  # not 1.0: unfavourable evidence is not censored
    assert c.verdict == "insufficient"  # p >= alpha, so not refuted either
    ledger.record_test(c.id, "permutation", 0.9, False, "", "critic")
    assert c.e_value == pytest.approx((KAPPA + p_to_e(0.9)) / 2)


def test_a_test_name_is_accepted_once() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    ledger.register_test(c.id, "Label permutation", "m", "critic")
    with pytest.raises(ValueError, match="already has a registered test"):
        ledger.register_test(c.id, "label-permutation ", "m", "critic")
    with pytest.raises(ValueError, match="method is empty"):
        ledger.register_test(c.id, "other", "  ", "critic")
    ledger.record_test(c.id, "Label permutation", 0.3, False, "", "critic")
    with pytest.raises(ValueError, match="first result stands"):
        ledger.record_test(c.id, "label-permutation ", 0.0001, False, "", "critic")
    assert len(c.tests) == 1 and c.tests[0].p_value == 0.3  # the first result stands


def test_thresholds_tighten_with_the_number_of_claims() -> None:
    ledger = Ledger()
    a = _claim(ledger)
    _test(ledger, a, "permutation", 0.001)  # e = 15.8
    assert a.verdict == "supported"  # one claim: threshold 10
    b = _claim(ledger)
    assert a.threshold == 20 and a.verdict == "insufficient"  # two claims: threshold 20
    ledger.record_test(b.id, "direction", 0.07, True, "", "critic")
    assert b.verdict == "insufficient"  # 0.07 is not below alpha / 2
    data = json.loads(ledger.to_json())
    assert data["claims_in_family"] == 2 and data["support_threshold"] == 20
    assert data["claims"][0]["registered"][0]["name"] == "permutation"
    assert data["claims"][0]["pending_tests"] == []


def test_a_single_zero_p_value_is_bounded() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    _test(ledger, c, "too good", 0.0)
    assert c.e_value == pytest.approx(500.0)


@pytest.mark.parametrize("bad", [1.5, -0.1, float("nan"), True, False, "0.01", None])
def test_rejects_invalid_p_values(bad: object) -> None:
    ledger = Ledger()
    c = _claim(ledger)
    ledger.register_test(c.id, "bad", "m", "critic")
    with pytest.raises(ValueError, match="p_value"):
        ledger.record_test(c.id, "bad", bad, False, "", "critic")  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="p_value"):  # also when it contradicts
        ledger.record_test(c.id, "bad", bad, True, "", "critic")  # type: ignore[arg-type]
    assert c.tests == []


def test_findings_state_the_guarantee_its_assumptions_and_unchecked_fixes() -> None:
    ledger = Ledger()
    claim = _claim(ledger)
    ledger.register_test(claim.id, "permutation", "permute labels 10000 times", "critic")
    ledger.register_test(claim.id, "held-out replicate", "refit without replicate 3", "critic")
    ledger.record_test(claim.id, "permutation", 0.2, False, "", "critic")
    first = ledger.raise_issue("major", ["degs"], "wrong threshold", "grep", "critic")
    ledger.resolve_issue(first.id, "fixed", "set padj < 0.05", "experimenter")
    assert ledger.mark_rechecked() == [first.id]  # a critic round completed after the fix
    second = ledger.raise_issue("major", ["degs"], "wrong sort", "head", "critic")
    ledger.resolve_issue(second.id, "fixed", "sorted by padj", "experimenter")
    md = ledger.findings_markdown()
    assert "under any dependence between its registered tests" in md
    assert "no test was run in private before it was registered" in md
    assert "Not controlled" in md and "independent" not in md
    assert "registered: held-out replicate. refit without replicate 3 [critic] NO RESULT" in md
    assert md.count("fixed, not re-checked by the critic") == 1
    assert "sorted by padj (fixed, not re-checked by the critic)" in md
    summary = ledger.summary()
    assert "registered, no result yet: held-out replicate" in summary
    assert "test registration: closed" in summary and "mean e-value is >= 10" in summary


def test_reports_list_rejections_and_fixed_issues() -> None:
    ledger = Ledger()
    a, b = _claim(ledger), _claim(ledger)
    _test(ledger, a, "perm", 1e-5)
    ledger.record_test(b.id, "direction", 0.001, True, "", "critic")
    issue = ledger.raise_issue(
        "blocking", ["degs"], "contrast reversed", "log2FC sign flipped", "critic"
    )
    ledger.resolve_issue(
        issue.id, "fixed", "swapped reference level, reran 03_deseq2.R", "experimenter"
    )
    md = ledger.findings_markdown()
    assert "Supported findings (1)" in md and "Rejected claims (1)" in md
    assert "(not pre-registered)" in md  # the contradicting test recorded without registration
    assert "critic issues fixed before reporting (1)" in md and "contrast reversed" in md
    data = json.loads(ledger.to_json())
    assert [c["verdict"] for c in data["claims"]] == ["supported", "refuted"]
    assert ledger.open_issues() == []
