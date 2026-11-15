// Starting, queueing and cancelling GLHF runs through the real routes, on a throwaway server. The tracker works in
// a temporary folder (GLHF_RUNS_DIR), so the engine that may be running and glhf/runs are not touched, and a stub
// stands in for the local runner (GLHF_LOCAL_CMD), for `docker` (GLHF_DOCKER_CMD) and for `bixbench3`
// (GLHF_BIXBENCH3_CMD): no Docker, no model, no cloud, no cost.
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { chmodSync, existsSync, symlinkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"
import type { GlhfRun } from "../src/glhf/types.ts"

// These tests are about what happens when paid calls are allowed. They make none: models, fetch and commands are
// fakes. What the NO_PAID_CALLS switch refuses is tested in paid.test.ts.
process.env.NO_PAID_CALLS = "0"

const here = dirname(fileURLToPath(import.meta.url))
const runs = mkdtempSync(join(tmpdir(), "glhf-runs-"))
const stubLog = join(runs, "stub.log")
process.env.GLHF_RUNS_DIR = runs
const fixture = (name: string) => `${process.execPath} ${join(here, "fixtures", name)}`
const PLAIN = fixture("local-runner-stub.mjs"), CONTROL = fixture("control-stub.mjs")
const dockerState = join(runs, "docker-state.json"), dockerLog = join(runs, "docker.log")
process.env.GLHF_LOCAL_CMD = PLAIN
process.env.GLHF_DOCKER_CMD = fixture("docker-stub.mjs") // the real Docker is never asked
process.env.GLHF_DOCKER_STUB_STATE = dockerState
process.env.GLHF_DOCKER_STUB_LOG = dockerLog
process.env.GLHF_BIXBENCH3_CMD = fixture("bixbench3-fail-stub.mjs") // the real `uv run bixbench3` is never the fallback
process.env.GLHF_BIXBENCH3_RUNS = join(runs, "manifests")
// How long a cancel waits after SIGINT, after SIGTERM and after SIGKILL.
process.env.GLHF_CANCEL_INT_MS = "300"
process.env.GLHF_CANCEL_GRACE_MS = "300"
process.env.GLHF_CANCEL_KILL_MS = "2000"
process.env.GLHF_LOCAL_POLL_MS = "40"
process.env.GLHF_STUB_LOG = stubLog

// Imported only now: store.ts reads GLHF_RUNS_DIR when it loads.
const { createApp } = await import("../src/app.ts")
const { sessionToken, startTracker, stopTracker, TOKEN_FILE } = await import("../src/glhf/routes.ts")
const { loadStored, patchRun, RUNS, saveStored } = await import("../src/glhf/store.ts")
const { pairKey } = await import("../src/glhf/scoreboard.ts")
const { alive } = await import("../src/glhf/proc.ts")
const { BadRequest, checkRequest, checkStart, cloudMaxHours, dailyTokenCap, DAILY_TOKENS, HARD_STOP, mostTokens, tokensToday } = await import("../src/glhf/tracker.ts")
const { readJson, readText, RUN_FILES, runFile, tail } = await import("../src/glhf/store.ts")
const { cancelDetail, predecessor, removeSandbox, sandboxNote, startOnce, stopAndWait } = await import("../src/glhf/task.ts")
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

const call = async (method: string, path: string, body?: unknown, origin: string | null = DASH, token?: string) => {
  const res = await fetch(base + path, { method, headers: { ...(origin && { origin }), ...(token && { "x-glhf-token": token }), ...(body !== undefined && { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, body: (await res.json()) as any }
}
const start = (body: object, ms = 300, fail = "") => {
  process.env.GLHF_STUB_MS = String(ms)
  process.env.GLHF_STUB_FAIL = fail
  // The dashboard's page with the session token: what is not the plain scripted run needs the token (routes.ts needsToken).
  return call("POST", "/api/glhf/runs", { mode: "local", model: "mock", ...body }, DASH, sessionToken())
}
const run = (id: string) => loadStored(id)!.run
const until = async (what: string, ok: () => boolean, ms = 15_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(25)) if (ok()) return
  assert.fail(`timed out waiting for ${what}`)
}
const isSettled = (id: string) => ["done", "failed", "cancelled"].includes(run(id).phase)
const stubLines = () => (existsSync(stubLog) ? readFileSync(stubLog, "utf8").trim().split("\n").map((l) => l.split(" ")) : [])
const listRunsDone = () => readdirSync(runs).every((id) => !loadStored(id) || isSettled(id))
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
  assert.deepEqual(predecessor("x", stored("cancelled")), { settled: true, cancel: true, note: "cancelled because x, the run it was queued behind, was cancelled" })
  assert.equal(predecessor("x", stored("failed", "boom")).cancel, undefined, "a failure does not cancel the partner")
  assert.match(predecessor("gone-run", undefined).note ?? "", /record of gone-run.* is gone/)
  assert.equal(predecessor("gone-run", undefined).settled, true, "a run that is gone altogether does not hold its partner back for ever")
})

test("one local run at a time: a second start is refused with 409, except the queued partner", async () => {
  const sent = await start({ solvers: ["glhf", "single"] }, 400)
  assert.equal(sent.status, 201, "the pair itself is two local runs and is not refused")
  const [first, second] = sent.body.ids as string[]
  for (const body of [{ solver: "glhf" }, { solver: "single" }, { solvers: ["glhf", "single"] }]) {
    const refused = await start(body, 400)
    assert.equal(refused.status, 409, JSON.stringify(body))
    assert.match(refused.body.error, /a local run is still going/)
    assert.equal(refused.body.run, first, "the run that is at work, not the one waiting behind it")
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
  assert.equal((await call("POST", "/api/glhf/runs/cloud-run/cancel")).status, 401, "the page alone may not touch a cloud run")
  const cloud = await cancel("cloud-run")
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

test("cancelling a queued partner means it never starts; cancelling the first cancels the partner too, with a note", async () => {
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

  // Cancelling the first run of a pair stops the spending: the partner is cancelled with it, and says why.
  // (Slow polling here, so that it is the cancel itself that reaches the partner, not the partner's next look.)
  process.env.GLHF_LOCAL_POLL_MS = "3000"
  const b = await start({ solvers: ["glhf", "single"] }, 60_000)
  const [one, two] = b.body.ids as string[]
  await until("the first to be launched", () => existsSync(join(runs, one, "runner.pid")) && alive(pidOf(one, "runner.pid")))
  await sleep(100) // the partner has had its first look and now sleeps for 3 s
  assert.equal((await call("POST", `/api/glhf/runs/${one}/cancel`)).body.phase, "cancelled")
  process.env.GLHF_LOCAL_POLL_MS = "40"
  assert.equal(run(two).phase, "cancelled", "already when the cancel answers")
  assert.equal(run(two).note, `cancelled because ${one}, the run it was queued behind, was cancelled`)
  assert.equal(run(one).note, undefined)
  await sleep(300)
  assert.equal(run(two).phase, "cancelled")
  assert.ok(!existsSync(join(runs, two, "runner.pid")), "the partner was never launched")
  assert.equal((await start({ solver: "single" }, 50)).status, 201, "and the machine is free")
  await until("that run to finish", () => listRunsDone())

  // The same when the engine stopped between the cancel of the first and the cancel of its partner.
  const d = await start({ solvers: ["glhf", "single"] }, 60_000)
  const [head, tail] = d.body.ids as string[]
  await until("the first to be launched", () => existsSync(join(runs, head, "runner.pid")) && alive(pidOf(head, "runner.pid")))
  await stopTracker()
  patchRun(head, { phase: "cancelled", finishedAt: Date.now() })
  process.kill(-Number(pidOf(head, "runner.pid").split(" ")[0]), "SIGKILL")
  await startTracker()
  await until("the partner to settle", () => isSettled(tail))
  assert.equal(run(tail).phase, "cancelled")
  assert.equal(run(tail).note, `cancelled because ${head}, the run it was queued behind, was cancelled`)
  assert.ok(!existsSync(join(runs, tail, "runner.pid")))
})

/** What a cloud start must say besides its settings: that the bill is meant, and for how long at most. */
const BILL = { billCloud: true, maxHours: 2 } as const

test("a real model needs a token budget", async () => {
  const real = { mode: "local", solver: "glhf", model: "anthropic/claude-sonnet-5-5" } as const
  for (const trust of [true, { token: false, origin: true }] as const) {
    assert.throws(() => checkRequest(real, trust), (e: any) => e instanceof BadRequest && e.field === "maxTokens" && /^maxTokens is required for a real model/.test(e.message))
    assert.equal(checkRequest({ ...real, maxTokens: 1_000 }, trust).maxTokens, 1_000)
  }
  assert.equal(checkRequest({ ...real, model: "mock" }, true).maxTokens, undefined, "the scripted model spends nothing")
  assert.throws(() => checkStart({ mode: "local", model: real.model, solvers: ["glhf", "single"] }, true), /maxTokens is required/)
  assert.equal(checkStart({ mode: "local", model: real.model, solvers: ["glhf", "single"], maxTokens: 5_000 }, true).length, 2)
  // A cloud run cannot take maxTokens (the cloud runner has its own limit), so it is not asked for one.
  assert.equal(checkRequest({ ...real, mode: "cloud", task: "9", effort: "high", project: "p", ...BILL }, true).maxTokens, undefined)
  assert.equal((await call("POST", "/api/glhf/runs", real)).status, 401, "the page alone: a real model needs the token")
  const sent = await call("POST", "/api/glhf/runs", real, DASH, sessionToken())
  assert.equal(sent.status, 400)
  assert.equal(sent.body.field, "maxTokens")
})

test("the CLI starts a pair with --solvers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "glhf-cli-"))
  // A port nobody listens on, so the CLI tracks the runs itself and never talks to an engine that may be running.
  const free = createServer(); await new Promise<void>((ok) => free.listen(0, "127.0.0.1", ok))
  const port = (free.address() as AddressInfo).port; await new Promise((ok) => free.close(ok))
  const cli = (...args: string[]) => spawnSync(process.execPath, [join(here, "..", "src", "glhf", "cli.ts"), ...args],
    { encoding: "utf8", env: { ...process.env, GLHF_RUNS_DIR: dir, DRUG_BOARD_PORT: String(port), GLHF_STUB_MS: "200", GLHF_STUB_FAIL: "", GLHF_STUB_LOG: join(dir, "stub.log") } })
  try {
    const out = cli("run", "--solvers", "single,glhf", "--model", "mock", "--time-limit", "120", "--seed", "4", "--follow")
    assert.equal(out.status, 0, out.stdout + out.stderr)
    const [, a, b] = /started (\S+), (\S+) /.exec(out.stdout) ?? []
    assert.match(a, /-single$/); assert.match(b, /-glhf$/)
    assert.match(out.stdout, new RegExp(`${b} starts when ${a} has ended`))
    const order = readFileSync(join(dir, "stub.log"), "utf8").trim().split("\n").map((l) => l.split(" ").slice(0, 2).join(" "))
    assert.deepEqual(order, ["start single", "end single", "start glhf", "end glhf"])
    const record = (id: string) => JSON.parse(readFileSync(join(dir, id, "record.json"), "utf8")).run as GlhfRun
    assert.equal(record(b).after, a)
    assert.equal(record(b).phase, "done")
    assert.equal(pairKey(record(a)), pairKey(record(b)))
    assert.equal(record(b).settings?.seed, 4)

    const both = cli("run", "--solvers", "glhf,single", "--solver", "glhf", "--model", "mock")
    assert.equal(both.status, 1); assert.match(both.stderr, /--solver or --solvers, not both/)
    const bad = cli("run", "--solvers", "glhf,glhf", "--model", "mock")
    assert.equal(bad.status, 1); assert.match(bad.stderr, /solvers must be/)
    const unpaid = cli("run", "--solvers", "glhf,single", "--model", "anthropic/claude-sonnet-5-5")
    assert.equal(unpaid.status, 1); assert.match(unpaid.stderr, /maxTokens is required/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("status gives the limits from types.ts, the models to offer, and keys as true or false only", async () => {
  const { status, body } = await call("GET", "/api/glhf/status")
  assert.equal(status, 200)
  assert.deepEqual(body.limits, { timeLimit: [60, 86_400], maxTokens: [1_000, 500_000_000], reviewRounds: [1, 10], maxMessagesPerRole: [2, 5_000], seed: [1, 2 ** 31 - 1] })
  assert.deepEqual(body.limits, JSON.parse(JSON.stringify(LIMITS)), "the same object checkRequest enforces")
  assert.equal(body.keys.EXA_API_KEY, false)
  for (const [name, value] of Object.entries(body.keys)) assert.equal(typeof value, "boolean", name)
  assert.equal(body.models[0], "mock")
  assert.deepEqual(body.models, modelsFor())
  assert.deepEqual(modelsFor({ NO_PAID_CALLS: "0" }), ["mock"])
  assert.deepEqual(modelsFor({ NO_PAID_CALLS: "0", ANTHROPIC_API_KEY: "k" }), ["mock", "anthropic/claude-sonnet-5-5", "anthropic/claude-haiku-5-5"])
  assert.deepEqual(modelsFor({ NO_PAID_CALLS: "0", OPENAI_API_KEY: "k" }), ["mock", "openai/gpt-5.5"])
  assert.equal(modelsFor({ NO_PAID_CALLS: "0", ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k" }).length, 4)
  // The limits are what is enforced: one past each end is refused, each end is accepted.
  const base = { mode: "local", solver: "glhf", model: "mock" } as const
  for (const field of ["timeLimit", "maxTokens", "reviewRounds", "maxMessagesPerRole", "seed"] as const) {
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
  assert.equal(field({ ...base, model: "anthropic/claude-sonnet-5-5" }), "maxTokens")
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
  assert.equal(real.status, 403, "a caller with neither the dashboard's Origin nor the token starts nothing")
  assert.deepEqual((await start({ solver: "glhf", task: 5 })).body, { error: "task must be a short text" }, "no field key when there is none")
  assert.equal((await call("GET", "/api/glhf/runs")).body.filter((r: GlhfRun) => r.detail === "refused").length, 0)
})

// ---------------------------------------------------------------- run control: what an independent review found

const USAGE = { "mockllm/model": { input_tokens: 120, output_tokens: 30, total_tokens: 150 } }
const STUB_VARS = ["GLHF_STUB_IGNORE", "GLHF_STUB_ON_INT", "GLHF_STUB_CHILD", "GLHF_STUB_LINGER_MS"]
/** Start with the control stub (fixtures/control-stub.mjs). `vars` are its GLHF_STUB_* settings for this run. */
const startControl = async (body: object, vars: Record<string, string> = {}, ms = 60_000) => {
  for (const key of STUB_VARS) delete process.env[key]
  Object.assign(process.env, vars, { GLHF_LOCAL_CMD: CONTROL })
  try { return await start(body, ms) } finally { process.env.GLHF_LOCAL_CMD = PLAIN }
}
/** The control stub is launched by the run's task, a moment after the request: wait for it with its settings in place. */
const going = async (id: string) => {
  await until(`${id} to be going`, () => run(id).phase === "running" && existsSync(join(runs, id, "child.pid")) || existsSync(join(runs, id, "run.json")) && process.env.GLHF_STUB_CHILD === "none")
  for (const key of STUB_VARS) delete process.env[key]
}
const pidIn = (id: string, file: string) => Number(pidOf(id, file).split(" ")[0])
const exists = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
/** Is any process of the group left? */
const groupLeft = (pgid: number) => { try { process.kill(-pgid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH" } }
const cancel = (id: string) => call("POST", `/api/glhf/runs/${id}/cancel`, undefined, DASH, sessionToken())
const trackerLogOf = (id: string) => readFileSync(join(runs, id, "tracker.log"), "utf8")
const STOPPED = /^cancelled; the runner was stopped and no process of its group is left; /
/** A process in its own group that has nothing to do with any run. */
const bystander = () => {
  const child = spawn("sleep", ["120"], { detached: true, stdio: "ignore" })
  child.unref()
  return child.pid!
}
const record = (id: string, extra: Partial<GlhfRun> = {}, request: object = {}) => {
  mkdirSync(join(runs, id), { recursive: true })
  saveStored({ request: { mode: "local", solver: "glhf", model: "mock", ...request } as never, run: { id, mode: "local", task: "demo", solver: "glhf", model: "mock", roleModels: {}, phase: "queued", startedAt: Date.now(), ...extra } })
}

test("H1: cancel does not say stopped while a process of the runner's group is alive; it kills what ignores SIGINT and SIGTERM", async (t) => {
  await t.test("the runner itself ignores them: SIGINT first, then SIGTERM, then SIGKILL", async () => {
    const sent = await startControl({ solver: "glhf" }, { GLHF_STUB_IGNORE: "SIGINT,SIGTERM" })
    const id = sent.body.id as string
    await going(id)
    const runner = pidIn(id, "runner.pid"), child = pidIn(id, "child.pid")
    const began = Date.now()
    const done = await cancel(id)
    assert.equal(done.body.phase, "cancelled")
    assert.match(done.body.detail, STOPPED)
    assert.ok(!groupLeft(runner), "no process of the runner's group is left when the cancel answers")
    assert.ok(!exists(child))
    assert.deepEqual(readFileSync(join(runs, id, "signals.log"), "utf8").trim().split("\n"), ["SIGINT", "SIGTERM"], "the gentle signal first: the real runner removes its sandbox on SIGINT")
    assert.ok(Date.now() - began >= 600, "each signal got its grace time before the next")
    assert.ok(!existsSync(join(runs, id, "runner.stuck")))
  })
  await t.test("the wrapping shell and the runner die at once, a child of the runner ignores them", async () => {
    const sent = await startControl({ solver: "glhf" }, { GLHF_STUB_CHILD: "ignore" })
    assert.equal(sent.status, 201, "the machine was free: the run before is really gone")
    const id = sent.body.id as string
    await going(id)
    const runner = pidIn(id, "runner.pid"), child = pidIn(id, "child.pid")
    const done = await cancel(id)
    assert.match(done.body.detail, STOPPED)
    assert.ok(!exists(child), "the child that ignored SIGTERM is gone too: the group was killed, not only its leader")
    assert.ok(!groupLeft(runner))
    const next = await start({ solver: "single" }, 50)
    assert.equal(next.status, 201)
    await until("it to finish", () => isSettled(next.body.id))
  })
  await t.test("a group that SIGKILL does not empty is reported as stuck, and the machine stays busy until it is gone", async () => {
    const pid = bystander(), id = "stuck-run", dir = join(runs, id)
    record(id, { phase: "cancelled", finishedAt: Date.now() })
    writeFileSync(join(dir, "runner.pid"), String(pid))
    const signals: string[] = []
    const result = await stopAndWait(dir, "runner", { intMs: 30, termMs: 30, killMs: 30, kill: (_pid, signal) => void signals.push(String(signal)) })
    assert.equal(result, "stuck", "never stopped while the group has a member")
    assert.deepEqual(signals, ["SIGINT", "SIGTERM", "SIGKILL"])
    assert.ok(existsSync(join(dir, "runner.stuck")))
    assert.match(cancelDetail({ runner: "stuck", sandbox: { found: 0, left: [] } }), /^cancelled, but the runner could not be stopped: .*still there after SIGKILL.*busy/)
    const refused = await start({ solver: "glhf" }, 50)
    assert.equal(refused.status, 409, "a runner that could not be stopped keeps the machine")
    assert.equal(refused.body.run, id)
    assert.equal(await stopAndWait(dir, "runner"), "stopped") // for real this time
    assert.ok(!exists(pid) && !existsSync(join(dir, "runner.stuck")))
    const next = await start({ solver: "glhf" }, 50)
    assert.equal(next.status, 201)
    await until("it to finish", () => isSettled(next.body.id))
  })
  await t.test("a pid that now belongs to another program is not signalled (the start time is checked before the kill)", async () => {
    const pid = bystander(), id = "reused-pid-run"
    record(id, { phase: "running" })
    writeFileSync(join(runs, id, "runner.pid"), `${pid} ps:Thu Jan  1 00:00:00 1970`)
    const done = await cancel(id)
    assert.equal(done.body.phase, "cancelled")
    assert.match(done.body.detail, /^cancelled; no runner was running/)
    await sleep(100)
    assert.ok(exists(pid), "the other program is still running")
    process.kill(-pid, "SIGKILL")
  })
})

test("H1: at the deadline the runner's whole group is stopped too, with SIGKILL when it has to be; a cancel during that stop wins", async () => {
  process.env.GLHF_LOCAL_MARGIN_MS = String(600 - 60_000) // the deadline of a run with a 60 s limit is 0.6 s after its start
  try {
    const sent = await startControl({ solver: "glhf", timeLimit: 60 }, { GLHF_STUB_IGNORE: "SIGINT,SIGTERM", GLHF_STUB_CHILD: "ignore" })
    const id = sent.body.id as string
    await going(id)
    const runner = pidIn(id, "runner.pid")
    await until("the run to fail at its deadline", () => isSettled(id))
    assert.equal(run(id).phase, "failed")
    assert.match(run(id).error ?? "", /far past its 60 s limit; it was stopped$/)
    assert.ok(!groupLeft(runner), "\"it was stopped\" is said only when no process of the group is left")

    // The same, and a cancel arrives while the deadline's stop is waiting for the runner to go.
    process.env.GLHF_CANCEL_INT_MS = "800"
    const again = await startControl({ solver: "glhf", timeLimit: 60 }, { GLHF_STUB_IGNORE: "SIGINT,SIGTERM" })
    const late = again.body.id as string
    await until("the deadline's SIGINT", () => existsSync(join(runs, late, "signals.log")))
    const done = await cancel(late)
    assert.equal(done.body.phase, "cancelled")
    assert.ok(!groupLeft(pidIn(late, "runner.pid")))
    await sleep(200)
    assert.equal(run(late).phase, "cancelled")
    assert.equal(run(late).error, undefined)
    assert.doesNotMatch(trackerLogOf(late), /finished: /, "the phase that was stopping the runner did not settle the run as failed after the cancel")
  } finally { delete process.env.GLHF_LOCAL_MARGIN_MS; process.env.GLHF_CANCEL_INT_MS = "300" }
})

test("M1: cancel removes the sandbox containers of the run, and says only what it checked", async () => {
  const sent = await start({ solver: "glhf" }, 60_000)
  const id = sent.body.id as string
  await until("the run to be going", () => run(id).phase === "running")
  const dir = join(runs, id)
  // Docker reports real paths (/private/var/... on a Mac), the tracker knows the folder by the name it was given.
  const mine = { id: "c".repeat(64), name: "inspect-bixbench3_ca-iabc-default-1", project: "inspect-bixbench3_ca-iabc", mounts: ["/somewhere/data", `${realpathSync(dir)}/outputs`, `${realpathSync(dir)}/workspace`] }
  const other = { id: "d".repeat(64), name: "inspect-bixbench3_ca-ixyz-default-1", project: "inspect-bixbench3_ca-ixyz", mounts: [`${realpathSync(dir)}-2/workspace`, "/elsewhere/outputs"] }
  writeFileSync(dockerState, JSON.stringify([mine, other]))
  rmSync(dockerLog, { force: true })
  const done = await cancel(id)
  assert.equal(done.body.detail, "cancelled; the runner was stopped and no process of its group is left; 1 sandbox container removed")
  assert.deepEqual(JSON.parse(readFileSync(dockerState, "utf8")), [other], "only the container that mounts this run's folder; another run's sandbox is left alone")
  const calls = readFileSync(dockerLog, "utf8").trim().split("\n")
  assert.deepEqual(calls.filter((c) => c.startsWith("rm ")), [`rm -f -v ${mine.id}`])
  assert.ok(calls.indexOf(`rm -f -v ${mine.id}`) < calls.lastIndexOf("ps -aq --no-trunc"), "it looked again after the removal")

  // Nothing found, something that cannot be removed, and no Docker to ask: each says what it is.
  writeFileSync(dockerState, JSON.stringify([other]))
  assert.deepEqual(await removeSandbox(dir), { found: 0, left: [] })
  assert.equal(sandboxNote({ found: 0, left: [] }), "Docker shows no sandbox container of this run")
  writeFileSync(dockerState, JSON.stringify([{ ...mine, sticky: true }, other]))
  const left = await removeSandbox(dir)
  assert.deepEqual(left, { found: 1, left: [mine.name] })
  assert.match(sandboxNote(left), /^1 of 1 sandbox container could not be removed \(inspect-bixbench3_ca-iabc-default-1\)/)
  process.env.GLHF_DOCKER_STUB_FAIL = "1"
  try {
    assert.equal(await removeSandbox(dir), undefined)
    assert.match(sandboxNote(undefined), /were not checked \(Docker did not answer\)/)
    const blind = await start({ solver: "glhf" }, 60_000)
    await until("the run to be going", () => run(blind.body.id).phase === "running")
    const said = (await cancel(blind.body.id)).body.detail as string
    assert.match(said, /^cancelled; the runner was stopped .*; its sandbox containers were not checked/, "no claim about containers without Docker's answer")
    assert.doesNotMatch(said, /removed|shows no/)
  } finally { delete process.env.GLHF_DOCKER_STUB_FAIL; rmSync(dockerState, { force: true }) }
  // A run that was cancelled before its runner started has no sandbox to speak of.
  const pair = await start({ solvers: ["glhf", "single"] }, 60_000)
  assert.equal((await cancel(pair.body.ids[1])).body.detail, "cancelled before the runner started")
  await cancel(pair.body.ids[0])
})

test("M2: a run whose runner has written its result is not recorded as cancelled, and a cancelled run keeps the usage its runner reported", async () => {
  // The result is in run.json, the tracker has not looked yet (slow polling), and two cancels arrive at once.
  process.env.GLHF_LOCAL_POLL_MS = "700"
  try {
    for (const linger of ["0", "2000"]) { // the runner is gone already, or still on its way out
      const sent = await startControl({ solver: "glhf" }, { GLHF_STUB_LINGER_MS: linger, GLHF_STUB_CHILD: "none" }, 150)
      const id = sent.body.id as string
      await until("the runner's result", () => /"done"/.test(existsSync(join(runs, id, "run.json")) ? readFileSync(join(runs, id, "run.json"), "utf8") : ""))
      assert.notEqual(run(id).phase, "done", "the tracker has not read it yet")
      const [one, two] = await Promise.all([cancel(id), cancel(id)])
      for (const answer of [one, two]) {
        assert.equal(answer.status, 200)
        assert.equal(answer.body.phase, "done", `a finished run stays a result (linger ${linger})`)
        assert.equal(answer.body.score, 1)
        assert.deepEqual(answer.body.usage, USAGE)
      }
      assert.equal(run(id).phase, "done")
      assert.doesNotMatch(trackerLogOf(id), /cancel/)
      assert.ok(!groupLeft(pidIn(id, "runner.pid")), "and a runner that lingered after its result is not left running")
    }
  } finally { process.env.GLHF_LOCAL_POLL_MS = "40" }

  // Cancelled mid-run: the runner reports on SIGINT what it had used, and the cancelled record keeps it.
  const sent = await startControl({ solver: "glhf" }, { GLHF_STUB_ON_INT: "result" })
  const id = sent.body.id as string
  await going(id)
  const done = await cancel(id)
  assert.equal(done.body.phase, "cancelled", "the runner wrote \"failed\" because it was interrupted; the run is cancelled all the same")
  assert.deepEqual(done.body.usage, USAGE)
  assert.deepEqual(run(id).usage, USAGE)
  assert.equal(done.body.score, undefined)
  assert.equal(done.body.error, undefined)
})

test("M3, L3: a first run whose record cannot be read still holds its partner back, keeps the machine, and can be cancelled", async () => {
  const sent = await start({ solvers: ["glhf", "single"] }, 60_000)
  const [first, second] = sent.body.ids as string[]
  await until("the first run to be going", () => run(first).phase === "running")
  await sleep(100)

  // L3: while nothing changes, the polls of the waiting partner (and of the watcher) do not rewrite the records.
  const inode = (id: string) => statSync(join(runs, id, "record.json")).ino
  const before = [inode(first), inode(second)]
  await sleep(300) // seven polls each
  assert.deepEqual([inode(first), inode(second)], before, "record.json was not written again")
  assert.equal(run(second).phase, "queued")

  writeFileSync(join(runs, first, "record.json"), "{ not json") // a torn or damaged record
  assert.equal(loadStored(first), undefined)
  const runner = pidIn(first, "runner.pid")
  await sleep(300)
  assert.ok(exists(runner))
  assert.ok(!existsSync(join(runs, second, "runner.pid")), "the partner is not launched on top of a runner that is alive")
  assert.equal(run(second).phase, "queued")
  assert.deepEqual(predecessor(first), { settled: false })

  rmSync(join(runs, first, "record.json")) // a deleted record is the same
  await sleep(200)
  assert.ok(!existsSync(join(runs, second, "runner.pid")))
  await cancel(second)
  const refused = await start({ solver: "glhf" }, 50)
  assert.equal(refused.status, 409, "the machine is not free while that runner is alive")
  assert.equal(refused.body.run, first)

  const again = await start({ solver: "single" }, 50) // still refused, so nothing is queued behind it
  assert.equal(again.status, 409)
  const done = await cancel(first)
  assert.equal(done.status, 200, "not 404: the pid file in the run folder is enough to stop it")
  assert.equal(done.body.id, first)
  assert.equal(done.body.phase, "cancelled")
  assert.match(done.body.detail, /^cancelled; the runner was stopped and no process of its group is left; .*record \(record\.json\) could not be read/)
  assert.ok(!groupLeft(runner))
  assert.equal(predecessor(first).settled, true, "with its runner gone it no longer holds anything back")
  assert.equal((await cancel("never-existed")).status, 404)
  mkdirSync(join(runs, "empty-folder"))
  assert.equal((await cancel("empty-folder")).status, 404, "a folder without a record and without a runner is not a run")
  const next = await start({ solver: "single" }, 50)
  assert.equal(next.status, 201)
  await until("it to finish", () => isSettled(next.body.id))
})

test("M3: cancelling a run whose record cannot be read cancels the partner queued behind it", async () => {
  const sent = await start({ solvers: ["glhf", "single"] }, 60_000)
  const [first, second] = sent.body.ids as string[]
  await until("the first run to be going", () => run(first).phase === "running")
  writeFileSync(join(runs, first, "record.json"), "")
  assert.equal((await cancel(first)).status, 200)
  assert.equal(run(second).phase, "cancelled")
  assert.equal(run(second).note, `cancelled because ${first}, the run it was queued behind, was cancelled`)
  await sleep(200)
  assert.ok(!existsSync(join(runs, second, "runner.pid")))
})

test("L1: starting and cancelling need the dashboard's Origin or the token, also for the scripted model", async () => {
  const demo = { mode: "local", solver: "glhf", model: "mock" }
  process.env.GLHF_STUB_MS = "60000"
  const open = await call("POST", "/api/glhf/runs", demo, null)
  assert.equal(open.status, 403)
  assert.match(open.body.error, /needs the dashboard's Origin or this machine's token/)
  assert.equal((await call("POST", "/api/glhf/runs", demo, null, "0".repeat(48))).status, 403, "a wrong token is no token")
  assert.ok(listRunsDone(), "nothing was started")

  const sent = await call("POST", "/api/glhf/runs", demo, null, sessionToken())
  assert.equal(sent.status, 201, "the CLI: no Origin, the token")
  const id = sent.body.id as string
  await until("the run to be going", () => run(id).phase === "running")
  const refused = await call("POST", `/api/glhf/runs/${id}/cancel`, undefined, null)
  assert.equal(refused.status, 403)
  assert.equal(run(id).phase, "running", "an unknown caller stops nothing")
  assert.ok(alive(pidOf(id, "runner.pid")))
  assert.equal((await call("POST", "/api/glhf/runs/no-such-run/cancel", undefined, null)).status, 403, "and learns nothing about which runs exist")
  assert.equal((await call("POST", `/api/glhf/runs/${id}/cancel`, undefined, null, sessionToken())).body.phase, "cancelled")
  assert.equal((await call("GET", "/api/glhf/runs", undefined, null)).status, 200, "reading stays open to local callers")
})

test("L2: a runner whose pid the engine never recorded is found through the pid its own shell wrote, watched, and stopped", async () => {
  const sent = await start({ solver: "glhf" }, 100)
  await until("it to finish", () => isSettled(sent.body.id))
  assert.equal(pidOf(sent.body.id, "runner.self").trim(), String(pidIn(sent.body.id, "runner.pid")), "every runner writes its own pid before it starts the command")

  const id = "pid-never-recorded", dir = join(runs, id)
  await stopTracker()
  record(id, { startedAt: Date.now() })
  process.env.GLHF_STUB_MS = "60000"
  assert.equal(startOnce(dir, "runner", [...CONTROL.split(" "), "--solver", "glhf", "--out", dir], join(dir, "runner.log"), null), true)
  writeFileSync(join(dir, "runner.pid"), "") // the engine died after the spawn, before it wrote the pid
  await until("the runner to be up", () => existsSync(join(dir, "child.pid")))
  const runner = pidIn(id, "runner.self")
  await startTracker() // the record has no task yet: it gets one, and the launch finds that the runner was started
  await sleep(500) // far more than the five polls after which an unrecorded pid counts as gone
  assert.equal(run(id).phase, "running", "not failed as \"stopped without finishing\" while its runner works on")
  assert.equal(pidIn(id, "runner.pid"), runner, "the pid file now names the runner")
  assert.ok(alive(pidOf(id, "runner.pid")), "with its start time, so it is a full stamp")
  assert.match(trackerLogOf(id), /already started; not starting again/)
  assert.equal((await start({ solver: "single" }, 50)).status, 409, "the machine is still taken")
  assert.match((await cancel(id)).body.detail, STOPPED)
  assert.ok(!groupLeft(runner))
})

test("L4: the token file is created with mode 600, never widened and never written in place", async () => {
  await stopTracker()
  writeFileSync(TOKEN_FILE, "left by an earlier engine")
  chmodSync(TOKEN_FILE, 0o644)
  const old = statSync(TOKEN_FILE)
  await startTracker()
  const now = statSync(TOKEN_FILE)
  assert.equal(now.mode & 0o777, 0o600)
  assert.notEqual(now.ino, old.ino, "a new file moved into place: the token was never in the file others could read")
  assert.equal(readFileSync(TOKEN_FILE, "utf8"), sessionToken())
  assert.deepEqual(readdirSync(runs).filter((name) => name.startsWith(".token.")), [], "no temporary file is left")
})

test("L6: what reaches the cloud runner's command line cannot start with a dash", () => {
  const cloud = { mode: "cloud", solver: "glhf", model: "openai/gpt-5.5", task: "9", effort: "high", project: "my-project", ...BILL } as const
  const ok = checkRequest({ ...cloud, resultsBucket: "gs://my-bucket/results/run_1" }, true)
  assert.deepEqual([ok.task, ok.effort, ok.project, ok.resultsBucket], ["9", "high", "my-project", "gs://my-bucket/results/run_1"])
  assert.equal(checkRequest({ ...cloud, task: "bix-12.v2", project: "example.com:proj", resultsBucket: "bucket" }, true).project, "example.com:proj")
  for (const [key, value] of [["task", "--help"], ["task", "-x"], ["task", "a b"], ["effort", "--results-bucket=gs://x"], ["effort", "-h"], ["effort", "high low"],
    ["project", "--project"], ["project", "p;rm"], ["project", 5], ["resultsBucket", "--effort"], ["resultsBucket", "gs://--x"], ["resultsBucket", "gs://b/$(id)"], ["resultsBucket", ["a"]]] as const) {
    assert.throws(() => checkRequest({ ...cloud, [key]: value } as never, true), BadRequest, `${key}: ${JSON.stringify(value)}`)
  }
  assert.throws(() => checkRequest({ mode: "local", solver: "glhf", model: "mock", task: "--case" }, true), BadRequest, "a local task label too")
})

test("a caller cannot queue a run behind another: `after` in a request is dropped", async () => {
  const base = { mode: "local", solver: "glhf", model: "mock" } as const
  assert.equal(checkRequest({ ...base, after: "some-run" } as never, true).after, undefined)
  assert.equal(checkStart({ mode: "local", model: "mock", solvers: ["glhf", "single"], after: "some-run" } as never, true).some((r) => "after" in r), false)
  const sent = await start({ solver: "glhf", after: "no-such-run" }, 100)
  assert.equal(sent.status, 201)
  const stored = loadStored(sent.body.id)!
  assert.equal(stored.request.after, undefined)
  assert.equal(stored.run.after, undefined)
  await until("it to finish", () => isSettled(sent.body.id))
  assert.equal(run(sent.body.id).phase, "done")
  assert.equal(run(sent.body.id).note, undefined, "it waited for nothing")
})

test("after a restart a record without a task gets one, and a run that was already launched does not go back into the queue", async () => {
  await stopTracker()
  process.env.GLHF_STUB_MS = "100"; process.env.GLHF_STUB_FAIL = ""
  record("no-task-yet") // the engine died between writing the record and creating its task
  // A partner whose runner was started (runner.pid is there) when the engine died, before the task recorded that.
  record("was-first", { phase: "done", finishedAt: 5_000 })
  record("was-launched", { after: "was-first", startedAt: 9_000 }, { after: "was-first" })
  writeFileSync(join(runs, "was-launched", "runner.pid"), "")
  writeFileSync(join(runs, "was-launched", "run.json"), JSON.stringify({ status: "done", score: 1 }))
  await startTracker()
  await until("both to finish", () => isSettled("no-task-yet") && isSettled("was-launched"))
  assert.equal(run("no-task-yet").phase, "done")
  assert.equal(typeof loadStored("no-task-yet")!.taskId, "number")
  assert.equal(run("was-launched").phase, "done")
  assert.equal(run("was-launched").startedAt, 9_000, "its clock was not started a second time")
  assert.doesNotMatch(trackerLogOf("was-launched"), /is settled; starting/)
  assert.match(trackerLogOf("was-launched"), /already started; not starting again/)
})

test("a cancel that was recorded but never carried out (the engine died) is carried out after the restart", async () => {
  const sent = await start({ solver: "glhf" }, 60_000)
  const id = sent.body.id as string
  await until("the run to be going", () => run(id).phase === "running" && existsSync(join(runs, id, "child.pid")))
  const runner = pidIn(id, "runner.pid")
  await stopTracker()
  patchRun(id, { phase: "cancelled", detail: "cancelled; stopping the runner", finishedAt: Date.now() })
  assert.ok(groupLeft(runner))
  await startTracker()
  await until("the watcher to stop the runner of the cancelled run", () => !groupLeft(runner), 5_000)
  await until("the record to say so", () => STOPPED.test(run(id).detail ?? ""))
  assert.equal(run(id).phase, "cancelled")
})

test("cancel ends the tracking task at once, not at its next poll", async () => {
  process.env.GLHF_LOCAL_POLL_MS = "60000"
  try {
    const sent = await start({ solver: "glhf" }, 60_000)
    const id = sent.body.id as string
    await until("the runner to be launched", () => existsSync(join(runs, id, "runner.pid")) && alive(pidOf(id, "runner.pid")))
    await sleep(150) // its watcher has looked once and now sleeps for a minute
    assert.equal((await cancel(id)).body.phase, "cancelled")
    assert.match(trackerLogOf(id), /tracking ended: the run was cancelled/)
  } finally { process.env.GLHF_LOCAL_POLL_MS = "40" }
})

test("one local run at a time is about local runs: a cloud run starts while a local run is going", async () => {
  const local = await start({ solver: "glhf" }, 60_000)
  await until("the local run to be going", () => run(local.body.id).phase === "running")
  // `bixbench3` is a stub that fails at once (GLHF_BIXBENCH3_CMD): nothing is provisioned.
  const cloud = await call("POST", "/api/glhf/runs", { mode: "cloud", solver: "glhf", model: "stub/model", task: "9", effort: "high", project: "stub-project", ...BILL }, null, sessionToken())
  assert.equal(cloud.status, 201, JSON.stringify(cloud.body))
  assert.equal((await start({ solver: "single" }, 50)).status, 409, "a local one is still refused")
  await until("the cloud launch to fail", () => isSettled(cloud.body.id))
  assert.match(run(cloud.body.id).error ?? "", /^bixbench3 run exited with status 3\nbixbench3 stub: refusing to launch/)
  assert.equal(run(local.body.id).phase, "running")
  await cancel(local.body.id)
})

// ---------------------------------------------------------------- security review: M4, M2, M7, the daily cap

test("M4: a symlink the sandbox leaves in a run's outputs is not followed, so GET /api/glhf/runs/:id cannot return a file from outside the run folder", async () => {
  const sent = await start({ solver: "glhf" }, 50)
  const id = sent.body.id as string
  await until("it to finish", () => isSettled(id))
  const dir = join(runs, id), outside = mkdtempSync(join(tmpdir(), "glhf-outside-"))
  try {
    const secret = join(outside, "secret.env")
    writeFileSync(secret, '{"events": [], "KEY": "sk-not-for-the-dashboard"}')
    writeFileSync(join(outside, "ledger.json"), '{"KEY": "sk-through-a-folder"}')
    const put = (make: () => void) => { rmSync(join(dir, "outputs"), { recursive: true, force: true }); mkdirSync(join(dir, "outputs", "glhf"), { recursive: true }); make() }
    const served = async () => { const got = await call("GET", `/api/glhf/runs/${id}`); assert.equal(got.status, 200); return got }
    const nothing = async (what: string) => {
      const got = await served()
      assert.deepEqual([got.body.ledger, got.body.findings, got.body.methods], [null, null, null], what)
      assert.doesNotMatch(JSON.stringify(got.body), /sk-/, what)
    }

    put(() => { writeFileSync(runFile(id, "ledger"), '{"events": [1]}'); writeFileSync(runFile(id, "findings"), "found"); writeFileSync(runFile(id, "methods"), "how") })
    const plain = await served()
    assert.deepEqual([plain.body.ledger, plain.body.findings, plain.body.methods], [{ events: [1] }, "found", "how"], "regular files are served as before")

    put(() => { for (const name of ["ledger", "findings", "methods"] as const) symlinkSync(secret, runFile(id, name)) })
    await nothing("a symlink to a file outside the run folder")
    put(() => { symlinkSync(join(dir, "record.json"), runFile(id, "findings")) })
    await nothing("a symlink is refused also when it points inside the run folder")
    put(() => { rmSync(join(dir, "outputs", "glhf"), { recursive: true }); symlinkSync(outside, join(dir, "outputs", "glhf")) })
    await nothing("a symlinked folder on the way: the real path leaves the run folder")
    rmSync(join(dir, "outputs"), { recursive: true }); symlinkSync(outside, join(dir, "outputs"))
    writeFileSync(join(outside, "METHODS.md"), "sk-methods")
    await nothing("outputs itself replaced by a symlink")
    put(() => { mkdirSync(runFile(id, "ledger")); spawnSync("mkfifo", [runFile(id, "findings")]) })
    await nothing("a folder, and a pipe that would block the engine for good")

    // The readers themselves, for every other file of a run folder (run.json, the logs, the pid files).
    rmSync(join(dir, "run.json"), { force: true }); symlinkSync(secret, join(dir, "run.json"))
    rmSync(join(dir, "runner.log"), { force: true }); symlinkSync(secret, join(dir, "runner.log"))
    assert.equal(readText(join(dir, "run.json")), null)
    assert.equal(readJson(join(dir, "run.json")), undefined)
    assert.equal(tail(join(dir, "runner.log")), "", "error messages quote the log: not through a symlink either")
    assert.equal(readText(secret), '{"events": [], "KEY": "sk-not-for-the-dashboard"}', "outside glhf/runs a regular file is read")
    symlinkSync(secret, join(outside, "link"))
    assert.equal(readText(join(outside, "link")), null, "and a symlink is not, wherever it is")

    // Size: no more than the cap is read; of a long log, its end.
    put(() => { writeFileSync(runFile(id, "findings"), "x".repeat(5_000)); writeFileSync(runFile(id, "methods"), "short") })
    process.env.GLHF_MAX_READ_BYTES = "4096"
    const capped = await served()
    assert.deepEqual([capped.body.findings, capped.body.methods], [null, "short"], "a file over the cap counts as unreadable")
    delete process.env.GLHF_MAX_READ_BYTES
    rmSync(join(dir, "runner.log")); writeFileSync(join(dir, "runner.log"), `${"line\n".repeat(100_000)}the end`)
    assert.equal(tail(join(dir, "runner.log"), 2), "line\nthe end")
    assert.equal(RUN_FILES.ledger, "outputs/glhf/ledger.json", "the one place the ledger's path is named")
  } finally { delete process.env.GLHF_MAX_READ_BYTES; rmSync(outside, { recursive: true, force: true }) }
})

test("M2: a cloud start needs an explicit acknowledgement of the bill (billCloud: true and maxHours within the cap), also with the token", async () => {
  const cloud = { mode: "cloud", solver: "glhf", model: "openai/gpt-5.5", task: "9", effort: "high", project: "p" } as const
  const refused = (body: object) => { try { checkRequest(body as never, true); return "accepted" } catch (e: any) { assert.ok(e instanceof BadRequest, String(e)); return e.field } }
  assert.equal(refused(cloud), "billCloud")
  for (const no of [false, "true", 1, "yes", null]) assert.equal(refused({ ...cloud, billCloud: no, maxHours: 2 }), "billCloud", `billCloud: ${JSON.stringify(no)}`)
  assert.equal(refused({ ...cloud, billCloud: true }), "maxHours")
  for (const no of [0, -1, 1.5, "soon", cloudMaxHours() + 1, 1e9]) assert.equal(refused({ ...cloud, billCloud: true, maxHours: no }), "maxHours", `maxHours: ${JSON.stringify(no)}`)
  assert.equal((checkRequest({ ...cloud, billCloud: true, maxHours: cloudMaxHours() } as never, true) as any).maxHours, cloudMaxHours(), "stored with the request, so the task knows it")
  assert.equal(cloudMaxHours(), 24)
  process.env.GLHF_CLOUD_MAX_HOURS = "3"
  try { assert.equal(refused({ ...cloud, billCloud: true, maxHours: 4 }), "maxHours"); assert.equal(refused({ ...cloud, billCloud: true, maxHours: 3 }), "accepted") } finally { delete process.env.GLHF_CLOUD_MAX_HOURS }
  assert.equal(refused({ ...cloud, ...BILL }, ), "accepted")
  assert.equal((checkRequest({ mode: "local", solver: "glhf", model: "mock", billCloud: true, maxHours: 5 } as never, true) as any).maxHours, undefined, "a local run takes no such field")
  // Who may not start a cloud run at all is told that first: the acknowledgement does not replace the token.
  assert.throws(() => checkRequest({ ...cloud, ...BILL } as never, { token: false, origin: true }), (e: any) => e instanceof BadRequest && e.field === "mode")

  // Over HTTP, with the token the CLI reads by itself: 400 and the field; nothing is launched.
  const before = stubLines().length
  const sent = await call("POST", "/api/glhf/runs", { ...cloud, model: "stub/model" }, null, sessionToken())
  assert.equal(sent.status, 400, JSON.stringify(sent.body))
  assert.equal(sent.body.field, "billCloud")
  assert.match(sent.body.error, /creates a VM that bills until it is removed.*billCloud: true and maxHours \(1 to 24\).*--yes-bill-cloud --max-hours N/)
  const half = await call("POST", "/api/glhf/runs", { ...cloud, model: "stub/model", billCloud: true, maxHours: 500 }, null, sessionToken())
  assert.deepEqual([half.status, half.body.field], [400, "maxHours"])
  assert.equal(stubLines().length, before)
  assert.ok(listRunsDone(), "no run was created")
})

test("M7: the refusal that asks for maxTokens says what it is: the budget the run plans by, with the hard stop a multiple of it", () => {
  const tasks = readFileSync(join(here, "../../glhf/bixbench/src/bixbench3/inspect_harness/tasks.py"), "utf8")
  assert.equal(Number(tasks.match(/^TOKEN_BACKSTOP = ([\d.]+)/m)?.[1]), HARD_STOP, "HARD_STOP in tracker.ts mirrors TOKEN_BACKSTOP of the harness")
  assert.match(tasks, /token_limit=(?:int|round)\(max_tokens \* TOKEN_BACKSTOP\) if max_tokens else None/, "and that is the limit the harness sets")
  assert.ok(HARD_STOP > 1)
  assert.throws(() => checkRequest({ mode: "local", solver: "glhf", model: "anthropic/claude-sonnet-5-5" }, true), (e: any) => {
    assert.equal(e.field, "maxTokens")
    assert.ok(e.message.includes(`It is not a hard limit: the run is cut off only once ${HARD_STOP} x maxTokens is passed (checked after each model call), so count on that much being spent`), e.message)
    assert.doesNotMatch(e.message, /the limit on what the run can spend/)
    return true
  })
  assert.equal(mostTokens({ mode: "local", model: "a/b", maxTokens: 1_000 }), Math.floor(1_000 * HARD_STOP))
  assert.equal(mostTokens({ mode: "local", model: "mock", maxTokens: 1_000 }), 0, "the scripted model spends nothing")
  assert.equal(mostTokens({ mode: "local", model: "mock", maxTokens: 1_000, roleModels: { critic: "a/b" } }), Math.floor(1_000 * HARD_STOP))
})

test("the daily token cap: today's local runs are summed, running and queued ones at their full budget, and a start past the cap is refused with 429", async () => {
  const most = (maxTokens: number) => mostTokens({ mode: "local", model: "a/b", maxTokens })
  const now = new Date(2026, 5, 10, 15), today = now.getTime() - 3_600_000, yesterday = now.getTime() - 20 * 3_600_000
  const stored = (id: string, startedAt: number, phase: string, maxTokens: number | undefined, used?: number, model = "a/b") =>
    ({ request: { mode: "local", solver: "glhf", model, maxTokens }, run: { id, mode: "local", task: "demo", solver: "glhf", model, roleModels: {}, phase, startedAt, ...(used !== undefined && { usage: { [model]: { input_tokens: used, output_tokens: 0, total_tokens: used } } }) } }) as never
  assert.equal(tokensToday([stored("a", today, "done", 1_000, 700)], now), 700, "settled: what it used")
  assert.equal(tokensToday([stored("a", today, "done", 1_000, 2_600)], now), 2_600, "also when that is more than its budget")
  assert.equal(tokensToday([stored("a", today, "running", 1_000, 300)], now), most(1_000), "running: its hard stop")
  assert.equal(tokensToday([stored("a", today, "queued", 1_000)], now), most(1_000), "queued: its hard stop too")
  assert.equal(tokensToday([stored("a", today, "failed", 1_000)], now), 0, "failed before a runner was started: nothing")
  assert.equal(tokensToday([stored("a", yesterday, "done", 1_000, 700), stored("b", yesterday, "running", 1_000)], now), 0, "started on an earlier day")
  assert.equal(tokensToday([stored("a", today, "running", 1_000, undefined, "mock")], now), 0, "scripted runs count nothing")
  assert.equal(tokensToday([stored("a", today, "done", 1_000, 700), stored("b", today, "running", 5_000), stored("c", today, "queued", 5_000)], now), 700 + 2 * most(5_000))
  assert.equal(dailyTokenCap(), DAILY_TOKENS)
  for (const [value, cap] of [["1000", 1_000], ["0", 0], ["lots", DAILY_TOKENS], ["-5", DAILY_TOKENS]] as const) {
    process.env.GLHF_DAILY_TOKENS = value
    try { assert.equal(dailyTokenCap(), cap, `GLHF_DAILY_TOKENS=${value}: a value that is not a number does not switch the cap off`) } finally { delete process.env.GLHF_DAILY_TOKENS }
  }

  // Over HTTP. The stub stands in for the runner, so "stub/model" costs nothing here.
  await until("earlier runs to end", listRunsDone)
  const base = tokensToday()
  process.env.GLHF_DAILY_TOKENS = String(base + most(20_000) + most(5_000))
  try {
    const first = await start({ solver: "glhf", model: "stub/model", maxTokens: 20_000 }, 60_000)
    assert.equal(first.status, 201, JSON.stringify(first.body))
    assert.equal(tokensToday(), base + most(20_000), "in flight: counted at its hard stop")
    assert.equal((await cancel(first.body.id)).body.phase, "cancelled")
    assert.equal(tokensToday(), base + most(20_000), "cancelled without a usage report: it may have spent its budget")

    const over = await start({ solver: "glhf", model: "stub/model", maxTokens: 6_000 }, 50)
    assert.equal(over.status, 429, JSON.stringify(over.body))
    assert.match(over.body.error, /^the daily token cap would be passed: [\d,]+ of [\d,]+ tokens are counted for today's local runs \(running and queued ones at their hard stop, [\d.]+ x maxTokens\), and this start can use up to ([\d,]+) more\. Lower maxTokens, wait until tomorrow, or raise GLHF_DAILY_TOKENS$/)
    assert.ok(over.body.error.includes(`up to ${most(6_000).toLocaleString("en-US")} more`))
    const pair = await start({ solvers: ["glhf", "single"], model: "stub/model", maxTokens: 3_000 }, 50)
    assert.equal(pair.status, 429, "a pair asks for both budgets, and neither run is created")
    assert.ok(listRunsDone())
    assert.equal(tokensToday(), base + most(20_000), "a refused start reserves nothing")

    const fits = await start({ solver: "glhf", model: "stub/model", maxTokens: 5_000 }, 50)
    assert.equal(fits.status, 201, "exactly up to the cap")
    await until("it to finish", () => isSettled(fits.body.id))
    const demo = await start({ solver: "glhf" }, 50)
    assert.equal(demo.status, 201, "the scripted demo is never refused by the cap")
    await until("it to finish", () => isSettled(demo.body.id))
  } finally { delete process.env.GLHF_DAILY_TOKENS }
})
