# Readiness: can the system run real research?

Written 2026-11-14 and **updated 2026-11-15** by the `runnable` agent, after the direct-provider rewire and the new nine-role
board roster landed. Nothing here cost money. `NO_PAID_CALLS=1` was set in every shell, `.env` was never read (only variable
names were listed), and no engine on 8787 or dashboard on 5317 was touched.

How this was tested, in two passes. Both used private `git worktree`s under `/tmp` with no `.env`, so no key could reach them,
and engines on port 8788:

- **Pass 1, commit `0d3b50e`** (before the rewire): routes, board and swarm walk-throughs, the original findings. Sections 3 and 5a.
- **Pass 2, commit `b749e38` plus the uncommitted edits to `board.ts`, `triage.ts`, `events.ts`, `board/config.yaml`**
  (the rewire and Josue's roster): type check, tests, a scripted board run, the plan route. Sections 1, 2, 4, 5b, 6.

The shared tree changes while others work. Where something is only in the working tree it says so.

> **Later change.** The `board:` list now also has `evidence-verifier`, a seventh member. It rechecks the Scout's sources in
> every round (see `docs/drug-board.md`). The member counts and estimates in this report predate it.

> **Update (branch `fm/engine-review-cost`).** The team-review roster changed after both passes. The `board:` list in
> `board/config.yaml` has six members: scout, proposer, experimenter, methods-auditor, critic, reporter. The scout searches
> (`exa_search`, `literature_search`, `database_search` in `board/agents/scout.md`). The lead has `converse` and
> `write_memo` (`board/agents/lead-scientist.md`). The other members have no tool. Sections 1, 4, 6, 8 and 9 are corrected
> for this, and section 10 is new. Sections 2, 3 and 5 record the two passes and describe the roster of that time.
>
> One real team review is recorded since, in `README.md` ("Where things stand", commit `dc37c8d`): 3 Exa searches,
> 5 literature searches, 204 statements checked (71 supported, 28 without enough evidence, 105 not checked, none
> contradicted), $1.31, 8 minutes. At that commit `board/config.yaml` already had this six-member roster. It is one run.
> Its run folder and its tokens per model are not in the repo. A run's `run.json` now keeps tokens and cost per model
> (`usage`, `engine/src/board/board.ts`) for the lead and the members. The checkers are kept as dollars only
> (`firstPassUsd`, `checkerUsd`).

Labels: **measured** = I ran it and saw it. **read** = from the code, not run. **unverified** = needs a paid call or a login.

## 1. Answer in five lines

| Question | Answer |
|---|---|
| Does the board run end to end? | **Yes, scripted** (measured at both commits: brief, plan, start, events, memo, verdicts), **and once with real models** (recorded in `README.md`: $1.31, 8 minutes, 204 statements checked; see the update at the top). The real run's folder is not in the repo. |
| If `NO_PAID_CALLS` is off, does a real run now start? | **Yes, by the code (read; 39 tests of it pass).** Since the rewire, scripted mode is `paid off OR DRUG_BOARD_MOCK=1` only (`config.ts:50`). With the switch off and no key for a tier, the start fails with 503 naming the tier and key (`providers.ts`). It never silently goes scripted. **Not run live.** |
| What does a real board run actually do today? | **Searches, but computes nothing** (read from the code; one real run is recorded, row above). The scout searches the web (Exa, paid), PubMed and preprints (Europe PMC, free) and public databases (free). The first pass screens its results into an evidence pool, so a literature claim that cites a pool source can be checked. No other member has a tool, and no member can run code (the experimenter's prompt says "You cannot run code on this board yet"). So computed claims are `unchecked`, and a literature claim whose source is not in the pool is `unsupported` with no model call. See section 6. |
| Does the swarm run end to end? | **Yes, scripted** (score 1.0, 20 s). With a real model it ran 3 times on the demo case, and the single agent once (recorded in `glhf/runs/real`). It is the only path that has produced real model output with tools (it runs code in Docker). |
| First thing that breaks with the switch off | **The first paid call is the lead's Anthropic call** (`claude-sonnet-5-5`, the one id used for real before). The likeliest non-switch failures come next and are all unverified: ids with no call recorded per model in the repo (`claude-haiku-5-5`, `gpt-5-mini`, `gpt-4o-mini`), and the reasoning setting on `gpt-5-mini`. Section 6. |

## 2. Build and tests

| Check | At `0d3b50e` (measured) | At `b749e38` + uncommitted edits (measured) |
|---|---|---|
| `cd engine && npx tsc --noEmit` | 7 errors, all in `test/chat.test.ts` (6) and `test/glhf-timeouts.test.ts` (1) | **0 errors** |
| `cd dashboard && npx tsc -b` | 1 error, `src/lib/token.test.tsx` | not re-run |
| Engine tests | 186 tests, 159 pass, **27 fail** (HEAD's tests predate its token auth: `401 !== 201`) | **250 pass, 6 fail** in a keyless worktree (below) |
| Python, `glhf/bixbench`, red-team file left out | 1,230 passed, 1 failed (`test_budget_plan`), 2 skipped, 134 s | not re-run |

The six engine failures at pass 2, run file by file:

| File | Failing test | Cause |
|---|---|---|
| `board-core` | `resume: a run does not continue past the daily cap…` | **Needs keys.** It gets `MissingTierKey`, not `BudgetReached`, in a clone without keys; it passes with fake `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` in the environment (I tried). A CI job with no secrets will fail it. Reported to `direct-providers`. |
| `app` | `an event stream sends only what was appended, and streams are capped…` | assertion `one more on the same run`; the file also took 150 s. Not investigated. |
| `bixv1-budget` | `over HTTP: the new fields are served…` | `Cannot read properties of undefined (reading '0')`; the runs folder is not in git, so likely a missing fixture in a clone. Not investigated. |
| `glhf-runs` | `M7: the refusal that asks for maxTokens…` | wording assertion; owned by the run-control agents |
| `glhf-tracker` (2) | cloud-run tests | error text now asks for `billCloud`; tests predate it |

Meaning at `b749e38`: `npm test` was not a clean gate. One of the six hurt any CI without secrets.

**Measured again at `6e3cb2c` (2026-11-15, a keyless worktree, `NO_PAID_CALLS=1 PAID_SWITCH_LOCKED=1`):**
`cd engine && npx tsc --noEmit` gives 0 errors, `npm run lint` is clean, and `node --test test/*.test.ts` gives
**457 pass, 0 fail** in 36 s. The six failures above no longer happen, also without keys. GitHub's checks pass on `main`.
The dashboard and the Python suites were not re-run for this line.

## 3. Routes (measured at `0d3b50e`, with the dashboard's `Origin` header)

The owner restarted the live engine, and `GET /api/chat/catalog` answers 200 there, so **no route needs a restart**. Pass 2
confirmed `/api/chat` and `/api/chat/plans/:id/start` again, and that `POST /api/runs` now returns `{runId, scripted, mode}`.

| Route | Result | Note |
|---|---|---|
| `GET /api/status` | 200 | `mock`, `paidCalls`, key flags |
| `GET /api/roster`, `/api/briefs`, `/api/runs` | 200 | |
| `POST /api/runs {brief}` | 201; 400 for `_template.md` (names the unfilled sections); 404 unknown brief | No `Origin` needed in scripted mode |
| `GET /api/runs/:id/events` | SSE, stays open | `curl` needs a timeout |
| `GET /api/runs/:id/memo` | 200 Markdown; 404 `no memo yet` | |
| `POST /api/runs/:id/resume` | 202; a no-op on a finished run | |
| `GET /api/chat/catalog`, `/api/chat/search?q=` | 200 | |
| `POST /api/chat` | 200 `mode: scripted`; no `Origin`: 403 | returns a plan, starts nothing |
| `POST /api/chat/plans/:id/start` | 400 without `confirm`; 400 for a brief missing sections; 201; 409 on a second start | |
| `POST /api/ask` | 200 keyword mode; no `Origin`: 403 | |
| `/api/glhf/*` | 200 / 201 | a real model or cloud run: 400 with the `NO_PAID_CALLS` message; `roles` runs `uv`, no `Origin`: 403 |
| `/api/bixv1/*` | 200 | `runs/:id` 404 in a clone: the runs folder is not in git |
| `GET /api/token` | 401 without the token | by design |

Plans: at `0d3b50e` a plan's members and limits were ignored (a "quick" plan ran 8 members for 3 rounds). **Now they are
applied**: a quick plan ran 2 members for 1 round (measured). Not applied: the plan's model tier and search cap, as its own
warning says.

## 4. The central question: what happens with `NO_PAID_CALLS=0` and no OpenRouter key

**At `0d3b50e` (before the rewire).** The keys the live engine saw: `ANTHROPIC` true, `OPENAI` true, `EXA` true, `OPENROUTER`
false, `TYPESAFE` false. `config.ts:42` was `paidCallsOff || DRUG_BOARD_MOCK=1 || !OPENROUTER_API_KEY`, so turning the
switch off still gave scripted models and a run with no API call. It was not fully silent: the dashboard showed "Scripted
models", but the engine log printed `(mock models)` then `Paid calls: ON … can spend`, and `POST /api/runs` returned a bare 201.

**Now (working tree, read, and exercised by `board-direct.test.ts`, 39 tests passing):**

| What | Behaviour | Where |
|---|---|---|
| Scripted or real | scripted iff `NO_PAID_CALLS` is not `0` or `DRUG_BOARD_MOCK=1`. A missing key no longer means scripted. | `config.ts:50` |
| A tier key missing in a real run | HTTP **503** from `POST /api/runs` and the plan start, CLI exit 3, naming each tier, model and key. Also checked on resume. | `providers.ts` `assertBoardKeys`, `board.ts:399,427`, `cli.ts:51` |
| Which keys a real run needs | `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` (lead and strong, cheap, critic, first-pass), and `EXA_API_KEY`, because the scout has `exa_search`. No OpenRouter or TypeSafe key. | `providers.ts` `missingKeys`; `startRun` and `runBoard` in `board.ts` ask for Exa when a roster member has `exa_search` |
| Start-up banner | `Board runs: SCRIPTED (paid calls are off)…` or `REAL (anthropic/…, openai/…)`, then the paid-calls line, then a warning if a real run would be refused. The contradiction is gone. | `server.ts`, `providers.ts` `boardModeLine` |
| API response | `POST /api/runs` returns `{runId, scripted, mode}` | `app.ts:183` |

So the silent path is closed, in code. Verify it live, for free, with the check in section 9 (step 2 with the keys removed
shows the refusal, but only with the switch off for that command; do not do that: the unit tests cover it).

## 5. The scripted walk-through (measured)

### 5a. Pass 1, `0d3b50e`, eight-member roster

| Step | Command / route | Result |
|---|---|---|
| Plan | `POST /api/chat` "Should we advance a KRAS G12C covalent inhibitor series…", quick | 200, `mode: scripted`, plan with 4 agents, `paid: false`, estimate $0 |
| Validate | `POST …/plans/:id/start {confirm:true, brief:"# Brief: x\n\n## Question\nhello"}` | **400** `Brief … is missing or has unfilled sections: Candidates, Target and Indication, …` |
| Validate (CLI) | `node engine/src/cli.ts run board/briefs/_template.md` | exit 2, same message |
| Start | plan start, `{confirm:true}`; again | 201; then 409 |
| Watch | SSE | 57 events, 3 rounds, 24 replies, 7 searches, 20 claims, memo, in 2.2 s |
| Memo | `GET /api/runs/:id/memo` | "Go with conditions: advance CMP-0423; park CMP-0517" (text fixed in `mock.ts`) |
| Verdicts | `verification_ledger.json` | 20 rows: verified 10, unsupported 9, contradicted 1 (scripted word-overlap proxy: says nothing about science) |

### 5b. Pass 2, `b749e38` + edits, nine-role roster

`node engine/src/cli.ts run board/briefs/kras-g12c-hit-to-lead.md`, scripted:

| Item | Result |
|---|---|
| Events | 3 rounds, **27** replies (9 roles), **0 searches**, 19 `claim.checked`, memo, finish |
| Claims | 17 `brief`, 2 `computed`, 0 `literature`; first pass verified 12, unsupported 2, contradicted 1; 2 escalated (scripted) |
| Plan route | `POST /api/chat` (quick) names `scout` and `critic`; started, it ran **2 members, 1 round** |
| Scripted-only caveats | the scripted `claude-code` check still says `verified` for a computed claim; a real run records computed claims `unchecked` and does not call it |

No step failed.

### 5c. GLHF swarm, scripted (measured at `0d3b50e`; the swarm code was not touched by the rewire)

| Run (mock model, Docker sandbox) | Settings | Result |
|---|---|---|
| solver `glhf`, seed 7 | default 1,800 s | **done, score 1.0**, 20.4 s, 98,555 scripted tokens, 10 phases, 2 claims, 2 registered tests |
| solver `single` | default | done, score 1.0, 11,454 tokens |
| solver `glhf` | `timeLimit: 600` | **done, score 0.0.** The planner found the full plan's floors need 1,124 s, chose a degraded `direct` plan (experiment, finish, report), and the scripted experiment wrote no artifact. The ledger records `budget.degraded`. |

The 600 s result is the planner plus the scripted model, not a crash. For a real run give the swarm 1,500 s or more.

## 6. What a real run would do, step by step (read; nothing live)

### Board, current config (six members)

Order in time, with the key each step needs:

| Order | Step | Provider and key | What could fail for a reason other than the switch |
|---|---|---|---|
| 1 | Lead's kickoff call | Anthropic `claude-sonnet-5-5`, `ANTHROPIC_API_KEY` | Least risk: this id has run for real in the swarm. **This is the first paid call.** |
| 2 | The scout searches and replies first; then the other five reply in parallel | Haiku (scout), Sonnet (proposer, experimenter, methods-auditor, reporter), `gpt-5-mini` via OpenAI (critic); Exa with `EXA_API_KEY` for the scout's web searches | No call to `claude-haiku-5-5` or `gpt-5-mini` is recorded per model in the repo (the real run in `README.md` kept no record per model). `gpt-5-mini` cannot switch reasoning off; the critic uses the default, so a few thousand hidden tokens are billed. Exa from the board's code: the real run made 3 searches. |
| 3 | Screening of each search's new results | the cheap tier (Haiku), one call per search (`triage` in `triage.ts`) | Kept results go into the evidence pool. |
| 4 | First-pass check of claims about the brief or about a source in the pool | Haiku (for the critic's claims), `gpt-4o-mini` (for the rest), JSON with a quote, reasoning off or `minimal` | No call to `gpt-4o-mini` is recorded per model in the repo. Whether the providers honour the reasoning setting: unverified. A malformed reply is never `verified`; it escalates. |
| 5 | Escalation of a claim the first pass cannot settle (not a computed one) | **Vendor-aware now:** `escalationModel` (`engine/src/providers.ts`) picks OpenAI `gpt-5-mini` for a Claude member's claim and the strong-tier Claude model for the critic's claim; `engine/src/board/board.ts` calls it. With no model of another vendor the claim is recorded `unchecked`. | Whether the real run escalated a claim is not recorded in the repo. |
| 6 | Literature claim whose source is not in the pool | none | `unsupported`, no call: "source is not in the screened evidence pool" |
| 7 | Computed claims | none | `unchecked`, `claude` is not called. `claude` 2.1.311 is installed and its help lists `--restricted`; unused today. |
| 8 | Memo | lead model | none known |

Money guards (read): the spend cap counts models, first pass, checkers and Exa; a round is refused when the last round's cost
would pass `max_usd`; no paid call is made after the cap. The first round cannot be predicted, so it can overshoot.

**What the output is.** Six members reasoning over one brief and the scout's screened sources. Each claim about the
brief or about a source in the pool is checked by a different vendor's model that must quote the source. No member
computes anything, so computed claims stay `unchecked`. The demo brief says its data is "illustrative placeholders", so
claims about its tables restate placeholders. One real run is recorded (`README.md`): 204 statements checked, 71
supported, 28 without enough evidence, 105 not checked (75 of them calculations, which the checker cannot re-run), none
contradicted.

### Swarm (unchanged)

| Step | Provider and key | Status |
|---|---|---|
| Real model | Anthropic through Inspect, `ANTHROPIC_API_KEY` | **Works**: 4 recorded real runs (3 swarm, 1 single) on `claude-sonnet-5-5`. Needs `--max-tokens`, Docker, and for `--exa` an Exa key. |
| Runs code | Docker image `python:3.12-slim` (present) | works scripted and real |

BixBench v1 additionally needs the 18 GB image `futurehouse/bixbench:aviary-notebook-env`: **present** locally (18.3 GB).

Not applicable on these paths: Ollama (only with `DRUG_BOARD_LOCAL_MODEL=1`), OpenRouter, TypeSafe, Jev (removed).

## 7. Do the model ids exist? (partly unverified)

| Id | Where used | Evidence it resolves | Live check |
|---|---|---|---|
| `claude-sonnet-5-5` | lead, strong, swarm | used in 4 real runs and the BixBench pilot; in pi-ai's catalog | **verified by use** |
| `gpt-4o` | BixBench judge | worked in the pilot (judge tokens recorded) | verified by use |
| `claude-haiku-5-5`, `gpt-5-mini`, `gpt-4o-mini` | cheap tier, critic, first pass | in pi-ai 1.5.2's bundled catalogs (`getModel` found them, `gpt-5-mini` and `gpt-4o-mini` also priced) | **unverified** |
| `claude-opus-5-5`, `gpt-5.5` | optional upgrades named in `config.yaml` comments | in the catalog | unverified |

I cannot do a live check: both model-list endpoints need an API key and I may not read `.env`. For the payer, a free check
that costs nothing (no inference):
`curl -s https://api.anthropic.com/v1/models -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01"` and
`curl -s https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY"`. I did not run them.

## 8. What I could not verify without spending

- That `claude-haiku-5-5`, `gpt-5-mini`, `gpt-4o-mini` resolve on the accounts, and that the reasoning setting is honoured.
- That real models write the `CLAIMS` section reliably. Shown once: the real run in `README.md` checked 204 statements.
- Real token counts and cache hits of a board run, and its cost split by model. The one real run cost $1.31 in total
  (`README.md`) but kept no tokens per model. `docs/cost.md` is a model of the old 9-role roster. A run's `run.json` now
  records tokens and cost per model (`usage`) for the lead and the members, so the next real run will show them. The
  checkers are kept as dollars only (`firstPassUsd`, `checkerUsd`).
- Exa's real price per search (the config's $0.007 comes from 2 live searches).
- That the structured JSON reply is accepted by each provider.
- The dashboard in a browser; the Python suite and dashboard `tsc` at pass 2.

## 9. To do one real run

For today's roster (six members, the scout searches). Nothing below edits `board/config.yaml`. The payer makes one decision
(step 3). Everything before it is free. `NO_PAID_CALLS=0` is given **for one command only** (the process environment wins
over `.env`), so nothing stays enabled; do not put it in `.env` unless you want that. Needed keys in `.env`:
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `EXA_API_KEY` (the scout's web search). No OpenRouter or TypeSafe key.

```bash
# 0. Be at the root of the repository, with paid calls off for everything free.
cd "$(git rev-parse --show-toplevel)"
export NO_PAID_CALLS=1

# 1. Read the roster and the caps the real run will use. Change nothing.
grep -n -A7 '^board:' board/config.yaml          # expect scout, proposer, experimenter, methods-auditor, critic, reporter
grep -n -E '^  (max_usd|max_rounds|max_searches|max_escalations|daily_usd):' board/config.yaml

# 2. Free gates. All must pass before any money is spent.
npm run check                                     # health report, about 3 minutes; it forces paid calls off. Every line must say ok
npm run board -- board/briefs/kras-g12c-hit-to-lead.md   # practice run: searches, claim verdicts, a memo, ends "finished: $0.000"

# 3. THE PAYER'S DECISION. Only the person who pays sets this, for this one command.
#    --max-usd only lowers this run's spend cap (here to $2, from the config's $5). It never raises it.
NO_PAID_CALLS=0 npm run board -- board/briefs/kras-g12c-hit-to-lead.md --max-usd 2
#    If a key is missing it stops at once (exit 3), naming the tier and key, and spends nothing.

# 4. Check it was real, not scripted. All must hold.
RUN=$(ls -t board/runs | grep -v '^\.' | head -1)   # or the id the command printed after "run"
grep -c '"mock": true' board/runs/$RUN/run.json    # expect 0
node -e 'const s=require(process.argv[1]); console.log("usd", s.usd, "firstPassUsd", s.firstPassUsd, "checkerUsd", s.checkerUsd, "escalations", s.escalations, "mock", s.mock, "costEstimated", s.costEstimated); for (const [m, u] of Object.entries(s.usage ?? {})) console.log(m, "in", u.input, "out", u.output, "cacheRead", u.cacheRead, "cacheWrite", u.cacheWrite, "usd", u.cost?.total)' "$PWD/board/runs/$RUN/run.json"
head -40 board/runs/$RUN/memo.md
# usd 0 or mock true: stop, it was not a real run. costEstimated true: a price was missing, the cap used a fallback.
```

Notes:

- Step 1, the practice run of step 2 and the step-4 commands were run on this branch with paid calls off (step 4 then
  shows `mock true`, `usd 0` and scripted token counts). Step 3 was not run.
- The run uses the whole roster. The lead decides the number of rounds, up to `max_rounds` (4). A team-review plan
  (`POST /api/chat`, then start) can only narrow the members and limits (`applyOverrides` in
  `engine/src/board/board.ts`); its model tier and search cap are not applied.
- A real run writes each member's verified and contradicted claims into `board/expertise/<member>.md` (tracked files,
  `memory.enabled: true`), and they are read into that member's next run. Review `git status board/expertise` and
  `git diff board/expertise` before you commit anything.
- **Expected cost.** The one real run recorded on this roster cost $1.31 and took 8 minutes (`README.md`). That is one
  run, not an estimate. A cap below it may end this run early, because the lead is told to wrap up at the cap. The old
  estimate (about $0.10, `docs/cost.md` section 7) was for the old roster with no searches. The cap is checked before
  each round, with the last round's cost as the guess for the next one, and after a limit one final round may still run
  (`gateRound` and `overLimit` in `engine/src/board/board.ts`). So a run can pass `--max-usd` by about one round's cost.
  Exa searches count in the cap (`max_searches: 20` a run).
- After the run, put its `usage` numbers into `docs/cost.md` in place of the estimate.
- The demo brief's data is "illustrative placeholders". The run shows the machinery and the scout's sources. It computes
  nothing (section 6).
- Optional, the swarm on the demo case (measured $0.23 to $0.38; done before, proves nothing new):
  `NO_PAID_CALLS=0 npm run glhf -- run --mode local --solver glhf --model anthropic/claude-sonnet-5-5 --max-tokens 400000 --follow`
- To stop: `Ctrl-C`; `NO_PAID_CALLS=0 npm run resume <run-id>` continues it later.

## 10. Direct answers on the Research screen

The Research screen (`Home` in `dashboard/src/nav.ts`; older documents call it the Search screen) first asks the engine
for a direct answer (`POST /api/research`, [research-answer.md](research-answer.md)). In Real mode the engine refuses it
with 503 unless the engine was started with `RESEARCH_PREVIEW=1` (`previewOn` in `engine/src/research/preview.ts`, used
in `engine/src/research/routes.ts`). The screen then asks for a team-review plan instead (`dashboard/src/views/HomeView.tsx`).
Demo mode needs no switch.

This branch makes that state visible:

- the engine prints a start-up line that begins `Direct answers` and says ON or OFF (`previewLine`, called in
  `engine/src/server.ts`);
- `GET /api/status` has `researchPreview` (the switch) and `directAnswers` (whether a question gets an answer now)
  (`engine/src/app.ts`);
- the Research screen shows a note under the question box when direct answers are off (`DIRECT_ANSWERS_OFF` in
  `dashboard/src/research/api.ts`, shown by `dashboard/src/views/HomeView.tsx`).

Turning it on is the payer's decision: it is a paid path, with its own cap per answer (`research:` in
`board/config.yaml`). What it costs: [cost.md section 10](cost.md#10-the-research-answer-research-screen).
