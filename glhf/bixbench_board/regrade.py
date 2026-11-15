#!/usr/bin/env python3
"""regrade.py — re-run the judge on stored answers without re-solving.

    python regrade.py --results results/ [--grader-model gpt-4o]

Only re-grades runs whose solve actually produced answers; runs that errored
before submission are left untouched (their <no_answer> markers stand).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from dotenv import load_dotenv

from bixbase.paid import refuse_paid

from bixbase.budget import Budget
from bixbase.grader import compute_metrics, grade_answer
from bixbase.llm import LLMClient, default_model, detect_provider
from bixbase.loader import load_studies


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--results", default="results")
    p.add_argument("--data", default="hf")
    p.add_argument("--cache-dir", default="data")
    p.add_argument("--grader-model", default=None)
    args = p.parse_args(argv)
    refuse_paid("the LLM judge")
    load_dotenv()

    import os
    provider = "openai" if os.environ.get("OPENAI_API_KEY") else detect_provider()
    model = args.grader_model or (
        "gpt-4o" if provider == "openai" else default_model(provider)
    )
    print(f"judge: {model} ({provider})")
    llm = LLMClient(model=model, provider=provider)

    questions = {
        q.question_id: q
        for s in load_studies(args.data, cache_dir=Path(args.cache_dir))
        for q in s.questions
    }

    n_ok = n_skip = 0
    for path in sorted(Path(args.results).rglob("result.json")):
        row = json.loads(path.read_text())
        if row["error"] or all(
            v == "<no_answer>" for v in row["answers"].values()
        ):
            n_skip += 1
            continue
        budget = Budget()
        grades, refused = [], []
        for qid, predicted in row["answers"].items():
            q = questions.get(qid)
            if q is None:
                continue
            g = grade_answer(
                question=q.text, target=q.ideal, predicted=predicted,
                eval_mode=q.eval_mode, llm=llm, budget=budget,
            )
            row["grades"][qid] = {
                "predicted": predicted, "ideal": q.ideal,
                "grade": g.grade, "grade_type": g.grade_type.value,
                "judge_raw": g.raw_response,
            }
            grades.append(g.grade)
            refused.append(g.refusal)
        row["metrics"] = compute_metrics(grades, refused)
        row["grader_model"] = model
        path.write_text(json.dumps(row, indent=2))
        n_ok += 1
        print(f"regraded {row['study_id']} rep{row['repeat']}: "
              f"acc={row['metrics']['accuracy']:.3f}")

    print(f"\n{n_ok} runs regraded, {n_skip} skipped (no answers)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
