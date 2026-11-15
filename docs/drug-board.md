# Drug Candidate Board

A lead scientist and a board of research agents decide whether drug candidates should advance. Each board member has one task and one deliverable. Checkers verify every claim. The output is a go / no-go memo.

The pattern follows IndyDevDan's "CEO and board" video (brief in, memo out, constrained debate, specialized agents, persistent expertise). Here the CEO is a **Lead Scientist**, and the board is research staff working through the literature.

![Board view](board.png)

The Board view shows a plain summary (progress, recommendation, how many claims checked out, open questions, next steps). Tick **Show details** for the full roster, discussion with per-claim verdicts, evidence pool and memo ([screenshot](board-details.png)).

> **Status.** The board runs from brief to memo on scripted models (no keys). With `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `NO_PAID_CALLS=0` in `.env` it calls those two providers directly. This repository holds no record of a finished run with real models, and none of the model ids, the structured-output format or the cost per run has been tried with a paid call, so treat the live path as not verified. The board is the older project in this repository; the main project is the GLHF swarm ([README](../README.md)).

```
brief.md ──▶ Lead Scientist ──converse──▶ 9 board members (parallel, each its own durable conversation)
                 ▲                            │ no member searches today (tools: [])
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
npm run desktop         # same UI as a Tauri desktop app (needs Rust)
```

In VS Code, run **Tasks: Run Task → Board: start all** to start the engine and dashboard together.

## Keys

**Paid calls are off by default.** While `NO_PAID_CALLS` is not exactly `0`, the board runs on scripted models, also when every key below is set (`mockMode` in `engine/src/config.ts`). A live run needs `NO_PAID_CALLS=0` in `.env`, set by the person who pays, and a restart of the engine. See [running.md](running.md#paid-calls-no_paid_calls).

| While paid calls are off | What happens | Code |
|---|---|---|
| Board models (lead and members) | Scripted. No real provider is registered. | `engine/src/models.ts` |
| First-pass checker (cheap model) | Refused before any call. | `engine/src/triage.ts` |
| OpenAI checker | Refused before any call. | `engine/src/checkers.ts` |
| Claude Code checker | Refused before the process is started. | `engine/src/checkers.ts` |
| Exa literature search | Refused before the request. | `engine/src/exa.ts` |
| A run that was started with real models | Not continued, in the engine (HTTP 403 on resume) and in `npm run resume` (exit status 3). It stays paused. A finished run and a scripted run are not affected. | `refusePaidRun` in `engine/src/board.ts` |

In a scripted run the checkers and the search give scripted answers, so nothing is refused; the refusals above are a second barrier for code paths that would reach a real service. Tested in `engine/test/paid.test.ts`, with no network.

With paid calls allowed, a live run needs the key of **every tier** in `board/config.yaml`: Anthropic for `lead`, `strong` and `cheap`, OpenAI for `rival`, the first-pass checker of Claude members' claims and the literature checker (`engine/src/providers.ts`). If one is missing, the run is refused when it starts, with the tier and the key named (HTTP 503). It is **never** silently run with scripted models: a run that looks real but is scripted is the worst outcome. With `DRUG_BOARD_MOCK=1` the board is scripted on purpose. Copy `.env.example` to `.env`:

| Key | Used for | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | `lead`, `strong`, `cheap` tiers (Claude Sonnet 5.5 lead and strong, Haiku 5.5 cheap) | yes |
| `OPENAI_API_KEY` | `rival` tier (the Critic, GPT-5 mini), first-pass checker of Claude members' claims, literature checker | yes |
| `EXA_API_KEY` | Search, for a member that has the `exa_search` tool (none has it today) | only then |

Claude Code (the checker for computed claims) uses your existing `claude` login. By default it runs with `--restricted` and **cannot run code**: it checks a claim by reasoning and answers "unsupported" when that is not enough. It runs in an empty temporary folder, with only the tools named in `checkers.claude_code_tools` (`Read Write`), and with a fixed list of environment variables, so other providers' keys are not passed (`engine/src/checkers.ts`). It is not in a container. The `--restricted` mode was not tested with a live call. Details: [configuration.md](configuration.md#drug-board-boardconfigyaml).

## The board (`board/agents/*.md`)

The board now holds the nine roles of our own swarm. It will compete with the BixBench swarm, which is
the baseline. **Status: prompts only, scripted runs only.** Two limits:

- Every member gets every round **at the same time**. The engine does not run the roles in order yet, and
  it has no review loop of its own. The lead asks for the order and for at most three review rounds in
  its messages.
- Members have **no tools**: no code, no file access, no search. Pilot, Experimenter, Reviser and Finisher
  describe work they cannot run, and they mark it "not run". No member has open web search, because
  benchmark agents get none (see `AGENTS.md`).

| Member | Task | Deliverable | Model tier |
|---|---|---|---|
| Lead Scientist | Frames the question, gives each role its task by name, writes the memo | Memo | lead (Opus) |
| Scout | Inspects the data: files, damage, sample groups, software | Data report | cheap |
| Proposer | Writes the analysis plan and 3 to 8 claims to test | Research plan | strong |
| Pilot | Tests the analysis on part of the data | Tested scripts | cheap |
| Experimenter | Runs the analysis on the full data | Results, tables, output files | strong |
| Methods Auditor | Checks the methods against the study instructions | Methods report | strong |
| Critic | Tries to disprove the claims | Supported / rejected / not yet established | rival (second vendor) |
| Reviser | Fixes what the Auditor and the Critic flagged | Corrected analyses and a change log | strong |
| Finisher | Checks that each required output exists and opens; never makes up results | Final list of output files | cheap |
| Reporter | Writes the methods, findings, rejected claims and limits | Report and rejection ledger | strong |

The checkers decide each claim's verdict. The Critic's labels are its view, not the verdict.

To add or bench a member, add or remove a line under `board:` in `board/config.yaml` and add an agent file. Tiers map to `<vendor>/<model>` ids in `models:` (Anthropic or OpenAI only), so changing a model is a one-line edit. Keep `rival` (the Critic) on a different vendor from `lead`.

## How it stays cheap

1. **A cheap model before the expensive ones.** Every Exa result is screened by the `cheap` tier (relevant? reports results? study type?) before a member reads it, in one call per search. A result already in the pool, or already dropped for the same key question, is not screened again. (No member searches today, so this step does not run; see "What a real run checks" below.)
2. **A cheap model makes the first check of each claim.** Members end each reply with a `CLAIMS` section. The first pass reads the cited source and answers in strict JSON: `supports`, `contradicts`, `not_stated` or `unclear`, **with a quote** of the source passage. Code then decides (`engine/src/triage.ts`):
   - `supports` is **verified** only if the quote is really in the source text (case and spacing aside), is at least 20 characters, and contains every number of the claim (digits inside names such as CMP-0517 or H358 are ignored; a minus sign counts);
   - `contradicts` is **contradicted** only if its quote is in the source;
   - `not_stated` is **unsupported**;
   - `unclear`, any reply that is not exactly the expected JSON (also truncated, repeated or out-of-range entries), a quote that is not in the source, or a missing number is **escalate**. Nothing malformed is ever verified.
   - **Independence:** the checker is never from the same vendor as the member who made the claim. The `cheap` tier (Anthropic) checks claims of OpenAI members; `checkers.first_pass.alt` (OpenAI) checks everyone else's. If both were on one vendor, the first pass could not verify anything.
   - Reasoning is switched off for these calls where the model allows it, and their output is capped.
3. **Only unsettled claims go to a second checker**: literature claims go to OpenAI. Computed claims are **not sent to Claude Code at all** while it runs `--restricted` (it cannot run code): they are recorded `unchecked` with the reason "computed claim not re-executed". At most `meeting.max_escalations` second checks per run, each with a time limit (`checkers.timeout_seconds`). A check that fails or times out records the claim as unsupported.
   A claim that the same member repeats from the same source in a later round is not checked again: the earlier ruling is copied into the new round's ledger row.
4. **One budget per run** (`meeting.max_usd`, `max_minutes`, `max_rounds`). It counts models, the first-pass checker, the second checkers and Exa. A round is not started when the last round's cost would take the run past `max_usd`, and no first-pass check, escalation or search is started once the cap is reached (the claim is recorded `unchecked`). Worst-case overshoot: the round in progress when the cap is crossed (every member's turns, up to `member_turns` each), plus the one final-positions round. `meeting.daily_usd` limits all runs started on one day; past it, starts and resumes are refused. If a model reports tokens but no cost, the price `meeting.fallback_usd_per_mtok` is used.

Every key of `board/config.yaml` is listed in [configuration.md](configuration.md#drug-board-boardconfigyaml).

## Memory

With `memory.enabled: true`, each member's verified and contradicted claims are added to `board/expertise/<member>.md` after a run, under the heading `## From earlier runs`. The file is read into that member's instructions in the next run. Text above the heading is yours and is kept. Scripted runs write to the run folder, so made-up claims never reach `board/expertise/`.

All first-pass wording lives in `engine/src/questions.ts`. All decision logic lives in `engine/src/triage.ts`. Which provider and key each tier needs: `engine/src/providers.ts`.

## What a real run checks, and what was lost

- **Evidence.** No member has `exa_search` (their `tools` are empty), so the evidence pool stays empty. A `[literature]` claim cites a source that is not in the pool and is recorded `unsupported` with the note "source is not in the screened evidence pool", without any model call. Only `[brief]` claims, checked against the brief's Candidates and Available Data sections, can be verified. Search, the Exa caps (20 searches, counted in `max_usd`, a $40 lifetime ceiling in `board/runs/.exa-ledger.jsonl`) and triage are built and tested but have nothing to act on until a member is given the tool.
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
dashboard/             the web UI (Tauri + React); the board is dashboard/src/views/BoardView.tsx
```

## Next steps

- [ ] Add keys; run the example brief live; check that the model ids resolve and the first-pass JSON is accepted.
- [ ] Watch mode: scheduled Exa searches reopen a run when new evidence changes a verdict. The `watch:` keys exist in the config, but no code uses them yet.
- [x] Members' checked claims are written to their `expertise/` files after each run (see Memory).
- [ ] Run the nine roles in order (Scout, Proposer, Pilot, Experimenter, then review, Finisher, Reporter) instead of all at once.
- [ ] A code tool for Pilot, Experimenter, Reviser and Finisher, in a sandbox, with `refusePaid()` and replay keys. Today no member can run code, and the Claude Code checker does not run code by default.
- [ ] Brief sections for research tasks. `brief.required_sections` in `board/config.yaml` still asks for drug sections (Candidates, Target and Indication).
- [ ] Evals in the acyclic style: plant a wrong claim, fork the session at the same entry, and measure how often the board adopts it.
- [ ] Hosting: Modal for long runs and scheduled watch mode. Planned only; no code uses Modal.
- [ ] Add the Exa key to the dashboard Settings (keychain) instead of `.env`.

Decision support only. This doesn't replace expert review or regulatory judgment.
