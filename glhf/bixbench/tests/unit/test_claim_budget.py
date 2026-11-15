"""Budget per claim: the claims never get more than the pool, re-triage moves only what a closed
claim did not spend, and the stop rule keeps the reserves."""

from __future__ import annotations

import pytest

from bixbench3.inspect_harness.swarm.board import Board, State
from bixbench3.inspect_harness.swarm.claim_budget import (
    RETRIAGE_HOLD,
    STAGE_SPLIT,
    Held,
    Pool,
    allocate,
    must_stop,
    retriage,
    stage_tokens,
)


def _board(acuities: list[str]) -> Board:
    board = Board("run-1")
    for n, acuity in enumerate(acuities, 1):
        board.add(f"C{n}", f"claim {n}", ["a"], acuity, "proposer")
    return board


def _close(board: Board, claim_id: str, to: State) -> None:
    for step in (State.PILOTING, State.IN_WORKUP, State.UNDER_REVIEW):
        board.move(claim_id, step, "engine", "step")
    board.move(claim_id, to, "engine", "done")


@pytest.mark.parametrize(
    "acuities", [["high"], ["high", "low"], ["high", "medium", "low", "low"], ["medium"] * 8]
)
@pytest.mark.parametrize("tokens", [0, 1, 999, 1_000_003])
def test_allocations_never_exceed_the_pool_and_follow_acuity(
    acuities: list[str], tokens: int
) -> None:
    board = _board(acuities)
    held = allocate(board, Pool(tokens, 600.0))
    given = sum(c.budget.tokens_alloc for c in board.claims.values())
    assert given + held.tokens == tokens, "every token is either given or held, none is made up"
    assert held.tokens >= int(tokens * RETRIAGE_HOLD)
    seconds = sum(c.budget.seconds_alloc for c in board.claims.values())
    assert seconds + held.seconds == pytest.approx(600.0)
    assert sum(c.share for c in board.claims.values()) == pytest.approx(1.0)


def test_a_high_acuity_claim_gets_three_times_a_low_one() -> None:
    board = _board(["high", "low"])
    allocate(board, Pool(40_000, 400.0), hold=0.0)
    high, low = board.claims["C1"].budget, board.claims["C2"].budget
    assert (high.tokens_alloc, low.tokens_alloc) == (30_000, 10_000)
    assert high.seconds_alloc == pytest.approx(300.0)


def test_retriage_moves_only_what_closed_claims_did_not_spend() -> None:
    board = _board(["high", "medium", "low"])
    held = allocate(board, Pool(60_000, 600.0), hold=0.0)
    board.spend("C3", 2_000, 10.0)
    _close(board, "C3", State.REJECTED)  # allocated 10_000, spent 2_000: 8_000 freed
    before = {c: board.claims[c].budget.tokens_alloc for c in ("C1", "C2")}
    held = retriage(board, held)
    after = {c: board.claims[c].budget.tokens_alloc for c in ("C1", "C2")}
    moved = sum(after.values()) - sum(before.values())
    assert moved + held.tokens == 8_000
    assert (
        after["C1"] - before["C1"] == 8_000 * 3 // 5
        and after["C2"] - before["C2"] == 8_000 * 2 // 5
    )
    assert board.claims["C3"].budget.tokens_alloc == 2_000, (
        "a closed claim keeps only what it spent"
    )
    again = retriage(board, held)
    assert sum(board.claims[c].budget.tokens_alloc for c in ("C1", "C2")) == sum(after.values()) + (
        held.tokens - again.tokens
    )
    total = sum(c.budget.tokens_alloc for c in board.claims.values()) + again.tokens
    assert total == 60_000, "re-triage never makes budget: the total is the pool"


def test_without_retriage_the_freed_budget_stays_unspent() -> None:
    board = _board(["high", "low"])
    held = allocate(board, Pool(40_000, 400.0))
    freed = board.claims["C2"].budget.tokens_alloc  # C2 spent nothing
    _close(board, "C2", State.NOT_ESTABLISHED)
    before = board.claims["C1"].budget.tokens_alloc
    kept = retriage(board, held, enabled=False)
    assert board.claims["C1"].budget.tokens_alloc == before, "nothing moves"
    assert kept.tokens == held.tokens + freed, "the freed tokens are kept, not lost"


def test_retriage_with_no_open_claim_keeps_everything() -> None:
    board = _board(["high"])
    held = allocate(board, Pool(10_000, 100.0))
    _close(board, "C1", State.SUPPORTED)
    kept = retriage(board, held)
    assert kept.tokens == 10_000 - board.claims["C1"].budget.tokens_spent


@pytest.mark.parametrize(
    ("stage", "pilot", "review", "share"),
    [
        ("pilot", True, True, STAGE_SPLIT["pilot"]),
        ("workup", True, True, STAGE_SPLIT["workup"]),
        ("revise", True, True, STAGE_SPLIT["review"]),
        ("workup", False, True, STAGE_SPLIT["workup"] + STAGE_SPLIT["pilot"]),
        ("workup", False, False, 1.0),
        ("pilot", False, True, 0.0),
    ],
)
def test_stage_tokens_split_the_claim_and_never_pass_what_is_left(
    stage: str, pilot: bool, review: bool, share: float
) -> None:
    board = _board(["high"])
    board.claims["C1"].budget.tokens_alloc = 10_000
    assert stage_tokens(board.claims["C1"], stage, pilot=pilot, review=review) == int(
        10_000 * share
    )
    board.spend("C1", 9_500, 0.0)
    assert stage_tokens(board.claims["C1"], stage, pilot=pilot, review=review) <= 500


def test_must_stop_keeps_the_reserves() -> None:
    args = {"reserved_tokens": 10_000, "min_claim_tokens": 5_000, "reserved_seconds": 120.0}
    assert must_stop(tokens_left=15_000, seconds_left=121.0, **args) is None
    assert "tokens left" in (must_stop(tokens_left=14_999, seconds_left=500.0, **args) or "")
    assert "s left" in (must_stop(tokens_left=None, seconds_left=119.0, **args) or "")
    assert must_stop(tokens_left=None, seconds_left=500.0, **args) is None, (
        "time only: no token rule"
    )


def test_held_is_returned_and_logged() -> None:
    board = _board(["medium", "medium"])
    held = allocate(board, Pool(1_001, 10.0))
    assert isinstance(held, Held) and held.tokens >= 150
