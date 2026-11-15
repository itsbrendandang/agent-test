// The engine's local server: HTTP + SSE for the dashboard. The routes and their checks are in app.ts.
// Runs execute in this process; on startup, unfinished runs resume (so a board keeps going across restarts
// and long deliberations).
//
// The server listens on 127.0.0.1 only (HOST overrides, for a container).
import { createServer } from "node:http"
import "./env.ts"
import { bindHost, createApp } from "./app.ts"
import { startTracker } from "./glhf/routes.ts"
import { paidCallsLine } from "./paid.ts"
import { boardKeysLine, boardModeLine } from "./providers.ts"
import { LOCAL, loadConfig, MOCK } from "./config.ts"

const PORT = Number(process.env.DRUG_BOARD_PORT ?? 8787)
const HOST = bindHost()
const app = createApp()

createServer((req, res) => void app.handler(req, res)).listen(PORT, HOST, () => {
  console.log(`AI Scientist Bot engine on http://${HOST}:${PORT}`)
  console.log(boardModeLine(loadConfig(), app.mock, LOCAL))
  console.log(paidCallsLine())
  if (!MOCK) console.warn(boardKeysLine(loadConfig())) // paid calls are on: say now if a real board run would be refused for a missing key
  app.resumePaused()
  void startTracker().catch((e) => console.error("glhf tracker failed to start:", e)) // continues unfinished GLHF runs
})

// Stop on request. Locks on runs in progress are released on the way out (runlock.ts).
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => process.exit(signal === "SIGINT" ? 130 : 143))
