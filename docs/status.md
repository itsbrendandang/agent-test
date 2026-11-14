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
| Swarm on the demo case with a real model | Done. Score 1.0. | One run, `anthropic/claude-sonnet-5-5`, 284,532 tokens, `--exa` on, seed 7. |
| Single agent on the demo case with a real model | Done. Score 1.0. | One run, same model, 18,644 tokens, seed 7. |
| Token budget (`--max-tokens`) on the demo case, real model | Tried twice with the swarm. | 70,000 tokens: score 0.0. 200,000 tokens: score 1.0. |
| A real BixBench3 task | **Not done.** | |
| Cloud run (`--mode cloud`) | **Not done.** Google Cloud is not set up. | |
| Tracking of a cloud run (launch, status, collect) | Parts are tested: a command is started only once, the tracker lock, and matching a run manifest to the right solver. No test follows a whole cloud run, also not with a stand-in. | `engine/test/glhf-tracker.test.ts`. |
| Per-role models (`--role-model`) | **Not run.** Role models cannot be combined with the scripted model, and no real-model run used them. | |
| Public BixBench dataset (`futurehouse/BixBench`, 205 questions, 64 data capsules) | In progress. | Adapter in `glhf/bixbench_v1/`. See [its README](../glhf/bixbench_v1/README.md). |

The real-model runs above are single runs on the demo case. The swarm used about 15 times the
tokens of the single agent (284,532 against 18,644) for the same score. The swarm run had
documentation search (`--exa`); the single agent cannot have it. One run per solver does not
show a difference between the solvers.

The records of these runs are local files under `glhf/runs/` (not in git), so a new clone does
not have them.

## Sponsor tools

| Tool | Status |
|---|---|
| Exa search | Tested live. Used by the drug board's literature search (`engine/src/exa.ts`) and by the swarm's `search_docs` tool (`swarm/tools.py`). |
| past.dev memory | Sending lessons (ingest) and recalling them are tested against the live API (`swarm/past_memory.py`). Not used inside a full swarm run yet. |
| Modal | Planned only. No code in this repository uses Modal. |

## Engine and dashboard

| Feature | Status |
|---|---|
| Run tracker: no second launch after a restart | The parts are tested (start-once marker file, lock file, process check) in `engine/test/glhf-tracker.test.ts`. No automated test stops and restarts the engine during a run. |
| HTTP checks (Host, Origin, token) | Automated tests (`engine/test/board-http.test.ts`). |
| Scoreboard pairing rules | Automated tests (`engine/test/glhf-scoreboard.test.ts`). |
| Ask (question answering over runs) | Automated tests with a stand-in for the model API (`engine/test/glhf-ask.test.ts`). |
| Docker Compose setup | Built. We have no record of a test on Linux. |
| Dashboard | No automated tests. Type checks only (`npm run typecheck`). |

## Drug candidate board

| Feature | Status |
|---|---|
| Full run with scripted models | Works (`npm run board` without `OPENROUTER_API_KEY`). |
| Full run with real models | Not verified. The repository holds no record of a finished live run. |
| Watch mode (`watch:` in `board/config.yaml`) | Not implemented. The key is read but no code uses it. |
