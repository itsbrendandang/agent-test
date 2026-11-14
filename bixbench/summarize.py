#!/usr/bin/env python3
"""summarize.py — aggregate results/ into a report table + summary.json.

    python summarize.py --results results/

Per-study: mean ± std accuracy across repeats, tokens, wall-clock.
Overall: pooled official metrics (accuracy / precision / coverage) across all
questions of all runs — matching the benchmark's scoring convention.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path


def load_runs(results_dir: Path) -> list[dict]:
    """Every result.json on disk is a completed run.

    runs.json only covers the most recent invocation, so resumable runs
    (--skip-existing across waves) must be reconstructed from result files.
    """
    rows = {}
    for rj in sorted(results_dir.rglob("result.json")):
        r = json.loads(rj.read_text())
        rows[(r["study_id"], r["repeat"])] = r
    return list(rows.values())


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--results", default="results")
    p.add_argument("--out", default=None,
                   help="write summary json (default: <results>/summary.json)")
    args = p.parse_args(argv)

    results_dir = Path(args.results)
    rows = load_runs(results_dir)
    if not rows:
        print(f"no runs found under {results_dir}", file=sys.stderr)
        return 1

    by_study: dict[str, list[dict]] = {}
    for r in rows:
        by_study.setdefault(r["study_id"], []).append(r)

    # pooled official metrics
    all_grades, all_refused = [], []
    for r in rows:
        for g in r.get("grades", {}).values():
            if "grade" in g:
                all_grades.append(g["grade"])
                all_refused.append(g.get("grade_type") == "refused")
    n_correct = sum(all_grades)
    n_refused = sum(all_refused)
    n_total = len(all_grades)
    n_sure = n_total - n_refused
    overall = {
        "accuracy": n_correct / n_total if n_total else 0,
        "precision": n_correct / n_sure if n_sure else 0,
        "coverage": n_sure / n_total if n_total else 0,
        "n_questions": n_total,
        "n_correct": n_correct,
    }

    lines = [
        f"{'study':<20} {'reps':>4} {'acc mean±std':>18} "
        f"{'tokens':>10} {'time_s':>8} {'forced':>6}"
    ]
    per_study = {}
    tot_tokens = 0
    tot_time = 0.0
    for sid in sorted(by_study):
        runs = by_study[sid]
        accs = [
            (r["metrics"] or {}).get("accuracy")
            for r in runs
            if r.get("metrics")
        ]
        mean = statistics.fmean(accs) if accs else float("nan")
        std = statistics.stdev(accs) if len(accs) > 1 else 0.0
        tokens = sum(r["budget"]["used"]["total_tokens"] for r in runs)
        ttime = sum(r["budget"]["elapsed_seconds"] for r in runs)
        forced = sum(1 for r in runs if r.get("forced"))
        tot_tokens += tokens
        tot_time += ttime
        per_study[sid] = {
            "repeats": len(runs),
            "accuracy_mean": mean,
            "accuracy_std": std,
            "total_tokens": tokens,
            "total_seconds": round(ttime, 1),
            "n_forced": forced,
        }
        lines.append(
            f"{sid:<20} {len(runs):>4} "
            f"{mean:>8.3f} ±{std:>7.3f} "
            f"{tokens:>10} {ttime:>8.1f} {forced:>6}"
        )

    print("\n".join(lines))
    print(f"\noverall accuracy={overall['accuracy']:.3f} "
          f"precision={overall['precision']:.3f} "
          f"coverage={overall['coverage']:.3f} "
          f"({overall['n_correct']}/{overall['n_questions']} correct)")
    print(f"total tokens={tot_tokens}  total agent time={tot_time:.1f}s")

    out_path = Path(args.out) if args.out else results_dir / "summary.json"
    out_path.write_text(json.dumps(
        {"overall": overall, "per_study": per_study,
         "total_tokens": tot_tokens, "total_seconds": tot_time},
        indent=2,
    ))
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
