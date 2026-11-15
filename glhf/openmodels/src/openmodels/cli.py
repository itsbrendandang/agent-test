"""Command line of the open-model grid.

    uv run openmodels models                      # the registry, checked
    uv run openmodels draw                        # print the capsule draw (does not overwrite)
    uv run openmodels ledger                      # what Modal has cost so far, by this ledger
    uv run openmodels estimate                    # vendor cells from the pilot's tokens
    uv run openmodels status                      # our Modal apps that are not stopped
    uv run openmodels stop                        # stop every one of them (always allowed)

Need NO_PAID_CALLS=0 (they use Modal; only the person who pays sets it):

    uv run openmodels key                         # make the endpoint key once
    uv run openmodels weights --model NAME        # download the weights to the Volume (CPU)
    uv run openmodels check --model NAME          # deploy, key check, tool-call check, speed, stop
    uv run openmodels grid --name grid1 --models a,b --solvers single,swarm --capsules capsules.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

from bixbench_v1 import paid

from . import capsules, checks, estimate, grid, ledger, registry, serve

PILOT = ledger.RUNS / "pilot-sonnet-5-5"


def cmd_models(arguments: argparse.Namespace) -> int:
    loaded = registry.load()
    for m in loaded.models:
        where = f"{m.gpu} x{m.gpu_count} {m.price_per_second:.6f} USD/s" if m.on_modal else m.kind
        print(f"{m.name:22} {m.status:13} {where:32} {m.inspect_model or m.hf_repo}")
    return 0


def cmd_draw(arguments: argparse.Namespace) -> int:
    from bixbench_v1.cli import DATA
    from bixbench_v1.dataset import QUESTION_FILE, group_capsules, load_questions

    counts = {
        c.key: len(c.questions)
        for c in group_capsules(load_questions(DATA / "hub" / QUESTION_FILE))
    }
    made = capsules.record(counts, capsules.pilot_capsules(PILOT))
    if arguments.write:
        if capsules.LIST_FILE.exists():
            sys.exit(f"{capsules.LIST_FILE} exists; the draw is made once and is not redone")
        capsules.LIST_FILE.write_text(json.dumps(made, indent=2) + "\n")
    print(
        json.dumps(
            {k: made[k] for k in ("seed", "count", "excluded", "capsules", "questions")}, indent=2
        )
    )
    return 0


def cmd_ledger(arguments: argparse.Namespace) -> int:
    for line in ledger.read():
        who = line.get("who", line.get("job"))
        print(
            f"{line.get('ts', line.get('at'))}  {who:13} {line.get('kind', line.get('source')):12} "
            f"{float(line.get('seconds') or 0):8.0f} s  {float(line.get('usd') or 0):7.2f} USD  "
            f"{line.get('run') or '-'}  {str(line.get('note') or line.get('what') or '')[:70]}"
        )
    mine = ledger.total()
    print(
        f"total, {ledger.WHO}: {mine:.2f} USD of a {ledger.CAP_USD:.2f} USD cap; all writers: {ledger.total(who=None):.2f} USD"
    )
    if ledger.open_sessions():
        print(f"OPEN SESSIONS (not closed): {sorted(ledger.open_sessions())}")
    return 0


def cmd_status(arguments: argparse.Namespace) -> int:
    live = serve.live()
    print("live apps of ours: " + (", ".join(live) if live else "none"))
    return 1 if live else 0


def cmd_stop(arguments: argparse.Namespace) -> int:
    loaded = registry.load()
    names = set(serve.live()) | set(ledger.open_sessions())
    left = [name for name in sorted(names) if not serve.stop(name)]
    if names:
        grid.recover_open_sessions(loaded, grid.Deps())
    print(f"stopped: {sorted(names) or 'nothing was live'}; still live: {left or 'none'}")
    return 1 if left else 0


def cmd_key(arguments: argparse.Namespace) -> int:
    print(f"proxy token {serve.create_key()} saved to {serve.KEY_FILE} (mode 600)")
    return 0


def cmd_weights(arguments: argparse.Namespace) -> int:
    loaded = registry.load()
    model = loaded.get(arguments.model)
    paid.refuse_modal(f"download the weights of {model.name}")  # NO_PAID_CALLS
    ledger.Guard(cap_usd=arguments.cap).check(
        1.0, f"weights of {model.name}"
    )  # a CPU job: under 1 USD
    started = time.time()
    done = serve.shell(
        [
            "modal",
            "run",
            f"{registry.ROOT / 'apps' / 'weights.py'}::fetch",
            "--repo",
            str(model.hf_repo),
            "--revision",
            str(model.revision),
        ]
    )
    seconds = time.time() - started
    # The download function reserves 4 cores and 8 GiB (see the app file). The image build, the
    # first time, runs on Modal's builders inside the same wall-clock time.
    rate = (4 * loaded.prices.cpu_core_per_hour + 8 * loaded.prices.memory_gib_per_hour) / 3600
    ledger.append(
        {
            "ts": ledger.now(), "kind": "weights_download", "who": ledger.WHO, "run": None,
            "capsule": None, "solver": None,
            "resource": {"cpu": 4, "memory_gib": 8, "gpu": None},
            "seconds": round(seconds, 1),
            "seconds_source": "wall-clock of `modal run ...::download` (includes the image build; upper bound)",
            "usd": ledger.dollars(seconds, rate),
            "price": {"container_s": rate, "read_from": loaded.prices.read_from},
            "modal_ids": {"app": model.app_name},
            "note": f"weights of {model.hf_repo} to the Volume; exit {done.code}",
        },
        ledger.CUMULATIVE,
    )  # fmt: skip
    print(
        "\n".join(
            line
            for line in (done.out + done.err).splitlines()
            if line.startswith(("RESULT", "Error"))
        )[-1500:]
    )
    return done.code


def cmd_preflight(arguments: argparse.Namespace) -> int:
    """On CPU: does the vLLM in our image know every flag and parser the model's app passes?"""
    loaded = registry.load()
    model = loaded.get(arguments.model)
    paid.refuse_modal(f"check the vLLM flags of {model.name}")  # NO_PAID_CALLS
    source = (registry.ROOT / str(model.app_file)).read_text(encoding="utf-8")
    names = sorted(
        set(re.findall(r'"(--[a-z][a-z-]+)', source))
        | {str(model.tool_call_parser), str(model.reasoning_parser)}
    )
    ledger.Guard(cap_usd=arguments.cap).check(0.5, f"flag check of {model.name}")
    started = time.time()
    done = serve.shell(
        [
            "modal",
            "run",
            f"{registry.ROOT / 'apps' / 'weights.py'}::flags",
            f"--names={','.join(names)}",
        ]
    )
    rate = (2 * loaded.prices.cpu_core_per_hour + 8 * loaded.prices.memory_gib_per_hour) / 3600
    ledger.append(
        {
            "ts": ledger.now(), "kind": "flag_check", "who": ledger.WHO, "run": None, "capsule": None, "solver": None,
            "resource": {"cpu": 2, "memory_gib": 8, "gpu": None}, "seconds": round(time.time() - started, 1),
            "seconds_source": "wall-clock of `modal run` (upper bound)", "usd": ledger.dollars(time.time() - started, rate),
            "price": {"container_s": rate, "read_from": loaded.prices.read_from}, "modal_ids": {"app": "openmodels-weights"},
            "note": f"vLLM flag check for {model.name}; exit {done.code}",
        },
        ledger.CUMULATIVE,
    )  # fmt: skip
    result = next((line for line in done.out.splitlines() if line.startswith("RESULT ")), "")
    if not result:
        print((done.out + done.err)[-800:])
        return 1
    answer = json.loads(result.removeprefix("RESULT "))
    unknown = [name for name, ok in answer["known"].items() if not ok]
    print(
        f"{answer['vllm']}: {len(answer['known']) - len(unknown)} of {len(answer['known'])} names known; unknown: {unknown or 'none'}"
    )
    return 1 if unknown else 0


def cmd_authcheck(arguments: argparse.Namespace) -> int:
    """Deploy the CPU stand-in (apps/authcheck.py), test the lock on its endpoint, stop it."""
    loaded = registry.load()
    paid.refuse_modal("deploy the CPU stand-in for the key check")  # NO_PAID_CALLS
    ledger.Guard(cap_usd=arguments.cap).check(0.25, "authcheck")
    stub = registry.Model(
        name="authcheck",
        kind="modal-app",
        status="served",
        app_file="apps/authcheck.py",
        app_name="openmodels-authcheck",
    )
    key = serve.load_key()
    started = time.time()
    result: dict[str, Any] = {}
    try:
        url = serve.deploy(stub)
        result["cold_start_seconds"] = round(serve.wake(url, key, timeout_seconds=240), 1)
        result["key_check"] = checks.key_check(url, key)
    finally:
        result["stopped"] = serve.stop(str(stub.app_name))
        seconds = time.time() - started
        rate = (1 * loaded.prices.cpu_core_per_hour + 1 * loaded.prices.memory_gib_per_hour) / 3600
        ledger.append(
            {
                "ts": ledger.now(), "kind": "auth_check", "who": ledger.WHO, "run": None, "capsule": None, "solver": None,
                "resource": {"cpu": 1, "memory_gib": 1, "gpu": None}, "seconds": round(seconds, 1),
                "seconds_source": "wall-clock, before deploy -> after `modal app stop` (upper bound)",
                "usd": ledger.dollars(seconds, rate), "price": {"container_s": rate, "read_from": loaded.prices.read_from},
                "modal_ids": {"app": stub.app_name}, "note": f"CPU stand-in for the key check; stopped={result['stopped']}",
            },
            ledger.CUMULATIVE,
        )  # fmt: skip
    print(json.dumps(result, indent=2))
    return 0 if result.get("key_check", {}).get("ok") and result["stopped"] else 1


def _plan(arguments: argparse.Namespace, keys: list[str], counts: dict[str, int]) -> grid.Plan:
    return grid.Plan(
        name=arguments.name,
        capsules=tuple(keys),
        question_counts=counts,
        solvers=tuple(grid.SOLVER_NAMES[s] for s in arguments.solvers.split(",")),
        tokens_base=arguments.tokens_base,
        tokens_per_question=arguments.tokens_per_question,
        time_limit_seconds=arguments.time_limit,
        seed=arguments.seed,
        sandbox=arguments.sandbox,
        judge=arguments.judge,
        total_token_cap=arguments.total_token_cap,
    )


def cmd_check(arguments: argparse.Namespace) -> int:
    loaded = registry.load()
    model = loaded.get(arguments.model)
    plan = grid.Plan(name=arguments.name, capsules=(), time_limit_seconds=0)

    def work(url: str, key: str) -> dict[str, Any]:
        return {"speed": checks.speed(url, key, str(model.hf_repo))}

    deps = grid.Deps(guard=ledger.Guard(cap_usd=arguments.cap))
    summary = grid.serve_and_run(model, loaded, plan, deps, work, runs=0, what="check")
    summary.pop("url", None)
    (plan.out_dir(model) / "check.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))
    return 0 if summary["ok"] else 1


def cmd_grid(arguments: argparse.Namespace) -> int:
    loaded = registry.load()
    keys, counts = capsules.load(Path(arguments.capsules))
    if arguments.only:
        keys = arguments.only.split(",")  # full capsule keys, e.g. bix-46_d37acffb
    plan = _plan(arguments, keys, counts)
    deps = grid.Deps(guard=ledger.Guard(cap_usd=arguments.cap))
    results = grid.run_grid(arguments.models.split(","), loaded, plan, deps)
    for result in results:
        result.pop("url", None)
    summary_file = plan.runs_root / f"{plan.name}-grid.json"
    summary_file.write_text(
        json.dumps(
            {
                "plan": {
                    **plan.__dict__,
                    "runs_root": str(plan.runs_root),
                    "question_counts": dict(plan.question_counts),
                },
                "results": results,
            },
            indent=2,
            default=str,
        )
    )
    print(f"summary: {summary_file}")
    return 0 if all(r.get("ok") for r in results) else 1


def cmd_estimate(arguments: argparse.Namespace) -> int:
    loaded = registry.load()
    made = json.loads(capsules.LIST_FILE.read_text())
    questions = int(made["questions"])
    pilot = estimate.pilot_usage(PILOT)
    out: dict[str, Any] = {"questions": questions, "capsules": len(made["capsules"]), "cells": {}}
    for model in loaded.models:
        if model.kind != "api":
            continue
        for solver, usage in pilot.items():
            out["cells"][f"{model.name} / {solver}"] = estimate.api_cell(usage, questions, model)
    print(json.dumps(out, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    commands = parser.add_subparsers(dest="command", required=True)
    for name, run in (("models", cmd_models), ("ledger", cmd_ledger), ("status", cmd_status),
                      ("stop", cmd_stop), ("key", cmd_key), ("estimate", cmd_estimate)):  # fmt: skip
        commands.add_parser(name).set_defaults(run=run)
    sub = commands.add_parser("draw")
    sub.add_argument(
        "--write", action="store_true", help="write capsules.json (refused if it exists)"
    )
    sub.set_defaults(run=cmd_draw)
    sub = commands.add_parser("weights")
    sub.add_argument("--model", required=True)
    sub.add_argument("--cap", type=float, default=ledger.CAP_USD)
    sub.set_defaults(run=cmd_weights)
    sub = commands.add_parser("authcheck")
    sub.add_argument("--cap", type=float, default=ledger.CAP_USD)
    sub.set_defaults(run=cmd_authcheck)
    sub = commands.add_parser("preflight")
    sub.add_argument("--model", required=True)
    sub.add_argument("--cap", type=float, default=ledger.CAP_USD)
    sub.set_defaults(run=cmd_preflight)

    def shared(sub: argparse.ArgumentParser) -> None:
        sub.add_argument(
            "--name", required=True, help="prefix of the run folders: runs/<name>-<model>"
        )
        sub.add_argument(
            "--cap", type=float, default=ledger.CAP_USD, help="USD cap on this ledger's total"
        )

    sub = commands.add_parser("check")
    sub.add_argument("--model", required=True)
    shared(sub)
    sub.set_defaults(run=cmd_check)
    sub = commands.add_parser("grid")
    shared(sub)
    sub.add_argument("--models", required=True, help="comma-separated names from models.yaml")
    sub.add_argument("--solvers", default="single,swarm")
    sub.add_argument(
        "--capsules", default=str(capsules.LIST_FILE), help="capsules.json or a text file of keys"
    )
    sub.add_argument(
        "--only", help="run only these capsule keys (comma-separated), e.g. a smoke test"
    )
    sub.add_argument("--tokens-base", type=int, default=160_000)
    sub.add_argument("--tokens-per-question", type=int, default=80_000)
    sub.add_argument("--time-limit", type=int, default=1800)
    sub.add_argument("--seed", type=int, default=0)
    sub.add_argument("--sandbox", choices=grid.SANDBOXES, default="docker")
    sub.add_argument(
        "--total-token-cap", type=int, help="per model: stop before a run that could pass it"
    )
    sub.add_argument(
        "--judge", action="store_true", help="grade with the LLM judge too (a paid vendor call)"
    )
    sub.set_defaults(run=cmd_grid)

    arguments = parser.parse_args()
    try:
        return int(arguments.run(arguments))
    except (
        paid.PaidCallsOff,
        registry.RegistryError,
        serve.ServeError,
        ledger.CapExceeded,
        grid.GridError,
    ) as error:
        sys.exit(f"openmodels: {error}")


if __name__ == "__main__":
    raise SystemExit(main())
