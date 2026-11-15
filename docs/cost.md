# Cost and efficiency of one real research run

Written 2026-11-14 by the `runnable` agent. No money was spent. The one-line answer is in section 0; the arithmetic is
in sections 1 to 4; the proposal is in sections 5 to 8.

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
| One drug-board run, current config shape, 8 members, 3 rounds | **about $0.50** with prompt caching, **about $1.00** without; plausible $0.30 to $3.00 | `[estimate]`: no real board run has ever been recorded (section 3) |
| Same, proposed tiers (section 5) | **about $0.40** (-19% cached, -25% uncached) | `[estimate]` |
| Board run that is cheapest and still honest (section 7) | **about $0.30**, range **$0.13 to $0.95**, hard stop about $1.30 | `[estimate]` |
| Effect of removing Jev (section 4) | first-pass checks cost **3x to 9x more per call**, but the total is **+$0.03 to +$0.10 per run** if the checker's hidden reasoning is off, and **+$0.20 to +$0.80 if it is on** | `[estimate]` |
| Lead on Opus instead of Sonnet | **+$0.07 per run** (cached) to **+$0.11** (uncached), about 15% of a run (Sonnet lead $0.073 against Opus $0.146, cached) | `[estimate]` |

Two findings that change the plan:

1. **Opus for the lead is not the money problem.** The lead makes 4 model calls and writes one memo, about 47K input
   and 2K output tokens. At catalog prices (Opus $4/$20, Sonnet $2/$10) that is 21% (uncached) to 29% (cached) of a run. The money is in the
   **four "strong" members**, which are about 60% of a run, cached or not.
2. **The biggest swing is a setting, not a model.** Every candidate checker model in the catalog is marked
   `reasoning: true`. Hidden reasoning tokens are billed as output. If the checker runs with default reasoning, the first-pass
   checks cost about 6x to 7x more than with reasoning off (an estimate that assumes 1,000 hidden tokens a call). Turn it off and cap output tokens.

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

All 12 runs under `board/runs` are scripted (`usd: 0`, `mock: true` where the field exists). They have the structure of
the scripted script, not of a real model, so they give **counts of calls**, never token counts or dollars. Per run
(identical in all 12):

| Item | Count |
|---|---|
| Rounds (2 working + 1 final) | 3 |
| Searches (7 of 9 agents have `exa_search`) | 7 |
| Search results triaged | 28 (only **4 distinct URLs**; 3 kept, 1 dropped each time) |
| Claims checked | 20 (**12** distinct member + text; 8 are repeats from round 1 in round 2) |
| First-pass checks that reached Jev | 19 calls (one per member, round and source): 17 verdicts + 2 escalated to OpenAI |
| Computed claims | 1, sent straight to the Claude Code checker |
| Escalations used | 3 of the cap of 12 |
| Verdicts (older runs) | verified 15, contradicted 1, unsupported 4 |

## 2. Prices used

`[catalog]`, per Mtok: input / output / cache read / cache write. Haiku 5.5 is 5x dearer above 100K context (not reached).

| Model | Input | Output | Cache read | Cache write | Used for |
|---|---|---|---|---|---|
| `claude-opus-5-5` | 4 | 20 | 0.20 | 5 | lead (today's shipped intent) |
| `claude-sonnet-5-5` | 2 | 10 | 0.10 | 2.50 | strong tier; swarm (measured) |
| `claude-haiku-5-5` | 0.10 | 0.50 | 0.01 | 0.125 | cheap tier, checker |
| `gpt-5.5` | 5 | 30 | 0.50 | none | strong rival |
| `gpt-5.4` | 2.5 | 15 | 0.25 | none | |
| `gpt-5.4-mini` | 0.75 | 4.50 | 0.075 | none | rival |
| `gpt-5-mini` | 0.25 | 2 | 0.025 | none | rival, escalation checker (config today) |
| `gpt-5.4-nano` | 0.20 | 1.25 | 0.02 | none | checker |
| `gpt-6-luna` (OpenAI classifier) | 0.10 | 0 | 0.01 | 0.125 | checker option |
| Shipped aliases through OpenRouter | opus 4/20, sonnet 2/10, gemini-flash 0.75/3.75, gpt-mini 0.75/4.50 | | | | `board/config.yaml` at HEAD; OpenRouter is being removed |

Not in the catalog and from `[memory]`: Exa search is about **$5 to $7 per 1,000 searches**, plus a fee for page contents.
The skill under `.agents/skills/build-with-exa` gives no price. Check `exa.ai/pricing`. Claude Code (`claude -p`) cost per
check is **unknown**; `checkers.ts` reads `total_cost_usd` from its JSON output when there is one.

## 3. Cost of one board run `[estimate]`

No real board run exists, so this is a model, not a measurement. The model is in `/tmp/costmodel/model.py`; the logic is
below so it can be redone by hand.

### Structure (read from `engine/src/board.ts`, `agents.ts`, `board/agents/*.md`)

- 1 lead and 8 members. Tiers: lead 1 (`lead`), `strong` 4 (target biologist, medicinal chemist, toxicologist, moonshot),
  `cheap` 3 (literature scout, ADMET, competitive IP), `rival` 1 (skeptic).
- Instructions per agent are small: `1,195` tokens for the lead, `817` to `1,042` for members (4,000 characters / 4;
  `[estimate]` for the token count, characters measured). Nine agents together: about 9,000 tokens.
- Every round, the lead broadcasts; **all 8 members always reply**, and from round 2 each receives a **digest of all 8
  replies with verdicts** (`peerDigest`). Each member keeps one conversation for the whole run, so context grows.
- Members with `exa_search` call it 2 to 4 times in round 1 (scout prompt: "Two to four searches per round"); the engine sets
  no `numResults`, so Exa returns its default **10 results** per search.

### Assumptions (three scenarios)

| Parameter | Low | Mid | High |
|---|---|---|---|
| Rounds (last is the final-positions round) | 3 | 3 | 4 |
| Member reply, tokens | 400 | 700 | 1,000 |
| Digest per member-reply (reply + verdict lines) | 475 | 775 | 1,100 |
| Searches per searching member, round 1 / round 2 | 2 / 0 | 3 / 1 | 5 / 2 |
| Tokens added to context per search (kept results) | 1,000 | 1,500 | 2,500 |
| Lead memo, tokens | 1,200 | 1,200 | 1,200 |

Cost of a call with caching: `prefix x cache-read + new tokens x cache-write (or input where there is none) + output x
output price`. Without caching: `(prefix + new) x input + output x output price`. "Cached" assumes the 5-minute cache
holds between a member's turns; the swarm showed 69-80% reads, but **the board's hit rate is unmeasured**.

### Result: tokens and dollars per run (shipped tier mapping, catalog prices)

| Scenario | Input tokens | Output tokens | Uncached | Cached |
|---|---|---|---|---|
| Low | 240K | 10.4K | $0.52 | $0.30 |
| **Mid** | **530K** | **16.8K** | **$1.01** | **$0.50** |
| High | 1,704K | 32.1K | $2.95 | $1.05 |

Worked example, mid scenario, one strong member (target biologist on Sonnet, cached). Each row is one model call:
`prefix` tokens are read from cache at $0.10, `new` tokens are written at $2.50, `out` tokens cost $10, all per Mtok.

| Round | Call | Prefix | New | Out | Cost |
|---|---|---|---|---|---|
| 1 | search 1 | 0 | 1,200 | 100 | $0.0040 |
| 1 | search 2 | 1,300 | 1,600 | 100 | $0.0051 |
| 1 | search 3 | 3,000 | 1,600 | 100 | $0.0053 |
| 1 | reply | 4,700 | 1,600 | 700 | $0.0115 |
| 2 | search 1 | 7,000 | 6,400 | 100 | $0.0177 |
| 2 | reply | 13,500 | 1,600 | 700 | $0.0123 |
| 3 (final) | reply | 15,800 | 6,400 | 100 | $0.0186 |
| | | | | | **$0.0745** |

Check of one row: round 2, search 1 = 7,000 x 0.10 + 6,400 x 2.50 + 100 x 10 = 700 + 16,000 + 1,000 = 17,700 micro-dollars =
$0.0177. Four strong members make 4 x $0.0745 = **$0.298**, the strong-tier figure below. The member read 65.7K input
tokens (prefix + new, summed over calls) and wrote 1.9K.

Share by tier, mid:

| Tier | Agents | Uncached | Cached | Share (cached) |
|---|---|---|---|---|
| lead (Opus) | 1 | $0.218 | $0.146 | 29% |
| strong (Sonnet) | 4 | $0.602 | $0.298 | 60% |
| cheap (Gemini Flash) | 3 | $0.169 | $0.034 | 7% |
| rival (GPT mini) | 1 | $0.025 | $0.018 | 4% |
| **Models total** | 9 | **$1.014** | **$0.496** | |

On top, per run, outside the model rows above:

| Cost | Mid `[estimate]` | Basis |
|---|---|---|
| Exa | 28 searches x $5 to $7 per 1,000 = **$0.14 to $0.20** | `[memory]` price; not counted by `max_usd` |
| First-pass checks and triage | **$0.03 to $0.10** (section 4) | |
| OpenAI escalations | under $0.01 | about 1.2K in, 200 out each |
| Claude Code escalations | **$0.1 to $0.4** for 2 to 3 computed claims; worst case 12 x $0.03 to $0.15 = **$0.36 to $1.8** | cost per check unknown |

Mid total with caching: about $0.50 + $0.17 + $0.07 + $0.25 = **$1.0**; plausible range $0.5 to $4. That is well under
`max_usd: 5`.

Sanity check against measurements: the swarm's demo run, a different workload with about the same input volume, cost $0.38
to $0.23 on Sonnet. The board model's mid result on Sonnet-class prices, $0.40, is the same order. That supports the
order of magnitude, not the precise number.

## 4. What removing Jev does to the cost

Jev was a classifier at about **$0.042 per Mtok of input and nothing for output** (`[catalog]` for `typesafe/jev-1.14`). The
replacement is a language-model call per search result and per claim.

Calls per run: **triage** = searches x 10 results (Exa default); **claim check** = one per member, round and cited
source (the old code already grouped the claims of one member that cite one source).

| Scale | Searches | Triage calls | Claim calls | Basis |
|---|---|---|---|---|
| Recorded (scripted) | 7 | 28 | 19 | `[measured]` from `board/runs` |
| Low | 14 | 140 | 20 | `[estimate]` |
| Mid | 28 | 280 | 50 | `[estimate]` |
| High | 49 | 490 | 100 | `[estimate]` |

The recorded scale is far below real use, because the scripted model gets only 4 fixture results per search, not 10, and
searches once.

Per-call size `[estimate]`: triage about 600 tokens in, 60 out; claim check about 1,500 in, 120 out.

| Checker | Recorded scale | Mid, reasoning off | Mid, +1,000 hidden reasoning tokens per call | Mid after the avoidances below |
|---|---|---|---|---|
| Jev (before), 0.042/M in | **$0.002** | about $0.01 | n/a | |
| `claude-haiku-5-5` | $0.0065 | **$0.036** | $0.20 | $0.008 |
| `gpt-5.4-nano` | | $0.077 | $0.49 | $0.017 |
| `gpt-5-mini` | $0.019 | **$0.106** | **$0.77** | $0.024 |
| `gpt-6-luna` (OpenAI classifier, no output cost) | $0.0045 | **$0.024** | $0.024 | $0.006 |

Reading it:

- Per call the replacement is **3x (Haiku) to 10x (`gpt-5-mini`) dearer** than Jev. In dollars that is **+$0.03 to +$0.10
  per run**, small.
- With reasoning on it is **+$0.2 to +$0.8 per run**, and then the checker costs more than the whole lead. All of these
  models are `reasoning: true` in pi-ai. **Disable reasoning (or set the lowest effort) and cap output at about 200
  tokens for every checker call.** I could not verify the exact option name without a call.
- The OpenAI classifier `gpt-6-luna` has no output cost and, being a classifier, no reasoning tokens. It exists in pi-ai
  as `getModelOfType("classifier", "openai", "gpt-6-luna")` (looked up offline: found), and it returns the same probability
  answers the old Jev code consumed. Its calibration is **unverified**. Anthropic ships no classifier, so claims made by an
  OpenAI member (the Skeptic) still need a Claude call for independence.

### Avoidable calls, measured on the recording

The recording is a scripted run, so the repeat rates overstate what a real model does; they show where the mechanism is.

| Avoidance | Recording | Calls saved | Real-run expectation |
|---|---|---|---|
| **Memoise triage by (URL, key question)** across members. `state.evidence` is already keyed by URL. | 28 triage calls, 4 distinct URLs | **24 of 28 (-86%)** | unknown; a real search returns 10 results with fewer repeats across members. Count it from the first real run: one line of logging. |
| **Memoise claims across rounds.** The key `round:member:sha1(claim)` includes the round, so the same member repeating a claim in round 2 is checked again. Keep the per-round ledger row; skip the model call when `sha1(kind, text, source)` was already ruled. | 20 claims, 12 distinct; 8 of the 9 round-2 claims repeat | 19 first-pass calls become 11 (**-42%**) | Real members rephrase. Exact repeats will be fewer. Cheap to build. |
| **Batch claims across members** that cite the same source in the same round, grouped by the claimant's vendor (so a batch never mixes vendors, which keeps independence). | 19 calls -> 8 | **-58%** | Real runs: members cite different papers more often. Likely less. |
| Both of the last two | 19 -> about 5 | **-74%** | |
| **Lexical pre-filter on triage:** drop a result with no word in common with the key question, candidate names and target, before any model call. | Not measurable: the scripted fixtures have one off-topic item in four | untested | Needs one live Exa search to measure (about $0.007). The model call it avoids costs $0.0001 to $0.0003, so this is only worth doing for latency and rate limits. |
| **Skip triage for study-type** when the host is PubMed, PMC or a preprint server | untested | | Same remark. |

At mid scale the model cost of the checker is $0.03 to $0.10 per run. Even a perfect avoidance saves less than $0.10. **The
avoidances matter for rate limits and latency, not for dollars,** unless reasoning is left on.

Rate limits: `jev.triage` is called with `Promise.all` over a search's results, from 7 members at once: up to about 70
concurrent requests. Give the new triage a concurrency limit and a retry on HTTP 429.

## 5. Proposed model tiers

`direct-providers` is choosing the ids; this is the cost view. The vendor split is kept: **the lead and the Skeptic stay on
different vendors.** That is a correctness property, not a cost line, and it costs nothing (the Skeptic makes 3 calls).

Cost per tier is `[estimate]`, mid scenario, with caching, catalog prices.

| Tier | Agents | What it does | Proposed default | Cost / run | What is lost by going a tier down |
|---|---|---|---|---|---|
| lead | lead scientist | Frames the decision; tasks each member by name; reads the 8 replies with verdicts each round; pushes on disagreement; writes the memo (about 1.2K tokens). 4 calls. | **`claude-sonnet-5-5`** (was Opus) | $0.073 (Opus: $0.146) | Opus would synthesise 8 replies and spot weak agreement better. Unmeasured. The lead cannot change a verdict: verdicts are computed in `ledger.py` and `board.ts`. The risk is a worse memo, and a wrong summary of the ledger counts. **Saves $0.07 per run.** |
| strong | target biologist, medicinal chemist, toxicologist, moonshot | The substantive domain work: searches, reads results, argues a position, makes the claims that get checked. 60% of cost. | **`claude-sonnet-5-5`** | $0.298 | Going to Haiku would cut the strong tier to about $0.016 (**-$0.28 per run**) but these members must follow the `CLAIMS` format (a claim without its line is "unsupported" by design), use the search tool well, and reason about SAR and safety. A weak member makes fewer or poorer claims, so the ledger has less to check. **Not measured; do not assume.** Test it once (section 7) before making it a default. |
| cheap | literature scout, ADMET, competitive IP | Retrieval and summary of what sources say, with URLs. | **`claude-haiku-5-5`** | $0.012 (shipped Gemini Flash: $0.034) | Haiku already does the job of a retriever. A cheaper model would lose accurate quoting of numbers (the prompt says "quote the finding"); the checkers catch it, at a cost. |
| rival | skeptic | Attacks the preferred answer. No search tool. 3 calls. | **`gpt-5.4-mini`** (OpenAI) | $0.018 | `gpt-5-mini` costs $0.007 instead of $0.018 and may argue less well; `gpt-5.5` costs about $0.2 for a stronger attacker. The difference is cents, so choose for quality. Keep it on the other vendor from the lead. Reasoning tokens apply here as well; cap them. |
| first-pass checker (new) | for every claim and search result | Triage and a verdict, strict structured output | Haiku for the Skeptic's claims; an **OpenAI** model (`gpt-6-luna`, `gpt-5.4-nano` or `gpt-5-mini`) for claims by Anthropic members; **reasoning off** | $0.02 to $0.04 | Jev gave calibrated probabilities; an LLM's stated confidence is not calibrated. Route on a categorical verdict plus a quote that must appear in the source text (checkable by code), as `direct-providers` plans. |
| escalation | contested literature claims | OpenAI `gpt-5-mini` reads the evidence | keep; for the Skeptic's claims use a Claude model instead | under $0.01 | |
| escalation, computed | computed claims | `claude -p --restricted` | **do not escalate; mark `unchecked: computed claim not run`** unless a code runner exists | $0.1 to $0.4 | See section 6. |

Totals, mid, with caching `[estimate]`:

| Mapping | Cached | Uncached | Change vs shipped |
|---|---|---|---|
| Shipped intent (Opus / Sonnet / Gemini Flash / GPT mini) | $0.496 | $1.014 | |
| Opus lead, Sonnet strong, Haiku cheap, `gpt-5.4-mini` | $0.474 | $0.868 | -4% / -14% |
| **Proposed: Sonnet lead and strong, Haiku cheap, `gpt-5.4-mini`** | **$0.401** | **$0.759** | **-19% / -25%** |
| Cheap option: Sonnet lead, **Haiku strong and cheap**, `gpt-5-mini` | $0.107 | $0.171 | **-78% / -83%** |
| All Haiku, `gpt-5-mini` | $0.038 | $0.067 | -92% / -93% |
| High end: Opus lead and strong, Sonnet cheap, `gpt-5.5` | $1.086 | $2.042 | +119% / +101% |

So the proposal saves about 20%. The only large saving, 78%, is giving the strong tier to Haiku, and I cannot say what it
costs in quality without running both. A plan: run the demo (section 7) once on the proposed mapping, once on the cheap
option, compare the number and quality of checked claims. Cost: about $0.40 + $0.11.

## 6. Biggest avoidable spend in the hot path

Ranked by dollars at mid scale, `[estimate]` unless noted.

| # | What | Cost | How to cut | Saving |
|---|---|---|---|---|
| 1 | **Claude Code on every computed claim.** `checkClaims` sends each `computed` claim straight to `claude -p --restricted` (`board.ts:264`), skipping the cheap check. Restricted mode cannot run code and the prompt says to answer `unsupported` when it cannot settle. One check costs an unknown amount (my guess $0.03 to $0.15) and runs for up to 180 s, **one after another**: 12 of them could hold a round for 36 minutes (config `max_minutes` is 15). Also, `ANTHROPIC_API_KEY` in its environment means API billing. `rdkit` is not installed here (`import rdkit` fails), so there is no free local alternative today. | $0.1 to $0.4 typical; $0.36 to $1.8 at the cap | Do not call a model that cannot compute. Record the claim as `unchecked` with the reason, or add a container with RDKit. At least lower `max_escalations` to 3 for a demo. | **$0.1 to $0.4** and up to 30 minutes |
| 2 | **Exa is uncounted and uncapped.** `state.usd = models + jevUsd + checkerUsd` (`board.ts:480-487`): Exa spend is not in it, so `max_usd` and `daily_usd` do not bind it. The plan's `maxSearches` (4/12/30) is saved in `overrides.json` but `board.ts` ignores it at HEAD. | $0.14 to $0.20 at 28 searches `[memory]` | Count searches (and a price per search) in the run total; apply the plan cap; set `member_turns: 4` for a demo (at most 3 searches a member). | up to **$0.1** |
| 3 | **A plan's limits are not applied** (section 3 of `readiness.md`): a "quick" plan runs the full roster for 3 rounds. | quick plan priced at $0.2, runs at about $0.4 to $1.0 | Make `board.ts` read `overrides.json` (it sets `RUN_OVERRIDES = true` when done). The 4-member, 2-round roster costs 3.4x less than the full one ($0.118 vs $0.401, same tiers, cached). | **up to 70%** of a quick run |
| 4 | **The digest is resent to every member every round.** About 6.2K tokens x 8 members x 2 rounds is roughly 100K of the 530K input tokens (19%). | cheap when cached (about $0.01); about $0.2 uncached | Send a member only the other members' claims with verdicts, not their full replies; or shorten replies. | $0.01 to $0.10 |
| 5 | **Checker reasoning on** (section 4) | +$0.2 to +$0.8 | Turn reasoning off, cap output. | **$0.2 to $0.8** |
| 6 | Repeated claims across rounds; triage without memo; batching | $0.03 to $0.10 total | Section 4 table. | under $0.08 |
| 7 | Escalation readiness. 3 of 19 first-pass checks escalated in the recording (16%) because Jev's probability fell in 0.3 to 0.7. An LLM checker with a categorical verdict has no such band: escalate only when the quote is missing from the source. The OpenAI escalation is under $0.01 anyway. | under $0.01 | | negligible |
| 8 | Opus lead | $0.07 | Sonnet lead. | $0.07 |

Where Jev does **not** short-circuit today: the old design checked every claim and every search result; there was no
skip rule. `computed` claims skipped Jev entirely (#1).

## 7. The cheapest run that still demonstrates the product honestly

What "honest" means here: a **real** model run (`run.json` says `"mock": false`, `usd > 0`), real search, claims checked
by a checker from the other vendor, a memo with verdicts that code computed, and a label that says what the inputs are.

| Choice | Value | Why |
|---|---|---|
| Brief | `board/briefs/kras-g12c-hit-to-lead.md` | Exists, passes validation, and its title says **"illustrative data"**: the assay table is placeholders. Say so when showing the result. It demonstrates the machinery, not a drug decision. |
| Roster | lead + literature scout + medicinal chemist + toxicologist + skeptic (edit `board:` in `config.yaml`; at HEAD a plan cannot do it) | One search-based retriever (evidence pool and literature claims), two domain members whose claims cite the brief and the literature, and the Skeptic on the other vendor. 3 members search. |
| Tiers | lead and strong `claude-sonnet-5-5`, cheap `claude-haiku-5-5`, rival `gpt-5.4-mini` | Section 5. Keeps the vendor split. |
| Caps | `max_rounds: 2` (one working round and the final-positions round), `max_usd: 1`, `max_escalations: 3`, `member_turns: 4`, `max_minutes` 10 | Bounds searches to 3 per member and escalations to 3. |
| Checker | cheap tier, other vendor, reasoning off | Section 4. |

Expected cost `[estimate]`, each term from the model:

| Term | Low | Mid | High |
|---|---|---|---|
| Models, 5 agents, 2 rounds, cached (T1) | $0.080 | $0.118 | $0.193 |
| (same, uncached) | $0.113 | $0.180 | $0.377 |
| First-pass checks and triage (about 90 and 20 calls) | $0.01 | $0.02 | $0.05 |
| Escalations: OpenAI, and Claude Code for 0 to 3 computed claims | $0 | $0.10 | $0.45 |
| Exa, 6 to 9 searches `[memory]` | $0.04 | $0.05 | $0.08 |
| **Total** | **$0.13** | **$0.30** | **$0.95** |

**Expected: about $0.30. Error bar: a factor of about 2.5 either way (range $0.13 to $0.95).** The error bar is wide
because (a) no real board run has ever been recorded, so every token count above is modelled, (b) the board's cache hit rate
is unmeasured, (c) the cost of a Claude Code check and of an Exa search are not known. The single largest uncertainty is the
Claude Code line; if computed claims are recorded as `unchecked` (section 6, #1) the high end drops to about $0.50.

What the caps guarantee: `max_usd: 1` is tested **between rounds**, and only against models, Jev and checkers. A round in
flight can add up to one round's cost (about $0.1 to $0.2 here) and Exa is not in the total. **Worst case about $1.30**,
not $1.00.

For comparison, the cheapest *measured* honest run is the swarm on the demo case: **$0.23** (`budget2`, 200K tokens, score
1.0) or $0.027 for the single agent. It has been done before and shows only that the swarm works on a toy case, so it is
not the one to buy.

What to look at in the result: `board/runs/<id>/verification_ledger.json` (every claim with its checker and verdict),
the `claim.checked` events with `checker` showing the vendor, `run.json` fields `usd`, `jevUsd`, `checkerUsd`, `costEstimated`
(true means a price was missing and the $15 per Mtok fallback was used). After the run, **count the real searches, triage
calls and claims** and replace the estimates in this file.

## 8. Cap and accounting notes for whoever sets the prices

- `usdOf` (`board.ts:177`) charges `fallback_usd_per_mtok` (now 15) **only when a model reports tokens and a cost of 0**. For
  catalog models the cost is non-zero, so it will not fire. If an id is left out of the catalog, Haiku would be over-counted
  about 30x (15 vs 0.5), so the cap trips early: the safe direction. `costEstimated: true` in `run.json` marks that case.
- Cache pricing is included in `cost.total` by pi-ai, so the cap follows real cache behaviour. That is also why a run that
  caches well will report less than the uncached numbers here.
- Daily cap (`daily_usd: 20`) counts an in-flight run at its full `max_usd`.
- The checker's own spend must be added to `checkerUsd` or `jevUsd`; a new checker that forgets this makes `max_usd` blind to it.
- Swarm: the engine's token cap is `GLHF_DAILY_TOKENS`, default 20,000,000, about $27 at the measured $1.34 per million.

## 9. What could not be verified without spending

- Any real board token count, cache hit rate or dollar figure (no real run exists).
- That the catalog prices are the account's prices. OpenRouter's 5.5% credit fee is moot after the removal; Anthropic and OpenAI
  prices must be checked against their pricing pages.
- Exa's per-search price, and Claude Code's cost per check.
- Whether the checker models accept a "reasoning off" setting through pi-ai, and the name of it.
- Quality loss from any lower tier; nothing in this repo measures it. The BixBench pilot is 8 questions and cannot.
- How often real members repeat a claim across rounds, and how many results real searches share across members.
