// Agent details: each reply records the member's own model use so far, the finish event records every agent's use
// (the lead included), and the roster carries each agent file's "# Purpose" paragraph, never its prompt.
// Scripted models and checkers only. The switches are set before the engine is imported, so MOCK is true.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

process.env.DRUG_BOARD_MOCK = "1"
delete process.env.NO_PAID_CALLS
const { runBoard } = await import("../src/board/board.ts")
const { loadAgent, loadRoster, purposeOf } = await import("../src/board/agents.ts")
const { memberUsage } = await import("../src/board/usage.ts")
const { loadConfig, MOCK, path } = await import("../src/config.ts")

test("the scripted engine is on for this file", () => {
  assert.equal(MOCK, true, "a full run below must never reach a real model or checker")
})

test("purposeOf reads the paragraph under # Purpose, up to the next heading, and nothing when there is none", () => {
  assert.equal(purposeOf("# Purpose\nFind things\nquickly.\n\n# Instructions\n- no"), "Find things quickly.")
  assert.equal(purposeOf("Intro.\n# Purpose\nLast section."), "Last section.")
  assert.equal(purposeOf("# Instructions\n- only rules"), undefined)
  assert.equal(purposeOf("# Purpose\n\n# Next"), undefined)
})

test("every board agent file has a purpose, and it is not the whole prompt", () => {
  const config = loadConfig()
  for (const agent of [loadAgent(config, "lead-scientist"), ...loadRoster(config)]) {
    assert.ok(agent.purpose && agent.purpose.length > 20, `${agent.name} has a purpose`)
    assert.ok(agent.purpose!.length < agent.prompt.length, `${agent.name}'s purpose is a part of its prompt`)
    assert.ok(!agent.purpose!.includes("# Instructions"))
  }
})

test("memberUsage sums the model buckets, leaves tools out, and never reports negative or missing dollars", () => {
  const state = {
    models: { "a/x": { input: 10, output: 5, cacheRead: 1, cacheWrite: 2, totalTokens: 18 }, "b/y": { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 } },
    tools: { exa_search: { input: 999, output: 999, cacheRead: 0, cacheWrite: 0, totalTokens: 1998 } },
  } as never
  assert.deepEqual(memberUsage(state, () => 0.25), { input: 11, output: 6, cacheRead: 1, cacheWrite: 2, totalTokens: 20, usd: 0.25 })
  assert.deepEqual(memberUsage(undefined, () => Number.NaN), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, usd: 0 })
  assert.equal(memberUsage(state, () => -1).usd, 0)
})

test("a scripted run: replies carry the member's growing use, and the finish event names every agent, at $0", async () => {
  const real = loadConfig(), dir = mkdtempSync(join(tmpdir(), "board-usage-run-"))
  const config = { ...real, paths: { ...real.paths, runs: join(dir, "runs"), expertise: join(dir, "expertise") } }
  const runId = "202611140000-usage", runPath = join(config.paths.runs, runId)
  mkdirSync(runPath, { recursive: true })
  const briefFile = path(real, "briefs", "kras-g12c-hit-to-lead.md")
  writeFileSync(join(runPath, "run.json"), JSON.stringify({ runId, briefFile, startedAt: Date.now(), members: {}, rounds: 0, lastRound: [], evidence: {}, ledger: [], escalations: 0, checkerUsd: 0, jevUsd: 0, usd: 0, mock: true }))
  await runBoard(runId, undefined, { config, mock: true })

  const events = readFileSync(join(runPath, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  const replies = events.filter((e) => e.type === "member.replied")
  assert.ok(replies.length > 0)
  const keys = ["input", "output", "cacheRead", "cacheWrite", "totalTokens", "usd"]
  for (const r of replies) {
    assert.deepEqual(Object.keys(r.usage).sort(), [...keys].sort(), `${r.member} round ${r.round} has a usage record`)
    for (const k of keys) assert.ok(Number.isFinite(r.usage[k]) && r.usage[k] >= 0, `${k} is a number`)
    assert.equal(r.usage.usd, 0, "a practice run is free")
  }
  // The record is the member's running total: it never goes down from one round to the next.
  for (const member of new Set(replies.map((r) => r.member))) {
    const totals = replies.filter((r) => r.member === member).map((r) => r.usage.totalTokens)
    assert.deepEqual(totals, [...totals].sort((a, b) => a - b), `${member}'s tokens never go down`)
  }
  const finished = events.find((e) => e.type === "run.finished")
  assert.deepEqual(Object.keys(finished.members).sort(), ["lead-scientist", ...new Set(replies.map((r) => r.member))].sort(), "the lead and every member")
  for (const member of new Set(replies.map((r) => r.member))) {
    assert.ok(finished.members[member].totalTokens >= replies.filter((r) => r.member === member).at(-1).usage.totalTokens, `${member}'s final use covers its last reply`)
  }
})
