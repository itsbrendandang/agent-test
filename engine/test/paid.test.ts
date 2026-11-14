// The NO_PAID_CALLS switch (src/paid.ts). Every path that can spend is called here with the switch on, with
// spies on fetch and on spawn: the path must refuse, and nothing may go out. Nothing here can spend even if a
// gate were missing: fetch is replaced for the whole file, every provider key is replaced by a fake, the local
// runner is a stub, and the Claude Code command is a script in a temporary folder.
import assert from "node:assert/strict"
import childProcess from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { syncBuiltinESMExports } from "node:module"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"

const here = dirname(fileURLToPath(import.meta.url))
const runs = mkdtempSync(join(tmpdir(), "glhf-paid-"))
const stubLog = join(runs, "stub.log")
const realSpawnSync = childProcess.spawnSync

// The board decides "mock or real" once, when config.ts loads. It loads here as an engine with paid calls allowed
// and a key would, so that the tests below reach the gates in the real-model code, not the scripted shortcuts.
process.env.NO_PAID_CALLS = "0"
process.env.DRUG_BOARD_MOCK = "0"
process.env.OPENROUTER_API_KEY = "fake-key-for-tests"
process.env.GLHF_RUNS_DIR = runs
process.env.GLHF_LOCAL_CMD = `${process.execPath} ${join(here, "fixtures", "local-runner-stub.mjs")}`
process.env.GLHF_LOCAL_POLL_MS = "40"
process.env.GLHF_STUB_LOG = stubLog

const paid = await import("../src/paid.ts")
const { MOCK, mockMode, loadConfig } = await import("../src/config.ts")
const { createApp } = await import("../src/app.ts")
const { ask } = await import("../src/ask.ts")
const { runBoard } = await import("../src/board.ts")
const { claudeCodeCheck, openaiCheck } = await import("../src/checkers.ts")
const { exaLive, exaSearch } = await import("../src/exa.ts")
const { Jev } = await import("../src/jev.ts")
const { buildModels } = await import("../src/models.ts")
const { statusBody } = await import("../src/glhf/doctor.ts")
const { sessionToken, startTracker, stopTracker } = await import("../src/glhf/routes.ts")
const { loadStored, listRuns } = await import("../src/glhf/store.ts")
const { paidRun } = await import("../src/glhf/task.ts")
const { BadRequest, checkRequest, checkStart } = await import("../src/glhf/tracker.ts")
const { modelsFor } = await import("../src/glhf/types.ts")
const { PaidCallsOff, PAID_KEYS } = paid

// From here on: no real key in this process, and the switch on. Tests that need it off turn it off and on again.
for (const key of PAID_KEYS) process.env[key] = "fake-key-for-tests"
process.env.TYPESAFE_API_KEY = "fake-key-for-tests"
const on = () => { process.env.NO_PAID_CALLS = "1" }
const off = () => { process.env.NO_PAID_CALLS = "0" }
on()

// Spies. fetch never reaches the network: a call to anything but this machine is recorded and fails.
const outbound: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.startsWith("http://127.0.0.1:")) return realFetch(input, init)
  outbound.push(url)
  throw new Error(`a test tried to reach ${url}`)
}) as typeof fetch
const spawned: string[] = []
const realSpawn = childProcess.spawn, realExecFile = childProcess.execFile
childProcess.spawn = ((...args: Parameters<typeof realSpawn>) => { spawned.push([args[0], ...(Array.isArray(args[1]) ? args[1] : [])].join(" ")); return realSpawn(...args) }) as typeof realSpawn
childProcess.execFile = ((...args: Parameters<typeof realExecFile>) => { spawned.push([args[0], ...(Array.isArray(args[1]) ? args[1] : [])].join(" ")); return realExecFile(...args) }) as typeof realExecFile
syncBuiltinESMExports() // the modules above see the spies through their `import { spawn } from "node:child_process"`
/** Runs `work` and returns what went out during it. */
async function watching<T>(work: () => T | Promise<T>): Promise<{ result: T; fetches: string[]; spawns: string[] }> {
  const f = outbound.length, s = spawned.length
  const result = await work()
  return { result, fetches: outbound.slice(f), spawns: spawned.slice(s) }
}
/** `work` must fail with PaidCallsOff, naming the switch, and nothing may go out. */
async function refused(work: () => unknown, what: RegExp) {
  const seen = await watching(async () => { try { await work() } catch (error) { return error } return undefined })
  assert.ok(seen.result instanceof PaidCallsOff, `expected a PaidCallsOff refusal, got: ${String(seen.result)}`)
  assert.match(seen.result.message, what)
  assert.match(seen.result.message, /NO_PAID_CALLS/)
  assert.deepEqual(seen.fetches, [], "no network call")
  assert.deepEqual(seen.spawns, [], "no process started")
}

const DASH = "http://127.0.0.1:5317"
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
const until = async (what: string, ok: () => boolean, ms = 15_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(25)) if (ok()) return
  assert.fail(`timed out waiting for ${what}`)
}
const run = (id: string) => loadStored(id)!.run
const isSettled = (id: string) => ["done", "failed", "cancelled"].includes(run(id).phase)

const config = loadConfig()
const boardDir = mkdtempSync(join(tmpdir(), "board-paid-"))
mkdirSync(join(boardDir, "runs")); mkdirSync(join(boardDir, "briefs"))
writeFileSync(join(boardDir, "briefs", "ok.md"), "# Brief: ok\n")
const boardConfig = { ...config, paths: { ...config.paths, runs: join(boardDir, "runs"), briefs: join(boardDir, "briefs"), expertise: join(boardDir, "expertise") } }
const addBoardRun = (id: string, state: object) => {
  mkdirSync(join(boardDir, "runs", id), { recursive: true })
  writeFileSync(join(boardDir, "runs", id, "run.json"), JSON.stringify({ runId: id, briefFile: join(boardDir, "briefs", "ok.md"), startedAt: Date.now(), members: {}, rounds: 0, lastRound: [], evidence: {}, ledger: [], escalations: 0, checkerUsd: 0, usd: 0, ...state }))
}

let server: Server, base = ""
const started: string[] = [], ran: string[] = []
before(async () => {
  await startTracker()
  // A handler that believes it runs real models (mock: false), as an engine with keys would.
  const app = createApp({ config: boardConfig, mock: false, start: async (file) => { started.push(file); return "new-run" }, run: async (id) => { ran.push(id) } })
  server = createServer((req, res) => void app.handler(req, res))
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(async () => {
  server.close()
  await stopTracker()
  rmSync(runs, { recursive: true, force: true }); rmSync(boardDir, { recursive: true, force: true })
})
const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = { origin: DASH }) => {
  const res = await realFetch(base + path, { method, headers: { ...headers, ...(body !== undefined && { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, body: (await res.json()) as any }
}

test("the switch is on unless NO_PAID_CALLS is exactly 0", () => {
  assert.equal(paid.paidCallsOff({}), true, "unset: no paid calls")
  for (const value of ["", "1", "true", "false", "off", "no", "00", "0.0", "O"]) assert.equal(paid.paidCallsOff({ NO_PAID_CALLS: value }), true, JSON.stringify(value))
  assert.equal(paid.paidCallsOff({ NO_PAID_CALLS: "0" }), false)
  assert.equal(paid.paidCallsOff({ NO_PAID_CALLS: " 0 " }), false)
  assert.throws(() => paid.refusePaid("x", {}), PaidCallsOff)
  assert.doesNotThrow(() => paid.refusePaid("x", { NO_PAID_CALLS: "0" }))
  assert.match(paid.paidCallsLine({}), /^Paid calls: OFF \(NO_PAID_CALLS\)/)
  assert.match(paid.paidCallsLine({ NO_PAID_CALLS: "0" }), /^Paid calls: ON/)
})

test("the drug board is in mock mode while the switch is on, whatever keys are set", () => {
  assert.equal(MOCK, false, "this file loaded the board as an engine with paid calls allowed would")
  assert.equal(mockMode({ OPENROUTER_API_KEY: "k" }), true)
  assert.equal(mockMode({ OPENROUTER_API_KEY: "k", NO_PAID_CALLS: "1" }), true)
  assert.equal(mockMode({ OPENROUTER_API_KEY: "k", NO_PAID_CALLS: "0" }), false)
  assert.equal(mockMode({ OPENROUTER_API_KEY: "k", NO_PAID_CALLS: "0", DRUG_BOARD_MOCK: "1" }), true)
  assert.equal(mockMode({ NO_PAID_CALLS: "0" }), true, "no key: scripted, as before")
})

test("glhf: a run with a real model, a cloud run and Exa are refused, with the field", async () => {
  const field = (body: object, trust: Parameters<typeof checkRequest>[1] = true) => {
    try { checkStart(body as never, trust) } catch (error) {
      assert.ok(error instanceof BadRequest, String(error))
      assert.match(error.message, /NO_PAID_CALLS/)
      return error.field
    }
    return assert.fail(`not refused: ${JSON.stringify(body)}`)
  }
  const local = { mode: "local", solver: "glhf", model: "anthropic/claude-sonnet-5-5", maxTokens: 50_000 }
  const seen = await watching(async () => {
    for (const trust of [true, { token: true, origin: true }, { token: false, origin: true }] as const) assert.equal(field(local, trust), "model")
    assert.equal(field({ ...local, solver: "single" }), "model")
    assert.equal(field({ ...local, model: "ollama/qwen3:32b" }), "model", "any model that is not the scripted one")
    assert.equal(field({ mode: "local", model: "openai/gpt-5.5", maxTokens: 5_000, solvers: ["glhf", "single"] }), "model")
    assert.equal(field({ mode: "cloud", solver: "glhf", model: "openai/gpt-5.5", task: "9", effort: "high", project: "p" }), "model", "a cloud launch")
    assert.equal(field({ mode: "cloud", solver: "glhf", model: "mock", task: "9", effort: "high", project: "p" }), "mode", "a cloud launch is refused whatever the model")
    assert.equal(field({ mode: "local", solver: "glhf", model: "mock", exa: true }), "exa", "Exa is paid also under the scripted model")
    // Through the routes, as the dashboard and as the CLI (token).
    for (const headers of [{ origin: DASH }, { "x-glhf-token": sessionToken() }] as Record<string, string>[]) {
      const sent = await call("POST", "/api/glhf/runs", local, headers)
      assert.equal(sent.status, 400)
      assert.equal(sent.body.field, "model")
      assert.match(sent.body.error, /NO_PAID_CALLS/)
    }
    assert.equal((await call("POST", "/api/glhf/runs", { mode: "local", solver: "glhf", model: "mock", exa: true })).body.field, "exa")
  })
  assert.deepEqual(seen.fetches, []); assert.deepEqual(seen.spawns, [])
  assert.deepEqual(listRuns(), [], "no run was recorded")
  // With the switch off the same request is accepted (and not started here).
  off()
  try { assert.equal(checkRequest(local as never, true).model, local.model) } finally { on() }
  // What costs nothing is still allowed.
  assert.equal(checkRequest({ mode: "local", solver: "glhf", model: "mock", memory: true }, true).memory, true)
})

test("glhf: the runner gets blank keys, and the scripted run still works", async () => {
  process.env.GLHF_STUB_MS = "150"
  const sent = await call("POST", "/api/glhf/runs", { mode: "local", solver: "glhf", model: "mock", memory: true })
  assert.equal(sent.status, 201, JSON.stringify(sent.body))
  await until("the run to finish", () => isSettled(sent.body.id))
  assert.equal(run(sent.body.id).phase, "done")
  const env = JSON.parse(readFileSync(join(runs, sent.body.id, "env.json"), "utf8"))
  assert.deepEqual(env, { NO_PAID_CALLS: "1", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", OPENROUTER_API_KEY: "", EXA_API_KEY: "", PAST_API_KEY: "", HF_TOKEN: "", TINKER_API_KEY: "" },
    "blank, not absent: Inspect reads an absent key back from .env; past.dev is out of reach without PAST_API_KEY")

  const child = paid.childEnv({ PATH: "/bin", ANTHROPIC_API_KEY: "a", HF_TOKEN: "h", VSCODE_PID: "1", VSCODE_CWD: "/x", TERM_PROGRAM: "vscode", UV_ENV_FILE: ".env", OTHER: "kept" })
  assert.deepEqual(child, { PATH: "/bin", OTHER: "kept", NO_PAID_CALLS: "1", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", OPENROUTER_API_KEY: "", EXA_API_KEY: "", PAST_API_KEY: "", HF_TOKEN: "", TINKER_API_KEY: "" },
    "and nothing that makes Inspect or uv load .env over them")
  const open = { NO_PAID_CALLS: "0", ANTHROPIC_API_KEY: "a" }
  assert.equal(paid.childEnv(open), open, "with paid calls allowed the environment is passed on as it is")
})

test("glhf: a paid run that was accepted before the switch came on is stopped, and its queued partner is not launched", async () => {
  off()
  process.env.GLHF_STUB_MS = "60000"
  let ids: string[]
  try {
    const sent = await call("POST", "/api/glhf/runs", { mode: "local", model: "anthropic/claude-sonnet-5-5", maxTokens: 50_000, solvers: ["glhf", "single"] })
    assert.equal(sent.status, 201, JSON.stringify(sent.body))
    ids = sent.body.ids
    await until("the first run to be going (it is the stub: nothing is spent)", () => run(ids[0]).phase === "running")
  } finally { on() }
  const [first, second] = ids
  const seen = await watching(() => until("both to settle", () => isSettled(first) && isSettled(second)))
  assert.equal(run(first).phase, "failed")
  assert.match(run(first).error ?? "", /^stopped: a run with a real model is refused\. Paid calls are off \(NO_PAID_CALLS\)/)
  assert.equal(run(second).phase, "failed")
  assert.match(run(second).error ?? "", /^not launched: a run with a real model is refused\. Paid calls are off \(NO_PAID_CALLS\)/)
  assert.ok(!existsSync(join(runs, second, "runner.pid")), "the partner was never started")
  assert.deepEqual(seen.spawns.filter((s) => s.includes("local-runner-stub")), [], "no runner was started after the switch came on")
  const { alive } = await import("../src/glhf/proc.ts")
  assert.ok(!alive(readFileSync(join(runs, first, "runner.pid"), "utf8")), "the runner that was spending is gone")

  assert.match(paidRun({ mode: "cloud", model: "openai/gpt-5.5" }) ?? "", /a cloud run is refused/)
  assert.match(paidRun({ mode: "local", model: "mock", exa: true }) ?? "", /Exa search is refused/)
  assert.match(paidRun({ mode: "local", model: "mock", roleModels: { critic: "openai/gpt-5.5" } }) ?? "", /real model/)
  assert.equal(paidRun({ mode: "local", model: "mock" }), undefined)
  off(); try { assert.equal(paidRun({ mode: "cloud", model: "openai/gpt-5.5" }), undefined) } finally { on() }
})

test("status: paidCalls is false and only the scripted model is offered", async () => {
  const body = await statusBody()
  assert.equal(body.paidCalls, false)
  assert.deepEqual(body.models, ["mock"])
  assert.deepEqual(modelsFor({ ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k" }), ["mock"])
  const served = await call("GET", "/api/glhf/status")
  assert.equal(served.body.paidCalls, false)
  assert.deepEqual(served.body.models, ["mock"])
  assert.equal((await call("GET", "/api/status")).body.paidCalls, false)
  off()
  try {
    const allowed = await statusBody()
    assert.equal(allowed.paidCalls, true)
    assert.ok(allowed.models.length > 1, "the fake keys of this test count as set")
  } finally { on() }
})

test("ask: no model call; the answer is the keyword search, and says why", async () => {
  const calls: string[] = []
  const spy = (async (url: string) => { calls.push(url); throw new Error("must not be called") }) as unknown as typeof fetch
  const seen = await watching(() => ask("which run had the best score", [], "all", { key: "fake-key-for-tests", fetch: spy }))
  assert.equal(seen.result.mode, "keyword")
  assert.match(seen.result.note ?? "", /Paid calls are off \(NO_PAID_CALLS\)/)
  assert.deepEqual(calls, []); assert.deepEqual(seen.fetches, [])
  // Through the route, where the key comes from the environment (a fake one here).
  const served = await watching(() => call("POST", "/api/ask", { question: "which run had the best score" }))
  assert.equal(served.result.status, 200)
  assert.equal(served.result.body.mode, "keyword")
  assert.match(served.result.body.note, /NO_PAID_CALLS/)
  assert.deepEqual(served.fetches, [])
  off()
  try { // with the switch off the same question does reach the (fake) model
    await ask("which run had the best score", [], "all", { key: "fake-key-for-tests", fetch: spy, entries: [{ kind: "swarm", id: "r", title: "t", startedAt: 1, text: "x" } as never] })
    assert.deepEqual(calls, ["https://api.anthropic.com/v1/messages"])
  } finally { on() }
})

test("board: Exa search is refused before the request", async () => {
  await refused(() => exaLive("kras", "papers", "fake-key-for-tests"), /Exa search/)
  await refused(() => exaSearch("kras", "papers", false), /Exa search/)
  const seen = await watching(() => exaSearch("kras", "papers", true))
  assert.ok(seen.result.items.length > 0, "scripted mode still returns its fixture papers")
  assert.deepEqual(seen.fetches, [])
})

/** A Models stand-in that records every use. Any use is a paid call that got through. */
function fakeModels() {
  const used: string[] = []
  const models = new Proxy({}, { get: (_target, name) => (..._args: unknown[]) => { used.push(String(name)); return name === "classify" || name === "complete" ? Promise.reject(new Error("must not be called")) : { id: "fake" } } })
  return { models: models as never, used }
}

test("board: Jev, the OpenAI checker and the Claude Code checker are refused before any call", async () => {
  const jev = fakeModels()
  await refused(() => new Jev(jev.models, config, false).check(["a claim"], "evidence"), /Jev/)
  await refused(() => new Jev(jev.models, config, false).triage({ url: "u", title: "t", text: "x" }, "question"), /Jev/)
  assert.deepEqual(jev.used, [], "the model collection was not touched")
  assert.equal((await new Jev(jev.models, config, true).check(["a claim"], "evidence")).length, 1, "scripted Jev still answers")

  const openai = fakeModels()
  await refused(() => openaiCheck(openai.models, config, "a claim", "evidence", false), /OpenAI checker/)
  assert.deepEqual(openai.used, [])
  assert.equal((await openaiCheck(openai.models, config, "a claim", "evidence", true)).usd, 0)

  // Claude Code: the command is a script that would leave a file behind if it were ever started.
  const dir = mkdtempSync(join(tmpdir(), "paid-claude-")), marker = join(dir, "started"), script = join(dir, "fake-claude.mjs")
  writeFileSync(script, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "x"); console.log("VERDICT: verified")`)
  const claude = { ...config, checkers: { ...config.checkers, claude_code_cmd: `${process.execPath} ${script}`, claude_code_tools: "" } }
  try {
    await refused(() => claudeCodeCheck(claude, "logP is 3.4", "calc", false), /Claude Code checker/)
    assert.ok(!existsSync(marker), "the command was not started")
    off()
    try { assert.equal((await claudeCodeCheck(claude, "logP is 3.4", "calc", false)).verdict, "verified"); assert.ok(existsSync(marker), "with the switch off the same call does start it") } finally { on() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("board: real models are not registered, and a run started with real models is not continued", async () => {
  await refused(() => buildModels([], false), /drug board with real models/)
  assert.doesNotThrow(() => buildModels([], true))

  addBoardRun("real-paused", { mock: false })
  addBoardRun("old-paused", {}) // written before the field existed: not known to be scripted, so treated as real
  for (const id of ["real-paused", "old-paused"]) {
    await refused(() => runBoard(id, undefined, { config: boardConfig, mock: false }), /continuing board run/)
    assert.ok(!existsSync(join(boardDir, "runs", id, "run.lock")) && !existsSync(join(boardDir, "runs", id, "session.sqlite")), "nothing was opened")
  }
  addBoardRun("real-done", { mock: false, finished: true })
  await runBoard("real-done", undefined, { config: boardConfig, mock: false }) // a finished run returns at once

  // The routes of a handler that believes it has real models.
  const seen = await watching(async () => {
    const start = await call("POST", "/api/runs", { brief: "ok.md" })
    assert.equal(start.status, 403)
    assert.match(start.body.error, /NO_PAID_CALLS/)
    const withToken = await call("POST", "/api/runs", { brief: "ok.md" }, { "x-glhf-token": sessionToken() })
    assert.equal(withToken.status, 403, "the token does not open it either")
    const resume = await call("POST", "/api/runs/real-paused/resume", {})
    assert.equal(resume.status, 403)
    assert.match(resume.body.error, /NO_PAID_CALLS/)
  })
  assert.deepEqual(started, [], "no run was started"); assert.deepEqual(ran, [], "no run was continued")
  assert.deepEqual(seen.fetches, [])
  addBoardRun("mock-paused", { mock: true })
  assert.equal((await call("POST", "/api/runs/mock-paused/resume", {})).status, 202, "a scripted run may continue")
  assert.deepEqual(ran, ["mock-paused"])
})

test("doctor and the board CLI say whether paid calls are on", () => {
  const cli = (file: string, args: string[], value: string) => realSpawnSync(process.execPath, [join(here, "..", "src", file), ...args], { encoding: "utf8", env: { ...process.env, NO_PAID_CALLS: value, DRUG_BOARD_PORT: "1" } })
  assert.match(cli("glhf/cli.ts", ["doctor"], "1").stdout, /^Paid calls: OFF \(NO_PAID_CALLS\)/m)
  assert.match(cli("glhf/cli.ts", ["doctor"], "0").stdout, /^Paid calls: ON \(NO_PAID_CALLS=0\)/m)
  const refusedRun = cli("glhf/cli.ts", ["run", "--model", "anthropic/claude-sonnet-5-5", "--max-tokens", "5000"], "1")
  assert.equal(refusedRun.status, 1)
  assert.match(refusedRun.stderr, /NO_PAID_CALLS/)
})

test("nothing in this file reached the network", () => {
  assert.deepEqual(outbound.filter((url) => url !== "https://api.anthropic.com/v1/messages"), [])
})
