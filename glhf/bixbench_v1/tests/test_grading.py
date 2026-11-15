"""Grading rules per eval mode and profile. The judge is a function, so no paid call is made."""

from __future__ import annotations

import asyncio

import pytest

from bixbench_v1 import grading
from bixbench_v1.answers import compare
from bixbench_v1.dataset import KeyEntry
from bixbench_v1.grading import Grade, grade_answers, grade_mcq, grade_open
from bixbench_v1.stats import (
    accuracy,
    capsule_sign_flip,
    mcnemar_exact,
    mean_over_repeats,
    paired,
    summarise,
    wilson,
)
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
        ("10.6%", "10.6", True, "numeric"),
        ("4,550", "4550", True, "numeric"),
        ("-4.96", "-4.960", True, "numeric"),
        # Normalising drops "-" and ".": these were all "exact" matches before.
        ("-4.96", "4.96", False, "numeric"),
        ("-4.96", "49.6", False, "numeric"),
        ("1.5", "-15", False, "numeric"),
        ("1.5", "15", False, "numeric"),
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
    assert judge.prompts == [] and grade.correct_strict is correct


def test_numbers_are_never_matched_as_normalised_strings() -> None:
    # A judge that would wave anything through is not even asked: code decides numbers.
    for ideal, predicted in (("-4.96", "4.96"), ("-4.96", "49.6"), ("1.5", "-15")):
        assert normalise(ideal) == normalise(predicted) or normalise(ideal) in normalise(predicted)
        judge = FakeJudge("<grade> correct </grade>")
        grade = run(entry("str_verifier", ideal), predicted, judge)
        assert not grade.correct and grade.method == "numeric" and judge.prompts == []
        # llm_verifier: no "exact" shortcut for two different numbers; the judge is asked.
        asked = FakeJudge("<grade> incorrect </grade>")
        other = run(entry("llm_verifier", ideal), predicted, asked)
        assert not other.correct and other.method == "llm" and len(asked.prompts) == 1
        # The answer ledger's comparison has the same rule.
        assert compare(ideal, predicted) == "differ"
    # A factor of 100, or a percent sign on one side only, is a possible unit difference:
    # not decided in code, sent to the judge with a note.
    for ideal, predicted in (("35%", "0.35"), ("0.35", "35"), ("35", "35.5%")):
        judge = FakeJudge("<grade> incorrect </grade>")
        grade = run(entry("str_verifier", ideal), predicted, judge)
        assert grade.method == "llm" and "factor of 100" in grade.note and len(judge.prompts) == 1
        assert run(entry("str_verifier", ideal), predicted, None).method == "judge_error"


def test_str_verifier_falls_back_to_the_judge_like_the_official_grader() -> None:
    judge = FakeJudge("<grade> correct </grade>")
    grade = run(entry("str_verifier", "CD14"), "CD14 monocytes", judge)
    assert grade.correct and grade.method == "llm" and not grade.correct_strict
    assert len(judge.prompts) == 1
    assert grade.judge_response == "<grade> correct </grade>"
    # Two different numbers are decided by code; no judge can wave "6" through for "166".
    lenient = FakeJudge("<grade> correct </grade>")
    wrong = run(entry("str_verifier", "166"), "6", lenient)
    assert not wrong.correct and wrong.method == "numeric" and lenient.prompts == []


def test_the_official_substring_rule_is_only_in_the_official_profile() -> None:
    e = entry("str_verifier", "166")
    assert run(e, "6", FakeJudge("<grade> incorrect </grade>"), "official").method == "partial"
    assert run(e, "6", FakeJudge("<grade> incorrect </grade>"), "official").correct
    assert not run(e, "6", FakeJudge("<grade> incorrect </grade>"), "per-mode").correct
    # Upstream grades an empty answer correct (it is a substring of anything). Not here.
    for profile in ("per-mode", "official", "paper"):
        empty = run(e, "   ", FakeJudge(), profile)
        assert not empty.correct and empty.method == "empty" and empty.own_refused


def test_official_and_paper_never_mark_an_open_answer_refused() -> None:
    e = entry("llm_verifier", "a long answer")
    says_refused = "<grade> refused </grade>"
    ours = run(e, "cannot tell", FakeJudge(says_refused), "per-mode")
    assert ours.refused and ours.own_refused
    for profile, reply in (("official", says_refused), ("paper", "0")):
        for predicted in ("cannot tell", ""):
            grade = run(e, predicted, FakeJudge(reply), profile)
            assert grade.refused is False and not grade.correct
        assert run(e, "", FakeJudge(reply), profile).own_refused  # our count, kept apart
    assert run(e, "cannot tell", FakeJudge(says_refused), "official").own_refused
    rows = [run(e, "", FakeJudge(), "official").to_dict(), ours.to_dict()]
    summary = summarise(rows)
    assert (summary["refused"], summary["own_refused"]) == (1, 2)
    # Precision is upstream's metric for the refusal option; open answers have none.
    assert summary["precision"] is None
    mcq = entry("str_verifier", "4", correct_letter="C", refusal_letter="E")
    letters = [grade_mcq(mcq, x, "mcq-refusal").to_dict() for x in ("C", "E", "A", "")]
    assert summarise(letters)["precision"] == pytest.approx(1 / 3)  # no answer is not a refusal
    assert summarise([grade_mcq(mcq, "C", "mcq").to_dict()])["precision"] is None


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
        ("(1.13e-10,1.13e-12)", "5e-6", False),
        ("(24,26)", "30", False),
        ("(24,26)", "-25", False),
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


def test_official_grades_a_range_with_the_generic_prompt_as_upstream_does() -> None:
    # Upstream's range prompt is dead code: range_verifier gets the one open-answer prompt.
    judge = FakeJudge()
    official = run(entry("range_verifier", "(24,26)"), "25", judge, "official")
    assert official.method == "llm" and official.correct
    assert judge.prompts == [
        grading.OPEN_ENDED_GRADING_PROMPT.format(
            question="What is it?", target="(24,26)", predicted="25"
        )
    ]
    assert "Target Range" not in judge.prompts[0]
    assert "Target Range" in grading.OPEN_ENDED_RANGE_GRADING_PROMPT  # kept for per-mode only


@pytest.mark.parametrize(
    ("ideal", "predicted"),
    [
        ("(24,26)", "0.25"),  # times 100 is in range
        ("(0.24,0.26)", "25"),  # a hundredth is in range
        ("(0.24,0.26)", "25%"),
        ("(24,26)", "30%"),  # out of range and carries a percent sign
    ],
)
def test_a_range_answer_off_by_a_scale_goes_to_the_judge_with_a_note(
    ideal: str, predicted: str
) -> None:
    for reply, correct in (
        ("<grade> correct </grade>", True),
        ("<grade> incorrect </grade>", False),
    ):
        judge = FakeJudge(reply)
        grade = run(entry("range_verifier", ideal), predicted, judge)
        assert (grade.method, grade.correct) == ("llm_range", correct) and len(judge.prompts) == 1
        assert "factor of 100" in grade.note and f"Target Range: {ideal}" in judge.prompts[0]
    ungraded = run(entry("range_verifier", ideal), predicted, None)
    assert ungraded.method == "judge_error" and "factor of 100" in ungraded.note


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
    # The reply must be exactly "1": anything else, even "1" with a newline, is incorrect,
    # and the grade says when stripping would have changed the verdict.
    for reply in ("1\n", " 1", "1.", "Score: 1", "10"):
        grade = run(entry("str_verifier", "7"), "7", FakeJudge(reply), "paper")
        assert not grade.correct, reply
        assert ("only after stripping" in grade.note) is (reply.strip() == "1")


def test_each_profile_has_its_judge_and_deviations_are_recorded() -> None:
    assert grading.PROFILE_JUDGES["paper"] == grading.JudgeSpec(
        "anthropic/claude-3-5-sonnet-20241022", None
    )
    assert grading.PROFILE_JUDGES["official"].model == "openai/gpt-4o"
    assert grading.judge_record("paper", "anthropic/claude-3-5-sonnet-20241022", None) == {
        "model": "anthropic/claude-3-5-sonnet-20241022",
        "temperature": None,
        "profile_default": {"model": "anthropic/claude-3-5-sonnet-20241022", "temperature": None},
        "deviations": [],
    }
    assert grading.judge_record("official", "openai/gpt-4o", 1.0)["deviations"] == []
    for profile in ("official", "paper"):
        zero = grading.judge_record(profile, grading.PROFILE_JUDGES[profile].model, 0.0)  # type: ignore[index]
        assert len(zero["deviations"]) == 1 and "temperature 0;" in zero["deviations"][0]
    other = grading.judge_record("paper", "openai/gpt-4o", None)["deviations"]
    assert len(other) == 1 and "not this profile's default" in other[0]
    assert "no judge" in grading.judge_record("official", None, None)["deviations"][0]
    assert grading.InspectJudge("x/y").temperature is None  # provider default unless told


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
        ("q1", True, "numeric"),
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
    assert summary["precision"] is None and summary["refused"] == 1
    assert summary["lower_bound"] is False


def _pairs(capsules: int, flip_every: int = 2) -> tuple[dict, dict, dict]:  # type: ignore[type-arg]
    a, b, capsule_of = {}, {}, {}
    for c in range(capsules):
        for q in range(3):
            key = f"c{c}-q{q}"
            a[key], b[key], capsule_of[key] = q == 0, q == 0 or c % flip_every == 0, f"c{c}"
    return a, b, capsule_of


def test_paired_comparison() -> None:
    assert mcnemar_exact(0, 0) is None
    assert mcnemar_exact(0, 5) == pytest.approx(0.0625)
    assert mcnemar_exact(3, 3) == 1.0
    assert "independent" in str(mcnemar_exact.__doc__)
    a = {"q1": True, "q2": False, "q3": False, "q4": True, "q5": False}
    b = {"q1": True, "q2": True, "q3": True, "q4": False, "q5": False}
    capsule_of = {"q1": "c1", "q2": "c1", "q3": "c2", "q4": "c2", "q5": "c3"}
    result = paired(a, b, capsule_of, resamples=2000)
    assert (result["both_correct"], result["only_a_correct"], result["only_b_correct"]) == (1, 1, 2)
    assert result["neither_correct"] == 1 and result["difference_b_minus_a"] == pytest.approx(0.2)
    assert "independent" in result["mcnemar_assumes"]
    # Three capsules: a percentile interval from three resampled units is not an estimate.
    assert result["capsule_bootstrap95"] is None
    assert "not estimable: 3 capsule(s)" in result["capsule_bootstrap_note"]
    nine, ten = paired(*_pairs(9), resamples=500), paired(*_pairs(10), resamples=500)
    assert nine["capsule_bootstrap95"] is None and ten["capsule_bootstrap95"] is not None
    low, high = ten["capsule_bootstrap95"]
    assert low <= ten["difference_b_minus_a"] <= high and ten["capsule_bootstrap_note"] is None
    # Enough capsules but no discordant pair: every resample is 0, which is not an interval.
    same = {f"c{c}-q0": True for c in range(12)}
    agree = paired(same, dict(same), {k: k[:3] for k in same})
    assert (
        agree["capsule_bootstrap95"] is None and "0 discordant" in agree["capsule_bootstrap_note"]
    )
    assert agree["capsule_sign_flip"] is None


def test_capsule_sign_flip_permutation_test() -> None:
    # Exact for small numbers of capsules. Sums +2, +2, +2: |total| = 6 only when all three
    # signs agree, 2 of the 8 patterns.
    assert capsule_sign_flip([2, 2, 2]) == {
        "p": 0.25,
        "method": "exact",
        "capsules_with_a_difference": 3,
    }
    # Capsules with no difference carry no information and are left out.
    assert capsule_sign_flip([2, 0, 2, 0, 2])["p"] == 0.25  # type: ignore[index]
    assert capsule_sign_flip([1, -1])["p"] == 1.0 and capsule_sign_flip([0, 0]) is None  # type: ignore[index]
    assert capsule_sign_flip([1] * 10)["p"] == pytest.approx(2 / 2**10)  # type: ignore[index]
    # One capsule with six questions all won is ONE observation: McNemar says 0.03, this says 1.
    assert mcnemar_exact(0, 6) == pytest.approx(0.03125)
    assert capsule_sign_flip([6])["p"] == 1.0  # type: ignore[index]
    exact = capsule_sign_flip([1.0] * 20)
    assert (
        exact is not None and exact["method"] == "exact" and exact["p"] == pytest.approx(2 / 2**20)
    )
    # More than 20 capsules with a difference: Monte Carlo, seeded, never exactly zero.
    many = capsule_sign_flip([1.0] * 21 + [-1.0] * 2, resamples=20_000, seed=1)
    assert many is not None and many["method"].startswith("monte carlo")
    assert 0 < many["p"] < 0.001 and many == capsule_sign_flip([1.0] * 21 + [-1.0] * 2, 20_000, 1)
    balanced = capsule_sign_flip([1.0, -1.0] * 15, resamples=5000)
    assert balanced is not None and balanced["p"] > 0.9
    # The paired comparison reports it, from per-capsule (b - a) sums.
    a, b, capsule_of = _pairs(4, flip_every=1)  # b wins two questions in each of four capsules
    result = paired(a, b, capsule_of)
    assert result["capsule_sign_flip"] == {
        "p": 0.125,
        "method": "exact",
        "capsules_with_a_difference": 4,
    }
    assert result["mcnemar_exact_p"] == pytest.approx(2 / 2**8)  # eight "independent" wins


def test_mean_accuracy_over_repeats_and_the_lower_bound_flag() -> None:
    def row(repeat: int | None, correct: bool, graded: bool = True) -> dict:  # type: ignore[type-arg]
        base = {"eval_mode": "str_verifier", "correct": correct, "graded": graded}
        return base if repeat is None else {**base, "repeat": repeat}

    rows = [
        row(None, True),
        row(0, True),
        row(1, True),
        row(1, False),
        row(1, False),
        row(1, False),
    ]
    over = mean_over_repeats(rows)
    assert over["repeats"] == 2 and over["accuracy_by_repeat"] == {"0": 1.0, "1": 0.25}
    # The mean of the repeats' accuracies (0.625), not the pooled 3/6.
    assert over["mean_accuracy"] == pytest.approx(0.625)
    assert over["sd_between_repeats"] == pytest.approx(0.5303, abs=1e-3)
    assert mean_over_repeats([row(0, True)])["sd_between_repeats"] is None
    assert mean_over_repeats([])["mean_accuracy"] is None
    assert summarise([row(0, True), row(0, False, graded=False)])["lower_bound"] is True
