#!/usr/bin/env python3
"""regrade.py — re-run the judge on stored answers without re-solving.

    python regrade.py --results results/ [--out results_regraded/]
                      [--grader-model gpt-4o]

Calls a real judge model, so it is refused unless NO_PAID_CALLS=0.

Every question of each run's study is graded, also the ones the run gave no
answer for (they are graded as "<no_answer>", exactly as run.py does), so the
denominator is always the full study. The ideal answers are read from the
dataset here, on the host, at grade time; result.json does not carry them.

Nothing is overwritten: the regraded copy of each result.json goes to
<out>/<study_id>/rep<k>/result.json (default <results>_regraded/), a layout
summarize.py reads as it is.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from dotenv import load_dotenv

from bixbase.budget import Budget
from bixbase.grader import compute_metrics, grade_answer
from bixbase.llm import LLMClient, default_model, detect_provider
from bixbase.loader import load_studies
from bixbase.paid import PaidCallsOff, enforce, refuse_paid

NO_ANSWER = "<no_answer>"


def regrade_row(row: dict, study, llm, model: str) -> dict:
    """A regraded copy of one result row: every question of the study."""
    row = dict(row)
    budget = Budget()
    grades, refused, out = [], [], {}
    for q in study.questions:
        predicted = row.get("answers", {}).get(q.question_id, NO_ANSWER)
        g = grade_answer(
            question=q.text, target=q.ideal, predicted=predicted,
            eval_mode=q.eval_mode, llm=llm, budget=budget,
        )
        out[q.question_id] = {
            "predicted": predicted,
            "grade": g.grade, "grade_type": g.grade_type.value,
            "judge_raw": g.raw_response,
        }
        grades.append(g.grade)
        refused.append(g.refusal)
    row["grades"] = out
    row["metrics"] = compute_metrics(grades, refused)
    row["grader_model"] = model
    row["grader_budget"] = budget.snapshot()
    return row


def main(argv=None) -> int:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--results", default="results")
    p.add_argument("--out", default=None,
                   help="where the regraded copies go "
                        "(default: <results>_regraded)")
    p.add_argument("--data", default="hf")
    p.add_argument("--cache-dir", default="data")
    p.add_argument("--grader-model", default=None)
    args = p.parse_args(argv)

    enforce()  # paid switch on: blank the provider keys before .env loads
    try:
        refuse_paid("regrade.py (the judge is a real model)")
    except PaidCallsOff as e:
        print(e, file=sys.stderr)
        return 2
    load_dotenv()

    results = Path(args.results)
    out = Path(args.out) if args.out else results.with_name(
        results.resolve().name + "_regraded")
    if out.resolve() == results.resolve() or results.resolve() in out.resolve().parents:
        print("--out must be a different folder, outside --results: "
              "regrade never overwrites", file=sys.stderr)
        return 2

    import os
    provider = "openai" if os.environ.get("OPENAI_API_KEY") else detect_provider()
    model = args.grader_model or (
        "gpt-4o" if provider == "openai" else default_model(provider)
    )
    print(f"judge: {model} ({provider})")
    llm = LLMClient(model=model, provider=provider)

    studies = {
        s.study_id: s
        for s in load_studies(args.data, cache_dir=Path(args.cache_dir))
    }

    n_ok = n_skip = 0
    for path in sorted(results.rglob("result.json")):
        row = json.loads(path.read_text())
        study = studies.get(row.get("study_id"))
        if study is None:
            n_skip += 1
            print(f"SKIPPED {path}: study {row.get('study_id')!r} is not in "
                  f"the dataset", file=sys.stderr)
            continue
        new = regrade_row(row, study, llm, model)
        dest = out / path.relative_to(results)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(new, indent=2))
        n_ok += 1
        print(f"regraded {new['study_id']} rep{new['repeat']}: "
              f"acc={new['metrics']['accuracy']:.3f} "
              f"(n={new['metrics']['n_total']})")

    print(f"\n{n_ok} runs regraded into {out}, {n_skip} skipped "
          f"(study not found); originals untouched")
    return 0


if __name__ == "__main__":
    sys.exit(main())
