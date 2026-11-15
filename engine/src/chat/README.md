# Home chat (engine side)

A person types a question on the Home view. The engine answers from past runs, or proposes a drug board run
(a Plan) that starts only after a separate, confirmed request.

## Flow

1. `GET /api/chat/catalog`: what a plan can use. Providers and whether each key is set (never a key), agents
   (board members and specialists; a specialist says whether it can take part and which methods it has notes for),
   skills, the Method library in numbers, the three effort levels and the default one.
2. `GET /api/chat/search?q=&kind=&limit=`: keyword search over runs (the Experiments search in `search.ts`),
   agents and skills. No model, whatever the paid switch says.
3. `POST /api/chat {messages, effort?, provider?, model?}`: the reply.
   - Paid calls off, or no key: no network call. A question about past runs gets the keyword answer of
     `ask.ts` (`mode: "keyword"`). Any other question gets a Plan from a template (`mode: "scripted"`): board
     members by word match against each profile, method specialists by word match against their method notes
     (`../specialists.ts`), the brief filled with the question and "not stated" text.
   - Paid calls on, with a key and the session token: one model call (`model.ts`) decides which of the two it
     is and writes the reply and plan suggestions as JSON (`mode: "ai"`). `plan.ts` treats that as data:
     unknown agents, specialists and skills are dropped, text is cut, the brief is re-checked. Limits, `paid`, `search`,
     models and the estimate are computed by the engine and are never read from the model or the client.
   - Nothing starts here. Text in a question or in a run record cannot start a run.
4. `POST /api/chat/plans/:id/start {confirm: true, effort?, agents?, limits?, brief?}`: starts the run with the
   same `start` and `launch` functions `POST /api/runs` uses, after the same checks (trust, paid switch, brief
   check, daily cap). A plan starts once: the claim is a file made with the exclusive flag
   (`board/runs/.plans/<id>.start`), so a second start gets 409 with the first run's id.
5. Progress and results: the board's own routes. `GET /api/runs`, `GET /api/runs/<id>/events` (SSE),
   `GET /api/runs/<id>/memo`, `POST /api/runs/<id>/resume`. Who takes part in a run: the `run.roster` event, or
   `GET /api/chat/roster?run=<id>` (`roster.ts`).

Plans and their briefs are files in `board/runs/.plans/` (gitignored). An unstarted plan expires after 24 hours.

## What is wired, and what is not

| Thing | State |
|---|---|
| Board agents (`board/agents`) | Used. A chat plan is a board run. |
| Specialists (`glhf/specialists`: 9 profiles, 18 method agents) | **Used by the board, as text.** 23 of the 27 can take part (`takesPart` in the catalog; the other four say why not). A plan adds the ones whose trigger or method notes share words with the question, inside the effort level's member limit: a specialist takes a place, it never adds one, and no cap is raised. The lead, the scout and the proposer always stay; the Critic stays at standard and deep; specialists get at most half of the places left. The start writes them to `overrides.json` (`specialists`), and `board.ts` runs each as a member with no tools (`../specialists.ts`). |
| Method notes | A specialist's instructions are a fixed frame (it cannot run code; it says which analysis would settle the question, the pitfalls and what the data can support; it reports no result of its own), its role, and the notes of the matched methods: at most 4 methods, 1,200 characters each, 8,000 characters for its own prompt. 58 skills have notes that can be read. 38 are a name only: never loaded, never listed, never a reason to choose a specialist. Skills 11, 96 and 97 are never loaded. URLs, install and download steps and every line naming where the text came from are removed. The plan lists the notes under `skills` and on each specialist (`methods`). |
| The swarm (`glhf/bixbench`) | **Does not use the specialists or the method notes.** Nothing in this folder changes a swarm run. |
| Per-run agents and limits | **Applied.** The start route writes them to `board/runs/<run>/overrides.json`; `board.ts` (`applyOverrides`) reads it and can only narrow the config, never widen it. |
| Per-run model tier and search cap | **Recorded, not applied.** Each agent runs on the tier in its own file and searches are not counted. Every plan says so in `warnings`. |
| Skills (`.agents/skills`) | Only skills with `installed: true` are chosen as skills of a plan. No board run loads a skill file; `build-with-exa` is named because `exa.ts` follows it. The index of the method library is listed as `method-library` ("Method library"), is not installed and is never chosen as a skill: its methods reach a run through the specialists. |
| Exa | Not used by the chat call. The run's members search through `exa.ts`. |
| Chat model | Anthropic Messages by default, OpenAI chat completions when chosen. Unit-tested with a fake fetch. **Never run against a real API.** |
| Board models | Anthropic and OpenAI directly, as in `board/config.yaml`, whichever provider wrote the plan. |

Members and limits are applied by `applyOverrides` in `board.ts` (tested in `test/board-overrides.test.ts`). The model
tier and the search cap need more: `modelFor` takes the tier from the agent file, and the search tool has no
counter.

Not done for the specialists: no real model has run one (scripted runs only, `test/specialists-run.test.ts`); the
choice is a word match made once, when the plan is drafted (the trigger rules in `glhf/specialists/README.md`, such as
"an attending rejects a hypothesis", are not code); the tools their files name (`search_docs`, `read_ledger`,
`propose_claim`) do not exist on the board, so a specialist has no tools; and nothing is executed, because no member
has a code tool and the skill packages are not installed.

## Three decisions before turning paid calls on

1. **Who holds the token.** With `NO_PAID_CALLS=0` the chat call and a real-model start need the session token
   (`x-glhf-token`). Decide who gets it and how the dashboard asks for it.
2. **The caps.** `meeting.max_usd` and `meeting.daily_usd` in `board/config.yaml` are the real ceilings today:
   a Quick plan shows $1 but the run stops at the config cap until `board.ts` applies overrides. Either apply
   the overrides first or set the config caps to what one run may truly spend. The chat call itself has no
   daily cap, only 20 messages a minute.
3. **Which provider reads the records.** The chat call sends up to 40,000 characters of run records and the
   conversation to the chosen provider. Decide which provider and model that may be (`ASK_MODEL`, the lists in
   `catalog.ts`), and whether run records may leave the machine at all.
