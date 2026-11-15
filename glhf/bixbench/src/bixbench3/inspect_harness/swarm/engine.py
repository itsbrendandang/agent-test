"""The claims engine: pilot, workup and review for each claim on the Board, in parallel up to a cap.

    allocate the pool by acuity
    pilot every claim            (code checks the pilot's outputs: a failure is dead on arrival)
    work up every claim left     (code checks that its artifacts exist)
    up to `review_rounds` times:
        audit and critique each claim under review, on their own
        the harness runs the registered tests (hooks.after_critique)
        each claim moves by the Ledger's verdict and its open issues (board.review_outcome)
        re-triage: what closed claims did not spend goes to the open ones
        revise each claim that was sent back
    every claim still open is closed as not established

What runs a role, what checks its files and what the run has left is passed in (`Hooks`), so the
loop is the same in the solver and in tests. The engine never decides a verdict: it moves a claim
only by a code check or by the Ledger. A role that raises, times out or ends without its required
tool call is tried once more; after that the claim is closed as not established (a crash says
nothing about the claim, so it is never counted as a rejection) and the study goes on.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from bixbench3.inspect_harness.swarm.board import Board, ClaimRecord, State, review_outcome
from bixbench3.inspect_harness.swarm.claim_budget import (
    Held,
    Pool,
    allocate,
    call_tokens,
    must_stop,
    parse_mode,
    retriage,
)
from bixbench3.inspect_harness.swarm.flags import SwarmFlags
from bixbench3.inspect_harness.swarm.ledger import Ledger

ENGINE = "engine"  # the `by` of every change the engine makes
RETRIES = 1  # extra attempts after an error, a time-out or a malformed ending


@dataclass
class CallResult:
    """What one role call did. `status`: ok (ended with its required tool call), failed (ended, and
    reported that its work failed), malformed (ended without the required call), error, limit."""

    status: str
    tokens: int = 0
    seconds: float = 0.0
    note: str = ""
    model: str = ""

    @property
    def finished(self) -> bool:
        return self.status in ("ok", "failed")


@dataclass
class Left:
    tokens: int | None  # None: the run has no token budget
    seconds: float


@dataclass
class Check:
    passed: bool
    reason: str
    evidence: dict[str, Any] = field(default_factory=dict)


class Hooks(Protocol):
    async def call(
        self, role: str, mode: str, record: ClaimRecord, tokens: int | None, attempt: int
    ) -> CallResult: ...

    async def pilot_passed(self, record: ClaimRecord) -> Check: ...

    async def artifacts_present(self, record: ClaimRecord) -> Check: ...

    async def after_critique(self, round_no: int) -> None: ...

    def left(self) -> Left: ...


@dataclass
class Limits:
    reserved_tokens: int  # the report and finish reserves, never spent on claims
    min_claim_tokens: int  # one more claim step needs at least this
    reserved_seconds: float  # kept for the finisher and the report


@dataclass
class Summary:
    states: dict[str, str]
    stopped: str | None
    rounds: int
    held: Held


async def run_claims(
    board: Board,
    ledger: Ledger,
    hooks: Hooks,
    flags: SwarmFlags,
    pool: Pool,
    limits: Limits,
) -> Summary:
    budgeted = pool.tokens > 0
    board.event("flags", **flags.event(), budgeted=budgeted)
    held = allocate(board, pool)
    sem = asyncio.Semaphore(flags.max_parallel)
    stopped: str | None = None

    def stop_reason() -> str | None:
        left = hooks.left()
        return must_stop(
            tokens_left=left.tokens if budgeted else None,
            seconds_left=left.seconds,
            reserved_tokens=limits.reserved_tokens,
            min_claim_tokens=limits.min_claim_tokens,
            reserved_seconds=limits.reserved_seconds,
        )

    async def call(role: str, mode: str, record: ClaimRecord) -> CallResult:
        """One role on one claim, tried once more after an error, a limit or a malformed ending.
        Its token cap comes from its mode (claim_budget.call_tokens): a retry gets what the first
        attempt left of a review share, never a second share."""
        result = CallResult("error", note="not started")
        stage = parse_mode(mode)[0]
        for attempt in range(1, RETRIES + 2):
            tokens = call_tokens(record, mode, flags) if budgeted else None
            if tokens is not None and tokens <= 0:
                return CallResult("limit", note=f"no tokens left in the claim's {stage} share")
            record.attempts[mode] = record.attempts.get(mode, 0) + 1
            try:
                result = await hooks.call(role, mode, record, tokens, attempt)
            except Exception as error:  # a role never stops the study
                result = CallResult("error", note=f"{type(error).__name__}: {error}"[:300])
            board.spend(record.id, result.tokens, result.seconds, stage)
            board.event(
                "agent.call",
                claim_id=record.id,
                role=role,
                mode=mode,
                model=result.model,
                tokens=result.tokens,
                seconds=round(result.seconds, 3),
                outcome=result.status,
                attempt=attempt,
                note=result.note[:300],
            )
            if result.finished:
                return result
            board.note_error(
                record.id, f"{mode} attempt {attempt}: {result.status} {result.note}"[:300]
            )
        return result

    def close(record: ClaimRecord, reason: str, evidence: dict[str, Any] | None = None) -> None:
        if record.open:
            board.move(record.id, State.NOT_ESTABLISHED, ENGINE, reason, evidence)

    async def guarded(work: Callable[[ClaimRecord], Awaitable[None]], record: ClaimRecord) -> None:
        async with sem:
            if not record.open:
                return
            reason = stop_reason()
            if reason:
                return  # closed below by the global stop
            try:
                await work(record)
            except Exception as error:  # the loop's own bug must not stall the study either
                board.note_error(record.id, f"engine: {type(error).__name__}: {error}"[:300])
                close(record, "engine error")

    async def each(
        work: Callable[[ClaimRecord], Awaitable[None]], records: list[ClaimRecord]
    ) -> None:
        await asyncio.gather(*(guarded(work, r) for r in records), return_exceptions=True)

    async def pilot(record: ClaimRecord) -> None:
        board.move(record.id, State.PILOTING, ENGINE, "pilot granted")
        result = await call("experimenter", "pilot", record)
        if not result.finished:
            close(
                record,
                f"pilot did not finish after a retry ({result.status})",
                {"note": result.note},
            )
            return
        check = await hooks.pilot_passed(record)
        if check.passed:
            board.move(record.id, State.IN_WORKUP, ENGINE, check.reason, check.evidence)
        else:
            board.move(
                record.id,
                State.REJECTED,
                ENGINE,
                f"dead on arrival: {check.reason}",
                check.evidence,
            )

    async def workup(record: ClaimRecord, mode: str = "workup") -> None:
        result = await call("experimenter", mode, record)
        if not result.finished:
            close(
                record,
                f"{mode} did not finish after a retry ({result.status})",
                {"note": result.note},
            )
            return
        check = await hooks.artifacts_present(record)
        if check.passed:
            board.move(record.id, State.UNDER_REVIEW, ENGINE, check.reason, check.evidence)
        else:
            close(record, f"no artifacts after {mode}: {check.reason}", check.evidence)

    # -- pilot and workup --------------------------------------------------------------------------
    if flags.pilot:
        await each(pilot, board.in_state(State.TRIAGED))
    else:
        for record in board.in_state(State.TRIAGED):
            board.move(record.id, State.IN_WORKUP, ENGINE, "pilot is off (--no-pilot)")
    await each(workup, board.in_state(State.IN_WORKUP))

    # -- review rounds -----------------------------------------------------------------------------
    rounds = 0
    for n in range(1, flags.review_rounds + 1 if flags.review else 1):
        stopped = stop_reason()
        reviewing = board.in_state(State.UNDER_REVIEW)
        if stopped or not reviewing:
            break
        rounds = n
        critic_done: dict[str, bool] = {}

        async def audit(record: ClaimRecord, n: int = n) -> None:
            await call("auditor", f"audit {n}", record)

        async def critique(
            record: ClaimRecord, n: int = n, done: dict[str, bool] = critic_done
        ) -> None:
            done[record.id] = (await call("critic", f"critique {n}", record)).status == "ok"

        # The auditor and the critic review on their own; neither waits for the other's report.
        await asyncio.gather(
            each(audit, reviewing) if flags.auditor else asyncio.sleep(0),
            each(critique, reviewing),
        )
        await hooks.after_critique(n)
        for record in reviewing:
            if not record.open:
                continue
            budget_left = record.budget.tokens_left > 0 if budgeted else True
            state, reason, evidence = review_outcome(
                ledger,
                record,
                critic_completed=critic_done.get(record.id, False),
                rounds_left=flags.review_rounds - n,
                budget_left=budget_left,
            )
            evidence["round"] = n
            board.move(record.id, state, ENGINE, reason, evidence)
        held = retriage(board, held, enabled=flags.retriage)
        for record in board.in_state(State.SENT_BACK):
            board.move(record.id, State.IN_WORKUP, ENGINE, f"revise after round {n}")

        async def revise(record: ClaimRecord, n: int = n) -> None:
            await workup(record, f"revise {n}")

        await each(revise, board.in_state(State.IN_WORKUP))

    # -- close -------------------------------------------------------------------------------------
    stopped = stopped or stop_reason()
    if stopped:
        board.event("engine.stopped", reason=stopped)
    for record in board.open_claims():
        if record.state == State.UNDER_REVIEW and not flags.review:
            reason = "no review ran (review is off)"
        elif record.state == State.UNDER_REVIEW:
            reason = "review rounds are over"
        else:
            reason = stopped or "not finished"
        close(record, reason)
    summary = Summary({c.id: str(c.state) for c in board.claims.values()}, stopped, rounds, held)
    board.event("engine.finished", states=summary.states, stopped=stopped, rounds=rounds)
    return summary
