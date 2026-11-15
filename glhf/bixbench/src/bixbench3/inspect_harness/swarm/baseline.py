"""The single-agent baseline under a token budget, with the same end-of-budget rule as the swarm.

Without a token budget the baseline is upstream's `bixbench3_agent`, untouched (see tasks.py).
With one, a hard sample limit would end the baseline with no METHODS.md, while the swarm keeps
10% of the budget so its reporter always runs. To compare like with like, this solver gives the
same agent (same tools, same prompt, same compaction) 90% of the budget and, if that runs out,
one continuation with what is left (at least 10%) to write /outputs/METHODS.md.
"""

from __future__ import annotations

from inspect_ai.agent import AgentState, react, run
from inspect_ai.model import ChatMessage, ChatMessageUser, CompactionAuto
from inspect_ai.solver import Generate, Solver, TaskState, solver
from inspect_ai.tool import bash_session, python, text_editor
from inspect_ai.util import sample_limits, token_limit

from ..tools import request_web_access

REPORT_TOKEN_RESERVE = 0.10  # the swarm's reserve; solver.py asserts the two are equal
WRAP_UP = (
    "The token budget for the analysis is used up. Do not start or continue any analysis. With "
    "the little budget left, write or update /outputs/METHODS.md now: what was done, with which "
    "tools and parameters, what is incomplete or missing, and every deviation. Then submit."
)
TOKEN_SEMANTICS = {
    "single": "90% of max_tokens for the analysis; if that is used up, one continuation with the "
    "rest (at least 10%) to write METHODS.md. Limits are checked after each model call.",
    "glhf": "a budget plan made before the first role runs: every phase has a floor, a target "
    "share and what earlier phases left unused, and may not touch the floors of the phases "
    "still owed nor the reserves (overshoot 5%, finisher, reporter at least 10%). If max_tokens "
    "cannot cover the floors, a smaller plan drops phases up front and says so; a phase left "
    "with less than its floor is skipped; the reporter always runs. A role that hits its limit "
    "gets one short final turn without tools, paid from its own slice. Limits are checked after "
    "each model call, so a role can pass its limit by one call: that is paid from the overshoot "
    "reserve.",
}


@solver
def single_with_report_reserve(max_tokens: int) -> Solver:
    async def solve(state: TaskState, generate: Generate) -> TaskState:
        del generate
        # Same construction as solvers.bixbench3_agent; `run` needs the agent itself so the
        # transcript survives a limit.
        agent = react(
            tools=[
                bash_session(timeout=600),
                python(timeout=600),
                text_editor(timeout=120),
                request_web_access(),
            ],
            compaction=CompactionAuto(),
        )
        start = sample_limits().token.usage
        reserve = int(max_tokens * REPORT_TOKEN_RESERVE)
        result = await run(agent, list(state.messages), limits=[token_limit(max_tokens - reserve)])
        agent_state, limit_error = result if isinstance(result, tuple) else (result, None)
        assert isinstance(agent_state, AgentState)
        wrapped_up = False
        if limit_error is not None:
            left = max(max_tokens - int(sample_limits().token.usage - start), reserve)
            again: list[ChatMessage] = [m for m in agent_state.messages if m.role != "system"]
            again.append(ChatMessageUser(content=WRAP_UP))
            result = await run(agent, again, limits=[token_limit(left)])
            agent_state = result[0] if isinstance(result, tuple) else result
            assert isinstance(agent_state, AgentState)
            wrapped_up = True
        state.messages = agent_state.messages
        state.output = agent_state.output
        state.metadata["token_budget"] = {
            "max_tokens": max_tokens,
            "analysis_limit_hit": limit_error is not None,
            "wrap_up_ran": wrapped_up,
            "tokens": int(sample_limits().token.usage - start),
        }
        return state

    return solve
