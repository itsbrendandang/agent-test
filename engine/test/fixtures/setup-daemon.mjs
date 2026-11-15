// A stand-in Docker daemon for test/setup.test.ts: the fake `colima start` runs it on the built-in runtime's socket.
// It knows no image until one is "pulled". It ends by itself after a minute, so a failed test leaves nothing behind.
import { mkdirSync } from "node:fs"
import { createServer } from "node:http"
import { dirname } from "node:path"

const socket = process.argv[2], images = new Set()
mkdirSync(dirname(socket), { recursive: true })
createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://docker")
  if (url.pathname === "/_ping") return void res.end("OK")
  if (url.pathname === "/containers/json") return void res.end("[]")
  const image = /^\/images\/(.+)\/json$/.exec(url.pathname)
  if (image) { res.statusCode = images.has(decodeURIComponent(image[1])) ? 200 : 404; return void res.end("{}") }
  if (url.pathname === "/images/create") {
    images.add(`${url.searchParams.get("fromImage")}:${url.searchParams.get("tag")}`)
    return void res.end(`${JSON.stringify({ status: "Pull complete", id: "a" })}\n`)
  }
  res.statusCode = 404; res.end("{}")
}).listen(socket)
setTimeout(() => process.exit(0), 60_000).unref?.()
