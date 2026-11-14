# Status: what was tested

This page lists each feature and how far it was tested. Use these labels:

- **Tested with a real model**: a run with a paid model finished and was graded.
- **Tested with the scripted model**: the code path works with `--model mock`. This tests the
  code, not the science.
- **Tested against a stand-in**: an automated test replaces the outside service with a fake one.
- **Tested live**: the real outside service was called.
- **Not done** or **Planned**: no run and no test.

Do not present a demo-case result or a scripted-model result as a benchmark result.

## GLHF swarm

| Feature | Status | Evidence |
|---|---|---|
| Nine roles, ledger, verdicts, budgets | Tested with the scripted model. | `glhf/bixbench/tests/unit/test_glhf_*.py`, `glhf/bixbench/tests/e2e/test_glhf_swarm_smoke.py` (needs Docker). |
| Verdict rules: registered tests, mean of e-values | Automated tests, with a simulation of the error rate. **Not used in a real-model run.** The real-model run below used the older rules (product, no registration). | `glhf/bixbench/tests/unit/test_glhf_ledger.py`. |
| Contract check with the grader's delimiter rules | Automated tests. | `glhf/bixbench/tests/unit/test_glhf_contract_and_budgets.py`. |
| One review round in a default local run (1,800 seconds) | Automated tests of the time rule. Not checked in a real-model run. | Same file; `min_review_seconds` in `swarm/solver.py`. |
| Documentation search (`--exa`): 9 sites, path rules, identifier refusal, 20 searches per run | Automated tests. Tested live outside a run: 2 searches with the 9-site list (see "Sponsor tools"). Not used inside a run with the present list, and not on a real BixBench3 task. | `glhf/bixbench/tests/unit/test_glhf_memory_and_search.py`. |
| Memory (`--memory`): pending lessons, approval by a person, filter | Automated tests and the scripted model. **Not used in a real-model run.** | Same file; [glhf/memory/README.md](../glhf/memory/README.md). |
| Swarm on the demo case with a real model | Done. Score 1.0. | One run, `anthropic/claude-sonnet-5-5`, 284,532 tokens, `--exa` on, seed 7. |
| Single agent on the demo case with a real model | Done. Score 1.0. | One run, same model, 18,644 tokens, seed 7. |
| Token budget (`--max-tokens`) on the demo case, real model | Tried twice with the swarm. | 70,000 tokens: score 0.0. 200,000 tokens: score 1.0. |
| A real BixBench3 task | **Not done.** | |
| Cloud run (`--mode cloud`) | **Not done.** Google Cloud is not set up. | |
| Tracking of a cloud run (launch, status, collect) | Parts are tested: a command is started only once, the tracker lock, and matching a run manifest to the right solver. No test follows a whole cloud run, also not with a stand-in. | `engine/test/glhf-tracker.test.ts`. |
| Per-role models (`--role-model`) | **Not run.** Role models cannot be combined with the scripted model, and no real-model run used them. | |
| Public BixBench dataset (`futurehouse/BixBench` v1.5) | Adapter built. Pilot only. See the next section. | `glhf/bixbench_v1/`. |

The real-model runs above are single runs on the demo case. The swarm used about 15 times the
tokens of the single agent (284,532 against 18,644) for the same score. The swarm run had
documentation search (`--exa`); the single agent cannot have it. One run per solver does not
show a difference between the solvers.

The records of these runs are local files under `glhf/runs/` (not in git), so a new clone does
not have them.

## BixBench v1 adapter

The adapter in `glhf/bixbench_v1/` runs the single agent and a three-role swarm (analyst, blind
critic, reconciler) on the public dataset `futurehouse/BixBench` v1.5 (205 questions on 59 data
capsules, in 64 zip files). It is not BixBench3 and not the nine-role swarm. Full text:
[glhf/bixbench_v1/README.md](../glhf/bixbench_v1/README.md).

| Feature | Status | Evidence |
|---|---|---|
| Staging of data, integrity rules, both solvers, three grading profiles, report | Tested with the scripted model. | 102 automated tests in `glhf/bixbench_v1/tests/`. Run: `cd glhf/bixbench_v1 && uv run pytest -q tests`. Not part of `npm test`. |
| Pilot with a real model | Done once. 3 capsules, 8 questions, `anthropic/claude-sonnet-5-5`. | Single agent: 4 of 8 correct, 317,110 tokens. Swarm: 4 of 8 correct, 532,394 tokens (about 1.7 times). Report in `glhf/bixbench_v1/runs/pilot-sonnet-5-5/report.md` (local file, not in git). |
| Full run (205 questions) | **Not done.** | |
| One run per question (`--unit question`) | Not tried with a real model. | |
| Multiple-choice mode (`--answer-mode mcq`) | Not tried with a real model. | |
| Critic without hints (`--critic-hints none`) | Not tried with a real model. | |

The pilot is too small to conclude anything. Both solvers answered the same 4 questions
correctly, and the 95% interval for each is about 22% to 79%. It does not show that one solver
is better or that they are equal.

Known limits:

| Limit | Effect |
|---|---|
| The sandbox has no network. | At least 17 of the 205 questions (in 6 capsules) name an online resource such as KEGG or Reactome. Neither solver can answer them as asked. The official harness leaves the network on. |
| The official image (`futurehouse/bixbench:aviary-notebook-env`) lacks some R packages. | edgeR, limma, org.Mm.eg.db, Seurat, msigdbr and ReactomePA are not installed. Questions that need them are harder or cannot be done as asked. |
| One run is one capsule with all its questions. | The official protocol is one question per run. Questions of a capsule can hint at each other, and one data-loading mistake can cost several questions. State this with any number. |
| The image is published for linux/arm64 only. | Tested on Apple Silicon. An x86-64 machine needs emulation or its own build. |

## Sponsor tools

| Tool | Status |
|---|---|
| Exa search | Tested live. Used by the drug board's literature search (`engine/src/exa.ts`) and by the swarm's `search_docs` tool (`swarm/tools.py`). Details for the swarm's tool are in the next table. |

Live test of the swarm's documentation search (the guard in `swarm/tools.py`, with the 9-site
list):

| Item | Value |
|---|---|
| What was called | The search with the 9-site list, and the result check on what came back. Outside a run. |
| Searches | 2 |
| Results returned by Exa | 10 for each search |
| Dropped by the result check | About half. Examples: pages on the Bioconductor support forum (a subdomain of `bioconductor.org`), and a `readthedocs.io` project that is not on the list of named projects. |
| Cost | $0.014 |
| Not tested | The search inside a swarm run, with a real model that writes the queries. |

What this shows: asking Exa for the listed domains is not enough by itself, because Exa also
returns subdomains and other projects of a listed host. The second check in code
(`result_block_reason`) is needed, and it worked on these results. Two searches are a small
sample.

| Tool | Status |
|---|---|
| past.dev memory | Sending lessons (ingest) and recalling them are tested against the live API (`swarm/past_memory.py`). Lessons are now sent only when a person approves them (`approve` command). Not used inside a full swarm run yet. |
| Modal | Planned only. No code in this repository uses Modal. |

## Engine and dashboard

| Feature | Status |
|---|---|
| Run tracker: no second launch after a restart | The parts are tested (start-once marker file, lock file, process check) in `engine/test/glhf-tracker.test.ts`. No automated test stops and restarts the engine during a run. |
| Run control: a pair in one request (`solvers`), one local run at a time (409), a queued partner that survives an engine restart, a partner that starts after a failure | Automated tests through the real routes, with a stand-in for the local runner (`engine/test/glhf-runs.test.ts`). **Not tested with a real model or a real Docker sandbox.** |
| Cancel (`POST /api/glhf/runs/:id/cancel`, `npm run glhf -- cancel`): stops the runner and its processes, cancels a queued partner, refuses cloud runs | Same test file, same stand-in. Not tested on a run with a real sandbox container; check `docker ps` after a cancel. Not tested on a cloud run (none exists). |
| A real model needs a token budget (local runs) | Automated tests (same file). |
| `--solvers` in the CLI | Automated test (same file). |
| `GET /api/glhf/status`: limits, models, keys as true or false | Automated tests (same file). |
| Refusals name the field (`{error, field}`) | Automated tests (same file). |
| Paid-calls switch (`NO_PAID_CALLS`, `engine/src/paid.ts`): on unless the value is `0`; refuses real-model and cloud runs, Exa, the board's models and three checkers; Ask falls back to word search; keys blank in child processes; a paid local run in progress is stopped; `paidCalls` and `models` in the status; the doctor line | Automated tests (`engine/test/paid.test.ts`, 12 tests). The tests check that no request left the process. **Not tested:** a real cloud run that is already on its machine (none exists); the switch inside Docker Compose. |
| Paid-calls switch for Python commands run directly (`uv run bixbench3 ...`, `uv run bixbench-v1 run ...`, `python -m bixbench3.glhf_local`) | **Not covered at commit `05600b1`.** A Python guard was added after it (`glhf/bixbench/src/bixbench3/paid.py`, `glhf/bixbench_v1/src/bixbench_v1/paid.py`). **No automated tests yet.** We checked by hand only that the on/off rule and the blanking of keys work on given inputs; no command was run against it. |
| HTTP checks (Host, Origin, token, JSON bodies) | Automated tests that call the real request handler (`engine/test/app.test.ts`, `engine/test/board-http.test.ts`). The handler is in `engine/src/app.ts`; `server.ts` only listens. |
| Scoreboard pairing rules (task, case, model, mode, effort, time limit, token budget) | Automated tests (`engine/test/glhf-scoreboard.test.ts`). |
| Drug board run lock (`engine/src/runlock.ts`): survives a restart, and a process id that the system uses again | Automated tests (`engine/test/board-http.test.ts`, `engine/test/app.test.ts`). No test restarts a real container. |
| Claude Code checker runs with `--restricted` by default and cannot run code | The command and the tool list are tested (`engine/test/board-core.test.ts`). **The `--restricted` mode was not tested with a live call.** Its behaviour is taken from `claude --help`. |
| Ask (question answering over runs) | Automated tests with a stand-in for the model API (`engine/test/glhf-ask.test.ts`). |
| Docker Compose setup | Tested by hand on macOS on a new clone: `docker compose up --build`, then `docker compose exec engine npm run demo` (score 1.000) and `npm run doctor`. Not tested on Linux or Windows. Windows needs WSL2. |
| Dashboard | No automated tests. Type checks only (`npm run typecheck`). |
| Dashboard: New run form (real models with a confirm step, pair with "Both"), Cancel run button, queued and cancelled states | No automated tests in the dashboard. The engine's side is tested (`engine/test/glhf-tracker.test.ts`, `engine/test/glhf-runs.test.ts`). |

## Drug candidate board

| Feature | Status |
|---|---|
| Full run with scripted models | Works (`npm run board` without `OPENROUTER_API_KEY`). |
| Full run with real models | Not verified. The repository holds no record of a finished live run. |
| Watch mode (`watch:` in `board/config.yaml`) | Not implemented. The key is read but no code uses it. |
