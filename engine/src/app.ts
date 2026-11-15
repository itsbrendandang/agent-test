// The engine's HTTP request handler, without the listening. server.ts listens; tests call the handler on a
// throwaway server. Importing this file starts nothing.
//
//   GET/POST /api/paid           the runtime paid switch (paidswitch.ts): token, confirmation, lock, audit
//   GET  /api/status             mode (mock or live), whether paid calls are allowed (NO_PAID_CALLS, see paid.ts)
//                                and which keys are present (never the keys)
//   GET  /api/roster             lead + board members with task, deliverable, model tier
//   GET  /api/briefs             briefs available to run
//   GET  /api/runs               runs with status
//   GET  /api/token              is the x-glhf-token header this engine's session token? 200 {ok: true}, else the
//                                401 below. For the dashboard, to check a pasted token. It never returns the token.
//   POST /api/runs {brief}       start a run. With scripted models: anyone local. With real models: the session
//                                token; the dashboard's Origin alone gets 401 {error, field: "token", needsToken: true}
//   POST /api/runs/:id/resume    resume a run (same rule)
//   GET  /api/runs/:id/events    SSE: the whole event log, then live events (204 for a run with no log, 429 past
//                                MAX_STREAMS_PER_RUN streams on one run or MAX_STREAMS in total)
//   GET  /api/runs/:id/memo      the memo (Markdown)
//   GET  /api/search?q=          keyword search over all runs and saved research answers
//   /api/research/*              a direct, sourced answer to one question (see research/routes.ts)
//   POST /api/ask {question}     a small model answers from the run records (see ask.ts). Needs the dashboard's
//                                Origin or the token; the model is asked only for a token holder
//   /api/glhf/*                  GLHF benchmark runs (see glhf/routes.ts)
//
// Every request first passes the checks in http.ts: Host must be this machine, an Origin must be the
// dashboard's, POST bodies must be JSON. An Origin is not a credential (any local program can send one): what
// can spend needs the session token, by the one rule in http.ts (`gate`).
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync, readSync, watch } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import { basename, resolve } from "node:path"
import { loadAgent, loadRoster } from "./board/agents.ts"
import { BudgetReached, checkDailyBudget, loadState, lockHolder, refusePaidRun, RunBusy, runBoard, runDir, startRun, summarize } from "./board/board.ts"
import { BriefRejected } from "./brief.ts"
import { handleChat } from "./chat/routes.ts"
import { type BoardConfig, loadConfig, LOCAL, MOCK, path } from "./config.ts"
import { cancelPaidRuns, handleGlhf, hasSessionToken, TOKEN_FILE } from "./glhf/routes.ts"
import { handleBixV1 } from "./bixv1/routes.ts"
import { gate, guard, HttpError, isSafeId, linesFrom, readJson, safeId, tokenNeeded } from "./http.ts"
import { PaidCallsOff, paidCallsOff, paidState, paidSwitchLocked } from "./paid/paid.ts"
import { handlePaid } from "./paid/paidswitch.ts"
import { FatalModelError } from "./providers.ts"
import { createResearch } from "./research/routes.ts"
import { search } from "./search/search.ts"

/** The address the server listens on unless HOST says otherwise: this machine only. */
export const DEFAULT_HOST = "127.0.0.1"
export const bindHost = (env: NodeJS.ProcessEnv = process.env): string => env.HOST || DEFAULT_HOST

/** Event streams open at once: on one run, and on all runs. Past either, a new one is answered 429. */
export const MAX_STREAMS_PER_RUN = 8
export const MAX_STREAMS = 32

export interface AppOptions {
  config?: BoardConfig
  /** Scripted models (no cost). Defaults to the engine's mode. */
  mock?: boolean
  /** Does the request carry this server's token? Defaults to the token made at startup (glhf/routes.ts). */
  hasToken?: (req: IncomingMessage) => boolean
  /** Start or continue a board run in this process. Tests replace it. */
  run?: (runId: string) => Promise<void>
  start?: (briefFile: string) => Promise<string>
  env?: NodeJS.ProcessEnv
  /** Options for POST /api/ask (tests: a fake fetch and key). */
  ask?: import("./search/ask.ts").AskOptions
}

export function createApp(options: AppOptions = {}) {
  const config = options.config ?? loadConfig()
  // The engine's mode now, read at each use: the paid switch (paid.ts) can change it while the engine runs.
  const mockNow = () => options.mock ?? MOCK
  const hasToken = options.hasToken ?? hasSessionToken
  const run = options.run ?? ((runId: string) => runBoard(runId))
  const start = options.start ?? startRun
  const env = options.env ?? process.env
  const active = new Set<string>()

  function launch(runId: string) {
    if (active.has(runId)) return
    active.add(runId)
    run(runId)
      .catch((e) => (e instanceof RunBusy || e instanceof BudgetReached || e instanceof PaidCallsOff || e instanceof FatalModelError ? console.log(`run ${runId} not continued: ${e.message}`) : console.error(`run ${runId} failed:`, e)))
      .finally(() => active.delete(runId))
  }

  const listRuns = () => {
    const dir = path(config, "runs")
    if (!existsSync(dir)) return []
    return readdirSync(dir).filter((d) => isSafeId(d) && existsSync(`${dir}/${d}/run.json`)).sort().reverse().flatMap((id) => {
      let s: ReturnType<typeof loadState>
      try { s = loadState(config, id) } catch { return [] } // an unreadable run.json hides that run, not the list
      // "running" also when another process (the CLI) holds the run's lock, so it is not resumed twice.
      const status = s.finished ? "done" : active.has(id) || lockHolder(`${dir}/${id}`) !== undefined ? "running" : s.failed ? "failed" : "paused"
      return [{ id, brief: s.briefFile.split("/").pop(), startedAt: s.startedAt, status, ...(s.failed && !s.finished ? { error: s.failed } : {}), ...summarize(`${dir}/${id}`, s) }]
    })
  }

  const json = (res: ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" })
    res.end(JSON.stringify(body))
  }

  const trust = { hasToken, env, tokenFile: TOKEN_FILE }
  const research = createResearch({ config, env, hasToken, tokenFile: TOKEN_FILE, mock: mockNow }) // the direct, sourced answer (research/routes.ts)
  /**
   * May this request start or resume a board run? With scripted models anyone local may (it costs nothing). With
   * real models only a holder of the token: false, with 403 or the 401 that asks for the token sent, otherwise.
   */
  const mayRun = (req: IncomingMessage, res: ServerResponse, what: string) => mockNow() || gate(req, res, "spend", what, trust)

  const streams = new Map<string, number>() // run id -> open event streams
  let streamCount = 0

  function sse(req: IncomingMessage, res: ServerResponse, runId: string) {
    const file = `${runDir(config, runId)}/events.jsonl`
    // 204 tells an EventSource to stop reconnecting; there is nothing to stream for a run that does not exist.
    if (!existsSync(file)) { res.writeHead(204); return void res.end() }
    // Each stream holds a file watcher and a timer. An EventSource does not reconnect after an error status.
    if (streamCount >= MAX_STREAMS || (streams.get(runId) ?? 0) >= MAX_STREAMS_PER_RUN) return json(res, 429, { error: "too many event streams are open; close one" })
    streamCount++
    streams.set(runId, (streams.get(runId) ?? 0) + 1)
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" })
    let sent = 0 // bytes of the file already sent; only what follows is read
    const flush = () => {
      let fd: number
      try { fd = openSync(file, "r") } catch { return } // removed meanwhile
      try {
        const size = fstatSync(fd).size
        if (size < sent) sent = 0 // the file was replaced by a shorter one: start again
        if (size === sent) return
        const chunk = Buffer.alloc(size - sent)
        const got = readSync(fd, chunk, 0, chunk.length, sent)
        const { lines, next } = linesFrom(chunk.subarray(0, got), 0) // a line still being written waits for its newline
        sent += next
        for (const line of lines) res.write(`data: ${line}\n\n`)
      } finally { closeSync(fd) }
    }
    flush()
    const watcher = watch(file, flush) // works for runs started by the CLI too
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000)
    let open = true
    const close = () => {
      if (!open) return
      open = false
      watcher.close(); clearInterval(ping)
      streamCount--
      const left = (streams.get(runId) ?? 1) - 1
      if (left > 0) streams.set(runId, left); else streams.delete(runId)
    }
    req.on("close", close)
    res.on("close", close)
  }

  async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!guard(req, res, env)) return // foreign Host or Origin: refused; preflight: answered
    const url = new URL(req.url ?? "/", "http://x")
    const parts = url.pathname.split("/").filter(Boolean) // api, runs, :id, events
    if (parts[0] === "api" && parts[1] === "glhf") return handleGlhf(req, res, parts)
    if (parts[0] === "api" && parts[1] === "bixv1") return handleBixV1(req, res, parts)
    if (url.pathname === "/api/paid") return handlePaid(req, res, { config, env, hasToken, tokenFile: TOKEN_FILE, stopPaidRuns: cancelPaidRuns }) // the runtime paid switch (paidswitch.ts)
    if (parts[0] === "api" && parts[1] === "research") return research.handle(req, res, parts) // POST a question, GET its events, record and files
    if (parts[0] === "api" && parts[1] === "chat") return handleChat(req, res, parts, { config, mock: mockNow(), env, hasToken, start, launch, listRuns }) // the Home chat (chat/routes.ts)
    try {
      if (url.pathname === "/api/status") return json(res, 200, {
        mock: mockNow(),
        paidCalls: !paidCallsOff(),
        paidSource: paidState().source,
        paidLocked: paidSwitchLocked(),
        keys: Object.fromEntries(["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "EXA_API_KEY"].map((k) => [k, Boolean(env[k])])),
        meeting: config.meeting, models: config.models,
      })
      if (url.pathname === "/api/search") return json(res, 200, [...search(url.searchParams.get("q") ?? "", listRuns()), ...research.hits(url.searchParams.get("q") ?? "")].sort((a, b) => b.startedAt - a.startedAt)) // runs, and saved answers (kind "answer")
      if (url.pathname === "/api/token") return hasToken(req) ? json(res, 200, { ok: true }) : json(res, 401, tokenNeeded("this", TOKEN_FILE))
      if (url.pathname === "/api/ask") { // AI search over experiments
        // The keyword answer for the dashboard or a token holder; the model call (money) for a token holder only.
        if (!gate(req, res, "scripted", "asking about the experiments", trust)) return
        return (await import("./search/ask.ts")).handleAsk(req, res, listRuns(), { ...options.ask, model: hasToken(req) })
      }
      if (url.pathname === "/api/roster") {
        const lead = loadAgent(config, "lead-scientist")
        return json(res, 200, [lead, ...loadRoster(config)].map(({ prompt: _p, ...a }) => ({ ...a, modelId: config.models[a.model] })))
      }
      if (url.pathname === "/api/briefs") return json(res, 200,
        readdirSync(path(config, "briefs")).filter((f) => f.endsWith(".md") && !f.startsWith("_")))
      if (url.pathname === "/api/runs" && req.method === "GET") return json(res, 200, listRuns())
      if (url.pathname === "/api/runs" && req.method === "POST") {
        const { brief } = await readJson<{ brief?: unknown }>(req)
        if (!mockNow() && paidCallsOff()) throw new PaidCallsOff("starting a board run with real models") // not reachable with the engine's own MOCK; kept for a handler built with mock: false
        if (!mayRun(req, res, "starting a board run with real models")) return
        if (typeof brief !== "string" || !brief.endsWith(".md")) throw new HttpError(400, "name a brief, for example {\"brief\": \"kras-g12c-hit-to-lead.md\"}")
        const file = resolve(path(config, "briefs"), safeId(basename(brief))) // a file in board/briefs, never a path
        if (!existsSync(file)) throw new HttpError(404, "no such brief")
        const runId = await start(file)
        launch(runId)
        // Say what was started: the dashboard must not present a scripted run as research. `mode` is the one to read.
        return json(res, 201, { runId, scripted: mockNow(), mode: mockNow() ? (LOCAL ? "local" : "scripted") : "real" })
      }
      if (parts[1] === "runs" && parts[2]) {
        let runId: string
        try { runId = safeId(decodeURIComponent(parts[2])) } catch { throw new HttpError(400, "invalid run id") }
        if (parts[3] === "events") return sse(req, res, runId)
        if (parts[3] === "resume" && req.method === "POST") {
          // A caller that is neither the dashboard nor a token holder learns nothing about the run.
          if (!mockNow() && !gate(req, res, "scripted", "resuming a board run with real models", trust)) return
          if (!existsSync(`${runDir(config, runId)}/run.json`)) throw new HttpError(404, "no such run")
          if (!active.has(runId) && lockHolder(runDir(config, runId)) !== undefined) throw new RunBusy("another process is working on this run")
          if (paidCallsOff()) refusePaidRun(loadState(config, runId)) // 403: a run started with real models stays paused, whoever asks
          if (!mayRun(req, res, "resuming a board run with real models")) return
          if (!loadState(config, runId).finished) checkDailyBudget(config, new Date(), mockNow()) // 429 past the daily cap
          launch(runId)
          return json(res, 202, { runId })
        }
        if (parts[3] === "memo") {
          const file = `${runDir(config, runId)}/memo.md`
          return existsSync(file) ? (res.writeHead(200, { "content-type": "text/markdown" }), void res.end(readFileSync(file))) : json(res, 404, { error: "no memo yet" })
        }
      }
      json(res, 404, { error: "not found" })
    } catch (error) {
      if (res.headersSent) return void res.end()
      const code = error instanceof HttpError ? error.status : error instanceof BriefRejected ? 400 : error instanceof BudgetReached ? 429 : error instanceof RunBusy ? 409 : error instanceof PaidCallsOff ? 403 : 500
      json(res, code, { error: String(error instanceof Error ? error.message : error) })
    }
  }

  /** Continue runs a previous process left unfinished. runBoard refuses one past the daily cap or held by another process, and says so. */
  const resumePaused = () => {
    for (const r of listRuns()) if (r.status === "paused") { console.log(`resuming ${r.id}`); launch(r.id) }
    for (const id of research.resume()) console.log(`continuing research answer ${id}`) // answers and queued questions an earlier process left unfinished
  }

  return { handler, listRuns, launch, resumePaused, get mock() { return mockNow() } }
}
