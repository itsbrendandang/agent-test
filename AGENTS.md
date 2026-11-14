# Notes for coding agents (Pi, Claude Code, Codex and others)

This repo holds GLHF, a multi-agent solver for the BixBench3 benchmark, and a drug candidate board
that shares its engine and dashboard. Read README.md first.

## Commands

- `npm run setup`: install everything. `npm run doctor`: what is missing on this machine.
- `npm run demo`: scripted swarm run on the demo case (needs Docker, no keys).
- `npm test`: harness tests and type checks. Run it before committing.
- `npm run engine` (port 8787) and `npm run dashboard` (port 5317).
- Harness only: `cd glhf/bixbench && uv run pytest -q tests && uv run ruff check src tests`.

## Rules

- Never read, download or reference `gs://bixbench3-ground-truth` or any published result of a
  benchmark paper while working on a solver, a prompt or a run. It holds the answers.
- Do not give benchmark agents a web search tool. Scored runs use only staged inputs.
- Never start a cloud run (`--mode cloud`, `bixbench3 run`, `setup-runtime`) unless the user asks
  for that run. It creates a billed 32-core VM.
- Keys live in `.env` (gitignored). Never print, log or commit a key.
- Do not change scoring: `glhf/bixbench/src/bixbench3/grading/**` and the upstream single-agent
  solver stay as upstream. Our code is under `inspect_harness/swarm/` and `glhf_local.py`.
- Verdicts on claims are computed in `swarm/ledger.py`. Do not let a model decide a verdict.
- Do not present demo-case or scripted-model results as benchmark results.

## Where things are

- Swarm solver: `glhf/bixbench/src/bixbench3/inspect_harness/swarm/`.
- Run tracker (Pi Durable): `engine/src/glhf/`. Contract types: `engine/src/glhf/types.ts`.
- Swarm view: `dashboard/src/views/SwarmView.tsx`, `dashboard/src/swarm/`.
- Exa search tool (drug board): `engine/src/exa.ts`; Exa's own guidance is the installed skill at
  `.agents/skills/build-with-exa/`.
