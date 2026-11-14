"""Run one capsule with one solver in a local Docker sandbox, then grade it on the host.

Order of events, which is the integrity boundary:
  1. the capsule zip is staged (allow-list, staging.py), re-verified and scanned for leaks;
  2. the questions are split into the public view and the grading key (dataset.public_view);
     the prompt is built from the public view and checked for the capsule's secret strings;
  3. Inspect runs the solver in a sandbox with no network that mounts the staged data
     read-only and the outputs directory; the key is not passed to Inspect;
  4. only after Inspect has returned and the sandbox is gone does `grade_run` read
     outputs/answers.json and compare it with the key.

Layout of a run directory: outputs/ logs/ run.json grade.json
"""

from __future__ import annotations

import asyncio
import json
import os
import platform
import subprocess
import time
from importlib.metadata import version
from pathlib import Path
from typing import Any

from inspect_ai import eval as inspect_eval
from inspect_ai.model import Model, ModelOutput, get_model

from . import roles, staging
from .dataset import HF_REVISION, AnswerMode, Capsule, KeyEntry, PublicQuestion, public_view
from .grading import PROFILES, Judge, Profile, grade_answers
from .solvers import (
    COMPACTION_THRESHOLD_TOKENS,
    DERIVATION_SHARE,
    RECONCILE_RESERVE,
    TOKEN_SEMANTICS,
    BudgetPolicy,
    plan_budget,
    swarm_budget_mode,
)
from .stats import summarise
from .task import COMPOSE, backstop_tokens, bixbench_v1

MOCK = "mockllm/model"
DEFAULT_IMAGE = "futurehouse/bixbench:aviary-notebook-env"


def load_env(path: Path) -> list[str]:
    """Put KEY=value lines of a .env file into the environment (existing variables win).
    Returns the names set, never the values."""
    names: list[str] = []
    if not path.exists():
        return names
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        name, value = name.strip(), value.strip().strip("'\"")
        if name and value and name not in os.environ:
            os.environ[name] = value
            names.append(name)
    return names


def check_prompt(prompt: str, capsule: Capsule, answer_mode: AnswerMode) -> None:
    """Refuse a prompt that carries one of the capsule's secrets. The prompt is built from
    `PublicQuestion` only, so this can fail only if the dataset itself repeats a secret in a
    question's text; then the run must not start."""
    for question in capsule.questions:
        secrets = question.long_secrets()
        if answer_mode != "open":  # the ideal is an unlabelled option there
            secrets = [s for s in secrets if s != question.ideal.strip()]
        for secret in secrets:
            if secret in prompt:
                raise staging.IntegrityError(
                    f"{question.question_id}: the prompt contains a secret field of the capsule"
                )


def mock_script(solver: str, question_ids: list[str]) -> list[ModelOutput]:
    """A fixed script for `--model mock`: no analysis, placeholder answers. It exercises the
    plumbing (sandbox, ledger, reconciliation, grading) and says nothing about the benchmark."""

    def call(tool: str, **arguments: object) -> ModelOutput:
        return ModelOutput.for_tool_call(MOCK, tool, arguments)

    def answers(value: str, differ_on_first: str | None = None, **more: str) -> list[ModelOutput]:
        return [
            call(
                "submit_answer",
                question_id=q,
                answer=differ_on_first if differ_on_first and i == 0 else value,
                route="scripted placeholder",
                evidence="none: scripted run",
                **more,
            )
            for i, q in enumerate(question_ids)
        ]

    done = call("submit", answer="done")
    if solver == "single":
        return [call("bash_session", action="type_submit", input="ls /data"), *answers("1"), done]
    script = f"{roles.RECONCILE_DIR}/scripted.sh"
    return [
        *answers(
            "1", method="data=none; subset=none; procedure=scripted placeholder one; tool=mock"
        ),
        done,
        *answers(
            "1",
            differ_on_first="2",
            method="data=other; subset=every; procedure=different scripted route two; tool=mock",
        ),
        done,
        # The reconciler has to produce the value with a script the harness runs itself.
        call(
            "bash_session",
            action="type_submit",
            input=f"printf 'ls /data >/dev/null\\necho 2\\n' > {script}",
        ),
        call(
            "rederive",
            question_id=question_ids[0],
            script=script,
            answer="2",
            cause="scripted disagreement",
            same_method=False,
        ),
        done,
    ]


def _image_digest(image: str) -> str | None:
    try:
        result = subprocess.run(
            ["docker", "image", "inspect", image, "--format", "{{.Id}}"],
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return result.stdout.strip() or None


def run_capsule(
    capsule: Capsule,
    *,
    hub_dir: Path,
    staged_root: Path,
    out_dir: Path,
    solver: str = "single",
    model: str = "mock",
    answer_mode: AnswerMode = "open",
    question_ids: list[str] | None = None,
    time_limit_seconds: int = 1800,
    max_tokens: int | None = None,
    max_messages_per_role: int | None = None,
    role_models: dict[str, str] | None = None,
    critic_hints: str = "none",
    seed: int = 0,
    image: str | None = None,
    mock_outputs: list[ModelOutput] | None = None,
    swarm_budget: str | None = None,
    budget_policy: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run the solver. Does not grade and never touches the key beyond building the public view.
    `question_ids` restricts the run to some of the capsule's questions (one per run mirrors the
    official protocol). `mock_outputs` replaces the fixed script of `--model mock` (tests).

    `max_tokens` is the single agent's budget for this run. `swarm_budget` ("equal": the swarm
    gets the same total; "extended": the analyst gets all of it and the swarm's total is larger;
    default $BIXBENCH_V1_SWARM_BUDGET, else "equal") says what the swarm gets. A swarm budget
    that cannot hold the role floors raises `BudgetError` here, before staging or any container.
    `critic_hints` is accepted for the command line and ignored: the critic is always blind."""
    out_dir = out_dir.resolve()
    outputs = out_dir / "outputs"
    outputs.mkdir(parents=True, exist_ok=True)
    asked = [q for q in capsule.questions if question_ids is None or q.question_id in question_ids]
    if not asked:
        raise ValueError(f"{capsule.key}: none of {question_ids} is a question of this capsule")
    swarm = solver == "glhf"
    mode = swarm_budget_mode(swarm_budget)
    plan = (
        plan_budget(max_tokens, len(asked), mode, BudgetPolicy(**(budget_policy or {})))
        if swarm and max_tokens
        else None
    )

    # 1. Stage and verify the data the sandbox will see.
    staged = staged_root.resolve() / capsule.uuid
    data_dir = staging.stage_capsule(hub_dir / capsule.zip_name, staged)
    manifest = staging.verify_staged(staged)
    secrets = [s for q in capsule.questions for s in q.long_secrets()]
    leaks = staging.leak_scan(data_dir, secrets)
    if leaks:
        raise staging.IntegrityError(f"{capsule.key}: staged files contain a secret field: {leaks}")

    # 2. Public view for the solver; the key stays here and is not used until grading.
    public, _key = public_view(asked, answer_mode, seed)
    del _key
    check_prompt(roles.brief(public), capsule, answer_mode)

    image = image or os.environ.get("BIXBENCH_V1_IMAGE") or DEFAULT_IMAGE
    os.environ.update(
        BIXBENCH_V1_IMAGE=image,
        BIXBENCH_V1_DATA_DIR=str(data_dir),
        BIXBENCH_V1_OUTPUTS_DIR=str(outputs),
    )
    if model == "mock":
        if role_models:
            raise ValueError("role models cannot be combined with --model mock")
        resolved: Model = get_model(
            MOCK,
            custom_outputs=mock_outputs or mock_script(solver, [q.question_id for q in public]),
        )
    else:
        resolved = get_model(model)

    started = time.time()
    summary: dict[str, Any] = {
        "benchmark": "BixBench v1.5 (futurehouse/BixBench)",
        "dataset_revision": HF_REVISION,
        "capsule": capsule.key,
        "capsule_uuid": capsule.uuid,
        "question_ids": [q.question_id for q in public],
        "questions_in_capsule": len(capsule.questions),
        "settings": {
            "solver": solver,
            "model": model,
            "role_models": (role_models or {}) if swarm else {},
            "answer_mode": answer_mode,
            "unit": "capsule" if len(asked) == len(capsule.questions) else "questions",
            "time_limit_seconds": time_limit_seconds,
            "max_tokens": max_tokens,
            "token_backstop": backstop_tokens(max_tokens, solver, mode) if max_tokens else None,
            # What the single agent gets for this run, what this solver may spend in all, and
            # whether a swarm result is therefore a "same budget" or a "more budget" result.
            "single_budget_tokens": max_tokens,
            "total_budget_tokens": (plan.total if plan else max_tokens),
            "swarm_budget": plan.describe() if plan else ({"mode": mode} if swarm else None),
            "budget_reading": (plan.reading if plan else None),
            "token_semantics": TOKEN_SEMANTICS[solver] if max_tokens else None,
            "max_messages_per_role": max_messages_per_role,
            "compaction_threshold_tokens": COMPACTION_THRESHOLD_TOKENS,
            "derivation_share": DERIVATION_SHARE if swarm else None,
            "reconcile_reserve": RECONCILE_RESERVE if swarm else None,
            "critic_hints": "none" if swarm else None,  # always blind; "route" is ignored
            "critic_hints_requested": critic_hints if swarm else None,
            "seed": seed,
            "image": image,
            "image_id": _image_digest(image),
            "network": "none",
            # The BixBench3 swarm's extras are not wired into this solver; both are always off.
            "documentation_search": False,
            "lessons_memory": False,
            "tools": ["bash_session", "python", "text_editor", "submit_answer"]
            + (["rederive (reconciler only)"] if swarm else []),
        },
        "staging": {
            "zip": manifest.zip_name,
            "zip_sha256": manifest.zip_sha256,
            "files": len(manifest.included),
            "bytes": sum(int(str(i["bytes"])) for i in manifest.included),
            "excluded": len(manifest.excluded),
        },
        "versions": {
            "inspect_ai": version("inspect_ai"),
            "bixbench_v1": version("bixbench-v1"),
            "python": platform.python_version(),
        },
        "started_at": started,
        "status": "running",
    }
    (out_dir / "run.json").write_text(json.dumps(summary, indent=2))

    # 3. Solve. The task receives public questions only.
    role_args: dict[str, Any] = {}
    if swarm:
        role_args = {f"{role}_model": name for role, name in (role_models or {}).items()}
        role_args["critic_hints"] = critic_hints
        role_args["swarm_budget"] = mode
        role_args["budget_policy"] = budget_policy
    logs = inspect_eval(
        bixbench_v1(
            questions=[q.model_dump() for q in public],
            sample_id=capsule.key,
            solver=solver,
            time_limit_seconds=time_limit_seconds,
            max_tokens=max_tokens,
            max_messages_per_role=max_messages_per_role,
            seed=seed,
            **role_args,
        ),
        model=resolved,
        log_dir=str(out_dir / "logs"),
        display="none",
    )
    log = logs[0]
    usage: dict[str, dict[str, int | None]] = {}
    for name, u in (log.stats.model_usage or {}).items():
        usage[name] = {
            "input_tokens": u.input_tokens,
            "output_tokens": u.output_tokens,
            "cache_read_tokens": u.input_tokens_cache_read,
            "cache_write_tokens": u.input_tokens_cache_write,
            "reasoning_tokens": u.reasoning_tokens,
            "total_tokens": u.total_tokens,
        }
    answers_file = outputs / "answers.json"
    statuses: dict[str, str] = {}
    if answers_file.exists():
        recorded = json.loads(answers_file.read_text(encoding="utf-8"))
        statuses = {q: a["status"] for q, a in recorded["answers"].items()}
    events: list[dict[str, Any]] = []
    ledger_file = outputs / "glhf" / "ledger.json"
    if ledger_file.exists():
        events = json.loads(ledger_file.read_text(encoding="utf-8")).get("events", [])
    sample = log.samples[0] if log.samples else None
    total_tokens = sum(int(u["total_tokens"] or 0) for u in usage.values())
    phases = [e for e in events if str(e.get("kind", "")).startswith("phase.")]
    records_file = outputs / "glhf" / "questions.json"
    if records_file.exists():
        cross = json.loads(records_file.read_text(encoding="utf-8"))
        summary["questions"] = cross.get("questions", [])
        summary["blind_check"] = cross.get("blind_check", {})
    summary["budget"] = {
        "solver": solver,
        "single_budget_tokens": max_tokens,
        "total_budget_tokens": plan.total if plan else max_tokens,
        "reading": plan.reading if plan else None,
        "tokens_used": total_tokens,
        "used_vs_single_budget": round(total_tokens / max_tokens, 3) if max_tokens else None,
        "tokens_by_phase": {
            str(e["phase"]): e.get("phase_tokens", e.get("tokens"))
            for e in phases
            if e.get("kind") == "phase.finished"
        },
        "forced_answers": {
            str(e["phase"]): e.get("forced_answers", [])
            for e in phases
            if e.get("kind") == "phase.finished" and e.get("forced_answers")
        },
    }
    summary.update(
        status="done" if log.status == "success" and answers_file.exists() else "failed",
        error=str(log.error.message) if log.error else None,
        sample_limit=str(sample.limit.type) if sample is not None and sample.limit else None,
        finished_at=time.time(),
        seconds=round(time.time() - started, 1),
        usage=usage,
        total_tokens=total_tokens,
        messages=len(sample.messages) if sample is not None else 0,
        answer_statuses=statuses,
        phases=phases,
    )
    (out_dir / "run.json").write_text(json.dumps(summary, indent=2))
    return summary


def key_for(capsule: Capsule, run: dict[str, Any]) -> dict[str, KeyEntry]:
    """Rebuild the grading key of a finished run from the question file and the run's settings."""
    asked = [q for q in capsule.questions if q.question_id in run["question_ids"]]
    settings = run["settings"]
    _, key = public_view(asked, settings["answer_mode"], settings["seed"])
    return key


def grade_run(
    out_dir: Path,
    capsule: Capsule,
    judge: Judge | None = None,
    judge_name: str | None = None,
    profiles: tuple[Profile, ...] = ("per-mode",),
) -> dict[str, Any]:
    """Grade outputs/answers.json of a finished run. Host only; the sandbox no longer exists.

    The judge is given the question, the ideal answer and the submitted answer string, nothing
    from the solver's transcript. grade.json holds verdicts, not ideal answers."""
    run = json.loads((out_dir / "run.json").read_text(encoding="utf-8"))
    if run.get("status") == "running":
        raise RuntimeError(f"{out_dir}: the solver has not finished; refusing to grade")
    answers_file = out_dir / "outputs" / "answers.json"
    answers: dict[str, str] = {}
    if answers_file.exists():
        recorded = json.loads(answers_file.read_text(encoding="utf-8"))
        answers = {q: str(a.get("answer", "")) for q, a in recorded["answers"].items()}
    key = key_for(capsule, run)
    answer_mode: AnswerMode = run["settings"]["answer_mode"]
    result: dict[str, Any] = {
        "capsule": capsule.key,
        "solver": run["settings"]["solver"],
        "answer_mode": answer_mode,
        "judge_model": judge_name,
        "graded_at": time.time(),
        "profiles": {},
    }
    for profile in profiles:
        if profile not in PROFILES:
            raise ValueError(f"unknown grading profile {profile!r}")
        grades = asyncio.run(grade_answers(key, answers, answer_mode, judge, profile))
        rows = [g.to_dict() for g in grades]
        result["profiles"][profile] = {"summary": summarise(rows), "grades": rows}
    (out_dir / "grade.json").write_text(json.dumps(result, indent=2))
    return result


__all__ = [
    "COMPOSE",
    "DEFAULT_IMAGE",
    "PublicQuestion",
    "check_prompt",
    "grade_run",
    "key_for",
    "load_env",
    "mock_script",
    "run_capsule",
]
