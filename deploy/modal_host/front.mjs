// The front door of the hosted app. One small Node program, no dependencies. It is the only thing that listens
// on the container's public port. The engine listens on 127.0.0.1 inside the container and is never exposed.
//
// What it does, in this order, for every request:
//   1. Sign-in. Nothing is served to a caller without a valid session cookie: not the app's files, not the API,
//      not the event stream. The only exception is the sign-in itself (POST /login). A person signs in with a
//      personal access code; the front keeps only the SHA-256 of each code (ASB_ACCESS_HASHES).
//   2. Same-origin check. An API request, and every request that is not a GET, must come from this app's own
//      page: `Sec-Fetch-Site: same-origin`, and an `Origin` header (when there is one) equal to this address.
//      This matters here more than usual: every Modal app lives under modal.run, which is not on the public
//      suffix list, so a page on somebody else's Modal app is "same-site" and SameSite cookies do not stop it.
//   3. Hosted limits. Requests the hosted engine cannot serve are refused here in plain words (NOT_HOSTED).
//   4. Static files of the built dashboard, or a pass-through to the engine for /api/*.
//
// To the engine, the front is the dashboard: it sends the engine's own default dashboard Origin
// (http://127.0.0.1:5317) and Host (127.0.0.1), so the engine's Host and Origin checks stay as they are and need
// no configuration. The engine's session token (x-glhf-token) is passed through untouched: it still guards
// everything that can cost money, and the front never sees or stores its value.
import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { createReadStream, existsSync, statSync } from "node:fs"
import { createServer, request as httpRequest } from "node:http"
import { extname, join, normalize, sep } from "node:path"
import { fileURLToPath } from "node:url"

export const COOKIE = "__Host-asb_session" // __Host-: only this exact host can set it, only over https, for path /
const ENGINE_ORIGIN = "http://127.0.0.1:5317" // the engine's default dashboard origin (engine/src/http.ts)
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2", ".wasm": "application/wasm", ".txt": "text/plain; charset=utf-8", ".webp": "image/webp", ".jpg": "image/jpeg" }

/** Requests the hosted engine cannot serve. Stage 3 (sandbox runs on Modal) removes entries from this list. */
export const NOT_HOSTED = [
  { method: "POST", path: /^\/api\/glhf\/runs\/?$/, error: "Swarm and benchmark runs are not available in the hosted app yet. They need an analysis sandbox (Docker), and the host has none. Board reviews, the chat, saved research and the graph work here. To start a swarm run, use the app on a machine with Docker." },
  { method: "GET", path: /^\/api\/glhf\/roles\/?$/, error: "The swarm's role descriptions are read from the benchmark harness, which is not in the hosted app yet. The board's members are listed under Agents." },
  { method: "POST", path: /^\/api\/setup(\/|$)/, error: "Setup is for the app on your own machine. The hosted app needs no setup." },
]

export const sha256 = (text) => createHash("sha256").update(text).digest("hex")
const b64 = (buffer) => buffer.toString("base64url")
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) }

/** The people who may sign in: {name: sha256 hex of the access code}. Names are lower-case letters, digits, "_" and "-". */
export function parseAccess(env = process.env) {
  let hashes = {}
  try { hashes = JSON.parse(env.ASB_ACCESS_HASHES ?? "{}") } catch { hashes = {} }
  const users = new Map()
  if (hashes && typeof hashes === "object" && !Array.isArray(hashes)) {
    for (const [name, hash] of Object.entries(hashes)) if (/^[a-z0-9_-]{1,32}$/.test(name) && typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash)) users.set(name, hash)
  }
  const key = typeof env.ASB_COOKIE_KEY === "string" && /^[0-9a-f]{64,}$/.test(env.ASB_COOKIE_KEY) ? env.ASB_COOKIE_KEY : ""
  const days = Number(env.ASB_SESSION_DAYS)
  return { users, key, sessionSeconds: (Number.isFinite(days) && days > 0 && days <= 30 ? days : 7) * 86400, configured: users.size > 0 && key !== "" }
}

/** The cookie value for `name`, good until `expires` (seconds). The signature also covers the person's code hash, so a new code ends the old sessions. */
export function signSession(access, name, expires) {
  const sig = createHmac("sha256", access.key).update(`${name}.${expires}.${access.users.get(name)}`).digest()
  return `${name}.${expires}.${b64(sig)}`
}

/** The signed-in person's name, or undefined. */
export function readSession(access, cookieHeader, now = Date.now()) {
  if (!access.configured || typeof cookieHeader !== "string") return undefined
  for (const part of cookieHeader.split(";")) {
    const at = part.indexOf("=")
    if (at < 0 || part.slice(0, at).trim() !== COOKIE) continue
    const [name, expires, sig, ...rest] = part.slice(at + 1).trim().split(".")
    if (rest.length || !name || !sig || !/^\d{1,12}$/.test(expires ?? "") || !access.users.has(name)) continue
    if (Number(expires) * 1000 <= now) continue
    if (same(signSession(access, name, expires), `${name}.${expires}.${sig}`)) return name
  }
  return undefined
}

/** The person whose access code this is, or undefined. Every stored hash is compared, so the time does not tell which names exist. */
export function whoHasCode(access, code) {
  if (typeof code !== "string") return undefined
  code = code.trim()
  if (code.length < 20 || code.length > 200) return undefined // a short code could be guessed; access.py makes 32 random characters
  const given = sha256(code)
  let found
  for (const [name, hash] of access.users) if (same(given, hash)) found = name
  return found
}

const CSP = Object.entries({
  "default-src": "'self'", "script-src": "'self' 'wasm-unsafe-eval'", "style-src": "'self' 'unsafe-inline'", "img-src": "'self' data: blob:",
  "font-src": "'self' data:", "connect-src": "'self'", "object-src": "'none'", "frame-src": "'none'", "base-uri": "'self'", "form-action": "'self'", "frame-ancestors": "'none'",
}).map(([k, v]) => `${k} ${v}`).join("; ")
// referrer-policy is "same-origin", not "no-referrer": with "no-referrer" a browser sends `Origin: null` on a form
// POST (the Fetch rule for navigation requests), and the sign-in form would fail its own same-origin check. Found
// with a real browser; curl does not show it. Nothing is sent to other sites either way.
const SECURITY = { "content-security-policy": CSP, "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "same-origin", "strict-transport-security": "max-age=31536000", "x-robots-tag": "noindex, nofollow" }

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])

/** The sign-in page. No script, no outside file: nothing of the app is given to a person who is not signed in. */
export function loginPage(message = "", next = "/") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Sign in</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#f6f5f2;color:#1c1b19;display:grid;place-items:center;min-height:100vh;margin:0}main{background:#fff;border:1px solid #dcd9d2;border-radius:12px;padding:28px;width:min(92vw,380px)}h1{font-size:20px;margin:0 0 4px}p{margin:0 0 16px;color:#57534e;font-size:14px}label{display:block;font-size:14px;margin-bottom:6px}input{box-sizing:border-box;width:100%;font:inherit;padding:10px;border:1px solid #a8a29e;border-radius:8px}button{margin-top:14px;width:100%;font:inherit;padding:10px;border:0;border-radius:8px;background:#1c1b19;color:#fff;cursor:pointer}.msg{color:#b42318;font-size:14px;margin:12px 0 0}</style></head>
<body><main><h1>AI Scientist Bot</h1><p>This is a private app. Sign in with your access code.</p>
<form method="post" action="/login"><input type="hidden" name="next" value="${escapeHtml(next)}"><input type="text" name="username" value="AI Scientist Bot" autocomplete="username" hidden>
<label for="code">Access code</label><input id="code" name="code" type="password" autocomplete="current-password" required autofocus>
<button type="submit">Sign in</button></form>${message ? `<p class="msg" role="alert">${escapeHtml(message)}</p>` : ""}</main></body></html>`
}

/** A path on this site to go to after sign-in. Anything else (another site, a scheme, "//host") becomes "/". */
export const safeNext = (next) => (typeof next === "string" && /^\/(?!\/)[\w\-./?=&%#~]*$/.test(next) && !next.startsWith("/login") && !next.startsWith("/api/") ? next : "/")

function readBody(req, limit = 4096) {
  return new Promise((ok, fail) => {
    const chunks = []
    let size = 0
    req.on("data", (c) => { size += c.length; if (size > limit) { fail(new Error("too large")); req.destroy() } else chunks.push(c) })
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")))
    req.on("error", fail)
  })
}

const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"])
// Not passed to the engine: the session cookie (the engine has no use for it), the caller's Origin and Host (the
// front has checked them and sends the engine its own), and what Modal's proxy added.
const DROP_REQUEST = (name) => HOP.has(name) || name === "cookie" || name === "host" || name === "origin" || name === "referer" || name === "forwarded" || name.startsWith("x-forwarded-") || name.startsWith("modal-") || name.startsWith("sec-") || name === "authorization"
const DROP_RESPONSE = (name) => HOP.has(name) || name.startsWith("access-control-") || name === "vary"

/**
 * options: root (the built dashboard), engine ({host, port}), env (access settings), now, log (one line per request),
 * maxFailures / failureWindowMs (wrong codes allowed, in total, before sign-in is paused).
 */
export function createFront(options) {
  const env = options.env ?? process.env
  const access = parseAccess(env)
  const root = options.root
  const engine = options.engine ?? { host: "127.0.0.1", port: 8787 }
  const now = options.now ?? Date.now
  const log = options.log ?? (() => {})
  const pinnedOrigin = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(env.ASB_PUBLIC_ORIGIN ?? "") ? env.ASB_PUBLIC_ORIGIN : ""
  // Wrong codes allowed per caller address in ten minutes. A code is 32 random characters, so guessing is hopeless
  // with or without this; the limit keeps a guessing script from filling the log. It is per address so that a
  // stranger cannot lock the real people out of signing in.
  const maxFailures = options.maxFailures ?? 10, failureWindowMs = options.failureWindowMs ?? 10 * 60_000
  const failures = new Map() // caller address -> times of wrong codes
  const callerOf = options.callerOf ?? ((req) => String(req.headers["x-forwarded-for"] ?? "").split(",").pop().trim() || req.socket.remoteAddress || "unknown")
  const secure = options.secure ?? true

  const selfOrigin = (req) => pinnedOrigin || `${secure ? "https" : "http"}://${req.headers.host ?? ""}`

  /** Did this request come from this app's own page (or from a program that is not a browser)? */
  function sameOrigin(req) {
    const site = req.headers["sec-fetch-site"]
    if (site !== undefined && site !== "same-origin") return false
    const origin = req.headers.origin
    return origin === undefined || origin === selfOrigin(req)
  }

  function send(req, res, status, headers, body, who) {
    res.writeHead(status, { ...SECURITY, "cache-control": "no-store", ...headers })
    res.end(req.method === "HEAD" ? undefined : body)
    log(`${new Date(now()).toISOString()} ${who ?? "-"} ${req.method} ${(req.url ?? "").split("?")[0].slice(0, 200)} ${status}`)
  }
  const json = (req, res, status, body, who) => send(req, res, status, { "content-type": "application/json" }, JSON.stringify(body), who)
  const html = (req, res, status, body, extra = {}) => send(req, res, status, { "content-type": "text/html; charset=utf-8", ...extra }, body)
  const cookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`

  async function login(req, res) {
    if (!sameOrigin(req)) return html(req, res, 403, loginPage("Sign in from this page, not from another site."))
    if ((req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") return html(req, res, 415, loginPage("Use the form on this page."))
    const t = now(), caller = callerOf(req)
    for (const [key, times] of failures) { while (times.length && t - times[0] > failureWindowMs) times.shift(); if (!times.length) failures.delete(key) }
    if (failures.size > 10_000) failures.clear() // bounded memory
    const mine = failures.get(caller) ?? []
    if (mine.length >= maxFailures) return html(req, res, 429, loginPage("Too many wrong codes. Wait ten minutes and try again."), { "retry-after": "600" })
    let form
    try { form = new URLSearchParams(await readBody(req)) } catch { return html(req, res, 413, loginPage("That is not an access code.")) }
    const name = whoHasCode(access, form.get("code"))
    if (!name) {
      mine.push(t)
      failures.set(caller, mine)
      log(`${new Date(t).toISOString()} - sign-in refused: wrong code from ${String(caller).slice(0, 60)} (${mine.length} in ten minutes)`)
      return html(req, res, 401, loginPage("That code is not right. Check it and try again.", safeNext(form.get("next"))))
    }
    const expires = Math.floor(t / 1000) + access.sessionSeconds
    res.setHeader("set-cookie", cookie(signSession(access, name, expires), access.sessionSeconds))
    return send(req, res, 303, { location: safeNext(form.get("next")) }, "", name)
  }

  function serveStatic(req, res, who) {
    let path
    try { path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(/^(\.\.[/\\])+/, "") } catch { return json(req, res, 400, { error: "bad request" }, who) }
    let file = join(root, path)
    const inside = file === root || file.startsWith(root + sep)
    if (!inside || !existsSync(file) || statSync(file).isDirectory()) {
      if (extname(path) && path !== "/index.html") return json(req, res, 404, { error: "not found" }, who) // a missing file is not the app shell
      file = join(root, "index.html")
    }
    if (!existsSync(file)) return json(req, res, 503, { error: "the app's files are missing from this deployment" }, who)
    const shell = file.endsWith("index.html")
    // Hashed asset files never change; "private" keeps them out of shared caches, since only signed-in people may have them.
    res.writeHead(200, { ...SECURITY, "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": shell ? "no-store" : "private, max-age=31536000, immutable" })
    log(`${new Date(now()).toISOString()} ${who} ${req.method} ${path.slice(0, 200)} 200`)
    if (req.method === "HEAD") return void res.end()
    createReadStream(file).on("error", () => res.destroy()).pipe(res)
  }

  function proxy(req, res, who) {
    const headers = {}
    for (const [name, value] of Object.entries(req.headers)) if (!DROP_REQUEST(name) && value !== undefined) headers[name] = value
    headers.host = `${engine.host}:${engine.port}`
    headers.origin = ENGINE_ORIGIN
    const upstream = httpRequest({ host: engine.host, port: engine.port, method: req.method, path: req.url, headers }, (answer) => {
      const out = { ...SECURITY, "cache-control": "no-store" }
      for (const [name, value] of Object.entries(answer.headers)) if (!DROP_RESPONSE(name) && value !== undefined) out[name] = value
      delete out["content-security-policy"] // API answers are data, not pages
      res.writeHead(answer.statusCode ?? 502, out)
      log(`${new Date(now()).toISOString()} ${who} ${req.method} ${(req.url ?? "").split("?")[0].slice(0, 200)} ${answer.statusCode}`)
      answer.pipe(res)
      res.on("close", () => answer.destroy()) // the browser left (an event stream): free the engine's stream too
    })
    upstream.on("error", () => {
      if (res.headersSent) return void res.destroy()
      json(req, res, 502, { error: "The engine is not answering. It may be starting: wait a few seconds and try again." }, who)
    })
    res.on("close", () => upstream.destroy()) // the caller went away before the engine answered
    req.pipe(upstream)
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? "/", "http://x")
    const api = url.pathname === "/api" || url.pathname.startsWith("/api/")
    const read = req.method === "GET" || req.method === "HEAD"
    if (!access.configured) return json(req, res, 503, { error: "Access is not set up for this deployment, so nothing is served. See deploy/modal_host/README.md." })
    if (url.pathname === "/login" && req.method === "POST") return login(req, res)

    const who = readSession(access, req.headers.cookie, now())
    if (!who) {
      // Refused: 401 for everything. A person opening a page in a browser gets the sign-in form as the body.
      if (read && !api && (req.headers.accept ?? "").includes("text/html")) return html(req, res, 401, loginPage("", safeNext(url.pathname === "/login" ? url.searchParams.get("next") ?? "/" : url.pathname + url.search)))
      return json(req, res, 401, { error: "Sign in first: open this address in a browser and enter your access code." })
    }
    if (url.pathname === "/login") return send(req, res, 303, { location: "/" }, "", who)
    if (url.pathname === "/logout") {
      if (req.method !== "POST") return html(req, res, 200, `<!doctype html><meta charset="utf-8"><title>Sign out</title><body style="font:16px system-ui;padding:40px"><p>Signed in as ${escapeHtml(who)}.</p><form method="post" action="/logout"><button>Sign out</button></form> <a href="/">Back to the app</a></body>`)
      if (!sameOrigin(req)) return json(req, res, 403, { error: "not from this app's page" }, who)
      res.setHeader("set-cookie", cookie("", 0))
      return send(req, res, 303, { location: "/" }, "", who)
    }
    if ((api || !read) && !sameOrigin(req)) return json(req, res, 403, { error: "This request did not come from the app's own page, so it was refused." }, who)
    if (api) {
      const refused = NOT_HOSTED.find((rule) => rule.method === req.method && rule.path.test(url.pathname))
      if (refused) { req.resume(); return json(req, res, 501, { error: refused.error, hosted: true }, who) }
      return proxy(req, res, who)
    }
    if (!read) return json(req, res, 405, { error: "GET only" }, who)
    return serveStatic(req, res, who)
  }

  return createServer((req, res) => {
    handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(500, { ...SECURITY, "content-type": "application/json" }); res.end(JSON.stringify({ error: "the front door failed" })) })
  })
}

// Started as a program (node front.mjs), not imported by a test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 8000)
  const front = createFront({
    root: process.env.DASHBOARD_DIR ?? "/srv/dashboard",
    engine: { host: "127.0.0.1", port: Number(process.env.ENGINE_PORT ?? 8787) },
    secure: process.env.ASB_INSECURE_COOKIE !== "1", // only for a test on http://localhost
    log: (line) => console.log(`front ${line}`),
  })
  front.listen(port, "0.0.0.0", () => console.log(`front door on :${port} (access ${parseAccess().configured ? `set for ${parseAccess().users.size} people` : "NOT SET: every request is refused"})`))
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => process.exit(0))
}
