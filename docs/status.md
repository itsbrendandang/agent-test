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
| Claims engine (`--engine claims`): Board and state machine, budget per claim by acuity, re-triage, Scout and Finisher as code, parallel claims, retry once, ablations `--no-auditor`, `--no-pilot`, `--no-retriage` (the critic is always on). Each claim call is booked in the run's token account as it ends; review tokens and time are split per round and per role; a critic works on its own claim only | **Tested with the scripted model only (also with scripted token use). Never run with a real model. Not the default.** The engine's launcher does not pass `--engine` yet. | `glhf/bixbench/tests/unit/test_board.py`, `test_claim_budget.py`, `test_claims_engine.py`; `tests/e2e/test_claims_engine_e2e.py` (needs Docker). |
| Verdict rules: registered tests, mean of e-values | Automated tests, with a simulation of the error rate. **Not used in a real-model run.** The real-model run below used the older rules (product, no registration). | `glhf/bixbench/tests/unit/test_glhf_ledger.py`. |
| Contract check with the grader's delimiter rules | Automated tests. | `glhf/bixbench/tests/unit/test_glhf_contract_and_budgets.py`. |
| Contract warnings for column names read from the task text, row-key formats (spaces, Ensembl version suffix), `1,234` numbers, infinite values | Automated tests, and the demo case's task text. **Not checked on a real BixBench3 task text.** | Same file; `required_columns` in `swarm/tools.py`. |
| A refuted claim raises a major issue, so the Reviser checks its artifacts | Automated tests and the scripted model (the demo story refutes C2; the Reviser resolves the issue). **Not used in a real-model run.** | `glhf/bixbench/tests/unit/test_glhf_ledger.py`, `glhf/bixbench/tests/e2e/test_glhf_swarm_smoke.py`. |
| One review round in a default local run (1,800 seconds) | Automated tests of the time rule. Not checked in a real-model run. | Same file; `min_review_seconds` in `swarm/solver.py`. |
| Documentation search (`--exa`): 9 sites, path rules, identifier refusal, 20 searches per run | Automated tests. Tested live outside a run: 2 searches with the 9-site list (see "Sponsor tools"). Not used inside a run with the present list, and not on a real BixBench3 task. | `glhf/bixbench/tests/unit/test_glhf_memory_and_search.py`. |
| Memory (`--memory`): pending lessons, approval by a person, filter | Automated tests and the scripted model. **Not used in a real-model run.** | Same file; [glhf/memory/README.md](../glhf/memory/README.md). |
| Swarm on the demo case with a real model | Done. Score 1.0. | One run, `anthropic/claude-sonnet-5-5`, 284,532 tokens, `--exa` on, seed 7. |
| Single agent on the demo case with a real model | Done. Score 1.0. | One run, same model, 18,644 tokens, seed 7. |
| Token budget (`--max-tokens`) on the demo case, real model | Tried twice with the swarm. | 70,000 tokens: score 0.0. 200,000 tokens: score 1.0. |
| A real BixBench3 task | **Not done.** | |
| Cloud run (`--mode cloud`) | **Not done.** Google Cloud is not set up. | |
| Tracking of a cloud run (launch, status, collect) | Parts are tested: a command is started only once, the tracker lock, and matching a run manifest to the right solver. No test follows a whole cloud run, also not with a stand-in. | `engine/test/glhf-tracker.test.ts`. |
| Per-role models (`--role-model`) | **Not run.** Role models cannot be combined with the scripted model, and no real-model run used them. | |
| Public BixBench dataset (`futurehouse/BixBench` v1.5) | Adapter built. Pilot only. See the next section. | `glhf/bixbench_v1/`. |
| Analyses on Modal (`ANALYSIS_BACKEND=modal`, `glhf_local --sandbox modal`): the run's sandbox (every command, check and registered test) is PR #32's Modal sandbox; each test records where it ran; per-run dollar cap and the daily cap; sandboxes terminated after a cancel | **Tested against a stand-in only (a fake Modal, a stub runner). Never run on Modal.** Default stays local Docker. | `glhf/bixbench_v1/tests/glhf_modal_test.py`, `glhf/bixbench/tests/unit/test_analysis_backend.py`, `engine/test/glhf-modal.test.ts`; [configuration.md](configuration.md#where-the-swarms-analyses-run-analysis_backend). |

The real-model runs above are single runs on the demo case. The swarm used about 15 times the
tokens of the single agent (284,532 against 18,644) for the same score. The swarm run had
documentation search (`--exa`); the single agent cannot have it. One run per solver does not
show a difference between the solvers.

The records of these runs are local files under `glhf/runs/` (not in git), so a new clone does
not have them.

## BixBench v1 adapter

The adapter in `glhf/bixbench_v1/` runs the single agent and a three-role swarm (analyst, blind
critic, reconciler) on the public dataset `futurehouse/BixBench` v1.5 (205 questions on 59 data
capsules, in 64 zip files). It is not BixBench3 and not the nine-role swarm. Full text:
[glhf/bixbench_v1/README.md](../glhf/bixbench_v1/README.md).

| Feature | Status | Evidence |
|---|---|---|
| Staging of data, integrity rules, both solvers, three grading profiles, report | Tested with the scripted model. | 200 automated tests in `glhf/bixbench_v1/tests/`. Run: `cd glhf/bixbench_v1 && uv run pytest -q tests`. Not part of `npm test`. |
| Pilot with a real model | Done once. 3 capsules, 8 questions, `anthropic/claude-sonnet-5-5`. | Single agent: 4 of 8 correct, 317,110 tokens. Swarm: 4 of 8 correct, 532,394 tokens (about 1.7 times). Report in `glhf/bixbench_v1/runs/pilot-sonnet-5-5/report.md` (local file, not in git). |
| Full run (205 questions) | **Not done.** | |
| One run per question (`--unit question`) | Not tried with a real model. | |
| Multiple-choice mode (`--answer-mode mcq`) | Not tried with a real model. | |
| Swarm changes after the pilot: blind critic (no hint, analyst's files moved away, checked), reconciler that derives again by running a script, same-method flag, budget floors with refusal before the start, forced final turn, equal or extended budget (`BIXBENCH_V1_SWARM_BUDGET`) | **Tested with the scripted model only. No real-model run has checked these fixes.** | `glhf/bixbench_v1/tests/test_swarm_rules.py`, `test_swarm_e2e.py` (needs Docker). Commit `cfac205`. |
| `--critic-hints` | Still accepted, now ignored. The critic is always blind. | `runner.py`, `solvers.py` in `glhf/bixbench_v1/src/bixbench_v1/`. |
| Results API in the engine: `GET /api/bixv1/runs`, `/api/bixv1/runs/:id`, `/api/bixv1/scoreboard`. Pairing on effective budget, separate "more budget" row (`likeForLike` false), legacy label, design counts, stalled runs, cache | Automated tests with fixture run folders. Read-only. Not shown in the dashboard yet. Not used on a full run (none exists). | `engine/test/bixv1-api.test.ts`, `engine/test/bixv1-stats.test.ts`. |
| Statistics of the results API (exact McNemar, Newcombe paired interval, Wilson) | Automated tests on worked examples. Not checked by us against a statistics package. | `engine/test/bixv1-stats.test.ts`. |

The pilot is too small to conclude anything. Both solvers answered the same 4 questions
correctly, and the 95% interval for each is about 22% to 79%. It does not show that one solver
is better or that they are equal. The results API, called on the pilot folder, gives the same
reading: "Too few questions to conclude anything". No question was answered differently (the
rule needs at least 6), and the 95% interval for swarm minus single agent runs from -20.1 to
+20.1 percentage points.

**The pilot ran the older swarm.** In it the critic was shown the analyst's route, and each
derivation got 42% of the token budget. In the pilot's report, the analyst and the critic
agreed on 6 answers and 4 of these were graded wrong (the adapter's README says "four answers
and all four were wrong"; the report file counts 6 agreed, 2 correct). This is why the swarm
was changed. The 4-of-8 score and the 1.7 times token figure describe the older swarm, not the
present one. The present swarm has no real-model result at all.

Known limits:

| Limit | Effect |
|---|---|
| The sandbox has no network. | At least 17 of the 205 questions (in 6 capsules) name an online resource such as KEGG or Reactome. Neither solver can answer them as asked. The official harness leaves the network on. |
| The official image (`futurehouse/bixbench:aviary-notebook-env`) lacks some R packages. | edgeR, limma, org.Mm.eg.db, Seurat, msigdbr and ReactomePA are not installed. Questions that need them are harder or cannot be done as asked. |
| One run is one capsule with all its questions. | The official protocol is one question per run. Questions of a capsule can hint at each other, and one data-loading mistake can cost several questions. State this with any number. |
| "Replicated" is not "correct". | Two blind derivations by the same model can make the same choice where a question leaves one open. |
| The same-method check is crude. | It compares the words of two short lines that the roles write themselves. |
| The reconciler's script check can be gamed. | The harness checks that the value came from a script that reads `/data`. It cannot check that the script is a real analysis. |
| The forced final turn exists for the swarm only. | On a capsule where the single agent hits its limit, this is an advantage for the swarm. Say so with any comparison. |
| The image is published for linux/arm64 only. | Tested on Apple Silicon. An x86-64 machine needs emulation or its own build. |

## Sponsor tools

| Tool | Status |
|---|---|
| Exa search | Tested live. Used by the swarm's `search_docs` tool (`swarm/tools.py`). Also wired into the board review (`engine/src/search/exa.ts`): the scout has the tool, with a limit of 20 searches a run and $40 in total. No real board review has used it. The scout also has a free literature search (`engine/src/search/literature.ts`, Europe PMC), tested with a fake network and one live query by hand. Details for the swarm's tool are in the next table. |

Live test of the swarm's documentation search (the guard in `swarm/tools.py`, with the 9-site
list):

| Item | Value |
|---|---|
| What was called | The search with the 9-site list, and the result check on what came back. Outside a run. |
| Searches | 2 |
| Results returned by Exa | 10 for each search |
| Dropped by the result check | About half. Examples: pages on the Bioconductor support forum (a subdomain of `bioconductor.org`), and a `readthedocs.io` project that is not on the list of named projects. |
| Cost | $0.014 |
| Not tested | The search inside a swarm run, with a real model that writes the queries. |

What this shows: asking Exa for the listed domains is not enough by itself, because Exa also
returns subdomains and other projects of a listed host. The second check in code
(`result_block_reason`) is needed, and it worked on these results. Two searches are a small
sample.

| Tool | Status |
|---|---|
| past.dev memory | Sending lessons (ingest) and recalling them are tested against the live API (`swarm/past_memory.py`). Lessons are now sent only when a person approves them (`approve` command). Not used inside a full swarm run yet. |
| Modal | In use for two things. The app is hosted there in Demo mode behind a sign-in (`deploy/modal_host/`). One open model (Qwen3.6 35B) was served there and ran the 20-dataset, 82-question BixBench v1.5 grid, graded by code rules only (`glhf/openmodels/`). Real mode in the cloud is designed, not deployed. The BixBench v1 adapter can also run its analysis sandbox there (`--sandbox modal`, `glhf/bixbench_v1` README "The sandbox on Modal"); it ran with the scripted model and in the billed opt-in cloud tests. Two newer parts are tested with Docker and fakes only, not yet on Modal: `--jobs N` (several runs at once) and the environment check (every sandbox's conda packages, R packages and BUSCO layers must equal `modal_env/expected-env.json`). The engine's swarm runs can use the same sandbox (`ANALYSIS_BACKEND=modal`); tested with fakes only, never run on Modal. |

## Engine and dashboard

| Feature | Status |
|---|---|
| Run tracker: no second launch after a restart | The parts are tested (start-once marker file, lock file, process check) in `engine/test/glhf-tracker.test.ts`. No automated test stops and restarts the engine during a run. |
| Run control: a pair in one request (`solvers`), one local run at a time (409), a queued partner that survives an engine restart, a partner that starts after a failure | Automated tests through the real routes, with a stand-in for the local runner (`engine/test/glhf-runs.test.ts`). **Not tested with a real model or a real Docker sandbox.** |
| Cancel (`POST /api/glhf/runs/:id/cancel`, `npm run glhf -- cancel`): stops the runner and its processes, cancels a queued partner, refuses cloud runs | Same test file, same stand-in. Not tested on a run with a real sandbox container; check `docker ps` after a cancel. Not tested on a cloud run (none exists). |
| A real model needs a token budget (local runs) | Automated tests (same file). |
| `--solvers` in the CLI | Automated test (same file). |
| `GET /api/glhf/status`: limits, models, keys as true or false | Automated tests (same file). |
| Refusals name the field (`{error, field}`) | Automated tests (same file). |
| What produced a run (`engine/src/manifest.ts`): commit, uncommitted changes, hashes of `board/config.yaml`, the board's agent files and the research prompts, versions of Node, pi-ai and pi-durable. In board `run.json`, research `record.json` and `GET /api/status` | Automated tests (`engine/test/run-records.test.ts`). Not yet in a real run's record (none since). |
| Local swarm `run.json` (`glhf_local.py`): token use per model also keeps cache reads and writes, reasoning tokens and cost when Inspect reports them; `versions` has `git_commit` and `git_dirty` | Automated tests (`glhf/bixbench/tests/unit/test_glhf_local_usage.py`). Runs made before this have only input, output and total tokens. |
| Board `run.json` keeps tokens and cost per model for the lead and the members (`usage`: input, output, cache reads and writes) next to the dollar total; the checkers are kept as dollars only (`firstPassUsd`, `checkerUsd`) | Automated test with scripted models (`engine/test/run-records.test.ts`). The one real team review in `README.md` ran before it, so its tokens were not kept. |
| Direct answers switch visible (`RESEARCH_PREVIEW`): a start-up line, `researchPreview` and `directAnswers` in `GET /api/status`, a note under the Research question box when the engine refuses a direct answer because they are off; `npm start` prints the engine's mode, paid switch, keys (yes or no), direct answers, and warns when a reused engine runs other code | Automated tests (`engine/test/run-records.test.ts`, `dashboard/src/research/research.test.tsx`). The switch's default is unchanged: off. `npm start` itself was not run in a test (it would reuse the engine on port 8787). |
| Paid-calls switch (`NO_PAID_CALLS`, `engine/src/paid/paid.ts`): on unless the value is `0`; refuses real-model and cloud runs, Exa, the board's models and three checkers; Ask falls back to word search; keys blank in child processes; a paid local run in progress is stopped; `paidCalls` and `models` in the status; the doctor line | Automated tests (`engine/test/paid.test.ts`, 12 tests). The tests check that no request left the process. **Not tested:** a real cloud run that is already on its machine (none exists); the switch inside Docker Compose. |
| Paid-calls switch for Python commands run directly: `bixbench3 run` and `setup-runtime`, `python -m bixbench3.glhf_local` with a real model or `--exa`, `search_docs`, past.dev recall and ingest, lesson approval, `bixbench-v1 run` with a real model, the v1 LLM judge | Automated tests with fakes: 11 in `glhf/bixbench/tests/unit/test_paid.py`, 5 in `glhf/bixbench_v1/tests/test_paid.py`. All pass. **Not tested:** a real refused command on a machine with real keys. |
| Paid-calls switch: what it does not cover | `inspect eval` on `inspect_harness/tasks.py`; scripts that call `run_capsule`, `InspectJudge`, `GCPRunner` or `exa_docs` directly; credentials other than the seven named keys (Google, AWS, Azure, a saved Hugging Face login); a cloud run that is already on its virtual machine. No code guards these. |
| HTTP checks (Host, Origin, token, JSON bodies) | Automated tests that call the real request handler (`engine/test/app.test.ts`, `engine/test/board-http.test.ts`). The handler is in `engine/src/app.ts`; `server.ts` only listens. |
| Scoreboard pairing rules (task, case, model, mode, effort, time limit, token budget) | Automated tests (`engine/test/glhf-scoreboard.test.ts`). |
| Drug board run lock (`engine/src/runlock.ts`): survives a restart, and a process id that the system uses again | Automated tests (`engine/test/board-http.test.ts`, `engine/test/app.test.ts`). No test restarts a real container. |
| Claude Code checker runs with `--restricted` by default and cannot run code | The command and the tool list are tested (`engine/test/board-core.test.ts`). **The `--restricted` mode was not tested with a live call.** Its behaviour is taken from `claude --help`. |
| Ask (question answering over runs) | Automated tests with a stand-in for the model API (`engine/test/glhf-ask.test.ts`). |
| Docker Compose setup | Tested by hand on macOS on a new clone: `docker compose up --build`, then `docker compose exec engine npm run demo` (score 1.000) and `npm run doctor`. Not tested on Linux or Windows. Windows needs WSL2. |
| Dashboard | Automated tests in `dashboard/src/`; run `npm --prefix dashboard test`. Quick and Standard Demo answers and a bundled KRAS team review were also checked by hand in a browser against an isolated engine, with paid calls off and locked. No real-model research answer was run. |
| Overview: "Let's research together!", the answer right under the box, then the six-room Agent Lab and activity panel; the answer is also Research's conversation | Tested with Demo answers. The three-column, two-row Lab was checked at 1280, 1440 and 1920 pixels, plus a one-column mobile view. Tests in `dashboard/src/views/overview.test.tsx`, `dashboard/src/lab/LabScene.test.tsx` and `dashboard/src/lab/motion.test.ts`. The link to Research is tested in `dashboard/src/research/research.test.tsx`. Room art is unchanged. |
| Answers written in real time: the running answer's text appears as the engine streams it (`answer.delta`, a piece at least every 200 ms), under status lines of the team's steps; the reusable chat view `dashboard/src/research/LiveChat.tsx`; Demo answers stream their fixed text a few words at a time | Tested with Demo answers and fakes, not real models. Engine: `engine/test/research-live.test.ts` (pieces in order inside the write step, delivered live over the event stream, resume with `?after=`). Dashboard: `dashboard/src/research/livechat.test.tsx` (pieces render in order, a reconnect shows nothing twice, a finished answer is drawn at once, HTML in streamed text is not rendered). Checked by hand in a browser on Research against a locked Demo engine. |
| Research's live Agent Lab: beside the conversation while an answer is made (above it on narrow screens), folded to one line when the answer is done, Show the lab / Replay / Pause motion | Tested with the engine's Demo and real-shaped example event streams (`dashboard/src/research/researchLive.test.tsx`): shown while the answer runs, nothing before the first step, folded after, the choice remembered, agents with no step stay idle, Pause motion, reduced motion, one replay of a new Demo answer. Checked by hand in a browser with Demo answers at 1600 px (side by side) and 390 px (stacked, no sideways scroll), against an isolated engine with paid calls off and locked. **No real-model answer was watched live**: Real mode uses the same events and code, but this was not seen running. |
| Layout pass: two sidebar groups (main, How it works; Benchmarks and Compare open by address only), one 1100 px content edge (Graph and Research use a wider column), failed count kept in the Overview line, spend moved to Settings → Usage and limits, example questions fill the box, Research inspector without the Agent Lab tab (tabs on one line, panel flush to the right edge) | Checked in a browser with a Demo engine at 1440 × 900 (Overview, Research, Agent Log, Compare, Settings). Tests in `dashboard/src/nav.test.ts`, `dashboard/src/App.test.tsx`, `dashboard/src/views/overview.test.tsx`, `dashboard/src/views/settings.test.tsx`, `dashboard/src/views/HomeView.test.tsx`, `dashboard/src/views/ease.test.tsx` and `dashboard/src/research/inspector.test.tsx`. |
| Agent Log replaces the standalone Agent Lab page | Tested with Demo research answers and a Demo team review. Shown as a group chat: agent pictures, grouped messages, "Show thinking", quiet notes for tools and system steps. Live events, agent and step filters, search, JSON and CSV downloads, built from the shadcn Select and DropdownMenu and the AI Elements Reasoning parts. Event rows and ordering have automated tests in `dashboard/src/lab/` and `dashboard/src/views/`. The Overview keeps its Lab. The Team review page draws its discussion with the same component (round lines, member replies, statement checks as quiet notes), tested with fake events in `dashboard/src/views/thread.test.tsx`. |
| Links between screens (agents, runs, sources and statements; `dashboard/src/lib/links.ts`) | Tested with Demo answers, a Demo team review and the bundled examples, in a browser against a locked test engine, and by automated tests (`dashboard/src/lib/links.test.ts`, `dashboard/src/lab/agentFocus.test.tsx`, `dashboard/src/views/links.test.tsx`, `dashboard/src/research/evidenceLinks.test.tsx`, the last block of `dashboard/src/graph/GraphScreen.test.tsx`). Back, Forward and copied addresses were checked by hand. Not tested with a benchmark run (Compare) in the browser, only in the automated tests. |
| Six read-only examples, labelled "Example · practice, $0" | Generated by the Demo pipeline with `scripts/generate-examples.mjs`, stored in `examples/`. Four finished answers, one cancelled answer, one KRAS team review. All six were opened in Saved research, Research or Team review, Agent Log and Overview Lab. Listing, mutation refusals, spending and replay exclusions are tested in `engine/test/examples.test.ts` and `dashboard/src/views/examples.test.tsx`. Not counted in totals. `GLHF_HIDE_EXAMPLES=1` hides them. |
| Research answers search six free literature sources | Europe PMC, OpenAlex, Semantic Scholar, arXiv, Crossref and bioRxiv/medRxiv are asked at the same time and merged (`engine/src/search/scholarly.ts`, from Anh Lam's `glhf/scripts/fetch_literature.py`; Crossref and bioRxiv/medRxiv added by Anh Lam later). Tested with a fake network only (`engine/test/scholarly.test.ts`): merging, duplicates by DOI and title, one source failing, a source out of time, every source failing. Crossref and bioRxiv/medRxiv have fake-network tests too. **No live query to OpenAlex, Semantic Scholar or arXiv was made from the engine.** This file does not record a live query to Crossref either. |
| Research answers find lab protocols and SOPs | A question that asks for a protocol, an SOP or how to do a lab method also searches published protocols: Europe PMC and OpenAlex limited to protocol journals, and protocols.io through Crossref (`engine/src/search/protocols.ts`). Free, no key. Tested with a fake network and stand-in models only (`engine/test/protocols.test.ts`, `engine/test/research-protocols.test.ts`). Each of the three sources was checked by hand with live free queries on 2026-11-15. The protocols.io API was not used: it asks for a token. **No research answer with a real model has searched protocols yet.** |
| Anh Lam's data scripts (`glhf/scripts/`) | Standalone Python scripts, not used by the app: science-QA eval data and a grading adapter, arXiv reference papers, and a multi-source literature fetch. See `glhf/scripts/README.md`. Not run in this repository's checks. |
| Method specialists in research answers | Tested with Demo answers and stand-ins, not real models. Code matches skills to the question. Sections enter the draft and are checked and reviewed. Quick uses the cheap tier only if it shares the writer's company; otherwise it uses the writer's model. Standard uses the strong tier. `engine/test/research-specialists.test.ts`; details in [research-answer.md](research-answer.md#method-specialists). |
| Graph example: a cancer drug (pembrolizumab) from biomanufacturing to FDA approval. Eight stages in order, drawn in columns (CMC, preclinical, IND and Phase 1, Phase 2 and 3, BLA and FDA review, approval and post-marketing, interactions in the label, possible trials), 49 statements, 6 articles with a published retraction or correction (flagged sources), 5 recruiting Phase 3 trials. First in the Graph picker and open until a run is picked; works with no engine | **Built by hand, not by a run: no model wrote or checked it.** Facts were gathered once, on 2026-11-15, from free public records (openFDA and Drugs@FDA, FDA letters and reviews, ClinicalTrials.gov, Europe PMC, PubMed, Crossref); every statement links to its record, and every link was opened that day. Automated tests check the record's shape, the link formats and that no NCT or PubMed id is named without its link (`dashboard/src/graph/examples/pembrolizumab.test.ts`, `dashboard/src/graph/GraphScreen.test.tsx`). Checked by hand in a browser against an isolated engine with paid calls off and locked. The records will change after that date; the example does not update itself. |
| Pictures with research answers | Tested with fake Exa results only, with and without pictures (`engine/test/research-images.test.ts`, `dashboard/src/research/images.test.tsx`). The strip was checked by hand in a browser on a Demo answer whose saved events were given pictures, against an isolated engine with paid calls off and locked. **Not tested with a live Exa search**, so how many real pages come with a picture is not known. Details in [research-answer.md](research-answer.md#pictures). |
| Short path for plain factual questions in research answers | Tested with stand-ins, not real models. One search, at most 3 sources, a short draft with the least thinking, one round of statement checks; no hypotheses, specialists, critic or revision. Health questions and questions the planner does not call simple keep the full flow. `engine/test/research-short.test.ts`; details in [research-answer.md](research-answer.md#the-short-path-for-a-plain-factual-question). |
| Appearance and new look | Light, Dark and Match system are in Settings → Appearance. Bricolage Grotesque headings and rounded sticker cards; body text stays Geist. Fonts are bundled. Light and dark were checked with Demo runs. The restyle is kept out of the Lab art and panel. |
| "Try asking" questions from Google Trends (`GET /api/trending`, `engine/src/search/trending.ts`): the free trending-searches feed, a keyword rule keeps biology and health searches (a question names the biology word, never a person; words like "stroke" or "FDA" count only in the search itself, not in its news), kept for an hour, curated biology questions when the feed fails or has none. Shown on the Overview and on Research (a click fills the box), in place of the fixed example questions. The cancer-drug question of the Graph example ("Pembrolizumab: FDA path, interactions, retractions, trials?") always comes first | Automated tests with a fake feed (`engine/test/trending.test.ts`) and a stand-in engine (`dashboard/src/research/tryAsking.test.tsx`). The live feed was read once by hand: it had no biology searches that day, so the curated questions were shown. No model is called. |
| Database copy in Supabase (`engine/src/db/supabase.ts`, `npm run db:backfill`): off without its two variables; answers, team reviews and Exa lines written in the background; a failing or slow database does not stop an answer | Automated tests with a fake database (`engine/test/db-supabase.test.ts`). The current SQL in `supabase/migrations/` was run by hand on a local Postgres (PGlite), twice, with sample rows. **Not tested against a real Supabase project.** |
| Dashboard: New run form (real models with a confirm step, pair with "Both"), Cancel run button, queued and cancelled states | No automated tests in the dashboard. The engine's side is tested (`engine/test/glhf-tracker.test.ts`, `engine/test/glhf-runs.test.ts`). |

## Drug candidate board

| Feature | Status |
|---|---|
| Full run with scripted models | Works (`npm run board` with paid calls off, the default). |
| Board roster (`board/config.yaml`, `board/agents/`): the Lead Scientist, the scout (the member that gathers the sources, the only one with the web search), the evidence verifier (rechecks the scout's sources in every round, with free literature and database searches) and five members: proposer, experimenter (three modes: Pilot, full run, Reviser), methods auditor, critic, reporter. Code checks the brief's sections and the memo's sections (the Finisher check) | Prompts only; no member runs code. Ran with scripted models only (`DRUG_BOARD_MOCK=1 npm run board`). Modes and the Finisher check have automated tests (`engine/test/board-modes.test.ts`, `engine/test/board-core.test.ts`). The scout replies first, then the evidence verifier with the scout's reply of the round, then the others at the same time; the lead is told to read the verifier's report before deciding (`engine/test/board-verifier.test.ts`, scripted models only). A lead that ends without `write_memo` leaves the run marked failed, not finished, and is not asked again (`engine/test/board-memo.test.ts`, scripted lead). A run whose `overrides.json` cannot be read is marked failed and does not start. The limits in `board/config.yaml` are checked when it is loaded: a limit that is not a number stops the engine at start, naming the key (`engine/test/config.test.ts`). Never run with a real model. |
| Full run with real models | Not verified. The repository holds no record of a finished live run. |
| Watch mode (`watch:` in `board/config.yaml`) | Not implemented. The key is read but no code uses it. |
