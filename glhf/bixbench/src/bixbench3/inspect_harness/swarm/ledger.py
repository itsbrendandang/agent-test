"""The swarm's shared world model: claims, falsification tests, critic issues.

Everything here is deterministic. Agents propose claims and record test results through tools;
the verdict on each claim is computed by code, never by a model.

Falsification follows Popper (Huang et al., ICML 2025): each claim has a null hypothesis
("the claimed effect is absent"). Every falsification test the critic runs yields a p-value
under that null. p-values are converted to e-values with the calibrator e = k * p^(k-1)
(k = 0.5), and a claim's e-values are combined by their ARITHMETIC MEAN. The mean of e-values is
an e-value whatever the dependence between the tests (a product is one only if they are
independent, which the code cannot check), so by Markov's inequality a true null reaches a mean
of m/alpha with probability <= alpha/m.

What the code enforces:
  - a test is a script. It is registered (name, method, the test's own null, the script's path
    and the SHA-256 of its content) before any result of that claim exists, and registration
    closes at the claim's first result or first run. So the tests that count are fixed before
    their outcomes are recorded, and the best few of many cannot be picked afterwards;
  - relevance, between registration and run: a separate model call that is shown the claim, its
    null and the registered test (never a result, never the experimenter's reasoning) rates
    whether the test's null follows from the claim's null (Popper's Assumption 1 and relevance
    checker). Below RELEVANCE_THRESHOLD, or without a judgement, the test cannot support or
    refute: it counts as e = 0. It may still be run and its result is recorded;
  - the harness runs the test, not the model: the file at the registered path must still have
    the registered hash, the registered content is what is executed, and the p-value is parsed
    from the last line of its output (RESULT_LINE). A p-value typed in by a model is never
    accepted as support. A script that changed, is missing, exits non-zero, times out or prints
    no parsable last line has no result: it counts as e = 0, like any registered test without
    a result. Command, exit code, runtime and the end of the output are kept;
  - every registered test counts. One without a result counts as e = 0 and keeps the claim from
    being "supported"; a result that contradicts contributes KAPPA (the calibrated e-value of
    p = 1), never more;
  - at most MAX_TESTS registered tests per claim and one run per registered test. A
    CONTRADICTING result typed in by a role is never refused, registered or not, over the cap or
    not: it can only lower the mean and it can refute;
  - Bonferroni across the m registered claims: support needs a mean >= m/alpha, refutation needs
    a contradicting test with p < alpha/m;
  - p is floored at P_FLOOR = 1e-6, so one p = 0 is worth at most e = 500.
The guarantee: a true-null claim is "supported" with probability <= alpha/m, under any dependence
between its registered tests, IF each counted script computes a valid p-value under a null that
the claim's null implies, and the script was not chosen or tuned on the data it tests.
What the code now proves by itself: the number came from running the registered file, unchanged
since registration, and nobody typed it. What it still cannot prove: that the script is a
meaningful test (it may print a constant, or compute an invalid p-value); that the relevance
judgement is right (it is a model's reading, a filter and not a proof); that the model did not
run the script, or look at the data, before registering it (the sandbox is the model's own
workshop); and the refutation rule (a true claim can be refuted by one bad contradicting test).

Verdicts (m = number of registered claims):
  supported     every registered test has a result and their mean e-value is >= m/alpha
  refuted       a test contradicts the claim with p < alpha/m, or a replication failed
  insufficient  neither, after a result was recorded (reported, never presented as a finding)
  untested      no result recorded
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import asdict, dataclass, field
from decimal import ROUND_FLOOR, Decimal
from typing import Literal

ALPHA = 0.1  # family-wise, across all registered claims (Bonferroni)
KAPPA = 0.5
P_FLOOR = 1e-6  # finer p-values are not credible from permutations or bootstraps; caps e at 500
RELEVANCE_THRESHOLD = 0.8  # a test below this cannot support; see relevance.py for the rubric
# The last non-empty line a registered test script must print. Parsed by code, nothing else is.
RESULT_LINE = "GLHF_RESULT p_value=<number in [0, 1]> contradicts=<true|false>"
_RESULT = re.compile(r"GLHF_RESULT p_value=(\S+) contradicts=(true|false)")
MAX_SCRIPT_BYTES = 64 * 1024  # a registered script is kept whole in the ledger
OUTPUT_TAIL_CHARS = 2000
UNREVIEWED = "review.none"  # event: review was planned and no critic completed a pass
MAX_TESTS = 3  # registered tests per claim; see the module docstring

Verdict = Literal["supported", "refuted", "insufficient", "untested"]
Severity = Literal["blocking", "major", "minor"]
RunStatus = Literal["ok", "changed", "missing", "failed", "timeout", "unparsable"]


def p_to_e(p: float, kappa: float = KAPPA) -> float:
    """Calibrate a p-value into an e-value (Vovk & Wang). Valid for any kappa in (0, 1)."""
    p = min(1.0, max(P_FLOOR, float(p)))
    return float(kappa * p ** (kappa - 1))


def p_needed(threshold: float, kappa: float = KAPPA) -> float | None:
    """The largest p-value whose calibrated e-value reaches `threshold`: what ONE registered test
    must reach to support a claim on its own. None when no p-value can (e is capped at P_FLOOR's)."""
    if p_to_e(P_FLOOR, kappa) < threshold:
        return None
    p = min(1.0, (kappa / threshold) ** (1 / (1 - kappa)))
    while p > P_FLOOR and p_to_e(p, kappa) < threshold:  # floating-point rounding
        p = math.nextafter(p, 0.0)
    return p


def p_shown(p: float) -> str:
    """`p` rounded DOWN to two significant digits, so the value shown still reaches the bar."""
    step = Decimal(f"1e{math.floor(math.log10(p)) - 1}")
    return f"{float(Decimal(repr(p)).quantize(step, ROUND_FLOOR)):.2g}"


def permutations_needed(threshold: float) -> int | None:
    """The fewest permutations with which a permutation test can reach `threshold` on its own:
    its smallest p-value is 1 / (permutations + 1). None when no p-value can (p_needed)."""
    p = p_needed(threshold)
    if p is None:
        return None
    count = max(0, math.ceil(1 / p) - 1)
    while count > 0 and p_to_e(1 / count) >= threshold:  # floating-point rounding
        count -= 1
    while p_to_e(1 / (count + 1)) < threshold:
        count += 1
    return count


def normalised_name(name: str) -> str:
    """Test names compared without case, punctuation or spacing, so a repeat is recognised."""
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


@dataclass
class Test:
    name: str
    p_value: float
    contradicts: bool
    note: str
    by: str
    registered: bool = True  # False: a contradicting result recorded without registration
    source: Literal["harness", "model"] = "model"  # who produced the number
    counts: bool = True  # False: judged not relevant (or not judged): worth e = 0, cannot refute

    @property
    def e_value(self) -> float:
        if not self.counts:
            return 0.0
        # A result that goes against the claim has a one-sided p >= 0.5 in the claim's direction,
        # whose calibrated e-value is at least KAPPA; using KAPPA is the conservative choice.
        return KAPPA if self.contradicts else p_to_e(self.p_value)


def parse_result_line(output: str) -> tuple[float, bool] | None:
    """(p-value, contradicts) from the last non-empty line of a test's output, or None when
    that line is not exactly RESULT_LINE with a number in [0, 1]."""
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    found = _RESULT.fullmatch(lines[-1]) if lines else None
    if not found:
        return None
    try:
        p_value = float(found.group(1))
    except ValueError:
        return None
    if math.isnan(p_value) or not 0.0 <= p_value <= 1.0:
        return None
    return p_value, found.group(2) == "true"


@dataclass
class Relevance:
    """One judgement of whether a registered test bears on its claim, made before the run."""

    score: float | None  # 0.1 to 1.0 on the rubric; None: the judge gave no usable answer
    relevant: bool  # score >= threshold
    reason: str
    threshold: float = RELEVANCE_THRESHOLD
    judge: str = "relevance"
    judge_model: str = ""
    proposer_model: str = ""
    same_vendor_as_proposer: bool | None = None  # True: judge and proposer share blind spots


@dataclass
class Run:
    """What the harness saw when it executed a registered script. `status` "ok" is the only one
    with a result; every other status leaves the test without one (e = 0)."""

    status: RunStatus
    command: list[str] = field(default_factory=list)
    exit_code: int | None = None
    seconds: float = 0.0
    output_tail: str = ""
    sha256_at_run: str | None = None  # of the file found at the registered path
    p_value: float | None = None
    contradicts: bool | None = None
    detail: str = ""


@dataclass
class Registration:
    name: str
    method: str  # what will be run, and which outcome would contradict the claim
    by: str
    test_null: str = ""  # the null the script's p-value is computed under
    script_path: str | None = None  # in the sandbox
    script_sha256: str | None = None  # of the content at registration
    script_bytes: int = 0
    script: str = ""  # the registered content: this is what the harness executes
    relevance: Relevance | None = None
    run: Run | None = None


def _state(entry: Registration) -> str:
    """Why a registered test has no result, in words; "" when it has one."""
    if entry.run is not None:
        return "" if entry.run.status == "ok" else f"run {entry.run.status}"
    if entry.script_sha256 is None:
        return "no script"
    return "not judged for relevance" if entry.relevance is None else "not run"


@dataclass
class Claim:
    id: str
    text: str
    artifact_ids: list[str]
    proposed_by: str
    null_hypothesis: str
    tests: list[Test] = field(default_factory=list)
    replication_failed: bool = False
    family: int = 1  # number of registered claims; set by the ledger
    registered: list[Registration] = field(default_factory=list)

    @property
    def pending(self) -> list[str]:
        """Registered tests without a result: not run yet, or run without a parsable result."""
        return [r.name for r in self.registered if r.run is None or r.run.status != "ok"]

    @property
    def closed(self) -> bool:
        """No more tests may be registered: the claim has a result, or a test of it was run."""
        return bool(self.tests) or any(r.run is not None for r in self.registered)

    def registration(self, name: str) -> Registration | None:
        key = normalised_name(name)
        return next((r for r in self.registered if normalised_name(r.name) == key), None)

    @property
    def e_value(self) -> float:
        """Mean e-value over every registered test (no result = 0) and every recorded result."""
        count = len(self.tests) + len(self.pending)
        return sum(t.e_value for t in self.tests) / count if count else 1.0

    @property
    def threshold(self) -> float:
        return max(1, self.family) / ALPHA

    @property
    def verdict(self) -> Verdict:
        refute_below = ALPHA / max(1, self.family)
        if self.replication_failed or any(
            t.contradicts and t.counts and t.p_value < refute_below for t in self.tests
        ):
            return "refuted"
        if not self.tests:
            return "untested"
        if self.pending:
            return "insufficient"  # a registered test without a result cannot be left out
        return "supported" if self.e_value >= self.threshold else "insufficient"


@dataclass
class Issue:
    id: str
    severity: Severity
    artifact_ids: list[str]
    problem: str
    evidence: str
    raised_by: str
    status: Literal["open", "fixed", "wontfix"] = "open"
    resolution: str = ""
    rechecked: bool = False  # a critic round completed after the fix
    claim_ids: list[str] = field(default_factory=list)  # the claims it is about (claims engine)


@dataclass
class Ledger:
    claims: dict[str, Claim] = field(default_factory=dict)
    issues: dict[str, Issue] = field(default_factory=dict)
    events: list[dict[str, object]] = field(default_factory=list)

    def log(self, kind: str, **detail: object) -> None:
        self.events.append({"kind": kind, **detail})

    # Claims -------------------------------------------------------------------------------
    def add_claim(self, text: str, artifact_ids: list[str], null_hypothesis: str, by: str) -> Claim:
        claim = Claim(
            f"C{len(self.claims) + 1}", text.strip(), artifact_ids, by, null_hypothesis.strip()
        )
        self.claims[claim.id] = claim
        for each in self.claims.values():
            each.family = len(self.claims)
        self.log("claim.added", claim=claim.id, by=by, text=claim.text)
        return claim

    def register_test(
        self,
        claim_id: str,
        name: str,
        method: str,
        by: str,
        *,
        script_path: str | None = None,
        script: str | None = None,
        test_null: str = "",
    ) -> Claim:
        """Pre-register a falsification test before any result exists: its name, its method, and
        the script that is the test (path and content; the hash is taken here). A registration
        without a script is recorded but can never be run, so it can never support."""
        claim = self.claims[claim_id]
        key = normalised_name(name)
        if not key:
            raise ValueError("test_name is empty")
        if not method.strip():
            raise ValueError("method is empty: say what you will run and what would contradict")
        if claim.closed:
            raise ValueError(
                f"registration for {claim_id} is closed: it already has a result. Tests must be "
                "registered before any of them is run."
            )
        if any(normalised_name(r.name) == key for r in claim.registered):
            raise ValueError(f"{claim_id} already has a registered test named {name!r}")
        if len(claim.registered) >= MAX_TESTS:
            raise ValueError(
                f"{claim_id} already has {MAX_TESTS} registered tests, the most a claim may have"
            )
        entry = Registration(name.strip(), method.strip(), by, test_null.strip())
        if script is not None:
            size = len(script.encode("utf-8"))
            if not script.strip():
                raise ValueError("the test script is empty")
            if size > MAX_SCRIPT_BYTES:
                raise ValueError(
                    f"the test script is {size} bytes; the most a registered test may be is "
                    f"{MAX_SCRIPT_BYTES} (put the data handling in the script, not data)"
                )
            entry.script_path, entry.script, entry.script_bytes = script_path, script, size
            entry.script_sha256 = hashlib.sha256(script.encode("utf-8")).hexdigest()
        claim.registered.append(entry)
        self.log(
            "test.registered",
            claim=claim_id,
            name=name,
            method=method.strip(),
            test_null=entry.test_null,
            script_path=entry.script_path,
            script_sha256=entry.script_sha256,
            script_bytes=entry.script_bytes,
            by=by,
        )
        return claim

    def judge_relevance(self, claim_id: str, name: str, relevance: Relevance) -> Claim:
        """Record the relevance judgement of a registered test. Once, and before its run."""
        claim = self.claims[claim_id]
        entry = claim.registration(name)
        if entry is None:
            raise ValueError(f"{claim_id} has no registered test named {name!r}")
        if entry.run is not None:
            raise ValueError(f"{claim_id} / {name!r} was already run: relevance is judged first")
        if entry.relevance is not None:
            raise ValueError(f"{claim_id} / {name!r} already has a relevance judgement")
        relevance.relevant = relevance.score is not None and relevance.score >= relevance.threshold
        entry.relevance = relevance
        self.log("test.relevance", claim=claim_id, name=entry.name, **asdict(relevance))
        return claim

    def record_run(self, claim_id: str, name: str, run: Run) -> Claim:
        """Record what the harness saw when it ran a registered script. The only way a
        favourable result enters the ledger. Needs a relevance judgement first; one run per
        registered test; the hash at run time must be the registered one for a result."""
        claim = self.claims[claim_id]
        entry = claim.registration(name)
        if entry is None or entry.script_sha256 is None:
            raise ValueError(f"{claim_id} has no registered test script named {name!r}")
        if entry.relevance is None:
            raise ValueError(
                f"{claim_id} / {name!r} has no relevance judgement: it is judged before it is run"
            )
        if entry.run is not None:
            raise ValueError(f"{claim_id} / {name!r} was already run; the first run stands")
        if run.status == "ok" and run.sha256_at_run != entry.script_sha256:
            run.status, run.detail = "changed", "the script is not the registered one"
        if run.status == "ok" and (
            run.p_value is None
            or run.contradicts is None
            or isinstance(run.p_value, bool)
            or math.isnan(run.p_value)
            or not 0.0 <= run.p_value <= 1.0
        ):
            run.status, run.detail = "unparsable", "no p-value in [0, 1] on the last line"
        if run.status != "ok":
            run.p_value = run.contradicts = None
        run.output_tail = run.output_tail[-OUTPUT_TAIL_CHARS:]
        entry.run = run
        counts = entry.relevance.relevant
        if run.status == "ok":
            assert run.p_value is not None and run.contradicts is not None
            claim.tests.append(
                Test(
                    entry.name,
                    float(run.p_value),
                    run.contradicts,
                    f"run by the harness: {entry.script_path} (sha256 {entry.script_sha256[:12]})"
                    + ("" if counts else "; judged not relevant, counts as e = 0"),
                    "harness",
                    registered=True,
                    source="harness",
                    counts=counts,
                )
            )
        self.log(
            "test.executed",
            claim=claim_id,
            name=entry.name,
            status=run.status,
            command=run.command,
            exit_code=run.exit_code,
            seconds=round(run.seconds, 3),
            output_tail=run.output_tail,
            script_sha256=entry.script_sha256,
            sha256_at_run=run.sha256_at_run,
            detail=run.detail,
            p=run.p_value,
            contradicts=run.contradicts,
            counts=counts,
        )
        if run.status == "ok":
            self.log(
                "test.recorded",
                claim=claim_id,
                name=entry.name,
                p=run.p_value,
                contradicts=run.contradicts,
                registered=True,
                source="harness",
                counts=counts,
                e=round(claim.e_value, 4),
                verdict_at_the_time=claim.verdict,
                by="harness",
            )
        return claim

    def record_test(
        self, claim_id: str, name: str, p_value: float, contradicts: bool, note: str, by: str
    ) -> Claim:
        """Record a result a role typed in. Only a CONTRADICTING one: it can lower the mean and
        it can refute, never support. A favourable result comes from the harness (record_run)."""
        claim = self.claims[claim_id]
        if isinstance(p_value, bool) or not isinstance(p_value, (int, float)):
            raise ValueError("p_value must be a number in [0, 1], not a boolean or text")
        if math.isnan(p_value) or not 0.0 <= p_value <= 1.0:
            raise ValueError("p_value must be in [0, 1]")
        key = normalised_name(name)
        if not key:
            raise ValueError("test_name is empty")
        if not bool(contradicts):
            raise ValueError(
                "a result typed in by a role cannot support a claim. Register the test as a "
                "script with register_falsification_test; the harness runs the registered file "
                "and reads the p-value from its last line. Only a result that contradicts the "
                "claim can be reported by hand."
            )
        again = re.compile(re.escape(key) + r"( repeat \d+)?")
        repeats = sum(1 for t in claim.tests if again.fullmatch(normalised_name(t.name)))
        label = name.strip()
        if repeats:
            label = f"{label} (repeat {repeats + 1})"
        claim.tests.append(
            Test(label, float(p_value), True, note.strip(), by, registered=False, source="model")
        )
        self.log(
            "test.recorded",
            claim=claim_id,
            name=label,
            p=p_value,
            contradicts=True,
            registered=False,
            source="model",
            counts=True,
            e=round(claim.e_value, 4),
            # Only what was true when this result came in. A claim registered later raises the
            # threshold of every claim, so the verdict that counts is the one in "claims".
            verdict_at_the_time=claim.verdict,
            by=by,
        )
        return claim

    def fail_replication(self, claim_id: str, note: str, by: str) -> Claim:
        claim = self.claims[claim_id]
        claim.replication_failed = True
        if not any(normalised_name(t.name) == "independent replication" for t in claim.tests):
            claim.tests.append(
                Test("independent replication", 1.0, True, note.strip(), by, registered=False)
            )
        self.log("replication.failed", claim=claim_id, note=note, by=by)
        return claim

    # Issues -------------------------------------------------------------------------------
    def raise_issue(
        self,
        severity: Severity,
        artifact_ids: list[str],
        problem: str,
        evidence: str,
        by: str,
        claim_ids: list[str] | None = None,
    ) -> Issue:
        issue = Issue(
            f"I{len(self.issues) + 1}",
            severity,
            artifact_ids,
            problem.strip(),
            evidence.strip(),
            by,
            claim_ids=list(claim_ids or []),
        )
        self.issues[issue.id] = issue
        self.log("issue.raised", issue=issue.id, severity=severity, problem=issue.problem, by=by)
        return issue

    def flag_refuted(self, by: str = "harness") -> list[Issue]:
        """Raise one major issue on the artifacts of each refuted claim that has none from `by`
        yet, and return the new ones. A refutation (a counted contradicting test, or a failed
        replication) often means an artifact is wrong: a swapped contrast, a flipped sign, a
        mislabelled sample. As an open issue it reaches the Reviser, who fixes the artifact or
        closes the issue as wontfix with the command and output that show it is right. "major",
        not "blocking": the refuted verdict is not error-controlled, one mistaken test can refute
        a true claim. The verdict itself is unchanged; this only routes it to a revision."""
        raised: list[Issue] = []
        for claim in self.claims.values():
            if claim.verdict != "refuted":
                continue
            if any(claim.id in i.claim_ids and i.raised_by == by for i in self.issues.values()):
                continue
            refute_below = ALPHA / max(1, claim.family)
            reasons = [
                f"{t.name}: p = {t.p_value:.3g}, contradicts. {t.note}".strip()
                for t in claim.tests
                if t.contradicts
                and t.counts
                and t.p_value < refute_below
                and normalised_name(t.name) != "independent replication"
            ]
            if claim.replication_failed:
                failed = [
                    t for t in claim.tests if normalised_name(t.name) == "independent replication"
                ]
                reasons.insert(
                    0, f"independent replication failed. {failed[0].note if failed else ''}".strip()
                )
            raised.append(
                self.raise_issue(
                    "major",
                    list(claim.artifact_ids),
                    f"Claim {claim.id} was refuted: {claim.text} Check the artifacts it rests on "
                    "(contrast direction, sign, sample labels, filters) and fix them, or close "
                    "this issue as wontfix with the command and output that show they are right "
                    "and the test was wrong.",
                    " | ".join(reasons) or "refuted by the ledger",
                    by,
                    claim_ids=[claim.id],
                )
            )
        return raised

    def resolve_issue(
        self, issue_id: str, status: Literal["fixed", "wontfix"], resolution: str, by: str
    ) -> Issue:
        issue = self.issues[issue_id]
        issue.status, issue.resolution, issue.rechecked = status, resolution.strip(), False
        self.log("issue.resolved", issue=issue_id, status=status, by=by)
        return issue

    def open_issues(self, severities: tuple[Severity, ...] = ("blocking", "major")) -> list[Issue]:
        return [i for i in self.issues.values() if i.status == "open" and i.severity in severities]

    def mark_rechecked(self) -> list[str]:
        """Call when a critic round completes: fixes that survived it count as re-checked."""
        ids = [i.id for i in self.issues.values() if i.status == "fixed" and not i.rechecked]
        for issue_id in ids:
            self.issues[issue_id].rechecked = True
        if ids:
            self.log("issues.rechecked", issues=ids)
        return ids

    # Views --------------------------------------------------------------------------------
    def to_json(self) -> str:
        return json.dumps(
            {
                "alpha": ALPHA,
                "kappa": KAPPA,
                "p_floor": P_FLOOR,
                "max_tests_per_claim": MAX_TESTS,
                "combination": "mean of e-values over registered tests (no result = 0)",
                "relevance_threshold": RELEVANCE_THRESHOLD,
                "result_line": RESULT_LINE,
                "test_results": "run by the harness from the registered script; a typed-in "
                "result is accepted only when it contradicts",
                "claims_in_family": len(self.claims),
                "support_threshold": max(1, len(self.claims)) / ALPHA,
                "claims": [
                    {
                        **asdict(c),
                        "e_value": c.e_value,
                        "threshold": c.threshold,
                        "verdict": c.verdict,
                        "pending_tests": c.pending,
                        "tests": [{**asdict(t), "e_value": t.e_value} for t in c.tests],
                    }
                    for c in self.claims.values()
                ],
                "issues": [asdict(i) for i in self.issues.values()],
                "events": self.events,
            },
            indent=2,
            default=str,
        )

    def summary(self) -> str:
        """Compact text the agents see: never vote tallies, only claims, evidence and open issues."""
        m = max(1, len(self.claims))
        lines = [
            f"Claims (verdict by code; alpha={ALPHA} shared by {m} claims. Supported: every "
            f"registered test has a result and their mean e-value is >= {m / ALPHA:g}. Refuted: a "
            f"contradicting test with p < {ALPHA / m:.3g}, or a failed replication. A test is a "
            f"script: register at most {MAX_TESTS} per claim BEFORE any is run. Each is judged "
            "for relevance, then run by the harness, which reads the p-value from the script's "
            "last line. A test without a result, or judged not relevant, counts as zero; a "
            "typed-in result is accepted only when it contradicts):"
        ]
        needed, permutations = p_needed(m / ALPHA), permutations_needed(m / ALPHA)
        lines.append(
            f"One registered test supports a claim on its own only with p <= {p_shown(needed)} (a "
            f"permutation test needs at least {permutations:,} permutations; an "
            "analytic test can go lower). A claim's tests are averaged: every further test of it "
            "must be as strong, or it pulls the claim below the bar. The bar rises with each "
            "claim registered."
            if needed is not None and permutations is not None
            else f"No single test can reach the bar of {m / ALPHA:g}: p is floored at {P_FLOOR:g} "
            f"(e at most {p_to_e(P_FLOOR):g}), so no claim can be supported with {m} claims."
        )
        for c in self.claims.values():
            tests = "; ".join(
                f"{t.name}: p={t.p_value:.3g}{' CONTRADICTS' if t.contradicts else ''}"
                + ("" if t.counts else " (not relevant: counts 0)")
                for t in c.tests
            )
            waiting = ", ".join(f"{r.name} ({_state(r)})" for r in c.registered if _state(r))
            state = "closed" if c.closed else f"open, {MAX_TESTS - len(c.registered)} left"
            lines.append(
                f"- {c.id} [{c.verdict}, mean e={c.e_value:.3g}] {c.text} (artifacts: {', '.join(c.artifact_ids)})"
                + f"\n    null: {c.null_hypothesis}"
                + f"\n    test registration: {state}"
                + (f"\n    registered, no result: {waiting}" if waiting else "")
                + (f"\n    tests: {tests}" if tests else "")
            )
        lines.append("Issues:")
        for i in self.issues.values():
            lines.append(
                f"- {i.id} [{i.severity}/{i.status}] ({', '.join(i.artifact_ids)}) {i.problem}"
                + (f" -> {i.resolution}" if i.resolution else "")
                + (
                    " (fix not yet re-checked by the critic)"
                    if i.status == "fixed" and not i.rechecked
                    else ""
                )
            )
        return "\n".join(lines)

    def findings_markdown(self) -> str:
        def section(title: str, verdicts: set[str]) -> list[str]:
            rows = [c for c in self.claims.values() if c.verdict in verdicts]
            out = [f"## {title} ({len(rows)})", ""]
            for c in rows:
                out.append(f"### {c.id}. {c.text}")
                out.append(f"- Artifacts: {', '.join(c.artifact_ids)}; proposed by {c.proposed_by}")
                out.append(f"- Null hypothesis: {c.null_hypothesis}")
                out.append(f"- Mean e-value: {c.e_value:.3g} (threshold {c.threshold:g})")
                for r in c.registered:
                    waiting = f" NO RESULT: {_state(r)} (counts as e = 0)" if _state(r) else ""
                    script = (
                        f" Script {r.script_path}, sha256 {r.script_sha256[:12]}."
                        if r.script_sha256
                        else " No script: cannot be run."
                    )
                    judged = ""
                    if r.relevance is not None:
                        score = (
                            "no score" if r.relevance.score is None else f"{r.relevance.score:g}"
                        )
                        judged = (
                            f" Relevance {score} (needs {r.relevance.threshold:g}): "
                            f"{'relevant' if r.relevance.relevant else 'NOT RELEVANT, counts as e = 0'}"
                            + (
                                "; judge on the proposer's vendor"
                                if r.relevance.same_vendor_as_proposer
                                else ""
                            )
                            + "."
                        )
                    out.append(
                        f"  - registered: {r.name}. {r.method}{script}{judged} [{r.by}]{waiting}"
                    )
                for t in c.tests:
                    tag = " (contradicts)" if t.contradicts else ""
                    tag += "" if t.registered else " (typed in by a role, not pre-registered)"
                    tag += "" if t.counts else " (not relevant)"
                    out.append(
                        f"  - {t.name}: p = {t.p_value:.3g}, e = {t.e_value:.3g}{tag}. {t.note} [{t.by}]"
                    )
                out.append("")
            return out

        m = max(1, len(self.claims))
        fixed = [i for i in self.issues.values() if i.status == "fixed"]
        unreviewed = (
            [
                "## NOT REVIEWED",
                "",
                "Review was planned and no critic completed a pass (event `review.none`). The "
                "artifacts are the first pass, unchecked: no claim below was tested to the end, "
                "and nothing in this run should be read as a reviewed result.",
                "",
            ]
            if any(e.get("kind") == UNREVIEWED for e in self.events)
            else []
        )
        unresolved = [i for i in self.issues.values() if i.status != "fixed"]
        lines = [
            "# GLHF swarm: findings and rejections",
            "",
            f"Verdicts are computed in code from falsification tests (e-values, alpha = {ALPHA}). "
            "A claim counts as a finding only if it survived falsification.",
            "",
            f"Error control and its limits. alpha = {ALPHA} is shared by the {m} registered claims "
            f"(Bonferroni). A claim is supported when every test registered for it has a result and "
            f"the mean of their e-values reaches {m / ALPHA:g}; it is refuted when a test contradicts "
            f"it with p < {ALPHA / m:.3g} or a replication fails. A test is a script, registered "
            f"with its content hash (at most {MAX_TESTS} per claim) before the claim has any "
            "result. Before it is run, a separate model call that sees no result judges whether "
            f"the test bears on the claim; under {RELEVANCE_THRESHOLD:g} it counts as e = 0. The "
            "harness then runs the registered file and reads the p-value from its last line; a "
            "script that changed, failed, timed out or printed no value has no result and counts "
            f"as e = 0. A contradicting test counts as e = {KAPPA}; one typed in by a role is "
            "always accepted, a favourable one never. "
            f"Guarantee: a claim whose null is true is supported with probability at most "
            f"{ALPHA / m:.3g} (alpha / m), under any dependence between its registered tests. "
            "Assumptions: each counted script computes a valid p-value under a null that the "
            "claim's null implies, and it was not chosen or tuned on the data it tests. "
            "Checked by code: the number was produced by running the registered file, unchanged "
            "since registration. Not checked: whether the script is a meaningful test (it could "
            "print a constant), whether the relevance judgement (a model's reading) is right, "
            "and whether the model ran the script or explored the data before registering it. "
            "A true claim can be refuted by one mistaken contradicting test. The registered "
            "scripts are in the ledger with their hashes.",
            "",
            *unreviewed,
            *section("Supported findings", {"supported"}),
            *section("Rejected claims", {"refuted"}),
            *section(
                "Not established (insufficient evidence; not reported as findings)",
                {"insufficient", "untested"},
            ),
            f"## Rejected analyses: critic issues fixed before reporting ({len(fixed)})",
            "",
            *[
                f"- {i.id} [{i.severity}] {', '.join(i.artifact_ids)}: {i.problem} Evidence: {i.evidence} "
                f"Fix: {i.resolution}"
                + ("" if i.rechecked else " (fixed, not re-checked by the critic)")
                for i in fixed
            ],
            "",
            f"## Unresolved issues ({len(unresolved)})",
            "",
            *[
                f"- {i.id} [{i.severity}/{i.status}] {', '.join(i.artifact_ids)}: {i.problem} {i.resolution}"
                for i in unresolved
            ],
            "",
        ]
        return "\n".join(lines)
