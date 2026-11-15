"""The report: its banner, what it refuses to pool, how it keys rows and what it drops from the
paired test. Built from run.json and grade.json files written here; no model, no Docker."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from bixbench_v1 import cli, report
from bixbench_v1.grading import PROFILE_JUDGES, judge_record
from bixbench_v1.stats import summarise


def write_run(
    root: Path,
    name: str,
    solver: str,
    verdicts: dict[str, bool | None],  # None = ungraded
    *,
    model: str = "anthropic/some-model",
    repeat: int = 0,
    profile: str = "per-mode",
    judge: dict[str, Any] | None = None,
    unit: str = "capsule",
    capsule: str = "bix-1_aaaaaaaa",
    network: str = "none",
) -> None:
    folder = root / name
    folder.mkdir(parents=True)
    run = {
        "capsule": capsule,
        "status": "done",
        "question_ids": list(verdicts),
        "total_tokens": 1000,
        "seconds": 10,
        "usage": {},
        "answer_statuses": dict.fromkeys(verdicts, "unchecked"),
        "settings": {
            "solver": solver,
            "model": model,
            "repeat": repeat,
            "unit": unit,
            "network": network,
            "answer_mode": "open",
        },
    }
    grades = [
        {
            "question_id": q,
            "eval_mode": "str_verifier",
            "answer_mode": "open",
            "correct": bool(v),
            "correct_strict": bool(v),
            "graded": v is not None,
            "refused": False,
            "own_refused": False,
            "method": "judge_error" if v is None else "numeric",
        }
        for q, v in verdicts.items()
    ]
    default = PROFILE_JUDGES[profile]  # type: ignore[index]
    block = {
        "judge": judge or judge_record(profile, default.model, default.temperature),  # type: ignore[arg-type]
        "summary": summarise(grades),
        "grades": grades,
    }
    (folder / "run.json").write_text(json.dumps(run))
    (folder / "grade.json").write_text(json.dumps({"profiles": {profile: block}}))


def test_the_banner_says_what_was_run_and_that_it_is_not_comparable(tmp_path: Path) -> None:
    write_run(tmp_path, "c/single", "single", {"q1": True, "q2": False})
    write_run(tmp_path, "c/glhf", "glhf", {"q1": True, "q2": True})
    built = report.build(tmp_path)
    banner = built["banner"]
    assert banner["profile"] == "per-mode" and banner["answer_modes"] == ["open"]
    assert banner["judges"] == ["openai/gpt-4o at temperature 0"]
    assert banner["repeats"] == {"glhf": 1, "single": 1} and banner["units"] == ["capsule"]
    assert banner["network"] == ["none"]
    assert (banner["questions_covered"], banner["questions_total"]) == (2, 205)
    comparable = banner["comparable_to_published"]
    assert comparable["value"] is False
    reasons = "\n".join(comparable["reasons"])
    for expected in (
        "this adapter's own",
        "single covers 2 of 205",
        "glhf covers 2 of 205",
        "one run per capsule",
        "no network",
    ):
        assert expected in reasons, expected
    text = report.markdown(built)
    for line in (
        "- Grading profile: per-mode",
        "- Judge: openai/gpt-4o at temperature 0",
        "- Answer mode: open",
        "- Repeats: glhf 1, single 1",
        "- Unit: capsule per run",
        "- Network in the sandbox: none",
        "- Questions covered: 2 of 205",
        "- Comparable to published: no",
    ):
        assert line in text, line
    assert "lower bound" not in text and "at least" not in text


def test_comparable_only_when_every_condition_holds(tmp_path: Path) -> None:
    def build(**changes: Any) -> dict[str, Any]:
        root = tmp_path / f"case{len(list(tmp_path.iterdir()))}"
        settings: dict[str, Any] = {
            "profile": "official",
            "unit": "questions",
            "network": "on",
            "capsule": "c",
        }
        settings.update(changes)
        verdict = settings.pop("verdict", True)
        for solver in ("single", "glhf"):
            for q in ("q1", "q2"):
                write_run(root, f"{q}/{solver}", solver, {q: verdict}, **settings)
        built = report.build(root, settings["profile"], total_questions=2)
        return dict(built["banner"]["comparable_to_published"])

    assert build() == {"value": True, "reasons": []}
    assert build(profile="paper")["value"] is True
    # Each condition, broken alone, makes it "no" and names itself.
    zero = judge_record("official", "openai/gpt-4o", 0.0)
    for changes, reason in (
        ({"profile": "per-mode"}, "adapter's own"),
        ({"judge": zero}, "temperature 0"),
        ({"judge": judge_record("official", "openai/gpt-5.5", 1.0)}, "not this profile's default"),
        ({"judge": judge_record("official", None, None)}, "no judge"),
        ({"network": "none"}, "no network"),
        ({"unit": "capsule"}, "one run per capsule"),
        ({"verdict": None}, "ungraded"),
        ({"model": "mock"}, "scripted mock model"),
    ):
        result = build(**changes)
        assert result["value"] is False and reason in "\n".join(result["reasons"]), reason
    partial = tmp_path / "partial"
    write_run(partial, "q1/single", "single", {"q1": True}, profile="official", unit="questions")
    covered = report.build(partial, "official")["banner"]["comparable_to_published"]
    assert "single covers 1 of 205 questions" in covered["reasons"]
    # Temperature 0 with an upstream profile is called out as a deviation in the text.
    flagged = tmp_path / "flagged"
    write_run(flagged, "q1/single", "single", {"q1": True}, profile="official", judge=zero)
    assert "**Deviation: judge temperature 0;" in report.markdown(report.build(flagged, "official"))


def test_models_are_never_pooled(tmp_path: Path) -> None:
    write_run(tmp_path, "a/single", "single", {"q1": True}, model="anthropic/one")
    write_run(tmp_path, "b/single", "single", {"q1": False}, model="openai/two")
    with pytest.raises(report.ReportError, match=r"not\s+pooled"):
        report.build(tmp_path)
    one = report.build(tmp_path, model="anthropic/one")
    assert one["models"] == ["anthropic/one"] and one["solvers"]["single"]["n"] == 1
    assert one["solvers"]["single"]["correct"] == 1
    # The command line says so instead of writing a pooled report.
    cli._write_report(tmp_path, "per-mode")
    assert not (tmp_path / "report.json").exists()
    cli._write_report(tmp_path, "per-mode", "openai/two")
    assert json.loads((tmp_path / "report.json").read_text())["models"] == ["openai/two"]


def test_rows_are_keyed_by_model_question_and_repeat(tmp_path: Path) -> None:
    write_run(tmp_path, "c/single", "single", {"q1": True, "q2": True})
    write_run(tmp_path, "c/single-r1", "single", {"q1": False, "q2": False}, repeat=1)
    write_run(tmp_path, "c/glhf", "glhf", {"q1": True, "q2": False})
    write_run(tmp_path, "c/glhf-r1", "glhf", {"q1": True, "q2": False}, repeat=1)
    built = report.build(tmp_path)
    # Before, the second repeat overwrote the first in the paired test and the question table.
    assert built["paired"]["n"] == 4 and len(built["questions"]) == 4
    assert (built["paired"]["only_a_correct"], built["paired"]["only_b_correct"]) == (1, 1)
    assert {(q["question_id"], q["repeat"]) for q in built["questions"]} == {
        ("q1", 0), ("q2", 0), ("q1", 1), ("q2", 1),
    }  # fmt: skip
    over = built["solvers"]["single"]["over_repeats"]
    assert over["repeats"] == 2 and over["mean_accuracy"] == 0.5
    assert over["accuracy_by_repeat"] == {"0": 1.0, "1": 0.0}
    assert built["banner"]["repeats"] == {"glhf": 2, "single": 2}
    assert "| single | 2/4 = 50.0%" in report.markdown(built)
    assert "50.0% over 2 |" in report.markdown(built)
    # The same (model, solver, question, repeat) twice is an error, not a silent overwrite.
    write_run(tmp_path, "again/single", "single", {"q1": True})
    with pytest.raises(report.ReportError, match="run twice"):
        report.build(tmp_path)


def test_ungraded_pairs_are_dropped_and_accuracy_is_a_lower_bound(tmp_path: Path) -> None:
    write_run(tmp_path, "c/single", "single", {"q1": True, "q2": None, "q3": False})
    write_run(tmp_path, "c/glhf", "glhf", {"q1": True, "q2": True, "q3": None})
    built = report.build(tmp_path)
    pair = built["paired"]
    # q2 and q3 each have an ungraded side: before, they counted as a swarm win and a tie.
    assert (pair["n"], pair["pairs_available"], pair["pairs_dropped_ungraded"]) == (1, 3, 2)
    assert (pair["only_a_correct"], pair["only_b_correct"]) == (0, 0)
    assert built["solvers"]["single"]["lower_bound"] is True
    text = report.markdown(built)
    assert "2 of 3 pair(s) dropped because a side was ungraded" in text
    assert "| single | at least 1/3 = 33.3%" in text and "lower bound" in text
    assert "It assumes independent questions" in text
    assert "sign-flip permutation test" in text and "not estimable" in text
    assert "Precision" not in text  # open answers: upstream has no refusals to exclude


def test_a_grade_file_from_before_judges_were_recorded_says_so(tmp_path: Path) -> None:
    write_run(tmp_path, "c/single", "single", {"q1": True})
    grade_file = tmp_path / "c" / "single" / "grade.json"
    grade = json.loads(grade_file.read_text())
    del grade["profiles"]["per-mode"]["judge"]
    grade_file.write_text(json.dumps({**grade, "judge_model": "openai/gpt-4o"}))
    banner = report.build(tmp_path)["banner"]
    assert banner["judges"] == ["openai/gpt-4o (temperature not recorded)"]
    assert "judge temperature was not recorded" in banner["comparable_to_published"]["reasons"]
