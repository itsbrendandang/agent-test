"""Grading for BixBench v1.5 answers. Runs on the host, after the solver has finished.

The official repository (Future-House/BixBench, commit 4931118) has two graders:
  * bixbench/graders.py, used by grade_outputs.py: rules per `eval_mode`;
  * bixbench/postprocessing.py, used for the paper's agent runs: one LLM prompt for every
    open answer, whatever its `eval_mode`.
Three profiles are offered here. The judge prompts are the official ones, verbatim.

"per-mode" (default, ours):
  str_verifier    if both sides are one number: equal as numbers, decided in code (a value that
                  matches only after a factor of 100, or where one side carries a percent sign,
                  goes to the LLM judge with a note); otherwise normalised equality (letters
                  and digits, lower case), else the LLM judge;
  range_verifier  the answer parsed as one number must lie in the ideal range (bounds
                  included). Out of range but in range after a factor of 100, or carrying a
                  percent sign: the LLM judge with a note. Not one number: the LLM judge. Both
                  with the official range prompt;
  llm_verifier    the LLM judge (skipped when both sides are the same number, or are not
                  numbers and are equal after normalising).
"official" reproduces graders.py as grade_outputs.py calls it: str_verifier is normalised
  equality, then "answer is a substring of the ideal", then the LLM judge; range_verifier and
  llm_verifier always go to the LLM judge with the one generic open-answer prompt. (Upstream
  has a range prompt, OPEN_ENDED_RANGE_GRADING_PROMPT, but no code path reaches it; it is used
  here only by "per-mode".)
"paper" reproduces postprocessing.py: one binary LLM prompt for every question; the answer is
  correct only if the reply is exactly "1" (the reply is not stripped; a reply that is "1"
  only after stripping is graded incorrect and the grade's note says so).

Judge per profile (`PROFILE_JUDGES`): per-mode openai/gpt-4o at temperature 0 (ours, for
repeatability); official openai/gpt-4o at 1.0 (grade_outputs.py's defaults); paper
anthropic/claude-3-5-sonnet-20241022 at the provider's default temperature (postprocessing.py).
grade.json records the judge and temperature used per profile; the report flags a judge or
temperature that is not the profile's default.

Refusals. Upstream records a refusal only for the multiple-choice refusal option. In "official"
and "paper" an open answer is therefore never `refused`; what we would count (no answer, or a
judge reply of `refused`) is kept in `own_refused`. "per-mode" sets both.

Differences from the official code, all profiles:
  * an empty answer is incorrect without a judge call and stays in the denominator
    (officially an empty string is a substring of every ideal and is graded correct in
    str_verifier; through upstream's CSV path an empty answer becomes "nan"; upstream's paper
    path drops empty answers from the denominator);
  * a judge call that fails three times is recorded as "judge_error" and reported as ungraded.
Differences in "per-mode" only: the substring rule is not used (it accepts "6" for an ideal of
"166"); numbers are compared as numbers and never as normalised strings (normalising drops "-"
and ".", so "-4.96", "4.96" and "49.6" would all be equal); ranges are checked in code, with
reversed bounds in the ideal swapped (two rows of v1.5 are written upper bound first).

The judge sees the question, the ideal answer and the submitted answer. It never sees the
solver's reasoning, route or evidence.
"""

from __future__ import annotations

import ast
import asyncio
import math
import re
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import asdict, dataclass
from typing import Any, Literal

from .dataset import AnswerMode, EvalMode, KeyEntry
from .text import normalise, parse_number

# Verbatim from bixbench/prompts.py (Apache-2.0).
OPEN_ENDED_GRADING_PROMPT = """You are given a question, target answer and a predicted answer. Your task is to compare the target answer with the predicted and assess if the predicted answer is correct, incorrect or it refused to answer.
Question: {question}
Target Answer: {target}
Predicted Answer: {predicted}

Important: You must only output one from `correct`, `incorrect` or `refused` between <grade> tags.
Example Output: <grade> correct </grade>
"""

OPEN_ENDED_RANGE_GRADING_PROMPT = """You are given a question, target range using the format (lower,upper) and a predicted answer. Your task is to compare the target range with the predicted and assess if the predicted answer falls within the specified range. If it falls within the range, it is correct, otherwise it is incorrect. If the predicted answer cannot be compared to the target range, it is refused to answer.
Question: {question}
Target Range: {target}
Predicted Answer: {predicted}

Important: You must only output one from `correct`, `incorrect` or `refused` between <grade> tags.
Example Output: <grade> correct </grade>
"""

OPEN_ENDED_EVAL_PROMPT = """
Here is a question, the correct answer to the question, and a proposed answer.
Question: {question}
Correct answer: {correct_answer}
Proposed answer: {proposed_answer}
You must respond with a binary score (0 or 1) for whether the proposed answer is equivalent  to the correct answer.
\nNothing else is permitted.
"""

Profile = Literal["per-mode", "official", "paper"]
PROFILES: tuple[Profile, ...] = ("per-mode", "official", "paper")
Judge = Callable[[str], Awaitable[str]]


@dataclass(frozen=True)
class JudgeSpec:
    """A judge model and its temperature (None = the provider's default)."""

    model: str
    temperature: float | None


# What each profile's upstream code uses, except per-mode's temperature, which is ours.
PROFILE_JUDGES: dict[Profile, JudgeSpec] = {
    "per-mode": JudgeSpec("openai/gpt-4o", 0.0),
    "official": JudgeSpec("openai/gpt-4o", 1.0),
    "paper": JudgeSpec("anthropic/claude-3-5-sonnet-20241022", None),
}
SCALE_NOTE = (
    "not equal as written, but a factor of 100 or a percent sign separates it from the ideal "
    "(a fraction/percentage difference is possible); left to the judge"
)
JUDGE_ATTEMPTS = 3


def judge_record(profile: Profile, model: str | None, temperature: float | None) -> dict[str, Any]:
    """What grade.json says about a profile's judge: what was used, the profile's default, and
    every way the two differ. Temperature 0 with "official" or "paper" is such a deviation."""
    default = PROFILE_JUDGES[profile]
    deviations: list[str] = []
    if model is None:
        deviations.append("no judge: code rules only, the rest is ungraded")
    else:
        if model != default.model:
            deviations.append(f"judge {model} is not this profile's default ({default.model})")
        if temperature != default.temperature:
            said = "provider default" if temperature is None else f"{temperature:g}"
            want = "provider default" if default.temperature is None else f"{default.temperature:g}"
            deviations.append(f"judge temperature {said}; this profile's default is {want}")
    return {
        "model": model,
        "temperature": temperature if model is not None else None,
        "profile_default": {"model": default.model, "temperature": default.temperature},
        "deviations": deviations,
    }


# Methods decided by code alone. `correct_strict` in a grade counts only these.
DETERMINISTIC = frozenset({"exact", "numeric", "range", "letter", "empty", "partial"})


@dataclass
class Grade:
    question_id: str
    eval_mode: EvalMode
    answer_mode: AnswerMode
    profile: Profile
    predicted: str
    correct: bool
    refused: bool
    method: str  # exact, numeric, range, partial, letter, empty, llm, llm_range, llm_binary, judge_error
    judge_response: str | None = None
    note: str = ""
    # Our own reading of a refusal (no answer, or the judge replied `refused`). `refused` is
    # upstream's: in "official" and "paper" it is never set for an open answer.
    own_refused: bool = False

    @property
    def graded(self) -> bool:
        return self.method != "judge_error"

    @property
    def correct_strict(self) -> bool:
        """Correct by a rule that needs no judge."""
        return self.correct and self.method in DETERMINISTIC

    def to_dict(self) -> dict[str, Any]:
        return {**asdict(self), "graded": self.graded, "correct_strict": self.correct_strict}


def parse_range(ideal: str) -> tuple[float, float, bool]:
    """(lower, upper, bounds_were_reversed) from an ideal such as "(0.6 , 0.7)"."""
    lower, upper = ast.literal_eval(ideal.strip())
    low, high = float(lower), float(upper)
    return (low, high, False) if low <= high else (high, low, True)


def parse_judge_grade(response: str) -> tuple[bool, bool]:
    """(correct, refused) from a <grade> response. Official rule: correct only if it says so."""
    match = re.search(r"<grade>\s*(.*?)\s*</grade>", response, re.DOTALL)
    grade = match[1].strip().lower() if match else None
    return grade == "correct", grade == "refused"


def numbers_equal(a: float, b: float) -> bool:
    return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-12)


async def _ask(judge: Judge | None, prompt: str) -> str | None:
    if judge is None:
        return None
    for attempt in range(JUDGE_ATTEMPTS):
        try:
            return await judge(prompt)
        except Exception:
            if attempt + 1 < JUDGE_ATTEMPTS:
                await asyncio.sleep(2**attempt)
    return None


def scale_ambiguous(
    value: float, predicted: str, ideal: str, fits: Callable[[float], bool]
) -> bool:
    """Could `value` be the ideal on another scale? True if 100 times or a hundredth of it fits,
    or exactly one of the two texts carries a percent sign."""
    return fits(value * 100) or fits(value / 100) or (("%" in predicted) != ("%" in ideal))


async def grade_open(
    entry: KeyEntry, predicted: str, judge: Judge | None, profile: Profile = "per-mode"
) -> Grade:
    """Grade one open answer. `judge=None` means deterministic rules only: whatever would need
    the judge is recorded as "judge_error" (ungraded), never as incorrect."""
    predicted = predicted.strip()

    def result(correct: bool, method: str, refused: bool = False, **extra: Any) -> Grade:
        return Grade(
            entry.question_id, entry.eval_mode, "open", profile, predicted, correct,
            refused and profile == "per-mode", method, own_refused=refused, **extra,
        )  # fmt: skip

    async def judged(template: str, method: str, note: str = "") -> Grade:
        prompt = template.format(question=entry.question, target=entry.ideal, predicted=predicted)
        response = await _ask(judge, prompt)
        if response is None:
            why = "no judge, or the judge call failed"
            return result(False, "judge_error", note=f"{why}; {note}" if note else why)
        correct, refused = parse_judge_grade(response)
        return result(correct, method, refused, judge_response=response[:500], note=note)

    if not predicted:
        return result(False, "empty", refused=True, note="no answer submitted")
    if profile == "paper":
        prompt = OPEN_ENDED_EVAL_PROMPT.format(
            question=entry.question, correct_answer=entry.ideal, proposed_answer=predicted
        )
        response = await _ask(judge, prompt)
        if response is None:
            return result(False, "judge_error", note="no judge, or the judge call failed")
        # The reply is compared with "1" exactly, not stripped.
        note = (
            'the reply is "1" only after stripping whitespace; it is compared exactly'
            if response != "1" and response.strip() == "1"
            else ""
        )
        return result(response == "1", "llm_binary", judge_response=response[:500], note=note)

    if profile == "official":
        if entry.eval_mode == "str_verifier":
            if normalise(predicted) == normalise(entry.ideal):
                return result(True, "exact")
            if normalise(predicted) and normalise(predicted) in normalise(entry.ideal):
                return result(True, "partial", note="official substring rule")
        # Upstream sends range_verifier to the same generic prompt as llm_verifier.
        return await judged(OPEN_ENDED_GRADING_PROMPT, "llm")

    # per-mode. Two numbers are compared as numbers: normalising would drop "-" and ".".
    ours, theirs = parse_number(predicted), parse_number(entry.ideal)
    if entry.eval_mode == "range_verifier":
        low, high, reversed_bounds = parse_range(entry.ideal)
        note = "ideal bounds were written upper first; swapped" if reversed_bounds else ""
        if ours is None:
            return await judged(OPEN_ENDED_RANGE_GRADING_PROMPT, "llm_range", note)
        if low <= ours <= high:
            return result(True, "range", note=note)
        if scale_ambiguous(ours, predicted, "", lambda v: low <= v <= high):
            return await judged(
                OPEN_ENDED_RANGE_GRADING_PROMPT,
                "llm_range",
                "; ".join(n for n in (SCALE_NOTE, note) if n),
            )
        return result(False, "range", note=note)
    if ours is not None and theirs is not None:
        if numbers_equal(ours, theirs):
            return result(True, "numeric")
        if scale_ambiguous(ours, predicted, entry.ideal, lambda v: numbers_equal(v, theirs)):
            return await judged(OPEN_ENDED_GRADING_PROMPT, "llm", SCALE_NOTE)
        if entry.eval_mode == "str_verifier":
            return result(False, "numeric", note="both are numbers and they differ")
        return await judged(OPEN_ENDED_GRADING_PROMPT, "llm")
    if normalise(predicted) == normalise(entry.ideal):
        return result(True, "exact")
    return await judged(OPEN_ENDED_GRADING_PROMPT, "llm")


def grade_mcq(
    entry: KeyEntry, predicted: str, answer_mode: AnswerMode, profile: Profile = "per-mode"
) -> Grade:
    """Letter match, as the official MCQGrader: normalised equality with the correct letter;
    choosing the refusal option is a refusal (and incorrect). No answer at all is incorrect and
    not a refusal (it stays in precision's denominator); `own_refused` records it."""
    assert entry.correct_letter is not None
    cleaned = normalise(predicted)
    refused = entry.refusal_letter is not None and cleaned == entry.refusal_letter.lower()
    if not cleaned:
        return Grade(
            entry.question_id, entry.eval_mode, answer_mode, profile, predicted, False, False,
            "empty", note="no answer submitted", own_refused=True,
        )  # fmt: skip
    return Grade(
        entry.question_id, entry.eval_mode, answer_mode, profile, predicted,
        cleaned == entry.correct_letter.lower(), refused, "letter", own_refused=refused,
    )  # fmt: skip


async def grade_answers(
    key: Mapping[str, KeyEntry],
    answers: Mapping[str, str],
    answer_mode: AnswerMode = "open",
    judge: Judge | None = None,
    profile: Profile = "per-mode",
) -> list[Grade]:
    """One grade per question in `key`; a question with no submitted answer is incorrect."""
    grades: list[Grade] = []
    for question_id, entry in key.items():
        predicted = str(answers.get(question_id, "") or "")
        if answer_mode == "open":
            grades.append(await grade_open(entry, predicted, judge, profile))
        else:
            grades.append(grade_mcq(entry, predicted, answer_mode, profile))
    return grades


class InspectJudge:
    """LLM judge through Inspect's model API. Counts its own tokens so a run can budget them."""

    def __init__(self, model: str, temperature: float | None = None) -> None:
        # temperature=None leaves the provider default (some reasoning models accept no other).
        self.model, self.temperature = model, temperature
        self.calls = 0
        self.tokens = 0

    async def __call__(self, prompt: str) -> str:
        from inspect_ai.model import GenerateConfig, get_model

        output = await get_model(self.model).generate(
            prompt, config=GenerateConfig(temperature=self.temperature)
        )
        self.calls += 1
        if output.usage is not None:
            self.tokens += int(output.usage.total_tokens)
        return str(output.completion)
