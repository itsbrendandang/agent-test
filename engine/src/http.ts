// Shared HTTP checks for the engine's local server. The server can start paid model runs, so:
// - it answers only requests addressed to this machine by name (Host check, against DNS rebinding),
// - a request that carries an Origin must come from the dashboard (browsers always send Origin on
//   cross-origin POSTs, so another web page cannot start a run or read a memo),
// - POST bodies must be application/json (a cross-origin text/plain POST needs no preflight) and small,
// - ids that become folder names are checked before any path is built.
import { timingSafeEqual } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"

/** An error that maps to an HTTP status. */
export class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

// 5317 is the dashboard (Vite dev server, Docker, Tauri dev); 5173 and 4173 are Vite's defaults.
const DEFAULT_ORIGINS = [5317, 5173, 4173].flatMap((p) => [`http://127.0.0.1:${p}`, `http://localhost:${p}`])
  .concat(["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"])

const list = (value: string | undefined) => (value ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean)

/** Origins allowed to call the engine. Extend with DASHBOARD_ORIGINS (comma-separated). */
export const dashboardOrigins = (env: NodeJS.ProcessEnv = process.env): Set<string> =>
  new Set([...DEFAULT_ORIGINS, ...list(env.DASHBOARD_ORIGINS)])

type HasHeaders = Pick<IncomingMessage, "headers">

/** "allowed": Origin is the dashboard. "none": no Origin (CLI, curl, same-origin GET). "forbidden": any other Origin. */
export function originState(req: HasHeaders, env: NodeJS.ProcessEnv = process.env): "allowed" | "none" | "forbidden" {
  const origin = req.headers.origin
  if (origin === undefined) return "none"
  return dashboardOrigins(env).has(origin.replace(/\/$/, "")) ? "allowed" : "forbidden"
}

/** True only when the request carries an Origin on the dashboard allow-list. */
export const allowedOrigin = (req: HasHeaders, env: NodeJS.ProcessEnv = process.env): boolean => originState(req, env) === "allowed"

/** True when Host names this machine (localhost, 127.0.0.1, [::1], or a name in ENGINE_HOSTS). Any port. */
export function allowedHost(req: HasHeaders, env: NodeJS.ProcessEnv = process.env): boolean {
  const host = (req.headers.host ?? "").toLowerCase()
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0]
  return ["localhost", "127.0.0.1", "[::1]", ...list(env.ENGINE_HOSTS).map((h) => h.toLowerCase())].includes(name)
}

/**
 * Run at the top of every request. Sets the CORS headers for an allowed Origin, answers preflights, and
 * refuses a foreign Host or Origin with 403. Returns false when the response has been sent.
 */
export function guard(req: IncomingMessage, res: ServerResponse, env: NodeJS.ProcessEnv = process.env): boolean {
  const refuse = (message: string) => { res.writeHead(403, { "content-type": "application/json" }); res.end(JSON.stringify({ error: message })); return false }
  if (!allowedHost(req, env)) return refuse("this server answers only to localhost")
  const state = originState(req, env)
  if (state === "forbidden") return refuse("origin not allowed; add it to DASHBOARD_ORIGINS if it is your dashboard")
  if (state === "allowed") {
    res.setHeader("access-control-allow-origin", req.headers.origin as string)
    res.setHeader("vary", "origin")
    res.setHeader("access-control-allow-headers", "content-type, x-glhf-token")
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS")
  }
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return false }
  return true
}

/** Parse a JSON object body. 415 unless content-type is application/json, 413 over `limit` bytes, 400 if not a JSON object. */
export function readJson<T = Record<string, unknown>>(req: IncomingMessage, limit = 1 << 20): Promise<T> {
  return new Promise((ok, fail) => {
    const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase()
    if (type !== "application/json") { req.resume(); return fail(new HttpError(415, "send the body as content-type: application/json")) }
    const chunks: Buffer[] = []
    let size = 0, done = false
    req.on("data", (c: Buffer) => {
      if (done) return
      size += c.length
      if (size > limit) { done = true; req.resume(); return fail(new HttpError(413, `request body is larger than ${limit} bytes`)) }
      chunks.push(c)
    })
    req.on("error", (e) => { if (!done) { done = true; fail(e) } })
    req.on("end", () => {
      if (done) return
      done = true
      try {
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object")
        ok(value as T)
      } catch { fail(new HttpError(400, "the body is not a JSON object")) }
    })
  })
}

const SAFE_ID = /^[\w.-]+$/

/** True for a name that is safe as one path segment: letters, digits, "_", "." and "-", and no "..". */
export const isSafeId = (id: unknown): id is string => typeof id === "string" && id.length <= 200 && SAFE_ID.test(id) && !id.includes("..")

/** Returns the id, or throws HttpError 400. Use before any path is built from a run id or file name. */
export function safeId(id: unknown): string {
  if (!isSafeId(id)) throw new HttpError(400, "invalid id")
  return id
}

/** True when the x-glhf-token header equals the token in `tokenFile` (written by the server at startup, mode 600). */
export function hasToken(req: HasHeaders, tokenFile: string): boolean {
  const sent = req.headers["x-glhf-token"]
  if (typeof sent !== "string" || !sent || !existsSync(tokenFile)) return false
  const a = Buffer.from(sent), b = Buffer.from(readFileSync(tokenFile, "utf8").trim())
  return a.length === b.length && b.length > 0 && timingSafeEqual(a, b)
}

/**
 * The complete lines of an append-only file from byte offset `from`, and the offset to continue at.
 * Offsets are bytes, so a multi-byte character never shifts the next read.
 */
export function linesFrom(data: Buffer, from: number): { lines: string[]; next: number } {
  const end = data.lastIndexOf(0x0a) + 1 // just past the last newline
  if (end <= from) return { lines: [], next: from }
  return { lines: data.subarray(from, end).toString("utf8").split("\n").filter(Boolean), next: end }
}
