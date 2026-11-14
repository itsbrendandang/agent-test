"""Grading rules per eval mode and profile. The judge is a function, so no paid call is made."""

from __future__ import annotations

import asyncio

import pytest

from bixbench_v1 import grading
from bixbench_v1.dataset import KeyEntry
from bixbench_v1.grading import Grade, grade_answers, grade_mcq, grade_open
from bixbench_v1.stats import accuracy, mcnemar_exact, paired, summarise, wilson
from bixbench_v1.text import normalise, parse_number, significant_digits


class FakeJudge:
    """Answers with a fixed grade and records every prompt it was shown."""

    def __init__(self, reply: str = "<grade> correct </grade>", fail: int = 0) -> None:
        self.reply, self.fail, self.prompts = reply, fail, []

    async def __call__(self, prompt: str) -> str:
        self.prompts.append(prompt)
        if self.fail > 0:
            self.fail -= 1
            raise RuntimeError("judge unavailable")
        return self.reply


def entry(mode: str, ideal: str, **extra: str) -> KeyEntry:
    return KeyEntry("q1", "What is it?", mode, ideal, **extra)  # type: ignore[arg-type]


def run(
    e: KeyEntry, predicted: str, judge: FakeJudge | None = None, profile: str = "per-mode"
) -> Grade:
    return asyncio.run(grade_open(e, predicted, judge, profile))  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("text", "value"),
    [
        ("0.0002", 0.0002),
        ("1.9E-05", 1.9e-5),
        (" 10.6% ", 10.6),
        ("4,550", 4550.0),
        ("-0.084", -0.084),
        ("\u22120.5", -0.5),
        ("1.9 x 10^-5", 1.9e-5),
        ("3.2 \u00d7 10^4", 32000.0),
        ("about 3", None),
        ("3 genes", None),
        ("1-50", None),
        ("0:0", None),
        ("1,2", None),
        ("", None),
        ("nan", None),
    ],
)
def test_parse_number(text: str, value: float | None) -> None:
    assert (
        parse_number(text) == pytest.approx(value)
        if value is not None
        else parse_number(text) is None
    )


def test_text_helpers() -> None:
    assert normalise(" CDKN1A. ") == "cdkn1a" and normalise("10.6%") == "106"
    assert significant_digits("0.0002") == 1 and significant_digits("1.50") == 3
    assert significant_digits("82000") == 2 and significant_digits("1.9E-05") == 2


@pytest.mark.parametrize(
    ("ideal", "predicted", "correct", "method"),
    [
        ("CDKN1A", "cdkn1a", True, "exact"),
        ("10.6%", "10.6", True, "exact"),
        ("4,550", "4550", True, "exact"),
        ("1.9E-05", "1.9e-5", True, "numeric"),
        ("0.0002", "2e-4", True, "numeric"),
        ("166", "166.0", True, "numeric"),
    ],
)
def test_str_verifier_without_the_judge(
    ideal: str, predicted: str, correct: bool, method: str
) -> None:
    judge = FakeJudge("<grade> incorrect </grade>")
    grade = run(entry("str_verifier", ideal), predicted, judge)
    assert (grade.correct, grade.method) == (correct, method)
    assert judge.prompts == [] and grade.correct_strict


def test_str_verifier_falls_back_to_the_judge_like_the_official_grader() -> None:
    judge = FakeJudge("<grade> correct </grade>")
    grade = run(entry("str_verifier", "CD14"), "CD14 monocytes", judge)
    assert grade.correct and grade.method == "llm" and not grade.correct_strict
    assert len(judge.prompts) == 1
    assert grade.judge_response == "<grade> correct </grade>"
    wrong = run(entry("str_verifier", "166"), "6", FakeJudge("<grade> incorrect </grade>"))
    assert not wrong.correct and wrong.method == "llm"


def test_the_official_substring_rule_is_only_in_the_official_profile() -> None:
    e = entry("str_verifier", "166")
    assert run(e, "6", FakeJudge("<grade> incorrect </grade>"), "official").method == "partial"
    assert run(e, "6", FakeJudge("<grade> incorrect </grade>"), "official").correct
    assert not run(e, "6", FakeJudge("<grade> incorrect </grade>"), "per-mode").correct
    # Upstream grades an empty answer correct (it is a substring of anything). Not here.
    for profile in ("per-mode", "official", "paper"):
        empty = run(e, "   ", FakeJudge(), profile)
        assert not empty.correct and empty.method == "empty" and empty.refused


@pytest.mark.parametrize(
    ("ideal", "predicted", "correct"),
    [
        ("(1.50,1.54)", "1.52", True),
        ("(1.50,1.54)", "1.50", True),
        ("(1.50,1.54)", "1.54", True),
        ("(1.50,1.54)", "1.55", False),
        ("(24,26)", "25%", True),
        ("(0.6 , 0.7)", "0.65", True),
        ("(-0.064,-0.084) ", "-0.07", True),  # bounds written upper first in the dataset
        ("(1.13e-10,1.13e-12)", "5e-11", True),
        ("(1.13e-10,1.13e-12)", "5e-9", False),
        ("(24,26)", "0.25", False),
    ],
)
def test_range_verifier_is_decided_by_code(ideal: str, predicted: str, correct: bool) -> None:
    judge = FakeJudge("<grade> correct </grade>")
    grade = run(entry("range_verifier", ideal), predicted, judge)
    assert grade.correct is correct and grade.method == "range" and judge.prompts == []


def test_range_answer_that_is_not_a_number_goes_to_the_range_judge() -> None:
    judge = FakeJudge("<grade> correct </grade>")
    grade = run(entry("range_verifier", "(24,26)"), "about 25 samples", judge)
    assert grade.correct and grade.method == "llm_range"
    assert "Target Range: (24,26)" in judge.prompts[0]
    official = run(entry("range_verifier", "(24,26)"), "25", FakeJudge(), "official")
    assert official.method == "llm_range"  # upstream always asks the judge in open-answer mode


def test_llm_verifier_and_what_the_judge_sees() -> None:
    judge = FakeJudge("thinking... <grade>\n Correct \n</grade>")
    e = KeyEntry("q1", "Which pathway?", "llm_verifier", "Canonical glycolysis")
    grade = run(e, "glycolysis (canonical)", judge)
    assert grade.correct and grade.method == "llm"
    prompt = judge.prompts[0]
    # Exactly the official template: question, target, predicted. Nothing from the solver.
    assert prompt == grading.OPEN_ENDED_GRADING_PROMPT.format(
        question="Which pathway?", target="Canonical glycolysis", predicted="glycolysis (canonical)"
    )
    refused = run(e, "cannot tell", FakeJudge("<grade>refused</grade>"))
    assert not refused.correct and refused.refused
    unparseable = run(e, "x", FakeJudge("correct"))
    assert not unparseable.correct  # official rule: correct only inside <grade> tags
    shortcut = FakeJudge()
    assert run(e, "canonical glycolysis", shortcut).method == "exact" and shortcut.prompts == []


def test_paper_profile_uses_one_binary_prompt() -> None:
    judge = FakeJudge("1")
    grade = run(entry("range_verifier", "(24,26)"), "25", judge, "paper")
    assert grade.correct and grade.method == "llm_binary"
    assert "Correct answer: (24,26)" in judge.prompts[0]
    assert not run(entry("str_verifier", "7"), "7.0", FakeJudge("0"), "paper").correct


def test_judge_failure_is_ungraded_not_wrong(monkeypatch: pytest.MonkeyPatch) -> None:
    async def no_sleep(_: float) -> None:
        return None

    monkeypatch.setattr(grading.asyncio, "sleep", no_sleep)
    e = entry("llm_verifier", "a long answer")
    recovered = run(e, "another answer", FakeJudge(fail=2))
    assert recovered.correct and recovered.graded
    failed = run(e, "another answer", FakeJudge(fail=3))
    assert failed.method == "judge_error" and not failed.graded and not failed.correct
    assert run(e, "another answer", None).method == "judge_error"
    summary = summarise([failed.to_dict(), recovered.to_dict()])
    assert summary["ungraded"] == 1 and summary["n"] == 2 and summary["correct"] == 1


def test_multiple_choice_grading() -> None:
    e = entry("str_verifier", "4", correct_letter="C", refusal_letter="E")
    assert grade_mcq(e, "C", "mcq-refusal").correct
    assert grade_mcq(e, " c. ", "mcq-refusal").correct
    refused = grade_mcq(e, "E", "mcq-refusal")
    assert not refused.correct and refused.refused
    wrong = grade_mcq(e, "A", "mcq-refusal")
    assert not wrong.correct and not wrong.refused
    assert not grade_mcq(e, "4", "mcq").correct  # the option's text is not a letter
    assert grade_mcq(e, "", "mcq").method == "empty"


def test_unanswered_questions_are_graded_incorrect() -> None:
    key = {
        "q1": KeyEntry("q1", "?", "str_verifier", "4"),
        "q2": KeyEntry("q2", "?", "range_verifier", "(1,2)"),
    }
    grades = asyncio.run(grade_answers(key, {"q1": "4"}, "open", None))
    assert [(g.question_id, g.correct, g.method) for g in grades] == [
        ("q1", True, "exact"),
        ("q2", False, "empty"),
    ]


def test_wilson_interval_and_summary() -> None:
    low, high = wilson(8, 10) or (0, 0)
    assert low == pytest.approx(0.4902, abs=1e-3) and high == pytest.approx(0.9433, abs=1e-3)
    assert wilson(0, 0) is None and accuracy([])["accuracy"] is None
    assert wilson(0, 5) == pytest.approx((0.0, 0.4345), abs=1e-3)
    rows = [
        {
            "eval_mode": "str_verifier",
            "correct": True,
            "correct_strict": True,
            "graded": True,
            "refused": False,
        },
        {
            "eval_mode": "str_verifier",
            "correct": False,
            "correct_strict": False,
            "graded": True,
            "refused": True,
        },
        {
            "eval_mode": "llm_verifier",
            "correct": True,
            "correct_strict": False,
            "graded": True,
            "refused": False,
        },
    ]
    summary = summarise(rows)
    assert (summary["correct"], summary["n"], summary["strict"]["correct"]) == (2, 3, 1)
    assert summary["by_eval_mode"]["str_verifier"]["correct"] == 1
    assert summary["precision"] == 1.0 and summary["refused"] == 1


def test_paired_comparison() -> None:
    assert mcnemar_exact(0, 0) is None
    assert mcnemar_exact(0, 5) == pytest.approx(0.0625)
    assert mcnemar_exact(3, 3) == 1.0
    a = {"q1": True, "q2": False, "q3": False, "q4": True, "q5": False}
    b = {"q1": True, "q2": True, "q3": True, "q4": False, "q5": False}
    capsule_of = {"q1": "c1", "q2": "c1", "q3": "c2", "q4": "c2", "q5": "c3"}
    result = paired(a, b, capsule_of, resamples=2000)
    assert (result["both_correct"], result["only_a_correct"], result["only_b_correct"]) == (1, 1, 2)
    assert result["neither_correct"] == 1 and result["difference_b_minus_a"] == pytest.approx(0.2)
    low, high = result["capsule_bootstrap95"]
    assert low <= 0.2 <= high
    assert paired({"q1": True}, {"q1": True}, {"q1": "c1"})["capsule_bootstrap95"] is None
