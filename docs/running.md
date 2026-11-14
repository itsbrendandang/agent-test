# Running GLHF

All commands run from the repository root. Words such as swarm, single agent, phase and demo
case are defined in the [README](../README.md#words-used-in-these-documents).

## npm scripts

| Command | What it does |
|---|---|
| `npm run setup` | Installs the engine, the dashboard and the benchmark harness (`uv sync --locked`). |
| `npm run doctor` | Checks tools and keys on this machine. It prints only "set" or "not set" for a key. |
| `npm run demo` | Runs the swarm on the demo case with the scripted model. Needs Docker. No keys. |
| `npm run glhf -- <command>` | The run tracker CLI (see below). |
| `npm run scoreboard` | Same as `npm run glhf -- scoreboard`. |
| `npm run engine` | Starts the engine on `127.0.0.1:8787`. It continues unfinished runs. |
| `npm run dashboard` | Starts the dashboard on `http://localhost:5317`. |
| `npm run desktop` | The dashboard as a Tauri desktop app. Needs Rust. |
| `npm run board` | One drug board run in the terminal. |
| `npm run resume <run-id>` | Continues an unfinished drug board run. |
| `npm run runs` | Lists drug board runs. |
| `npm run typecheck` | Type checks for the engine and the dashboard. |
| `npm run test:engine` | Engine tests only. |
| `npm test` | Harness tests, type checks, engine tests. |
| `npm run docker` | Same as `docker compose up --build`. |

## Run tracker CLI

```bash
npm run glhf -- doctor [--cellranger DIR]
npm run glhf -- demo [--solver single|glhf]
npm run glhf -- run --mode local|cloud --solver single|glhf --model MODEL [flags]
npm run glhf -- run --help
npm run glhf -- list
npm run glhf -- show <run-id>
npm run glhf -- resume
npm run glhf -- scoreboard
```

| Command | What it does |
|---|---|
| `doctor` | Lists what is ready and what is missing, with the fix for each gap. `--cellranger DIR` also checks for the two Cell Ranger archives in `DIR`. |
| `demo` | Scripted run on the demo case. It waits until the run ends. |
| `run` | Starts a run. With `--follow` it waits and prints each change. |
| `list` | All runs, newest first. |
| `show <run-id>` | One run: phase, score, claims, issues. |
| `resume` | Continues to track unfinished runs when the engine is not running. |
| `scoreboard` | Single agent and swarm side by side. See [reading-results.md](reading-results.md). |

If the engine is running, the CLI sends the request to the engine. If not, the CLI process
tracks the run itself. Only one process can track runs at a time (lock file
`glhf/runs/tracker.lock`).

### Flags of `run`

| Flag | Mode | Solver | Meaning |
|---|---|---|---|
| `--mode local\|cloud` | | | Where to run. Default `local`. |
| `--solver single\|glhf` | both | | Default `glhf`. |
| `--model MODEL` | both | both | An Inspect model id such as `anthropic/claude-sonnet-5-5`, or `mock` (local only). Required. |
| `--role-model ROLE=MODEL` | both | swarm | A different model for one group of roles. Can be repeated. Not with `mock`. |
| `--review-rounds N` | both | swarm | Rounds of audit, critique and revise. 1 to 10. Default 3. |
| `--follow` | both | both | Wait until the run ends. |
| `--time-limit S` | local | both | Seconds for the whole run. 60 to 86,400. Default 1,800. |
| `--max-tokens N` | local | both | Token budget for the whole run. 1,000 to 500,000,000. |
| `--max-messages-per-role N` | local | swarm | Message limit per phase. 2 to 5,000. A model call with one tool call is two messages. |
| `--seed N` | local | both | Sent to model providers that support a seed. |
| `--exa` | local | swarm | Gives the roles the `search_docs` tool. Needs `EXA_API_KEY`. |
| `--memory` | local | swarm | Keeps process lessons between runs. See below. |
| `--case DIR` | local | both | A case folder other than the demo case. |
| `--task T` | cloud | both | Task number or paper id. Required for cloud runs. |
| `--effort E` | cloud | both | Reasoning effort. Required for cloud runs. |
| `--project P` | cloud | both | Google Cloud project. Default: the project selected in `gcloud`. |
| `--results-bucket gs://...` | cloud | both | Where the full run bundle is copied. |

Groups for `--role-model`:

| Group | Roles that use it |
|---|---|
| `planner` | Scout, Proposer |
| `experimenter` | Pilot, Experimenter, Reviser, Finisher |
| `critic` | Methods Auditor, Critic |
| `reporter` | Reporter |

Example: run the Critic and the Methods Auditor on a second vendor.

```bash
npm run glhf -- run --mode local --solver glhf --model anthropic/claude-sonnet-5-5 \
    --role-model critic=openai/gpt-5.5 --follow
```

### Budgets

```bash
npm run glhf -- run --mode local --solver glhf --model anthropic/claude-sonnet-5-5 \
    --time-limit 2400 --max-tokens 4000000 --max-messages-per-role 300 \
    --exa --memory --seed 7 --follow
```

- **Time.** The swarm uses 97% of the time limit. Each phase gets a fixed share. Shares are in
  [glhf/docs/DESIGN.md](../glhf/docs/DESIGN.md) and in the dashboard's Agents view.
- **Tokens.** With `--max-tokens`, both solvers keep 10% of the budget to write `METHODS.md`.
  The swarm also limits some phases (scout 5%, propose 8%, pilot 15%, audit 8%, critique 20% of
  the budget) and skips a phase when the budget is spent. Limits are checked after each model
  call, so a run can end a little over the budget.
- **Money.** There is no dollar limit for swarm runs. Tokens are the budget.

### Documentation search (`--exa`)

`search_docs` searches a fixed list of software documentation and help sites (`DOC_DOMAINS` in
`swarm/tools.py`). It does not search journals, preprint servers, code hosts or data
repositories. The reason: an open search could find the results of the study that the task
asks to reproduce.

Rules in code:

- A query with a DOI, an accession number or a paper id is refused.
- Each result is checked again against the list and against the task's network policy.
- A run gets at most 20 searches, for all roles together.
- Every query, refusal and dropped result is written to the ledger.

The Critic and the Reporter do not get this tool.

### Memory (`--memory`)

The Reporter writes process lessons to a file. Code filters the lines (the text is cut at 2,000
characters, and lines that look like results are dropped). The lines that pass are added to
`glhf/memory/lessons.md`. This file is in git, so the team shares it.

- With `PAST_API_KEY` set, the lessons are also sent to past.dev, and the next run asks past.dev
  for lessons. If past.dev fails, the run uses the file.
- Lessons from a run on task X are never shown to a later run on task X.
- Lessons are written before grading, so a lesson cannot hold a score.
- With `--model mock`, lessons go to the run folder (`glhf/runs/<run-id>/memory/`), not to
  `glhf/memory/`.

`--exa` and `--memory` give the swarm help that the single agent does not have. Say so when
you report a run that used them.

## Cloud runs

Not done yet (see [status.md](status.md)). A cloud run creates a 32-core virtual machine
(`n2-standard-32`) that is billed until the run is collected. The upstream README says a run
takes about 8 hours on average and at most 24.

Needed first:

1. A Google Cloud project with billing, the Compute Engine API and quota. `npm run doctor`
   checks `gcloud` and the project.
2. `OPENAI_API_KEY` (the benchmark's judge and network gate use it) and `HF_TOKEN` (access to
   the dataset `EdisonScientific/BixBench3`).
3. The benchmark's runtime image, built once with `bixbench3 setup-runtime`. This needs the two
   Cell Ranger archives from 10x Genomics. See
   [glhf/bixbench/README.md](../glhf/bixbench/README.md) (upstream text).

```bash
npm run glhf -- run --mode cloud --task 11 --solver glhf   --model openai/gpt-5.5 --effort max
npm run glhf -- run --mode cloud --task 11 --solver single --model openai/gpt-5.5 --effort max
```

The tracker passes only these to the cloud runner: `--task`, `--model`, `--effort`, `--project`,
`--solver`, `--role-model`, `--review-rounds`, `--results-bucket`. The engine refuses
`--time-limit`, `--max-tokens`, `--seed`, `--max-messages-per-role`, `--exa` and `--memory` for
cloud runs.

Cloud runs appear in the dashboard with phase and score. Their claims and issues are in the
results bucket, not in the dashboard.

## How tracking works

Each run is one [Pi Durable](https://github.com/earendil-works/pi) task
(`engine/src/glhf/task.ts`). The task starts the run as a separate process, sleeps between
checks, and stores a checkpoint after each step in `glhf/runs/tracker.sqlite`.

- Local run: start `glhf_local.py`, read `run.json` every 2 seconds, record the grade.
- Cloud run: start `bixbench3 run`, wait until it detaches, call `bixbench3 status` every
  5 minutes, then `bixbench3 complete` to collect the grades and delete the machine.

If the engine stops, the run itself continues. When the engine starts again, tracking continues
from the last checkpoint. Before a launch, the tracker creates a marker file, so a restart does
not launch the same run twice.

A local run is stopped and marked failed when it is still going long after its time limit
(limit plus 30 minutes, or plus a quarter of the limit if that is more).

## Docker

```bash
docker compose up --build
docker compose run --rm engine npm run doctor
```

| Service | Address | Notes |
|---|---|---|
| `engine` | `http://localhost:8787` | Published on `127.0.0.1` only. Reads `.env` if it exists. |
| `dashboard` | `http://localhost:5317` | Serves the built dashboard (`docker/serve.mjs`). |

- The repository is mounted into the container at the same path as on your machine. Run
  `docker compose` from the repository root.
- The engine container uses your machine's Docker (`/var/run/docker.sock`) to start the
  sandbox. This gives the container full control of Docker. Run only code you trust.
- The first start installs dependencies into Docker volumes. This takes some minutes.
- On Linux, files that the container writes under `glhf/runs/` belong to root.
- The dashboard is built with the engine address `http://localhost:8787`
  (`VITE_ENGINE_URL` in the `Dockerfile`). If you change the engine port, rebuild with a
  matching `VITE_ENGINE_URL`.

## Who can start a run

The engine can start runs that cost money, so it checks each request (`engine/src/http.ts`,
`checkRequest` in `engine/src/glhf/tracker.ts`).

- The engine listens on `127.0.0.1` only (`HOST` changes this).
- The `Host` header must name this machine (`localhost`, `127.0.0.1`, `[::1]`, or a name in
  `ENGINE_HOSTS`).
- If a request has an `Origin` header, it must be the dashboard (`DASHBOARD_ORIGINS` adds more).
- POST bodies must be `application/json`.

| Caller | Can start |
|---|---|
| Has the token (the CLI reads it from `glhf/runs/.token`) | Everything: cloud runs, `--case`, real models, `--exa`, `--memory`. |
| The dashboard page (allowed `Origin`) | Local runs on the demo case, also with a real model, `--exa` or `--memory`. |
| Any other caller | The scripted demo only. |

The dashboard's Swarm view has a button for the scripted demo only (`startDemo` in
`dashboard/src/swarm/api.ts`). Start real-model runs from the CLI.

Drug board runs (`POST /api/runs`) are allowed from the dashboard page, with the token, or when
the board runs on scripted models.

## HTTP API

Engine routes (`engine/src/server.ts`, `engine/src/glhf/routes.ts`):

| Method and path | Returns |
|---|---|
| `GET /api/glhf/status` | The record to beat, tools and keys present (never the key values). |
| `GET /api/glhf/roles` | The nine roles: instructions and budget shares, read from the Python code. |
| `GET /api/glhf/runs` | Swarm and single-agent runs, newest first. |
| `POST /api/glhf/runs` | Starts a run. Body: see `RunRequest` in `engine/src/glhf/types.ts`. |
| `GET /api/glhf/runs/:id` | One run with ledger, `FINDINGS.md` and `METHODS.md`. |
| `GET /api/glhf/scoreboard` | Scoreboard rows. |
| `GET /api/search?q=...` | Word search over all runs. Every word must appear. |
| `POST /api/ask` | A question about the runs, answered by a small model. See below. |
| `GET /api/status` | Drug board: scripted or live mode, keys present. |
| `GET /api/roster` | Drug board members. |
| `GET /api/briefs` | Drug board briefs. |
| `GET /api/runs`, `POST /api/runs` | Drug board runs: list, start. |
| `POST /api/runs/:id/resume` | Continue a drug board run. |
| `GET /api/runs/:id/events` | Drug board run events (server-sent events). |
| `GET /api/runs/:id/memo` | The memo of a drug board run (Markdown). |

## Ask and search

The dashboard's Experiments view has two tools.

- **Search** (`GET /api/search`): finds runs that contain every word of the query.
- **Ask** (`POST /api/ask`): a small model (`claude-haiku-5-5`; change with `ASK_MODEL`) reads a
  summary of the newest runs and answers. It names the runs it used. It needs
  `ANTHROPIC_API_KEY`. Without the key, or on an error, the answer is a word search and says so.
  At most 20 questions per minute.

An Ask answer can be wrong. Open the runs it names to check.
