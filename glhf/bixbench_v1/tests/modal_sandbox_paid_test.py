"""`--sandbox modal` behind the NO_PAID_CALLS switch.

A Modal sandbox is billed by the second, so with the switch on (the default) the option is
refused before anything starts: no capsule is selected, no Volume is touched, the `modal`
package is not even imported. The same holds for a direct call of `run_capsule(sandbox="modal")`
and for the image commands. Each case is run again with the switch off against the same spies,
which shows the switch is what stopped it. Nothing here can spend or reach the network: the
Volume is a fake, and importing `modal` is made to fail.
"""

from __future__ import annotations

import builtins
import json
import sys
from pathlib import Path
from typing import Any

import pytest
from bixbench3 import paid as switch
from conftest import Synthetic
from modal_sandbox_boundary_test import FakeVolume, staged_capsule

import bixbench_v1
from bixbench_v1 import cli, modal_cost, modal_image, modal_run, paid, runner


class Reached(Exception):
    """A spy was reached: the code got past the switch."""


@pytest.fixture(autouse=True)
def clean(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """The switch as a person who set nothing has it; fake provider keys; no Modal import."""
    monkeypatch.delenv(paid.SWITCH, raising=False)
    monkeypatch.setattr(switch, "REPO_ENV", tmp_path / "no-such.env")
    monkeypatch.chdir(tmp_path)
    for key in paid.PAID_KEYS:
        monkeypatch.setenv(key, "fake-key-for-tests")
    real_import = builtins.__import__

    def no_modal(name: str, *args: Any, **kwargs: Any) -> Any:
        if name == "modal" or name.startswith(("modal.", "inspect_sandboxes")):
            raise Reached(f"import {name}")
        return real_import(name, *args, **kwargs)

    for name in [
        m for m in sys.modules if m == "modal" or m.startswith(("modal.", "inspect_sandboxes"))
    ]:
        monkeypatch.delitem(sys.modules, name)
    monkeypatch.delitem(sys.modules, "bixbench_v1.modal_sandbox", raising=False)
    monkeypatch.delattr(bixbench_v1, "modal_sandbox", raising=False)
    monkeypatch.setattr(builtins, "__import__", no_modal)


@pytest.fixture
def reached(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    seen: list[str] = []

    def run_capsule(*_: Any, **arguments: Any) -> Any:
        seen.append(f"run sandbox={arguments['sandbox']}")
        raise Reached("run")

    def selected(arguments: Any) -> Any:
        seen.append("capsules")
        raise Reached("capsules")

    monkeypatch.setattr(cli, "run_capsule", run_capsule)
    monkeypatch.setattr(cli, "_selected", selected)
    monkeypatch.setattr(cli, "load_env", lambda path: [])
    return seen


def command(monkeypatch: pytest.MonkeyPatch, *argv: str) -> None:
    monkeypatch.setattr("sys.argv", ["bixbench-v1", *argv])
    cli.main()


def test_the_modal_sandbox_is_refused_while_the_switch_is_on(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, reached: list[str]
) -> None:
    out = tmp_path / "runs"
    base = ("run", "--capsules", "bix-1", "--out", str(out), "--model", "mock")
    for value in (None, "1", "", "false", "00"):  # anything but exactly "0" keeps it on
        if value is not None:
            monkeypatch.setenv(paid.SWITCH, value)
        with pytest.raises(SystemExit) as stopped:
            command(monkeypatch, *base, "--sandbox", "modal")
        message = str(stopped.value.code)
        assert "NO_PAID_CALLS" in message and "Modal" in message and "--sandbox modal" in message
    # Refused before a capsule was selected, a folder made or a run started.
    assert reached == [] and not out.exists()
    # The default sandbox is untouched by the switch: the scripted Docker run goes on.
    with pytest.raises(Reached):
        command(monkeypatch, *base)
    assert reached == ["capsules"]
    # With the switch off the same Modal command gets as far as selecting the capsules.
    monkeypatch.setenv(paid.SWITCH, "0")
    reached.clear()
    with pytest.raises(Reached):
        command(monkeypatch, *base, "--sandbox", "modal")
    assert reached == ["capsules"]


def test_only_docker_and_modal_are_sandboxes_and_docker_is_the_default(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, reached: list[str]
) -> None:
    with pytest.raises(SystemExit):
        command(
            monkeypatch, "run", "--capsules", "x", "--out", str(tmp_path / "o"), "--sandbox", "e2b"
        )
    assert runner.SANDBOXES == ("docker", "modal")
    monkeypatch.setattr(cli, "_selected", lambda arguments: [])  # no capsule: parse only
    monkeypatch.setattr("sys.argv", ["bixbench-v1", "run", "--all", "--out", str(tmp_path / "o")])
    monkeypatch.setattr(cli, "_write_report", lambda *a, **k: None)
    assert cli.main() == 0


def test_a_direct_modal_run_is_refused_before_the_volume_is_touched(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, synthetic: Synthetic
) -> None:
    data_dir, manifest = staged_capsule(synthetic)
    volume = FakeVolume()
    arguments: dict[str, Any] = dict(
        data_dir=data_dir, manifest=manifest, outputs_dir=tmp_path / "outputs",
        run_dir=tmp_path / "run", run_name="syn-1/single", capsule="syn-1", solver="single",
        time_limit_seconds=300, backstop_seconds=180, volume=volume,
    )  # fmt: skip
    with pytest.raises(paid.PaidCallsOff, match="NO_PAID_CALLS"):
        modal_run.prepare(**arguments)
    assert volume.files == {} and volume.uploads == 0
    # run_capsule itself: the same refusal, after local staging and before any sandbox.
    with pytest.raises(paid.PaidCallsOff, match="Modal"):
        runner.run_capsule(
            synthetic.capsule, hub_dir=synthetic.hub, staged_root=synthetic.staged,
            out_dir=tmp_path / "direct", solver="single", model="mock", sandbox="modal",
        )  # fmt: skip
    assert not list((synthetic.staged.parent / "mounts").iterdir())  # the neutral folder is gone
    # Switch off: the guard lets it through, as far as the import of Modal (the spy).
    monkeypatch.setenv(paid.SWITCH, "0")
    with pytest.raises(Reached, match="import modal"):
        modal_run.prepare(**arguments)


def test_without_the_optional_packages_the_option_says_what_to_install(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, synthetic: Synthetic
) -> None:
    monkeypatch.setenv(paid.SWITCH, "0")
    real_import = builtins.__import__

    def not_installed(name: str, *args: Any, **kwargs: Any) -> Any:
        if name == "modal":
            raise ModuleNotFoundError("No module named 'modal'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", not_installed)
    data_dir, manifest = staged_capsule(synthetic)
    volume = FakeVolume()
    with pytest.raises(RuntimeError, match="uv run --group modal"):
        modal_run.prepare(
            data_dir=data_dir, manifest=manifest, outputs_dir=tmp_path / "outputs",
            run_dir=tmp_path / "run", run_name="syn-1/single", capsule="syn-1", solver="single",
            time_limit_seconds=300, backstop_seconds=180, volume=volume,
        )  # fmt: skip
    assert volume.uploads == 0


def test_the_folder_cap_stops_a_modal_run_before_the_volume_is_touched(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, synthetic: Synthetic
) -> None:
    monkeypatch.setenv(paid.SWITCH, "0")
    data_dir, manifest = staged_capsule(synthetic)
    volume = FakeVolume()
    shared = tmp_path / "out" / modal_cost.LEDGER_NAME
    modal_cost.append(
        [shared], modal_cost.sandbox_line(seconds=1, cpu=1, memory_mib=1024, what="x", usd=0.99)
    )
    with pytest.raises(modal_cost.ModalCapReached, match=r"cap 1\.00"):
        modal_run.prepare(
            data_dir=data_dir, manifest=manifest, outputs_dir=tmp_path / "outputs",
            run_dir=tmp_path / "out" / "syn-1" / "glhf", run_name="syn-1/glhf", capsule="syn-1",
            solver="glhf", time_limit_seconds=300, backstop_seconds=180, volume=volume,
            ledgers=[shared], usd_cap=1.0,
        )  # fmt: skip
    assert volume.uploads == 0


def test_building_and_listing_the_image_are_refused_while_the_switch_is_on(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for call in (modal_image.build, modal_image.inventory):
        with pytest.raises(paid.PaidCallsOff, match="NO_PAID_CALLS"):
            call()
    monkeypatch.setenv(paid.SWITCH, "0")
    for call in (modal_image.build, modal_image.inventory):
        with pytest.raises(Reached, match="import modal"):  # past the guard, at the spy
            call()


def test_comparing_the_two_inventories_needs_no_modal_and_no_switch() -> None:
    official = json.loads((modal_image.EVIDENCE / "arm64-official.inventory.json").read_text())
    ours = json.loads((modal_image.EVIDENCE / "amd64-modal.inventory.json").read_text())
    result = modal_image.diff(official, ours)
    assert result["python"]["official"] == result["python"]["modal"]
    assert result["official"]["machine"] == "aarch64" and result["modal"]["machine"] == "x86_64"
    assert "Conda packages" in modal_image.diff_markdown(result)


def test_build_refuses_another_image_builder_version_before_modal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Paid calls on (a fake: it ends before Modal is imported, so nothing is reached)."""
    from bixbench_v1 import modal_image

    monkeypatch.setenv("NO_PAID_CALLS", "0")
    monkeypatch.setenv("MODAL_IMAGE_BUILDER_VERSION", "2024.10")
    real_import = builtins.__import__

    def no_modal(name: str, *args: Any, **kwargs: Any) -> Any:
        if name == "modal":
            raise AssertionError("build imported Modal")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", no_modal)
    with pytest.raises(SystemExit, match=modal_image.IMAGE_BUILDER_VERSION):
        modal_image.build()
