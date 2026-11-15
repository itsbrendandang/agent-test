"""The claims Board: every legal state change, illegal ones refused, outcomes read from the Ledger,
and the record on disk after every change."""

from __future__ import annotations

import asyncio
import itertools
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from bixbench3.inspect_harness.swarm.board import (
    BOARD_FILE,
    EVENTS_FILE,
    REJECTIONS_FILE,
    TERMINAL,
    TRANSITIONS,
    Artifact,
    Board,
    IllegalTransition,
    State,
    review_outcome,
)
from bixbench3.inspect_harness.swarm.ledger import Ledger

LEGAL = [(a, b) for a, targets in TRANSITIONS.items() for b in targets]
ILLEGAL = [(a, b) for a in State for b in State if b not in TRANSITIONS[a]]

# One path from TRIAGED to each state, so any transition can be tested from a real record.
PATH_TO = {
    State.TRIAGED: [],
    State.PILOTING: [State.PILOTING],
    State.IN_WORKUP: [State.PILOTING, State.IN_WORKUP],
    State.UNDER_REVIEW: [State.PILOTING, State.IN_WORKUP, State.UNDER_REVIEW],
    State.SENT_BACK: [State.PILOTING, State.IN_WORKUP, State.UNDER_REVIEW, State.SENT_BACK],
    State.SUPPORTED: [State.PILOTING, State.IN_WORKUP, State.UNDER_REVIEW, State.SUPPORTED],
    State.REJECTED: [State.PILOTING, State.REJECTED],
    State.NOT_ESTABLISHED: [State.NOT_ESTABLISHED],
}


def _board(tmp_path: Path | None = None) -> Board:
    ticks = itertools.count(1000)
    return Board("run-1", out_dir=tmp_path, clock=lambda: float(next(ticks)))


def _at(board: Board, state: State, claim_id: str = "C1") -> None:
    board.add(claim_id, "C10 down-regulates REST targets", ["degs"], "high", "proposer")
    for step in PATH_TO[state]:
        board.move(claim_id, step, "engine", "setup")


def test_the_table_covers_every_state_and_terminal_states_have_no_way_out() -> None:
    assert set(TRANSITIONS) == set(State)
    assert all(not TRANSITIONS[s] for s in TERMINAL)
    assert all(State.NOT_ESTABLISHED in TRANSITIONS[s] for s in State if s not in TERMINAL)
    assert TERMINAL == {State.SUPPORTED, State.REJECTED, State.NOT_ESTABLISHED}


@pytest.mark.parametrize(("start", "to"), LEGAL, ids=[f"{a}->{b}" for a, b in LEGAL])
def test_every_legal_transition_is_made_and_recorded(start: State, to: State) -> None:
    board = _board()
    _at(board, start)
    record = board.move("C1", to, "engine", "because")
    assert record.state == to
    assert record.history[-1].from_state == start and record.history[-1].to_state == to


@pytest.mark.parametrize(("start", "to"), ILLEGAL, ids=[f"{a}->{b}" for a, b in ILLEGAL])
def test_every_illegal_transition_is_refused_and_logged(
    tmp_path: Path, start: State, to: State
) -> None:
    board = _board(tmp_path)
    _at(board, start)
    with pytest.raises(IllegalTransition):
        board.move("C1", to, "engine", "not allowed")
    assert board.claims["C1"].state == start, "a refused change leaves the record as it was"
    last = json.loads((tmp_path / EVENTS_FILE).read_text().splitlines()[-1])
    assert last["kind"] == "claim.illegal_transition" and last["from"] == start and last["to"] == to


def test_a_claim_and_its_acuity_are_checked() -> None:
    board = _board()
    board.add("C1", "x", ["a"], "low", "proposer")
    with pytest.raises(ValueError, match="already on the board"):
        board.add("C1", "x", ["a"], "low", "proposer")
    with pytest.raises(ValueError, match="acuity"):
        board.add("C2", "x", ["a"], "urgent", "proposer")
    assert board.claims["C1"].work_dir == "/workspace/work/glhf/claims/C1"


def test_dead_on_arrival_and_review_rejections_go_to_the_rejection_file(tmp_path: Path) -> None:
    board = _board(tmp_path)
    _at(board, State.PILOTING, "C1")
    board.move("C1", State.REJECTED, "engine", "pilot script failed twice", {"exit_code": 1})
    _at(board, State.UNDER_REVIEW, "C2")
    board.move(
        "C2",
        State.REJECTED,
        "engine",
        "the ledger refuted the claim",
        {"ledger_verdict": "refuted"},
    )
    _at(board, State.UNDER_REVIEW, "C3")
    board.move("C3", State.SUPPORTED, "engine", "supported")
    rejected = json.loads((tmp_path / REJECTIONS_FILE).read_text())
    assert [(r["claim"], r["stage"], r["reason"]) for r in rejected] == [
        ("C1", "pilot", "pilot script failed twice"),
        ("C2", "review", "the ledger refuted the claim"),
    ]
    assert rejected[0]["evidence"] == {"exit_code": 1}
    assert rejected[1]["evidence"] == {"ledger_verdict": "refuted"}


def test_the_global_stop_closes_every_open_claim_and_only_those() -> None:
    board = _board()
    _at(board, State.IN_WORKUP, "C1")
    _at(board, State.SENT_BACK, "C2")
    _at(board, State.SUPPORTED, "C3")
    assert board.close_open("engine", "budget low") == ["C1", "C2"]
    assert [c.state for c in board.claims.values()] == [
        State.NOT_ESTABLISHED,
        State.NOT_ESTABLISHED,
        State.SUPPORTED,
    ]
    assert not board.open_claims()


def test_the_record_on_disk_after_every_change_reads_back_the_same(tmp_path: Path) -> None:
    board = _board(tmp_path)
    _at(board, State.SENT_BACK)
    board.spend("C1", 1200, 3.5)
    board.add_artifact(
        "C1",
        Artifact("/workspace/work/glhf/claims/C1/degs.csv", "ab" * 32, "experimenter", "workup"),
    )
    board.note_error("C1", "timeout in workup")
    on_disk = (tmp_path / BOARD_FILE).read_text()
    assert on_disk == board.to_json(), "written after the last change"
    again = Board.from_json(on_disk)
    assert again.to_json() == board.to_json()
    assert again.claims["C1"].state == State.SENT_BACK
    assert again.claims["C1"].budget.tokens_spent == 1200
    assert not list(tmp_path.glob(f".{BOARD_FILE}.*")), "no temporary file is left behind"


def test_events_from_claims_worked_in_parallel_keep_one_order(tmp_path: Path) -> None:
    board = _board(tmp_path)
    ids = [f"C{n}" for n in range(1, 7)]
    for claim_id in ids:
        board.add(claim_id, "x", ["a"], "medium", "proposer")

    async def work(claim_id: str) -> None:
        for step in PATH_TO[State.UNDER_REVIEW]:
            await asyncio.sleep(0)  # give the other claims a turn between changes
            board.move(claim_id, step, f"worker-{claim_id}", "step")

    async def main() -> None:
        await asyncio.gather(*(work(c) for c in ids))

    asyncio.run(main())
    lines = [json.loads(line) for line in (tmp_path / EVENTS_FILE).read_text().splitlines()]
    assert [e["seq"] for e in lines] == list(range(1, len(lines) + 1)), (
        "one line per event, in order"
    )
    assert len({e["claim_id"] for e in lines if e["kind"] == "claim.transition"}) == len(ids)
    assert all(c.state == State.UNDER_REVIEW for c in board.claims.values())
    by_claim = {
        c: [e["to"] for e in lines if e.get("claim_id") == c and e["kind"] == "claim.transition"]
        for c in ids
    }
    assert all(steps == list(PATH_TO[State.UNDER_REVIEW]) for steps in by_claim.values())


# -- review outcome: read from the Ledger, never from a model ----------------------------------


def _stub(verdict: str, issues: list[SimpleNamespace] | None = None) -> SimpleNamespace:
    claim = SimpleNamespace(verdict=verdict, e_value=40.0, threshold=10.0)
    return SimpleNamespace(claims={"C1": claim}, open_issues=lambda: list(issues or []))


def _record(board: Board) -> object:
    _at(board, State.UNDER_REVIEW)
    return board.claims["C1"]


def _issue(
    claim_ids: list[str] | None = None, artifacts: list[str] | None = None
) -> SimpleNamespace:
    return SimpleNamespace(id="I1", artifact_ids=artifacts or [], claim_ids=claim_ids or [])


@pytest.mark.parametrize(
    ("verdict", "issues", "critic", "rounds", "budget", "expected"),
    [
        ("supported", [], True, 1, True, State.SUPPORTED),
        ("supported", [], False, 1, True, State.NOT_ESTABLISHED),  # never supported unreviewed
        ("refuted", [], True, 1, True, State.REJECTED),
        ("refuted", [_issue(["C1"])], True, 1, True, State.REJECTED),  # refuted wins
        ("supported", [_issue(["C1"])], True, 1, True, State.SENT_BACK),
        ("supported", [_issue(["C1"])], True, 0, True, State.NOT_ESTABLISHED),  # no round left
        ("supported", [_issue(["C1"])], True, 1, False, State.NOT_ESTABLISHED),  # no budget left
        ("supported", [_issue(["C2"])], True, 1, True, State.SUPPORTED),  # another claim's issue
        (
            "supported",
            [_issue(artifacts=["degs"])],
            True,
            1,
            True,
            State.SENT_BACK,
        ),  # same artifact
        ("insufficient", [], True, 1, True, State.NOT_ESTABLISHED),
        ("untested", [], True, 1, True, State.NOT_ESTABLISHED),
    ],
)
def test_review_outcome_follows_the_ledger(
    verdict: str, issues: list, critic: bool, rounds: int, budget: bool, expected: State
) -> None:
    record = _record(_board())
    state, reason, evidence = review_outcome(
        _stub(verdict, issues),
        record,
        critic_completed=critic,
        rounds_left=rounds,
        budget_left=budget,  # type: ignore[arg-type]
    )
    assert state == expected, reason
    assert evidence["ledger_verdict"] == verdict
    assert state in TRANSITIONS[State.UNDER_REVIEW]


def test_review_outcome_with_the_real_ledger() -> None:
    ledger = Ledger()
    ledger.add_claim("C10 down-regulates REST targets", ["degs"], "no change", "proposer")
    board = _board()
    record = _record(board)
    state, _, evidence = review_outcome(
        ledger, record, critic_completed=True, rounds_left=1, budget_left=True
    )  # type: ignore[arg-type]
    assert (state, evidence["ledger_verdict"]) == (State.NOT_ESTABLISHED, "untested")
    ledger.raise_issue("blocking", ["degs"], "wrong contrast", "design.tsv", "critic")
    state, reason, _ = review_outcome(
        ledger, record, critic_completed=True, rounds_left=1, budget_left=True
    )  # type: ignore[arg-type]
    assert state == State.SENT_BACK and "I1" in reason
    board.move("C1", state, "engine", reason)
    assert board.claims["C1"].verdicts[-1].outcome == State.SENT_BACK
