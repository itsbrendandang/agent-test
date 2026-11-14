// /api/glhf/* for the dashboard's Swarm view. See types.ts for the shapes.
//
//   GET  /api/glhf/status        the record to beat, and which tools and keys this machine has (never the keys)
//   GET  /api/glhf/runs          runs, newest first
//   POST /api/glhf/runs          start a run; cloud runs need the CLI's token (see below)
//   GET  /api/glhf/runs/:id      one run with its ledger, FINDINGS.md and METHODS.md
import { randomBytes } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import { statusBody } from "./doctor.ts"
import { listRuns, runDetail, RUNS } from "./store.ts"
import { BadRequest, checkRequest, openTracker, type Tracker, TrackerBusy } from "./tracker.ts"
import { RECORD, type RunRequest } from "./types.ts"

// Any web page can POST to localhost, and a cloud run costs money. So a request may start a cloud run or name
// a case directory only with this token, which the server writes to a file only local users can read.
export const TOKEN_FILE = `${RUNS}/.token`
const token = randomBytes(24).toString("hex")

let tracker: Tracker | undefined
let status: { at: number; body: Awaited<ReturnType<typeof statusBody>> } | undefined

/** Take over tracking and continue unfinished runs. Retries while a CLI command holds the tracker. */
export async function startTracker(): Promise<void> {
  mkdirSync(RUNS, { recursive: true })
  writeFileSync(TOKEN_FILE, token, { mode: 0o600 })
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

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

const readBody = (req: IncomingMessage) => new Promise<Partial<RunRequest>>((ok) => {
  let data = ""
  req.on("data", (c) => (data += c))
  req.on("end", () => { try { ok(JSON.parse(data || "{}") as Partial<RunRequest>) } catch { ok({}) } })
})

/** Handles a request under /api/glhf. `parts` is the path split on "/": api, glhf, runs, :id. */
export async function handleGlhf(req: IncomingMessage, res: ServerResponse, parts: string[]): Promise<void> {
  try {
    if (parts[2] === "status" && req.method === "GET") {
      if (!status || Date.now() - status.at > 30_000) status = { at: Date.now(), body: await statusBody() }
      return json(res, 200, { record: RECORD, ...status.body })
    }
    if (parts[2] === "runs" && !parts[3] && req.method === "GET") return json(res, 200, listRuns())
    if (parts[2] === "runs" && !parts[3] && req.method === "POST") {
      if (!tracker) return json(res, 503, { error: "the run tracker is held by another process; try again shortly" })
      const trusted = req.headers["x-glhf-token"] === token
      const run = await tracker.start(checkRequest(await readBody(req), trusted))
      return json(res, 201, { id: run.id })
    }
    if (parts[2] === "runs" && parts[3] && req.method === "GET") {
      const detail = runDetail(decodeURIComponent(parts[3]))
      return detail ? json(res, 200, detail) : json(res, 404, { error: "no such run" })
    }
    json(res, 404, { error: "not found" })
  } catch (error) {
    json(res, error instanceof BadRequest ? 400 : 500, { error: String(error instanceof Error ? error.message : error) })
  }
}
