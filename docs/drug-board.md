# Drug Candidate Board

A lead scientist and a board of research agents decide whether drug candidates should advance. Each board member has one task and one deliverable. Checkers verify every claim. The output is a go / no-go memo.

The pattern follows IndyDevDan's "CEO and board" video (brief in, memo out, constrained debate, specialized agents, persistent expertise). Here the CEO is a **Lead Scientist**, and the board is research staff working through the literature.

![Board view](board.png)

The Board view shows a plain summary (progress, recommendation, how many claims checked out, open questions, next steps). Tick **Show details** for the full roster, discussion with per-claim verdicts, evidence pool and memo ([screenshot](board-details.png)).

> **Status.** The board runs from brief to memo on scripted models (no keys). With `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `NO_PAID_CALLS=0` in `.env` it calls those two providers directly. This repository holds no record of a finished run with real models, and none of the model ids, the structured-output format or the cost per run has been tried with a paid call, so treat the live path as not verified. The board is the older project in this repository; the main project is the GLHF swarm ([README](../README.md)).

```
brief.md ──▶ Lead Scientist ──converse──▶ 6 board members (the scout first, then the others in parallel; each its own durable conversation)
                 ▲                            │ only the scout searches (exa_search, then literature_search, then database_search)
                 │                            ▼
                 └── replies + verdicts ◀── claim checks: cheap first pass ─(unsettled)─▶ OpenAI / Claude Code
             ──write_memo──▶ memo.md + verification_ledger.json
```

## Quick start

```bash
npm run setup           # installs the engine, the dashboard and the benchmark harness
npm run board           # one run in the terminal (scripted models unless NO_PAID_CALLS=0 and keys are set)
npm run runs            # list board runs
npm run resume <run-id> # continue an unfinished run
npm run engine          # backend for the dashboard, port 8787; continues unfinished runs
npm run dashboard       # http://localhost:5317, then "Board" (second icon)
```

In VS Code, run **Tasks: Run Task → Board: start all** to start the engine and dashboard together.

## Keys

**Paid calls are off by default.** While `NO_PAID_CALLS` is not exactly `0`, the board runs on scripted models, also when every key below is set (`mockMode` in `engine/src/config.ts`). A live run needs `NO_PAID_CALLS=0` in `.env`, set by the person who pays, and a restart of the engine. See [running.md](running.md#paid-calls-no_paid_calls).

| While paid calls are off | What happens | Code |
|---|---|---|
| Board models (lead and members) | Scripted. No real provider is registered. | `engine/src/models.ts` |
| First-pass checker (cheap model) | Refused before any call. | `engine/src/board/triage.ts` |
| OpenAI checker | Refused before any call. | `engine/src/board/checkers.ts` |
| Claude Code checker | Refused before the process is started. | `engine/src/board/checkers.ts` |
| Exa literature search | Refused before the request. | `engine/src/search/exa.ts` |
| A run that was started with real models | Not continued, in the engine (HTTP 403 on resume) and in `npm run resume` (exit status 3). It stays paused. A finished run and a scripted run are not affected. | `refusePaidRun` in `engine/src/board/board.ts` |

In a scripted run the checkers and the search give scripted answers, so nothing is refused; the refusals above are a second barrier for code paths that would reach a real service. Tested in `engine/test/paid.test.ts`, with no network.

With paid calls allowed, a live run needs the key of **every tier** in `board/config.yaml`: Anthropic for `lead`, `strong` and `cheap`, OpenAI for `rival`, the first-pass checker of Claude members' claims and the literature checker (`engine/src/providers.ts`). If one is missing, the run is refused when it starts, with the tier and the key named (HTTP 503). It is **never** silently run with scripted models: a run that looks real but is scripted is the worst outcome. With `DRUG_BOARD_MOCK=1` the board is scripted on purpose. Copy `.env.example` to `.env`:

| Key | Used for | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | `lead`, `strong`, `cheap` tiers (Claude Sonnet 5.5 lead and strong, Haiku 5.5 cheap) | yes |
| `OPENAI_API_KEY` | `rival` tier (the Critic, GPT-5 mini), first-pass checker of Claude members' claims, literature checker | yes |
| `EXA_API_KEY` | Search, for a member that has the `exa_search` tool (the scout) | yes while the scout can search |

Claude Code (the checker for computed claims) uses your existing `claude` login. By default it runs with `--restricted` and **cannot run code**: it checks a claim by reasoning and answers "unsupported" when that is not enough. It runs in an empty temporary folder, with only the tools named in `checkers.claude_code_tools` (`Read Write`), and with a fixed list of environment variables, so other providers' keys are not passed (`engine/src/board/checkers.ts`). It is not in a container. The `--restricted` mode was not tested with a live call. Details: [configuration.md](configuration.md#drug-board-boardconfigyaml).

## The board (`board/agents/*.md`)

The board runs our own swarm. It will compete with the BixBench swarm, which is the baseline, at equal
compute. **Status: prompts only, scripted runs only.** The nine roles of the plan are covered by **six
model agents and three code checks**. Fewer agents means fewer model calls: every member is called every
round, and each call resends its whole conversation.

| Role | Done by | Task | Model tier |
|---|---|---|---|
| Lead Scientist | agent `lead-scientist` | Frames the question, gives each member its task and mode, writes the memo | lead (Opus) |
| Scout | agent `scout`, and code | The only member that searches. It opens every review with a search on the brief's main question and reports the sources the others can cite. It is first in `board:` and must stay: a test fails if the roster has no member with a search tool. The brief check before anything runs is code (`loadBrief`, `brief.required_sections`). There is no dataset to inspect yet. | cheap |
| Proposer (triage) | agent `proposer` | 3 to 8 claims, each with a priority and a share of the budget | strong |
| Pilot | agent `experimenter`, mode `pilot` | Subsample test; claims that fail early are dropped | strong |
| Experimenter | agent `experimenter`, mode `full` | The analysis per claim, highest priority first | strong |
| Methods Auditor | agent `methods-auditor` | Were the methods right? | strong |
| Critic | agent `critic` | Is the conclusion true? Works on its own, not from the Auditor's report | rival (second vendor) |
| Reviser | agent `experimenter`, mode `revise` | Fixes only what was flagged; at most 2 review rounds | strong |
| Finisher | code | `write_memo` is refused until the memo has every section in `MEMO_SECTIONS` (`engine/src/board/board.ts`). It never fills a section in. | none |
| Reporter | agent `reporter` | Supported findings and the rejection log | strong |
| Board (shared record) | code | One budget per run, the claim ledger in `run.json` and `verification_ledger.json`, verdicts from the checkers | none |

**Modes: one agent, several roles.** An agent file can declare `modes:` (for example
`modes: {pilot: "Pilot", full: "Experimenter", revise: "Reviser"}` in `experimenter.md`). The lead names
a mode per round in `converse` (`modes: {"experimenter": "pilot"}`). Code checks it (`checkModes`): an
unknown member or mode is refused, and the round is not counted. The member's input starts with
"Mode: ...". Each `member.replied` event carries `mode`, and `GET /api/roster` lists each member's
`modes`, so the dashboard can show one figure per role. The agent keeps one conversation, so the Reviser
remembers what the Pilot did. Limit: one mode per member per round.

Other limits:

- Every member gets every round. The scout replies first; the others then reply **at the same time**. The
  engine does not run the other roles in order. The lead follows a round plan in its prompt, and a member
  with no task replies "No task."
- Only the scout has tools, and only search tools. No member can run code or read files. Results that were
  not run are marked "not run". (The rule "no open web search" in `AGENTS.md` is about the benchmark swarm
  under `glhf/`; a board review is not a benchmark run.)
- The checkers decide each claim's verdict. The Critic's labels are its view, not the verdict.

To add or bench a member, add or remove a line under `board:` in `board/config.yaml` and add an agent file. Tiers map to `<vendor>/<model>` ids in `models:` (Anthropic or OpenAI only), so changing a model is a one-line edit. Keep `rival` (the Critic) on a different vendor from `lead`.

## How it stays cheap

1. **A cheap model before the expensive ones.** Every Exa result is screened by the `cheap` tier (relevant? reports results? study type?) before a member reads it, in one call per search. A result already in the pool, or already dropped for the same key question, is not screened again.
2. **A cheap model makes the first check of each claim.** Members end each reply with a `CLAIMS` section. The first pass reads the cited source and answers in strict JSON: `supports`, `contradicts`, `not_stated` or `unclear`, **with a quote** of the source passage. Code then decides (`engine/src/board/triage.ts`):
   - `supports` is **verified** only if the quote is really in the source text (case and spacing aside), is at least 20 characters, and contains every number of the claim (digits inside names such as CMP-0517 or H358 are ignored; a minus sign counts);
   - `contradicts` is **contradicted** only if its quote is in the source;
   - `not_stated` is **unsupported**;
   - `unclear`, any reply that is not exactly the expected JSON (also truncated, repeated or out-of-range entries), a quote that is not in the source, or a missing number is **escalate**. Nothing malformed is ever verified.
   - **Independence:** the checker is never from the same vendor as the member who made the claim. The `cheap` tier (Anthropic) checks claims of OpenAI members; `checkers.first_pass.alt` (OpenAI) checks everyone else's. If both were on one vendor, the first pass could not verify anything.
   - Reasoning is switched off for these calls where the model allows it, and their output is capped.
3. **Only unsettled claims go to a second checker**: literature claims go to a model from the other vendor than the claim's author (OpenAI for Claude members, the strong-tier Claude model for the OpenAI critic; with no such model the claim stays `unchecked`). Computed claims are **not sent to Claude Code at all** while it runs `--restricted` (it cannot run code): they are recorded `unchecked` with the reason "computed claim not re-executed". At most `meeting.max_escalations` second checks per run, each with a time limit (`checkers.timeout_seconds`). A check that fails or times out records the claim as unsupported.
   A claim that the same member repeats from the same source in a later round is not checked again: the earlier ruling is copied into the new round's ledger row.
4. **One budget per run** (`meeting.max_usd`, `max_minutes`, `max_rounds`). It counts models, the first-pass checker, the second checkers and Exa. A round is not started when the last round's cost would take the run past `max_usd`, and no first-pass check, escalation or search is started once the cap is reached (the claim is recorded `unchecked`). Worst-case overshoot: the round in progress when the cap is crossed (every member's turns, up to `member_turns` each), plus the one final-positions round. `meeting.daily_usd` limits all runs started on one day; past it, starts and resumes are refused. If a model reports tokens but no cost, the price `meeting.fallback_usd_per_mtok` is used.

Every key of `board/config.yaml` is listed in [configuration.md](configuration.md#drug-board-boardconfigyaml).

## Memory

With `memory.enabled: true`, each member's verified and contradicted claims are added to `board/expertise/<member>.md` after a run, under the heading `## From earlier runs`. The file is read into that member's instructions in the next run. Text above the heading is yours and is kept. Scripted runs write to the run folder, so made-up claims never reach `board/expertise/`.

All first-pass wording lives in `engine/src/questions.ts`. All decision logic lives in `engine/src/board/triage.ts`. Which provider and key each tier needs: `engine/src/providers.ts`.

## Before the first real run

1. `cd engine && npm run preflight`. It needs the real keys (from `.env`) and makes **no billed call**: only a model-list request to each vendor (`GET /v1/models`, no completion) and no search. It checks that each tier's key is set and accepted, that each model id is in the vendor's list and has a price in the catalog, and it prints the caps, what Exa has used of the $40 ceiling, and an estimated worst case for one run. It prints which endpoints it called and exits 1 naming anything that would fail. It refuses to run when `PAID_SWITCH_LOCKED=1`.
2. Lower the cap for the first run: `npm run board -- run <brief> --max-usd 0.5` (a plan's limits work the same way). The value can only lower the cap in `board/config.yaml`.
3. If a vendor refuses a model id (404) or a key (401, 403) on a call, the run stops at once with a plain message naming the tier, the model and the vendor, spends nothing more, and is listed as `failed` with that message (not `running`). Fix `board/config.yaml` or `.env` and resume it. Rate limits (429) and server errors are not treated this way.

## The paid switch (practice mode and real mode)

Paid calls start off. The dashboard's switch (`POST /api/paid`) turns them on **for the running engine only**: it is kept in memory and a restart goes back to `.env`. It needs the session token, the exact text `I will be charged`, every key the board needs, and `PAID_SWITCH_LOCKED` not set to 1. Details and what it does when turned off: [configuration.md](configuration.md#paid-calls-no_paid_calls-and-the-runtime-switch). A run keeps the mode it started in: switching never relabels past runs, and a real run is not continued as scripted.

## How the evidence reaches the members

The scout (the only member with a search tool) replies first in each round; the other members then get its screened sources in their prompt (title, study type, URL and the text kept, up to 12 sources, marked as data). A `[literature]` claim is checked against the text kept for the source it cites, so cite a source by its exact URL. Highlights from the search are what is kept, so a claim whose numbers are not in them goes to the second checker and may end `unsupported`: this is honest, and it makes `verified` rarer. If it proves too rare in a real run, ask Exa for longer highlights with `meeting.exa_highlight_chars` (the price of that was not verified). Each member's reply may open with `In short: ...`; the engine parses that line into `summary` on the `member.replied` event.

## What a real run checks, and what was lost

- **Evidence.** Only the scout has `exa_search`; the other members have no tool. What the scout finds is screened by the cheap model and enters the evidence pool; a claim can be verified only against a source in that pool (or the brief). A `[literature]` claim that cites anything else (a URL from a model's memory, or a source another member read) is recorded `unsupported` ("source is not in the screened evidence pool"), without a model call. Search is capped at 20 per run, counted in `max_usd`, and limited by a $40 lifetime ceiling (`board/runs/.exa-ledger.jsonl`).
- **Not calibrated any more.** The old checker (Jev) returned calibrated probabilities. A language model's own confidence is not calibrated, so there are no probability thresholds. In their place is a check that code can do: the quote must be in the source. Its weakness: a real quote does not prove that the passage supports the claim, and a web page can contain text written to be quoted. Treat `verified` as "a model from another vendor found a real passage that matches, with the same numbers".

## Durable over time (Pi Durable)

The engine is built on [`@earendil-works/pi-durable`](https://github.com/earendil-works/pi). Every model turn, tool call and member reply is committed to `board/runs/<run>/session.sqlite` before it's shown. Kill the process at any point, then run `npm run resume <run-id>` or restart the engine: the run continues where it stopped. Tools are replay-safe and member inputs carry stable request IDs, so a finished model turn or claim check is not asked or paid for again. A check that was running when the process died runs again. A lock file (`board/runs/<run>/run.lock`, code in `engine/src/runlock.ts`) keeps two processes off the same run. The lock stores the process id and the start time of the process. So a lock that is left after a crash, a restart or `docker compose down` does not block the run, also when the system gives the same process id to a new process (in a container the engine has the same process id on every start). Limit: an engine in a container and a CLI on your machine cannot see each other's processes, so the lock does not keep those two apart.

## Guarding against multi-agent failure modes

These come from the failure-mode probes in [acyclic-labs/sdk `research/experiments`](https://github.com/acyclic-labs/sdk/tree/main/research/experiments):

| Failure mode | Guard here |
|---|---|
| Sycophancy cascade (claimed consensus moves agents to a wrong answer) | Round 1 is blind: members answer independently (fan-out, not chain). Later digests show arguments with verdicts, never vote tallies. |
| Orchestrator deference | The lead assigns tasks and doesn't reveal its leaning before final positions. The Critic runs on a different vendor. |
| Error propagation (one wrong seed spreads) | Evidence is screened before it enters the shared pool. Contradicted claims are marked in every later digest. |
| Budget scaling | One aggregate budget per run, not per agent. Unknown cost is recorded as unknown, not zero. |

## Layout

```
board/                 config.yaml, agents/, briefs/ (+ _template.md), context/ (shared), expertise/, runs/
engine/src/            board.ts (Pi Durable), triage.ts + questions.ts + providers.ts, exa.ts + exaledger.ts, checkers.ts, claims.ts,
                       models.ts (Anthropic and OpenAI directly / scripted), mock.ts, app.ts (HTTP + SSE handler), server.ts (listens),
                       http.ts, runlock.ts, cli.ts
engine/src/glhf/       not part of the board: the GLHF run tracker
dashboard/             the web UI (React); the board is dashboard/src/views/BoardView.tsx
```

## Next steps

- [ ] Add keys; run the example brief live; check that the model ids resolve and the first-pass JSON is accepted.
- [ ] Watch mode: scheduled Exa searches reopen a run when new evidence changes a verdict. The `watch:` keys exist in the config, but no code uses them yet.
- [x] Members' checked claims are written to their `expertise/` files after each run (see Memory).
- [ ] Run the phases in order in code instead of all at once, and call only the members with a task.
- [ ] One Experimenter conversation per claim, run in parallel, with each claim's budget share enforced in code.
- [ ] A data workspace, so the Scout and the Finisher can check real files in code. A code tool for the Experimenter (all three modes), in a sandbox, with `refusePaid()` and replay keys. Today no member can run code, and the Claude Code checker does not run code by default.
- [ ] Brief sections for research tasks. `brief.required_sections` in `board/config.yaml` still asks for drug sections (Candidates, Target and Indication).
- [ ] Evals in the acyclic style: plant a wrong claim, fork the session at the same entry, and measure how often the board adopts it.
- [ ] Hosting: Modal for long runs and scheduled watch mode. Planned only; no code uses Modal.

Decision support only. This doesn't replace expert review or regulatory judgment.

## Free literature search (Europe PMC)

The scout has a second search tool, `literature_search` (`engine/src/search/literature.ts`). It searches PubMed and
preprints through [Europe PMC](https://europepmc.org/RestfulWebService) and returns abstracts. It needs no key and
costs nothing, so it does not use the Exa credit. The order of the scout's searches is fixed in its instructions
(`searchOrder` in `engine/src/board/agents.ts`, and `board/agents/scout.md`): one `exa_search` on the brief's main question
opens every review, then `literature_search` on each key question, then `exa_search` again only for what the other
searches cannot find. The caps are unchanged (20 Exa searches a run, the $40 lifetime ceiling), and a refused or
failed search is said plainly and never replaced by example sources. Its results go through the same screening and the same evidence pool as Exa's, and a
statement is "verified" only when the quoted passage is in the abstract. Limits: `meeting.max_literature_searches`
per run (default 20); abstracts only, not full papers; preprints are marked `[preprint]`. A practice run reaches no
network and gets the example sources. A query that finds nothing is tried again with fewer words. Not yet done: a real
board run that uses it, and listing it in the Home catalogue.

## Method specialists (from a chat plan)

A plan drafted in the Home chat can add **method specialists** to one board review. A specialist is a profile or a
method agent from `glhf/specialists/` (the **Method library**: 58 method skills with notes, held by 19 method agents,
plus four domain profiles with no notes). The code is `engine/src/specialists.ts` (loading, cleaning, the
instructions) and `engine/src/chat/plan.ts` (choosing).

**What is wired**

| Step | What happens | Code |
|---|---|---|
| Choosing | The question's words are compared with each method's notes and each profile's trigger. A word of a method's name or of a trigger counts 2, another shared word 1; 2 points on one method (or on the profile) are needed. A few question words are read through a short list (`ALIASES`: "hERG" is read as "safety"); the plan's reason shows it. With a model (AI mode) the model may name specialists; every name is checked against the catalog and unknown ones are dropped. | `matchSpecialists`, `planFrom` |
| Places | A specialist takes a place **inside** the level's member limit (Quick: 3 members; Standard and Deep: the size of the roster). The lead, the scout and the proposer always stay; the Critic stays at Standard and Deep. Specialists get at most half of the places that are left, rounded up. No limit and no spend cap is raised. | `agentsFor`, `memberLimit` |
| Running | The start writes the chosen specialists into the run's `overrides.json`. `board.ts` adds them to the roster for that run only (`runSpecialists` checks every name and method again, and adds no more than the free places). Each is a normal member: its own durable conversation, the shared context, "In short:", the CLAIMS section, a blind first round, and its claims are checked like anyone's. It has **no tools** and runs on the `strong` tier. | `runSpecialists`, `runLocked` |
| Instructions | First a fixed frame: it cannot run code or install anything; it says which analysis would settle the question, the pitfalls, and what the brief's data can and cannot support; it challenges other members by name; it reports no result that is not in the brief or in the sources the board found; decision support only, no synthesis route for a hazardous compound. Then its role, then the notes of the matched methods. **Caps:** at most 4 methods, 1,200 characters per method, 8,000 characters for the specialist's whole own prompt (the deliverable, CLAIMS format, shared context and brief come after, as for every member). | `specialistPrompt` |
| Events | Every run writes one `run.roster` event (key `roster`): the lead and the members, each with `source` (`board` or `specialist`), and for a specialist a plain title, one line of why it was chosen and its methods. `GET /api/chat/roster?run=<id>` returns the same with tier and tools. | `rosterEntries`, `chat/roster.ts` |
| Practice runs | A specialist's scripted reply is fixed text that says so ("This is fixed example text for a practice run, not a method result."), with no number and no claim. | `MOCK_SPECIALIST_REPLY` in `mock.ts` |

**Rules enforced in code** (tests: `engine/test/specialists-load.test.ts`, `specialists-plan.test.ts`, `specialists-run.test.ts`)

- Skill 11 (its text describes a way round a paywall) and skills 96 and 97 (billed multi-machine compute) are never loaded: by number, by name and by what their text says. One more skill is left out because it is a tool of the outside product the list came from.
- A skill that is a name only (38 of the 100) is never loaded, never shown as something a specialist can do, and never the reason a specialist is chosen.
- Method notes are treated as data. Each field is one line, cleaned and cut. URLs, install, download and run instructions for packages that are not here, and every line that names where the text came from are removed before the text reaches a prompt, a plan, an event or an API response. The files keep those lines as the provenance record (`docs/proposals/licenses.md`).
- A specialist file cannot set tools, a model tier, a mode or a limit: these are fixed in `specialists.ts`.

**What is not wired, and not verified**

- **The swarm in `glhf/bixbench` does not use the specialists or the method skills.** Only the drug board does.
- Nothing is executed. The skill packages are not installed and no member has a code tool. The notes are short (a scope, what the method needs, what it would produce, flags): they are not the long procedure texts.
- **No real model has run a specialist.** Everything above was tested with scripted models. Whether a model keeps to the frame, and whether a specialist improves a review, is not known.
- The choice is a word match. It can miss (a question about a method whose skill is a name only gets no specialist for it) and it can pick a neighbour (a "differential expression" question gets the bulk RNA-seq agent with its notes on counts, deconvolution and consensus signatures, because the differential-expression skill itself is a name only).
- `GET /api/roster?run=<id>` (the board's own roster route) is served by `rosterFor` in `engine/src/chat/roster.ts` once `app.ts` calls it; until then use `GET /api/chat/roster?run=<id>`.

## Free database records (`database_search`)

The scout has a third search tool, `database_search` (`engine/src/sources/`, one file per database). It reads one
public database and returns its records. None needs a key and none costs money. In the scout's order of searches it
comes third: web search, then the literature, then the databases (`searchOrder` in `engine/src/board/agents.ts`).

| `source` | Database | What a lookup returns | The record's page (the URL to cite) |
|---|---|---|---|
| `chembl` | ChEMBL (EMBL-EBI) | A compound's record (highest clinical phase, mechanism, calculated properties) and its most potent measured values, one item per assay; or the most potent compounds against a target | `www.ebi.ac.uk/chembl/explore/compound/…`, `/target/…`, `/assay/…` |
| `clinicaltrials` | ClinicalTrials.gov | Up to 8 trials: phase, status, enrollment, conditions, interventions, primary outcome, sponsor, dates, whether results are posted | `clinicaltrials.gov/study/NCT…` |
| `openfda` | openFDA | The newest FDA label that names the drug, one item per section (boxed warning, warnings, adverse reactions, contraindications, indications), and the counts of adverse-event reports by reaction | The label on DailyMed (`…drugInfo.cfm?setid=…#section`); for the counts, the openFDA request itself |
| `opentargets` | Open Targets Platform | A target's record (tractability, safety liabilities, function) and its strongest target-disease associations with their scores | `platform.opentargets.org/target/ENSG…`, `/evidence/ENSG…/<disease id>` |
| `uniprot` | UniProt | The best-matching reviewed entry: function, disease involvement, natural variants, subcellular location | `www.uniprot.org/uniprotkb/<accession>/entry#…`, `/variant-viewer` |
| `pubchem` | PubChem | A compound's identity and computed properties, and experimental properties from sources with an open licence | `pubchem.ncbi.nlm.nih.gov/compound/<CID>` |

How a record is turned into a source:

- Each record becomes plain text that holds the values **as the database wrote them**. Nothing is converted or rounded
  (`4.0` stays `4.0`), codes such as `PHASE3` or `RECRUITING` are kept, and a field the database does not give is left
  out, never filled in. A statement is "verified" only when the checker's quoted passage, with its numbers, is in that text.
- The URL is built only from an id that passed a strict pattern (an NCT number, a ChEMBL id, an accession ...), never
  from free text.
- Limits: at most 8 items per lookup, 3000 characters per item (cut at a sentence or a word, with `[...]`), at most 4
  requests per lookup, a 15-second timeout per request and 45 seconds per lookup, no retries, and at most one request
  every 1.5 seconds to a host.
- The engine keeps each good answer in memory for 10 minutes (at most 200 answers, `engine/src/sources/shared.ts`). The
  same request made again in that time, by another lookup or another run, sends nothing and waits no gap. A failure is
  not kept. Open Targets finds a gene symbol and reads its target in one request.
- `meeting.max_database_searches` lookups per run (default 20). A lookup is free, but its records are screened by the
  first pass, so it is refused at the spend cap and when paid calls are switched off. A database that does not answer
  does not stop the run: the scout is told, and the lookup is not counted. A crash replay reads the stored result.
- Screening: a database record is kept unless the first pass says it is off-topic. (For papers the first pass also
  drops a source that "reports no results of its own"; a trial registration or a label section would fail that rule.)
- A practice run reaches no network: the lookup returns the example sources, labelled as such.

Every source in the pool keeps the search that found it (`provider`: `exa`, `europepmc`, one of the six database
names, or `fixture`) and the query (`query`), in `run.json` and in the `evidence.triaged` event. A source found again
by a later search keeps the search that found it first.

Things to know before relying on it:

- **Not yet done: a real board run that uses it.** The clients were run against the live services by hand, and the
  tests use saved answers; no real model has called the tool.
- ChEMBL lookups give the **most potent** values first. That end of a list also holds outliers and data errors. One
  value is one experiment.
- Adverse-event counts are spontaneous reports, not rates. An Open Targets score measures how much evidence there is,
  not the size of an effect. A trial record says what was planned or done, not that a drug works.
- PubChem's experimental values come from other sources with their own licences. A value is passed on only when
  PubChem's record of its source states public domain, CC BY or CC0, or the source is NLM's HSDB; the others (DrugBank,
  HMDB, Haz-Map and so on) are left out and counted in a note to the scout.
- openFDA allows 1,000 requests a day per IP address without a key. One lookup uses up to 3.
