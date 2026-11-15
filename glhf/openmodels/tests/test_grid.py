"""The grid runner with fakes: guard, order of events, resume, and the stop on every way out."""

from __future__ import annotations

import json
from typing import Any

import pytest
from bixbench_v1 import paid
from helpers import KEY, URL, FakeEndpoint, FakeModal

from openmodels import grid, ledger


def test_with_the_switch_on_nothing_is_deployed_or_requested(
    world: dict[str, Any], clean: list[str]
) -> None:
    results = grid.run_grid([world["model"].name], world["registry"], world["plan"], world["deps"])
    assert results[0]["ok"] is False and "NO_PAID_CALLS" in results[0]["error"]
    assert world["modal"].commands == [] and world["endpoint"].requests == [] and clean == []
    assert world["harness_calls"] == [] and not world["deps"].cumulative.exists()


def test_a_session_deploys_checks_runs_and_always_stops(
    world: dict[str, Any], allowed: None
) -> None:
    [result] = grid.run_grid([world["model"].name], world["registry"], world["plan"], world["deps"])
    assert (
        result["ok"]
        and result["stopped"]
        and result["key_check"]["ok"]
        and result["tool_check"]["ok"]
    )
    assert world["modal"].verbs() == ["deploy", "server info", "app stop", "app list"]
    assert world["modal"].live == set()
    # One harness process for the model, with only the endpoint reachable.
    [(command, env)] = world["harness_calls"]
    assert (
        env[paid.SWITCH] == "0"
        and env["OPENMODELS_BASE_URL"] == URL + "/v1"
        and env["OPENMODELS_API_KEY"] == KEY
    )
    assert all(env[name] == "" for name in paid.PAID_KEYS)
    assert (
        "--no-judge" in command
        and command[command.index("--model") + 1] == world["model"].inspect_model
    )
    # The ledger line: wall-clock seconds times the container's rate, in both files.
    [line] = ledger.read(world["deps"].cumulative)
    assert line["who"] == "modal-bench" and line["kind"] == "gpu_endpoint"
    assert line["seconds"] >= 600 and line["usd"] == pytest.approx(
        line["seconds"] * 0.0006653, abs=0.001
    )
    assert ledger.read(world["plan"].out_dir(world["model"]) / "modal_ledger.jsonl") == [line]
    assert ledger.open_sessions(world["deps"].open_sessions) == {}


def test_a_finished_grid_is_skipped_without_touching_modal(
    world: dict[str, Any], allowed: None
) -> None:
    grid.run_grid([world["model"].name], world["registry"], world["plan"], world["deps"])
    world["modal"].commands.clear()
    world["harness_calls"].clear()
    [again] = grid.run_grid([world["model"].name], world["registry"], world["plan"], world["deps"])
    assert again == {"model": world["model"].name, "ok": True, "skipped": True}
    assert world["modal"].commands == [] and world["harness_calls"] == []
    assert len(ledger.read(world["deps"].cumulative)) == 1


def test_resume_counts_only_unfinished_runs(world: dict[str, Any]) -> None:
    plan, model = world["plan"], world["model"]
    assert len(grid.pending(plan, model)) == 4
    done = plan.out_dir(model) / "bix-1_aaaa" / "single"
    done.mkdir(parents=True)
    (done / "run.json").write_text(json.dumps({"status": "done"}))
    failed = plan.out_dir(model) / "bix-1_aaaa" / "glhf"
    failed.mkdir(parents=True)
    (failed / "run.json").write_text(json.dumps({"status": "failed"}))
    assert grid.pending(plan, model) == [
        ("bix-1_aaaa", "glhf"),
        ("bix-2_bbbb", "single"),
        ("bix-2_bbbb", "glhf"),
    ]


@pytest.mark.parametrize(
    "failure",
    ["harness exit", "harness raises", "ctrl-c", "no tools", "open endpoint", "deploy fails"],
)
def test_the_app_is_stopped_on_every_way_out(
    world: dict[str, Any], allowed: None, failure: str
) -> None:
    deps = world["deps"]
    if failure == "harness exit":
        deps.harness = lambda command, env: 1
    elif failure == "harness raises":
        deps.harness = lambda command, env: (_ for _ in ()).throw(OSError("docker is not running"))
    elif failure == "ctrl-c":
        deps.harness = lambda command, env: (_ for _ in ()).throw(KeyboardInterrupt())
    elif failure == "no tools":
        deps.http = FakeEndpoint(tools=False)
    elif failure == "open endpoint":
        deps.http = FakeEndpoint(open_without_key=True)
    elif failure == "deploy fails":
        deps.shell = world["modal"] = FakeModal(deploy_code=1)
    if failure == "ctrl-c":
        with pytest.raises(KeyboardInterrupt):
            grid.run_grid([world["model"].name], world["registry"], world["plan"], deps)
    else:
        [result] = grid.run_grid([world["model"].name], world["registry"], world["plan"], deps)
        assert result["ok"] is False and result["stopped"] is True
    modal = world["modal"]
    assert [
        "modal",
        "app",
        "stop",
        "-y",
        world["model"].app_name,
    ] in modal.commands and modal.live == set()
    assert modal.verbs()[-2:] == [
        "app stop",
        "app list",
    ]  # the stop, then the check that it is gone
    [line] = ledger.read(deps.cumulative)  # the time is charged whatever happened
    assert line["usd"] >= 0 and "stopped" in line["note"]
    assert ledger.open_sessions(deps.open_sessions) == {}
    if failure in ("no tools", "open endpoint", "deploy fails"):
        assert world["harness_calls"] == []  # a model that fails a check never gets a benchmark run


def test_an_app_that_does_not_stop_is_reported_and_stays_open(
    world: dict[str, Any], allowed: None
) -> None:
    world["deps"].shell = modal = FakeModal(stop_works=False)
    [result] = grid.run_grid([world["model"].name], world["registry"], world["plan"], world["deps"])
    assert result["ok"] is False and "still listed" in result["error"] and modal.live
    assert any("NOT CONFIRMED STOPPED" in text for text in world["said"])
    assert list(ledger.open_sessions(world["deps"].open_sessions)) == [world["model"].app_name]


def test_a_session_left_open_is_stopped_and_charged_by_the_next_start(
    world: dict[str, Any], allowed: None
) -> None:
    deps, model = world["deps"], world["model"]
    world["modal"].live.add(model.app_name)
    ledger.open_session(
        model.app_name,
        {"started": world["clock"]() - 900, "model": model.name, "run": "t-x"},
        deps.open_sessions,
    )
    assert grid.recover_open_sessions(world["registry"], deps) == [model.app_name]
    [line] = ledger.read(deps.cumulative)
    assert line["seconds"] == 900 and line["usd"] == pytest.approx(900 * 0.0006653, abs=0.001)
    assert world["modal"].live == set() and ledger.open_sessions(deps.open_sessions) == {}


def test_the_cap_refuses_before_anything_is_deployed(world: dict[str, Any], allowed: None) -> None:
    deps = world["deps"]
    worst = grid.worst_case_usd(world["model"], world["registry"].prices, 4, world["plan"])
    ledger.append({"who": "modal-bench", "usd": 20.0 - worst + 0.01}, deps.cumulative)
    ledger.append({"who": "modal-sandbox", "usd": 500.0}, deps.cumulative)  # another job's spend
    [result] = grid.run_grid([world["model"].name], world["registry"], world["plan"], deps)
    assert result["ok"] is False and "cap 20.00" in result["error"]
    assert world["modal"].commands == [] and world["harness_calls"] == []
    # One cent less on the ledger and the same start is allowed.
    deps.cumulative.unlink()
    ledger.append({"who": "modal-bench", "usd": 20.0 - worst - 0.01}, deps.cumulative)
    [result] = grid.run_grid([world["model"].name], world["registry"], world["plan"], deps)
    assert result["ok"] is True


def test_every_model_gets_the_same_command(world: dict[str, Any]) -> None:
    registry, plan = world["registry"], world["plan"]
    commands = [
        grid.harness_command(plan, registry.get(n))
        for n in ("qwen3.6-35b-a3b", "claude-opus-5-5", "gpt-6.1-sol")
    ]

    def shared(command: list[str]) -> list[str]:
        command = [c for c in command if c != "--no-judge"]
        for flag in ("--model", "--out"):
            del command[command.index(flag) : command.index(flag) + 2]
        return command

    assert shared(commands[0]) == shared(commands[1]) == shared(commands[2])
    for flag, value in (
        ("--seed", "0"),
        ("--time-limit", "1800"),
        ("--tokens-base", "160000"),
        ("--tokens-per-question", "80000"),
        ("--solvers", "single,glhf"),
    ):
        assert commands[0][commands[0].index(flag) + 1] == value
    assert "--sandbox" not in commands[0] and "--total-token-cap" not in commands[0]
    capped = grid.harness_command(
        grid.Plan(name="t", capsules=plan.capsules, total_token_cap=5_000_000), world["model"]
    )
    assert capped[capped.index("--total-token-cap") + 1] == "5000000"
    modal_plan = grid.Plan(name="t", capsules=plan.capsules, sandbox="modal")
    command = grid.harness_command(modal_plan, registry.get("claude-opus-5-5"))
    assert command[command.index("--sandbox") + 1] == "modal" and command[:2] == ["uv", "run"]
    with pytest.raises(grid.GridError):
        grid.harness_command(grid.Plan(name="t", capsules=(), sandbox="k8s"), world["model"])


def test_a_vendor_model_gets_no_session_and_the_owners_environment(
    world: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    opus = world["registry"].get("claude-opus-5-5")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-key-for-tests")
    [result] = grid.run_grid([opus.name], world["registry"], world["plan"], world["deps"])
    assert result["ok"] and world["modal"].commands == [] and world["endpoint"].requests == []
    [(_, env)] = world["harness_calls"]
    assert env["ANTHROPIC_API_KEY"] == "fake-key-for-tests" and "OPENMODELS_API_KEY" not in env
    assert paid.SWITCH not in env  # the child's own guard decides; this runner does not allow it


def test_a_model_that_is_not_deployed_is_refused(world: dict[str, Any], allowed: None) -> None:
    [result] = grid.run_grid(["kimi-k3.1-pro"], world["registry"], world["plan"], world["deps"])
    assert (
        result["ok"] is False
        and "not deployed" in result["error"]
        and world["modal"].commands == []
    )
