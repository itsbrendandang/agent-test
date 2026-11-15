"""Where a run's analyses execute: local Docker (the default) or a Modal sandbox (`--sandbox
modal`, ANALYSIS_BACKEND=modal in the engine). Fakes only: no Docker, no Modal, no model, no
network. The Modal sandbox itself is tested in glhf/bixbench_v1 (tests/glhf_modal_test.py)."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from inspect_ai.util import SandboxEnvironment, SandboxEnvironmentSpec
from inspect_ai.util._sandbox.events import SandboxEnvironmentProxy

from bixbench3 import glhf_local, paid
from bixbench3.inspect_harness import tasks
from bixbench3.inspect_harness.swarm import tools
from bixbench3.inspect_harness.swarm.ledger import Ledger, Registration, Relevance

DEMO_CASE = Path(__file__).parents[4] / "glhf" / "demo_case"
SCRIPT = "print('GLHF_RESULT p_value=0.004 contradicts=false')\n"
PATH = "/workspace/work/glhf/tests/perm.py"


class Reached(Exception):
    """A spy was reached."""


@pytest.fixture(autouse=True)
def clean(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """The switch as a person who set nothing has it, fake keys, no .env in reach."""
    monkeypatch.delenv(paid.SWITCH, raising=False)
    monkeypatch.setattr(paid, "REPO_ENV", tmp_path / "no-such.env")
    monkeypatch.chdir(tmp_path)
    for key in paid.PAID_KEYS:
        monkeypatch.setenv(key, "fake-key-for-tests")
    monkeypatch.delenv(tools.HOST_LEDGER_ENV, raising=False)


def allow(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(paid.SWITCH, "0")


# --- each registered test records where it ran ------------------------------------------------
def _box(monkeypatch: pytest.MonkeyPatch, cls_name: str, describe: Any = None) -> None:
    def read_file(self: Any, path: str) -> str:
        return SCRIPT

    async def aread(self: Any, path: str) -> str:
        return read_file(self, path)

    async def exec(self: Any, cmd: list[str], **options: Any) -> Any:
        line = "GLHF_RESULT p_value=0.004 contradicts=false\n"
        return SimpleNamespace(success=True, returncode=0, stdout=line, stderr="")

    members: dict[str, Any] = {"read_file": aread, "exec": exec}
    if describe is not None:
        members["analysis_backend"] = describe
    box = type(cls_name, (), members)()
    monkeypatch.setattr(tools, "sandbox", lambda: box)


def _entry() -> Registration:
    entry = Registration("permutation", "permute labels", "critic", "labels do not matter")
    entry.script_path, entry.script = PATH, SCRIPT
    entry.script_sha256 = hashlib.sha256(SCRIPT.encode()).hexdigest()
    return entry


def test_a_test_run_in_a_modal_sandbox_says_so_in_the_run_and_the_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def describe(self: Any) -> dict[str, str]:
        return {"backend": "modal", "sandbox_id": "sb-123", "image": "bixbench-v1-env:amd64-1"}

    _box(monkeypatch, "GlhfModalSandbox", describe)
    entry = _entry()
    run = asyncio.run(tools.run_registered_test(entry, 60))
    assert (run.backend, run.sandbox_id) == ("modal", "sb-123")
    ledger = Ledger()
    claim = ledger.add_claim("labels matter", ["a"], "labels do not matter", "planner")
    claim.registered.append(entry)
    ledger.judge_relevance(claim.id, entry.name, Relevance(1.0, True, "fits"))
    ledger.record_run(claim.id, entry.name, run)
    executed = next(e for e in ledger.events if e["kind"] == "test.executed")
    assert executed["backend"] == "modal" and executed["sandbox_id"] == "sb-123"
    assert json.loads(ledger.to_json())["claims"][0]["registered"][0]["run"]["backend"] == "modal"


def test_a_test_run_in_docker_says_docker_also_when_it_did_not_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _box(monkeypatch, "DockerSandboxEnvironment")
    entry = _entry()
    assert asyncio.run(tools.run_registered_test(entry, 60)).backend == "docker"
    entry.script_sha256 = "0" * 64  # the file no longer matches: not run, still attributed
    run = asyncio.run(tools.run_registered_test(entry, 60))
    assert (run.status, run.backend, run.sandbox_id) == ("changed", "docker", None)


def test_a_provider_that_cannot_describe_itself_is_named_by_its_class(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def broken(self: Any) -> dict[str, str]:
        raise RuntimeError("no")

    _box(monkeypatch, "LocalSandboxEnvironment", broken)
    assert tools.sandbox_backend() == {"backend": "local"}


def test_the_provider_is_found_behind_inspect_s_proxy(monkeypatch: pytest.MonkeyPatch) -> None:
    # sandbox() returns Inspect's event-recording proxy, not the provider: its class says nothing.
    class Remote(SandboxEnvironment):
        async def exec(self, cmd: list[str], **options: Any) -> Any:  # type: ignore[override]
            raise AssertionError("not called")

        async def write_file(self, file: str, contents: str | bytes) -> None:
            raise AssertionError("not called")

        async def read_file(self, file: str, text: bool = True) -> Any:  # type: ignore[override]
            raise AssertionError("not called")

        @classmethod
        async def sample_cleanup(cls, *args: Any, **kwargs: Any) -> None:
            return None

        def analysis_backend(self) -> dict[str, str]:
            return {"backend": "modal", "sandbox_id": "sb-9"}

    class DockerSandboxEnvironment(Remote):
        def analysis_backend(self) -> dict[str, str]:
            raise RuntimeError("Docker's provider has no such method")

    monkeypatch.setattr(tools, "sandbox", lambda: SandboxEnvironmentProxy(Remote()))
    assert tools.sandbox_backend() == {"backend": "modal", "sandbox_id": "sb-9"}
    proxied = SandboxEnvironmentProxy(DockerSandboxEnvironment())
    monkeypatch.setattr(tools, "sandbox", lambda: proxied)
    assert tools.sandbox_backend() == {"backend": "docker"}


# --- the task's sandbox -----------------------------------------------------------------------
def test_the_task_uses_docker_unless_another_provider_is_named() -> None:
    task = tasks.bixbench3_cases(dataset_path=str(DEMO_CASE), solver="glhf")
    assert task.sandbox is not None and task.sandbox.type == "docker"
    with pytest.raises(ValueError, match="other than docker"):
        tasks.bixbench3_cases(dataset_path=str(DEMO_CASE), sandbox_config={"a": 1})


def test_another_provider_gets_its_config_as_its_own_type(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[dict[str, Any]] = []

    def deserialize(kind: str, config: dict[str, Any]) -> Any:
        seen.append(config)
        return SimpleNamespace(kind=kind, **config)

    monkeypatch.setattr(
        "inspect_ai.util._sandbox.environment.deserialize_sandbox_specific_config", deserialize
    )
    task = tasks.bixbench3_cases(
        dataset_path=str(DEMO_CASE),
        solver="glhf",
        sandbox_type="glhf_modal",
        sandbox_config={"run_tag": "a" * 32},
    )
    assert isinstance(task.sandbox, SandboxEnvironmentSpec) and task.sandbox.type == "glhf_modal"
    assert seen == [{"run_tag": "a" * 32}] and task.sandbox.config.run_tag == "a" * 32
    assert task.metadata["sandbox"] == "glhf_modal"


# --- the runner -------------------------------------------------------------------------------
class FakeBackend:
    """A Modal backend stand-in: records the calls; `refuse` makes `prepare` raise."""

    name = "modal"

    def __init__(self, refuse: Exception | None = None) -> None:
        self.refuse, self.calls = refuse, []  # type: ignore[var-annotated]

    def prepare(self, **arguments: Any) -> tuple[str, dict[str, Any]]:
        self.calls.append(("prepare", arguments))
        if self.refuse:
            raise self.refuse
        return "glhf_modal", {"run_tag": "b" * 32}

    def finish(self) -> dict[str, Any]:
        self.calls.append(("finish", {}))
        return {"sandboxes": 1, "sandbox_usd": 0.01, "left_over_terminated": []}


def _spy(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    seen: dict[str, Any] = {}

    def task(**arguments: Any) -> Any:
        seen["task"] = arguments
        return "task"

    def inspect_eval(*_: Any, **__: Any) -> Any:
        seen["eval"] = True
        raise Reached("eval")

    monkeypatch.setattr(glhf_local, "bixbench3_cases", task)
    monkeypatch.setattr(glhf_local, "inspect_eval", inspect_eval)
    return seen


def test_modal_analyses_are_a_paid_call_also_with_the_scripted_model(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    seen, backend = _spy(monkeypatch), FakeBackend()
    out = tmp_path / "run"
    with pytest.raises(paid.PaidCallsOff, match="Modal"):
        glhf_local.run_local(DEMO_CASE, out, model="mock", sandbox="modal", backend=backend)
    assert seen == {} and backend.calls == [] and not out.exists()
    allow(monkeypatch)  # the switch is what stopped it
    with pytest.raises(Reached):
        glhf_local.run_local(DEMO_CASE, out, model="mock", sandbox="modal", backend=backend)
    assert [name for name, _ in backend.calls] == ["prepare", "finish"]


def test_the_backend_sandbox_reaches_the_task_and_is_finished_after_an_error(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    allow(monkeypatch)
    seen, backend = _spy(monkeypatch), FakeBackend()
    out = tmp_path / "run"
    with pytest.raises(Reached):  # the run itself breaks; the sandbox is still finished
        glhf_local.run_local(DEMO_CASE, out, model="mock", sandbox="modal", backend=backend)
    prepared = backend.calls[0][1]
    assert prepared["data_dir"] == DEMO_CASE / "data" and prepared["run_dir"] == out
    assert prepared["outputs_dir"] == out / "outputs" and prepared["time_limit_seconds"] == 1800
    assert seen["task"]["sandbox_type"] == "glhf_modal"
    assert seen["task"]["sandbox_config"] == {"run_tag": "b" * 32}
    assert backend.calls[-1][0] == "finish"
    recorded = json.loads((out / "run.json").read_text())["settings"]
    assert recorded["sandbox"] == "modal" and recorded["modal"]["sandboxes"] == 1


def test_a_docker_run_names_no_other_sandbox(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    seen = _spy(monkeypatch)
    with pytest.raises(Reached):
        glhf_local.run_local(DEMO_CASE, tmp_path / "run", model="mock")
    assert "sandbox_type" not in seen["task"]
    assert (
        json.loads((tmp_path / "run" / "run.json").read_text())["settings"]["sandbox"] == "docker"
    )


def test_a_backend_that_refuses_fails_the_run_and_nothing_runs_here(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    allow(monkeypatch)
    seen = _spy(monkeypatch)
    backend = FakeBackend(refuse=RuntimeError("Modal sandbox cap: this run could cost up to 9 USD"))
    summary = glhf_local.run_local(
        DEMO_CASE, tmp_path / "run", model="mock", sandbox="modal", backend=backend
    )
    assert summary["status"] == "failed" and "eval" not in seen and "task" not in seen
    assert "could not start on modal: Modal sandbox cap" in summary["error"]
    assert "Nothing was run on this machine instead" in summary["error"]
    written = json.loads((tmp_path / "run" / "run.json").read_text())
    assert written["status"] == "failed" and written["error"] == summary["error"]
    assert written["settings"]["modal"]["sandboxes"] == 1  # what finish reported
    assert glhf_local.swarm_tools.HOST_LEDGER_ENV not in os.environ


def test_without_the_modal_package_the_run_fails_and_does_not_fall_back(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    allow(monkeypatch)
    seen = _spy(monkeypatch)
    real = glhf_local.importlib.import_module

    def import_module(name: str, *args: Any) -> Any:
        if name == glhf_local.MODAL_BRIDGE:
            raise ModuleNotFoundError(f"No module named {name!r}")
        return real(name, *args)

    monkeypatch.setattr(glhf_local.importlib, "import_module", import_module)
    summary = glhf_local.run_local(DEMO_CASE, tmp_path / "run", model="mock", sandbox="modal")
    assert summary["status"] == "failed" and seen == {}
    assert "glhf/bixbench_v1" in summary["error"] and "uv run --group modal" in summary["error"]
    assert "Nothing was run on this machine instead" in summary["error"]


def test_the_command_line_refuses_modal_in_one_line_while_paid_calls_are_off(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    seen = _spy(monkeypatch)
    argv = ["glhf_local", "--case", str(DEMO_CASE), "--out", str(tmp_path / "run")]
    monkeypatch.setattr("sys.argv", [*argv, "--sandbox", "modal"])
    with pytest.raises(SystemExit) as stopped:
        glhf_local.main()
    assert stopped.value.code == 2 and seen == {}
    err = capsys.readouterr().err
    assert "Modal sandbox" in err and "NO_PAID_CALLS" in err
