"""Nothing in these tests reaches the network or Modal. The paid switch is as a person who set
nothing has it (on); a test of paid-allowed logic sets NO_PAID_CALLS=0 itself and uses fakes."""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import httpx
import pytest
from bixbench3 import paid as switch
from bixbench_v1 import paid
from helpers import KEY, QWEN, REPO_REGISTRY, Clock, FakeEndpoint, FakeModal

from openmodels import grid, ledger


@pytest.fixture(autouse=True)
def clean(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> list[str]:
    monkeypatch.delenv(paid.SWITCH, raising=False)
    monkeypatch.setattr(switch, "REPO_ENV", tmp_path / "no-such.env")
    monkeypatch.chdir(tmp_path)
    sent: list[str] = []

    def refuse(self: Any, request: httpx.Request, **_: Any) -> Any:
        sent.append(str(request.url))
        raise AssertionError(f"a test tried to reach the network: {request.url}")

    monkeypatch.setattr(httpx.Client, "send", refuse)
    monkeypatch.setattr(httpx.AsyncClient, "send", refuse)
    return sent


@pytest.fixture
def allowed(monkeypatch: pytest.MonkeyPatch) -> None:
    """Paid calls allowed, for a test that uses fakes only."""
    monkeypatch.setenv(paid.SWITCH, "0")


@pytest.fixture
def world(tmp_path: Path) -> dict[str, Any]:
    """A grid plan in a temporary runs folder with fakes for Modal, the endpoint and the harness."""
    modal, endpoint, clock = FakeModal(), FakeEndpoint(), Clock()
    said: list[str] = []
    harness_calls: list[tuple[list[str], dict[str, str]]] = []
    plan = grid.Plan(
        name="t", capsules=("bix-1_aaaa", "bix-2_bbbb"), question_counts={"bix-1_aaaa": 2, "bix-2_bbbb": 3},
        runs_root=tmp_path / "runs",
    )  # fmt: skip

    def harness(command: Sequence[str], env: dict[str, str]) -> int:
        harness_calls.append((list(command), dict(env)))
        clock.now += 600  # the runs take ten minutes
        out = Path(command[command.index("--out") + 1])
        for capsule in plan.capsules:
            for solver in plan.solvers:
                (out / capsule / solver).mkdir(parents=True, exist_ok=True)
                (out / capsule / solver / "run.json").write_text(json.dumps({"status": "done"}))
        return 0

    deps = grid.Deps(
        shell=modal, http=endpoint, harness=harness, clock=clock, sleep=clock.sleep,
        load_key=lambda: KEY, guard=ledger.Guard(cap_usd=20.0, path=tmp_path / "runs" / "modal_ledger.jsonl"),
        cumulative=tmp_path / "runs" / "modal_ledger.jsonl", open_sessions=tmp_path / "runs" / "open.json",
        say=said.append,
    )  # fmt: skip
    return {"modal": modal, "endpoint": endpoint, "clock": clock, "plan": plan, "deps": deps,
            "harness_calls": harness_calls, "said": said, "registry": REPO_REGISTRY, "model": QWEN}  # fmt: skip
