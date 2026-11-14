"""The swarm's shared world model: claims, falsification tests, critic issues.

Everything here is deterministic. Agents propose claims and record test results through tools;
the verdict on each claim is computed by code, never by a model.

Falsification follows Popper (Huang et al., ICML 2025): each claim has a null hypothesis
("the claimed effect is absent"). Every falsification test the critic runs yields a p-value
under that null. p-values are converted to e-values with the calibrator e = k * p^(k-1)
(k = 0.5) and multiplied. A product of e-values from INDEPENDENT tests is itself an e-value, so
by Markov's inequality a true null reaches E >= m/alpha with probability <= alpha/m.

What the code enforces, because the p-values are reported by a model and cannot be re-derived here:
  - every test counts, favourable or not. A test marked `contradicts` contributes KAPPA (the
    calibrated e-value of p = 1), never 1.0, so unfavourable results are not censored;
  - one result per test name per claim (a repeat is refused) and at most MAX_TESTS per claim.
    With MAX_TESTS = 3, even three copies of one test under different names keep each claim's
    false-support rate at 0.25 / T^(2/3) for threshold T = m/alpha: 5.4% at m = 1, and below
    alpha/m for up to 6 claims (1.35% against 1.25% at m = 8);
  - Bonferroni across the m registered claims: support needs E >= m/alpha, refutation needs a
    contradicting test with p < alpha/m;
  - p is floored at P_FLOOR = 1e-6, so one self-reported p = 0 is worth at most e = 500.
What it cannot enforce: that tests on one claim are independent. The critic is told to use
independent splits or methods; FINDINGS.md states the assumption.

Verdicts (m = number of registered claims):
  supported     E >= m/alpha                      (null rejected; claim survives falsification)
  refuted       a test contradicts the claim with p < alpha/m, or a replication failed
  insufficient  neither, after the tests run (reported, never presented as a finding)
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import asdict, dataclass, field
from typing import Literal

ALPHA = 0.1  # family-wise, across all registered claims (Bonferroni) and the tests of each claim
KAPPA = 0.5
P_FLOOR = 1e-6  # finer p-values are not credible from permutations or bootstraps; caps e at 500
MAX_TESTS = 3  # per claim; see the module docstring

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

    @property
    def e_value(self) -> float:
        # A result that goes against the claim has a one-sided p >= 0.5 in the claim's direction,
        # whose calibrated e-value is at least KAPPA; using KAPPA is the conservative choice.
        return KAPPA if self.contradicts else p_to_e(self.p_value)


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

    @property
    def e_value(self) -> float:
        return math.prod(t.e_value for t in self.tests) if self.tests else 1.0

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

    def record_test(
        self, claim_id: str, name: str, p_value: float, contradicts: bool, note: str, by: str
    ) -> Claim:
        claim = self.claims[claim_id]
        if not 0.0 <= p_value <= 1.0 or math.isnan(p_value):
            raise ValueError("p_value must be in [0, 1]")
        key = normalised_name(name)
        if not key:
            raise ValueError("test_name is empty")
        if any(normalised_name(t.name) == key for t in claim.tests):
            raise ValueError(
                f"{claim_id} already has a result for test {name!r}; the first result stands. "
                "A new test must use different data or a different method."
            )
        if len(claim.tests) >= MAX_TESTS:
            raise ValueError(
                f"{claim_id} already has {MAX_TESTS} tests, the most a claim may have; "
                "its verdict is final."
            )
        claim.tests.append(Test(name.strip(), float(p_value), bool(contradicts), note.strip(), by))
        self.log(
            "test.recorded",
            claim=claim_id,
            name=name,
            p=p_value,
            contradicts=contradicts,
            e=round(claim.e_value, 4),
            verdict=claim.verdict,
            by=by,
        )
        return claim

    def fail_replication(self, claim_id: str, note: str, by: str) -> Claim:
        claim = self.claims[claim_id]
        claim.replication_failed = True
        if not any(normalised_name(t.name) == "independent replication" for t in claim.tests):
            claim.tests.append(Test("independent replication", 1.0, True, note.strip(), by))
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
                "claims_in_family": len(self.claims),
                "support_threshold": max(1, len(self.claims)) / ALPHA,
                "claims": [
                    {
                        **asdict(c),
                        "e_value": c.e_value,
                        "threshold": c.threshold,
                        "verdict": c.verdict,
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
            f"Claims (verdict by e-value; alpha={ALPHA} shared by {m} claims, so supported needs "
            f"E >= {m / ALPHA:g} and refuted needs a contradicting test with p < {ALPHA / m:.3g}; "
            f"at most {MAX_TESTS} tests per claim, one result per test name):"
        ]
        for c in self.claims.values():
            tests = "; ".join(
                f"{t.name}: p={t.p_value:.3g}{' CONTRADICTS' if t.contradicts else ''}"
                for t in c.tests
            )
            lines.append(
                f"- {c.id} [{c.verdict}, E={c.e_value:.3g}] {c.text} (artifacts: {', '.join(c.artifact_ids)})"
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
                out.append(f"- Combined e-value: {c.e_value:.3g} (threshold {c.threshold:g})")
                for t in c.tests:
                    tag = " (contradicts)" if t.contradicts else ""
                    out.append(
                        f"  - {t.name}: p = {t.p_value:.3g}, e = {t.e_value:.3g}{tag}. {t.note} [{t.by}]"
                    )
                out.append("")
            return out

        m = max(1, len(self.claims))
        fixed = [i for i in self.issues.values() if i.status == "fixed"]
        unresolved = [i for i in self.issues.values() if i.status != "fixed"]
        lines = [
            "# GLHF swarm: findings and rejections",
            "",
            f"Verdicts are computed in code from falsification tests (e-values, alpha = {ALPHA}). "
            "A claim counts as a finding only if it survived falsification.",
            "",
            f"Error control and its limits. alpha = {ALPHA} is shared by the {m} registered claims "
            f"(Bonferroni): a claim is supported when its combined e-value reaches {m / ALPHA:g}, and "
            f"refuted when a test contradicts it with p < {ALPHA / m:.3g} or a replication fails. Every "
            f"recorded test counts, a contradicting test counts against the claim (e = {KAPPA}), each "
            f"test name is accepted once per claim, and a claim has at most {MAX_TESTS} tests. "
            "Assumption: the tests on one claim are independent (different data splits or "
            "methods). The p-values are computed by the critic's scripts and reported by a model; "
            "the code cannot verify them or their independence. The scripts are in scripts/.",
            "",
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
