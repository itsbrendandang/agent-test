"""Budget per claim: the claims never get more than the pool, re-triage moves only what a closed
claim did not spend, and the stop rule keeps the reserves."""

from __future__ import annotations

import pytest

from bixbench3.inspect_harness.swarm import solver
from bixbench3.inspect_harness.swarm.board import Board, State
from bixbench3.inspect_harness.swarm.claim_budget import (
    MIN_CALL_SECONDS,
    RETRIAGE_HOLD,
    REVIEW_SPLIT,
    STAGE_SPLIT,
    Held,
    Pool,
    allocate,
    call_seconds,
    call_tokens,
    must_stop,
    parse_mode,
    retriage,
    review_split,
    stage_tokens,
)
from bixbench3.inspect_harness.swarm.flags import SwarmFlags


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


# -- One call: review share per round and per role ------------------------------------------------
REVIEW_ROLES = ("audit", "critique", "revise")


def _claim(tokens: int = 100_000, seconds: float = 1_000.0) -> Board:
    board = _board(["high"])
    board.claims["C1"].budget.tokens_alloc = tokens
    board.claims["C1"].budget.seconds_alloc = seconds
    return board


def test_parse_mode() -> None:
    assert parse_mode("audit 2") == ("audit", 2)
    assert parse_mode("revise 1") == ("revise", 1)
    assert parse_mode("pilot") == ("pilot", 0)


def test_without_the_auditor_its_part_goes_to_the_critic() -> None:
    assert sum(REVIEW_SPLIT.values()) == pytest.approx(1.0)
    assert review_split(auditor=False) == pytest.approx({"critique": 0.75, "revise": 0.25})


@pytest.mark.parametrize("rounds", [1, 2, 3, 5])
def test_the_last_round_still_has_review_tokens_when_every_round_spends_its_cap(
    rounds: int,
) -> None:
    board = _claim()
    record = board.claims["C1"]
    flags = SwarmFlags(review_rounds=rounds)
    review = int(100_000 * STAGE_SPLIT["review"])
    for n in range(1, rounds + 1):
        for role in REVIEW_ROLES:
            cap = call_tokens(record, f"{role} {n}", flags)
            assert cap > 0, f"{role} in round {n} of {rounds} found the review share empty"
            board.spend("C1", cap, 0.0, role)  # each call spends all it was given
    spent = sum(record.budget.stage_tokens_spent.get(r, 0) for r in REVIEW_ROLES)
    assert spent <= review, "the review caps never add up to more than the review share"


def test_what_a_round_does_not_use_rolls_forward_to_the_same_role() -> None:
    record = _claim().claims["C1"]
    flags = SwarmFlags(review_rounds=2)
    first = call_tokens(record, "critique 1", flags)
    assert call_tokens(record, "critique 2", flags) == 2 * first, "round 1 spent nothing"


def test_a_review_retry_gets_what_the_first_attempt_left_not_a_second_share() -> None:
    board = _claim()
    flags = SwarmFlags(review_rounds=2)
    cap = call_tokens(board.claims["C1"], "audit 1", flags)
    board.spend("C1", cap - 100, 0.0, "audit")
    assert call_tokens(board.claims["C1"], "audit 1", flags) == 100


def test_pilot_and_workup_keep_their_stage_share() -> None:
    record = _claim().claims["C1"]
    for mode in ("pilot", "workup"):
        assert call_tokens(record, mode, SwarmFlags()) == stage_tokens(record, mode)


def test_spend_per_role_survives_the_board_json() -> None:
    board = _claim()
    board.spend("C1", 700, 12.5, "critique")
    again = Board.from_json(board.to_json())
    assert again.claims["C1"].budget.stage_tokens_spent == {"critique": 700}
    assert again.claims["C1"].budget.stage_seconds_spent == {"critique": 12.5}


# -- One call: its time limit --------------------------------------------------------------------
@pytest.mark.parametrize("mode", ["pilot", "workup", "audit 1", "critique 2", "revise 1"])
@pytest.mark.parametrize("seconds_left", [0.0, 5.0, 29.0, 400.0])
def test_the_floor_never_spends_more_than_the_claim_has_left(
    mode: str, seconds_left: float
) -> None:
    board = _claim(seconds=seconds_left)
    seconds = call_seconds(board.claims["C1"], mode, SwarmFlags(), run_left=10_000.0)
    assert seconds <= seconds_left
    if seconds_left >= MIN_CALL_SECONDS:
        assert seconds >= MIN_CALL_SECONDS


def test_a_pilot_does_not_use_the_time_its_later_stages_need() -> None:
    record = _claim(seconds=1_000.0).claims["C1"]
    later = 1_000.0 * (STAGE_SPLIT["workup"] + STAGE_SPLIT["review"])
    # Plenty of wall clock: the pilot gets its share.
    assert call_seconds(record, "pilot", SwarmFlags(), run_left=10_000.0) == pytest.approx(150.0)
    # Short wall clock: the pilot leaves the workup and the review their time.
    assert call_seconds(record, "pilot", SwarmFlags(), run_left=later + 40.0) == pytest.approx(40.0)
    # Too short for both: the pilot still gets what the run has, never more.
    assert call_seconds(record, "pilot", SwarmFlags(), run_left=20.0) == pytest.approx(20.0)


def test_calls_at_the_same_time_each_end_by_the_run_deadline_and_stay_in_their_claims() -> None:
    board = _board(["high", "low", "medium"])
    held = allocate(board, Pool(0, 300.0))
    assert held.seconds >= 0
    run_left = 300.0
    calls = {
        c.id: call_seconds(c, "pilot", SwarmFlags(), run_left=run_left)
        for c in board.claims.values()
    }
    for claim_id, seconds in calls.items():
        assert seconds <= run_left
        assert seconds <= board.claims[claim_id].budget.seconds_left
    assert sum(calls.values()) <= 300.0, "the floor never spends another claim's time"


# -- Booking a claim call in the run's TokenBook -------------------------------------------------
def test_a_claim_call_is_booked_and_its_overshoot_borrowed_never_from_the_report() -> None:
    book = solver.TokenBook(solver.plan_budget(1_000_000, 24 * 3600))
    report = book.reserves["report"]
    within = book.charge("claim C1:pilot:1", 9_000, 10_000)
    assert (within["used"], within["overshoot"], within["borrowed"]) == (9_000, 0, {})
    over = book.charge("claim C1:workup:1", 12_000, 10_000)
    assert over["overshoot"] == 2_000 and sum(over["borrowed"].values()) == 2_000
    assert book.used == 21_000 and book.reserves["report"] == report


def test_the_relevance_judge_pays_only_its_own_tokens_while_claims_run() -> None:
    """The judge is settled between claim calls (after each critique round). With each claim
    call booked as it ends, its settle sees only its own tokens: no false overshoot."""
    book = solver.TokenBook(solver.plan_budget(1_000_000, 24 * 3600))
    book.used = 50_000  # the triage phase
    for n in range(4):
        book.charge(f"claim C{n}:workup:1", 40_000, 60_000)
    run_total = book.used  # what sample_limits() would report now
    grant = book.grant("relevance 1", [])
    settled = book.settle(grant, run_total + 1_000)
    assert settled["spent"] == 1_000 and settled["overshoot"] == 0 and settled["borrowed"] == {}
