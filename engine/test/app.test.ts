// The real request handler (src/app.ts) on a throwaway server on a free port. No model calls, no network
// beyond 127.0.0.1, and the real engine is not started. Each test removes one way the handler could go wrong.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { createServer, request, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import { type AppOptions, bindHost, createApp, DEFAULT_HOST, MAX_STREAMS, MAX_STREAMS_PER_RUN } from "../src/app.ts"
import { type BoardConfig, loadConfig } from "../src/config.ts"
import { stamp } from "../src/glhf/proc.ts"
import { sessionToken } from "../src/glhf/routes.ts"

// These tests are about what happens when paid calls are allowed. They make none: models, fetch and commands are
// fakes. What the NO_PAID_CALLS switch refuses is tested in paid.test.ts.
process.env.NO_PAID_CALLS = "0"

const DASH = "http://127.0.0.1:5317"
/** The dashboard's page after a person has given it the token. */
const AUTH = { origin: DASH, "x-glhf-token": sessionToken() }
const servers: Server[] = []
after(() => { for (const s of servers) s.close() })

function tempConfig(): BoardConfig {
  const config = loadConfig(), dir = mkdtempSync(join(tmpdir(), "engine-app-"))
  mkdirSync(join(dir, "briefs")); mkdirSync(join(dir, "runs"))
  writeFileSync(join(dir, "briefs", "ok.md"), "# Brief: ok\n")
  return { ...config, paths: { ...config.paths, runs: join(dir, "runs"), briefs: join(dir, "briefs"), expertise: join(dir, "expertise") }, meeting: { ...config.meeting, max_usd: 5, daily_usd: 20 } }
}

/** A handler under test, with what it started or resumed recorded instead of run. */
async function boot(options: AppOptions = {}) {
  const config = options.config ?? tempConfig()
  const started: string[] = [], ran: string[] = []
  const app = createApp({ config, mock: false, env: {}, start: async (file) => { started.push(file); return "new-run" }, run: async (id) => { ran.push(id) }, ...options })
  const server = createServer((req, res) => void app.handler(req, res))
  servers.push(server)
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
  const port = (server.address() as AddressInfo).port
  /** One request. `headers` are sent as given, so Host and Origin can be anything (fetch does not allow that). */
  const call = (method: string, path: string, headers: Record<string, string> = {}, body?: string) => new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((ok, fail) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let text = ""
      res.on("data", (d) => (text += d))
      res.on("end", () => ok({ status: res.statusCode ?? 0, body: text, headers: res.headers }))
    })
    req.on("error", fail)
    req.end(body)
  })
  const post = (path: string, headers: Record<string, string>, body: unknown) => call("POST", path, { "content-type": "application/json", ...headers }, JSON.stringify(body))
  const addRun = (id: string, state: object = {}) => {
    const dir = join(config.paths.runs, id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "run.json"), JSON.stringify({ runId: id, briefFile: "/x/ok.md", startedAt: Date.now(), members: {}, rounds: 0, lastRound: [], evidence: {}, ledger: [], escalations: 0, checkerUsd: 0, usd: 0, ...state }))
    return dir
  }
  return { app, config, call, post, started, ran, addRun }
}

test("the server listens on this machine only unless HOST says otherwise", () => {
  assert.equal(DEFAULT_HOST, "127.0.0.1")
  assert.equal(bindHost({}), "127.0.0.1")
  assert.equal(bindHost({ HOST: "" }), "127.0.0.1")
  assert.equal(bindHost({ HOST: "0.0.0.0" }), "0.0.0.0") // only a container sets this
})

test("a request from another web page or for another host name is refused before any route", async () => {
  const { call, post, started } = await boot()
  assert.equal((await call("GET", "/api/runs")).status, 200)
  const allowed = await call("GET", "/api/runs", { origin: DASH })
  assert.equal(allowed.status, 200)
  assert.equal(allowed.headers["access-control-allow-origin"], DASH)
  for (const path of ["/api/runs", "/api/status", "/api/glhf/runs", "/api/search?q=x", "/api/runs/x/memo"]) {
    assert.equal((await call("GET", path, { origin: "https://evil.example" })).status, 403, `foreign Origin ${path}`)
    assert.equal((await call("GET", path, { host: "evil.example:8787" })).status, 403, `foreign Host ${path}`) // DNS rebinding
  }
  const evil = await post("/api/runs", { origin: "https://evil.example" }, { brief: "ok.md" })
  assert.equal(evil.status, 403)
  assert.equal(evil.headers["access-control-allow-origin"], undefined)
  assert.equal((await call("OPTIONS", "/api/runs", { origin: "https://evil.example", "access-control-request-method": "POST" })).status, 403)
  assert.equal((await call("OPTIONS", "/api/runs", { origin: DASH, "access-control-request-method": "POST" })).status, 204)
  assert.deepEqual(started, [], "nothing was started")
  // Also where a run needs no token (scripted mode): the refusal must end the request, not only answer it.
  const mock = await boot({ mock: true })
  assert.equal((await mock.post("/api/runs", { origin: "https://evil.example" }, { brief: "ok.md" })).status, 403)
  assert.equal((await mock.post("/api/runs", { host: "evil.example:8787" }, { brief: "ok.md" })).status, 403)
  await new Promise((ok) => setTimeout(ok, 50))
  assert.deepEqual(mock.started, [], "a refused request starts nothing")
})

test("POST bodies must be JSON: a cross-origin text/plain form post cannot start a run", async () => {
  const { call, started } = await boot()
  assert.equal((await call("POST", "/api/runs", { origin: DASH, "content-type": "text/plain" }, '{"brief":"ok.md"}')).status, 415)
  assert.equal((await call("POST", "/api/runs", { origin: DASH }, '{"brief":"ok.md"}')).status, 415)
  assert.equal((await call("POST", "/api/glhf/runs", { origin: DASH, "content-type": "text/plain" }, '{"mode":"local","solver":"glhf","model":"mock"}')).status, 415)
  assert.equal((await call("POST", "/api/ask", { origin: DASH, "content-type": "text/plain" }, '{"question":"x"}')).status, 415)
  assert.deepEqual(started, [])
})

test("a paid board run starts with this server's token only; the dashboard's Origin alone is asked for the token", async () => {
  const { post, started, ran, addRun } = await boot()
  addRun("paused-run")
  // No Origin (curl, a script, another program on this machine) and no token.
  assert.equal((await post("/api/runs", {}, { brief: "ok.md" })).status, 403)
  assert.equal((await post("/api/runs/paused-run/resume", {}, {})).status, 403)
  assert.equal((await post("/api/runs", { "x-glhf-token": "0".repeat(48) }, { brief: "ok.md" })).status, 403, "a wrong token")
  // M1: an Origin is a header anyone on this machine can send. It does not start or resume a paid run.
  for (const origin of [DASH]) for (const [path, body] of [["/api/runs", { brief: "ok.md" }], ["/api/runs/paused-run/resume", {}]] as const) {
    const res = await post(path, { origin }, body)
    assert.equal(res.status, 401, `${origin} ${path}`)
    const said = JSON.parse(res.body)
    assert.deepEqual([said.field, said.needsToken], ["token", true], "what the dashboard reads to ask for the token")
    assert.match(said.error, /x-glhf-token/)
    assert.ok(!res.body.includes(sessionToken()), "the refusal never carries the token")
    assert.equal((await post(path, { origin, "x-glhf-token": "0".repeat(48) }, body)).status, 401, "a wrong token with the Origin")
  }
  assert.deepEqual([started, ran], [[], []])
  // The token this engine made at startup (in memory; a file left by an earlier engine does not count).
  assert.equal((await post("/api/runs", { "x-glhf-token": sessionToken() }, { brief: "ok.md" })).status, 201)
  assert.equal((await post("/api/runs/paused-run/resume", { "x-glhf-token": sessionToken() }, {})).status, 202)
  // The dashboard's own page, once a person has given it the token.
  assert.equal((await post("/api/runs", AUTH, { brief: "ok.md" })).status, 201)
  assert.equal(started.length, 2)
  assert.deepEqual(ran, ["new-run", "paused-run", "new-run"])
  // In scripted mode nothing costs money, so no token is needed.
  const mock = await boot({ mock: true })
  mock.addRun("paused-run")
  assert.equal((await mock.post("/api/runs", {}, { brief: "ok.md" })).status, 201)
  assert.equal((await mock.post("/api/runs", { origin: DASH }, { brief: "ok.md" })).status, 201)
  assert.equal((await mock.post("/api/runs/paused-run/resume", { origin: DASH }, {})).status, 202)
})

test("GET /api/token says whether the header is this engine's token, and never returns it", async () => {
  const { call } = await boot()
  for (const headers of [{}, { origin: DASH }, { origin: DASH, "x-glhf-token": "0".repeat(48) }, { "x-glhf-token": "" }] as Record<string, string>[]) {
    const res = await call("GET", "/api/token", headers)
    assert.equal(res.status, 401)
    assert.deepEqual([JSON.parse(res.body).field, JSON.parse(res.body).needsToken], ["token", true])
    assert.ok(!res.body.includes(sessionToken()))
  }
  const ok = await call("GET", "/api/token", AUTH)
  assert.deepEqual([ok.status, ok.body], [200, '{"ok":true}'])
  assert.match(String(ok.headers["access-control-allow-headers"]), /x-glhf-token/, "a browser may send the header")
})

test("an event stream sends only what was appended, and streams are capped per run and in total", async () => {
  const { config, addRun } = await boot()
  const { app } = await boot({ config })
  const server = createServer((req, res) => void app.handler(req, res))
  servers.push(server)
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
  const port = (server.address() as AddressInfo).port
  const open = (id: string) => new Promise<{ status: number; text: () => string; close: () => void }>((ok, fail) => {
    const req = request({ host: "127.0.0.1", port, path: `/api/runs/${id}/events`, agent: false }, (res) => {
      let text = ""
      res.on("data", (d) => (text += d))
      res.on("error", () => {})
      ok({ status: res.statusCode ?? 0, text: () => text, close: () => req.destroy() })
    })
    req.on("error", (e) => { if (!req.destroyed) fail(e) })
    req.end()
  })
  const wait = async (what: string, done: () => boolean) => { for (let i = 0; i < 200 && !done(); i++) await new Promise((ok) => setTimeout(ok, 20)); assert.ok(done(), what) }
  const file = join(addRun("s0"), "events.jsonl")
  writeFileSync(file, '{"n":1}\n{"n":"é"}\n{"half":')
  const first = await open("s0")
  assert.equal(first.status, 200)
  await wait("the lines there at the start", () => first.text().includes('data: {"n":"é"}'))
  assert.ok(!first.text().includes("half"), "a line still being written is not sent")
  appendFileSync(file, '1}\n{"n":3}\n')
  await wait("the appended lines", () => first.text().includes('data: {"n":3}'))
  const sent = first.text().split("\n").filter((l) => l.startsWith("data: "))
  assert.deepEqual(sent, ['data: {"n":1}', 'data: {"n":"é"}', 'data: {"half":1}', 'data: {"n":3}'], "each line once: the file is read from the last offset, not from the start")

  // Per run.
  const streams = [first]
  for (let i = 1; i < MAX_STREAMS_PER_RUN; i++) streams.push(await open("s0"))
  assert.ok(streams.every((s) => s.status === 200))
  const over = await open("s0")
  assert.equal(over.status, 429, "one more on the same run")
  over.close()
  // In total.
  for (let r = 1; streams.length < MAX_STREAMS; r++) {
    writeFileSync(join(addRun(`s${r}`), "events.jsonl"), "{}\n")
    for (let i = 0; i < MAX_STREAMS_PER_RUN && streams.length < MAX_STREAMS; i++) streams.push(await open(`s${r}`))
  }
  assert.ok(streams.every((s) => s.status === 200))
  writeFileSync(join(addRun("one-more"), "events.jsonl"), "{}\n")
  const full = await open("one-more")
  assert.equal(full.status, 429, "one more in total")
  full.close()
  // A closed stream gives its place back.
  streams.pop()!.close()
  let again = await open("one-more")
  for (let i = 0; i < 100 && again.status !== 200; i++) { again.close(); await new Promise((ok) => setTimeout(ok, 20)); again = await open("one-more") }
  assert.equal(again.status, 200)
  again.close()
  for (const s of streams) s.close()
})

test("briefs and run ids are names, never paths", async () => {
  const { post, call, started } = await boot()
  for (const brief of ["../../README.md", "/etc/passwd.md", "missing.md"]) assert.equal((await post("/api/runs", AUTH, { brief })).status, 404, brief) // basename only, then not found
  for (const brief of ["a b.md", "..%2F..%2FREADME.md", "ok.txt", 7, undefined]) assert.equal((await post("/api/runs", AUTH, { brief })).status, 400, String(brief))
  assert.deepEqual(started, [])
  for (const id of ["..%2F..%2Fglhf%2Fruns%2Fx", "a%20b", "%E0%A4%A", "..%5Cx", "a..b"]) {
    assert.equal((await call("GET", `/api/runs/${id}/memo`)).status, 400, `memo ${id}`)
    assert.equal((await call("GET", `/api/runs/${id}/events`)).status, 400, `events ${id}`)
    assert.equal((await post(`/api/runs/${id}/resume`, { origin: DASH }, {})).status, 400, `resume ${id}`)
    assert.equal((await call("GET", `/api/glhf/runs/${id}`)).status, 400, `glhf ${id}`)
  }
  // "." and ".." (also written %2e%2e) are removed when the address is parsed, so they never reach a route as an id.
  for (const id of [".", "..", "%2e%2e", "%2E"]) for (const path of [`/api/runs/${id}/memo`, `/api/runs/${id}/events`, `/api/glhf/runs/${id}/x`]) {
    const res = await call("GET", path)
    assert.ok(res.status === 404 || res.status === 400, `${path}: ${res.status}`)
    assert.doesNotMatch(res.body, /"runId"|# /)
  }
  assert.equal((await call("GET", "/api/runs/no-such-run/memo")).status, 404)
  assert.equal((await post("/api/runs/no-such-run/resume", { origin: DASH }, {})).status, 404)
  assert.equal((await call("GET", "/api/glhf/runs/no-such-run")).status, 404)
})

test("an event stream for a run that does not exist ends with 204, which stops a browser's retries", async () => {
  const { call } = await boot()
  const res = await call("GET", "/api/runs/no-such-run/events", { origin: DASH })
  assert.equal(res.status, 204)
  assert.equal(res.body, "")
})

test("a run another process is working on cannot be resumed (409), and counts as running", async () => {
  const { post, call, ran, addRun } = await boot()
  const dir = addRun("held")
  const other = spawn("sleep", ["30"], { stdio: "ignore" })
  try {
    writeFileSync(join(dir, "run.lock"), stamp(other.pid!))
    const res = await post("/api/runs/held/resume", AUTH, {})
    assert.equal(res.status, 409)
    assert.deepEqual(ran, [])
    assert.equal((JSON.parse((await call("GET", "/api/runs")).body) as { id: string; status: string }[]).find((r) => r.id === "held")?.status, "running")
  } finally { other.kill("SIGKILL") }
  // The holder is gone (here: its pid now reads as dead), so the run is paused again and can be resumed.
  await new Promise((ok) => setTimeout(ok, 100))
  assert.equal((JSON.parse((await call("GET", "/api/runs")).body) as { id: string; status: string }[]).find((r) => r.id === "held")?.status, "paused")
  assert.equal((await post("/api/runs/held/resume", AUTH, {})).status, 202)
})

test("a resume past the daily cap is refused (429)", async () => {
  const { post, ran, addRun, config } = await boot()
  addRun("paused")
  addRun("spent", { usd: config.meeting.daily_usd, finished: true })
  assert.equal((await post("/api/runs/paused/resume", AUTH, {})).status, 429)
  assert.deepEqual(ran, [])
})

test("the run list takes rounds and claims from the event log when run.json has none", async () => {
  const { call, addRun } = await boot()
  const dir = addRun("old", { finished: true }) // like 202611141959-kras-g12c-hit-to-lead: rounds 0, ledger [] in run.json
  writeFileSync(join(dir, "events.jsonl"), [
    { key: "round:1", type: "round.started", round: 1 }, { key: "round:2", type: "round.started", round: 2 }, { key: "round:2", type: "round.started", round: 2 },
    { key: "claim:a", type: "claim.checked" }, { key: "claim:b", type: "claim.checked" }, { key: "claim:a", type: "claim.checked" },
  ].map((e) => JSON.stringify(e)).join("\n") + '\n{"key":"claim:c","type":"claim.che')
  const run = (JSON.parse((await call("GET", "/api/runs")).body) as { id: string; rounds: number; claims: number; status: string }[]).find((r) => r.id === "old")!
  assert.deepEqual([run.rounds, run.claims, run.status], [2, 2, "done"])
})

test("a request that throws outside a route's own error handling is answered, and the server keeps serving", async () => {
  // `new URL("//[", base)` throws. That ran outside the handler's try, and server.ts does not await the handler: the
  // rejection was unhandled and stopped the engine with every run in it. Here it would fail this test file instead.
  const { call } = await boot()
  const bad = await call("GET", "//[")
  assert.equal(bad.status, 400)
  assert.match(bad.body, /invalid URL/)
  assert.equal((await call("GET", "/api/runs")).status, 200, "the same server still answers")
})
