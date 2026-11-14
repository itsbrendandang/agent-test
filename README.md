# GLHF: AI scientist swarm

Team GLHF, hackathon Track 3 (AI Scientist Swarms).

The question we test: can a team of agents reproduce a computational biology study from raw data
better than one model with the same budget?

This repository holds two projects that share one backend and one web UI:

1. **GLHF swarm** (the main project). A solver with nine roles for Edison's BixBench3 benchmark.
   Only the solver is ours. The sandbox, time limit, grader and judge are the benchmark's own code.
2. **Drug candidate board** (the older project). A lead scientist agent and eight research agents
   that write a go / no-go memo. See [docs/drug-board.md](docs/drug-board.md).

## Status

Read this first. It says what was really done.

| Item | Status |
|---|---|
| Swarm and single agent on the demo case, scripted model | Works. Covered by automated tests and `npm run demo`. |
| Swarm and single agent on the demo case, real model | Done once each. Both scored 1.0. The swarm used about 15 times the tokens of the single agent. |
| A real BixBench3 task | **Not done.** There is no benchmark score to report. |
| Cloud run on Google Cloud | **Not done.** Google Cloud is not set up. |
| Public BixBench dataset (`futurehouse/BixBench` v1.5, 205 questions, 59 data capsules) | Adapter built and tested with the scripted model. A small pilot with a real model ran (3 capsules, 8 questions). **The full run is not done.** See [BixBench v1 adapter](#bixbench-v1-adapter). |

The demo case is a small built-in test case. It is not a benchmark task, so a demo score is not a
benchmark score. Full details: [docs/status.md](docs/status.md).

## Words used in these documents

| Word | Meaning |
|---|---|
| Swarm | The GLHF solver with nine roles (`--solver glhf`). |
| Single agent | The benchmark's own solver with one agent (`--solver single`). It is our baseline. |
| Role | One agent in the swarm. Each role has its own instructions and starts with an empty context. |
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
npm run engine     # start the engine on http://127.0.0.1:8787
npm run dashboard  # start the dashboard on http://localhost:5317 (run in a second terminal)
```

Or run everything in containers. Only Docker is needed:

```bash
docker compose up --build                 # wait for "glhf tracker ready", then open http://localhost:5317
docker compose exec engine npm run demo   # in a second terminal; ends with "score 1.000"
docker compose exec engine npm run doctor
```

The Docker path was tested on a new clone on macOS. Linux and Windows are not tested. Windows
needs WSL2. Steps: [CONTRIBUTING.md](CONTRIBUTING.md#quick-start-with-docker-only).

Run the engine in Docker or on your machine, not both at the same time.

For real models, copy `.env.example` to `.env` and add your keys. Key list:
[docs/configuration.md](docs/configuration.md).

## How to run

```bash
# Demo case with a real model, swarm and single agent:
npm run glhf -- run --mode local --solver glhf   --model anthropic/claude-sonnet-5-5 --follow
npm run glhf -- run --mode local --solver single --model anthropic/claude-sonnet-5-5 --follow

npm run glhf -- list            # all runs
npm run glhf -- show <run-id>   # one run: phase, score, claims, issues
npm run scoreboard              # single agent and swarm side by side
```

All commands, flags and the rules for cloud runs: [docs/running.md](docs/running.md).

The dashboard's Swarm view can also start a local run on the demo case (button **New run**).
A run with a real model needs a token budget and a confirm step there.

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
reconciler) on the public dataset `futurehouse/BixBench` v1.5. This is a different benchmark
from BixBench3, and this swarm is not the nine-role swarm. Full text:
[glhf/bixbench_v1/README.md](glhf/bixbench_v1/README.md).

| Item | Status |
|---|---|
| Staging, the integrity rules, both solvers, grading, report | Built. Tested with the scripted model (102 automated tests). |
| Pilot with a real model (`anthropic/claude-sonnet-5-5`) | 3 capsules, 8 questions. Single agent 4 of 8 correct. Swarm 4 of 8 correct. The swarm used about 1.7 times the tokens. |
| Full run (205 questions) | **Not done.** |

The pilot is too small to conclude anything. It does not show that one solver is better.

Known limits:

- The sandbox has no network. At least 17 of the 205 questions name an online resource, so
  they cannot be answered as asked, by either solver.
- The official image does not have some R packages (for example edgeR, limma, Seurat).
- One run is one capsule with all its questions. The official protocol is one question per run
  (`--unit question` does that, at a higher cost). Say this with any number you report.

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
| [docs/running.md](docs/running.md) | Commands, flags, Docker, cloud runs, who can start a run, HTTP API. |
| [docs/configuration.md](docs/configuration.md) | Keys, environment variables, ports, `board/config.yaml`. |
| [docs/reading-results.md](docs/reading-results.md) | Output files, verdict rules, scoreboard, fair comparison. |
| [docs/drug-board.md](docs/drug-board.md) | The drug candidate board. |
| [glhf/docs/DESIGN.md](glhf/docs/DESIGN.md) | Design of the swarm. |
| [glhf/memory/README.md](glhf/memory/README.md) | Swarm memory: how to approve or reject lessons. |
| [glhf/bixbench_v1/README.md](glhf/bixbench_v1/README.md) | The BixBench v1 adapter. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | For teammates: setup, tests, what not to commit. |
| [AGENTS.md](AGENTS.md) | Rules for coding agents. |
| [docs/pi-setup.md](docs/pi-setup.md) | Optional: the Pi agent harness this was built with, and the reviewer, advisor, docs and QA profiles in `.pi/agents/`. |

## Tests

```bash
npm test
```

This runs 359 harness tests (pytest), the type checks for the engine and the dashboard, and 64
engine tests. Some harness tests start a Docker sandbox; they are skipped when Docker is not running.

`npm test` does not run the tests of the BixBench v1 adapter (102 tests). Run them with:

```bash
cd glhf/bixbench_v1 && uv run pytest -q tests
```

The dashboard has no automated tests.

## Limits

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
