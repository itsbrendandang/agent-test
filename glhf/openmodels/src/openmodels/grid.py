"""The grid runner: models x solvers x capsules, through the existing `bixbench-v1 run`.

For a model served on Modal one serving session wraps all its runs:

    guard (paid switch, then the cap) -> record the session as open -> deploy -> wait until the
    server answers -> key check -> tool-call check -> `bixbench-v1 run` (one child process; it
    skips runs that are done, so the grid resumes) -> ALWAYS: `modal app stop`, check that Modal
    no longer lists the app, write the ledger line.

The stop is in a `finally`, and SIGTERM is turned into an exception, so an error, Ctrl+C or a
kill signal still stops the app. If this process is killed outright the session stays recorded
as open and the next start stops the app and charges the time first.

A vendor model (`kind: api`) has no session: its runs are the same child process with the
owner's keys. Same capsules, budgets, time limit, seed and grading options for every model."""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from bixbench_v1 import paid

from . import checks, ledger, serve
from .registry import SERVICE, Model, Prices, Registry

ADAPTER = Path(__file__).resolve().parents[3] / "bixbench_v1"
SOLVER_NAMES = {"single": "single", "swarm": "glhf", "glhf": "glhf"}
SANDBOXES = ("docker", "modal")
BACKSTOP_SECONDS = 300  # bixbench_v1.task.TIME_BACKSTOP_SECONDS


@dataclass(frozen=True)
class Plan:
    """The settings every cell of the grid shares."""

    name: str
    capsules: tuple[str, ...]
    question_counts: Mapping[str, int] = field(default_factory=dict)
    solvers: tuple[str, ...] = ("single", "glhf")
    tokens_base: int = 160_000
    tokens_per_question: int = 80_000
    time_limit_seconds: int = 1800
    seed: int = 0
    sandbox: str = "docker"
    judge: bool = False  # False: --no-judge, code rules only; nothing is sent to a judge model
    total_token_cap: int | None = (
        None  # per model: the adapter stops before a run that could pass it
    )
    runs_root: Path = ledger.RUNS

    def out_dir(self, model: Model) -> Path:
        return self.runs_root / f"{self.name}-{model.name}"


@dataclass
class Deps:
    """Everything that touches the outside, so tests can replace each piece."""

    shell: serve.Shell = serve.shell
    http: serve.Http = serve.http
    harness: Callable[[Sequence[str], Mapping[str, str]], int] | None = None
    clock: Callable[[], float] = time.time
    sleep: Callable[[float], None] = time.sleep
    load_key: Callable[[], str] = serve.load_key
    guard: ledger.Guard = field(default_factory=ledger.Guard)
    cumulative: Path = ledger.CUMULATIVE
    open_sessions: Path = ledger.OPEN_SESSIONS
    say: Callable[[str], None] = lambda text: print(text, flush=True)


class GridError(RuntimeError):
    pass


def harness_command(plan: Plan, model: Model) -> list[str]:
    """The `bixbench-v1 run` command of one model. Identical for every model but for --model and
    --out. With the Modal sandbox the adapter needs its `modal` dependency group."""
    if plan.sandbox not in SANDBOXES:
        raise GridError(f"unknown sandbox {plan.sandbox!r}; choose from {SANDBOXES}")
    if plan.sandbox == "modal":
        head = ["uv", "run", "--project", str(ADAPTER), "--group", "modal", "bixbench-v1"]
    else:
        head = [sys.executable, "-m", "bixbench_v1.cli"]
    command = [
        *head,
        "run",
        "--capsules", ",".join(plan.capsules),
        "--solvers", ",".join(plan.solvers),
        "--model", str(model.inspect_model),
        "--tokens-base", str(plan.tokens_base),
        "--tokens-per-question", str(plan.tokens_per_question),
        "--time-limit", str(plan.time_limit_seconds),
        "--seed", str(plan.seed),
        "--out", str(plan.out_dir(model)),
    ]  # fmt: skip
    # A model on our endpoint runs with every vendor key blank, so no judge can be called in the
    # same process: it is graded by code rules, and a judge pass is a separate `bixbench-v1 grade`.
    if not plan.judge or model.on_modal:
        command.append("--no-judge")
    if plan.total_token_cap:
        command += ["--total-token-cap", str(plan.total_token_cap)]
    if plan.sandbox != "docker":
        command += ["--sandbox", plan.sandbox]
    return command


def child_env(
    model: Model, base: Mapping[str, str], url: str | None, key: str | None
) -> dict[str, str]:
    """The environment of the harness process. For a model on our endpoint: the endpoint's address
    and key, paid calls allowed for this one child, and every vendor key blank, so the only
    place it can spend is the endpoint. For a vendor model nothing is added: the owner's own
    NO_PAID_CALLS and keys decide."""
    env = dict(base)
    if model.on_modal:
        env[paid.SWITCH] = "0"
        env[f"{SERVICE.upper()}_BASE_URL"] = f"{url}/v1"
        env[f"{SERVICE.upper()}_API_KEY"] = str(key)
        for name in paid.PAID_KEYS:
            env[name] = ""
    elif model.base_url_env and model.base_url and not env.get(model.base_url_env):
        # A hosted OpenAI-compatible service: its public address. The key is the owner's.
        env[model.base_url_env] = model.base_url
    return env


def pending(plan: Plan, model: Model) -> list[tuple[str, str]]:
    """The (capsule, solver) runs of this model that are not finished. A run is finished when its
    run.json says status "done" (the rule `bixbench-v1 run` itself uses to skip)."""
    todo: list[tuple[str, str]] = []
    for capsule in plan.capsules:
        for solver in plan.solvers:
            run_file = plan.out_dir(model) / capsule / solver / "run.json"
            try:
                done = json.loads(run_file.read_text(encoding="utf-8")).get("status") == "done"
            except (OSError, json.JSONDecodeError):
                done = False
            if not done:
                todo.append((capsule, solver))
    return todo


def worst_case_usd(model: Model, prices: Prices, runs: int, plan: Plan) -> float:
    seconds = ledger.worst_case_seconds(
        model,
        runs=runs,
        time_limit_seconds=plan.time_limit_seconds,
        backstop_seconds=BACKSTOP_SECONDS,
    )
    rate = prices.per_second(str(model.gpu), model.gpu_count, model.cpu, model.memory_gib)
    return ledger.dollars(seconds, rate)


def recover_open_sessions(registry: Registry, deps: Deps) -> list[str]:
    """Sessions an earlier process opened and never closed: stop each app, charge the time from
    its start until now (an upper bound), and close it. Returns the apps handled."""
    handled: list[str] = []
    for app_name, record in ledger.open_sessions(deps.open_sessions).items():
        model = next((m for m in registry.models if m.app_name == app_name), None)
        stopped = serve.stop(app_name, deps.shell, sleep=deps.sleep)
        if model is not None:
            seconds = max(0.0, deps.clock() - float(record.get("started", deps.clock())))
            line = ledger.entry(
                model,
                registry.prices,
                seconds=seconds,
                seconds_source="wall-clock, session start -> found open by a later start (upper bound)",
                run=record.get("run"),
                note="the process that opened this session ended without closing it",
            )
            ledger.append(line, deps.cumulative)
        if not stopped:
            raise GridError(
                f"{app_name} is still listed by Modal; stop it by hand: modal app stop -y {app_name}"
            )
        ledger.close_session(app_name, deps.open_sessions)
        handled.append(app_name)
    return handled


def _run_harness(command: Sequence[str], env: Mapping[str, str]) -> int:
    return subprocess.run(list(command), env=dict(env), cwd=ADAPTER, check=False).returncode


def serve_and_run(
    model: Model,
    registry: Registry,
    plan: Plan,
    deps: Deps,
    work: Callable[[str, str], Any],
    *,
    runs: int,
    what: str,
) -> dict[str, Any]:
    """One serving session: guards, deploy, checks, `work(url, key)`, and always the stop and the
    ledger line. Returns a summary with the checks, the seconds and the dollars."""
    paid.refuse_modal(f"{what}: serve {model.name} on {model.gpu}")  # NO_PAID_CALLS
    if model.gated:
        raise GridError(f"{model.name} is gated on Hugging Face; it waits for the owner")
    recover_open_sessions(registry, deps)
    worst = worst_case_usd(model, registry.prices, runs, plan)
    spent = deps.guard.check(worst, f"{what}: {model.name}")
    deps.say(
        f"{model.name}: ledger so far {spent:.2f} USD; worst case of this session {worst:.2f} USD"
    )
    key = deps.load_key()
    app = str(model.app_name)
    run_rel = plan.out_dir(model).name
    started = deps.clock()
    ledger.open_session(
        app, {"started": started, "model": model.name, "run": run_rel}, deps.open_sessions
    )
    summary: dict[str, Any] = {"model": model.name, "app": app, "ok": False}
    error: BaseException | None = None
    try:
        url = serve.deploy(model, deps.shell)
        summary["url"] = url
        summary["cold_start_seconds"] = round(
            serve.wake(
                url, key, timeout_seconds=model.startup_timeout_seconds + 120,
                request=deps.http, sleep=deps.sleep,
            ),
            1,
        )  # fmt: skip
        summary["key_check"] = checks.key_check(url, key, deps.http)
        if not summary["key_check"]["ok"]:
            raise GridError(f"{model.name}: the endpoint answered without the key, or refused ours")
        summary["tool_check"] = checks.tool_check(url, key, str(model.hf_repo), deps.http)
        if not summary["tool_check"]["ok"]:
            raise GridError(
                f"{model.name}: tool calls do not work: {summary['tool_check'].get('problem')}"
            )
        summary["work"] = work(url, key)
        summary["ok"] = True
    except BaseException as caught:  # also KeyboardInterrupt and SystemExit: stop, then re-raise
        error = caught
        summary["error"] = f"{type(caught).__name__}: {str(caught)[:300]}"
    finally:
        stopped = serve.stop(app, deps.shell, sleep=deps.sleep)
        seconds = deps.clock() - started
        line = ledger.entry(
            model,
            registry.prices,
            seconds=seconds,
            seconds_source="wall-clock, before deploy -> after `modal app stop` (upper bound on container time)",
            run=run_rel,
            note=f"{what}; {'ok' if summary['ok'] else summary.get('error', 'failed')}; "
            f"app {'stopped' if stopped else 'NOT CONFIRMED STOPPED'}",
        )
        plan.out_dir(model).mkdir(parents=True, exist_ok=True)
        ledger.append(line, deps.cumulative, plan.out_dir(model) / "modal_ledger.jsonl")
        summary.update(seconds=line["seconds"], usd=line["usd"], stopped=stopped)
        if stopped:
            ledger.close_session(app, deps.open_sessions)
        deps.say(
            f"{model.name}: session {line['seconds']:.0f} s, about {line['usd']:.2f} USD; "
            + (
                "app stopped"
                if stopped
                else f"APP NOT CONFIRMED STOPPED: run `modal app stop -y {app}`"
            )
        )
    if error is not None and not isinstance(error, Exception):
        raise error  # Ctrl+C or a signal: the caller must stop too
    if not summary["stopped"]:
        raise GridError(f"{app} is still listed by Modal after the stop")
    return summary


def run_model(model: Model, registry: Registry, plan: Plan, deps: Deps) -> dict[str, Any]:
    """All pending runs of one model. Nothing is deployed when nothing is pending."""
    todo = pending(plan, model)
    if not todo:
        deps.say(
            f"{model.name}: all {len(plan.capsules) * len(plan.solvers)} runs are done; skipped"
        )
        return {"model": model.name, "ok": True, "skipped": True}
    harness = deps.harness or _run_harness
    command = harness_command(plan, model)
    deps.say(f"{model.name}: {len(todo)} run(s) to do -> {plan.out_dir(model)}")
    if not model.on_modal:
        if model.kind != "api":
            raise GridError(
                f"{model.name} is not deployed (status {model.status}); see models.yaml"
            )
        code = harness(command, child_env(model, os.environ, None, None))
        return {"model": model.name, "ok": code == 0, "harness_exit": code}

    def work(url: str, key: str) -> dict[str, Any]:
        code = harness(command, child_env(model, os.environ, url, key))
        if code not in (0, 2):  # 2: the adapter stopped at its token cap; runs so far are kept
            raise GridError(f"`bixbench-v1 run` ended with exit status {code}")
        return {"harness_exit": code, "left": len(pending(plan, model))}

    return serve_and_run(
        model, registry, plan, deps, work, runs=len(todo), what=f"grid {plan.name}"
    )


def run_grid(
    names: Sequence[str], registry: Registry, plan: Plan, deps: Deps
) -> list[dict[str, Any]]:
    """One model after another; a model's app is stopped before the next is served. An error in
    one model is recorded and the grid goes on to the next (its app is already stopped)."""
    for solver in plan.solvers:
        if solver not in ("single", "glhf"):
            raise GridError(f"unknown solver {solver!r}")
    models = [registry.get(name) for name in names]

    def on_signal(number: int, _frame: Any) -> None:
        raise SystemExit(f"signal {number}")

    previous = signal.signal(signal.SIGTERM, on_signal)
    results: list[dict[str, Any]] = []
    try:
        for model in models:
            try:
                results.append(run_model(model, registry, plan, deps))
            except (GridError, serve.ServeError, ledger.CapExceeded, paid.PaidCallsOff) as error:
                deps.say(f"{model.name}: {error}")
                results.append({"model": model.name, "ok": False, "error": str(error)})
                if isinstance(error, ledger.CapExceeded | paid.PaidCallsOff):
                    break  # the same refusal would meet every later model
    finally:
        signal.signal(signal.SIGTERM, previous)
    return results
