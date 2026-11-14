"""The deterministic output check and the swarm's time and token budgets (no Docker, no model)."""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import pytest

from bixbench3.inspect_harness.swarm import baseline, solver, tools


def _check(tmp_path: Path, name: str, text: str | None, **spec: Any) -> dict[str, Any]:
    """Run the sandbox script on one file. `text=None` leaves the file missing."""
    path = tmp_path / name
    if text is not None:
        path.write_text(text)
    specs = [{"artifact_id": "a", "sandbox_path": str(path), **spec}]
    result = subprocess.run(
        [sys.executable, "-c", tools._CONTRACT_SCRIPT, json.dumps(specs)],
        capture_output=True,
        text=True,
        check=True,
    )
    report: dict[str, Any] = json.loads(result.stdout)[0]
    return report


def test_a_good_table_passes(tmp_path: Path) -> None:
    r = _check(tmp_path, "t.csv", "gene_id,a,b\ng1,1,2\ng2,3,4\n", format="csv", row_key="gene_id")
    assert r["problems"] == [] and r["warnings"] == [] and not r["fatal"]
    assert tools.needs_rescue([r]) == []
    assert tools.contract_text([r]) == "1/1 required artifacts pass the shape check."


@pytest.mark.parametrize(
    ("name", "text", "spec", "warning"),
    [
        # The false positives of the code review: each can be a correct artifact.
        ("one.csv", "gene_id\ng1\ng2\n", {"format": "csv", "row_key": "gene_id"}, "single column"),
        ("empty.csv", "gene_id,log2fc\n", {"format": "csv", "row_key": "gene_id"}, "header only"),
        ("empty.json", "[]", {"format": "json"}, "empty JSON"),
    ],
)
def test_legitimate_shapes_are_warnings_not_problems(
    tmp_path: Path, name: str, text: str, spec: dict[str, Any], warning: str
) -> None:
    r = _check(tmp_path, name, text, **spec)
    assert r["problems"] == [] and not r["fatal"]
    assert any(warning in w for w in r["warnings"])
    assert tools.needs_rescue([r]) == []  # the finisher is not sent to "fix" it
    text_report = tools.contract_text([r])
    assert (
        text_report.startswith("1/1 required artifacts pass")
        and "Warnings (not failures" in text_report
    )


@pytest.mark.parametrize("spec", [{"format": "table"}, {"format": None}, {"format": "txt"}])
def test_tab_separated_text_files_are_read_as_tabs(tmp_path: Path, spec: dict[str, Any]) -> None:
    r = _check(tmp_path, "t.txt", "gene_id\tlog2fc\ng1\t1.5\ng2\t-2\n", row_key="gene_id", **spec)
    assert r["problems"] == [] and r["warnings"] == [] and r["delimiter"] == "tab"
    assert r["columns"] == ["gene_id", "log2fc"]


def test_comma_separated_text_files_are_read_as_commas(tmp_path: Path) -> None:
    r = _check(tmp_path, "t.txt", "gene_id,log2fc\ng1,1.5\n", format="table", row_key="gene_id")
    assert r["problems"] == [] and r["delimiter"] == "comma"


@pytest.mark.parametrize(
    ("name", "text", "spec", "problem"),
    [
        ("missing.csv", None, {"format": "csv"}, "missing"),
        ("zero.csv", "", {"format": "csv"}, "empty file"),
        (
            "tabs.csv",
            "gene_id\ta\ng1\t1\n",
            {"format": "csv", "row_key": "gene_id"},
            "wrong delimiter",
        ),
        ("commas.tsv", "gene_id,a\ng1,1\n", {"format": "tsv"}, "wrong delimiter"),
        ("nokey.csv", "gene,a\ng1,1\n", {"format": "csv", "row_key": "gene_id"}, "row_key column"),
        ("bad.json", "{not json", {"format": "json"}, "could not parse"),
    ],
)
def test_missing_or_unreadable_artifacts_need_rescue(
    tmp_path: Path, name: str, text: str | None, spec: dict[str, Any], problem: str
) -> None:
    r = _check(tmp_path, name, text, **spec)
    assert any(problem in p for p in r["problems"]) and r["fatal"]
    assert tools.needs_rescue([r]) == [r]


def test_duplicate_keys_and_ragged_rows_are_problems_but_not_for_the_finisher(
    tmp_path: Path,
) -> None:
    r = _check(tmp_path, "d.csv", "gene_id,a\ng1,1\ng1,2\ng2\n", format="csv", row_key="gene_id")
    assert any("duplicate" in p for p in r["problems"])
    assert any("different column count" in p for p in r["problems"])
    assert not r["fatal"] and tools.needs_rescue([r]) == []  # the critic raises these


def test_a_check_that_could_not_run_counts_as_needing_rescue() -> None:
    failed = [{"artifact_id": "*", "problems": ["contract check failed to run: boom"]}]
    assert tools.needs_rescue(failed) == failed


# --- Token budget -------------------------------------------------------------------------------


def test_token_allowance_caps_supporting_roles_and_keeps_the_report_reserve() -> None:
    budget = 1_000_000
    assert solver.token_allowance("scout", budget, 0) == 50_000  # TOKEN_SHARE caps it
    assert solver.token_allowance("critique 2", budget, 100_000) == 200_000
    # Roles without a share take what is left, minus the reporter's 10%.
    assert solver.token_allowance("experiment", budget, 300_000) == 600_000
    assert solver.token_allowance("revise 1", budget, 850_000) == 50_000
    # A capped role near the end gets only what is left before the reserve.
    assert solver.token_allowance("audit 3", budget, 880_000) == 20_000


@pytest.mark.parametrize(
    "phase", ["scout", "pilot", "experiment", "audit 1", "critique 1", "finish"]
)
def test_phases_are_skipped_once_the_budget_minus_the_reserve_is_spent(phase: str) -> None:
    assert solver.token_allowance(phase, 1_000_000, 900_000) <= 0
    assert solver.token_allowance(phase, 1_000_000, 1_200_000) <= 0


def test_the_report_always_gets_at_least_the_reserve() -> None:
    assert solver.token_allowance("report", 1_000_000, 400_000) == 600_000
    assert solver.token_allowance("report", 1_000_000, 950_000) == 100_000
    assert solver.token_allowance("report", 1_000_000, 5_000_000) == 100_000  # after an overshoot


def test_both_solvers_share_one_token_rule() -> None:
    assert solver.REPORT_TOKEN_RESERVE == baseline.REPORT_TOKEN_RESERVE == 0.10
    assert set(baseline.TOKEN_SEMANTICS) == {"single", "glhf"}
    assert sum(solver.TOKEN_SHARE.values()) + solver.REPORT_TOKEN_RESERVE < 1  # room for the run


# --- Time budget --------------------------------------------------------------------------------


def _clock(budget: float, spent: float) -> solver.Clock:
    return solver.Clock(budget, time.monotonic() - spent)


def test_a_phase_gets_its_share_and_never_the_reserve() -> None:
    assert solver.Clock(10_000, time.monotonic()).slice(0.45, 0.10) in (4499, 4500)
    # Late in the run only what is left before the reserve remains, even under the minute floor.
    assert _clock(1000, 880).slice(0.45, 0.10) in (19, 20)
    assert _clock(1000, 950).slice(0.03, 0.10) == 0  # the reserve is not eaten: phase skipped
    # Early in a short run a small share is still rounded up to a minute.
    assert solver.Clock(1000, time.monotonic()).slice(0.03, 0.10) == 60


def test_the_finisher_reserve_is_enough_for_the_finisher_to_start() -> None:
    for budget in (1800 * 0.97, 3600, 6 * 3600, 24 * 3600):
        held = solver.finish_hold(budget) * budget
        assert held >= solver.MIN_FINISH_SECONDS  # the default 30-minute local run included
        assert solver.finish_hold(budget) <= solver.MAX_FINISH_HOLD
    assert solver.finish_hold(24 * 3600) == solver.FINISH_RESERVE  # 5% is already 72 minutes
    assert solver.finish_hold(600) == solver.FINISH_RESERVE  # too short to hold five minutes


def test_each_role_is_told_its_own_budget() -> None:
    note = solver._budget_note(2400, 150_000, 300)
    assert "40 minutes (2400 s)" in note and "150,000 tokens" in note and "300 messages" in note
    assert "whole team's" in note
    assert "tokens" not in solver._budget_note(90, None, None)
