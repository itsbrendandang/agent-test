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
from bixbench3.inspect_harness.swarm.solver import glhf_swarm

MESSAGE_LIMIT = 5_000
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
    """solver="single" is the upstream baseline, unchanged. solver="glhf" is the GLHF swarm."""
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
        solver=bixbench3_agent()
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
        token_limit=max_tokens if solver == "single" else None,
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
            "exa": exa,
            "memory": bool(memory_dir),
            "seed": seed,
            "artifact_grading": "host_after_inspect_exit",
        },
    )
