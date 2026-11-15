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
import os
import signal
import sys
from pathlib import Path
from typing import Any

from . import modal_cost, paid, roles, staging
from . import report as reporting
from .dataset import (
    ANSWER_MODES,
    QUESTION_FILE,
    Capsule,
    download,
    find_capsules,
    group_capsules,
    load_questions,
    new_shuffle_salt,
    public_view,
)
from .grading import PROFILE_JUDGES, PROFILES, InspectJudge, Profile
from .runner import SANDBOXES, check_prompt, grade_run, load_env, run_capsule
from .solvers import CRITIC_HINTS, SWARM_BUDGETS, swarm_budget_mode
from .task import SOLVERS, backstop_tokens

REPO = Path(__file__).resolve().parents[4]
DATA = REPO / "glhf" / "data" / "bixbench_v1"
# The default profile's judge. Each profile has its own default: see grading.PROFILE_JUDGES.
DEFAULT_JUDGE = PROFILE_JUDGES["per-mode"].model
JUDGE_RESERVE_TOKENS = 20_000  # per run, when checking a total token cap
# Every Modal line of every run folder, shared with glhf/openmodels (gitignored).
MODAL_LEDGER = REPO / "glhf" / "bixbench_v1" / "runs" / modal_cost.LEDGER_NAME


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
            for mode in ANSWER_MODES:
                view = public_view(capsule.questions, mode, salt=new_shuffle_salt())[0]
                check_prompt(roles.brief(view), capsule, mode)
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
        # A data-folder file whose type is not on the allow-list is withheld, and said out
        # loud: it is either a new data type to add to staging.DATA_SUFFIXES or a write-up.
        for item in manifest.not_listed:
            print(f"    REVIEW withheld from /data: {item['member']} ({item['reason']})")
            problems += 1
    print(f"{problems} problem(s)")
    return 1 if problems else 0


def _temperature(text: str) -> float | None:
    """--judge-temperature: a number, or "default" for the provider's default."""
    return None if text.lower() in ("default", "provider") else float(text)


def _judges(
    arguments: argparse.Namespace, profiles: tuple[Profile, ...]
) -> dict[str, InspectJudge | None]:
    """The judge of each grading profile: that profile's default model and temperature
    (grading.PROFILE_JUDGES) unless --judge-model / --judge-temperature say otherwise. Every
    judge model passes the NO_PAID_CALLS guard before any is built."""
    # A scripted run makes no paid call unless a judge is named explicitly.
    scripted = getattr(arguments, "model", None) == "mock" and arguments.judge_model is None
    if arguments.no_judge or scripted:
        return dict.fromkeys(profiles)
    chosen: dict[str, tuple[str, float | None]] = {}
    for profile in profiles:
        default = PROFILE_JUDGES[profile]
        temperature = (
            default.temperature
            if arguments.judge_temperature is None
            else _temperature(arguments.judge_temperature)
        )
        chosen[profile] = (arguments.judge_model or default.model, temperature)
    for model, _ in chosen.values():
        paid.refuse_judge(model)  # NO_PAID_CALLS
    built: dict[tuple[str, float | None], InspectJudge] = {}
    for spec in chosen.values():
        if spec not in built:
            built[spec] = InspectJudge(*spec)
    return {profile: built[spec] for profile, spec in chosen.items()}


def _judge_tokens(judges: dict[str, InspectJudge | None]) -> int:
    return sum(j.tokens for j in {id(j): j for j in judges.values() if j is not None}.values())


def _profiles(arguments: argparse.Namespace) -> tuple[Profile, ...]:
    chosen = tuple(arguments.grading.split(","))
    for profile in chosen:
        if profile not in PROFILES:
            sys.exit(f"unknown grading profile {profile!r}; choose from {PROFILES}")
    return chosen


def _write_report(out: Path, profile: str, model: str | None = None) -> None:
    try:
        report = reporting.build(out, profile, model=model)
    except reporting.ReportError as error:
        print(f"no report written: {error}")
        return
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
    paid.refuse_models(arguments.model, *role_models.values())  # NO_PAID_CALLS
    # Only our own endpoint and no judge: blank the vendor keys, so nothing else can be reached.
    paid.isolate_endpoint([arguments.model, *role_models.values()], judge=not arguments.no_judge)
    if arguments.sandbox == "modal":  # NO_PAID_CALLS: a Modal sandbox is billed by the second
        paid.refuse_modal("--sandbox modal: the analysis sandbox would run on Modal")
        # A plain `kill` (SIGTERM) is handled like Ctrl+C, so the sandboxes are terminated.
        signal.signal(signal.SIGTERM, lambda *_: os.kill(os.getpid(), signal.SIGINT))
    out: Path = arguments.out
    out.mkdir(parents=True, exist_ok=True)
    budget_file = out / "budget.json"
    budget: dict[str, Any] = (
        json.loads(budget_file.read_text()) if budget_file.exists() else {"spent": 0, "runs": []}
    )
    budget["cap"] = arguments.total_token_cap
    profiles = _profiles(arguments)
    judges = _judges(arguments, profiles)
    swarm_budget = swarm_budget_mode(arguments.swarm_budget)  # the option, else the variable
    stopped = False
    for capsule in _selected(arguments):
        units: list[list[str] | None] = (
            [[q.question_id] for q in capsule.questions] if arguments.unit == "question" else [None]
        )
        for question_ids in units:
            count = len(question_ids) if question_ids else len(capsule.questions)
            max_tokens, seconds = _budget(arguments, count)
            for solver, repeat in [(s, r) for r in range(arguments.repeats) for s in solvers]:
                run_dir = out / capsule.key
                if question_ids:
                    run_dir = run_dir / question_ids[0]
                run_dir = run_dir / (solver if repeat == 0 else f"{solver}-r{repeat}")
                done = run_dir / "run.json"
                if done.exists() and not arguments.force:
                    if json.loads(done.read_text()).get("status") == "done":
                        print(f"skip {run_dir} (already done; --force reruns it)")
                        continue
                # A run starts only if the cap still covers the most it can spend.
                worst = backstop_tokens(max_tokens, swarm_budget=swarm_budget)
                worst += JUDGE_RESERVE_TOKENS
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
                        seed=arguments.seed + repeat,
                        image=arguments.image,
                        swarm_budget=swarm_budget,
                        repeat=repeat,
                        sandbox=arguments.sandbox,
                        modal_cpu=arguments.modal_cpu,
                        modal_memory_mib=int(arguments.modal_memory_gib * 1024),
                        modal_ledgers=[out / modal_cost.LEDGER_NAME, MODAL_LEDGER],
                        modal_usd_cap=arguments.modal_usd_cap,
                    )
                except Exception as error:
                    # Unknown spend: charge the most the run could have used, so the cap holds.
                    budget["spent"] += backstop_tokens(max_tokens, swarm_budget=swarm_budget)
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
                judge_before = _judge_tokens(judges)
                grade_run(run_dir, capsule, judges, None, profiles)
                judge_tokens = _judge_tokens(judges) - judge_before
                budget["spent"] += summary["total_tokens"] + judge_tokens
                budget["runs"].append(
                    {
                        "run": str(run_dir.relative_to(out)),
                        "solver_tokens": summary["total_tokens"],
                        "judge_tokens": judge_tokens,
                        "seconds": summary["seconds"],
                        "status": summary["status"],
                        **_sandbox_cost(summary),
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
    if arguments.sandbox == "modal":
        _print_modal_costs(out)
    return 2 if stopped else 0


def _sandbox_cost(summary: dict[str, Any]) -> dict[str, Any]:
    """Modal sandbox seconds and dollars of one run, for budget.json (nothing for Docker)."""
    modal = summary.get("settings", {}).get("modal")
    if not modal:
        return {}
    return {
        "sandbox": "modal",
        "sandboxes": modal.get("sandboxes"),
        "sandbox_seconds": modal.get("sandbox_seconds"),
        "sandbox_usd": modal.get("sandbox_usd"),
    }


def _print_modal_costs(out: Path) -> None:
    """Per-capsule Modal sandbox cost of this --out folder, from its ledger."""
    rows = modal_cost.read(out / modal_cost.LEDGER_NAME)
    per = modal_cost.per_capsule(rows)
    if not per:
        return
    print(f"Modal sandboxes ({modal_cost.PRICES_READ}; our estimate from wall-clock seconds):")
    for capsule, cell in sorted(per.items()):
        print(
            f"  {capsule:22} {int(cell['sandboxes'])} sandbox(es) "
            f"{cell['seconds']:8.1f} s  {cell['usd']:.4f} USD"
        )
    print(f"  total {modal_cost.spent(rows):.4f} USD in {out / modal_cost.LEDGER_NAME}")


def cmd_grade(arguments: argparse.Namespace) -> int:
    load_env(REPO / ".env")
    profiles = _profiles(arguments)
    judges = _judges(arguments, profiles)  # NO_PAID_CALLS is checked in there, before anything
    by_key = {c.key: c for c in _capsules(arguments)}
    for run_file in sorted(arguments.out.rglob("run.json")):
        run = json.loads(run_file.read_text())
        if run.get("status") == "running":
            continue
        grade_run(run_file.parent, by_key[run["capsule"]], judges, None, profiles)
    for judge in {id(j): j for j in judges.values() if j is not None}.values():
        print(f"judge {judge.model}: {judge.calls} calls, {judge.tokens:,} tokens")
    _write_report(arguments.out, profiles[0])
    return 0


def cmd_report(arguments: argparse.Namespace) -> int:
    _write_report(arguments.out, arguments.grading.split(",")[0], arguments.model)
    return 0


def cmd_modal_sandboxes(arguments: argparse.Namespace) -> int:
    """List the Modal sandboxes of this adapter that are still running; with --terminate, end
    them. A run ends its own sandboxes; this is for a process that was killed outright, whose
    sandboxes would otherwise live until their timeout."""
    paid.refuse_modal("listing or terminating Modal sandboxes")  # NO_PAID_CALLS
    from . import modal_image, modal_sandbox

    if arguments.terminate:
        ended = modal_sandbox.terminate_all(modal_image.APP_NAME)
        print(f"terminated {len(ended)} sandbox(es): {' '.join(ended) or 'none were running'}")
    alive = modal_sandbox.live_sandboxes(modal_image.APP_NAME)
    print(f"{len(alive)} sandbox(es) running in app {modal_image.APP_NAME}: {' '.join(alive)}")
    return 1 if alive else 0


def _grading_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--judge-model",
        help="LLM judge (Inspect model id) for every profile. Default: each profile's own "
        + ", ".join(f"{name}: {spec.model}" for name, spec in PROFILE_JUDGES.items()),
    )
    parser.add_argument(
        "--judge-temperature",
        help="a number, or \"default\" for the provider's default. Default: each profile's own "
        "(per-mode 0, official 1, paper the provider's default); grade.json records it and the "
        "report flags a deviation",
    )
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
    sub.add_argument(
        "--swarm-budget",
        choices=SWARM_BUDGETS,
        help="swarm tokens: 'equal' to the single agent's budget, or 'extended' (the analyst "
        "gets all of it and the total is 2.25 times that). Default: $BIXBENCH_V1_SWARM_BUDGET, "
        "else equal",
    )
    sub.add_argument(
        "--repeats", type=int, default=1, help="runs of each unit per solver (seed + repeat)"
    )
    sub.add_argument("--total-token-cap", type=int, help="stop before a run that could exceed it")
    sub.add_argument("--seed", type=int, default=0, help="option shuffling; sent to the provider")
    sub.add_argument("--image", help="sandbox image (default: the official BixBench image)")
    sub.add_argument(
        "--sandbox",
        choices=SANDBOXES,
        default="docker",
        help="where the analysis runs: local 'docker' (default, the official arm64 image) or "
        "'modal' (a Modal Sandbox from our amd64 rebuild; billed; refused while NO_PAID_CALLS "
        "is on; needs `uv run --group modal`; results are not comparable with a Docker run)",
    )
    sub.add_argument("--modal-cpu", type=float, default=4.0, help="cores per Modal sandbox")
    sub.add_argument("--modal-memory-gib", type=float, default=16.0, help="GiB per Modal sandbox")
    sub.add_argument(
        "--modal-usd-cap",
        type=float,
        default=modal_cost.DEFAULT_CAP_USD,
        help="stop before a run whose worst case would take this --out folder's Modal sandbox "
        f"spend past this many dollars (default {modal_cost.DEFAULT_CAP_USD})",
    )
    sub.add_argument("--force", action="store_true", help="rerun runs that are already done")
    _grading_options(sub)
    sub.set_defaults(run=cmd_run)

    sub = commands.add_parser(
        "modal-sandboxes", help="list (and with --terminate, end) running Modal sandboxes"
    )
    sub.add_argument("--terminate", action="store_true")
    sub.set_defaults(run=cmd_modal_sandboxes)

    sub = commands.add_parser("grade", help="grade finished runs again")
    sub.add_argument("--out", type=Path, required=True)
    _grading_options(sub)
    sub.set_defaults(run=cmd_grade)

    sub = commands.add_parser("report", help="rebuild report.md and report.json")
    sub.add_argument("--out", type=Path, required=True)
    sub.add_argument("--grading", default="per-mode")
    sub.add_argument("--model", help="report this model only (several are never pooled)")
    sub.set_defaults(run=cmd_report)

    arguments = parser.parse_args()
    paid.enforce()  # NO_PAID_CALLS: blank the provider keys before .env is loaded
    try:
        return int(arguments.run(arguments))
    except paid.PaidCallsOff as error:
        sys.exit(f"bixbench-v1: {error}")


if __name__ == "__main__":
    raise SystemExit(main())
