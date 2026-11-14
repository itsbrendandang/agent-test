import assert from "node:assert/strict"
import { test } from "node:test"
import { extras, scoreboard } from "../src/glhf/scoreboard.ts"
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
  assert.match(row.note ?? "", /Exa search, memory, role models/)
  assert.match(scoreboard([run({ solver: "single" })])[0].note ?? "", /no matching swarm run/)
  assert.equal(scoreboard([run({ solver: "single", score: undefined }), run({})])[0].note, "not graded")
})

test("records without settings (written before the field existed) still group", () => {
  const rows = scoreboard([run({ solver: "single", settings: undefined }), run({ settings: undefined })])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].timeLimit, undefined)
})
