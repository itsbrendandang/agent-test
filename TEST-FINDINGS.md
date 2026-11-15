# Test Findings — `testing-b`

A local shakedown of the AI Scientist Bot repo: fresh clone, full setup, test suite,
scripted demo, and the web UI. Nothing in `main` was touched.

- **Date:** 2026-11-15
- **Branch:** `testing-b` (copied from `main`, no source files changed)
- **Machine:** macOS (aarch64), Node 26.0.0, npm 11.12.1, uv 0.13.7, Docker 29.9.2

## Summary

| Area | Result |
|---|---|
| Dependency setup (`npm run setup`) | ✅ Works |
| Full test suite (`npm test`) | ✅ 451 pass, 1 skip, 0 fail |
| Scripted demo (`npm run demo`) | ✅ Score 1.000 end-to-end |
| Web UI (`npm start`) | ✅ Engine + dashboard both serve |
| Doctor readiness (`npm run doctor`) | ⚠️ Demo-ready only (no API keys / cloud) |

## What works

- **Setup.** `npm run setup` installed engine + dashboard (npm) and bixbench (`uv sync`)
  cleanly on a fresh clone.
- **Tests.** `npm test` ran all three suites — pytest, `tsc` typecheck (engine + dashboard),
  and the engine `node --test` suite. **452 tests: 451 passed, 1 skipped, 0 failed.**
- **Demo.** `npm run demo` completed in ~33s. The full pipeline ran: sandbox launch (Docker)
  → run → relevance → report → grading → critic loop.
  - Official grader score: **1.000**
  - Artifacts: `gene_counts: 1.000`, `treated_vs_control: 1.000`
  - Claims: 1 supported, 1 refuted, 0 not established
  - Critic issues: 1 found and fixed (`gene_counts.csv has a header and no rows`), 0 open
- **UI.** `npm start` brought up both services and the browser opens to
  http://127.0.0.1:5317.
  - Dashboard: HTTP 200, serves `<title>AI Scientist Bot</title>` + React root (Vite dev).
  - Engine: HTTP 200, `/api/glhf/status` returns live config; `/api/glhf/runs` lists the
    demo run with its score.

## What didn't work / caveats

- **Docker was stopped.** The demo and local runs need the Docker daemon as the agents'
  sandbox. It was not running on first try — had to launch Docker Desktop (`open -a Docker`)
  and wait for it before the demo would run.
- **Demo mode only (no real research).** The demo uses the scripted `mock` model. It proves
  the plumbing works, not the science. The score of 1.000 is from fixed example data.
- **Not ready for real / cloud runs.** `npm run doctor` flagged everything needed for real
  runs as missing:
  - `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `EXA_API_KEY` — not set
  - gcloud CLI, GCP project, Hugging Face access (`HF_TOKEN`) — not configured (needed for
    BixBench3 cloud runs)
  - Paid calls are OFF (`NO_PAID_CALLS`), so paid models, Exa, and checkers are refused.
- **No `timeout` command** on this machine (minor; only affected an ad-hoc command, not the app).

## How to reproduce

```bash
npm run setup     # once, after cloning
npm test          # full suite (needs Docker for some engine tests)
# start Docker Desktop first, then:
npm run demo      # scripted end-to-end run, no keys needed
npm start         # engine + dashboard, opens http://127.0.0.1:5317
```
