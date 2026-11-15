"""Budget per claim: how the claims pool is split, moved, and when the run must stop new work.

The run keeps ONE budget, the same as the single-agent baseline: one Clock and one TokenBook
(solver.py). This module never adds to it. It only divides what the run can spend on claims (the
pool: what is left after the report and finish reserves and the triage call) among the claims on
the Board, by acuity, and moves what a closed claim did not spend to the claims still open.

All of it is pure arithmetic on integers and floats, so the sums can be checked exactly:
  - the claims' allocations never add up to more than the pool;
  - RETRIAGE_HOLD of the pool is held back at first, for re-triage;
  - re-triage moves only tokens and seconds a closed claim did not spend.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from bixbench3.inspect_harness.swarm.board import ACUITY_WEIGHT, Board, ClaimRecord
from bixbench3.inspect_harness.swarm.flags import SwarmFlags

RETRIAGE_HOLD = 0.15  # of the pool, held back at first and handed out by re-triage
# How a claim's own allocation is split between its stages. Without a pilot its share goes to the
# workup; without any review the review share does too.
STAGE_SPLIT = {"pilot": 0.15, "workup": 0.50, "review": 0.35}
# How the review share is split between the roles that draw on it. Each role gets 1/rounds of its
# part per round; what a round does not use rolls forward to the next round of the same role.
REVIEW_SPLIT = {"audit": 0.30, "critique": 0.45, "revise": 0.25}
MIN_CALL_SECONDS = 30  # a call gets at least this, when its claim has it
SKIP_CALL_SECONDS = 10  # under this the call is not started


@dataclass
class Pool:
    tokens: int  # 0 when the run has no token budget (time limits only)
    seconds: float


@dataclass
class Held:
    """What the pool still holds back: the re-triage reserve, plus rounding remainders."""

    tokens: int = 0
    seconds: float = 0.0


def _weights(records: list[ClaimRecord]) -> list[int]:
    return [ACUITY_WEIGHT[r.acuity] for r in records]


def _split_int(amount: int, weights: list[int]) -> list[int]:
    total = sum(weights)
    return [amount * w // total for w in weights] if total else [0 for _ in weights]


def allocate(board: Board, pool: Pool, hold: float = RETRIAGE_HOLD) -> Held:
    """Give each open claim `weight / sum(weights)` of the pool after `hold`. Returns what is held."""
    records = board.open_claims()
    weights = _weights(records)
    total = sum(weights)
    held_tokens = int(pool.tokens * hold)
    held_seconds = pool.seconds * hold
    tokens = _split_int(pool.tokens - held_tokens, weights)
    seconds = [(pool.seconds - held_seconds) * w / total if total else 0.0 for w in weights]
    for record, t, s, w in zip(records, tokens, seconds, weights, strict=True):
        record.budget.tokens_alloc = t
        record.budget.seconds_alloc = s
        record.share = w / total if total else 0.0
    held = Held(pool.tokens - sum(tokens), pool.seconds - sum(seconds))
    board.event(
        "budget.allocated",
        pool_tokens=pool.tokens,
        pool_seconds=round(pool.seconds, 3),
        held_tokens=held.tokens,
        held_seconds=round(held.seconds, 3),
        claims={
            r.id: {"tokens": r.budget.tokens_alloc, "share": round(r.share, 4)} for r in records
        },
    )
    return held


def retriage(board: Board, held: Held, *, enabled: bool = True) -> Held:
    """Move what closed claims did not spend, plus what is held, to the open claims by acuity.

    A closed claim's allocation is cut to what it spent, so its unspent part is counted once.
    With `enabled=False` (the --no-retriage ablation) nothing moves: the freed budget stays held,
    unspent, and the event says so."""
    freed_tokens, freed_seconds = 0, 0.0
    for record in board.claims.values():
        if record.open:
            continue
        freed_tokens += record.budget.tokens_left
        freed_seconds += record.budget.seconds_left
        record.budget.tokens_alloc = record.budget.tokens_spent
        record.budget.seconds_alloc = record.budget.seconds_spent
    tokens = held.tokens + freed_tokens
    seconds = held.seconds + freed_seconds
    records = board.open_claims()
    if not enabled or not records:
        board.event(
            "retriage",
            enabled=enabled,
            moved_tokens=0,
            kept_tokens=tokens,
            reason="disabled" if not enabled else "no open claim",
        )
        return Held(tokens, seconds)
    weights = _weights(records)
    total = sum(weights)
    gives = _split_int(tokens, weights)
    moved: dict[str, Any] = {}
    for record, give, w in zip(records, gives, weights, strict=True):
        record.budget.tokens_alloc += give
        record.budget.seconds_alloc += seconds * w / total
        moved[record.id] = give
    board.event(
        "retriage", enabled=True, moved_tokens=sum(gives), kept_tokens=tokens - sum(gives), to=moved
    )
    return Held(tokens - sum(gives), 0.0)


def stage_share(stage: str, *, pilot: bool = True, review: bool = True) -> float:
    """The share of a claim's allocation that `stage` may use. A stage that will not run gives its
    share to the workup; a revision is paid from the review share."""
    split = dict(STAGE_SPLIT)
    if not pilot:
        split["workup"] += split.pop("pilot")
    if not review:
        split["workup"] += split.pop("review")
    return split.get("review" if stage == "revise" else stage, 0.0)


def stage_tokens(
    record: ClaimRecord, stage: str, *, pilot: bool = True, review: bool = True
) -> int:
    """Tokens the claim may spend on `stage` now: its stage share of the allocation, never more than
    it has left. A stage that will not run gives its share to the workup."""
    share = stage_share(stage, pilot=pilot, review=review)
    return min(record.budget.tokens_left, int(record.budget.tokens_alloc * share))


def must_stop(
    *,
    tokens_left: int | None,
    seconds_left: float,
    reserved_tokens: int,
    min_claim_tokens: int,
    reserved_seconds: float,
) -> str | None:
    """Why the run must stop new claim work now, or None. `tokens_left` is None without a token
    budget. The reserves are the report and finish slices; one more claim step needs
    `min_claim_tokens` on top of them."""
    if tokens_left is not None and tokens_left < reserved_tokens + min_claim_tokens:
        return f"{tokens_left} tokens left, {reserved_tokens + min_claim_tokens} needed for one more claim step and the reserves"
    if seconds_left < reserved_seconds:
        return f"{int(seconds_left)} s left, {int(reserved_seconds)} s are kept for finishing and the report"
    return None


def stage_seconds(
    record: ClaimRecord, stage: str, *, pilot: bool = True, review: bool = True
) -> float:
    """Seconds the claim may spend on `stage` now, like stage_tokens."""
    share = stage_share(stage, pilot=pilot, review=review)
    return min(record.budget.seconds_left, record.budget.seconds_alloc * share)


# -- One call: its token cap and its time limit ---------------------------------------------------
def parse_mode(mode: str) -> tuple[str, int]:
    """("audit", 2) for "audit 2"; ("pilot", 0) for a mode without a round."""
    base, _, rest = mode.partition(" ")
    return base, int(rest) if rest.strip().isdigit() else 0


def review_split(*, auditor: bool = True, critic: bool = True) -> dict[str, float]:
    """REVIEW_SPLIT with a reviewer that is off giving its part to the other one."""
    split = dict(REVIEW_SPLIT)
    if not auditor:
        split["critique"] += split.pop("audit")
    if not critic:
        split["audit"] = split.get("audit", 0.0) + split.pop("critique")
    return split


def _review_share(role: str, round_no: int, flags: SwarmFlags) -> float:
    """The share of the claim's allocation `role` may have spent by the end of round `round_no`."""
    rounds = max(1, flags.review_rounds)
    split = review_split(auditor=flags.auditor, critic=flags.critic)
    done = min(max(round_no, 1), rounds)
    return (
        stage_share("review", pilot=flags.pilot, review=flags.review)
        * split.get(role, 0.0)
        * (done / rounds)
    )


def _later_share(role: str, round_no: int, flags: SwarmFlags) -> float:
    """The share of the claim's allocation its stages after this call still need."""

    def share(stage: str) -> float:
        return stage_share(stage, pilot=flags.pilot, review=flags.review)

    if role == "pilot":
        return share("workup") + share("review")
    if role == "workup":
        return share("review")
    rounds = max(1, flags.review_rounds)
    left = max(0, rounds - max(round_no, 1)) / rounds
    later = share("review") * left
    if role in ("audit", "critique"):
        later += share("review") * REVIEW_SPLIT["revise"] / rounds  # this round's revision
    return later


def call_tokens(record: ClaimRecord, mode: str, flags: SwarmFlags) -> int:
    """The token cap of one call on `record`. A pilot or a workup gets its stage share, as
    stage_tokens. A review role in round n gets n/rounds of its part of the review share, minus
    what it already spent on this claim, so round 1 cannot empty the review share."""
    role, round_no = parse_mode(mode)
    if role not in REVIEW_SPLIT:
        return stage_tokens(record, role, pilot=flags.pilot, review=flags.review)
    allowed = int(record.budget.tokens_alloc * _review_share(role, round_no, flags))
    spent = record.budget.stage_tokens_spent.get(role, 0)
    return max(0, min(record.budget.tokens_left, allowed - spent))


def call_seconds(record: ClaimRecord, mode: str, flags: SwarmFlags, *, run_left: float) -> float:
    """The time limit of one call on `record`, `run_left` seconds before the claims must stop.

    - its stage share of the claim's seconds (review roles: per round, as call_tokens);
    - at least MIN_CALL_SECONDS, but never more than the claim has left, so the floor cannot
      spend another claim's time;
    - at most `run_left` minus what the claim's later stages still need, while that leaves room
      for the floor, so a pilot cannot use the workup's time.
    Calls that run at the same time share the wall clock, so each one ends by `run_left`."""
    role, round_no = parse_mode(mode)
    budget = record.budget
    if role in REVIEW_SPLIT:
        allowed = budget.seconds_alloc * _review_share(role, round_no, flags)
        base = max(
            0.0, min(budget.seconds_left, allowed - budget.stage_seconds_spent.get(role, 0.0))
        )
    else:
        base = stage_seconds(record, role, pilot=flags.pilot, review=flags.review)
    floor = min(float(MIN_CALL_SECONDS), budget.seconds_left)
    later = min(budget.seconds_left, budget.seconds_alloc * _later_share(role, round_no, flags))
    cap = run_left - later if run_left - later >= floor else run_left
    return max(0.0, min(max(base, floor), cap))
