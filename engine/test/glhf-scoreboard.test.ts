import assert from "node:assert/strict"
import { test } from "node:test"
import { extras, pairKey, scoreboard } from "../src/glhf/scoreboard.ts"
import { DEMO_CASE, settingsOf } from "../src/glhf/store.ts"
import type { GlhfRun } from "../src/glhf/types.ts"

let clock = 1_000
const run = (over: Partial<GlhfRun>): GlhfRun => ({
  id: `run-${clock}`, mode: "local", task: "9", solver: "glhf", model: "anthropic/m", roleModels: {}, phase: "done", score: 0.5,
  startedAt: clock++, settings: { timeLimit: 1800 }, ...over,
})

test("runs are paired only when task, model, time limit and token budget match", () => {
  const rows = scoreboard([
    run({ id: "single-a", solver: "single", score: 0.4 }),
    run({ id: "swarm-a", score: 0.6 }),
    run({ id: "swarm-long", score: 0.9, settings: { timeLimit: 86400 } }),
    run({ id: "swarm-capped", score: 0.8, settings: { timeLimit: 1800, maxTokens: 200_000 } }),
    run({ id: "swarm-other-model", score: 0.7, model: "openai/x" }),
  ])
  assert.equal(rows.length, 4)
  const paired = rows.find((r) => r.single)!
  assert.equal(paired.single?.id, "single-a")
  assert.equal(paired.swarm?.id, "swarm-a")
  assert.ok(Math.abs(paired.diff! - 0.2) < 1e-9)
  for (const row of rows.filter((r) => !r.single)) {
    assert.equal(row.diff, undefined)
    assert.match(row.note ?? "", /no matching baseline/)
  }
})

test("the latest run per solver is shown even when it failed", () => {
  const rows = scoreboard([
    run({ id: "single-ok", solver: "single", score: 0.4 }),
    run({ id: "swarm-old-success", score: 0.9 }),
    run({ id: "swarm-new-failure", phase: "failed", score: 0.1, error: "x" }),
    run({ id: "swarm-still-running", phase: "running", score: undefined }),
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].swarm?.id, "swarm-new-failure", "an older success does not stand in")
  assert.equal(rows[0].swarm?.phase, "failed")
  assert.equal(rows[0].swarm?.score, 0.1, "a graded failed run keeps its score")
  assert.equal(rows[0].diff, undefined)
  assert.match(rows[0].note ?? "", /swarm run failed/)
})

test("extras are listed per run, and noted when only the swarm had them", () => {
  const swarm = run({ id: "swarm-x", score: 0.7, settings: { timeLimit: 1800, exa: true, memory: true, reviewRounds: 2, seed: 7 }, roleModels: { critic: "openai/gpt" } })
  assert.deepEqual(extras(swarm), ["Exa search", "memory", "2 review rounds", "role models: critic=openai/gpt", "seed 7"])
  assert.deepEqual(extras(run({ solver: "single" })), [])
  const [row] = scoreboard([run({ id: "single-x", solver: "single", score: 0.5 }), swarm])
  assert.ok(Math.abs(row.diff! - 0.2) < 1e-9)
  assert.equal(row.note, "settings that differ. swarm only: Exa search, memory, 2 review rounds, role models: critic=openai/gpt, seed 7")
  assert.match(scoreboard([run({ solver: "single" })])[0].note ?? "", /no matching swarm run/)
  assert.equal(scoreboard([run({ solver: "single", score: undefined }), run({})])[0].note, "not graded")
})

test("records without settings (written before the field existed) still group", () => {
  const rows = scoreboard([run({ solver: "single", settings: undefined }), run({ settings: undefined })])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].timeLimit, undefined)
})

test("runs in different places, at different effort or on different case folders are not compared", () => {
  const base = { task: "9", model: "anthropic/m", score: 0.5 }
  // The reviewer's case: a cloud single-agent run at effort high against a local swarm run at effort low gave diff +0.10 and no note.
  const rows = scoreboard([
    run({ ...base, id: "single-cloud-high", solver: "single", mode: "cloud", settings: { effort: "high" } }),
    run({ ...base, id: "swarm-local-low", score: 0.6, mode: "local", settings: { effort: "low" } }),
  ])
  assert.equal(rows.length, 2)
  for (const row of rows) { assert.equal(row.diff, undefined); assert.match(row.note ?? "", /no matching/) }
  const efforts = scoreboard([run({ ...base, solver: "single", mode: "cloud", settings: { effort: "high" } }), run({ ...base, mode: "cloud", settings: { effort: "low" } })])
  assert.equal(efforts.length, 2, "same place, different effort")
  const cases = scoreboard([run({ ...base, solver: "single", settings: { timeLimit: 1800, caseId: "aaaa1111" } }), run({ ...base, settings: { timeLimit: 1800, caseId: "bbbb2222" } })])
  assert.equal(cases.length, 2, "same task label, different case folder")
  assert.notEqual(pairKey(run({ mode: "cloud" })), pairKey(run({ mode: "local" })))
})

test("the note names every setting that differs between the two runs", () => {
  const [row] = scoreboard([
    run({ id: "s", solver: "single", score: 0.5, settings: { timeLimit: 1800, seed: 3 } }),
    run({ id: "g", score: 0.6, settings: { timeLimit: 1800, seed: 7, reviewRounds: 2, maxMessagesPerRole: 300 } }),
  ])
  assert.ok(Math.abs(row.diff! - 0.1) < 1e-9)
  assert.equal(row.note, "settings that differ. swarm only: 2 review rounds, 300 messages per role, seed 7; single agent only: seed 3")
  const [same] = scoreboard([run({ solver: "single", settings: { timeLimit: 1800, seed: 3 } }), run({ settings: { timeLimit: 1800, seed: 3 } })])
  assert.equal(same.note, "settings that differ. swarm only: 3 review rounds")
})

test("a case folder other than the demo case gets a fingerprint", () => {
  assert.equal(settingsOf({ mode: "local", caseDir: DEMO_CASE }).caseId, undefined)
  const a = settingsOf({ mode: "local", caseDir: "/tmp/case-a" }).caseId, b = settingsOf({ mode: "local", caseDir: "/tmp/case-b" }).caseId
  assert.match(a ?? "", /^[0-9a-f]{8}$/)
  assert.notEqual(a, b)
})
