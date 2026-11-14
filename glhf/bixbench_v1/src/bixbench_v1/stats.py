"""Accuracy with counts and intervals, and the paired comparison of two solvers.

Questions from one capsule share data and are not independent, so the Wilson interval (which
the official harness also reports) and the McNemar test are too confident when capsules have
several questions. The paired comparison therefore also gives a sign-flip permutation test on
per-capsule differences and, with enough capsules, a bootstrap interval that resamples whole
capsules.
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
    the denominator as incorrect and are counted separately, so they cannot flatter a score:
    with `ungraded` > 0 the accuracy is a lower bound (`lower_bound`).

    `refused` is upstream's notion (the multiple-choice refusal option; also set by our own
    "per-mode" profile for open answers). `own_refused` is our count in every profile: no
    answer, or a judge reply of `refused`. `precision` (correct / not refused, the official
    compute_metrics) is given only when every row is in "mcq-refusal" mode, the one mode in
    which upstream has refusals."""
    out: dict[str, Any] = accuracy(bool(g["correct"]) for g in grades)
    out["strict"] = accuracy(bool(g.get("correct_strict")) for g in grades)
    out["ungraded"] = sum(1 for g in grades if not g.get("graded", True))
    out["lower_bound"] = out["ungraded"] > 0
    out["refused"] = sum(1 for g in grades if g.get("refused"))
    out["own_refused"] = sum(1 for g in grades if g.get("own_refused", g.get("refused")))
    refusal_mode = bool(grades) and all(g.get("answer_mode") == "mcq-refusal" for g in grades)
    answered = [g for g in grades if not g.get("refused")]
    out["precision"] = (
        sum(bool(g["correct"]) for g in answered) / len(answered)
        if refusal_mode and answered
        else None
    )
    out["by_eval_mode"] = {
        mode: accuracy(bool(g["correct"]) for g in grades if g["eval_mode"] == mode)
        for mode in sorted({str(g["eval_mode"]) for g in grades})
    }
    return out


def mean_over_repeats(grades: list[dict[str, Any]]) -> dict[str, Any]:
    """Accuracy of each repeat (rows carry `repeat`; a row without one is repeat 0) and their
    mean. The mean weights repeats equally, whatever the number of questions each covered."""
    by_repeat: dict[int, list[bool]] = {}
    for g in grades:
        by_repeat.setdefault(int(g.get("repeat") or 0), []).append(bool(g["correct"]))
    per = {r: sum(flags) / len(flags) for r, flags in sorted(by_repeat.items())}
    values = list(per.values())
    mean = sum(values) / len(values) if values else None
    spread = (
        math.sqrt(sum((v - mean) ** 2 for v in values) / (len(values) - 1))
        if mean is not None and len(values) > 1
        else None
    )
    return {
        "repeats": len(per),
        "accuracy_by_repeat": {str(r): round(v, 4) for r, v in per.items()},
        "questions_by_repeat": {str(r): len(flags) for r, flags in sorted(by_repeat.items())},
        "mean_accuracy": mean,
        "sd_between_repeats": spread,
    }


def mcnemar_exact(only_a: int, only_b: int) -> float | None:
    """Two-sided exact McNemar p-value from the discordant pairs (binomial, p = 0.5).

    It assumes the pairs are independent. Questions of one capsule share data and a solver's
    data-loading decisions, so they are not: with several questions per capsule this p-value is
    too small. `capsule_sign_flip` is the test that respects capsules."""
    n = only_a + only_b
    if n == 0:
        return None
    tail = sum(math.comb(n, k) for k in range(0, min(only_a, only_b) + 1)) / 2**n
    return float(min(1.0, 2 * tail))


MIN_BOOTSTRAP_CAPSULES = 10
EXACT_SIGN_FLIP_CAPSULES = 20


def capsule_sign_flip(
    sums: list[float], resamples: int = 100_000, seed: int = 0
) -> dict[str, Any] | None:
    """Two-sided sign-flip permutation test on per-capsule sums of (b correct - a correct).

    Under the null that the two solvers are exchangeable within a capsule, each capsule's sum
    is as likely to have either sign. The statistic is the absolute total. Exact (all 2^k sign
    patterns of the k capsules with a non-zero sum) for up to 20 such capsules, Monte Carlo
    with a +1 correction otherwise. None if no capsule has a non-zero sum."""
    active = [s for s in sums if s != 0]
    if not active:
        return None
    observed = abs(sum(active))
    tolerance = 1e-9
    if len(active) <= EXACT_SIGN_FLIP_CAPSULES:
        # Subset sums: flipping the signs of a subset S changes the total by -2 * sum(S).
        totals = {0.0: 1}
        for value in active:
            grown: dict[float, int] = {}
            for total, count in totals.items():
                for signed in (total + value, total - value):
                    grown[round(signed, 9)] = grown.get(round(signed, 9), 0) + count
            totals = grown
        extreme = sum(count for total, count in totals.items() if abs(total) >= observed - tolerance)
        return {
            "p": extreme / 2 ** len(active),
            "method": "exact",
            "capsules_with_a_difference": len(active),
        }
    rng = random.Random(seed)
    extreme = sum(
        abs(sum(v if rng.random() < 0.5 else -v for v in active)) >= observed - tolerance
        for _ in range(resamples)
    )
    return {
        "p": (extreme + 1) / (resamples + 1),
        "method": f"monte carlo, {resamples} resamples",
        "capsules_with_a_difference": len(active),
    }


def paired(
    a: Mapping[Any, bool],
    b: Mapping[Any, bool],
    capsule_of: Mapping[Any, str],
    resamples: int = 10_000,
    seed: int = 0,
) -> dict[str, Any]:
    """Compare two solvers on the pairs both have (keys are questions, or (question, repeat)).

    Gives the discordant counts; the exact McNemar test, which assumes independent questions
    and is therefore too confident when capsules hold several; the capsule-level sign-flip
    permutation test, which does not; and a bootstrap interval for accuracy(b) - accuracy(a)
    that resamples whole capsules. The bootstrap is None ("not estimable") with fewer than
    10 capsules or no discordant pair: a percentile interval from a handful of capsules, or
    one that is the single point 0, says nothing."""
    shared = sorted(set(a) & set(b), key=str)
    both = sum(a[q] and b[q] for q in shared)
    only_a = sum(a[q] and not b[q] for q in shared)
    only_b = sum(b[q] and not a[q] for q in shared)
    neither = len(shared) - both - only_a - only_b
    by_capsule: dict[str, list[Any]] = {}
    for q in shared:
        by_capsule.setdefault(capsule_of.get(q, str(q)), []).append(q)
    capsules = sorted(by_capsule)
    estimable = len(capsules) >= MIN_BOOTSTRAP_CAPSULES and (only_a + only_b) > 0
    differences: list[float] = []
    if estimable:
        rng = random.Random(seed)
        for _ in range(resamples):
            drawn = [q for c in rng.choices(capsules, k=len(capsules)) for q in by_capsule[c]]
            differences.append(sum(b[q] - a[q] for q in drawn) / len(drawn))
        differences.sort()
    sums = [float(sum(b[q] - a[q] for q in by_capsule[c])) for c in capsules]
    return {
        "n": len(shared),
        "capsules": len(capsules),
        "both_correct": both,
        "only_a_correct": only_a,
        "only_b_correct": only_b,
        "neither_correct": neither,
        "difference_b_minus_a": (only_b - only_a) / len(shared) if shared else None,
        "mcnemar_exact_p": mcnemar_exact(only_a, only_b),
        "mcnemar_assumes": "independent questions; too confident when capsules hold several",
        "capsule_sign_flip": capsule_sign_flip(sums, seed=seed),
        "capsule_bootstrap95": [
            round(differences[int(0.025 * resamples)], 4),
            round(differences[min(resamples - 1, int(0.975 * resamples))], 4),
        ]
        if differences
        else None,
        "capsule_bootstrap_note": None
        if estimable
        else (
            f"not estimable: {len(capsules)} capsule(s) (needs {MIN_BOOTSTRAP_CAPSULES}) and "
            f"{only_a + only_b} discordant pair(s) (needs 1)"
        ),
    }
