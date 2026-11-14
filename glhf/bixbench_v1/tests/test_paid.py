"""The NO_PAID_CALLS switch for `bixbench-v1` run directly (bixbench_v1/paid.py).

With the switch on, a run or a grading that needs a real model must refuse before anything is
started, naming the switch, and nothing may go out. Each case is also run with the switch off
against the same spies, which shows that the switch is what stopped it. Nothing here can spend:
every provider key is a fake, the httpx spy fails every request, and the run, the judge and the
.env loader are stand-ins.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import httpx
import pytest
from bixbench3 import paid as switch

from bixbench_v1 import cli, paid
from bixbench_v1.runner import load_env

REAL = "anthropic/claude-sonnet-5-5"


class Reached(Exception):
    """A spy was reached: the code got past the switch."""


@pytest.fixture(autouse=True)
def clean(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """The switch as a person who set nothing has it: not in the environment and no .env in
    reach. Every provider key is a fake, and the environment is put back afterwards."""
    monkeypatch.delenv(paid.SWITCH, raising=False)
    monkeypatch.setattr(switch, "REPO_ENV", tmp_path / "no-such.env")
    monkeypatch.chdir(tmp_path)
    for key in paid.PAID_KEYS:
        monkeypatch.setenv(key, "fake-key-for-tests")


@pytest.fixture
def outbound(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Every request any httpx client tries to send. None is sent."""
    sent: list[str] = []

    async def async_send(self: httpx.AsyncClient, request: httpx.Request, **_: Any) -> Any:
        sent.append(str(request.url))
        raise Reached(str(request.url))

    def send(self: httpx.Client, request: httpx.Request, **_: Any) -> Any:
        sent.append(str(request.url))
        raise Reached(str(request.url))

    monkeypatch.setattr(httpx.AsyncClient, "send", async_send)
    monkeypatch.setattr(httpx.Client, "send", send)
    return sent


@pytest.fixture
def reached(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Stand-ins for what the command line would start. Each records that it was reached, and
    what the provider keys were at that moment (blank or set, never a value)."""
    seen: list[str] = []
    keys = lambda: "blank" if not any(os.environ.get(k) for k in paid.PAID_KEYS) else "set"  # noqa: E731

    class Judge:
        calls = tokens = 0

        def __init__(self, model: str, temperature: float) -> None:
            seen.append(f"judge {model}")

    def run_capsule(*_: Any, **arguments: Any) -> Any:
        seen.append(f"run {arguments['model']}")
        raise Reached("run")

    def selected(arguments: Any) -> Any:
        seen.append("capsules")
        raise Reached("capsules")

    monkeypatch.setattr(cli, "InspectJudge", Judge)
    monkeypatch.setattr(cli, "run_capsule", run_capsule)
    monkeypatch.setattr(cli, "_selected", selected)
    monkeypatch.setattr(cli, "_capsules", selected)
    monkeypatch.setattr(cli, "load_env", lambda path: seen.append(f"load_env keys={keys()}") or [])
    return seen


def command(monkeypatch: pytest.MonkeyPatch, *argv: str) -> None:
    monkeypatch.setattr("sys.argv", ["bixbench-v1", *argv])
    cli.main()


def test_the_switch_is_on_by_default_and_is_the_one_of_bixbench3(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert paid.paid_calls_off() is True
    monkeypatch.setenv(paid.SWITCH, "1")
    assert paid.paid_calls_off() is True
    monkeypatch.setenv(paid.SWITCH, "0")
    assert paid.paid_calls_off() is False
    assert paid.PaidCallsOff is switch.PaidCallsOff and paid.PAID_KEYS == switch.PAID_KEYS


def test_a_run_with_a_real_model_is_refused_before_anything_starts(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, outbound: list[str], reached: list[str]
) -> None:
    out = tmp_path / "runs"
    for extra in (
        ["--model", REAL],
        ["--model", "openai/gpt-5.5", "--solvers", "single"],
        ["--model", REAL, "--role-model", "critic=openai/gpt-5.5"],
        ["--model", REAL, "--no-judge"],
    ):
        reached.clear()
        with pytest.raises(SystemExit) as stopped:
            command(monkeypatch, "run", "--capsules", "bix-1", "--out", str(out), *extra)
        assert "NO_PAID_CALLS" in str(stopped.value.code) and "real model" in str(
            stopped.value.code
        )
        # .env was loaded after the keys were blanked, so it could not fill them in again.
        assert reached == ["load_env keys=blank"]
    assert outbound == [] and not out.exists()

    # With the switch off the same command gets as far as the judge and the capsules.
    monkeypatch.setenv(paid.SWITCH, "0")
    for key in paid.PAID_KEYS:
        monkeypatch.setenv(key, "fake-key-for-tests")
    reached.clear()
    with pytest.raises(Reached):
        command(monkeypatch, "run", "--capsules", "bix-1", "--out", str(out), "--model", REAL)
    assert reached == ["load_env keys=set", f"judge {cli.DEFAULT_JUDGE}", "capsules"]


def test_the_scripted_model_runs_and_a_named_judge_is_refused(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, outbound: list[str], reached: list[str]
) -> None:
    out = tmp_path / "runs"
    with pytest.raises(Reached):  # mock, default judge: no judge is built, the run goes on
        command(monkeypatch, "run", "--capsules", "bix-1", "--out", str(out), "--model", "mock")
    assert reached == ["load_env keys=blank", "capsules"]

    reached.clear()
    with pytest.raises(SystemExit) as stopped:
        command(
            monkeypatch,
            "run",
            "--capsules",
            "bix-1",
            "--out",
            str(out),
            "--judge-model",
            "openai/gpt-5.5",
        )
    assert "NO_PAID_CALLS" in str(stopped.value.code) and "--no-judge" in str(stopped.value.code)
    assert reached == ["load_env keys=blank"] and outbound == []


def test_grading_with_the_llm_judge_is_refused_and_no_judge_grading_works(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, outbound: list[str], reached: list[str]
) -> None:
    monkeypatch.setattr(cli, "_capsules", lambda arguments: [])
    monkeypatch.setattr(cli, "_write_report", lambda out, profile: reached.append("report"))
    with pytest.raises(SystemExit) as stopped:
        command(monkeypatch, "grade", "--out", str(tmp_path))
    assert "NO_PAID_CALLS" in str(stopped.value.code) and "--no-judge" in str(stopped.value.code)
    assert reached == ["load_env keys=blank"] and outbound == []

    reached.clear()
    command(monkeypatch, "grade", "--out", str(tmp_path), "--no-judge")
    assert reached == ["load_env keys=blank", "report"]

    monkeypatch.setenv(paid.SWITCH, "0")
    reached.clear()
    command(monkeypatch, "grade", "--out", str(tmp_path))
    assert f"judge {cli.DEFAULT_JUDGE}" in reached


def test_the_repository_env_file_cannot_put_the_keys_back(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    env_file = tmp_path / "repo.env"
    env_file.write_text("ANTHROPIC_API_KEY=from-dotenv\nOPENAI_API_KEY=from-dotenv\n")
    assert paid.enforce() is True
    assert load_env(env_file) == []  # the real loader: a variable that is set, even blank, stays
    assert os.environ["ANTHROPIC_API_KEY"] == "" and os.environ["OPENAI_API_KEY"] == ""
    assert os.environ[paid.SWITCH] == "1"
    # The switch itself is read from that file when the environment does not set it.
    monkeypatch.delenv(paid.SWITCH)
    monkeypatch.setattr(switch, "REPO_ENV", env_file)
    assert paid.paid_calls_off() is True
    env_file.write_text("NO_PAID_CALLS=0\n")
    assert paid.paid_calls_off() is False
