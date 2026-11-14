# Notes for coding agents (Pi, Claude Code, Codex and others)

This repository holds GLHF, a nine-role solver (the swarm) for the BixBench3 benchmark, and a
drug candidate board that shares its engine and dashboard. Read `README.md` first. Reference
documents are in `docs/`.

## Commands

- `npm run setup`: install everything. `npm run doctor`: what is missing on this machine.
- `npm run demo`: scripted swarm run on the demo case (needs Docker, no keys). It is free.
- `npm test`: harness tests, type checks and engine tests. Run it before committing. It does
  not run the adapter tests: `cd glhf/bixbench_v1 && uv run pytest -q tests`.
- `npm run engine` (port 8787) and `npm run dashboard` (port 5317).
- Harness only: `cd glhf/bixbench && uv run pytest -q tests && uv run ruff check src tests`.
- Engine only: `npm run test:engine`. Type checks only: `npm run typecheck`.
- Lessons that wait for approval (run from `glhf/bixbench`):
  `uv run python -m bixbench3.inspect_harness.swarm.memory list`.

## Rules

- **Paid calls.** An agent never makes a paid call and never sets `NO_PAID_CALLS=0`. Only the
  person who pays may. If a task needs a paid call, stop and ask that person to run it.
  - A paid call is: a run with a real model (any `--model` other than `mock`), a cloud run
    (`--mode cloud`, `bixbench3 run`, `bixbench3 setup-runtime`; it creates a billed 32-core
    virtual machine), Exa search (`--exa`, the board's search), the drug board with real
    models or its checkers, the model behind Ask, a BixBench v1 run with a real model
    (`bixbench-v1 run`), and sending lessons to past.dev.
  - The engine refuses these while `NO_PAID_CALLS` is not exactly `0` (`engine/src/paid.ts`).
    Do not edit `.env`, do not export the variable, and do not change or go around `paid.ts`.
  - Do not rely on the switch for a Python command that you run directly (`uv run bixbench3
    ...`, `uv run bixbench-v1 run ...`, `python -m bixbench3.glhf_local ...`). The engine's
    switch does not see these. The Python guard (`glhf/bixbench/src/bixbench3/paid.py`) is new
    and has no tests yet. The rule covers them: use `--model mock` only.
  - New code that can spend must call `refusePaid()` from `engine/src/paid.ts` (Python:
    `refuse_paid()` from `bixbench3/paid.py`) right before the paid step. The engine must
    start child processes with `childEnv()`.
- Never read, download or reference `gs://bixbench3-ground-truth` or any published result of a
  benchmark paper while working on a solver, a prompt or a run. It holds the answers.
- Benchmark agents get no open web search. The optional `search_docs` tool (`--exa`) is limited
  to the documentation allow-list `DOC_DOMAINS` (9 sites) in
  `glhf/bixbench/src/bixbench3/inspect_harness/swarm/tools.py`. Never add a journal, a preprint
  server, a code host, a data repository, a package index or a forum to it. Do not loosen the
  path rules (`_PATH_RULES`), the project list (`READTHEDOCS_PROJECTS`), the search limit
  (`MAX_SEARCHES`) or the identifier checks in `swarm/guards.py`.
- Memory: a run with `--memory` only queues lessons in `glhf/memory/lessons.pending.md`. Only a
  person approves them into `glhf/memory/lessons.md`, the file later runs read. As a coding
  agent, never run `approve` or `approve-all` and never write to `lessons.md` yourself. Both files hold process lessons only: no results, scores or answers.
  Do not weaken the filter in `swarm/memory.py`. See `glhf/memory/README.md`.
- Keys live in `.env` (not in git). Never print, log or commit a key. Never print `.env`.
- Do not commit run folders (`glhf/runs/`, `glhf/bixbench/runs/`, `glhf/bixbench_v1/runs/`,
  `board/runs/`) or benchmark data (`glhf/data/`).
- Do not change scoring: `glhf/bixbench/src/bixbench3/grading/**` and the upstream single-agent
  solver (`inspect_harness/solvers.py`) stay as upstream. Our code is under
  `inspect_harness/swarm/` and `glhf_local.py`. We also changed `inspect_harness/tasks.py` and
  `cli.py` to select the solver.
- Verdicts on claims are computed in `swarm/ledger.py`. Do not let a model decide a verdict.
  The rules: tests are registered before any result, the e-values of a claim are combined by
  their arithmetic mean (not the product), and a registered test with no result blocks support.
  Do not remove the registration step. If you change a rule or a constant there (`ALPHA`,
  `KAPPA`, `P_FLOOR`, `MAX_TESTS`), update `docs/reading-results.md` and `glhf/docs/DESIGN.md`.
- The drug board's Claude Code checker runs with `--restricted` by default and cannot run code
  (`checkers.claude_code_cmd` in `board/config.yaml`). Do not remove the flag or add `Bash` to
  `checkers.claude_code_tools`.
- Durable replay repeats your code, so it repeats your side effects. Any call that costs money
  or acts outside the process (a model, a checker, Exa, a subprocess, a cloud launch) must be
  stored under a stable key before the run can rely on it, and skipped on replay when that key
  exists. The pattern is in `checkClaims` in `engine/src/board.ts` (key: round, member, hash of
  the claim) and `startOnce` in `engine/src/glhf/task.ts`. Do not add a paid call without
  one, and add a test that replays and counts the calls.
- The engine's request checks (`engine/src/http.ts`, `checkRequest` in
  `engine/src/glhf/tracker.ts`) decide who may start a paid run. Do not loosen them. The
  paid-calls check in `checkRequest` comes before them and holds for every caller.
- Do not rename the types in `engine/src/glhf/types.ts`. The dashboard is built against them.
- Do not present demo-case or scripted-model results as benchmark results. Label every result
  with what was run. The current state is in `docs/status.md`; keep it true when you add a
  feature or a run.

## Where things are

- Swarm solver: `glhf/bixbench/src/bixbench3/inspect_harness/swarm/`.
- Local runner and scripted model: `glhf/bixbench/src/bixbench3/glhf_local.py`.
- Adapter for the public BixBench dataset (v1.5): `glhf/bixbench_v1/`, with its own README and
  tests. Built; a pilot of 8 questions ran; the full run is not done.
- Swarm memory: `glhf/memory/` (`lessons.pending.md`, `lessons.md`, `README.md`).
- Run tracker (Pi Durable): `engine/src/glhf/`. Contract types: `engine/src/glhf/types.ts`.
- Paid-calls switch: `engine/src/paid.ts`, tests in `engine/test/paid.test.ts`.
- Engine request handler and request checks: `engine/src/app.ts`, `engine/src/http.ts`.
  `engine/src/server.ts` only listens. Board run lock: `engine/src/runlock.ts`.
- Search and Ask over runs: `engine/src/search.ts`, `engine/src/ask.ts`.
- Drug board: `engine/src/board.ts`, `board/config.yaml`.
- Swarm view: `dashboard/src/views/SwarmView.tsx`, `dashboard/src/swarm/` (New run form:
  `NewRun.tsx`).
- Exa search tool (drug board): `engine/src/exa.ts`. Exa's own guidance is the installed skill
  at `.agents/skills/build-with-exa/`.

## Documents

- Write in short sentences and plain words. Two teammates are not native English readers.
- Use the words defined in `README.md` ("Words used in these documents").
- Check that each command and path you document exists.
