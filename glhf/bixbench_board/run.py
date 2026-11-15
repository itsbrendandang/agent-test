#!/usr/bin/env python3
"""run.py — BixBench3 single-agent baseline runner.

    python run.py --studies all|id1,id2 --repeats N --seed S \
        --budget-tokens X --out results/ [--data SRC] [--workers W]

Layout of --out:
  results/<study_id>/rep<k>/transcript.jsonl   full message/tool/usage log
  results/<study_id>/rep<k>/final_script.py   reproducible code cells
  results/<study_id>/rep<k>/result.json       answers, grades, budget
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from dotenv import load_dotenv

from bixbase.paid import refuse_paid

from bixbase import agent, board
from bixbase.budget import Budget, BudgetCaps
from bixbase.grader import compute_metrics, grade_answer
from bixbase.llm import LLMClient, default_model, detect_provider
from bixbase.loader import load_studies, prepare_study_data


def parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--studies", default="all",
                   help="'all' or comma-separated study ids")
    p.add_argument("--repeats", type=int, default=1)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--budget-tokens", type=int, default=None,
                   help="combined input+output token cap per run")
    p.add_argument("--budget-seconds", type=float, default=None)
    p.add_argument("--budget-tool-calls", type=int, default=60)
    p.add_argument("--data", default="hf",
                   help="'hf' or path to a local benchmark directory")
    p.add_argument("--cache-dir", default="data")
    p.add_argument("--out", default="runs/results")
    p.add_argument("--workers", type=int, default=2,
                   help="parallel study runs")
    p.add_argument("--model", default=None)
    p.add_argument("--provider", default=None,
                   choices=["anthropic", "openai"],
                   help="solver provider (default: auto-detect from env keys)")
    p.add_argument("--grader-model", default=None,
                   help="judge model for open-answer grading (official: gpt-4o)")
    p.add_argument("--eval-mode", default=None,
                   choices=["llm_verifier", "str_verifier", "range_verifier"],
                   help="override per-question eval_mode")
    p.add_argument("--solver", choices=["single", "board"], default="single",
                   help="single = baseline agent; board = 5-member board")
    p.add_argument("--no-grade", action="store_true")
    p.add_argument("--skip-existing", action="store_true",
                   help="skip (study,repeat) pairs with a successful result.json")
    return p.parse_args(argv)


def run_one(study, repeat_idx, args, run_root: Path) -> dict:
    """One solve+grade for (study, repeat). Writes result.json."""
    run_dir = run_root / study.study_id / f"rep{repeat_idx}"
    run_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed + repeat_idx)
    _ = rng.random()  # seed consumed deterministically per repeat

    caps = BudgetCaps(
        max_total_tokens=args.budget_tokens,
        max_seconds=args.budget_seconds,
        max_tool_calls=args.budget_tool_calls,
    )
    budget = Budget(caps)
    llm = LLMClient(model=args.model, provider=args.provider,
                    seed=args.seed + repeat_idx)

    prepare_study_data(study, Path(args.cache_dir))
    solve = board.solve if args.solver == "board" else agent.solve
    result = solve(study, budget, llm=llm, run_dir=run_dir)

    row = {
        "study_id": study.study_id,
        "repeat": repeat_idx,
        "seed": args.seed + repeat_idx,
        "solver": args.solver,
        "model": llm.model,
        "provider": llm.provider,
        "submitted": result.submitted,
        "forced": result.forced,
        "stop_reason": result.stop_reason,
        "error": result.error,
        "answers": result.answers,
        "budget": result.budget,
        "grades": {},
        "metrics": None,
    }

    if not args.no_grade:
        import os
        # official judge is gpt-4o on OpenAI; only fall back to the solver's
        # provider when OpenAI creds are absent (flagged as a deviation)
        grader_provider = "openai" if os.environ.get("OPENAI_API_KEY") \
            else detect_provider()
        grader_model = args.grader_model or (
            "gpt-4o" if grader_provider == "openai"
            else default_model(grader_provider)
        )
        grader_llm = LLMClient(model=grader_model, provider=grader_provider)
        grader_budget = Budget()  # judge accounting, uncapped, logged separately
        grades, refused = [], []
        for q in study.questions:
            predicted = result.answers.get(q.question_id, "<no_answer>")
            mode = args.eval_mode or q.eval_mode
            try:
                g = grade_answer(
                    question=q.text, target=q.ideal, predicted=predicted,
                    eval_mode=mode, llm=grader_llm, budget=grader_budget,
                )
            except Exception as e:  # noqa: BLE001
                row["grades"][q.question_id] = {"error": str(e)}
                continue
            row["grades"][q.question_id] = {
                "predicted": predicted,
                "ideal": q.ideal,
                "grade": g.grade,
                "grade_type": g.grade_type.value,
                "judge_raw": g.raw_response,
            }
            grades.append(g.grade)
            refused.append(g.refusal)
        row["metrics"] = compute_metrics(grades, refused)
        row["grader_model"] = grader_model
        row["grader_budget"] = grader_budget.snapshot()

    (run_dir / "result.json").write_text(json.dumps(row, indent=2))
    return row


def main(argv=None) -> int:
    refuse_paid("a run with a real model and the LLM judge")
    load_dotenv()  # secrets from .env, never logged
    args = parse_args(argv)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    random.seed(args.seed)

    only = None if args.studies == "all" else args.studies.split(",")
    studies = load_studies(args.data, cache_dir=Path(args.cache_dir), only=only)
    print(f"loaded {len(studies)} studies: "
          f"{[s.study_id for s in studies]}", flush=True)

    jobs = [(s, k) for s in studies for k in range(args.repeats)]
    if args.skip_existing:
        def _done(job):
            s, k = job
            rj = out / s.study_id / f"rep{k}" / "result.json"
            if not rj.is_file():
                return False
            try:
                r = json.loads(rj.read_text())
            except json.JSONDecodeError:
                return False
            # a run counts as done if it completed without an API-level error;
            # forced budget-exhaustion submissions are legitimate outcomes
            return not r.get("error")
        skipped = [j for j in jobs if _done(j)]
        jobs = [j for j in jobs if not _done(j)]
        if skipped:
            print(f"skipping {len(skipped)} completed runs", flush=True)
    results = []
    failures = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {
            pool.submit(run_one, s, k, args, out): (s.study_id, k)
            for s, k in jobs
        }
        for fut in as_completed(futs):
            sid, k = futs[fut]
            try:
                row = fut.result()
                results.append(row)
                acc = (row["metrics"] or {}).get("accuracy")
                print(f"[done] {sid} rep{k} acc={acc} "
                      f"tokens={row['budget']['used']['total_tokens']} "
                      f"stop={row['stop_reason']}", flush=True)
            except Exception as e:  # noqa: BLE001
                # fail loudly: record the failure, keep going with other jobs
                failures.append({"study_id": sid, "repeat": k,
                                 "error": f"{type(e).__name__}: {e}",
                                 "traceback": traceback.format_exc()})
                print(f"[FAIL] {sid} rep{k}: {e}", flush=True)

    summary = {
        "config": {k: getattr(args, k) for k in vars(args)},
        "n_runs": len(results),
        "n_failures": len(failures),
        "failures": failures,
    }
    (out / "runs.json").write_text(
        json.dumps({"results": results, **summary}, indent=2)
    )
    if failures:
        print(f"WARNING: {len(failures)} run(s) failed — see runs.json",
              file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
