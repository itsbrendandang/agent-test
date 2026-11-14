// The tracker: one Pi Durable Harness over glhf/runs/tracker.sqlite that runs a `glhf.run` task per benchmark
// run. No model is involved. Only one process may drive it at a time (the engine server, or a CLI command when
// the server is not running); a lock file enforces that, so a run is never launched twice by two trackers.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { createModels } from "@earendil-works/pi-ai"
import { createRegistry, defineExtension, Harness, type TaskId } from "@earendil-works/pi-durable"
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node"
import { alive, parseStamp, stamp } from "./proc.ts"
import { DEMO_CASE, listStored, loadStored, newRunId, patchRun, publicRun, runDir, RUNS, saveStored, settingsOf, trackerLog } from "./store.ts"
import { type RunInput, type RunResult, RunTask, stopAndWait } from "./task.ts"
import { type Field, type GlhfRun, LIMITS, MAX_SEED, type RunRequest, settled, type Solver, type StartBody } from "./types.ts"

const ctx = BACKGROUND_CONTEXT
const LOCK = `${RUNS}/tracker.lock`
const ROLES = ["planner", "experimenter", "critic", "reporter"]

export class TrackerBusy extends Error {
  pid: number
  constructor(pid: number) { super(`another process (pid ${pid}) is tracking runs`); this.pid = pid }
}
/** A refused request. `field` names the input the refusal is about, when there is one. */
export class BadRequest extends Error {
  field?: Field
  constructor(message: string, field?: Field) { super(message); if (field) this.field = field }
}
/** A local run is still going. Local runs share this machine's CPU under a time limit, so only one runs at a time. */
export class LocalBusy extends Error {
  run: string
  constructor(run: string) { super(`a local run is still going (${run}); wait for it to end or cancel it. Local runs go one at a time so that their timing stays comparable`); this.run = run }
}
export class NoSuchRun extends Error {}
/** The run cannot be cancelled from here. */
export class CannotCancel extends Error {}

/** A model id: starts with a letter or digit, no spaces. So it can never be read as a command-line option. */
const MODEL_ID = /^[A-Za-z0-9][\w./:@~-]{0,199}$/

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
  const bad = (why: string, field?: Field): never => { throw new BadRequest(why, field) }
  if (typeof body !== "object" || body === null || Array.isArray(body)) bad("the request body must be a JSON object")
  if (body.mode !== "local" && body.mode !== "cloud") bad('mode must be "local" or "cloud"', "mode")
  if (body.solver !== "single" && body.solver !== "glhf") bad('solver must be "single" or "glhf"', "solver")
  if (typeof body.model !== "string" || !MODEL_ID.test(body.model)) bad("model is required (a model id such as anthropic/claude-sonnet-5-5, or mock)", "model")
  if (body.task !== undefined && (typeof body.task !== "string" || body.task.length > 100)) bad("task must be a short text")
  if (body.caseDir !== undefined && typeof body.caseDir !== "string") bad("caseDir must be a path", "caseDir")
  const roleModels = body.roleModels ?? {}
  if (typeof roleModels !== "object" || Array.isArray(roleModels)) bad("roleModels must be an object")
  for (const [role, model] of Object.entries(roleModels)) {
    if (!ROLES.includes(role) || typeof model !== "string" || !model.includes("/") || !MODEL_ID.test(model)) bad(`roleModels: ${role} must be one of ${ROLES.join(", ")} and name a provider/model`)
  }
  if (Object.keys(roleModels).length && body.solver !== "glhf") bad("roleModels need solver glhf", "solver")
  if (Object.keys(roleModels).length && body.model === "mock") bad("roleModels cannot be combined with the mock model", "model")
  const cli = "start it from the CLI (npm run glhf -- run ...), which holds this machine's token"
  if (body.mode === "cloud") {
    if (!token) bad(`cloud runs cost money: ${cli}`, "mode")
    if (!body.task || !body.effort || !body.project) bad("cloud runs need task, effort and project")
    if (body.model === "mock") bad("cloud runs need a real model", "model")
  } else {
    if (body.caseDir && !token) bad(`a case directory can only be named by a local user: ${cli}`, "caseDir")
    if ((body.task ?? "demo") !== "demo" && !body.caseDir) bad("local runs cover the demo case only; BixBench3 tasks need the cloud runner (mode cloud)")
  }
  if (body.model !== "mock" && !known) bad(`runs with a real model cost money, so they start from the dashboard or the CLI: ${cli}`, "model")
  if ((body.exa || body.memory) && !known) bad(`exa and memory are not open to unknown callers: ${cli}`, body.exa ? "exa" : "memory")
  const request: RunRequest = { mode: body.mode!, task: body.task ?? "demo", solver: body.solver!, model: body.model!, roleModels }
  if (body.effort) request.effort = String(body.effort).slice(0, 40)
  if (body.project) request.project = String(body.project).slice(0, 100)
  if (body.resultsBucket) request.resultsBucket = String(body.resultsBucket).slice(0, 300)
  const whole = (name: string, field: Field, value: unknown, [min, max]: readonly [number, number]) => {
    const n = Number(value)
    if (!Number.isInteger(n) || n < min || n > max) bad(`${name} must be a whole number from ${min} to ${max}`, field)
    return n
  }
  if (body.timeLimit !== undefined && body.timeLimit !== null) request.timeLimit = whole("timeLimit (seconds)", "timeLimit", body.timeLimit, LIMITS.timeLimit)
  if (body.maxTokens !== undefined) request.maxTokens = whole("maxTokens", "maxTokens", body.maxTokens, LIMITS.maxTokens)
  if (body.seed !== undefined) request.seed = whole("seed", "seed", body.seed, [1, MAX_SEED])
  if (body.maxMessagesPerRole !== undefined || body.exa || body.memory) {
    const first: Field = body.maxMessagesPerRole !== undefined ? "maxMessagesPerRole" : body.exa ? "exa" : "memory"
    if (body.solver !== "glhf") bad("maxMessagesPerRole, exa and memory need solver glhf", first)
    if (body.mode === "cloud") bad("maxMessagesPerRole, exa and memory are for local runs so far; the cloud runner does not pass them on yet", first)
    if (body.exa && !process.env.EXA_API_KEY) bad("exa needs EXA_API_KEY in .env", "exa")
    if (body.maxMessagesPerRole !== undefined) request.maxMessagesPerRole = whole("maxMessagesPerRole", "maxMessagesPerRole", body.maxMessagesPerRole, LIMITS.maxMessagesPerRole)
    if (body.exa) request.exa = true
    if (body.memory) request.memory = true
  }
  if (body.mode === "cloud" && (body.maxTokens !== undefined || body.seed !== undefined || body.timeLimit)) {
    bad("timeLimit, maxTokens and seed are for local runs so far; the cloud runner does not pass them on yet", body.timeLimit ? "timeLimit" : body.maxTokens !== undefined ? "maxTokens" : "seed")
  }
  if (body.reviewRounds !== undefined && body.reviewRounds !== null) request.reviewRounds = whole("reviewRounds", "reviewRounds", body.reviewRounds, LIMITS.reviewRounds)
  if (body.mode === "local") request.caseDir = token && body.caseDir ? body.caseDir : DEMO_CASE
  return request
}

/** What only the swarm reads. In a pair the single-agent run does not get these; everything else is shared. */
const SWARM_ONLY = ["roleModels", "reviewRounds", "maxMessagesPerRole", "exa", "memory"] as const

/**
 * Check a POST /api/glhf/runs body: one request per run to start, in order. `solver` gives one run. `solvers` with
 * two different solvers gives a matched pair of local runs: both get the same mode, task, case, model, time limit,
 * token budget and seed (so the scoreboard pairs them, see pairKey), and the second starts when the first is settled.
 * Every run is checked before any is started, so a pair is never half refused.
 */
export function checkStart(body: StartBody, trust: Trust): RunRequest[] {
  if (typeof body !== "object" || body === null || Array.isArray(body) || body.solvers === undefined) return [checkRequest(body, trust)]
  const { solvers, ...shared } = body
  const bad = (why: string): never => { throw new BadRequest(why, "solver") }
  if (shared.solver !== undefined) bad("give solver or solvers, not both")
  if (!Array.isArray(solvers) || solvers.length < 1 || solvers.length > 2 || solvers.some((s) => s !== "single" && s !== "glhf") || new Set(solvers).size !== solvers.length) {
    bad('solvers must be ["glhf"], ["single"], or both in the order they should run, such as ["glhf", "single"]')
  }
  if (solvers.length === 2 && shared.mode !== "local") throw new BadRequest("a pair (two solvers) is for local runs; start cloud runs one by one, each has its own machine", "mode")
  return (solvers as Solver[]).map((solver) => {
    const one: Partial<RunRequest> = { ...shared, solver }
    if (solver === "single" && solvers.length === 2) for (const key of SWARM_ONLY) delete one[key]
    return checkRequest(one, trust)
  })
}

export interface Tracker {
  /** Start one run. Throws LocalBusy when it is local and a local run is still going. */
  start(request: RunRequest): Promise<GlhfRun>
  /**
   * Start the runs one after the other: each starts when the one before it is settled, however that ended. Used
   * for a matched pair. Throws LocalBusy, starting none, when a local run outside this group is still going.
   */
  startChain(requests: RunRequest[]): Promise<GlhfRun[]>
  /**
   * Stop a run and mark it cancelled. A run that is already settled is returned as it is. Throws NoSuchRun, or
   * CannotCancel for a cloud run (its VM is removed with `bixbench3 cancel`, which only a local user may do).
   */
  cancel(id: string): Promise<GlhfRun>
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
    if (settled(stored.run.phase)) continue
    if (stored.taskId === undefined) { await createTask({ ...stored.request, id: stored.run.id }); continue }
    const task = await harness.getTask(stored.taskId as unknown as TaskId<RunResult>, ctx)
    if (!task) patchRun(stored.run.id, { phase: "failed", error: "its tracking task is missing from tracker.sqlite", finishedAt: Date.now() })
    else if (task.state.status === "terminal") patchRun(stored.run.id, { phase: "failed", error: `tracking ended (${task.state.outcome.status}) without a result`, finishedAt: Date.now() })
  }
  harness.resume() // continue every unfinished run from its last checkpoint

  /** The local run that is going, or waiting for one: the oldest, so a pair is named by the run that is at work. */
  const liveLocal = () => listStored().findLast((s) => s.run.mode === "local" && !settled(s.run.phase))?.run.id

  // The records are written first, all of them and without a pause, so two requests cannot both find the machine
  // free. The queue is the `after` field: it is in the record and in the durable task's input, not in memory.
  const startChain = async (requests: RunRequest[]): Promise<GlhfRun[]> => {
    const busy = requests.some((r) => r.mode === "local") ? liveLocal() : undefined
    if (busy) throw new LocalBusy(busy)
    const now = Date.now()
    const ids: string[] = []
    for (const request of requests) {
      const id = newRunId(request.task ?? "demo", request.solver)
      mkdirSync(runDir(id), { recursive: true }) // so the next id cannot be the same
      ids.push(id)
    }
    const all = requests.map((request, i) => {
      const queued: RunRequest = i > 0 ? { ...request, after: ids[i - 1] } : request
      const run: GlhfRun = { id: ids[i], mode: request.mode, task: request.task ?? "demo", solver: request.solver, model: request.model, roleModels: request.roleModels ?? {}, settings: settingsOf(request), phase: "queued", startedAt: now + i }
      if (i > 0) { run.after = ids[i - 1]; run.detail = `waiting for ${ids[i - 1]} to finish` }
      if (requests.length === 2) run.pairedWith = ids[1 - i]
      saveStored({ run, request: queued })
      return { run, input: { ...queued, id: ids[i] } }
    })
    for (const { input } of all) await createTask(input)
    return all.map(({ run }) => run)
  }

  return {
    start: async (request) => (await startChain([request]))[0],
    startChain,
    async cancel(id) {
      const stored = loadStored(id)
      if (!stored) throw new NoSuchRun(`no such run: ${id}`)
      if (settled(stored.run.phase)) return publicRun(stored)
      if (stored.run.mode === "cloud") {
        const remote = stored.run.remoteId
        throw new CannotCancel(`cloud runs are not cancelled from here, because a VM may be billing. ${remote ? `Run: uv run bixbench3 cancel --run ${remote} --project ${stored.request.project}` : "It has no cloud run yet; stop its launcher (see launch.pid in its folder), then check for a VM"}`)
      }
      // The record first: from here on no phase of its task starts, reads or overwrites anything (see patchRun).
      patchRun(id, { phase: "cancelled", detail: "cancelled; stopping the runner", finishedAt: Date.now() }, "cancel requested")
      const stopped = await stopAndWait(runDir(id), "runner")
      const detail = stopped === "stopped" ? "cancelled; the runner and what it started were stopped"
        : stopped === "none" ? "cancelled before the runner started, or after it had ended"
        : "cancelled, but the runner could not be stopped; check for a leftover process (runner.pid) or container"
      patchRun(id, { phase: "cancelled", detail }, detail)
      // End the durable task now instead of at its next poll. If this fails the task still ends on its own:
      // every phase first looks at the record.
      const taskId = loadStored(id)?.taskId
      if (taskId !== undefined) {
        try {
          await harness.abortTask(taskId as unknown as TaskId<RunResult>, ctx)
          await Promise.race([harness.waitForTask(taskId as unknown as TaskId<RunResult>, ctx), new Promise((ok) => setTimeout(ok, 5_000).unref())])
        } catch (error) { trackerLog(id, `could not end the tracking task at once: ${String(error)}`) }
      }
      return publicRun(loadStored(id)!)
    },
    async wait(id) {
      const stored = loadStored(id)
      if (!stored) throw new BadRequest(`no such run: ${id}`)
      if (stored.taskId !== undefined && !settled(stored.run.phase)) {
        await harness.waitForTask(stored.taskId as unknown as TaskId<RunResult>, ctx)
      }
      return publicRun(loadStored(id)!)
    },
    unfinished: () => listStored().map(publicRun).filter((r) => !settled(r.phase)),
    async close() {
      await harness.close(ctx)
      rmSync(LOCK, { force: true })
    },
  }
}
