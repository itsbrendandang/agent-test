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

from bixbench3.glhf_local import run_local

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
    assert phases == ["propose", "experiment", "critique 1", "revise 1", "critique 2", "report"]
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
