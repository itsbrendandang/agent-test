// HTTP + SSE for the dashboard. Runs execute in this process; on startup, unfinished runs resume
// (so a board keeps going across restarts and long deliberations).
//
//   GET  /api/status             mode (mock or live) and which keys are present (never the keys)
//   GET  /api/roster             lead + board members with task, deliverable, model tier
//   GET  /api/briefs             briefs available to run
//   GET  /api/runs               runs with status
//   POST /api/runs {brief}       start a run (from the dashboard; without an Origin, a paid run needs the token)
//   POST /api/runs/:id/resume    resume a run (same rule)
//   GET  /api/runs/:id/events    SSE: the whole event log, then live events
//   GET  /api/runs/:id/memo      the memo (Markdown)
//   /api/glhf/*                  GLHF benchmark runs (see glhf/routes.ts)
//
// The server listens on 127.0.0.1 only (HOST overrides, for a container) and applies the checks in
// http.ts to every request: Host must be this machine, an Origin must be the dashboard's, POST bodies
// must be JSON.
import { chmodSync, existsSync, readdirSync, readFileSync, watch } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { basename, resolve } from "node:path"
import { search } from "./search.ts"
import "./env.ts"
import { loadAgent, loadRoster } from "./agents.ts"
import { BudgetReached, checkDailyBudget, lockHolder, loadState, RunBusy, runBoard, runDir, startRun } from "./board.ts"
import { BriefRejected } from "./brief.ts"
import { loadConfig, MOCK, path } from "./config.ts"
import { handleGlhf, startTracker, TOKEN_FILE } from "./glhf/routes.ts"
import { guard, hasToken, HttpError, isSafeId, linesFrom, originState, readJson, safeId } from "./http.ts"

const PORT = Number(process.env.DRUG_BOARD_PORT ?? 8787)
const HOST = process.env.HOST ?? "127.0.0.1"
const config = loadConfig()
const active = new Set<string>()

function launch(runId: string) {
  if (active.has(runId)) return
  active.add(runId)
  runBoard(runId)
    .catch((e) => (e instanceof RunBusy || e instanceof BudgetReached ? console.log(`run ${runId} not continued: ${e.message}`) : console.error(`run ${runId} failed:`, e)))
    .finally(() => active.delete(runId))
}

const listRuns = () => {
  const dir = path(config, "runs")
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((d) => isSafeId(d) && existsSync(`${dir}/${d}/run.json`)).sort().reverse().map((id) => {
    const s = loadState(config, id)
    // "running" also when another process (the CLI) holds the run's lock, so it is not resumed twice.
    const status = s.finished ? "done" : active.has(id) || lockHolder(`${dir}/${id}`) !== undefined ? "running" : "paused"
    return { id, brief: s.briefFile.split("/").pop(), rounds: s.rounds, startedAt: s.startedAt, status, claims: s.ledger.length }
  })
}

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

/** May this request start or resume a board run? The dashboard may. Without an Origin (CLI, curl), a paid run needs the token. */
const mayRun = (req: IncomingMessage) => originState(req) === "allowed" || MOCK || hasToken(req, TOKEN_FILE)

function sse(req: IncomingMessage, res: ServerResponse, runId: string) {
  const file = `${runDir(config, runId)}/events.jsonl`
  if (!existsSync(file)) return json(res, 404, { error: "no such run" })
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

createServer(async (req, res) => {
  if (!guard(req, res)) return // foreign Host or Origin: refused; preflight: answered
  const url = new URL(req.url ?? "/", "http://x")
  const parts = url.pathname.split("/").filter(Boolean) // api, runs, :id, events
  if (parts[0] === "api" && parts[1] === "glhf") return handleGlhf(req, res, parts)
  try {
    if (url.pathname === "/api/status") return json(res, 200, {
      mock: MOCK,
      keys: Object.fromEntries(["OPENROUTER_API_KEY", "EXA_API_KEY", "OPENAI_API_KEY", "TYPESAFE_API_KEY"].map((k) => [k, Boolean(process.env[k])])),
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
      if (typeof brief !== "string" || !brief.endsWith(".md")) throw new HttpError(400, "name a brief, for example {\"brief\": \"kras-g12c-hit-to-lead.md\"}")
      const file = resolve(path(config, "briefs"), safeId(basename(brief))) // a file in board/briefs, never a path
      if (!existsSync(file)) throw new HttpError(404, "no such brief")
      const runId = await startRun(file)
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
        if (!loadState(config, runId).finished) checkDailyBudget(config) // 429 past the daily cap
        launch(runId)
        return json(res, 202, { runId })
      }
      if (parts[3] === "memo") {
        const file = `${runDir(config, runId)}/memo.md`
        return existsSync(file) ? (res.writeHead(200, { "content-type": "text/markdown" }), res.end(readFileSync(file))) : json(res, 404, { error: "no memo yet" })
      }
    }
    json(res, 404, { error: "not found" })
  } catch (error) {
    if (res.headersSent) return void res.end()
    const code = error instanceof HttpError ? error.status : error instanceof BriefRejected ? 400 : error instanceof BudgetReached ? 429 : error instanceof RunBusy ? 409 : 500
    json(res, code, { error: String(error instanceof Error ? error.message : error) })
  }
}).listen(PORT, HOST, () => {
  console.log(`drug-board engine on http://${HOST}:${PORT}  (${MOCK ? "mock models" : "live models"})`)
  // Paused runs continue. runBoard refuses one past the daily cap or held by another process, and says so.
  for (const run of listRuns()) if (run.status === "paused") { console.log(`resuming ${run.id}`); launch(run.id) }
  void startTracker().catch((e) => console.error("glhf tracker failed to start:", e)) // continues unfinished GLHF runs
  try { chmodSync(TOKEN_FILE, 0o600) } catch { /* written by startTracker; absent only if that failed */ } // also when the file already existed
})
