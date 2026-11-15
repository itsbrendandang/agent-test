# Benchmark run: what is ready and what one command starts

This is the plan for the first full comparison of one agent alone against the three-role swarm
on BixBench v1.5 (205 questions on 59 datasets). Nothing here has spent money. The run itself
needs the person who pays to turn paid calls on.

## What was checked on 15 November (no cost)

| Check | Result |
|---|---|
| Dataset on this machine | 59 capsules, 205 questions, all 64 zip files present (5.5 GB). |
| `bixbench-v1 audit` | 0 problems. Every prompt is clean. No file is withheld for an unlisted type. |
| Official sandbox image | Present (`futurehouse/bixbench:aviary-notebook-env`). |
| Dry run on a real capsule (`bix-9`, 3 questions), scripted model, both solvers | Both finished. The swarm's blind check found nothing visible to the critic. Scores of a scripted run mean nothing. |
| Adapter tests | 272 without Docker, 18 with Docker, all pass. |
| Free disk | 39 GB. Staging every capsule needs about 13.5 GB. |

Not checked: any real model in the changed swarm. The only real-model numbers are the pilot's
(8 questions, older swarm).

## The run

Run from `glhf/bixbench_v1/`. `NO_PAID_CALLS=0` is the payer's decision.

Step 1, a slice first (10 capsules with 43 questions, both solvers, same budget). The cap below
covers the most these 20 runs can spend (12.6 M tokens of budget, 15.75 M at the hard stop):

```bash
NO_PAID_CALLS=0 uv run bixbench-v1 run \
  --capsules bix-1,bix-2,bix-3,bix-4,bix-5,bix-6,bix-7,bix-8,bix-9,bix-10 \
  --solvers single,glhf --swarm-budget equal \
  --model anthropic/claude-sonnet-5-5 \
  --total-token-cap 16000000 --out runs/slice-1
```

Step 2, everything (resumable; finished runs are skipped):

```bash
NO_PAID_CALLS=0 uv run bixbench-v1 run --all \
  --solvers single,glhf --swarm-budget equal \
  --model anthropic/claude-sonnet-5-5 \
  --total-token-cap 70000000 --out runs/full-1
uv run bixbench-v1 report --out runs/full-1
```

Read the report's first lines before any number: it says how the run was graded and why it is
not comparable with published numbers (today: no network in the sandbox, one run per capsule).

## Budget

Each run may spend 200,000 tokens plus 100,000 per question; the swarm gets the same total.

| | One agent | Swarm | Both |
|---|---|---|---|
| Most the budgets allow (59 runs) | 32.3 M tokens | 32.3 M | 64.6 M |
| Hard stop (1.25 times) | 40.4 M | 40.4 M | 80.8 M |
| Scaled from the pilot's real use | about 8 M | about 14 M | about 22 M |
| Dollars, scaled from the pilot | about $10 | about $17 | about $27 |
| Longest it can take, one after another | 34 hours | 34 hours | 68 hours |

The pilot rows are a rough guide only: 8 questions on 3 small datasets, the older swarm, assumed
list prices, and no judge cost. The pilot's three capsules took 2.5 minutes (one agent) and 4
minutes (swarm) in all, so the real time should be far under the longest.

`--total-token-cap` stops before a run that could pass it. Set it to what you accept.

## Decisions before step 2

1. **Judge.** 205 questions include free-text ones that need a model to grade. The default judge
   is `openai/gpt-4o`. With `--no-judge` they stay ungraded and accuracy is a lower bound.
2. **Unit.** One run per capsule (default, cheaper) or `--unit question` (what the official
   code does, about three times the cost).
3. **Repeats.** `--repeats 3` gives a mean over repeats and a fairer test, at three times the cost.
4. **Network.** At least 17 questions name an online resource. The sandbox has none, for both
   solvers. Report those questions apart.

## Charts, later

`report.json` already holds what the charts need: accuracy per solver with intervals, per eval
mode, tokens and seconds per question, the paired test, and what the swarm rejected
(`outputs/answers.json` of each swarm run). No chart code exists yet.
