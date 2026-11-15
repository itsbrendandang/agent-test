// The research answer over HTTP (docs/research-answer.md).
//
//   POST /api/research {question, effort, thread?}   202 {id, thread, mode} or, when that thread is busy,
//                                                    202 {id, thread, mode, queued: true, after}
//   POST /api/research/:id/cancel                    stop a running or queued answer
//   GET  /api/research/:id/events                    SSE: replay, then tail. `Last-Event-ID` or ?after=<seq> resumes
//   GET  /api/research/:id                           the whole record
//   GET  /api/research?thread=<id>                   the thread's answers, oldest first (no thread: the newest 50)
//   GET  /api/research?all=1                         every answer, one short line each (id, question, status, mode, times, usd)
//   GET  /api/research/threads                       one line per thread, newest first
//   GET  /api/research/:id/artifacts[/:name]         the registered result files; one of them as a download
//
// WHO MAY ASK. While paid calls are off the answer is a demo (fixed text, example sources, no network): the dashboard's
// Origin or the session token is enough. With paid calls on it costs money: the session token, by the same rule and
// with the same 401 as POST /api/chat (http.ts gate). Cancelling follows the mode of the answer. Reads are open to
// local callers, like the board's event stream and memo.
// LIMITS, each refused with a plain message: the question's size; a per-Origin rate; MAX answers in progress; three
// queued questions per thread; and the board's daily cap, which counts answers and board runs together.
import { closeSync, existsSync, fstatSync, openSync, readSync, watch, writeFileSync } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { createModels, type Models } from "@earendil-works/pi-ai"
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic"
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai"
import type { JsonValue } from "@earendil-works/chord/json"
import { createRegistry, defineExtension, defineTask, Harness, type TaskId } from "@earendil-works/pi-durable"
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node"
import { spentToday } from "../board/board.ts"
import type { BoardConfig } from "../config.ts"
import { exaSearch, type SearchResult } from "../search/exa.ts"
import { gate, HttpError, linesFrom, readJson } from "../http.ts"
import { scholarlyLive } from "../search/scholarly.ts"
import { checkTierPrices, gateProvider } from "../models.ts"
import { PaidCallsOff, paidCallsOff, refusePaid } from "../paid/paid.ts"
import { missingKeys } from "../providers.ts"
import { take } from "../runlock.ts"
import { FirstPass } from "../board/triage.ts"
import { demoBrain } from "./demo.ts"
import { type Database, Interrupted, modelNames, type PipelineDeps, realBrain, runAnswer } from "./pipeline.ts"
import { type Match, matchSpecialists } from "../specialists.ts"
import { type AnswerHit, answerDir, answerHits, eventsFile, isAnswerId, isThreadId, listArtifacts, listRecords, loadRecord, newAnswerId, newThreadId, readArtifact, ResearchLog, saveRecord, threadLines, threadRecords } from "./store.ts"
import { plainBlock, scrub } from "./text.ts"
import { type Effort, isEffort, limitsOf, type ResearchRecord } from "./types.ts"
import { exampleEntries } from "../examples.ts"
import { configHash, runManifest } from "../manifest.ts"
import { previewOn } from "./preview.ts"

export const MAX_QUEUED_PER_THREAD = 3
export const MAX_STREAMS_PER_ANSWER = 8
export const MAX_STREAMS = 32

export interface ResearchDeps {
  config: BoardConfig
  env: NodeJS.ProcessEnv
  hasToken: (req: IncomingMessage) => boolean
  tokenFile?: string
  /** The engine's mode now: true while paid calls are off (or the board is scripted on purpose). Read at every request. */
  mock: () => boolean
  /** Tests: the models of a real answer (fakes). Default: the gated Anthropic and OpenAI providers of models.ts. */
  models?: () => Models
  /** Tests: stand-ins for the searches. Defaults: exa.ts, scholarly.ts (literature), and sources/ when it is there. */
  exa?: (query: string, objective: string) => Promise<SearchResult>
  literature?: (query: string) => Promise<SearchResult>
  database?: (source: Database, query: string) => Promise<SearchResult>
  now?: () => number
  /** The method specialists that fit a question. Default: the matcher of specialists.ts over glhf/specialists. */
  specialists?: (question: string) => Match[]
  /** Tests: called right after a step's outcome was stored (its key). Returning "stop" stops this process's work at that exact point, as a killed engine would. */
  onStored?: (key: string) => void | "stop"
}

/** A refusal that names the input it is about. */
class Refusal extends HttpError {
  readonly field: string
  constructor(status: number, field: string, message: string) { super(status, message); this.field = field }
}

/** The database lookup of sources/, when that module is there. It is free and needs no key; its results are screened like any other. */
async function databaseLookup(): Promise<ResearchDeps["database"]> {
  try {
    const name = "../sources/index.ts" // not a static import: the module is another agent's and may be absent
    const sources = (await import(name)) as { databaseLive?: (source: string, query: string) => Promise<SearchResult> }
    return typeof sources.databaseLive === "function" ? (source, query) => sources.databaseLive!(source, query) : undefined
  } catch { return undefined }
}

const ctx = BACKGROUND_CONTEXT

// THE PREVIEW SWITCH (preview.ts). A real (paid) answer is refused unless the engine was started with RESEARCH_PREVIEW=1:
// the pipeline has not yet written a real answer, so the Search screen must not offer one by default. Demo answers and
// every GET work without it. The dashboard reads `preview: false` in the 503, says that direct answers are off, and
// falls back to the plan path. The start-up lines and GET /api/status show the switch.
export { previewOn }
export const PREVIEW_OFF = { error: "Direct answers are being built. Use Deep for a team review.", preview: false } as const
export const TASK_NAME = "research.answer"
/** How often a queued question looks whether its turn has come. The wait is a stored sleep (Pi Durable), so it holds across a restart. */
export const QUEUE_POLL_MS = 300
type Checkpoint = { phase: "wait" } | { phase: "work" }
type Result = { status: string }
const ended = (status: string) => status === "done" || status === "failed" || status === "cancelled"

export function createResearch(deps: ResearchDeps) {
  const { config, env } = deps
  const loadedConfig = configHash()
  const manifest = () => runManifest(config, loadedConfig)
  const now = deps.now ?? Date.now
  const trust = { hasToken: deps.hasToken, env, tokenFile: deps.tokenFile }
  /** Answers this process holds open: each has its own Pi Durable session (session.sqlite in its folder) and its lock. */
  const active = new Map<string, { thread: string; cancel: AbortController; halt: AbortController; harness?: Harness; done: Promise<void> }>()
  /** Of those, the ones past the queue: being written now. */
  const working = new Set<string>()
  const asked = new Map<string, number[]>() // Origin -> times of its recent questions
  let stopping = false

  const json = (res: ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" })
    res.end(JSON.stringify(body))
  }
  const withFiles = (record: ResearchRecord) => ({ ...record, artifacts: listArtifacts(config, record.id) })
  const cancelFile = (id: string) => `${answerDir(config, id)}/cancel`
  /** The record as it is on disk: a record left "running" by a stopped engine is still "running" here, and is continued. */
  const stored = (id: string) => loadRecord(config, id, 0)

  /** End an answer with a plain reason, when the pipeline did not do it. */
  function fail(record: ResearchRecord, log: ResearchLog, error: string) {
    record.status = "failed"; record.error = scrub(error, env, 400); record.finishedAt = now()
    saveRecord(config, record)
    log.emit("end", { type: "research.failed", error: record.error, spentUsd: record.usd })
  }

  /** The models of a real answer: Anthropic and OpenAI through pi-ai, each call checked against the paid switch at the moment it is made (models.ts gateProvider). */
  function realModels(): Models {
    if (deps.models) return deps.models()
    const models = createModels()
    models.setProvider(gateProvider(anthropicProvider()))
    models.setProvider(gateProvider(openaiProvider()))
    checkTierPrices(models, config) // a model with no price could not be counted against the caps
    return models
  }

  // ── The durable task: one per answer ───────────────────────────────────────────────────────────
  // wait: a queued question stays here (a stored sleep, tried again every QUEUE_POLL_MS) until no earlier answer of
  //       its thread is unfinished and there is room. A question that is not queued passes at once.
  // work: the pipeline (pipeline.ts runAnswer). Every paid or outside step is stored as a memo of this task before
  //       the pipeline relies on it. When the engine stops, the phase ends without a commit; at the next start it
  //       runs again from the top and the stored steps are not done again.
  const AnswerTask = defineTask<{ id: string }, Checkpoint, Result>({
    name: TASK_NAME,
    version: 1,
    initial: () => ({ phase: "wait" }),
    phases: {
      wait: async (task, runtime, context) => {
        const id = task.input.id, record = stored(id)
        const finish = (status: string) => runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: { status } } }), context)
        if (!record || ended(record.status)) return finish(record?.status ?? "failed")
        const log = new ResearchLog(config, id)
        if (existsSync(cancelFile(id)) || active.get(id)?.cancel.signal.aborted) {
          record.status = "cancelled"; record.finishedAt = now(); record.seconds = 0; record.note = "Cancelled before it started."
          saveRecord(config, record)
          log.emit("end", { type: "research.cancelled", spentUsd: 0, seconds: 0 })
          return finish("cancelled")
        }
        const limits = limitsOf(config)
        const earlier = threadRecords(config, record.thread, now()).some((r) => r.id !== id && !ended(r.status) && (r.startedAt < record.startedAt || (r.startedAt === record.startedAt && r.id < id)))
        if (earlier || (!working.has(id) && working.size >= limits.maxInProgress)) return runtime.sleepUntil(runtime.now() + QUEUE_POLL_MS, { phase: "wait" }, context)
        if (record.mode === "real" && record.status === "queued") { // it waited: what was true when it was asked is checked again
          if (deps.mock() || paidCallsOff(env)) { fail(record, log, "Paid calls were switched off before this queued question could start. Switch to Real and ask it again."); return finish("failed") }
          const today = spentToday(config, new Date(now()))
          if (today + record.caps.maxUsd > config.meeting.daily_usd) { fail(record, log, `The daily spending limit ($${config.meeting.daily_usd}) would be passed, so this queued question was not started.`); return finish("failed") }
        }
        working.add(id) // in the same step as the check above: two questions cannot both take the last place
        await runtime.commit(() => ({ status: "running", checkpoint: { phase: "work" } }), context)
      },
      work: async (task, runtime, context) => {
        const id = task.input.id, record = stored(id)
        const finish = (status: string) => runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: { status } } }), context)
        if (!record || ended(record.status)) { working.delete(id); return finish(record?.status ?? "failed") }
        working.add(id)
        const log = new ResearchLog(config, id)
        try {
          const limits = limitsOf(config)
          const earlier = threadRecords(config, record.thread, now()).filter((r) => r.id !== id && (r.startedAt < record.startedAt || (r.startedAt === record.startedAt && r.id < id)))
          const halted = AbortSignal.any([runtime.signal, ...(active.get(id) ? [active.get(id)!.halt.signal] : [])])
          const remember: PipelineDeps["remember"] = async (key, work) => {
            const kept = await runtime.memo<JsonValue>(key, context)
            if (kept !== undefined) return kept as never
            const outcome = await work()
            if (halted.aborted) throw new Interrupted() // the engine stopped while this step was at work: its result is not stored, as with a killed process
            const winner = await runtime.memo<JsonValue>(key, JSON.parse(JSON.stringify(outcome)) as JsonValue, context) // stored before the pipeline relies on it
            if (deps.onStored?.(key) === "stop") void kill()
            return winner as never
          }
          const stored = async () => Object.keys(((await runtime.getTask(runtime.taskId, context)) as { memos?: Record<string, unknown> } | undefined)?.memos ?? {})
          const shared = { config, limits, env, earlier, remember, stored, specialists: deps.specialists ?? ((question: string) => matchSpecialists(question)), now: deps.now, interrupted: halted, cancel: active.get(id)?.cancel.signal, cancelRequested: () => existsSync(cancelFile(id)) }
          let pipeline: PipelineDeps
          if (record.mode === "demo") {
            pipeline = {
              ...shared, brain: demoBrain, firstPass: () => new FirstPass(undefined as never, config, true),
              exa: async () => { throw new Error("a demo answer does not search") }, literature: async () => { throw new Error("a demo answer does not search") },
              fixtures: (query) => exaSearch(query, "", true), // the board's example sources (mock.ts); no network
              paidOff: () => false,
            }
          } else {
            const models = runtime.models // the models this answer's Harness was opened with (realModels above)
            const brain = realBrain(models, config, limits.levels[record.effort], (what) => refusePaid(what, env))
            pipeline = {
              ...shared, brain, firstPass: () => new FirstPass(models, config, false), writerModel: brain.names.writer,
              exa: deps.exa ?? ((query, objective) => exaSearch(query, objective, false, env, config.meeting.exa_highlight_chars)),
              literature: deps.literature ?? ((query) => scholarlyLive(query, { env })), // Europe PMC, OpenAlex, Semantic Scholar, arXiv: free, no key needed
              database: deps.database ?? (limits.levels[record.effort].databaseLookups ? await databaseLookup() : undefined),
              paidOff: () => paidCallsOff(env),
            }
          }
          await runAnswer(pipeline, record, log)
        } catch (error) {
          if (error instanceof Interrupted || runtime.signal.aborted) {
            // The engine is stopping: no commit, so the task continues at the next start. The phase ends only once its
            // session is closing; ending earlier without a commit would be recorded as a fault of the task.
            if (!runtime.signal.aborted) await new Promise<void>((resolve) => runtime.signal.addEventListener("abort", () => resolve(), { once: true }))
            throw error
          }
          fail(record, log, `The answer could not be finished: ${error instanceof Error ? error.message : String(error)}`)
        } finally { working.delete(id) }
        await finish(record.status)
      },
    },
    // Not how an answer is cancelled (a cancel is a mark on disk that the pipeline reads before every paid step). This
    // runs only when the task itself is aborted through the Harness.
    abort: async (task, runtime, context) => {
      const record = stored(task.input.id)
      if (record && !ended(record.status)) fail(record, new ResearchLog(config, record.id), "The answer was stopped by the engine.")
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context)
    },
  })

  /**
   * Work on a saved answer in this process: take its lock, open its Pi Durable session, make its task if it has none
   * (it has exactly one, whatever was interrupted), and let the Harness run or continue it. Does nothing for an answer
   * that has ended, that this process already holds, or that another live process holds.
   */
  function launch(id: string): void {
    if (stopping || active.has(id)) return
    const record = stored(id)
    if (!record || ended(record.status)) return
    if (record.mode === "real" && !previewOn(env)) return // no real answer is worked on, started or continued, without the preview switch
    const lock = take(`${answerDir(config, id)}/run.lock`)
    if (typeof lock !== "function") return
    const entry: { thread: string; cancel: AbortController; halt: AbortController; harness?: Harness; done: Promise<void> } = { thread: record.thread, cancel: new AbortController(), halt: new AbortController(), done: Promise.resolve() }
    active.set(id, entry)
    entry.done = (async () => {
      try {
        const registry = createRegistry()
        registry.install(defineExtension({ name: "research", tasks: [AnswerTask] }))
        const harness = await Harness.open(await openNodeSqliteStorage(`${answerDir(config, id)}/session.sqlite`), {
          models: record.mode === "demo" ? createModels() : realModels(), registry,
          onReport: (report) => console.error(`research answer ${id}: ${report.kind}`, scrub(report.error instanceof Error ? report.error.message : report.error, env)),
        }, ctx)
        entry.harness = harness
        const root = await harness.root(ctx)
        let taskId = (await harness.inspect(ctx)).tasks.find((t) => t.record.kind === TASK_NAME)?.record.id as TaskId<Result> | undefined
        if (taskId === undefined) await root.commit(async (tx) => { taskId = await tx.createTask(AnswerTask, { id }, { ownership: { kind: "conversation" }, background: true }) }, ctx)
        harness.resume() // run it, or continue it from its last stored step
        const settled = await harness.waitForTask(taskId as TaskId<Result>, ctx)
        const after = stored(id)
        if (after && !ended(after.status)) fail(after, new ResearchLog(config, id), settled.state.outcome.status === "faulted" ? `The answer could not be finished: ${settled.state.outcome.error.message}` : "The answer ended without a result.")
      } catch (error) {
        if (!stopping) {
          const after = stored(id)
          try { if (after && !ended(after.status)) fail(after, new ResearchLog(config, id), `The answer could not be started: ${error instanceof Error ? error.message : String(error)}`) } catch (inner) { console.error(`research answer ${id} could not be closed:`, scrub(inner, env)) }
        }
      } finally {
        try { await entry.harness?.close(ctx) } catch { /* already closed */ }
        working.delete(id)
        lock()
        active.delete(id)
      }
    })()
  }

  /**
   * Continue what an earlier process left unfinished: answers in progress and queued questions, oldest first. A real
   * answer is not continued while paid calls are off (as a board run is not): it stays as it is until they are on.
   */
  function resume(): string[] {
    const started: string[] = []
    for (const record of listRecords(config, 0).sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))) {
      if (ended(record.status) || active.has(record.id)) continue
      if (record.mode === "real" && (deps.mock() || paidCallsOff(env))) continue
      launch(record.id)
      if (active.has(record.id)) started.push(record.id)
    }
    return started
  }

  /** Stop working, as when the engine stops: every open session is closed and nothing is marked. `resume` continues them. */
  async function stop(): Promise<void> {
    stopping = true
    try {
      await Promise.allSettled([...active.values()].map(async (entry) => { try { await entry.harness?.close(ctx) } catch { /* closing twice */ } }))
      await Promise.allSettled([...active.values()].map((entry) => entry.done))
    } finally { stopping = false }
  }

  /** Stop dead, as a killed engine does: every answer stops at the point it is at (nothing more is stored or written), then the sessions are closed. */
  function kill(): Promise<void> {
    stopping = true
    for (const entry of active.values()) entry.halt.abort()
    return stop()
  }

  // ── POST /api/research ─────────────────────────────────────────────────────────────────────────
  async function ask(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!gate(req, res, "scripted", "asking a research question", trust)) return
    const limits = limitsOf(config)
    const body = await readJson<Record<string, unknown>>(req, 65_536)
    if (typeof body.question !== "string") throw new Refusal(400, "question", "send the question as {\"question\": \"...\"}")
    if (body.question.length > limits.maxQuestionChars) throw new Refusal(400, "question", `the question is longer than ${limits.maxQuestionChars} characters`)
    const question = plainBlock(body.question, limits.maxQuestionChars)
    if (question.replace(/[^\p{L}\p{N}]/gu, "").length < 3) throw new Refusal(400, "question", "the question is empty")
    if (body.effort !== undefined && !isEffort(body.effort)) throw new Refusal(400, "effort", "effort must be \"quick\" or \"standard\" (the deep level is a team review: ask for a plan with POST /api/chat)")
    const effort: Effort = (body.effort as Effort | undefined) ?? "quick"
    if (body.thread !== undefined && !isThreadId(body.thread)) throw new Refusal(400, "thread", "thread must be the id of a thread this engine gave out")
    if (exampleEntries({ ...env, GLHF_HIDE_EXAMPLES: "0" }).some((e) => e.thread === body.thread && body.thread !== undefined)) throw new Refusal(403, "thread", "Examples are read-only. Start a new question instead.")
    const earlier = body.thread === undefined ? [] : threadRecords(config, body.thread as string, now())
    if (body.thread !== undefined && !earlier.length) throw new Refusal(404, "thread", "no such thread")

    const demo = deps.mock()
    if (!demo && !previewOn(env)) return json(res, 503, PREVIEW_OFF) // before the token is asked for and before anything that can spend
    if (!demo) {
      if (paidCallsOff(env)) throw new PaidCallsOff("a research answer written by real models")
      if (!gate(req, res, "spend", "a research answer written by real models", trust)) return // 401 {needsToken} for the dashboard without the token
    }
    const level = limits.levels[effort]

    const origin = typeof req.headers.origin === "string" ? req.headers.origin.slice(0, 200) : "(no origin)"
    const recent = (asked.get(origin) ?? []).filter((t) => t > now() - 60_000)
    if (recent.length >= limits.perOriginPerMinute) throw new Refusal(429, "rate", `At most ${limits.perOriginPerMinute} questions a minute. Wait a moment and ask again.`)

    if (!demo) {
      const missing = [...new Set(missingKeys(config, env, false).map((m) => m.key))]
      if (missing.length) throw new Refusal(503, "keys", `A real answer needs ${missing.join(" and ")}, which ${missing.length === 1 ? "is" : "are"} not set in .env. Nothing was started. (A demo answer needs no key: switch to Demo.)`)
      const today = spentToday(config, new Date(now()))
      if (today + level.maxUsd > config.meeting.daily_usd) throw new Refusal(429, "budget", `The daily spending limit would be passed: $${today.toFixed(2)} of $${config.meeting.daily_usd} is counted for today (answers in progress count at their cap), and this answer may cost up to $${level.maxUsd}. Nothing was started. The limit is meeting.daily_usd in board/config.yaml.`)
    }

    const thread = (body.thread as string | undefined) ?? newThreadId()
    const ahead = earlier.filter((r) => !ended(r.status))
    if (ahead.filter((r) => r.status === "queued").length >= MAX_QUEUED_PER_THREAD) throw new Refusal(429, "queue", `${MAX_QUEUED_PER_THREAD} questions are already waiting in this thread. Wait for one to finish, or cancel one.`)
    if (!ahead.length && working.size >= limits.maxInProgress) throw new Refusal(429, "busy", `${limits.maxInProgress} answers are being written now, which is the most this engine does at once. Try again when one has finished.`)

    asked.set(origin, [...recent, now()])
    const names = demo ? demoBrain.names : modelNames(config)
    const record: ResearchRecord = {
      id: newAnswerId(new Date(now())), thread, kind: "answer", question, effort, mode: demo ? "demo" : "real", status: ahead.length ? "queued" : "running", startedAt: Math.max(now(), ...earlier.map((r) => r.startedAt + 1)),
      caps: { maxUsd: demo ? 0 : level.maxUsd, maxSeconds: limits.maxSeconds }, models: names,
      steps: [], searches: [], sources: [], statements: [], recommendations: [], usd: 0,
      review: { checker: names.checker, critic: names.critic, revised: false, notes: [] },
      manifest: manifest(),
      ...(ahead.length ? { after: ahead.at(-1)!.id } : {}),
    }
    saveRecord(config, record) // the record first: a question that was accepted is on disk before anything else happens
    if (ahead.length) new ResearchLog(config, record.id).emit("queued", { type: "research.queued", after: record.after as string })
    else working.add(record.id) // it takes its place now, so the next request in this same moment sees it
    launch(record.id)
    resume() // and anything an earlier process left: a real answer that was waiting for paid calls to be on again
    json(res, 202, { id: record.id, thread, mode: record.mode, ...(ahead.length ? { queued: true, after: record.after } : {}) })
  }

  // ── POST /api/research/:id/cancel ──────────────────────────────────────────────────────────────
  async function cancel(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    if (!gate(req, res, "scripted", "cancelling a research answer", trust)) return
    const record = stored(id)
    if (!record) throw new HttpError(404, "no such answer")
    if (record.mode === "real" && !gate(req, res, "spend", "cancelling an answer written by real models", trust)) return
    if (ended(record.status)) return json(res, 200, { id, status: record.status, cancelled: false, message: record.status === "cancelled" ? "This answer was already cancelled." : `This answer had already ended (${record.status}), so there was nothing to cancel.` })
    writeFileSync(cancelFile(id), `${new Date(now()).toISOString()}\n`) // on disk first: it holds across a restart, and the pipeline reads it before every paid step
    launch(id) // an answer no process holds (left by a stopped engine) is taken up, so that it is closed as cancelled
    const live = active.get(id)
    if (!live) return json(res, 200, { id, status: record.status, cancelled: true, message: "Marked as cancelled. Another engine process is working on it and stops before its next paid step." })
    live.cancel.abort()
    await Promise.race([live.done, new Promise((resolve) => setTimeout(resolve, 3_000).unref())])
    const after = stored(id)
    json(res, 200, { id, status: after?.status ?? record.status, cancelled: true, message: after?.status === "cancelled" ? (record.status === "queued" ? "Cancelled before it started. Nothing was spent." : "Cancelled. No further paid step was started; what was found by then is kept.") : "Cancelling: no further paid step will start." })
  }

  // ── GET /api/research/:id/events ───────────────────────────────────────────────────────────────
  const streams = new Map<string, number>()
  let streamCount = 0
  function events(req: IncomingMessage, res: ServerResponse, id: string, url: URL) {
    const file = eventsFile(config, id)
    // 204 tells an EventSource to stop reconnecting: there is nothing to stream for an answer that does not exist.
    if (!existsSync(file)) { res.writeHead(204); return void res.end() }
    if (streamCount >= MAX_STREAMS || (streams.get(id) ?? 0) >= MAX_STREAMS_PER_ANSWER) return json(res, 429, { error: "too many event streams are open; close one" })
    const header = req.headers["last-event-id"]
    const given = url.searchParams.get("after") ?? (typeof header === "string" ? header : "")
    const after = /^\d{1,9}$/.test(given) ? Number(given) : 0 // only events with a later seq are sent
    streamCount++
    streams.set(id, (streams.get(id) ?? 0) + 1)
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" })
    res.write(": connected\n\n") // so the stream opens at once, also when there is nothing new to send
    let sent = 0 // bytes of the file already read; only what follows is read
    const flush = () => {
      let fd: number
      try { fd = openSync(file, "r") } catch { return }
      try {
        const size = fstatSync(fd).size
        if (size <= sent) return
        const chunk = Buffer.alloc(size - sent)
        const got = readSync(fd, chunk, 0, chunk.length, sent)
        const { lines, next } = linesFrom(chunk.subarray(0, got), 0) // a line still being written waits for its newline
        sent += next
        for (const line of lines) {
          const seq = Number(/^\{"seq":(\d+),/.exec(line)?.[1])
          if (!Number.isInteger(seq) || seq <= after) continue
          res.write(`id: ${seq}\ndata: ${line}\n\n`)
        }
      } finally { closeSync(fd) }
    }
    flush()
    const watcher = watch(file, flush)
    const ping = setInterval(() => { flush(); res.write(": ping\n\n") }, 15_000)
    let open = true
    const close = () => {
      if (!open) return
      open = false
      watcher.close(); clearInterval(ping)
      streamCount--
      const left = (streams.get(id) ?? 1) - 1
      if (left > 0) streams.set(id, left); else streams.delete(id)
    }
    req.on("close", close)
    res.on("close", close)
  }

  /** The handler for everything under /api/research. `parts` is the path, split: ["api", "research", ...]. */
  async function handle(req: IncomingMessage, res: ServerResponse, parts: string[]): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", "http://x")
      const [, , a, b, c] = parts
      if (parts.length === 2 && req.method === "POST") return await ask(req, res)
      if (parts.length === 2 && req.method === "GET") {
        const thread = url.searchParams.get("thread")
        // ?all=1: one short line for every answer, for totals (the Overview). Without it: the newest 50, whole.
        if (thread === null && url.searchParams.get("all") === "1") return json(res, 200, { items: listRecords(config, now()).map((r) => ({ id: r.id, thread: r.thread, question: r.question.slice(0, 200), status: r.status, mode: r.mode, startedAt: r.startedAt, finishedAt: r.finishedAt, usd: r.usd })) })
        if (thread === null) return json(res, 200, { items: listRecords(config, now()).slice(0, 50).map(withFiles) })
        if (!isThreadId(thread)) throw new Refusal(400, "thread", "thread must be the id of a thread this engine gave out")
        const items = threadRecords(config, thread, now())
        if (!items.length) throw new Refusal(404, "thread", "no such thread")
        return json(res, 200, { thread, items: items.map(withFiles) })
      }
      if (a === "threads" && parts.length === 3 && req.method === "GET") return json(res, 200, threadLines(config, now()))
      let id = ""
      try { id = decodeURIComponent(a ?? "") } catch { /* 404 below */ }
      if (!isAnswerId(id)) throw new HttpError(404, "not found")
      if (b === "cancel" && parts.length === 4 && req.method === "POST") return await cancel(req, res, id)
      if (req.method !== "GET") throw new HttpError(405, "GET or POST")
      if (b === "events" && parts.length === 4) return events(req, res, id, url)
      const record = loadRecord(config, id, now())
      if (!record) throw new HttpError(404, "no such answer")
      if (parts.length === 3) return json(res, 200, withFiles(record))
      if (b === "artifacts" && parts.length === 4) return json(res, 200, { items: listArtifacts(config, id) })
      if (b === "artifacts" && parts.length === 5) {
        let name = ""
        try { name = decodeURIComponent(c ?? "") } catch { /* refused below */ }
        const file = readArtifact(config, id, name)
        if (!file.ok) throw new HttpError(file.status, file.error)
        res.writeHead(200, { "content-type": `${file.type}; charset=utf-8`, "content-length": file.body.length, "content-disposition": `attachment; filename="${id}-${file.name}"`, "x-content-type-options": "nosniff", "cache-control": "no-store" })
        return void res.end(file.body)
      }
      throw new HttpError(404, "not found")
    } catch (error) {
      if (res.headersSent) return void res.end()
      const code = error instanceof HttpError ? error.status : error instanceof PaidCallsOff ? 403 : 500
      if (code === 500) console.error("research route failed:", scrub(error instanceof Error ? error.stack ?? error.message : error, env, 2_000))
      json(res, code, { error: code === 500 ? "the research route failed" : scrub(error instanceof Error ? error.message : String(error), env, 600), ...(error instanceof Refusal ? { field: error.field } : {}) })
    }
  }

  return {
    handle,
    /** Saved answers for GET /api/search. */
    hits: (query: string): AnswerHit[] => answerHits(config, query, now()),
    /** What an answer started now records: the config hash is the one of the config this engine loaded. */
    manifest,
    /** Continue the answers and queued questions an earlier process left unfinished. Returns the ids taken up. */
    resume,
    /** Stop as a stopping engine does: close every open session, mark nothing. */
    stop,
    /** Tests: stop dead at this instant, as a killed engine does. */
    kill,
    /** Wait until this process holds no answer. */
    idle: async () => { while (active.size) await Promise.allSettled([...active.values()].map((entry) => entry.done)) },
    get inProgress() { return working.size },
  }
}
