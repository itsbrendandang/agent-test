# GLHF: a swarm of AI scientists, and an honest measurement of it

Team GLHF. Track: multi-agent science systems.

## The result, first

Our question: does a team of agents do computational biology better than one agent on the same
budget?

**We do not know. Our only benchmark result with a real model is a tie, and the swarm cost
more.**

| | Single agent | Swarm (3 roles) |
|---|---|---|
| Correct, of 8 questions | 4 | 4 |
| Tokens | 317,110 | 532,394 (about 1.7 times) |

- Source: `glhf/bixbench_v1/runs/pilot-sonnet-5-5/report.md`. Public BixBench v1.5, 3 data
  capsules, model `anthropic/claude-sonnet-5-5`, one run each.
- Both solvers got the same 4 questions right and the same 4 wrong. The 95% interval for each is
  21.5% to 78.5%. Eight questions cannot separate the two solvers.
- The gated BixBench3 benchmark has **never been run**. `npm run doctor` shows why: no Hugging
  Face access and no Google Cloud project.
- **Nothing has run in the cloud.**
- Scores of 1.0 from the scripted model (`--model mock`) show that the code paths work. They say
  nothing about science.
- We also ran a real model four times on our small built-in demo case. It is not a benchmark.
  Swarm and single agent both scored 1.0. The swarm used about 15 times the tokens (284,532
  against 18,644; `glhf/runs/real/*/run.json`).
- Run folders are not in git. A new clone does not have the pilot files.

The rest of this page is what we built to make the measurement trustworthy, and what the pilot
taught us.

## What we built

- **Nine-role swarm** for BixBench3 (`glhf/bixbench/src/bixbench3/inspect_harness/swarm/`).
  Code fixes the order of roles and the budgets (`solver.py`). There is no supervisor model.
- **Three-role swarm** for BixBench v1.5 (`glhf/bixbench_v1/`): an analyst, a critic that
  derives each answer again, and a reconciler. The pilot used this one.
- **Engine and dashboard** (`engine/`, `dashboard/`) to start, track and compare runs.

## What we can show

**1. A claim ledger. Code computes every verdict.**
The Critic must register a test before it reports a result. Code refuses a good result that was
not registered. A registered test with no result blocks support. E-values are combined by their
mean, so the tests need not be independent. If each reported p-value is valid and no test was
run in private first, then over all claims of a run, the chance that a claim with a true null
hypothesis is marked supported is at most 0.1.
Code: `swarm/ledger.py`. Check: `cd glhf/bixbench && uv run pytest -q tests/unit/test_glhf_ledger.py`.
The tests include a simulation of the error rate under four kinds of critic behaviour.
Limit: a model reports the p-values, and code cannot recompute them. **No real-model run has
used these rules yet.**

**2. A harness that compares runs only on matched settings.**
Two runs share a scoreboard row only when task, case, model, mode, effort, time limit and token
budget are equal (`pairKey` in `engine/src/glhf/scoreboard.ts`). Extras that only the swarm had
are printed next to the score. Check: `node --test engine/test/glhf-scoreboard.test.ts`.

**3. Runs that survive a crash.**
The run tracker is built on Pi Durable (`engine/src/glhf/task.ts`). We killed the tracking
process with `kill -9` during a scripted run. `npm run glhf -- resume` continued the run, did
not start it twice, and then started its queued partner ([DEMO-SCRIPT.md](DEMO-SCRIPT.md),
step 2). Untested: a crash during a real-model run.

**4. An answer boundary, and guards on search and memory.**
- The v1 adapter gives the solver only the question id and text. The task has no target and no
  scorer. The sandbox has no network. Grading runs on the host afterwards (`dataset.py`,
  `task.py`, `sandbox/compose.yaml`). Check: `cd glhf/bixbench_v1 && uv run pytest -q tests`.
- Search through Exa is limited to 9 documentation sites and 20 searches per run. A query with
  a study identifier is refused (`swarm/tools.py`, `swarm/guards.py`). Check:
  `uv run pytest -q tests/unit/test_glhf_memory_and_search.py`.
- Untested: the benchmark's own network gate for cloud runs.

**5. A human gate on memory.**
A run can only queue lessons in `lessons.pending.md`. A person approves each one. Only approved
lessons reach later runs or past.dev. Code drops lines that look like results
(`swarm/memory.py`). Not used inside a real-model run yet.

## Two failure modes from the pilot

**Budget starvation.** Each derivation got 42% of the run's tokens. On capsule bix-2 that was
134,400. The single agent needed 151,522 for the same capsule. The analyst was cut off with no
answer recorded. The critic's answers were reported alone, as "unchecked". The swarm spent
283,321 tokens for one derivation.
Evidence: `phases` in `runs/pilot-sonnet-5-5/bix-2_30b33e47/glhf/run.json`.

**Agreement without independence.** On capsule bix-29 the swarm marked all 4 answers
"replicated". All 4 were wrong. The critic was shown the analyst's one-line route, and it fitted
the same statistical model. Two derivations that share one reading agree with each other, right
or wrong. In the pilot, 2 of 6 "replicated" answers were correct.
Evidence: `outputs/glhf/FINDINGS.md` in `runs/pilot-sonnet-5-5/bix-29_b8c485ff/glhf/`.

**What we changed** (`glhf/bixbench_v1/src/bixbench_v1/solvers.py`, `roles.py`):

- Budget: each role has a floor. A run that cannot cover the floors is refused before it starts.
  Unused tokens roll forward. A role that is cut off gets one last turn to record its answers.
  `run.json` records whether the swarm had the same total budget or a larger one.
- Independence: the critic is never shown the route, and a check must find no file of the
  analyst's before the critic starts. Code compares the two method lines. An agreement reached
  by the same method is flagged as weaker, and the reconciler derives it again with its own
  script.

These changes are uncommitted work in progress. They pass the adapter's tests with the scripted
model. **They have not been run with a real model. We do not know if they help.**

## Sponsors

| Sponsor | Use | Status |
|---|---|---|
| Exa | `search_docs` in the swarm (`swarm/tools.py`); literature search in the drug board (`engine/src/search/exa.ts`). | Guards tested with a stand-in. Live searches: stated in `docs/status.md`, not checked by us again. Not used in the pilot. |
| past.dev | Approved lessons are sent and recalled (`swarm/past_memory.py`). | Calls tested with a stand-in. Live test: stated in `docs/status.md`. Not used inside a full run. |
| Pi | The coding agent harness we built with (`.pi/`, `docs/pi-setup.md`). | |
| Pi Durable | Runtime of the run tracker and the drug board (`engine/package.json`, `engine/src/board/board.ts`). | Crash and resume checked by hand, scripted runs only. |
| Modal | Planned. | **Not used.** No code imports it. |

The swarm's own agent loop runs on Inspect AI, the benchmark's framework, not on Pi.

## What we got wrong

- We built nine roles before we measured one. We have no evidence that nine roles are better
  than three, or that three are better than one.
- We planned for BixBench3 without access to it. The public-dataset adapter came late, so the
  pilot is 8 questions.
- We fixed each derivation's share at 42%. That was less than one analysis needed.
- We called answers "replicated" when the second derivation had seen a hint from the first.
- The pilot ran one capsule per run. The official protocol is one question per run.
- The sandbox has no network. At least 17 of the 205 questions name an online resource.
- The first real-model swarm run used an older ledger rule, a product of e-values. That rule
  could pass false claims. The new rule is tested only by simulation.
- Our docs drift. Test counts and the demo time in `README.md` did not match what we measured
  ([CLAIMS.md](CLAIMS.md)).

## With 24 more hours and a budget

1. Run all 205 questions with both solvers. Report the paired difference with its interval,
   whatever it is.
2. Repeat with one question per run, the official protocol.
3. Run the changed swarm at equal total budget and at a larger budget. Report both.
4. Measure how often "replicated" answers are correct, with and without the same-method flag.
5. Put the critic on a second vendor's model (`--role-model`). Never tried.
6. Get BixBench3 access and run one task with each solver.
7. Run the ledger with a real Critic and audit its reported p-values by hand.
8. If the swarm does not beat the single agent at equal budget, say so and stop.

Every claim on this page is listed with its evidence and status in [CLAIMS.md](CLAIMS.md).
