"""End-to-end smoke test of the GLHF swarm: a scripted model plays every role against the demo
case in a real Docker sandbox, and the official grader scores the result.

It proves the orchestration (phases, ledger, critique/revise loop, reporting), not the science.
Skipped when Docker is not running.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from inspect_ai.log import read_eval_log
from inspect_ai.model import ModelOutput, ModelUsage

from bixbench3.glhf_local import _call, _done, _write, run_local

DEMO_CASE = Path(__file__).parents[3] / "demo_case"


def _docker_running() -> bool:
    if shutil.which("docker") is None:
        return False
    return subprocess.run(["docker", "info"], capture_output=True, check=False).returncode == 0


pytestmark = pytest.mark.skipif(not _docker_running(), reason="Docker is not running")


def test_swarm_rejects_a_bad_artifact_then_reports(tmp_path: Path) -> None:
    summary = run_local(DEMO_CASE, tmp_path, solver="glhf", model="mock")
    assert summary["status"] == "done", summary["error"]
    # The official deterministic grader accepts the revised artifacts.
    assert summary["score"] == 1.0
    outputs = tmp_path / "outputs"

    ledger = json.loads((outputs / "glhf" / "ledger.json").read_text())
    assert {c["id"]: c["verdict"] for c in ledger["claims"]} == {"C1": "supported", "C2": "refuted"}
    assert [(i["id"], i["status"]) for i in ledger["issues"]] == [("I1", "fixed")]
    phases = [e["phase"] for e in ledger["events"] if e["kind"] == "phase.started"]
    assert phases == [
        "scout",
        "propose",
        "pilot",
        "experiment",
        "audit 1",
        "critique 1",
        "revise 1",
        "audit 2",
        "critique 2",
        "report",
    ]  # no "finish": every artifact passed the shape check after review
    assert any(e["kind"] == "review.converged" for e in ledger["events"])

    findings = (outputs / "glhf" / "FINDINGS.md").read_text()
    assert "Supported findings (1)" in findings and "Rejected claims (1)" in findings
    assert "has a header and no rows." in findings
    assert (outputs / "METHODS.md").exists()

    # Every role's work is in the sample transcript, which is what the process judge reads,
    # and the shell tool ran inside the sandbox.
    log = read_eval_log(str(next((tmp_path / "logs").glob("*.eval"))))
    assert log.samples is not None
    messages = log.samples[0].messages
    transcript = "\n".join(str(m.content) for m in messages)
    for phase in phases:
        assert f"GLHF phase: {phase}" in transcript
    assert "reads.tsv" in transcript


def test_single_agent_baseline_runs_on_the_same_case(tmp_path: Path) -> None:
    summary = run_local(DEMO_CASE, tmp_path, solver="single", model="mock")
    assert summary["status"] == "done", summary["error"]
    assert summary["score"] == 1.0
    assert not (tmp_path / "outputs" / "glhf").exists()


def test_finisher_rescues_an_artifact_left_broken(tmp_path: Path) -> None:
    # With review switched off, the scripted first pass leaves one artifact with no rows.
    summary = run_local(DEMO_CASE, tmp_path, solver="glhf", model="mock", review_rounds=0)
    assert summary["status"] == "done", summary["error"]
    ledger = json.loads((tmp_path / "outputs" / "glhf" / "ledger.json").read_text())
    phases = [e["phase"] for e in ledger["events"] if e["kind"] == "phase.started"]
    assert phases == ["scout", "propose", "pilot", "experiment", "finish", "report"]
    assert summary["score"] == 1.0


def _spend(output: ModelOutput, tokens: int) -> ModelOutput:
    """A scripted model call that reports `tokens` used, so token budgets can be tested."""
    output.usage = ModelUsage(input_tokens=tokens - 1, output_tokens=1, total_tokens=tokens)
    return output


def _busy(tokens: int) -> ModelOutput:
    return _spend(_call("python", code="print('working')"), tokens)


def test_swarm_token_budget_skips_phases_and_still_reports(tmp_path: Path) -> None:
    methods = _write("/outputs/METHODS.md", "# Methods\n\nBudget ran out before any artifact.\n")
    outputs = [
        _spend(_done("inputs listed"), 1000),  # scout: over its 5% share after one call
        _spend(_done("planned"), 1000),  # proposer: over its 8% share
        _spend(_done("pilot done"), 1000),  # pilot: within its 15% share, completes
        *[_busy(1000) for _ in range(7)],  # experimenter: spends the rest, is cut off
        _spend(methods, 400),  # reporter: runs on the 10% reserve
        _spend(_done("reported"), 400),
    ]
    summary = run_local(
        DEMO_CASE, tmp_path, solver="glhf", model="mock", max_tokens=10_000, mock_outputs=outputs
    )
    assert summary["status"] == "done", summary["error"]
    ledger = json.loads((tmp_path / "outputs" / "glhf" / "ledger.json").read_text())
    events = ledger["events"]
    started = [e["phase"] for e in events if e["kind"] == "phase.started"]
    assert started == ["scout", "propose", "pilot", "experiment", "report"]
    hit = {e["phase"]: e["limit"] for e in events if e["kind"] == "phase.finished"}
    assert hit == {
        "scout": "token",
        "propose": "token",
        "pilot": None,
        "experiment": "token",
        "report": None,
    }
    allowed = {e["phase"]: e["tokens_allowed"] for e in events if e["kind"] == "phase.started"}
    assert allowed == {
        "scout": 500,
        "propose": 800,
        "pilot": 1500,
        "experiment": 6000,
        "report": 1000,
    }
    skipped = [(e["phase"], e["reason"]) for e in events if e["kind"] == "phase.skipped"]
    assert skipped == [("audit 1", "tokens"), ("critique 1", "tokens"), ("finish", "tokens")]
    # No review ran, so the ledger must not claim that the review converged.
    assert not any(e["kind"] == "review.converged" for e in events)
    assert [e["reason"] for e in events if e["kind"] == "review.incomplete"] == [
        "critic did not run (no budget left)"
    ]
    assert (tmp_path / "outputs" / "METHODS.md").exists()  # the run still ends documented
    assert summary["score"] == 0.0
    settings = summary["settings"]
    assert (
        settings["max_tokens"] == 10_000 and "reporter always runs" in settings["token_semantics"]
    )
    # Each role was told its own slice, not the whole run's limit.
    log = read_eval_log(str(next((tmp_path / "logs").glob("*.eval"))))
    assert log.samples is not None
    transcript = "\n".join(str(m.content) for m in log.samples[0].messages)
    assert "Your budget for this phase" in transcript and "500 tokens" in transcript


def test_a_critic_cut_off_with_nothing_raised_is_not_convergence(tmp_path: Path) -> None:
    methods = _write("/outputs/METHODS.md", "# Methods\n\nNo artifact was produced.\n")
    outputs = [
        _spend(_done("inputs listed"), 100),  # scout
        _spend(_done("planned"), 100),  # proposer
        _spend(_done("pilot done"), 100),  # pilot
        _spend(_done("first pass"), 100),  # experimenter
        _spend(_done("no deviations"), 100),  # auditor, round 1
        _busy(1500),  # critic, round 1: cut off by its 20% token share, nothing raised
        _busy(1500),
        _spend(_done("no deviations"), 100),  # auditor, round 2
        _spend(_done("no issues"), 100),  # critic, round 2: completes
        _spend(_done("nothing to rescue from"), 100),  # finisher (the artifacts are missing)
        _spend(methods, 100),  # reporter
        _spend(_done("reported"), 100),
    ]
    summary = run_local(
        DEMO_CASE, tmp_path, solver="glhf", model="mock", max_tokens=10_000, mock_outputs=outputs
    )
    assert summary["status"] == "done", summary["error"]
    events = json.loads((tmp_path / "outputs" / "glhf" / "ledger.json").read_text())["events"]
    review = [
        (e["kind"], e["round"]) for e in events if e["kind"].startswith("review.") and "round" in e
    ]
    # Round 1 found nothing only because the critic did not finish: it must not count as
    # agreement. The review converges in round 2, when the critic completed.
    assert review == [("review.incomplete", 1), ("review.converged", 2)]
    assert [e["reason"] for e in events if e["kind"] == "review.incomplete"] == [
        "critic stopped by the token limit"
    ]
    started = [e["phase"] for e in events if e["kind"] == "phase.started"]
    assert started[4:8] == ["audit 1", "critique 1", "audit 2", "critique 2"]


def test_single_agent_token_budget_keeps_a_reserve_for_methods(tmp_path: Path) -> None:
    methods = _write("/outputs/METHODS.md", "# Methods\n\nStopped by the token budget.\n")
    outputs = [
        _busy(1000),
        _busy(1000),  # 2000 used: over 90% of the budget, the analysis is cut off
        _spend(methods, 50),  # the wrap-up continuation, on the 10% reserve
        _spend(_done("stopped"), 50),
    ]
    summary = run_local(
        DEMO_CASE, tmp_path, solver="single", model="mock", max_tokens=2000, mock_outputs=outputs
    )
    assert summary["status"] == "done", summary["error"]
    assert (tmp_path / "outputs" / "METHODS.md").exists()
    budget = summary["settings"]["token_budget"]
    assert budget["analysis_limit_hit"] and budget["wrap_up_ran"]
    assert "one continuation" in summary["settings"]["token_semantics"]
    assert summary["settings"]["swarm_only_tools"] == []


def test_single_agent_with_a_budget_it_does_not_reach_is_unchanged(tmp_path: Path) -> None:
    summary = run_local(DEMO_CASE, tmp_path, solver="single", model="mock", max_tokens=10**9)
    assert summary["status"] == "done", summary["error"]
    assert summary["score"] == 1.0
    assert summary["settings"]["token_budget"]["wrap_up_ran"] is False


def test_run_settings_are_recorded_for_disclosure(tmp_path: Path) -> None:
    summary = run_local(
        DEMO_CASE, tmp_path, solver="glhf", model="mock", memory_dir=tmp_path / "memory", seed=3
    )
    assert summary["status"] == "done", summary["error"]
    settings = json.loads((tmp_path / "run.json").read_text())["settings"]
    assert settings == {
        "solver": "glhf",
        "model": "mock",
        "role_models": {},
        "time_limit_seconds": 1800,
        "max_tokens": None,
        "token_semantics": None,
        "max_messages_per_role": None,
        "review_rounds": 3,
        "exa": False,
        "memory": True,
        "memory_source": None,  # the memory folder was empty when the run started
        "seed": 3,
        "swarm_only_tools": ["check_outputs", "read_ledger", "ledger tools", "memory"],
    }
    ledger = json.loads((tmp_path / "outputs" / "glhf" / "ledger.json").read_text())
    kinds = [e["kind"] for e in ledger["events"]]
    assert "memory.pending" in kinds and "memory.saved" not in kinds
    assert "issues.rechecked" in kinds
    # The run's lesson is only queued for a person: there is no approved file yet.
    memory_dir = tmp_path / "memory"
    assert (
        "check that every output has data rows" in (memory_dir / "lessons.pending.md").read_text()
    )
    assert not (memory_dir / "lessons.md").exists()
    # The fix made in round 1 went through the critic's second pass.
    assert [(i["id"], i["rechecked"]) for i in ledger["issues"]] == [("I1", True)]
    assert "not re-checked" not in (tmp_path / "outputs" / "glhf" / "FINDINGS.md").read_text()
    # A second run on the same task must not be shown the lesson the first one saved.
    again = run_local(
        DEMO_CASE, tmp_path / "again", solver="glhf", model="mock", memory_dir=tmp_path / "memory"
    )
    assert again["settings"]["memory_source"] is None
    log = read_eval_log(str(next((tmp_path / "again" / "logs").glob("*.eval"))))
    assert log.samples is not None
    assert "Lessons from earlier runs" not in "\n".join(
        str(m.content) for m in log.samples[0].messages
    )
