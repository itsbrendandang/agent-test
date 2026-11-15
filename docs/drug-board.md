# Drug Candidate Board

A lead scientist and a board of research agents decide whether drug candidates should advance. Each board member has one task and one deliverable. Checkers verify every claim. The output is a go / no-go memo.

The pattern follows IndyDevDan's "CEO and board" video (brief in, memo out, constrained debate, specialized agents, persistent expertise). Here the CEO is a **Lead Scientist**, and the board is research staff working through the literature.

![Board view](board.png)

The Board view shows a plain summary (progress, recommendation, how many claims checked out, open questions, next steps). Tick **Show details** for the full roster, discussion with per-claim verdicts, evidence pool and memo ([screenshot](board-details.png)).

> **Status.** The board runs from brief to memo on scripted models (no keys). With `OPENROUTER_API_KEY` and `NO_PAID_CALLS=0` in `.env` it uses real models. This repository holds no record of a finished run with real models, so treat the live path as not verified. The board is the older project in this repository; the main project is the GLHF swarm ([README](../README.md)).

```
brief.md ──▶ Lead Scientist ──converse──▶ 5 board members (parallel, each its own durable conversation)
                 ▲                            │ no member searches today (tools: [])
                 │                            ▼
                 └── replies + verdicts ◀── claim checks: Jev first ─(uncertain)─▶ OpenAI / Claude Code
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
| Jev checker | Refused before any call. | `engine/src/jev.ts` |
| OpenAI checker | Refused before any call. | `engine/src/checkers.ts` |
| Claude Code checker | Refused before the process is started. | `engine/src/checkers.ts` |
| Exa literature search | Refused before the request. | `engine/src/exa.ts` |
| A run that was started with real models | Not continued, in the engine (HTTP 403 on resume) and in `npm run resume` (exit status 3). It stays paused. A finished run and a scripted run are not affected. | `refusePaidRun` in `engine/src/board.ts` |

In a scripted run the checkers and the search give scripted answers, so nothing is refused; the refusals above are a second barrier for code paths that would reach a real service. Tested in `engine/test/paid.test.ts`, with no network.

With paid calls allowed, the only required key for a live run is **`OPENROUTER_API_KEY`**. Every board model and Jev (`typesafe/jev-1.14`) go through it, so you do not need a key per model. Without it, or with `DRUG_BOARD_MOCK=1`, the board uses scripted models. Copy `.env.example` to `.env`:

| Key | Used for | Required |
|---|---|---|
| `OPENROUTER_API_KEY` | All agents (Opus lead, Sonnet / Gemini Flash / GPT-mini members) + Jev | yes |
| `EXA_API_KEY` | Literature search | for real searches |
| `OPENAI_API_KEY` | Escalation checker for contested literature claims | optional |
| `TYPESAFE_API_KEY` | Jev directly instead of through OpenRouter | optional |

Claude Code (the checker for computed claims) uses your existing `claude` login. By default it runs with `--restricted` and **cannot run code**: it checks a claim by reasoning and answers "unsupported" when that is not enough. It runs in an empty temporary folder, with only the tools named in `checkers.claude_code_tools` (`Read Write`), and with a fixed list of environment variables, so other providers' keys are not passed (`engine/src/checkers.ts`). It is not in a container. The `--restricted` mode was not tested with a live call. Details: [configuration.md](configuration.md#drug-board-boardconfigyaml).

## The board (`board/agents/*.md`)

The board runs our own swarm. It will compete with the BixBench swarm, which is the baseline, at equal
compute. **Status: prompts only, scripted runs only.** The nine roles of the plan are covered by **five
model agents and three code checks**. Fewer agents means fewer model calls: every member is called every
round, and each call resends its whole conversation.

| Role | Done by | Task | Model tier |
|---|---|---|---|
| Lead Scientist | agent `lead-scientist` | Frames the question, gives each member its task and mode, writes the memo | lead (Opus) |
| Scout | code | The brief check before anything runs (`loadBrief`, `brief.required_sections`). There is no dataset to inspect yet. | none |
| Proposer (triage) | agent `proposer` | 3 to 8 claims, each with a priority and a share of the budget | strong |
| Pilot | agent `experimenter`, mode `pilot` | Subsample test; claims that fail early are dropped | strong |
| Experimenter | agent `experimenter`, mode `full` | The analysis per claim, highest priority first | strong |
| Methods Auditor | agent `methods-auditor` | Were the methods right? | strong |
| Critic | agent `critic` | Is the conclusion true? Works on its own, not from the Auditor's report | rival (second vendor) |
| Reviser | agent `experimenter`, mode `revise` | Fixes only what was flagged; at most 2 review rounds | strong |
| Finisher | code | `write_memo` is refused until the memo has every section in `MEMO_SECTIONS` (`engine/src/board.ts`). It never fills a section in. | none |
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

- Every member gets every round **at the same time**. The engine does not run the roles in order. The
  lead follows a round plan in its prompt, and a member with no task replies "No task."
- Members have **no tools**: no code, no file access, no search. Results that were not run are marked
  "not run". No member has open web search, because benchmark agents get none (see `AGENTS.md`).
- The checkers decide each claim's verdict. The Critic's labels are its view, not the verdict.

To add or bench a member, add or remove a line under `board:` in `board/config.yaml` and add an agent file. Tiers map to OpenRouter model IDs in `models:`, so changing a model is a one-line edit.

## How it stays cheap

1. **Jev before LLMs.** Every Exa result is triaged by Jev (relevant? reports results? study type?) before any agent reads it.
2. **Jev checks claims.** Members end each reply with a `CLAIMS` section. Jev judges each claim against its cited evidence (`supports` / `contradicts` Nouls, one request per evidence source). Code holds the truth table:
   contradicts > 0.7 → contradicted · supports > 0.7 → verified · both < 0.3 → unsupported · otherwise → **escalate**.
3. **Only uncertain claims go to a second checker**: literature claims go to OpenAI, computed claims to Claude Code (Jev does not do math; by default Claude Code also does not run code, see Keys). At most `meeting.max_escalations` second checks per run, each with a time limit (`checkers.timeout_seconds`). A check that fails or times out records the claim as unsupported.
4. **One budget per run** (`meeting.max_usd`, `max_minutes`, `max_rounds`). Past a limit, the lead is told to finish. `meeting.daily_usd` limits all runs started on one day; past it, starts and resumes are refused. If a model reports tokens but no cost, the price `meeting.fallback_usd_per_mtok` is used.

Every key of `board/config.yaml` is listed in [configuration.md](configuration.md#drug-board-boardconfigyaml).

## Memory

With `memory.enabled: true`, each member's verified and contradicted claims are added to `board/expertise/<member>.md` after a run, under the heading `## From earlier runs`. The file is read into that member's instructions in the next run. Text above the heading is yours and is kept. Scripted runs write to the run folder, so made-up claims never reach `board/expertise/`.

All Jev wording lives in `engine/src/questions.ts`. All decision logic lives in `engine/src/jev.ts`.

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
engine/src/            board.ts (Pi Durable), jev.ts + questions.ts, exa.ts, checkers.ts, claims.ts,
                       models.ts (OpenRouter / scripted), mock.ts, app.ts (HTTP + SSE handler), server.ts (listens),
                       http.ts, runlock.ts, cli.ts
engine/src/glhf/       not part of the board: the GLHF run tracker
dashboard/             the web UI (Tauri + React); the board is dashboard/src/views/BoardView.tsx
```

## Next steps

- [ ] Add keys; run the example brief live; tune Jev questions on real Exa results.
- [ ] Watch mode: scheduled Exa searches reopen a run when new evidence changes a verdict. The `watch:` keys exist in the config, but no code uses them yet.
- [x] Members' checked claims are written to their `expertise/` files after each run (see Memory).
- [ ] Run the phases in order in code instead of all at once, and call only the members with a task.
- [ ] One Experimenter conversation per claim, run in parallel, with each claim's budget share enforced in code.
- [ ] A data workspace, so the Scout and the Finisher can check real files in code. A code tool for the Experimenter (all three modes), in a sandbox, with `refusePaid()` and replay keys. Today no member can run code, and the Claude Code checker does not run code by default.
- [ ] Brief sections for research tasks. `brief.required_sections` in `board/config.yaml` still asks for drug sections (Candidates, Target and Indication).
- [ ] Evals in the acyclic style: plant a wrong claim, fork the session at the same entry, and measure how often the board adopts it.
- [ ] Hosting: Modal for long runs and scheduled watch mode. Planned only; no code uses Modal.
- [ ] Add OpenRouter, Exa and TypeSafe keys to the dashboard Settings (keychain) instead of `.env`.

Decision support only. This doesn't replace expert review or regulatory judgment.
