// The engine's HTTP request handler, without the listening. server.ts listens; tests call the handler on a
// throwaway server. Importing this file starts nothing.
//
//   GET  /api/status             mode (mock or live), whether paid calls are allowed (NO_PAID_CALLS, see paid.ts)
//                                and which keys are present (never the keys)
//   GET  /api/roster             lead + board members with task, deliverable, model tier
//   GET  /api/briefs             briefs available to run
//   GET  /api/runs               runs with status
//   POST /api/runs {brief}       start a run (from the dashboard; without an Origin, a paid run needs the token)
//   POST /api/runs/:id/resume    resume a run (same rule)
//   GET  /api/runs/:id/events    SSE: the whole event log, then live events (204 for a run with no log)
//   GET  /api/runs/:id/memo      the memo (Markdown)
//   GET  /api/search?q=          keyword search over all runs
//   POST /api/ask {question}     a small model answers from the run records (see ask.ts)
//   /api/glhf/*                  GLHF benchmark runs (see glhf/routes.ts)
//
// Every request first passes the checks in http.ts: Host must be this machine, an Origin must be the
// dashboard's, POST bodies must be JSON.
import { existsSync, readdirSync, readFileSync, watch } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import { basename, resolve } from "node:path"
import { loadAgent, loadRoster } from "./agents.ts"
import { BudgetReached, checkDailyBudget, loadState, lockHolder, refusePaidRun, RunBusy, runBoard, runDir, startRun, summarize } from "./board.ts"
import { BriefRejected } from "./brief.ts"
import { type BoardConfig, loadConfig, MOCK, path } from "./config.ts"
import { handleGlhf, hasSessionToken } from "./glhf/routes.ts"
import { guard, HttpError, isSafeId, linesFrom, originState, readJson, safeId } from "./http.ts"
import { PaidCallsOff, paidCallsOff } from "./paid.ts"
import { search } from "./search.ts"

/** The address the server listens on unless HOST says otherwise: this machine only. */
export const DEFAULT_HOST = "127.0.0.1"
export const bindHost = (env: NodeJS.ProcessEnv = process.env): string => env.HOST || DEFAULT_HOST

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
}

export function createApp(options: AppOptions = {}) {
  const config = options.config ?? loadConfig()
  const mock = options.mock ?? MOCK
  const hasToken = options.hasToken ?? hasSessionToken
  const run = options.run ?? ((runId: string) => runBoard(runId))
  const start = options.start ?? startRun
  const env = options.env ?? process.env
  const active = new Set<string>()

  function launch(runId: string) {
    if (active.has(runId)) return
    active.add(runId)
    run(runId)
      .catch((e) => (e instanceof RunBusy || e instanceof BudgetReached || e instanceof PaidCallsOff ? console.log(`run ${runId} not continued: ${e.message}`) : console.error(`run ${runId} failed:`, e)))
      .finally(() => active.delete(runId))
  }

  const listRuns = () => {
    const dir = path(config, "runs")
    if (!existsSync(dir)) return []
    return readdirSync(dir).filter((d) => isSafeId(d) && existsSync(`${dir}/${d}/run.json`)).sort().reverse().flatMap((id) => {
      let s: ReturnType<typeof loadState>
      try { s = loadState(config, id) } catch { return [] } // an unreadable run.json hides that run, not the list
      // "running" also when another process (the CLI) holds the run's lock, so it is not resumed twice.
      const status = s.finished ? "done" : active.has(id) || lockHolder(`${dir}/${id}`) !== undefined ? "running" : "paused"
      return [{ id, brief: s.briefFile.split("/").pop(), startedAt: s.startedAt, status, ...summarize(`${dir}/${id}`, s) }]
    })
  }

  const json = (res: ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" })
    res.end(JSON.stringify(body))
  }

  /** May this request start or resume a board run? The dashboard may. Without an Origin (CLI, curl), a paid run needs the token. */
  const mayRun = (req: IncomingMessage) => originState(req, env) === "allowed" || mock || hasToken(req)

  function sse(req: IncomingMessage, res: ServerResponse, runId: string) {
    const file = `${runDir(config, runId)}/events.jsonl`
    // 204 tells an EventSource to stop reconnecting; there is nothing to stream for a run that does not exist.
    if (!existsSync(file)) { res.writeHead(204); return void res.end() }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" })
    let sent = 0 // bytes
    const flush = () => {
      const { lines, next } = linesFrom(readFileSync(file), sent)
      sent = next
      for (const line of lines) res.write(`data: ${line}\n\n`)
    }
    flush()
    const watcher = watch(file, flush) // works for runs started by the CLI too
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000)
    req.on("close", () => { watcher.close(); clearInterval(ping) })
  }

  async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!guard(req, res, env)) return // foreign Host or Origin: refused; preflight: answered
    const url = new URL(req.url ?? "/", "http://x")
    const parts = url.pathname.split("/").filter(Boolean) // api, runs, :id, events
    if (parts[0] === "api" && parts[1] === "glhf") return handleGlhf(req, res, parts)
    try {
      if (url.pathname === "/api/status") return json(res, 200, {
        mock,
        paidCalls: !paidCallsOff(),
        keys: Object.fromEntries(["OPENROUTER_API_KEY", "EXA_API_KEY", "OPENAI_API_KEY", "TYPESAFE_API_KEY"].map((k) => [k, Boolean(env[k])])),
        meeting: config.meeting, models: config.models,
      })
      if (url.pathname === "/api/search") return json(res, 200, search(url.searchParams.get("q") ?? "", listRuns()))
      if (url.pathname === "/api/ask") return (await import("./ask.ts")).handleAsk(req, res, listRuns()) // AI search over experiments
      if (url.pathname === "/api/roster") {
        const lead = loadAgent(config, "lead-scientist")
        return json(res, 200, [lead, ...loadRoster(config)].map(({ prompt: _p, ...a }) => ({ ...a, modelId: config.models[a.model] })))
      }
      if (url.pathname === "/api/briefs") return json(res, 200,
        readdirSync(path(config, "briefs")).filter((f) => f.endsWith(".md") && !f.startsWith("_")))
      if (url.pathname === "/api/runs" && req.method === "GET") return json(res, 200, listRuns())
      if (url.pathname === "/api/runs" && req.method === "POST") {
        const { brief } = await readJson<{ brief?: unknown }>(req)
        if (!mayRun(req)) throw new HttpError(403, "starting a paid run from outside the dashboard needs the x-glhf-token header (glhf/runs/.token)")
        if (!mock && paidCallsOff()) throw new PaidCallsOff("starting a board run with real models") // not reachable with the engine's own MOCK; kept for a handler built with mock: false
        if (typeof brief !== "string" || !brief.endsWith(".md")) throw new HttpError(400, "name a brief, for example {\"brief\": \"kras-g12c-hit-to-lead.md\"}")
        const file = resolve(path(config, "briefs"), safeId(basename(brief))) // a file in board/briefs, never a path
        if (!existsSync(file)) throw new HttpError(404, "no such brief")
        const runId = await start(file)
        launch(runId)
        return json(res, 201, { runId })
      }
      if (parts[1] === "runs" && parts[2]) {
        let runId: string
        try { runId = safeId(decodeURIComponent(parts[2])) } catch { throw new HttpError(400, "invalid run id") }
        if (parts[3] === "events") return sse(req, res, runId)
        if (parts[3] === "resume" && req.method === "POST") {
          if (!mayRun(req)) throw new HttpError(403, "resuming a paid run from outside the dashboard needs the x-glhf-token header (glhf/runs/.token)")
          if (!existsSync(`${runDir(config, runId)}/run.json`)) throw new HttpError(404, "no such run")
          if (!active.has(runId) && lockHolder(runDir(config, runId)) !== undefined) throw new RunBusy("another process is working on this run")
          if (paidCallsOff()) refusePaidRun(loadState(config, runId)) // 403: a run started with real models stays paused
          if (!loadState(config, runId).finished) checkDailyBudget(config, new Date(), mock) // 429 past the daily cap
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
  const resumePaused = () => { for (const r of listRuns()) if (r.status === "paused") { console.log(`resuming ${r.id}`); launch(r.id) } }

  return { handler, listRuns, launch, resumePaused, mock }
}
