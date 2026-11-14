// Serves the built dashboard. No dependencies.
import { createReadStream, existsSync, statSync } from "node:fs"
import { createServer } from "node:http"
import { extname, join, normalize } from "node:path"

const ROOT = process.env.DASHBOARD_DIR ?? "/srv/dashboard"
const PORT = Number(process.env.PORT ?? 5317)
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2", ".wasm": "application/wasm" }

createServer((req, res) => {
  let path
  try {
    path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(/^(\.\.[/\\])+/, "")
  } catch { // a malformed %-escape or URL must not take the server down
    res.writeHead(400, { "content-type": "text/plain" })
    return res.end("bad request")
  }
  let file = join(ROOT, path)
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) file = join(ROOT, "index.html")
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" })
  createReadStream(file).pipe(res)
}).listen(PORT, () => console.log(`dashboard on http://localhost:${PORT}`))
