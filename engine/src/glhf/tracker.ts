// The tracker: one Pi Durable Harness over glhf/runs/tracker.sqlite that runs a `glhf.run` task per benchmark
// run. No model is involved. Only one process may drive it at a time (the engine server, or a CLI command when
// the server is not running); a lock file enforces that, so a run is never launched twice by two trackers.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { createModels } from "@earendil-works/pi-ai"
import { createRegistry, defineExtension, Harness, type TaskId } from "@earendil-works/pi-durable"
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node"
import { DEMO_CASE, listStored, loadStored, newRunId, patchRun, RUNS, saveStored } from "./store.ts"
import { type RunInput, type RunResult, RunTask } from "./task.ts"
import type { GlhfRun, RunRequest } from "./types.ts"

const ctx = BACKGROUND_CONTEXT
const LOCK = `${RUNS}/tracker.lock`
const ROLES = ["planner", "experimenter", "critic", "reporter"]

export class TrackerBusy extends Error {
  pid: number
  constructor(pid: number) { super(`another process (pid ${pid}) is tracking runs`); this.pid = pid }
}
export class BadRequest extends Error {}

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

function lock() {
  mkdirSync(RUNS, { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try { writeFileSync(LOCK, String(process.pid), { flag: "wx" }); return } catch {
      const holder = Number(existsSync(LOCK) ? readFileSync(LOCK, "utf8") : 0)
      if (holder && holder !== process.pid && alive(holder)) throw new TrackerBusy(holder)
      rmSync(LOCK, { force: true }) // left by a process that died
    }
  }
  throw new Error(`could not take ${LOCK}`)
}

/** Check a request and fill defaults. `trusted` (the CLI) may also start cloud runs and name a case directory. */
export function checkRequest(body: Partial<RunRequest>, trusted: boolean): RunRequest {
  const bad = (why: string) => { throw new BadRequest(why) }
  if (body.mode !== "local" && body.mode !== "cloud") bad('mode must be "local" or "cloud"')
  if (body.solver !== "single" && body.solver !== "glhf") bad('solver must be "single" or "glhf"')
  if (typeof body.model !== "string" || !body.model) bad("model is required")
  const roleModels = body.roleModels ?? {}
  for (const [role, model] of Object.entries(roleModels)) {
    if (!ROLES.includes(role) || typeof model !== "string" || !model.includes("/")) bad(`roleModels: ${role} must be one of ${ROLES.join(", ")} and name a provider/model`)
  }
  if (Object.keys(roleModels).length && body.solver !== "glhf") bad("roleModels need solver glhf")
  if (Object.keys(roleModels).length && body.model === "mock") bad("roleModels cannot be combined with the mock model")
  if (body.mode === "cloud") {
    if (!trusted) bad("cloud runs start from the CLI: npm run glhf -- run --mode cloud ...")
    if (!body.task || !body.effort || !body.project) bad("cloud runs need task, effort and project")
    if (body.model === "mock") bad("cloud runs need a real model")
  } else if ((body.task ?? "demo") !== "demo" && !(trusted && body.caseDir)) {
    bad("local runs cover the demo case only; BixBench3 tasks need the cloud runner (mode cloud)")
  }
  const request: RunRequest = { mode: body.mode!, task: body.task ?? "demo", solver: body.solver!, model: body.model!, roleModels }
  if (body.effort) request.effort = String(body.effort)
  if (body.project) request.project = String(body.project)
  if (body.resultsBucket) request.resultsBucket = String(body.resultsBucket)
  if (body.timeLimit) request.timeLimit = Math.max(60, Math.floor(Number(body.timeLimit)))
  const whole = (name: string, value: unknown) => { const n = Number(value); if (!Number.isInteger(n) || n < 1) bad(`${name} must be a whole number above 0`); return n }
  if (body.maxTokens !== undefined) request.maxTokens = whole("maxTokens", body.maxTokens)
  if (body.seed !== undefined) request.seed = whole("seed", body.seed)
  if (body.maxMessagesPerRole !== undefined || body.exa || body.memory) {
    if (body.solver !== "glhf") bad("maxMessagesPerRole, exa and memory need solver glhf")
    if (body.mode === "cloud") bad("maxMessagesPerRole, exa and memory are for local runs so far; the cloud runner does not pass them on yet")
    if (body.exa && !process.env.EXA_API_KEY) bad("exa needs EXA_API_KEY in .env")
    if (body.maxMessagesPerRole !== undefined) request.maxMessagesPerRole = whole("maxMessagesPerRole", body.maxMessagesPerRole)
    if (body.exa) request.exa = true
    if (body.memory) request.memory = true
  }
  if (body.mode === "cloud" && (body.maxTokens !== undefined || body.seed !== undefined)) bad("maxTokens and seed are for local runs so far; the cloud runner does not pass them on yet")
  if (body.reviewRounds) request.reviewRounds = Math.max(1, Math.floor(Number(body.reviewRounds)))
  if (body.mode === "local") request.caseDir = trusted && body.caseDir ? body.caseDir : DEMO_CASE
  return request
}

export interface Tracker {
  start(request: RunRequest): Promise<GlhfRun>
  /** Resolves when the run is done or failed. */
  wait(id: string): Promise<GlhfRun>
  /** Runs that are still being tracked. */
  unfinished(): GlhfRun[]
  close(): Promise<void>
}

export async function openTracker(): Promise<Tracker> {
  lock()
  const registry = createRegistry()
  registry.install(defineExtension({ name: "glhf", tasks: [RunTask] }))
  const harness = await Harness.open(await openNodeSqliteStorage(`${RUNS}/tracker.sqlite`), {
    models: createModels(), // required by the Harness; the tracker never calls a model
    registry,
    onReport: (report) => console.error(`glhf tracker: ${report.kind}`, report.error),
  }, ctx)
  const root = await harness.root(ctx)

  const createTask = async (input: RunInput) => {
    let taskId: TaskId<RunResult> | undefined
    await root.commit(async (tx) => {
      taskId = await tx.createTask(RunTask, input, { ownership: { kind: "conversation" }, background: true })
    }, ctx)
    const stored = loadStored(input.id)!
    saveStored({ ...stored, taskId: taskId as unknown as number })
    return taskId!
  }

  // A run whose record was written but whose task was not (a crash between the two) gets its task now. A record
  // whose task has already settled keeps the task's verdict.
  for (const stored of listStored()) {
    if (stored.run.phase === "done" || stored.run.phase === "failed") continue
    if (stored.taskId === undefined) { await createTask({ ...stored.request, id: stored.run.id }); continue }
    const task = await harness.getTask(stored.taskId as unknown as TaskId<RunResult>, ctx)
    if (!task) patchRun(stored.run.id, { phase: "failed", error: "its tracking task is missing from tracker.sqlite", finishedAt: Date.now() })
    else if (task.state.status === "terminal") patchRun(stored.run.id, { phase: "failed", error: `tracking ended (${task.state.outcome.status}) without a result`, finishedAt: Date.now() })
  }
  harness.resume() // continue every unfinished run from its last checkpoint

  return {
    async start(request) {
      const id = newRunId(request.task ?? "demo", request.solver)
      const run: GlhfRun = { id, mode: request.mode, task: request.task ?? "demo", solver: request.solver, model: request.model, roleModels: request.roleModels ?? {}, phase: "queued", startedAt: Date.now() }
      saveStored({ run, request })
      await createTask({ ...request, id })
      return run
    },
    async wait(id) {
      const stored = loadStored(id)
      if (!stored) throw new BadRequest(`no such run: ${id}`)
      if (stored.taskId !== undefined && stored.run.phase !== "done" && stored.run.phase !== "failed") {
        await harness.waitForTask(stored.taskId as unknown as TaskId<RunResult>, ctx)
      }
      return loadStored(id)!.run
    },
    unfinished: () => listStored().map((s) => s.run).filter((r) => r.phase !== "done" && r.phase !== "failed"),
    async close() {
      await harness.close(ctx)
      rmSync(LOCK, { force: true })
    },
  }
}
