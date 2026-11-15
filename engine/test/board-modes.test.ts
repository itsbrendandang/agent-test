// One agent, several roles: an agent file declares modes, the lead names one per round, code checks it, and
// the mode is on each reply event and in /api/roster, so the dashboard can draw one figure per role.
// Scripted models and checkers only. The switches are set before the engine is imported, so MOCK is true.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createServer, request, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

process.env.DRUG_BOARD_MOCK = "1"
delete process.env.NO_PAID_CALLS
const { checkModes, missingMemoSections, runBoard } = await import("../src/board.ts")
const { loadAgent, loadRoster } = await import("../src/agents.ts")
const { loadConfig, MOCK, path } = await import("../src/config.ts")
const { createApp } = await import("../src/app.ts")

const servers: Server[] = []
after(() => { for (const s of servers) s.close() })

const MODES = { pilot: "Pilot", full: "Experimenter", revise: "Reviser" }

test("the scripted engine is on for this file", () => {
  assert.equal(MOCK, true, "a full run below must never reach a real model or checker")
})

test("modes come from the agent file, and a bad modes block is an error in that file", () => {
  const config = loadConfig()
  assert.deepEqual(loadAgent(config, "experimenter").modes, MODES)
  assert.equal(loadAgent(config, "critic").modes, undefined)
  const dir = mkdtempSync(join(tmpdir(), "board-modes-agents-"))
  const bad = { ...config, paths: { ...config.paths, agents: dir } }
  for (const [name, modes] of [["list", "[pilot, full]"], ["empty", "{}"], ["caps", '{Pilot: "Pilot"}'], ["blank", '{pilot: ""}']]) {
    writeFileSync(join(dir, `${name}.md`), `---\ntitle: X\nmodes: ${modes}\n---\nPrompt.\n`)
    assert.throws(() => loadAgent(bad, name), /modes|mode needs/, name)
  }
})

test("the lead's modes are checked in code: unknown members and modes are refused, and the round is not counted", () => {
  const roster = loadRoster(loadConfig())
  assert.equal(checkModes(roster, undefined), "")
  assert.equal(checkModes(roster, {}), "")
  assert.equal(checkModes(roster, { experimenter: "revise" }), "")
  assert.match(checkModes(roster, { experimenter: "deploy" }), /no mode "deploy" \(it has: pilot, full, revise\)/)
  assert.match(checkModes(roster, { critic: "pilot" }), /critic has no modes/)
  assert.match(checkModes(roster, { "root-shell": "pilot" }), /root-shell is not on the board/)
  assert.match(checkModes(roster, { experimenter: "x" }), /^Round not run, and not counted/)
})

test("a scripted run: the Experimenter's replies carry the mode the lead named, and the memo passes the Finisher check", async () => {
  const real = loadConfig(), dir = mkdtempSync(join(tmpdir(), "board-modes-run-"))
  const config = { ...real, paths: { ...real.paths, runs: join(dir, "runs"), expertise: join(dir, "expertise") } }
  const runId = "202611140000-modes", runPath = join(config.paths.runs, runId)
  mkdirSync(runPath, { recursive: true })
  const briefFile = path(real, "briefs", "kras-g12c-hit-to-lead.md")
  writeFileSync(join(runPath, "run.json"), JSON.stringify({ runId, briefFile, startedAt: Date.now(), members: {}, rounds: 0, lastRound: [], evidence: {}, ledger: [], escalations: 0, checkerUsd: 0, jevUsd: 0, usd: 0, mock: true }))
  await runBoard(runId, undefined, { config, mock: true })

  const events = readFileSync(join(runPath, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  const replies = events.filter((e) => e.type === "member.replied")
  const modeOf = (member: string) => replies.filter((e) => e.member === member).map((e) => [e.round, e.mode ?? null])
  assert.deepEqual(modeOf("experimenter"), [[1, "pilot"], [2, "revise"], [3, null]], "the lead's mode per round; none for final positions")
  assert.ok(replies.filter((e) => e.member !== "experimenter").every((e) => !("mode" in e)), "members without modes get no mode")
  assert.deepEqual([...new Set(replies.map((e) => e.member))], ["scout", "proposer", "experimenter", "methods-auditor", "critic", "reporter"], "six members: the scout, then the five of the consolidated board")
  assert.ok(events.some((e) => e.type === "claim.checked" && e.verdict === "contradicted"), "the planted wrong claim is caught")
  const memo = readFileSync(join(runPath, "memo.md"), "utf8")
  assert.deepEqual(missingMemoSections(memo), [])
  assert.ok(events.some((e) => e.type === "memo.written"))
})

test("GET /api/roster lists each member's modes, and never a prompt", async () => {
  const app = createApp({ config: loadConfig(), mock: true, env: {}, start: async () => "x", run: async () => {} })
  const server = createServer((req, res) => void app.handler(req, res))
  servers.push(server)
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
  const port = (server.address() as AddressInfo).port
  const body = await new Promise<string>((ok, fail) => {
    const req = request({ host: "127.0.0.1", port, method: "GET", path: "/api/roster", headers: { host: `127.0.0.1:${port}` } }, (res) => {
      let text = ""
      res.on("data", (d) => (text += d))
      res.on("end", () => (res.statusCode === 200 ? ok(text) : fail(new Error(`status ${res.statusCode}: ${text}`))))
    })
    req.on("error", fail)
    req.end()
  })
  const roster = JSON.parse(body)
  assert.deepEqual(roster.map((m: any) => m.name), ["lead-scientist", "scout", "proposer", "experimenter", "methods-auditor", "critic", "reporter"])
  assert.deepEqual(roster.find((m: any) => m.name === "experimenter").modes, MODES)
  assert.ok(roster.filter((m: any) => m.name !== "experimenter").every((m: any) => !("modes" in m)))
  assert.ok(roster.every((m: any) => !("prompt" in m)))
})
