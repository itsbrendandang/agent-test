"""The swarm's shared world model: claims, falsification tests, critic issues.

Everything here is deterministic. Agents propose claims and record test results through tools;
the verdict on each claim is computed by code, never by a model.

Falsification follows Popper (Huang et al., ICML 2025): each claim has a null hypothesis
("the claimed effect is absent"). Every falsification test the critic runs yields a p-value
under that null. p-values are converted to e-values with the calibrator e = k * p^(k-1)
(k = 0.5) and multiplied. Because a product of e-values is itself an e-value (for sequential,
non-adaptive tests), Ville's inequality bounds the chance that a true null ever reaches
E >= 1/alpha by alpha: this is the Type-I control.

Verdicts:
  supported     E >= 1/alpha                      (null rejected; claim survives falsification)
  refuted       a test contradicts the claim with p < alpha, or a replication failed
  insufficient  neither, after the tests run (reported, never presented as a finding)
"""

from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass, field
from typing import Literal

ALPHA = 0.1  # Popper's default; family-wise over the sequence of tests for one claim
KAPPA = 0.5
P_FLOOR = 1e-12

Verdict = Literal["supported", "refuted", "insufficient", "untested"]
Severity = Literal["blocking", "major", "minor"]


def p_to_e(p: float, kappa: float = KAPPA) -> float:
    """Calibrate a p-value into an e-value (Vovk & Wang). Valid for any kappa in (0, 1)."""
    p = min(1.0, max(P_FLOOR, float(p)))
    return float(kappa * p ** (kappa - 1))


@dataclass
class Test:
    name: str
    p_value: float
    contradicts: bool
    note: str
    by: str

    @property
    def e_value(self) -> float:
        return 1.0 if self.contradicts else p_to_e(self.p_value)


@dataclass
class Claim:
    id: str
    text: str
    artifact_ids: list[str]
    proposed_by: str
    null_hypothesis: str
    tests: list[Test] = field(default_factory=list)
    replication_failed: bool = False

    @property
    def e_value(self) -> float:
        return math.prod(t.e_value for t in self.tests) if self.tests else 1.0

    @property
    def verdict(self) -> Verdict:
        if self.replication_failed or any(t.contradicts and t.p_value < ALPHA for t in self.tests):
            return "refuted"
        if not self.tests:
            return "untested"
        return "supported" if self.e_value >= 1 / ALPHA else "insufficient"


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
        self.log("claim.added", claim=claim.id, by=by, text=claim.text)
        return claim

    def record_test(
        self, claim_id: str, name: str, p_value: float, contradicts: bool, note: str, by: str
    ) -> Claim:
        claim = self.claims[claim_id]
        if not 0.0 <= p_value <= 1.0 or math.isnan(p_value):
            raise ValueError("p_value must be in [0, 1]")
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
        issue.status, issue.resolution = status, resolution.strip()
        self.log("issue.resolved", issue=issue_id, status=status, by=by)
        return issue

    def open_issues(self, severities: tuple[Severity, ...] = ("blocking", "major")) -> list[Issue]:
        return [i for i in self.issues.values() if i.status == "open" and i.severity in severities]

    # Views --------------------------------------------------------------------------------
    def to_json(self) -> str:
        return json.dumps(
            {
                "alpha": ALPHA,
                "kappa": KAPPA,
                "claims": [
                    {
                        **asdict(c),
                        "e_value": c.e_value,
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
        lines = [f"Claims (verdict by e-value, alpha={ALPHA}; supported needs E >= {1 / ALPHA:g}):"]
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
                out.append(f"- Combined e-value: {c.e_value:.3g} (threshold {1 / ALPHA:g})")
                for t in c.tests:
                    tag = " (contradicts)" if t.contradicts else ""
                    out.append(
                        f"  - {t.name}: p = {t.p_value:.3g}, e = {t.e_value:.3g}{tag}. {t.note} [{t.by}]"
                    )
                out.append("")
            return out

        fixed = [i for i in self.issues.values() if i.status == "fixed"]
        unresolved = [i for i in self.issues.values() if i.status != "fixed"]
        lines = [
            "# GLHF swarm: findings and rejections",
            "",
            f"Verdicts are computed in code from falsification tests (e-values, alpha = {ALPHA}). "
            "A claim counts as a finding only if it survived falsification.",
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
