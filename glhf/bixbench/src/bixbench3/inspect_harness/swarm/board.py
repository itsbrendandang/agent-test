"""The Board: one record per claim, a state machine over those records, and a log of every change.

The claims engine treats each claim as a patient: it is triaged, piloted, worked up, reviewed and
then supported, rejected, or left not established. The Board holds that record. It sits next to
the Ledger (ledger.py), which stays the only place where a verdict on a claim is computed:

  - every state change is made by code, through `Board.move`, and only along `TRANSITIONS`.
    An illegal change raises IllegalTransition and is logged;
  - the outcome of a review is read from the Ledger's verdict and its open issues
    (`review_outcome`), never from what a model wrote;
  - after every change the Board is written to `board.json` (in one step: temporary file, then
    rename) and one line is appended to `events.jsonl`, so a crashed run leaves a readable record.

Every method that changes the Board is synchronous and does not await. Inside one asyncio event
loop that makes each change atomic, also when claims are worked on in parallel.
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any, Literal

from bixbench3.inspect_harness.swarm.ledger import Ledger
from bixbench3.inspect_harness.swarm.tools import write_host_file

BOARD_FILE = "board.json"
EVENTS_FILE = "events.jsonl"
REJECTIONS_FILE = "rejections.json"


class State(StrEnum):
    TRIAGED = "triaged"
    PILOTING = "piloting"
    IN_WORKUP = "in_workup"
    UNDER_REVIEW = "under_review"
    SENT_BACK = "sent_back"
    SUPPORTED = "supported"
    REJECTED = "rejected"
    NOT_ESTABLISHED = "not_established"


TERMINAL = frozenset({State.SUPPORTED, State.REJECTED, State.NOT_ESTABLISHED})

# Every legal change. Any open state may also go to NOT_ESTABLISHED (a global stop, an error after
# the retry, or a claim budget that ran out); terminal states have no way out.
TRANSITIONS: dict[State, frozenset[State]] = {
    State.TRIAGED: frozenset({State.PILOTING, State.IN_WORKUP, State.NOT_ESTABLISHED}),
    State.PILOTING: frozenset({State.IN_WORKUP, State.REJECTED, State.NOT_ESTABLISHED}),
    State.IN_WORKUP: frozenset({State.UNDER_REVIEW, State.NOT_ESTABLISHED}),
    State.UNDER_REVIEW: frozenset(
        {State.SUPPORTED, State.REJECTED, State.SENT_BACK, State.NOT_ESTABLISHED}
    ),
    State.SENT_BACK: frozenset({State.IN_WORKUP, State.NOT_ESTABLISHED}),
    State.SUPPORTED: frozenset(),
    State.REJECTED: frozenset(),
    State.NOT_ESTABLISHED: frozenset(),
}

# The stage a rejection is reported under, by the state the claim was rejected from.
REJECTED_AT = {State.PILOTING: "pilot", State.UNDER_REVIEW: "review"}

Acuity = Literal["high", "medium", "low"]
ACUITY_WEIGHT: dict[str, int] = {"high": 3, "medium": 2, "low": 1}


class IllegalTransition(ValueError):
    """A state change that is not in TRANSITIONS."""


@dataclass
class ClaimBudget:
    tokens_alloc: int = 0
    tokens_spent: int = 0
    seconds_alloc: float = 0.0
    seconds_spent: float = 0.0
    # What each role (pilot, workup, audit, critique, revise) spent on this claim, so a review
    # role's share can be paid per round (claim_budget.call_tokens).
    stage_tokens_spent: dict[str, int] = field(default_factory=dict)
    stage_seconds_spent: dict[str, float] = field(default_factory=dict)

    @property
    def tokens_left(self) -> int:
        return max(0, self.tokens_alloc - self.tokens_spent)

    @property
    def seconds_left(self) -> float:
        return max(0.0, self.seconds_alloc - self.seconds_spent)


@dataclass
class Artifact:
    path: str
    sha256: str
    by: str
    stage: str


@dataclass
class VerdictEntry:
    stage: str
    outcome: str  # the state the review led to; computed by code from the Ledger
    reason: str
    evidence: dict[str, Any]
    by: str
    at: float


@dataclass
class Change:
    from_state: str
    to_state: str
    by: str
    reason: str
    at: float


@dataclass
class ClaimRecord:
    id: str  # the Ledger's claim id
    text: str
    artifact_ids: list[str]
    acuity: Acuity
    state: State = State.TRIAGED
    share: float = 0.0  # of the claims pool, set by the budget
    budget: ClaimBudget = field(default_factory=ClaimBudget)
    work_dir: str = ""
    artifacts: list[Artifact] = field(default_factory=list)
    verdicts: list[VerdictEntry] = field(default_factory=list)
    history: list[Change] = field(default_factory=list)
    attempts: dict[str, int] = field(default_factory=lambda: {"pilot": 0, "workup": 0, "revise": 0})
    errors: list[str] = field(default_factory=list)

    @property
    def open(self) -> bool:
        return self.state not in TERMINAL


def review_outcome(
    ledger: Ledger,
    record: ClaimRecord,
    *,
    critic_completed: bool,
    rounds_left: int,
    budget_left: bool,
) -> tuple[State, str, dict[str, Any]]:
    """Where a claim under review goes next, from the Ledger alone. Returns (state, reason, evidence).

    supported: the Ledger says supported, no blocking or major issue is open on the claim, and a
      critic round completed (an unreviewed claim is never supported).
    rejected: the Ledger says refuted.
    sent_back: an open blocking or major issue on the claim, with a round and budget left.
    not_established: everything else.
    """
    claim = ledger.claims[record.id]
    verdict = claim.verdict
    issues = [i.id for i in open_issues_for(ledger, record)]
    evidence: dict[str, Any] = {
        "ledger_verdict": verdict,
        "e_value": claim.e_value,
        "threshold": claim.threshold,
        "open_issues": issues,
        "critic_completed": critic_completed,
    }
    if verdict == "refuted":
        return State.REJECTED, "the ledger refuted the claim", evidence
    if issues and rounds_left > 0 and budget_left:
        return State.SENT_BACK, f"open issues {', '.join(issues)}", evidence
    if verdict == "supported" and not issues and critic_completed:
        return State.SUPPORTED, "the ledger supports the claim and no issue is open", evidence
    if issues:
        why = "no review round left" if rounds_left <= 0 else "no budget left"
        return State.NOT_ESTABLISHED, f"open issues {', '.join(issues)} and {why}", evidence
    if not critic_completed:
        return State.NOT_ESTABLISHED, "no critic round completed", evidence
    return State.NOT_ESTABLISHED, f"the ledger verdict is {verdict}", evidence


def open_issues_for(ledger: Ledger, record: ClaimRecord) -> list[Any]:
    """Open blocking or major issues that name the claim, or (when an issue names no claim) share
    one of its artifacts."""
    found = []
    for issue in ledger.open_issues():
        named = list(getattr(issue, "claim_ids", []) or [])
        if named:
            if record.id in named:
                found.append(issue)
        elif set(issue.artifact_ids) & set(record.artifact_ids):
            found.append(issue)
    return found


@dataclass
class Board:
    run_id: str
    out_dir: Path | None = None  # where board.json, events.jsonl and rejections.json are written
    claims: dict[str, ClaimRecord] = field(default_factory=dict)
    seq: int = 0
    clock: Any = time.time  # replaced in tests

    # -- changes ---------------------------------------------------------------------------------

    def add(
        self, claim_id: str, text: str, artifact_ids: list[str], acuity: str, by: str
    ) -> ClaimRecord:
        if claim_id in self.claims:
            raise ValueError(f"{claim_id} is already on the board")
        if acuity not in ACUITY_WEIGHT:
            raise ValueError(f"acuity must be one of {', '.join(ACUITY_WEIGHT)}, not {acuity!r}")
        record = ClaimRecord(claim_id, text, list(artifact_ids), acuity)  # type: ignore[arg-type]
        record.work_dir = f"/workspace/work/glhf/claims/{claim_id}"
        self.claims[claim_id] = record
        self.event("claim.added", claim_id=claim_id, by=by, acuity=acuity, text=text)
        return record

    def move(
        self,
        claim_id: str,
        to: State,
        by: str,
        reason: str,
        evidence: dict[str, Any] | None = None,
    ) -> ClaimRecord:
        record = self.claims[claim_id]
        before = record.state
        if to not in TRANSITIONS[before]:
            self.event(
                "claim.illegal_transition",
                claim_id=claim_id,
                by=by,
                from_=before,
                to=to,
                reason=reason,
            )
            raise IllegalTransition(f"{claim_id}: {before} -> {to} is not allowed")
        now = self.clock()
        record.state = to
        record.history.append(Change(before, to, by, reason, now))
        if before == State.UNDER_REVIEW or to == State.REJECTED:
            stage = "pilot" if before == State.PILOTING else "review"
            record.verdicts.append(VerdictEntry(stage, to, reason, evidence or {}, by, now))
        self.event(
            "claim.transition",
            claim_id=claim_id,
            by=by,
            from_=before,
            to=to,
            reason=reason,
            evidence=evidence or {},
        )
        return record

    def spend(
        self, claim_id: str, tokens: int, seconds: float, stage: str | None = None
    ) -> ClaimBudget:
        budget = self.claims[claim_id].budget
        budget.tokens_spent += max(0, tokens)
        budget.seconds_spent += max(0.0, seconds)
        if stage:
            budget.stage_tokens_spent[stage] = budget.stage_tokens_spent.get(stage, 0) + max(
                0, tokens
            )
            budget.stage_seconds_spent[stage] = budget.stage_seconds_spent.get(stage, 0.0) + max(
                0.0, seconds
            )
        self.event(
            "budget.spent", claim_id=claim_id, tokens=tokens, seconds=round(seconds, 3), stage=stage
        )
        return budget

    def add_artifact(self, claim_id: str, artifact: Artifact) -> None:
        self.claims[claim_id].artifacts.append(artifact)
        self.event("claim.artifact", claim_id=claim_id, **asdict(artifact))

    def note_error(self, claim_id: str, error: str) -> None:
        self.claims[claim_id].errors.append(error)
        self.event("claim.error", claim_id=claim_id, error=error)

    def close_open(self, by: str, reason: str) -> list[str]:
        """Move every open claim to not_established (the global stop). Returns their ids."""
        closed = [c.id for c in self.claims.values() if c.open]
        for claim_id in closed:
            self.move(claim_id, State.NOT_ESTABLISHED, by, reason)
        return closed

    # -- reading ---------------------------------------------------------------------------------

    def open_claims(self) -> list[ClaimRecord]:
        return [c for c in self.claims.values() if c.open]

    def in_state(self, state: State) -> list[ClaimRecord]:
        return [c for c in self.claims.values() if c.state == state]

    def rejections(self) -> list[dict[str, Any]]:
        """One entry per rejected claim: the claim, the stage, the reason and the evidence."""
        out = []
        for record in self.claims.values():
            if record.state != State.REJECTED:
                continue
            change = record.history[-1]
            verdict = record.verdicts[-1] if record.verdicts else None
            out.append(
                {
                    "claim": record.id,
                    "text": record.text,
                    "stage": REJECTED_AT.get(State(change.from_state), change.from_state),
                    "reason": change.reason,
                    "evidence": verdict.evidence if verdict else {},
                }
            )
        return out

    def markdown(self) -> str:
        """The claims, their end states and the rejection log, for FINDINGS.md."""
        lines = [
            "## Claims (claims engine)",
            "",
            "| Claim | Acuity | State | Last reason |",
            "|---|---|---|---|",
        ]
        for c in self.claims.values():
            reason = c.history[-1].reason if c.history else ""
            lines.append(f"| {c.id}: {c.text} | {c.acuity} | {c.state} | {reason} |")
        lines += ["", "## Rejection log", ""]
        rejected = self.rejections()
        lines += [f"- {r['claim']} ({r['stage']}): {r['reason']}" for r in rejected] or ["- none"]
        return "\n".join(lines) + "\n"

    # -- records ---------------------------------------------------------------------------------

    def event(self, kind: str, **detail: Any) -> dict[str, Any]:
        """Log one event (one JSONL line) and write the Board as it is now."""
        self.seq += 1
        entry = {"seq": self.seq, "ts": self.clock(), "run_id": self.run_id, "kind": kind}
        entry.update({k.rstrip("_"): v for k, v in detail.items()})
        if self.out_dir is not None:
            self.out_dir.mkdir(parents=True, exist_ok=True)
            with (self.out_dir / EVENTS_FILE).open("a", encoding="utf-8") as out:
                out.write(json.dumps(entry, default=str) + "\n")
            write_host_file(self.out_dir / BOARD_FILE, self.to_json())
            write_host_file(self.out_dir / REJECTIONS_FILE, json.dumps(self.rejections(), indent=2))
        return entry

    def to_json(self) -> str:
        return json.dumps(
            {
                "run_id": self.run_id,
                "seq": self.seq,
                "claims": [asdict(c) for c in self.claims.values()],
            },
            indent=2,
            default=str,
        )

    @classmethod
    def from_json(cls, text: str, out_dir: Path | None = None) -> Board:
        data = json.loads(text)
        board = cls(data["run_id"], out_dir=out_dir, seq=data["seq"])
        for raw in data["claims"]:
            record = ClaimRecord(
                raw["id"], raw["text"], raw["artifact_ids"], raw["acuity"], State(raw["state"])
            )
            record.share = raw["share"]
            record.budget = ClaimBudget(**raw["budget"])
            record.work_dir = raw["work_dir"]
            record.artifacts = [Artifact(**a) for a in raw["artifacts"]]
            record.verdicts = [VerdictEntry(**v) for v in raw["verdicts"]]
            record.history = [Change(**h) for h in raw["history"]]
            record.attempts = raw["attempts"]
            record.errors = raw["errors"]
            board.claims[record.id] = record
        return board
