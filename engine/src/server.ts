// HTTP + SSE for the dashboard. Runs execute in this process; on startup, unfinished runs resume
// (so a board keeps going across restarts and long deliberations).
//
//   GET  /api/status             mode (mock or live) and which keys are present (never the keys)
//   GET  /api/roster             lead + board members with task, deliverable, model tier
//   GET  /api/briefs             briefs available to run
//   GET  /api/runs               runs with status
//   POST /api/runs {brief}       start a run
//   POST /api/runs/:id/resume    resume a run
//   GET  /api/runs/:id/events    SSE: the whole event log, then live events
//   GET  /api/runs/:id/memo      the memo (Markdown)
//   /api/glhf/*                  GLHF benchmark runs (see glhf/routes.ts)
import { existsSync, readdirSync, readFileSync, statSync, watch } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { resolve } from "node:path"
import { search } from "./search.ts"
import "./env.ts"
import { loadAgent, loadRoster } from "./agents.ts"
import { BudgetReached, loadState, runBoard, runDir, startRun } from "./board.ts"
import { BriefRejected } from "./brief.ts"
import { loadConfig, MOCK, path } from "./config.ts"
import { handleGlhf, startTracker } from "./glhf/routes.ts"

const PORT = Number(process.env.DRUG_BOARD_PORT ?? 8787)
const config = loadConfig()
const active = new Set<string>()

function launch(runId: string) {
  if (active.has(runId)) return
  active.add(runId)
  runBoard(runId).catch((e) => console.error(`run ${runId} failed:`, e)).finally(() => active.delete(runId))
}

const listRuns = () => {
  const dir = path(config, "runs")
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((d) => existsSync(`${dir}/${d}/run.json`)).sort().reverse().map((id) => {
    const s = loadState(config, id)
    const status = s.finished ? "done" : active.has(id) ? "running" : "paused"
    return { id, brief: s.briefFile.split("/").pop(), rounds: s.rounds, startedAt: s.startedAt, status, claims: s.ledger.length }
  })
}

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

const body = (req: IncomingMessage) => new Promise<Record<string, string>>((ok) => {
  let data = ""
  req.on("data", (c) => (data += c))
  req.on("end", () => { try { ok(JSON.parse(data || "{}")) } catch { ok({}) } })
})

function sse(req: IncomingMessage, res: ServerResponse, runId: string) {
  const file = `${runDir(config, runId)}/events.jsonl`
  if (!existsSync(file)) return json(res, 404, { error: "no such run" })
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" })
  let sent = 0
  const flush = () => {
    const size = statSync(file).size
    if (size <= sent) return
    const chunk = readFileSync(file, "utf8").slice(sent)
    const complete = chunk.slice(0, chunk.lastIndexOf("\n") + 1)
    sent += Buffer.byteLength(complete)
    for (const line of complete.split("\n").filter(Boolean)) res.write(`data: ${line}\n\n`)
  }
  flush()
  const watcher = watch(file, flush) // works for runs started by the CLI too
  const ping = setInterval(() => res.write(": ping\n\n"), 15_000)
  req.on("close", () => { watcher.close(); clearInterval(ping) })
}

createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*")
  res.setHeader("access-control-allow-headers", "content-type")
  if (req.method === "OPTIONS") return res.end()
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
    if (url.pathname === "/api/roster") {
      const lead = loadAgent(config, "lead-scientist")
      return json(res, 200, [lead, ...loadRoster(config)].map(({ prompt: _p, ...a }) => ({ ...a, modelId: config.models[a.model] })))
    }
    if (url.pathname === "/api/briefs") return json(res, 200,
      readdirSync(path(config, "briefs")).filter((f) => f.endsWith(".md") && !f.startsWith("_")))
    if (url.pathname === "/api/runs" && req.method === "GET") return json(res, 200, listRuns())
    if (url.pathname === "/api/runs" && req.method === "POST") {
      const { brief } = await body(req)
      const runId = await startRun(resolve(path(config, "briefs"), brief ?? ""))
      launch(runId)
      return json(res, 201, { runId })
    }
    if (parts[1] === "runs" && parts[2]) {
      const runId = decodeURIComponent(parts[2])
      if (parts[3] === "events") return sse(req, res, runId)
      if (parts[3] === "resume" && req.method === "POST") { launch(runId); return json(res, 202, { runId }) }
      if (parts[3] === "memo") {
        const file = `${runDir(config, runId)}/memo.md`
        return existsSync(file) ? (res.writeHead(200, { "content-type": "text/markdown" }), res.end(readFileSync(file))) : json(res, 404, { error: "no memo yet" })
      }
    }
    json(res, 404, { error: "not found" })
  } catch (error) {
    json(res, error instanceof BriefRejected ? 400 : error instanceof BudgetReached ? 429 : 500, { error: String(error instanceof Error ? error.message : error) })
  }
}).listen(PORT, () => {
  console.log(`drug-board engine on http://localhost:${PORT}  (${MOCK ? "mock models" : "live models"})`)
  for (const run of listRuns()) if (run.status === "paused") { console.log(`resuming ${run.id}`); launch(run.id) }
  void startTracker().catch((e) => console.error("glhf tracker failed to start:", e)) // continues unfinished GLHF runs
})
