# Claims in WRITEUP.md, with evidence

Checked on 14 Nov 2026, 17:20 to 17:40 EST, on the working tree. HEAD moved from `f6aee6d` to `77f7b75` during
the check, with uncommitted changes on top. Other people were changing code and docs. Line numbers are from that time and may
have moved. Re-run the commands before you submit.

No paid call was made. `.env` was not read. All runs used `--model mock` with `NO_PAID_CALLS=1`.

Status words:

- **verified-by-me**: I ran the command or read the file named in the evidence column.
- **taken from docs**: an existing document says so. I did not check it again.
- **untested**: nobody has checked it, or I could not.

Paths: `swarm/` is `glhf/bixbench/src/bixbench3/inspect_harness/swarm/`. `v1/` is
`glhf/bixbench_v1/src/bixbench_v1/`. `pilot/` is `glhf/bixbench_v1/runs/pilot-sonnet-5-5/`
(a local folder, not in git).

## The result

| # | Claim | Evidence | Status |
|---|---|---|---|
| 1 | Pilot: single agent 4 of 8, swarm 4 of 8. | `pilot/report.md:7-8` | verified-by-me (read the report; I did not grade again) |
| 2 | Tokens 317,110 and 532,394, about 1.7 times. | `pilot/report.md:7-8`; `pilot/budget.json` (the six runs add up); 532,394 / 317,110 = 1.68 | verified-by-me |
| 3 | 3 capsules, model `anthropic/claude-sonnet-5-5`, one run per solver and capsule. | `pilot/report.md:3,25`; `pilot/*/*/run.json` (6 files); `glhf/bixbench_v1/runs/pilot.log` | verified-by-me |
| 4 | Same 4 right and same 4 wrong for both solvers. | `pilot/report.md:25` ("both correct 4, single only 0, swarm only 0, neither 4") | verified-by-me |
| 5 | 95% interval 21.5% to 78.5% for each. | `pilot/report.md:7-8` | verified-by-me (read; not recomputed) |
| 6 | BixBench3 has never been run. | `docs/status.md` ("A real BixBench3 task: Not done"); `npm run doctor` prints `MISSING Hugging Face access` and `Not ready for BixBench3 cloud runs` | taken from docs; the doctor output is verified-by-me. Doctor shows this machine cannot run it now, not that nobody ever did. |
| 7 | Nothing has run in the cloud. | `docs/status.md` ("Cloud run: Not done"); `npm run doctor` prints `MISSING gcloud CLI`, `MISSING GCP project` | taken from docs; doctor output verified-by-me |
| 8 | Scripted-model scores of 1.0 show only that the code paths work. | `npm run demo` prints `score 1.000 (official grader) [scripted model: shows the plumbing works, not the science]`; `engine/src/glhf/cli.ts:57` | verified-by-me |
| 9 | Four real-model runs on the demo case. Swarm 1.0 with 284,532 tokens, single agent 1.0 with 18,644 tokens, about 15 times. | `glhf/runs/real/{swarm1,single1,budget1,budget2}/run.json` (local files) | verified-by-me (read the files). The other two runs: score 0.0 with 76,056 tokens and 1.0 with 188,611 tokens. Their token budgets are not recorded in `run.json`; the 70,000 and 200,000 in `docs/status.md` are taken from docs. |
| 10 | Run folders are not in git. | `.gitignore` (`glhf/runs/`, `glhf/bixbench_v1/runs/`) | verified-by-me |

## What we built

| # | Claim | Evidence | Status |
|---|---|---|---|
| 11 | Nine-role swarm; code fixes the order and the budgets; no supervisor model. | `swarm/solver.py:8`; `glhf/docs/DESIGN.md` section 2; the scripted run's ledger events show the phases in order | verified-by-me for the scripted run; taken from docs for the full list of roles |
| 12 | Three-role swarm (analyst, critic, reconciler) in the v1 adapter; the pilot used it. | `v1/solvers.py` (top comment), `v1/roles.py`; `pilot/*/glhf/run.json` `phases` (analyst, critic) | verified-by-me. No pilot run reached the reconciler. |
| 13 | Engine and dashboard start, track and compare runs. | `engine/src/glhf/`, `dashboard/src/views/SwarmView.tsx`; CLI commands run in the demo rehearsal | verified-by-me for the CLI. The dashboard was **not opened by me: untested**. |

## What we can show

| # | Claim | Evidence | Status |
|---|---|---|---|
| 14 | A favourable result that was not registered is refused. | `swarm/ledger.py:190-225` (`record_test`); `uv run python ../../docs/submission/demo/ledger_refusal.py` prints `REFUSED by code` | verified-by-me |
| 15 | A registered test with no result blocks support. | `swarm/ledger.py:121-132` (`verdict`); same script prints `insufficient (waiting for: held-out)` | verified-by-me |
| 16 | E-values are combined by their mean. | `swarm/ledger.py:111-114` | verified-by-me |
| 17 | False support is at most 0.1 over all claims of a run, under any dependence, given two assumptions. | Argument: `swarm/ledger.py:6-32`. Simulation: `glhf/bixbench/tests/unit/test_glhf_ledger.py:138-186`, four modes (independent, same, best-of-100, drop), 1, 8 and 20 claims. `uv run pytest -q tests/unit/test_glhf_ledger.py`: 35 passed | verified-by-me that the tests pass. The proof itself is taken from docs; I did not check the mathematics beyond reading it. |
| 18 | Code cannot recompute the reported p-values. | `swarm/ledger.py:14,29-32`; `docs/reading-results.md` ("What is not controlled") | verified-by-me (read) |
| 19 | No real-model run has used the registration rule and the mean. | `docs/status.md`, `glhf/docs/DESIGN.md` section 3 | taken from docs |
| 20 | Runs are paired only when task, case, model, mode, effort, time limit and token budget match. | `engine/src/glhf/scoreboard.ts:48` (`pairKey`); `node --test engine/test/glhf-scoreboard.test.ts` passes | verified-by-me |
| 21 | Swarm-only extras are printed next to the score. | `npm run scoreboard` printed `note: settings that differ. swarm only: memory, 3 review rounds` | verified-by-me |
| 22 | The run tracker is built on Pi Durable. | `engine/src/glhf/task.ts:14` (`defineTask` from `@earendil-works/pi-durable`); `engine/src/glhf/tracker.ts:8,200`; `engine/package.json:14` | verified-by-me |
| 23 | After `kill -9` of the tracking process, `resume` continued the run, did not start it twice, and started the queued partner. | Done twice by hand with scripted runs. `tracker.log` of the run has one `local runner started` line. Automated tests of the parts: `engine/test/glhf-tracker.test.ts:162`, `engine/test/glhf-runs.test.ts:108` (pass) | verified-by-me, for the CLI tracker and the scripted model only |
| 24 | A crash during a real-model run. | none | untested |
| 25 | A kill and restart of the engine server (not the CLI) during a run. | `docs/status.md` says no automated test does this. I did not start a second engine. | untested |
| 26 | v1 adapter: only the question id and text reach the solver. | `v1/dataset.py:77-83` (`PublicQuestion`, `extra="forbid"`); `glhf/bixbench_v1/tests/test_boundary.py:28-96` | verified-by-me (tests pass). In multiple-choice mode the options are shown too. |
| 27 | The task has no target and no scorer. | `v1/task.py:3`; `test_boundary.py:50` | verified-by-me |
| 28 | The sandbox has no network. | `v1/sandbox/compose.yaml:14`; `glhf/bixbench/sandbox/local-compose.yaml:11`; `test_boundary.py:103` | verified-by-me |
| 29 | Grading runs on the host after the container is gone. | `v1/runner.py` (`grade_run`); `glhf/bixbench_v1/README.md` ("Integrity boundary") | taken from docs; the adapter tests pass |
| 30 | `cd glhf/bixbench_v1 && uv run pytest -q tests` passes. | 102 passed at 17:20; 112 passed at 17:29 (tests were added in between) | verified-by-me |
| 31 | Search: 9 documentation sites, 20 searches per run, study identifiers refused. | `swarm/tools.py:390-400` (9 entries), `:419`, `:437`; `swarm/guards.py:48`; `study_identifier("GSE 123456 ...")` returned `GSE 123456` | verified-by-me |
| 32 | `uv run pytest -q tests/unit/test_glhf_memory_and_search.py` passes. | 103 passed (run together with the ledger file: 138 passed) | verified-by-me |
| 33 | The benchmark's own network gate. | `docs/reading-results.md` ("Answer leakage") | untested |
| 34 | A run only queues lessons; only approved lessons reach later runs. | `swarm/memory.py:39-40,240`; `test_glhf_memory_and_search.py:30`; a scripted run with `--memory` left `lessons.pending.md` and no `lessons.md`; `memory --dir ... list` printed `1 pending` | verified-by-me |
| 35 | Only approved lessons are sent to past.dev. | `swarm/memory.py:350-357`; `test_glhf_memory_and_search.py:81` (passes, with a stand-in) | verified-by-me by test. I did not run `approve` (rule in `AGENTS.md`). |
| 36 | Code drops lesson lines that look like results. | `swarm/memory.py:86`; `lesson_rejection(...)` refused two example lines and passed one | verified-by-me |
| 37 | Memory was not used inside a real-model run. | `docs/status.md` | taken from docs |

## The pilot's two failure modes

| # | Claim | Evidence | Status |
|---|---|---|---|
| 38 | bix-2, swarm: each derivation was allowed 134,400 tokens (42% of 320,000). | `pilot/bix-2_30b33e47/glhf/run.json` `phases[0].tokens_allowed`; `settings.derivation_share` in the pilot `run.json` files | verified-by-me |
| 39 | The single agent used 151,522 tokens on bix-2. | `pilot/bix-2_30b33e47/single/run.json`; `pilot/report.md:33` | verified-by-me |
| 40 | The analyst was cut off by the token limit with no answer recorded; the critic's answers were reported as "unchecked". | Same `run.json` (`limit: "token"` for analyst and critic); `pilot/bix-2_30b33e47/glhf/outputs/glhf/FINDINGS.md` (both answers "by critic [unchecked]") | verified-by-me |
| 41 | The swarm spent 283,321 tokens on bix-2. | `pilot/report.md:33` | verified-by-me |
| 42 | bix-29: 4 answers "replicated", all 4 wrong. | `pilot/report.md:29-32` | verified-by-me |
| 43 | The critic fitted the same statistical model as the analyst. | `pilot/bix-29_b8c485ff/glhf/outputs/glhf/FINDINGS.md` (the two routes per question name the same model and predictors) | verified-by-me |
| 44 | The critic was shown the analyst's one-line route in the pilot. | `glhf/bixbench_v1/README.md` at commit `5577c0d` (default `--critic-hints route`; "Problems to know about"). The pilot `run.json` files do not record this setting. | taken from docs |
| 45 | 2 of 6 "replicated" answers were correct. | `pilot/report.md:21` | verified-by-me |
| 46 | Changed: role floors; a run that cannot cover them is refused; unused tokens roll forward; one forced last turn; `run.json` records equal or larger budget. | `v1/solvers.py:101,168` (`BudgetError`, `plan_budget`), `:961` (`forced_final`); `v1/runner.py` (`swarm_budget`, `budget_reading`); `glhf/bixbench_v1/tests/test_swarm_rules.py:50-105` | verified-by-me that the code and tests exist and pass (112 passed). Uncommitted. |
| 47 | Changed: the critic is never shown the route; a check must find no analyst file; same-method agreements are flagged; the reconciler derives again with its own script. | `v1/runner.py:178,251`; `v1/solvers.py:635` (`blind_check`), `:324` (`method_similarity`), `:778` (`rederive`); `test_swarm_rules.py:130-258` | verified-by-me that the code and tests exist and pass. Uncommitted. |
| 48 | These changes help with a real model. | none | untested |

## Sponsors

| # | Claim | Evidence | Status |
|---|---|---|---|
| 49 | Exa is called by `search_docs` and by the drug board's search. | `swarm/tools.py:501-507` (`api.exa.ai/search`, `includeDomains`); `engine/src/search/exa.ts:52` | verified-by-me (read) |
| 50 | Exa was tested with live searches. | `docs/status.md` ("Sponsor tools"). It also says there is no record of a live search with the 9-site list. | taken from docs |
| 51 | Exa was not used in the pilot. | pilot `run.json` files: `settings.documentation_search: false` | verified-by-me |
| 52 | past.dev sends and recalls approved lessons. | `swarm/past_memory.py:24,49,94`; `test_glhf_memory_and_search.py:527,595` (stand-in) | verified-by-me (read, tests pass) |
| 53 | past.dev was tested against the live API. | `docs/status.md`, `README.md` | taken from docs |
| 54 | Pi is the coding agent harness the project was built with. | `docs/pi-setup.md`; `.pi/settings.json`, `.pi/agents/` (4 profiles) exist | taken from docs; the files exist |
| 55 | Pi Durable runs the tracker and the drug board. | `engine/package.json:14`; `engine/src/board/board.ts:28-29,473`; `engine/src/glhf/task.ts:14` | verified-by-me |
| 56 | Modal is not used. | No `import modal` or `"modal"` dependency in any `.py`, `.ts`, `.json` or `.toml` file outside `node_modules` and `.venv` (grep) | verified-by-me |
| 57 | The swarm's agent loop runs on Inspect AI, not on Pi. | `swarm/solver.py:22-26` (imports from `inspect_ai`) | verified-by-me |

## What we got wrong

| # | Claim | Evidence | Status |
|---|---|---|---|
| 58 | Nine roles were built before any measurement. | `git log`: commit `848663c` (nine roles, 14:36) is before `5577c0d` (adapter and pilot, 16:31) | verified-by-me |
| 59 | No evidence that nine roles beat three, or three beat one. | `glhf/docs/DESIGN.md` section 7; claim 1 | taken from docs |
| 60 | We planned for BixBench3 without access to it. | Doctor: `MISSING Hugging Face access`. The plan itself: `README.md`. | taken from docs; "planned without access" is my reading of these two facts |
| 61 | The pilot ran one capsule per run; the official protocol is one question per run. | pilot `run.json`: `settings.unit: "capsule"`; `glhf/bixbench_v1/README.md` | verified-by-me for the setting; the official protocol is taken from docs |
| 62 | At least 17 of the 205 questions name an online resource. | `glhf/bixbench_v1/README.md` ("Problems to know about") | taken from docs |
| 63 | The first real-model swarm run used a product of e-values, and that rule could pass false claims. | `docs/status.md`; the comment in `test_glhf_ledger.py:182-185` gives 10% to 38% false support for the product rule | taken from docs |
| 64 | Test counts and the demo time in `README.md` did not match. | See "Things in the existing documents that were not true when I checked" below | verified-by-me |

## With 24 more hours

These are plans, not facts. Two facts inside them:

| # | Claim | Evidence | Status |
|---|---|---|---|
| 65 | A second vendor's model for the critic was never tried. | `docs/status.md` ("Per-role models: Not run") | taken from docs |
| 66 | One question per run was never tried with a real model. | `docs/status.md` | taken from docs |

## Claims I could not verify

- 6, 7: that no cloud run and no BixBench3 run ever happened. I can show only that the docs say
  so and that this machine is not set up for either.
- 17: the mathematical argument for the bound. The simulation passes; I did not check the proof.
- 19, 37: that no real-model run used the new ledger rules or memory.
- 29: the order of grading and container removal (read in the README, not traced in code).
- 44: that the pilot's critic saw the route. The pilot's `run.json` does not record it.
- 50, 53: live calls to Exa and past.dev. I made no paid or outside call.
- 54: that Pi was the harness used to build the project.
- 62: the count of 17 questions.
- 63: the measured false-support rate of the old product rule.
- 13: the dashboard. I did not open it in a browser.
- 48: whether the changes after the pilot help.

## Things in the existing documents that were not true when I checked

The tree was changing while I checked, so some of these may be fixed already.

| Document | It says | What I saw |
|---|---|---|
| `README.md` ("Tests") | 74 engine tests. | `npm run test:engine`: 89 tests with 1 failure at 17:21; 158 tests with 1 failure at 17:30. The failing test differed between the two runs. |
| `README.md` ("Tests") | 359 harness tests. | 357 passed and 2 skipped at 17:24. At 17:31: 10 failed, 347 passed, 2 skipped. The failures were in the budget tests (`test_glhf_contract_and_budgets.py`, `tests/e2e/test_glhf_swarm_smoke.py`), while `swarm/solver.py` was being edited. |
| `README.md`, `docs/status.md` | 102 adapter tests. | 112 at 17:29. |
| `README.md` ("Quick start") | `npm run demo` takes about 15 seconds. | 23 to 46 seconds on this machine, which was busy. |
| `README.md`, `docs/status.md` | The dashboard has no automated tests. | Untracked test files now exist (`dashboard/src/swarm/*.test.ts*`, `dashboard/vitest.config.ts`). I did not run them. |
| `glhf/bixbench_v1/README.md` (as committed in `5577c0d`) | `--critic-hints none` is an option; the reconciler runs "only on a mismatch"; analyst and critic get 42% each; the tool is `resolve_dispute`. | The working-tree code ignores `--critic-hints` (the critic is always blind), sends same-method agreements to the reconciler too, plans budgets with floors, and the tool is `rederive`. The README was being rewritten to match by 17:40; I did not re-read all of it. |
| `glhf/bixbench_v1/README.md` | "Same model, image, tools, working rules, time limit and token budget for both." | True for the pilot. With the new `extended` budget mode the swarm's total is larger. |
| `docs/status.md` | Swarm budget runs on the demo case: 70,000 and 200,000 tokens. | `glhf/runs/real/budget1,budget2/run.json` record tokens used (76,056 and 188,611) but no budget. Not false; not checkable from the files. |
| `docs/drug-board.md` ("Keys"), at 17:20 | The board uses scripted models without a provider key or with `DRUG_BOARD_MOCK=1`. | Also whenever `NO_PAID_CALLS` is not `0`, the default (`engine/src/config.ts:42`). **Fixed by 17:40**: the document now says so. |
| The job brief for this write-up | The 8-question pilot is the only real-model result. | It is the only real-model result on benchmark questions. Four real-model runs on the demo case also exist (claim 9). The write-up says so. |
