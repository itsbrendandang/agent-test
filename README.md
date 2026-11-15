# AI Scientist Bot

Team GLHF, hackathon Track 3 (AI Scientist Swarms).

## What this is

You ask a science question. A team of AI agents works on it. Then every statement they make is
checked, and you see which ones held up.

An AI model can write a confident answer that is wrong. This project does not ask you to trust the
answer. It shows the checking.

**How it works**

1. **You ask.** For example: "Should we take this drug candidate forward?" or "Reproduce the
   analysis in this study from the raw data."
2. **A team works on it.** Each agent has one job: one plans, one does the analysis, one looks for
   mistakes, one writes the report.
3. **Every statement is checked.** A statement gets one of three marks:
   - ✓ **Holds up.** A check supported it.
   - ✕ **Proven wrong.** A check contradicted it.
   - ? **Not enough evidence.** Nothing was found to check it against.
4. **You get an answer with the marks.** You can open any statement and see who said it and how it
   was checked.

**Words you will see**

| Word | Plain meaning |
|---|---|
| Agent | One AI model given one job and its own instructions. |
| Swarm | A team of agents that work through a task in a fixed order. |
| Single agent | One AI model doing the whole task alone. We compare the swarm against it. |
| Board review | A team of agents that discuss a written question in rounds and write a recommendation. |
| Practice run | A run with fixed example answers. It is free and needs no account. It shows how the app works. It is not research. |
| Real run | A run that uses real AI models. It costs money and is off until someone turns it on. |
| Benchmark | A public set of tasks with known answers, used to measure how good a method is. Ours is BixBench (biology data analysis). |

A longer list for developers is [further down](#words-used-in-these-documents).

**Where things stand, in plain words**

- The app works, and you can try it today with practice runs.
- The team of agents has been run with a real AI model only on a small test case and a small pilot.
  On both, it scored the same as one model alone and cost more.
- We have **not** run a full benchmark. So we cannot say that a team of agents is better than one
  model. That is the question this project was built to test.
- The board review has never been run with real AI models, and today its agents cannot look
  anything up. This is the next thing to fix.

Exact details are in [Status](#status).

**Why "durable"**

The app is built on a durable agent harness ([Pi Durable](docs/pi-setup.md)). A board review that
is interrupted, for example by a crash or a restart, continues where it stopped and does not
repeat finished work. We tested this by stopping a practice run in the middle.

## Try it

This needs a terminal and a few minutes. You need [Node.js](https://nodejs.org) 24 or newer. For the
swarm you also need [uv](https://docs.astral.sh/uv/) and Docker (running).

```bash
npm run setup    # once, after cloning
npm start        # starts the engine and the app, and opens it in your browser
```

Press Ctrl+C to stop. A new clone does **practice runs** only: fixed example answers, no keys,
no cost. They show how the app works. They are not research.

Other ways to start:

```bash
npm run doctor   # list what this machine has and what is missing
npm run demo     # run the swarm on the demo case with the scripted model (about 15 seconds)

docker compose up --build   # everything in containers; wait for "glhf tracker ready",
                            # then open http://localhost:5317
```

- `npm start` was tested only with the engine and the app already running. A start from nothing
  is not tested yet.
- The Docker path was tested on a new clone on macOS. Linux and Windows are not tested; Windows
  needs WSL2. Steps: [CONTRIBUTING.md](CONTRIBUTING.md#quick-start-with-docker-only).
- Run the engine in Docker or on your machine, not both at the same time.
- A desktop app for macOS (Apple Silicon) exists as a
  [prerelease](https://github.com/itsbrendandang/agent-test/releases). It is an older build under
  the old name "Drug Board", it is not signed, and it only shows the window: the engine must be
  started separately. A build that starts its own engine is in progress.

## What is in the app

| View | What it shows |
|---|---|
| Home | A chat box. Ask about past runs, or ask a research question and get a plan you can start. |
| Runs | Every run, with search. |
| Compare | The swarm and the single agent on the same task, side by side. Start a run here. |
| Board | One board review: what each member said, and how each statement was checked. |
| Agents | The roles and what each one did. |
| Graph | One run as a 3D graph of who said what and what held up. |
| Settings | Engine state, paid calls, session token. |

The dashboard is being reworked now. The table describes the views; details on screen may differ.

---

The rest of this page is for developers and teammates.

## Two parts, one engine

1. **GLHF swarm.** A solver with nine roles for Edison's BixBench3 benchmark. The nine roles are
   nine phases with their own instructions. Only the solver is ours. The sandbox, time limit,
   grader and judge are the benchmark's own code.
2. **Board review.** A lead scientist agent and nine members discuss a written brief in rounds
   and the lead writes a memo. The members have the same nine role names as the swarm, but here
   they are prompts only: they have no tools and run no code. Each statement a member makes is
   checked by a model from a different vendor, which must quote the source. See
   [docs/drug-board.md](docs/drug-board.md).

Both are tracked by one engine (`engine/`, port 8787) and shown in one app (`dashboard/`, port 5317).

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
| Refused while on | Runs with a real model, cloud runs, Exa search, the board's real models and its claim checkers. The Home chat answers with a word search or fixed text, with no model. |
| Still works | `npm run demo`, runs with `--model mock`, the scripted board review, the dashboard, all tests. |
| Python commands | Covered too: `uv run bixbench3 run`, `python -m bixbench3.glhf_local` and `uv run bixbench-v1 run` refuse a real model, a cloud launch and Exa in the same way. |
| **Not covered** | `inspect eval` on `inspect_harness/tasks.py`, and scripts that call `run_capsule`, `InspectJudge`, `GCPRunner` or `exa_docs` directly. Credentials other than seven named provider keys (Google, AWS, Azure, a saved Hugging Face login). A cloud run that is already on its virtual machine. |

With paid calls on, a board run with a missing key stops at the start and names the key. It does not
fall back to a practice run. A switch in the app to turn paid calls on is being built; today `.env` is
the only way.

Details: [docs/running.md](docs/running.md#paid-calls-no_paid_calls).

## Status

Read this first. It says what was really done.

| Item | Status |
|---|---|
| Swarm and single agent on the demo case, scripted model | Works. Covered by automated tests and `npm run demo`. |
| Swarm and single agent on the demo case, real model | Done once each. Both scored 1.0. The swarm used about 15 times the tokens of the single agent. |
| Board review, scripted | Works. A practice run with the default members shows statements that hold up, one proven wrong, and some with too little evidence. |
| Board review, real models | **Never run.** The board calls Anthropic and OpenAI directly. The model names, the cost and the quote check are not proven with a real run. |
| Evidence for the board | **Missing.** No board member has a search tool, so a real run has no sources. Every literature statement would be recorded as "not enough evidence". Only statements about the brief itself can be confirmed. |
| A real BixBench3 task | **Not done.** There is no benchmark score to report. |
| Cloud run on Google Cloud | **Not done.** Google Cloud is not set up. |
| Public BixBench dataset (`futurehouse/BixBench` v1.5, 205 questions, 59 data capsules) | Adapter built and tested with the scripted model. A small pilot with a real model ran (3 capsules, 8 questions) with the older swarm. The swarm was changed after it; the changes are tested with the scripted model only. **The full run is not done.** See [BixBench v1 adapter](#bixbench-v1-adapter). |

The demo case is a small built-in test case. It is not a benchmark task, so a demo score is not a
benchmark score. Full details: [docs/status.md](docs/status.md).

## Words used in these documents

The developer list. The plain list is at the [top](#what-this-is).

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

The app's Compare view can also start a local run on the demo case (button **New run**).
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

## Sponsors

| Sponsor | Used for | Status |
|---|---|---|
| [Exa](https://exa.ai) | Search. Documentation search for the swarm (`--exa`). Literature search for the board is built, with spend limits, but no board member has the search tool today. | The swarm's search was tested with live searches. |
| [past.dev](https://past.dev) | Long-term memory for the swarm (`--memory` with `PAST_API_KEY`). Only lessons that a person approved are sent. | Sending and recalling lessons is tested against the live API. It has not been used inside a full swarm run. |
| [Modal](https://modal.com) | Cloud computing. | Planned only. No code in this repository uses Modal. |

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
| `engine/src/chat/` | The Home chat: catalogue, plans, routes. |
| `engine/src/` (other files) | Board review (`board.ts`), providers (`providers.ts`), claim checking (`triage.ts`, `checkers.ts`), Exa search and its spend record (`exa.ts`, `exaledger.ts`), search (`search.ts`), Ask (`ask.ts`), HTTP checks (`http.ts`), request handler (`app.ts`), server start (`server.ts`). |
| `dashboard/src/views/` | One file per view: `HomeView.tsx`, `ExperimentsView.tsx` (Runs), `SwarmView.tsx` (Compare), `BoardView.tsx`, `AgentsView.tsx`, `WorldsView.tsx` (Graph), `SettingsView.tsx`. |
| `dashboard/src-tauri/` | The desktop app (Tauri). |
| `dashboard/src/swarm/NewRun.tsx` | The form that starts a run from the dashboard. |
| `board/` | Board review configuration, members, briefs. The folder and the API keep the name "board". |
| `glhf/specialists/` | Domain specialist profiles and skill agents. Instructions only. Nothing runs them. |
| `bixbench/` | A teammate's separate single-agent baseline for BixBench v1. Not used for our comparison. |
| `datasets/` | A catalogue of public dataset pointers. A proposal; no code reads it. |
| `scripts/start.mjs` | What `npm start` runs. |
| `Dockerfile`, `docker-compose.yml`, `docker/` | The container setup. |
| `docs/` | Reference documents (list below). |

## Documents

| Document | Content |
|---|---|
| [docs/status.md](docs/status.md) | What was tested, and how. |
| [docs/running.md](docs/running.md) | Commands, flags, run control (pair, cancel), Docker, cloud runs, who can start a run, HTTP API. |
| [docs/configuration.md](docs/configuration.md) | Keys, environment variables, ports, `board/config.yaml`. |
| [docs/reading-results.md](docs/reading-results.md) | Output files, verdict rules, scoreboard, fair comparison. |
| [docs/drug-board.md](docs/drug-board.md) | The board review: members, models, how statements are checked, what "verified" means. |
| [docs/cost.md](docs/cost.md), [docs/readiness.md](docs/readiness.md) | Measured cost per run, and what works with paid calls on. Written before the provider change; parts are out of date. |
| [docs/local-model.md](docs/local-model.md) | Running with a local model (Ollama). |
| [docs/proposals/](docs/proposals/) | Proposals, not decisions: desktop app, agent sets and the Popper paper, licences, Modal. |
| [glhf/docs/DESIGN.md](glhf/docs/DESIGN.md) | Design of the swarm. |
| [glhf/memory/README.md](glhf/memory/README.md) | Swarm memory: how to approve or reject lessons. |
| [glhf/bixbench_v1/README.md](glhf/bixbench_v1/README.md) | The BixBench v1 adapter. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | For teammates: setup, tests, what not to commit. |
| [AGENTS.md](AGENTS.md) | Rules for coding agents. |
| [docs/pi-setup.md](docs/pi-setup.md) | Optional: the Pi agent harness this was built with, and the reviewer, advisor, docs and QA profiles in `.pi/agents/`. |
| [dashboard/DESIGN.md](dashboard/DESIGN.md) | For teammates changing the UI: where the dashboard's design lives and which file to change for what. |

## Tests

```bash
npm test                                         # harness tests, type checks, engine tests
cd glhf/bixbench_v1 && uv run pytest -q tests    # BixBench v1 adapter
npm --prefix dashboard test                      # dashboard
```

**`main` is not green today.** Several changes are in progress at once.

| Part | Last known state |
|---|---|
| Engine type check | Clean. |
| Engine tests | 249 pass, 5 fail, and `app.test.ts` does not finish, so `npm test` hangs. The failures are known and being fixed. |
| Dashboard | Mid-rework. The last pushed dashboard passed its tests; the working copy does not build yet. |
| Harness (`glhf/bixbench/tests`) | Not re-run in full after the latest changes. |
| BixBench v1 adapter | Not re-run in full after the latest changes. |

Some harness tests start a Docker sandbox. They are skipped when Docker is not running.
Details and older counts: [docs/status.md](docs/status.md).

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
- A board review cannot gather evidence today, because no member can search. See [Status](#status).
- On the board, "verified" means a model from another vendor found a real passage in the source with the
  same numbers. It does not prove the passage supports the statement.
- The swarm's ledger is inspired by the Popper paper (Huang et al., 2025) but is not that method: we
  average e-values where the paper multiplies them, and we have no separate relevance check. See
  [docs/proposals/agent-sets.md](docs/proposals/agent-sets.md).
- A board review is decision support only. It does not replace expert review.
