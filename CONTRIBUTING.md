# Contributing (for teammates)

Read [README.md](README.md) first. It defines the words used here.

## 1. Get the code

```bash
git clone https://github.com/itsbrendandang/agent-test.git
cd agent-test
```

The GitHub repository is named `agent-test`. Some older text calls the project `drug-board`.
Both names mean this repository.

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

If you do not want to install Node.js and uv, use Docker only:

```bash
docker compose up --build
```

## 3. Keys

```bash
cp .env.example .env
```

Open `.env` and add the keys you have. You need no key for the scripted demo. The key list is in
[docs/configuration.md](docs/configuration.md).

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

Harness only (faster when you changed only Python):

```bash
cd glhf/bixbench && uv run pytest -q tests && uv run ruff check src tests
```

## 6. Add a run

A local run with a real model costs money (tokens). Start small.

```bash
# The swarm, then the single agent, with the same settings:
npm run glhf -- run --mode local --solver glhf   --model anthropic/claude-sonnet-5-5 --max-tokens 4000000 --seed 7 --follow
npm run glhf -- run --mode local --solver single --model anthropic/claude-sonnet-5-5 --max-tokens 4000000 --seed 7 --follow

npm run glhf -- list
npm run glhf -- show <run-id>
npm run scoreboard
```

- The scoreboard compares two runs only when task, model, time limit and token budget are the
  same. Use the same values for both solvers.
- Each run is saved in `glhf/runs/<run-id>/`. This folder is not in git. To share a result, send
  the output of `npm run glhf -- show <run-id>` or the file `run.json`.
- All flags: [docs/running.md](docs/running.md). How to read the output:
  [docs/reading-results.md](docs/reading-results.md).

**Do not start a cloud run (`--mode cloud`) unless the team agrees.** It creates a billed
32-core virtual machine.

For the public BixBench dataset, see [glhf/bixbench_v1/README.md](glhf/bixbench_v1/README.md)
(in progress).

## 7. Do not commit

| Never commit | Why | Protected by |
|---|---|---|
| `.env` or any key | Keys are secret. | `.gitignore` (`.env`, `.env.*`) |
| Run folders: `glhf/runs/`, `glhf/bixbench/runs/`, `glhf/bixbench_v1/runs/`, `board/runs/` | Large, and local to your machine. | `.gitignore` |
| Benchmark data (`glhf/data/`, downloaded datasets, data capsules) | Large. Some data has access rules. | `.gitignore` (`glhf/data/`) |
| Benchmark answers: anything from `gs://bixbench3-ground-truth`, or published results of a benchmark paper | It would put the answers next to the solver. | Team rule. Do not download them at all. |
| Results, scores or answers inside `glhf/memory/lessons.md` | This file is shown to later runs. It holds process lessons only. | Code filter and team rule |
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
- Do not add a journal, a preprint server or a data repository to `DOC_DOMAINS` in
  `swarm/tools.py`.
- When you write about a result, say what was run: which case, which model, scripted or real,
  how many runs. See [docs/status.md](docs/status.md).
- If you use a coding agent, it reads [AGENTS.md](AGENTS.md). The same rules are there.

## 9. Writing style for documents

- Short sentences. Plain words. No idioms.
- Define a word once (README, "Words used in these documents") and use the same word everywhere.
- Use tables for flags and keys. Put commands in code blocks.
- Check that each command and path you write exists.
