"""GLHF swarm solver, nine roles:
scout -> propose -> pilot -> experiment -> [audit + critique -> revise] (loop) -> finish -> report.

Same sandbox, tools, time limit and grader as the single-agent baseline (`bixbench3_agent`).
Orchestration is code, not a supervisor model: phases, budgets and the stop rule are fixed here.

Per-role models (task args, default = the eval's --model), one per group of roles:
  planner_model (scout, proposer), experimenter_model (pilot, experimenter, reviser, finisher),
  critic_model (methods auditor, critic), reporter_model
e.g. -T critic_model=openai/gpt-5.5 to put the critic on a second vendor (Claude + OpenAI credits).
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from inspect_ai.agent import Agent, AgentState, react, run
from inspect_ai.model import ChatMessageUser, CompactionAuto, Model, get_model
from inspect_ai.solver import Generate, Solver, TaskState, solver
from inspect_ai.tool import Tool, bash_session, python, text_editor
from inspect_ai.util import sandbox, time_limit

from ..models import RuntimeCase
from ..tools import request_web_access
from . import roles
from .ledger import Ledger
from .tools import (
    WORK,
    check_contract,
    check_outputs,
    contract_text,
    propose_claim,
    raise_issue,
    read_ledger,
    record_falsification_test,
    report_failed_replication,
    resolve_issue,
    save_ledger,
)

# Fractions of the run's time budget. Whatever a phase does not use rolls forward.
SCOUT_SHARE = 0.03
PLAN_SHARE = 0.04
PILOT_SHARE = 0.08
FIRST_PASS_SHARE = 0.45
FINISH_RESERVE = 0.05  # kept back so a missing artifact can still be rescued after review
REPORT_RESERVE = 0.05  # always kept for the reporter and final writes
MIN_REVIEW_SECONDS = 15 * 60
MIN_FINISH_SECONDS = 5 * 60
AUDIT_SHARE = 0.10  # of the review time left in a round
CRITIQUE_SHARE = 0.30
PILOT_OUT = f"{WORK}/pilot/outputs"


@dataclass
class Clock:
    budget: float
    started: float

    def left(self) -> float:
        return self.budget - (time.monotonic() - self.started)

    def slice(self, share: float, reserve: float = 0.0) -> int:
        return int(max(60.0, min(self.budget * share, self.left() - self.budget * reserve)))


def _model(name: str | None) -> Model | None:
    return get_model(name) if name else None


@solver
def glhf_swarm(
    review_rounds: int = 3,
    budget_seconds: int | None = None,
    planner_model: str | None = None,
    experimenter_model: str | None = None,
    critic_model: str | None = None,
    reporter_model: str | None = None,
) -> Solver:
    async def solve(state: TaskState, generate: Generate) -> TaskState:
        del generate
        case = state.metadata_as(RuntimeCase)
        outputs = case.expected_outputs
        brief = state.input_text
        ledger = Ledger()
        from .. import tasks  # late import: avoids a cycle with tasks.py

        clock = Clock(float(budget_seconds or tasks.TIME_LIMIT_SECONDS) * 0.97, time.monotonic())
        await sandbox().exec(["mkdir", "-p", f"{WORK}/scripts", "/outputs/glhf"])
        await save_ledger(ledger)

        def agent(name: str, instructions: str, model: str | None, extra: list[Tool]) -> Agent:
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

        async def phase(title: str, who: Agent, task: str, seconds: int) -> None:
            ledger.log("phase.started", phase=title, seconds=seconds)
            # Every role's transcript is appended to the sample so the process judge sees all work.
            state.messages.append(
                ChatMessageUser(content=f"=== GLHF phase: {title} (budget {seconds}s) ===")
            )
            result = await run(who, f"{brief}\n\n---\n\n{task}", limits=[time_limit(seconds)])
            agent_state, limit_error = result if isinstance(result, tuple) else (result, None)
            assert isinstance(agent_state, AgentState)
            state.messages.extend(m for m in agent_state.messages if m.role != "system")
            ledger.log(
                "phase.finished",
                phase=title,
                limit_hit=limit_error is not None,
                left=int(clock.left()),
            )
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
                record_falsification_test(ledger, "critic"),
                report_failed_replication(ledger, "critic"),
            ],
        )
        reporter = agent("reporter", roles.REPORTER, reporter_model, [])

        hold = REPORT_RESERVE + FINISH_RESERVE  # time the early phases may not spend

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
                if review_left() < MIN_REVIEW_SECONDS:
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
                await phase(
                    f"critique {n}",
                    critic,
                    f"Review round {n}. Deterministic contract check right now:\n{contract}\n\n"
                    f"Current ledger:\n{ledger.summary()}",
                    int(review_left() * CRITIQUE_SHARE),
                )
                if not ledger.open_issues():
                    ledger.log("review.converged", round=n)
                    break
                await phase(
                    f"revise {n}",
                    reviser,
                    f"Revision round {n}. Fix the open issues.\n\n{ledger.summary()}",
                    int(review_left() * (0.6 if n < review_rounds else 0.9)),
                )
            # Last line of defence for completeness: only runs when an artifact would score zero.
            failing = [r for r in await check_contract(outputs) if r.get("problems")]
            finish_time = int(clock.left() - clock.budget * REPORT_RESERVE)
            if failing and finish_time >= MIN_FINISH_SECONDS:
                await phase(
                    "finish",
                    finisher,
                    "These required artifacts are missing or malformed:\n"
                    f"{contract_text(await check_contract(outputs))}",
                    finish_time,
                )
            elif failing:
                ledger.log("finish.skipped", reason="time", failing=len(failing))
        finally:
            # Reporting always runs, even after a failure or a limit, so the run ends documented.
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
            await phase(
                "report", reporter, "Write /outputs/METHODS.md.", max(120, int(clock.left()) - 60)
            )
            final = contract_text(await check_contract(outputs))
            ledger.log("finished", contract=final)
            await save_ledger(ledger)
            await sandbox().exec(["cp", f"{WORK}/ledger.json", "/outputs/glhf/ledger.json"])
            state.output.completion = f"{final}\n\n{ledger.summary()}"
        return state

    return solve
