// An optional copy of the app's records in a Supabase (hosted Postgres) database. Off unless SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are both set. When off, nothing here runs and the app works on its local files only.
//
// The local files stay the source of truth. When on, every save of a record is also sent to the database
// ("write-through"), in the background:
//   research_answers   one row per research answer (board/runs/.research/<id>/record.json); threads are a view on it
//   board_runs         one row per board run (board/runs/<run>/run.json, and the memo once it is written)
//   exa_ledger         one row per line of the Exa spend record (board/runs/.exa-ledger.jsonl)
// The schema is supabase/migrations/. A database write never throws into the caller, never makes it wait, and is
// given up after a time limit; a failure is logged as one line. Only the newest version of a row waits to be sent:
// when an answer is saved ten times while one write is on its way, the next write sends the tenth version only.
//
// The key is the service role key: it is used here, in the engine, only, and never sent to the dashboard or logged.
// The calls are plain HTTPS requests to Supabase's REST API (PostgREST), so no package is needed.
import { readFileSync } from "node:fs"
import { basename } from "node:path"
import type { RunState } from "../board/board.ts"
import type { ExaEntry } from "../paid/exaledger.ts"
import type { ResearchRecord } from "../research/types.ts"

export type Table = "research_answers" | "board_runs" | "exa_ledger"
export type Row = Record<string, unknown>

/** The columns that name a row of each table: an upsert on them replaces the row. */
export const CONFLICT: Record<Table, string> = { research_answers: "id", board_runs: "run_id", exa_ledger: "run_id,call_id,kind,at" }

/** What the engine needs from a database. The REST client below, or a fake in tests. */
export interface DbClient { upsert(table: Table, rows: Row[]): Promise<void> }

export const DEFAULT_TIMEOUT_MS = 5000

/** The database settings, or undefined when either variable is missing (then the database is off). */
export function supabaseSettings(env: NodeJS.ProcessEnv = process.env): { url: string; key: string; timeoutMs: number } | undefined {
  const url = env.SUPABASE_URL?.trim(), key = env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) return undefined
  const timeout = Number(env.SUPABASE_TIMEOUT_MS)
  return { url: url.replace(/\/+$/, ""), key, timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS }
}

/** A client for Supabase's REST API: one POST per upsert, merged on the table's key columns. */
export function restClient(settings: { url: string; key: string; timeoutMs: number }, fetchImpl: typeof fetch = fetch): DbClient {
  return {
    async upsert(table, rows) {
      const res = await fetchImpl(`${settings.url}/rest/v1/${table}?on_conflict=${CONFLICT[table]}`, {
        method: "POST",
        headers: { apikey: settings.key, authorization: `Bearer ${settings.key}`, "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows),
        signal: AbortSignal.timeout(settings.timeoutMs),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200)}`)
    },
  }
}

// The client in use. `undefined`: not decided yet (decided from the environment at the first save).
// Under `node --test` the environment never turns it on: a test sets a fake with setDbClient, so no test reaches a
// database even when a developer's .env has the keys.
let client: DbClient | null | undefined
let timeoutMs = DEFAULT_TIMEOUT_MS

/** Use this client (a fake in tests), or none (null). `undefined` goes back to the environment's choice. */
export function setDbClient(next: DbClient | null | undefined, limitMs = DEFAULT_TIMEOUT_MS): void { client = next; timeoutMs = limitMs }

/** The client in use, or null when the database is off. */
export function dbClient(env: NodeJS.ProcessEnv = process.env): DbClient | null {
  if (client !== undefined) return client
  const settings = env.NODE_TEST_CONTEXT ? undefined : supabaseSettings(env)
  client = settings ? restClient(settings) : null
  if (settings) timeoutMs = settings.timeoutMs
  return client
}

export const dbEnabled = (): boolean => dbClient() !== null

const warn = (what: string, error: unknown) => console.warn(`[supabase] ${what} not saved to the database: ${error instanceof Error ? error.message : String(error)}`)

/** Waits at most `ms`, then rejects. The timer does not keep the process alive. */
function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms); timer.unref?.() })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

// One slot per row being written: the write on its way, and the newest version waiting behind it.
const slots = new Map<string, { next?: Row[] }>()
const pending = new Set<Promise<void>>()

/**
 * Send rows to the database in the background, if it is on. `build` makes the rows; it runs only when the database
 * is on, and an error in it is logged like a failed write. `slot` names the row (table and key) so that versions of
 * one row are sent in order, newest last. Returns at once.
 */
export function mirror(table: Table, slot: string, build: () => Row[] | Row | undefined): void {
  const db = dbClient()
  if (!db) return
  let rows: Row[]
  try { const made = build(); if (!made) return; rows = Array.isArray(made) ? made : [made] } catch (error) { warn(`${table} ${slot}`, error); return }
  const key = `${table}:${slot}`
  const waiting = slots.get(key)
  if (waiting) { waiting.next = rows; return }
  const state: { next?: Row[] } = {}
  slots.set(key, state)
  const send = async (batch: Row[]): Promise<void> => {
    try { await within(Promise.resolve().then(() => db.upsert(table, batch)), timeoutMs) } catch (error) { warn(`${table} ${slot}`, error) }
    const next = state.next
    if (next) { state.next = undefined; return send(next) }
    slots.delete(key)
  }
  const work = send(rows).finally(() => pending.delete(work))
  pending.add(work)
}

/** Wait until every background write has ended (sent, failed or timed out). For tests and the backfill. */
export async function flushDb(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending])
}

// ── Rows ─────────────────────────────────────────────────────────────────────────────────────────

const time = (ms: unknown): string | null => (typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : null)
const num = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) ? n : null)

/** A research answer as a row: the columns to search and sort on, and the whole record (sources with their images, steps, review). */
export function answerRow(record: ResearchRecord, now = Date.now()): Row {
  return {
    id: record.id, thread: record.thread, question: record.question, effort: record.effort, mode: record.mode, status: record.status,
    started_at: time(record.startedAt), work_started_at: time(record.workStartedAt), finished_at: time(record.finishedAt),
    worked_ms: num(record.workedMs), seconds: num(record.seconds), usd: num(record.usd) ?? 0,
    answer_markdown: record.answer?.markdown ?? record.draft ?? null, sources: record.sources ?? [], error: record.error ?? null,
    record, updated_at: time(now),
  }
}

/** A board run as a row. `memo` (text and decision) is added once the memo is written; without it those columns are left as they are. */
export function runRow(state: RunState, memo?: { memo: string | null; decision: string | null }, now = Date.now()): Row {
  return {
    run_id: state.runId, brief_file: state.briefFile, brief_id: basename(state.briefFile).replace(/\.md$/, ""),
    status: state.finished ? "finished" : state.failed ? "failed" : "running", mock: state.mock === true,
    started_at: time(state.startedAt), roster: Object.keys(state.members ?? {}), rounds: state.rounds ?? 0,
    usd: num(state.usd) ?? 0, checker_usd: num(state.checkerUsd) ?? 0, first_pass_usd: num(state.firstPassUsd) ?? 0, cost_estimated: state.costEstimated === true,
    ledger: state.ledger ?? [], state, updated_at: time(now),
    ...(memo ? { memo: memo.memo, decision: memo.decision } : {}),
  }
}

/** One line of the Exa spend record as a row. */
export const exaRow = (entry: ExaEntry): Row => ({ run_id: entry.runId, call_id: entry.callId, kind: entry.kind, at: time(entry.at), usd: entry.usd, basis: entry.basis })

// ── The calls the stores make ────────────────────────────────────────────────────────────────────

export const mirrorAnswer = (record: ResearchRecord): void => mirror("research_answers", record.id, () => answerRow(structuredClone(record)))
export const mirrorRun = (state: RunState): void => mirror("board_runs", state.runId, () => runRow(structuredClone(state)))
/** The memo of a run, read from the file just written, with the decision the lead gave. A slot of its own, so a later save of the state does not replace it. */
export const mirrorMemo = (state: RunState, file: string, decision: string): void =>
  mirror("board_runs", `${state.runId}:memo`, () => ({ run_id: state.runId, memo: readFileSync(file, "utf8"), decision, updated_at: time(Date.now()) }))
export const mirrorExa = (entry: ExaEntry): void => mirror("exa_ledger", `${entry.runId}:${entry.callId}:${entry.kind}:${entry.at}`, () => exaRow(entry))
