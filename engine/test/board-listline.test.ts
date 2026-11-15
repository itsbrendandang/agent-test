// What GET /api/runs adds to a team review's line for the Overview: recorded dollars, members and checks by verdict.
// Pure: no model, no network.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { runDir } from "../src/board/board.ts"
import { boardCap, boardExtras } from "../src/board/listline.ts"
import { loadConfig } from "../src/config.ts"

test("a team review's line: its recorded dollars, members and checked claims by verdict", () => {
  const ledger = [{ verdict: "verified" }, { verdict: "verified" }, { verdict: "contradicted" }, { verdict: "unsupported" }, { verdict: "unchecked" }, { verdict: "nonsense" }] as never
  assert.deepEqual(boardExtras({ usd: 1.25, mock: false, members: { "lead-scientist": 1, scout: 2 }, ledger }), {
    usd: 1.25, mock: false, members: ["lead-scientist", "scout"], checks: { verified: 2, contradicted: 1, unsupported: 1, unchecked: 1 },
  })
})

test("a run recorded before the fields: nothing is made up", () => {
  assert.deepEqual(boardExtras({ members: {}, ledger: [] } as never), { members: [], checks: { verified: 0, contradicted: 0, unsupported: 0, unchecked: 0 } })
  assert.deepEqual(boardExtras({ usd: Number.NaN, members: undefined, ledger: undefined } as never), { members: [], checks: { verified: 0, contradicted: 0, unsupported: 0, unchecked: 0 } })
})

test("a team review's cap is its own: the config's $5, lowered by its overrides.json, and left out when that file is unreadable", () => {
  const base = loadConfig()
  const config = { ...base, paths: { ...base.paths, runs: mkdtempSync(join(tmpdir(), "listline-")) }, meeting: { ...base.meeting, max_usd: 5 } }
  for (const id of ["plain", "lowered", "broken"]) mkdirSync(runDir(config, id), { recursive: true })
  writeFileSync(`${runDir(config, "lowered")}/overrides.json`, JSON.stringify({ meeting: { max_usd: 1 } }))
  writeFileSync(`${runDir(config, "broken")}/overrides.json`, "{ not json")
  assert.deepEqual(boardCap(config, "plain"), { maxUsd: 5 })
  assert.deepEqual(boardCap(config, "lowered"), { maxUsd: 1 })
  assert.deepEqual(boardCap(config, "broken"), {})
})
