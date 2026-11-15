# How the code base is organised

This page says what each folder is for, which parts are in use, where new code goes, and how to
check that your copy is healthy. For setup, read [CONTRIBUTING.md](../CONTRIBUTING.md) first.

## The three layers

```
you ──▶ dashboard/ (the app, port 5317) ──▶ engine/ (port 8787) ──▶ board/      a team review of a question
                                                              ├──▶ glhf/       the benchmark swarm and its sandbox
                                                              └──▶ outside services (model vendors, Exa, Europe PMC)
```

- **`dashboard/`** is only a screen. It holds no keys and makes no model call. Everything it shows
  comes from the engine's API.
- **`engine/`** decides everything: who may start what, the spending limits, the order of steps,
  and the marks on statements. It saves every step, so an interrupted review continues.
- **`board/`** and **`glhf/`** are what the engine runs. `board/` is configuration and instructions
  (no code). `glhf/` is Python: the benchmark harness, our swarm and the adapters.

## Folders

| Folder | What it is | State |
|---|---|---|
| `engine/src/` | The backend (TypeScript, run directly by Node.js, no build step). | In use. |
| `engine/src/board/board.ts`, `agents.ts`, `claims.ts`, `triage.ts`, `checkers.ts`, `mock.ts` | The team review: rounds, members, statements, checks, and the fixed replies of a practice run. | In use. |
| `engine/src/search/exa.ts`, `exaledger.ts`, `literature.ts` | The scout's searches: Exa (paid, with a spend record and a ceiling) and Europe PMC (free). | In use. |
| `engine/src/search/scholarly.ts` | The research answer's literature search: Europe PMC, OpenAlex, Semantic Scholar and arXiv (free), merged. | In use. |
| `engine/src/chat/` | The chat on the Search screen: catalogue, plans, routes. | In use. |
| `engine/src/research/`, `engine/src/sources/` | A direct answer with numbered sources, and searches of public databases. | Being built. Not complete in `main`. |
| `engine/src/glhf/` | The run tracker for swarm runs: start, follow, cancel, grade. | In use. |
| `engine/src/bixv1/` | Read-only results of the BixBench v1 adapter. | In use. |
| `engine/src/paid/paid.ts`, `paidswitch.ts`, `preflight.ts` | The paid-calls switch, the in-app Demo/Real switch, the free pre-check. | In use. |
| `engine/src/http.ts`, `app.ts`, `server.ts` | Request checks, the request handler, the listener. | In use. |
| `engine/test/` | One `*.test.ts` file per area. They use fakes and never reach the network. | In use. |
| `dashboard/src/views/` | One file per view. `HomeView.tsx` is Search, `ExperimentsView.tsx` is Saved research, `SwarmView.tsx` is Compare, `WorldsView.tsx` is Graph. | In use. |
| `dashboard/src/home/`, `research/`, `board/`, `swarm/`, `graph/` | The parts of each view. | In use; `research/` is being built. |
| `dashboard/src/components/` | Shared parts. `ui/` is shadcn/ui, `ai-elements/` is Vercel AI Elements. | In use. |
| `board/config.yaml` | Limits, models and the team list of a review. | In use. Shared file: edit with care. |
| `board/agents/` | One instruction file per team member. | In use. |
| `board/briefs/`, `board/context/`, `board/expertise/` | Written questions, shared context, notes kept between reviews. | In use. |
| `glhf/bixbench/` | Edison's BixBench3 harness with our swarm in `src/bixbench3/inspect_harness/swarm/`. | In use (demo case only; no benchmark task was run). |
| `glhf/bixbench_v1/` | Adapter for the public BixBench dataset (v1.5): single agent and swarm. | In use (a pilot of 8 questions ran). |
| `glhf/demo_case/` | The small built-in test case. | In use. |
| `glhf/memory/` | Lessons from runs. A person approves each one. | In use. |
| `glhf/specialists/` | Profiles of domain specialists and method notes. | Matched by skills to research questions. Selected specialists write short sections from the sources found. |
| `glhf/openmodels/`, `deploy/` | Modal: serving open models for the benchmark, and hosting the app. | Being built. Nothing is deployed. |
| `bixbench/` | A teammate's separate single-agent baseline for BixBench v1. | Kept for reference. Not used for our comparison. |
| `datasets/` | A catalogue of public datasets with their licences. Pointers only. | No code reads it yet. |
| `docs/` | Reference documents. `docs/proposals/` are proposals, not decisions. | In use. |
| `scripts/start.mjs`, `scripts/check.mjs` | What `npm start` and `npm run check` run. | In use. |
| `.github/workflows/ci.yml` | The checks GitHub runs on every push. | Passing on `main` (the runs of 2026-11-15 are green). |
| `.agents/`, `.pi/` | Skills and profiles for coding agents. | Optional. |

Not in git, made on your machine: `.env` (keys), `board/runs/`, `glhf/runs/`, `glhf/data/`,
`node_modules/`, `.venv/`.

## Names that do not match what you see

The product was renamed and the screens were reworded, but folder names, file names and API paths
were kept so that saved runs still open.

| You see | In the code |
|---|---|
| AI Scientist Bot | The repository is `agent-test`; some scripts and variables say `glhf` or `drug-board`. |
| Team review | `board` (`board/`, `engine/src/board/board.ts`, `/api/runs`, `BoardView.tsx`, `DRUG_BOARD_*` variables). |
| Search | `HomeView.tsx`, `dashboard/src/home/`, `/api/chat`. |
| Saved research | `ExperimentsView.tsx`, "runs". |
| Demo mode, practice run | `mock`, `scripted`, `NO_PAID_CALLS` not `0`. |
| Holds up / Proven wrong / Not enough evidence | `verified` / `contradicted` / `unsupported`. |

Do not rename these in the code without a plan for the saved runs.

## Where new code goes

| You are adding | Put it in | And |
|---|---|---|
| Something that can spend money (a model call, a paid search, a cloud launch) | The engine, never the dashboard. | Call `refusePaid()` right before the paid step, store the result under a stable key so a replay does not pay twice, and add a test that counts the calls. |
| A new search source | `engine/src/sources/` | Return the same evidence items as `literature.ts`, with a `provider` name, and give it its own cap. |
| A team member or a change to one | `board/agents/<name>.md` and the `board:` list in `board/config.yaml` | Keep the scout on the list. Run the board tests. |
| A new screen or part of one | `dashboard/src/views/` and a folder beside `home/` | Use the parts in `components/ui` and `components/ai-elements`; add tests beside the file. |
| A new API route | `engine/src/<area>/routes.ts`, registered in `app.ts` | Use the request checks in `http.ts`; never loosen them. |
| Swarm logic | `glhf/bixbench/src/bixbench3/inspect_harness/swarm/` | Do not touch the grader or the upstream solver. |
| A test | Beside what it tests (`engine/test/`, `dashboard/src/**`, `glhf/*/tests/`) | No network, no real key. |
| A document | `docs/`; a proposal in `docs/proposals/` | Short sentences, plain words, every command checked. |

## Is my copy healthy?

```bash
npm run check             # about 3 minutes
```

One line per part: merge-conflict markers, type checks, engine tests, dashboard tests. It never
spends money. `-- --fast` takes a few seconds; `-- --all` adds the Python suites. The numbers for
`main` today are in [developers.md](developers.md#tests).

Known problems on `main` today:

- Many parts are being built at the same time (see "Being built" above). Their files appear and
  change often. If the engine type check fails right after a pull, pull again a little later
  before you look for the cause in your own change.

## Rules that keep it organised

1. One owner per folder at a time. If two people or agents need the same file, the second one
   re-reads it right before editing and keeps the edit small.
2. Shared files (`board/config.yaml`, `board/agents/`, `engine/src/board/board.ts`, `agents.ts`,
   `app.ts`, `mock.ts`, `package.json`) are never resolved in a merge by taking one whole side.
3. After a pull: restart the engine, then `npm run check -- --fast`.
4. Before a commit: `npm run check`, then `git status --short`. No keys, no run folders, no data.
5. A feature is "done" in a document only when it ran. Say what ran: practice run or real run,
   which model, how many times. [docs/status.md](status.md) is the record.
