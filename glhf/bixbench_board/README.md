# BixBench board: the five board members on the baseline's BixBench study

This folder runs the drug board's five strong members on BixBench v1 questions. It reuses the
single-agent baseline harness (`bixbase/`), so the loader, sandbox, budget, logs and grader are
the same for both solvers. Only `solve()` changes:

- `--solver single`: the single-agent baseline (`bixbase/agent.py`).
- `--solver board`: the board (`bixbase/board.py`).

This is not the BixBench v1 adapter (`glhf/bixbench_v1/`, three roles) and not the BixBench3
swarm (`glhf/bixbench/`, nine roles).

## The board

The prompts are read at run time from `board/agents/` (`proposer`, `experimenter`,
`methods-auditor`, `critic`, `reporter`). Their sha256 is written to each run's transcript.
The code is the lead. It runs these steps in order:

1. Proposer: plans one claim per question. A claim is the answer to one question. No tools.
2. Experimenter, Full mode: runs Python or R in the sandbox and records draft answers.
3. Methods auditor and critic, at the same time. Neither sees the other's report. No tools.
4. Experimenter, Revise mode: fixes what was flagged. Skipped when nothing is flagged.
5. Reporter: writes the final answers with `submit_answer`.

All five share one `Budget`. The experimenter stops Full mode at 60% of any cap. Review is
skipped after 80%, and Revise mode stops at 90%. When the budget runs out, the reporter makes
one last call, like the baseline's forced final answer. Every member uses the same model.
`bixbase/board.py` lists the few prompt lines it changes for the benchmark.

## Setup (Linux x86_64)

```bash
cd glhf/bixbench_board
./setup_cloud.sh
export BIXBASE_RSCRIPT="$HOME/renv/bin/Rscript"
```

The script installs:

- bubblewrap, which makes the study data read-only for code cells;
- Python 3.11 with `requirements.txt`;
- R 4.4.3 with DESeq2, edgeR, limma, clusterProfiler and tidyverse, pinned in
  `r-environment.lock.txt`.

At the end it runs both self-tests. They use a scripted model and cost nothing:

```bash
.venv/bin/python selftest.py         # single agent
.venv/bin/python board_selftest.py   # board, R cell, read-only data, paid switch
```

On macOS the sandbox uses `sandbox-exec` instead. R is optional there.

## The study conditions

These are the baseline's settings: gpt-5.1, 20 studies, 3 repeats, 500,000 tokens,
90 tool calls and 600 seconds per run, and gpt-4o as the judge.

```bash
.venv/bin/python run.py --solver board \
  --studies bix-1,bix-2,bix-3,bix-4,bix-5,bix-6,bix-7,bix-8,bix-9,bix-10,bix-11,bix-12,bix-13,bix-14,bix-16,bix-17,bix-18,bix-19,bix-20,bix-21 \
  --repeats 3 --model gpt-5.1 --provider openai \
  --budget-tokens 500000 --budget-seconds 600 --budget-tool-calls 90 \
  --out runs/board_gpt51 --workers 12
.venv/bin/python summarize.py --results runs/board_gpt51
```

`run.py` and `regrade.py` make paid calls. They refuse to start unless `NO_PAID_CALLS=0`.
Only the person who pays sets it. The keys come from the repository's `.env`.

The single-agent baseline with these settings scored 0.260 (64 of 246 graded attempts). It had
no R, so it used Python equivalents such as pydeseq2. Its run files are not in this repository.

Do not commit `runs/` or `data/`.
