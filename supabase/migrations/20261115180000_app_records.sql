-- The app's records in Supabase (hosted Postgres). The engine writes them (engine/src/db/supabase.ts) when
-- SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set; the local files under board/runs/ stay the source of truth.
-- Row level security is on and there is no policy for anon or authenticated: only the service role (the engine)
-- can read or write. The dashboard never talks to the database.

-- One row per research answer (board/runs/.research/<id>/record.json).
create table if not exists public.research_answers (
  id               text primary key,
  thread           text not null,
  question         text not null,
  effort           text,
  mode             text not null check (mode in ('real', 'demo')),
  status           text not null,
  started_at       timestamptz,
  work_started_at  timestamptz,
  finished_at      timestamptz,
  worked_ms        double precision,
  seconds          double precision,
  usd              numeric(12, 6) not null default 0,
  answer_markdown  text,
  sources          jsonb not null default '[]'::jsonb, -- the numbered sources, with their text and images
  error            text,
  record           jsonb not null,                     -- the whole record.json
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists research_answers_thread_idx on public.research_answers (thread, started_at);
create index if not exists research_answers_started_idx on public.research_answers (started_at desc);
create index if not exists research_answers_status_idx on public.research_answers (status);

-- One row per thread (a conversation of answers): the first question as its title, the latest answer's status.
create or replace view public.research_threads with (security_invoker = on) as
select
  thread,
  (array_agg(left(regexp_replace(question, '\s+', ' ', 'g'), 120) order by started_at, id))[1] as title,
  (array_agg(status order by started_at desc, id desc))[1] as status,
  count(*)::int as answers,
  sum(usd) as usd,
  min(started_at) as started_at,
  max(coalesce(finished_at, work_started_at, started_at)) as updated_at
from public.research_answers
group by thread;

-- One row per board run (board/runs/<run>/run.json, and memo.md once the lead writes it).
create table if not exists public.board_runs (
  run_id          text primary key,
  brief_file      text,
  brief_id        text,
  status          text check (status in ('running', 'finished', 'failed')),
  mock            boolean,
  started_at      timestamptz,
  roster          jsonb not null default '[]'::jsonb, -- member names
  rounds          integer,
  usd             numeric(12, 6),
  checker_usd     numeric(12, 6),
  first_pass_usd  numeric(12, 6),
  cost_estimated  boolean,
  ledger          jsonb not null default '[]'::jsonb, -- the checked claims and their verdicts
  memo            text,
  decision        text,
  state           jsonb,                              -- the whole run.json
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists board_runs_started_idx on public.board_runs (started_at desc);
create index if not exists board_runs_status_idx on public.board_runs (status);

-- One row per line of the Exa spend record (board/runs/.exa-ledger.jsonl): a reservation before a search, or the
-- adjustment after it. Appended, never changed. The total spend is sum(usd).
create table if not exists public.exa_ledger (
  run_id      text not null,
  call_id     text not null,
  kind        text not null check (kind in ('reserve', 'adjust')),
  at          timestamptz not null,
  usd         numeric(12, 6) not null,
  basis       text not null check (basis in ('assumed', 'reported', 'refund')),
  created_at  timestamptz not null default now(),
  primary key (run_id, call_id, kind, at)
);
create index if not exists exa_ledger_at_idx on public.exa_ledger (at);

alter table public.research_answers enable row level security;
alter table public.board_runs enable row level security;
alter table public.exa_ledger enable row level security;
revoke all on public.research_answers, public.board_runs, public.exa_ledger, public.research_threads from anon, authenticated;
