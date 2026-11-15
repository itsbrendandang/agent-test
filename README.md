# AI Scientist Bot (GLHF): AI scientist swarm

Team GLHF, hackathon Track 3 (AI Scientist Swarms).

The question we test: can a team of agents reproduce a computational biology study from raw data
better than one model with the same budget?

This repository holds two projects that share one backend and one web UI:

1. **GLHF swarm** (the main project). A solver with nine roles for Edison's BixBench3 benchmark.
   The nine roles are nine phases with their own instructions. They use four model groups, and
   by default all four use the same model.
   Only the solver is ours. The sandbox, time limit, grader and judge are the benchmark's own code.
2. **Drug candidate board** (the older project). A lead scientist agent and nine research agents (our own
   nine-role swarm, prompts only so far) that write a memo. See [docs/drug-board.md](docs/drug-board.md).

## Paid calls are off on a new clone

A new clone can only do scripted runs (`--model mock`). They cost nothing. Everything that
costs money is refused by the engine until a person writes this line in `.env` and starts the
engine again:

```
NO_PAID_CALLS=0
```

| | |
|---|---|
| Who may set it | Only the person who pays for the API keys. A coding agent never sets it. |
| Where it is read | First the process environment (an exported value wins), then `.env`. |
| When is the switch on | Always, unless the value is exactly `0`. No value, `1`, `true` or a typing mistake all mean: no paid calls. |
| Refused while on | Runs with a real model, cloud runs, Exa search, the drug board's real models and its three checkers. The Ask box answers by word search, with no model. |
| Still works | `npm run demo`, runs with `--model mock`, the scripted drug board, the dashboard, all tests. |
| Python commands | Covered too: `uv run bixbench3 run`, `python -m bixbench3.glhf_local` and `uv run bixbench-v1 run` refuse a real model, a cloud launch and Exa in the same way. |
| **Not covered** | `inspect eval` on `inspect_harness/tasks.py`, and scripts that call `run_capsule`, `InspectJudge`, `GCPRunner` or `exa_docs` directly. Credentials other than seven named provider keys (Google, AWS, Azure, a saved Hugging Face login). A cloud run that is already on its virtual machine. |

Details: [docs/running.md](docs/running.md#paid-calls-no_paid_calls).

## Status

Read this first. It says what was really done.

| Item | Status |
|---|---|
| Swarm and single agent on the demo case, scripted model | Works. Covered by automated tests and `npm run demo`. |
| Swarm and single agent on the demo case, real model | Done once each. Both scored 1.0. The swarm used about 15 times the tokens of the single agent. |
| A real BixBench3 task | **Not done.** There is no benchmark score to report. |
| Cloud run on Google Cloud | **Not done.** Google Cloud is not set up. |
| Public BixBench dataset (`futurehouse/BixBench` v1.5, 205 questions, 59 data capsules) | Adapter built and tested with the scripted model. A small pilot with a real model ran (3 capsules, 8 questions) with the older swarm. The swarm was changed after it; the changes are tested with the scripted model only. **The full run is not done.** See [BixBench v1 adapter](#bixbench-v1-adapter). |

The demo case is a small built-in test case. It is not a benchmark task, so a demo score is not a
benchmark score. Full details: [docs/status.md](docs/status.md).

## Words used in these documents

| Word | Meaning |
|---|---|
| Swarm | The GLHF solver with nine roles (`--solver glhf`). |
| Single agent | The benchmark's own solver with one agent (`--solver single`). It is our baseline. |
| Role | One agent in the swarm. Each role has its own instructions and starts with an empty context. There are nine roles in four model groups (planner, experimenter, critic, reporter). A role is not a separate model: with one `--model`, all nine use it. |
| Phase | One turn of one role inside a run, for example `critique 2`. |
| Artifact | An output file that the task requires. The grader scores artifacts. |
| Claim | A statement about the results that can be tested, with a null hypothesis. |
| Ledger | The shared record of a run: claims, registered tests, results, issues and events. File: `ledger.json`. |
| Registered test | A test that the Critic names and describes before it runs any test of that claim. Only registered tests can support a claim. |
| Verdict | The result for a claim: supported, refuted, insufficient or untested. Code computes it. |
| Demo case | The small test case in `glhf/demo_case/` (3,598 reads, 4 samples, 2 required tables). |
| Scripted model | `--model mock`. It replays fixed steps and needs no key. It tests the code, not the science. |
| Engine | The Node.js backend in `engine/`. It tracks runs and serves the API on port 8787. |
| Dashboard | The web UI in `dashboard/`, on port 5317. |
| Run tracker | The part of the engine that starts a run, follows it and records the grade. |

## The nine roles

```
Scout -> Proposer -> Pilot -> Experimenter -> [Methods Auditor -> Critic -> Reviser] -> Finisher -> Reporter
                                               repeated, at most 3 rounds by default   only if an
                                                                                        artifact is
                                                                                        missing
```

| Role | What it does |
|---|---|
| Scout | Lists the inputs, the sample mapping and the installed tools. |
| Proposer | Writes the plan and registers 3 to 8 claims. |
| Pilot | Runs the whole pipeline on a small subsample, so format and tool errors appear early. |
| Experimenter | Runs the full analysis and writes every artifact. |
| Methods Auditor | Compares the scripts with the task's Method Guidance. Raises issues. |
| Critic | Registers tests for each claim, then runs them. Raises issues. |
| Reviser | Fixes the open issues. |
| Finisher | Runs only if an artifact is still missing or unreadable after review. |
| Reporter | Writes `METHODS.md` from what was really run. This phase always runs. |

The order of roles, the budgets and the verdicts are fixed in code. No model decides them.
Design and diagrams: [glhf/docs/DESIGN.md](glhf/docs/DESIGN.md).

## Sponsors

| Sponsor | Used for | Status |
|---|---|---|
| [Exa](https://exa.ai) | Search. Literature search for the drug board, and documentation search for the swarm (`--exa`). | Tested with live searches. |
| [past.dev](https://past.dev) | Long-term memory for the swarm (`--memory` with `PAST_API_KEY`). Only lessons that a person approved are sent. | Sending and recalling lessons is tested against the live API. It has not been used inside a full swarm run. |
| [Modal](https://modal.com) | Cloud computing. | Planned only. No code in this repository uses Modal. |

## Quick start (no keys needed)

You need Node.js 24 or newer, [uv](https://docs.astral.sh/uv/) and Docker (running).

```bash
npm run setup      # install the engine, the dashboard and the benchmark harness
npm run doctor     # list what this machine has and what is missing
npm run demo       # run the swarm on the demo case with the scripted model (about 15 seconds)
npm start          # start the engine and the dashboard, and open the app in your browser
```

`npm start` is the one command for everyday use. It runs practice runs only until paid calls are
turned on. Press Ctrl+C to stop. To run the two parts yourself, use `npm run engine` and, in a
second terminal, `npm run dashboard`.

Or run everything in containers. Only Docker is needed:

```bash
docker compose up --build                 # wait for "glhf tracker ready", then open http://localhost:5317
docker compose exec engine npm run demo   # in a second terminal; ends with "score 1.000"
docker compose exec engine npm run doctor
```

The Docker path was tested on a new clone on macOS. Linux and Windows are not tested. Windows
needs WSL2. Steps: [CONTRIBUTING.md](CONTRIBUTING.md#quick-start-with-docker-only).

Run the engine in Docker or on your machine, not both at the same time.

For real models, copy `.env.example` to `.env`, add your keys, and set `NO_PAID_CALLS=0` (see
[Paid calls are off on a new clone](#paid-calls-are-off-on-a-new-clone)). Key list:
[docs/configuration.md](docs/configuration.md).

## How to run

```bash
# Demo case with a real model, swarm and single agent. Needs NO_PAID_CALLS=0 in .env and a token budget.
npm run glhf -- run --mode local --solver glhf   --model anthropic/claude-sonnet-5-5 --max-tokens 400000 --follow
npm run glhf -- run --mode local --solver single --model anthropic/claude-sonnet-5-5 --max-tokens 400000 --follow

npm run glhf -- list            # all runs
npm run glhf -- show <run-id>   # one run: phase, score, claims, issues
npm run glhf -- cancel <run-id> # stop a local run
npm run scoreboard              # single agent and swarm side by side
```

All commands, flags and the rules for cloud runs: [docs/running.md](docs/running.md).

Rules for local runs (details: [docs/running.md](docs/running.md#run-control)):

| Rule | Detail |
|---|---|
| One local run at a time | A second start is refused until the first run ends or is cancelled. |
| Paid calls | A run with a real model, a cloud run and `--exa` are refused unless `.env` has `NO_PAID_CALLS=0`. |
| Token budget | A local run with a real model is refused without `--max-tokens`. |
| Pair | One request can start the swarm and the single agent with the same settings, one after the other (`--solvers glhf,single`, or `solvers` in the HTTP API). |
| Cancel | `cancel` stops a local run and a partner that is queued behind it. A cloud run is not cancelled this way; the command prints what to run. |

These rules were tested with a stand-in for the runner, not with a real model.

The dashboard's Swarm view can also start a local run on the demo case (button **New run**).
A run with a real model needs a token budget and a confirm step there. "Both, to compare"
starts a pair. A live or queued run has a **Cancel run** button.

Cloud runs create a billed 32-core virtual machine. Do not start one unless the team agrees.

## How to read results

Each run has a folder `glhf/runs/<run-id>/`.

| File | Content |
|---|---|
| `run.json` | Settings, score, score per artifact, token use. |
| `outputs/` | The artifacts that were graded. |
| `outputs/METHODS.md` | What was run, what failed, what differs from the guidance. |
| `outputs/glhf/FINDINGS.md` | Swarm only. Supported claims, refuted claims, claims not established, fixed issues. |
| `outputs/glhf/ledger.json` | Swarm only. Every claim, registered test, result, issue and event. |

How verdicts are computed and how to compare two runs fairly:
[docs/reading-results.md](docs/reading-results.md).

## BixBench v1 adapter

`glhf/bixbench_v1/` runs the single agent and a three-role swarm (analyst, blind critic,
reconciler that derives the answer again by running code) on the public dataset
`futurehouse/BixBench` v1.5. This is a different benchmark
from BixBench3, and this swarm is not the nine-role swarm. Full text:
[glhf/bixbench_v1/README.md](glhf/bixbench_v1/README.md).

| Item | Status |
|---|---|
| Staging, the integrity rules, both solvers, grading, report | Built. Tested with the scripted model (122 automated tests). |
| Pilot with a real model (`anthropic/claude-sonnet-5-5`) | 3 capsules, 8 questions. Single agent 4 of 8 correct. Swarm 4 of 8 correct. The swarm used about 1.7 times the tokens. **This was the older swarm**, before the changes below. |
| Changes to the swarm after the pilot (table below) | **Tested with the scripted model only. No run with a real model has checked them.** |
| Full run (205 questions) | **Not done.** |
| Results API in the engine (`GET /api/bixv1/...`) | Built, read-only. Automated tests with fixture folders. The dashboard does not show it yet. See [docs/running.md](docs/running.md#bixbench-v1-results-api). |

The pilot is too small to conclude anything. It does not show that one solver is better.

What the pilot did show: where the analyst and the critic agreed, the answer was often wrong.
In the pilot the critic was shown the analyst's route. That is why the swarm was changed:

| Change | What it does now |
|---|---|
| Blind critic | The critic gets the questions and its own instructions only. Nothing of the analyst's: no answer, no route, no files. Code moves the analyst's files away and checks this before the critic starts. If the check fails, the critic does not run. `--critic-hints` is still accepted but is ignored. |
| Reconciler runs code | The reconciler cannot record an answer by saying so. It writes a script, the harness runs it, and the answer is the value on the last output line. It runs whenever a question has two answers. |
| Same-method flag | When two answers agree and both were made by the same method, the agreement is marked as weaker and gets a spot check. |
| Budget floors | Each role has a smallest token budget, computed from the number of questions. A run whose budget cannot hold the three floors is refused before it starts. Tokens that a role does not use go to the next role. |
| Forced final turn | A derivation that stops with questions unanswered gets one last short turn that can only submit answers. Such answers are marked as forced and count as weak. The single agent has no such turn. |
| Equal or extended budget | `BIXBENCH_V1_SWARM_BUDGET=equal` (default): the swarm's total is the single agent's budget. `extended`: the swarm gets 2.25 times that, and the result must be read as "more budget". There is no command-line option for this yet. |

These changes answer a problem seen in 8 questions. We do not know if they help.

Known limits:

- The sandbox has no network. At least 17 of the 205 questions name an online resource, so
  they cannot be answered as asked, by either solver.
- The official image does not have some R packages (for example edgeR, limma, Seurat).
- One run is one capsule with all its questions. The official protocol is one question per run
  (`--unit question` does that, at a higher cost). Say this with any number you report.
- Two blind derivations by the same model can still make the same mistake. "Replicated" does
  not mean "correct".
- The same-method check compares the words of two short lines. It is crude.
- The harness cannot prove that the reconciler's script is a real analysis.

## Where things are

| Path | Content |
|---|---|
| `glhf/bixbench/` | Edison's BixBench3 harness (CC BY-SA 4.0, commit in `UPSTREAM_COMMIT`) plus our code. |
| `glhf/bixbench/src/bixbench3/inspect_harness/swarm/` | The swarm: `solver.py`, `roles.py`, `ledger.py`, `tools.py`, `memory.py`, `past_memory.py`, `baseline.py`, `catalog.py`. |
| `glhf/bixbench/src/bixbench3/glhf_local.py` | Runs one case on your machine and grades it. |
| `glhf/bixbench/sandbox/local-compose.yaml` | The local sandbox (no network). |
| `glhf/bixbench_v1/` | Adapter for the public BixBench dataset (v1.5). Its own package and tests. |
| `glhf/demo_case/` | The demo case. |
| `glhf/memory/` | Swarm memory. `lessons.pending.md`: lessons that wait for a person. `lessons.md`: approved lessons, the only file later runs read. See [glhf/memory/README.md](glhf/memory/README.md). |
| `glhf/docs/DESIGN.md` | Design of the swarm. |
| `glhf/runs/` | Run folders. Not in git. |
| `engine/src/glhf/` | Run tracker, CLI, doctor, scoreboard, API routes. |
| `engine/src/bixv1/` | Read-only results API for the BixBench v1 adapter. |
| `engine/src/paid.ts` | The paid-calls switch (`NO_PAID_CALLS`). |
| `engine/src/` (other files) | Drug board, search (`search.ts`), Ask (`ask.ts`), HTTP checks (`http.ts`), request handler (`app.ts`), server start (`server.ts`). |
| `dashboard/src/views/` | `SwarmView.tsx`, `AgentsView.tsx`, `ExperimentsView.tsx`, `BoardView.tsx` and others. |
| `dashboard/src/swarm/NewRun.tsx` | The form that starts a run from the dashboard. |
| `board/` | Drug board configuration, agents, briefs. |
| `Dockerfile`, `docker-compose.yml`, `docker/` | The container setup. |
| `docs/` | Reference documents (list below). |

## Documents

| Document | Content |
|---|---|
| [docs/status.md](docs/status.md) | What was tested, and how. |
| [docs/running.md](docs/running.md) | Commands, flags, run control (pair, cancel), Docker, cloud runs, who can start a run, HTTP API. |
| [docs/pi-setup.md](docs/pi-setup.md) | Optional: the Pi coding agent in this repository. |
| [docs/configuration.md](docs/configuration.md) | Keys, environment variables, ports, `board/config.yaml`. |
| [docs/reading-results.md](docs/reading-results.md) | Output files, verdict rules, scoreboard, fair comparison. |
| [docs/drug-board.md](docs/drug-board.md) | The drug candidate board. |
| [glhf/docs/DESIGN.md](glhf/docs/DESIGN.md) | Design of the swarm. |
| [glhf/memory/README.md](glhf/memory/README.md) | Swarm memory: how to approve or reject lessons. |
| [glhf/bixbench_v1/README.md](glhf/bixbench_v1/README.md) | The BixBench v1 adapter. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | For teammates: setup, tests, what not to commit. |
| [AGENTS.md](AGENTS.md) | Rules for coding agents. |
| [docs/pi-setup.md](docs/pi-setup.md) | Optional: the Pi agent harness this was built with, and the reviewer, advisor, docs and QA profiles in `.pi/agents/`. |
| [dashboard/DESIGN.md](dashboard/DESIGN.md) | For teammates changing the UI: where the dashboard's design lives and which file to change for what. |

## Tests

```bash
npm test
```

This runs the harness tests (pytest), the type checks for the engine and the dashboard, and the
engine tests. Counts at commit `58c0935`:

| Part | In committed files | With files not yet committed |
|---|---|---|
| Harness (`glhf/bixbench/tests`) | 370 | 2,390. Three new files add 2,020 (most are generated cases in `test_redteam_guards.py`). |
| Engine (`engine/test`) | 115 | 188: 171 pass, 0 fail, 1 skipped, 16 marked "todo". One new file, `glhf-timeouts.test.ts`, adds 58. Uncommitted changes to `glhf-runs.test.ts` add 15. |
| BixBench v1 adapter (`glhf/bixbench_v1/tests`) | 122 | the same |
| Dashboard (`dashboard/src`, vitest) | 105, all pass | the same |

- The 16 "todo" tests are in `glhf-timeouts.test.ts`. Each one describes a known problem in how
  the engine handles a run that passes its time limit. They do not count as failures, but the
  problems are real.
- Some harness tests start a Docker sandbox. They are skipped when Docker is not running.
- The harness and adapter numbers are counts of collected tests. We ran only the paid-calls
  tests of both (11 and 5, all pass) for this count.

`npm test` does not run the adapter tests or the dashboard tests. Run them with:

```bash
cd glhf/bixbench_v1 && uv run pytest -q tests
npm --prefix dashboard test
```

## Licence

Our own code is under the MIT licence (`LICENSE`). Two folders are not: `glhf/bixbench/` is a modified copy
of BixBench3 (Edison Scientific, CC BY-SA 4.0; our changes are listed in `glhf/bixbench/CHANGES.md` and carry
the same licence), and `glhf/bixbench_v1/` depends on it and is offered under CC BY-SA 4.0 as well.
Third-party files copied into the repository keep their own terms. Open items before the repository is made
public are in `docs/proposals/licenses.md`.

## Limits

- The `NO_PAID_CALLS` switch does not cover `inspect eval` on the task file, scripts that call
  the library functions directly, credentials other than seven named keys, or a cloud run that
  is already on its virtual machine. See
  [docs/running.md](docs/running.md#what-is-not-covered).
- No BixBench3 task has been run. We do not know if the swarm is better than the single agent.
- On the demo case the swarm cost about 15 times the tokens for the same score.
- The budget flags (`--time-limit`, `--max-tokens`, `--max-messages-per-role`, `--seed`, `--exa`,
  `--memory`) work for local runs only. The engine refuses them for cloud runs.
- The swarm has tools that the single agent does not have. Say so when you report a comparison.
  See [docs/reading-results.md](docs/reading-results.md).
- The p-values in the ledger are reported by a model. Code cannot check them. Code also cannot
  see a test that a model ran in private before it registered the test.
- The BixBench v1 pilot (8 questions) is too small to compare the solvers.
- The benchmark's network gate is not tested by us.
- The drug board is decision support only. It does not replace expert review.
