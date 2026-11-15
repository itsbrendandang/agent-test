// What GET /api/runs adds to a team review's line for the Overview: recorded dollars, members and checks by verdict.
// Pure: no model, no network.
import assert from "node:assert/strict"
import { test } from "node:test"
import { boardExtras } from "../src/board/listline.ts"

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
