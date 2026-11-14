"""The answer ledger: every derivation of every answer, and what became of it.

The BixBench3 swarm's ledger (swarm/ledger.py) turns p-values from falsification tests into
verdicts. A BixBench v1.5 claim is "the answer to question Q is X", and the test that fits it
is replication: a second role derives the answer again, without seeing the first, by its own
route. This ledger records both derivations and computes every status in code:

  question status   rule
  replicated        two derivations by different roles agree (`compare`)
  reconciled        they did not agree by code; a third role examined both and recorded which
                    to keep and why (`resolve`); the others are listed as rejected
  disputed          they did not agree and nobody resolved it; the first derivation is reported
                    and flagged
  unchecked         one derivation only (always the case for the single agent)
  missing           no derivation

No model sets a status. A model supplies answers and, in a resolution, which derivation to keep;
`resolve` refuses a resolution whose final answer contradicts the derivation it claims to keep.
Agreement of free-text answers cannot be decided by code: they are compared after normalising,
and anything else is "unclear" and goes to reconciliation like a disagreement.
"""

from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass, field
from typing import Any, Literal

from .text import normalise, parse_number, round_significant, significant_digits

Comparison = Literal["agree", "differ", "unclear"]
Keep = Literal["A", "B", "both", "neither"]
Status = Literal["replicated", "reconciled", "disputed", "unchecked", "missing"]
RELATIVE_TOLERANCE = 0.01  # non-integer answers within 1% agree; see `compare`


def compare(a: str, b: str) -> Comparison:
    """Do two answers to the same question agree? Decided by code, never by a model."""
    if normalise(a) and normalise(a) == normalise(b):
        return "agree"
    x, y = parse_number(a), parse_number(b)
    if x is None or y is None:
        # One or both are text. Different text may still mean the same thing: not decidable here.
        return "unclear"
    if x == y:
        return "agree"
    if float(x).is_integer() and float(y).is_integer() and not _has_fraction(a, b):
        return "differ"  # counts must match exactly: 166 genes is not 167
    if math.isclose(x, y, rel_tol=RELATIVE_TOLERANCE, abs_tol=1e-12):
        return "agree"  # measured values agree within 1%
    # 0.00018 and 0.0002 agree if one is the other rounded to the digits it was written with.
    for value, other, written in ((x, y, b), (y, x, a)):
        digits = significant_digits(written)
        if digits is not None and math.isclose(
            round_significant(value, digits), other, rel_tol=1e-9, abs_tol=1e-12
        ):
            return "agree"
    return "differ"


def _has_fraction(*texts: str) -> bool:
    return any("." in t or "e" in t.lower() for t in texts)


@dataclass
class Derivation:
    id: str
    question_id: str
    by: str
    answer: str
    route: str
    evidence: str
    superseded_by: str | None = None  # the same role replaced it; not a review outcome


@dataclass
class Resolution:
    question_id: str
    keep: Keep
    final_answer: str
    cause: str
    evidence: str
    by: str
    a: str  # derivation ids the labels A and B stood for
    b: str


@dataclass
class Final:
    question_id: str
    answer: str
    status: Status
    comparison: Comparison | None
    derivations: list[str]
    note: str = ""


@dataclass
class AnswerLedger:
    questions: dict[str, str]  # question id -> question text
    solver: str
    primary: str = "analyst"  # whose derivation is reported when nothing else decides
    checker: str | None = "critic"
    derivations: list[Derivation] = field(default_factory=list)
    resolutions: dict[str, Resolution] = field(default_factory=dict)
    events: list[dict[str, object]] = field(default_factory=list)

    def log(self, kind: str, **detail: object) -> None:
        self.events.append({"kind": kind, **detail})

    # Recording ----------------------------------------------------------------------------
    def submit(
        self, question_id: str, answer: str, route: str, evidence: str, by: str
    ) -> Derivation:
        if question_id not in self.questions:
            raise ValueError(f"unknown question {question_id}; known: {', '.join(self.questions)}")
        if not answer.strip():
            raise ValueError("answer is empty")
        new = Derivation(
            f"D{len(self.derivations) + 1}",
            question_id,
            by,
            answer.strip(),
            route.strip(),
            evidence.strip(),
        )
        old = self.current(question_id, by)
        if old is not None:
            old.superseded_by = new.id
        self.derivations.append(new)
        self.log(
            "answer.submitted",
            derivation=new.id,
            question=question_id,
            by=by,
            replaces=old.id if old else None,
        )
        return new

    def current(self, question_id: str, by: str) -> Derivation | None:
        """The standing derivation of one role for one question."""
        for d in reversed(self.derivations):
            if d.question_id == question_id and d.by == by and d.superseded_by is None:
                return d
        return None

    def pair(self, question_id: str) -> tuple[Derivation | None, Derivation | None]:
        """(A, B): the primary role's derivation and the checker's."""
        first = self.current(question_id, self.primary)
        second = self.current(question_id, self.checker) if self.checker else None
        return first, second

    def comparison(self, question_id: str) -> Comparison | None:
        first, second = self.pair(question_id)
        if first is None or second is None:
            return None
        return compare(first.answer, second.answer)

    def unanswered(self, by: str) -> list[str]:
        return [q for q in self.questions if self.current(q, by) is None]

    def disputes(self) -> list[str]:
        """Questions with two derivations that code could not show to agree, not yet resolved."""
        return [
            q
            for q in self.questions
            if q not in self.resolutions and self.comparison(q) in ("differ", "unclear")
        ]

    def resolve(
        self, question_id: str, keep: Keep, final_answer: str, cause: str, evidence: str, by: str
    ) -> Resolution:
        first, second = self.pair(question_id)
        if first is None or second is None or self.comparison(question_id) == "agree":
            raise ValueError(f"{question_id} has no open dispute")
        if not final_answer.strip() or not cause.strip():
            raise ValueError("final_answer and cause are required")
        kept = {"A": [first], "B": [second], "both": [first, second], "neither": []}[keep]
        for d in kept:
            if compare(final_answer, d.answer) == "differ":
                raise ValueError(
                    f"final_answer {final_answer!r} differs from the derivation you keep "
                    f"({d.answer!r}). Keep the other one, or use keep='neither' for a new answer."
                )
        resolution = Resolution(
            question_id, keep, final_answer.strip(), cause.strip(), evidence.strip(), by,
            first.id, second.id,
        )  # fmt: skip
        self.resolutions[question_id] = resolution
        self.log("dispute.resolved", question=question_id, keep=keep, by=by)
        return resolution

    # Verdicts (code only) -----------------------------------------------------------------
    def final(self, question_id: str) -> Final:
        first, second = self.pair(question_id)
        ids = [d.id for d in (first, second) if d is not None]
        if first is None and second is None:
            return Final(question_id, "", "missing", None, [])
        if first is None or second is None:
            only = first or second
            assert only is not None
            return Final(question_id, only.answer, "unchecked", None, ids)
        comparison = compare(first.answer, second.answer)
        if comparison == "agree":
            return Final(question_id, first.answer, "replicated", comparison, ids)
        resolution = self.resolutions.get(question_id)
        if resolution is not None and (resolution.a, resolution.b) == (first.id, second.id):
            return Final(
                question_id, resolution.final_answer, "reconciled", comparison, ids,
                f"kept {resolution.keep}: {resolution.cause}",
            )  # fmt: skip
        note = (
            "the two derivations give different answers"
            if comparison == "differ"
            else "the two derivations are worded differently and code cannot tell if they agree"
        )
        return Final(question_id, first.answer, "disputed", comparison, ids, note)

    def verdict(self, derivation: Derivation) -> str:
        """replicated, upheld, rejected, disputed, unchecked or superseded."""
        if derivation.superseded_by is not None:
            return "superseded"
        final = self.final(derivation.question_id)
        if derivation.id not in final.derivations or final.status == "unchecked":
            return "unchecked"
        if final.status in ("replicated", "disputed"):
            return final.status
        resolution = self.resolutions[derivation.question_id]
        label = "A" if derivation.id == resolution.a else "B"
        if resolution.keep == "both":
            return "replicated"
        return "upheld" if resolution.keep == label else "rejected"

    def rejected(self) -> list[dict[str, str]]:
        """Derivations a reconciliation threw out, with the recorded cause."""
        out: list[dict[str, str]] = []
        for d in self.derivations:
            if self.verdict(d) == "rejected":
                resolution = self.resolutions[d.question_id]
                out.append(
                    {
                        "derivation": d.id,
                        "question_id": d.question_id,
                        "by": d.by,
                        "answer": d.answer,
                        "route": d.route,
                        "cause": resolution.cause,
                        "evidence": resolution.evidence,
                        "replaced_by": resolution.final_answer,
                    }
                )
        return out

    # Views --------------------------------------------------------------------------------
    def answers(self) -> dict[str, Any]:
        """The content of answers.json: what is graded (`answer`) and how far it was checked."""
        return {
            "solver": self.solver,
            "answers": {
                q: {"answer": f.answer, "status": f.status, "note": f.note}
                for q in self.questions
                for f in [self.final(q)]
            },
            "rejected": self.rejected(),
        }

    def to_json(self) -> str:
        return json.dumps(
            {
                "solver": self.solver,
                "rule": "status per question is computed in code; see bixbench_v1/answers.py",
                "relative_tolerance": RELATIVE_TOLERANCE,
                "questions": self.questions,
                "final": [asdict(self.final(q)) for q in self.questions],
                "derivations": [
                    {**asdict(d), "verdict": self.verdict(d)} for d in self.derivations
                ],
                "resolutions": [asdict(r) for r in self.resolutions.values()],
                "rejected": self.rejected(),
                "events": self.events,
            },
            indent=2,
            default=str,
        )

    def _by_status(self, status: Status) -> list[Final]:
        return [f for f in (self.final(q) for q in self.questions) if f.status == status]

    def findings_markdown(self) -> str:
        by_id = {d.id: d for d in self.derivations}

        def lines_for(final: Final) -> list[str]:
            out = [
                f"- **{final.question_id}**: `{final.answer}`"
                + (f" ({final.note})" if final.note else "")
            ]
            for derivation_id in final.derivations:
                d = by_id[derivation_id]
                out.append(
                    f"  - {d.id} by {d.by} [{self.verdict(d)}]: `{d.answer}`. Route: {d.route}"
                )
            return out

        sections: list[tuple[str, Status]] = [
            ("Replicated answers (two independent derivations agree)", "replicated"),
            (
                "Reconciled answers (derivations disagreed; one was kept after examination)",
                "reconciled",
            ),
            (
                "Disputed answers (derivations disagree, unresolved; reported answer is unconfirmed)",
                "disputed",
            ),
            ("Unchecked answers (one derivation only)", "unchecked"),
            ("Missing answers", "missing"),
        ]
        lines = [
            f"# Answers and rejections ({self.solver})",
            "",
            "Statuses are computed in code from the recorded derivations. Two numeric answers "
            f"agree when equal or, for non-integers, within {RELATIVE_TOLERANCE:.0%} or when one is "
            "the other rounded; text answers agree only when identical after removing case "
            "and punctuation.",
            "",
        ]
        for title, status in sections:
            rows = self._by_status(status)
            lines += [f"## {title} ({len(rows)})", ""]
            for final in rows:
                lines += lines_for(final) if final.derivations else [f"- **{final.question_id}**"]
            lines.append("")
        rejected = self.rejected()
        lines += [f"## Rejected derivations ({len(rejected)})", ""]
        for r in rejected:
            lines.append(
                f"- {r['derivation']} ({r['question_id']}, by {r['by']}): `{r['answer']}` rejected in "
                f"favour of `{r['replaced_by']}`. Cause: {r['cause']} Evidence: {r['evidence']}"
            )
        superseded = [d for d in self.derivations if d.superseded_by]
        lines += ["", f"## Answers a role replaced itself ({len(superseded)})", ""]
        lines += [
            f"- {d.id} ({d.question_id}, by {d.by}): `{d.answer}` replaced by {d.superseded_by}"
            for d in superseded
        ]
        return "\n".join(lines) + "\n"

    def methods_markdown(self, settings: dict[str, Any]) -> str:
        """METHODS.md, written by code from what the roles recorded, for both solvers."""
        lines = [
            "# Methods",
            "",
            f"Solver: {self.solver}. Generated by code from the routes and evidence the agents "
            "recorded with each answer; nothing here was written after grading.",
            "",
            "## Settings",
            "",
            *[f"- {name}: {value}" for name, value in settings.items()],
            "",
            "## Answers",
            "",
        ]
        for question_id, text in self.questions.items():
            final = self.final(question_id)
            lines += [
                f"### {question_id}",
                "",
                f"Question: {text}",
                "",
                f"Answer: `{final.answer}` (status: {final.status}"
                + (f"; {final.note}" if final.note else "")
                + ")",
                "",
            ]
            for d in self.derivations:
                if d.question_id == question_id:
                    lines += [
                        f"- {d.id} by {d.by} [{self.verdict(d)}]: `{d.answer}`",
                        f"  - Route: {d.route}",
                        f"  - Evidence: {d.evidence}",
                    ]
            resolution = self.resolutions.get(question_id)
            if resolution is not None:
                lines += [
                    f"- Reconciliation by {resolution.by}: keep {resolution.keep} "
                    f"(A = {resolution.a}, B = {resolution.b}). Cause: {resolution.cause}",
                    f"  - Evidence: {resolution.evidence}",
                ]
            lines.append("")
        return "\n".join(lines)
