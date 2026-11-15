#!/usr/bin/env node
// One command to use the app: starts the engine and the dashboard, waits until both answer,
// opens the browser, and stops both when you press Ctrl+C. Paid calls stay off unless .env says otherwise.
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"

const ENGINE = "http://127.0.0.1:8787/api/glhf/status"
const DASHBOARD = "http://127.0.0.1:5317/"
const up = async (url) => { try { return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok } catch { return false } }
const wait = async (url, name) => {
  for (let i = 0; i < 60; i++) { if (await up(url)) return; await new Promise((r) => setTimeout(r, 500)) }
  throw new Error(`${name} did not start within 30 seconds. Run it on its own to see why: npm run ${name}`)
}

if (!existsSync("engine/node_modules") || !existsSync("dashboard/node_modules")) {
  console.error("First-time setup is needed. Run:  npm run setup\nThen run:  npm start"); process.exit(1)
}

const children = []
const run = (name, args) => { const c = spawn("npm", ["run", "--silent", ...args], { stdio: ["ignore", "inherit", "inherit"] }); children.push(c); c.on("exit", (code) => { if (code) console.error(`${name} stopped (exit ${code}).`) }); return c }
const stop = () => { for (const c of children) c.kill("SIGTERM"); process.exit(0) }
process.on("SIGINT", stop); process.on("SIGTERM", stop)

try {
  if (await up(ENGINE)) console.log("Engine is already running."); else { run("engine", ["engine"]); await wait(ENGINE, "engine") }
  if (await up(DASHBOARD)) console.log("Dashboard is already running."); else { run("dashboard", ["dashboard"]); await wait(DASHBOARD, "dashboard") }
} catch (e) { console.error(String(e.message ?? e)); stop() }

console.log(`\nAI Scientist Bot is ready:  ${DASHBOARD}\nPress Ctrl+C here to stop it.\n`)
if (!process.env.NO_OPEN) spawn(process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open", process.platform === "win32" ? ["/c", "start", DASHBOARD] : [DASHBOARD], { stdio: "ignore", detached: true }).on("error", () => {})
if (!children.length) process.exit(0)
