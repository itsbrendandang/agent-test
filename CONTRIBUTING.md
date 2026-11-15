# Contributing (for teammates)

Read [README.md](README.md) first. It defines the words used here.

## 1. Get the code

```bash
git clone https://github.com/itsbrendandang/agent-test.git
cd agent-test
```

The GitHub repository is named `agent-test`. Some older text calls the project `drug-board` or Drug Board; the product is now called AI Scientist Bot.
All these names mean this repository.

## Quick start with Docker only

Use this path if you do not want to install Node.js and uv. You need only Docker (running) and
no keys. Run the commands from the repository root.

| Step | Command | What you should see |
|---|---|---|
| 1 | `docker compose up --build` | After some minutes, the line `glhf tracker ready`. Leave this terminal open. |
| 2 | Open `http://localhost:5317` in a browser | The app. |
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

Use your own keys. Keys are never in the repository and are not shared between teammates.
`npm run preflight` checks them with the vendors for free.

**A key alone does not allow spending.** Paid calls are off until the person who pays turns them on:
with the Demo/Real switch in the app's Settings (it lasts until the engine restarts), or with the
line `NO_PAID_CALLS=0` in `.env` and a restart of the engine.

| Question | Answer |
|---|---|
| Who sets `NO_PAID_CALLS=0`? | Only the person who pays for the keys. Not a teammate on someone else's keys, and never a coding agent. |
| What works without it? | The scripted demo, runs with `--model mock`, the scripted drug board, the dashboard, all tests. |
| What is refused without it? | Real models, cloud runs, `--exa`, the drug board's real models and checkers. Ask answers by word search. |
| How do I see the state? | `npm run doctor` prints `Paid calls: OFF ...` or `Paid calls: ON ...`. The engine prints the same line when it starts. |
| Are Python commands covered? | Yes. `uv run bixbench3 run`, `python -m bixbench3.glhf_local` and `uv run bixbench-v1 run` refuse a real model, a cloud launch and Exa. `bixbench-v1 grade` needs `--no-judge`. |
| Where is the value read? | First your shell (an exported value wins), then `.env`. |
| What is not covered? | `inspect eval` on `inspect_harness/tasks.py`, and scripts that call `run_capsule`, `InspectJudge`, `GCPRunner` or `exa_docs` directly; credentials other than the seven named keys (Google, AWS, Azure, a saved Hugging Face login); a cloud run that is already on its virtual machine. |

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

Run this before every commit and after every pull:

```bash
npm run check
```

It takes about two minutes, never spends money, and prints one line per part (`ok` or `FAIL`):
merge-conflict markers, the two type checks, the engine tests and the dashboard tests.
`npm run check -- --fast` does only the first two (a few seconds). `npm run check -- --all` adds
the Python suites (several minutes).

`npm test` hangs today, because one engine test file (`app.test.ts`) does not exit. `npm run check`
runs each engine test file on its own with a time limit, so it always ends.

| Part | Command | In `npm run check` |
|---|---|---|
| Merge-conflict markers left in a file | `npm run check -- --fast` | yes |
| Type checks (engine and dashboard) | `npm run typecheck` | yes |
| Engine, all files | `npm run check` | yes |
| Engine, one file | `cd engine && PAID_SWITCH_LOCKED=1 node --test test/board-core.test.ts` | |
| Dashboard | `npm --prefix dashboard test` | yes |
| Harness (swarm, grader) | `cd glhf/bixbench && uv run pytest -q tests && uv run ruff check src tests` | with `--all` |
| BixBench v1 adapter | `cd glhf/bixbench_v1 && uv run pytest -q tests` | with `--all` |
| Datasets catalogue | `cd datasets && uv run --no-project --with pytest pytest -q` | with `--all` |

The current counts and the known failures are in [README.md](README.md#tests). `main` is not
fully green today; do not add to the failures. If `npm run check` shows a failure you did not
cause, say so in your commit message or to the team, and do not "fix" a test by deleting it.

Some tests start a Docker sandbox. They are skipped when Docker is not running.

### A working day

```bash
git pull                 # 1. get the team's changes
npm run setup            # 2. only if a package.json or uv.lock changed
npm start                # 3. start (or restart) the engine and the app; an engine left running across a pull can fail
npm run check -- --fast  # 4. your copy type-checks and has no half-finished merge
# ... work ...
npm run check            # 5. before you commit
git status --short       # 6. look at what will go in, then commit and push
```

Three things that have gone wrong here, and how to avoid them:

- **A merge committed with `<<<<<<<` markers in it.** After resolving a conflict, run
  `npm run check -- --fast`. It lists every file that still has markers.
- **The team list changed and the engine was not restarted.** The engine reads `board/config.yaml`
  and `board/agents/` when it starts. After a pull, restart it.
- **The scout was removed from the team list.** The scout is the only member that searches. Without
  it a review has no sources and no statement about the literature can be checked. If you change
  the `board:` list in `board/config.yaml`, keep the scout, and run the board tests
  (`cd engine && PAID_SWITCH_LOCKED=1 node --test test/board-real-run.test.ts test/board-direct.test.ts`).

### Tests and the paid-calls switch

A test that checks what happens when paid calls are allowed must set `NO_PAID_CALLS=0` inside
that test (pytest: `monkeypatch.setenv("NO_PAID_CALLS", "0")`) or at the top of that test file
(engine: `process.env.NO_PAID_CALLS = "0"`). It must use fakes and must not reach the network.
Do not depend on `.env` or on your shell: on a new clone the switch is on.

## 6. Add a run

A local run with a real model costs money (tokens). It needs `NO_PAID_CALLS=0` (section 3).
Start small.

```bash
# The swarm, then the single agent, with the same settings:
npm run glhf -- run --mode local --solver glhf   --model anthropic/claude-sonnet-5-5 --max-tokens 400000 --seed 7 --follow
npm run glhf -- run --mode local --solver single --model anthropic/claude-sonnet-5-5 --max-tokens 400000 --seed 7 --follow

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
shared skills in `.agents/skills/`, four agent profiles in `.pi/agents/` (reviewer, advisor,
docs-writer, dashboard-qa), and one package, `pi-agents` 0.40.1. This package is from a third
party ([github.com/mavam/pi-agents](https://github.com/mavam/pi-agents)), not from the authors
of Pi. It runs inside the agent with full access to your files and shell.

Whatever agent you use, hold it to the rules in `AGENTS.md`. The two that cost real money or
invalidate a result:

- An agent never makes a paid call and never sets `NO_PAID_CALLS=0`. Only the person who pays
  may. Paid calls are off unless `NO_PAID_CALLS` is exactly `0`, in the engine and in the
  Python command lines. The switch does not cover `inspect eval` or a script that calls the
  library functions directly, so the rule still matters.
- Never let an agent read benchmark answers: the bucket `gs://bixbench3-ground-truth` or the
  published results of a benchmark paper. That voids the run. The grader's code may be read,
  but it must not be changed.
