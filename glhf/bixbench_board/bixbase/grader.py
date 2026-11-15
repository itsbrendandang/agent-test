"""Grading — vendored from the official BixBench scoring procedure.

Matches Future-House/BixBench bixbench/graders.py + utils.py:
  - mcq / str_verifier: strip non-alphanumerics, lowercase, exact match
  - openanswer / llm_verifier (default): judge model answers
    `correct | incorrect | refused` inside <grade> tags; correct=1, else 0
  - range_verifier: predicted float within (lower, upper) target tuple
  - compute_metrics: accuracy, precision (excl. refusals), coverage

The judge model call goes through its own Budget so judge token usage is
accounted separately from the solver's budget.
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Literal

from .budget import Budget
from .llm import LLMClient
from .prompts import OPEN_ENDED_GRADING_PROMPT, OPEN_ENDED_RANGE_GRADING_PROMPT

EvalMode = Literal["str_verifier", "range_verifier", "llm_verifier"]


class GradeType(StrEnum):
    CORRECT = "correct"
    INCORRECT = "incorrect"
    REFUSED = "refused"


@dataclass
class GradeResult:
    grade: int  # 0 or 1
    correct: bool
    refusal: bool
    grade_type: GradeType
    raw_response: str | None = None


def _parse_grade_response(response: str) -> GradeType:
    match = re.search(r"<grade>\s*(.*?)\s*</grade>", response, re.DOTALL)
    grade = match[1].strip().lower() if match else None
    if grade == "correct":
        return GradeType.CORRECT
    if grade == "refused":
        return GradeType.REFUSED
    return GradeType.INCORRECT


def _result(t: GradeType, raw: str | None = None) -> GradeResult:
    return GradeResult(
        grade=1 if t == GradeType.CORRECT else 0,
        correct=t == GradeType.CORRECT,
        refusal=t == GradeType.REFUSED,
        grade_type=t,
        raw_response=raw,
    )


def grade_str_verifier(
    target: str, predicted: str, unsure: str | None = None
) -> GradeResult:
    """Official MCQ grading: normalized exact match."""
    cleaned_target = re.sub(r"[^a-zA-Z0-9]", "", target).lower()
    cleaned_predicted = re.sub(r"[^a-zA-Z0-9]", "", predicted).lower()
    if cleaned_predicted == cleaned_target:
        return _result(GradeType.CORRECT)
    if unsure is not None and predicted == unsure:
        return _result(GradeType.REFUSED)
    return _result(GradeType.INCORRECT)


def grade_range_verifier(target: str, predicted: str) -> GradeResult:
    lower, upper = ast.literal_eval(target)
    t = (
        GradeType.CORRECT
        if lower <= float(predicted) <= upper
        else GradeType.INCORRECT
    )
    return _result(t)


def grade_llm_verifier(
    question: str,
    target: str,
    predicted: str,
    llm: LLMClient,
    budget: Budget,
    *,
    template: str = OPEN_ENDED_GRADING_PROMPT,
) -> GradeResult:
    """Official open-answer grading: judge compares predicted vs target."""
    prompt = template.format(
        question=question, target=target, predicted=predicted
    )
    response = llm.complete(prompt, budget=budget)
    return _result(_parse_grade_response(response), raw=response)


def grade_answer(
    question: str,
    target: str,
    predicted: str,
    eval_mode: EvalMode,
    llm: LLMClient | None,
    budget: Budget,
    unsure: str | None = None,
) -> GradeResult:
    if eval_mode == "str_verifier":
        return grade_str_verifier(target, predicted, unsure)
    if eval_mode == "range_verifier":
        try:
            return grade_range_verifier(target, predicted)
        except (ValueError, SyntaxError, TypeError):
            # official fallback: judge with the range prompt
            if llm is None:
                raise
            return grade_llm_verifier(
                question, target, predicted, llm, budget,
                template=OPEN_ENDED_RANGE_GRADING_PROMPT,
            )
    if eval_mode == "llm_verifier":
        if llm is None:
            raise ValueError("llm_verifier requires an LLMClient")
        return grade_llm_verifier(question, target, predicted, llm, budget)
    raise ValueError(f"unknown eval_mode {eval_mode!r}")


def compute_metrics(grades: list[int], is_refused: list[bool]) -> dict:
    """Vendored from official utils.py.

    accuracy  = correct / total
    precision = correct / (total - refused)
    coverage  = (total - refused) / total
    """
    if len(grades) != len(is_refused):
        raise ValueError("grades and is_refused must have the same length")
    n_total = len(grades)
    n_correct = sum(grades)
    n_unsure = sum(bool(x) for x in is_refused)
    n_sure = n_total - n_unsure
    return {
        "accuracy": n_correct / n_total if n_total else 0,
        "precision": n_correct / n_sure if n_sure else 0,
        "coverage": n_sure / n_total if n_total else 0,
        "n_total": n_total,
        "n_correct": n_correct,
        "n_sure": n_sure,
    }
