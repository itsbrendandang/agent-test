"""Collect the runs under a directory into one report: per question, per solver, per eval mode,
with intervals, the paired comparison and what the runs cost. Reads run.json and grade.json
only; it holds no ideal answers."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .stats import paired, summarise

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
    """One row per (run, question): solver, capsule, question, eval mode, verdict, run cost."""
    rows: list[dict[str, Any]] = []
    for run_file in sorted(root.rglob("run.json")):
        run = json.loads(run_file.read_text(encoding="utf-8"))
        grade_file = run_file.parent / "grade.json"
        if run.get("status") == "running" or not grade_file.exists():
            continue
        graded = json.loads(grade_file.read_text(encoding="utf-8"))["profiles"].get(profile)
        if graded is None:
            continue
        for grade in graded["grades"]:
            rows.append(
                {
                    **grade,
                    "solver": run["settings"]["solver"],
                    "model": run["settings"]["model"],
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


def build(
    root: Path,
    profile: str = "per-mode",
    prices: dict[str, float] | None = None,
    total_questions: int = 205,
) -> dict[str, Any]:
    prices = prices or DEFAULT_PRICES
    rows = collect(root, profile)
    solvers = sorted({r["solver"] for r in rows})
    report: dict[str, Any] = {
        "profile": profile,
        "models": sorted({r["model"] for r in rows}),
        "scripted_model": any(r["model"] == "mock" for r in rows),
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
        a = {r["question_id"]: bool(r["correct"]) for r in rows if r["solver"] == "single"}
        b = {r["question_id"]: bool(r["correct"]) for r in rows if r["solver"] == "glhf"}
        capsule_of = {r["question_id"]: r["capsule"] for r in rows}
        report["paired"] = {"a": "single", "b": "glhf", **paired(a, b, capsule_of)}
    by_question: dict[str, dict[str, Any]] = {}
    for r in rows:
        entry = by_question.setdefault(
            r["question_id"],
            {"capsule": r["capsule"], "question_id": r["question_id"], "eval_mode": r["eval_mode"]},
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


def markdown(report: dict[str, Any]) -> str:
    lines = [f"# BixBench v1.5 report ({report['profile']} grading)", ""]
    if report["scripted_model"]:
        lines += [
            "**Scripted mock model: these numbers test the plumbing and are not results.**",
            "",
        ]
    lines += [f"Models: {', '.join(report['models'])}", ""]
    lines += ["| Solver | Accuracy | Without the judge | Ungraded | Tokens | Seconds | Est. USD |"]
    lines += ["|---|---|---|---|---|---|---|"]
    for solver, s in report["solvers"].items():
        cost = s["cost"]
        lines.append(
            f"| {solver} | {_pct(s)} | {s['strict']['correct']}/{s['strict']['n']} | {s['ungraded']} | "
            f"{cost['tokens']:,} | {cost['seconds']:,} | {cost['usd']} |"
        )
    lines += ["", "Per eval mode:", ""]
    for solver, s in report["solvers"].items():
        for mode, block in s["by_eval_mode"].items():
            lines.append(f"- {solver}, {mode}: {_pct(block)}")
    lines += ["", "Per answer status (how far an answer was checked before grading):", ""]
    for solver, s in report["solvers"].items():
        for status, block in s["by_status"].items():
            lines.append(f"- {solver}, {status}: {block['correct']}/{block['n']} correct")
    p = report["paired"]
    if p:
        lines += [
            "",
            f"Paired (same questions, n = {p['n']} in {p['capsules']} capsules): both correct "
            f"{p['both_correct']}, single only {p['only_a_correct']}, swarm only "
            f"{p['only_b_correct']}, neither {p['neither_correct']}. Difference swarm minus single: "
            f"{p['difference_b_minus_a']:+.1%}; exact McNemar p = "
            f"{p['mcnemar_exact_p'] if p['mcnemar_exact_p'] is not None else 'n/a (no discordant pairs)'}; "
            f"capsule bootstrap 95% interval {p['capsule_bootstrap95']}.",
        ]
    lines += [
        "",
        "| Capsule | Question | Eval mode | Single | Swarm | Swarm status | Single tokens / s | Swarm tokens / s |",
        "|---|---|---|---|---|---|---|---|",
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
            f"| {q['capsule']} | {q['question_id']} | {q['eval_mode']} | {mark(single)} | {mark(swarm)} | "
            f"{swarm['status'] if swarm else ''} | {spent(single)} | {spent(swarm)} |"
        )
    lines += ["", "Tokens and seconds are per run (all questions of the run together).", ""]
    return "\n".join(lines)
