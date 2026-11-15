"""Collect the runs under a directory into one report: per question, per solver, per eval mode,
with intervals, the paired comparison and what the runs cost. Reads run.json and grade.json
only; it holds no ideal answers.

The report opens with a banner saying what was run and graded how (profile, judge, answer mode,
repeats, unit, network, questions covered) and whether the numbers can be set beside published
ones. They can only if every condition in `comparability` holds; otherwise it says "no" and
why. Rows are keyed by (model, solver, question, repeat): two runs with the same key are an
error, and runs of different models are never pooled.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .stats import mean_over_repeats, paired, summarise

TOTAL_QUESTIONS = 205  # BixBench v1.5


class ReportError(ValueError):
    """The runs under the directory cannot be reported as one set."""


# Assumed list prices in US dollars per million tokens, used only for the cost estimate.
# Check them against the provider's current price list before relying on the estimate.
DEFAULT_PRICES = {"input": 3.0, "output": 15.0, "cache_read": 0.30, "cache_write": 3.75}


def cost_usd(usage: dict[str, dict[str, int | None]], prices: dict[str, float]) -> float:
    total = 0.0
    for u in usage.values():
        total += (u.get("input_tokens") or 0) * prices["input"]
        total += (u.get("output_tokens") or 0) * prices["output"]
        total += (u.get("cache_read_tokens") or 0) * prices["cache_read"]
        total += (u.get("cache_write_tokens") or 0) * prices["cache_write"]
    return total / 1e6


def collect(root: Path, profile: str = "per-mode") -> list[dict[str, Any]]:
    """One row per (run, question): solver, model, repeat, capsule, question, eval mode,
    verdict, the judge that gave it, the run's settings and cost."""
    rows: list[dict[str, Any]] = []
    for run_file in sorted(root.rglob("run.json")):
        run = json.loads(run_file.read_text(encoding="utf-8"))
        grade_file = run_file.parent / "grade.json"
        if run.get("status") == "running" or not grade_file.exists():
            continue
        graded = json.loads(grade_file.read_text(encoding="utf-8"))
        block = graded["profiles"].get(profile)
        if block is None:
            continue
        settings = run["settings"]
        # grade.json written before judges were recorded per profile has only `judge_model`.
        judge = block.get("judge") or {
            "model": graded.get("judge_model"),
            "temperature": None,
            "temperature_recorded": False,
            "deviations": ["judge temperature was not recorded"],
        }
        for grade in block["grades"]:
            rows.append(
                {
                    **grade,
                    "solver": settings["solver"],
                    "model": settings["model"],
                    "repeat": int(settings.get("repeat") or 0),
                    "unit": settings.get("unit"),
                    "network": settings.get("network"),
                    "run_answer_mode": settings.get("answer_mode"),
                    "judge": judge,
                    "capsule": run["capsule"],
                    "run_dir": str(run_file.parent.relative_to(root)),
                    "run_status": run["status"],
                    "status": run.get("answer_statuses", {}).get(grade["question_id"], "missing"),
                    "run_tokens": run.get("total_tokens", 0),
                    "run_seconds": run.get("seconds", 0),
                    "run_questions": len(run["question_ids"]),
                    "run_usage": run.get("usage", {}),
                }
            )
    return rows


def _judge_label(judge: dict[str, Any]) -> str:
    if judge.get("letter_match"):
        return "none (letter match)"
    if not judge.get("model"):
        return "none (code rules only)"
    if judge.get("temperature_recorded") is False:
        return f"{judge['model']} (temperature not recorded)"
    temperature = judge.get("temperature")
    return f"{judge['model']} at temperature " + (
        "provider default" if temperature is None else f"{temperature:g}"
    )


def comparability(rows: list[dict[str, Any]], profile: str, total_questions: int) -> dict[str, Any]:
    """Whether the numbers may be set beside published BixBench numbers, and every reason not.

    All of these must hold: a real model; the "official" or "paper" profile with that profile's
    default judge at its default temperature; one answer mode; every question covered by every
    solver, none ungraded; one run per question, as the official repository's code does; and
    the network as the official harness has it (on). This sandbox has no network, so today the
    answer is always no; the list says what else stands in the way."""
    reasons: list[str] = []
    if any(r["model"] == "mock" for r in rows):
        reasons.append("scripted mock model: plumbing only")
    if profile not in ("official", "paper"):
        reasons.append(f'grading profile "{profile}" is this adapter\'s own, not an upstream one')
    for deviation in sorted({d for r in rows for d in r["judge"].get("deviations", [])}):
        reasons.append(deviation)
    if len({r["run_answer_mode"] for r in rows}) > 1:
        reasons.append("more than one answer mode")
    for solver in sorted({r["solver"] for r in rows}):
        covered = len({r["question_id"] for r in rows if r["solver"] == solver})
        if covered != total_questions:
            reasons.append(f"{solver} covers {covered} of {total_questions} questions")
    ungraded = sum(1 for r in rows if not r.get("graded", True))
    if ungraded:
        reasons.append(f"{ungraded} answer(s) ungraded, counted as incorrect")
    if any(r["unit"] != "questions" or r["run_questions"] != 1 for r in rows):
        reasons.append(
            "one run per capsule with all its questions; the official repository's code runs "
            "each question alone (the paper's text describes capsule-level runs)"
        )
    if any(r["network"] != "on" for r in rows):
        reasons.append("the sandbox has no network; the official harness leaves it on")
    if not rows:
        reasons.append("no graded run")
    return {"value": not reasons, "reasons": reasons}


def build(
    root: Path,
    profile: str = "per-mode",
    prices: dict[str, float] | None = None,
    total_questions: int = TOTAL_QUESTIONS,
    model: str | None = None,
) -> dict[str, Any]:
    """`model` picks one model when the directory holds runs of several; without it, several
    models are refused (`ReportError`), never pooled."""
    prices = prices or DEFAULT_PRICES
    rows = collect(root, profile)
    models = sorted({r["model"] for r in rows})
    if model is not None:
        rows = [r for r in rows if r["model"] == model]
    elif len(models) > 1:
        raise ReportError(
            f"runs of {len(models)} models under {root} ({', '.join(models)}): they are not "
            "pooled. Report one with --model."
        )
    seen: dict[tuple[str, str, str, int], str] = {}
    for r in rows:
        key = (r["model"], r["solver"], r["question_id"], r["repeat"])
        if key in seen:
            raise ReportError(
                f"{r['question_id']} was run twice by {r['solver']} with {r['model']} as repeat "
                f"{r['repeat']} ({seen[key]} and {r['run_dir']}); give repeats their own number"
            )
        seen[key] = r["run_dir"]
    solvers = sorted({r["solver"] for r in rows})
    covered = len({r["question_id"] for r in rows})
    report: dict[str, Any] = {
        "profile": profile,
        "models": sorted({r["model"] for r in rows}),
        "scripted_model": any(r["model"] == "mock" for r in rows),
        "banner": {
            "profile": profile,
            "judges": sorted({_judge_label(r["judge"]) for r in rows}),
            "judge_deviations": sorted({d for r in rows for d in r["judge"].get("deviations", [])}),
            "answer_modes": sorted({str(r["run_answer_mode"]) for r in rows}),
            "repeats": {
                solver: len({r["repeat"] for r in rows if r["solver"] == solver})
                for solver in solvers
            },
            "units": sorted({str(r["unit"]) for r in rows}),
            "network": sorted({str(r["network"]) for r in rows}),
            "questions_covered": covered,
            "questions_total": total_questions,
            "comparable_to_published": comparability(rows, profile, total_questions),
        },
        "solvers": {},
        "paired": None,
        "questions": [],
        "prices_usd_per_million_tokens": prices,
    }
    for solver in solvers:
        mine = [r for r in rows if r["solver"] == solver]
        runs = {r["run_dir"]: r for r in mine}
        tokens = sum(r["run_tokens"] for r in runs.values())
        seconds = sum(r["run_seconds"] for r in runs.values())
        dollars = sum(cost_usd(r["run_usage"], prices) for r in runs.values())
        summary = summarise(mine)
        summary["over_repeats"] = mean_over_repeats(mine)
        summary["by_status"] = {
            status: {
                "correct": sum(bool(r["correct"]) for r in mine if r["status"] == status),
                "n": sum(1 for r in mine if r["status"] == status),
            }
            for status in sorted({r["status"] for r in mine})
        }
        n = len(mine)
        summary["cost"] = {
            "runs": len(runs),
            "failed_runs": sum(1 for r in runs.values() if r["run_status"] != "done"),
            "tokens": tokens,
            "seconds": round(seconds, 1),
            "usd": round(dollars, 2),
            "tokens_per_question": round(tokens / n) if n else None,
            "seconds_per_question": round(seconds / n, 1) if n else None,
            "usd_per_question": round(dollars / n, 3) if n else None,
            # Straight scaling by question count. A small sample of small capsules; treat as a
            # rough order of magnitude.
            "extrapolated_to_all_questions": {
                "questions": total_questions,
                "tokens": round(tokens / n * total_questions) if n else None,
                "hours_sequential": round(seconds / n * total_questions / 3600, 1) if n else None,
                "usd": round(dollars / n * total_questions, 0) if n else None,
            },
        }
        report["solvers"][solver] = summary
    if {"single", "glhf"} <= set(solvers):
        # A pair is one question in one repeat, answered by both solvers. A pair with an
        # ungraded side is dropped: an unknown is neither a win nor a loss.
        sides: dict[str, dict[str, dict[str, Any]]] = {"single": {}, "glhf": {}}
        for r in rows:
            if r["solver"] in sides:
                sides[r["solver"]][f"{r['question_id']}#{r['repeat']}"] = r
        both = sorted(set(sides["single"]) & set(sides["glhf"]))
        graded = [
            k
            for k in both
            if sides["single"][k].get("graded", True) and sides["glhf"][k].get("graded", True)
        ]
        a = {k: bool(sides["single"][k]["correct"]) for k in graded}
        b = {k: bool(sides["glhf"][k]["correct"]) for k in graded}
        capsule_of = {k: str(sides["single"][k]["capsule"]) for k in graded}
        report["paired"] = {
            "a": "single",
            "b": "glhf",
            **paired(a, b, capsule_of),
            "pairs_available": len(both),
            "pairs_dropped_ungraded": len(both) - len(graded),
        }
    by_question: dict[tuple[str, int], dict[str, Any]] = {}
    for r in rows:
        entry = by_question.setdefault(
            (r["question_id"], r["repeat"]),
            {
                "capsule": r["capsule"],
                "question_id": r["question_id"],
                "repeat": r["repeat"],
                "eval_mode": r["eval_mode"],
            },
        )
        entry[r["solver"]] = {
            "correct": r["correct"],
            "graded": r["graded"],
            "method": r["method"],
            "status": r["status"],
            "run_tokens": r["run_tokens"],
            "run_seconds": r["run_seconds"],
            "run_questions": r["run_questions"],
        }
    report["questions"] = list(by_question.values())
    return report


def _pct(block: dict[str, Any]) -> str:
    if not block.get("n"):
        return "n/a"
    low, high = block["wilson95"]
    return f"{block['correct']}/{block['n']} = {block['accuracy']:.1%} (95% CI {low:.1%} to {high:.1%})"


def _banner(report: dict[str, Any]) -> list[str]:
    banner = report["banner"]
    comparable = banner["comparable_to_published"]
    lines = [
        f"- Grading profile: {banner['profile']}",
        f"- Judge: {'; '.join(banner['judges']) or 'n/a'}",
        f"- Answer mode: {', '.join(banner['answer_modes']) or 'n/a'}",
        "- Repeats: "
        + (", ".join(f"{solver} {n}" for solver, n in banner["repeats"].items()) or "n/a"),
        f"- Unit: {', '.join(banner['units']) or 'n/a'} per run",
        f"- Network in the sandbox: {', '.join(banner['network']) or 'n/a'}",
        f"- Questions covered: {banner['questions_covered']} of {banner['questions_total']}",
        f"- Comparable to published: {'yes' if comparable['value'] else 'no'}",
    ]
    lines += [f"  - {reason}" for reason in comparable["reasons"]]
    for deviation in banner["judge_deviations"]:
        if "temperature 0;" in deviation:
            lines.append(f"- **Deviation: {deviation}.**")
    return lines


def markdown(report: dict[str, Any]) -> str:
    lines = [f"# BixBench v1.5 report ({report['profile']} grading)", ""]
    if report["scripted_model"]:
        lines += [
            "**Scripted mock model: these numbers test the plumbing and are not results.**",
            "",
        ]
    lines += [*_banner(report), ""]
    lines += [f"Models: {', '.join(report['models'])}", ""]
    lower = any(s["ungraded"] for s in report["solvers"].values())
    lines += [
        "| Solver | Accuracy" + (" (lower bound where ungraded > 0)" if lower else "")
        + " | Mean over repeats | Without the judge | Ungraded | Tokens | Seconds | Est. USD |"
    ]  # fmt: skip
    lines += ["|---|---|---|---|---|---|---|---|"]
    for solver, s in report["solvers"].items():
        cost = s["cost"]
        over = s["over_repeats"]
        mean = (
            f"{over['mean_accuracy']:.1%} over {over['repeats']}"
            if over["mean_accuracy"] is not None
            else "n/a"
        )
        accuracy = ("at least " if s["ungraded"] else "") + _pct(s)
        lines.append(
            f"| {solver} | {accuracy} | {mean} | {s['strict']['correct']}/{s['strict']['n']} | "
            f"{s['ungraded']} | {cost['tokens']:,} | {cost['seconds']:,} | {cost['usd']} |"
        )
    if lower:
        lines += [
            "",
            "Ungraded answers (no judge, or the judge call failed) are counted as incorrect, so "
            "an accuracy with ungraded answers is a lower bound, not an estimate.",
        ]
    lines += ["", "Per eval mode:", ""]
    for solver, s in report["solvers"].items():
        for mode, block in s["by_eval_mode"].items():
            lines.append(f"- {solver}, {mode}: {_pct(block)}")
    lines += ["", "Per answer status (how far an answer was checked before grading):", ""]
    for solver, s in report["solvers"].items():
        for status, block in s["by_status"].items():
            lines.append(f"- {solver}, {status}: {block['correct']}/{block['n']} correct")
    refusal = {
        solver: s["precision"] for solver, s in report["solvers"].items() if s["precision"] is not None
    }  # fmt: skip
    if refusal:  # only in mcq-refusal mode, the one mode in which upstream has refusals
        lines += ["", "Precision (correct / not refused):", ""]
        lines += [f"- {solver}: {value:.1%}" for solver, value in refusal.items()]
    p = report["paired"]
    if p:
        difference = (
            f"{p['difference_b_minus_a']:+.1%}" if p["difference_b_minus_a"] is not None else "n/a"
        )
        flip = p["capsule_sign_flip"]
        lines += [
            "",
            f"Paired (same questions, n = {p['n']} in {p['capsules']} capsules; "
            f"{p['pairs_dropped_ungraded']} of {p['pairs_available']} pair(s) dropped because a "
            f"side was ungraded): both correct {p['both_correct']}, single only "
            f"{p['only_a_correct']}, swarm only {p['only_b_correct']}, neither "
            f"{p['neither_correct']}. Difference swarm minus single: {difference}.",
            "",
            "- Capsule-level sign-flip permutation test on per-capsule (swarm minus single) sums: "
            + (
                f"p = {flip['p']:.4g} ({flip['method']}, {flip['capsules_with_a_difference']} "
                "capsule(s) with a difference)."
                if flip
                else "n/a (no capsule with a difference)."
            ),
            "- Exact McNemar p = "
            + (
                f"{p['mcnemar_exact_p']:.4g}"
                if p["mcnemar_exact_p"] is not None
                else "n/a (no discordant pairs)"
            )
            + ". It assumes independent questions; questions of one capsule are not, so read "
            "it as too confident.",
            "- Capsule bootstrap 95% interval: "
            + (
                str(p["capsule_bootstrap95"])
                if p["capsule_bootstrap95"] is not None
                else p["capsule_bootstrap_note"]
            )
            + ".",
        ]
    lines += [
        "",
        "| Capsule | Question | Repeat | Eval mode | Single | Swarm | Swarm status | Single tokens / s | Swarm tokens / s |",
        "|---|---|---|---|---|---|---|---|---|",
    ]

    def mark(cell: dict[str, Any] | None) -> str:
        if cell is None:
            return "not run"
        if not cell["graded"]:
            return "ungraded"
        return "correct" if cell["correct"] else "wrong"

    def spent(cell: dict[str, Any] | None) -> str:
        return f"{cell['run_tokens']:,} / {cell['run_seconds']:.0f}" if cell else ""

    for q in report["questions"]:
        single, swarm = q.get("single"), q.get("glhf")
        lines.append(
            f"| {q['capsule']} | {q['question_id']} | {q['repeat']} | {q['eval_mode']} | {mark(single)} | {mark(swarm)} | "
            f"{swarm['status'] if swarm else ''} | {spent(single)} | {spent(swarm)} |"
        )
    lines += ["", "Tokens and seconds are per run (all questions of the run together).", ""]
    return "\n".join(lines)
