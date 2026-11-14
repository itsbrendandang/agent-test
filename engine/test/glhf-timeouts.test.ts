// The run tracker's unhappy endings: a runner or launcher that hangs, exits without a result, writes rubbish, dies,
// or was never recorded, and an engine restart in each of those states. The real tracker (openTracker) works in a
// temporary folder (GLHF_RUNS_DIR) with stub commands from fixtures/timeouts/ (GLHF_LOCAL_CMD, GLHF_BIXBENCH3_CMD)
// and short limits (GLHF_LOCAL_MARGIN_MS, GLHF_LAUNCH_TIMEOUT_MS). No Docker, no cloud, no model, no cost.
//
// Every scenario checks four things: the final phase, the error a person reads, that no process is left running,
// and that a restart neither launches again nor hangs. The last part of the file calls single phases of the task
// with a runtime of its own, to repeat a phase the way a restart does (a crash after an effect, before the commit).
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { after, before, test, type TestContext } from "node:test"
import type { Tracker } from "../src/glhf/tracker.ts"
import type { GlhfRun, RunRequest } from "../src/glhf/types.ts"

const here = dirname(fileURLToPath(import.meta.url))
const base = mkdtempSync(join(tmpdir(), "glhf-timeouts-")) // also the tag that finds every process a stub started
const runs = join(base, "runs")
const manifests = join(base, "manifests")
const stubLog = join(base, "stub.log")
const fixture = (name: string) => `${process.execPath} ${join(here, "fixtures", name)}`
const BIXBENCH3 = `${fixture("timeouts/bixbench3.mjs")} --tag ${base}`
assert.doesNotMatch(base + here + process.execPath, /\s/, "the stub commands are split on spaces")

process.env.GLHF_RUNS_DIR = runs
process.env.GLHF_BIXBENCH3_RUNS = manifests
process.env.GLHF_BIXBENCH3_CMD = BIXBENCH3 // set for the whole file: the real `uv run bixbench3` is never the fallback
process.env.GLHF_LOCAL_CMD = fixture("timeouts/silent.mjs")
process.env.GLHF_STUB_LOG = stubLog
process.env.NO_PAID_CALLS = "1" // the kill switch stays on, except inside cloud() below

// Imported only now: store.ts reads GLHF_RUNS_DIR when it loads.
const { openTracker } = await import("../src/glhf/tracker.ts")
const { loadStored, patchRun, runDir, RUNS, saveStored } = await import("../src/glhf/store.ts")
const { failUntracked, processState, readLocal, RunTask, startOnce } = await import("../src/glhf/task.ts")
const { alive, parseStamp } = await import("../src/glhf/proc.ts")

// After the imports: env.ts fills the keys from .env when it loads. Nothing here may be able to spend.
for (const key of Object.keys(process.env)) if (/(_API_KEY|_TOKEN)$/.test(key)) delete process.env[key]

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
/** True as soon as `ok()` holds, false when it still does not after `ms`. */
const eventually = async (ok: () => boolean, ms: number) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) if (ok()) return true
  return ok()
}
const until = async (what: string | (() => string), ok: () => boolean, ms = 10_000) => { if (!(await eventually(ok, ms))) assert.fail(`timed out waiting for ${typeof what === "string" ? what : what()}`) }
const within = async <T>(what: string, promise: Promise<T>, ms = 5_000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error(`${what} did not return within ${ms} ms`)), ms) })
  try { return await Promise.race([promise, late]) } finally { clearTimeout(timer) }
}

let tracker: Tracker
const run = (id: string): GlhfRun => loadStored(id)!.run
const file = (id: string, name: string) => join(runs, id, name)
const text = (id: string, name: string) => (existsSync(file(id, name)) ? readFileSync(file(id, name), "utf8") : "")
const isSettled = (id: string) => ["done", "failed", "cancelled"].includes(run(id).phase)
/** One line per process a stub was started as. */
const launches = () => (existsSync(stubLog) ? readFileSync(stubLog, "utf8").trim().split("\n").filter((line) => line.startsWith("start ")) : [])
/** Processes started by a stub that are still there: "<pid> <command line>". */
const leftovers = () => spawnSync("pgrep", ["-fl", base], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean)
const sweep = () => { for (const line of leftovers()) try { process.kill(Number(line.split(" ")[0]), "SIGKILL") } catch { /* gone */ } }
const assertNoProcess = async (ms = 3_000) => { await eventually(() => leftovers().length === 0, ms); assert.deepEqual(leftovers(), [], "a process is left running") }

/** The run until it is settled. A run that never settles is the bug "stuck forever". */
const settle = async (id: string, ms = 10_000) => {
  await until(() => `${id} to settle (it is ${run(id).phase}: ${run(id).detail})`, () => isSettled(id), ms)
  return run(id)
}
const launched = (id: string, name: "runner" | "launch") => until(`${id} to be launched`, () => parseStamp(text(id, `${name}.pid`)) !== undefined && launches().length > 0)

/** Stop the engine and start it again: nothing in memory survives, only tracker.sqlite and the run folders. */
const restart = async (between?: () => unknown) => {
  await tracker.close()
  await between?.()
  tracker = await openTracker()
}
/** A restart leaves a settled run exactly as it is: no second launch, no new verdict, nothing left to track. */
const assertRestartChangesNothing = async (id: string, name: "runner" | "launch") => {
  const record = structuredClone(run(id)), count = launches().length, pid = text(id, `${name}.pid`), log = text(id, "tracker.log")
  await restart()
  assert.equal((await within("wait() after the restart", tracker.wait(id))).phase, record.phase)
  await sleep(250) // several polls
  assert.deepEqual(run(id), record, "the record changed after the restart")
  assert.equal(launches().length, count, "launched again after the restart")
  assert.equal(text(id, `${name}.pid`), pid)
  assert.equal(text(id, "tracker.log"), log, "the tracker worked on a settled run after the restart")
  assert.deepEqual(tracker.unfinished(), [])
}

const env = (vars: Record<string, string | undefined>) => { for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v }
/** GLHF_LOCAL_MARGIN_MS that puts the deadline of a run with a 60 s limit `ms` after its start. */
const deadlineIn = (ms: number) => String(ms - 60_000)

const startLocal = (stub: string, vars: Record<string, string | undefined> = {}) => {
  env({ GLHF_LOCAL_CMD: fixture(stub), ...vars })
  return tracker.start({ mode: "local", solver: "glhf", model: "mock", task: "demo", timeLimit: 60 })
}
const CLOUD = { mode: "cloud", solver: "glhf", model: "stub/model", effort: "high", project: "stub-project" } as const
const startCloud = (task: string, vars: Record<string, string | undefined> = {}) => {
  env(vars)
  return tracker.start({ ...CLOUD, task })
}
/** Cloud runs are refused while paid calls are off. Here `bixbench3` is the stub, so the switch is opened for the test. */
const cloud = (body: (t: TestContext) => Promise<void>) => async (t: TestContext) => {
  assert.equal(process.env.GLHF_BIXBENCH3_CMD, BIXBENCH3, "only the stub may stand behind a cloud run in tests")
  process.env.NO_PAID_CALLS = "0"
  try { await body(t) } finally { process.env.NO_PAID_CALLS = "1" }
}
/**
 * A run as an engine leaves it when it dies inside startOnce: the record and the (empty) pid marker exist, the pid
 * was never written. Must be called while the tracker is closed; opening it gives the record its task.
 */
const seed = (id: string, name: "runner" | "launch", request: RunRequest, startedAt = Date.now()) => {
  mkdirSync(runDir(id), { recursive: true })
  writeFileSync(file(id, `${name}.pid`), "")
  saveStored({ request, run: { id, mode: request.mode, task: request.task ?? "demo", solver: request.solver, model: request.model, roleModels: {}, phase: "queued", startedAt } })
}
/** The runner that such an engine did start: alive, but nobody knows its pid. */
const orphan = (id: string, stub: string, vars: Record<string, string> = {}) =>
  spawn(process.execPath, [join(here, "fixtures", stub), "--solver", "glhf", "--out", runDir(id)], { detached: true, stdio: "ignore", env: { ...process.env, ...vars } }).unref()

before(async () => {
  assert.equal(RUNS, runs, "the tracker must not work in glhf/runs during tests")
  mkdirSync(manifests, { recursive: true })
  tracker = await openTracker()
})
/**
 * One scenario: clean stub settings before it; after it, no run left unfinished (one local run at a time) and no
 * stub left alive, also when it failed. Not beforeEach/afterEach: those would run around every subtest too.
 */
const scenario = (name: string, body: (t: TestContext) => Promise<void>) => test(name, async (t) => {
  rmSync(stubLog, { force: true })
  for (const key of Object.keys(process.env)) if (key.startsWith("GLHF_STUB_")) delete process.env[key]
  env({ GLHF_STUB_LOG: stubLog, GLHF_LOCAL_POLL_MS: "40", GLHF_LAUNCH_POLL_MS: "40", GLHF_CLOUD_POLL_MS: "40", GLHF_LOCAL_MARGIN_MS: undefined, GLHF_LAUNCH_TIMEOUT_MS: undefined })
  try { await body(t) } finally {
    for (const one of tracker.unfinished()) patchRun(one.id, { phase: "cancelled", detail: "left unfinished by a test", finishedAt: Date.now() })
    sweep()
  }
})
after(async () => {
  await tracker.close()
  sweep()
  rmSync(base, { recursive: true, force: true })
})

// ---------------------------------------------------------------- local runs: watchLocal

const TIMED_OUT = /^the local runner was still going \d+ minutes after the start, far past its 60 s limit; it was stopped\n/

scenario("watchLocal: a runner that never finishes is stopped at start + time limit + margin, and the run fails", async (t) => {
  const cases = [
    { name: "it reported that it was running", stub: "timeouts/hang.mjs", vars: { GLHF_STUB_WRITE: "running" }, phase: "running", log: "hang stub: started; it will never finish" },
    { name: "it never wrote run.json", stub: "timeouts/hang.mjs", vars: {}, phase: "launching", log: "hang stub: started; it will never finish" },
    { name: "it wrote a run.json that is not JSON", stub: "timeouts/garbage.mjs", vars: { GLHF_STUB_GARBAGE: "text", GLHF_STUB_THEN: "hang" }, phase: "launching", log: "garbage stub: wrote run.json" },
  ] as const
  for (const c of cases) {
    await t.test(c.name, async () => {
      rmSync(stubLog, { force: true })
      const { id } = await startLocal(c.stub, { GLHF_STUB_WRITE: undefined, GLHF_STUB_GARBAGE: undefined, GLHF_STUB_THEN: undefined, ...c.vars, GLHF_LOCAL_MARGIN_MS: deadlineIn(1_500) })
      await launched(id, "runner")
      await until(`phase ${c.phase} before the deadline`, () => run(id).phase === c.phase && existsSync(file(id, "runner.log")), 1_200)
      assert.ok(alive(text(id, "runner.pid")), "still going before the deadline")

      const final = await settle(id)
      assert.equal(final.phase, "failed")
      assert.match(final.error ?? "", TIMED_OUT)
      assert.ok(final.error!.endsWith(c.log), "the error ends with the last lines of runner.log")
      assert.equal(final.detail, undefined)
      assert.ok(final.finishedAt! - final.startedAt >= 1_500, "not before the deadline")
      assert.ok(final.finishedAt! - final.startedAt < 5_000, "and soon after it")
      assert.match(text(id, "tracker.log"), /finished: failed/)
      await assertNoProcess()
      assert.equal(text(id, "runner.exit"), "", "the wrapper was stopped too, so no exit status was written")
      await assertRestartChangesNothing(id, "runner")
    })
  }
})

scenario("watchLocal: a runner that ignores SIGTERM at the deadline", async (t) => {
  const { id } = await startLocal("timeouts/hang.mjs", { GLHF_STUB_WRITE: "running", GLHF_STUB_IGNORE_TERM: "1", GLHF_LOCAL_MARGIN_MS: deadlineIn(800) })
  await launched(id, "runner")
  const final = await settle(id)
  assert.equal(final.phase, "failed")
  assert.match(final.error ?? "", /^the local runner was still going \d+ minutes after the start, far past its 60 s limit; /)
  await sleep(500) // time for SIGTERM to do what it is going to do
  const left = leftovers()
  await t.test("the runner is gone, or the error says that it could not be stopped", () => {
    assert.ok(left.length === 0 || /could not be stopped/.test(final.error ?? ""), `error: ${final.error!.split("\n")[0]}\nstill running: ${left.join(" | ")}`)
  })
  sweep()
  await assertNoProcess()
  await assertRestartChangesNothing(id, "runner")
})

scenario("watchLocal: the engine is down when the deadline passes; after the restart the runner is stopped, not started again", async () => {
  const { id } = await startLocal("timeouts/hang.mjs", { GLHF_STUB_WRITE: "running", GLHF_LOCAL_MARGIN_MS: deadlineIn(1_500) })
  await launched(id, "runner")
  await until("the run to be going", () => run(id).phase === "running", 1_200)
  const pid = text(id, "runner.pid")
  await restart(async () => {
    await sleep(1_800) // the deadline passes while nobody is tracking
    assert.equal(run(id).phase, "running", "nobody was there to end it")
    assert.ok(alive(pid), "the runner outlives the engine")
  })
  const final = await settle(id)
  assert.equal(final.phase, "failed")
  assert.match(final.error ?? "", TIMED_OUT)
  assert.equal(launches().length, 1, "the restart did not launch a second runner")
  assert.equal(text(id, "runner.pid"), pid)
  assert.match(text(id, "tracker.log"), /local runner started/)
  assert.doesNotMatch(text(id, "tracker.log"), /already started/, "the launch phase did not run a second time")
  await assertNoProcess()
  await assertRestartChangesNothing(id, "runner")
})

scenario("watchLocal: a runner that exits 0 without writing its result", async (t) => {
  const { id } = await startLocal("timeouts/silent.mjs")
  const final = await settle(id)
  assert.equal(final.phase, "failed")
  assert.equal(final.error, "the local runner ended without writing a result: it exited with status 0 and there is no run.json", "runner.log is empty, so that is all a person gets")
  assert.equal(final.score, undefined)
  assert.equal(launches().length, 1)
  await assertNoProcess()
  await t.test("the same when run.json still says running", async () => {
    rmSync(stubLog, { force: true })
    const { id } = await startLocal("timeouts/crash.mjs", { GLHF_STUB_WRITE: "running", GLHF_STUB_EXIT: "0" })
    assert.match((await settle(id)).error ?? "", /^the local runner ended without writing a result: it exited with status 0 and run\.json still says that it is running\n/)
    await assertNoProcess()
  })
  await assertRestartChangesNothing(id, "runner")
})

scenario("watchLocal: a runner that exits non-zero", async (t) => {
  for (const [name, vars, status] of [
    ["before it wrote anything", {}, 3],
    ["after it reported that it was running", { GLHF_STUB_WRITE: "running" }, 3],
    ["killed by the out-of-memory killer's exit status", { GLHF_STUB_EXIT: "137" }, 137],
  ] as const) {
    await t.test(name, async () => {
      rmSync(stubLog, { force: true })
      const { id } = await startLocal("timeouts/crash.mjs", { GLHF_STUB_WRITE: undefined, GLHF_STUB_EXIT: undefined, ...vars })
      const final = await settle(id)
      assert.equal(final.phase, "failed")
      assert.equal(final.error, `the local runner exited with status ${status}\ncrash stub: the sandbox image is missing`)
      assert.equal(text(id, "runner.exit").trim(), String(status))
      assert.equal(launches().length, 1)
      await assertNoProcess()
      await assertRestartChangesNothing(id, "runner")
    })
  }
  await t.test("the command does not exist", async () => {
    env({ GLHF_LOCAL_CMD: join(base, "no-such-runner") })
    const { id } = await tracker.start({ mode: "local", solver: "single", model: "mock", timeLimit: 60 })
    const final = await settle(id)
    assert.equal(final.phase, "failed")
    assert.match(final.error ?? "", /^the local runner exited with status 127\n.*no-such-runner/)
    await assertNoProcess()
    await assertRestartChangesNothing(id, "runner")
  })
})

scenario("watchLocal: a runner that writes a malformed run.json and exits 0", async (t) => {
  for (const [kind, why] of [["text", "it is not JSON"], ["truncated", "it is not JSON"], ["array", "it is not a JSON object"], ["status", 'status is "finished-ish", not "running", "done" or "failed"']]) {
    await t.test(kind, async () => {
      rmSync(stubLog, { force: true })
      const { id } = await startLocal("timeouts/garbage.mjs", { GLHF_STUB_GARBAGE: kind })
      const final = await settle(id)
      assert.equal(final.phase, "failed")
      assert.equal(final.error, `the local runner exited with status 0, but run.json is not usable: ${why}\ngarbage stub: wrote run.json`)
      assert.equal(final.score, undefined, "nothing of the rubbish reached the record")
      assert.equal(launches().length, 1)
      await assertNoProcess()
      await assertRestartChangesNothing(id, "runner")
    })
  }
})

scenario("watchLocal: run.json says done, with the wrong type in score, artifacts, usage and error", async () => {
  const { id } = await startLocal("timeouts/garbage.mjs", { GLHF_STUB_GARBAGE: "types" })
  const final = await settle(id)
  assert.equal(final.phase, "failed", "a result that cannot be used is not a result")
  assert.match(final.error ?? "", /^the local runner (wrote a result, but|exited with status 0, but) run\.json is not usable: score is "high", not a number; artifacts is "none", not a list of \{artifact_id, score\}; usage is 7, not token counts per model; error is 5, not text\ngarbage stub: wrote run\.json$/)
  for (const key of ["score", "artifacts", "usage"] as const) assert.equal(final[key], undefined, `${key} of the rubbish reached the record`)
  assert.equal(launches().length, 1)
  await assertNoProcess()
  await assertRestartChangesNothing(id, "runner")
})

scenario("watchLocal: a finished run whose run.json gives finished_at as a date, not as seconds", async () => {
  const { id } = await startLocal("timeouts/garbage.mjs", { GLHF_STUB_GARBAGE: "date" })
  await launched(id, "runner")
  // It settles while the engine is up (it once faulted the task on NaN and stayed "launching" for good).
  const final = await settle(id, 3_000)
  assert.equal(final.phase, "failed")
  assert.match(final.error ?? "", /run\.json is not usable: finished_at is "2026-11-14T22:27:23Z", not seconds since 1970 as a number\n/)
  assert.equal(final.score, undefined)
  assert.equal(launches().length, 1)
  await assertNoProcess()
  const next = await tracker.start({ mode: "local", solver: "single", model: "mock", timeLimit: 60 }) // the machine is free again
  await settle(next.id)
  await assertRestartChangesNothing(id, "runner")
})

test("readLocal: every field of run.json is checked before it can reach the record", () => {
  const dir = join(base, "read-local")
  mkdirSync(dir, { recursive: true })
  const read = (value: unknown) => { writeFileSync(join(dir, "run.json"), typeof value === "string" ? value : JSON.stringify(value)); return readLocal(dir) }
  const usage = { "m/x": { input_tokens: 1, output_tokens: 2, total_tokens: 3 } }
  assert.deepEqual(read({ status: "done", score: 0.5, artifacts: [{ artifact_id: "a", score: 1, extra: "dropped" }], usage, error: null, finished_at: 1_700_000_000.4 }),
    { kind: "ended", result: { phase: "done", score: 0.5, artifacts: [{ artifact_id: "a", score: 1 }], usage, finishedAt: 1_700_000_000_400 } })
  assert.deepEqual(read({ status: "failed", error: "boom" }), { kind: "ended", result: { phase: "failed", error: "boom" } })
  assert.deepEqual(read({ status: "running", score: "anything" }), { kind: "running" })
  const bad = (value: Record<string, unknown>) => { const got = read({ status: "done", ...value }); assert.equal(got.kind, "unusable", JSON.stringify(value)); return got.kind === "unusable" && got.final ? got.why : "" }
  assert.match(bad({ score: "1" }), /^score is "1", not a number$/)
  assert.match(bad({ artifacts: [{ artifact_id: 1, score: 1 }] }), /^artifacts/)
  assert.match(bad({ artifacts: {} }), /^artifacts/)
  assert.match(bad({ usage: { m: { input_tokens: "1", output_tokens: 1, total_tokens: 1 } } }), /^usage/)
  assert.match(bad({ usage: [] }), /^usage/)
  assert.match(bad({ error: { message: "x" } }), /^error/)
  assert.match(bad({ finished_at: -1 }), /^finished_at/)
  assert.match(bad({ finished_at: "1700000000" }), /^finished_at/)
  rmSync(join(dir, "run.json"))
  assert.deepEqual(readLocal(dir), { kind: "missing" })
})

scenario("watchLocal: the runner is killed mid-run", async (t) => {
  const killGroup = (id: string) => process.kill(-parseStamp(text(id, "runner.pid"))!.pid, "SIGKILL")
  const check = async (id: string) => {
    const final = await settle(id)
    assert.equal(final.phase, "failed")
    assert.equal(final.error, "the local runner stopped without finishing\nhang stub: started; it will never finish")
    assert.equal(launches().length, 1)
    await assertNoProcess()
    await assertRestartChangesNothing(id, "runner")
  }
  await t.test("while the engine is watching", async () => {
    const { id } = await startLocal("timeouts/hang.mjs", { GLHF_STUB_WRITE: "running" })
    await launched(id, "runner")
    await until("the run to be going", () => run(id).phase === "running")
    killGroup(id)
    await check(id)
  })
  await t.test("while the engine is down", async () => {
    rmSync(stubLog, { force: true })
    const { id } = await startLocal("timeouts/hang.mjs", { GLHF_STUB_WRITE: "running" })
    await launched(id, "runner")
    await until("the run to be going", () => run(id).phase === "running")
    await restart(() => { killGroup(id); assert.equal(run(id).phase, "running") })
    await check(id)
  })
})

// ---------------------------------------------------------------- local runs: between the spawn and the pid file

const LOCAL: RunRequest = { mode: "local", solver: "glhf", model: "mock", task: "demo", timeLimit: 60 }

// An empty pid file says nothing about a process. The message claims neither "stopped" nor "running", and asks someone to look.
const NO_PID = (id: string) => `the local runner's pid was never recorded, so it is not known whether it was started or is still running. Check for a leftover process or container (its command line holds --out ${runDir(id)})`

scenario("the engine died between the pid marker and the pid: nothing is started again, and the run fails after five polls", async (t) => {
  await t.test("nothing was started", async () => {
    await restart(() => seed("seeded-never-started", "runner", LOCAL))
    const id = "seeded-never-started"
    const final = await settle(id)
    assert.equal(final.phase, "failed")
    assert.equal(final.error, NO_PID(id))
    assert.match(text(id, "tracker.log"), /local runner was already started; not starting again/)
    assert.equal(text(id, "runner.pid"), "", "the marker was left alone")
    assert.deepEqual(launches(), [], "the runner was not started: it may be running already")
    await assertNoProcess()
    await assertRestartChangesNothing(id, "runner")
  })
  await t.test("a restart during those five polls", async () => {
    env({ GLHF_LOCAL_POLL_MS: "250" })
    const id = "seeded-restart-midway"
    await restart(() => seed(id, "runner", LOCAL))
    await until("the launch phase", () => run(id).phase === "launching")
    await restart()
    assert.equal(run(id).phase, "launching")
    const final = await settle(id)
    assert.equal(final.phase, "failed")
    assert.equal(final.error, NO_PID(id))
    assert.equal((text(id, "tracker.log").match(/not starting again/g) ?? []).length, 1, "the launch phase ran once")
    assert.deepEqual(launches(), [])
    await assertNoProcess()
    await assertRestartChangesNothing(id, "runner")
  })
  await t.test("the runner was started and finishes within the five polls: its result is read", async () => {
    env({ GLHF_LOCAL_POLL_MS: "300", GLHF_STUB_MS: "200" })
    const id = "seeded-orphan-finishes"
    await restart(() => { seed(id, "runner", LOCAL); orphan(id, "local-runner-stub.mjs") })
    const final = await settle(id)
    assert.equal(final.phase, "done")
    assert.equal(final.score, 1)
    assert.equal(final.error, undefined)
    assert.equal(launches().length, 1, "only the one the dead engine started")
    await assertNoProcess()
    await assertRestartChangesNothing(id, "runner")
  })
})

scenario("the engine died between the spawn and the pid: the runner is alive, but nobody knows its pid", async () => {
  const id = "seeded-orphan-alive"
  await restart(() => { seed(id, "runner", LOCAL); orphan(id, "timeouts/hang.mjs", { GLHF_STUB_WRITE: "running" }) })
  const final = await settle(id)
  assert.equal(final.phase, "failed")
  assert.equal(launches().length, 1, "only the one the dead engine started")
  const left = leftovers()
  assert.ok(left.length > 0, "the runner works on: the tracker has no pid to stop it with")
  assert.equal(final.error, NO_PID(id).replace(". Check", " (run.json shows that it did start). Check"))
  assert.doesNotMatch(final.error ?? "", /stopped without finishing/, "the run is not called stopped while its runner works on")
  sweep()
  await assertNoProcess()
  await assertRestartChangesNothing(id, "runner")
})

scenario("the same state when the deadline has passed: the error tells the person to look for the process", async () => {
  const id = "seeded-orphan-late"
  env({ GLHF_LOCAL_MARGIN_MS: "0" })
  await restart(() => { seed(id, "runner", LOCAL, Date.now() - 10 * 60_000); orphan(id, "timeouts/hang.mjs") })
  const final = await settle(id)
  assert.equal(final.phase, "failed")
  assert.equal(final.error, "the local runner was still going 10 minutes after the start, far past its 60 s limit; it could not be stopped, check for a leftover process or container")
  // Here a process is left, and the tracker cannot help it (it has no pid). The error says so, which is the most it can do.
  await until("the orphan to be up", () => launches().length === 1)
  assert.ok(leftovers().length > 0)
  sweep()
  await assertNoProcess()
  await assertRestartChangesNothing(id, "runner")
})

scenario("the spawn of the wrapping shell itself fails (child.pid is undefined): the run fails at once and says why", async () => {
  // GLHF_BIXBENCH_DIR is the folder the commands start in; one that does not exist makes the spawn fail.
  try {
    const { id } = await startLocal("timeouts/silent.mjs", { GLHF_BIXBENCH_DIR: join(base, "no-such-folder"), GLHF_LOCAL_POLL_MS: "400" })
    const final = await settle(id)
    assert.equal(final.phase, "failed")
    const why = `the folder to start it in does not exist (${join(base, "no-such-folder")})`
    assert.ok([why, `${why}: spawn sh ENOENT`].includes(final.error!.replace("the local runner could not be started: ", "")), final.error) // Node's own reason arrives as an event, a moment later
    assert.ok(final.finishedAt! - final.startedAt < 1_500, "known at the first look, not after five polls of guessing")
    assert.equal(text(id, "runner.pid"), "", "no pid: no process was created")
    assert.equal(text(id, "runner.nospawn"), `${why}: spawn sh ENOENT`)
    assert.deepEqual(launches(), [])
    await assertNoProcess()
    await assertRestartChangesNothing(id, "runner")
  } finally { delete process.env.GLHF_BIXBENCH_DIR }
})

test("startOnce and processState: an empty pid file is \"unstarted\" only when the spawn is known to have failed, else \"unknown\", never \"gone\"", () => {
  const dir = join(base, "spawn-states")
  mkdirSync(dir, { recursive: true })
  assert.equal(startOnce(dir, "a", ["true"], join(dir, "a.log"), null, join(base, "no-such-folder")), true)
  assert.equal(processState(dir, "a", 0), "unstarted")
  assert.equal(processState(dir, "a", 99), "unstarted")
  assert.throws(() => startOnce(dir, "b", ["true", "a\0b"], join(dir, "b.log"), null), TypeError, "an argument the system cannot take")
  assert.equal(processState(dir, "b", 0), "unstarted", "the marker is there and the reason is recorded: a retry starts nothing and does not guess")
  assert.equal(startOnce(dir, "b", ["true"], join(dir, "b.log"), null), false)
  writeFileSync(join(dir, "c.pid"), "")
  assert.equal(processState(dir, "c", 4), "running")
  assert.equal(processState(dir, "c", 5), "unknown")
})

// ---------------------------------------------------------------- cloud runs: awaitLaunch

// A launcher past GLHF_LAUNCH_TIMEOUT_MS is stopped (the group stop of a cancel) before the run is settled: left
// alive, it could still create a VM that bills and that no run follows. "No VM" is said because it is known then.
const STUCK = /^the launcher did not finish within \d+ minutes and reported no run; it was stopped \(no run manifest was written, so no VM was created by it\)\nbixbench3 stub: provisioning$/

scenario("awaitLaunch: a launcher that hangs and wrote no manifest fails the run at GLHF_LAUNCH_TIMEOUT_MS", cloud(async () => {
  const { id } = await startCloud("hang-1", { GLHF_STUB_RUN: "hang", GLHF_LAUNCH_TIMEOUT_MS: "1200" })
  await launched(id, "launch")
  await until("the launch to be shown", () => run(id).phase === "launching" && run(id).detail === "bixbench3 stub: provisioning", 1_000)
  assert.match(launches()[0], /--tag \S+ run --task hang-1 --model stub\/model --effort high --project stub-project --solver glhf/, "the stub, with the arguments of the real command")
  const final = await settle(id)
  assert.equal(final.phase, "failed")
  assert.match(final.error ?? "", STUCK)
  assert.equal(final.remoteId, undefined)
  assert.ok(final.finishedAt! - final.startedAt >= 1_200 && final.finishedAt! - final.startedAt < 5_000, "at the limit, not before and not much later")
  assert.deepEqual(leftovers(), [], "the launcher was stopped before the run was settled")
  assert.equal(text(id, "launch.exit"), "", "its wrapper too")
  await assertRestartChangesNothing(id, "launch")
}))

scenario("awaitLaunch: the engine is down when the launch limit passes; after the restart the run fails, and nothing is launched again", cloud(async () => {
  const { id } = await startCloud("hang-2", { GLHF_STUB_RUN: "hang", GLHF_LAUNCH_TIMEOUT_MS: "1200" })
  await launched(id, "launch")
  const pid = text(id, "launch.pid")
  await restart(async () => {
    await sleep(1_500)
    assert.equal(run(id).phase, "launching")
    assert.ok(alive(pid))
  })
  const final = await settle(id)
  assert.equal(final.phase, "failed")
  assert.match(final.error ?? "", STUCK)
  assert.equal(launches().length, 1, "the restart did not launch a second time")
  assert.equal(text(id, "launch.pid"), pid)
  assert.doesNotMatch(text(id, "tracker.log"), /already started/, "the launch phase did not run a second time")
  assert.deepEqual(leftovers(), [], "the launcher was stopped before the run was settled")
  await assertRestartChangesNothing(id, "launch")
}))

scenario("awaitLaunch: a launcher that hangs after it wrote its manifest: the cloud run is adopted and followed to its grade", cloud(async () => {
  const { id } = await startCloud("hang-3", { GLHF_STUB_RUN: "hang", GLHF_STUB_MANIFEST: "remote-hang-3", GLHF_LAUNCH_TIMEOUT_MS: "800" })
  const final = await settle(id)
  assert.equal(final.phase, "done")
  assert.equal(final.remoteId, "remote-hang-3")
  assert.equal(final.score, 0.5)
  assert.equal(final.error, undefined)
  assert.equal(final.detail, `cloud run remote-hang-3: results in ${join(manifests, "remote-hang-3")}`)
  assert.match(text(id, "tracker.log"), /adopted cloud run remote-hang-3 from its manifest/)
  assert.equal(launches().length, 1)
  assert.match(text(id, "tracker.log"), /adopted cloud run remote-hang-3 from its manifest\n[^\n]*running -> completing/, "adopted only after the stop")
  assert.deepEqual(leftovers(), [], "the launcher was stopped before its cloud run was followed")
  await assertRestartChangesNothing(id, "launch")
}))

scenario("awaitLaunch: the launcher exits 0 and the manifest never appears", cloud(async (t) => {
  for (const mode of ["silent", "garbage"]) {
    await t.test(mode === "silent" ? "it printed nothing" : "it printed text without a run id", async () => {
      rmSync(stubLog, { force: true })
      const { id } = await startCloud(`exit0-${mode}`, { GLHF_STUB_RUN: mode })
      const final = await settle(id)
      assert.equal(final.phase, "failed")
      assert.equal(final.error, "bixbench3 run exited with status 0 but printed no run id and wrote no manifest, so there is no cloud run to follow\nbixbench3 stub: provisioning")
      assert.equal(final.remoteId, undefined)
      assert.equal(launches().length, 1)
      await assertNoProcess()
      await assertRestartChangesNothing(id, "launch")
    })
  }
}))

scenario("awaitLaunch: the launcher exits non-zero", cloud(async (t) => {
  await t.test("before it wrote a manifest", async () => {
    const { id } = await startCloud("crash-1", { GLHF_STUB_RUN: "crash" })
    const final = await settle(id)
    assert.equal(final.phase, "failed")
    assert.equal(final.error, "bixbench3 run exited with status 3\nbixbench3 stub: provisioning\nbixbench3 stub: quota exceeded in region")
    assert.equal(launches().length, 1)
    await assertNoProcess()
    await assertRestartChangesNothing(id, "launch")
  })
  await t.test("after it wrote a manifest: the error gives the command that removes the VM", async () => {
    rmSync(stubLog, { force: true })
    const { id } = await startCloud("crash-2", { GLHF_STUB_RUN: "crash", GLHF_STUB_MANIFEST: "remote-crash-2" })
    const final = await settle(id)
    assert.equal(final.phase, "failed")
    assert.equal(final.error, "bixbench3 run exited with status 3\nbixbench3 stub: provisioning\nbixbench3 stub: quota exceeded in region\n"
      + `A VM may be left stopped. Remove it with: ${BIXBENCH3} cancel --run remote-crash-2 --project stub-project`)
    assert.equal(final.remoteId, undefined, "a launch that failed is not followed")
    assert.equal(launches().length, 1)
    await assertNoProcess()
    await assertRestartChangesNothing(id, "launch")
  })
}))

scenario("awaitLaunch: the launcher is killed and the manifest never appears", cloud(async (t) => {
  const GONE = "the launcher stopped before it reported a run (no run manifest was written, so no VM was created by it)\nbixbench3 stub: provisioning"
  const killGroup = (id: string) => process.kill(-parseStamp(text(id, "launch.pid"))!.pid, "SIGKILL")
  const check = async (id: string) => {
    const final = await settle(id)
    assert.equal(final.phase, "failed")
    assert.equal(final.error, GONE)
    assert.equal(launches().length, 1)
    await assertNoProcess()
    await assertRestartChangesNothing(id, "launch")
  }
  await t.test("while the engine is watching", async () => {
    const { id } = await startCloud("killed-1", { GLHF_STUB_RUN: "hang" })
    await launched(id, "launch")
    await until("the launcher's first line", () => text(id, "launch.log") !== "")
    killGroup(id)
    await check(id)
  })
  await t.test("while the engine is down", async () => {
    rmSync(stubLog, { force: true })
    const { id } = await startCloud("killed-2", { GLHF_STUB_RUN: "hang" })
    await launched(id, "launch")
    await until("the launcher's first line", () => text(id, "launch.log") !== "")
    await restart(() => killGroup(id))
    await check(id)
  })
}))

scenario("awaitLaunch: the engine died between the pid marker and the pid of the launcher", cloud(async () => {
  const NO_PID = (task: string) => `the launcher's pid was never recorded, so it is not known whether it was started or is still running. Check for a leftover process (\`bixbench3 run --task ${task}\`) and stop it. `
    + "It can still create a VM that bills, and no run would follow it. Check for a VM with: gcloud compute instances list --project stub-project\n"
    + `Remove it with: ${BIXBENCH3} cancel --run ID --project stub-project (ID: the run_id in the run_manifest.json it wrote under ${manifests})`
  const id = "seeded-cloud-never-launched"
  await restart(() => seed(id, "launch", { ...CLOUD, task: "seeded-1" }))
  const final = await settle(id)
  assert.equal(final.phase, "failed")
  assert.equal(final.error, NO_PID("seeded-1"), "nothing is known, so nothing is promised")
  assert.match(text(id, "tracker.log"), /bixbench3 run was already started; not launching again/)
  assert.deepEqual(launches(), [], "not launched: a second launch could mean a second VM")
  await assertNoProcess()
  await assertRestartChangesNothing(id, "launch")

  // The launcher that such an engine did start, alive and unknown: the same message, and it is the true one.
  const alone = "seeded-cloud-orphan"
  await restart(() => {
    seed(alone, "launch", { ...CLOUD, task: "seeded-2" })
    spawn(process.execPath, [join(here, "fixtures", "timeouts", "bixbench3.mjs"), "--tag", base, "run", "--task", "seeded-2"], { detached: true, stdio: "ignore", env: { ...process.env, GLHF_STUB_RUN: "hang" } }).unref()
  })
  const second = await settle(alone)
  assert.equal(second.phase, "failed")
  await until("the orphan to be up", () => launches().length === 1)
  assert.ok(leftovers().length > 0, "the launcher works on: the tracker has no pid to stop it with")
  assert.equal(second.error, NO_PID("seeded-2"))
  assert.doesNotMatch(second.error ?? "", /no VM was created/, "not promised while the launcher may be at work")
  sweep()
  await assertNoProcess()
  await assertRestartChangesNothing(alone, "launch")
}))
