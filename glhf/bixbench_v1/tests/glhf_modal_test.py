"""The research engine's analyses on Modal (glhf_modal.py, glhf_modal_sandbox.py) with a fake Modal:
what is uploaded, when a run is refused, that the swarm gets /workspace in #32's checked sandbox,
that every test records the Modal sandbox it ran in, and that nothing is left running. No cloud
is reached and nothing is billed. Needs the optional packages (`uv run --group modal pytest`)."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("modal")
pytest.importorskip("inspect_sandboxes")

from bixbench3 import glhf_local
from bixbench3 import paid as switch
from bixbench3.inspect_harness import tasks
from modal_sandbox_boundary_test import FakeVolume
from modal_sandbox_provider_test import World, config, world  # noqa: F401  (the fixture)

from bixbench_v1 import glhf_modal, glhf_modal_sandbox, modal_cost, modal_sandbox, paid, staging
from bixbench_v1.glhf_modal import ModalAnalyses, case_manifest
from bixbench_v1.glhf_modal_sandbox import GlhfModalSandbox
from bixbench_v1.modal_boundary import BixModalConfig

DEMO_CASE = Path(__file__).resolve().parents[2] / "demo_case"


@pytest.fixture(autouse=True)
def clean(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Paid calls as a person who set nothing has them; fake keys; no .env in reach."""
    monkeypatch.delenv(paid.SWITCH, raising=False)
    monkeypatch.setattr(switch, "REPO_ENV", tmp_path / "no-such.env")
    for key in paid.PAID_KEYS:
        monkeypatch.setenv(key, "fake-key-for-tests")


def allow(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(paid.SWITCH, "0")  # inside this test only; nothing here reaches Modal


def case(tmp_path: Path, files: dict[str, str] | None = None) -> Path:
    data = tmp_path / "case" / "data"
    for name, text in (files or {"reads.tsv": "a\t1\n", "meta/samples.tsv": "s\n"}).items():
        (data / name).parent.mkdir(parents=True, exist_ok=True)
        (data / name).write_text(text)
    return data


def prepare(backend: ModalAnalyses, tmp_path: Path, data: Path, **more: Any) -> tuple[str, Any]:
    run_dir = tmp_path / "run"
    run_dir.mkdir(exist_ok=True)
    arguments: dict[str, Any] = {
        "data_dir": data,
        "outputs_dir": run_dir / "outputs",
        "run_dir": run_dir,
        "task": "demo",
        "solver": "glhf",
        "time_limit_seconds": 1800,
    }
    return backend.prepare(**(arguments | more))


# --- what goes to Modal ---------------------------------------------------------------------------
def test_the_manifest_holds_the_case_data_files_and_nothing_else(tmp_path: Path) -> None:
    manifest = case_manifest(case(tmp_path))
    assert manifest.paths == {"reads.tsv", "meta/samples.tsv"}
    assert {str(i["path"]): i["bytes"] for i in manifest.included} == {
        "meta/samples.tsv": 2,
        "reads.tsv": 4,
    }
    assert manifest.rules_version == staging.RULES_VERSION


@pytest.mark.parametrize(
    "files",
    [
        {"reads.tsv": "x", "solution.ipynb": "{}"},
        {"reads.tsv": "x", "analysis.py": "print(1)"},
        {"reads.tsv": "x", "write-up.md": "the answer"},
        {"reads.tsv": "x", "README": "no suffix"},
    ],
)
def test_a_file_that_is_not_data_stops_the_upload(tmp_path: Path, files: dict[str, str]) -> None:
    with pytest.raises(staging.IntegrityError, match="not uploading"):
        case_manifest(case(tmp_path, files))


def test_a_link_or_an_empty_folder_stops_the_upload(tmp_path: Path) -> None:
    data = case(tmp_path)
    (data / "elsewhere.tsv").symlink_to(tmp_path / "secret.tsv")
    with pytest.raises(staging.IntegrityError, match="symbolic link"):
        case_manifest(data)
    empty = tmp_path / "empty"
    empty.mkdir()
    with pytest.raises(staging.IntegrityError, match="no data file"):
        case_manifest(empty)


# --- prepare --------------------------------------------------------------------------------------
def test_prepare_is_refused_while_paid_calls_are_off(tmp_path: Path) -> None:
    volume = FakeVolume()
    with pytest.raises(paid.PaidCallsOff, match="Modal"):
        prepare(ModalAnalyses(volume=volume), tmp_path, case(tmp_path))
    assert volume.files == {} and not (tmp_path / "run" / glhf_modal.MARKER).exists()


def test_prepare_uploads_the_data_and_returns_the_checked_sandbox(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    allow(monkeypatch)
    volume = FakeVolume()
    backend = ModalAnalyses(volume=volume, usd_cap=1.5)
    kind, settings = prepare(backend, tmp_path, case(tmp_path))
    assert kind == glhf_modal_sandbox.PROVIDER == "glhf_modal"
    parsed = BixModalConfig(**settings)
    assert parsed.image.startswith("bixbench-v1-env:")  # the image whose environment is checked
    assert parsed.timeout_seconds == 1800 + 600 and parsed.files == 2
    # Only the two data files went up, under a content hash.
    assert sorted(name.split("/", 1)[1] for name in volume.files if "/data/" in name) == [
        "data/meta/samples.tsv",
        "data/reads.tsv",
    ]
    marker = json.loads((tmp_path / "run" / glhf_modal.MARKER).read_text())
    assert marker["run_tag"] == parsed.run_tag and marker["usd_cap"] == 1.5
    assert marker["worst_case_usd"] == round(modal_cost.worst_case_usd(2400, 4.0, 16384, 1), 4)
    context = modal_sandbox.RUNS[parsed.run_tag]
    assert context.outputs_dir == tmp_path / "run" / "outputs" and context.capsule == "demo"
    assert context.ledgers == [tmp_path / "run" / modal_cost.LEDGER_NAME]


def test_a_run_whose_worst_case_passes_the_cap_never_reaches_modal(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    allow(monkeypatch)
    volume = FakeVolume()
    with pytest.raises(modal_cost.ModalCapReached, match=r"cap 0\.50 USD"):
        prepare(ModalAnalyses(volume=volume, usd_cap=0.5), tmp_path, case(tmp_path))
    assert volume.files == {}
    # A day-long run passes the default per-run cap of 2 USD as well.
    with pytest.raises(modal_cost.ModalCapReached):
        prepare(ModalAnalyses(volume=volume), tmp_path, case(tmp_path), time_limit_seconds=86_400)


# --- the provider ---------------------------------------------------------------------------------
def start(cfg: BixModalConfig | None = None) -> GlhfModalSandbox:
    envs = asyncio.run(GlhfModalSandbox.sample_init("task", cfg or config(), {}))
    return envs["default"].as_type(GlhfModalSandbox)


def test_the_swarm_gets_workspace_after_the_checks_of_32(world: World) -> None:  # noqa: F811
    env = start()
    sandbox = world.sandboxes[0]
    commands = [" ".join(c) for c in sandbox.commands]
    # #32's order: place the data, probe, check the environment; then /workspace.
    assert "cp -a /mnt/bix-staged/." in commands[0] and "socket" in commands[1]
    assert "conda list" in commands[2] and glhf_modal_sandbox.MAKE_WORKSPACE in commands[3]
    assert world.created[0][1]["block_network"] is True  # the same plan and rules
    assert env.analysis_backend() == {
        "backend": "modal",
        "sandbox_id": sandbox.object_id,
        "image": "bixbench-v1-env:amd64-1",
    }


def test_the_harness_records_this_sandbox_with_every_test(
    world: World,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from bixbench3.inspect_harness.swarm import tools
    from inspect_ai.util._sandbox.events import SandboxEnvironmentProxy

    env = start()
    # Inspect hands the sandbox out behind its proxy.
    monkeypatch.setattr(tools, "sandbox", lambda: SandboxEnvironmentProxy(env))
    assert tools.sandbox_backend() == env.analysis_backend()
    assert tools.sandbox_backend()["backend"] == "modal"


def test_commands_start_in_workspace_unless_told_otherwise(world: World) -> None:  # noqa: F811
    env = start()
    seen: list[Any] = []
    real = env.sandbox.exec

    def recording(*cmd: str, **kwargs: Any) -> Any:
        seen.append(kwargs.get("workdir"))
        return real(*cmd, **kwargs)

    env.sandbox.exec = type(real)(recording)
    asyncio.run(env.exec(["ls"]))
    asyncio.run(env.exec(["ls"], cwd="/data"))
    assert seen == ["/workspace", "/data"]


def test_a_sandbox_without_workspace_is_terminated_with_its_ledger_line(
    world: World,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def refused(sandbox: Any, cmd: list[str], timeout: int) -> tuple[int, str, str]:
        return 1, "", "read-only file system"

    monkeypatch.setattr(glhf_modal_sandbox, "_raw_exec", refused)
    with pytest.raises(staging.IntegrityError, match="making /workspace failed"):
        start()
    assert world.sandboxes[0].alive is False
    (line,) = modal_cost.read(world.context.ledgers[0])
    assert line["what"] == "refused at start" and line["ok"] is False


def test_outputs_come_back_and_the_sandbox_is_terminated(world: World) -> None:  # noqa: F811
    env = start()
    asyncio.run(GlhfModalSandbox.sample_cleanup("task", config(), {"default": env}, False))
    assert (world.context.outputs_dir / "answers.json").exists()
    assert world.sandboxes[0].alive is False
    assert len(modal_cost.read(world.context.ledgers[0])) == 1


# --- the runner, with the real backend and task, and a fake Modal -----------------------------------
def test_the_runner_gives_the_task_the_modal_sandbox_and_finishes_it(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    allow(monkeypatch)
    monkeypatch.chdir(tmp_path)
    seen: dict[str, Any] = {}
    finished: list[str] = []

    def inspect_eval(task: Any, **_: Any) -> Any:
        seen["sandbox"] = task.sandbox
        raise KeyboardInterrupt  # Ctrl+C in the middle of the run

    def terminate_run(tag: str, cfg: BixModalConfig, started: float) -> list[str]:
        finished.append(tag)
        return []

    monkeypatch.setattr(glhf_local, "inspect_eval", inspect_eval)
    monkeypatch.setattr(modal_sandbox, "terminate_run", terminate_run)
    out = tmp_path / "run"
    with pytest.raises(KeyboardInterrupt):
        glhf_local.run_local(
            DEMO_CASE,
            out,
            model="mock",
            sandbox="modal",
            backend=ModalAnalyses(volume=FakeVolume()),
        )
    spec = seen["sandbox"]
    assert spec.type == "glhf_modal" and isinstance(spec.config, BixModalConfig)
    assert finished == [spec.config.run_tag]  # the last net ran after the interrupt
    recorded = json.loads((out / "run.json").read_text())["settings"]
    assert recorded["sandbox"] == "modal" and recorded["modal"]["usd_cap"] == 2.0
    assert recorded["modal"]["image"].startswith("bixbench-v1-env:")
    assert tasks.bixbench3_cases  # the real task builder made the spec above


# --- the engine's last net --------------------------------------------------------------------------
def test_terminate_ends_what_this_run_left_and_writes_its_cost(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / glhf_modal.MARKER).write_text(
        json.dumps(
            {"run_tag": "c" * 32, "app": "bixbench-v1-sandbox", "cpu": 4.0, "memory_mib": 16384,
             "prepared_at": 1000.0}
        )
    )  # fmt: skip
    asked: list[tuple[str, str | None]] = []
    ended: list[str] = []

    def live(app: str, tag: str | None = None) -> list[str]:
        asked.append((app, tag))
        return ["sb-left"]

    class Handle:
        def __init__(self, sandbox_id: str) -> None:
            self.sandbox_id = sandbox_id

        def terminate(self) -> None:
            ended.append(self.sandbox_id)

    monkeypatch.setattr(modal_sandbox, "live_sandboxes", live)
    monkeypatch.setattr(glhf_modal_sandbox.modal.Sandbox, "from_id", Handle)
    result = glhf_modal.terminate(run_dir, now=1600.0)
    assert result == {"terminated": ["sb-left"], "errors": []}
    assert asked == [("bixbench-v1-sandbox", "c" * 32)] and ended == ["sb-left"]
    (line,) = modal_cost.read(run_dir / modal_cost.LEDGER_NAME)
    assert line["seconds"] == 600.0 and line["usd"] > 0 and line["ok"] is False
    assert "upper bound" in line["seconds_source"]


def test_terminate_without_a_marker_does_nothing(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert glhf_modal.main(["terminate", "--run-dir", str(tmp_path)]) == 0
    assert json.loads(capsys.readouterr().out)["terminated"] == []
