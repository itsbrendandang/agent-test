# Contributing (for teammates)

Read [README.md](README.md) first. It defines the words used here.

## 1. Get the code

```bash
git clone https://github.com/itsbrendandang/agent-test.git
cd agent-test
```

The GitHub repository is named `agent-test`. Some older text calls the project `drug-board`.
Both names mean this repository.

## Quick start with Docker only

Use this path if you do not want to install Node.js and uv. You need only Docker (running) and
no keys. Run the commands from the repository root.

| Step | Command | What you should see |
|---|---|---|
| 1 | `docker compose up --build` | After some minutes, the line `glhf tracker ready`. Leave this terminal open. |
| 2 | Open `http://localhost:5317` in a browser | The dashboard, Swarm view. |
| 3 | In a second terminal: `docker compose exec engine npm run demo` | A scripted swarm run. It ends with `score 1.000`. The run also appears in the dashboard. |
| 4 | `docker compose exec engine npm run doctor` | A list of what the container has and what is missing. |

| System | Status |
|---|---|
| macOS | Tested on a new clone. |
| Linux | Not tested. |
| Windows | Not tested. It needs WSL2: run Docker with the WSL2 backend and run the commands inside WSL2. |

Notes:

- The first build and start install dependencies. This takes some minutes.
- `score 1.000` shows that the code works. The demo uses the scripted model, so it says nothing
  about the science.
- Items that `doctor` marks `[cloud runs]` are needed only for cloud runs.
- Stop with Ctrl+C in the first terminal, or `docker compose down`.
- Do not run `npm run engine` on your machine at the same time.
- For real models, follow section 3 (Keys and `NO_PAID_CALLS=0`) and start the containers again.

The next section is the other path: tools installed on your machine.

## 2. Install

You need:

| Tool | Version | Check |
|---|---|---|
| Node.js | 24 or newer (the Docker image uses 26) | `node --version` |
| uv | any recent version | `uv --version` |
| Docker | running | `docker info` |

```bash
npm run setup
npm run doctor
```

`npm run doctor` lists what is missing and how to fix it. Items marked `[cloud runs]` are needed
only for cloud runs. You can ignore them for local work.

If you do not want to install Node.js and uv, use the Docker path above.

## 3. Keys

```bash
cp .env.example .env
```

Open `.env` and add the keys you have. You need no key for the scripted demo. The key list is in
[docs/configuration.md](docs/configuration.md).

**A key alone does not allow spending.** Paid calls are off until `.env` has the line
`NO_PAID_CALLS=0` and the engine is started again.

| Question | Answer |
|---|---|
| Who sets `NO_PAID_CALLS=0`? | Only the person who pays for the keys. Not a teammate on someone else's keys, and never a coding agent. |
| What works without it? | The scripted demo, runs with `--model mock`, the scripted drug board, the dashboard, all tests. |
| What is refused without it? | Real models, cloud runs, `--exa`, the drug board's real models and checkers. Ask answers by word search. |
| How do I see the state? | `npm run doctor` prints `Paid calls: OFF ...` or `Paid calls: ON ...`. The engine prints the same line when it starts. |
| What is not covered? | At commit `05600b1`: Python commands that you run yourself, for example `uv run bixbench3 run ...` or `uv run bixbench-v1 run ...`. They do not go through the engine. A Python guard was added after that commit, but it has no automated tests yet. Treat these commands as able to spend. |

When you finish paid work, remove the line (or set `NO_PAID_CALLS=1`) and start the engine
again. Details: [docs/running.md](docs/running.md#paid-calls-no_paid_calls).

## 4. Check that it works

```bash
npm run demo
```

This runs the swarm on the demo case with the scripted model. It takes about 15 seconds and
ends with `score 1.000`. That score shows the code works. It says nothing about the science.

To see it in the browser, use two terminals:

```bash
npm run engine      # terminal 1
npm run dashboard   # terminal 2, then open http://localhost:5317
```

## 5. Run the tests

Run this before every commit:

```bash
npm test
```

| Part | Command | Tests |
|---|---|---|
| Everything below except the adapter | `npm test` | |
| Harness (swarm, grader) | `cd glhf/bixbench && uv run pytest -q tests && uv run ruff check src tests` | 359 |
| Engine | `npm run test:engine` | 159 with all test files (142 pass, 1 skipped, 16 marked "todo" for known problems). 86 in the committed files at commit `77f7b75`. |
| Type checks (engine and dashboard) | `npm run typecheck` | |
| BixBench v1 adapter (not part of `npm test`) | `cd glhf/bixbench_v1 && uv run pytest -q tests` | 102 |

Some tests start a Docker sandbox. They are skipped when Docker is not running. The dashboard
has no automated tests.

## 6. Add a run

A local run with a real model costs money (tokens). It needs `NO_PAID_CALLS=0` (section 3).
Start small.

```bash
# The swarm, then the single agent, with the same settings:
npm run glhf -- run --mode local --solver glhf   --model anthropic/claude-sonnet-5-5 --max-tokens 4000000 --seed 7 --follow
npm run glhf -- run --mode local --solver single --model anthropic/claude-sonnet-5-5 --max-tokens 4000000 --seed 7 --follow

npm run glhf -- list
npm run glhf -- show <run-id>
npm run scoreboard
```

- The scoreboard compares two runs only when task, case, model, mode (local or cloud), effort,
  time limit and token budget are the same. Use the same values for both solvers.
- You can also start a local run on the demo case from the dashboard (Swarm view, **New run**).
  "Both, to compare" starts a swarm run and a single-agent run with the same settings.
- Each run is saved in `glhf/runs/<run-id>/`. This folder is not in git. To share a result, send
  the output of `npm run glhf -- show <run-id>` or the file `run.json`.
- All flags: [docs/running.md](docs/running.md). How to read the output:
  [docs/reading-results.md](docs/reading-results.md).

**Do not start a cloud run (`--mode cloud`) unless the team agrees.** It creates a billed
32-core virtual machine.

For the public BixBench dataset, see [glhf/bixbench_v1/README.md](glhf/bixbench_v1/README.md).
The adapter is built. A pilot ran on 3 capsules (8 questions). The full run of 205 questions is
not done; it costs money, so agree with the team first.

### Lessons from runs with `--memory`

A run with `--memory` does not change what later runs see. It only adds lessons to
`glhf/memory/lessons.pending.md`. A person must approve each lesson:

```bash
cd glhf/bixbench
uv run python -m bixbench3.inspect_harness.swarm.memory list
uv run python -m bixbench3.inspect_harness.swarm.memory approve 1 3
uv run python -m bixbench3.inspect_harness.swarm.memory reject 2
```

Approve a lesson only if it is about process. Rules: [glhf/memory/README.md](glhf/memory/README.md).

## 7. Do not commit

| Never commit | Why | Protected by |
|---|---|---|
| `.env` or any key | Keys are secret. | `.gitignore` (`.env`, `.env.*`) |
| Run folders: `glhf/runs/`, `glhf/bixbench/runs/`, `glhf/bixbench_v1/runs/`, `board/runs/` | Large, and local to your machine. | `.gitignore` |
| Benchmark data (`glhf/data/`, downloaded datasets, data capsules) | Large. Some data has access rules. | `.gitignore` (`glhf/data/`) |
| Benchmark answers: anything from `gs://bixbench3-ground-truth`, or published results of a benchmark paper | It would put the answers next to the solver. | Team rule. Do not download them at all. |
| Results, scores or answers inside `glhf/memory/lessons.md` or `lessons.pending.md` | Approved lessons are shown to later runs. They hold process lessons only. | A person approves each lesson. A code filter is the second check. |
| `node_modules/`, `.venv/`, `dist/`, `*.sqlite` | Built or local files. | `.gitignore` |

Before you commit, look at what will go in:

```bash
git status --short
git diff --cached --stat
```

## 8. Rules for changes

- Do not change the grader (`glhf/bixbench/src/bixbench3/grading/`) or the upstream single-agent
  solver (`glhf/bixbench/src/bixbench3/inspect_harness/solvers.py`).
- Verdicts are computed in `swarm/ledger.py`. Do not let a model decide a verdict.
- Do not approve a lesson for a teammate without reading it. Do not write to
  `glhf/memory/lessons.md` from code; only the `approve` command does that.
- Do not add a journal, a preprint server, a code host, a data repository, a package index or a
  forum to `DOC_DOMAINS` in `swarm/tools.py`.
- When you write about a result, say what was run: which case, which model, scripted or real,
  how many runs. See [docs/status.md](docs/status.md).
- If you use a coding agent, it reads [AGENTS.md](AGENTS.md). The same rules are there.

## 9. Writing style for documents

- Short sentences. Plain words. No idioms.
- Define a word once (README, "Words used in these documents") and use the same word everywhere.
- Use tables for flags and keys. Put commands in code blocks.
- Check that each command and path you write exists.

## 10. Coding agents (optional)

This project was built with [Pi](https://pi.dev), an agent harness. You do not need it. If you
want it, [docs/pi-setup.md](docs/pi-setup.md) has the install and what the repository configures for it:
shared skills in `.agents/skills/`, and four agent profiles in `.pi/agents/` (reviewer,
advisor, docs-writer, dashboard-qa).

Whatever agent you use, hold it to the rules in `AGENTS.md`. The two that cost real money or
invalidate a result:

- An agent never makes a paid call and never sets `NO_PAID_CALLS=0`. Only the person who pays
  may. The engine refuses paid calls by default, but it cannot stop an agent that runs a paid
  Python command directly, so the rule still matters.
- Never let an agent read benchmark answers: the bucket `gs://bixbench3-ground-truth` or the
  published results of a benchmark paper. That voids the run. The grader's code may be read,
  but it must not be changed.
