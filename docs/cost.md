# Cost and efficiency of one real research run

Written 2026-11-14, **updated 2026-11-15** for the direct-provider rewire and the new nine-role board roster, by the
`runnable` agent. No money was spent. The one-line answer is in section 0; the arithmetic is in sections 1 to 4; the
proposal is in sections 5 to 8. State described: commit `b749e38` plus the uncommitted edits to `board.ts`, `triage.ts`,
`events.ts`, `board/config.yaml` and `chat/README.md` (tested in a private worktree).

> **Later change.** The `board:` list now also has `evidence-verifier`, a seventh member. It rechecks the Scout's sources in
> every round (see `docs/drug-board.md`). The member counts and estimates in this report predate it.

> **Read this first (update, branch `fm/engine-review-cost`).** The team-review roster changed after this file was
> written. The `board:` list in `board/config.yaml` now has six members: scout, proposer, experimenter, methods-auditor,
> critic, reporter. The experimenter has Pilot, Experimenter and Reviser modes (`board/agents/experimenter.md`); there is
> no separate pilot, reviser or finisher. The scout has three search tools: `exa_search`, `literature_search` and
> `database_search` (`board/agents/scout.md`). The lead has `converse` and `write_memo`; the other members have no tool.
>
> - The team-review estimates in sections 0, 3, 4, 5, 6 and 7 model the **old 9-role roster, with `tools: []` and Exa
>   dormant**. They are superseded. They stay here as a record of the method.
> - **One real team review on today's roster is recorded**, in `README.md` ("Where things stand", commit `dc37c8d`):
>   3 Exa searches, 5 literature searches, 204 statements checked (71 supported, 28 without enough evidence, 105 not
>   checked, none contradicted), **$1.31 and 8 minutes**. At that commit `board/config.yaml` already had the six-member
>   roster and the same model tiers. It is one run. Its run folder and its tokens per model were not kept in the repo,
>   so it cannot be split by model or by step. It is the only real figure for a team review; the old $0.37 has no
>   searches, no screening of search results and no checks against retrieved sources.
> - A team review's `run.json` now has a `usage` field: tokens (input, output, cache reads, cache writes) and cost for
>   each harness model, the lead and the members (`state.usage` in `engine/src/board/board.ts`, added on this branch).
>   The first-pass and escalation checkers are kept as dollars only (`firstPassUsd`, `checkerUsd`), with no tokens. It is per model, not per member: in
>   a real run the lead and the four strong members share `claude-sonnet-5-5` (`modelFor` in `engine/src/models.ts`).
>   From now on a real run keeps the counts that can replace the estimate.
> - The swarm numbers in sections 1a and 1b are measurements. The roster change does not touch them.

**Labels.** `[measured]` comes from a recorded run in this repo. `[catalog]` is a price taken from the model catalog
bundled in `@earendil-works/pi-ai` 1.5.2 (`engine/node_modules/.../providers/*.models.js`); it is a snapshot, not a live
price list, and I could not check it against the providers without a key. `[estimate]` is my own number and the
assumptions are written next to it. `[memory]` is from my memory of a public price and must be checked.
Dollar amounts are US dollars per million tokens ("Mtok") unless said otherwise.

## 0. Summary

| Item | Value | Basis |
|---|---|---|
| One swarm run on the demo case, `claude-sonnet-5-5` | **$0.23** (200K-token cap, score 1.0) to **$0.38** (Exa on) | `[measured]` tokens, `[catalog]` prices (section 1) |
| One single-agent run, same case | **$0.027** | `[measured]` + `[catalog]` |
| One board run, **today's 6-member roster** (the scout searches) | **$1.31**, 8 minutes: one real run | `[measured]` once, recorded in `README.md`; its tokens per model were not kept. The `usage` field in `run.json` keeps them from now on |
| One board run, **old 9-role roster, superseded** (no tools, Sonnet lead and strong, Haiku cheap, `gpt-5-mini` critic), 3 rounds | **about $0.37 with prompt caching, $0.49 without**; low-to-high $0.25 to $0.74 cached, $0.33 to $1.17 uncached | `[estimate]`, made before any real board run (section 3) |
| Of that (old roster), the five "strong" roles | about **three quarters** ($0.277 of $0.373) | `[estimate]` |
| Lead on Opus instead of Sonnet (old roster) | **+$0.08** (cached) to **+$0.12** (uncached) per run | `[estimate]` |
| Strong tier on Haiku instead of Sonnet (old roster) | **$0.11** per run (**-70%**), quality effect unmeasured | `[estimate]` |
| Effect of removing Jev | **under $0.01 per run on the old roster**: no member had a search tool, so there was no triage, and only claims about the brief were checked first-pass (section 4). The old estimate with search (7 searching members) was +$0.03 to +$0.10 per run. Today the scout searches, so "under $0.01" no longer holds; not re-estimated | `[estimate]` |
| Cheapest honest board run (section 7), old roster, superseded | **about $0.10**, range **$0.05 to $0.25** (4 roles, 2 rounds); **about $0.13** if the scout also searches | `[estimate]` |
| One research answer, `quick` (Research screen) | **$0.074** and 30.9 s, one real answer; the rest are estimates | `[measured]` once, in `docs/research-answer.md` (section 10) |

Three findings for the old roster (the second no longer holds):

1. **Opus for the lead is not the money problem.** The lead makes 3 to 4 model calls and writes one memo, about 45K input and
   2K output tokens. It is 21 to 22% of a run. The money is in the **five "strong" roles** (proposer, experimenter, methods
   auditor, reviser, reporter).
2. **What a real board run produces today is narrow.** No board member has a tool (`tools: []` in every
   `board/agents/*.md`, and the experimenter's own prompt says "You cannot run code on this board yet"). So a real run has no
   retrieved evidence and no computation: literature claims come back `unsupported` ("source is not in the screened evidence
   pool", no model call), computed claims are `unchecked`, and only claims about the brief's own tables can be `verified`. The
   dollar cost is low *because* it does little research. See section 7. **Superseded:** the scout now searches, so a
   literature claim that cites a source it found can be checked.
3. **The biggest swing in the checker is a setting, not a model**, and the rewire already handles it: see section 4.

## 1. What was measured

### 1a. Swarm and single agent on the demo case (real model, `glhf/runs/real/*`)

Token splits are from the Inspect logs in each run folder (`logs/*.eval`, header `stats.model_usage`). Prices
`[catalog]` for `claude-sonnet-5-5`: input $2, output $10, cache read $0.10, cache write $2.50.

| Run | Solver, settings | Score | Seconds | Input (uncached) | Output | Cache write | Cache read | Total tokens |
|---|---|---|---|---|---|---|---|---|
| `single1` | single | 1.0 | 19.2 | 10 | 1,246 | 5,388 | 12,000 | 18,644 |
| `budget2` | swarm, `--max-tokens 200000`, no Exa | 1.0 | 148.8 | 68 | 12,106 | 36,100 | 140,337 | 188,611 |
| `swarm1` | swarm, `--max-tokens 4000000`, Exa on | 1.0 | 191.7 | 76 | 19,167 | 68,438 | 196,851 | 284,532 |
| `budget1` | swarm, `--max-tokens 70000` | **0.0** | 71.9 | 26 | 6,778 | 15,042 | 54,210 | 76,056 |

Arithmetic (cost = in x 2 + out x 10 + cache read x 0.1 + cache write x 2.5, per million):

| Run | Calculation (tokens x $/Mtok, in micro-dollars) | Cost | Without caching (all input at $2) |
|---|---|---|---|
| `single1` | 10x2 + 1,246x10 + 12,000x0.1 + 5,388x2.5 = 20 + 12,460 + 1,200 + 13,470 = 27,150 | **$0.0272** | $0.0473 |
| `budget2` | 68x2 + 12,106x10 + 140,337x0.1 + 36,100x2.5 = 136 + 121,060 + 14,034 + 90,250 = 225,480 | **$0.2255** | $0.4741 |
| `swarm1` | 76x2 + 19,167x10 + 196,851x0.1 + 68,438x2.5 = 152 + 191,670 + 19,685 + 171,095 = 382,602 | **$0.3826** | $0.7224 |
| `budget1` | 26x2 + 6,778x10 + 54,210x0.1 + 15,042x2.5 = 52 + 67,780 + 5,421 + 37,605 = 110,858 | $0.1109 | $0.2063 |

Reading it:

- **Prompt caching is real on this provider and it halves the bill.** 69 to 80% of the input tokens were cache reads
  (`swarm1`: 196,851 / (76 + 196,851 + 68,438) = 74%). Without it `swarm1` would cost $0.72, not $0.38.
- **Output is half the cost** (46 to 61%) although it is only 7% of the tokens. Short replies save more than short prompts.
- The swarm used **15.3x the tokens and 14.1x the money** of the single agent for the same score (284,532 / 18,644 and
  $0.3826 / $0.0272). One run each; it shows cost, not that either is better.
- `--max-tokens 70000` is below what the swarm needs (score 0.0); 200,000 was enough once. The README's example uses
  `--max-tokens 4000000`. Real use was 284K, but the hard stop is 2x the cap (`HARD_STOP`, `tracker.ts`), so the example
  allows up to 8M tokens. At the measured $1.34 per million total tokens (382,602 / 284,532) that is a ceiling of about
  **$10.7**. With `--max-tokens 400000` the ceiling is 800K x $1.34 = **$1.07**.

Per-phase share of swarm tokens (`swarm1`, differences of the ledger's cumulative counts, cache reads included):

| Phase | Tokens | Share |
|---|---|---|
| scout | 37,825 | 13.3% |
| propose | 22,855 | 8.0% |
| pilot | 34,113 | 12.0% |
| experiment | 33,285 | 11.7% |
| audit 1 | 24,175 | 8.5% |
| critique 1 | 80,705 | **28.4%** |
| report | 51,574 | 18.1% |

The critique is the independent verdict machinery. It is the last thing to cut.

### 1b. BixBench v1 pilot (real model, `glhf/bixbench_v1/runs/pilot-sonnet-5-5/report.json`)

| | Single | Swarm | Ratio |
|---|---|---|---|
| Questions / capsules | 8 / 3 | 8 / 3 | |
| Correct | 4 | 4 | |
| Tokens `[measured]` | 317,110 | 532,394 | **1.68x** |
| Seconds `[measured]` | 153.2 | 251.3 | 1.64x |
| Cost as the report states it | $0.38 | $0.66 | 1.74x |
| Per question (report) | $0.047 | $0.083 | |
| Extrapolated to 205 questions (report) | **$10.0** | **$17.0** | |

Caveats. The report prices tokens at $3 / $15 / $0.30 / $3.75 (`report.py:15`), not the `[catalog]` Sonnet 5.5 rates
above ($2 / $10 / $0.10 / $2.50). At the catalog rates the same token mix costs about two thirds of that, roughly **$0.25
and $0.44**, and **$6.7 and $11** for 205 questions `[estimate]`. The 205-question numbers assume that 8 questions in 3
capsules are typical; they are not (capsule sizes vary 10 MB to 481 MB). Treat them as +/- 3x. The pilot ran the older
swarm; the present one has no real result.

### 1c. What the board runs recorded

All 12 older runs under `board/runs` are scripted (`usd: 0`) and used the earlier 8-member drug roster with search tools. I
also ran one scripted run on the nine-role roster of that time (below; superseded since). Scripted runs give **counts of calls**, never token counts
or dollars.

| Item | Older 8-member roster (12 runs, identical) | 9-role roster, superseded (1 run, `b749e38` + edits) |
|---|---|---|
| Rounds (2 working + 1 final) | 3 | 3 |
| Member replies | 24 | **27** |
| Searches / results triaged | 7 / 28 (4 distinct URLs) | **0 / 0** (`tools: []`) |
| Claims checked | 20 (12 distinct member+text; 8 repeats in round 2) | 19 (11 distinct; 8 repeats) |
| Claim kinds | literature, brief, computed | **brief 17, computed 2**, literature 0 |
| First-pass calls (one per member, round, source) | 19 | 11 member-round groups, fewer with carry-over (about 7) |
| Escalations | 3 | 2 (scripted `openai`) |

## 2. Prices used

`[catalog]`, per Mtok: input / output / cache read / cache write. Haiku 5.5 is 5x dearer above 100K context (not reached).

| Model | Input | Output | Cache read | Cache write | Used for |
|---|---|---|---|---|---|
| `claude-opus-5-5` | 4 | 20 | 0.20 | 5 | optional lead (comment in `board/config.yaml`) |
| `claude-sonnet-5-5` | 2 | 10 | 0.10 | 2.50 | strong tier; swarm (measured) |
| `claude-haiku-5-5` | 0.10 | 0.50 | 0.01 | 0.125 | cheap tier (today the scout; the old roster also had pilot and finisher); first-pass checker for the critic's claims |
| `gpt-5.5` | 5 | 30 | 0.50 | none | strong rival |
| `gpt-5.4` | 2.5 | 15 | 0.25 | none | |
| `gpt-5.4-mini` | 0.75 | 4.50 | 0.075 | none | rival |
| `gpt-5-mini` | 0.25 | 2 | 0.025 | none | rival tier (the critic); literature escalation checker |
| `gpt-4o-mini` | 0.15 | 0.60 | 0.075 | none | first-pass checker for every other member's claims (no reasoning mode) |
| `gpt-4o` | 2.5 | 10 | 1.25 | none | judge in the BixBench pilot; fallback first-pass model |
| `gpt-5.4-nano` | 0.20 | 1.25 | 0.02 | none | checker |
| `gpt-6-luna` (OpenAI classifier) | 0.10 | 0 | 0.01 | 0.125 | checker option |

Exa: `board/config.yaml` now assumes **$0.007 per search** (`exa_usd_per_search`), with the comment "measured once, 2 live
searches, $0.014": a sample of two. I could not check it. The skill under `.agents/skills/build-with-exa` gives no price. Claude Code (`claude -p`) cost per
check is **unknown**; `checkers.ts` reads `total_cost_usd` from its JSON output when there is one.

## 3. Cost of one board run `[estimate]`

> **Superseded: old 9-role roster.** This section models the roster before the change described at the top. It assumes
> no tools and no searches. Today the scout searches, its results are screened by the first pass, and literature claims
> can be checked against them. None of that is in these numbers. Do not quote $0.37 as the cost of a team review today:
> the one real run recorded on today's roster cost $1.31 (`README.md`).

No real board run existed when this was written, so this is a model, not a measurement. The model was in `/tmp/costmodel/model.py` and
`run5.py`. These scripts are not kept in the repo. The logic is below so it can be redone by hand.

### Structure (read from `engine/src/board/board.ts`, `agents.ts`, `board/agents/*.md`, `board/config.yaml`)

- One lead and **nine members**, in the order `scout, proposer, pilot, experimenter, methods-auditor, critic, reviser,
  finisher, reporter`. Tiers come from each agent's file: `strong` (Sonnet) is proposer, experimenter, methods auditor, reviser,
  reporter (5); `cheap` (Haiku) is scout, pilot, finisher (3); `rival` (`gpt-5-mini`, OpenAI) is the critic (1); the lead is on
  Sonnet. The vendor split holds: lead Anthropic, critic OpenAI.
- **No member has a tool.** No search, no code. Every call is one reply from text; there are no tool results in the context.
- Instructions: 1,700 tokens for the lead and 1,112 to 1,172 for each member (characters / 4; characters measured).
- Each round the lead broadcasts; all nine reply; from round 2 each gets a **digest of all nine replies** (`peerDigest`).
  A member keeps one conversation for the run, so context grows by the digest each round.

### Assumptions (three scenarios)

| Parameter | Low | Mid | High |
|---|---|---|---|
| Rounds (last is the final-positions round) | 3 | 3 | 4 |
| Member reply, tokens | 400 | 700 | 1,000 |
| Digest per member reply (reply + verdict lines) | 475 | 775 | 1,100 |
| Final-round reply | 80 | 100 | 120 |
| Lead memo | 1,200 | 1,200 | 1,200 |

Cost of a call with caching: `prefix x cache-read + new tokens x cache-write (or input, where there is no write price) +
output x output price`. Without caching: `(prefix + new) x input + output x output price`. "Cached" assumes the 5-minute cache
holds between a member's turns. The swarm showed 69 to 80% cache reads, but **the board's hit rate is unmeasured**.

Worked example, mid scenario, one strong member on Sonnet (no tools, so one call per round). Digest = 9 x 775 = 6,975.

| Round | Prefix (cache read $0.10) | New (cache write $2.50) | Out ($10) | Cost cached | Cost uncached |
|---|---|---|---|---|---|
| 1 | 0 | 1,300 (instructions 1,100 + lead message 200) | 700 | $0.0103 | $0.0096 |
| 2 | 2,000 | 7,175 (digest + message) | 700 | $0.0251 | $0.0254 |
| 3 (final) | 9,875 | 7,175 | 100 | $0.0199 | $0.0351 |
| | | | | **$0.0553** | |

Check, round 2: 2,000 x 0.10 + 7,175 x 2.50 + 700 x 10 = 200 + 17,938 + 7,000 = 25,138 micro-dollars = $0.0251. Five strong
members make 5 x $0.0553 = **$0.277**. Note that in round 1 caching costs slightly more (a write premium) and from round 3 it
pays.

### Result (old roster's tier mapping, catalog prices)

| Scenario | Input tokens | Output tokens | Uncached | Cached |
|---|---|---|---|---|
| Low | 202K | 9.9K | $0.33 | $0.25 |
| **Mid** | **299K** | **15.4K** | **$0.49** | **$0.37** |
| High | 758K | 30.3K | $1.17 | $0.74 |

Mid, by tier:

| Tier | Agents | Cached | Share |
|---|---|---|---|
| lead (Sonnet) | 1 | $0.080 | 21% |
| strong (Sonnet) | 5 | $0.277 | **74%** |
| cheap (Haiku) | 3 | $0.008 | 2% |
| rival (`gpt-5-mini`) | 1 | $0.007 | 2% |
| **Models total** | 10 | **$0.373** | |

The critic is on `gpt-5-mini`, which cannot switch reasoning off; hidden reasoning there is a few thousand tokens at
most over 3 calls (1,500 x 3 x $2 per Mtok = $0.009 if it used 1,500 a call).

On top of the models, mid scale:

| Cost | Value | Basis |
|---|---|---|
| Exa | **$0** | dormant: no member has `exa_search` |
| First-pass checks | **$0.002 to $0.007** | 7 to 27 calls at about 800 in and 200 out on `gpt-4o-mini` ($0.0004 a call) or Haiku |
| OpenAI escalations | $0.001 each | 1,200 in, 300 out on `gpt-5-mini` |
| Claude Code escalations | **$0** | computed claims are recorded `unchecked`, the checker is not called |
| **Run total** | **about $0.38 cached, $0.50 uncached** | |

That is far under `max_usd: 5`. Sanity check: the swarm's demo run, a different workload of similar token volume, cost
$0.23 to $0.38 on Sonnet. Same order of magnitude; it supports the order, not the precise number.

## 4. What removing Jev does to the cost

Jev was a classifier at about $0.042 per Mtok of input and nothing for output (`[catalog]`, `typesafe/jev-1.14`). It is
replaced (`engine/src/board/triage.ts`, `providers.ts`) by a cheap model that answers in strict JSON and must quote the source; code
accepts "verified" only if the quote is in the source and contains the claim's numbers. The checker is always from the other
vendor than the member: Haiku for the critic's claims, `gpt-4o-mini` for everyone else's.

> **Superseded in part.** "Today" below means the old roster. The scout now has the search tools, so search results
> are screened and claims are checked against retrieved sources: the case "if a member gets the search tool back" is
> the current one, with one searching member, not seven. One more correction: the screening is one call on the cheap
> model for all new results of one search (`triage` in `engine/src/board/triage.ts`, called from `poolEvidence` in
> `engine/src/board/board.ts`), not one call per result. Not re-estimated.

**Today the effect is almost nothing**, for two reasons that follow from the roster:

- **Triage runs per search result. No member searches**, so there are 0 triage calls (the old roster made 28 in the scripted
  runs, and would make 140 to 490 for real, at 10 Exa results a search).
- **Claim checks run only for claims that cite a source in the pool.** With no search the pool is empty: a `[literature]`
  claim costs nothing (it is recorded `unsupported`), a `[computed]` claim costs nothing (`unchecked`), and a `[brief]` claim
  is checked against the brief's Candidates and Available Data (about 300 tokens of source). One call covers all the
  claims of one member in one round.

| First-pass calls | Count | Cost on `gpt-4o-mini` | On Haiku |
|---|---|---|---|
| Scripted run, one per member-round | 11 | $0.0026 | $0.0020 |
| Same, with carry-over of repeats (-42%) | about 7 | $0.0017 | $0.0013 |
| 9 members x 2 rounds | 18 | $0.0043 | $0.0032 |
| 9 members x 3 rounds (high) | 27 | $0.0065 | $0.0049 |
| Jev, for comparison | | about $0.0002 | |

So the first pass costs about **$0.002 to $0.007 per run**, against about $0.0002 for Jev: ten to thirty times more per call,
but under a cent in total.

**If a member gets the search tool back** (the scout, say), the old numbers return. Triage is then a call per Exa result
(10 per search) and claim checks run against retrieved sources. At the old roster's scale (7 searching members, 28 searches,
280 triage calls and 50 claim calls) `[estimate]`:

| Checker | Reasoning off | +1,000 hidden reasoning tokens a call | After memo and batching |
|---|---|---|---|
| Haiku | $0.036 | $0.20 | $0.008 |
| `gpt-5-mini` | $0.106 | $0.77 | $0.024 |
| `gpt-6-luna` (OpenAI classifier, no output cost) | $0.024 | $0.024 | $0.006 |

The rewire handles the dangerous setting: `quietReasoning` (`triage.ts`) reads each model's own catalog entry, asks for nothing
where "off" is supported (Haiku), asks for `minimal` where it is not (`gpt-5-mini`), and the first-pass default `gpt-4o-mini`
has no reasoning mode at all. **Unverified without a call:** that the providers honour it. `usage.reasoning` on the first real
reply will show.

Avoidances, with what is already done and what the scripted runs show:

| Avoidance | Status | Effect on the recordings |
|---|---|---|
| Memoise triage by URL | done (`board.ts` evidence pool) | old roster: 28 triage calls on 4 distinct URLs, so up to -86% if repeated results are as common in real searches (unknown) |
| Do not re-check the same member's repeated claim in a later round | **done** (`carry` in `checkClaims`) | 8 of 19 claims in the current recording are repeats |
| Batch claims across members that cite the same source, grouped by vendor | not done | old roster: 19 calls -> 8 (-58%); for the brief-only claims today, 11 -> about 4 |
| Concurrency limit on the cheap model | **done** (`MAX_CONCURRENT = 4`) | removes the 70-way burst |
| Lexical pre-filter before triage | not done | not measurable without a live search |

None of these matters in dollars today: the whole first pass is under a cent.

## 5. Model tiers

The vendor split is kept as a correctness property, not a cost line: **the lead (Anthropic) and the critic (OpenAI) are on
different vendors, and no claim is first-checked by its own claimant's vendor.** `board/config.yaml` says so in its comments.

What the config did for the old roster, with cost per tier `[estimate]`, mid scenario, cached. Today, by `model:` in
`board/agents/*.md`: strong is proposer, experimenter, methods-auditor and reporter (4); cheap is the scout; rival is the
critic; the lead is on `models.lead`. The costs below were not redone for that.

| Tier | Agents | What it does | Model now | Cost / run | What is lost by going a tier down |
|---|---|---|---|---|---|
| lead | lead scientist | Frames the decision, tasks the roles, reads nine replies with verdicts each round, writes the memo. 4 calls. | `claude-sonnet-5-5` (comment shows how to raise it to Opus) | $0.080 (Opus $0.161) | Opus would synthesise nine replies and spot weak agreement better; unmeasured. The lead cannot change a verdict: code computes them. Risk: a worse memo, and a wrong summary of the ledger counts. **Going up costs +$0.08.** Going down to Haiku would save $0.07 but the memo is the product. |
| strong | proposer, experimenter, methods auditor, reviser, reporter | The reasoning and writing: plan, claims, audit, revision, final draft. 74% of the cost. | `claude-sonnet-5-5` | $0.277 | Haiku for all five: **$0.014, -$0.26 per run (-70% of the run)**. These roles make the claims that get checked and must follow the `CLAIMS` format (a claim without its line counts as unsupported). A weaker model gives fewer or poorer claims. **Not measured.** Test it once (section 7). |
| cheap | scout, pilot, finisher | Inventory, small test, completeness check. | `claude-haiku-5-5` | $0.008 | Already the cheapest Anthropic model. Nothing below it in the catalog worth using. |
| rival | critic | Attacks the conclusions. 3 calls. | `gpt-5-mini` (comment: `gpt-5.5` is the stronger option) | $0.007 | `gpt-5.5` would cost $0.129 (+$0.12) for a stronger attacker. It is the role that supplies independence, so spend here before anywhere else. It must stay off the lead's vendor. |
| first-pass checker | every claim about the brief; every search result if search returns | Strict JSON, quote must be in the source. | Haiku for the critic's claims, `gpt-4o-mini` for the rest, reasoning off | $0.002 to $0.007 | Jev gave calibrated probabilities; this gives a category and a quote. Verified means "a different vendor's model found a real passage with the claim's numbers". It does not prove the passage supports the claim (`triage.ts` says so). |
| escalation | contested literature claims | A model of the other vendor reads the evidence. | keep | $0.001 each (on `gpt-5-mini`) | **Fixed since.** `escalationModel` (`engine/src/providers.ts`) picks the OpenAI checker model (`checkers.openai_model`) for a Claude member's claim and the strong-tier Claude model for an OpenAI member's claim (the critic). `engine/src/board/board.ts` calls it for each contested literature claim; with no model of another vendor the claim is recorded `unchecked`. An escalation of the critic's claim now runs on `claude-sonnet-5-5`, dearer per token than `gpt-5-mini` (section 2); not re-estimated. |
| escalation, computed | computed claims | `claude -p --restricted` | **not called**: recorded `unchecked` | $0 | A computed claim is never verified by this board. |

Alternatives, whole run, mid, `[estimate]`:

| Mapping | Cached | Uncached |
|---|---|---|
| **Old roster** (Sonnet lead and strong, Haiku cheap, `gpt-5-mini` critic) | **$0.373** | **$0.493** |
| Opus lead | $0.453 | $0.615 |
| Haiku strong, Sonnet lead | $0.110 | $0.160 |
| Critic on `gpt-5.5` | $0.494 | $0.666 |

The current mapping is already the cheaper one the earlier plan proposed. The single large saving left, 70%, is Haiku for the
strong tier, and I cannot say what it costs in quality without running both. Plan: run the demo once on the current mapping and
once with `strong: claude-haiku-5-5`, and compare the number and quality of checked claims. Cost: about $0.10 + $0.04.

## 6. Biggest avoidable spend in the hot path

Ranked by dollars, mid scale, `[estimate]` unless noted, for the old roster. The earlier hazards were fixed by the rewire;
what remains is smaller.

| # | What | Cost | Status / how to cut | Saving |
|---|---|---|---|---|
| 1 | **The strong tier's context.** Five roles, each resending a growing context; the digest of nine replies goes to nine members each round (about 63K tokens a round). | $0.277 of $0.373 | Send a member only the other roles' claims with verdicts, not their full replies; or shorten replies. Cheap while cached, $0.35 when not. | $0.03 to $0.10 |
| 2 | **Strong tier on Sonnet at all.** | $0.277 | Haiku. Quality unmeasured. | up to $0.26 |
| 3 | **Opus lead** (optional). | +$0.08 | Stay on Sonnet. | $0.08 |
| 4 | **Rounds.** `max_rounds: 4`; a high run is 4 rounds and costs 2x the mid one ($0.74). | | The lead decides; the gate refuses a round whose estimated cost would pass `max_usd`. A demo caps at 2. | up to 50% |
| 5 | **Claude Code on computed claims**: no longer a cost. Computed claims are `unchecked`. The old design would have paid $0.1 to $0.4 and up to 36 minutes. | $0 | done | |
| 6 | **Exa uncounted**: fixed. Searches now count in `max_usd` and `daily_usd`; per-run cap 20; lifetime ledger with a $40 ceiling. No longer dormant: the scout now searches. | not measured | done | |
| 7 | **Checker reasoning**: handled by `quietReasoning`. | | done; verify with `usage.reasoning` | |
| 8 | **Plan limits not applied**: now applied for members and limits (measured: a quick plan ran 2 members for 1 round). **Not applied: model tier and search cap**, as the plan's own warning says. | | partly done | |
| 9 | **Repeated claims**, triage memo | under $0.003 | done | |

Where the first pass does not short-circuit: it checks each claim about the brief once per member-round (carry-over aside).
`[brief]` claims are the only ones it can verify, because the source is the brief's own table.

## 7. The cheapest run that still demonstrates the product honestly

**First, what a real run demonstrates today.** With `tools: []` for every role the board is nine models reasoning about one
brief. It shows: real deliberation across two vendors; the claim ledger; verdicts that code computes; an independent
first-pass check with a quoted source; escalation and the spend gate; a memo. It does **not** show: retrieval of evidence (no
search), any computation (no code tool), or verification of a literature claim (they are `unsupported`). "Verified" means a
different vendor's model found the claim's numbers in the brief's own table. The brief's table is "illustrative
placeholders", so the verified claims restate placeholders. That is a demonstration of the machinery and nothing about
the drug. Say so when showing it.

> **Superseded: old 9-role roster.** Demo A and Demo B were planned for the old roster. Demo B's change has been made:
> the scout now has `exa_search` and two free search tools. Neither figure below ($0.10, $0.13) was checked by a real
> run, and neither describes today's roster. The one real run recorded (`README.md`) used the full six-member roster and
> cost $1.31. A real run now also needs `EXA_API_KEY`: `startRun` in
> `engine/src/board/board.ts` asks for it when a roster member has `exa_search` (`missingKeys` in
> `engine/src/providers.ts`). The current steps for one real run are in
> [readiness.md section 9](readiness.md#9-to-do-one-real-run).

### Demo A, as the board was then

| Choice | Value |
|---|---|
| Brief | `board/briefs/kras-g12c-hit-to-lead.md` (title says "illustrative data") |
| Roster | scout, proposer, critic, reporter (edit `board:` in `config.yaml`, or accept a quick plan, which now applies its members) |
| Models | the current tiers; keeps the vendor split (critic on OpenAI) |
| Caps | `max_rounds: 2`, `max_usd: 1`, `max_escalations: 3`, `member_turns: 4` |
| Keys | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`. No Exa key needed |

| Term | Low | Mid | High |
|---|---|---|---|
| Models: lead + 4 roles, 2 rounds, cached | $0.062 | $0.082 | $0.103 |
| (same, uncached) | $0.075 | $0.096 | $0.117 |
| First-pass checks (about 4 to 8 calls) | $0.001 | $0.002 | $0.004 |
| OpenAI escalations (0 to 3) | $0 | $0.002 | $0.003 |
| Exa, Claude Code | $0 | $0 | $0 |
| **Total** | **$0.06** | **$0.09** | **$0.13** |

I widen that to **about $0.10, range $0.05 to $0.25**: the token counts are modelled (no real board run exists), the cache hit
rate is unmeasured, and real replies may be longer than 700 tokens (a reply of 2,000 tokens a role doubles the output cost).

### Demo B, if the owner gives the scout the search tool

This is the only way a real run shows the product's core promise, a claim checked against retrieved evidence. It needs
`tools: [exa_search]` in `board/agents/scout.md` (not mine to edit) and `EXA_API_KEY`. The scout's prompt is written for a data
case ("Lists the inputs, the sample mapping and the installed tools"), so its prompt would need a line telling it to search the
literature for the brief's key questions. Cost on top of Demo A, with 3 searches: Exa 3 x $0.007 = $0.021, triage of 30
results on Haiku about $0.003, first-pass checks against retrieved sources about $0.002. **About $0.13 in total, range $0.07
to $0.30.** The Exa price is the rewire's assumption ($0.007, from two live searches).

### What the caps guarantee

`max_usd` now counts models, first-pass, checkers and Exa. `gateRound` refuses a round when the **last round's cost would pass
the cap**, and no paid call is made after the cap (`capReached`). Round 1 cannot be predicted, so it is the one round that can
overshoot. At these prices that is a few cents; **the worst case is bounded by `max_usd` plus the cost of round 1**, about
$1.15 for the cap of $1 in the demo.

What to look at in the result: `board/runs/<id>/verification_ledger.json` (each claim, its checker, `checkedBy`, `quoteFound`,
the quoted passage), `run.json` fields `usd`, `firstPassUsd`, `checkerUsd`, `costEstimated`, and `usage` (tokens and cost
for each harness model: the lead and the members; the checkers are in dollars only). After the run, **replace the estimates in this file** with the real token counts, cache reads and
searches.

## 8. Cap and accounting notes

- `usdOf` charges `fallback_usd_per_mtok` (15) only when a model reports tokens and a cost of 0. Catalog models have costs, so it
  will not fire; if an id were missing from the catalog Haiku would be over-counted about 30x (15 / 0.5), so the cap trips early:
  the safe direction. `costEstimated: true` marks it.
- Cache pricing is inside `cost.total`, so the cap follows real cache behaviour.
- The daily cap (`daily_usd: 20`) counts a run in flight at its full `max_usd`.
- Swarm: the engine's daily token cap is `GLHF_DAILY_TOKENS`, default 20,000,000, about $27 at the measured $1.34 per million.
- The README's swarm examples now use `--max-tokens 400000` (ceiling about $1.07), as measured here.

## 9. What could not be verified without spending

- Any real board token count or cache hit rate. The one real run (`README.md`, $1.31) kept no tokens per model; the
  `usage` field keeps them from now on.
- That the catalog prices are the accounts' prices.
- That the providers honour the reasoning setting (`usage.reasoning` on the first reply will show), and that `claude-haiku-5-5`,
  `gpt-5-mini` and `gpt-4o-mini` are available to the keys. Only `claude-sonnet-5-5` and `gpt-4o` are recorded as used for real; the
  one real team review (`README.md`) kept no record per model.
- That the board's members write the `CLAIMS` section on a real model as reliably as the scripted ones do. Shown once: the
  real run in `README.md` checked 204 statements.
- Exa's real price per search (the config's $0.007 is from two searches).
- Quality loss from any lower tier; nothing in the repo measures it.

## 10. The research answer (Research screen)

The research answer is a different path from the team review: one question typed on the Research screen
(the Search screen in older documents; `POST /api/research`). Its cost is in [research-answer.md](research-answer.md#what-one-answer-costs-estimate-not-measured).
In short: one real `quick` answer was measured, 30.9 seconds and $0.074. All other figures there are estimates
(expected about $0.05 for `quick` and about $0.07 for `standard`). The limits per answer are $0.15 (`quick`) and $0.60
(`standard`), under `research:` in `board/config.yaml`. In Real mode a direct answer needs the engine started with
`RESEARCH_PREVIEW=1` ([readiness.md section 10](readiness.md#10-direct-answers-on-the-research-screen)).
