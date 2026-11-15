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

        def __init__(self, model: str, temperature: float | None) -> None:
            self.model, self.temperature = model, temperature
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
        message = str(stopped.value.code)
        # bixbench3.paid words the refusal; it has said "real model" and "paid model".
        assert "NO_PAID_CALLS" in message and ("real model" in message or "paid model" in message)
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


def test_every_profiles_default_judge_is_behind_the_switch(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, outbound: list[str], reached: list[str]
) -> None:
    monkeypatch.setattr(cli, "_capsules", lambda arguments: [])
    monkeypatch.setattr(cli, "_write_report", lambda out, profile: reached.append("report"))
    # Switch on: the paper profile's Anthropic judge is refused like any other, by name.
    for profiles in ("paper", "official", "per-mode,official,paper"):
        reached.clear()
        with pytest.raises(SystemExit) as stopped:
            command(monkeypatch, "grade", "--out", str(tmp_path), "--grading", profiles)
        assert "NO_PAID_CALLS" in str(stopped.value.code)
        assert reached == ["load_env keys=blank"] and outbound == []
    with pytest.raises(SystemExit) as stopped:
        command(monkeypatch, "grade", "--out", str(tmp_path), "--grading", "paper")
    assert "claude-3-5-sonnet-20241022" in str(stopped.value.code)
    # Switch off: each profile gets its own default judge and temperature...
    monkeypatch.setenv(paid.SWITCH, "0")
    built: list[tuple[str, float | None]] = []
    real = cli.InspectJudge

    class Spy(real):  # type: ignore[valid-type,misc]
        def __init__(self, model: str, temperature: float | None) -> None:
            built.append((model, temperature))
            self.model, self.temperature, self.calls, self.tokens = model, temperature, 0, 0

    monkeypatch.setattr(cli, "InspectJudge", Spy)
    command(monkeypatch, "grade", "--out", str(tmp_path), "--grading", "per-mode,official,paper")
    assert built == [
        ("openai/gpt-4o", 0.0),
        ("openai/gpt-4o", 1.0),
        ("anthropic/claude-3-5-sonnet-20241022", None),
    ]
    # ...unless the command line names one, which then applies to every profile.
    built.clear()
    command(
        monkeypatch, "grade", "--out", str(tmp_path), "--grading", "official,paper",
        "--judge-model", "openai/gpt-5.5", "--judge-temperature", "0",
    )  # fmt: skip
    assert built == [("openai/gpt-5.5", 0.0)]
    built.clear()
    command(
        monkeypatch, "grade", "--out", str(tmp_path), "--grading", "official",
        "--judge-temperature", "default",
    )  # fmt: skip
    assert built == [("openai/gpt-4o", None)] and outbound == []


# --- Modal and our own OpenAI-compatible endpoint (glhf/openmodels) ---------------------------

ENDPOINT = "openai-api/openmodels/Qwen/Qwen3.6-35B-A3B-FP8"


def _keys() -> str:
    return "blank" if not any(os.environ.get(k) for k in paid.PAID_KEYS) else "set"


def test_modal_is_refused_while_the_switch_is_on(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(paid.PaidCallsOff) as refused:
        paid.refuse_modal("deploy openmodels-qwen")
    assert "NO_PAID_CALLS" in str(refused.value) and "Modal (deploy openmodels-qwen)" in str(
        refused.value
    )
    monkeypatch.setenv(paid.SWITCH, "1")
    with pytest.raises(paid.PaidCallsOff):
        paid.refuse_modal("request")
    monkeypatch.setenv(paid.SWITCH, "0")
    paid.refuse_modal("request")  # allowed only by the exact value 0


def test_a_model_on_our_endpoint_is_a_paid_model_while_the_switch_is_on(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, outbound: list[str], reached: list[str]
) -> None:
    monkeypatch.setenv("OPENMODELS_API_KEY", "fake-endpoint-key")
    monkeypatch.setenv("OPENMODELS_BASE_URL", "https://example.invalid/v1")
    out = tmp_path / "runs"
    with pytest.raises(SystemExit) as stopped:
        command(
            monkeypatch, "run", "--capsules", "bix-1", "--out", str(out), "--model", ENDPOINT,
            "--no-judge",
        )  # fmt: skip
    assert "NO_PAID_CALLS" in str(stopped.value.code) and "paid model" in str(stopped.value.code)
    assert reached == ["load_env keys=blank"] and outbound == [] and not out.exists()


def test_an_endpoint_only_run_without_a_judge_has_no_vendor_key(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, outbound: list[str], reached: list[str]
) -> None:
    """Paid calls allowed (fakes only): the run gets as far as choosing capsules, and by then
    every vendor key is blank, so only the endpoint could be reached."""

    def run(*extra: str) -> str:
        for key in paid.PAID_KEYS:
            monkeypatch.setenv(key, "fake-key-for-tests")
        monkeypatch.setenv(paid.SWITCH, "0")
        reached.clear()
        with pytest.raises(Reached):
            command(monkeypatch, "run", "--capsules", "bix-1", "--out", str(tmp_path / "r"), *extra)
        assert "capsules" in reached
        return _keys()

    assert run("--model", ENDPOINT, "--no-judge") == "blank"
    assert run("--model", ENDPOINT, "--role-model", f"critic={ENDPOINT}", "--no-judge") == "blank"
    # A judge, or one vendor model among the roles, needs a vendor key: nothing is blanked.
    assert run("--model", ENDPOINT) == "set"
    assert run("--model", ENDPOINT, "--role-model", "critic=openai/gpt-5.5", "--no-judge") == "set"
    assert run("--model", REAL, "--no-judge") == "set"
    assert outbound == []


def test_endpoint_ids_are_recognised_by_form_only() -> None:
    assert paid.endpoint_service(ENDPOINT) == "openmodels"
    assert paid.is_endpoint_model("openai-api/modal/x")
    for other in ("openai/gpt-5.5", "openai-api/x", "openai-api//x", "openai-api/x/", "mock",
                  "xopenai-api/a/b", "ollama/qwen2.5:14b", ""):  # fmt: skip
        assert not paid.is_endpoint_model(other), other
    env = {"ANTHROPIC_API_KEY": "k"}
    assert paid.isolate_endpoint([], judge=False, environ=env) is False and env == {
        "ANTHROPIC_API_KEY": "k"
    }
    assert paid.isolate_endpoint([ENDPOINT], judge=False, environ=env) is True
    assert all(env[k] == "" for k in paid.PAID_KEYS)


def test_isolating_an_endpoint_run_keeps_the_key_of_its_own_service() -> None:
    """`openai-api/tinker/...` needs TINKER_API_KEY, which is one of the named paid keys."""
    env = dict.fromkeys(paid.PAID_KEYS, "fake-key-for-tests")
    tinker = "openai-api/tinker/Qwen/Qwen3.6-35B-A3B:peft:262144"
    assert paid.isolate_endpoint([tinker], judge=False, environ=env) is True
    assert env["TINKER_API_KEY"] == "fake-key-for-tests"
    assert all(env[k] == "" for k in paid.PAID_KEYS if k != "TINKER_API_KEY")
    env = dict.fromkeys(paid.PAID_KEYS, "fake-key-for-tests")
    assert paid.isolate_endpoint([ENDPOINT], judge=False, environ=env) is True
    assert all(env[k] == "" for k in paid.PAID_KEYS)  # our own endpoint: every named key goes
