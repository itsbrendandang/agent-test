# Database (Supabase, optional)

The engine keeps its records as files under `board/runs/`. It can also keep a copy in a
[Supabase](https://supabase.com) database (hosted Postgres). The copy is **off** by default.

## What is stored

| Table | One row per | Read from |
|---|---|---|
| `research_answers` | research answer: question, thread, status, times, cost, answer text, sources (with their images), and the whole record | `board/runs/.research/<id>/record.json` |
| `research_threads` (a view) | thread (one conversation of answers): title, status of the latest answer, number of answers, cost | `research_answers` |
| `board_runs` | team review: brief, members, status, rounds, cost, checked claims, memo and decision, and the whole `run.json` | `board/runs/<run>/run.json`, `memo.md` |
| `exa_ledger` | line of the Exa spend record | `board/runs/.exa-ledger.jsonl` |

The schema is in `supabase/migrations/`. Row level security is on, and there is no policy for
the `anon` or `authenticated` roles. Only the service role (the engine) can read or write. The
dashboard never talks to the database, and the key never reaches it.

Not stored: the event logs (`events.jsonl`), the result files of an answer, and the run
tracker's database (`glhf/runs/tracker.sqlite`).

## How it works

- The local files stay the source of truth. The engine reads only the files.
- Each time the engine saves a record, it sends the record to the database in the background.
  The answer or review never waits for the database.
- A write that fails, or takes longer than the time limit (5 seconds), is given up. The engine
  logs one line, `[supabase] ... not saved to the database: <reason>`. The answer or review goes
  on as normal.
- When the engine saves one record many times while a write is on its way, only the newest
  version is sent next.
- Code: `engine/src/db/supabase.ts`. It calls Supabase's REST API with `fetch`; there is no extra
  package. Tests: `engine/test/db-supabase.test.ts` (fake database only, no network).

## Turn it on

1. Create a Supabase project.
2. Run the SQL in `supabase/migrations/` (the Supabase SQL editor, or `supabase db push` with
   the Supabase CLI).
3. In `.env`, set the two variables (Project Settings → API in Supabase):

   ```
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service role key>
   ```

   The service role key passes row level security. Keep it in `.env` only. Never commit it.
4. Restart the engine.
5. To copy the records you already have, run once:

   ```
   npm run db:backfill
   ```

   It reads the runs folder (`paths.runs` in `board/config.yaml`, or `DRUG_BOARD_RUNS_DIR`) and
   sends every answer, review and Exa line. It is safe to run again: each row replaces the row
   with the same key.

Optional: `SUPABASE_TIMEOUT_MS` changes the time limit of one write (default `5000`).

To turn it off, remove the two variables and restart the engine. Nothing else changes.
