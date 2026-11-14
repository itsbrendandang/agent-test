// /api/glhf/* for the dashboard's Swarm view. See types.ts for the shapes.
//
//   GET  /api/glhf/status        the record to beat, and which tools and keys this machine has (never the keys)
//   GET  /api/glhf/roles         the swarm's roles: instructions and time shares, read from the solver code
//   GET  /api/glhf/runs          runs, newest first
//   GET  /api/glhf/scoreboard    single agent against swarm, runs paired only when their settings match
//   POST /api/glhf/runs          start a run. Who may start what is in tracker.ts (checkRequest):
//                                cloud runs and case directories need the CLI's token; a real model, Exa and
//                                memory need the token or the dashboard's own Origin; anyone else gets the demo
//   GET  /api/glhf/runs/:id      one run with its ledger, FINDINGS.md and METHODS.md
import { execFile } from "node:child_process"
import { randomBytes, timingSafeEqual } from "node:crypto"
import { chmodSync, mkdirSync, writeFileSync } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import { allowedOrigin, HttpError, readJson } from "../http.ts"
import { statusBody } from "./doctor.ts"
import { scoreboard } from "./scoreboard.ts"
import { BIXBENCH, listRuns, runDetail, RUNS, safeId } from "./store.ts"
import { BadRequest, checkRequest, openTracker, type Tracker, TrackerBusy } from "./tracker.ts"
import { RECORD, type RunRequest } from "./types.ts"

// Any web page can POST to localhost, and runs cost money. So a request may start a cloud run or name a case
// directory only with this token, which the server writes to a file only local users can read. Runs with a
// real model need the token or the dashboard's own Origin (the server refuses other Origins before this).
export const TOKEN_FILE = `${RUNS}/.token`
const token = randomBytes(24).toString("hex")

let tracker: Tracker | undefined
let status: { at: number; body: Awaited<ReturnType<typeof statusBody>> } | undefined

/** Take over tracking and continue unfinished runs. Retries while a CLI command holds the tracker. */
export async function startTracker(): Promise<void> {
  mkdirSync(RUNS, { recursive: true })
  writeFileSync(TOKEN_FILE, token, { mode: 0o600 })
  chmodSync(TOKEN_FILE, 0o600) // the mode above applies only when the file is created
  try {
    tracker = await openTracker()
    const open = tracker.unfinished()
    console.log(`glhf tracker ready${open.length ? `; continuing ${open.map((r) => r.id).join(", ")}` : ""}`)
  } catch (error) {
    if (!(error instanceof TrackerBusy)) throw error
    console.log(`glhf tracker: ${error.message}; retrying in 3 s`)
    setTimeout(() => void startTracker().catch((e) => console.error("glhf tracker failed to start:", e)), 3_000)
  }
}

// The roles as the solver defines them (instructions, time shares), read from the Python code once.
let roles: Promise<unknown> | undefined
const loadRoles = () => (roles ??= new Promise((ok, fail) => {
  execFile("uv", ["run", "python", "-m", "bixbench3.inspect_harness.swarm.catalog"], { cwd: BIXBENCH, timeout: 120_000, maxBuffer: 8 << 20 },
    (error, stdout) => { try { if (error) throw error; ok(JSON.parse(stdout)) } catch (e) { roles = undefined; fail(e) } })
}))

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

const hasToken = (req: IncomingMessage) => {
  const sent = Buffer.from(String(req.headers["x-glhf-token"] ?? "")), mine = Buffer.from(token)
  return sent.length === mine.length && timingSafeEqual(sent, mine)
}

/** Handles a request under /api/glhf. `parts` is the path split on "/": api, glhf, runs, :id. */
export async function handleGlhf(req: IncomingMessage, res: ServerResponse, parts: string[]): Promise<void> {
  try {
    if (parts[2] === "status" && req.method === "GET") {
      if (!status || Date.now() - status.at > 30_000) status = { at: Date.now(), body: await statusBody() }
      return json(res, 200, { record: RECORD, ...status.body })
    }
    if (parts[2] === "roles" && req.method === "GET") return json(res, 200, await loadRoles())
    if (parts[2] === "runs" && !parts[3] && req.method === "GET") return json(res, 200, listRuns())
    if (parts[2] === "runs" && !parts[3] && req.method === "POST") {
      const body = await readJson<Partial<RunRequest>>(req) // 415 unless application/json, 413 over 1 MB
      const request = checkRequest(body, { token: hasToken(req), origin: allowedOrigin(req) })
      if (!tracker) return json(res, 503, { error: "the run tracker is held by another process; try again shortly" })
      const run = await tracker.start(request)
      return json(res, 201, { id: run.id })
    }
    if (parts[2] === "scoreboard" && req.method === "GET") return json(res, 200, scoreboard(listRuns()))
    if (parts[2] === "runs" && parts[3] && !parts[4] && req.method === "GET") {
      let id: string
      try { id = decodeURIComponent(parts[3]) } catch { return json(res, 400, { error: "invalid run id" }) }
      if (!safeId(id)) return json(res, 400, { error: "invalid run id" })
      const detail = runDetail(id)
      return detail ? json(res, 200, detail) : json(res, 404, { error: "no such run" })
    }
    json(res, 404, { error: "not found" })
  } catch (error) {
    json(res, error instanceof HttpError ? error.status : error instanceof BadRequest ? 400 : 500, { error: String(error instanceof Error ? error.message : error) })
  }
}
