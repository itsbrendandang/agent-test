import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { test } from "node:test"
import { applyOverrides, runDir } from "../src/board.ts"
import { loadConfig } from "../src/config.ts"

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
  assert.deepEqual(got.board, config.board.filter((n) => n === "critic"))
  assert.equal(got.meeting.max_usd, Math.min(0.5, config.meeting.max_usd))
  assert.equal(got.meeting.max_minutes, config.meeting.max_minutes)
  assert.equal(got.meeting.max_rounds, 1)
})

test("a broken or hostile overrides file changes nothing", () => {
  for (const bad of ["{not json", { board: [], meeting: { max_usd: -1, max_rounds: "9" } }, { board: ["nobody"] }]) {
    const config = setup(bad)
    const got = applyOverrides(config, "r1")
    assert.deepEqual(got.board, config.board)
    assert.deepEqual(got.meeting, config.meeting)
  }
})
