# BixBench board: the app's board on the baseline's BixBench study

This folder runs the app's board, the same 7 agents as a review in the app, on BixBench v1
questions. It reuses the single-agent baseline harness (`bixbase/`), so the loader, sandbox,
budget, logs and grader are the same for both solvers. Only `solve()` changes:

- `--solver single`: the single-agent baseline (`bixbase/agent.py`).
- `--solver board`: the app's board (`bixbase/board.py`).

This is not the BixBench v1 adapter (`glhf/bixbench_v1/`, three roles) and not the BixBench3
swarm (`glhf/bixbench/`, nine roles).

## The board

The board is read at run time from the files the app uses:

- **Who:** the Lead Scientist and the members of the `board:` list in `board/config.yaml`, in
  its order: today `scout`, `proposer`, `experimenter`, `methods-auditor`, `critic`, `reporter`.
  A member added to that list joins the board here too.
- **Prompts:** `board/agents/<name>.md`. The files are not changed. Their sha256 goes into each
  run's transcript.
- **Models:** each member's tier (`model:` in its file) in the `models:` of `board/config.yaml`,
  as in the app. Today: lead and strong on Claude Sonnet, the scout on Claude Haiku, the critic
  on OpenAI gpt-5-mini. `--model` is not used for the board.
- **How a review runs:** as in the app (`engine/src/board/board.ts`). The Lead Scientist frames
  the question, then calls `converse`. Every member gets the message and replies; the scout
  first, then the others at the same time. Round 1 is blind; from round 2 every member sees the
  others' last replies. The lead names the experimenter's mode (`pilot`, `full`, `revise`).
  Each member keeps its own conversation. At most `meeting.max_rounds` rounds and
  `meeting.lead_turns` lead calls; past a limit (or 85% of any budget cap), only one round with
  `final=true` may run. The lead ends with `submit_answer`.

What the benchmark changes. A BENCHMARK section is added to each prompt, and it overrides the
file where they differ:

- **The scout cannot search.** AGENTS.md forbids open search for benchmark agents: the answers
  are in published papers. It inspects the study's data with `list_dir` and `read_file`.
- **The experimenter runs code** (`run_code`, Python or R) and reads the data. In the app it
  cannot run code; on BixBench the answers come from the data. It is the only member that runs
  code.
- **No claim checkers.** In the app they check claims against web and literature sources, which
  the benchmark forbids. So the digest has no verdicts.
- **Answers, not a memo:** the lead submits an answer per question id.

All members share one `Budget`. When it runs out, the lead makes one last call that may only
submit answers, like the baseline's forced final answer.

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
.venv/bin/python board_selftest.py   # the app's board: rounds, limits, R cell, read-only data, paid switch
.venv/bin/python transcript_selftest.py # the transcript fields a reader relies on
.venv/bin/python sandbox_selftest.py # nothing a code cell starts outlives the cell
.venv/bin/python modal_selftest.py   # code cells on Modal, with a fake Modal (needs requirements-modal.txt)
```

A code cell runs in its own process group. When the cell ends, or when its 120 seconds are
up, the whole group is killed: the cell and every process it started (`bixbase/cellrun.py`).

On macOS the sandbox uses `sandbox-exec` instead. R is optional there.

## The study conditions

The baseline's settings: 20 studies, 3 repeats, 500,000 tokens, 90 tool calls and 600 seconds per
run, and gpt-4o as the judge. The single agent uses gpt-5.1; the board uses the app's tiers.

Run **both solvers the same way**, with R and with `--sandbox modal`. The earlier baseline ran on
macOS without R, so it cannot be compared with a board run that had R.

```bash
STUDIES=bix-1,bix-2,bix-3,bix-4,bix-5,bix-6,bix-7,bix-8,bix-9,bix-10,bix-11,bix-12,bix-13,bix-14,bix-16,bix-17,bix-18,bix-19,bix-20,bix-21
COMMON="--studies $STUDIES --repeats 3 --budget-tokens 500000 --budget-seconds 600 --budget-tool-calls 90 --sandbox modal --workers 12 --modal-usd-cap 30"
.venv/bin/python run.py --solver single --model gpt-5.1 --provider openai $COMMON --out runs/single_modal
.venv/bin/python run.py --solver board $COMMON --out runs/board7_modal
.venv/bin/python summarize.py --results runs/single_modal
.venv/bin/python summarize.py --results runs/board7_modal
```

The board needs both keys in `.env` (Anthropic and OpenAI); the single agent and the judge need
the OpenAI key. `run.py` and `regrade.py` make paid calls. They refuse to start unless
`NO_PAID_CALLS=0`. Only the person who pays sets it.

Earlier runs, not comparable with these: the single-agent baseline scored 0.260 (64 of 246) on
macOS without R. A 5-member board ran once (2026-11-15); it is not the board this folder runs now,
and its numbers are not a result.

Do not commit `runs/` or `data/`.

## Code cells on Modal (`--sandbox modal`)

With `--sandbox modal`, each run gets its own Modal sandbox, and its code cells run there.
The board's members, their prompts and the review's rounds do not change, and the members'
model calls still go from this machine. Only `run_code`, `list_dir` and `read_file` run on Modal.
This machine then only waits on the model, so more runs fit at once (`--workers`).

Each sandbox:

- is made from the image `bixbench-board-env:1`: Python 3.11 with `requirements.txt`, and R
  from `r-environment.lock.txt`, installed as `setup_cloud.sh` installs them. When it starts,
  its packages are compared with those two files. If they differ, the run is refused;
- has no network. A code cell on a VM has network; on Modal it has none;
- gets the study's data from a Volume (uploaded once per study), copied to `/data`, which the
  code cannot change. The code runs as the user `agent`, in `/work`;
- gets no key and no variable from this machine;
- ends with its run. Its work folder is copied back to the run's `work/` folder (at most 50 MB).

Every Modal step is a paid call: it is refused unless `NO_PAID_CALLS` is `0`. Only the person
who pays runs these commands.

```bash
uv pip install -p .venv/bin/python -r requirements-modal.txt
.venv/bin/modal token new                                   # once, on this machine
.venv/bin/python -m bixbase.modal_sandbox build             # build and publish the image (once)
.venv/bin/python -m bixbase.modal_sandbox verify            # one small sandbox: the check, a Python cell, an R cell
.venv/bin/python run.py --solver board --sandbox modal --workers 40 --modal-usd-cap 20 ...   # the other options as above
.venv/bin/python -m bixbase.modal_sandbox list              # sandboxes still running (after a crash)
.venv/bin/python -m bixbase.modal_sandbox terminate         # end them
```

Options: `--modal-cpu` (default 2), `--modal-memory-gib` (default 8), `--modal-usd-cap`
(default 10 USD for the `--out` folder), `--modal-image`.

Money. A run reserves its worst case before its sandbox starts: the sandbox alive for the
run's `--budget-seconds` plus 900 seconds. With 2 cores and 8 GiB that is about 0.20 USD for a
600-second run. A run waits while the running runs' reservations would pass the cap; it is
refused when nothing runs and it still does not fit. Each sandbox gets one line in
`<out>/modal_ledger.jsonl`, and `result.json` records the sandbox (`"sandbox"`). Ctrl+C ends
every sandbox at once.

Compare like with like. The single-agent baseline ran its cells on a machine, with network.
Run both solvers with the same `--sandbox` before you compare them.

## Following runs while they go (for the dashboard)

Each run's `transcript.jsonl` is written line by line. It names the run (`run_start.run`), the
board's members and where the code runs, and every turn, tool call and code cell names its member.
`.venv/bin/python transcript_selftest.py` checks these fields. What a reader can rely on, and how
to show several runs at once, is in
[docs/proposals/concurrent-board-runs-ui.md](../../docs/proposals/concurrent-board-runs-ui.md).

