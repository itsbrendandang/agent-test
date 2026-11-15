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

Labels: **measured** = I ran it and saw it. **read** = from the code, not run. **unverified** = needs a paid call or a login.

## 1. Answer in five lines

| Question | Answer |
|---|---|
| Does the board run end to end? | **Only scripted**, and that works (measured at both commits: brief, plan, start, events, memo, verdicts). It has never run with a real model: every recorded run in `board/runs` is scripted (`usd: 0`). |
| If `NO_PAID_CALLS` is off, does a real run now start? | **Yes, by the code (read; 39 tests of it pass).** Since the rewire, scripted mode is `paid off OR DRUG_BOARD_MOCK=1` only (`config.ts:50`). With the switch off and no key for a tier, the start fails with 503 naming the tier and key (`providers.ts`). It never silently goes scripted. **Not run live.** |
| What does a real board run actually do today? | **Less than "research".** No role has a tool (`tools: []` in all nine `board/agents/*.md`; the experimenter's prompt says "You cannot run code on this board yet"). So no retrieved evidence, no computation. Literature claims are `unsupported` with no model call, computed claims are `unchecked`, and only claims about the brief's own tables can be `verified`. See section 6. |
| Does the swarm run end to end? | **Yes, scripted** (score 1.0, 20 s). With a real model it ran 3 times on the demo case, and the single agent once (recorded in `glhf/runs/real`). It is the only path that has produced real model output with tools (it runs code in Docker). |
| First thing that breaks with the switch off | **The first paid call is the lead's Anthropic call** (`claude-sonnet-5-5`, the one id used for real before). The likeliest non-switch failures come next and are all unverified: ids never called by this repo (`claude-haiku-5-5`, `gpt-5-mini`, `gpt-4o-mini`), and the reasoning setting on `gpt-5-mini`. Section 6. |

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
| Which keys a real run needs | `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` (lead and strong, cheap, critic, first-pass). `EXA_API_KEY` only if a member has the search tool, which none has. No OpenRouter or TypeSafe key. | `providers.ts` `missingKeys` |
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

### Board, current config

Order in time, with the key each step needs:

| Order | Step | Provider and key | What could fail for a reason other than the switch |
|---|---|---|---|
| 1 | Lead's kickoff call | Anthropic `claude-sonnet-5-5`, `ANTHROPIC_API_KEY` | Least risk: this id has run for real in the swarm. **This is the first paid call.** |
| 2 | Nine roles reply in parallel | Haiku (scout, pilot, finisher), Sonnet (five), `gpt-5-mini` via OpenAI (critic) | `claude-haiku-5-5` and `gpt-5-mini` have never been called by this repo. `gpt-5-mini` cannot switch reasoning off; the critic uses the default, so a few thousand hidden tokens are billed. |
| 3 | First-pass check of claims about the brief | Haiku (for the critic's claims), `gpt-4o-mini` (for the rest), JSON with a quote, reasoning off or `minimal` | `gpt-4o-mini` never used here. Whether the providers honour the reasoning setting: unverified. A malformed reply is never `verified`; it escalates. |
| 4 | Escalation of what the first pass cannot settle | OpenAI `gpt-5-mini` | **Not vendor-aware** (`board.ts:580`): a claim by the OpenAI critic is escalated to OpenAI. Reported to `direct-providers`. |
| 5 | Literature claims | none | `unsupported`, no call: "source is not in the screened evidence pool" |
| 6 | Computed claims | none | `unchecked`, `claude` is not called. `claude` 2.1.311 is installed and its help lists `--restricted`; unused today. |
| 7 | Memo | lead model | none known |

Money guards (read): the spend cap counts models, first pass, checkers and Exa; a round is refused when the last round's cost
would pass `max_usd`; no paid call is made after the cap. The first round cannot be predicted, so it can overshoot.

**What the output is.** Nine models reasoning over one brief, with every claim about the brief's table checked by a
different vendor's model that must quote the table. It shows the machinery. It is not research: no retrieved evidence, no
computation. The brief itself says its data is "illustrative placeholders". To make it research, a role needs a tool (the
cheapest: `tools: [exa_search]` on the scout, plus a prompt line telling it to search; then `EXA_API_KEY` is needed and the Exa
path, dormant today, wakes up). That is a decision for the owner, not something I changed.

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
- That a real model writes the `CLAIMS` section the checkers read (a real run that produces no claims has nothing to check).
- Real token counts, cache hits and cost of any board run (cost.md is a model).
- That Exa works from the board's code (dormant now) and its real price per search.
- That the structured JSON reply is accepted by each provider.
- The dashboard in a browser; the Python suite and dashboard `tsc` at pass 2.

## 9. To do one real run

**Conditional on the rewire being merged and its tests green** (it is in the working tree, uncommitted at the time of
writing). The payer makes one decision (step 4). Everything before it is free. `NO_PAID_CALLS=0` is given **for one command
only** (the process environment wins over `.env`), so nothing stays enabled; do not put it in `.env` unless you want that.
Needed keys: `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` in `.env`. No OpenRouter or TypeSafe key.

```bash
# 0. Be in the repo, with the switch ON for everything free.
cd /Users/brendandang/AI/workspace/drug-board
export NO_PAID_CALLS=1

# 1. The rewire must be in, and nothing live may still name the removed providers.
git status --short engine/src board/config.yaml
git grep -nIi 'openrouter\|typesafe\|jev' -- engine/src board/config.yaml .env.example     # expect: no live code or config hits

# 2. Free gates. All must pass before any money is spent.
(cd engine && npx tsc --noEmit && npm test)       # expect 0 errors and 0 failures (today: see section 2)
npm run board -- board/briefs/kras-g12c-hit-to-lead.md    # scripted control: prints a memo and claim verdicts, first line says SCRIPTED

# 3. Demo A configuration (docs/cost.md section 7): 4 roles, 2 rounds, small caps. Back up, then edit.
cp board/config.yaml /tmp/config.yaml.bak
sed -i '' -e 's/^  max_usd: .*/  max_usd: 1/' -e 's/^  max_rounds: .*/  max_rounds: 2/' \
          -e 's/^  max_escalations: .*/  max_escalations: 3/' -e 's/^  member_turns: .*/  member_turns: 4/' board/config.yaml
sed -i '' -e '/^  - pilot/d' -e '/^  - experimenter$/d' -e '/^  - methods-auditor$/d' -e '/^  - reviser$/d' -e '/^  - finisher$/d' board/config.yaml
git diff board/config.yaml                         # confirm: caps changed, roster is scout, proposer, critic, reporter

# 4. THE PAYER'S DECISION. Only the person who pays sets this, for this one command.
NO_PAID_CALLS=0 npm run board -- board/briefs/kras-g12c-hit-to-lead.md
#    If a key is missing it stops at once (exit 3), naming the tier and key, and spends nothing.

# 5. Check it was real, not scripted. All must hold.
RUN=$(ls -t board/runs | grep -v '^\.' | head -1)
grep -c '"mock": true' board/runs/$RUN/run.json    # expect 0
node -e 'const s=require("./board/runs/'"$RUN"'/run.json"); console.log("usd", s.usd, "firstPassUsd", s.firstPassUsd, "escalations", s.escalations, "mock", s.mock, "costEstimated", s.costEstimated)'
sed -n 1,40p board/runs/$RUN/memo.md
# usd 0 or mock true: stop, it was not a real run. costEstimated true: a price was missing, the cap used a fallback.

# 6. Restore the config. The switch was never exported as 0.
cp /tmp/config.yaml.bak board/config.yaml
```

Notes:

- The roster `sed` was tested on a copy of `board/config.yaml`: it removes pilot, experimenter, methods-auditor, reviser and
  finisher, and leaves `scout`, `proposer`, `critic` and `reporter`. Check the `git diff` anyway.
- A real run writes each role's verified and contradicted claims into `board/expertise/<member>.md` (tracked files,
  `memory.enabled: true`), and they are read into that role's next run. Review `git diff board/expertise`, or set
  `memory.enabled: false` in step 3.
- Expected cost: about **$0.10, plausible $0.05 to $0.25** (estimate; `docs/cost.md` section 7). The hard stop is `max_usd: 1`
  plus whatever round 1 costs.
- This run shows the machinery on illustrative data. It does not retrieve evidence or compute anything (section 6).
- Optional, the swarm on the demo case (measured $0.23 to $0.38; done before, proves nothing new):
  `NO_PAID_CALLS=0 npm run glhf -- run --mode local --solver glhf --model anthropic/claude-sonnet-5-5 --max-tokens 400000 --follow`
- To stop: `Ctrl-C`; `NO_PAID_CALLS=0 npm run resume <run-id>` continues it later.
