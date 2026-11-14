// The tracker: one Pi Durable Harness over glhf/runs/tracker.sqlite that runs a `glhf.run` task per benchmark
// run. No model is involved. Only one process may drive it at a time (the engine server, or a CLI command when
// the server is not running); a lock file enforces that, so a run is never launched twice by two trackers.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { createModels } from "@earendil-works/pi-ai"
import { createRegistry, defineExtension, Harness, type TaskId } from "@earendil-works/pi-durable"
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node"
import { alive, parseStamp, stamp } from "./proc.ts"
import { DEMO_CASE, listStored, loadStored, newRunId, patchRun, publicRun, RUNS, saveStored, settingsOf } from "./store.ts"
import { type RunInput, type RunResult, RunTask } from "./task.ts"
import { type GlhfRun, MAX_MESSAGES_PER_ROLE, MAX_REVIEW_ROUNDS, MAX_TIME_LIMIT, MAX_TOKENS, type RunRequest } from "./types.ts"

const ctx = BACKGROUND_CONTEXT
const LOCK = `${RUNS}/tracker.lock`
const ROLES = ["planner", "experimenter", "critic", "reporter"]

export class TrackerBusy extends Error {
  pid: number
  constructor(pid: number) { super(`another process (pid ${pid}) is tracking runs`); this.pid = pid }
}
export class BadRequest extends Error {}

const read = (file: string) => { try { return readFileSync(file, "utf8") } catch { return null } }

/**
 * Take the tracker lock, or throw TrackerBusy. The lock holds "<pid> <start time>", so a pid reused by another
 * program does not keep it. A lock left by a dead process is replaced under a second, short-lived lock, so two
 * processes that both find it stale cannot both end up holding it.
 */
export function lock(file = LOCK) {
  mkdirSync(RUNS, { recursive: true })
  const me = stamp(process.pid)
  const take = () => { try { writeFileSync(file, me, { flag: "wx" }); return true } catch { return false } }
  if (take()) return
  const takeover = `${file}.takeover`
  for (let attempt = 0; attempt < 50; attempt++) {
    const holder = read(file)
    if (holder !== null && parseStamp(holder)?.pid !== process.pid && alive(holder)) throw new TrackerBusy(parseStamp(holder)!.pid)
    try { writeFileSync(takeover, me, { flag: "wx" }) } catch {
      // Another process is replacing the stale lock right now. If it died doing so, clear its marker.
      const age = Date.now() - (statSync(takeover, { throwIfNoEntry: false })?.mtimeMs ?? Date.now())
      if (age > 10_000 || !alive(read(takeover))) rmSync(takeover, { force: true })
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
      continue
    }
    try {
      const now = read(file) // look again: it may have changed hands while we were getting here
      if (now !== null && parseStamp(now)?.pid !== process.pid && alive(now)) throw new TrackerBusy(parseStamp(now)!.pid)
      rmSync(file, { force: true })
      if (take()) return
    } finally { rmSync(takeover, { force: true }) }
  }
  throw new Error(`could not take ${file}`)
}

/**
 * Who is asking. `token`: the caller holds the CLI's token (a local user). `origin`: the request came from the
 * dashboard's own page. A plain `true` means token, `false` means neither (any web page, any host on the network).
 */
export type Trust = boolean | { token: boolean; origin: boolean }

/**
 * Check a request and fill defaults.
 *   cloud runs, and naming a case directory:  token only (they cost real money, or read any folder)
 *   a real model, Exa search, memory:         token, or the dashboard's own page
 *   anyone else:                              the scripted demo only
 */
export function checkRequest(body: Partial<RunRequest>, trust: Trust): RunRequest {
  const token = trust === true || (typeof trust === "object" && trust.token)
  const known = token || (typeof trust === "object" && trust.origin)
  const bad = (why: string): never => { throw new BadRequest(why) }
  if (typeof body !== "object" || body === null || Array.isArray(body)) bad("the request body must be a JSON object")
  if (body.mode !== "local" && body.mode !== "cloud") bad('mode must be "local" or "cloud"')
  if (body.solver !== "single" && body.solver !== "glhf") bad('solver must be "single" or "glhf"')
  if (typeof body.model !== "string" || !body.model || body.model.length > 200 || !/^[\w./:@-]+$/.test(body.model)) bad("model is required (a model id such as anthropic/claude-sonnet-5-5, or mock)")
  if (body.task !== undefined && (typeof body.task !== "string" || body.task.length > 100)) bad("task must be a short text")
  if (body.caseDir !== undefined && typeof body.caseDir !== "string") bad("caseDir must be a path")
  const roleModels = body.roleModels ?? {}
  if (typeof roleModels !== "object" || Array.isArray(roleModels)) bad("roleModels must be an object")
  for (const [role, model] of Object.entries(roleModels)) {
    if (!ROLES.includes(role) || typeof model !== "string" || !model.includes("/")) bad(`roleModels: ${role} must be one of ${ROLES.join(", ")} and name a provider/model`)
  }
  if (Object.keys(roleModels).length && body.solver !== "glhf") bad("roleModels need solver glhf")
  if (Object.keys(roleModels).length && body.model === "mock") bad("roleModels cannot be combined with the mock model")
  const cli = "start it from the CLI (npm run glhf -- run ...), which holds this machine's token"
  if (body.mode === "cloud") {
    if (!token) bad(`cloud runs cost money: ${cli}`)
    if (!body.task || !body.effort || !body.project) bad("cloud runs need task, effort and project")
    if (body.model === "mock") bad("cloud runs need a real model")
  } else {
    if (body.caseDir && !token) bad(`a case directory can only be named by a local user: ${cli}`)
    if ((body.task ?? "demo") !== "demo" && !body.caseDir) bad("local runs cover the demo case only; BixBench3 tasks need the cloud runner (mode cloud)")
  }
  if (body.model !== "mock" && !known) bad(`runs with a real model cost money, so they start from the dashboard or the CLI: ${cli}`)
  if ((body.exa || body.memory) && !known) bad(`exa and memory are not open to unknown callers: ${cli}`)
  const request: RunRequest = { mode: body.mode!, task: body.task ?? "demo", solver: body.solver!, model: body.model!, roleModels }
  if (body.effort) request.effort = String(body.effort).slice(0, 40)
  if (body.project) request.project = String(body.project).slice(0, 100)
  if (body.resultsBucket) request.resultsBucket = String(body.resultsBucket).slice(0, 300)
  const whole = (name: string, value: unknown, max: number, min = 1) => {
    const n = Number(value)
    if (!Number.isInteger(n) || n < min || n > max) bad(`${name} must be a whole number from ${min} to ${max}`)
    return n
  }
  if (body.timeLimit !== undefined && body.timeLimit !== null) request.timeLimit = whole("timeLimit (seconds)", body.timeLimit, MAX_TIME_LIMIT, 60)
  if (body.maxTokens !== undefined) request.maxTokens = whole("maxTokens", body.maxTokens, MAX_TOKENS, 1_000)
  if (body.seed !== undefined) request.seed = whole("seed", body.seed, 2 ** 31 - 1)
  if (body.maxMessagesPerRole !== undefined || body.exa || body.memory) {
    if (body.solver !== "glhf") bad("maxMessagesPerRole, exa and memory need solver glhf")
    if (body.mode === "cloud") bad("maxMessagesPerRole, exa and memory are for local runs so far; the cloud runner does not pass them on yet")
    if (body.exa && !process.env.EXA_API_KEY) bad("exa needs EXA_API_KEY in .env")
    if (body.maxMessagesPerRole !== undefined) request.maxMessagesPerRole = whole("maxMessagesPerRole", body.maxMessagesPerRole, MAX_MESSAGES_PER_ROLE, 2)
    if (body.exa) request.exa = true
    if (body.memory) request.memory = true
  }
  if (body.mode === "cloud" && (body.maxTokens !== undefined || body.seed !== undefined || body.timeLimit)) bad("timeLimit, maxTokens and seed are for local runs so far; the cloud runner does not pass them on yet")
  if (body.reviewRounds !== undefined && body.reviewRounds !== null) request.reviewRounds = whole("reviewRounds", body.reviewRounds, MAX_REVIEW_ROUNDS)
  if (body.mode === "local") request.caseDir = token && body.caseDir ? body.caseDir : DEMO_CASE
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
      const run: GlhfRun = { id, mode: request.mode, task: request.task ?? "demo", solver: request.solver, model: request.model, roleModels: request.roleModels ?? {}, settings: settingsOf(request), phase: "queued", startedAt: Date.now() }
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
      return publicRun(loadStored(id)!)
    },
    unfinished: () => listStored().map(publicRun).filter((r) => r.phase !== "done" && r.phase !== "failed"),
    async close() {
      await harness.close(ctx)
      rmSync(LOCK, { force: true })
    },
  }
}
