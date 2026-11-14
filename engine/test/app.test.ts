// The real request handler (src/app.ts) on a throwaway server on a free port. No model calls, no network
// beyond 127.0.0.1, and the real engine is not started. Each test removes one way the handler could go wrong.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { createServer, request, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import { type AppOptions, bindHost, createApp, DEFAULT_HOST } from "../src/app.ts"
import { type BoardConfig, loadConfig } from "../src/config.ts"
import { stamp } from "../src/glhf/proc.ts"
import { sessionToken } from "../src/glhf/routes.ts"

// These tests are about what happens when paid calls are allowed. They make none: models, fetch and commands are
// fakes. What the NO_PAID_CALLS switch refuses is tested in paid.test.ts.
process.env.NO_PAID_CALLS = "0"

const DASH = "http://127.0.0.1:5317"
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

test("a paid board run starts from the dashboard, or with this server's token; nobody else", async () => {
  const { post, started, ran, addRun } = await boot()
  addRun("paused-run")
  // No Origin (curl, a script, another program on this machine) and no token.
  assert.equal((await post("/api/runs", {}, { brief: "ok.md" })).status, 403)
  assert.equal((await post("/api/runs/paused-run/resume", {}, {})).status, 403)
  assert.equal((await post("/api/runs", { "x-glhf-token": "0".repeat(48) }, { brief: "ok.md" })).status, 403, "a wrong token")
  assert.deepEqual([started, ran], [[], []])
  // The token this engine made at startup (in memory; a file left by an earlier engine does not count).
  assert.equal((await post("/api/runs", { "x-glhf-token": sessionToken() }, { brief: "ok.md" })).status, 201)
  assert.equal((await post("/api/runs/paused-run/resume", { "x-glhf-token": sessionToken() }, {})).status, 202)
  // The dashboard's own page.
  assert.equal((await post("/api/runs", { origin: DASH }, { brief: "ok.md" })).status, 201)
  assert.equal(started.length, 2)
  assert.deepEqual(ran, ["new-run", "paused-run", "new-run"])
  // In scripted mode nothing costs money, so no token is needed.
  const mock = await boot({ mock: true })
  assert.equal((await mock.post("/api/runs", {}, { brief: "ok.md" })).status, 201)
})

test("briefs and run ids are names, never paths", async () => {
  const { post, call, started } = await boot()
  for (const brief of ["../../README.md", "/etc/passwd.md", "missing.md"]) assert.equal((await post("/api/runs", { origin: DASH }, { brief })).status, 404, brief) // basename only, then not found
  for (const brief of ["a b.md", "..%2F..%2FREADME.md", "ok.txt", 7, undefined]) assert.equal((await post("/api/runs", { origin: DASH }, { brief })).status, 400, String(brief))
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
    const res = await post("/api/runs/held/resume", { origin: DASH }, {})
    assert.equal(res.status, 409)
    assert.deepEqual(ran, [])
    assert.equal((JSON.parse((await call("GET", "/api/runs")).body) as { id: string; status: string }[]).find((r) => r.id === "held")?.status, "running")
  } finally { other.kill("SIGKILL") }
  // The holder is gone (here: its pid now reads as dead), so the run is paused again and can be resumed.
  await new Promise((ok) => setTimeout(ok, 100))
  assert.equal((JSON.parse((await call("GET", "/api/runs")).body) as { id: string; status: string }[]).find((r) => r.id === "held")?.status, "paused")
  assert.equal((await post("/api/runs/held/resume", { origin: DASH }, {})).status, 202)
})

test("a resume past the daily cap is refused (429)", async () => {
  const { post, ran, addRun, config } = await boot()
  addRun("paused")
  addRun("spent", { usd: config.meeting.daily_usd, finished: true })
  assert.equal((await post("/api/runs/paused/resume", { origin: DASH }, {})).status, 429)
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
