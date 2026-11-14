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
| Public BixBench dataset (`futurehouse/BixBench`, 205 questions, 64 data capsules) | In progress. An adapter is being built in `glhf/bixbench_v1/`. See [glhf/bixbench_v1/README.md](glhf/bixbench_v1/README.md). |

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
| Ledger | The shared record of a run: claims, tests, issues and events. File: `ledger.json`. |
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
| Critic | Tests each claim and raises issues. |
| Reviser | Fixes the open issues. |
| Finisher | Runs only if an artifact is still missing or unreadable after review. |
| Reporter | Writes `METHODS.md` from what was really run. This phase always runs. |

The order of roles, the budgets and the verdicts are fixed in code. No model decides them.
Design and diagrams: [glhf/docs/DESIGN.md](glhf/docs/DESIGN.md).

## Sponsors

| Sponsor | Used for | Status |
|---|---|---|
| [Exa](https://exa.ai) | Search. Literature search for the drug board, and documentation search for the swarm (`--exa`). | Tested with live searches. |
| [past.dev](https://past.dev) | Long-term memory for the swarm (`--memory` with `PAST_API_KEY`). | Sending and recalling lessons is tested against the live API. It has not been used inside a full swarm run. |
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
docker compose up --build                        # dashboard on :5317, engine on :8787
docker compose run --rm engine npm run doctor    # run any CLI command in the container
```

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

Cloud runs create a billed 32-core virtual machine. Do not start one unless the team agrees.

## How to read results

Each run has a folder `glhf/runs/<run-id>/`.

| File | Content |
|---|---|
| `run.json` | Settings, score, score per artifact, token use. |
| `outputs/` | The artifacts that were graded. |
| `outputs/METHODS.md` | What was run, what failed, what differs from the guidance. |
| `outputs/glhf/FINDINGS.md` | Swarm only. Supported claims, refuted claims, claims not established, fixed issues. |
| `outputs/glhf/ledger.json` | Swarm only. Every claim, test, issue and event. |

How verdicts are computed and how to compare two runs fairly:
[docs/reading-results.md](docs/reading-results.md).

## Where things are

| Path | Content |
|---|---|
| `glhf/bixbench/` | Edison's BixBench3 harness (CC BY-SA 4.0, commit in `UPSTREAM_COMMIT`) plus our code. |
| `glhf/bixbench/src/bixbench3/inspect_harness/swarm/` | The swarm: `solver.py`, `roles.py`, `ledger.py`, `tools.py`, `memory.py`, `past_memory.py`, `baseline.py`, `catalog.py`. |
| `glhf/bixbench/src/bixbench3/glhf_local.py` | Runs one case on your machine and grades it. |
| `glhf/bixbench/sandbox/local-compose.yaml` | The local sandbox (no network). |
| `glhf/bixbench_v1/` | In progress: adapter for the public BixBench dataset. |
| `glhf/demo_case/` | The demo case. |
| `glhf/memory/lessons.md` | Process lessons that the swarm keeps between runs. |
| `glhf/docs/DESIGN.md` | Design of the swarm. |
| `glhf/runs/` | Run folders. Not in git. |
| `engine/src/glhf/` | Run tracker, CLI, doctor, scoreboard, API routes. |
| `engine/src/` (other files) | Drug board, search (`search.ts`), Ask (`ask.ts`), HTTP checks (`http.ts`), server (`server.ts`). |
| `dashboard/src/views/` | `SwarmView.tsx`, `AgentsView.tsx`, `ExperimentsView.tsx`, `BoardView.tsx` and others. |
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
| [CONTRIBUTING.md](CONTRIBUTING.md) | For teammates: setup, tests, what not to commit. |
| [AGENTS.md](AGENTS.md) | Rules for coding agents. |

## Tests

```bash
npm test
```

This runs 239 harness tests (pytest), the type checks for the engine and the dashboard, and 32
engine tests. Some harness tests start a Docker sandbox; they are skipped when Docker is not running.

## Limits

- No BixBench3 task has been run. We do not know if the swarm is better than the single agent.
- On the demo case the swarm cost about 15 times the tokens for the same score.
- The budget flags (`--time-limit`, `--max-tokens`, `--max-messages-per-role`, `--seed`, `--exa`,
  `--memory`) work for local runs only. The engine refuses them for cloud runs.
- The swarm has tools that the single agent does not have. Say so when you report a comparison.
  See [docs/reading-results.md](docs/reading-results.md).
- The p-values in the ledger are reported by a model. Code cannot check them, and cannot check
  that the tests on one claim are independent.
- The benchmark's network gate is not tested by us.
- The drug board is decision support only. It does not replace expert review.
