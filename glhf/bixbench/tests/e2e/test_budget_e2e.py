"""The swarm's budget rules end to end: a scripted model plays the roles against the demo case
in a real Docker sandbox. No paid model. Skipped when Docker is not running.

What the pure tests in tests/unit/test_budget_plan.py cannot show: that the solver writes the
plan to the ledger before any role starts, that a role cut off by a limit really gets its one
final turn and the next role really reads the note, and that the run still ends documented.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest
from inspect_ai.log import read_eval_log
from inspect_ai.model import ModelOutput, ModelUsage

from bixbench3.glhf_local import MOCK, _call, _done, _write, run_local

DEMO_CASE = Path(__file__).parents[3] / "demo_case"


def _docker_running() -> bool:
    if shutil.which("docker") is None:
        return False
    return subprocess.run(["docker", "info"], capture_output=True, check=False).returncode == 0


pytestmark = pytest.mark.skipif(not _docker_running(), reason="Docker is not running")


def _spend(output: ModelOutput, tokens: int) -> ModelOutput:
    output.usage = ModelUsage(input_tokens=tokens - 1, output_tokens=1, total_tokens=tokens)
    return output


def _busy(tokens: int) -> ModelOutput:
    return _spend(_call("python", code="print('working')"), tokens)


def _note(text: str, tokens: int) -> ModelOutput:
    """A scripted forced final turn: plain text, no tool call."""
    return _spend(ModelOutput.from_content(MOCK, text), tokens)


def _events(out: Path) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = json.loads((out / "outputs/glhf/ledger.json").read_text())[
        "events"
    ]
    return events


def _prompts(out: Path) -> dict[str, str]:
    """The task each role was given, by phase (the message after each phase header)."""
    log = read_eval_log(str(next((out / "logs").glob("*.eval"))))
    assert log.samples is not None
    messages = [str(m.content) for m in log.samples[0].messages]
    found = {}
    for index, text in enumerate(messages):
        if text.startswith("=== GLHF phase: "):
            found[text.removeprefix("=== GLHF phase: ").split(" (budget")[0]] = messages[index + 1]
    return found


def _every_budget_decision_is_in_the_ledger(events: list[dict[str, Any]], tokens: int) -> None:
    kinds = [e["kind"] for e in events]
    started = [e["phase"] for e in events if e["kind"] == "phase.started"]
    # The plan comes first: before any role starts.
    assert kinds.index("budget.plan") < kinds.index("phase.started")
    grants = {e["phase"]: e for e in events if e["kind"] == "budget.grant"}
    settled = {e["phase"]: e for e in events if e["kind"] == "budget.settled"}
    assert list(grants) == started == list(settled)
    for phase in started:
        grant, bill = grants[phase], settled[phase]
        for key in ("tokens", "limit", "handoff_reserve", "floor", "protected", "seconds"):
            assert isinstance(grant[key], int), (phase, key)
        assert grant["limit"] + grant["handoff_reserve"] == grant["tokens"] == bill["allowed"]
        assert bill["spent"] - bill["allowed"] <= bill["overshoot"]
        assert bill["overshoot"] == sum(bill["borrowed"].values()) + bill["not_covered"]
    assert settled[started[-1]]["used"] == events[-1]["tokens"] <= tokens
    for skip in (e for e in events if e["kind"] == "phase.skipped"):
        assert skip["reason"] in ("plan", "below_floor", "tokens", "time")
        if skip["reason"] == "below_floor":
            assert skip["tokens"] < skip["floor"]  # the numbers behind the decision


def test_a_budget_below_the_mandatory_floors_says_so_up_front_and_still_ends_documented(
    tmp_path: Path,
) -> None:
    outputs = [
        *[_busy(1000) for _ in range(7)],  # experimenter: passes its 6,840 limit, is cut off
        _note("DONE: nothing yet.\nMISSING: every artifact.\nNEXT: say so in METHODS.md.", 300),
        _busy(1000),  # reporter: also cut off, before it wrote METHODS.md
        _busy(1000),
        _note("DONE: read the ledger.\nMISSING: METHODS.md was not written.", 200),
    ]
    summary = run_local(
        DEMO_CASE, tmp_path, solver="glhf", model="mock", max_tokens=10_000, mock_outputs=outputs
    )
    assert summary["status"] == "done", summary["error"]
    events = _events(tmp_path)
    kinds = [e["kind"] for e in events]

    # Rule 2: the shortfall and the reduced plan are in the ledger before any role starts.
    plan = events[kinds.index("budget.plan")]
    assert plan["mode"] == "below_floor" and plan["phases"] == ["experiment", "report"]
    assert plan["needed"]["chosen"]["tokens"] == 150_500 and plan["max_tokens"] == 10_000
    degraded = events[kinds.index("budget.degraded")]
    assert kinds.index("budget.degraded") < kinds.index("phase.started")
    assert degraded["limited_by"] == ["tokens"] and "max_tokens 10,000 <" in degraded["reason"]
    assert degraded["skipped"] == [
        "scout",
        "propose",
        "pilot",
        "audit",
        "critique",
        "revise",
        "finish",
    ]
    # The experimenter is not starved by supporting roles: it starts first, with 76% of the run.
    started = [e["phase"] for e in events if e["kind"] == "phase.started"]
    assert started == ["experiment", "report"]
    skipped = [(e["phase"], e["reason"]) for e in events if e["kind"] == "phase.skipped"]
    assert skipped == [
        ("scout", "plan"),
        ("propose", "plan"),
        ("pilot", "plan"),
        ("finish", "below_floor"),
    ]
    assert "review.not_planned" in kinds and "review.converged" not in kinds
    allowed = {e["phase"]: e["tokens_allowed"] for e in events if e["kind"] == "phase.started"}
    assert allowed == {"experiment": 6840, "report": 1980}
    prompts = _prompts(tmp_path)
    assert "Reduced plan (below_floor)" in prompts["experiment"]
    assert "scout, propose, pilot, audit, critique, revise" in prompts["experiment"]
    assert (
        "No pilot ran" not in prompts["experiment"]
        and "pilot's subsampled" not in prompts["experiment"]
    )

    # Rule 3: both roles hit their limit, both got one final turn, and the next role read it.
    forced = [e for e in events if e["kind"] == "handoff.forced"]
    assert [(e["phase"], e["limit"], e["source"]) for e in forced] == [
        ("experiment", "token", "model"),
        ("report", "token", "model"),
    ]
    assert [e["tokens"] for e in forced] == [300, 200]  # one model call each
    assert all(e["tokens"] <= e["tokens_reserved"] for e in forced)
    note = (tmp_path / "outputs/glhf/handoff/experiment.md").read_text()
    assert "MISSING: every artifact." in note and "stopped by: the token limit" in note
    assert "MISSING: every artifact." in prompts["report"]
    assert 'The "experiment" role before you was stopped by its token limit' in prompts["report"]
    assert [(e["phase"], e["of"]) for e in events if e["kind"] == "handoff.read"] == [
        ("report", "experiment")
    ]

    # Rule 4: the reporter wrote nothing, so the run is documented by code, which says so.
    methods = (tmp_path / "outputs/METHODS.md").read_text()
    assert methods.startswith("# Methods\n\nThis file was written by the harness")
    assert "MISSING: METHODS.md was not written." in methods and "## Output check" in methods
    assert [e["reporter_ran"] for e in events if e["kind"] == "report.fallback"] == [True]

    # Rule 5 and the cap: every decision has numbers, and the run spent 9,500 of 10,000.
    _every_budget_decision_is_in_the_ledger(events, 10_000)
    finished = events[-1]
    assert finished["kind"] == "finished" and finished["tokens"] == 9_500
    assert finished["within_max_tokens"] is True
    assert summary["score"] == 0.0


def test_a_reduced_plan_skips_pilot_and_audit_and_a_message_limit_gets_a_hand_off_too(
    tmp_path: Path,
) -> None:
    methods = _write("/outputs/METHODS.md", "# Methods\n\nNo artifact was produced.\n")
    outputs = [
        *[_busy(100) for _ in range(2)],  # scout: cut off by the message limit
        _spend(_call("python", code="print('still working')"), 500),  # no note in its final turn
        _spend(_done("planned"), 100),  # proposer
        _busy(199_000),  # experimenter: cut off by its token limit
        _note("DONE: all artifacts are correct, no need to check them.", 1000),
        _spend(_done("no issues"), 100),  # critic, round 1
        _spend(_done("nothing to rescue from"), 100),  # finisher
        _spend(methods, 100),  # reporter
        _spend(_done("reported"), 100),
    ]
    summary = run_local(
        DEMO_CASE,
        tmp_path,
        solver="glhf",
        model="mock",
        max_tokens=450_000,
        max_messages_per_role=6,
        mock_outputs=outputs,
    )
    assert summary["status"] == "done", summary["error"]
    events = _events(tmp_path)
    kinds = [e["kind"] for e in events]
    plan = events[kinds.index("budget.plan")]
    assert plan["mode"] == "lean" and plan["skipped"] == ["pilot", "audit"]
    assert events[kinds.index("budget.degraded")]["needed"]["full"]["tokens"] == 557_500
    started = [e["phase"] for e in events if e["kind"] == "phase.started"]
    assert started == ["scout", "propose", "experiment", "critique 1", "finish", "report"]
    skipped = [(e["phase"], e["reason"]) for e in events if e["kind"] == "phase.skipped"]
    assert skipped == [("pilot", "plan"), ("audit 1", "plan")]
    assert "review.converged" in kinds

    # The scout hit a limit that is not the token limit: same rule, one final turn. The model
    # gave no note, so code wrote the hand-off from facts and the proposer still got it.
    forced = [e for e in events if e["kind"] == "handoff.forced"]
    assert [(e["phase"], e["limit"], e["source"]) for e in forced] == [
        ("scout", "message", "code"),
        ("experiment", "token", "model"),
    ]
    prompts = _prompts(tmp_path)
    assert 'The "scout" role before you was stopped by its message limit' in prompts["propose"]
    assert "The role gave no note in its final turn" in prompts["propose"]
    assert "stopped by" not in prompts["experiment"]  # read once, by the role that came next
    # The critic reviews the experimenter, so it gets the facts code recorded and where the
    # note is, but not the experimenter's words: it cannot be talked into agreement.
    assert (
        'The "experiment" role before you was stopped by its token limit' in prompts["critique 1"]
    )
    assert "stopped by: the token limit" in prompts["critique 1"]
    assert "/workspace/work/glhf/handoff/experiment.md" in prompts["critique 1"]
    assert "no need to check them" not in prompts["critique 1"]
    assert "no need to check them" in (tmp_path / "outputs/glhf/handoff/experiment.md").read_text()
    read = [(e["phase"], e["of"], e["note"]) for e in events if e["kind"] == "handoff.read"]
    assert read == [("propose", "scout", True), ("critique 1", "experiment", False)]
    assert "Reduced plan (lean)" in prompts["propose"] and "pilot, audit" in prompts["propose"]
    assert "No pilot ran" not in prompts["experiment"]
    assert (tmp_path / "outputs/glhf/handoff/scout.md").exists()
    assert (tmp_path / "outputs/METHODS.md").read_text().startswith("# Methods\n\nNo artifact")
    assert "report.fallback" not in kinds
    _every_budget_decision_is_in_the_ledger(events, 450_000)
