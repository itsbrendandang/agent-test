// What a run record says about how it was made and what it used, and what the engine says about its own mode:
// the manifest (commit, hashes, versions) in board run.json, research record.json and GET /api/status; the board's
// token usage per model in run.json; the RESEARCH_PREVIEW state in GET /api/status, the chat catalog and the start-up
// line; and what `npm start` prints about the engine it uses (startinfo.ts).
// Scripted models only, paid calls off. No request leaves 127.0.0.1.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

process.env.NO_PAID_CALLS = "1"
process.env.DRUG_BOARD_MOCK = "1"
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.startsWith("http://127.0.0.1:")) return realFetch(input, init)
  throw new Error(`a test tried to reach ${url}`)
}) as typeof fetch

const { fileHash, folderHash, runManifest } = await import("../src/manifest.ts")
const { directAnswers, previewLine, previewOn } = await import("../src/research/preview.ts")
const { engineSummary } = await import("../src/startinfo.ts")
const { loadConfig, MOCK, path } = await import("../src/config.ts")
const { createApp } = await import("../src/app.ts")
const { runBoard, startRun } = await import("../src/board/board.ts")
const { createResearch } = await import("../src/research/routes.ts")
const { loadRecord } = await import("../src/research/store.ts")

const servers: Server[] = []
after(() => { for (const s of servers) s.close() })

function tempConfig() {
  const real = loadConfig(), dir = mkdtempSync(join(tmpdir(), "run-records-"))
  return { ...real, paths: { ...real.paths, runs: join(dir, "runs"), expertise: join(dir, "expertise") } }
}
async function serve(handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}
const getJson = async (url: string) => (await fetch(url, { headers: { origin: "http://127.0.0.1:5317" } })).json() as Promise<Record<string, unknown>>

test("this file runs scripted", () => assert.equal(MOCK, true))

test("manifest: commit and versions of this checkout, and 16-character content hashes that follow the files", () => {
  const m = runManifest()
  assert.ok(m.commit === null || /^[0-9a-f]{40}$/.test(m.commit), `commit: ${m.commit}`)
  assert.ok(m.dirty === null || typeof m.dirty === "boolean")
  assert.equal(m.versions.node, process.versions.node)
  assert.match(m.versions.piAi ?? "", /^\d+\.\d+\.\d+/)
  assert.match(m.versions.piDurable ?? "", /^\d+\.\d+\.\d+/)
  for (const h of Object.values(m.hashes)) assert.match(h ?? "", /^[0-9a-f]{16}$/)
  assert.deepEqual(Object.keys(m.hashes).sort(), ["boardAgents", "config", "researchPrompts"])

  const dir = mkdtempSync(join(tmpdir(), "manifest-"))
  assert.equal(folderHash(dir), null, "no .md file: no hash")
  assert.equal(fileHash(join(dir, "missing.md")), null)
  writeFileSync(join(dir, "a.md"), "one"); writeFileSync(join(dir, "notes.txt"), "ignored")
  const first = folderHash(dir)
  writeFileSync(join(dir, "notes.txt"), "changed")
  assert.equal(folderHash(dir), first, "only .md files count")
  writeFileSync(join(dir, "a.md"), "two")
  assert.notEqual(folderHash(dir), first, "a changed prompt changes the hash")
  const text = JSON.stringify(m)
  assert.ok(!text.includes(process.cwd()) && !text.includes(tmpdir()), "no local path is recorded")
})

test("RESEARCH_PREVIEW: direct answers always in Demo mode, in Real mode only with exactly 1; the start-up line says which", () => {
  assert.equal(directAnswers(true, {}), true)
  assert.equal(directAnswers(false, {}), false)
  assert.equal(directAnswers(false, { RESEARCH_PREVIEW: "1" }), true)
  assert.equal(directAnswers(false, { RESEARCH_PREVIEW: "true" }), false)
  assert.equal(previewOn({ RESEARCH_PREVIEW: "1" }), true)
  assert.match(previewLine(false, {}), /^Direct answers \(Research screen\): OFF\. RESEARCH_PREVIEW is not 1/)
  assert.match(previewLine(false, { RESEARCH_PREVIEW: "1" }), /^Direct answers \(Research screen\): ON \(RESEARCH_PREVIEW=1\)/)
  assert.match(previewLine(true, {}), /DEMO answers, nothing is spent.*now not set/)
})

test("GET /api/status reports the preview switch, and the status carries the manifest", async () => {
  for (const [mock, env, preview, direct] of [[false, {}, false, false], [false, { RESEARCH_PREVIEW: "1" }, true, true], [true, {}, false, true]] as const) {
    const app = createApp({ config: tempConfig(), mock, env: { ...env } })
    const url = await serve((req, res) => void app.handler(req, res))
    const status = await getJson(`${url}/api/status`)
    assert.deepEqual([status.researchPreview, status.directAnswers], [preview, direct], `mock ${mock}, ${JSON.stringify(env)}`)
    assert.deepEqual(Object.keys(status.manifest as object).sort(), ["commit", "dirty", "hashes", "versions"])
  }
})

test("board: a new run records its manifest, and a finished scripted run records token usage per model", async () => {
  const config = tempConfig()
  const runId = await startRun(path(config, "briefs", "kras-g12c-hit-to-lead.md"), { config, mock: true })
  const file = join(config.paths.runs, runId, "run.json")
  const started = JSON.parse(readFileSync(file, "utf8"))
  assert.deepEqual(Object.keys(started.manifest).sort(), ["commit", "dirty", "hashes", "versions"])
  assert.equal(started.usage, undefined)
  await runBoard(runId, undefined, { config, mock: true })
  const done = JSON.parse(readFileSync(file, "utf8"))
  assert.equal(done.finished, true)
  assert.deepEqual(done.manifest, started.manifest, "the manifest is the one of the start")
  const models = Object.entries(done.usage ?? {}) as [string, { input?: number; output?: number; totalTokens?: number; cost?: { total?: number } }][]
  assert.ok(models.length > 0, "usage per model is in run.json")
  for (const [name, u] of models) {
    assert.match(name, /\//, "keyed provider/model")
    assert.ok(Number.isFinite(u.input) && Number.isFinite(u.output) && Number.isFinite(u.totalTokens), `${name} has token counts`)
  }
})

test("research: an answer's record carries the manifest", async () => {
  const config = tempConfig()
  mkdirSync(config.paths.runs, { recursive: true })
  const research = createResearch({ config, env: { NO_PAID_CALLS: "1" }, hasToken: () => false, mock: () => true })
  const url = await serve((req, res) => void research.handle(req, res, new URL(req.url ?? "/", "http://x").pathname.split("/").filter(Boolean)))
  const res = await fetch(`${url}/api/research`, { method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:5317" }, body: JSON.stringify({ question: "Does drug X lower blood pressure in adults?", effort: "quick" }) })
  assert.equal(res.status, 202)
  const { id } = await res.json() as { id: string }
  await research.idle()
  const record = loadRecord(config, id)
  assert.equal(record?.status, "done")
  assert.deepEqual(Object.keys(record?.manifest ?? {}).sort(), ["commit", "dirty", "hashes", "versions"])
  await research.stop()
})

test("npm start: mode, paid switch, keys (yes or no only), direct answers, and a warning for an engine that is not this folder's", () => {
  const status = { mock: false, paidCalls: true, paidSource: "env", keys: { ANTHROPIC_API_KEY: true, OPENAI_API_KEY: false, EXA_API_KEY: true }, directAnswers: false, manifest: { commit: "a".repeat(40), dirty: false } }
  const fresh = engineSummary(status, "a".repeat(40), false)
  assert.deepEqual(fresh.warnings, [])
  assert.match(fresh.lines.join("\n"), /Mode: +Real/)
  assert.match(fresh.lines.join("\n"), /Paid calls: +ON \(NO_PAID_CALLS=0\)/)
  assert.match(fresh.lines.join("\n"), /Keys set: +Anthropic yes, OpenAI no, Exa yes/)
  assert.match(fresh.lines.join("\n"), /Direct answers: +OFF\. RESEARCH_PREVIEW is not 1/)
  assert.ok(!fresh.lines.some((l) => l.includes("already running")))

  const same = engineSummary(status, "a".repeat(40), true)
  assert.deepEqual(same.warnings, [])
  assert.ok(same.lines.some((l) => l.includes("already running")), "a reused engine is said to be reused")
  const other = engineSummary(status, "b".repeat(40), true)
  assert.match(other.warnings[0] ?? "", /runs commit aaaaaaaaaa, but this folder is at bbbbbbbbbb/)
  const older = engineSummary({ mock: true, paidCalls: false }, "b".repeat(40), true)
  assert.match(older.warnings[0] ?? "", /does not say which code it runs/)
  const unknown = engineSummary({ ...status, manifest: { commit: null, dirty: null } }, "b".repeat(40), true)
  assert.match(unknown.warnings[0] ?? "", /cannot say which commit it runs/)
  assert.match(engineSummary({ ...status, paidSource: "switch" }, null, false).lines.join("\n"), /turned on in the app/)
  assert.match(engineSummary(undefined, null, true).warnings[0] ?? "", /Could not read the engine's mode/)
  assert.ok(!JSON.stringify(engineSummary(status, null, true)).includes("sk-"), "never a key value")
})
