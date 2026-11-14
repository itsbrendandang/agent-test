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

What the code enforces, because the p-values are reported by a model and cannot be re-derived here:
  - pre-registration: a test is registered (name and what would contradict the claim) before any
    result of that claim exists; a favourable result is accepted only under a registered name,
    and registration closes at the claim's first result. So the tests that count are fixed before
    their outcomes are known, and the best few of many cannot be picked afterwards;
  - every registered test counts. One without a result counts as e = 0 and keeps the claim from
    being "supported"; a test marked `contradicts` contributes KAPPA (the calibrated e-value of
    p = 1), never more;
  - at most MAX_TESTS registered tests per claim and one result per test name. A CONTRADICTING
    result is never refused, registered or not, over the cap or not: it can only lower the mean
    and it can refute;
  - Bonferroni across the m registered claims: support needs a mean >= m/alpha, refutation needs
    a contradicting test with p < alpha/m;
  - p is floored at P_FLOOR = 1e-6, so one self-reported p = 0 is worth at most e = 500.
The guarantee: a true-null claim is "supported" with probability <= alpha/m, under any dependence
between its registered tests, IF each reported p-value is a valid p-value from code that was run
and no test was run privately before it was registered. What is not controlled: a dishonest or
miscomputed p-value, tests tried in private and then registered, and the refutation rule (a true
claim can be refuted by one bad contradicting test).

Verdicts (m = number of registered claims):
  supported     every registered test has a result and their mean e-value is >= m/alpha
  refuted       a test contradicts the claim with p < alpha/m, or a replication failed
  insufficient  neither, after a result was recorded (reported, never presented as a finding)
  untested      no result recorded
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import asdict, dataclass, field
from typing import Literal

ALPHA = 0.1  # family-wise, across all registered claims (Bonferroni)
KAPPA = 0.5
P_FLOOR = 1e-6  # finer p-values are not credible from permutations or bootstraps; caps e at 500
UNREVIEWED = "review.none"  # event: review was planned and no critic completed a pass
MAX_TESTS = 3  # registered tests per claim; see the module docstring

Verdict = Literal["supported", "refuted", "insufficient", "untested"]
Severity = Literal["blocking", "major", "minor"]


def p_to_e(p: float, kappa: float = KAPPA) -> float:
    """Calibrate a p-value into an e-value (Vovk & Wang). Valid for any kappa in (0, 1)."""
    p = min(1.0, max(P_FLOOR, float(p)))
    return float(kappa * p ** (kappa - 1))


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

    @property
    def e_value(self) -> float:
        # A result that goes against the claim has a one-sided p >= 0.5 in the claim's direction,
        # whose calibrated e-value is at least KAPPA; using KAPPA is the conservative choice.
        return KAPPA if self.contradicts else p_to_e(self.p_value)


@dataclass
class Registration:
    name: str
    method: str  # what will be run, and which outcome would contradict the claim
    by: str


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
        """Registered tests that have no result yet."""
        done = {normalised_name(t.name) for t in self.tests}
        return [r.name for r in self.registered if normalised_name(r.name) not in done]

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
            t.contradicts and t.p_value < refute_below for t in self.tests
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

    def register_test(self, claim_id: str, name: str, method: str, by: str) -> Claim:
        """Pre-register a falsification test: its name and method, before any result exists."""
        claim = self.claims[claim_id]
        key = normalised_name(name)
        if not key:
            raise ValueError("test_name is empty")
        if not method.strip():
            raise ValueError("method is empty: say what you will run and what would contradict")
        if claim.tests:
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
        claim.registered.append(Registration(name.strip(), method.strip(), by))
        self.log("test.registered", claim=claim_id, name=name, method=method.strip(), by=by)
        return claim

    def record_test(
        self, claim_id: str, name: str, p_value: float, contradicts: bool, note: str, by: str
    ) -> Claim:
        claim = self.claims[claim_id]
        if isinstance(p_value, bool) or not isinstance(p_value, (int, float)):
            raise ValueError("p_value must be a number in [0, 1], not a boolean or text")
        if math.isnan(p_value) or not 0.0 <= p_value <= 1.0:
            raise ValueError("p_value must be in [0, 1]")
        key = normalised_name(name)
        if not key:
            raise ValueError("test_name is empty")
        contradicts = bool(contradicts)
        is_registered = any(normalised_name(r.name) == key for r in claim.registered)
        again = re.compile(re.escape(key) + r"( repeat \d+)?")
        repeats = sum(1 for t in claim.tests if again.fullmatch(normalised_name(t.name)))
        label = name.strip()
        if contradicts:
            # Never refused: a result against the claim can only lower the mean, and may refute.
            if repeats:
                label, is_registered = f"{label} (repeat {repeats + 1})", False
        else:
            if not is_registered:
                state = (
                    "registration is closed because the claim already has a result"
                    if claim.tests
                    else "register it first with register_falsification_test"
                )
                raise ValueError(
                    f"{claim_id} has no registered test named {name!r}; {state}. Only tests "
                    f"registered before their result count (registered: "
                    f"{', '.join(r.name for r in claim.registered) or 'none'})."
                )
            if repeats:
                raise ValueError(
                    f"{claim_id} already has a result for test {name!r}; the first result stands."
                )
        claim.tests.append(
            Test(label, float(p_value), contradicts, note.strip(), by, registered=is_registered)
        )
        self.log(
            "test.recorded",
            claim=claim_id,
            name=label,
            p=p_value,
            contradicts=contradicts,
            registered=is_registered,
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
        self, severity: Severity, artifact_ids: list[str], problem: str, evidence: str, by: str
    ) -> Issue:
        issue = Issue(
            f"I{len(self.issues) + 1}",
            severity,
            artifact_ids,
            problem.strip(),
            evidence.strip(),
            by,
        )
        self.issues[issue.id] = issue
        self.log("issue.raised", issue=issue.id, severity=severity, problem=issue.problem, by=by)
        return issue

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
            f"contradicting test with p < {ALPHA / m:.3g}, or a failed replication. Register at "
            f"most {MAX_TESTS} tests per claim BEFORE running any; a registered test without a "
            "result counts as zero; a contradicting result is always accepted):"
        ]
        for c in self.claims.values():
            tests = "; ".join(
                f"{t.name}: p={t.p_value:.3g}{' CONTRADICTS' if t.contradicts else ''}"
                for t in c.tests
            )
            waiting = ", ".join(c.pending)
            state = "closed" if c.tests else f"open, {MAX_TESTS - len(c.registered)} left"
            lines.append(
                f"- {c.id} [{c.verdict}, mean e={c.e_value:.3g}] {c.text} (artifacts: {', '.join(c.artifact_ids)})"
                + f"\n    null: {c.null_hypothesis}"
                + f"\n    test registration: {state}"
                + (f"\n    registered, no result yet: {waiting}" if waiting else "")
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
                    waiting = " NO RESULT RECORDED (counts as e = 0)" if r.name in c.pending else ""
                    out.append(f"  - registered: {r.name}. {r.method} [{r.by}]{waiting}")
                for t in c.tests:
                    tag = " (contradicts)" if t.contradicts else ""
                    tag += "" if t.registered else " (not pre-registered)"
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
            f"it with p < {ALPHA / m:.3g} or a replication fails. Tests are registered (name and "
            f"method, at most {MAX_TESTS} per claim) before the claim has any result; a registered "
            f"test without a result counts as e = 0, a contradicting test counts as e = {KAPPA} and "
            "is always accepted. "
            f"Guarantee: a claim whose null is true is supported with probability at most "
            f"{ALPHA / m:.3g} (alpha / m), under any dependence between its registered tests. "
            "Assumptions: each reported p-value is a valid p-value computed by the critic's "
            "scripts, and no test was run in private before it was registered. Not controlled: "
            "the code cannot verify a p-value or detect private tests (both are reported by a "
            "model), and a true claim can be refuted by one mistaken contradicting test. The "
            "scripts are in scripts/.",
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
