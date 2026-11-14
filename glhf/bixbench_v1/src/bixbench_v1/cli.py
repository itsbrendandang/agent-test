"""Command line for the BixBench v1.5 adapter.

    uv run bixbench-v1 download                       # question file and all capsule zips (5.9 GB)
    uv run bixbench-v1 list                           # capsules, question counts, eval modes, sizes
    uv run bixbench-v1 audit                          # what staging keeps and drops, every capsule
    uv run bixbench-v1 run --capsules bix-26 --solvers single,glhf \\
        --model anthropic/claude-sonnet-5-5 --max-tokens 400000 --time-limit 1800 --out runs/try
    uv run bixbench-v1 run --all --solvers single,glhf --model ... --out runs/full
    uv run bixbench-v1 grade --out runs/try           # grade again (e.g. another judge or profile)
    uv run bixbench-v1 report --out runs/try

`--model mock` plays a fixed script and needs no key. It proves the plumbing, not the science.
Keys are read from the repository's .env; they are never printed.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from . import report as reporting
from . import staging
from .dataset import (
    ANSWER_MODES,
    QUESTION_FILE,
    Capsule,
    download,
    find_capsules,
    group_capsules,
    load_questions,
)
from .grading import PROFILES, InspectJudge, Profile
from .runner import check_prompt, grade_run, load_env, run_capsule
from .solvers import CRITIC_HINTS
from .task import SOLVERS, backstop_tokens

REPO = Path(__file__).resolve().parents[4]
DATA = REPO / "glhf" / "data" / "bixbench_v1"
DEFAULT_JUDGE = "openai/gpt-4o"  # the official grader's default model
JUDGE_RESERVE_TOKENS = 20_000  # per run, when checking a total token cap


def _capsules(arguments: argparse.Namespace) -> list[Capsule]:
    question_file = arguments.data / "hub" / QUESTION_FILE
    if not question_file.exists():
        sys.exit(f"{question_file} not found; run `bixbench-v1 download` first")
    return group_capsules(load_questions(question_file))


def _selected(arguments: argparse.Namespace) -> list[Capsule]:
    capsules = _capsules(arguments)
    if arguments.all:
        return capsules
    if not arguments.capsules:
        sys.exit("give --capsules a,b,c or --all")
    return find_capsules(capsules, arguments.capsules.split(","))


def _budget(arguments: argparse.Namespace, questions: int) -> tuple[int, int]:
    """(max_tokens, time_limit_seconds) of one run: explicit values, or base + per question."""
    tokens = arguments.max_tokens or (
        arguments.tokens_base + arguments.tokens_per_question * questions
    )
    seconds = arguments.time_limit or (
        arguments.seconds_base + arguments.seconds_per_question * questions
    )
    return int(tokens), int(seconds)


def cmd_download(arguments: argparse.Namespace) -> int:
    names = None
    if arguments.capsules:
        download(arguments.data / "hub", [])  # the question file first
        names = [
            c.zip_name for c in find_capsules(_capsules(arguments), arguments.capsules.split(","))
        ]
    download(arguments.data / "hub", names)
    print(f"downloaded to {arguments.data / 'hub'}")
    return 0


def cmd_list(arguments: argparse.Namespace) -> int:
    for capsule in _capsules(arguments):
        zip_path = arguments.data / "hub" / capsule.zip_name
        size = (
            f"{zip_path.stat().st_size / 1e6:8.1f} MB" if zip_path.exists() else "  not downloaded"
        )
        modes = ",".join(sorted({q.eval_mode.removesuffix("_verifier") for q in capsule.questions}))
        print(f"{capsule.key:20} questions={len(capsule.questions)} zip={size} modes={modes}")
    return 0


def cmd_audit(arguments: argparse.Namespace) -> int:
    """Plan the staging of every capsule and check every prompt, without extracting anything."""
    problems = 0
    for capsule in _capsules(arguments):
        zip_path = arguments.data / "hub" / capsule.zip_name
        if not zip_path.exists():
            print(f"{capsule.key}: zip not downloaded")
            problems += 1
            continue
        manifest = staging.plan(zip_path)
        reasons: dict[str, int] = {}
        for item in manifest.excluded:
            reason = item["reason"].split(" (")[0]
            reasons[reason] = reasons.get(reason, 0) + 1
        try:
            from . import roles
            from .dataset import public_view

            for mode in ANSWER_MODES:
                check_prompt(roles.brief(public_view(capsule.questions, mode)[0]), capsule, mode)
            prompt = "prompts clean"
        except staging.IntegrityError as error:
            prompt, problems = f"PROMPT LEAK: {error}", problems + 1
        if not manifest.included:
            prompt, problems = prompt + "; NO DATA FILES", problems + 1
        megabytes = sum(int(str(i["bytes"])) for i in manifest.included) / 1e6
        print(
            f"{capsule.key:20} staged={len(manifest.included):4} files {megabytes:8.1f} MB  "
            f"dropped={len(manifest.excluded)} {reasons or ''}  {prompt}"
        )
    print(f"{problems} problem(s)")
    return 1 if problems else 0


def _judge(arguments: argparse.Namespace) -> InspectJudge | None:
    # A scripted run makes no paid call unless a judge is named explicitly.
    if arguments.no_judge or (arguments.model == "mock" and arguments.judge_model == DEFAULT_JUDGE):
        return None
    return InspectJudge(arguments.judge_model, arguments.judge_temperature)


def _profiles(arguments: argparse.Namespace) -> tuple[Profile, ...]:
    chosen = tuple(arguments.grading.split(","))
    for profile in chosen:
        if profile not in PROFILES:
            sys.exit(f"unknown grading profile {profile!r}; choose from {PROFILES}")
    return chosen


def _write_report(out: Path, profile: str) -> None:
    report = reporting.build(out, profile)
    (out / "report.json").write_text(json.dumps(report, indent=2))
    text = reporting.markdown(report)
    (out / "report.md").write_text(text)
    print(text)


def cmd_run(arguments: argparse.Namespace) -> int:
    load_env(REPO / ".env")
    solvers = arguments.solvers.split(",")
    for solver in solvers:
        if solver not in SOLVERS:
            sys.exit(f"unknown solver {solver!r}; choose from {SOLVERS}")
    role_models: dict[str, str] = {}
    for item in arguments.role_model:
        role, sep, name = item.partition("=")
        if not sep or role not in ("analyst", "critic", "reconciler"):
            sys.exit(f"--role-model expects ROLE=MODEL (analyst, critic, reconciler); got {item!r}")
        role_models[role] = name
    out: Path = arguments.out
    out.mkdir(parents=True, exist_ok=True)
    budget_file = out / "budget.json"
    budget: dict[str, Any] = (
        json.loads(budget_file.read_text()) if budget_file.exists() else {"spent": 0, "runs": []}
    )
    budget["cap"] = arguments.total_token_cap
    judge = _judge(arguments)
    profiles = _profiles(arguments)
    stopped = False
    for capsule in _selected(arguments):
        units: list[list[str] | None] = (
            [[q.question_id] for q in capsule.questions] if arguments.unit == "question" else [None]
        )
        for question_ids in units:
            count = len(question_ids) if question_ids else len(capsule.questions)
            max_tokens, seconds = _budget(arguments, count)
            for solver in solvers:
                run_dir = out / capsule.key
                if question_ids:
                    run_dir = run_dir / question_ids[0]
                run_dir = run_dir / solver
                done = run_dir / "run.json"
                if done.exists() and not arguments.force:
                    if json.loads(done.read_text()).get("status") == "done":
                        print(f"skip {run_dir} (already done; --force reruns it)")
                        continue
                # A run starts only if the cap still covers the most it can spend.
                worst = backstop_tokens(max_tokens) + JUDGE_RESERVE_TOKENS
                if (
                    arguments.total_token_cap
                    and budget["spent"] + worst > arguments.total_token_cap
                ):
                    print(
                        f"STOP before {run_dir}: {budget['spent']:,} tokens spent, this run could "
                        f"use {worst:,}, cap {arguments.total_token_cap:,}"
                    )
                    stopped = True
                    break
                print(
                    f"run {run_dir}: {count} question(s), {max_tokens:,} tokens, {seconds} s",
                    flush=True,
                )
                try:
                    summary = run_capsule(
                        capsule,
                        hub_dir=arguments.data / "hub",
                        staged_root=arguments.data / "staged",
                        out_dir=run_dir,
                        solver=solver,
                        model=arguments.model,
                        answer_mode=arguments.answer_mode,
                        question_ids=question_ids,
                        time_limit_seconds=seconds,
                        max_tokens=max_tokens,
                        max_messages_per_role=arguments.max_messages_per_role,
                        role_models=role_models,
                        critic_hints=arguments.critic_hints,
                        seed=arguments.seed,
                        image=arguments.image,
                    )
                except Exception as error:
                    # Unknown spend: charge the most the run could have used, so the cap holds.
                    budget["spent"] += backstop_tokens(max_tokens)
                    budget["runs"].append(
                        {
                            "run": str(run_dir.relative_to(out)),
                            "status": "error",
                            "error": str(error)[:300],
                        }
                    )
                    budget_file.write_text(json.dumps(budget, indent=2))
                    print(f"  ERROR {type(error).__name__}: {str(error)[:300]}", flush=True)
                    continue
                judge_before = judge.tokens if judge else 0
                grade_run(
                    run_dir, capsule, judge, arguments.judge_model if judge else None, profiles
                )
                judge_tokens = (judge.tokens - judge_before) if judge else 0
                budget["spent"] += summary["total_tokens"] + judge_tokens
                budget["runs"].append(
                    {
                        "run": str(run_dir.relative_to(out)),
                        "solver_tokens": summary["total_tokens"],
                        "judge_tokens": judge_tokens,
                        "seconds": summary["seconds"],
                        "status": summary["status"],
                    }
                )
                budget_file.write_text(json.dumps(budget, indent=2))
                print(
                    f"  {summary['status']}: {summary['total_tokens']:,} tokens, {summary['seconds']} s; "
                    f"total spent {budget['spent']:,}",
                    flush=True,
                )
            if stopped:
                break
        if stopped:
            break
    _write_report(out, profiles[0])
    return 2 if stopped else 0


def cmd_grade(arguments: argparse.Namespace) -> int:
    load_env(REPO / ".env")
    by_key = {c.key: c for c in _capsules(arguments)}
    judge = (
        None
        if arguments.no_judge
        else InspectJudge(arguments.judge_model, arguments.judge_temperature)
    )
    profiles = _profiles(arguments)
    for run_file in sorted(arguments.out.rglob("run.json")):
        run = json.loads(run_file.read_text())
        if run.get("status") == "running":
            continue
        grade_run(
            run_file.parent,
            by_key[run["capsule"]],
            judge,
            arguments.judge_model if judge else None,
            profiles,
        )
    if judge:
        print(f"judge: {judge.calls} calls, {judge.tokens:,} tokens")
    _write_report(arguments.out, profiles[0])
    return 0


def cmd_report(arguments: argparse.Namespace) -> int:
    _write_report(arguments.out, arguments.grading.split(",")[0])
    return 0


def _grading_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--judge-model", default=DEFAULT_JUDGE, help="LLM judge (Inspect model id)")
    parser.add_argument("--judge-temperature", type=float, default=0.0)
    parser.add_argument(
        "--no-judge", action="store_true", help="code rules only; the rest is ungraded"
    )
    parser.add_argument(
        "--grading",
        default="per-mode",
        help=f"comma-separated grading profiles from {PROFILES}; the first one is reported",
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--data", type=Path, default=DATA, help="dataset folder (gitignored)")
    commands = parser.add_subparsers(dest="command", required=True)

    sub = commands.add_parser("download", help="fetch the question file and capsule zips")
    sub.add_argument("--capsules", help="only these capsules (comma-separated short ids)")
    sub.set_defaults(run=cmd_download)

    sub = commands.add_parser("list", help="capsules with question counts and eval modes")
    sub.set_defaults(run=cmd_list)

    sub = commands.add_parser("audit", help="what staging keeps and drops; prompt checks")
    sub.set_defaults(run=cmd_audit)

    sub = commands.add_parser("run", help="run solvers on capsules, grade, report")
    sub.add_argument("--capsules", help="comma-separated short ids, capsule keys or uuids")
    sub.add_argument("--all", action="store_true", help="every capsule of the question file")
    sub.add_argument("--solvers", default="single,glhf")
    sub.add_argument("--model", default="mock", help="'mock' or an Inspect provider/model id")
    sub.add_argument("--role-model", action="append", default=[], metavar="ROLE=MODEL")
    sub.add_argument("--out", type=Path, required=True, help="directory for this set of runs")
    sub.add_argument("--answer-mode", choices=ANSWER_MODES, default="open")
    sub.add_argument(
        "--unit",
        choices=("capsule", "question"),
        default="capsule",
        help="one run per capsule with all its questions (default) or one run per question",
    )
    sub.add_argument("--max-tokens", type=int, help="token budget of each run, both solvers")
    sub.add_argument("--tokens-base", type=int, default=200_000)
    sub.add_argument("--tokens-per-question", type=int, default=100_000)
    sub.add_argument("--time-limit", type=int, help="seconds for each run, both solvers")
    sub.add_argument("--seconds-base", type=int, default=600)
    sub.add_argument("--seconds-per-question", type=int, default=420)
    sub.add_argument("--max-messages-per-role", type=int)
    sub.add_argument(
        "--critic-hints",
        choices=CRITIC_HINTS,
        default="route",
        help="swarm: show the critic the analyst's one-line route (default) or nothing",
    )
    sub.add_argument("--total-token-cap", type=int, help="stop before a run that could exceed it")
    sub.add_argument("--seed", type=int, default=0, help="option shuffling; sent to the provider")
    sub.add_argument("--image", help="sandbox image (default: the official BixBench image)")
    sub.add_argument("--force", action="store_true", help="rerun runs that are already done")
    _grading_options(sub)
    sub.set_defaults(run=cmd_run)

    sub = commands.add_parser("grade", help="grade finished runs again")
    sub.add_argument("--out", type=Path, required=True)
    _grading_options(sub)
    sub.set_defaults(run=cmd_grade)

    sub = commands.add_parser("report", help="rebuild report.md and report.json")
    sub.add_argument("--out", type=Path, required=True)
    sub.add_argument("--grading", default="per-mode")
    sub.set_defaults(run=cmd_report)

    arguments = parser.parse_args()
    return int(arguments.run(arguments))


if __name__ == "__main__":
    raise SystemExit(main())
