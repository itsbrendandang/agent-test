import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { createServer, request } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { createApp } from "../src/app.ts"
import { applyOverrides, loadState, OverridesUnreadable, runBoard, runDir, startRun } from "../src/board/board.ts"
import { loadConfig } from "../src/config.ts"
import { EventLog } from "../src/events.ts"

process.env.NO_PAID_CALLS = "1"

function setup(overrides?: unknown) {
  const base = loadConfig()
  const root = mkdtempSync(`${tmpdir()}/ovr-`)
  const config = { ...base, paths: { ...base.paths, runs: root } }
  const dir = runDir(config, "r1")
  mkdirSync(dir, { recursive: true })
  if (overrides !== undefined) writeFileSync(`${dir}/overrides.json`, typeof overrides === "string" ? overrides : JSON.stringify(overrides))
  return config
}

test("no overrides file leaves the config as it is", () => {
  const config = setup()
  assert.equal(applyOverrides(config, "r1"), config)
})

test("overrides narrow members and limits and never widen them", () => {
  const config = setup({ board: ["critic", "not-a-member"], meeting: { max_usd: 0.5, max_minutes: 99999, max_rounds: 1 } })
  const got = applyOverrides(config, "r1")
  assert.deepEqual(got.board, config.board.filter((n) => n === "critic" || n === "evidence-verifier"), "the evidence verifier is always kept")
  assert.equal(got.meeting.max_usd, Math.min(0.5, config.meeting.max_usd))
  assert.equal(got.meeting.max_minutes, config.meeting.max_minutes)
  assert.equal(got.meeting.max_rounds, 1)
})

test("an overrides file that cannot be read refuses the run instead of falling back to the config's wider limits", () => {
  // A plan's narrower members and caps are in this file. Skipping it would run the plan on the whole config.
  for (const bad of ["{not json", '{"meeting": {"max_usd": 0.', "[]", "null", ""]) {
    const config = setup(bad)
    assert.throws(() => applyOverrides(config, "r1"), (e: Error) => e instanceof OverridesUnreadable && /run r1: overrides\.json/.test(e.message), JSON.stringify(bad))
  }
})

test("a hostile overrides file changes nothing", () => {
  for (const bad of [{ board: [], meeting: { max_usd: -1, max_rounds: "9" } }, { board: ["nobody"] }]) {
    const config = setup(bad)
    const got = applyOverrides(config, "r1")
    assert.deepEqual(got.board, config.board)
    assert.deepEqual(got.meeting, config.meeting)
  }
})

test("a run whose overrides.json is cut off is recorded as failed, not left paused, and its roster answers 409", async () => {
  // Scripted models only; nothing is paid. A paused run would be started again at every engine start.
  const base = loadConfig(), root = mkdtempSync(join(tmpdir(), "ovr-run-"))
  const config = { ...base, paths: { ...base.paths, runs: join(root, "runs"), expertise: join(root, "expertise") } }
  const id = await startRun(join(import.meta.dirname, "../../board/briefs/kras-g12c-hit-to-lead.md"), { config, mock: true })
  writeFileSync(join(runDir(config, id), "overrides.json"), '{"meeting": {"max_usd": 0.')
  await assert.rejects(runBoard(id, undefined, { config, mock: true }), OverridesUnreadable)
  assert.match(loadState(config, id).failed ?? "", /overrides\.json/)
  assert.ok(EventLog.read(join(runDir(config, id), "events.jsonl")).some((e) => e.type === "run.failed"))
  const app = createApp({ config, mock: true, env: {} })
  const listed = app.listRuns().find((r) => r.id === id) as { status: string; error?: string }
  assert.equal(listed.status, "failed")
  assert.match(listed.error ?? "", /overrides\.json/)

  const server = createServer((req, res) => void app.handler(req, res))
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
  const port = (server.address() as AddressInfo).port
  try {
    const status = await new Promise<number>((ok, fail) => {
      const req = request({ host: "127.0.0.1", port, path: `/api/chat/roster?run=${id}`, headers: { host: `127.0.0.1:${port}`, origin: "http://127.0.0.1:5317" } }, (res) => { res.resume(); res.on("end", () => ok(res.statusCode ?? 0)) })
      req.on("error", fail)
      req.end()
    })
    assert.equal(status, 409)
  } finally { server.close() }
})
