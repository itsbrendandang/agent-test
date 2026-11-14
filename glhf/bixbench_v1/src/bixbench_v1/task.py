"""The Inspect task for one run: one capsule's staged data and a set of its questions.

The task is built from `PublicQuestion` objects only. It has no target and no scorer: the
answer key never enters Inspect, so it is in no prompt, no sample metadata and no eval log.
Grading happens in runner.py after `inspect_ai.eval` has returned and the sandbox is gone.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from inspect_ai import Task, task
from inspect_ai.dataset import Sample
from inspect_ai.model import GenerateConfig

from . import roles
from .dataset import PublicQuestion
from .solvers import (
    TOKEN_SEMANTICS,
    BudgetPolicy,
    glhf_qa_swarm,
    plan_budget,
    single_agent,
    swarm_budget_mode,
)

COMPOSE = Path(__file__).parent / "sandbox" / "compose.yaml"
SOLVERS = ("single", "glhf")
MESSAGE_LIMIT = 2_000  # backstop only
TOKEN_BACKSTOP = (
    1.25  # hard sample limit, as a multiple of max_tokens, if a solver's own limit fails
)
TIME_BACKSTOP_SECONDS = 180  # added to the time limit for setup and the final writes


def swarm_total_tokens(
    max_tokens: int, swarm_budget: str | None = None, policy: BudgetPolicy | None = None
) -> int:
    """What the swarm may spend in all when the single agent's budget is `max_tokens`."""
    if swarm_budget_mode(swarm_budget) == "equal":
        return max_tokens
    return int(max_tokens * (policy or BudgetPolicy()).extended_multiplier)


def backstop_tokens(
    max_tokens: int, solver: str | None = None, swarm_budget: str | None = None
) -> int:
    """The most tokens a run can spend before Inspect stops the sample outright.

    Without `solver` (the command line's check of a total token cap) this is the worst case of
    either solver under the budget mode in force, so a cap holds for an extended swarm too."""
    total = max_tokens if solver == "single" else swarm_total_tokens(max_tokens, swarm_budget)
    return int(total * TOKEN_BACKSTOP)


@task
def bixbench_v1(
    questions: list[dict[str, Any]],
    sample_id: str,
    solver: str = "single",
    time_limit_seconds: int = 1800,
    max_tokens: int | None = None,
    max_messages_per_role: int | None = None,
    analyst_model: str | None = None,
    critic_model: str | None = None,
    reconciler_model: str | None = None,
    critic_hints: str = "none",
    seed: int | None = None,
    swarm_budget: str = "equal",
    budget_policy: dict[str, Any] | None = None,
) -> Task:
    """`questions` are `PublicQuestion` dicts; anything with another field is refused.

    `max_tokens` is the single agent's budget. For the swarm, `swarm_budget` ("equal" or
    "extended") sets its total from that; a total that cannot hold the swarm's role floors
    raises `BudgetError` here, before a sandbox exists."""
    if solver not in SOLVERS:
        raise ValueError(f"unknown solver {solver!r}; use one of {SOLVERS}")
    public = [PublicQuestion.model_validate(q) for q in questions]
    if not public:
        raise ValueError("no questions")
    swarm = solver == "glhf"
    mode = swarm_budget_mode(swarm_budget)
    if swarm and max_tokens:
        plan_budget(max_tokens, len(public), mode, BudgetPolicy(**(budget_policy or {})))
    return Task(
        dataset=[
            Sample(
                id=sample_id,
                input=roles.brief(public),
                metadata={"questions": [q.model_dump() for q in public]},
            )
        ],
        solver=single_agent(time_limit_seconds, max_tokens, max_messages_per_role)
        if solver == "single"
        else glhf_qa_swarm(
            time_limit_seconds,
            max_tokens,
            max_messages_per_role,
            analyst_model,
            critic_model,
            reconciler_model,
            critic_hints,
            mode,
            budget_policy,
        ),
        sandbox=("docker", os.environ.get("BIXBENCH_V1_COMPOSE", str(COMPOSE))),
        message_limit=MESSAGE_LIMIT,
        time_limit=time_limit_seconds + TIME_BACKSTOP_SECONDS,
        token_limit=backstop_tokens(max_tokens, solver, mode) if max_tokens else None,
        config=GenerateConfig(seed=seed) if seed is not None else GenerateConfig(),
        metadata={
            "solver": solver,
            "time_limit_seconds": time_limit_seconds,
            "max_tokens": max_tokens,
            "swarm_budget": mode if swarm else None,
            "token_semantics": TOKEN_SEMANTICS[solver] if max_tokens else None,
            "grading": "host_after_inspect_exit",
        },
    )
