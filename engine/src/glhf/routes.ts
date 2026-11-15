// /api/glhf/* for the dashboard's Swarm view. See types.ts for the shapes.
//
//   GET  /api/glhf/status        the record to beat, which tools and keys this machine has (never the keys), the
//                                limits a request must keep (`limits`, from types.ts) and the models to offer
//   GET  /api/glhf/roles         the swarm's roles: instructions and time shares, read from the solver code. Needs
//                                the dashboard's Origin or the token (it runs `uv`); the answer is kept, and a
//                                failure is not tried again for a minute
//   GET  /api/glhf/runs          runs, newest first
//   GET  /api/glhf/scoreboard    single agent against swarm, runs paired only when their settings match
//   POST /api/glhf/runs          start a run. Needs the dashboard's Origin or the session token (403 without), also
//                                for the scripted demo. Anything that can spend or touches shared state needs the
//                                TOKEN (needsToken below): a real model, role models, Exa, memory, cloud, a case
//                                directory. The Origin alone gets 401 {error, field: "token", needsToken: true}.
//                                With NO_PAID_CALLS on, what is paid is refused first (400), whoever asks.
//                                Body: a RunRequest; `solvers: ["glhf", "single"]` instead of `solver` starts a
//                                matched pair, the second when the first is settled. Answers 201 {id, ids}.
//                                409 {error, run} while a local run is still going: one local run at a time.
//                                400 {error, field?}: `field` names the input the refusal is about.
//   GET  /api/glhf/runs/:id      one run with its ledger, FINDINGS.md and METHODS.md
//   POST /api/glhf/runs/:id/cancel   stop a local run and mark it cancelled; answers the run. A settled run is
//                                returned unchanged, and so is one whose runner has written its result. `detail`
//                                says what was done about the runner and its sandbox containers. Needs the
//                                dashboard's Origin or the token (403 without); the token (401 as above) when the
//                                run is not a plain scripted local run, or its record cannot be read.
import { execFile } from "node:child_process"
import { randomBytes, timingSafeEqual } from "node:crypto"
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import { allowedOrigin, type Caller, gate, type GateOptions, HttpError, type Need, readJson } from "../http.ts"
import { childEnv, paidCallsOff } from "../paid/paid.ts"
import { statusBody } from "./doctor.ts"
import { scoreboard } from "./scoreboard.ts"
import { BIXBENCH, listRuns, runDetail, runDir, RUNS, safeId } from "./store.ts"
import { BadRequest, CannotCancel, checkStart, LocalBusy, NoSuchRun, openTracker, type Tracker, TrackerBusy } from "./tracker.ts"
import { type GlhfRun, RECORD, type StartBody } from "./types.ts"

// Any web page can POST to localhost, any program on this machine can send any Origin, and runs cost money. So
// whatever can spend or touches shared state needs this token, which the server writes to a file only this user
// can read (mode 600). The CLI reads the file. A browser cannot, and no route hands the token out (a route that
// gave it to an Origin would be as spoofable as the Origin): a person pastes it into the dashboard once per engine
// start, and the dashboard sends it as the x-glhf-token header.
export const TOKEN_FILE = `${RUNS}/.token`
const token = randomBytes(24).toString("hex")

let tracker: Tracker | undefined
let announced = false
let retry: ReturnType<typeof setTimeout> | undefined
let status: { at: number; body: Awaited<ReturnType<typeof statusBody>> } | undefined

/** Take over tracking and continue unfinished runs. Retries while a CLI command holds the tracker. */
export async function startTracker(): Promise<void> {
  mkdirSync(RUNS, { recursive: true })
  // Created with mode 600 under another name, then moved into place: the token is never in a file others can read,
  // also when an older file with a wider mode is in the way.
  const fresh = `${TOKEN_FILE}.${process.pid}.tmp`
  rmSync(fresh, { force: true })
  writeFileSync(fresh, token, { mode: 0o600, flag: "wx" })
  renameSync(fresh, TOKEN_FILE)
  // The path, never the token: this output may end up in a shared log.
  if (!announced) { announced = true; console.log(`session token (for paid runs from the dashboard; paste it there when asked): ${TOKEN_FILE}`) }
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

// The roles as the solver defines them (instructions, time shares), read from the Python code once. `uv run` may
// install packages, so a failure is kept for a minute instead of being tried again on every request.
type RolesLoader = () => Promise<unknown>
const readRoles: RolesLoader = () => new Promise((ok, fail) => {
  execFile("uv", ["run", "python", "-m", "bixbench3.inspect_harness.swarm.catalog"], { cwd: BIXBENCH, env: childEnv(), timeout: 120_000, maxBuffer: 8 << 20 },
    (error, stdout) => { try { if (error) throw error; ok(JSON.parse(stdout)) } catch (e) { fail(e) } })
})
export const ROLES_RETRY_MS = 60_000
let roles: { value: Promise<unknown>; failedAt?: number } | undefined
function loadRoles(load: RolesLoader, now = Date.now()): Promise<unknown> {
  if (roles && (roles.failedAt === undefined || now - roles.failedAt < ROLES_RETRY_MS)) return roles.value
  const entry: NonNullable<typeof roles> = { value: Promise.resolve().then(load) }
  entry.value.catch(() => { entry.failedAt = Date.now() })
  roles = entry
  return entry.value
}
/** Forget the cached roles (tests). */
export const forgetRoles = () => { roles = undefined }

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

/** Who is asking, for code outside this file (the chat routes): `access(callerOf(req), need)` from http.ts. */
export const callerOf = (req: Pick<IncomingMessage, "headers">, env: NodeJS.ProcessEnv = process.env): Caller => ({ origin: allowedOrigin(req, env), token: hasSessionToken(req) })

/**
 * The trust rule with this engine's token: true when the request may go on, else the 403 or 401 has been sent
 * (see `gate` in http.ts). Check NO_PAID_CALLS before calling it for paid work.
 */
export const requireTrust = (req: IncomingMessage, res: ServerResponse, need: Need, what: string, options: Partial<GateOptions> = {}): boolean =>
  gate(req, res, need, what, { hasToken: hasSessionToken, tokenFile: TOKEN_FILE, ...options })

const has = (value: unknown) => value !== undefined && value !== null && value !== false && value !== "" && value !== 0
/**
 * Does starting this need the token? Yes for all but the plain scripted run: a real model (anything that is not
 * exactly "mock"), role models, Exa, shared memory, a cloud run, a case directory. A body this misses is still
 * not started: the caller is then checked as an unknown one (checkStart with no trust), who gets the demo only.
 */
export function needsToken(body: unknown): boolean {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false // refused as a bad request
  const b = body as Record<string, unknown>
  const roleModels = b.roleModels
  return (typeof b.model === "string" && b.model !== "mock") || b.mode === "cloud" || has(b.exa) || has(b.memory) || has(b.caseDir)
    || (typeof roleModels === "object" && roleModels !== null && Object.keys(roleModels).length > 0)
}

/** Is this a run only a token holder may stop? Everything but a scripted local run without Exa and memory. */
export const paidRun = (run: GlhfRun): boolean =>
  run.model !== "mock" || run.mode !== "local" || Object.keys(run.roleModels ?? {}).length > 0 || Boolean(run.settings?.exa) || Boolean(run.settings?.memory)

export interface GlhfOptions { /** Reads the roles from the solver code. Tests replace it. */ loadRoles?: RolesLoader }

/** Handles a request under /api/glhf. `parts` is the path split on "/": api, glhf, runs, :id. */
export async function handleGlhf(req: IncomingMessage, res: ServerResponse, parts: string[], options: GlhfOptions = {}): Promise<void> {
  try {
    if (parts[2] === "status" && req.method === "GET") {
      if (!status || Date.now() - status.at > 30_000) status = { at: Date.now(), body: await statusBody() }
      return json(res, 200, { record: RECORD, ...status.body })
    }
    if (parts[2] === "roles" && req.method === "GET") {
      if (!requireTrust(req, res, "scripted", "reading the roles (it runs uv)")) return
      return json(res, 200, await loadRoles(options.loadRoles ?? readRoles))
    }
    if (parts[2] === "runs" && !parts[3] && req.method === "GET") return json(res, 200, listRuns())
    if (parts[2] === "runs" && !parts[3] && req.method === "POST") {
      const body = await readJson<StartBody>(req) // 415 unless application/json, 413 over 1 MB
      if (!requireTrust(req, res, "scripted", "starting and cancelling runs")) return
      if (!hasToken(req) && needsToken(body)) {
        // The switch first: with paid calls off, what is paid is refused as such (400), whoever asks. Checked with
        // full trust so that the refusal is about the switch and not about the caller.
        if (paidCallsOff()) checkStart(body, true)
        if (!requireTrust(req, res, "spend", "a run with a real model, Exa, memory, the cloud or a case directory")) return
      }
      // Past this point a caller without the token has asked for the plain scripted run only.
      const requests = checkStart(body, { token: hasToken(req), origin: false })
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
      if (!requireTrust(req, res, "scripted", "starting and cancelling runs")) return
      if (!hasToken(req)) {
        // A scripted local run may be stopped from the dashboard's page. Anything else, and a run folder whose
        // record cannot be read (so nobody knows what it is), needs the token.
        const run = listRuns().find((r) => r.id === id)
        if ((run ? paidRun(run) : existsSync(runDir(id))) && !requireTrust(req, res, "spend", "cancelling a run that is not a scripted local run")) return
      }
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

/**
 * Stop every local GLHF run that can spend (a paid model, Exa, or memory), for the paid switch going off: the runner is
 * a separate process that was given the provider keys when it started, so only stopping it ends its spending. A cloud
 * run cannot be stopped from here (its VM is removed with `bixbench3 cancel`) and is left; the ids returned are the
 * runs that were asked to stop.
 */
export async function cancelPaidRuns(): Promise<string[]> {
  const stopped: string[] = []
  for (const run of tracker?.unfinished() ?? []) {
    if (!paidRun(run) || run.mode !== "local") continue
    try { await tracker!.cancel(run.id); stopped.push(run.id) } catch { /* settled meanwhile, or not stoppable: nothing to report */ }
  }
  return stopped
}
