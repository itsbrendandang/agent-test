"""Run one capsule with one solver in a local Docker sandbox, then grade it on the host.

Order of events, which is the integrity boundary:
  1. the capsule zip is staged (allow-list, staging.py), re-verified and scanned for leaks;
  2. the questions are split into the public view and the grading key (dataset.public_view);
     multiple-choice options are shuffled with a salt made for this run and kept in the run
     folder on the host (`shuffle_salt.json`), nowhere else; the prompt is built from the
     public view and checked for the capsule's secret strings;
  3. Inspect runs the solver in a sandbox with no network that mounts the staged data
     read-only and an outputs directory, both under a neutral, random host path
     (`neutral_mount`) so /proc/self/mountinfo names no capsule, run, model or solver; the
     two paths go into this run's own compose file, not into environment variables; the key
     is not passed to Inspect;
  4. the outputs are moved into the run folder, and only after Inspect has returned and the
     sandbox is gone does `grade_run` read outputs/answers.json and compare it with the key.

Layout of a run directory: outputs/ logs/ run.json grade.json shuffle_salt.json
"""

from __future__ import annotations

import asyncio
import json
import os
import platform
import secrets
import shutil
import subprocess
import time
from collections.abc import Mapping
from importlib.metadata import version
from pathlib import Path
from typing import Any

from inspect_ai import eval as inspect_eval
from inspect_ai.model import Model, ModelOutput, get_model

from . import modal_image, modal_run, roles, staging
from .dataset import (
    HF_REVISION,
    AnswerMode,
    Capsule,
    KeyEntry,
    PublicQuestion,
    new_shuffle_salt,
    public_view,
)
from .grading import PROFILES, Judge, Profile, grade_answers, judge_record
from .jobs import write_json
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
from .task import (
    DEFAULT_IMAGE,
    TIME_BACKSTOP_SECONDS,
    backstop_tokens,
    bixbench_v1,
    write_compose,
)

MOCK = "mockllm/model"
SALT_FILE = "shuffle_salt.json"
MOUNTS_DIR = "mounts"  # beside the staged capsules; one random folder per run, removed after
SANDBOXES = ("docker", "modal")
MODAL_IMAGE = modal_image.PUBLISHED  # the image of `--sandbox modal`: our amd64 rebuild


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


def write_salt(out_dir: Path) -> str:
    """Make this run's option-shuffle salt and keep it in the run folder, readable by the
    owner only. The folder is on the host and is not mounted into the sandbox (only a neutral
    outputs folder is); the salt is put in no prompt, task, environment variable or run.json."""
    salt = new_shuffle_salt()
    path = out_dir / SALT_FILE
    path.unlink(missing_ok=True)
    path.touch(mode=0o600)
    path.write_text(
        json.dumps({"salt": salt, "note": "host only; grading needs it to rebuild the key"})
    )
    return salt


def read_salt(out_dir: Path) -> str | None:
    path = out_dir / SALT_FILE
    if not path.exists():
        return None
    return str(json.loads(path.read_text(encoding="utf-8"))["salt"])


def neutral_mount(staged_root: Path, data_dir: Path, manifest: staging.Manifest) -> Path:
    """A host folder for one run whose path says nothing: `<staged_root>/../mounts/<random>/`
    with `data/` (hard links to the staged files; copies if links are not possible) and an
    empty `outputs/`. A bind mount's host path is readable inside the container in
    /proc/self/mountinfo, so the capsule's uuid and the run folder (which names the model and
    the solver) must not be in it."""
    root = staged_root.resolve().parent / MOUNTS_DIR / secrets.token_hex(8)
    (root / "outputs").mkdir(parents=True)
    for relative in sorted(manifest.paths):
        source, target = data_dir / relative, root / "data" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.link(source, target)
        except OSError:
            shutil.copy2(source, target)
    return root


def _collect_outputs(mount: Path, outputs: Path) -> None:
    """Move what the run wrote from the neutral folder into the run folder; drop the folder."""
    produced = mount / "outputs"
    if produced.is_dir():
        if outputs.exists():
            shutil.rmtree(outputs)
        shutil.move(str(produced), str(outputs))
    shutil.rmtree(mount, ignore_errors=True)


def stage(capsule: Capsule, hub_dir: Path, staged_root: Path) -> tuple[Path, staging.Manifest]:
    """Stage the capsule's data (once; later calls only verify it) and scan it for secrets.
    With --jobs the parent calls this for every capsule before any run starts: staging the
    same capsule twice at the same time would race."""
    staged = staged_root.resolve() / capsule.uuid
    data_dir = staging.stage_capsule(
        hub_dir / capsule.zip_name,
        staged,
        data_folder=staging.DATA_FOLDER_PREFIX + capsule.uuid,  # exactly the dataset's uuid
    )
    manifest = staging.verify_staged(staged)
    secrets = [s for q in capsule.questions for s in q.long_secrets()]
    leaks = staging.leak_scan(data_dir, secrets)
    if leaks:
        raise staging.IntegrityError(f"{capsule.key}: staged files contain a secret field: {leaks}")
    return data_dir, manifest


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
    repeat: int = 0,
    sandbox: str = "docker",
    modal_cpu: float = 4.0,
    modal_memory_mib: int = 16384,
    modal_ledgers: list[Path] | None = None,
    modal_usd_cap: float | None = None,
    jobs: int = 1,
) -> dict[str, Any]:
    """Run the solver. Does not grade and never touches the key beyond building the public view.
    `sandbox` is "docker" (local, the default) or "modal" (a Modal Sandbox made from our amd64
    rebuild of the image; see modal_run.py; refused while NO_PAID_CALLS is on).
    `repeat` numbers repeated runs of the same unit with the same solver and model (0 first).
    `question_ids` restricts the run to some of the capsule's questions (one per run mirrors the
    official protocol). `mock_outputs` replaces the fixed script of `--model mock` (tests).

    `max_tokens` is the single agent's budget for this run. `swarm_budget` ("equal": the swarm
    gets the same total; "extended": the analyst gets all of it and the swarm's total is larger;
    default $BIXBENCH_V1_SWARM_BUDGET, else "equal") says what the swarm gets. A swarm budget
    that cannot hold the role floors raises `BudgetError` here, before staging or any container.
    `critic_hints` is accepted for the command line and ignored: the critic is always blind.
    `jobs` is how many runs the command ran at once; it is recorded, because time spent waiting
    on a provider's rate limit comes out of the run's own time."""
    out_dir = out_dir.resolve()
    outputs = out_dir / "outputs"
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
    data_dir, manifest = stage(capsule, hub_dir, staged_root)

    # 2. Public view for the solver; the key stays here and is not used until grading.
    out_dir.mkdir(parents=True, exist_ok=True)
    public, _key = public_view(asked, answer_mode, seed, write_salt(out_dir))
    del _key
    check_prompt(roles.brief(public), capsule, answer_mode)

    if sandbox not in SANDBOXES:
        raise ValueError(f"unknown sandbox {sandbox!r}; use one of {SANDBOXES}")
    on_modal = sandbox == "modal"
    if on_modal:
        image = image or MODAL_IMAGE
    image = image or os.environ.get("BIXBENCH_V1_IMAGE") or DEFAULT_IMAGE
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
            "repeat": repeat,
            "jobs": jobs,
            "option_shuffle": None if answer_mode == "open" else f"host-only salt ({SALT_FILE})",
            "sandbox": sandbox,
            "image": image,
            "image_id": None if on_modal else _image_digest(image),
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
    write_json(out_dir / "run.json", summary)

    # 3. Solve. The task receives public questions only; the sandbox mounts neutral paths.
    role_args: dict[str, Any] = {"budget_policy": budget_policy}
    if swarm:
        role_args |= {f"{role}_model": name for role, name in (role_models or {}).items()}
        role_args["critic_hints"] = critic_hints
        role_args["swarm_budget"] = mode
    mount = neutral_mount(staged_root, data_dir, manifest)
    modal: modal_run.ModalRun | None = None
    leftover: list[str] = []
    try:
        if on_modal:
            # The staged data goes to the Volume (once); the sandbox's /outputs is copied into
            # the same neutral folder a Docker run mounts, so what follows is the same code.
            modal = modal_run.prepare(
                data_dir=data_dir,
                manifest=manifest,
                outputs_dir=mount / "outputs",
                run_dir=out_dir,
                run_name=f"{capsule.key}/{out_dir.name}",
                capsule=capsule.key,
                solver=solver,
                time_limit_seconds=time_limit_seconds,
                backstop_seconds=TIME_BACKSTOP_SECONDS,
                image=image,
                cpu=modal_cpu,
                memory_mib=modal_memory_mib,
                ledgers=modal_ledgers,
                usd_cap=modal_usd_cap,
            )
            where: dict[str, Any] = modal.task_args()
        else:
            compose = write_compose(
                mount / "compose.yaml", image, mount / "data", mount / "outputs"
            )
            where = {"compose_file": str(compose)}
        logs = inspect_eval(
            bixbench_v1(
                questions=[q.model_dump() for q in public],
                sample_id=capsule.key,
                solver=solver,
                time_limit_seconds=time_limit_seconds,
                max_tokens=max_tokens,
                max_messages_per_role=max_messages_per_role,
                seed=seed,
                **where,
                **role_args,
            ),
            model=resolved,
            log_dir=str(out_dir / "logs"),
            display="none",
        )
    finally:
        try:
            if modal is not None:  # also after an error or Ctrl+C: no sandbox is left running
                leftover = modal.finish()
        finally:
            _collect_outputs(mount, outputs)
    if modal is not None:
        summary["settings"]["modal"] = modal.settings(leftover)
        summary["settings"]["image_id"] = summary["settings"]["modal"].get("image_id")
        summary["settings"]["network_probe"] = summary["settings"]["modal"]["network_probe"]
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
    write_json(out_dir / "run.json", summary)
    return summary


def key_for(capsule: Capsule, run: dict[str, Any], out_dir: Path) -> dict[str, KeyEntry]:
    """Rebuild the grading key of a finished run from the question file, the run's settings
    and, for multiple choice, the salt kept in the run folder."""
    asked = [q for q in capsule.questions if q.question_id in run["question_ids"]]
    settings = run["settings"]
    _, key = public_view(asked, settings["answer_mode"], settings["seed"], read_salt(out_dir))
    return key


def grade_run(
    out_dir: Path,
    capsule: Capsule,
    judge: Judge | Mapping[str, Judge | None] | None = None,
    judge_name: str | None = None,
    profiles: tuple[Profile, ...] = ("per-mode",),
    judge_temperature: float | None = None,
) -> dict[str, Any]:
    """Grade outputs/answers.json of a finished run. Host only; the sandbox no longer exists.

    `judge` is one judge for every profile, or a judge per profile. The judge is given the
    question, the ideal answer and the submitted answer string, nothing from the solver's
    transcript. grade.json holds verdicts, not ideal answers, and per profile the judge model
    and temperature used (taken from the judge object, else `judge_name` and
    `judge_temperature`) with every deviation from that profile's default judge."""
    run = json.loads((out_dir / "run.json").read_text(encoding="utf-8"))
    if run.get("status") == "running":
        raise RuntimeError(f"{out_dir}: the solver has not finished; refusing to grade")
    answers_file = out_dir / "outputs" / "answers.json"
    answers: dict[str, str] = {}
    if answers_file.exists():
        recorded = json.loads(answers_file.read_text(encoding="utf-8"))
        answers = {q: str(a.get("answer", "")) for q, a in recorded["answers"].items()}
    key = key_for(capsule, run, out_dir)
    answer_mode: AnswerMode = run["settings"]["answer_mode"]
    result: dict[str, Any] = {
        "capsule": capsule.key,
        "solver": run["settings"]["solver"],
        "answer_mode": answer_mode,
        "judge_model": None,  # the first profile's judge; each profile records its own below
        "graded_at": time.time(),
        "profiles": {},
    }
    for index, profile in enumerate(profiles):
        if profile not in PROFILES:
            raise ValueError(f"unknown grading profile {profile!r}")
        mine = judge.get(profile) if isinstance(judge, Mapping) else judge
        name = (getattr(mine, "model", None) or judge_name or "unnamed") if mine else None
        temperature = getattr(mine, "temperature", judge_temperature) if mine else None
        if index == 0:
            result["judge_model"] = name
        grades = asyncio.run(grade_answers(key, answers, answer_mode, mine, profile))
        rows = [g.to_dict() for g in grades]
        result["profiles"][profile] = {
            # Multiple choice is a letter match: no judge is asked whatever was configured.
            "judge": judge_record(profile, name, temperature)
            if answer_mode == "open"
            else {"model": None, "temperature": None, "deviations": [], "letter_match": True},
            "summary": summarise(rows),
            "grades": rows,
        }
    (out_dir / "grade.json").write_text(json.dumps(result, indent=2))
    return result


__all__ = [
    "DEFAULT_IMAGE",
    "PublicQuestion",
    "check_prompt",
    "grade_run",
    "key_for",
    "load_env",
    "mock_script",
    "run_capsule",
]
