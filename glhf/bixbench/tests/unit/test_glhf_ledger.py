from __future__ import annotations

import json
import random

import pytest

from bixbench3.inspect_harness.swarm.ledger import (
    ALPHA,
    KAPPA,
    MAX_SCRIPT_BYTES,
    MAX_TESTS,
    RELEVANCE_THRESHOLD,
    Claim,
    Ledger,
    Relevance,
    Run,
    RunStatus,
    p_to_e,
    parse_result_line,
)


def _claim(ledger: Ledger) -> Claim:
    return ledger.add_claim(
        "C10 down-regulates REST targets", ["degs"], "no change in REST targets", "planner"
    )


def _register(
    ledger: Ledger, claim: Claim, name: str, score: float | None = 1.0, method: str = "m"
) -> None:
    """A test as the critic registers it (a script with its content), then the relevance
    judgement that comes before any run. `score` None leaves it unjudged."""
    script = f"# {claim.id} / {name}\nprint('GLHF_RESULT p_value=... contradicts=false')\n"
    ledger.register_test(
        claim.id,
        name,
        method,
        "critic",
        script_path=f"/workspace/work/glhf/tests/{claim.id}_{len(claim.registered)}.py",
        script=script,
        test_null="no difference",
    )
    if score is not None:
        ledger.judge_relevance(claim.id, name, Relevance(score, False, "why"))


def _run(
    ledger: Ledger,
    claim: Claim,
    name: str,
    p: float | None,
    contradicts: bool = False,
    status: RunStatus = "ok",
) -> Claim:
    """What the harness records after executing the registered script unchanged."""
    entry = claim.registration(name)
    assert entry is not None
    run = Run(status, ["python3", "-"], 0, 0.1, "tail", entry.script_sha256, p, contradicts)
    return ledger.record_run(claim.id, name, run)


def _test(ledger: Ledger, claim: Claim, name: str, p: float, contradicts: bool = False) -> Claim:
    """Register a test, have it judged relevant, then let the harness run it: the only way a
    favourable result is accepted."""
    _register(ledger, claim, name)
    return _run(ledger, claim, name, p, contradicts)


def test_calibrator_is_a_valid_e_value() -> None:
    # E[p_to_e(U)] for U ~ Uniform(0,1) must be <= 1 (it equals 1 for kappa in (0,1)).
    grid = [(i + 0.5) / 200_000 for i in range(200_000)]
    assert sum(p_to_e(p) for p in grid) / len(grid) == pytest.approx(1.0, rel=0.02)
    assert p_to_e(1.0) == 0.5


def test_untested_claim_is_never_a_finding() -> None:
    ledger = Ledger()
    claim = _claim(ledger)
    assert claim.verdict == "untested"
    _register(ledger, claim, "permutation")
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
        _register(ledger, c, name)
    for name in ("a", "b", "c"):
        _run(ledger, c, name, 0.02)
    assert c.e_value == pytest.approx(p_to_e(0.02))
    assert c.verdict == "insufficient"


# --- Who produces the number ---------------------------------------------------------------------


def test_a_result_typed_in_by_a_role_is_never_accepted_as_support() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    # Not without a registration, and not under a registered and relevant test's name either.
    with pytest.raises(ValueError, match="typed in by a role cannot support"):
        ledger.record_test(c.id, "permutation", 1e-6, False, "", "critic")
    _register(ledger, c, "permutation")
    with pytest.raises(ValueError, match="typed in by a role cannot support"):
        ledger.record_test(c.id, "permutation", 1e-6, False, "I ran it, trust me", "critic")
    assert c.tests == [] and c.verdict == "untested" and c.pending == ["permutation"]
    assert not c.closed  # a refused result closes nothing
    _run(ledger, c, "permutation", 1e-6)
    assert c.verdict == "supported"
    assert (c.tests[0].source, c.tests[0].by, c.tests[0].registered) == ("harness", "harness", True)


def test_registration_closes_at_the_first_result_or_run() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    _test(ledger, c, "permutation", 0.3)
    with pytest.raises(ValueError, match="registration for C1 is closed"):
        _register(ledger, c, "a better test")
    assert len(c.tests) == 1 and c.verdict == "insufficient"
    # A run that produced no result closes it too: one cannot watch a test fail and add another.
    d = _claim(ledger)
    _register(ledger, d, "permutation")
    _run(ledger, d, "permutation", None, status="failed")
    assert d.tests == [] and d.closed
    with pytest.raises(ValueError, match="registration for C2 is closed"):
        _register(ledger, d, "second try")
    # So does a contradicting result typed in before any run.
    e = _claim(ledger)
    ledger.record_test(e.id, "direction", 0.4, True, "", "critic")
    with pytest.raises(ValueError, match="registration for C3 is closed"):
        _register(ledger, e, "permutation")


def test_a_test_is_registered_as_a_script_with_its_path_and_content_hash() -> None:
    import hashlib

    ledger = Ledger()
    c = _claim(ledger)
    script = "import random\nprint('GLHF_RESULT p_value=0.5 contradicts=false')\n"
    ledger.register_test(
        c.id, "perm", "permute", "critic", script_path="/workspace/t.py", script=script
    )
    entry = c.registered[0]
    digest = hashlib.sha256(script.encode()).hexdigest()
    assert (entry.script_path, entry.script_sha256, entry.script_bytes, entry.script) == (
        "/workspace/t.py",
        digest,
        len(script),
        script,
    )
    event = ledger.events[-1]
    assert event["kind"] == "test.registered" and event["script_sha256"] == digest
    assert event["script_path"] == "/workspace/t.py" and event["script_bytes"] == len(script)
    with pytest.raises(ValueError, match="script is empty"):
        ledger.register_test(c.id, "b", "m", "critic", script_path="/workspace/b.py", script=" \n")
    with pytest.raises(ValueError, match="most a registered test may be"):
        ledger.register_test(
            c.id,
            "c",
            "m",
            "critic",
            script_path="/workspace/c.py",
            script="#" * (MAX_SCRIPT_BYTES + 1),
        )
    assert len(c.registered) == 1


def test_a_registration_without_a_script_can_never_be_run() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    ledger.register_test(c.id, "words only", "I will permute the labels", "critic")
    ledger.judge_relevance(c.id, "words only", Relevance(1.0, True, "fine"))
    with pytest.raises(ValueError, match="no registered test script"):
        ledger.record_run(c.id, "words only", Run("ok", [], 0, 0.1, "", None, 1e-6, False))
    assert c.verdict == "untested" and c.pending == ["words only"]
    assert (
        "no script" in ledger.summary() and "No script: cannot be run" in ledger.findings_markdown()
    )


def test_the_script_that_ran_must_be_the_registered_one() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    _register(ledger, c, "permutation")
    run = Run("ok", ["python3", "-"], 0, 0.2, "GLHF_RESULT p_value=0.000001 contradicts=false")
    run.sha256_at_run, run.p_value, run.contradicts = "0" * 64, 1e-6, False  # another file
    ledger.record_run(c.id, "permutation", run)
    assert c.registered[0].run is not None and c.registered[0].run.status == "changed"
    assert c.registered[0].run.p_value is None  # the number is not kept as a result
    assert c.tests == [] and c.pending == ["permutation"] and c.verdict == "untested"
    with pytest.raises(ValueError, match="first run stands"):  # and it cannot be run again
        _run(ledger, c, "permutation", 1e-6)


@pytest.mark.parametrize("status", ["changed", "missing", "failed", "timeout", "unparsable"])
def test_a_run_without_a_result_counts_as_zero_like_a_test_never_run(status: RunStatus) -> None:
    ledger = Ledger()
    c = _claim(ledger)
    _register(ledger, c, "permutation")
    _register(ledger, c, "held-out replicate")
    _run(ledger, c, "permutation", 1e-6)  # e = 500
    assert c.e_value == pytest.approx(250.0) and c.verdict == "insufficient"  # one still pending
    _run(ledger, c, "held-out replicate", 1e-6, status=status)  # a p-value given with it is ignored
    assert c.pending == ["held-out replicate"] and len(c.tests) == 1
    assert c.e_value == pytest.approx(250.0) and c.verdict == "insufficient"
    assert f"run {status}" in ledger.summary()
    assert f"NO RESULT: run {status} (counts as e = 0)" in ledger.findings_markdown()


@pytest.mark.parametrize("p", [None, float("nan"), 1.5, -0.1, True])
def test_an_ok_run_without_a_valid_p_value_has_no_result(p: object) -> None:
    ledger = Ledger()
    c = _claim(ledger)
    _register(ledger, c, "permutation")
    _run(ledger, c, "permutation", p)  # type: ignore[arg-type]
    assert c.registered[0].run is not None and c.registered[0].run.status == "unparsable"
    assert c.tests == [] and c.verdict == "untested"


def test_every_run_is_recorded_with_command_exit_code_runtime_and_output() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    _register(ledger, c, "permutation")
    run = Run("failed", ["Rscript", "-"], 3, 12.3456, "x" * 5000 + "Error in library(DESeq2)")
    run.sha256_at_run = c.registered[0].script_sha256
    ledger.record_run(c.id, "permutation", run)
    event = ledger.events[-1]
    assert event["kind"] == "test.executed"
    assert (event["status"], event["command"], event["exit_code"], event["seconds"]) == (
        "failed",
        ["Rscript", "-"],
        3,
        12.346,
    )
    assert str(event["output_tail"]).endswith("Error in library(DESeq2)")
    assert len(str(event["output_tail"])) == 2000  # the end of the output, bounded
    assert event["p"] is None and event["sha256_at_run"] == event["script_sha256"]
    stored = json.loads(ledger.to_json())["claims"][0]["registered"][0]["run"]
    assert (
        stored["exit_code"] == 3 and stored["status"] == "failed" and stored["seconds"] == 12.3456
    )
    # A run with a result adds the test.recorded entry the views already read.
    d = _claim(ledger)
    _test(ledger, d, "permutation", 0.01)
    kinds = [e["kind"] for e in ledger.events[-2:]]
    assert kinds == ["test.executed", "test.recorded"]
    assert ledger.events[-1]["source"] == "harness" and ledger.events[-1]["by"] == "harness"


@pytest.mark.parametrize(
    ("output", "parsed"),
    [
        ("GLHF_RESULT p_value=0.0123 contradicts=false", (0.0123, False)),
        ("noise\n\nGLHF_RESULT p_value=1e-4 contradicts=true\n\n", (1e-4, True)),
        ("GLHF_RESULT p_value=0 contradicts=false", (0.0, False)),
        ("GLHF_RESULT p_value=1 contradicts=false\n", (1.0, False)),
        ("GLHF_RESULT p_value=0.01 contradicts=false\nDone.", None),  # not the last line
        ("p = 0.01", None),
        ("GLHF_RESULT p_value=0.01", None),  # no direction
        ("GLHF_RESULT p_value=0.01 contradicts=no", None),
        ("GLHF_RESULT p_value=nan contradicts=false", None),
        ("GLHF_RESULT p_value=1.5 contradicts=false", None),
        ("GLHF_RESULT p_value=-0.1 contradicts=false", None),
        ("GLHF_RESULT p_value=<0.001 contradicts=false", None),
        ("x GLHF_RESULT p_value=0.01 contradicts=false", None),  # the whole line, nothing else
        ("", None),
    ],
)
def test_the_result_is_read_from_the_last_line_in_one_fixed_format(
    output: str, parsed: tuple[float, bool] | None
) -> None:
    assert parse_result_line(output) == parsed


# --- Relevance ------------------------------------------------------------------------------------


def test_a_test_judged_not_relevant_is_run_and_recorded_but_cannot_support() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    _register(ledger, c, "positive control", score=0.6)  # under the threshold of 0.8
    assert c.registered[0].relevance is not None and c.registered[0].relevance.relevant is False
    _run(ledger, c, "positive control", 1e-6)  # would be e = 500
    assert len(c.tests) == 1 and c.tests[0].counts is False and c.tests[0].p_value == 1e-6
    assert c.e_value == 0.0 and c.verdict == "insufficient"
    assert ledger.events[-1]["kind"] == "test.recorded" and ledger.events[-1]["counts"] is False
    # Next to a relevant test it stays in the mean as zero: every registered test counts.
    d = _claim(ledger)
    _register(ledger, d, "permutation")
    _register(ledger, d, "positive control", score=0.2)
    _run(ledger, d, "permutation", 1e-6)
    _run(ledger, d, "positive control", 1e-6)
    assert d.e_value == pytest.approx(250.0)
    md = ledger.findings_markdown()
    assert "NOT RELEVANT, counts as e = 0" in md and "(not relevant)" in md


@pytest.mark.parametrize(
    ("score", "relevant"), [(1.0, True), (0.8, True), (0.6, False), (0.1, False)]
)
def test_relevance_is_decided_by_the_threshold_not_by_the_judge_s_word(
    score: float, relevant: bool
) -> None:
    ledger = Ledger()
    c = _claim(ledger)
    _register(ledger, c, "permutation", score=None)
    # Whatever the caller puts in `relevant`, the ledger computes it from the score.
    ledger.judge_relevance(c.id, "permutation", Relevance(score, not relevant, "why"))
    assert c.registered[0].relevance is not None
    assert c.registered[0].relevance.relevant is relevant and RELEVANCE_THRESHOLD == 0.8
    _run(ledger, c, "permutation", 1e-6)
    assert (c.verdict == "supported") is relevant


def test_a_judgement_without_a_score_is_not_relevant() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    _register(ledger, c, "permutation", score=None)
    ledger.judge_relevance(c.id, "permutation", Relevance(None, True, "no line for this test"))
    _run(ledger, c, "permutation", 1e-6)
    assert c.tests[0].counts is False and c.verdict == "insufficient"


def test_relevance_is_judged_once_and_before_the_run() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    _register(ledger, c, "permutation", score=None)
    with pytest.raises(ValueError, match="judged before it is run"):
        _run(ledger, c, "permutation", 1e-6)
    assert c.registered[0].run is None and c.tests == [] and not c.closed
    assert "not judged for relevance" in ledger.summary()
    ledger.judge_relevance(c.id, "permutation", Relevance(0.2, False, "about something else"))
    with pytest.raises(ValueError, match="already has a relevance judgement"):
        ledger.judge_relevance(c.id, "permutation", Relevance(1.0, True, "second opinion"))
    _run(ledger, c, "permutation", 1e-6)
    with pytest.raises(ValueError, match="already run"):  # never after the result is known
        ledger.judge_relevance(c.id, "permutation", Relevance(1.0, True, "now it looks good"))
    with pytest.raises(ValueError, match="no registered test"):
        ledger.judge_relevance(c.id, "another", Relevance(1.0, True, ""))
    assert c.verdict == "insufficient"


def test_the_relevance_judgement_is_its_own_ledger_entry_and_names_the_vendors() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    _register(ledger, c, "permutation", score=None)
    ledger.judge_relevance(
        c.id,
        "permutation",
        Relevance(
            0.8, True, "tests the contrast", 0.8, "relevance", "openai/gpt-x", "openai/gpt-y", True
        ),
    )
    assert ledger.events[-1] == {
        "kind": "test.relevance",
        "claim": "C1",
        "name": "permutation",
        "score": 0.8,
        "relevant": True,
        "reason": "tests the contrast",
        "threshold": 0.8,
        "judge": "relevance",
        "judge_model": "openai/gpt-x",
        "proposer_model": "openai/gpt-y",
        "same_vendor_as_proposer": True,
    }
    assert "judge on the proposer's vendor" in ledger.findings_markdown()


def test_an_irrelevant_test_cannot_refute_either() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    _register(ledger, c, "unrelated check", score=0.2)
    _run(ledger, c, "unrelated check", 1e-9, contradicts=True)
    assert c.verdict == "insufficient" and c.e_value == 0.0


# --- Counting -------------------------------------------------------------------------------------


def test_a_registered_test_without_a_result_counts_as_zero_and_blocks_support() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    _register(ledger, c, "permutation")
    _register(ledger, c, "held-out replicate")
    _run(ledger, c, "permutation", 1e-6)  # e = 500
    # The unfavourable test cannot be dropped: the mean is 250, above the threshold of 10,
    # and the claim is still not supported until the second registered test has a result.
    assert c.pending == ["held-out replicate"]
    assert c.e_value == pytest.approx(250.0) and c.verdict == "insufficient"
    _run(ledger, c, "Held-out  replicate", 0.9)
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
        _register(ledger, c, f"test {i}")
    with pytest.raises(ValueError, match="most a claim may have"):
        _register(ledger, c, "one more")
    for i in range(MAX_TESTS):
        _run(ledger, c, f"test {i}", 1e-6)
    assert c.verdict == "supported"
    # Over the cap, unregistered, after registration closed: still accepted, and it refutes.
    ledger.record_test(c.id, "late direction check", 1e-9, True, "went the other way", "critic")
    assert c.verdict == "refuted" and c.tests[-1].registered is False
    assert c.tests[-1].source == "model"
    # Even under a name that already has a result.
    ledger.record_test(c.id, "test 0", 0.5, True, "rerun went the other way", "critic")
    assert c.tests[-1].name == "test 0 (repeat 2)" and len(c.tests) == MAX_TESTS + 2
    # A weak contradiction does not refute, but it lowers the mean.
    other = _claim(ledger)
    _test(ledger, other, "permutation", 1e-6)
    before = other.e_value
    ledger.record_test(other.id, "direction", 0.4, True, "", "critic")
    assert other.verdict != "refuted" and other.e_value == pytest.approx((before + KAPPA) / 2)


def test_a_typed_contradiction_does_not_stand_in_for_a_registered_test() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    _register(ledger, c, "permutation")
    ledger.record_test(c.id, "permutation", 0.4, True, "went the other way", "critic")
    # It is an extra result against the claim; the registered script still has to be run.
    assert c.pending == ["permutation"] and c.tests[0].registered is False
    assert c.e_value == pytest.approx(KAPPA / 2)
    _run(ledger, c, "permutation", 1e-6)
    assert c.pending == [] and c.e_value == pytest.approx((KAPPA + 500) / 2)


def test_failed_replication_refutes() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    ledger.fail_replication(c.id, "edgeR finds 12 DEGs vs 480", "critic")
    assert c.verdict == "refuted"


# --- False support, measured through the ledger's own entry points --------------------------------

MODES = (
    "independent",
    "same",
    "best-of-100",
    "drop",
    "typed",
    "edit-after",
    "private-then-register",
    "irrelevant",
)


def _trial(rng: random.Random, mode: str, claims: int, judge_misses: float = 0.0) -> bool:
    """One run with `claims` true-null claims; True if any of them ends "supported".

    Under the null a p-value is uniform. Modes (the critic's behaviour):
      independent  three registered tests per claim, each with its own p;
      same         one test registered three times under different names (fully dependent);
      best-of-100  the critic runs a hundred tests in private and tries to type in the best one.
                   A typed-in favourable result is refused; what counts is the registered
                   script the harness runs: one draw, not the best;
      drop         the critic lets only the favourable registered tests through: it ran them in
                   private and breaks the scripts that came out badly (changed after
                   registration, so they have no result);
      typed        nothing is run; the critic types p = 1e-6 for a registered test;
      edit-after   one test is registered, then its script is reworked a hundred times and the
                   best version left in place: the hash no longer matches;
      private-then-register
                   a hundred different scripts are tried in private BEFORE registration and
                   the best one is registered. The harness reruns it and gets the same number.
                   Nothing in the code can see this: it is the stated limit;
      irrelevant   the registered test rejects whatever the claim (p = 1e-6): its null does not
                   follow from the claim's. Only the relevance judge stands in the way; it
                   lets the test through with probability `judge_misses`.
    """
    ledger = Ledger()
    family = [_claim(ledger) for _ in range(claims)]
    for claim in family:
        if mode in ("independent", "same", "drop"):
            names = [f"test {i}" for i in range(MAX_TESTS)]
            for name in names:
                _register(ledger, claim, name)
            draws = [rng.random()] * MAX_TESTS if mode == "same" else [rng.random() for _ in names]
            for name, p in zip(names, draws, strict=True):
                dropped = mode == "drop" and p > 0.05
                _run(ledger, claim, name, p, status="changed" if dropped else "ok")
            continue
        relevant = mode != "irrelevant" or rng.random() < judge_misses
        _register(ledger, claim, "test 0", score=1.0 if relevant else 0.2)
        if mode == "best-of-100":
            private = [rng.random() for _ in range(100)]
            with pytest.raises(ValueError):  # a typed-in favourable result is refused
                ledger.record_test(claim.id, "the best one", min(private), False, "", "critic")
            _run(ledger, claim, "test 0", private[0])
        elif mode == "typed":
            with pytest.raises(ValueError):
                ledger.record_test(claim.id, "test 0", 1e-6, False, "", "critic")
        elif mode == "edit-after":
            _run(ledger, claim, "test 0", min(rng.random() for _ in range(100)), status="changed")
        elif mode == "private-then-register":
            _run(ledger, claim, "test 0", min(rng.random() for _ in range(100)))
        else:
            _run(ledger, claim, "test 0", 1e-6)
    return any(c.verdict == "supported" for c in family)


def _family_error(mode: str, claims: int, trials: int, judge_misses: float = 0.0) -> float:
    rng = random.Random(claims * 7919 + len(mode))
    return sum(_trial(rng, mode, claims, judge_misses) for _ in range(trials)) / trials


SIZES = [(1, 20_000), (8, 6_000), (20, 3_000)]


@pytest.mark.parametrize("mode", ["independent", "same", "best-of-100", "drop"])
@pytest.mark.parametrize(("claims", "trials"), SIZES)
def test_type_one_error_is_controlled_through_the_ledger(
    mode: str, claims: int, trials: int
) -> None:
    # The scenarios of the two code reviews. With a product of e-values, the same test recorded
    # three times reached 10-18% and the best 3 of 20 reached 12-38% false support. With the mean
    # over pre-registered tests, P(any of the m true-null claims is supported) stays within
    # alpha for every m, whatever the dependence between a claim's tests.
    assert _family_error(mode, claims, trials) <= ALPHA


@pytest.mark.parametrize("mode", ["typed", "edit-after"])
@pytest.mark.parametrize(("claims", "trials"), SIZES)
def test_a_typed_or_reworked_result_never_supports(mode: str, claims: int, trials: int) -> None:
    # Before the harness ran the tests these were 100% (typed) and 22%, 3%, 1% (reworked).
    assert _family_error(mode, claims, trials // 10) == 0.0


@pytest.mark.parametrize(("claims", "trials"), SIZES)
def test_an_irrelevant_test_supports_only_as_often_as_the_judge_misses_it(
    claims: int, trials: int
) -> None:
    # Before the relevance judgement this was 100%. Now it is exactly the judge's miss rate,
    # per claim: the judge is a filter, and the bound is only as good as the judge.
    assert _family_error("irrelevant", claims, trials // 10) == 0.0
    for misses in (0.15, 0.5):
        expected = 1 - (1 - misses) ** claims
        assert _family_error("irrelevant", claims, trials // 4, misses) == pytest.approx(
            expected, abs=0.03
        )


def test_tests_tried_in_private_before_registration_still_break_the_bound() -> None:
    # The limit that remains, pinned so that nobody reads the rules as covering it: a script
    # chosen as the best of a hundred before it is registered reruns to the same p-value.
    assert _family_error("private-then-register", 1, 20_000) > 2 * ALPHA


def test_selecting_the_best_test_would_break_the_bound_without_registration() -> None:
    # What pre-registration prevents, shown by computing what the ledger refuses to record:
    # the best of a hundred null p-values passes the threshold far more often than alpha.
    rng = random.Random(1)
    passed = sum(p_to_e(min(rng.random() for _ in range(100))) >= 1 / ALPHA for _ in range(4_000))
    assert passed / 4_000 > ALPHA


def test_every_test_counts_and_a_contradiction_counts_against() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    _register(ledger, c, "direction")
    _register(ledger, c, "permutation")
    _run(ledger, c, "direction", 0.4, contradicts=True)
    assert c.tests[0].e_value == KAPPA  # not 1.0: unfavourable evidence is not censored
    assert c.verdict == "insufficient"  # p >= alpha, so not refuted either
    _run(ledger, c, "permutation", 0.9)
    assert c.e_value == pytest.approx((KAPPA + p_to_e(0.9)) / 2)


def test_a_test_name_is_accepted_once() -> None:
    ledger = Ledger()
    c = _claim(ledger)
    _register(ledger, c, "Label permutation")
    with pytest.raises(ValueError, match="already has a registered test"):
        _register(ledger, c, "label-permutation ")
    with pytest.raises(ValueError, match="method is empty"):
        _register(ledger, c, "other", method="  ")
    _run(ledger, c, "Label permutation", 0.3)
    with pytest.raises(ValueError, match="first run stands"):
        _run(ledger, c, "label-permutation ", 0.0001)
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
    with pytest.raises(ValueError, match="p_value"):
        ledger.record_test(c.id, "bad", bad, True, "", "critic")  # type: ignore[arg-type]
    assert c.tests == []


def test_the_ledger_json_has_exactly_these_fields() -> None:
    # The dashboard's Graph and Compare views read this file. A field added or renamed here
    # must be told to whoever owns those views.
    ledger = Ledger()
    c = _claim(ledger)
    _test(ledger, c, "permutation", 0.001)
    data = json.loads(ledger.to_json())
    assert set(data) == {
        "alpha",
        "kappa",
        "p_floor",
        "max_tests_per_claim",
        "combination",
        "relevance_threshold",
        "result_line",
        "test_results",
        "claims_in_family",
        "support_threshold",
        "claims",
        "issues",
        "events",
    }
    claim = data["claims"][0]
    assert set(claim) == {
        "id",
        "text",
        "artifact_ids",
        "proposed_by",
        "null_hypothesis",
        "tests",
        "replication_failed",
        "family",
        "registered",
        "e_value",
        "threshold",
        "verdict",
        "pending_tests",
    }
    assert set(claim["registered"][0]) == {
        "name",
        "method",
        "by",
        "test_null",
        "script_path",
        "script_sha256",
        "script_bytes",
        "script",
        "relevance",
        "run",
    }
    assert set(claim["registered"][0]["relevance"]) == {
        "score",
        "relevant",
        "reason",
        "threshold",
        "judge",
        "judge_model",
        "proposer_model",
        "same_vendor_as_proposer",
    }
    assert set(claim["registered"][0]["run"]) == {
        "status",
        "command",
        "exit_code",
        "seconds",
        "output_tail",
        "sha256_at_run",
        "p_value",
        "contradicts",
        "detail",
    }
    assert set(claim["tests"][0]) == {
        "name",
        "p_value",
        "contradicts",
        "note",
        "by",
        "registered",
        "source",
        "counts",
        "e_value",
    }
    assert data["relevance_threshold"] == 0.8
    assert data["result_line"] == "GLHF_RESULT p_value=<number in [0, 1]> contradicts=<true|false>"


def test_findings_state_the_guarantee_its_assumptions_and_unchecked_fixes() -> None:
    ledger = Ledger()
    claim = _claim(ledger)
    _register(ledger, claim, "permutation", method="permute labels 10000 times")
    _register(ledger, claim, "held-out replicate", method="refit without replicate 3")
    _run(ledger, claim, "permutation", 0.2)
    first = ledger.raise_issue("major", ["degs"], "wrong threshold", "grep", "critic")
    ledger.resolve_issue(first.id, "fixed", "set padj < 0.05", "experimenter")
    assert ledger.mark_rechecked() == [first.id]  # a critic round completed after the fix
    second = ledger.raise_issue("major", ["degs"], "wrong sort", "head", "critic")
    ledger.resolve_issue(second.id, "fixed", "sorted by padj", "experimenter")
    md = ledger.findings_markdown()
    assert "under any dependence between its registered tests" in md
    # What code checks, and what it does not, said in every report.
    assert "produced by running the registered file, unchanged since registration" in md
    assert "whether the script is a meaningful test" in md
    assert "ran the script or explored the data before registering it" in md
    assert "a favourable one never" in md and "independent" not in md
    assert "registered: held-out replicate. refit without replicate 3" in md
    assert "NO RESULT: not run (counts as e = 0)" in md
    assert md.count("fixed, not re-checked by the critic") == 1
    assert "sorted by padj (fixed, not re-checked by the critic)" in md
    summary = ledger.summary()
    assert "registered, no result: held-out replicate (not run)" in summary
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
    assert "(typed in by a role, not pre-registered)" in md  # the contradicting test
    assert "critic issues fixed before reporting (1)" in md and "contrast reversed" in md
    data = json.loads(ledger.to_json())
    assert [c["verdict"] for c in data["claims"]] == ["supported", "refuted"]
    assert ledger.open_issues() == []
