# Readiness: can the system run real research?

Written 2026-11-14 by the `runnable` agent. Nothing here cost money. `NO_PAID_CALLS=1` was set in every shell, `.env` was
never read (only variable names were listed), and no engine on 8787 or dashboard on 5317 was touched.

How this was tested: a private `git worktree` of commit `0d3b50e` in `/tmp/drug-board-head` (no `.env`, so no key could
reach it), with its own engine on **127.0.0.1:8788**. The shared tree has many uncommitted edits from other agents; this
report describes **HEAD as committed**, and says where the shared tree differs.

Labels: **measured** = I ran it and saw it. **read** = from the code, not run. **unverified** = needs a paid call or a
network login, so I did not do it.

## 1. Answer in four lines

| Question | Answer |
|---|---|
| Does the board run end to end? | **Only scripted.** Brief, plan, start, event stream, memo and claim verdicts all work with scripted models (measured, 2 s). It has never run with a real model: all 12 recorded runs in `board/runs` are scripted (`usd: 0`). |
| If you turn `NO_PAID_CALLS` off today, does a real board run start? | **No. It stays scripted.** `engine/src/config.ts:42` makes the board scripted when `OPENROUTER_API_KEY` is empty, and it is. See section 4. |
| Does the swarm run end to end? | **Yes, scripted** (measured: score 1.0, 20 s). With a real model it ran 3 times on the demo case in the past, and the single agent once (recorded in `glhf/runs/real`). It is the only part that can spend money usefully today. |
| First thing that breaks when the switch goes off | **Board:** nothing breaks, it silently stays scripted (section 4). **Swarm:** nothing known; it uses Anthropic directly and has done so before. |

HEAD is not in a clean state: `tsc` reports 7 errors in the engine and 1 in the dashboard (all in test files) and 27 of 186 engine tests fail (section 2). The
commit message of `d8f249d` says so ("mid-edit … test suites not run").

## 2. Build and tests at HEAD (measured)

| Check | Result |
|---|---|
| `cd engine && npx tsc --noEmit` | **7 errors, all in tests**: `test/chat.test.ts` (6, `url`/`init`/`startsWith` on type `never`), `test/glhf-timeouts.test.ts` (1). `src/` is clean. |
| `cd dashboard && npx tsc -b` | **1 error**: `src/lib/token.test.tsx(126,60)` property `headers` does not exist on type `Sent`. |
| `cd engine && npm test` | **186 tests, 159 pass, 27 fail.** By file: `glhf-runs` 12, `app` 4, `chat` 3, `paid` 3, `glhf-tracker` 2, `bixv1-api` 1, `bixv1-budget` 1, `board-http` 1. Others pass (`board-core` 12/12, `glhf-timeouts` 46/46, `bixv1-stats` 7/7). |
| Why they fail | HEAD's `src/` has session-token auth (`401 needsToken`) but the tests at HEAD were written before it. Examples: `paid.test.ts` `401 !== 201`, `a scripted run may continue 401 !== 202`; `glhf-runs.test.ts` `Cannot read properties of undefined (reading 'run')`. The shared working tree has modified these test files; I did not run those. |
| `cd glhf/bixbench && uv run pytest` | See the line at the end of this section. |

Python at HEAD (`uv run pytest -q tests`, with the 1,161 red-team guard cases in `test_redteam_guards.py` left out because
they are strict-xfail records of known gaps, not gates): **1,230 passed, 1 failed, 2 skipped** in 134 s, Docker end-to-end
tests included. The one failure is `tests/unit/test_budget_plan.py::test_a_phase_may_not_spend_the_floors_of_the_phases_still_owed`
(`assert 44 == 1746 - 1000 - 255 - 387`): the budget planner's reserves and the test disagree, in the 30-minute case.
The 2 skips need a sibling checkout that is not here.

Meaning: you cannot rely on `npm test` as a gate at HEAD. A reviewer should run it on the shared tree after the other
agents finish.

## 3. Routes on a HEAD build (measured on 8788, with the dashboard's `Origin` header)

The owner restarted the live engine at HEAD, and I confirmed `GET /api/chat/catalog` answers 200 on 8787 now. So **no
route in this table needs a restart any more**. The earlier 404 was a stale process.

| Route | Result at HEAD | Note |
|---|---|---|
| `GET /api/status` | 200 | `mock`, `paidCalls`, key presence for OPENROUTER, EXA, OPENAI, TYPESAFE only (no ANTHROPIC flag). |
| `GET /api/roster`, `/api/briefs`, `/api/runs` | 200 | |
| `POST /api/runs {brief}` | 201 `{runId}`; 400 for `_template.md` (names the unfilled sections); 404 unknown brief | No Origin needed in scripted mode. |
| `GET /api/runs/:id/events` | SSE, 57 events for a full run | Stays open: `curl` needs a timeout. |
| `GET /api/runs/:id/memo` | 200 Markdown | 404 `no memo yet` before the end. |
| `POST /api/runs/:id/resume` | 202 | On a finished run it is a no-op. |
| `GET /api/chat/catalog` | 200 | Providers anthropic, openai, **openrouter** (still listed), agents, skills. |
| `GET /api/chat/search?q=` | 200 | Keyword only. |
| `POST /api/chat` | 200, `mode: "scripted"` | Returns a plan, starts nothing. No Origin: 403. |
| `POST /api/chat/plans/:id/start` | 400 without `confirm`; 400 for a brief missing sections (names them); 201; 409 on a second start | |
| `POST /api/ask` | 200 keyword mode | No Origin: 403. |
| `GET/POST /api/glhf/*` (`status`, `runs`, `roles`, `scoreboard`, `runs/:id`, `runs/:id/cancel`) | 200 / 201 | A real model or a cloud run: 400 with the `NO_PAID_CALLS` message. `roles` runs `uv`; no Origin: 403. |
| `GET /api/bixv1/runs`, `/scoreboard` | 200 (empty in the worktree: the runs folder is not in git) | `runs/:id` 404 `no such run`. |
| `GET /api/token` | 401 without the token | By design. |

Behaviour to know: a plan from `/api/chat` is **not applied** by the board at HEAD. `board.ts` never reads `overrides.json`
(`chat/plan.ts:43` says so). I started a `quick` plan (3 members, 1 round, $1 limit); the board ran **all 8 members for 3
rounds** under the config caps. The plan's own `warnings` say "Not applied yet". Any cost reading from a plan is only the
cap, not a forecast.

## 4. The central question: what happens with `NO_PAID_CALLS=0` and no OpenRouter key

Fact checked on the live engine: the keys it sees are `ANTHROPIC` true, `OPENAI` true, `EXA` true, `OPENROUTER` false,
`TYPESAFE` false (`/api/status`, `/api/chat/catalog`). `engine/src/env.ts` skips a blank value, so an empty
`OPENROUTER_API_KEY=` is the same as unset.

Code path (read, and consistent with what the engine prints):

1. `config.ts:42`: `mockMode = paidCallsOff(env) || env.DRUG_BOARD_MOCK === "1" || !env.OPENROUTER_API_KEY`. With the switch
   off and no OpenRouter key this is `true`. `MOCK` is computed once at import.
2. `models.ts:16-21` `buildModels(roster, MOCK)`: `MOCK` true gives faux (scripted) providers. The `refusePaid` call and the
   OpenRouter registration are inside the `if (!mock)` branch and are never reached.
3. `models.ts:44` `modelFor`: `MOCK` gives `mock-<agent>`. `jev.ts` and `checkers.ts` also take `mock = MOCK`, and
   `exa.ts:54` returns fixture papers. Result: a full run with **no API call at all**, and `run.json` says `"mock": true`.

So: **turning the switch off does not produce a real board run.** (Before the owner's decision, the fix would have been an
OpenRouter key: then the board goes real and Jev uses OpenRouter. That path is being removed, see section 6.)

**Is it silent?** Partly. What tells the user:

| Place | What it says | Good enough? |
|---|---|---|
| Engine start (`server.ts:17-18`) | `(mock models)` then `Paid calls: ON (NO_PAID_CALLS=0). Runs with real models … can spend API credits.` | **Misleading.** Two lines that contradict each other. The second line is a promise the first one breaks. |
| `GET /api/status` | `mock: true, paidCalls: true` | A client must read both fields together. |
| Dashboard Board view (`BoardView.tsx:91,124,153`) | Warning pill "Scripted models" and "The engine has no OPENROUTER_API_KEY, so the board runs with scripted models." | Yes. |
| Chat plan | `paid: false`, "Scripted: costs nothing", button "Start scripted run" | Yes. |
| CLI `npm run board` | `(mock models, no keys)` on the first line | Yes, small. |
| `POST /api/runs`, `POST …/plans/:id/start` | 201 with no flag in the body (the plan route has a `note`) | **Silent** for an API client. |
| Run events | `run.started` has `mock: true` | Yes, but only if read. |

A person watching the dashboard is told. A person who reads only the engine log, or a script that calls the API, is told
`Paid calls: ON` and gets a scripted run. After `direct-providers` lands, the rule in its brief (fail loudly at start,
name the tier and key, never fall back to scripted) closes this. Verify that with the test in the block at the end.

## 5. The scripted walk-through (measured)

All in the HEAD worktree, scripted models, 8788.

| Step | Command / route | Result |
|---|---|---|
| Plan | `POST /api/chat` "Should we advance a KRAS G12C covalent inhibitor series…", effort quick | 200, `mode: scripted`, plan with 4 agents, `paid: false`, estimate $0. Warnings: brief says "not stated" for 5 sections. |
| Validate | `POST …/plans/:id/start {confirm:true, brief:"# Brief: x\n\n## Question\nhello"}` | **400** `Brief … is missing or has unfilled sections: Candidates, Target and Indication, …` (field `brief`). |
| Validate (CLI) | `node engine/src/cli.ts run board/briefs/_template.md` | exit 2, same message. |
| Start | `POST …/plans/:id/start {confirm:true}` | 201 `{kind: board, id: <runId>, scripted: true}`; a second start gives 409. |
| Direct start | `POST /api/runs {brief: "kras-g12c-hit-to-lead.md"}` | 201 `{runId}`. |
| Watch | SSE `GET /api/runs/:id/events` | 57 events: 3 rounds, 24 `member.replied`, 7 `evidence.triaged`, 20 `claim.checked`, `memo.written`, `run.finished` after 2.2 s. |
| Memo | `GET /api/runs/:id/memo` | "Go with conditions: advance CMP-0423; park CMP-0517", text fixed in `mock.ts`. |
| Verdicts | `verification_ledger.json` | 20 rows: verified 10 (jev 9, claude-code 1), unsupported 9 (jev 7, openai 2), contradicted 1. They come from the scripted word-overlap proxy, so they say nothing about science. |

No step failed. Two observations: scripted `jev` verdicts and the one scripted `claude-code` verdict only prove that the
routing and ledger code run; the plan's agent and limit choices were ignored (section 3).

### GLHF swarm, scripted (measured)

| Run (HEAD worktree, mock model, Docker sandbox) | Settings | Result |
|---|---|---|
| `POST /api/glhf/runs` solver `glhf`, model `mock`, seed 7 | default time limit (1800 s) | **done, score 1.0**, 20.4 s, 98,555 scripted tokens, 10 phases, 2 claims, 2 registered tests. |
| same, `single` | default | done, score 1.0, 11,454 tokens. |
| same, `glhf`, `timeLimit: 600` | 600 s | **done, score 0.0.** The budget planner found that the floors of the full plan need 1,124 s, chose a degraded `direct` plan (experiment, finish, report) and the scripted experiment wrote no artifact. The ledger records `budget.degraded` with the numbers. |

The 600 s result is expected behaviour of the planner plus the scripted model, not a crash. For a real run, give the swarm
at least ~1,500 s (the default 1,800 is fine). This matches the earlier mock-pair question; the owner of that item is
`mock-pair`.

## 6. What a real run would do: provider by provider

### 6a. Before the change (state today, read)

| Step | Provider and key | Outcome today |
|---|---|---|
| Board, any model turn | OpenRouter, `OPENROUTER_API_KEY` | Not reached: scripted (section 4). |
| Board, search | Exa, `EXA_API_KEY` | Not reached: fixture papers. |
| Board, triage and first-pass verdict | Jev through OpenRouter, or TypeSafe if `TYPESAFE_API_KEY` | Not reached: scripted. Latent bug, for the record: with `TYPESAFE_API_KEY` set, `jev.ts:22` asks for provider `typesafe`, but `buildModels` registers only OpenRouter and OpenAI, so Jev would throw `Jev model … is not available` (lookup returns undefined, checked offline). |
| Board, escalation | OpenAI `gpt-5-mini` (key present), Claude Code CLI | Not reached. `claude` 2.1.311 is installed and its help lists `--restricted` and `--strict-mcp-config` (checked). |
| Swarm, real model | Anthropic direct through Inspect, `ANTHROPIC_API_KEY` | **Works**: 4 recorded real runs (3 swarm, 1 single) on `anthropic/claude-sonnet-5-5`. Needs `--max-tokens`, Docker, and for `--exa` an Exa key. |
| BixBench v1 judge | OpenAI `gpt-4o` | Worked in the 3-capsule pilot (judge tokens recorded). |

### 6b. After `direct-providers` lands (conditional, nothing here is verified)

`direct-providers` is replacing OpenRouter and Jev with direct Anthropic and OpenAI calls and a cheap first-pass checker.
Until it is merged and its tests are green, treat this table as the expected path to check, not as fact.

| Order | Step | Provider and key | What could still fail for a reason other than the switch |
|---|---|---|---|
| 1 | Lead's first model call | Anthropic, `ANTHROPIC_API_KEY` | Model id not in the account. `claude-sonnet-5-5` was used for real by the swarm (recorded); every other id is only in pi-ai's bundled catalog (see section 7). **This is the first paid call.** |
| 2 | 7 members in parallel | Anthropic (strong, cheap), OpenAI (Skeptic) | OpenAI reasoning models through the Responses API have not been called by this repo's board code. Hidden reasoning tokens can multiply cost (cost.md). |
| 3 | `exa_search` per member | Exa, `EXA_API_KEY` | `exaSearch` returns **fixture papers** if the key is missing (`exa.ts:54`), even in a real run. Key is present now. Exa spend is **not counted** in `max_usd`. |
| 4 | Triage of each search result | cheap tier, direct | Rate limits: the old code fired 10 calls per search from 7 members at once. |
| 5 | First-pass claim verdict | other vendor than the claimant | `openaiCheck` returns a fake `unsupported` ("mock: …") if `OPENAI_API_KEY` is missing (`checkers.ts:40`), even in a real run. Key is present now. |
| 6 | Computed claims | `claude -p --restricted` | Unverified live. In restricted mode it cannot run code, so it will often answer `unsupported`. With `ANTHROPIC_API_KEY` in its environment it bills the API. Each check is sequential, up to 180 s. |
| 7 | Memo | lead model | none known |

Not applicable on this path: Ollama (only with `DRUG_BOARD_LOCAL_MODEL=1`), Docker (the board does not use it).

### The single answer to "what breaks first"

Today, with the switch off: **the board does not break, it just does not go real.** After `direct-providers`, the first
paid call is the lead's Anthropic call. It is the first thing that can fail for a non-switch reason (a model id the
account cannot use), and that risk is lowest for `claude-sonnet-5-5` because the swarm has used it.

## 7. Do the model ids exist? (partly unverified)

| Id | Where used | Evidence it resolves | Live check |
|---|---|---|---|
| `~anthropic/claude-opus-latest`, `~anthropic/claude-sonnet-latest`, `~google/gemini-flash-latest`, `~openai/gpt-mini-latest`, `typesafe/jev-1.14` | `board/config.yaml` at HEAD | Present in pi-ai 1.5.2's bundled OpenRouter catalog (looked up offline). | **Not possible:** OpenRouter is no longer used and its key is gone. Moot after the change. |
| `claude-sonnet-5-5` | swarm, chat, `MODEL_CHOICES` | Used in 4 real demo-case runs (3 swarm, 1 single) and the BixBench pilot (recorded). Also in pi-ai's Anthropic catalog. | Verified by use, as of those runs. |
| `claude-haiku-5-5`, `claude-opus-5-5`, `gpt-5.5`, `gpt-5-mini`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-6-luna` (classifier) | candidates for `direct-providers` | Present in pi-ai 1.5.2's bundled Anthropic and OpenAI catalogs (`getModel` returned them offline). | **Unverified.** Both providers' model-list endpoints need an API key, and I may not read `.env`. A bundled catalog is a snapshot; it does not prove the account can use the model. |
| `gpt-4o` | BixBench judge | Worked in the pilot (judge tokens recorded). | by use |

Cheapest way to settle the unverified rows, for the payer: `curl -s https://api.anthropic.com/v1/models -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01"` and `curl -s https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY"`. Both list models and are free (no inference). I did not run them. Do not paste the keys anywhere.

## 8. What I could not verify without spending (or logging in)

- That any model id other than `claude-sonnet-5-5` and `gpt-4o` resolves on the account.
- That Exa's request shape in `exa.ts` still returns 200 (the README says it was tested live; I did not repeat it).
- That `claude -p --restricted` returns a parseable verdict, and what one call costs.
- Real token counts and real cost of any board run (none was ever recorded; cost.md uses estimates).
- Prompt caching on the board's conversations (it is real on the swarm: 69-80% of input tokens were cache reads).
- That structured output (the checker's replacement for Jev) is accepted by each provider.
- The dashboard in a browser (not in scope).

## 9. To do one real run

**Conditional on `direct-providers` landing.** Do not run steps 3 onward until step 2 is all green. The payer makes one
decision (step 3). Everything before it is free. Commands run from the repo root. `NO_PAID_CALLS=0` is given **for one
command only** (the process environment wins over `.env`), so nothing stays enabled afterwards; do not put it in `.env`
unless you want it to persist.

```bash
# 0. Be in the repo, with the switch ON for everything free.
cd /Users/brendandang/AI/workspace/drug-board
export NO_PAID_CALLS=1

# 1. The change must have landed and nothing may still name the removed providers.
git status --short engine/src board/config.yaml          # review what direct-providers changed
git grep -nIi 'openrouter\|typesafe\|jev' -- engine/src board/config.yaml .env.example   # expect: no live code or config hits

# 2. Free gates. All must pass before any money is spent.
(cd engine && npx tsc --noEmit && npm test)             # expect 0 errors, 0 failures
npm run board -- board/briefs/kras-g12c-hit-to-lead.md  # scripted run: must print a memo and claim verdicts
#   (this is the control: it prints "(mock models, no keys)")

# 3. Cheap demo configuration (see docs/cost.md, "Cheapest honest demo"). Back up, then edit.
cp board/config.yaml /tmp/config.yaml.bak
sed -i '' -e 's/^  max_usd: .*/  max_usd: 1/' -e 's/^  max_rounds: .*/  max_rounds: 2/' \
          -e 's/^  max_escalations: .*/  max_escalations: 3/' -e 's/^  member_turns: .*/  member_turns: 4/' board/config.yaml
sed -i '' -e '/^  - target-biologist$/d' -e '/^  - admet$/d' -e '/^  - competitive-ip$/d' -e '/^  - moonshot$/d' board/config.yaml
git diff board/config.yaml                               # confirm only the caps and the roster changed

# 4. THE PAYER'S DECISION. Only the person who pays sets this, for this one command.
#    A real run is refused (fails loudly, naming the tier and key) if a key is missing.
NO_PAID_CALLS=0 npm run board -- board/briefs/kras-g12c-hit-to-lead.md

# 5. Check it was real, not scripted. All three must hold.
RUN=$(ls -t board/runs | grep -v '^\.' | head -1)
grep -c '"mock": true' board/runs/$RUN/run.json          # expect 0
node -e 'const s=require("./board/runs/'"$RUN"'/run.json"); console.log("usd", s.usd, "escalations", s.escalations, "mock", s.mock)'   # expect usd > 0, mock false
sed -n 1,40p board/runs/$RUN/memo.md                     # the memo
# If run.json says mock true, or usd is 0: stop. It was not a real run.

# 6. Restore the config. The switch was never exported as 0, so nothing else is on.
cp /tmp/config.yaml.bak board/config.yaml
```

A real run also writes each member's verified and contradicted claims into `board/expertise/<member>.md` (tracked files,
`memory.enabled: true`), and they are read into that member's next run. Review `git diff board/expertise` afterwards; set
`memory.enabled: false` in step 3 if you do not want that.

Expected cost of this run: about **$0.30, plausible range $0.13 to $0.95** (estimate; see docs/cost.md). The hard stop is
`max_usd: 1`, checked between rounds (one round can overshoot), and it does not count Exa.

Optional second run, the swarm on the demo case (measured $0.23 to $0.38 on `claude-sonnet-5-5`, needs Docker; this has
been done before and proves nothing new):

```bash
NO_PAID_CALLS=0 npm run glhf -- run --mode local --solver glhf --model anthropic/claude-sonnet-5-5 --max-tokens 400000 --follow
```

If a run must be stopped: `Ctrl-C`, then `npm run resume <run-id>` continues it later (only with the switch off for that
command again), or leave it paused.
