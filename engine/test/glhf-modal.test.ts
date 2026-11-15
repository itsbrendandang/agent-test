// Analyses on Modal (ANALYSIS_BACKEND=modal, glhf/modal.ts): who may ask, what is refused while paid calls are off,
// how the runner is started, how the cost is capped and counted, and what a cancel does about the Modal sandboxes.
// Fakes only: the runner is a stub (GLHF_LOCAL_CMD), so is the last net (GLHF_MODAL_CLEANUP_CMD) and Docker
// (GLHF_DOCKER_CMD). Nothing reaches Modal, no model is called, nothing is billed. The Modal sandbox itself is tested
// with a fake Modal in glhf/bixbench_v1/tests/glhf_modal_test.py.
import assert from "node:assert/strict"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { after, before, test } from "node:test"
import type { GlhfRun, RunRequest } from "../src/glhf/types.ts"

const here = dirname(fileURLToPath(import.meta.url))
const runs = mkdtempSync(join(tmpdir(), "glhf-modal-"))
const board = mkdtempSync(join(tmpdir(), "glhf-modal-board-"))
const stubLog = join(runs, "stub.log"), cleanupLog = join(runs, "cleanup.log")
const fixture = (name: string) => `${process.execPath} ${join(here, "fixtures", name)}`
process.env.GLHF_RUNS_DIR = runs
process.env.DRUG_BOARD_RUNS_DIR = board // the board's daily cap reads its runs here, not in board/runs
process.env.GLHF_LOCAL_CMD = fixture("modal-runner-stub.mjs")
process.env.GLHF_MODAL_CLEANUP_CMD = fixture("modal-cleanup-stub.mjs") // Modal is never asked
process.env.GLHF_DOCKER_CMD = fixture("docker-stub.mjs") // nor Docker
process.env.GLHF_DOCKER_STUB_STATE = join(runs, "docker-state.json")
process.env.GLHF_DOCKER_STUB_LOG = join(runs, "docker.log")
process.env.GLHF_BIXBENCH3_CMD = fixture("bixbench3-fail-stub.mjs")
process.env.GLHF_STUB_LOG = stubLog
process.env.GLHF_CLEANUP_LOG = cleanupLog
process.env.GLHF_LOCAL_POLL_MS = "40"
process.env.GLHF_CANCEL_INT_MS = "300"
process.env.GLHF_MODAL_CANCEL_INT_MS = "300"
process.env.GLHF_CANCEL_GRACE_MS = "300"
process.env.GLHF_CANCEL_KILL_MS = "2000"
delete process.env.GLHF_MODAL_MAX_USD
delete process.env.ANALYSIS_BACKEND

// Imported only now: store.ts reads GLHF_RUNS_DIR when it loads.
const { createApp } = await import("../src/app.ts")
const { sessionToken, startTracker, stopTracker, needsToken, paidRun: tokenToCancel } = await import("../src/glhf/routes.ts")
const { loadStored, RUNS, saveStored, settingsOf } = await import("../src/glhf/store.ts")
const { BadRequest, checkRequest, checkStart } = await import("../src/glhf/tracker.ts")
const { paidRun } = await import("../src/glhf/task.ts")
const modal = await import("../src/glhf/modal.ts")
const { spentToday } = await import("../src/board/board.ts")
const { loadConfig } = await import("../src/config.ts")
const { extras, pairKey } = await import("../src/glhf/scoreboard.ts")
const { setPaidOverride } = await import("../src/paid/paid.ts")

const DASH = "http://127.0.0.1:5317"
const NOBODY = { token: false, origin: false }, DASHBOARD = { token: false, origin: true }, CLI = { token: true, origin: false }
const LOCAL = { mode: "local", solver: "glhf", model: "mock" } as const
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
/** Paid calls on for one test's body (this process only; nothing here can spend). */
const paidOn = () => { process.env.NO_PAID_CALLS = "0" }
const paidOff = () => { delete process.env.NO_PAID_CALLS }
const withEnv = <T,>(vars: Record<string, string | undefined>, work: () => T): T => {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
  for (const [k, v] of Object.entries(vars)) v === undefined ? delete process.env[k] : (process.env[k] = v)
  try { return work() } finally { for (const [k, v] of Object.entries(before)) v === undefined ? delete process.env[k] : (process.env[k] = v) }
}

let server: Server, base = ""
before(async () => {
  assert.equal(RUNS, runs, "the tracker must not work in glhf/runs during tests")
  setPaidOverride(undefined)
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
  rmSync(board, { recursive: true, force: true })
})

// --- the settings ------------------------------------------------------------------------------------------------
test("ANALYSIS_BACKEND is local unless it says modal, and a value it does not know is refused", () => {
  assert.equal(modal.analysisBackend({}), "local")
  assert.equal(modal.analysisBackend({ ANALYSIS_BACKEND: "" }), "local")
  assert.equal(modal.analysisBackend({ ANALYSIS_BACKEND: " Modal " }), "modal")
  assert.equal(modal.analysisBackend({ ANALYSIS_BACKEND: "local" }), "local")
  for (const typo of ["docker", "modl", "cloud", "1"]) assert.throws(() => modal.analysisBackend({ ANALYSIS_BACKEND: typo }), modal.BadSetting, typo)
  assert.deepEqual(modal.analysisStatus({ ANALYSIS_BACKEND: "modal" }), { backend: "modal", modalMaxUsd: 2 })
  assert.equal(modal.analysisStatus({ ANALYSIS_BACKEND: "modl" }).backend, null)
})

test("the per-run Modal cap is a positive number, never read as no cap", () => {
  assert.equal(modal.modalMaxUsd({}), modal.DEFAULT_MODAL_MAX_USD)
  assert.equal(modal.modalMaxUsd({ GLHF_MODAL_MAX_USD: "0.75" }), 0.75)
  for (const bad of ["0", "-1", "$2", "none", "Infinity"]) assert.throws(() => modal.modalMaxUsd({ GLHF_MODAL_MAX_USD: bad }), modal.BadSetting, bad)
})

// --- who may start what ------------------------------------------------------------------------------------------
test("while paid calls are off, Modal is refused with the reason and is not replaced by this machine", () => {
  paidOff()
  withEnv({ ANALYSIS_BACKEND: "modal" }, () => {
    assert.throws(() => checkRequest(LOCAL, CLI), (e: any) => e instanceof BadRequest && e.field === "analysisBackend"
      && /billed by Modal, also with the scripted model/.test(e.message) && /not run on this machine instead/.test(e.message) && /NO_PAID_CALLS/.test(e.message))
    // Only the engine's setting chooses: a body that asks for this machine is still refused.
    assert.throws(() => checkRequest({ ...LOCAL, analysisBackend: "local" } as Partial<RunRequest>, NOBODY), (e: any) => e.field === "analysisBackend")
    assert.equal(paidRun({ ...LOCAL, analysisBackend: "modal" })?.includes("analyses on Modal"), true)
    assert.equal(paidRun({ ...LOCAL }), undefined)
  })
  withEnv({ ANALYSIS_BACKEND: "local" }, () => {
    // ANALYSIS_BACKEND=local is free, and a body that asks for Modal does not change that.
    assert.equal(checkRequest(LOCAL, NOBODY).analysisBackend, undefined)
    assert.equal(checkRequest({ ...LOCAL, analysisBackend: "modal" } as Partial<RunRequest>, NOBODY).analysisBackend, undefined)
  })
})

test("with paid calls on, Modal needs a known caller and gets the run's cap", () => {
  paidOn()
  try {
    withEnv({ ANALYSIS_BACKEND: "modal", GLHF_MODAL_MAX_USD: "1.5" }, () => {
      assert.throws(() => checkRequest(LOCAL, NOBODY), (e: any) => e.field === "analysisBackend" && /cost money/.test(e.message))
      const request = checkRequest(LOCAL, DASHBOARD)
      assert.equal(request.analysisBackend, "modal")
      assert.equal(request.modalMaxUsd, 1.5)
      assert.deepEqual(settingsOf(request), { timeLimit: 1800, analysisBackend: "modal" })
      // A pair shares where its analyses run, so both sides stay comparable.
      const pair = checkStart({ ...LOCAL, solver: undefined, solvers: ["glhf", "single"] }, CLI)
      assert.deepEqual(pair.map((r) => r.analysisBackend), ["modal", "modal"])
      // A caller cannot set its own cap.
      assert.equal(checkRequest({ ...LOCAL, modalMaxUsd: 999 } as Partial<RunRequest>, CLI).modalMaxUsd, 1.5)
    })
    withEnv({ ANALYSIS_BACKEND: "modl" }, () => assert.throws(() => checkRequest(LOCAL, CLI), (e: any) => e.field === "analysisBackend" && /ANALYSIS_BACKEND must be/.test(e.message)))
    withEnv({ ANALYSIS_BACKEND: "modal", GLHF_MODAL_MAX_USD: "free" }, () => assert.throws(() => checkRequest(LOCAL, CLI), /GLHF_MODAL_MAX_USD/))
    const cloud = { mode: "cloud", solver: "glhf", model: "openai/gpt-5.5", task: "9", effort: "high", project: "p", billCloud: true, maxHours: 1 }
    withEnv({ ANALYSIS_BACKEND: "modal" }, () => assert.equal(checkRequest(cloud as never, CLI).analysisBackend, undefined, "a cloud run ignores the setting"))
  } finally { paidOff() }
})

test("Modal needs the token over HTTP, and a run on Modal is stopped only by the token", () => {
  withEnv({ ANALYSIS_BACKEND: "modal" }, () => {
    assert.equal(needsToken(LOCAL), true)
    assert.equal(needsToken({ ...LOCAL, analysisBackend: "local" }), true, "the body does not choose")
    assert.equal(needsToken({ ...LOCAL, mode: "cloud" }), true, "a cloud run needs the token for itself")
  })
  withEnv({ ANALYSIS_BACKEND: "local" }, () => {
    assert.equal(needsToken(LOCAL), false)
    assert.equal(needsToken({ ...LOCAL, analysisBackend: "modal" }), false, "the body does not choose")
  })
  withEnv({ ANALYSIS_BACKEND: "nonsense" }, () => assert.equal(needsToken(LOCAL), true, "a bad setting gets the stricter rule"))
  const run = { id: "x", mode: "local", task: "demo", solver: "glhf", model: "mock", roleModels: {}, phase: "running", startedAt: 0 } as GlhfRun
  assert.equal(tokenToCancel(run), false)
  assert.equal(tokenToCancel({ ...run, settings: { analysisBackend: "modal" } }), true)
})

test("runs on Modal are compared only with runs on Modal, and say so", () => {
  const run = { id: "x", mode: "local", task: "demo", solver: "glhf", model: "mock", roleModels: {}, phase: "done", startedAt: 0, settings: { timeLimit: 1800 } } as GlhfRun
  const onModal = { ...run, settings: { timeLimit: 1800, analysisBackend: "modal" as const } }
  assert.notEqual(pairKey(run), pairKey(onModal))
  assert.ok(extras(onModal).includes("analyses on Modal") && !extras(run).includes("analyses on Modal"))
})

// --- cost: per run and per day -----------------------------------------------------------------------------------
const record = (id: string, phase: GlhfRun["phase"], startedAt: number, request: Partial<RunRequest>) => {
  const run = { id, mode: "local", task: "demo", solver: "glhf", model: "mock", roleModels: {}, phase, startedAt } as GlhfRun
  saveStored({ run, request: { ...LOCAL, ...request } as RunRequest })
  return join(runs, id)
}

test("what Modal runs spent today is counted in the daily cap that answers and reviews share", () => {
  const now = new Date(), today = now.getTime(), yesterday = today - 26 * 3_600_000
  const ledger = (dir: string, ...usd: number[]) => { for (const u of usd) appendFileSync(join(dir, modal.MODAL_LEDGER), `${JSON.stringify({ usd: u })}\n`); appendFileSync(join(dir, modal.MODAL_LEDGER), "{half a line\n") }
  const before = modal.glhfModalSpentToday(now)
  const settledDir = record("m-settled", "done", today, { analysisBackend: "modal", modalMaxUsd: 2 })
  ledger(settledDir, 0.25, 0.05)
  assert.deepEqual(modal.modalSpent(settledDir), { usd: 0.3, sandboxes: 2 })
  record("m-running", "running", today, { analysisBackend: "modal", modalMaxUsd: 1.5 }) // its whole cap while it runs
  const killed = record("m-killed", "failed", today, { analysisBackend: "modal", modalMaxUsd: 0.5 })
  writeFileSync(join(killed, modal.MODAL_MARKER), "{}") // prepared, no ledger to read: its whole cap
  record("m-never", "failed", today, { analysisBackend: "modal", modalMaxUsd: 4 }) // refused before Modal: nothing
  ledger(record("m-old", "done", yesterday, { analysisBackend: "modal", modalMaxUsd: 2 }), 9)
  ledger(record("m-local", "done", today, {}), 9) // not a Modal run
  assert.ok(Math.abs(modal.glhfModalSpentToday(now) - before - (0.3 + 1.5 + 0.5)) < 1e-9)
  // The board's daily total is where it counts: answers, reviews and Modal runs together.
  const config = loadConfig()
  assert.ok(Math.abs(spentToday(config, now) - modal.glhfModalSpentToday(now)) < 1e-9, "no board run or answer in this test's folder")
  for (const id of ["m-settled", "m-running", "m-killed", "m-never", "m-old", "m-local"]) rmSync(join(runs, id), { recursive: true, force: true })
})

// --- the runner, through the real routes and tracker ----------------------------------------------------------------
const call = async (body: unknown, token = sessionToken()) => {
  const res = await fetch(`${base}/api/glhf/runs`, { method: "POST", headers: { origin: DASH, "content-type": "application/json", ...(token && { "x-glhf-token": token }) }, body: JSON.stringify(body) })
  return { status: res.status, body: (await res.json()) as any }
}
const run = (id: string) => loadStored(id)!.run
const until = async (what: string, ok: () => boolean, ms = 15_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(25)) if (ok()) return
  assert.fail(`timed out waiting for ${what}`)
}
const settledRun = (id: string) => ["done", "failed", "cancelled"].includes(run(id).phase)
const lines = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean) : [])

test("a run on Modal starts the runner with --sandbox modal and its cap, and records what it cost", async () => {
  paidOn()
  try {
    process.env.ANALYSIS_BACKEND = "modal"
    process.env.GLHF_MODAL_MAX_USD = "0.8"
    process.env.GLHF_STUB_MS = "200"
    process.env.GLHF_STUB_USD = "0.0123"
    const refused = await call({ mode: "local", model: "mock", solver: "glhf" }, "")
    assert.equal(refused.status, 401, "the dashboard's page without the token may not start a billed run")
    const sent = await call({ mode: "local", model: "mock", solver: "glhf" })
    assert.equal(sent.status, 201, JSON.stringify(sent.body))
    const id = sent.body.id as string
    assert.equal(run(id).settings?.analysisBackend, "modal")
    assert.equal(loadStored(id)!.request.modalMaxUsd, 0.8)
    await until("the run to finish", () => settledRun(id))
    assert.equal(run(id).phase, "done", run(id).error ?? "")
    const started = lines(stubLog).find((l) => l.startsWith("start") && l.includes(id))!
    assert.match(started, /--sandbox modal --modal-usd-cap 0\.8/)
    assert.deepEqual(run(id).modal, { usd: 0.0123, sandboxes: 1, maxUsd: 0.8 })
  } finally { delete process.env.ANALYSIS_BACKEND; delete process.env.GLHF_MODAL_MAX_USD; paidOff() }
})

test("a start that could pass the daily dollar cap is refused before anything runs", async () => {
  paidOn()
  try {
    process.env.ANALYSIS_BACKEND = "modal"
    process.env.GLHF_MODAL_MAX_USD = String(loadConfig().meeting.daily_usd + 1)
    const sent = await call({ mode: "local", model: "mock", solver: "glhf" })
    assert.equal(sent.status, 429)
    assert.match(sent.body.error, /daily spending limit would be passed/)
    assert.match(sent.body.error, /ANALYSIS_BACKEND=local/)
  } finally { delete process.env.ANALYSIS_BACKEND; delete process.env.GLHF_MODAL_MAX_USD; paidOff() }
})

test("cancelling a run on Modal stops the runner and terminates what it left on Modal", async () => {
  paidOn()
  try {
    process.env.ANALYSIS_BACKEND = "modal"
    process.env.GLHF_STUB_MS = "20000"
    process.env.GLHF_STUB_IGNORE_INT = "1" // a runner that hangs while it cleans up: it has to be killed
    process.env.GLHF_CLEANUP_SAY = "left"
    const sent = await call({ mode: "local", model: "mock", solver: "glhf" })
    assert.equal(sent.status, 201, JSON.stringify(sent.body))
    const id = sent.body.id as string
    await until("the runner to prepare Modal", () => existsSync(join(runs, id, modal.MODAL_MARKER)))
    const res = await fetch(`${base}/api/glhf/runs/${id}/cancel`, { method: "POST", headers: { origin: DASH, "x-glhf-token": sessionToken() } })
    const cancelled = (await res.json()) as GlhfRun
    assert.equal(res.status, 200)
    assert.equal(cancelled.phase, "cancelled")
    assert.match(cancelled.detail ?? "", /1 Modal sandbox left by the runner terminated/)
    assert.ok(lines(cleanupLog).some((l) => l === `terminate --run-dir ${join(runs, id)}`))
  } finally {
    delete process.env.ANALYSIS_BACKEND; delete process.env.GLHF_STUB_IGNORE_INT; delete process.env.GLHF_CLEANUP_SAY; paidOff()
  }
})

test("the last net says when Modal could not be asked", async () => {
  const dir = join(runs, "net-only")
  mkdirSync(dir, { recursive: true })
  assert.equal(await modal.terminateModal(dir), undefined, "no marker: the runner never reached Modal")
  writeFileSync(join(dir, modal.MODAL_MARKER), "{}")
  process.env.GLHF_CLEANUP_SAY = "broken"
  try {
    const cleanup = await modal.terminateModal(dir)
    assert.equal(cleanup?.checked, false)
    assert.match(modal.modalNote(cleanup), /could not be checked \(modal.exception.AuthError: token missing\); they end at their timeout/)
  } finally { delete process.env.GLHF_CLEANUP_SAY }
  process.env.GLHF_CLEANUP_SAY = "none"
  try { assert.equal(modal.modalNote(await modal.terminateModal(dir)), "Modal shows no sandbox of this run still running") } finally { delete process.env.GLHF_CLEANUP_SAY }
  assert.equal(modal.modalNote(undefined), "")
})

test("the status tells the dashboard where the analyses run", async () => {
  process.env.ANALYSIS_BACKEND = "modal"
  try {
    const { statusBody } = await import("../src/glhf/doctor.ts")
    const body = await statusBody()
    assert.deepEqual(body.analysis, { backend: "modal", modalMaxUsd: 2 })
  } finally { delete process.env.ANALYSIS_BACKEND }
})
