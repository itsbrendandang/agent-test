// Starting, queueing and cancelling GLHF runs through the real routes, on a throwaway server. The tracker works in
// a temporary folder (GLHF_RUNS_DIR), so the engine that may be running and glhf/runs are not touched, and a stub
// stands in for the local runner (GLHF_LOCAL_CMD): no Docker, no model, no cost.
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"
import type { GlhfRun } from "../src/glhf/types.ts"

const here = dirname(fileURLToPath(import.meta.url))
const runs = mkdtempSync(join(tmpdir(), "glhf-runs-"))
const stubLog = join(runs, "stub.log")
process.env.GLHF_RUNS_DIR = runs
process.env.GLHF_LOCAL_CMD = `${process.execPath} ${join(here, "fixtures", "local-runner-stub.mjs")}`
process.env.GLHF_LOCAL_POLL_MS = "40"
process.env.GLHF_STUB_LOG = stubLog

// Imported only now: store.ts reads GLHF_RUNS_DIR when it loads.
const { createApp } = await import("../src/app.ts")
const { startTracker, stopTracker } = await import("../src/glhf/routes.ts")
const { loadStored, patchRun, RUNS, saveStored } = await import("../src/glhf/store.ts")
const { pairKey } = await import("../src/glhf/scoreboard.ts")
const { alive } = await import("../src/glhf/proc.ts")
const { BadRequest, checkRequest, checkStart } = await import("../src/glhf/tracker.ts")
const { predecessor } = await import("../src/glhf/task.ts")
const { LIMITS, modelsFor } = await import("../src/glhf/types.ts")

delete process.env.EXA_API_KEY // after the imports: env.ts fills it from .env when it loads

const DASH = "http://127.0.0.1:5317"
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
let server: Server, base = ""

before(async () => {
  assert.equal(RUNS, runs, "the tracker must not work in glhf/runs during tests")
  await startTracker()
  const app = createApp({ mock: true, env: {} })
  server = createServer((req, res) => void app.handler(req, res))
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(async () => {
  server.close()
  await stopTracker()
  rmSync(runs, { recursive: true, force: true })
})

const call = async (method: string, path: string, body?: unknown, origin: string | null = DASH) => {
  const res = await fetch(base + path, { method, headers: { ...(origin && { origin }), ...(body !== undefined && { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, body: (await res.json()) as any }
}
const start = (body: object, ms = 300, fail = "") => {
  process.env.GLHF_STUB_MS = String(ms)
  process.env.GLHF_STUB_FAIL = fail
  return call("POST", "/api/glhf/runs", { mode: "local", model: "mock", ...body })
}
const run = (id: string) => loadStored(id)!.run
const until = async (what: string, ok: () => boolean, ms = 15_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(25)) if (ok()) return
  assert.fail(`timed out waiting for ${what}`)
}
const isSettled = (id: string) => ["done", "failed", "cancelled"].includes(run(id).phase)
const stubLines = () => (existsSync(stubLog) ? readFileSync(stubLog, "utf8").trim().split("\n").map((l) => l.split(" ")) : [])
const pidOf = (id: string, file: string) => readFileSync(join(runs, id, file), "utf8")

test("a pair runs one after the other, with the settings that make the scoreboard pair them", async () => {
  const sent = await start({ solvers: ["glhf", "single"], timeLimit: 600, maxTokens: 50_000, seed: 7, reviewRounds: 2, memory: true }, 500)
  assert.equal(sent.status, 201, JSON.stringify(sent.body))
  const [first, second] = sent.body.ids as string[]
  assert.equal(sent.body.id, first, "id stays, for callers that start one run")
  assert.match(first, /-glhf(-\d+)?$/); assert.match(second, /-single(-\d+)?$/)

  const queued = run(second)
  assert.equal(queued.phase, "queued")
  assert.equal(queued.after, first)
  assert.equal(queued.pairedWith, first)
  assert.equal(run(first).pairedWith, second)
  assert.equal(pairKey(run(first)), pairKey(queued))
  for (const key of ["timeLimit", "maxTokens", "seed"] as const) assert.equal(run(first).settings?.[key], queued.settings?.[key], key)
  assert.equal(queued.task, run(first).task); assert.equal(queued.model, run(first).model)
  assert.equal(queued.settings?.memory, undefined, "what only the swarm reads is not given to the single agent")
  assert.equal(run(first).settings?.reviewRounds, 2)

  await until("the first run to be going", () => run(first).phase === "running")
  assert.equal(run(second).phase, "queued")
  assert.ok(!existsSync(join(runs, second, "runner.pid")), "the partner has not been launched while the first is going")
  assert.match(run(second).detail ?? "", new RegExp(`waiting for ${first}`))

  await until("both runs to finish", () => isSettled(first) && isSettled(second))
  assert.equal(run(first).phase, "done"); assert.equal(run(second).phase, "done")
  const mine = stubLines().filter((l) => l.slice(3).join(" ").includes(first) || l.slice(3).join(" ").includes(second))
  assert.deepEqual(mine.map((l) => `${l[0]} ${l[1]}`), ["start glhf", "end glhf", "start single", "end single"], "never two at once")
  assert.equal(run(second).note, undefined)
  assert.ok(run(second).startedAt >= (run(first).finishedAt ?? Infinity), "the partner's clock starts when it is launched, not when it was queued")
  assert.match(mine[2].join(" "), /--time-limit 600 .*--max-tokens 50000 .*--seed 7/)
})

test("a queued partner survives an engine restart", async () => {
  const sent = await start({ solvers: ["single", "glhf"] }, 700)
  const [first, second] = sent.body.ids as string[]
  assert.match(first, /-single(-\d+)?$/, "the order given is the order run")
  await until("the first run to be launched", () => existsSync(join(runs, first, "runner.pid")))
  await stopTracker() // the engine goes away: nothing in memory is left
  assert.equal((await call("GET", `/api/glhf/runs/${second}`)).body.run.phase, "queued")
  await sleep(900) // the first run ends while nobody is tracking
  assert.equal(run(second).phase, "queued")
  assert.ok(!existsSync(join(runs, second, "runner.pid")))
  await startTracker()
  await until("both runs to finish after the restart", () => isSettled(first) && isSettled(second))
  assert.equal(run(first).phase, "done"); assert.equal(run(second).phase, "done")
})

test("when the first run of a pair fails, the partner still starts and says why", async () => {
  const sent = await start({ solvers: ["glhf", "single"] }, 150, "glhf")
  const [first, second] = sent.body.ids as string[]
  await until("both runs to finish", () => isSettled(first) && isSettled(second))
  assert.equal(run(first).phase, "failed")
  assert.equal(run(second).phase, "done")
  assert.equal(run(second).note, `started although ${first}, the run it was queued behind, failed: the stub was told to fail`)
  assert.match(readFileSync(join(runs, second, "tracker.log"), "utf8"), /started although .* failed/)
  // The same decision, without a run:
  const stored = (phase: GlhfRun["phase"], error?: string) => ({ request: {} as never, run: { ...run(first), phase, error } })
  assert.deepEqual(predecessor("x", stored("running")), { settled: false })
  assert.deepEqual(predecessor("x", stored("queued")), { settled: false })
  assert.deepEqual(predecessor("x", stored("done")), { settled: true })
  assert.match(predecessor("x", stored("cancelled")).note ?? "", /was cancelled/)
  assert.match(predecessor("gone-run", undefined).note ?? "", /record of gone-run.* is gone/)
})

test("one local run at a time: a second start is refused with 409, except the queued partner", async () => {
  const sent = await start({ solvers: ["glhf", "single"] }, 400)
  assert.equal(sent.status, 201, "the pair itself is two local runs and is not refused")
  const [first, second] = sent.body.ids as string[]
  for (const body of [{ solver: "glhf" }, { solver: "single" }, { solvers: ["glhf", "single"] }]) {
    const refused = await start(body, 400)
    assert.equal(refused.status, 409, JSON.stringify(body))
    assert.match(refused.body.error, /a local run is still going/)
    assert.ok([first, second].includes(refused.body.run))
  }
  assert.equal((await start({ solver: "glhf" }, 400, "")).status, 409)
  await until("the first to finish", () => isSettled(first))
  assert.equal((await start({ solver: "glhf" }, 400)).status, 409, "still refused while the queued partner is waiting or going")
  await until("the pair to finish", () => isSettled(second))
  const next = await start({ solver: "single" }, 100)
  assert.equal(next.status, 201)
  assert.deepEqual(next.body.ids, [next.body.id])
  await until("it to finish", () => isSettled(next.body.id))
})

test("cancel stops the runner and what it started, marks the run cancelled, and frees the machine", async () => {
  const sent = await start({ solver: "glhf" }, 60_000)
  const id = sent.body.id as string
  await until("the run to be going", () => run(id).phase === "running" && existsSync(join(runs, id, "child.pid")))
  const runner = pidOf(id, "runner.pid"), child = pidOf(id, "child.pid")
  assert.ok(alive(runner) && alive(child))

  const cancelled = await call("POST", `/api/glhf/runs/${id}/cancel`)
  assert.equal(cancelled.status, 200)
  assert.equal(cancelled.body.id, id)
  assert.equal(cancelled.body.phase, "cancelled", "not failed")
  assert.equal(cancelled.body.error, undefined)
  assert.equal(typeof cancelled.body.finishedAt, "number")
  assert.ok(!alive(runner), "the runner is gone")
  assert.ok(!alive(child), "and so is what it started (the whole process group)")

  await sleep(300) // several polls later the watcher has not written "failed" over it
  assert.equal(run(id).phase, "cancelled")
  assert.doesNotMatch(readFileSync(join(runs, id, "tracker.log"), "utf8"), /finished: failed/)
  assert.ok(!(await call("GET", "/api/glhf/scoreboard")).body.some((row: any) => row.swarm?.id === id), "a cancelled run is not a result")

  const again = await call("POST", `/api/glhf/runs/${id}/cancel`)
  assert.equal(again.status, 200)
  assert.deepEqual(again.body, cancelled.body, "cancelling a settled run changes nothing")

  const next = await start({ solver: "single" }, 100)
  assert.equal(next.status, 201, "a cancelled run no longer blocks the next one")
  await until("it to finish", () => isSettled(next.body.id))
  assert.equal(run(next.body.id).phase, "done")
  const finished = structuredClone(run(next.body.id))
  assert.deepEqual((await call("POST", `/api/glhf/runs/${next.body.id}/cancel`)).body, { ...finished, settings: finished.settings }, "a finished run stays done")

  assert.equal((await call("POST", "/api/glhf/runs/no-such-run/cancel")).status, 404)
  // A cloud run is not marked cancelled while its VM may be billing: refused, with the command that removes the VM.
  saveStored({ request: { mode: "cloud", solver: "glhf", model: "openai/gpt-5.5", project: "proj" }, run: { id: "cloud-run", mode: "cloud", task: "9", solver: "glhf", model: "openai/gpt-5.5", roleModels: {}, phase: "running", remoteId: "remote-1", startedAt: 1 } })
  const cloud = await call("POST", "/api/glhf/runs/cloud-run/cancel")
  assert.equal(cloud.status, 409)
  assert.match(cloud.body.error, /bixbench3 cancel --run remote-1 --project proj/)
  assert.equal(run("cloud-run").phase, "running")
  patchRun("cloud-run", { phase: "failed" }) // so the restart below does not start tracking it
  assert.equal((await call("POST", "/api/glhf/runs/..%2Fx/cancel")).status, 400)
  assert.equal((await call("POST", `/api/glhf/runs/${id}/cancel`, undefined, "http://evil.example")).status, 403)

  await stopTracker(); await startTracker() // a restart does not bring it back
  await sleep(200)
  assert.equal(run(id).phase, "cancelled")
})

test("cancelling a queued partner means it never starts; cancelling the first lets the partner start, with a note", async () => {
  const a = await start({ solvers: ["glhf", "single"] }, 400)
  const [first, second] = a.body.ids as string[]
  assert.equal((await call("POST", `/api/glhf/runs/${second}/cancel`)).body.phase, "cancelled")
  await until("the first to finish", () => isSettled(first))
  await sleep(200)
  assert.equal(run(second).phase, "cancelled")
  assert.ok(!existsSync(join(runs, second, "runner.pid")), "it was never launched")

  // A cancel that was recorded just before the engine died, so the task was never told: after the restart the
  // task reads the record and ends without launching anything.
  const c = await start({ solvers: ["glhf", "single"] }, 300)
  const [lead, late] = c.body.ids as string[]
  await stopTracker()
  patchRun(late, { phase: "cancelled", finishedAt: Date.now() })
  await startTracker()
  await until("the first to finish", () => isSettled(lead))
  await sleep(300)
  assert.equal(run(late).phase, "cancelled")
  assert.ok(!existsSync(join(runs, late, "runner.pid")), "not launched after the restart either")

  const b = await start({ solvers: ["glhf", "single"] }, 300)
  const [one, two] = b.body.ids as string[]
  await until("the first to be going", () => run(one).phase === "running")
  assert.equal((await call("POST", `/api/glhf/runs/${one}/cancel`)).body.phase, "cancelled")
  await until("the partner to finish", () => isSettled(two))
  assert.equal(run(two).phase, "done")
  assert.match(run(two).note ?? "", new RegExp(`${one}.* was cancelled`))
})

test("status gives the limits from types.ts, the models to offer, and keys as true or false only", async () => {
  const { status, body } = await call("GET", "/api/glhf/status")
  assert.equal(status, 200)
  assert.deepEqual(body.limits, { timeLimit: [60, 86_400], maxTokens: [1_000, 500_000_000], reviewRounds: [1, 10], maxMessagesPerRole: [2, 5_000] })
  assert.deepEqual(body.limits, JSON.parse(JSON.stringify(LIMITS)), "the same object checkRequest enforces")
  assert.equal(body.keys.EXA_API_KEY, false)
  for (const [name, value] of Object.entries(body.keys)) assert.equal(typeof value, "boolean", name)
  assert.equal(body.models[0], "mock")
  assert.deepEqual(body.models, modelsFor())
  assert.deepEqual(modelsFor({}), ["mock"])
  assert.deepEqual(modelsFor({ ANTHROPIC_API_KEY: "k" }), ["mock", "anthropic/claude-sonnet-5-5", "anthropic/claude-haiku-5-5"])
  assert.deepEqual(modelsFor({ OPENAI_API_KEY: "k" }), ["mock", "openai/gpt-5.5"])
  assert.equal(modelsFor({ ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k" }).length, 4)
  // The limits are what is enforced: one past each end is refused, each end is accepted.
  const base = { mode: "local", solver: "glhf", model: "mock" } as const
  for (const field of ["timeLimit", "maxTokens", "reviewRounds", "maxMessagesPerRole"] as const) {
    const [min, max] = LIMITS[field]
    assert.equal(checkRequest({ ...base, [field]: min }, true)[field], min)
    assert.equal(checkRequest({ ...base, [field]: max }, true)[field], max)
    assert.throws(() => checkRequest({ ...base, [field]: min - 1 }, true), BadRequest, `${field} below`)
    assert.throws(() => checkRequest({ ...base, [field]: max + 1 }, true), BadRequest, `${field} above`)
  }
})

test("a refusal names the field it is about", async () => {
  const base = { mode: "local", solver: "glhf", model: "mock" } as const
  const field = (body: object, trust: Parameters<typeof checkRequest>[1] = true) => {
    try { checkStart(body as never, trust) } catch (error) { assert.ok(error instanceof BadRequest, String(error)); return error.field }
    return assert.fail(`not refused: ${JSON.stringify(body)}`)
  }
  assert.equal(field({ ...base, timeLimit: 5 }), "timeLimit")
  assert.equal(field({ ...base, maxTokens: 1 }), "maxTokens")
  assert.equal(field({ ...base, seed: 0.5 }), "seed")
  assert.equal(field({ ...base, reviewRounds: 11 }), "reviewRounds")
  assert.equal(field({ ...base, maxMessagesPerRole: 1 }), "maxMessagesPerRole")
  assert.equal(field({ ...base, model: "a b" }), "model")
  assert.equal(field({ ...base, model: "anthropic/claude-sonnet-5-5" }, false), "model")
  assert.equal(field({ ...base, exa: true }), "exa") // no EXA_API_KEY in this test
  assert.equal(field({ ...base, exa: true }, false), "exa")
  assert.equal(field({ ...base, memory: true }, false), "memory")
  assert.equal(field({ ...base, solver: "single", memory: true }), "memory")
  assert.equal(field({ ...base, mode: "moon" }), "mode")
  assert.equal(field({ ...base, mode: "cloud", task: "9", effort: "high", project: "p", model: "openai/gpt-5.5" }, { token: false, origin: true }), "mode")
  assert.equal(field({ ...base, caseDir: "/etc" }, { token: false, origin: true }), "caseDir")
  assert.equal(field({ ...base, caseDir: 5 }), "caseDir")
  assert.equal(field({ ...base, solver: "both" }), "solver")
  assert.equal(field({ ...base, solvers: ["glhf", "single"] }), "solver", "solver and solvers together")
  assert.equal(field({ mode: "local", model: "mock", solvers: ["glhf", "glhf"] }), "solver")
  assert.equal(field({ mode: "local", model: "mock", solvers: [] }), "solver")
  assert.equal(field({ mode: "cloud", model: "openai/gpt-5.5", task: "9", effort: "high", project: "p", solvers: ["glhf", "single"] }), "mode")
  assert.equal(field({ ...base, task: 5 }), undefined, "not a field of the form")
  assert.equal(field({ mode: "local", model: "mock", solvers: ["glhf", "single"], timeLimit: 5 }), "timeLimit", "a pair is checked before either run starts")

  // Through the route: {error, field}, with the text unchanged.
  const refused = await start({ solver: "glhf", timeLimit: 5 })
  assert.equal(refused.status, 400)
  assert.deepEqual(refused.body, { error: "timeLimit (seconds) must be a whole number from 60 to 86400", field: "timeLimit" })
  const real = await call("POST", "/api/glhf/runs", { mode: "local", solver: "glhf", model: "anthropic/claude-sonnet-5-5" }, null)
  assert.equal(real.status, 400)
  assert.equal(real.body.field, "model")
  assert.match(real.body.error, /^runs with a real model cost money/)
  assert.deepEqual((await start({ solver: "glhf", task: 5 })).body, { error: "task must be a short text" }, "no field key when there is none")
  assert.equal((await call("GET", "/api/glhf/runs")).body.filter((r: GlhfRun) => r.detail === "refused").length, 0)
})
