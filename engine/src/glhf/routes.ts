// /api/glhf/* for the dashboard's Swarm view. See types.ts for the shapes.
//
//   GET  /api/glhf/status        the record to beat, which tools and keys this machine has (never the keys), the
//                                limits a request must keep (`limits`, from types.ts) and the models to offer
//   GET  /api/glhf/roles         the swarm's roles: instructions and time shares, read from the solver code
//   GET  /api/glhf/runs          runs, newest first
//   GET  /api/glhf/scoreboard    single agent against swarm, runs paired only when their settings match
//   POST /api/glhf/runs          start a run. Who may start what is in tracker.ts (checkRequest):
//                                cloud runs and case directories need the CLI's token; a real model, Exa and
//                                memory need the token or the dashboard's own Origin; anyone else gets the demo
//                                Body: a RunRequest; `solvers: ["glhf", "single"]` instead of `solver` starts a
//                                matched pair, the second when the first is settled. Answers 201 {id, ids}.
//                                409 {error, run} while a local run is still going: one local run at a time.
//                                400 {error, field?}: `field` names the input the refusal is about.
//   GET  /api/glhf/runs/:id      one run with its ledger, FINDINGS.md and METHODS.md
//   POST /api/glhf/runs/:id/cancel   stop a local run and mark it cancelled; answers the run. A settled run is
//                                returned unchanged. Open to the dashboard and to local callers, like every route.
import { execFile } from "node:child_process"
import { randomBytes, timingSafeEqual } from "node:crypto"
import { chmodSync, mkdirSync, writeFileSync } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import { allowedOrigin, HttpError, readJson } from "../http.ts"
import { childEnv } from "../paid.ts"
import { statusBody } from "./doctor.ts"
import { scoreboard } from "./scoreboard.ts"
import { BIXBENCH, listRuns, runDetail, RUNS, safeId } from "./store.ts"
import { BadRequest, CannotCancel, checkStart, LocalBusy, NoSuchRun, openTracker, type Tracker, TrackerBusy } from "./tracker.ts"
import { RECORD, type StartBody } from "./types.ts"

// Any web page can POST to localhost, and runs cost money. So a request may start a cloud run or name a case
// directory only with this token, which the server writes to a file only local users can read. Runs with a
// real model need the token or the dashboard's own Origin (the server refuses other Origins before this).
export const TOKEN_FILE = `${RUNS}/.token`
const token = randomBytes(24).toString("hex")

let tracker: Tracker | undefined
let retry: ReturnType<typeof setTimeout> | undefined
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
    retry = setTimeout(() => void startTracker().catch((e) => console.error("glhf tracker failed to start:", e)), 3_000)
  }
}

/** Stop tracking and release the tracker lock. Runs that were launched go on; the next startTracker continues them. */
export async function stopTracker(): Promise<void> {
  clearTimeout(retry)
  const open = tracker
  tracker = undefined
  await open?.close()
}

// The roles as the solver defines them (instructions, time shares), read from the Python code once.
let roles: Promise<unknown> | undefined
const loadRoles = () => (roles ??= new Promise((ok, fail) => {
  execFile("uv", ["run", "python", "-m", "bixbench3.inspect_harness.swarm.catalog"], { cwd: BIXBENCH, env: childEnv(), timeout: 120_000, maxBuffer: 8 << 20 },
    (error, stdout) => { try { if (error) throw error; ok(JSON.parse(stdout)) } catch (e) { roles = undefined; fail(e) } })
}))

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

/**
 * Does the request carry this server's token? Compared with the token in memory, not with the file: a file
 * left by an earlier engine must not open this one.
 */
export const hasSessionToken = (req: Pick<IncomingMessage, "headers">) => {
  const sent = Buffer.from(String(req.headers["x-glhf-token"] ?? "")), mine = Buffer.from(token)
  return sent.length === mine.length && timingSafeEqual(sent, mine)
}
const hasToken = hasSessionToken
/** This server's token, for the CLI and for tests in the same process. Never send it in a response. */
export const sessionToken = () => token

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
      const body = await readJson<StartBody>(req) // 415 unless application/json, 413 over 1 MB
      const requests = checkStart(body, { token: hasToken(req), origin: allowedOrigin(req) })
      if (!tracker) return json(res, 503, { error: "the run tracker is held by another process; try again shortly" })
      const ids = (await tracker.startChain(requests)).map((run) => run.id)
      return json(res, 201, { id: ids[0], ids }) // `id` is the first run: what callers that start one run read
    }
    if (parts[2] === "scoreboard" && req.method === "GET") return json(res, 200, scoreboard(listRuns()))
    if (parts[2] === "runs" && parts[3] && !parts[4] && req.method === "GET") {
      let id: string
      try { id = decodeURIComponent(parts[3]) } catch { return json(res, 400, { error: "invalid run id" }) }
      if (!safeId(id)) return json(res, 400, { error: "invalid run id" })
      const detail = runDetail(id)
      return detail ? json(res, 200, detail) : json(res, 404, { error: "no such run" })
    }
    if (parts[2] === "runs" && parts[3] && parts[4] === "cancel" && !parts[5] && req.method === "POST") {
      let id: string
      try { id = decodeURIComponent(parts[3]) } catch { return json(res, 400, { error: "invalid run id" }) }
      if (!safeId(id)) return json(res, 400, { error: "invalid run id" })
      if (!tracker) return json(res, 503, { error: "the run tracker is held by another process; try again shortly" })
      return json(res, 200, await tracker.cancel(id))
    }
    json(res, 404, { error: "not found" })
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error)
    if (error instanceof BadRequest) return json(res, 400, error.field ? { error: message, field: error.field } : { error: message })
    if (error instanceof LocalBusy) return json(res, 409, { error: message, run: error.run })
    if (error instanceof CannotCancel) return json(res, 409, { error: message })
    if (error instanceof NoSuchRun) return json(res, 404, { error: "no such run" })
    json(res, error instanceof HttpError ? error.status : 500, { error: message })
  }
}
