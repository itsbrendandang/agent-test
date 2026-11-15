"""The Modal sandbox provider with a fake Modal: what it creates, when it refuses, that it always
copies the outputs out and terminates, and that the critic's sandbox is a new one. No cloud is
reached. Needs the optional packages (`uv run --group modal pytest`); skipped without them."""

from __future__ import annotations

import asyncio
import io
import json
import tarfile
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("modal")
pytest.importorskip("inspect_sandboxes")

from bixbench_v1 import modal_boundary as boundary
from bixbench_v1 import modal_cost, modal_sandbox, staging
from bixbench_v1.modal_boundary import BixModalConfig
from bixbench_v1.modal_sandbox import BixModalSandbox, RunContext, upstream

KEY = "0123456789abcdef0123456789abcdef"
GOOD = {
    "reached": [], "secret_names": [], "forbidden_files": [], "not_regular": [], "files": 2,
    "listing_sha256": "1" * 64, "content_sha256": "2" * 64, "data_writable_by_others": False,
    "volume_visible_to_others": False, "machine": "x86_64", "kernel": "4.19.0-gvisor",
}  # fmt: skip


def config(tag: str = "a" * 32) -> BixModalConfig:
    return BixModalConfig(
        run_tag=tag, image="bixbench-v1-env:amd64-1", app="bixbench-v1-sandbox",
        volume="vol", data_path=f"/{KEY}/data", files=2, listing_sha256="1" * 64,
        content_sha256="2" * 64, timeout_seconds=900, cpu=2.0, memory_mib=4096,
    )  # fmt: skip


class Method:
    """A Modal method: blocking when called, awaitable through `.aio`."""

    def __init__(self, function: Any) -> None:
        self.function = function

        async def aio(*args: Any, **kwargs: Any) -> Any:
            return function(*args, **kwargs)

        self.aio = aio

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        return self.function(*args, **kwargs)


class Stream:
    def __init__(self, text: str) -> None:
        self.read = Method(lambda: text)


class Process:
    def __init__(self, code: int, out: str, err: str = "") -> None:
        self.returncode, self.stdout, self.stderr = code, Stream(out), Stream(err)
        self.wait = Method(lambda: code)


def tgz(files: dict[str, bytes], link: str | None = None) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
        if link:
            info = tarfile.TarInfo(link)
            info.type, info.linkname = tarfile.SYMTYPE, "/etc/passwd"
            tar.addfile(info)
    return buffer.getvalue()


class FakeSandbox:
    count = 0

    def __init__(self, probe: dict[str, Any], outputs: bytes) -> None:
        FakeSandbox.count += 1
        self.object_id = f"sb-fake-{FakeSandbox.count}"
        self.probe, self.outputs = probe, outputs
        self.commands: list[list[str]] = []
        self.tags: dict[str, str] = {}
        self.alive = True
        self.exec = Method(self._exec)
        self.set_tags = Method(self._set_tags)
        self.terminate = Method(self._terminate)
        self.poll = Method(self._poll)
        self.filesystem = type("FS", (), {"read_bytes": Method(self._read_bytes)})()

    def _exec(self, *cmd: str, **kwargs: Any) -> Process:
        assert self.alive, "exec on a terminated sandbox"
        self.commands.append(list(cmd))
        text = " ".join(cmd)
        if boundary.PROBE in cmd:
            return Process(0, json.dumps(self.probe) + "\n")
        if "tar -C" in text:
            return Process(0, f"{len(self.outputs)}\n")
        return Process(0, "")

    def _set_tags(self, tags: dict[str, str]) -> None:
        self.tags = tags

    def _terminate(self, **kwargs: Any) -> None:
        self.alive = False

    def _poll(self) -> int | None:
        return None if self.alive else 137

    def _read_bytes(self, path: str) -> bytes:
        return self.outputs


class World:
    """Everything the provider asks Modal for, recorded."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        self.created: list[tuple[list[str], dict[str, Any]]] = []
        self.sandboxes: list[FakeSandbox] = []
        self.probes: list[dict[str, Any]] = []  # one per sandbox to come; default GOOD
        self.outputs: list[bytes] = []
        self.mounts: list[dict[str, Any]] = []
        self.context = RunContext(
            outputs_dir=tmp_path / "outputs",
            ledgers=[tmp_path / "run" / "modal_ledger.jsonl", tmp_path / "all.jsonl"],
            run="syn-1/glhf", capsule="syn-1", solver="glhf",
        )  # fmt: skip
        world = self

        async def create(command: list[str], kwargs: dict[str, Any]) -> FakeSandbox:
            world.created.append((command, kwargs))
            probe = world.probes.pop(0) if world.probes else GOOD
            outputs = world.outputs.pop(0) if world.outputs else tgz({"./answers.json": b"{}"})
            world.sandboxes.append(FakeSandbox(probe, outputs))
            return world.sandboxes[-1]

        async def lookup(name: str) -> Any:
            return type("App", (), {"app_id": "ap-fake", "name": name})()

        class Volume:
            def with_mount_options(self, **options: Any) -> Volume:
                world.mounts.append(options)
                return self

        monkeypatch.setattr(BixModalSandbox, "_create_sandbox", staticmethod(create))
        monkeypatch.setattr(BixModalSandbox, "_lookup_app", staticmethod(lookup))
        monkeypatch.setattr(
            modal_sandbox.modal.Image,
            "from_name",
            lambda name: type("I", (), {"object_id": "im-fake"})(),
        )
        monkeypatch.setattr(modal_sandbox.modal.Volume, "from_name", lambda name: Volume())
        upstream.sandbox_cleanup_startup()
        modal_sandbox.RUNS.clear()
        modal_sandbox.register_run("a" * 32, self.context)


@pytest.fixture
def world(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> World:
    return World(monkeypatch, tmp_path)


def start(cfg: BixModalConfig | None = None) -> BixModalSandbox:
    envs = asyncio.run(BixModalSandbox.sample_init("task", cfg or config(), {}))
    return envs["default"].as_type(BixModalSandbox)


def test_a_sandbox_is_created_from_the_plan_and_probed_before_use(world: World) -> None:
    env = start()
    command, kwargs = world.created[0]
    assert command == ["sleep", "infinity"]
    boundary.check_create_kwargs(kwargs)
    assert kwargs["block_network"] is True and kwargs["timeout"] == 900
    assert kwargs["cpu"] == (2.0, 2.0) and kwargs["memory"] == (4096, 4096)
    assert list(kwargs["volumes"]) == ["/mnt/bix-staged"] and kwargs["workdir"] == "/home"
    assert not {"env", "secrets", "encrypted_ports", "unencrypted_ports"} & set(kwargs)
    assert world.mounts == [{"read_only": True, "sub_path": f"/{KEY}/data"}]
    sandbox = world.sandboxes[0]
    assert sandbox.tags == {"created_by": "inspect-ai", "bixbench_v1_run": "a" * 32}
    # The data is placed and the probe has run before the solver gets the sandbox.
    assert boundary.PLACE_DATA in sandbox.commands[0] and boundary.PROBE in sandbox.commands[1]
    assert world.context.probes[0]["sandbox"] == sandbox.object_id
    assert world.context.image_id == "im-fake" and env.sandbox is sandbox


@pytest.mark.parametrize(
    "finding",
    [
        {"reached": ["tcp 1.1.1.1:443"]},
        {"secret_names": ["OPENAI_API_KEY"]},
        {"content_sha256": "9" * 64},
        {"files": 0, "listing_sha256": "0" * 64},
        {"forbidden_files": ["/data/BixBench.jsonl"]},
    ],
)
def test_a_sandbox_that_fails_the_probe_is_terminated_and_the_run_stops(
    world: World, finding: dict[str, Any]
) -> None:
    world.probes.append(GOOD | finding)
    with pytest.raises(staging.IntegrityError, match="Modal sandbox refused"):
        start()
    assert world.sandboxes[0].alive is False
    lines = modal_cost.read(world.context.ledgers[0])
    assert len(lines) == 1 and lines[0]["ok"] is False and lines[0]["what"] == "refused at start"


def test_commands_run_as_the_role_user_with_its_home_and_a_clean_environment(world: World) -> None:
    env = start()
    asyncio.run(env.exec(["id", "-un"], user="deriv_a"))
    asyncio.run(env.exec(["id", "-un"]))
    as_user, as_root = world.sandboxes[0].commands[-2:]
    script = as_user[-1]  # the provider's `su` wrapper: one shell script
    assert as_user[:2] == ["/bin/sh", "-c"] and '-- "$u"' in script and "deriv_a" in script
    assert "getent passwd" in script and "HOME" in script  # HOME is set to the user's home
    assert "/usr/bin/env -u PYTHONHASHSEED" in script and "-u MODAL_SANDBOX_ID" in script
    assert as_root[0] == "/usr/bin/env" and as_root[-2:] == ["id", "-un"]
    assert "getent" not in " ".join(as_root)  # root keeps its own HOME


def test_the_critic_gets_a_new_sandbox_and_the_old_one_is_terminated(world: World) -> None:
    env = start()
    first = world.sandboxes[0]
    first.outputs = tgz({"./deriv_a/analysis.py": b"print('analyst')"})
    asyncio.run(env.fresh_sandbox(keep=["/outputs/glhf/work"]))
    second = world.sandboxes[1]
    assert env.sandbox is second and second.alive and not first.alive
    assert world.created[1] == world.created[0] or world.created[1][1]["timeout"] == 900
    boundary.check_create_kwargs(world.created[1][1])  # same rules for the second sandbox
    assert boundary.PROBE in second.commands[1]  # and it is probed like the first
    # The analyst's scripts are held on the host; nothing was written into the new sandbox.
    assert world.context.held == [("glhf/work/deriv_a/analysis.py", b"print('analyst')")]
    assert not any("analysis.py" in " ".join(c) for c in second.commands)
    lines = modal_cost.read(world.context.ledgers[0])
    assert [line["sandbox_id"] for line in lines] == [first.object_id]
    # At the end the outputs of the second sandbox and the held scripts are both on the host.
    second.outputs = tgz({"./answers.json": b'{"answers": {}}', "./glhf/work/deriv_b/b.py": b"1"})
    asyncio.run(BixModalSandbox.sample_cleanup("task", config(), {"default": env}, False))
    out = world.context.outputs_dir
    assert (out / "glhf/work/deriv_a/analysis.py").read_bytes() == b"print('analyst')"
    assert (out / "glhf/work/deriv_b/b.py").exists() and (out / "answers.json").exists()
    assert not second.alive and len(modal_cost.read(world.context.ledgers[1])) == 2


def test_a_new_sandbox_that_is_not_clean_is_not_used(world: World) -> None:
    env = start()
    first = world.sandboxes[0]
    world.probes.append(GOOD | {"reached": ["dns pypi.org"]})
    with pytest.raises(staging.IntegrityError):
        asyncio.run(env.fresh_sandbox(keep=[]))
    assert env.sandbox is first and world.sandboxes[1].alive is False  # the bad one is gone


@pytest.mark.parametrize("interrupted", [False, True])
def test_outputs_are_copied_out_and_the_sandbox_terminated_also_when_interrupted(
    world: World, interrupted: bool
) -> None:
    env = start()
    asyncio.run(BixModalSandbox.sample_cleanup("task", config(), {"default": env}, interrupted))
    assert (world.context.outputs_dir / "answers.json").read_bytes() == b"{}"
    assert world.sandboxes[0].alive is False and world.context.copied_out is True
    lines = modal_cost.read(world.context.ledgers[0])
    assert len(lines) == 1 and lines[0]["capsule"] == "syn-1" and lines[0]["solver"] == "glhf"
    assert lines[0]["what"] == ("interrupted" if interrupted else "run ended")
    assert lines[0]["resource"] == {"cpu": 2.0, "memory_gib": 4.0, "gpu": None}
    assert upstream.running_sandboxes() == []  # nothing left for the task-level cleanup
    asyncio.run(BixModalSandbox.sample_cleanup("task", config(), {"default": env}, interrupted))
    assert len(modal_cost.read(world.context.ledgers[0])) == 1  # closing twice does nothing


def test_a_hostile_outputs_archive_writes_nothing_and_the_sandbox_is_still_terminated(
    world: World, tmp_path: Path
) -> None:
    world.outputs.append(tgz({"./answers.json": b"{}"}, link="./glhf"))
    env = start()
    asyncio.run(BixModalSandbox.sample_cleanup("task", config(), {"default": env}, False))
    assert not list(world.context.outputs_dir.rglob("*")) and world.context.copied_out is False
    assert "copying /outputs out failed" in world.context.errors[0]
    assert world.sandboxes[0].alive is False
    assert modal_sandbox.summary("a" * 32)["outputs_copied"] is False


def test_the_run_level_net_terminates_what_is_still_alive_by_tag(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    start()
    left = world.sandboxes[0]
    seen: dict[str, Any] = {}

    def listing(**kwargs: Any) -> Any:
        seen.update(kwargs)
        return iter(world.sandboxes)

    monkeypatch.setattr(modal_sandbox.modal.Sandbox, "list", listing)
    monkeypatch.setattr(
        modal_sandbox.modal.App,
        "lookup",
        lambda name, **kw: type("App", (), {"app_id": "ap-fake"})(),
    )
    ended = modal_sandbox.terminate_run("a" * 32, config(), started=0.0)
    assert ended == [left.object_id] and left.alive is False
    assert seen == {"app_id": "ap-fake", "tags": {"bixbench_v1_run": "a" * 32}}
    line = modal_cost.read(world.context.ledgers[0])[-1]
    assert line["ok"] is False and "left over" in line["what"]
    assert modal_sandbox.terminate_run("a" * 32, config(), started=0.0) == []  # nothing twice


def test_a_sandbox_that_something_else_terminated_still_gets_its_ledger_line(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    # After Ctrl+C Inspect's own task cleanup may terminate the sandbox before our code ran.
    start()
    gone = world.sandboxes[0]
    gone.alive = False
    monkeypatch.setattr(modal_sandbox.modal.Sandbox, "list", lambda **kw: iter([]))
    monkeypatch.setattr(modal_sandbox.modal.Sandbox, "from_id", lambda sandbox_id: gone)
    monkeypatch.setattr(
        modal_sandbox.modal.App,
        "lookup",
        lambda name, **kw: type("App", (), {"app_id": "ap-fake"})(),
    )
    assert modal_cost.read(world.context.ledgers[0]) == []
    assert modal_sandbox.terminate_run("a" * 32, config(), started=0.0) == [gone.object_id]
    (line,) = modal_cost.read(world.context.ledgers[0])
    assert line["sandbox_id"] == gone.object_id and "without a ledger line" in line["what"]
    assert line["usd"] >= 0 and line["ok"] is False
    assert modal_sandbox.terminate_run("a" * 32, config(), started=0.0) == []


def test_cleanup_does_not_depend_on_the_cancelled_task(world: World) -> None:
    # Closing uses Modal's blocking calls: an awaited call would be cancelled with the sample.
    env = start()

    async def cancelled_sample() -> None:
        task = asyncio.current_task()
        assert task is not None
        task.cancel()  # what Ctrl+C does to the sample's task
        try:
            await asyncio.sleep(0)
        except asyncio.CancelledError:
            await BixModalSandbox.sample_cleanup("task", config(), {"default": env}, True)
            raise

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(cancelled_sample())
    assert world.sandboxes[0].alive is False and world.context.copied_out is True
    assert modal_cost.read(world.context.ledgers[0])[0]["what"] == "interrupted"


def test_a_plan_that_opens_the_boundary_never_reaches_modal(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Whatever builds the arguments, they are checked right before Sandbox.create.
    real = boundary.sandbox_plan
    for change in ({"block_network": False}, {"cpu": (2.0, 64.0)}, {"timeout": None}):
        monkeypatch.setattr(boundary, "sandbox_plan", lambda cfg, change=change: real(cfg) | change)
        with pytest.raises(ValueError, match="BixBench sandbox"):
            start()
    assert world.created == []


def test_only_a_typed_config_starts_a_sandbox(world: World) -> None:
    for bad in (None, "compose.yaml", {"image": "x"}):
        with pytest.raises(ValueError, match="BixModalConfig"):
            asyncio.run(BixModalSandbox.sample_init("task", bad, {}))  # type: ignore[arg-type]
    assert world.created == [] and BixModalSandbox.config_files() == []
