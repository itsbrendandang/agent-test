# Running GLHF

All commands run from the repository root. Words such as swarm, single agent, phase and demo
case are defined in the [README](../README.md#words-used-in-these-documents).

## npm scripts

| Command | What it does |
|---|---|
| `npm run setup` | Installs the engine, the dashboard and the benchmark harness (`uv sync --locked`). |
| `npm run doctor` | Checks tools and keys on this machine. It prints only "set" or "not set" for a key. It also says if paid calls are on or off. |
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
| `npm test` | Harness tests, type checks, engine tests. Not the tests of `glhf/bixbench_v1/`. |
| `npm run docker` | Same as `docker compose up --build`. |

## Run tracker CLI

```bash
npm run glhf -- doctor [--cellranger DIR]
npm run glhf -- demo [--solver single|glhf]
npm run glhf -- run --mode local|cloud --solver single|glhf --model MODEL [flags]
npm run glhf -- run --help
npm run glhf -- list
npm run glhf -- show <run-id>
npm run glhf -- cancel <run-id>
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
| `cancel <run-id>` | Stops a local run and marks it cancelled. See [Run control](#run-control). |
| `resume` | Continues to track unfinished runs when the engine is not running. |
| `scoreboard` | Single agent and swarm side by side. See [reading-results.md](reading-results.md). |

If the engine is running, the CLI sends the request to the engine. If not, the CLI process
tracks the run itself. Only one process can track runs at a time (lock file
`glhf/runs/tracker.lock`).

### Phases of a run

| Phase | Meaning | Settled |
|---|---|---|
| `queued` | The run is recorded but not started. The second run of a pair stays here while it waits for the first. | no |
| `launching` | The runner or the sandbox is starting. | no |
| `running` | The agents are working. | no |
| `completing` | Cloud runs only: grades are collected and the machine is deleted. | no |
| `done` | Finished and graded. | yes |
| `failed` | Ended with an error, or went far past its time limit. | yes |
| `cancelled` | Stopped on request. It is not a result, and the scoreboard leaves it out. | yes |

A settled run does not change any more (`settled` in `engine/src/glhf/types.ts`).

### Flags of `run`

| Flag | Mode | Solver | Meaning |
|---|---|---|---|
| `--mode local\|cloud` | | | Where to run. Default `local`. |
| `--solver single\|glhf` | both | | Default `glhf`. |
| `--model MODEL` | both | both | An Inspect model id such as `anthropic/claude-sonnet-5-5`, or `mock` (local only). Required. Any model other than `mock` needs `NO_PAID_CALLS=0` (see [Paid calls](#paid-calls-no_paid_calls)). |
| `--role-model ROLE=MODEL` | both | swarm | A different model for one group of roles. Can be repeated. Not with `mock`. |
| `--review-rounds N` | both | swarm | Rounds of audit, critique and revise. 1 to 10. Default 3. |
| `--follow` | both | both | Wait until the run ends. |
| `--time-limit S` | local | both | Seconds for the whole run. 60 to 86,400. Default 1,800. |
| `--max-tokens N` | local | both | Token budget for the whole run. 1,000 to 500,000,000. **Required for a local run with a real model.** Optional with `mock`. |
| `--max-messages-per-role N` | local | swarm | Message limit per phase. 2 to 5,000. A model call with one tool call is two messages. |
| `--seed N` | local | both | Sent to model providers that support a seed. |
| `--exa` | local | swarm | Gives the roles the `search_docs` tool. Needs `EXA_API_KEY` and `NO_PAID_CALLS=0`. |
| `--memory` | local | swarm | Reads approved lessons from earlier runs and queues new lessons for a person to approve. See below. |
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
    --role-model critic=openai/gpt-5.5 --max-tokens 4000000 --follow
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
- **Money.** There is no dollar limit for swarm runs. Tokens are the budget. This is why the
  engine refuses a local run with a real model that has no `--max-tokens`
  (`checkRequest` in `engine/src/glhf/tracker.ts`).

### Documentation search (`--exa`)

`search_docs` searches a fixed list of 9 software documentation sites (`DOC_DOMAINS` in
`swarm/tools.py`). It does not search journals, preprint servers, code hosts, data
repositories, package indexes or forums and question-and-answer sites. The reason: an open
search could find the results of the study that the task asks to reproduce.

| Site | What is allowed |
|---|---|
| `bioconductor.org` | Only software package pages (`/packages/<release>/bioc/`), `/help/` and `/install`. Not its subdomains (for example the support forum). Not experiment-data packages, annotation data or workflows. |
| `readthedocs.io` | Only the tool manuals named in `READTHEDOCS_PROJECTS` in `swarm/tools.py` (for example `samtools`, `scanpy`, `pandas`). |
| `htslib.org` | All pages. |
| `support.10xgenomics.com` | All pages. |
| `nf-co.re` | All pages. |
| `training.galaxyproject.org` | All pages. |
| `hbctraining.github.io` | All pages. |
| `satijalab.org` | All pages. |
| `docs.python.org` | All pages. |

Rules in code (`swarm/tools.py`, `swarm/guards.py`):

| Rule | Detail |
|---|---|
| Identifier queries are refused | A query or objective with a DOI, an accession number (GEO, SRA, BioProject, ArrayExpress and similar), a PubMed id, or a name such as `zenodo`, `figshare` or `biorxiv` is refused. |
| The text is normalised first | Unusual characters, invisible characters, other dash characters, and spaces, hyphens or underscores inside an identifier (`GSE 12345`, `GSE12345_raw`) do not hide it. |
| The task's own DOI is refused | Also with spaces or `%2F` in place of the slash. |
| Each result is checked again | Against the list, the path rules above, and the task's network policy. A result that fails is dropped. |
| At most 20 searches per run | For all roles together. A search that fails after it was sent also counts. A refused query does not count. |
| Everything is recorded | Every query, refusal and dropped result is written to the ledger. |

The code can also refuse a query that repeats the paper's title or names an author. A BixBench3
case does not give the title or the authors, so this check is not active.

One risk remains: a tool's manual can quote a public dataset in an example.

The Critic and the Reporter do not get this tool.

Tested with automated tests (`tests/unit/test_glhf_memory_and_search.py`) and with live
searches. Not tested inside a run on a real BixBench3 task.

### Memory (`--memory`)

A person must approve each lesson before any later run sees it.

| File in `glhf/memory/` | Written by | Read by runs |
|---|---|---|
| `lessons.pending.md` | Runs with `--memory`. The file is created when the first lesson is queued. | Never. |
| `lessons.md` | A person, with the `approve` command. | Yes. |

What a run with `--memory` does:

1. At the start, it gives the approved lessons to every role.
2. At the end, the Reporter writes process lessons. Code cuts the text at 2,000 characters and
   drops lines that look like results.
3. The lines that pass are added to `lessons.pending.md`. They wait there. Nothing is sent to
   past.dev at this step.

Approve or reject lessons. Run these from `glhf/bixbench`:

```bash
uv run python -m bixbench3.inspect_harness.swarm.memory list
uv run python -m bixbench3.inspect_harness.swarm.memory approve 1 3
uv run python -m bixbench3.inspect_harness.swarm.memory reject 2
uv run python -m bixbench3.inspect_harness.swarm.memory approve-all
uv run python -m bixbench3.inspect_harness.swarm.memory reject-all
```

| Command or option | What it does |
|---|---|
| `list` | Shows each pending lesson with a number, its task and its context. |
| `approve N...` | Moves these lessons to `lessons.md`. With `PAST_API_KEY` set, also sends them to past.dev. |
| `reject N...` | Deletes these lessons. |
| `approve-all`, `reject-all` | The same for every pending lesson. |
| `--no-past` | Put it before the command. Approved lessons are not sent to past.dev. |
| `--dir FOLDER` | Put it before the command. Uses another memory folder. |

The numbers change after each `approve` or `reject`, so run `list` again first. A Python warning
about `sys.modules` may appear; ignore it.

Rules for reading lessons:

- A lesson from a run on task X is never shown to a later run on task X.
- A lesson is never shown to a run on a task in its "context". The context is the list of tasks
  whose lessons the writing run was shown. This stops a result from going from X to Y and back
  to X.
- With `PAST_API_KEY` set, the run asks past.dev for lessons first. The same two rules apply.
  If past.dev fails or returns nothing, the run uses `lessons.md`.
- Lessons are written before grading, so a lesson cannot hold a score.
- With `--model mock`, pending lessons go to the run folder (`glhf/runs/<run-id>/memory/`), not
  to `glhf/memory/`.

Full text, with the filter rules: [glhf/memory/README.md](../glhf/memory/README.md).

Tested with automated tests and with the scripted model. past.dev was tested against the live
API. Memory was not used in a run with a real model.

`--exa` and `--memory` give the swarm help that the single agent does not have. Say so when
you report a run that used them.

## Paid calls (`NO_PAID_CALLS`)

Code: `engine/src/paid.ts`. Tests: `engine/test/paid.test.ts` (the tests check that nothing
reaches the network).

The engine has one switch for everything that costs money. The switch is **on** (no paid
calls) unless the variable `NO_PAID_CALLS` is exactly `0`.

| Value of `NO_PAID_CALLS` | Paid calls |
|---|---|
| not set, empty, `1`, `true`, `off`, any other text | Refused. |
| `0` | Allowed. |

To allow paid calls, the person who pays writes `NO_PAID_CALLS=0` in `.env` and starts the
engine again. A variable in your shell wins over `.env`. The engine reads the variable when
it starts, so a change needs a restart (with Docker: stop and `docker compose up` again).

### What is refused while the switch is on

| Paid step | What happens | Code |
|---|---|---|
| A run with a real model (local or cloud), or with `--role-model` | Refused before anything starts. HTTP 400 with `field: "model"`. Only `mock` may run. | `checkRequest` in `engine/src/glhf/tracker.ts` |
| A cloud run | Refused. HTTP 400 with `field: "mode"`. | same |
| `--exa` (Exa documentation search in a run) | Refused. HTTP 400 with `field: "exa"`. | same |
| A paid run that was accepted earlier (a queued partner, or a run left by an engine that allowed paid calls) | Not launched. It ends as `failed` with `not launched: ...`. | `paidRun` in `engine/src/glhf/task.ts` |
| Ask (`POST /api/ask`) | No model call. The answer is the word search, and it says why. | `engine/src/ask.ts` |
| Drug board models | The board runs on scripted models, also when keys are set. A board run that was started with real models is not continued (HTTP 403 on resume). | `mockMode` in `engine/src/config.ts`, `refusePaidRun` in `engine/src/board.ts`, `engine/src/models.ts` |
| Drug board checkers: Jev, OpenAI, Claude Code | Refused before any call or process. | `engine/src/jev.ts`, `engine/src/checkers.ts` |
| Drug board Exa search | Refused before the request. | `engine/src/exa.ts` |

The CLI goes through the same checks: `npm run glhf -- run --model <real model> ...` prints
the refusal and ends with status 1.

### Keys are blanked in child processes

While the switch is on, every process that the engine starts (the local runner, `bixbench3`,
`uv`) gets an environment in which these keys are empty: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`OPENROUTER_API_KEY`, `EXA_API_KEY`, `PAST_API_KEY`, `HF_TOKEN`, `TINKER_API_KEY`. It also gets
`NO_PAID_CALLS=1` (`childEnv` in `engine/src/paid.ts`). So if something further down tries a
paid call by mistake, it has no key.

The keys are set to empty, not removed, because the Python runner would read a removed key
back from `.env`.

Effect on memory (`--memory`): `PAST_API_KEY` is empty in the run, so the run does not ask
past.dev. It reads the local file `glhf/memory/lessons.md`. A scripted run queues its lessons in
its own run folder, as before.

### How to see the state

| Where | What you see |
|---|---|
| `npm run doctor` | A line `Paid calls: OFF (NO_PAID_CALLS). ...` or `Paid calls: ON (NO_PAID_CALLS=0). ...`. When the tools and keys for cloud runs are present but the switch is on, doctor says that cloud runs are refused. |
| Start of the engine (`npm run engine`, or the Docker log) | The same line, as the second line of output. |
| `GET /api/glhf/status` | `paidCalls`: false while the switch is on. `models`: only `["mock"]` while the switch is on. |
| `GET /api/status` (drug board) | `paidCalls`: false while the switch is on. `mock`: true. |
| The dashboard's New run form | It lists only the scripted model, because it takes its list from `models`. |

### Turning the switch on while something is running

"Turning on" means: remove `NO_PAID_CALLS=0` and start the engine again. A local run goes on
by itself while the engine is down, so the engine deals with it at its next check.

| What is running | What happens |
|---|---|
| A local run with a real model or Exa | The engine stops the runner (SIGTERM, then SIGKILL) and marks the run `failed` with `stopped: ...`. Its queued partner is not launched. Tokens used before the stop are spent. |
| A cloud run that is still launching | The launcher is stopped and the run is marked `failed`. **A virtual machine may already exist and bill.** The error gives the command to check: `gcloud compute instances list --project <project>`. |
| A cloud run that is already on its virtual machine | **It is not stopped.** Its keys are on the machine and the engine does not delete a machine by itself. The run's detail says so and gives the command: `uv run bixbench3 cancel --run <cloud-run-id> --project <project>` (from `glhf/bixbench`). |
| A drug board run with real models | It stays paused. It is not continued while the switch is on. |

### Python commands that you run yourself

A Python command that you start yourself does not go through the engine.

| Commit | State |
|---|---|
| `05600b1` (the commit that added the switch) | **Not covered.** The Python code has no check for `NO_PAID_CALLS`. With keys in `.env` or in your shell, `uv run bixbench3 run ...` or `uv run bixbench-v1 run ...` can spend. |
| After it | A Python guard was added: `glhf/bixbench/src/bixbench3/paid.py` and `glhf/bixbench_v1/src/bixbench_v1/paid.py`. When this text was written the guard was new, not committed, and **had no automated tests**. Check that these two files exist in your clone (`git ls-files glhf/bixbench/src/bixbench3/paid.py`). If they do not, your clone is not covered. |

What the Python guard does, as read from the code (not tested by us):

| Command | While the switch is on |
|---|---|
| `uv run python -m bixbench3.glhf_local --model <real model> ...`, also with `--role-model` or `--exa` | Refused before anything is created (`refuse_run`). `--model mock` runs. |
| `uv run bixbench3 run ...`, `uv run bixbench3 setup-runtime ...` | Refused (a cloud launch on a billed machine). `--dry-run`, `status`, `complete` and `cancel` still work. |
| The `search_docs` tool inside a run | Refused before the key is read. |
| past.dev: recall in a run, and sending on `memory approve` | Not done. The run reads the local `lessons.md`. `approve` still moves the lesson to `lessons.md` and prints that nothing was sent. |
| `uv run bixbench-v1 run --model <real model> ...` and `bixbench-v1 grade` with the LLM judge | Refused. `--model mock`, `--no-judge`, `download`, `list`, `audit` and `report` work. |
| Provider keys | Set to empty in the Python process, the same seven keys as in the engine. |

The Python guard reads `NO_PAID_CALLS` from the environment first. If it is not set there, it
reads that one line from the nearest `.env` above the working folder, then from the
repository's `.env`. The rule is the same: on unless the value is exactly `0`.

### What is still not covered

| Case | Why |
|---|---|
| A clone or branch without the two `paid.py` files | The Python commands above are then not checked at all. |
| `inspect eval` on the task file, or a script that calls the cloud runner class, `run_capsule` or the judge class itself | These do not pass through the guarded entry points. |
| A key that is not in the list of seven | It is not blanked. |
| A cloud run that is already on its virtual machine | See the table above. Its keys are on the machine. |
| A coding agent (Pi, Claude Code) and its own model use | A separate program with its own account. |
| The desktop app's Settings view (it tests provider keys that you type in) | It does not go through the engine. |

So the switch protects against a mistake. It does not protect against a person or an agent
who works around it. The rule for that is in [AGENTS.md](../AGENTS.md): an agent never makes a
paid call and never sets `NO_PAID_CALLS=0`.

## Run control

Code: `engine/src/glhf/tracker.ts`, `task.ts`, `routes.ts`. Tests:
`engine/test/glhf-runs.test.ts`. These tests use a stand-in for the local runner (no Docker, no
model). Run control was not tested with a real model.

### One local run at a time

Local runs share this machine's CPU under a time limit. Two at the same time would make their
timing hard to compare. So the engine starts a local run only when no other local run is
queued or going.

| Case | What happens |
|---|---|
| You start a local run while another local run is not settled | Refused. HTTP 409 with `{"error": "...", "run": "<id of the run that is going>"}`. The CLI prints the message. |
| The queued second run of a pair | Not refused. It belongs to the pair. |
| Cloud runs | Not limited by this rule. Each has its own machine. |

Wait for the run to end, or cancel it.

### A matched pair (swarm and single agent)

One request can start both solvers. Send `solvers` in place of `solver` to
`POST /api/glhf/runs`:

```json
{"mode": "local", "model": "mock", "solvers": ["glhf", "single"], "timeLimit": 600, "seed": 7}
```

Answer (HTTP 201): `{"id": "<first run>", "ids": ["<first run>", "<second run>"]}`.

| Rule | Detail |
|---|---|
| Order | The runs go one after the other, in the order of `solvers`. |
| Same settings | Both get the same mode, task, case, model, time limit, token budget and seed. So the scoreboard pairs them. |
| Swarm-only settings | Role models, review rounds, message limit, Exa and memory go to the swarm run only. |
| The waiting run | It has the phase `queued`, the detail `waiting for <id> to finish`, and the field `after`. Both runs have the field `pairedWith`. |
| The clock | The time limit of the second run counts from its own start, not from the request. |
| The first run fails | The second run still starts. Its `note` says `started although <id> ... failed: ...`. |
| The first run is cancelled | The second run is cancelled too. It never starts. Its `note` says why. |
| Engine restart | The queue is stored in the run record and in the durable task. A queued run still starts after a restart. |
| Checks | Both requests are checked before either starts. A pair is never half refused. |
| Limits | A pair is for local runs only. `solvers` takes one or two different solvers. Do not send `solver` and `solvers` together. |

From the CLI:

```bash
npm run glhf -- run --mode local --solvers glhf,single --model mock --follow
```

`--solvers` takes one or two names with a comma between them. Do not give it together with
`--solver`. With `--follow`, the CLI follows each run of the pair in turn; the exit code is 0
only when every run ends as `done`.

### Cancel a run

```bash
npm run glhf -- cancel <run-id>
```

Or `POST /api/glhf/runs/<run-id>/cancel`. The answer is the run record.

| Case | What happens |
|---|---|
| Local run that is going | The record is marked `cancelled` first. Then the runner and the processes it started get SIGTERM. If they are still there after 5 seconds (`GLHF_CANCEL_GRACE_MS`), they get SIGKILL. The machine is free for the next run. |
| Queued run | It is marked `cancelled` and never starts. |
| A run with a queued partner behind it | The partner is cancelled too. Its `note` says `cancelled because <id>, the run it was queued behind, was cancelled`. |
| The queued partner only | Only the partner is cancelled. The first run goes on. |
| Run that is already settled | Returned unchanged (HTTP 200). Nothing behind it is touched. |
| Cloud run | Refused (HTTP 409, `{"error": "..."}`). A virtual machine may be billing, so you remove it yourself. The message gives the command: `uv run bixbench3 cancel --run <cloud-run-id> --project <project>`, run from `glhf/bixbench`. If the run has no cloud run id yet, the message says to stop its launcher (`launch.pid` in the run folder) and to check for a machine. |
| Unknown run id | HTTP 404. |

Notes:

- A cancelled run stays cancelled. A step that was half done cannot write `running` or
  `failed` over it.
- A cancelled run has no score. Tokens that it used before the cancel are spent.
- If the detail says the runner could not be stopped, look for a leftover process
  (`runner.pid` in the run folder) or container (`docker ps`).
- The cancel was tested with a stand-in runner. It was not tested with a real Docker sandbox,
  so check `docker ps` after you cancel a real run.
- Cancel needs no token. The dashboard page and callers on this machine may use it, like the
  other routes.

### Refusals

A refused request gets a JSON body with `error`. Some have one more field.

| Status | Body | When |
|---|---|---|
| 400 | `{"error", "field"?}` | The request is not valid, or it asks for a paid step while paid calls are off. `field` names the input that the refusal is about, when there is one: `timeLimit`, `maxTokens`, `seed`, `reviewRounds`, `maxMessagesPerRole`, `model`, `exa`, `memory`, `mode`, `caseDir` or `solver`. |
| 404 | `{"error"}` | No such run. |
| 409 | `{"error", "run"}` | A local run is still going. `run` is its id. |
| 409 | `{"error"}` | A cloud run cannot be cancelled from here. |
| 503 | `{"error"}` | Another process (a CLI command) holds the run tracker. Try again shortly. |

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
docker compose up --build                   # wait for the line "glhf tracker ready"
docker compose exec engine npm run demo     # second terminal; ends with "score 1.000"
docker compose exec engine npm run doctor
```

`docker compose exec` runs a command in the engine container that is already running.
`docker compose run --rm engine <command>` starts a new container for one command; use it when
the services are not running.

Tested on macOS on a new clone. Not tested on Linux or Windows. Windows needs WSL2.

| Service | Address | Notes |
|---|---|---|
| `engine` | `http://localhost:8787` | Published on `127.0.0.1` only. Reads `.env` if it exists. |
| `dashboard` | `http://localhost:5317` | Serves the built dashboard (`docker/serve.mjs`). |

- The repository is mounted into the container at the same path as on your machine. Run
  `docker compose` from the repository root.
- The engine container uses your machine's Docker (`/var/run/docker.sock`) to start the
  sandbox. This gives the container full control of Docker. Run only code you trust.
- The first start installs dependencies into Docker volumes. This takes some minutes.
- Both services use `init: true`. A small init process is process 1 in each container. It
  passes the stop signal of `docker compose down` to the engine, so the engine releases its run
  locks, and it cleans up processes that are left behind.
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

For every caller, a local run with a real model needs a token budget (`maxTokens`). And for
every caller, also with the token, paid runs are refused while `NO_PAID_CALLS` is not `0`.
This check comes first.

### Starting a run from the dashboard

The Swarm view has a **New run** button. It opens a form (`dashboard/src/swarm/NewRun.tsx`)
that starts a local run on the demo case.

| Field | Values | Notes |
|---|---|---|
| Who does the work | Swarm, Single agent, or Both | "Both" starts a matched pair: the same model, time limit, token budget and seed, one run after the other. |
| Model | `mock` (default, free), the models the engine offers (`models` in the status), or another model id | |
| Time limit | 1 to 1,440 minutes. Default 30. | |
| Token budget | 1,000 to 500,000,000 | Required for a real model, by the form and by the engine. Optional for `mock`. |
| Seed | optional | |
| Review rounds | 1 to 10. Default 3. | Swarm only. |
| Exa documentation search | off by default | Swarm only. Same as `--exa`. |
| Memory between runs | off by default | Swarm only. Same as `--memory`. |

Safety steps for a real model:

1. The form shows the note "This run costs money".
2. The form refuses to continue without a token budget. The engine has the same rule.
3. A second page, "Confirm a paid run", repeats the model, the number of runs, the time limit
   and the token budget.
4. The start button works only after you tick "I understand that this spends money on the
   model provider's account".

Other behaviour:

- The form warns when the engine has no key for an Anthropic or OpenAI model, and says that
  Exa search is off when the engine has no Exa key.
- If another local run is still going, the engine answers 409. The form shows the message and
  a link to that run.
- "Both" sends one request with `solvers: ["glhf", "single"]`. The swarm run goes first; the
  single-agent run is queued behind it.
- A live or queued run has a **Cancel run** button (`dashboard/src/swarm/CancelRun.tsx`). A
  dialog asks first, and says when a queued partner will be cancelled too.
- The engine checks every field again. If it refuses, the form shows the engine's message next
  to the input that the refusal names (`field`).

The form cannot start cloud runs, runs on another case (`--case`), per-role models
(`--role-model`) or a message limit (`--max-messages-per-role`). Use the CLI for these.

The form and the cancel dialog have no automated tests. Type checks only.

Drug board runs (`POST /api/runs`) are allowed from the dashboard page, with the token, or when
the board runs on scripted models.

## HTTP API

Engine routes (`engine/src/app.ts`, `engine/src/glhf/routes.ts`). `engine/src/server.ts` only
starts the server and listens; the request handler is in `app.ts`, so tests can call it.

| Method and path | Returns |
|---|---|
| `GET /api/glhf/status` | The record to beat, tools and keys present, limits and models. See the table below. |
| `GET /api/glhf/roles` | The nine roles: instructions and budget shares, read from the Python code. |
| `GET /api/glhf/runs` | Swarm and single-agent runs, newest first. |
| `POST /api/glhf/runs` | Starts a run, or a pair with `solvers`. Body: see `StartBody` and `RunRequest` in `engine/src/glhf/types.ts`. Answers 201 `{id, ids}`; `id` is the first run. See [Run control](#run-control). |
| `GET /api/glhf/runs/:id` | One run with ledger, `FINDINGS.md` and `METHODS.md`. |
| `POST /api/glhf/runs/:id/cancel` | Stops a local run and marks it cancelled. Answers the run record. |
| `GET /api/glhf/scoreboard` | Scoreboard rows. |
| `GET /api/search?q=...` | Word search over all runs. Every word must appear. |
| `POST /api/ask` | A question about the runs, answered by a small model. See below. |
| `GET /api/status` | Drug board: scripted or live mode (`mock`), `paidCalls`, keys present. |
| `GET /api/roster` | Drug board members. |
| `GET /api/briefs` | Drug board briefs. |
| `GET /api/runs`, `POST /api/runs` | Drug board runs: list, start. |
| `POST /api/runs/:id/resume` | Continue a drug board run. |
| `GET /api/runs/:id/events` | Drug board run events (server-sent events). |
| `GET /api/runs/:id/memo` | The memo of a drug board run (Markdown). |

Fields of `GET /api/glhf/status` (`statusBody` in `engine/src/glhf/doctor.ts`). The answer is
kept for 30 seconds.

| Field | Content |
|---|---|
| `record` | The BixBench3 record to beat (0.523). |
| `tools` | `docker`, `uv`, `gcloud`: true or false. |
| `keys` | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `HF_TOKEN`, `EXA_API_KEY`: true or false only. Never the key values. |
| `paidCalls` | False while the `NO_PAID_CALLS` switch is on (the default). True only with `NO_PAID_CALLS=0`. |
| `project` | The Google Cloud project selected in `gcloud`, or null. |
| `limits` | The smallest and largest value a request may ask for: `timeLimit` [60, 86400] seconds, `maxTokens` [1000, 500000000], `reviewRounds` [1, 10], `maxMessagesPerRole` [2, 5000], `seed` [1, 2147483647]. From `LIMITS` in `engine/src/glhf/types.ts`, the same numbers the engine enforces. |
| `models` | Model ids to offer in a form: `mock` first, then each of `anthropic/claude-sonnet-5-5`, `anthropic/claude-haiku-5-5` and `openai/gpt-5.5` whose key is set. While paid calls are off, only `mock`. With paid calls on, any other model id can still be sent. |

The dashboard's New run form reads `limits`, `models` and `keys` from this route.

## Ask and search

The dashboard's Experiments view has two tools.

- **Search** (`GET /api/search`): finds runs that contain every word of the query.
- **Ask** (`POST /api/ask`): a small model (`claude-haiku-5-5`; change with `ASK_MODEL`) reads a
  summary of the newest runs and answers. It names the runs it used. It needs
  `ANTHROPIC_API_KEY` and `NO_PAID_CALLS=0`. Without the key, with paid calls off, or on an
  error, the answer is a word search and says so.
  At most 20 questions per minute.

An Ask answer can be wrong. Open the runs it names to check.
