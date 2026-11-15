// Serves the built dashboard. No dependencies.
//
// Every response carries a Content-Security-Policy, frame-ancestors 'none' and
// X-Content-Type-Options: nosniff. The page may connect to the engine only:
// ENGINE_ORIGINS (space- or comma-separated origins) names it, by default the engine on this machine at
// GLHF_ENGINE_PORT (8787), under both of its local names. It must be the address the dashboard was built
// with (VITE_ENGINE_URL).
import { createReadStream, existsSync, statSync } from "node:fs"
import { createServer } from "node:http"
import { extname, join, normalize, sep } from "node:path"
import { fileURLToPath } from "node:url"

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2", ".wasm": "application/wasm" }

/** The origins the page may connect to. Anything that is not a plain http(s) origin is dropped, so the value cannot add a directive. */
export function engineOrigins(env = process.env) {
  const port = /^\d{1,5}$/.test(env.GLHF_ENGINE_PORT ?? "") ? env.GLHF_ENGINE_PORT : "8787"
  const given = (env.ENGINE_ORIGINS ?? "").split(/[\s,]+/).filter((o) => /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(o))
  return given.length ? given : [`http://127.0.0.1:${port}`, `http://localhost:${port}`]
}

export function securityHeaders(env = process.env) {
  const csp = {
    "default-src": "'self'",
    "script-src": "'self' 'wasm-unsafe-eval'",
    "style-src": "'self' 'unsafe-inline'",
    "img-src": "'self' data: blob:",
    "font-src": "'self' data:",
    "connect-src": ["'self'", ...engineOrigins(env)].join(" "),
    "object-src": "'none'",
    "frame-src": "'none'",
    "base-uri": "'self'",
    "form-action": "'none'",
    "frame-ancestors": "'none'",
  }
  return {
    "content-security-policy": Object.entries(csp).map(([k, v]) => `${k} ${v}`).join("; "),
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY", // for browsers that do not read frame-ancestors
    "referrer-policy": "no-referrer",
  }
}

export function createDashboardServer(root, env = process.env) {
  const headers = securityHeaders(env)
  return createServer((req, res) => {
    let path
    try {
      path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(/^(\.\.[/\\])+/, "")
    } catch { // a malformed %-escape or URL must not take the server down
      res.writeHead(400, { ...headers, "content-type": "text/plain" })
      return res.end("bad request")
    }
    let file = join(root, path)
    if (!(file === root || file.startsWith(root + sep)) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html")
    res.writeHead(200, { ...headers, "content-type": TYPES[extname(file)] ?? "application/octet-stream" })
    createReadStream(file).on("error", () => res.destroy()).pipe(res)
  })
}

// Started as a program (node serve.mjs), not imported by a test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const PORT = Number(process.env.PORT ?? 5317)
  createDashboardServer(process.env.DASHBOARD_DIR ?? "/srv/dashboard").listen(PORT, () => console.log(`dashboard on http://localhost:${PORT}`))
}
