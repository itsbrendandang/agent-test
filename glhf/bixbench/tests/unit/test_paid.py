"""The NO_PAID_CALLS switch (bixbench3/paid.py) for someone who runs this package directly.

Every path that can spend is called here with the switch on and a spy on httpx: the path must
refuse, naming the switch, and nothing may go out. Each test also runs the same path with the
switch off against the spy, which shows that the switch is what stopped it. Nothing here can
spend: every provider key is a fake, the spy fails every request, and no model, sandbox or
cloud command is started.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import Any

import httpx
import pytest
from inspect_ai.tool import ToolError

from bixbench3 import cli, glhf_local, paid
from bixbench3.inspect_harness.swarm import memory, past_memory, tools
from bixbench3.inspect_harness.swarm.ledger import Ledger

DEMO_CASE = Path(__file__).parents[4] / "glhf" / "demo_case"
REAL = "anthropic/claude-sonnet-5-5"


class Reached(Exception):
    """A spy was reached: the code got past the switch."""


@pytest.fixture(autouse=True)
def clean(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """The switch as a person who set nothing has it: not in the environment, no .env in reach
    (the working folder is empty and the repository's .env is not read). Every provider key is a
    fake, and what a test changes in the environment is put back afterwards."""
    monkeypatch.delenv(paid.SWITCH, raising=False)
    monkeypatch.setattr(paid, "REPO_ENV", tmp_path / "no-such.env")
    monkeypatch.chdir(tmp_path)
    for key in paid.PAID_KEYS:
        monkeypatch.setenv(key, "fake-key-for-tests")
    for key in ("VSCODE_PID", "VSCODE_CWD", "TERM_PROGRAM"):
        monkeypatch.delenv(key, raising=False)


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


def allow(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(paid.SWITCH, "0")


# --- the switch ----------------------------------------------------------------------------


def test_the_switch_is_on_unless_it_is_exactly_zero() -> None:
    assert paid.paid_calls_off({}, []) is True  # unset: no paid calls
    for value in ("", "1", "true", "false", "off", "no", "00", "0.0", "O"):
        assert paid.paid_calls_off({paid.SWITCH: value}, []) is True, value
    assert paid.paid_calls_off({paid.SWITCH: "0"}, []) is False
    assert paid.paid_calls_off({paid.SWITCH: " 0 "}, []) is False
    assert paid.paid_calls_off() is True  # this test process: nothing set, no .env in reach
    with pytest.raises(paid.PaidCallsOff, match="NO_PAID_CALLS"):
        paid.refuse_paid("a paid step")


def test_the_switch_is_also_read_from_dotenv_and_the_environment_wins(tmp_path: Path) -> None:
    def env(text: str) -> list[Path]:
        path = tmp_path / "x.env"
        path.write_text(text)
        return [path]

    assert paid.paid_calls_off({}, env("NO_PAID_CALLS=0\n")) is False
    assert paid.paid_calls_off({}, env("OTHER=0\n")) is True
    assert paid.paid_calls_off({}, env("NO_PAID_CALLS=1\n")) is True
    assert paid.paid_calls_off({}, env("# NO_PAID_CALLS=0\n")) is True  # commented out
    assert paid.paid_calls_off({}, env("NO_PAID_CALLS=\n")) is True
    assert paid.paid_calls_off({}, env('export NO_PAID_CALLS="0"\n')) is False
    assert (
        paid.paid_calls_off({}, env("NO_PAID_CALLS=0 # allowed for the run on Friday\n")) is False
    )
    assert paid.paid_calls_off({}, env("NO_PAID_CALLS=0\nNO_PAID_CALLS=1\n")) is True  # last wins
    assert paid.paid_calls_off({}, env("XNO_PAID_CALLS=0\nNO_PAID_CALLS_X=0\n")) is True
    # The environment wins over the file, both ways (the engine passes NO_PAID_CALLS=1 down).
    assert paid.paid_calls_off({paid.SWITCH: "1"}, env("NO_PAID_CALLS=0\n")) is True
    assert paid.paid_calls_off({paid.SWITCH: "0"}, env("NO_PAID_CALLS=1\n")) is False
    # Only this line is read: the value of another variable is never returned.
    secret = env("ANTHROPIC_API_KEY=sk-secret\nNO_PAID_CALLS=0\n")
    assert paid.switch_value({}, secret) == "0"
    assert paid.switch_value({}, [tmp_path / "missing.env"]) is None


def test_the_dotenv_files_are_the_ones_a_run_would_load(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    project, repo = tmp_path / "project", tmp_path / "repo"
    (project / "a" / "b").mkdir(parents=True)
    repo.mkdir()
    (project / ".env").write_text("NO_PAID_CALLS=0\n")
    (repo / ".env").write_text("NO_PAID_CALLS=1\n")
    monkeypatch.setattr(paid, "REPO_ENV", repo / ".env")
    monkeypatch.chdir(project / "a" / "b")
    # The nearest .env above the working folder (what Inspect loads), then the repository's.
    assert paid.dotenv_files() == [(project / ".env").resolve(), repo / ".env"]
    assert paid.paid_calls_off() is False
    monkeypatch.chdir(tmp_path)
    assert paid.dotenv_files() == [repo / ".env"]
    assert paid.paid_calls_off() is True
    assert Path(paid.__file__).resolve().parents[4] / ".env" == DEMO_CASE.parents[1] / ".env"


def test_the_keys_are_blank_while_the_switch_is_on(monkeypatch: pytest.MonkeyPatch) -> None:
    env = {"PATH": "/bin", "ANTHROPIC_API_KEY": "a", "HF_TOKEN": "h", "OTHER": "kept"}
    env |= {"VSCODE_PID": "1", "VSCODE_CWD": "/x", "TERM_PROGRAM": "vscode"}
    assert paid.enforce(env) is True
    assert env == {"PATH": "/bin", "OTHER": "kept", "NO_PAID_CALLS": "1"} | dict.fromkeys(
        paid.PAID_KEYS, ""
    )
    allowed = {"NO_PAID_CALLS": "0", "ANTHROPIC_API_KEY": "a", "TERM_PROGRAM": "vscode"}
    assert paid.enforce(allowed) is False
    assert allowed == {"NO_PAID_CALLS": "0", "ANTHROPIC_API_KEY": "a", "TERM_PROGRAM": "vscode"}
    # In this process, as the entry points do it.
    assert paid.enforce() is True
    assert {key: os.environ[key] for key in paid.PAID_KEYS} == dict.fromkeys(paid.PAID_KEYS, "")
    assert os.environ[paid.SWITCH] == "1"  # passed on to child processes


def test_inspect_does_not_read_the_blanked_keys_back_from_dotenv(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from inspect_ai._util.dotenv import init_dotenv

    (tmp_path / ".env").write_text("ANTHROPIC_API_KEY=from-dotenv\nEXA_API_KEY=from-dotenv\n")
    monkeypatch.setenv("TERM_PROGRAM", "vscode")  # where Inspect replaces variables that are set
    monkeypatch.setenv("VSCODE_PID", "1")
    assert paid.enforce() is True
    init_dotenv()  # what every Inspect eval does first
    assert os.environ["ANTHROPIC_API_KEY"] == "" and os.environ["EXA_API_KEY"] == ""
    # Without the switch the same .env is loaded, which is why the keys are blanked, not removed.
    for key in ("ANTHROPIC_API_KEY", "EXA_API_KEY"):
        monkeypatch.delenv(key)
    init_dotenv()
    assert os.environ["ANTHROPIC_API_KEY"] == "from-dotenv"


# --- local runs -----------------------------------------------------------------------------


def _spy_local(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Stand-ins for the model lookup and the Inspect eval of glhf_local: reaching one is a run."""
    reached: list[str] = []

    def get_model(name: str, **_: Any) -> Any:
        reached.append(f"get_model {name}")
        raise Reached(name)

    def inspect_eval(*_: Any, **__: Any) -> Any:
        reached.append("eval")
        raise Reached("eval")

    monkeypatch.setattr(glhf_local, "get_model", get_model)
    monkeypatch.setattr(glhf_local, "inspect_eval", inspect_eval)
    return reached


def test_a_local_run_with_a_real_model_or_exa_is_refused_before_anything_starts(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, outbound: list[str]
) -> None:
    reached = _spy_local(monkeypatch)
    out = tmp_path / "run"
    for arguments in (
        {"model": REAL},
        {"model": REAL, "solver": "single"},
        {"model": "ollama/qwen3:32b"},
        {"model": REAL, "role_models": {"critic": "openai/gpt-5.5"}},
        {"model": "mock", "exa": True},
    ):
        with pytest.raises(paid.PaidCallsOff, match="NO_PAID_CALLS"):
            glhf_local.run_local(DEMO_CASE, out, **arguments)  # type: ignore[arg-type]
    assert reached == [] and outbound == []
    assert not out.exists(), "nothing was created"
    assert os.environ["ANTHROPIC_API_KEY"] == "", "and the keys are blank from here on"

    # The scripted model passes the switch and reaches the (stand-in) run.
    with pytest.raises(Reached):
        glhf_local.run_local(DEMO_CASE, out, model="mock", memory_dir=tmp_path / "memory")
    assert reached == ["get_model mockllm/model"]

    # With the switch off the same real-model request reaches the model lookup.
    allow(monkeypatch)
    reached.clear()
    with pytest.raises(Reached):
        glhf_local.run_local(DEMO_CASE, out, model=REAL)
    assert reached == [f"get_model {REAL}"]


def test_the_local_command_line_refuses_in_one_line(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    reached = _spy_local(monkeypatch)
    argv = ["glhf_local", "--case", str(DEMO_CASE), "--out", str(tmp_path / "run"), "--model", REAL]
    monkeypatch.setattr("sys.argv", argv)
    with pytest.raises(SystemExit) as stopped:
        glhf_local.main()
    assert stopped.value.code == 2
    assert "NO_PAID_CALLS" in capsys.readouterr().err
    assert reached == []


# --- cloud launches --------------------------------------------------------------------------


def _spy_cloud(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    reached: list[str] = []

    def load_public_task(task: str) -> Any:
        reached.append("load_public_task")
        raise Reached("load_public_task")

    def runner(project: str) -> Any:
        reached.append("runner")
        raise Reached("runner")

    monkeypatch.setattr(cli, "load_public_task", load_public_task)
    monkeypatch.setattr(cli, "_runner", runner)
    return reached


RUN = ["run", "--task", "9", "--model", "openai/gpt-5.5", "--effort", "high", "--project", "p"]
SETUP = ["setup-runtime", "--project", "p", "--cellranger-tarball", "a", "--cellranger-arc-tarball"]


def test_a_cloud_launch_is_refused_before_the_task_is_even_looked_up(
    monkeypatch: pytest.MonkeyPatch, outbound: list[str], capsys: pytest.CaptureFixture[str]
) -> None:
    reached = _spy_cloud(monkeypatch)
    for argv in (RUN, [*RUN, "--solver", "glhf"], [*SETUP, "b"]):
        with pytest.raises(SystemExit) as stopped:
            cli.main(argv)
        assert stopped.value.code == 2
        message = capsys.readouterr().err
        assert "NO_PAID_CALLS" in message and "cloud launch" in message
    assert reached == [] and outbound == []
    assert os.environ["OPENAI_API_KEY"] == ""

    # A dry run starts nothing and is let through; so are the commands for a run that exists
    # (complete and cancel are what delete a VM that bills).
    for argv, first in (
        ([*RUN, "--dry-run"], "load_public_task"),
        ([*SETUP, "b", "--dry-run"], "runner"),
        (["status", "--run", "r", "--project", "p"], "runner"),
        (["complete", "--run", "r", "--project", "p"], "runner"),
        (["cancel", "--run", "r", "--project", "p"], "runner"),
    ):
        reached.clear()
        with pytest.raises(Reached):
            cli.main(argv)
        assert reached == [first], argv

    allow(monkeypatch)
    reached.clear()
    with pytest.raises(Reached):
        cli.main(RUN)
    assert reached == ["load_public_task"]


# --- Exa -------------------------------------------------------------------------------------


def test_documentation_search_is_refused_before_the_key_the_ledger_and_the_network(
    monkeypatch: pytest.MonkeyPatch, outbound: list[str]
) -> None:
    saved: list[int] = []

    async def save_ledger(ledger: Ledger) -> None:
        saved.append(len(ledger.events))

    monkeypatch.setattr(tools, "save_ledger", save_ledger)
    ledger = Ledger()
    search = tools.search_docs(ledger, "scout")
    with pytest.raises(ToolError, match="NO_PAID_CALLS"):
        asyncio.run(search("featureCounts strandedness option", "the manual page"))  # type: ignore[arg-type]
    assert outbound == [] and ledger.events == [] and saved == []

    allow(monkeypatch)
    with pytest.raises(Reached):
        asyncio.run(search("featureCounts strandedness option", "the manual page"))  # type: ignore[arg-type]
    assert outbound == ["https://api.exa.ai/search"]


# --- past.dev --------------------------------------------------------------------------------


def test_past_dev_recall_and_ingest_are_refused(
    monkeypatch: pytest.MonkeyPatch, outbound: list[str]
) -> None:
    assert past_memory.enabled() is False, "a key is set, and the switch still says no"
    with pytest.raises(paid.PaidCallsOff, match="NO_PAID_CALLS"):
        asyncio.run(past_memory.remember("9", "- pin the annotation version"))
    with pytest.raises(paid.PaidCallsOff, match="NO_PAID_CALLS"):
        asyncio.run(past_memory.recall_with_sources(task_id="9"))
    with pytest.raises(paid.PaidCallsOff, match="NO_PAID_CALLS"):
        asyncio.run(past_memory.recall(task_id="9"))
    assert outbound == []

    allow(monkeypatch)
    assert past_memory.enabled() is True
    with pytest.raises(Reached):
        asyncio.run(past_memory.remember("9", "- pin the annotation version"))
    with pytest.raises(Reached):
        asyncio.run(past_memory.recall(task_id="9"))
    assert outbound == ["https://api.past.dev/api/v1/ingest", "https://api.past.dev/api/v1/recall"]


def test_approving_lessons_keeps_the_file_and_sends_nothing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    outbound: list[str],
    capsys: pytest.CaptureFixture[str],
) -> None:
    folder = str(tmp_path / "memory")
    memory.add_pending(folder, "9", "- pin the annotation version\n")
    assert memory.main(["--dir", folder, "approve-all"]) == 0
    printed = capsys.readouterr()
    assert "nothing sent" in printed.err and "NO_PAID_CALLS" in printed.err
    assert outbound == []
    assert "pin the annotation version" in (tmp_path / "memory" / memory.MEMORY_FILE).read_text()

    allow(monkeypatch)
    memory.add_pending(folder, "11", "- check the strandedness first\n")
    assert memory.main(["--dir", folder, "approve-all"]) == 0  # a failed send never fails approval
    assert outbound == ["https://api.past.dev/api/v1/ingest"]
