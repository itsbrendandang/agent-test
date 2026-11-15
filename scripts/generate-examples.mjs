import { spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "node:http"
import { createResearch } from "../engine/src/research/routes.ts"
import { loadConfig } from "../engine/src/config.ts"

const root = fileURLToPath(new URL("../", import.meta.url))
const stage = mkdtempSync(resolve(homedir(), "glhf-examples-"))
const port = Number(process.env.EXAMPLES_PORT ?? 8812)
const base = `http://127.0.0.1:${port}`
const out = resolve(root, "examples")
mkdirSync(out, { recursive: true })
const child = spawn(process.execPath, ["engine/src/server.ts"], { cwd: root, env: { ...process.env, NO_PAID_CALLS: "1", PAID_SWITCH_LOCKED: "1", DRUG_BOARD_MOCK: "1", DRUG_BOARD_PORT: String(port), DRUG_BOARD_RUNS_DIR: `${stage}/board`, GLHF_RUNS_DIR: `${stage}/glhf`, GLHF_HIDE_EXAMPLES: "1" }, stdio: ["ignore", "pipe", "inherit"] })
const ready = new Promise((ok, fail) => {
  const timer = setTimeout(() => fail(new Error("Isolated engine did not start")), 60000)
  const end = (error) => { clearTimeout(timer); if (error) fail(error); else ok() }
  child.stdout.on("data", (data) => { if (data.toString().includes(`engine on http://127.0.0.1:${port}`)) end() })
  child.once("error", end)
  child.once("exit", (code) => end(new Error(`Isolated engine exited (${code})`)))
})
const pause = () => new Promise((r) => setTimeout(r, 100))
async function call(path, body) {
  const res = await fetch(base + path, body === undefined ? {} : { method: "POST", headers: { origin: "http://127.0.0.1:5317", "content-type": "application/json" }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`)
  return res.json()
}
async function until(fn) { for (let n = 0; n < 1200; n++) { const v = await fn(); if (v) return v; await pause() } throw new Error("Demo generation timed out") }
const entries = []
try {
  await ready
  await until(async () => { try { await call("/api/status"); return true } catch { if (child.exitCode !== null) throw new Error("Isolated engine exited"); return false } })
  const questions = [
    ["GLP-1 market", "What GLP-1s are working in the market right now?", "quick"],
    ["Safety and specialists", "Is hERG a safety risk for KRAS G12C inhibitors?", "standard"],
    ["Hypothesis investigation", "Investigate hypotheses for KRAS G12C inhibitor response and resistance", "standard"],
    ["Clinical evidence", "Do KRAS G12C inhibitors work in previously treated lung cancer?", "standard"],
    ["Stopped research", "Investigate KRAS G12C safety and resistance", "standard"],
  ]
  for (const [title, question, effort] of questions) {
    let id
    if (title === "Stopped research") {
      const config = loadConfig()
      config.paths.runs = `${stage}/board`
      const deps = { config, env: { ...process.env, NO_PAID_CALLS: "1", PAID_SWITCH_LOCKED: "1" }, hasToken: () => true, mock: () => true }
      let stopped = createResearch({ ...deps, onStored: () => "stop" })
      const server = createServer((req, res) => void stopped.handle(req, res, new URL(req.url, base).pathname.split("/").filter(Boolean)))
      await new Promise((r) => server.listen(0, "127.0.0.1", r))
      const stopBase = `http://127.0.0.1:${server.address().port}`
      const post = async (path, body) => { const res = await fetch(stopBase + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) throw new Error(await res.text()); return res.json() }
      try {
        id = (await post("/api/research", { question, effort })).id
        await stopped.idle()
        stopped = createResearch(deps)
        await post(`/api/research/${id}/cancel`, {})
        await stopped.idle()
      } finally { await stopped.stop(); server.closeAllConnections(); await new Promise((r) => server.close(r)) }
    } else id = (await call("/api/research", { question, effort })).id
    const record = await until(async () => { const r = await call(`/api/research/${id}`); return ["done", "cancelled", "failed"].includes(r.status) ? r : false })
    if (title === "Stopped research" && record.status !== "cancelled") throw new Error("Cancellation raced completion; regenerate rather than invent a stopped run")
    const source = `${stage}/board/.research/${id}`
    mkdirSync(`${out}/${id}`, { recursive: true })
    const artifacts = existsSync(`${source}/artifacts.json`) ? JSON.parse(readFileSync(`${source}/artifacts.json`, "utf8")) : []
    for (const name of ["record.json", "events.jsonl", "artifacts.json", ...artifacts.map((a) => a.name)]) if (existsSync(`${source}/${name}`)) cpSync(`${source}/${name}`, `${out}/${id}/${name}`)
    entries.push({ id, kind: "answer", title, question, status: record.status, thread: record.thread, startedAt: record.startedAt })
  }
  const { runId: id } = await call("/api/runs", { brief: "kras-g12c-hit-to-lead.md" })
  const run = await until(async () => (await call("/api/runs")).find((r) => r.id === id && r.status === "done"))
  mkdirSync(`${out}/${id}`, { recursive: true })
  for (const name of ["run.json", "events.jsonl", "memo.md"]) cpSync(`${stage}/board/${id}/${name}`, `${out}/${id}/${name}`)
  entries.push({ ...run, kind: "board", title: "KRAS G12C board review" })
  writeFileSync(`${out}/manifest.json`, JSON.stringify(entries, null, 2) + "\n")
  for (const dir of readdirSync(out, { withFileTypes: true })) if (dir.isDirectory() && !entries.some((e) => e.id === dir.name)) rmSync(`${out}/${dir.name}`, { recursive: true })
  console.log(`Generated ${entries.length} scripted, $0 examples in ${out}; staging: ${stage}`)
} finally { child.kill("SIGTERM") }
