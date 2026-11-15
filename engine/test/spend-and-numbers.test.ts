// The daily reservation of research answers (src/research/spend.ts) and the number check (src/triage.ts). No model, no network.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { loadConfig, type BoardConfig } from "../src/config.ts"
import { dayStamp, researchRoot, researchSpentToday } from "../src/research/spend.ts"
import { hasNumber } from "../src/board/triage.ts"

const tempConfig = (): BoardConfig => {
  const base = loadConfig(), dir = mkdtempSync(join(tmpdir(), "spend-"))
  return { ...base, paths: { ...base.paths, runs: join(dir, "runs") } }
}
const put = (config: BoardConfig, id: string, record: Record<string, unknown>) => {
  mkdirSync(join(researchRoot(config), id), { recursive: true })
  writeFileSync(join(researchRoot(config), id, "record.json"), JSON.stringify({ mode: "real", caps: { maxUsd: 0.5, maxSeconds: 120 }, ...record }))
}

test("a queued answer keeps its reservation: the time limit runs from when the work began", () => {
  const config = tempConfig(), now = new Date(2026, 10, 14, 12, 0, 0)
  // Asked 10 minutes ago, waited in the queue, began 30 seconds ago and is still running.
  put(config, `a-${dayStamp(now)}115000-q`, { status: "running", usd: 0.02, startedAt: now.getTime() - 600_000, workStartedAt: now.getTime() - 30_000 })
  assert.equal(researchSpentToday(config, now), 0.5)
  // One whose work began long ago is stale and counts for what it recorded.
  put(config, `a-${dayStamp(now)}110000-s`, { status: "running", usd: 0.03, startedAt: now.getTime() - 3_600_000, workStartedAt: now.getTime() - 3_000_000 })
  assert.equal(researchSpentToday(config, now), 0.53)
})

test("an answer asked before midnight and still running holds its reservation today; a finished one from yesterday does not", () => {
  const config = tempConfig(), now = new Date(2026, 10, 15, 0, 0, 30), yesterday = new Date(2026, 10, 14, 23, 59, 30)
  put(config, `a-${dayStamp(yesterday)}235930-m`, { status: "running", usd: 0.1, startedAt: yesterday.getTime() })
  put(config, `a-${dayStamp(yesterday)}120000-d`, { status: "done", usd: 0.4, startedAt: yesterday.getTime() - 40_000_000 })
  assert.equal(researchSpentToday(config, now), 0.5)
})

test("a claimed number must be the whole number in the quote, not the start of a longer one", () => {
  assert.equal(hasNumber("IC50 was 5.8 nM", "5"), false)
  assert.equal(hasNumber("5,000 cells per well", "5"), false)
  assert.equal(hasNumber("the fold change was 5.", "5"), true)
  assert.equal(hasNumber("5, 7 and 9 nM", "5"), true)
  assert.equal(hasNumber("IC50 was 5.8 nM", "5.8"), true)
  assert.equal(hasNumber("IC50 was 5.83 nM", "5.8"), false)
  assert.equal(hasNumber("a change of -4.96", "-4.96"), true)
})
