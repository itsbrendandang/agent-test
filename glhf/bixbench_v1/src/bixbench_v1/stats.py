"""Accuracy with counts and intervals, and the paired comparison of two solvers.

Questions from one capsule share data and are not independent, so the Wilson interval (which
the official harness also reports) is too narrow when capsules have several questions. The
paired comparison therefore also gives a bootstrap interval that resamples whole capsules.
"""

from __future__ import annotations

import math
import random
from collections.abc import Iterable, Mapping
from typing import Any

Z95 = 1.959963984540054


def wilson(correct: int, n: int, z: float = Z95) -> tuple[float, float] | None:
    """Wilson score interval for a proportion (the official harness's wilson_ci, z = 1.96)."""
    if n == 0:
        return None
    p = correct / n
    denominator = 1 + z**2 / n
    centre = (p + z**2 / (2 * n)) / denominator
    spread = z * math.sqrt(p * (1 - p) / n + z**2 / (4 * n**2)) / denominator
    return max(0.0, centre - spread), min(1.0, centre + spread)


def accuracy(flags: Iterable[bool]) -> dict[str, Any]:
    values = list(flags)
    n, correct = len(values), sum(values)
    interval = wilson(correct, n)
    return {
        "correct": correct,
        "n": n,
        "accuracy": correct / n if n else None,
        "wilson95": [round(interval[0], 4), round(interval[1], 4)] if interval else None,
    }


def summarise(grades: list[dict[str, Any]]) -> dict[str, Any]:
    """Accuracy over all questions and per eval mode. Ungraded questions (judge errors) stay in
    the denominator as incorrect and are counted separately, so they cannot flatter a score."""
    out: dict[str, Any] = accuracy(bool(g["correct"]) for g in grades)
    out["strict"] = accuracy(bool(g.get("correct_strict")) for g in grades)
    out["ungraded"] = sum(1 for g in grades if not g.get("graded", True))
    out["refused"] = sum(1 for g in grades if g.get("refused"))
    answered = [g for g in grades if not g.get("refused")]
    # The official compute_metrics: precision = correct / questions not refused.
    out["precision"] = (
        sum(bool(g["correct"]) for g in answered) / len(answered) if answered else None
    )
    out["by_eval_mode"] = {
        mode: accuracy(bool(g["correct"]) for g in grades if g["eval_mode"] == mode)
        for mode in sorted({str(g["eval_mode"]) for g in grades})
    }
    return out


def mcnemar_exact(only_a: int, only_b: int) -> float | None:
    """Two-sided exact McNemar p-value from the discordant pairs (binomial, p = 0.5)."""
    n = only_a + only_b
    if n == 0:
        return None
    tail = sum(math.comb(n, k) for k in range(0, min(only_a, only_b) + 1)) / 2**n
    return float(min(1.0, 2 * tail))


def paired(
    a: Mapping[str, bool],
    b: Mapping[str, bool],
    capsule_of: Mapping[str, str],
    resamples: int = 10_000,
    seed: int = 0,
) -> dict[str, Any]:
    """Compare two solvers on the questions both answered: discordant counts, exact McNemar
    test and a capsule-level bootstrap interval for accuracy(b) - accuracy(a)."""
    shared = sorted(set(a) & set(b))
    both = sum(a[q] and b[q] for q in shared)
    only_a = sum(a[q] and not b[q] for q in shared)
    only_b = sum(b[q] and not a[q] for q in shared)
    neither = len(shared) - both - only_a - only_b
    by_capsule: dict[str, list[str]] = {}
    for q in shared:
        by_capsule.setdefault(capsule_of.get(q, q), []).append(q)
    capsules = sorted(by_capsule)
    rng = random.Random(seed)
    differences: list[float] = []
    if len(capsules) >= 2:
        for _ in range(resamples):
            drawn = [q for c in rng.choices(capsules, k=len(capsules)) for q in by_capsule[c]]
            differences.append(sum(b[q] - a[q] for q in drawn) / len(drawn))
        differences.sort()
    return {
        "n": len(shared),
        "capsules": len(capsules),
        "both_correct": both,
        "only_a_correct": only_a,
        "only_b_correct": only_b,
        "neither_correct": neither,
        "difference_b_minus_a": (only_b - only_a) / len(shared) if shared else None,
        "mcnemar_exact_p": mcnemar_exact(only_a, only_b),
        "capsule_bootstrap95": [
            round(differences[int(0.025 * resamples)], 4),
            round(differences[min(resamples - 1, int(0.975 * resamples))], 4),
        ]
        if differences
        else None,
    }
