import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { alive, parseStamp, stamp, startTime } from "../src/glhf/proc.ts"
import { BadId, runDir, safeId, settingsOf, type Stored } from "../src/glhf/store.ts"
import type { GlhfRun, RunRequest } from "../src/glhf/types.ts"
import { findManifest, hasRival, manifestSolver, processState, startOnce } from "../src/glhf/task.ts"
import { BadRequest, checkRequest, lock, TrackerBusy } from "../src/glhf/tracker.ts"

const tmp = () => mkdtempSync(join(tmpdir(), "glhf-test-"))
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
const NOBODY = { token: false, origin: false }
const DASHBOARD = { token: false, origin: true }
const CLI = { token: true, origin: false }

test("the reviewer's cross-origin request is refused for an unknown caller", () => {
  const exploit = { mode: "local", solver: "glhf", model: "anthropic/claude-opus-5", timeLimit: 86400, memory: true } as const
  assert.throws(() => checkRequest(exploit, false), BadRequest)
  assert.throws(() => checkRequest(exploit, NOBODY), /real model/)
  assert.throws(() => checkRequest({ ...exploit, memory: undefined }, NOBODY), /real model/)
  assert.throws(() => checkRequest({ mode: "local", solver: "glhf", model: "mock", memory: true }, NOBODY), /memory/)
  assert.throws(() => checkRequest({ mode: "local", solver: "glhf", model: "mock", exa: true }, NOBODY), /exa/)
})

test("an unknown caller may start the scripted demo, and nothing else", () => {
  const request = checkRequest({ mode: "local", solver: "glhf", model: "mock" }, NOBODY)
  assert.equal(request.task, "demo")
  assert.match(request.caseDir ?? "", /demo_case$/)
  assert.throws(() => checkRequest({ mode: "local", solver: "glhf", model: "mock", caseDir: "/etc" }, NOBODY), /case directory/)
})

test("the dashboard may start real-model local runs, but not cloud runs or case directories", () => {
  const request = checkRequest({ mode: "local", solver: "glhf", model: "anthropic/claude-sonnet-5-5", memory: true, timeLimit: 2400, maxTokens: 4_000_000 }, DASHBOARD)
  assert.equal(request.memory, true)
  assert.equal(request.timeLimit, 2400)
  assert.throws(() => checkRequest({ mode: "cloud", solver: "glhf", model: "anthropic/claude-sonnet-5-5", task: "9", effort: "high", project: "p" }, DASHBOARD), /cloud runs cost money/)
  assert.throws(() => checkRequest({ mode: "local", solver: "glhf", model: "mock", caseDir: "/etc" }, DASHBOARD), /case directory/)
  assert.equal(checkRequest({ mode: "cloud", solver: "glhf", model: "anthropic/claude-sonnet-5-5", task: "9", effort: "high", project: "p" }, CLI).mode, "cloud")
  assert.equal(checkRequest({ mode: "local", solver: "glhf", model: "mock", task: "9", caseDir: "/tmp/case" }, true).caseDir, "/tmp/case")
})

test("budgets are capped", () => {
  const base = { mode: "local", solver: "glhf", model: "mock" } as const
  assert.throws(() => checkRequest({ ...base, timeLimit: 86_401 }, CLI), /timeLimit/)
  assert.throws(() => checkRequest({ ...base, timeLimit: 5 }, CLI), /timeLimit/)
  assert.throws(() => checkRequest({ ...base, maxTokens: 1e12 }, CLI), /maxTokens/)
  assert.throws(() => checkRequest({ ...base, maxTokens: -1 }, CLI), /maxTokens/)
  assert.throws(() => checkRequest({ ...base, maxMessagesPerRole: 1e6 }, CLI), /maxMessagesPerRole/)
  assert.throws(() => checkRequest({ ...base, reviewRounds: 500 }, CLI), /reviewRounds/)
  assert.throws(() => checkRequest({ ...base, model: "mock; rm -rf /" }, CLI), /model/)
  assert.throws(() => checkRequest([] as never, CLI), BadRequest)
  assert.equal(checkRequest({ ...base, timeLimit: 86_400 }, CLI).timeLimit, 86_400)
})

test("settings recorded for a run", () => {
  assert.deepEqual(settingsOf({ mode: "local", solver: "glhf", model: "m" }), { timeLimit: 1800 })
  assert.deepEqual(settingsOf({ mode: "local", solver: "glhf", model: "m", timeLimit: 600, maxTokens: 5, exa: true, memory: true, seed: 7, reviewRounds: 2 }),
    { timeLimit: 600, maxTokens: 5, reviewRounds: 2, exa: true, memory: true, seed: 7 })
})

test("run ids are one safe path segment", () => {
  for (const id of ["202611141959-demo-glhf", "a.b_c-1"]) assert.ok(safeId(id))
  for (const id of [".", "...", "../../board/runs/x", "..", "a/b", "a\\b", "", "a..b", "a b", "%2e%2e", "x".repeat(201), 5, undefined]) assert.ok(!safeId(id), String(id))
  assert.throws(() => runDir("../../board/runs/x"), BadId)
  assert.match(runDir("ok-run"), /glhf\/runs\/ok-run$/)
})

test("a manifest is adopted only for the same solver", () => {
  const root = tmp()
  const write = (id: string, extra: object, at = Date.now()) => {
    mkdirSync(join(root, id), { recursive: true })
    writeFileSync(join(root, id, "run_manifest.json"), JSON.stringify({ run_id: id, task_id: "9", model: { id: "anthropic/m" }, started_at: new Date(at).toISOString(), ...extra }))
  }
  const since = Date.now() - 5_000
  const input = { task: "9", model: "anthropic/m" }
  write("run-single", { solver: "single" })
  write("run-swarm", { command: ["inspect", "eval", "-T", "solver=glhf"] })
  assert.equal(manifestSolver({ command: "-T solver=glhf" }), "glhf")
  assert.equal(manifestSolver({ run_id: "x" }), undefined)
  assert.deepEqual(findManifest({ ...input, solver: "glhf" }, since, root), { id: "run-swarm" })
  assert.deepEqual(findManifest({ ...input, solver: "single" }, since, root), { id: "run-single" })
  assert.deepEqual(findManifest({ ...input, solver: "single" }, since, root, ["run-single"]), { id: undefined }, "a run another record follows is not adopted")
  assert.deepEqual(findManifest({ ...input, task: "10", solver: "glhf" }, since, root), { id: undefined })
  assert.deepEqual(findManifest({ ...input, solver: "glhf" }, Date.now() + 60_000, root), { id: undefined }, "older than the launch")

  // Manifests that do not name their solver: one candidate is adopted, two are not.
  const plain = tmp()
  mkdirSync(join(plain, "a")); mkdirSync(join(plain, "b"))
  const m = (id: string) => JSON.stringify({ run_id: id, paper_id: "9", model: { id: "anthropic/m" }, started_at: new Date().toISOString() })
  writeFileSync(join(plain, "a", "run_manifest.json"), m("a"))
  assert.deepEqual(findManifest({ ...input, solver: "glhf" }, since, plain), { id: "a" })
  // ...but not while a run of the other solver, same task and model, still waits for its own cloud run:
  // the one manifest may be that run's.
  assert.deepEqual(findManifest({ ...input, solver: "glhf" }, since, plain, [], true), { ambiguous: ["a"] })
  assert.deepEqual(findManifest({ ...input, solver: "glhf" }, since, root, [], true), { id: "run-swarm" }, "a manifest that names our solver is still adopted")
  writeFileSync(join(plain, "b", "run_manifest.json"), m("b"))
  assert.deepEqual(findManifest({ ...input, solver: "glhf" }, since, plain).ambiguous?.sort(), ["a", "b"])
  assert.deepEqual(findManifest({ ...input, solver: "glhf" }, since, plain, ["b"]), { id: "a" })
})

test("a rival is an unfinished cloud run of the other solver, same task and model, without its cloud run yet", () => {
  const me = { id: "mine", task: "9", model: "anthropic/m", solver: "glhf" as const }
  const other = (over: Partial<GlhfRun>): Stored => ({ request: {} as RunRequest, run: { id: "other", mode: "cloud", task: "9", solver: "single", model: "anthropic/m", roleModels: {}, phase: "launching", startedAt: 1, ...over } })
  assert.equal(hasRival(me, [other({})]), true)
  assert.equal(hasRival(me, [other({ id: "mine" })]), false, "not itself")
  assert.equal(hasRival(me, [other({ solver: "glhf" })]), false)
  assert.equal(hasRival(me, [other({ task: "10" })]), false)
  assert.equal(hasRival(me, [other({ model: "openai/x" })]), false)
  assert.equal(hasRival(me, [other({ phase: "done" })]), false)
  assert.equal(hasRival(me, [other({ phase: "failed" })]), false)
  assert.equal(hasRival(me, [other({ remoteId: "run-1" })]), false, "it already follows its own cloud run")
  assert.equal(hasRival(me, [other({ mode: "local" })]), false)
})

test("model ids cannot look like command-line options", () => {
  const base = { mode: "local" as const, solver: "glhf" as const }
  for (const model of ["--help", "-x", "--x/y z", "a b", ".hidden", "/abs/path", "", "x".repeat(201)]) assert.throws(() => checkRequest({ ...base, model }, CLI), /model/, model)
  for (const model of ["mock", "anthropic/claude-sonnet-5-5", "openai/gpt-5.5", "ollama/qwen3:32b", "openrouter/~anthropic/claude-opus-latest"]) assert.equal(checkRequest({ ...base, model, maxTokens: model === "mock" ? undefined : 1_000 }, CLI).model, model)
  const real = { ...base, model: "anthropic/claude-sonnet-5-5", maxTokens: 1_000 }
  for (const critic of ["--x/y", "--x/y z", "-/a", "a /b"]) assert.throws(() => checkRequest({ ...real, roleModels: { critic } }, CLI), /roleModels/, critic)
  assert.deepEqual(checkRequest({ ...real, roleModels: { critic: "openai/gpt-5.5" } }, CLI).roleModels, { critic: "openai/gpt-5.5" })
})

test("a pid counts as alive only with the start time it was recorded with", () => {
  const mine = stamp(process.pid)
  assert.equal(parseStamp(mine)?.pid, process.pid)
  assert.notEqual(startTime(process.pid), "", "the start time of a live process can be read on this machine")
  assert.ok(alive(mine))
  assert.ok(!alive(`${process.pid} ps:Thu Jan  1 00:00:00 1970`), "same pid, different start time: a reused pid")
  assert.ok(alive(String(process.pid)), "a stamp from an older version (pid only) falls back to the pid")
  assert.ok(!alive("999999999"))
  assert.ok(!alive(""))
  assert.ok(!alive(null))
})

test("the tracker lock: a live holder keeps it, a dead or reused pid does not", () => {
  const dir = tmp()
  const file = join(dir, "tracker.lock")
  lock(file)
  assert.equal(readFileSync(file, "utf8"), stamp(process.pid))
  lock(file) // our own lock: taken again
  writeFileSync(file, "999999999 ps:gone")
  lock(file)
  assert.equal(readFileSync(file, "utf8"), stamp(process.pid), "a dead holder is replaced")
  writeFileSync(file, `${process.ppid} ps:Thu Jan  1 00:00:00 1970`)
  lock(file)
  assert.equal(readFileSync(file, "utf8"), stamp(process.pid), "a live pid with another start time is a reused pid")
  writeFileSync(file, stamp(process.ppid))
  assert.throws(() => lock(file), TrackerBusy)
  writeFileSync(`${file}.takeover`, "999999999 ps:gone") // a takeover that died half-way does not block the next one
  writeFileSync(file, "999999999 ps:gone")
  lock(file)
  assert.equal(readFileSync(file, "utf8"), stamp(process.pid))
})

test("a command is started once, and its state is read from the marker", async () => {
  const dir = tmp()
  assert.equal(processState(dir, "job", 0), "running", "no marker yet: give the launch a few polls")
  assert.equal(processState(dir, "job", 5), "gone")
  assert.equal(startOnce(dir, "job", ["sh", "-c", "sleep 0.4; exit 3"], join(dir, "out.log"), null, dir), true)
  assert.equal(startOnce(dir, "job", ["sh", "-c", "echo twice"], join(dir, "out2.log"), null, dir), false, "the marker stops a second start")
  assert.ok(parseStamp(readFileSync(join(dir, "job.pid"), "utf8")), "the marker holds the pid")
  assert.equal(processState(dir, "job", 9), "running")
  for (let i = 0; i < 50 && processState(dir, "job", 9) === "running"; i++) await sleep(50)
  assert.equal(processState(dir, "job", 9), 3)

  const reused = tmp() // a marker whose pid now belongs to another process, and no exit status
  writeFileSync(join(reused, "job.pid"), `${process.pid} ps:Thu Jan  1 00:00:00 1970`)
  assert.equal(processState(reused, "job", 9), "gone")
  const crashed = tmp() // a crash between the marker and the spawn: never started, never started again
  writeFileSync(join(crashed, "job.pid"), "")
  assert.equal(startOnce(crashed, "job", ["true"], join(crashed, "o"), null, crashed), false)
  assert.equal(processState(crashed, "job", 9), "gone")
})
