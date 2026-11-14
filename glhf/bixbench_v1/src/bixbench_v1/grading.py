"""Grading for BixBench v1.5 answers. Runs on the host, after the solver has finished.

The official repository (Future-House/BixBench, commit 4931118) has two graders:
  * bixbench/graders.py, used by grade_outputs.py: rules per `eval_mode`;
  * bixbench/postprocessing.py, used for the paper's agent runs: one LLM prompt for every
    open answer, whatever its `eval_mode`.
Three profiles are offered here. The judge prompts are the official ones, verbatim.

"per-mode" (default):
  str_verifier    normalised equality (letters and digits, lower case), else equal as numbers,
                  else the LLM judge;
  range_verifier  the answer parsed as one number must lie in the ideal range (bounds
                  included); an answer that is not one number goes to the LLM judge with the
                  official range prompt;
  llm_verifier    the LLM judge (skipped when the answer equals the ideal after normalising).
"official" reproduces graders.py as grade_outputs.py calls it: str_verifier is normalised
  equality, then "answer is a substring of the ideal", then the LLM judge; range_verifier and
  llm_verifier always go to the LLM judge.
"paper" reproduces postprocessing.py: one binary LLM prompt for every question.

Differences from the official code, all profiles:
  * an empty answer is incorrect without a judge call (officially an empty string is a
    substring of every ideal and is graded correct in str_verifier);
  * a judge call that fails three times is recorded as "judge_error" and reported as ungraded;
  * the judge temperature defaults to 0 (grade_outputs.py defaults to 1.0).
Differences in "per-mode" only: the substring rule is not used (it accepts "6" for an ideal of
"166"); numbers are compared as numbers before any judge call; ranges are checked in code, with
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
JUDGE_ATTEMPTS = 3
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


async def grade_open(
    entry: KeyEntry, predicted: str, judge: Judge | None, profile: Profile = "per-mode"
) -> Grade:
    """Grade one open answer. `judge=None` means deterministic rules only: whatever would need
    the judge is recorded as "judge_error" (ungraded), never as incorrect."""
    predicted = predicted.strip()

    def result(correct: bool, method: str, refused: bool = False, **extra: Any) -> Grade:
        return Grade(
            entry.question_id, entry.eval_mode, "open", profile, predicted, correct, refused,
            method, **extra,
        )  # fmt: skip

    async def judged(template: str, method: str) -> Grade:
        prompt = template.format(question=entry.question, target=entry.ideal, predicted=predicted)
        response = await _ask(judge, prompt)
        if response is None:
            return result(False, "judge_error", note="no judge, or the judge call failed")
        correct, refused = parse_judge_grade(response)
        return result(correct, method, refused, judge_response=response[:500])

    if not predicted:
        return result(False, "empty", refused=True, note="no answer submitted")
    if profile == "paper":
        prompt = OPEN_ENDED_EVAL_PROMPT.format(
            question=entry.question, correct_answer=entry.ideal, proposed_answer=predicted
        )
        response = await _ask(judge, prompt)
        if response is None:
            return result(False, "judge_error", note="no judge, or the judge call failed")
        return result(response.strip() == "1", "llm_binary", judge_response=response[:500])

    exact = normalise(predicted) == normalise(entry.ideal)
    if entry.eval_mode == "str_verifier":
        if exact:
            return result(True, "exact")
        if profile == "official":
            if normalise(predicted) and normalise(predicted) in normalise(entry.ideal):
                return result(True, "partial", note="official substring rule")
        else:
            ours, theirs = parse_number(predicted), parse_number(entry.ideal)
            if ours is not None and theirs is not None and numbers_equal(ours, theirs):
                return result(True, "numeric")
        return await judged(OPEN_ENDED_GRADING_PROMPT, "llm")
    if entry.eval_mode == "range_verifier":
        if profile == "official":
            return await judged(OPEN_ENDED_RANGE_GRADING_PROMPT, "llm_range")
        low, high, reversed_bounds = parse_range(entry.ideal)
        note = "ideal bounds were written upper first; swapped" if reversed_bounds else ""
        value = parse_number(predicted)
        if value is None:
            return await judged(OPEN_ENDED_RANGE_GRADING_PROMPT, "llm_range")
        return result(low <= value <= high, "range", note=note)
    if profile == "per-mode" and exact:
        return result(True, "exact")
    return await judged(OPEN_ENDED_GRADING_PROMPT, "llm")


def grade_mcq(entry: KeyEntry, predicted: str, answer_mode: AnswerMode) -> Grade:
    """Letter match, as the official MCQGrader: normalised equality with the correct letter;
    choosing the refusal option is a refusal (and incorrect)."""
    assert entry.correct_letter is not None
    cleaned = normalise(predicted)
    refused = entry.refusal_letter is not None and cleaned == entry.refusal_letter.lower()
    if not cleaned:
        return Grade(
            entry.question_id, entry.eval_mode, answer_mode, "per-mode", predicted, False, True,
            "empty", note="no answer submitted",
        )  # fmt: skip
    return Grade(
        entry.question_id, entry.eval_mode, answer_mode, "per-mode", predicted,
        cleaned == entry.correct_letter.lower(), refused, "letter",
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
            grades.append(grade_mcq(entry, predicted, answer_mode))
    return grades


class InspectJudge:
    """LLM judge through Inspect's model API. Counts its own tokens so a run can budget them."""

    def __init__(self, model: str, temperature: float | None = 0.0) -> None:
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
