# Notes for coding agents (Pi, Claude Code, Codex and others)

This repository holds GLHF, a nine-role solver (the swarm) for the BixBench3 benchmark, and a
drug candidate board that shares its engine and dashboard. Read `README.md` first. Reference
documents are in `docs/`.

## Commands

- `npm run setup`: install everything. `npm run doctor`: what is missing on this machine.
- `npm run demo`: scripted swarm run on the demo case (needs Docker, no keys).
- `npm test`: harness tests, type checks and engine tests. Run it before committing.
- `npm run engine` (port 8787) and `npm run dashboard` (port 5317).
- Harness only: `cd glhf/bixbench && uv run pytest -q tests && uv run ruff check src tests`.
- Engine only: `npm run test:engine`. Type checks only: `npm run typecheck`.

## Rules

- Never read, download or reference `gs://bixbench3-ground-truth` or any published result of a
  benchmark paper while working on a solver, a prompt or a run. It holds the answers.
- Benchmark agents get no open web search. The optional `search_docs` tool (`--exa`) is limited
  to the documentation allow-list `DOC_DOMAINS` in
  `glhf/bixbench/src/bixbench3/inspect_harness/swarm/tools.py`. Never add a journal, a preprint
  server, a code host or a data repository to it.
- `glhf/memory/lessons.md` holds process lessons only. Never write results, scores or answers
  into it. Do not weaken the filter in `swarm/memory.py`.
- Never start a cloud run (`--mode cloud`, `bixbench3 run`, `bixbench3 setup-runtime`) unless
  the user asks for that run. It creates a billed 32-core virtual machine.
- Keys live in `.env` (not in git). Never print, log or commit a key. Never print `.env`.
- Do not commit run folders (`glhf/runs/`, `glhf/bixbench/runs/`, `glhf/bixbench_v1/runs/`,
  `board/runs/`) or benchmark data (`glhf/data/`).
- Do not change scoring: `glhf/bixbench/src/bixbench3/grading/**` and the upstream single-agent
  solver (`inspect_harness/solvers.py`) stay as upstream. Our code is under
  `inspect_harness/swarm/` and `glhf_local.py`. We also changed `inspect_harness/tasks.py` and
  `cli.py` to select the solver.
- Verdicts on claims are computed in `swarm/ledger.py`. Do not let a model decide a verdict.
  If you change a constant there (`ALPHA`, `KAPPA`, `P_FLOOR`, `MAX_TESTS`), update
  `docs/reading-results.md` and `glhf/docs/DESIGN.md`.
- The engine's request checks (`engine/src/http.ts`, `checkRequest` in
  `engine/src/glhf/tracker.ts`) decide who may start a paid run. Do not loosen them.
- Do not rename the types in `engine/src/glhf/types.ts`. The dashboard is built against them.
- Do not present demo-case or scripted-model results as benchmark results. Label every result
  with what was run. The current state is in `docs/status.md`; keep it true when you add a
  feature or a run.

## Where things are

- Swarm solver: `glhf/bixbench/src/bixbench3/inspect_harness/swarm/`.
- Local runner and scripted model: `glhf/bixbench/src/bixbench3/glhf_local.py`.
- Adapter for the public BixBench dataset (in progress): `glhf/bixbench_v1/`.
- Run tracker (Pi Durable): `engine/src/glhf/`. Contract types: `engine/src/glhf/types.ts`.
- Engine server and request checks: `engine/src/server.ts`, `engine/src/http.ts`.
- Search and Ask over runs: `engine/src/search.ts`, `engine/src/ask.ts`.
- Drug board: `engine/src/board.ts`, `board/config.yaml`.
- Swarm view: `dashboard/src/views/SwarmView.tsx`, `dashboard/src/swarm/`.
- Exa search tool (drug board): `engine/src/exa.ts`. Exa's own guidance is the installed skill
  at `.agents/skills/build-with-exa/`.

## Documents

- Write in short sentences and plain words. Two teammates are not native English readers.
- Use the words defined in `README.md` ("Words used in these documents").
- Check that each command and path you document exists.
