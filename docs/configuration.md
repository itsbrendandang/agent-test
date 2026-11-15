# Configuration

## Keys (`.env`)

Copy `.env.example` to `.env` and fill in the keys you have. `.env` is not in git. Never commit,
print or log a key.

Format rules (`engine/src/env.ts`): one `KEY=value` per line. Put comments on their own lines.
A variable that is already set in your shell wins over `.env`.

| Key | Used for | Needed |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude models as swarm agents. Also the Ask box in the dashboard. On the drug board: the `lead`, `strong` and `cheap` tiers. | For runs with Claude models, and for a live drug board. |
| `OPENAI_API_KEY` | OpenAI models as swarm agents. The benchmark's judge and network gate (cloud runs). On the drug board: the `rival` tier, the first-pass checker for claims made by a Claude member, and the literature checker. | For every cloud run, and for a live drug board. |
| `HF_TOKEN` | Access to the dataset `EdisonScientific/BixBench3` on Hugging Face. | For cloud runs. |
| `EXA_API_KEY` | Exa search: the swarm's `--exa`, and the drug board's search for any member that has the `exa_search` tool (the scout). | For `--exa`, and for a live board run (the scout searches). |
| `PAST_API_KEY` | past.dev memory for the swarm (`--memory`). Approved lessons are sent there when a person runs the `approve` command, and runs ask past.dev for lessons first. While paid calls are off, a run started by the engine does not get this key and reads the local file. | Optional. Without it, runs read the approved file `glhf/memory/lessons.md`. |

No key is needed for `npm run demo` or for a scripted drug board run. A **live** drug board run needs the key of every tier in `board/config.yaml` (Anthropic and OpenAI today). If one is missing, the run is refused when it starts, with the tier and the key named (HTTP 503 from `POST /api/runs`). It is never silently run with scripted models.

## Paid calls: `NO_PAID_CALLS` and the runtime switch

The engine starts with the state `NO_PAID_CALLS` gives. The dashboard's paid switch (`POST /api/paid`, `engine/src/paid/paidswitch.ts`) can change it **for the running process only**: it is kept in memory, never written to `.env`, and a restart or crash goes back to the `.env` value. To turn it on the request needs the session token, `{"on": true, "confirm": "I will be charged"}` exactly, a JSON body, the usual Origin and Host checks, and every key the board's roster needs (else 409 naming them). Turning it off needs the token. Each attempt that passes the token check is appended to `board/runs/.paid-switch-audit.jsonl` (time, direction, origin; never the token). `PAID_SWITCH_LOCKED=1` refuses all changes. A board run keeps the mode it started in. Turning paid calls off stops new paid calls at the next call of a running board run, and asks the tracker to stop local GLHF runs that can spend; it cannot stop a cloud run's VM. `GET /api/paid` shows the state.


A key alone does not allow spending. The engine refuses every paid step unless this variable
is exactly `0`.

| Variable | Default | Meaning | Code |
|---|---|---|---|
| `NO_PAID_CALLS` | not set, which means **no paid calls** | `0` allows paid calls: real models, cloud runs, Exa, the drug board's models and checkers, the model behind Ask. Any other value, or no value, refuses them. Only the person who pays sets it. The engine reads it at start. | `engine/src/paid/paid.ts` (the only place that reads it) |

`.env.example` has the line as a comment (`# NO_PAID_CALLS=0`), so a copy of that file keeps
paid calls off.

While paid calls are off, the engine gives these keys as empty values to every process it
starts: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `EXA_API_KEY`,
`PAST_API_KEY`, `HF_TOKEN`, `TINKER_API_KEY`.

The switch covers the engine, the dashboard, the `npm run glhf` and `npm run board` CLIs, and
the Python command lines (`bixbench3`, `python -m bixbench3.glhf_local`, `bixbench-v1`).

Where the value comes from, in this order. The first place that has a value decides:

| Order | Place |
|---|---|
| 1 | The process environment. An exported value wins over `.env`. |
| 2 | The nearest `.env` above the working folder (Python commands). |
| 3 | The repository's `.env`. |

Not covered: `inspect eval` on `inspect_harness/tasks.py`; scripts that call `run_capsule`,
`InspectJudge`, `GCPRunner` or `exa_docs` directly; credentials other than the seven keys above
(Google, AWS, Azure, a saved Hugging Face login); a cloud run that is already on its virtual
machine. Full text: [running.md](running.md#what-is-not-covered).

## Ports

| Port | Service | Change with |
|---|---|---|
| 8787 | Engine | `DRUG_BOARD_PORT` (on your machine), `GLHF_ENGINE_PORT` (Docker Compose, published port) |
| 5317 | Dashboard | `GLHF_DASHBOARD_PORT` (Docker Compose, published port). The development server port is fixed in `dashboard/vite.config.ts`. |

Both listen on `127.0.0.1` only.

## Environment variables

Set these in `.env` or in your shell. All are optional.

### Engine

| Variable | Default | Meaning | Code |
|---|---|---|---|
| `DRUG_BOARD_PORT` | `8787` | Engine port. The CLI also uses it to find the engine. | `engine/src/server.ts`, `engine/src/glhf/cli.ts` |
| `HOST` | `127.0.0.1` | Address the engine listens on. Docker Compose sets `0.0.0.0` inside the container. | `bindHost` in `engine/src/app.ts` |
| `DASHBOARD_ORIGINS` | none | Extra origins that may call the engine, separated by commas. The defaults are `localhost` and `127.0.0.1` on port 5317. | `engine/src/http.ts` |
| `ENGINE_HOSTS` | none | Extra host names the engine answers to, separated by commas. The defaults are `localhost`, `127.0.0.1`, `[::1]`. | `engine/src/http.ts` |
| `ASK_MODEL` | `claude-haiku-5-5` | Model for the Ask box. | `engine/src/search/ask.ts` |
| `DRUG_BOARD_MOCK` | not set | `1` forces scripted models for the drug board, also when keys are set. The board is also scripted while paid calls are off (`NO_PAID_CALLS`). A missing key does **not** make it scripted: with paid calls on, the run is refused instead. | `mockMode` in `engine/src/config.ts` |
| `PAID_SWITCH_LOCKED` | not set | `1` locks the engine's runtime paid switch: `POST /api/paid` answers 403 and `GET /api/paid` reports `locked: true`. `npm test`, CI and every `node --test` process are locked by default (`PAID_SWITCH_LOCKED=0` opens it, for the switch's own tests). | `paidSwitchLocked` in `engine/src/paid/paid.ts` |
| `DRUG_BOARD_MOCK_TPS` | `400` | Speed of the scripted board models, in tokens per second. | `engine/src/models.ts` |

### Run tracker

| Variable | Default | Meaning |
|---|---|---|
| `GLHF_LOCAL_POLL_MS` | `2000` | Time between checks of a local run. |
| `GLHF_LOCAL_MARGIN_MS` | 30 minutes, or a quarter of the time limit if that is more | Time a local run may go past its limit before the tracker stops it and marks it failed. |
| `GLHF_LAUNCH_POLL_MS` | `5000` | Time between checks while a cloud run is launching. |
| `GLHF_LAUNCH_TIMEOUT_MS` | 2 hours | Time `bixbench3 run` may take to launch. After this the launch counts as stuck. |
| `GLHF_CLOUD_POLL_MS` | 5 minutes | Time between status checks of a cloud run. |
| `GLHF_BIXBENCH3_CMD` | `uv run bixbench3` | The command for cloud runs. Tests can replace it. |
| `GLHF_BIXBENCH3_RUNS` | `glhf/bixbench/runs` | Where the cloud runner writes run manifests. |
| `GLHF_LOCAL_CMD` | `uv run python -m bixbench3.glhf_local` | The command for local runs. The arguments stay the same. Tests replace it with a stand-in script. |
| `GLHF_CANCEL_GRACE_MS` | `5000` | On cancel, the time between SIGTERM and SIGKILL for the runner and the processes it started. |
| `GLHF_RUNS_DIR` | `glhf/runs` | Folder for run folders, the tracker's database (`tracker.sqlite`), the tracker lock and the token file. Tests use a temporary folder, so they do not touch real runs. Read in `engine/src/glhf/store.ts`. |

All others are read in `engine/src/glhf/task.ts`.

If you set `GLHF_RUNS_DIR`, set it for the engine and for the CLI. The CLI reads the token
and the run records from the same folder.

### BixBench v1

| Variable | Default | Meaning | Code |
|---|---|---|---|
| `BIXV1_RUNS_DIR` | `glhf/bixbench_v1/runs` | Where the results API looks for the adapter's run folders. Tests use a fixture folder. | `engine/src/bixv1/store.ts` |
| `BIXV1_STALL_MARGIN_SECONDS` | `600` | Quiet time beyond a capsule run's time limit after which a "running" capsule run is reported as "stalled". | `engine/src/bixv1/store.ts` |
| `BIXV1_QUESTIONS_FILE` | `glhf/data/bixbench_v1/hub/BixBench.jsonl` | The dataset's question file. The results API opens it only for a `?ideal=1` request. | `engine/src/bixv1/store.ts` |
| `BIXBENCH_V1_SWARM_BUDGET` | `equal` | Token budget of the adapter's swarm. `equal`: the same total as the single agent. `extended`: 2.25 times that; read the result as "more budget". Read by the Python adapter, not by the engine. There is no command-line option for it. | `glhf/bixbench_v1/src/bixbench_v1/solvers.py` |

### Sandbox and Docker

| Variable | Default | Meaning | File |
|---|---|---|---|
| `GLHF_LOCAL_IMAGE` | `python:3.12-slim` | Image of the local sandbox. | `glhf/bixbench/sandbox/local-compose.yaml` |
| `GLHF_ENGINE_PORT` | `8787` | Published engine port. | `docker-compose.yml` |
| `GLHF_DASHBOARD_PORT` | `5317` | Published dashboard port. | `docker-compose.yml` |
| `VITE_ENGINE_URL` | `http://localhost:8787` | Engine address built into the dashboard. | `Dockerfile`, `dashboard/src/board/api.ts` |
| `PORT`, `DASHBOARD_DIR` | `5317`, `/srv/dashboard` | Used by the dashboard container only. | `docker/serve.mjs` |

The local sandbox has no network and holds only Python 3.12. It has no bioinformatics tools.
It is enough for the demo case. Real BixBench3 tasks need the benchmark's runtime image.

## Drug board: `board/config.yaml`

| Key | Value in the file | Meaning |
|---|---|---|
| `meeting.max_minutes` | 15 | Time for one run. After this the lead is told to finish. |
| `meeting.max_usd` | 5 | Spend limit for one run, all agents and checkers together. |
| `meeting.max_rounds` | 4 | Rounds before final positions are forced. |
| `meeting.daily_usd` | 20 | Limit for all runs started today. Past it, starts and resumes are refused. |
| `meeting.lead_turns` | 20 | Model calls the lead may make in one run. |
| `meeting.member_turns` | 6 | Model calls each member may make per question. |
| `meeting.max_escalations` | 12 | OpenAI and Claude Code checks per run. |
| `meeting.fallback_usd_per_mtok` | 15 | Price per million tokens that is assumed when a model reports tokens but no cost. The run is then marked as cost-estimated. |
| `memory.enabled` | true | After a run, add each member's verified and contradicted claims to `board/expertise/<member>.md`. Scripted runs write to the run folder, not to `board/expertise/`. |
| `memory.max_notes` | 40 | Newest notes kept per member. |
| `watch.enabled`, `watch.every_hours` | false, 24 | **Not implemented.** No code uses these keys yet. |
| `brief.required_sections` | 8 section names | A brief without one of these sections is rejected. |
| `paths.*` | folders under `board/` | Where agents, briefs, context, expertise and runs are. |
| `models.lead`, `models.strong`, `models.cheap`, `models.rival` | `anthropic/claude-sonnet-5-5`, `anthropic/claude-sonnet-5-5`, `anthropic/claude-haiku-5-5`, `openai/gpt-5-mini` | Model for each tier, as `<vendor>/<model>` (only `anthropic` and `openai`). `rival` must be on a different vendor from `lead`. Called directly, not through a gateway. Prices come from the catalog that ships with `@earendil-works/pi-ai`; they were not checked against the vendors' price pages. |
| `checkers.first_pass.alt` | `openai/gpt-4o-mini` | The cheap model of the other vendor. The first pass of a claim uses `models.cheap`, or this one when `cheap` is on the claim author's vendor, so the checker is never from the author's vendor. |
| `checkers.first_pass.max_source_chars` | 12000 | Source text sent to the first pass per check. |
| `meeting.max_searches` | 20 | Exa searches per run. |
| `meeting.exa_usd_per_search` | 0.007 | Assumed price of one search, used until Exa's response states a cost. Measured once (two searches). |
| `meeting.exa_ceiling_usd` | 40 | Lifetime Exa spend the engine allows, summed from `board/runs/.exa-ledger.jsonl`. The Exa account holds $50 and is not topped up. At the ceiling a live run refuses to search; it does not use fixture papers. |
| `checkers.escalate.literature`, `checkers.escalate.computed` | `openai`, `claude-code` | Second checker for each kind of claim. |
| `checkers.openai_model` | `gpt-5-mini` | Model for the OpenAI checker. |
| `checkers.claude_code_cmd` | `claude -p --output-format json --restricted --strict-mcp-config` | Command for the Claude Code checker. `--restricted` removes the tools that run commands or code and the web fetch tool, keeps file tools inside the working folder, and ignores user and project settings. `--strict-mcp-config` loads no MCP servers. So by default the checker **cannot run code**: it checks a computed claim by reasoning, and answers "unsupported" when that is not enough. |
| `checkers.claude_code_tools` | `Read Write` | Tools the checker may use without asking. It runs in an empty temporary folder. Its environment holds only a fixed list of variables (`CHILD_ENV` in `engine/src/board/checkers.ts`), so other providers' keys are not passed. |
| `checkers.timeout_seconds` | 180 | Time limit for one second check. A check that times out records the claim as unsupported. |
| (warning for the two keys above) | | The checker is not in a container. It runs as your user. If you remove `--restricted` or add `Bash(python3:*)` to the tools, code that it writes can read any file you can read (also `.env`) and use the network. Do that only inside a container. The `--restricted` mode was not tested with a live call. |
| `board` | 8 member names | Members and their speaking order. Remove a line to leave a member out. |
