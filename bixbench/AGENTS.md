# BixBench3 baseline — project notes

## What this is
Single-agent baseline for BixBench-style benchmarks + shared infra that the
multi-agent swarm will reuse. Fair comparison requires the swarm to reuse:
loader, sandbox, budget, logging, grader. Only `solve()` gets swapped.

## Layout
- `bixbase/budget.py` — `Budget`/`BudgetCaps`: token/tool-call/wall-clock caps;
  `BudgetExhausted` forces a final answer. Pass ONE Budget to the whole swarm
  for a global cap.
- `bixbase/sandbox.py` — `Sandbox(data_dir, work_dir).run_code(code)`.
  macOS `sandbox-exec` makes data_dir genuinely read-only; agent writes land
  in work_dir. `$DATA_DIR` env inside cells. Agent cannot pip-install (writes
  denied) — install all needed packages in `.venv` beforehand.
- `bixbase/llm.py` — `LLMClient` (anthropic/openai via env detection).
  Every call goes through a `Budget`. `enforce_budget=False` only for the one
  forced final-answer call.
- `bixbase/agent.py` — `solve(study, budget, *, llm, run_dir) -> SolveResult`.
  Tools: run_code, read_file, list_dir, submit_answer.
- `bixbase/loader.py` — `load_studies(source)` → `Study`s (lazy data download);
  `prepare_study_data(study, cache_dir)` materializes the capsule.
- `bixbase/grader.py` — vendored official scoring: str_verifier (MCQ),
  llm_verifier (judge, default gpt-4o), range_verifier, `compute_metrics`.
- `run.py` — CLI runner. `summarize.py` — report. `selftest.py` — no-API e2e test.

## Commands
- Self-test (no API key): `.venv/bin/python selftest.py`
- Run: `.venv/bin/python run.py --studies all --repeats 1 --seed 0 \
    --budget-tokens 400000 --out results/`
- Report: `.venv/bin/python summarize.py --results results/`

## Secrets
`.env` holds ANTHROPIC_API_KEY + OPENAI_API_KEY (gitignored). Never log env.

## Models (verified on this account, Nov 2026)
- Solver default: `claude-sonnet-5-5` (anthropic) or `gpt-5.1` (openai);
  override with `MODEL_NAME` env or `--model`.
- Judge default: `gpt-4o` (official BixBench judge); `--grader-model` to change.

## Data
Source: HF `futurehouse/BixBench` (205 questions, ~60 capsules).
Capsule zips auto-download to `data/` on first use per study.
Official prep applied: only `Data/*` kept, Notebook dir + .ipynb stripped.
NOTE: benchmark questions are answered open-ended (`eval_mode` column);
official judge = LLM comparing to `ideal` answer.

## Known limitations
- No R installed: questions referencing R pkgs (DESeq2, clusterProfiler) rely
  on Python equivalents (pydeseq2 installed).
- Judge deviation: if only ANTHROPIC_API_KEY set, judge falls back to that
  provider — not comparable to official gpt-4o-judged scores.

## Baseline results (results_gpt51/, 2026-11-14)
- Solver gpt-5.1 (openai), judge gpt-4o, seed 0+rep, 20 studies × 3 reps,
  caps: 500k tokens / 90 tool calls / 600s per run.
- Pooled official metrics: accuracy 0.260 (64/246), precision 0.314,
  coverage 0.829. ~4.06M solver tokens, ~107min agent time.
- Best: bix-18 0.933, bix-19 0.667. Worst: bix-1,3,5,13,14,17,20,21 = 0.
- Reproduce: run.py --studies <20 ids> --repeats 3 --model gpt-5.1
  --provider openai --budget-tokens 500000 --budget-seconds 600
  --budget-tool-calls 90 --out results_gpt51/ --workers 12
- Sonnet-5-5 partial (4 studies, results/): bix-12 0.867, bix-11 0.722 —
  kept for cross-model reference, NOT part of the official baseline.
