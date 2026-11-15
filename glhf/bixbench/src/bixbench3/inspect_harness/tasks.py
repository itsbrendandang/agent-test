from __future__ import annotations

import os
from pathlib import Path

from inspect_ai import Task, task
from inspect_ai.model import GenerateConfig

from bixbench3.inspect_harness.dataset import (
    DEFAULT_TIME_LIMIT_SECONDS,
    load_cases_dataset,
)
from bixbench3.inspect_harness.scorers import output_collection
from bixbench3.inspect_harness.solvers import (
    bixbench3_agent,
    prepare_case_workspace,
)
from bixbench3.inspect_harness.swarm.baseline import TOKEN_SEMANTICS, single_with_report_reserve
from bixbench3.inspect_harness.swarm.solver import glhf_swarm

MESSAGE_LIMIT = 5_000
TOKEN_BACKSTOP = 1.15  # the sample's hard token limit, as a multiple of max_tokens
TIME_LIMIT_SECONDS = DEFAULT_TIME_LIMIT_SECONDS
DEFAULT_SANDBOX_COMPOSE = Path(__file__).parents[3] / "sandbox" / "compose.yaml"


@task
def bixbench3_cases(
    dataset_path: str,
    case_ids: list[str] | None = None,
    effort: str = "unspecified",
    solver: str = "single",
    review_rounds: int = 3,
    planner_model: str | None = None,
    experimenter_model: str | None = None,
    critic_model: str | None = None,
    reporter_model: str | None = None,
    time_limit_seconds: int | None = None,
    max_tokens: int | None = None,
    max_messages_per_role: int | None = None,
    exa: bool = False,
    memory_dir: str | None = None,
    seed: int | None = None,
) -> Task:
    """solver="single" is the upstream baseline, unchanged. solver="glhf" is the GLHF swarm.

    With `max_tokens`, both solvers follow one rule: 90% for the work, and the rest (at least 10%)
    is kept so the run still writes METHODS.md. For the baseline that is the same agent run by
    `single_with_report_reserve`; without `max_tokens` it is upstream's solver, untouched."""
    if solver not in ("single", "glhf"):
        raise ValueError(f"unknown solver {solver!r}; use 'single' or 'glhf'")
    limit = time_limit_seconds or TIME_LIMIT_SECONDS  # shorter only for local runs
    compose_path = os.environ.get(
        "BIXBENCH3_INSPECT_SANDBOX_COMPOSE",
        str(DEFAULT_SANDBOX_COMPOSE),
    )
    return Task(
        dataset=load_cases_dataset(
            dataset_path,
            case_ids,
            time_limit_seconds=limit,
        ),
        setup=prepare_case_workspace(),
        solver=(single_with_report_reserve(max_tokens) if max_tokens else bixbench3_agent())
        if solver == "single"
        else glhf_swarm(
            review_rounds=review_rounds,
            budget_seconds=limit,
            planner_model=planner_model,
            experimenter_model=experimenter_model,
            critic_model=critic_model,
            reporter_model=reporter_model,
            max_tokens=max_tokens,
            max_messages_per_role=max_messages_per_role,
            exa=exa,
            memory_dir=memory_dir,
        ),
        scorer=output_collection(),
        sandbox=("docker", compose_path),
        message_limit=MESSAGE_LIMIT,
        time_limit=limit,
        # The token budget is enforced by the solvers (see the docstring). This is a backstop
        # only, in case a solver's own limit fails: close to the budget, so a failure cannot
        # double the bill, and above it by more than a role's last call can overshoot.
        token_limit=round(max_tokens * TOKEN_BACKSTOP) if max_tokens else None,
        config=GenerateConfig(seed=seed) if seed is not None else GenerateConfig(),
        metadata={
            "effort": effort,
            "solver": solver,
            "role_models": {
                "planner": planner_model,
                "experimenter": experimenter_model,
                "critic": critic_model,
                "reporter": reporter_model,
            },
            "limits": {"max_tokens": max_tokens, "max_messages_per_role": max_messages_per_role},
            "token_semantics": TOKEN_SEMANTICS[solver] if max_tokens else None,
            "time_limit_seconds": limit,
            "review_rounds": review_rounds if solver == "glhf" else None,
            # What the swarm's roles have that the single agent does not. Disclose with scores.
            "swarm_only_tools": (
                ["check_outputs", "read_ledger", "ledger tools"]
                + (["search_docs"] if exa else [])
                + (["memory"] if memory_dir else [])
            )
            if solver == "glhf"
            else [],
            "exa": exa,
            "memory": bool(memory_dir),
            "seed": seed,
            "artifact_grading": "host_after_inspect_exit",
        },
    )
