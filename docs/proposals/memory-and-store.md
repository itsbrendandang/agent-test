# Proposal: memory (past.dev) for every agent, and one store for what agents find

Status: a plan. Nothing in it is built. Written 15 November after the owner said: past.dev
should be used, and asked whether to build a database.

## Where we are

- **past.dev** is wired into the nine-role swarm only
  (`glhf/bixbench/src/bixbench3/inspect_harness/swarm/past_memory.py`). At the start of a run
  with `--memory` it recalls lessons; it sends a lesson only after a person approves it. It is
  behind the paid switch (`PAST_API_KEY` is blanked while paid calls are off). It has not been
  used inside a full real run.
- **The engine** (chat, direct answers, team reviews) does not use past.dev at all.
- **What agents find** is kept per run, in a folder of files (`board/runs/<id>/`,
  `board/runs/.research/<id>/`, `glhf/runs/<id>/`). There is no database. Search over saved
  research reads those folders each time (`engine/src/search.ts`).

## Part 1: past.dev in the engine

What it would do: before a direct answer or a team review starts, recall what earlier work
found that is relevant, and show it to the planner and the writer as context. After a run, offer
what was learned for saving.

Rules to keep (the swarm already follows them; the engine must too):

1. **Recalled text is context, not evidence.** A statement is still marked supported only when
   the checker finds its passage in a source of this run. A memory can suggest where to look. It
   cannot support a claim.
2. **A person approves what is saved.** Nothing is sent to past.dev by a run on its own.
3. **Only checked material is offered for saving:** statements marked supported, with their
   source link, and process notes. Never a contradicted or unchecked statement as a fact.
4. **Benchmark work stays out.** No benchmark task text, answer or score goes to past.dev, and
   benchmark agents never read it (AGENTS.md).
5. **Behind the paid switch**, with every call counted and capped per run, and a failure never
   fails a run.
6. **Untrusted text.** Recalled text goes to models inside the same escaped block as sources.

Work: one module `engine/src/memory/` (recall, the approval queue, send), calls from the
research pipeline and the team review at their planning step, a "Memory" section in Settings to
approve or reject, tests with a fake past.dev. About one day. What cannot be tested without the
payer: a live call from the engine.

Decisions needed:

- May the **question text** be sent to past.dev as the recall query? Without it recall is weak.
  It is the one piece of user text that would leave the machine to a new third party.
- One shared memory for the three of us, or one per person?

## Part 2: the database

Answer to "do we build one": yes, a small one, and derived from the run folders.

- **What:** one SQLite file, written with Node's built-in `node:sqlite` (no new dependency).
- **Holds:** every source an agent found (link, title, provider, the run that found it), every
  checked statement (text, mark, the quoted passage, the source, the checker), every answer and
  memo (question, date, mode, cost), and every hypothesis with its sources for and against.
- **Derived:** the run folders stay the record. The database is an index built from them and
  can be rebuilt at any time. A crash or a bad write cannot lose research.
- **Practice runs are marked** and left out of anything that reads "what do we know".
- **Gives:** fast search across all runs, "have we seen this source before", "what did we
  conclude about X and was it checked", and the numbers for charts.

Work: schema and builder with tests, incremental update when a run ends, the search route
reading it, a rebuild command. About one day.

How the two fit: the database is the local, complete store. past.dev is the shared memory
across machines, fed only from approved, supported rows of the database.

## Order

1. Database (no outside service, no decision needed beyond this page).
2. past.dev recall and the approval queue in the engine, on top of it.
3. A live check of past.dev by the payer.
