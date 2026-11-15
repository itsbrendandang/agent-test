"""End-to-end test of the claims engine: a scripted model plays each role on each claim against the
demo case in a real Docker sandbox, and the official grader scores the result.

It proves the orchestration (triage, pilot, workup, review, send-back, the Finisher and the Scout as
code, the Board's files, the ablation switches), not the science. Skipped when Docker is not running.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

from bixbench3.glhf_local import run_local

DEMO_CASE = Path(__file__).parents[3] / "demo_case"


def _docker_running() -> bool:
    if shutil.which("docker") is None:
        return False
    return subprocess.run(["docker", "info"], capture_output=True, check=False).returncode == 0


pytestmark = pytest.mark.skipif(not _docker_running(), reason="Docker is not running")


def _events(out: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in (out / "events.jsonl").read_text().splitlines()]


def _states(out: Path) -> dict[str, str]:
    return {c["id"]: c["state"] for c in json.loads((out / "board.json").read_text())["claims"]}


def test_one_claim_dead_on_arrival_one_supported_after_a_send_back(tmp_path: Path) -> None:
    summary = run_local(DEMO_CASE, tmp_path, solver="glhf", model="mock", engine="claims")
    assert summary["status"] == "done", summary["error"]
    assert summary["score"] == 1.0, "the Finisher (code) copied the supported claim's files"
    assert _states(tmp_path) == {"C1": "supported", "C2": "rejected"}

    board = json.loads((tmp_path / "board.json").read_text())
    c1 = next(c for c in board["claims"] if c["id"] == "C1")
    assert [h["to_state"] for h in c1["history"]] == [
        "piloting",
        "in_workup",
        "under_review",
        "sent_back",
        "in_workup",
        "under_review",
        "supported",
    ]
    assert c1["acuity"] == "high"

    rejected = json.loads((tmp_path / "rejections.json").read_text())
    assert [(r["claim"], r["stage"]) for r in rejected] == [("C2", "pilot")]
    assert "shape check" in rejected[0]["reason"] and rejected[0]["evidence"]["contract"]

    # The ledger agrees: the verdicts were computed by code, the issue was fixed and rechecked.
    ledger = json.loads((tmp_path / "ledger.json").read_text())
    verdicts = {c["id"]: c["verdict"] for c in ledger["claims"]}
    assert verdicts["C1"] == "supported"
    assert [(i["id"], i["status"], i["claim_ids"]) for i in ledger["issues"]] == [
        ("I1", "fixed", ["C1"])
    ]
    kinds = {e["kind"] for e in ledger["events"]}
    assert {"scout.code", "claims.finished", "finish.assembled"} <= kinds

    events = _events(tmp_path)
    calls = [(e["claim_id"], e["mode"]) for e in events if e["kind"] == "agent.call"]
    assert ("C2", "pilot") in calls and not any(c == "C2" and m != "pilot" for c, m in calls)
    assert ("C1", "revise 1") in calls
    assembled = next(e for e in events if e["kind"] == "finish.assembled")["artifacts"]
    assert all(a["from"] == "C1" for a in assembled)

    # The outputs bundle holds the Board's files, and FINDINGS.md its claims and rejection log.
    glhf = tmp_path / "outputs" / "glhf"
    assert json.loads((glhf / "board.json").read_text())["claims"] == board["claims"]
    findings = (glhf / "FINDINGS.md").read_text()
    assert "## Rejection log" in findings and "C2 (pilot)" in findings
    assert summary["settings"]["engine"] == "claims"


@pytest.mark.parametrize(
    ("flag", "expected"),
    [
        ("no_pilot", {"C1": "supported", "C2": "not_established"}),
        ("no_auditor", {"C1": "supported", "C2": "rejected"}),
        ("no_critic", {"C1": "not_established", "C2": "rejected"}),
        ("no_retriage", {"C1": "supported", "C2": "rejected"}),
    ],
)
def test_each_ablation_runs_to_the_end_and_is_logged(
    tmp_path: Path, flag: str, expected: dict[str, str]
) -> None:
    summary = run_local(
        DEMO_CASE, tmp_path, solver="glhf", model="mock", engine="claims", **{flag: True}
    )
    assert summary["status"] == "done", summary["error"]
    assert _states(tmp_path) == expected
    events = _events(tmp_path)
    flags = next(e for e in events if e["kind"] == "flags")
    assert flags[flag.removeprefix("no_")] is False
    assert summary["settings"]["ablations"][flag] is True
    roles = {e["role"] for e in events if e["kind"] == "agent.call"}
    if flag == "no_critic":
        assert "critic" not in roles
    if flag == "no_auditor":
        assert "auditor" not in roles
    if flag == "no_pilot":
        assert not any(e["mode"] == "pilot" for e in events if e["kind"] == "agent.call")
    if flag == "no_retriage":
        assert all(not e["enabled"] for e in events if e["kind"] == "retriage")


def test_a_token_budget_is_kept(tmp_path: Path) -> None:
    summary = run_local(
        DEMO_CASE, tmp_path, solver="glhf", model="mock", engine="claims", max_tokens=400_000
    )
    assert summary["status"] == "done", summary["error"]
    used = sum(u["total_tokens"] for u in summary["usage"].values())
    assert used <= 400_000
    allocated = next(e for e in _events(tmp_path) if e["kind"] == "budget.allocated")
    assert 0 < allocated["pool_tokens"] < 400_000, "the reserves are not in the claims' pool"


def test_claim_calls_with_token_usage_are_booked_one_by_one(tmp_path: Path) -> None:
    """Every scripted answer reports tokens, so the budget is tested with real spend: claims run
    two at a time, each call's own token limit counts it apart, each call is booked in the run's
    TokenBook as it ends, and the relevance judge, settled between claim calls, pays only its own
    tokens."""
    summary = run_local(
        DEMO_CASE,
        tmp_path,
        solver="glhf",
        model="mock",
        engine="claims",
        max_tokens=1_000_000,  # covers every phase's floor, so the relevance judge runs
        max_parallel=2,
        mock_tokens_per_call=2_000,
    )
    assert summary["status"] == "done", summary["error"]
    assert summary["score"] == 1.0
    used = sum(u["total_tokens"] for u in summary["usage"].values())
    assert 0 < used <= 1_000_000, (
        "the run stays within max_tokens (the 1.15x backstop is never near)"
    )

    calls = [e for e in _events(tmp_path) if e["kind"] == "agent.call"]
    ran = [e for e in calls if e["outcome"] in ("ok", "failed")]
    assert ran and all(e["tokens"] > 0 and e["tokens"] % 2_000 == 0 for e in ran)

    ledger = json.loads((tmp_path / "outputs" / "glhf" / "ledger.json").read_text())
    events = ledger["events"]
    settled = [e for e in events if e["kind"] == "claims.settled"]
    assert sum(e["spent"] for e in settled) == sum(e["tokens"] for e in calls), (
        "each claim call is booked once, with the tokens its own limit counted"
    )
    assert not [e for e in events if e["kind"] == "claims.drift"], "the book matches the run"
    judged = [
        e
        for e in events
        if e["kind"] == "budget.settled" and str(e["phase"]).startswith("relevance")
    ]
    assert judged and all(e["overshoot"] == 0 and not e["borrowed"] for e in judged)
    assert max(e["used"] for e in events if "used" in e and e["kind"].endswith("settled")) <= used
