# BixBench v1 single-agent baseline — project notes

## What this is
A single-agent baseline for **BixBench v1** (Hugging Face `futurehouse/BixBench`,
205 questions). It is not BixBench3: that benchmark, and the GLHF swarm that
solves it, live in `glhf/bixbench` with their own loader, Docker sandbox and
unchanged upstream grader (see the repository `AGENTS.md`, which wins over this
file). The swarm does not reuse this folder, and nothing here may be wired into
its scoring. Numbers from here are not comparable with numbers from there.

## Rules (read before running anything)
- **Paid calls.** `run.py` and `regrade.py` call real models and are refused
  unless `NO_PAID_CALLS` is exactly `0` (process env, else the nearest `.env`,
  else the repo `.env`). Only the person who pays sets it. Agents never set it
  and never start a run unless the user asks for that run. `LLMClient` itself
  refuses too, so a script of your own is covered (`bixbase/paid.py`).
- **Ideal answers.** Agents never read, print or copy the ideal answers: not the
  dataset's `ideal` column, not the HF cache, not capsule zips or notebooks, not
  old `results*/` (records written before this rule contain `ideal`). Grading
  reads them host-side, in memory, at grade time; `result.json` never has them.
- **Model-written code** runs only inside the sandbox: no network, no parent
  environment, reads limited to the work dir, the prepared data dir and the
  Python install. Off macOS there is no sandbox and cells are refused unless
  `--unsafe-no-sandbox` is passed (only in a throwaway container/VM).
- `results*/` and `data/` are gitignored. Never commit them.
- Vendored code and its licence: `LICENSE.md`. Security changes: `CHANGES-security.md`.

## Layout
- `bixbase/budget.py` — `Budget`/`BudgetCaps`: token/tool-call/wall-clock caps;
  `BudgetExhausted` forces a final answer. Pass ONE Budget to the whole swarm
  for a global cap.
- `bixbase/sandbox.py` — `Sandbox(data_dir, work_dir).run_code(code)`.
  macOS `sandbox-exec`, deny by default: data_dir read-only, writes only in
  work_dir, no network, nothing else of the user's files readable. Cells get
  an allow-listed env (`$DATA_DIR`, HOME/TMPDIR inside work_dir). Agent cannot
  pip-install or download anything — install all needed packages in `.venv`
  beforehand (online tools such as gseapy's Enrichr calls will fail in cells).
- `bixbase/paid.py` — the `NO_PAID_CALLS` switch.
- `bixbase/llm.py` — `LLMClient` (anthropic/openai via env detection).
  Every call goes through a `Budget`. `enforce_budget=False` only for the one
  forced final-answer call.
- `bixbase/agent.py` — `solve(study, budget, *, llm, run_dir) -> SolveResult`.
  Tools: run_code, read_file, list_dir, submit_answer.
- `bixbase/loader.py` — `load_studies(source)` → `Study`s (lazy data download);
  `prepare_study_data(study, cache_dir)` materializes the capsule (atomic,
  with a `.bixbase-prepared` marker; notebooks, reports and scripts removed).
- `bixbase/grader.py` — vendored official scoring: str_verifier (MCQ),
  llm_verifier (judge, default gpt-4o), range_verifier, `compute_metrics`.
- `run.py` — CLI runner. `regrade.py` — re-judge into a new folder.
  `summarize.py` — report. `selftest.py` — no-API e2e test. `tests/` — pytest.

## Commands
Free (scripted model, no key, no network):
- Tests: `.venv/bin/python -m pytest tests` (needs `pip install pytest`; runs selftest too)
- Self-test alone: `.venv/bin/python selftest.py`
- Report: `.venv/bin/python summarize.py --results results/`

PAID — only when the user asks for this run and has set `NO_PAID_CALLS=0`.
`--budget-tokens` is required; name the studies, `all` is ~60 capsules:
- Run: `NO_PAID_CALLS=0 .venv/bin/python run.py --studies bix-1,bix-2 \
    --repeats 1 --seed 0 --budget-tokens 400000 --out results/`
- Re-judge: `NO_PAID_CALLS=0 .venv/bin/python regrade.py --results results/`
  (writes `results_regraded/`, grades every question of each study)

## Secrets
`.env` holds ANTHROPIC_API_KEY + OPENAI_API_KEY (gitignored). Never log env,
never read or print `.env`. While `NO_PAID_CALLS` is not `0` the keys are
blanked in the process before `.env` is loaded. Cells never get them.

## Models (verified on this account, Nov 2026)
- Solver default: `claude-sonnet-5-5` (anthropic) or `gpt-5.1` (openai);
  override with `MODEL_NAME` env or `--model`.
- Judge default: `gpt-4o` (official BixBench judge); `--grader-model` to change.

## Data
Source: HF `futurehouse/BixBench` (205 questions, ~60 capsules).
Capsule zips auto-download to `data/` on first use per study.
Official prep applied: only `Data/*` kept, Notebook dir + .ipynb stripped;
additionally .Rmd/.qmd/.html/.htm/.R/.py/.sh are stripped (none exist in the
64 v1 capsule zips checked by file name, so today this removes nothing more).
NOTE: benchmark questions are answered open-ended (`eval_mode` column);
official judge = LLM comparing to `ideal` answer.

## Known limitations
- No R installed: questions referencing R pkgs (DESeq2, clusterProfiler) rely
  on Python equivalents (pydeseq2 installed).
- Judge deviation: if only ANTHROPIC_API_KEY set, judge falls back to that
  provider — not comparable to official gpt-4o-judged scores.

## Baseline results (results_gpt51/, 2026-11-14)
**How to read these numbers:** real model; raw records not in git; sandbox at
the time did not prevent reading answers or the network; not comparable with
other harnesses. (The sandbox then was allow-by-default with the full parent
environment, see `CHANGES-security.md`; nobody has checked the transcripts for
use of that. Treat the numbers as unverified until re-run on the current code.)
- Solver gpt-5.1 (openai), judge gpt-4o, seed 0+rep, 20 studies × 3 reps,
  caps: 500k tokens / 90 tool calls / 600s per run.
- Pooled official metrics: accuracy 0.260 (64/246), precision 0.314,
  coverage 0.829. ~4.06M solver tokens, ~107min agent time.
- Best: bix-18 0.933, bix-19 0.667. Worst: bix-1,3,5,13,14,17,20,21 = 0.
- Reproduce (paid, needs NO_PAID_CALLS=0): run.py --studies <20 ids> --repeats 3 --model gpt-5.1
  --provider openai --budget-tokens 500000 --budget-seconds 600
  --budget-tool-calls 90 --out results_gpt51/ --workers 12
- Sonnet-5-5 partial (4 studies, results/): bix-12 0.867, bix-11 0.722 —
  kept for cross-model reference, NOT part of the official baseline.
