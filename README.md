# GLHF: AI scientist swarm

Hackathon Track 3, AI Scientist Swarms. Can a team of agents reproduce a computational biology study
from raw data better than one frontier model on the same compute budget?

GLHF is a nine-role swarm that runs **inside Edison's BixBench3 harness**. Only the solver changes;
the sandbox, tools, time limit, grader and judge are the benchmark's own. Nothing is reported until a
critic has tried to break it, and every verdict is computed by code from tests the critic ran.

> **Status.** The swarm, run tracker, dashboard and Docker setup are built and tested on a toy demo
> case with a scripted model. **No BixBench3 task has been run yet**, so there is no score to report.
> Real runs need a Google Cloud project and model keys; `npm run doctor` lists what is missing.

Design schematic: [glhf/docs/DESIGN.md](glhf/docs/DESIGN.md).

```
Scout ─▶ Proposer ─▶ Pilot ─▶ Experimenter ─▶ Auditor + Critic ─▶ open issues? ─yes─▶ Reviser ─┐
inputs   plan,       subsample  full run       methods diff,       │ no          (loops back    │
         claims      dry run                   falsification       ▼              to review) ◀──┘
                                                         Finisher (only if an output is
                                                         still missing) ─▶ Reporter
      shared ledger: claims, tests, issues. Verdicts are computed in code.
```

| Role | Why it is there (what it protects in the score) |
|---|---|
| Scout | Wrong samples or identifiers ruin every artifact. Inventories inputs and tools before planning. |
| Proposer | Plans each artifact and registers falsifiable claims. |
| Pilot | A missing or malformed artifact scores zero. Runs the whole pipeline on a subsample first, so format and tool failures surface in minutes, not hours. |
| Experimenter | The full run. |
| Methods Auditor | Diffs the scripts against the stated methods line by line (tool, version, contrast direction, thresholds). |
| Critic | Tries to disprove each claim with tests; raises issues. |
| Reviser | Fixes what the two reviewers raised. |
| Finisher | Runs only if an artifact is still missing or malformed after review; never fabricates. |
| Reporter | Writes METHODS.md from what actually ran. |

## Sponsors

| Sponsor | Used for | Status in this repo |
|---|---|---|
| [Exa](https://exa.ai) | Research search | Working. Literature search for the drug board, and the swarm's documentation search (`--exa`). Tested with live searches. |
| [past.dev](https://past.dev) | Long-term memory | Working. Sending lessons and recalling them is tested against the live API; a full swarm run using it has not been done yet. With `PAST_API_KEY` set, `--memory` sends each run's process lessons to past.dev and recalls the relevant ones at the start of the next run. Without the key, memory is the shared file `glhf/memory/lessons.md`. |
| [Modal](https://modal.com) | Cloud computing | Planned. The design for running tasks on Modal is written up; no run has used Modal yet. |

## Quick start (no keys needed)

Needs Node 26 (the version tested), [uv](https://docs.astral.sh/uv/) and Docker running.

```bash
npm run setup      # installs engine, dashboard and the benchmark harness
npm run doctor     # checks tools and keys, says what to do about each gap
npm run demo       # the swarm on the demo case with a scripted model, about 15 seconds
npm run engine     # backend on :8787 (run tracker + drug board)
npm run dashboard  # http://localhost:5317, "Swarm" is the first icon
```

Or everything in containers, with nothing installed but Docker:

```bash
docker compose up --build                        # dashboard :5317, engine :8787
docker compose run --rm engine npm run doctor    # any CLI command works this way
```

Run the engine in Docker or on the host, not both at once. On Linux, files the container writes
under `glhf/runs/` are owned by root.

## Keys

Copy `.env.example` to `.env` (gitignored). Put comments on their own lines.

| Key | Used for |
|---|---|
| `OPENAI_API_KEY` | Required for cloud runs: the benchmark's judge and network gate use GPT-5.5. Also an agent provider. |
| `ANTHROPIC_API_KEY` | Claude as the agents, or as one role. |
| `HF_TOKEN` | Access to the gated dataset `EdisonScientific/BixBench3`. |
| `EXA_API_KEY` | Exa search: the drug board's literature search and the swarm's `--exa` documentation search. |
| `PAST_API_KEY` | past.dev long-term memory for the swarm (`--memory`). Optional; a local file is used without it. |
| `OPENROUTER_API_KEY` | Drug board models and Jev. |

## Running it

```bash
# Local, on the demo case, with real models (not yet tried with a real model):
npm run glhf -- run --mode local --solver glhf   --model anthropic/claude-opus-5 --follow
npm run glhf -- run --mode local --solver single --model anthropic/claude-opus-5 --follow

# Put the critic on a second vendor:
npm run glhf -- run --mode local --solver glhf --model anthropic/claude-opus-5 \
    --role-model critic=openai/gpt-5.5 --follow

# A BixBench3 task on Google Cloud (about 8 hours, up to 24; a 32-core VM is billed until it completes):
npm run glhf -- run --mode cloud --task 11 --solver glhf   --model openai/gpt-5.5 --effort max
npm run glhf -- run --mode cloud --task 11 --solver single --model openai/gpt-5.5 --effort max

npm run glhf -- list            # all runs
npm run glhf -- show <run-id>   # one run: phase, score, claims
npm run glhf -- resume          # keep tracking unfinished runs after a restart
npm run scoreboard              # single agent vs swarm per task, next to the 0.523 record
```

Before the first cloud run, build the benchmark's runtime image once (30 to 60 minutes; needs the two
Cell Ranger archives from 10x Genomics). See [glhf/bixbench/README.md](glhf/bixbench/README.md).

**Runs survive restarts.** Each run is one [Pi Durable](https://github.com/earendil-works/pi) task
that launches the job, sleeps between status checks and records the grade. Kill the engine, restart
it, and tracking continues; the job itself keeps running meanwhile. Before launching, the tracker
checks for an existing launch, so a restart does not start a second VM (tested against a stand-in
for the cloud CLI, not against Google Cloud).

Cloud runs start from the CLI only (they cost money). In the dashboard they appear with their phase
and score. Claims and issues for cloud runs are in the results bucket (`--results-bucket`), not yet
in the dashboard.

## Budgets, search, memory and repeatability (local runs)

```bash
npm run glhf -- run --mode local --solver glhf --model anthropic/claude-sonnet-5-5 \
    --time-limit 2400 --max-tokens 4000000 --max-messages-per-role 300 \
    --exa --memory --seed 7 --follow
```

| Flag | What it does |
|---|---|
| `--time-limit S` | Seconds for the whole run. Each role gets a fixed share (see the Agents view). |
| `--max-tokens N` | Token budget for the whole run, both solvers. The swarm caps the supporting roles, skips phases once the budget is spent, and keeps 10% so the Reporter still writes METHODS.md. Limits are checked after each model call, so a run can end slightly over. |
| `--max-messages-per-role N` | Swarm: message cap per phase. A model call with one tool call is two messages. |
| `--review-rounds N` | Swarm: audit, critique and revise rounds (default 3). |
| `--exa` | Swarm: a `search_docs` tool (Exa). It searches an allow-list of software documentation and help sites only, never journals, preprint servers or data repositories, so it should not return the study being reproduced. Results are re-checked against the list and the task's restricted sites, queries containing a DOI or accession are refused, and a run gets at most 20 searches. Every query, refusal and dropped result is logged in the ledger. |
| `--memory` | Swarm: the Reporter writes up to 8 process lessons; they are saved in `glhf/memory/lessons.md` (in git, shared by the team) and, when `PAST_API_KEY` is set, in past.dev, which then picks the lessons relevant to each new task. They are given to every role in later runs. Lessons are written before grading and must not contain results. |
| `--seed N` | Sent to providers that support a seed. |

There is no dollar cap for swarm runs: tokens are the budget. These flags are not passed to cloud
runs yet. `--exa` and `--memory` give the swarm help the single agent does not have, so say so when
reporting a run that used them.

**Repeatability.** A rerun with a real model will not repeat exactly: model output varies, and time
budgets cut phases at different points. What is fixed or recorded: the order of roles and their
budgets (code), verdicts (code), every model call (Inspect log), every search query and claim
(ledger), the analysis scripts, and the settings, seed and versions in `run.json`. Report the mean
and spread of repeated runs rather than one run.

The drug board has its own limits and memory in `board/config.yaml`: spend per run and per day, turns
per agent, escalation checks, and `memory`, which adds each member's verified and contradicted claims
to `board/expertise/<member>.md` after a real (not scripted) run.

## A fair comparison

- Same model, VM, time limit, tools and grader for both solvers. `--solver single` is the upstream
  baseline, unchanged.
- The solver and any per-role models are recorded in the run manifest.
- The benchmark's answer tables are in a public bucket. Agents are told to use only staged inputs,
  and the benchmark's network gate lists that bucket as protected. We have not tested the gate.
- Report results as "N tasks, same budget", not as a full-benchmark score, unless all 20 tasks ran.

### What differs between the two solvers

The comparison is not tool-for-tool. The swarm has, and the single agent does not:

- `check_outputs`, a format checker built from the task's expected outputs
- the claims ledger and its tools
- nine role prompts with fresh contexts, and a Reporter pass that always runs
- with `--exa`, documentation search; with `--memory`, lessons from earlier runs (never from the same task)

With `--max-tokens`, both solvers keep 10% of the budget to write METHODS.md. The 5,000-message cap
applies per phase for the swarm and once for the single agent. The scoreboard shows a difference
only between runs with the same task, model, time limit and token budget, lists each run's extras,
and shows failed runs.

### Verdict rules

A claim is supported when the product of its tests' e-values reaches m/0.1, where m is the number of
registered claims; it is refuted by a contradicting test with p < 0.1/m. Each claim takes at most
three tests, one result per test name. The error bound assumes the tests are independent, which the
code cannot check; FINDINGS.md says so in every run.

## Ask and search

The Experiments view has an Ask box: a small model (`claude-haiku-5-5`, change with `ASK_MODEL`)
reads a summary of the newest runs and answers with the runs it used. It needs `ANTHROPIC_API_KEY`;
without it, or on an error, it falls back to keyword search and says so. Answers can be wrong: open
the cited runs to check.

## Who can start runs

The engine listens on `127.0.0.1:8787` only and accepts browser requests only from the dashboard
(`DASHBOARD_ORIGINS` adds origins, `HOST` changes the address). Cloud runs and `--case` need the
token the CLI reads from `glhf/runs/.token`. Real-model local runs can start from the dashboard or
the CLI. Any other caller can only start the scripted demo.

## What each run reports

- The required artifacts, graded against the published tables.
- `METHODS.md`: what was actually run, deviations and failures.
- `glhf/FINDINGS.md`: supported findings, rejected claims, claims not established, and analyses the
  critic rejected before reporting.
- `glhf/ledger.json`: every claim, test, e-value, issue and phase.

A claim is **supported** when its combined e-value is 10 or more, **refuted** when a contradicting
test has p below 0.1 or a replication fails, and otherwise **not established**. A claim with no real
effect is marked supported at most 10% of the time (Popper, Huang et al., ICML 2025).

## Layout

```
glhf/bixbench/                   Edison's BixBench3 harness (CC BY-SA 4.0, see UPSTREAM_COMMIT) plus:
  src/bixbench3/inspect_harness/swarm/   solver.py, roles.py, ledger.py, tools.py
  src/bixbench3/glhf_local.py            run a case on a laptop and grade it
  sandbox/local-compose.yaml             laptop sandbox (no network)
glhf/demo_case/                  toy case: 3,600 reads, 4 samples, 2 required tables
glhf/docs/                       DESIGN.md, ideas and design (docx)
engine/src/glhf/                 Pi Durable run tracker, CLI, doctor, API routes
dashboard/src/views/SwarmView.tsx   live view of roles, claims, verdicts, scores
dashboard/src/views/AgentsView.tsx  the nine roles: time share, model, instructions
dashboard/src/views/ExperimentsView.tsx  search across every run (engine: /api/search)
engine/, board/, dashboard/      the drug candidate board (see docs/drug-board.md)
Dockerfile, docker-compose.yml   the platform in containers
```

## Tests

```bash
npm test    # 237 harness tests (ledger, Type-I simulation, budgets, end-to-end in Docker), 32 engine tests, type checks
```

## Also in this repo: the drug candidate board

A lead scientist and eight research agents decide whether drug candidates should advance, with Jev,
OpenAI and Claude Code checking every claim and Exa for literature search. It shares the engine and
dashboard. See [docs/drug-board.md](docs/drug-board.md).
