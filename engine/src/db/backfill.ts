// npm run db:backfill: send the records already on disk to the Supabase database, once. Safe to run again: every row
// is an upsert on its key, so a second run replaces the rows with the same content. The local files are only read.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { RunState } from "../board/board.ts"
import { type BoardConfig, path } from "../config.ts"
import { EventLog } from "../events.ts"
import { type ExaEntry, exaLedgerFile } from "../paid/exaledger.ts"
import { listRecords } from "../research/store.ts"
import { holder } from "../runlock.ts"
import { answerRow, CONFLICT, type DbClient, exaRow, type Row, runRow, type Table } from "./supabase.ts"

export const BATCH = 50

/** The board runs on disk (each folder with a run.json), as rows ("running" only while a process holds the run's lock), with the memo and decision when one was written. */
export function runRows(config: BoardConfig): Row[] {
  const root = path(config, "runs")
  if (!existsSync(root)) return []
  return readdirSync(root).sort().flatMap((id) => {
    const dir = path(config, "runs", id)
    let state: RunState
    try { state = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as RunState } catch { return [] }
    if (!state || typeof state.runId !== "string") return []
    const memo = existsSync(join(dir, "memo.md")) ? readFileSync(join(dir, "memo.md"), "utf8") : null
    const written = EventLog.read(join(dir, "events.jsonl")).filter((e) => e.type === "memo.written").at(-1) as { decision?: string } | undefined
    return [runRow(state, holder(join(dir, "run.lock")) !== undefined, { memo, decision: written?.decision ?? null })]
  })
}

/** The lines of the Exa spend record, as rows. A line that cannot be read is skipped; a repeated key is sent once. */
export function exaRows(config: BoardConfig): Row[] {
  const file = exaLedgerFile(config)
  if (!existsSync(file)) return []
  const rows = new Map<string, Row>()
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue
    let e: ExaEntry
    try { e = JSON.parse(line) as ExaEntry } catch { continue }
    if (typeof e?.runId !== "string" || typeof e.callId !== "string" || typeof e.at !== "number" || typeof e.usd !== "number") continue
    rows.set(`${e.runId}\n${e.callId}\n${e.kind}\n${e.at}`, exaRow(e))
  }
  return [...rows.values()]
}

/** Send every local record, in batches. Stops at the first failed batch (the error says which table). */
export async function backfill(config: BoardConfig, db: DbClient, log: (line: string) => void = () => {}): Promise<Record<Table, number>> {
  const tables: [Table, Row[]][] = [
    ["research_answers", listRecords(config).map((r) => answerRow(r))],
    ["board_runs", runRows(config)],
    ["exa_ledger", exaRows(config)],
  ]
  const sent = { research_answers: 0, board_runs: 0, exa_ledger: 0 }
  for (const [table, rows] of tables) {
    for (let i = 0; i < rows.length; i += BATCH) {
      try { await db.upsert(table, rows.slice(i, i + BATCH)) } catch (error) { throw new Error(`${table} (on ${CONFLICT[table]}), rows ${i + 1} to ${Math.min(i + BATCH, rows.length)}: ${error instanceof Error ? error.message : String(error)}`) }
      sent[table] += Math.min(BATCH, rows.length - i)
    }
    log(`${table}: ${sent[table]} row${sent[table] === 1 ? "" : "s"}`)
  }
  return sent
}
