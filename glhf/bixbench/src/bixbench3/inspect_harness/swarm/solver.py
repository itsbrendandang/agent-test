"""GLHF swarm solver, nine roles:
scout -> propose -> pilot -> experiment -> [audit + critique -> revise] (loop) -> finish -> report.

Same sandbox, time limit and grader as the single-agent baseline (`bixbench3_agent`), and the
baseline's four tools. The swarm's roles also have check_outputs (a shape check built from the
task's expected outputs), the ledger tools and, when switched on, search_docs and memory; the
baseline has none of these. Runs that use them must say so.
Orchestration is code, not a supervisor model: phases, budgets and the stop rule are fixed here.

Budgets (`plan_budget`, `TokenBook`, `seconds_for`): every phase has a floor, the least it needs to
produce its files (`NEEDS`). A phase may spend up to a target share, and what earlier phases did
not use rolls forward to it, but never the floors of the phases still owed nor the named
reserves (overshoot, finish, report). If the run's limits cannot cover the floors of the full
plan, a smaller plan is chosen before the first role starts and written to the ledger. A role
that hits a limit gets one short final turn, without tools, to write a hand-off for the next
role. Every one of these decisions is a `budget.*` or `handoff.*` event with numbers.

Per-role models (task args, default = the eval's --model), one per group of roles:
  planner_model (scout, proposer), experimenter_model (pilot, experimenter, reviser, finisher),
  critic_model (methods auditor, critic), reporter_model
e.g. -T critic_model=openai/gpt-5.5 to put the critic on a second vendor (Claude + OpenAI credits).
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from typing import Any

from inspect_ai.agent import Agent, AgentState, react, run
from inspect_ai.model import (
    ChatMessage,
    ChatMessageSystem,
    ChatMessageUser,
    CompactionAuto,
    GenerateConfig,
    Model,
    get_model,
)
from inspect_ai.solver import Generate, Solver, TaskState, solver
from inspect_ai.tool import Tool, bash_session, python, text_editor
from inspect_ai.util import (
    Limit,
    LimitExceededError,
    apply_limits,
    message_limit,
    sample_limits,
    sandbox,
    time_limit,
    token_limit,
)

from ..models import RuntimeCase
from ..tools import request_web_access
from . import baseline, past_memory, relevance, roles
from .ledger import RELEVANCE_THRESHOLD, UNREVIEWED, Ledger
from .memory import add_pending, filter_lessons, load_memory
from .tools import (
    MIN_TEST_SECONDS,
    TEST_SECONDS,
    WORK,
    background_processes,
    check_contract,
    check_failed,
    check_outputs,
    contract_text,
    needs_rescue,
    persist_ledger,
    propose_claim,
    raise_issue,
    read_ledger,
    record_falsification_test,
    register_falsification_test,
    report_failed_replication,
    resolve_issue,
    run_registered_test,
    save_ledger,
    search_docs,
)

# Fractions of the run's time budget. Whatever a phase does not use rolls forward.
SCOUT_SHARE = 0.03
PLAN_SHARE = 0.04
PILOT_SHARE = 0.08
FIRST_PASS_SHARE = 0.45
FINISH_RESERVE = 0.05  # kept back so a missing artifact can still be rescued after review
REPORT_RESERVE = 0.05  # always kept for the reporter and final writes
MIN_REVIEW_SECONDS = 15 * 60  # for long runs; short runs use min_review_seconds()
MIN_REVIEW_SHARE = 0.15
# The phases before review leave this many times min_review_seconds() for the first round:
# the round is started only when that much is left, and hand-offs and checks take time too.
REVIEW_MARGIN = 1.2
RUN_MARGIN = 0.03  # of the sample's time limit, kept out of every phase's share
FINAL_WRITES_SHARE = 0.015  # of the sample's time limit, kept after the report for final writes
MIN_FINAL_WRITES_SECONDS = 30
MIN_FINISH_SECONDS = 5 * 60
MAX_FINISH_HOLD = 0.25  # the finisher's reserve never takes more than this share of the run
MIN_PHASE_SECONDS = 10  # a phase with less time than this is skipped, not started
AUDIT_SHARE = 0.10  # of the review time left in a round
CRITIQUE_SHARE = 0.30
RELEVANCE_SHARE = 0.05  # of the review time left after the critique: one model call, no tools
EXECUTE_SHARE = 0.5  # of the review time then left, shared by the registered tests to run
PILOT_OUT = f"{WORK}/pilot/outputs"
REPORT_TOKEN_RESERVE = 0.10  # of max_tokens, kept for the reporter
assert REPORT_TOKEN_RESERVE == baseline.REPORT_TOKEN_RESERVE  # same rule for both solvers
# With a token budget, the supporting roles are capped so the full run and the review keep most
# of it. Shares of max_tokens by phase (first word of the phase name); other phases take what is left.
TOKEN_SHARE = {
    "scout": 0.05,
    "propose": 0.08,
    "pilot": 0.15,
    "audit": 0.08,
    "critique": 0.20,
    "relevance": 0.02,  # the relevance judge: part of review, one call per round
}
SEARCH_ROLES = {"scout", "planner", "pilot", "experimenter", "reviser", "finisher", "auditor"}


def finish_hold(budget: float) -> float:
    """Share of the run kept back for the finisher: FINISH_RESERVE, raised to MIN_FINISH_SECONDS
    when the run is long enough for that to be at most MAX_FINISH_HOLD of it (20 minutes or more),
    so the reserve is never smaller than what the finisher needs to start."""
    if budget > 0 and MIN_FINISH_SECONDS / budget <= MAX_FINISH_HOLD:
        return max(FINISH_RESERVE, MIN_FINISH_SECONDS / budget)
    return FINISH_RESERVE


def min_review_seconds(budget: float) -> float:
    """Review time a round needs before it is started: 15 minutes, or 15% of a short run.

    A fixed 15 minutes meant the default 30-minute local run never reviewed: after the first
    pass about 5 minutes are left before the reserves. Scaled, such a run gets one round."""
    return min(float(MIN_REVIEW_SECONDS), budget * MIN_REVIEW_SHARE)


def review_room(budget: float) -> float:
    """Seconds the phases before review must leave so that one round can start."""
    return REVIEW_MARGIN * min_review_seconds(budget)


def study_names(case: object) -> tuple[list[str], list[str]]:
    """The paper's title(s) and author surnames, when the case record has them, for the search
    guard. The BixBench3 metadata has neither today (paper_id and doi only), so both are empty
    there; a case record that gains `title` or `authors` is protected without a change here."""
    title, authors = getattr(case, "title", None), getattr(case, "authors", None)
    titles = [title] if isinstance(title, str) else list(title or [])
    names = [authors] if isinstance(authors, str) else list(authors or [])
    return [str(t) for t in titles if t], [str(a) for a in names if a]


def review_step(critic: PhaseResult, open_issues: int) -> str:
    """What follows a critique: "stop" (the critic could not run), "converged" (it finished
    and nothing is open), "again" (it was cut off with nothing open: no verdict, look again),
    or "revise". "No open issues" means nothing when the critic did not finish looking."""
    if not critic.ran:
        return "stop"
    if open_issues:
        return "revise"
    return "converged" if critic.completed else "again"


@dataclass
class Clock:
    budget: float  # what the phases share: the sample's time limit minus RUN_MARGIN
    started: float
    total: float = 0.0  # the sample's own time limit; 0 = same as budget

    def left(self) -> float:
        return self.budget - (time.monotonic() - self.started)

    def report_seconds(self) -> int:
        """Time for the reporter, from the time the sample really has left: everything up to
        its limit except what the final writes need. Never more, so the sample's limit cannot
        cut the report or the files written after it; under MIN_PHASE_SECONDS it is skipped."""
        total = self.total or self.budget
        sample_left = total - (time.monotonic() - self.started)
        final = max(float(MIN_FINAL_WRITES_SECONDS), total * FINAL_WRITES_SHARE)
        return int(max(0.0, sample_left - final))

    def slice(self, share: float, reserve: float = 0.0) -> int:
        """Seconds for a phase: its share of the run, never into `reserve` (a share of the run).
        A phase gets at least a minute only while that minute does not come out of the reserve."""
        available = self.left() - self.budget * reserve
        return int(max(0.0, min(max(60.0, self.budget * share), available)))


@dataclass
class PhaseResult:
    ran: bool
    limit: str | None = None  # the limit that ended it early: time, token, message

    @property
    def completed(self) -> bool:
        return self.ran and self.limit is None


# --- The budget plan (pure: no sandbox, no model, no clock) ------------------------------------

PHASE_ORDER = (
    "scout",
    "propose",
    "pilot",
    "experiment",
    "audit",
    "critique",
    "relevance",
    "revise",
    "finish",
    "report",
)
REVIEW_KINDS = ("audit", "critique", "relevance", "revise")
MANDATORY = ("experiment", "report")  # a plan never drops these


@dataclass(frozen=True)
class Need:
    """The least a phase needs to produce its files. A phase given less is not started."""

    produces: str
    calls: int  # model calls
    seconds: int


# One model call re-sends the role's context, so it costs about this many tokens (brief, role
# instructions, tool definitions and a short history). An estimate, not a measurement.
TOKENS_PER_CALL = 5_000
NEEDS = {
    "scout": Need("data_report.md and sample_sheet.tsv", 5, 60),
    "propose": Need("plan.md and the registered claims", 5, 60),
    "pilot": Need("the pipeline scripts and one subsampled set of artifacts", 20, 180),
    "experiment": Need("a first complete version of every required artifact", 24, 480),
    "audit": Need("adherence.md", 8, 45),
    "critique": Need("one registered and recorded test per claim", 16, 120),
    "relevance": Need("one relevance judgement per registered test", 2, 20),
    "revise": Need("a fix for each blocking issue", 12, 90),
    "finish": Need("the rescue of one missing artifact", 8, MIN_FINISH_SECONDS),
    "report": Need("METHODS.md", 6, 60),
}
# Plans, tried in this order: the first one whose floors fit both limits is chosen.
LADDER: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("full", ()),
    ("lean", ("pilot", "audit")),
    ("no_review", ("pilot", "audit", "critique", "relevance", "revise")),
    ("direct", ("scout", "propose", "pilot", "audit", "critique", "relevance", "revise")),
    ("bare", ("scout", "propose", "pilot", "audit", "critique", "relevance", "revise", "finish")),
)
BELOW_FLOOR = "below_floor"  # not even experiment + report fit: both run on scaled-down floors
FIRST_PASS_TOKEN_SHARE = 0.40
# Targets: a phase may spend up to the sum of the targets up to and including its own, minus
# what is already spent. So what an earlier phase did not use rolls forward.
TOKEN_TARGET = {
    **{k: TOKEN_SHARE[k] for k in ("scout", "propose", "pilot")},
    "experiment": FIRST_PASS_TOKEN_SHARE,
}
TIME_TARGET = {
    "scout": SCOUT_SHARE,
    "propose": PLAN_SHARE,
    "pilot": PILOT_SHARE,
    "experiment": FIRST_PASS_SHARE,
}
REVISE_SHARE = 0.6  # of the review time left; 0.9 in the last round
# Named reserves. A token limit is checked after a model call, so a role can pass its limit by
# one call: that overshoot is paid from "overshoot", then from "finish", never from "report".
OVERSHOOT_SHARE = 0.05
# Inside every phase's allowance, for the one forced final turn of a role that hits its limit.
HANDOFF_TOKENS = 3_000
HANDOFF_SECONDS = 45
HANDOFF_SHARE = 0.10  # never more than this share of the phase's allowance
HANDOFF_DIR = f"{WORK}/handoff"
REVIEWERS = ("auditor", "critic")


def kind_of(title: str) -> str:
    """'critique 2' -> 'critique'."""
    return title.split()[0]


def overshoot_reserve(max_tokens: int) -> int:
    return int(max_tokens * OVERSHOOT_SHARE)


def _cumulative(targets: dict[str, float], kind: str) -> float:
    return sum(targets[k] for k in PHASE_ORDER[: PHASE_ORDER.index(kind) + 1] if k in targets)


@dataclass(frozen=True)
class BudgetPlan:
    """What the run will do with its limits, decided before the first role starts."""

    mode: str  # a name from LADDER, or BELOW_FLOOR
    phases: tuple[str, ...]  # kinds that run ("finish" = its reserve is held)
    skipped: tuple[str, ...]
    limited_by: tuple[str, ...]  # what ruled out the full plan: "tokens", "time"
    reason: str
    max_tokens: int | None
    seconds: int
    token_floors: dict[str, int]  # empty without max_tokens
    time_floors: dict[str, int]
    reserves: dict[str, int]  # tokens: overshoot, finish, report; empty without max_tokens
    time_reserves: dict[str, int]  # seconds: finish, report
    needed: dict[str, dict[str, int]]  # what the full plan and the chosen plan need

    @property
    def degraded(self) -> bool:
        return self.mode != "full"

    def event(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "phases": list(self.phases),
            "skipped": list(self.skipped),
            "limited_by": list(self.limited_by),
            "reason": self.reason,
            "max_tokens": self.max_tokens,
            "seconds": self.seconds,
            "token_floors": self.token_floors,
            "time_floors": self.time_floors,
            "token_reserves": self.reserves,
            "time_reserves": self.time_reserves,
            "needed": self.needed,
        }


def _kinds(dropped: tuple[str, ...], review_rounds: int) -> tuple[str, ...]:
    return tuple(
        k for k in PHASE_ORDER if k not in dropped and (review_rounds > 0 or k not in REVIEW_KINDS)
    )


def _report_tokens(max_tokens: int, floor: int) -> int:
    return max(floor, int(max_tokens * REPORT_TOKEN_RESERVE))


def _tokens_needed(kinds: tuple[str, ...], max_tokens: int) -> int:
    work = sum(NEEDS[k].calls * TOKENS_PER_CALL for k in kinds if k != "report")
    report = _report_tokens(max_tokens, NEEDS["report"].calls * TOKENS_PER_CALL)
    return work + report + overshoot_reserve(max_tokens)


def _seconds_needed(kinds: tuple[str, ...], seconds: float) -> int:
    work = sum(NEEDS[k].seconds for k in kinds if k not in ("finish", "report", *REVIEW_KINDS))
    review = float(sum(NEEDS[k].seconds for k in kinds if k in REVIEW_KINDS))
    if "critique" in kinds:  # a plan with review must be able to start one round
        review = max(review, review_room(seconds))
    work += int(review)
    finish = finish_hold(seconds) * seconds if "finish" in kinds else 0.0
    return int(work + finish + max(NEEDS["report"].seconds, seconds * REPORT_RESERVE))


def plan_budget(max_tokens: int | None, seconds: float, review_rounds: int = 3) -> BudgetPlan:
    """Choose the plan for a run with `max_tokens` (None = no token limit) and `seconds` (the
    time the phases share). Pure, so the choice can be tested and shown before any run.

    The first plan in LADDER whose floors and reserves fit both limits wins. If even
    experiment + report do not fit, both still run (BELOW_FLOOR) on floors scaled down to the
    limit, and the plan says so."""
    full = _kinds((), review_rounds)

    def fits(kinds: tuple[str, ...]) -> tuple[bool, bool]:
        tokens_ok = max_tokens is None or _tokens_needed(kinds, max_tokens) <= max_tokens
        return tokens_ok, _seconds_needed(kinds, seconds) <= seconds

    limited_by = tuple(
        name for name, ok in zip(("tokens", "time"), fits(full), strict=True) if not ok
    )
    mode, kinds = BELOW_FLOOR, _kinds(LADDER[-1][1], review_rounds)
    for name, dropped in LADDER:
        candidate = _kinds(dropped, review_rounds)
        if all(fits(candidate)):
            mode, kinds = name, candidate
            break
    tokens_ok, time_ok = fits(kinds)

    token_floors: dict[str, int] = {}
    reserves: dict[str, int] = {}
    if max_tokens is not None:
        scale = 1.0
        if not tokens_ok:  # BELOW_FLOOR: experiment and report share what the limit has
            floors = sum(NEEDS[k].calls * TOKENS_PER_CALL for k in MANDATORY)
            scale = (max_tokens - overshoot_reserve(max_tokens)) / floors
        token_floors = {k: int(n.calls * TOKENS_PER_CALL * scale) for k, n in NEEDS.items()}
        reserves = {
            "overshoot": overshoot_reserve(max_tokens),
            "finish": token_floors["finish"] if "finish" in kinds else 0,
            "report": _report_tokens(max_tokens, token_floors["report"]),
        }
    time_scale = 1.0 if time_ok else seconds / sum(NEEDS[k].seconds for k in MANDATORY)
    time_floors = {k: int(n.seconds * time_scale) for k, n in NEEDS.items()}
    time_reserves = {
        "finish": int(finish_hold(seconds) * seconds) if "finish" in kinds else 0,
        "report": int(max(time_floors["report"], seconds * REPORT_RESERVE)),
    }

    def need(of: tuple[str, ...]) -> dict[str, int]:
        out = {"seconds": _seconds_needed(of, seconds)}
        if max_tokens is not None:
            out["tokens"] = _tokens_needed(of, max_tokens)
        return out

    needed = {"full": need(full), "chosen": need(kinds)}
    if mode == "full":
        reason = "The limits cover the floor of every phase."
    else:
        short = []
        if "tokens" in limited_by:
            short.append(f"max_tokens {max_tokens:,} < {needed['full'].get('tokens', 0):,} tokens")
        if "time" in limited_by:
            short.append(f"{int(seconds)} s < {needed['full']['seconds']} s")
        reason = f"The limits do not cover the floors of the full plan ({'; '.join(short)})."
        if mode == BELOW_FLOOR:
            reason += (
                " They do not cover experiment + report either "
                f"({', '.join(f'{v:,} {k}' for k, v in sorted(needed['chosen'].items()))} needed): "
                "both run on scaled-down floors."
            )
    return BudgetPlan(
        mode=mode,
        phases=kinds,
        skipped=tuple(k for k in full if k not in kinds),
        limited_by=limited_by,
        reason=reason,
        max_tokens=max_tokens,
        seconds=int(seconds),
        token_floors=token_floors,
        time_floors=time_floors,
        reserves=reserves,
        time_reserves=time_reserves,
        needed=needed,
    )


@dataclass
class Owed:
    """The phases still owed their floor, in order. Later rounds of review are not owed one:
    they run only if their floor is still there."""

    kinds: list[str]

    @classmethod
    def of(cls, plan: BudgetPlan) -> Owed:
        return cls([k for k in plan.phases if k not in ("finish", "report")])

    def start(self, kind: str) -> list[str]:
        """Phase `kind` starts (or is skipped): the phases whose floors it must leave alone."""
        if kind in self.kinds:
            del self.kinds[: self.kinds.index(kind) + 1]
        elif kind in ("finish", "report"):
            self.kinds.clear()
        later = list(self.kinds)
        if kind == "audit" and "critique" not in later:
            later.append("critique")  # in any round an audit may not starve its critique
        if kind in ("audit", "critique") and "relevance" not in later:
            # nor may either starve the relevance judgement: a test nobody judged cannot be
            # run, so the critic's work in that round would count for nothing
            later.append("relevance")
        return later


@dataclass(frozen=True)
class Grant:
    """One phase's token allowance, with the numbers behind it."""

    phase: str
    tokens: int  # all the phase may cost, its forced final turn included
    limit: int  # the limit on the role's own work: tokens - handoff
    handoff: int  # kept for the forced final turn
    floor: int
    protected: int  # floors of the phases still owed and reserves, which it may not touch
    rolled_forward: int  # part of `tokens` that earlier phases left unused
    reserve_refilled: int = 0  # tokens moved into the overshoot reserve from unowed budget
    skip: str | None = None  # why it does not run: "below_floor" or "tokens"
    overdrawn: int = 0  # report only: its floor plus the reserve held, minus what is left

    def event(self) -> dict[str, Any]:
        return {
            "phase": self.phase,
            "tokens": self.tokens,
            "limit": self.limit,
            "handoff_reserve": self.handoff,
            "floor": self.floor,
            "protected": self.protected,
            "rolled_forward": self.rolled_forward,
            "overshoot_reserve_refilled": self.reserve_refilled,
        }


@dataclass
class TokenBook:
    """The run's token account. `grant` before a phase, `settle` after it. Pure arithmetic."""

    plan: BudgetPlan
    used: int = 0
    reserves: dict[str, int] = field(default_factory=dict)  # what is left of each

    def __post_init__(self) -> None:
        assert self.plan.max_tokens is not None
        self.max_tokens: int = self.plan.max_tokens
        self.reserves = dict(self.plan.reserves)

    def grant(self, title: str, later: list[str]) -> Grant:
        """Tokens for phase `title`; `later` = the phases whose floors it must leave (Owed.start).

        Before the grant the overshoot reserve is topped up to its planned size from tokens
        that are nobody's floor: an earlier overshoot is then paid by slack, and the reserve
        is whole again for the next role that passes its limit."""
        kind = kind_of(title)
        floors = self.plan.token_floors
        left = self.max_tokens - self.used
        report = kind == "report"
        floor = self.reserves["report"] if report else floors[kind]
        finish = 0 if kind in ("finish", "report") else self.reserves["finish"]
        owed = 0 if report else sum(floors[k] for k in later) + finish + self.reserves["report"]
        held = self.reserves["overshoot"]
        refill = max(0, min(self.plan.reserves["overshoot"], left - owed - floor) - held)
        self.reserves["overshoot"] = held + refill
        protected = owed + held + refill
        available = left - protected
        rolled, overdrawn, skip = 0, 0, None
        if report:
            # Everything left except the overshoot reserve, which pays for this phase's own
            # overshoot. The floor is guaranteed: a run always ends documented.
            tokens = max(available, floor)
            overdrawn = max(0, tokens - available)  # floor + reserve that are not there
        else:
            cap: int | None = None  # the last working phase takes all that is not protected
            if kind in TOKEN_TARGET and later:
                cap = int(self.max_tokens * _cumulative(TOKEN_TARGET, kind)) - self.used
                rolled = max(0, cap - int(self.max_tokens * TOKEN_TARGET[kind]))
            elif kind in ("audit", "critique", "relevance"):
                cap = int(self.max_tokens * TOKEN_SHARE[kind])
            tokens = max(0, min(available if cap is None else max(floor, cap), available))
            rolled = min(tokens - floor if cap is None else rolled, max(0, tokens - floor))
            # A role with less than its floor would stop before it wrote anything, so it is
            # not started. The experimenter is the exception: its work is the run.
            skip = "tokens" if tokens <= 0 else None
            if tokens < floor and kind != "experiment":
                skip = "below_floor"
        handoff = min(HANDOFF_TOKENS, int(tokens * HANDOFF_SHARE))
        return Grant(
            phase=title,
            tokens=tokens,
            limit=tokens - handoff,
            handoff=handoff,
            floor=floor,
            protected=protected,
            rolled_forward=max(0, rolled),
            reserve_refilled=refill,
            skip=skip,
            overdrawn=overdrawn,
        )

    def settle(self, grant: Grant, used_now: int) -> dict[str, Any]:
        """Book what the phase really spent. Tokens over its allowance are borrowed from the
        overshoot reserve, then from the finish reserve; never from the report's."""
        spent = used_now - self.used
        self.used = used_now
        over = max(0, spent - grant.tokens)
        lenders: tuple[str, ...] = ("overshoot", "finish")
        if kind_of(grant.phase) in ("finish", "report"):
            # The finish reserve is already inside these two phases' allowance: it is spent,
            # not lent a second time.
            lenders = ("overshoot",)
            self.reserves["finish"] = 0
        borrowed: dict[str, int] = {}
        for name in lenders:
            take = min(over - sum(borrowed.values()), self.reserves[name])
            if take > 0:
                borrowed[name] = take
                self.reserves[name] -= take
        return {
            "phase": grant.phase,
            "spent": spent,
            "allowed": grant.tokens,
            "unused_rolls_forward": max(0, grant.tokens - spent),
            "overshoot": over,
            "borrowed": borrowed,
            "not_covered": over - sum(borrowed.values()),
            "reserves_left": dict(self.reserves),
            "used": self.used,
            "left": self.max_tokens - self.used,
        }


def seconds_for(
    plan: BudgetPlan, title: str, elapsed: float, later: list[str], last_round: bool = False
) -> int:
    """Seconds for a phase before the finisher, `elapsed` seconds into the run. Same rules as
    the tokens: at least its floor, at most its target plus what earlier phases left unused,
    and never the floors of the phases still owed nor the finish and report reserves."""
    kind = kind_of(title)
    left = plan.seconds - elapsed
    hold = plan.time_reserves["finish"] + plan.time_reserves["report"]
    review_floors = float(sum(plan.time_floors[k] for k in later if k in REVIEW_KINDS))
    others_owed = sum(plan.time_floors[k] for k in later if k not in REVIEW_KINDS)
    available = left - hold - others_owed - review_floors
    if kind in TIME_TARGET and "critique" in later:
        # Before review: leave room for one round to start, not only the review floors. With
        # the floors alone, the early phases could take 76% of a short run and review, which
        # starts only with min_review_seconds() left, never ran. The extra room yields to this
        # phase's own floor, so a late run still gets its first pass.
        roomy = left - hold - others_owed - max(review_floors, review_room(plan.seconds))
        available = max(roomy, min(float(plan.time_floors[kind]), available))
    want: float | None = None  # the last working phase takes all that is not protected
    if kind in TIME_TARGET and later:
        want = plan.seconds * _cumulative(TIME_TARGET, kind) - elapsed
    elif kind in REVIEW_KINDS:
        review_left = left - hold
        share = {
            "audit": AUDIT_SHARE,
            "critique": CRITIQUE_SHARE,
            "relevance": RELEVANCE_SHARE,
        }.get(kind, 0.9 if last_round else REVISE_SHARE)
        want = review_left * share
    grant = available if want is None else max(float(plan.time_floors[kind]), want)
    return int(max(0.0, min(grant, available)))


def allocation(plan: BudgetPlan) -> list[dict[str, Any]]:
    """The plan as a table: what each phase gets if every phase before it spends all it may
    (one round of review, a finisher that runs). For documents and tests; the run itself
    grants phase by phase from what is really left."""
    book = TokenBook(plan) if plan.max_tokens is not None else None
    owed, elapsed, rows = Owed.of(plan), 0.0, []
    for kind in PHASE_ORDER:
        if kind not in plan.phases:
            rows.append({"phase": kind, "tokens": 0 if book else None, "seconds": 0})
            continue
        later = owed.start(kind)
        if kind == "report":
            seconds = int(plan.seconds - elapsed)
        elif kind == "finish":
            seconds = int(plan.seconds - elapsed - plan.time_reserves["report"])
        else:
            seconds = seconds_for(plan, kind, elapsed, later, last_round=True)
        elapsed += seconds
        tokens: int | None = None
        if book:
            grant = book.grant(kind, later)
            tokens = 0 if grant.skip else grant.tokens
            book.settle(grant, book.used + tokens)
        rows.append({"phase": kind, "tokens": tokens, "seconds": seconds})
    return rows


def digest(messages: list[ChatMessage], chars: int) -> str:
    """The end of a role's transcript in at most `chars` characters, newest steps kept."""
    parts: list[str] = []
    room = chars
    for message in reversed([m for m in messages if m.role != "system"]):
        calls = getattr(message, "tool_calls", None) or []
        called = "".join(f"\n[calls {c.function}: {str(c.arguments)[:300]}]" for c in calls)
        text = f"{message.role}: {message.text.strip()[:1500]}{called}"
        if len(text) > room:
            if room > 80:
                parts.append(text[:room])
            break
        parts.append(text)
        room -= len(text) + 2
    return "\n\n".join(reversed(parts))


async def forced_handoff(
    model: Model, title: str, limit: str, messages: list[ChatMessage], tokens: int, seconds: int
) -> str:
    """The one final turn of a role that hit a limit: one model call, no tools, its input and
    its output both sized from `tokens`. Returns the note, or "" if the model gave none."""
    log = digest(messages, max(400, tokens * 2))  # about half of `tokens` at 4 characters each
    try:
        with apply_limits([time_limit(max(5, seconds))], catch_errors=True):
            output = await model.generate(
                [
                    ChatMessageSystem(content=roles.HANDOFF),
                    ChatMessageUser(content=roles.handoff_request(title, limit, log)),
                ],
                tools=[],
                config=GenerateConfig(max_tokens=max(64, tokens // 4)),
            )
            if output.message.tool_calls:
                return ""  # it tried to go on working: that is not a note
            return output.completion.strip()[:4000]
    except LimitExceededError:
        raise  # a limit of the whole sample, not ours
    except Exception:  # a failed call must not cost the next role its hand-off: code writes it
        return ""
    return ""  # the turn's own time limit ended it


def _model(name: str | None) -> Model | None:
    return get_model(name) if name else None


def _budget_note(seconds: int, tokens: int | None, messages: int | None) -> str:
    parts = [f"about {max(1, seconds // 60)} minutes ({seconds} s)"]
    if tokens:
        parts.append(f"{tokens:,} tokens")
    if messages:
        parts.append(f"{messages} messages")
    return (
        "\n\nYour budget for this phase: "
        + ", ".join(parts)
        + ". Any limit named in the brief is the whole team's; yours is this slice, and you are "
        "cut off without warning when it ends. After a cut you get one short turn without tools "
        "to write a hand-off note, nothing more. Plan for it, write files as you go, and leave "
        "time for your final summary."
    )


def fallback_methods(reason: str, note: str, contract: str, findings: str) -> str:
    """METHODS.md written by code when the reporter left none, so a run always ends documented.
    It holds only what the ledger and the output check know, and says who wrote it."""
    return (
        "# Methods\n\n"
        f"This file was written by the harness, not by the reporter: {reason} It lists what "
        "the run's ledger and the deterministic output check recorded. The scripts, the "
        "notebook and the full ledger are in /outputs/glhf/.\n\n"
        + (f"## The reporter's hand-off note\n\n{note.strip()}\n\n" if note.strip() else "")
        + f"## Output check\n\n{contract.strip()}\n\n{findings.strip()}\n"
    )


@dataclass(frozen=True)
class Role:
    name: str
    agent: Agent
    model: str | None


@solver
def glhf_swarm(
    review_rounds: int = 3,
    budget_seconds: int | None = None,
    planner_model: str | None = None,
    experimenter_model: str | None = None,
    critic_model: str | None = None,
    reporter_model: str | None = None,
    relevance_model: str | None = None,
    max_tokens: int | None = None,
    max_messages_per_role: int | None = None,
    exa: bool = False,
    memory_dir: str | None = None,
) -> Solver:
    """Budgets: `budget_seconds` (time), `max_tokens` (all roles together) and
    `max_messages_per_role` (each phase; a model call with one tool call is two messages).
    `exa` gives roles a documentation search. `memory_dir` keeps lessons between runs."""

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        del generate
        case = state.metadata_as(RuntimeCase)
        outputs = case.expected_outputs
        brief = state.input_text
        ledger = Ledger()
        from .. import tasks  # late import: avoids a cycle with tasks.py

        total = float(budget_seconds or tasks.TIME_LIMIT_SECONDS)
        clock = Clock(total * (1 - RUN_MARGIN), time.monotonic(), total)
        await sandbox().exec(["mkdir", "-p", f"{WORK}/scripts", HANDOFF_DIR, "/outputs/glhf"])
        await save_ledger(ledger)
        if exa and not os.environ.get("EXA_API_KEY"):
            raise RuntimeError("exa=True needs EXA_API_KEY in the runner's environment")
        # Approved lessons from runs on other tasks only: never from an earlier run on this task,
        # nor from a run that had read this task's lessons.
        loaded = load_memory(memory_dir, case.task_id)
        memory, memory_sources = loaded.text, set(loaded.sources)
        past_used = False
        if memory_dir and past_memory.enabled():
            try:  # past.dev ranks the lessons; the local file is the fallback
                recalled, recalled_from = await past_memory.recall_with_sources(
                    task_id=case.task_id
                )
                if recalled:
                    memory, memory_sources, past_used = recalled, recalled_from, True
                ledger.log("memory.recalled", source="past.dev", chars=len(recalled))
            except Exception as error:
                ledger.log(
                    "memory.failed", source="past.dev", step="recall", error=str(error)[:200]
                )
        tokens_at_start = sample_limits().token.usage
        # The plan is fixed here, before any role runs, from the limits alone.
        plan = plan_budget(max_tokens or None, clock.budget, review_rounds)
        book = TokenBook(plan) if plan.max_tokens is not None else None
        owed = Owed.of(plan)
        # The relevance judge is in the critic's model group unless it is given its own model.
        # Whether it shares a vendor with the proposer is recorded: the same vendor can mean
        # the same blind spots.
        default_name = str(get_model())
        judge_name = relevance_model or critic_model or default_name
        proposer_name = planner_model or default_name
        ledger.log(
            "settings",
            budget_seconds=int(clock.budget),
            review_rounds=review_rounds,
            max_tokens=max_tokens,
            max_messages_per_role=max_messages_per_role,
            token_semantics=baseline.TOKEN_SEMANTICS["glhf"] if max_tokens else None,
            budget_plan=plan.mode,
            exa=exa,
            memory=bool(memory_dir),
            memory_source="past.dev" if past_used else ("file" if memory else None),
            memory_chars=len(memory),
            memory_from_tasks=sorted(memory_sources),
            role_models={
                "planner": planner_model,
                "experimenter": experimenter_model,
                "critic": critic_model,
                "reporter": reporter_model,
                "relevance": judge_name,
            },
            relevance={
                "threshold": RELEVANCE_THRESHOLD,
                "judge_model": judge_name,
                "proposer_model": proposer_name,
                "same_vendor_as_proposer": relevance.vendor(judge_name)
                == relevance.vendor(proposer_name),
                "time_share_of_review": RELEVANCE_SHARE,
                "token_share": TOKEN_SHARE["relevance"],
            },
            test_results="run by the harness from the registered script",
        )
        ledger.log("budget.plan", **plan.event(), allocation=allocation(plan))
        if plan.degraded:
            ledger.log(
                "budget.degraded",
                mode=plan.mode,
                skipped=list(plan.skipped),
                limited_by=list(plan.limited_by),
                reason=plan.reason,
                needed=plan.needed,
                max_tokens=plan.max_tokens,
                seconds=plan.seconds,
            )
        await save_ledger(ledger)
        not_running = [k for k in plan.skipped if k != "finish"]  # what the roles are told

        def tokens_used() -> int:
            return int(sample_limits().token.usage - tokens_at_start)

        def agent(name: str, instructions: str, model: str | None, extra: list[Tool]) -> Role:
            if exa and name in SEARCH_ROLES:
                instructions += roles.SEARCH
                titles, authors = study_names(case)
                extra = [
                    *extra,
                    search_docs(ledger, name, case.network_policy, case.doi, titles, authors),
                ]
            made = react(
                name=name,
                prompt=instructions,
                model=_model(model),
                tools=[
                    bash_session(timeout=600, instance=name),
                    python(timeout=600),
                    text_editor(timeout=120),
                    request_web_access(),
                    check_outputs(outputs),
                    read_ledger(ledger),
                    *extra,
                ],
                compaction=CompactionAuto(),
            )
            return Role(name, made, model)

        orphans = False  # an earlier role was cut off, so it may have left jobs running
        cuts: list[dict[str, Any]] = []  # the hand-offs of the roles that were cut off
        notes: dict[str, str] = {}  # phase -> the note of its forced final turn

        async def hand_off(
            title: str,
            who: Role,
            limit: str,
            messages: list[ChatMessage],
            tokens: int,
            seconds: int,
        ) -> None:
            """A role hit a limit: one forced final turn, then its hand-off file. The file always
            exists afterwards, written from facts by code if the model gave no note."""
            before = tokens_used()
            note = await forced_handoff(
                _model(who.model) or get_model(), title, limit, messages, tokens, seconds
            )
            changed = await sandbox().exec(
                [
                    "sh",
                    "-c",
                    f"find {WORK} /outputs -type f -newer {WORK}/.phase_started 2>/dev/null "
                    f"| grep -v -e /ledger.json -e {HANDOFF_DIR}/ | sort | head -30",
                ],
                timeout=60,
            )
            files = [line for line in (changed.stdout or "").splitlines() if line.strip()]
            facts = f"- stopped by: the {limit} limit, after {before:,} tokens of the run\n" + (
                "- files it wrote or changed:\n" + "\n".join(f"  - {f}" for f in files)
                if files
                else "- files it wrote or changed: none"
            )
            path = f"{HANDOFF_DIR}/{title.replace(' ', '_')}.md"
            own = (
                note or "(The role gave no note in its final turn. Only the facts above are known.)"
            )
            await sandbox().write_file(
                path,
                f"# Hand-off: {title}\n\n## Facts recorded by code\n{facts}\n\n"
                f"## The role's own note (one forced final turn, not checked)\n{own}\n",
            )
            notes[title] = note
            cuts.append(
                {
                    "phase": title,
                    "by": who.name,
                    "limit": limit,
                    "path": path,
                    "facts": facts,
                    "note": own,
                    "read": False,  # by the role that runs next
                    "reread": False,  # by the same role, when it comes back in a later round
                }
            )
            state.messages.append(
                ChatMessageUser(content=f"=== GLHF hand-off: {title} (cut by {limit} limit) ===")
            )
            state.messages.append(ChatMessageUser(content=f"{facts}\n\n{own}"))
            ledger.log(
                "handoff.forced",
                phase=title,
                limit=limit,
                source="model" if note else "code",
                tokens=tokens_used() - before,
                tokens_reserved=tokens,
                seconds_allowed=seconds,
                chars=len(note),
                files=len(files),
                path=path,
            )

        async def phase(
            title: str, who: Role, task: str, seconds: int | None = None, last_round: bool = False
        ) -> PhaseResult:
            nonlocal orphans
            kind = kind_of(title)
            later = owed.start(kind)
            if kind not in plan.phases and kind != "finish":
                ledger.log("phase.skipped", phase=title, reason="plan", mode=plan.mode)
                await save_ledger(ledger)
                return PhaseResult(ran=False)
            floor_seconds = plan.time_floors[kind]
            if seconds is None:
                seconds = seconds_for(plan, title, clock.budget - clock.left(), later, last_round)
                if seconds >= MIN_PHASE_SECONDS and kind != "experiment":
                    if seconds + 1 < floor_seconds:
                        # Too little time to produce its files: not started, the time rolls on.
                        ledger.log(
                            "phase.skipped",
                            phase=title,
                            reason="below_floor",
                            unit="seconds",
                            seconds=seconds,
                            floor=floor_seconds,
                        )
                        await save_ledger(ledger)
                        return PhaseResult(ran=False)
            if seconds < MIN_PHASE_SECONDS:
                ledger.log("phase.skipped", phase=title, reason="time", seconds=seconds)
                await save_ledger(ledger)
                return PhaseResult(ran=False)
            # The forced final turn of a role that is cut off is paid from its own slice.
            handoff_seconds = min(HANDOFF_SECONDS, seconds // 10)
            work_seconds = seconds - handoff_seconds
            limits: list[Limit] = [time_limit(work_seconds)]
            if max_messages_per_role:
                limits.append(message_limit(max_messages_per_role))
            grant: Grant | None = None
            if book:
                grant = book.grant(title, later)
                if grant.skip:
                    ledger.log(
                        "phase.skipped",
                        phase=title,
                        reason=grant.skip,
                        unit="tokens",
                        used=tokens_used(),
                        tokens=grant.tokens,
                        floor=grant.floor,
                        protected=grant.protected,
                    )
                    await save_ledger(ledger)
                    return PhaseResult(ran=False)
                limits.append(token_limit(grant.limit))
                if grant.overdrawn:
                    ledger.log(
                        "budget.overdrawn",
                        phase=title,
                        tokens=grant.overdrawn,
                        used=book.used,
                        max_tokens=book.max_tokens,
                        note="earlier overshoot was larger than the reserves; the report keeps "
                        "its floor, so the run may end above max_tokens by this much",
                    )
            ledger.log(
                "budget.grant",
                **(grant.event() if grant else {"phase": title, "tokens": None}),
                seconds=seconds,
                seconds_floor=floor_seconds,
                handoff_seconds=handoff_seconds,
                owed_later=later,
            )
            allowance = grant.limit if grant else None
            ledger.log("phase.started", phase=title, seconds=seconds, tokens_allowed=allowance)
            await save_ledger(ledger)
            # Every role's transcript is appended to the sample so the process judge sees all work.
            state.messages.append(
                ChatMessageUser(content=f"=== GLHF phase: {title} (budget {seconds}s) ===")
            )
            prompt = f"{brief}\n\n---\n\n{task}"
            prompt += _budget_note(work_seconds, allowance, max_messages_per_role)
            if not_running:
                prompt += roles.degraded(plan.mode, not_running, plan.reason)
            for cut in cuts:
                again = cut["by"] == who.name and not cut["reread"]
                if cut["read"] and not again:
                    continue
                cut["read"] = True
                cut["reread"] = cut["reread"] or cut["by"] == who.name
                # A reviewer must not be argued with: of the roles it reviews it gets the
                # facts recorded by code, not their words.
                facts_only = who.name in REVIEWERS and cut["by"] not in REVIEWERS
                prompt += roles.with_handoff(
                    cut["phase"],
                    cut["limit"],
                    cut["path"],
                    cut["facts"],
                    None if facts_only else cut["note"],
                )
                ledger.log("handoff.read", phase=title, of=cut["phase"], note=not facts_only)
            if orphans:
                running = await background_processes()
                if running:
                    prompt += (
                        "\n\nAn earlier role ran out of budget and left these jobs running. "
                        "Wait for them, reuse their output or kill them; do not start duplicates:\n"
                        + "\n".join(f"- pid {p['pid']}: {p['cmd']}" for p in running[:20])
                    )
            if memory:
                prompt += roles.with_memory(memory)
            await sandbox().exec(["touch", f"{WORK}/.phase_started"])
            began = time.monotonic()
            result = await run(who.agent, prompt, limits=limits)
            agent_state, limit_error = result if isinstance(result, tuple) else (result, None)
            assert isinstance(agent_state, AgentState)
            state.messages.extend(m for m in agent_state.messages if m.role != "system")
            limit = str(getattr(limit_error, "type", "limit")) if limit_error is not None else None
            ledger.log(
                "phase.finished",
                phase=title,
                limit_hit=limit is not None,
                limit=limit,
                left=int(clock.left()),
                tokens=tokens_used(),
            )
            if limit is not None:
                orphans = True
                running = await background_processes()
                if running:
                    ledger.log("phase.background", phase=title, processes=running[:20])
                await hand_off(
                    title,
                    who,
                    limit,
                    agent_state.messages,
                    grant.handoff if grant else HANDOFF_TOKENS,
                    # What is left of the phase's own slice, never more than the reserve's size.
                    min(
                        HANDOFF_SECONDS,
                        max(handoff_seconds, int(seconds - (time.monotonic() - began))),
                    ),
                )
            if book and grant:
                settled = book.settle(grant, tokens_used())
                ledger.log("budget.settled", **settled)
                if settled["borrowed"]:
                    ledger.log(
                        "budget.borrowed",
                        phase=title,
                        overshoot=settled["overshoot"],
                        from_reserves=settled["borrowed"],
                        reserves_left=settled["reserves_left"],
                    )
                if settled["not_covered"]:
                    ledger.log(
                        "budget.reserves_exhausted",
                        phase=title,
                        not_covered=settled["not_covered"],
                        note="the overshoot was larger than the overshoot and finish reserves; "
                        "the rest comes out of the phases that follow, not out of the report",
                    )
            await save_ledger(ledger)
            return PhaseResult(ran=True, limit=limit)

        async def judge_relevance(n: int) -> None:
            """Between registration and run: one call to the relevance judge for every
            registered test that has no judgement. The judge has no tools and sees only what
            relevance.request builds: no result, no transcript. It is paid from the review
            share like the other review phases, with its own floor."""
            items = relevance.waiting(ledger)
            if not items:
                return
            title = f"relevance {n}"
            later = owed.start("relevance")
            names = [f"{i.claim_id}/{i.name}" for i in items]

            async def skipped(reason: str, **detail: object) -> None:
                ledger.log("phase.skipped", phase=title, reason=reason, **detail)
                ledger.log(
                    "relevance.skipped",
                    round=n,
                    reason=reason,
                    tests=names,
                    note="a test without a relevance judgement is not run and cannot support",
                )
                await save_ledger(ledger)

            if "relevance" not in plan.phases:
                return await skipped("plan", mode=plan.mode)
            floor_seconds = plan.time_floors["relevance"]
            seconds = seconds_for(plan, title, clock.budget - clock.left(), later)
            if seconds < MIN_PHASE_SECONDS:
                return await skipped("time", seconds=seconds)
            if seconds + 1 < floor_seconds:
                return await skipped(
                    "below_floor", unit="seconds", seconds=seconds, floor=floor_seconds
                )
            grant: Grant | None = None
            if book:
                grant = book.grant(title, later)
                if grant.skip:
                    return await skipped(
                        grant.skip,
                        unit="tokens",
                        used=tokens_used(),
                        tokens=grant.tokens,
                        floor=grant.floor,
                        protected=grant.protected,
                    )
            ledger.log(
                "budget.grant",
                **(grant.event() if grant else {"phase": title, "tokens": None}),
                seconds=seconds,
                seconds_floor=floor_seconds,
                handoff_seconds=0,
                owed_later=later,
            )
            allowance = grant.tokens if grant else None
            ledger.log("phase.started", phase=title, seconds=seconds, tokens_allowed=allowance)
            # The request is sized to the allowance: about a third of it for the scripts
            # (4 characters a token), the rest for the instructions and the answer.
            script_chars = relevance.SCRIPT_CHARS
            if allowance is not None:
                script_chars = max(400, min(script_chars, allowance * 4 // (3 * len(items))))
            text = relevance.request(ledger, items, script_chars)
            answer, failed = await relevance.ask(
                _model(relevance_model or critic_model) or get_model(),
                text,
                80 * len(items) + 64,
                seconds,
            )
            state.messages.append(
                ChatMessageUser(content=f"=== GLHF phase: {title} (budget {seconds}s) ===")
            )
            state.messages.append(ChatMessageUser(content=text))
            state.messages.append(ChatMessageUser(content=f"[relevance judge] {answer or failed}"))
            if failed is None:
                for item, (score, reason) in zip(
                    items, relevance.parse(answer, items).values(), strict=True
                ):
                    ledger.judge_relevance(
                        item.claim_id,
                        item.name,
                        relevance.judgement(score, reason, judge_name, proposer_name),
                    )
            else:
                # No answer: the tests stay unjudged (they are asked about again next round).
                ledger.log(
                    "relevance.failed",
                    round=n,
                    reason=failed,
                    tests=names,
                    note="a test without a relevance judgement is not run and cannot support",
                )
            ledger.log(
                "phase.finished",
                phase=title,
                limit_hit=failed == "time",
                limit="time" if failed == "time" else None,
                left=int(clock.left()),
                tokens=tokens_used(),
            )
            if book and grant:
                settled = book.settle(grant, tokens_used())
                ledger.log("budget.settled", **settled)
                if settled["borrowed"]:
                    ledger.log(
                        "budget.borrowed",
                        phase=title,
                        overshoot=settled["overshoot"],
                        from_reserves=settled["borrowed"],
                        reserves_left=settled["reserves_left"],
                    )
            await save_ledger(ledger)

        async def run_registered_tests(n: int) -> None:
            """The harness runs every registered test that was judged and has no run yet. No
            model takes part and no tokens are spent. The time comes from the review time
            that is left (never the finisher's or the reporter's reserve): EXECUTE_SHARE of
            it, shared by the tests waiting, at most TEST_SECONDS each."""
            todo = [
                (claim.id, entry)
                for claim in ledger.claims.values()
                for entry in claim.registered
                if entry.script_sha256 and entry.relevance is not None and entry.run is None
            ]
            for position, (claim_id, entry) in enumerate(todo):
                share = review_left() * EXECUTE_SHARE / (len(todo) - position)
                seconds = int(min(TEST_SECONDS, share))
                if seconds < MIN_TEST_SECONDS:
                    ledger.log(
                        "test.not_run",
                        round=n,
                        claim=claim_id,
                        name=entry.name,
                        reason="time",
                        seconds=seconds,
                        needed=MIN_TEST_SECONDS,
                    )
                    continue
                outcome = await run_registered_test(entry, seconds)
                ledger.record_run(claim_id, entry.name, outcome)
                await save_ledger(ledger)
            if todo:
                await save_ledger(ledger)

        scout = agent("scout", roles.SCOUT, planner_model, [])
        planner = agent("planner", roles.PLANNER, planner_model, [propose_claim(ledger, "planner")])
        pilot = agent("pilot", roles.PILOT, experimenter_model, [])
        experimenter = agent("experimenter", roles.EXPERIMENTER, experimenter_model, [])
        auditor = agent("auditor", roles.AUDITOR, critic_model, [raise_issue(ledger, "auditor")])
        finisher = agent("finisher", roles.FINISHER, experimenter_model, [])
        reviser = agent(
            "reviser", roles.REVISER, experimenter_model, [resolve_issue(ledger, "experimenter")]
        )
        critic = agent(
            "critic",
            roles.CRITIC,
            critic_model,
            [
                raise_issue(ledger, "critic"),
                register_falsification_test(ledger, "critic"),
                record_falsification_test(ledger, "critic"),
                report_failed_replication(ledger, "critic"),
            ],
        )
        reporter = agent(
            "reporter", roles.REPORTER + (roles.LESSONS if memory_dir else ""), reporter_model, []
        )

        # Time the early phases may not spend: the report's reserve plus the finisher's.
        hold_seconds = plan.time_reserves["report"] + plan.time_reserves["finish"]

        def review_left() -> float:
            return clock.left() - hold_seconds

        try:
            await phase("scout", scout, "Inventory the inputs and the environment.")
            await phase("propose", planner, "Plan the reproduction.")
            await phase(
                "pilot",
                pilot,
                "Run the whole pipeline on a small subsample and shape every required artifact.",
            )
            first_pass = "Produce every required artifact on the full data."
            if "pilot" in plan.phases:
                pilot_contract = contract_text(await check_contract(outputs, root=PILOT_OUT))
                ledger.log("pilot.checked", contract=pilot_contract)
                first_pass += (
                    f"\n\nShape check of the pilot's subsampled artifacts under {PILOT_OUT}:\n"
                    f"{pilot_contract}"
                )
            await phase("experiment", experimenter, first_pass)
            critiques_completed = 0
            if review_rounds and "critique" not in plan.phases:
                ledger.log("review.not_planned", mode=plan.mode, reason=plan.reason)
            for n in range(1, review_rounds + 1 if "critique" in plan.phases else 1):
                if review_left() < min_review_seconds(clock.budget):
                    ledger.log("review.skipped", round=n, reason="time")
                    break
                contract = contract_text(await check_contract(outputs))
                await phase(
                    f"audit {n}",
                    auditor,
                    f"Audit round {n}. Check the scripts against the Method Guidance.\n\n"
                    f"Current ledger:\n{ledger.summary()}",
                )
                critique = await phase(
                    f"critique {n}",
                    critic,
                    f"Review round {n}. Deterministic contract check right now:\n{contract}\n\n"
                    f"Current ledger:\n{ledger.summary()}",
                )
                if critique.ran:
                    # What the critic registered is now fixed (script and hash). First the
                    # relevance judge, which sees no result; then the harness runs the tests.
                    await judge_relevance(n)
                    await run_registered_tests(n)
                step = review_step(critique, len(ledger.open_issues()))
                if critique.completed:
                    critiques_completed += 1
                    # Fixes made before this round have now been through a full critic pass.
                    ledger.mark_rechecked()
                else:
                    ledger.log(
                        "review.incomplete",
                        round=n,
                        reason=f"critic stopped by the {critique.limit} limit"
                        if critique.ran
                        else "critic did not run (no budget left)",
                    )
                if step == "stop":
                    break
                if step == "converged":
                    ledger.log("review.converged", round=n)
                    break
                if step == "again":
                    continue  # nothing to revise; the next round gives the critic another pass
                await phase(
                    f"revise {n}",
                    reviser,
                    f"Revision round {n}. Fix the open issues.\n\n{ledger.summary()}",
                    last_round=n == review_rounds,
                )
            unchecked = [
                i.id for i in ledger.issues.values() if i.status == "fixed" and not i.rechecked
            ]
            if unchecked:
                ledger.log("review.fixes_not_rechecked", issues=unchecked)
            if review_rounds > 0 and "critique" in plan.phases and critiques_completed == 0:
                # Review was planned and no critic finished a pass: the artifacts are the first
                # pass, unchecked. Said in the ledger, in FINDINGS.md and in run.json.
                ledger.log(
                    UNREVIEWED,
                    rounds_planned=review_rounds,
                    note="no critic completed a pass; the artifacts are the first pass, unchecked",
                )
            # Last line of defence for completeness: only for artifacts that would score zero
            # because they are missing or unreadable. Warnings never trigger it.
            last_check = await check_contract(outputs)
            if check_failed(last_check):
                # Nothing is known about the artifacts, so the finisher is not started on a guess.
                ledger.log("contract.check_failed", detail=contract_text(last_check)[:500])
            failing = needs_rescue(last_check)
            finish_time = int(clock.left() - plan.time_reserves["report"])
            # A run too short for the full reserve (under 20 minutes) still gets a rescue attempt.
            needed = min(MIN_FINISH_SECONDS, int(clock.budget * finish_hold(clock.budget)))
            if failing and finish_time >= max(needed, MIN_PHASE_SECONDS):
                await phase(
                    "finish",
                    finisher,
                    "These required artifacts are missing or cannot be read:\n"
                    f"{contract_text(failing)}\n\nFull check, for context:\n"
                    f"{contract_text(await check_contract(outputs))}",
                    finish_time,
                )
            elif failing:
                ledger.log(
                    "finish.skipped",
                    reason="time",
                    failing=len(failing),
                    seconds=finish_time,
                    needed=max(needed, MIN_PHASE_SECONDS),
                )
        finally:
            # Reporting always runs, even after a failure or a limit, so the run ends documented.
            # First stop every job a role left running, so nothing writes to /outputs after review.
            try:
                killed = await background_processes(kill=True)
                if killed:
                    ledger.log("background.killed", processes=killed[:20])
            except Exception as error:  # never block the report
                ledger.log("background.kill_failed", error=str(error)[:200])
            orphans = False
            await save_ledger(ledger)
            await sandbox().write_file("/outputs/glhf/FINDINGS.md", ledger.findings_markdown())
            await sandbox().exec(["cp", f"{WORK}/ledger.json", "/outputs/glhf/ledger.json"])
            await sandbox().exec(
                [
                    "sh",
                    "-c",
                    f"cp -r {WORK}/scripts {WORK}/plan.md {WORK}/notebook.md "
                    f"{WORK}/deviations.md {WORK}/sample_sheet.tsv {WORK}/data_report.md "
                    f"{WORK}/pilot_report.md {WORK}/adherence.md {HANDOFF_DIR} "
                    "/outputs/glhf/ 2>/dev/null; true",
                ]
            )
            report = await phase(
                "report", reporter, "Write /outputs/METHODS.md.", clock.report_seconds()
            )
            # Again after the report: the reporter is a role like any other and can leave a job
            # behind (one left a loop rewriting the ledger copy). Nothing may run in the sandbox
            # while the final files are written and the outputs are collected.
            try:
                killed = await background_processes(kill=True)
                if killed:
                    ledger.log("background.killed", after="report", processes=killed[:20])
            except Exception as error:
                ledger.log("background.kill_failed", after="report", error=str(error)[:200])
            if memory_dir:
                # Written before grading, so a lesson can never contain a score. Lines that look
                # like results are dropped in code (memory.filter_lessons). What is left is only
                # queued: no later run sees it, and nothing goes to past.dev, until a person
                # approves it (python -m bixbench3.inspect_harness.swarm.memory approve ...).
                try:
                    lessons = await sandbox().read_file(f"{WORK}/lessons.md")
                    kept, rejected = filter_lessons(lessons)
                    if rejected:
                        ledger.log("memory.rejected", lines=rejected)
                    clean = "\n".join(kept)
                    await sandbox().write_file("/outputs/glhf/lessons.md", clean + "\n")
                    queued = add_pending(memory_dir, case.task_id, clean, memory_sources)
                    ledger.log(
                        "memory.pending" if queued else "memory.nothing_to_save",
                        lines=queued,
                        context=sorted(memory_sources - {case.task_id}),
                        note="waiting for a person to approve; not shown to any run yet",
                    )
                except Exception as error:  # a missing lessons file must not fail the run
                    ledger.log("memory.failed", error=str(error)[:200])
            final = contract_text(await check_contract(outputs))
            # The reporter is the only writer of METHODS.md. If it was cut off or could not
            # start and left none, code writes one from the ledger and says so in its first line.
            written = await sandbox().exec(["test", "-s", "/outputs/METHODS.md"])
            if not written.success:
                why = (
                    f"the reporter was stopped by its {report.limit} limit before it wrote one."
                    if report.ran
                    else "the reporter could not start (no time left)."
                )
                await sandbox().write_file(
                    "/outputs/METHODS.md",
                    fallback_methods(
                        why, notes.get("report", ""), final, ledger.findings_markdown()
                    ),
                )
                ledger.log("report.fallback", reason=why, reporter_ran=report.ran)
            ledger.log(
                "finished",
                contract=final,
                tokens=tokens_used(),
                max_tokens=max_tokens,
                within_max_tokens=(tokens_used() <= max_tokens) if max_tokens else None,
            )
            await save_ledger(ledger)
            await sandbox().write_file("/outputs/glhf/FINDINGS.md", ledger.findings_markdown())
            await sandbox().exec(["cp", f"{WORK}/ledger.json", "/outputs/glhf/ledger.json"])
            await sandbox().exec(
                ["sh", "-c", f"cp -r {HANDOFF_DIR} /outputs/glhf/ 2>/dev/null; true"]
            )
            # The record that counts: from this process's memory into the sample's store (and
            # the host folder, when one is set). The copies under /outputs/glhf/ are untrusted.
            persist_ledger(ledger)
            state.output.completion = f"{final}\n\n{ledger.summary()}"
        return state

    return solve
