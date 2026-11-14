from __future__ import annotations

import json
import math
import random

import pytest

from bixbench3.inspect_harness.swarm.ledger import ALPHA, Ledger, p_to_e


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


def test_type_one_error_is_controlled_under_the_null() -> None:
    # Under the null, p-values are uniform. A true-null claim tested 5 times must reach
    # "supported" with probability <= alpha (Ville's inequality on the e-value product).
    rng = random.Random(0)
    trials, false_support = 20_000, 0
    for _ in range(trials):
        e = math.prod(p_to_e(rng.random()) for _ in range(5))
        false_support += e >= 1 / ALPHA
    assert false_support / trials <= ALPHA


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
