// Who may do what (the security review's M1, M5, M6 and its low findings), through the real routes on throwaway
// servers. An Origin header is not a credential: any program on this machine can send one. So whatever can spend
// or touches shared state needs the session token, and the dashboard's Origin alone gets a 401 that asks for it.
// No model, no Docker, no cloud, no cost: the runner is a stub (GLHF_LOCAL_CMD), the tracker works in a temporary
// folder (GLHF_RUNS_DIR), keys are fakes and every fetch is a spy.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer, request, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"
import type { GlhfRun } from "../src/glhf/types.ts"

process.env.NO_PAID_CALLS = "0" // paid calls "allowed": what is refused here is refused for want of the token
const here = dirname(fileURLToPath(import.meta.url))
const runs = mkdtempSync(join(tmpdir(), "glhf-auth-"))
const fixture = (name: string) => `${process.execPath} ${join(here, "fixtures", name)}`
process.env.GLHF_RUNS_DIR = runs
process.env.GLHF_LOCAL_CMD = fixture("local-runner-stub.mjs")
process.env.GLHF_DOCKER_CMD = fixture("docker-stub.mjs")
process.env.GLHF_DOCKER_STUB_STATE = join(runs, "docker-state.json")
process.env.GLHF_DOCKER_STUB_LOG = join(runs, "docker.log")
process.env.GLHF_BIXBENCH3_CMD = fixture("bixbench3-fail-stub.mjs")
process.env.GLHF_BIXBENCH3_RUNS = join(runs, "manifests")
process.env.GLHF_CANCEL_INT_MS = "200"
process.env.GLHF_CANCEL_GRACE_MS = "200"
process.env.GLHF_CANCEL_KILL_MS = "2000"
process.env.GLHF_LOCAL_POLL_MS = "40"

// Imported only now: store.ts reads GLHF_RUNS_DIR when it loads.
const { createApp } = await import("../src/app.ts")
const { forgetRoles, handleGlhf, needsToken, paidRun, sessionToken, startTracker, stopTracker, TOKEN_FILE } = await import("../src/glhf/routes.ts")
const { loadStored, RUNS } = await import("../src/glhf/store.ts")
const { access, guard } = await import("../src/http.ts")
const { askDailyCap, ASK_DAILY_CAP, resetDaily } = await import("../src/ask.ts")
type Entry = import("../src/ask.ts").Entry

// After the imports (env.ts fills keys from .env when it loads): no real key is in reach of this file.
for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "PAST_API_KEY"]) delete process.env[key]
process.env.EXA_API_KEY = "fake-exa-key" // so that an exa request is not refused for want of a key

const DASH = "http://127.0.0.1:5317"
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
const servers: Server[] = []
let base = ""
const logged: string[] = []

// What the Ask route may call instead of a model. Each call is counted.
const asked: string[] = []
const entries: Entry[] = [{ kind: "swarm", id: "run-a", title: "Task demo", startedAt: 2, text: "claim c1 [supported]: the table has rows" }]
const fakeModel = (async (url: string) => { asked.push(String(url)); return new Response(JSON.stringify({ content: [{ type: "text", text: '{"answer": "It has rows.", "runs": [{"kind": "swarm", "id": "run-a", "why": "says so"}]}' }] })) }) as unknown as typeof fetch
const realFetch = globalThis.fetch
const outside: string[] = []
globalThis.fetch = (async (input: any, init?: any) => { // nothing in this file may leave the machine
  const url = String(input?.url ?? input)
  if (!url.startsWith("http://127.0.0.1:")) { outside.push(url); throw new Error(`a test tried to reach ${url}`) }
  return realFetch(input, init)
}) as typeof fetch

async function listen(handler: Parameters<typeof createServer>[1]) {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

before(async () => {
  assert.equal(RUNS, runs, "the tracker must not work in glhf/runs during tests")
  const log = console.log
  console.log = (...args: unknown[]) => { logged.push(args.join(" ")) }
  try { await startTracker() } finally { console.log = log }
  const app = createApp({ mock: true, env: {}, ask: { key: "fake-anthropic-key", fetch: fakeModel, entries } })
  base = await listen((req, res) => void app.handler(req, res))
})
after(async () => {
  for (const s of servers) { s.closeAllConnections(); s.close() }
  await stopTracker()
  globalThis.fetch = realFetch
  rmSync(runs, { recursive: true, force: true })
})

type Who = { origin?: string; token?: string }
const ORIGIN: Who = { origin: DASH }, NOBODY: Who = {}
const holder = (): Who => ({ token: sessionToken() }), page = (): Who => ({ origin: DASH, token: sessionToken() })
const call = async (method: string, path: string, who: Who, body?: unknown, type = "application/json") => {
  const res = await fetch(base + path, { method, headers: { ...(who.origin && { origin: who.origin }), ...(who.token !== undefined && { "x-glhf-token": who.token }), ...(body !== undefined && { "content-type": type }) }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) })
  const text = await res.text()
  let parsed: any
  try { parsed = JSON.parse(text) } catch { parsed = undefined }
  return { status: res.status, body: parsed, text }
}
const run = (id: string) => loadStored(id)!.run as GlhfRun
const settled = (id: string) => ["done", "failed", "cancelled"].includes(run(id).phase)
const until = async (what: string, done: () => boolean, ms = 15_000) => {
  for (const end = Date.now() + ms; Date.now() < end;) { if (done()) return; await sleep(25) }
  assert.fail(`timed out waiting for ${what}`)
}
/** The run folders there are. */
const folders = () => readdirSync(runs).filter((d) => existsSync(join(runs, d, "record.json"))).sort()

/** The 401 the dashboard reads to ask a person for the token. */
function asksForToken(res: { status: number; body: any; text: string }, what: string) {
  assert.equal(res.status, 401, `${what}: ${res.text}`)
  assert.equal(res.body.field, "token", what)
  assert.equal(res.body.needsToken, true, what)
  assert.match(res.body.error, /x-glhf-token/, what)
  assert.ok(!res.text.includes(sessionToken()), "a refusal never carries the token")
}

const demo = { mode: "local", solver: "glhf", model: "mock" }
const real = { mode: "local", solver: "glhf", model: "anthropic/claude-sonnet-5-5", maxTokens: 50_000 }
/** Everything a start can ask for beyond the plain scripted run. */
const SPENDING: [string, Record<string, unknown>][] = [
  ["the review's request", { mode: "local", solver: "glhf", model: "anthropic/claude-sonnet-5-5", maxTokens: 500_000_000, timeLimit: 86_400, exa: true, memory: true }],
  ["a real model", real],
  ["a real model in a pair", { mode: "local", model: real.model, maxTokens: 50_000, solvers: ["glhf", "single"] }],
  ["role models", { ...demo, roleModels: { critic: "openai/gpt-5.5" } }],
  ["exa", { ...demo, exa: true }],
  ["shared memory", { ...demo, memory: true }],
  ["a cloud run", { mode: "cloud", solver: "glhf", model: "openai/gpt-5.5", task: "9", effort: "high", project: "p" }],
  ["a case directory", { ...demo, caseDir: "/etc" }],
]

test("the one rule: reads are open, scripted actions need the Origin or the token, spending needs the token", () => {
  const who = { nobody: { origin: false, token: false }, page: { origin: true, token: false }, holder: { origin: false, token: true }, both: { origin: true, token: true } }
  assert.deepEqual(Object.values(who).map((w) => access(w, "read")), ["ok", "ok", "ok", "ok"])
  assert.deepEqual(Object.values(who).map((w) => access(w, "scripted")), ["forbidden", "ok", "ok", "ok"])
  assert.deepEqual(Object.values(who).map((w) => access(w, "spend")), ["forbidden", "token", "ok", "ok"])
  for (const [what, body] of SPENDING) assert.equal(needsToken(body), true, what)
  assert.equal(needsToken(demo), false)
  assert.equal(needsToken({ ...demo, solvers: ["glhf", "single"], timeLimit: 600, seed: 7, roleModels: {}, exa: false, memory: false }), false)
  assert.equal(needsToken({ ...demo, model: "Mock" }), true, "only exactly mock is the scripted model")
  const base: GlhfRun = { id: "x", mode: "local", task: "demo", solver: "glhf", model: "mock", roleModels: {}, phase: "running", startedAt: 1 }
  assert.equal(paidRun(base), false)
  for (const patch of [{ model: "openai/gpt-5.5" }, { mode: "cloud" as const }, { roleModels: { critic: "openai/gpt-5.5" } }, { settings: { exa: true } }, { settings: { memory: true } }]) assert.equal(paidRun({ ...base, ...patch } as GlhfRun), true, JSON.stringify(patch))
})

test("M1: an Origin header alone starts nothing that can spend or touches shared state", async () => {
  const before = folders()
  for (const [what, body] of SPENDING) {
    for (const origin of [DASH, "http://localhost:5317", "tauri://localhost"]) asksForToken(await call("POST", "/api/glhf/runs", { origin }, body), `${what} from ${origin}`)
    asksForToken(await call("POST", "/api/glhf/runs", { origin: DASH, token: "0".repeat(48) }, body), `${what} with a wrong token`)
    assert.equal((await call("POST", "/api/glhf/runs", NOBODY, body)).status, 403, `${what} from nobody`)
  }
  // The ports Vite uses by default are not the dashboard any more: refused before any route.
  for (const origin of ["http://localhost:4173", "http://127.0.0.1:5173"]) assert.equal((await call("POST", "/api/glhf/runs", { origin }, demo)).status, 403, origin)
  assert.deepEqual(folders(), before, "no run folder was made")

  // What stays open to the dashboard's page without the token: the scripted run.
  process.env.GLHF_STUB_MS = "100"
  const scripted = await call("POST", "/api/glhf/runs", ORIGIN, demo)
  assert.equal(scripted.status, 201, scripted.text)
  await until("the scripted run to end", () => settled(scripted.body.id))
  // With the token a real model starts (here: the stub). From the CLI, and from the page once it has the token.
  for (const who of [holder(), page()]) {
    const sent = await call("POST", "/api/glhf/runs", who, real)
    assert.equal(sent.status, 201, sent.text)
    await until("the run to end", () => settled(sent.body.id))
    assert.equal(run(sent.body.id).model, real.model)
  }
  const memory = await call("POST", "/api/glhf/runs", page(), { ...demo, memory: true })
  assert.equal(memory.status, 201, memory.text)
  await until("the memory run to end", () => settled(memory.body.id))
})

test("M1: the other checks still come first or still hold: 415, the body cap, the form's own refusals", async () => {
  assert.equal((await call("POST", "/api/glhf/runs", ORIGIN, JSON.stringify(real), "text/plain")).status, 415)
  assert.equal((await call("POST", "/api/glhf/runs", page(), JSON.stringify(real), "text/plain")).status, 415)
  assert.equal((await call("POST", "/api/glhf/runs", ORIGIN, { ...real, pad: "x".repeat(1 << 20) })).status, 413)
  assert.equal((await call("POST", "/api/glhf/runs", { origin: "https://evil.example", token: sessionToken() }, demo)).status, 403, "a foreign Origin, even with the token")
  const bad = await call("POST", "/api/glhf/runs", ORIGIN, { ...demo, timeLimit: 5 })
  assert.deepEqual([bad.status, bad.body.field], [400, "timeLimit"], "a scripted request's own mistakes are still told as such")
  assert.equal((await call("POST", "/api/glhf/runs", ORIGIN, { solver: "glhf" })).status, 400, "no model, no mode: a bad request, not a question about the token")
  assert.deepEqual(outside, [])
})

test("M1: with NO_PAID_CALLS on, what is paid is refused as such, with or without the token", async () => {
  const before = folders()
  process.env.NO_PAID_CALLS = "1"
  try {
    for (const [what, body] of SPENDING.filter(([w]) => !["shared memory", "a case directory", "role models"].includes(w))) for (const who of [ORIGIN, holder(), page()]) {
      const res = await call("POST", "/api/glhf/runs", who, body)
      assert.equal(res.status, 400, `${what}: ${res.text}`)
      assert.match(res.body.error, /NO_PAID_CALLS/, what)
    }
    // Free but shared: still the token, switch or no switch.
    asksForToken(await call("POST", "/api/glhf/runs", ORIGIN, { ...demo, memory: true }), "memory with the switch on")
    asksForToken(await call("POST", "/api/glhf/runs", ORIGIN, { ...demo, caseDir: "/etc" }), "caseDir with the switch on")
  } finally { process.env.NO_PAID_CALLS = "0" }
  assert.deepEqual(folders(), before)
})

test("M1: cancelling a paid run needs the token; a scripted run stops from the dashboard's page", async () => {
  process.env.GLHF_STUB_MS = "60000"
  const paid = await call("POST", "/api/glhf/runs", holder(), real)
  assert.equal(paid.status, 201, paid.text)
  const id = paid.body.id as string
  await until("the paid run to be going", () => run(id).phase === "running")
  asksForToken(await call("POST", `/api/glhf/runs/${id}/cancel`, ORIGIN), "cancel of a paid run from the Origin alone")
  assert.equal((await call("POST", `/api/glhf/runs/${id}/cancel`, NOBODY)).status, 403)
  assert.equal(run(id).phase, "running", "it was not stopped")
  // A run folder whose record cannot be read: nobody knows what it is, so the token.
  mkdirSync(join(runs, "no-record"))
  writeFileSync(join(runs, "no-record", "record.json"), "{not json")
  asksForToken(await call("POST", "/api/glhf/runs/no-record/cancel", ORIGIN), "cancel of an unreadable run")
  assert.equal((await call("POST", "/api/glhf/runs/no-such-run/cancel", ORIGIN)).status, 404, "a run that does not exist is just not there")
  const done = await call("POST", `/api/glhf/runs/${id}/cancel`, page())
  assert.deepEqual([done.status, done.body.phase], [200, "cancelled"])
  await until("the machine to be free", () => !existsSync(join(runs, id, "runner.pid")) || settled(id))

  const scripted = await call("POST", "/api/glhf/runs", ORIGIN, demo)
  assert.equal(scripted.status, 201, scripted.text)
  await until("the scripted run to be going", () => run(scripted.body.id).phase === "running")
  const stopped = await call("POST", `/api/glhf/runs/${scripted.body.id}/cancel`, ORIGIN)
  assert.deepEqual([stopped.status, stopped.body.phase], [200, "cancelled"])
  process.env.GLHF_STUB_MS = "100"
})

test("the token: a 600 file whose place is printed at start-up, never the token; no route returns it", async () => {
  assert.equal(statSync(TOKEN_FILE).mode & 0o777, 0o600)
  assert.equal(readFileSync(TOKEN_FILE, "utf8"), sessionToken())
  assert.ok(logged.some((line) => line.includes(TOKEN_FILE)), "the engine says where the token file is")
  assert.ok(!logged.join("\n").includes(sessionToken()), "and never prints the token")
  for (const path of ["/api/status", "/api/glhf/status", "/api/token", "/api/glhf/runs", "/api/runs", "/api/bixv1/runs", "/api/glhf/token", "/api/glhf/.token"]) for (const who of [ORIGIN, page()]) {
    assert.ok(!(await call("GET", path, who)).text.includes(sessionToken()), path)
  }
  assert.equal((await call("GET", "/api/glhf/runs/.token", page())).status, 404, "the token file is not a run")
})

test("M6: Ask needs the dashboard's Origin for the keyword answer and the token for the model", async () => {
  resetDaily()
  const q = { question: "does the table have rows?" }
  // Nobody: nothing, and no model call.
  const nobody = await call("POST", "/api/ask", NOBODY, q)
  assert.equal(nobody.status, 403)
  // The Origin alone: the keyword answer, marked so that the page can ask for the token. No model call.
  const origin = await call("POST", "/api/ask", ORIGIN, q)
  assert.equal(origin.status, 200, origin.text)
  assert.deepEqual([origin.body.mode, origin.body.needsToken, origin.body.field], ["keyword", true, "token"])
  assert.match(origin.body.note, /session token/)
  assert.equal((await call("POST", "/api/ask", { origin: DASH, token: "0".repeat(48) }, q)).body.mode, "keyword", "a wrong token")
  assert.deepEqual(asked, [], "no model was asked for a caller without the token")
  // The token: the model answers. With or without an Origin (the CLI).
  for (const who of [page(), holder()]) {
    const res = await call("POST", "/api/ask", who, q)
    assert.deepEqual([res.status, res.body.mode, res.body.needsToken], [200, "ai", undefined], res.text)
  }
  assert.equal(asked.length, 2)
  // The switch: no model call, whoever asks, and no talk of a token that would not help.
  process.env.NO_PAID_CALLS = "1"
  try {
    for (const who of [ORIGIN, page()]) {
      const off = await call("POST", "/api/ask", who, q)
      assert.deepEqual([off.body.mode, off.body.needsToken], ["keyword", undefined])
      assert.match(off.body.note, /NO_PAID_CALLS/)
    }
  } finally { process.env.NO_PAID_CALLS = "0" }
  assert.equal(asked.length, 2)
  // The old checks hold.
  assert.equal((await call("POST", "/api/ask", page(), JSON.stringify(q), "text/plain")).status, 415)
  assert.equal((await call("POST", "/api/ask", page(), { question: "x".repeat(20_000) })).status, 413)
  assert.equal((await call("POST", "/api/ask", { origin: "https://evil.example", token: sessionToken() }, q)).status, 403)
  assert.equal(asked.length, 2)
})

test("M6: model answers are capped per day; past the cap the answer is the keyword one, with a note", async () => {
  assert.equal(ASK_DAILY_CAP, 200)
  assert.equal(askDailyCap({}), 200)
  assert.equal(askDailyCap({ ASK_DAILY_CAP: "5" }), 5)
  assert.equal(askDailyCap({ ASK_DAILY_CAP: "0" }), 0, "0 turns model answers off")
  for (const bad of ["", " ", "-1", "2.5", "many"]) assert.equal(askDailyCap({ ASK_DAILY_CAP: bad }), 200, JSON.stringify(bad))

  const app = createApp({ mock: true, env: {}, ask: { key: "fake-anthropic-key", fetch: fakeModel, entries, cap: 3 } })
  const capped = await listen((req, res) => void app.handler(req, res))
  const ask = async () => (await (await fetch(`${capped}/api/ask`, { method: "POST", headers: { "content-type": "application/json", "x-glhf-token": sessionToken() }, body: JSON.stringify({ question: "does the table have rows?" }) })).json()) as any
  resetDaily()
  asked.length = 0
  const modes: string[] = []
  let last: any
  for (let i = 0; i < 5; i++) modes.push((last = await ask()).mode)
  assert.deepEqual(modes, ["ai", "ai", "ai", "keyword", "keyword"])
  assert.equal(asked.length, 3, "three model calls, then none")
  assert.match(last.note, /limit of 3 AI answers.*ASK_DAILY_CAP/)
  assert.equal(last.needsToken, undefined, "the token is not what is missing")
  resetDaily() // the next day
  assert.equal((await ask()).mode, "ai")
  resetDaily()
})

test("low (a): the roles need the dashboard's Origin, are read once, and a failure is not retried on every request", async () => {
  let loads = 0, fail = false
  const loadRoles = async () => { loads++; if (fail) throw new Error("uv is not here"); return [{ name: "scout" }] }
  const url = await listen((req, res) => { if (guard(req, res, {})) void handleGlhf(req, res, new URL(req.url ?? "/", "http://x").pathname.split("/").filter(Boolean), { loadRoles }) })
  const roles = (headers: Record<string, string>) => fetch(`${url}/api/glhf/roles`, { headers })
  forgetRoles()
  for (const headers of [{}, { "x-glhf-token": "0".repeat(48) }] as Record<string, string>[]) assert.equal((await roles(headers)).status, 403)
  assert.equal(loads, 0, "a caller without the Origin starts no command")
  for (const headers of [{ origin: DASH }, { origin: DASH }, { "x-glhf-token": sessionToken() }] as Record<string, string>[]) {
    const res = await roles(headers)
    assert.deepEqual([res.status, await res.json()], [200, [{ name: "scout" }]])
  }
  assert.equal(loads, 1, "read once, then kept")
  forgetRoles()
  fail = true
  for (let i = 0; i < 4; i++) assert.equal((await roles({ origin: DASH })).status, 500)
  assert.equal(loads, 2, "a failure is kept too (for a minute): four requests, one more command")
  forgetRoles()
})

test("low (c): the dashboard's static server sends a content security policy that names the engine only", async () => {
  const file = join(here, "..", "..", "docker", "serve.mjs")
  const { createDashboardServer, securityHeaders } = await import(file) as { createDashboardServer: (root: string, env?: Record<string, string>) => Server; securityHeaders: (env?: Record<string, string>) => Record<string, string> }
  const root = mkdtempSync(join(tmpdir(), "glhf-serve-"))
  writeFileSync(join(root, "index.html"), "<!doctype html><title>t</title>")
  writeFileSync(join(root, "app.js"), "1")
  const server = createDashboardServer(root, {})
  servers.push(server)
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
  const port = (server.address() as AddressInfo).port
  const get = (path: string) => new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((ok, fail) => {
    const req = request({ host: "127.0.0.1", port, path }, (res) => { let body = ""; res.on("data", (d) => (body += d)); res.on("end", () => ok({ status: res.statusCode ?? 0, headers: res.headers, body })) })
    req.on("error", fail); req.end()
  })
  try {
    for (const path of ["/", "/app.js", "/no/such/page", "/%E0%A4%A", "/../../etc/passwd", "/..%2F..%2Fetc%2Fpasswd"]) {
      const res = await get(path)
      const csp = String(res.headers["content-security-policy"])
      assert.match(csp, /default-src 'self'/, path)
      assert.match(csp, /connect-src 'self' http:\/\/127\.0\.0\.1:8787 http:\/\/localhost:8787(;|$)/, path)
      assert.match(csp, /frame-ancestors 'none'/, path)
      assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'(;|$)/, "no inline script, no eval")
      assert.match(csp, /object-src 'none'/)
      assert.equal(res.headers["x-content-type-options"], "nosniff", path)
      assert.ok(!res.body.includes("root:"), "nothing from outside the folder")
    }
    assert.equal((await get("/app.js")).body, "1")
    assert.match((await get("/../../etc/passwd")).body, /<title>t<\/title>/, "a path outside the folder gets the page")
  } finally { rmSync(root, { recursive: true, force: true }) }
  // The policy matches the desktop app's production policy, without what only Tauri needs (ipc).
  const tauri = JSON.parse(readFileSync(join(here, "..", "..", "dashboard", "src-tauri", "tauri.conf.json"), "utf8")).app.security.csp as Record<string, string>
  const mine = Object.fromEntries(securityHeaders({})["content-security-policy"].split("; ").map((d) => [d.slice(0, d.indexOf(" ")), d.slice(d.indexOf(" ") + 1)]))
  for (const [directive, value] of Object.entries(tauri)) assert.equal(mine[directive], directive === "connect-src" ? value.replace(" ipc: http://ipc.localhost", "") : value, directive)
  // The engine's address can be set, and cannot smuggle a directive in.
  assert.match(securityHeaders({ GLHF_ENGINE_PORT: "9001" })["content-security-policy"], /connect-src 'self' http:\/\/127\.0\.0\.1:9001 http:\/\/localhost:9001;/)
  assert.match(securityHeaders({ ENGINE_ORIGINS: "http://engine.lan:8787 x; script-src *, https://e.example" })["content-security-policy"], /connect-src 'self' http:\/\/engine\.lan:8787 https:\/\/e\.example;/)
  assert.doesNotMatch(securityHeaders({ ENGINE_ORIGINS: "x; script-src *" })["content-security-policy"], /script-src \*/)
})
