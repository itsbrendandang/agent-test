"""The deterministic output check and the swarm's time and token budgets (no Docker, no model)."""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import pytest

from bixbench3.inspect_harness.models import ExpectedOutput
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


@pytest.mark.parametrize("spec", [{"format": None}, {"format": "txt"}, {"format": "tab"}])
def test_tab_separated_text_files_are_read_as_tabs(tmp_path: Path, spec: dict[str, Any]) -> None:
    r = _check(tmp_path, "t.txt", "gene_id\tlog2fc\ng1\t1.5\ng2\t-2\n", row_key="gene_id", **spec)
    assert r["problems"] == [] and r["warnings"] == [] and r["delimiter"] == "tab"
    assert r["columns"] == ["gene_id", "log2fc"]


def _graded(tmp_path: Path, name: str, text: str, fmt: str | None, key: str) -> bool:
    """Whether the benchmark's own table loader finds the row-key column in the file."""
    from bixbench3.grading.loaders import load_table

    path = tmp_path / f"graded-{name}"
    path.write_bytes(text.encode("utf-8"))
    try:
        return key in load_table(path, fmt).columns
    except ValueError:
        return False


@pytest.mark.parametrize(
    ("name", "text", "fmt", "usable"),
    [
        # The disagreements with the grader found in review, and their neighbours.
        ("bom.csv", "\ufeffgene,a\ng1,1\n", "csv", True),  # pandas drops the BOM
        ("bom.tsv", "\ufeffgene\ta\ng1\t1\n", None, True),
        ("commas.txt", "gene,a\ng1,1\n", None, False),  # the grader reads txt as tabs
        ("commas2.txt", "gene,a\ng1,1\n", "txt", False),
        ("commas.tab", "gene,a\ng1,1\n", "tab", False),
        ("tabs.txt", "gene\ta\ng1\t1\n", None, True),
        ("tabs.csv", "gene\ta\ng1\t1\n", "csv", False),
        ("named.dat", "gene,a\ng1,1\n", "csv", True),  # the declared format wins over the suffix
    ],
)
def test_the_check_reads_a_table_the_way_the_grader_does(
    tmp_path: Path, name: str, text: str, fmt: str | None, usable: bool
) -> None:
    assert _graded(tmp_path, name, text, fmt, "gene") is usable  # what the grader will do
    path = tmp_path / name
    path.write_bytes(text.encode("utf-8"))
    r = _check(tmp_path, name, None, format=fmt, row_key="gene")
    if usable:
        assert r["problems"] == [] and not r["fatal"], r
        assert r["columns"][0] == "gene"  # no byte-order mark left on the first column name
    else:
        assert r["fatal"] and any("wrong delimiter" in p for p in r["problems"]), r
        assert tools.needs_rescue([r]) == [r]


def test_a_format_the_grader_does_not_name_is_read_by_its_header_with_a_warning(
    tmp_path: Path,
) -> None:
    r = _check(tmp_path, "t.txt", "gene_id,log2fc\ng1,1.5\n", format="table", row_key="gene_id")
    assert r["problems"] == [] and r["delimiter"] == "comma"
    assert any("not one the grader's table loader names" in w for w in r["warnings"])


def test_gzipped_tables_are_read(tmp_path: Path) -> None:
    import gzip

    path = tmp_path / "t.csv.gz"
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        fh.write("gene_id,a\ng1,1\n")
    r = _check(tmp_path, "t.csv.gz", None, format="csv.gz", row_key="gene_id")
    assert r["problems"] == [] and r["columns"] == ["gene_id", "a"]


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


def test_a_check_that_could_not_run_never_starts_the_finisher() -> None:
    # The finisher cannot fix a check that failed to run, and could damage good artifacts.
    failed = [{"artifact_id": "*", "problems": ["contract check failed to run: boom"]}]
    assert tools.check_failed(failed) and tools.needs_rescue(failed) == []
    mixed = [*failed, {"artifact_id": "a", "problems": ["missing"], "fatal": True}]
    assert tools.needs_rescue(mixed) == [mixed[1]]
    assert not tools.check_failed([mixed[1]])


# --- Column names and key formats the grader matches exactly ---------------------------------------

DEMO_PROMPT = Path(__file__).parents[3] / "demo_case" / "prompt.md"


def _outputs(*paths: str) -> list[ExpectedOutput]:
    return [
        ExpectedOutput(artifact_id=Path(path).stem, path=path, format="csv", row_key="gene_id")
        for path in paths
    ]


def test_the_brief_s_column_names_are_read_per_artifact() -> None:
    outputs = _outputs("outputs/gene_counts.csv", "outputs/treated_vs_control.csv")
    assert tools.required_columns(DEMO_PROMPT.read_text(), outputs) == {
        "gene_counts": ["gene_id"],
        "treated_vs_control": ["gene_id", "log2fc"],
    }


@pytest.mark.parametrize(
    ("brief", "expected"),
    [
        # One artifact: the whole section, as in the synthetic fixture.
        (
            "## Required Outputs\n\nWrite a CSV with columns `gene_id` and `sample`.\n",
            ["gene_id", "sample"],
        ),
        # No "column" in the item: backticked words there are not read as column names.
        ("## Required Outputs\n\n- `outputs/de.csv`: use `DESeq2` with `alpha = 0.05`.\n", None),
        # Paths, expressions and file names are never column names; the next heading ends it.
        (
            "# Task\n## Required Outputs\n- `outputs/de.csv` columns `gene`, `padj < 0.05`, "
            "`log2FoldChange`, `notes.md`\n## Software\ncolumns `version`\n",
            ["gene", "log2FoldChange"],
        ),
        (
            "## Required Outputs\n- `outputs/de.csv` with columns `gene_id`, `padj`; keep rows "
            "with `padj` below `0.05` or `1e-3`\n",
            ["gene_id", "padj"],
        ),
        ("## Method\ncolumns `gene_id`\n", None),  # no Required Outputs section
    ],
)
def test_only_backticked_names_in_a_column_line_of_the_section_are_read(
    brief: str, expected: list[str] | None
) -> None:
    found = tools.required_columns(brief, _outputs("outputs/de.csv"))
    assert found == ({} if expected is None else {"de": expected})


def test_a_file_name_inside_another_is_not_its_line() -> None:
    brief = "## Required Outputs\n- `outputs/gene_counts.csv` with columns `gene_id`, `s1`\n"
    outputs = _outputs("outputs/counts.csv", "outputs/gene_counts.csv")
    assert tools.required_columns(brief, outputs) == {"gene_counts": ["gene_id", "s1"]}


def test_each_sub_heading_is_its_own_files_block() -> None:
    brief = (
        "## Required Outputs\n### outputs/a.csv\nColumns `x`, `y`.\n"
        "### outputs/b.csv\nColumns `z`.\n## Method\ncolumns `w`\n"
    )
    outputs = _outputs("outputs/a.csv", "outputs/b.csv")
    assert tools.required_columns(brief, outputs) == {"a": ["x", "y"], "b": ["z"]}


def test_a_column_the_brief_names_and_the_header_lacks_is_a_warning(tmp_path: Path) -> None:
    text = "gene_id,Log2FC\ng1,1.5\ng2,-2\n"
    r = _check(
        tmp_path,
        "t.csv",
        text,
        format="csv",
        row_key="gene_id",
        required_columns=["gene_id", "log2fc", "padj"],
    )
    assert r["problems"] == [] and not r["fatal"] and tools.needs_rescue([r]) == []
    assert any("'Log2FC' is named 'log2fc'" in w for w in r["warnings"])
    assert any("no column 'padj'" in w for w in r["warnings"])
    assert "Warnings (not failures" in tools.contract_text([r])
    good = _check(
        tmp_path,
        "g.csv",
        "gene_id,log2fc\ng1,1\n",
        format="csv",
        row_key="gene_id",
        required_columns=["gene_id", "log2fc"],
    )
    assert good["warnings"] == []


@pytest.mark.parametrize(
    ("text", "warning"),
    [
        ("gene_id,a\nENSG00000000003.14,1\nENSG00000000005,2\n", "mixes Ensembl IDs"),
        ("gene_id,a\nENSG00000000003.14,1\nENSG00000000005.6,2\n", "with a version suffix"),
        ("gene_id,a\n g1,1\ng2 ,2\n", "leading or trailing spaces"),
        ('gene_id,a\ng1,"1,234"\ng2,5\n', "thousands separators"),
        ("gene_id,a\ng1,Inf\ng2,-inf\n", "2 sampled values are infinite"),
    ],
)
def test_key_and_number_formats_the_grader_reads_differently_are_warnings(
    tmp_path: Path, text: str, warning: str
) -> None:
    r = _check(tmp_path, "t.csv", text, format="csv", row_key="gene_id")
    assert r["problems"] == [] and not r["fatal"]
    assert any(warning in w for w in r["warnings"]), r["warnings"]


def test_plain_ensembl_keys_and_ordinary_numbers_raise_nothing(tmp_path: Path) -> None:
    text = "gene_id,a,b\nENSG00000000003,1234,0.5\nENSMUSG00000000001,-2,1e-3\n"
    r = _check(tmp_path, "t.csv", text, format="csv", row_key="gene_id")
    assert r["problems"] == [] and r["warnings"] == []


def test_a_fatal_file_gets_no_column_warnings(tmp_path: Path) -> None:
    r = _check(
        tmp_path,
        "t.tsv",
        "gene_id,log2fc\ng1,1\n",
        format="tsv",
        row_key="gene_id",
        required_columns=["log2fc"],
    )
    assert r["fatal"] and not any("no column" in w for w in r["warnings"])


# --- Token budget -------------------------------------------------------------------------------


def _grant(title: str, used: int, later: tuple[str, ...] = (), budget: int = 1_000_000):
    """The token grant of a phase that starts with `used` tokens spent (see TokenBook)."""
    book = solver.TokenBook(solver.plan_budget(budget, 24 * 3600))
    book.used = used
    return book.grant(title, list(later))


def test_token_allowance_caps_supporting_roles_and_keeps_the_report_reserve() -> None:
    assert _grant("scout", 0, ("propose",)).tokens == 50_000  # its TOKEN_SHARE target caps it
    assert _grant("critique 2", 100_000).tokens == 200_000
    # Roles without a target take what is left, minus the reserves: the reporter's 10%, the
    # finisher's floor (40,000) and the overshoot reserve (5%).
    assert _grant("experiment", 300_000).tokens == 510_000
    assert _grant("revise 1", 700_000).tokens == 110_000
    # A capped role near the end gets only what is left before the reserves; under its floor
    # it is not started at all (it would stop before it wrote anything).
    assert _grant("audit 3", 750_000).tokens == 60_000
    assert _grant("audit 3", 880_000).skip == "below_floor"
    assert _grant("revise 1", 850_000).skip == "below_floor"


@pytest.mark.parametrize(
    "phase", ["scout", "pilot", "experiment", "audit 1", "critique 1", "finish"]
)
def test_phases_are_skipped_once_the_budget_minus_the_reserve_is_spent(phase: str) -> None:
    assert _grant(phase, 900_000).skip is not None
    assert _grant(phase, 1_200_000).skip is not None
    assert _grant(phase, 900_000).tokens <= 0 and _grant(phase, 1_200_000).tokens <= 0


def test_the_report_always_gets_at_least_the_reserve() -> None:
    # All that is left, except the overshoot reserve (5%) that pays for its own last call.
    assert _grant("report", 400_000).tokens == 550_000
    assert _grant("report", 950_000).tokens == 100_000
    assert _grant("report", 5_000_000).tokens == 100_000  # after an overshoot
    assert all(_grant("report", used).skip is None for used in (0, 950_000, 5_000_000))


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


def test_a_default_local_run_gets_a_review_round() -> None:
    # 1800 s: after scout, plan, pilot and the first pass used their full shares, the time left
    # before the reserves is about five minutes. A fixed 15-minute minimum skipped every review.
    budget = 1800 * (1 - solver.RUN_MARGIN)
    hold = solver.REPORT_RESERVE + solver.finish_hold(budget)
    used = (
        solver.SCOUT_SHARE + solver.PLAN_SHARE + solver.PILOT_SHARE + solver.FIRST_PASS_SHARE
    ) * budget
    review_left = budget - used - budget * hold
    assert review_left < solver.MIN_REVIEW_SECONDS  # the old rule: no review
    assert review_left >= solver.min_review_seconds(budget)  # the scaled rule: one round
    assert solver.min_review_seconds(24 * 3600) == solver.MIN_REVIEW_SECONDS  # long runs unchanged


@pytest.mark.parametrize("total", [600, 1800, 3600, 24 * 3600])
@pytest.mark.parametrize("spent_share", [0.0, 0.5, 0.9, 0.95, 0.97, 0.99, 1.2])
def test_the_report_ends_inside_the_sample_time_limit(total: int, spent_share: float) -> None:
    spent = total * spent_share
    clock = solver.Clock(total * (1 - solver.RUN_MARGIN), time.monotonic() - spent, float(total))
    seconds = clock.report_seconds()
    final = max(solver.MIN_FINAL_WRITES_SECONDS, total * solver.FINAL_WRITES_SHARE)
    assert seconds >= 0
    assert spent + seconds + final <= total + 1 or seconds == 0  # room left for the final writes
    if spent_share <= 0.9 and total >= 1800:
        assert seconds >= 60  # the reserves leave the reporter real time


def test_review_converges_only_when_the_critic_finished_looking() -> None:
    done, cut, skipped = (
        solver.PhaseResult(ran=True),
        solver.PhaseResult(ran=True, limit="token"),
        solver.PhaseResult(ran=False),
    )
    assert solver.review_step(done, 0) == "converged"
    assert solver.review_step(done, 2) == "revise"
    # Cut off with nothing raised: that is not agreement, the critic did not finish looking.
    assert solver.review_step(cut, 0) == "again"
    assert solver.review_step(cut, 1) == "revise"
    assert solver.review_step(skipped, 0) == "stop" and solver.review_step(skipped, 3) == "stop"


def test_the_budget_plan_is_what_the_settings_and_the_catalog_describe() -> None:
    from bixbench3.inspect_harness.swarm import catalog

    text = baseline.TOKEN_SEMANTICS["glhf"]
    for said in ("budget plan", "floor", "reserves", "smaller plan", "final turn"):
        assert said in text, said
    assert "phases are skipped once max_tokens minus a 10% reserve" not in text  # the old rule
    described = catalog.catalog()
    assert all(name in str(described["budget_plan"]) for name, _ in solver.LADDER)
    budgets = {r["key"]: r["budget"] for r in described["roles"]}  # type: ignore[attr-defined]
    assert set(budgets) == set(solver.PHASE_ORDER)
    for kind in ("scout", "propose", "pilot", "experiment", "audit", "critique", "revise"):
        assert f"floor {solver.NEEDS[kind].seconds} s" in budgets[kind], kind
    assert "45% of the time and 40% of the tokens" in budgets["experiment"]
    assert "1.2 times" in budgets["critique"] and "always runs" in budgets["report"]
