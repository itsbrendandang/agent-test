// The runtime paid switch (src/paidswitch.ts, src/paid.ts). Nothing here can spend: fetch is a spy that fails, the
// providers are fakes, and the keys are fake. Under `node --test` the switch is LOCKED (paid.ts paidSwitchLocked), so
// each test that needs it open sets PAID_SWITCH_LOCKED=0 for its own length and restores it.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, afterEach, test } from "node:test"
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai"

process.env.NO_PAID_CALLS = "1"
delete process.env.DRUG_BOARD_MOCK // CI sets it; this file tests the switch between scripted and real, with fakes
for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "EXA_API_KEY", "OPENROUTER_API_KEY"]) process.env[key] = "fake-key-for-tests"
const outbound: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.startsWith("http://127.0.0.1:")) return realFetch(input, init)
  outbound.push(url)
  throw new Error(`a test tried to reach ${url}`)
}) as typeof fetch

const paid = await import("../src/paid/paid.ts")
const { createApp } = await import("../src/app.ts")
const cfg = await import("../src/config.ts")
const { loadConfig } = cfg
const { handlePaid, CONFIRM, AUDIT_FILE, resetRateLimit, RATE_PER_MINUTE } = await import("../src/paid/paidswitch.ts")
const { checkClaims, searchOnce, startRun, runBoard, loadState } = await import("../src/board/board.ts")
const { gateProvider } = await import("../src/models.ts")
const { FirstPass } = await import("../src/board/triage.ts")
const { modelsFor } = await import("../src/glhf/types.ts")
const { buildCatalog } = await import("../src/chat/catalog.ts")
const { exaLedgerFile } = await import("../src/paid/exaledger.ts")
const { EventLog } = await import("../src/events.ts")
import type { BoardConfig } from "../src/config.ts"

const TOKEN = "test-token-not-real"
const ORIGIN = "http://127.0.0.1:5317"
const servers: Server[] = []
const savedLock = process.env.PAID_SWITCH_LOCKED
const unlock = () => { process.env.PAID_SWITCH_LOCKED = "0" }
const tempConfig = (): BoardConfig => {
  const base = loadConfig(), dir = mkdtempSync(join(tmpdir(), "paidswitch-"))
  return { ...base, paths: { ...base.paths, runs: join(dir, "runs"), expertise: join(dir, "expertise") } }
}
after(() => { for (const s of servers) { s.closeAllConnections(); s.close() } })
afterEach(() => {
  paid.setPaidOverride(undefined)
  if (savedLock === undefined) delete process.env.PAID_SWITCH_LOCKED; else process.env.PAID_SWITCH_LOCKED = savedLock
  process.env.NO_PAID_CALLS = "1"
  for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) process.env[key] = "fake-key-for-tests"
  resetRateLimit()
})

/** A server whose only route is the paid switch, with the dependencies a test wants to control. */
async function world(over: Record<string, unknown> = {}) {
  const config = (over.config as BoardConfig) ?? tempConfig()
  const stopped: string[] = []
  const deps = { config, env: process.env, hasToken: (req: { headers: Record<string, unknown> }) => req.headers["x-glhf-token"] === TOKEN, tokenFile: "/x/.token", stopPaidRuns: async () => { stopped.push("called"); return ["run-1"] }, ...over }
  const server = createServer((req, res) => void handlePaid(req, res, deps as never))
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
  servers.push(server)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = async (method: string, body?: unknown, headers: Record<string, string> = { "x-glhf-token": TOKEN, "content-type": "application/json", origin: ORIGIN }) => {
    const res = await fetch(`${base}/api/paid`, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) })
    return { status: res.status, body: (await res.json()) as any }
  }
  return { config, call, stopped }
}
const audit = (config: BoardConfig) => { const f = join(config.paths.runs, AUDIT_FILE); return existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [] }
const ON = { on: true, confirm: CONFIRM }

test("GET /api/paid: the live state, where it comes from, the lock, the missing keys, the caps", async () => {
  const w = await world()
  const { status, body } = await w.call("GET", undefined, {})
  assert.equal(status, 200)
  assert.deepEqual(Object.keys(body).sort(), ["board", "caps", "locked", "missing", "missingKeys", "paid", "source"])
  assert.deepEqual([body.paid, body.source, body.locked, body.board], [false, "env", true, "scripted"], "under node --test the switch is locked")
  assert.deepEqual(body.missingKeys, [])
  assert.deepEqual(Object.keys(body.caps).sort(), ["dailyUsd", "exaCeilingUsd", "exaUsedUsd", "maxUsd", "spentTodayUsd"])
  assert.equal(body.caps.exaCeilingUsd, 40)
  delete process.env.OPENAI_API_KEY
  const missing = (await w.call("GET", undefined, {})).body
  assert.ok(missing.missingKeys.includes("OPENAI_API_KEY") && missing.missing.some((m: any) => m.tier === "rival"))
})

test("POST needs the session token, either direction: an Origin alone changes nothing", async () => {
  unlock()
  const w = await world()
  for (const body of [ON, { on: false }]) {
    const r = await w.call("POST", body, { "content-type": "application/json", origin: ORIGIN })
    assert.equal(r.status, 401); assert.equal(r.body.needsToken, true); assert.equal(r.body.field, "token")
    const bare = await w.call("POST", body, { "content-type": "application/json" })
    assert.equal(bare.status, 403)
    const wrong = await w.call("POST", body, { "content-type": "application/json", origin: ORIGIN, "x-glhf-token": "not-the-token" })
    assert.equal(wrong.status, 401)
  }
  assert.equal(paid.paidCallsOff(), true)
  assert.deepEqual(audit(w.config), [], "a request that failed the token check leaves no audit line")
})

test("POST needs a JSON body", async () => {
  unlock()
  const w = await world()
  assert.equal((await w.call("POST", "on=true", { "x-glhf-token": TOKEN, "content-type": "text/plain", origin: ORIGIN })).status, 415)
  assert.equal((await w.call("POST", "{not json", { "x-glhf-token": TOKEN, "content-type": "application/json" })).status, 400)
  assert.equal((await w.call("POST", { on: "yes" })).body.field, "on")
  assert.equal((await w.call("POST", {})).status, 400)
  assert.equal(paid.paidCallsOff(), true)
})

test("turning ON needs the exact confirmation text; turning OFF needs the token only", async () => {
  unlock()
  const w = await world()
  for (const confirm of [undefined, "", "i will be charged", "I will be charged.", " I will be charged", true, 1]) {
    const r = await w.call("POST", { on: true, ...(confirm === undefined ? {} : { confirm }) })
    assert.equal(r.status, 400, String(confirm)); assert.equal(r.body.field, "confirm")
    assert.equal(paid.paidCallsOff(), true)
  }
  assert.equal((await w.call("POST", ON)).status, 200)
  assert.equal(paid.paidCallsOff(), false)
  const off = await w.call("POST", { on: false })
  assert.equal(off.status, 200, "no confirmation to turn off")
  assert.equal(paid.paidCallsOff(), true)
  assert.deepEqual(audit(w.config).map((l) => [l.result, l.reason ?? l.on]), [["refused", "confirm"], ["refused", "confirm"], ["refused", "confirm"], ["refused", "confirm"], ["refused", "confirm"], ["refused", "confirm"], ["refused", "confirm"], ["changed", true], ["changed", false]])
})

test("the lock: PAID_SWITCH_LOCKED=1 refuses every change, ON and OFF, and GET says so", async () => {
  const w = await world()
  process.env.PAID_SWITCH_LOCKED = "1"
  for (const body of [ON, { on: false }]) {
    const r = await w.call("POST", body)
    assert.equal(r.status, 403); assert.equal(r.body.locked, true); assert.equal(r.body.field, "locked")
  }
  assert.equal(paid.paidCallsOff(), true)
  assert.equal((await w.call("GET", undefined, {})).body.locked, true)
  // Under node --test it is locked even with the variable unset; only an explicit 0 opens it.
  delete process.env.PAID_SWITCH_LOCKED
  assert.equal(paid.paidSwitchLocked(), true)
  assert.equal(paid.paidSwitchLocked({}), false, "a process that is not a test, with nothing set, is not locked")
  assert.equal(paid.paidSwitchLocked({ PAID_SWITCH_LOCKED: "1" }), true)
  assert.equal(paid.paidSwitchLocked({ NODE_TEST_CONTEXT: "child" }), true)
  assert.equal(paid.paidSwitchLocked({ NODE_TEST_CONTEXT: "child", PAID_SWITCH_LOCKED: "0" }), false)
})

test("turning ON with a key the board needs missing is refused with 409 naming it, and the state stays off", async () => {
  unlock()
  const w = await world()
  delete process.env.ANTHROPIC_API_KEY
  const r = await w.call("POST", ON)
  assert.equal(r.status, 409); assert.equal(r.body.field, "keys")
  assert.deepEqual(r.body.missingKeys, ["ANTHROPIC_API_KEY"])
  assert.match(r.body.error, /lead \(anthropic\/claude-sonnet-5-5\) needs ANTHROPIC_API_KEY/)
  assert.equal(paid.paidCallsOff(), true, "never falls back to scripted silently: it stays off, visibly")
  assert.equal(audit(w.config).at(-1).reason, "keys")
})

test("turning ON, then OFF: audit lines (time, direction, origin, never the token), state in GET, live reads on every gated path", async () => {
  unlock()
  const w = await world()
  assert.deepEqual([paid.paidCallsOff(), cfg.MOCK, modelsFor(process.env).includes("anthropic/claude-sonnet-5-5")], [true, true, false])
  assert.throws(() => paid.refusePaid("x"), paid.PaidCallsOff)
  assert.ok(paid.paidModelRefusal(["anthropic/claude-sonnet-5-5"]))
  assert.equal(paid.childEnv().ANTHROPIC_API_KEY, ""); assert.equal(paid.childEnv().NO_PAID_CALLS, "1")
  assert.equal(buildCatalog(w.config, process.env).paidCalls, false)

  const on = await w.call("POST", ON)
  assert.equal(on.status, 200)
  assert.deepEqual([on.body.paid, on.body.source, on.body.board], [true, "switch", "real"])
  // The same gates, now allowed: each reads the live value.
  assert.deepEqual([paid.paidCallsOff(), cfg.MOCK], [false, false])
  assert.doesNotThrow(() => paid.refusePaid("x"))
  assert.equal(paid.paidModelRefusal(["anthropic/claude-sonnet-5-5"]), undefined)
  assert.equal(modelsFor(process.env).includes("anthropic/claude-sonnet-5-5"), true)
  assert.equal(paid.childEnv().ANTHROPIC_API_KEY, "fake-key-for-tests", "a child gets the keys while paid calls are on ...")
  assert.equal(paid.childEnv().NO_PAID_CALLS, "0", "... and NO_PAID_CALLS=0, whatever the environment says")
  assert.equal(buildCatalog(w.config, process.env).paidCalls, true)
  assert.equal(buildCatalog(w.config, process.env).paidSource, "switch")
  assert.equal((await w.call("GET", undefined, {})).body.source, "switch")

  const off = await w.call("POST", { on: false })
  assert.deepEqual([off.body.paid, off.body.source], [false, "switch"])
  assert.deepEqual(off.body.stoppedRuns, ["run-1"], "going off asks the tracker to stop paid GLHF runs")
  assert.deepEqual([paid.paidCallsOff(), cfg.MOCK], [true, true], "refused again")
  assert.throws(() => paid.refusePaid("x"), paid.PaidCallsOff)
  assert.equal(paid.childEnv().ANTHROPIC_API_KEY, ""); assert.equal(paid.childEnv().NO_PAID_CALLS, "1")
  assert.equal(modelsFor(process.env).includes("anthropic/claude-sonnet-5-5"), false)

  const lines = audit(w.config)
  assert.deepEqual(lines.map((l) => [l.result, l.on, l.from]), [["changed", true, "off"], ["changed", false, "on"]])
  assert.ok(lines.every((l) => l.origin === ORIGIN && !Number.isNaN(Date.parse(l.at))))
  assert.ok(!JSON.stringify(lines).includes(TOKEN), "the token is never written")
  assert.equal(outbound.length, 0)
})

test("the environment's own value is the start: NO_PAID_CALLS=0 reads as on, the switch can turn it off, and back on", async () => {
  unlock()
  const w = await world()
  process.env.NO_PAID_CALLS = "0"
  assert.deepEqual(paid.paidState(), { paid: true, source: "env" })
  assert.equal((await w.call("POST", { on: false })).status, 200)
  assert.deepEqual(paid.paidState(), { paid: false, source: "switch" })
  assert.equal((await w.call("POST", ON)).status, 200)
  assert.deepEqual(paid.paidState(), { paid: true, source: "switch" })
  paid.setPaidOverride(undefined)
  assert.deepEqual(paid.paidState(), { paid: true, source: "env" })
})

test("a restart goes back to the environment: the switch lives in memory only", () => {
  const code = (body: string) => spawnSync(process.execPath, ["--input-type=module", "-e", `const p = await import(${JSON.stringify(join(import.meta.dirname, "../src/paid/paid.ts"))}); ${body}`], { env: { PATH: process.env.PATH, NO_PAID_CALLS: "1", PAID_SWITCH_LOCKED: "0" }, encoding: "utf8" })
  const first = code("p.setPaidOverride(true); console.log(JSON.stringify(p.paidState()))")
  assert.equal(first.stdout.trim(), '{"paid":true,"source":"switch"}', first.stderr)
  const second = code("console.log(JSON.stringify(p.paidState()))")
  assert.equal(second.stdout.trim(), '{"paid":false,"source":"env"}', "a new process knows nothing of it")
})

test("POST is rate limited", async () => {
  unlock()
  const w = await world()
  for (let i = 0; i < RATE_PER_MINUTE; i++) assert.equal((await w.call("POST", { on: false })).status, 200)
  const over = await w.call("POST", { on: false })
  assert.equal(over.status, 429); assert.equal(over.body.field, "rate")
})

test("no audit line, no switch: if the audit file cannot be written, ON does not happen (OFF still does)", async () => {
  unlock()
  const config = tempConfig()
  mkdirSync(join(config.paths.runs, AUDIT_FILE), { recursive: true }) // a directory where the file should be
  const w = await world({ config })
  const r = await w.call("POST", ON)
  assert.equal(r.status, 500); assert.equal(r.body.field, "audit")
  assert.equal(paid.paidCallsOff(), true)
  paid.setPaidOverride(true)
  assert.equal((await w.call("POST", { on: false })).status, 200, "turning off is never blocked by a log")
  assert.equal(paid.paidCallsOff(), true)
})

test("through the app: a foreign Origin or Host is refused whatever the token, and the allowed Origin with the token works", async () => {
  unlock()
  const config = tempConfig()
  const app = createApp({ config, hasToken: (req) => req.headers["x-glhf-token"] === TOKEN })
  const server = createServer((req, res) => void app.handler(req, res))
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok)); servers.push(server)
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/paid`
  const post = (headers: Record<string, string>) => fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-glhf-token": TOKEN, ...headers }, body: JSON.stringify(ON) })
  assert.equal((await post({ origin: "https://evil.example" })).status, 403)
  assert.equal((await post({ origin: "http://localhost:4173" })).status, 403, "Vite's default port is not the dashboard")
  assert.equal(paid.paidCallsOff(), true)
  const ok = await post({ origin: ORIGIN })
  assert.equal(ok.status, 200)
  assert.equal(paid.paidCallsOff(), false)
  const status = (await (await fetch(url.replace("/paid", "/status"), { headers: { origin: ORIGIN } })).json()) as any
  assert.deepEqual([status.paidCalls, status.paidSource, status.mock], [true, "switch", false], "/api/status follows the live state")
  assert.equal(app.mock, false)
})

test("a gated model provider refuses the next call the moment the switch goes off, and allows it again when on", async () => {
  const calls: string[] = []
  const faux = fauxProvider({ provider: "anthropic", models: [{ id: "claude-sonnet-5-5", cost: { input: 2, output: 10, cacheRead: 0, cacheWrite: 0 } }] })
  faux.setResponses(Array.from({ length: 5 }, () => () => { calls.push("model"); return fauxAssistantMessage("ok") }))
  const models = createModels()
  models.setProvider(gateProvider(faux.provider))
  const model = models.getModel("anthropic", "claude-sonnet-5-5")!
  const ask = () => models.complete(model, { messages: [{ role: "user", content: "hi", timestamp: Date.now() }] })
  paid.setPaidOverride(true)
  assert.equal((await ask()).stopReason, "stop")
  paid.setPaidOverride(false)
  const refused = await ask() // the provider answers with an error message (pi-ai does not throw): the harness stops the turn
  assert.deepEqual([refused.stopReason, /Paid calls are off/.test(refused.errorMessage ?? "")], ["error", true])
  paid.setPaidOverride(true)
  assert.equal((await ask()).stopReason, "stop")
  assert.equal(calls.length, 2, "the model was reached only while paid calls were on")
})

test("a real run whose paid calls are switched off mid-run: no new check, search or model call; claims are recorded unchecked", async () => {
  const config = tempConfig()
  let off = false
  const calls = { firstPass: 0, literature: 0, search: 0 }
  const deps: any = {
    state: { ledger: [], escalations: 0, checkerUsd: 0 }, maxEscalations: 12,
    firstPass: async (_m: string, cs: string[]) => { calls.firstPass++; return cs.map(() => ({ verdict: "verified" as const, quote: "q", checkedBy: "openai/gpt-4o-mini" })) },
    computedCheck: async () => ({ verdict: "verified" as const, note: "n", usd: 0 }),
    literatureCheck: async () => { calls.literature++; return { verdict: "contradicted" as const, note: "n", usd: 0 } },
    evidenceFor: () => "evidence", save: () => {}, emit: () => {}, paidOff: () => off,
  }
  const claim = (text: string) => ({ kind: "brief" as const, text, source: "brief" })
  await checkClaims(deps, 1, "scout", [claim("one")])
  assert.equal(calls.firstPass, 1)
  off = true
  await checkClaims(deps, 1, "scout", [claim("two"), { kind: "computed" as const, text: "logP", source: "calc" }])
  assert.equal(calls.firstPass, 1, "no first-pass call after the switch went off")
  assert.deepEqual(deps.state.ledger.slice(1).map((r: any) => [r.verdict, r.note]), [["unchecked", "paid calls were switched off: not checked"], ["unchecked", "paid calls were switched off: not checked"]])
  // A search is refused the same way, and a stored result (a replay) is still served for free.
  const sworld: any = { state: { runId: "r", searched: { done: { items: [], notices: [], usd: 0.007, basis: "assumed" } } }, config, mock: false, search: async () => { calls.search++; return { items: [], notices: [] } }, capReached: async () => false, paidOff: () => off }
  const refused = await searchOnce(sworld, "new", { query: "q", objective: "o" })
  assert.match(refused.refused ?? "", /Paid calls were switched off/)
  assert.equal(calls.search, 0)
  assert.ok((await searchOnce(sworld, "done", { query: "q", objective: "o" })).result)
  assert.equal(existsSync(exaLedgerFile(config)), false, "nothing was reserved")
  // The model calls of the first pass: refused by paid.ts at the call.
  paid.setPaidOverride(false)
  await assert.rejects(new FirstPass(createModels(), loadConfig(), false).check("anthropic/claude-sonnet-5-5", ["c"], "s"), paid.PaidCallsOff)
})

test("a run keeps the mode it started in: scripted stays scripted after the switch goes on, and a real run is refused (not scripted) after it goes off", async () => {
  const config = tempConfig()
  const brief = join(import.meta.dirname, "../../board/briefs/kras-g12c-hit-to-lead.md")
  const id = await startRun(brief, { config, mock: true })
  paid.setPaidOverride(true) // the engine is now "real" ...
  assert.equal(cfg.MOCK, false)
  await runBoard(id, undefined, { config }) // ... but this run began scripted and finishes scripted
  const state = loadState(config, id)
  assert.deepEqual([state.mock, state.usd, state.finished], [true, 0, true])
  assert.equal(EventLog.read(join(config.paths.runs, id, "events.jsonl"))[0].type, "run.started")
  assert.equal((EventLog.read(join(config.paths.runs, id, "events.jsonl"))[0] as any).mock, true, "past runs are never relabelled")
  assert.equal(outbound.length, 0)
  // A real run (recorded as such), with the switch now off, is refused rather than continued as scripted.
  const real = await startRun(brief, { config, mock: false, env: process.env })
  paid.setPaidOverride(false)
  await assert.rejects(runBoard(real, undefined, { config }), paid.PaidCallsOff)
  assert.equal(loadState(config, real).mock, false)
})
