#!/usr/bin/env node
// `npm run troubleshoot`: a quick, read-only helper that checks the common things people get
// stuck on before the app will run. It never spends money, never starts the app, and changes
// nothing. It only looks and reports.
//
//   npm run troubleshoot
//
// For the written guide with explanations and fixes, see docs/faq.md.
// Exit code: 0 when nothing needs attention, 1 when at least one check wants a fix.

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import net from "node:net"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const rows = []
// status: "ok" (good), "warn" (worth knowing), "fix" (needs attention before the app runs)
const add = (status, part, detail) => {
  rows.push({ status, part, detail })
  const tag = status === "ok" ? "ok  " : status === "warn" ? "warn" : "FIX "
  console.log(`${tag}  ${part}: ${detail}`)
}

/** Is a TCP port already taken on localhost? Resolves true when something is listening. */
function portInUse(port) {
  return new Promise((done) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => { socket.destroy(); done(true) })
    socket.on("error", () => done(false))
    socket.setTimeout(700, () => { socket.destroy(); done(false) })
  })
}

// 1. Node.js version (the project needs 24 or newer).
{
  const major = Number(process.versions.node.split(".")[0])
  if (major >= 24) add("ok", "Node.js", `v${process.versions.node}`)
  else add("fix", "Node.js", `v${process.versions.node} — need v24 or newer (https://nodejs.org)`)
}

// 2. uv (the Python side is installed and run with it).
{
  const r = spawnSync("uv", ["--version"], { encoding: "utf8" })
  if (r.status === 0) add("ok", "uv", r.stdout.trim())
  else add("fix", "uv", "not found — install from https://docs.astral.sh/uv/")
}

// 3. Dependencies installed (npm run setup was run).
{
  const engine = existsSync(join(ROOT, "engine", "node_modules"))
  const dashboard = existsSync(join(ROOT, "dashboard", "node_modules"))
  if (engine && dashboard) add("ok", "dependencies", "engine and dashboard installed")
  else add("fix", "dependencies", `missing ${[!engine && "engine", !dashboard && "dashboard"].filter(Boolean).join(" and ")} — run: npm run setup`)
}

// 4. .env file and run mode.
{
  const envPath = join(ROOT, ".env")
  if (!existsSync(envPath)) {
    add("warn", ".env", "not found — copy it with: cp .env.example .env (leave keys blank for Demo mode)")
  } else {
    const text = readFileSync(envPath, "utf8")
    const noPaid = /^\s*NO_PAID_CALLS\s*=\s*0\s*$/m.test(text)
    const keys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "EXA_API_KEY"]
    const set = keys.filter((k) => new RegExp(`^\\s*${k}\\s*=\\s*\\S`, "m").test(text))
    if (noPaid) {
      const missing = keys.filter((k) => !set.includes(k))
      if (missing.length) add("fix", ".env", `Real mode is on (NO_PAID_CALLS=0) but missing keys: ${missing.join(", ")}`)
      else add("ok", ".env", "Real mode is on, all three keys set (check them free with: npm run preflight)")
    } else {
      add("ok", ".env", `Demo mode (free). Keys set: ${set.length ? set.join(", ") : "none"}`)
    }
  }
}

// 5. Ports the app uses (8787 engine, 5317 dashboard).
{
  const engineBusy = await portInUse(8787)
  const dashBusy = await portInUse(5317)
  add(engineBusy ? "warn" : "ok", "port 8787 (engine)", engineBusy ? "in use — an engine may already be running (lsof -i :8787)" : "free")
  add(dashBusy ? "warn" : "ok", "port 5317 (dashboard)", dashBusy ? "in use — the dashboard may already be running (lsof -i :5317)" : "free")
}

// Summary.
const fixes = rows.filter((r) => r.status === "fix").length
const warns = rows.filter((r) => r.status === "warn").length
console.log("")
if (fixes === 0 && warns === 0) {
  console.log("All good. Start the app with: npm start  (then open http://localhost:5317)")
} else {
  console.log(`${fixes} to fix, ${warns} to note. Full guide: docs/faq.md`)
}
process.exit(fixes === 0 ? 0 : 1)
