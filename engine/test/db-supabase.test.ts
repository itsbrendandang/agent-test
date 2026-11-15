// The optional Supabase copy (src/db/supabase.ts): off without its two variables, a row per save when on, and an
// answer that never waits for or fails because of the database. Fake clients and a fake fetch only: no network,
// no paid call. NO_PAID_CALLS stays 1; answers run in demo mode and the board run is scripted.
import assert from "node:assert/strict"
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, test } from "node:test"

process.env.NO_PAID_CALLS = "1"
process.env.DRUG_BOARD_MOCK = "1"
const outbound: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.startsWith("http://127.0.0.1:")) return realFetch(input, init) // the test's own engine
  outbound.push(url)
  throw new Error("a test tried to reach the network")
}) as typeof fetch

const db = await import("../src/db/supabase.ts")
const { backfill } = await import("../src/db/backfill.ts")
const { engine } = await import("./fixtures/research/harness.ts")
const { reserveSearch, settleSearch } = await import("../src/paid/exaledger.ts")
const { loadConfig } = await import("../src/config.ts")
const { acquireRunLock, runBoard, runDir, startRun } = await import("../src/board/board.ts")
import type { DbClient, Row, Table } from "../src/db/supabase.ts"

/** A database in memory: upserts merge on the table's key columns, as PostgREST's merge-duplicates does. */
function fakeDb() {
  const tables: Record<Table, Map<string, Row>> = { research_answers: new Map(), board_runs: new Map(), exa_ledger: new Map() }
  const calls: { table: Table; rows: Row[] }[] = []
  const client: DbClient = {
    async upsert(table, rows) {
      calls.push({ table, rows: structuredClone(rows) })
      for (const row of rows) {
        const key = db.CONFLICT[table].split(",").map((c) => String(row[c])).join("|")
        tables[table].set(key, { ...tables[table].get(key), ...structuredClone(row) })
      }
    },
  }
  return { client, tables, calls }
}

const tempConfig = () => { const base = loadConfig(); return { ...base, paths: { ...base.paths, runs: join(mkdtempSync(join(tmpdir(), "db-test-")), "runs") } } }

afterEach(async () => { await db.flushDb(); db.setDbClient(undefined) })

test("off unless both variables are set; under node --test the environment alone never turns it on", () => {
  assert.equal(db.supabaseSettings({}), undefined)
  assert.equal(db.supabaseSettings({ SUPABASE_URL: "https://x.supabase.co" }), undefined)
  assert.equal(db.supabaseSettings({ SUPABASE_SERVICE_ROLE_KEY: "k" }), undefined)
  assert.deepEqual(db.supabaseSettings({ SUPABASE_URL: "https://x.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: "k" }), { url: "https://x.supabase.co", key: "k" })
  db.setDbClient(undefined)
  assert.equal(db.dbClient({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k", NODE_TEST_CONTEXT: "child" }), null)
})

test("unset keys: an answer and an Exa line make no database call and reach no network", async () => {
  db.setDbClient(undefined)
  const e = await engine({ demo: true })
  try {
    const { record } = await e.answer({ question: "Does metformin lower cancer risk in people with type 2 diabetes?" })
    assert.equal(record.status, "done")
  } finally { await e.close() }
  const config = tempConfig()
  settleSearch(config, "r1", "c1", reserveSearch(config, "r1", "c1", 1000).ok ? 0.007 : 0, { failed: true })
  await db.flushDb()
  assert.equal(db.dbEnabled(), false)
  assert.deepEqual(outbound, [])
})

test("the REST client: one POST to the table, merged on its key, the key only in the headers", async () => {
  const seen: { url: string; init: RequestInit }[] = []
  const fake = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response(null, { status: 201 }) }) as unknown as typeof fetch
  const client = db.restClient({ url: "https://x.supabase.co", key: "service-key" }, fake)
  await client.upsert("exa_ledger", [{ run_id: "r" }])
  assert.equal(seen[0].url, "https://x.supabase.co/rest/v1/exa_ledger?on_conflict=run_id,call_id,kind,at")
  const headers = seen[0].init.headers as Record<string, string>
  assert.deepEqual([seen[0].init.method, headers.apikey, headers.authorization, headers.prefer], ["POST", "service-key", "Bearer service-key", "resolution=merge-duplicates,return=minimal"])
  assert.equal(seen[0].init.body, JSON.stringify([{ run_id: "r" }]))
  const refused = db.restClient({ url: "https://x.supabase.co", key: "service-key" }, (async () => new Response("permission denied", { status: 401 })) as unknown as typeof fetch)
  await assert.rejects(refused.upsert("board_runs", []), /HTTP 401 permission denied/)
})

test("keys set: the answer's row ends as the finished record; an Exa reservation and its refund are two rows", async () => {
  const fake = fakeDb()
  db.setDbClient(fake.client)
  const e = await engine({ demo: true })
  let id = ""
  try {
    const done = await e.answer({ question: "Does metformin lower cancer risk in people with type 2 diabetes?" })
    id = done.id
    await db.flushDb()
    const row = fake.tables.research_answers.get(id)
    assert.ok(row, "the answer has a row")
    assert.deepEqual([row.status, row.mode, row.thread, row.question], ["done", "demo", done.thread, done.record.question])
    assert.equal(row.answer_markdown, done.record.answer?.markdown)
    assert.equal((row.sources as unknown[]).length, done.record.sources.length)
    assert.equal((row.record as { id: string }).id, id)
    assert.equal(typeof row.started_at, "string")
    assert.equal(typeof row.finished_at, "string")
    assert.ok(fake.calls.filter((c) => c.table === "research_answers").length >= 1)
  } finally { await e.close() }
  const config = tempConfig()
  const reserved = reserveSearch(config, "r1", "c1", 1000)
  assert.ok(reserved.ok)
  settleSearch(config, "r1", "c1", reserved.reserved, { failed: true }, 2000)
  await db.flushDb()
  assert.deepEqual([...fake.tables.exa_ledger.values()].map((r) => [r.kind, r.basis, r.usd]), [["reserve", "assumed", 0.007], ["adjust", "refund", -0.007]])
  assert.deepEqual(outbound, [])
})

test("a failing database and a database that never answers: the answer still finishes, on time, and is on disk", async () => {
  const warned: string[] = []
  const warn = console.warn
  console.warn = (line: string) => { warned.push(String(line)) }
  try {
    db.setDbClient({ upsert: async () => { throw new Error("connection refused") } })
    const e1 = await engine({ demo: true })
    try { assert.equal((await e1.answer({ question: "Does metformin lower cancer risk in people with type 2 diabetes?" })).record.status, "done") } finally { await e1.close() }
    await db.flushDb()
    assert.ok(warned.some((l) => /research_answers .* not saved to the database: connection refused/.test(l)))
    db.setDbClient({ upsert: () => { throw new Error("thrown at once") } })
    const e2 = await engine({ demo: true })
    try { assert.equal((await e2.answer({ question: "Does metformin lower cancer risk in people with type 2 diabetes?" })).record.status, "done") } finally { await e2.close() }
    db.setDbClient({ upsert: () => new Promise<void>(() => {}) }, 50) // hangs for ever
    const e3 = await engine({ demo: true })
    try {
      const started = Date.now()
      const { record } = await e3.answer({ question: "Does metformin lower cancer risk in people with type 2 diabetes?" })
      assert.equal(record.status, "done")
      assert.ok(Date.now() - started < 5000)
    } finally { await e3.close() }
    await db.flushDb() // each write gave up after 50 ms
    assert.ok(warned.some((l) => /no answer within 50 ms/.test(l)))
    assert.ok(warned.every((l) => !l.includes("service-key")))
  } finally { console.warn = warn }
})

test("many saves of one row while a write is on its way: sent in order, and only the newest waits", async () => {
  const sent: number[] = []
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  db.setDbClient({ async upsert(_t, rows) { if (!sent.length) await gate; sent.push(rows[0].n as number) } })
  for (let n = 1; n <= 5; n++) db.mirror("board_runs", "same", () => ({ run_id: "same", n }))
  release()
  await db.flushDb()
  assert.deepEqual(sent, [1, 5])
})

test("a scripted board run: one row with roster, status, spend and the memo with its decision", async () => {
  const fake = fakeDb()
  db.setDbClient(fake.client)
  const base = tempConfig()
  const config = { ...base, board: base.board.slice(0, 3), meeting: { ...base.meeting, max_minutes: 5 } }
  const id = await startRun(join(import.meta.dirname, "../../board/briefs/kras-g12c-hit-to-lead.md"), { config, mock: true })
  await runBoard(id, undefined, { config, mock: true })
  await db.flushDb()
  const row = fake.tables.board_runs.get(id)
  assert.ok(row)
  assert.deepEqual([row.status, row.mock, row.brief_id, row.usd], ["finished", true, "kras-g12c-hit-to-lead", 0])
  assert.ok((row.roster as string[]).length > 0)
  assert.match(String(row.memo), /## /)
  assert.equal(typeof row.decision, "string")
  assert.ok((row.ledger as unknown[]).length > 0)
  assert.deepEqual(outbound, [])
})

test("a board run that stops before its end is mirrored as paused, not left running", async () => {
  const fake = fakeDb()
  db.setDbClient(fake.client)
  const base = tempConfig()
  const config = { ...base, board: base.board.slice(0, 3), meeting: { ...base.meeting, max_minutes: 5, lead_turns: 1 } }
  const id = await startRun(join(import.meta.dirname, "../../board/briefs/kras-g12c-hit-to-lead.md"), { config, mock: true })
  await assert.rejects(runBoard(id, undefined, { config, mock: true }))
  await db.flushDb()
  const statuses = fake.calls.filter((c) => c.table === "board_runs" && c.rows[0].run_id === id && "status" in c.rows[0]).map((c) => c.rows[0].status)
  assert.ok(statuses.includes("running"), "running while the lead works")
  assert.equal(fake.tables.board_runs.get(id)?.status, "paused")
  assert.deepEqual(outbound, [])
})

test("a resumed run that stops before its first round is mirrored as paused, not left running", async () => {
  const fake = fakeDb()
  db.setDbClient(fake.client)
  const base = tempConfig()
  const config = { ...base, board: base.board.slice(0, 3) }
  const brief = join(mkdtempSync(join(tmpdir(), "db-brief-")), "brief.md")
  copyFileSync(join(import.meta.dirname, "../../board/briefs/kras-g12c-hit-to-lead.md"), brief)
  const id = await startRun(brief, { config, mock: true })
  const file = join(runDir(config, id), "run.json")
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), failed: "an earlier stop" }))
  rmSync(brief)
  await assert.rejects(runBoard(id, undefined, { config, mock: true }))
  await db.flushDb()
  assert.equal(fake.tables.board_runs.get(id)?.status, "paused")
})

test("backfill: every local answer, run and Exa line, in batches, and running it twice changes nothing", async () => {
  db.setDbClient(null) // made with the database off
  const e = await engine({ demo: true })
  let id = ""
  try { id = (await e.answer({ question: "Does metformin lower cancer risk in people with type 2 diabetes?" })).id } finally { await e.close() }
  const config = { ...loadConfig(), paths: { ...loadConfig().paths, runs: e.runs } }
  reserveSearch(config, "r1", "c1", 1000)
  writeFileSync(join(e.runs, ".exa-ledger.jsonl"), "not json\n", { flag: "a" })
  const brief = join(import.meta.dirname, "../../board/briefs/kras-g12c-hit-to-lead.md")
  const runId = await startRun(brief, { config, mock: true })
  const fake = fakeDb()
  const lines: string[] = []
  assert.deepEqual(await backfill(config, fake.client, (l) => lines.push(l)), { research_answers: 1, board_runs: 1, exa_ledger: 1 })
  assert.equal(fake.tables.research_answers.get(id)?.status, "done")
  assert.deepEqual([fake.tables.board_runs.get(runId)?.status, fake.tables.board_runs.get(runId)?.memo], ["paused", null], "a run nobody works on is not running")
  assert.deepEqual(lines, ["research_answers: 1 row", "board_runs: 1 row", "exa_ledger: 1 row"])
  const release = acquireRunLock(runDir(config, runId))
  try { await backfill(config, fake.client) } finally { release() }
  assert.equal(fake.tables.board_runs.get(runId)?.status, "running", "running while a process holds the run's lock")
  const before = JSON.stringify([...fake.tables.exa_ledger.values()])
  await backfill(config, fake.client)
  assert.equal(JSON.stringify([...fake.tables.exa_ledger.values()]), before)
  await assert.rejects(backfill(config, { upsert: async () => { throw new Error("HTTP 401") } }), /research_answers .* rows 1 to 1: HTTP 401/)
  assert.deepEqual(outbound, [])
})
