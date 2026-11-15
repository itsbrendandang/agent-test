"""The Inspect task for one run: one capsule's staged data and a set of its questions.

The task is built from `PublicQuestion` objects only. It has no target and no scorer: the
answer key never enters Inspect, so it is in no prompt, no sample metadata and no eval log.
Grading happens in runner.py after `inspect_ai.eval` has returned and the sandbox is gone.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
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

DEFAULT_IMAGE = "futurehouse/bixbench:aviary-notebook-env"
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


def compose_config(image: str, data_dir: Path, outputs_dir: Path) -> dict[str, Any]:
    """The sandbox of ONE run, with that run's two host paths written in.

      - no network (network_mode: none);
      - /data is the staged capsule data, read-only (staging.py says what is staged);
      - /outputs receives answers.json, METHODS.md and the ledger, written by the solver's code.
    Nothing else from the host is mounted: the answer key, the capsule zip and the solution
    notebooks stay on the host, and the service is given no environment. The paths are values
    of this run, not process-wide environment variables, so two runs in one process (or two
    processes sharing an environment) cannot mount each other's capsule."""
    return {
        "services": {
            "default": {
                "image": image,
                "x-local": True,
                "init": True,
                "working_dir": "/home",
                "command": ["sleep", "infinity"],
                "network_mode": "none",
                "volumes": [
                    {"type": "bind", "source": str(data_dir), "target": "/data", "read_only": True},
                    {"type": "bind", "source": str(outputs_dir), "target": "/outputs"},
                ],
            }
        }
    }


def write_compose(path: Path, image: str, data_dir: Path, outputs_dir: Path) -> Path:
    path.write_text(yaml.safe_dump(compose_config(image, data_dir, outputs_dir), sort_keys=False))
    return path


def _sandbox(compose_file: str | None, modal_config: dict[str, Any] | None) -> Any:
    """The sandbox of the task: local Docker from this run's compose file (the default), or a
    Modal sandbox. The Modal provider and the `modal` package are imported only when asked for,
    so a Docker run needs neither."""
    if modal_config is None:
        return ("docker", compose_file) if compose_file else None
    if compose_file:
        raise ValueError("give compose_file (Docker) or modal_config (Modal), not both")
    from inspect_ai.util import SandboxEnvironmentSpec

    from .modal_boundary import BixModalConfig
    from .modal_sandbox import PROVIDER  # registers the provider

    return SandboxEnvironmentSpec(PROVIDER, BixModalConfig(**modal_config))


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
    compose_file: str | None = None,
    modal_config: dict[str, Any] | None = None,
) -> Task:
    """`questions` are `PublicQuestion` dicts; anything with another field is refused.
    `compose_file` is this run's sandbox (`write_compose`); without one the task can be
    inspected but not run. `modal_config` (a `modal_boundary.BixModalConfig` as a dict) runs
    the sandbox on Modal instead (`--sandbox modal`); it and `compose_file` exclude each other.

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
        solver=single_agent(time_limit_seconds, max_tokens, max_messages_per_role, budget_policy)
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
        sandbox=_sandbox(compose_file, modal_config),
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
