"""GLHF swarm solver, nine roles:
scout -> propose -> pilot -> experiment -> [audit + critique -> revise] (loop) -> finish -> report.

Same sandbox, time limit and grader as the single-agent baseline (`bixbench3_agent`), and the
baseline's four tools. The swarm's roles also have check_outputs (a shape check built from the
task's expected outputs), the ledger tools and, when switched on, search_docs and memory; the
baseline has none of these. Runs that use them must say so.
Orchestration is code, not a supervisor model: phases, budgets and the stop rule are fixed here.

Per-role models (task args, default = the eval's --model), one per group of roles:
  planner_model (scout, proposer), experimenter_model (pilot, experimenter, reviser, finisher),
  critic_model (methods auditor, critic), reporter_model
e.g. -T critic_model=openai/gpt-5.5 to put the critic on a second vendor (Claude + OpenAI credits).
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass

from inspect_ai.agent import Agent, AgentState, react, run
from inspect_ai.model import ChatMessageUser, CompactionAuto, Model, get_model
from inspect_ai.solver import Generate, Solver, TaskState, solver
from inspect_ai.tool import Tool, bash_session, python, text_editor
from inspect_ai.util import Limit, message_limit, sample_limits, sandbox, time_limit, token_limit

from ..models import RuntimeCase
from ..tools import request_web_access
from . import baseline, past_memory, roles
from .ledger import Ledger
from .memory import add_pending, filter_lessons, load_memory
from .tools import (
    WORK,
    background_processes,
    check_contract,
    check_failed,
    check_outputs,
    contract_text,
    needs_rescue,
    propose_claim,
    raise_issue,
    read_ledger,
    record_falsification_test,
    register_falsification_test,
    report_failed_replication,
    resolve_issue,
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
RUN_MARGIN = 0.03  # of the sample's time limit, kept out of every phase's share
FINAL_WRITES_SHARE = 0.015  # of the sample's time limit, kept after the report for final writes
MIN_FINAL_WRITES_SECONDS = 30
MIN_FINISH_SECONDS = 5 * 60
MAX_FINISH_HOLD = 0.25  # the finisher's reserve never takes more than this share of the run
MIN_PHASE_SECONDS = 10  # a phase with less time than this is skipped, not started
AUDIT_SHARE = 0.10  # of the review time left in a round
CRITIQUE_SHARE = 0.30
PILOT_OUT = f"{WORK}/pilot/outputs"
REPORT_TOKEN_RESERVE = 0.10  # of max_tokens, kept for the reporter
assert REPORT_TOKEN_RESERVE == baseline.REPORT_TOKEN_RESERVE  # same rule for both solvers
# With a token budget, the supporting roles are capped so the full run and the review keep most
# of it. Shares of max_tokens by phase (first word of the phase name); other phases take what is left.
TOKEN_SHARE = {"scout": 0.05, "propose": 0.08, "pilot": 0.15, "audit": 0.08, "critique": 0.20}
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


def review_step(critic: PhaseResult, open_issues: int) -> str:
    """What follows a critique: "stop" (the critic could not run), "converged" (it finished
    and nothing is open), "again" (it was cut off with nothing open: no verdict, look again),
    or "revise". "No open issues" means nothing when the critic did not finish looking."""
    if not critic.ran:
        return "stop"
    if open_issues:
        return "revise"
    return "converged" if critic.completed else "again"


def token_allowance(title: str, max_tokens: int, used: int) -> int:
    """Tokens a phase may spend; <= 0 means skip it. The report always gets at least the reserve:
    limits are checked after each call, so earlier phases can overshoot slightly, and a run must
    still end documented."""
    reserve = int(max_tokens * REPORT_TOKEN_RESERVE)
    if title == "report":
        return max(max_tokens - used, reserve)
    allowance = max_tokens - used - reserve
    share = TOKEN_SHARE.get(title.split()[0])
    return min(allowance, int(max_tokens * share)) if share else allowance


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
        "cut off without warning when it ends. Plan for it, write files as you go, and leave "
        "time for your final summary."
    )


@solver
def glhf_swarm(
    review_rounds: int = 3,
    budget_seconds: int | None = None,
    planner_model: str | None = None,
    experimenter_model: str | None = None,
    critic_model: str | None = None,
    reporter_model: str | None = None,
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
        await sandbox().exec(["mkdir", "-p", f"{WORK}/scripts", "/outputs/glhf"])
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
        ledger.log(
            "settings",
            budget_seconds=int(clock.budget),
            review_rounds=review_rounds,
            max_tokens=max_tokens,
            max_messages_per_role=max_messages_per_role,
            token_semantics=baseline.TOKEN_SEMANTICS["glhf"] if max_tokens else None,
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
            },
        )

        def tokens_used() -> int:
            return int(sample_limits().token.usage - tokens_at_start)

        def agent(name: str, instructions: str, model: str | None, extra: list[Tool]) -> Agent:
            if exa and name in SEARCH_ROLES:
                instructions += roles.SEARCH
                extra = [*extra, search_docs(ledger, name, case.network_policy, case.doi)]
            return react(
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

        orphans = False  # an earlier role was cut off, so it may have left jobs running

        async def phase(title: str, who: Agent, task: str, seconds: int) -> PhaseResult:
            nonlocal orphans
            if seconds < MIN_PHASE_SECONDS:
                ledger.log("phase.skipped", phase=title, reason="time", seconds=seconds)
                await save_ledger(ledger)
                return PhaseResult(ran=False)
            limits: list[Limit] = [time_limit(seconds)]
            if max_messages_per_role:
                limits.append(message_limit(max_messages_per_role))
            allowance: int | None = None
            if max_tokens:
                allowance = token_allowance(title, max_tokens, tokens_used())
                if allowance <= 0:
                    ledger.log("phase.skipped", phase=title, reason="tokens", used=tokens_used())
                    await save_ledger(ledger)
                    return PhaseResult(ran=False)
                limits.append(token_limit(allowance))
            ledger.log("phase.started", phase=title, seconds=seconds, tokens_allowed=allowance)
            await save_ledger(ledger)
            # Every role's transcript is appended to the sample so the process judge sees all work.
            state.messages.append(
                ChatMessageUser(content=f"=== GLHF phase: {title} (budget {seconds}s) ===")
            )
            prompt = f"{brief}\n\n---\n\n{task}"
            prompt += _budget_note(seconds, allowance, max_messages_per_role)
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
            result = await run(who, prompt, limits=limits)
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
            await save_ledger(ledger)
            return PhaseResult(ran=True, limit=limit)

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
        hold = REPORT_RESERVE + finish_hold(clock.budget)

        def review_left() -> float:
            return clock.left() - clock.budget * hold

        try:
            await phase(
                "scout",
                scout,
                "Inventory the inputs and the environment.",
                clock.slice(SCOUT_SHARE, hold),
            )
            await phase("propose", planner, "Plan the reproduction.", clock.slice(PLAN_SHARE, hold))
            await phase(
                "pilot",
                pilot,
                "Run the whole pipeline on a small subsample and shape every required artifact.",
                clock.slice(PILOT_SHARE, hold),
            )
            pilot_contract = contract_text(await check_contract(outputs, root=PILOT_OUT))
            ledger.log("pilot.checked", contract=pilot_contract)
            await phase(
                "experiment",
                experimenter,
                "Produce every required artifact on the full data.\n\n"
                f"Shape check of the pilot's subsampled artifacts under {PILOT_OUT}:\n{pilot_contract}",
                clock.slice(FIRST_PASS_SHARE, hold),
            )
            for n in range(1, review_rounds + 1):
                if review_left() < min_review_seconds(clock.budget):
                    ledger.log("review.skipped", round=n, reason="time")
                    break
                contract = contract_text(await check_contract(outputs))
                await phase(
                    f"audit {n}",
                    auditor,
                    f"Audit round {n}. Check the scripts against the Method Guidance.\n\n"
                    f"Current ledger:\n{ledger.summary()}",
                    int(review_left() * AUDIT_SHARE),
                )
                critique = await phase(
                    f"critique {n}",
                    critic,
                    f"Review round {n}. Deterministic contract check right now:\n{contract}\n\n"
                    f"Current ledger:\n{ledger.summary()}",
                    int(review_left() * CRITIQUE_SHARE),
                )
                step = review_step(critique, len(ledger.open_issues()))
                if critique.completed:
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
                    int(review_left() * (0.6 if n < review_rounds else 0.9)),
                )
            unchecked = [
                i.id for i in ledger.issues.values() if i.status == "fixed" and not i.rechecked
            ]
            if unchecked:
                ledger.log("review.fixes_not_rechecked", issues=unchecked)
            # Last line of defence for completeness: only for artifacts that would score zero
            # because they are missing or unreadable. Warnings never trigger it.
            last_check = await check_contract(outputs)
            if check_failed(last_check):
                # Nothing is known about the artifacts, so the finisher is not started on a guess.
                ledger.log("contract.check_failed", detail=contract_text(last_check)[:500])
            failing = needs_rescue(last_check)
            finish_time = int(clock.left() - clock.budget * REPORT_RESERVE)
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
                ledger.log("finish.skipped", reason="time", failing=len(failing))
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
                    f"{WORK}/pilot_report.md {WORK}/adherence.md /outputs/glhf/ 2>/dev/null; true",
                ]
            )
            await phase("report", reporter, "Write /outputs/METHODS.md.", clock.report_seconds())
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
            ledger.log("finished", contract=final, tokens=tokens_used())
            await save_ledger(ledger)
            await sandbox().write_file("/outputs/glhf/FINDINGS.md", ledger.findings_markdown())
            await sandbox().exec(["cp", f"{WORK}/ledger.json", "/outputs/glhf/ledger.json"])
            state.output.completion = f"{final}\n\n{ledger.summary()}"
        return state

    return solve
