// Budget modes on the scoreboard, the swarm's per-question record, stalled runs and the in-memory cache.
// Fixtures: test/fixtures/bixv1/runs2 (written by make-runs2.mjs there; every value in them is invented).
// Tests that change files work on a temporary copy.
import assert from "node:assert/strict"
import { cpSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"
import { handleBixV1 } from "../src/bixv1/routes.ts"
import { scoreboard } from "../src/bixv1/scoreboard.ts"
import { cacheStats, clearCache, listRuns, loadAll, loadRun, STALL_MARGIN_SECONDS } from "../src/bixv1/store.ts"
import type { BixRunDetail, BixScoreRow } from "../src/bixv1/types.ts"

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "bixv1")
const runs2 = join(fixtures, "runs2")
const temporary: string[] = []
const copyOf = (...ids: string[]) => {
  const root = mkdtempSync(join(tmpdir(), "bixv1-"))
  temporary.push(root)
  for (const id of ids) cpSync(join(runs2, id), join(root, id), { recursive: true })
  return root
}
after(() => { for (const dir of temporary) rmSync(dir, { recursive: true, force: true }) })

const rows = (root = runs2) => scoreboard(loadAll({}, root))
const find = (all: BixScoreRow[], single: string | undefined, swarm: string | undefined) => all.filter((r) => r.single?.run === single && r.swarm?.run === swarm)

test("an extended swarm is not paired like for like with the single agent it had 2.25 times the budget of", () => {
  const all = rows()
  // ext-swarm states max_tokens 1000, as eq-pair's single agent has, but could spend 2250.
  const pairs = find(all, "eq-pair", "ext-swarm")
  assert.equal(pairs.length, 1)
  const more = pairs[0]
  assert.deepEqual([more.comparison, more.likeForLike, more.budgetRatio, more.swarmBudgetMode], ["more budget", false, 2.25, "extended"])
  assert.deepEqual([more.single!.budgetTokens, more.swarm!.budgetTokens, more.single!.budgetMode, more.swarm!.budgetMode], [1000, 2250, null, "extended"])
  assert.equal(more.tokensUsedRatio, 2.5) // 2000 used against 800
  assert.match(more.budgetLabel, /^more budget, not like for like: the swarm could spend 2\.25 times the single agent's tokens \(extended budget mode\)/)
  assert.match(more.conclusion, /^Not a like-for-like comparison: the swarm could spend 2\.25 times the single agent's tokens and used 2\.5 times as many/)
  assert.ok(more.paired, "the counts are still shown")
  assert.deepEqual([more.paired!.onlySwarm, more.paired!.onlySingle, more.paired!.n], [2, 0, 4])
  assert.ok(!all.some((r) => r.likeForLike && r.budgetRatio !== 1), "no like-for-like row has unequal budgets")
  assert.ok(all.every((r) => r.likeForLike === (r.comparison === "same budget")))
  for (const r of all.filter((x) => x.likeForLike)) assert.equal(r.single!.budgetTokens, r.swarm!.budgetTokens)
})

test("pairing is on the effective total: an extended swarm is like for like with a single agent given its whole total", () => {
  const [same] = find(rows(), "single-2250", "ext-swarm")
  assert.deepEqual([same.comparison, same.likeForLike, same.budgetRatio, same.swarmBudgetMode, same.maxTokens], ["same budget", true, 1, "extended", 2250])
  assert.equal(same.budgetLabel, "same budget; swarm in extended budget mode")
  assert.doesNotMatch(same.conclusion, /like-for-like/)
  assert.match(same.note ?? "", /different run folders \(single-2250, ext-swarm\)/)
})

test("an equal-mode pair is like for like; the row order puts a more-budget row after its swarm's same-budget row", () => {
  const all = rows()
  const [equal] = find(all, "eq-pair", "eq-pair")
  assert.deepEqual([equal.comparison, equal.likeForLike, equal.budgetRatio, equal.swarmBudgetMode, equal.maxTokens, equal.tokensUsedRatio], ["same budget", true, 1, "equal", 1000, 1.125])
  assert.deepEqual([equal.paired!.bothCorrect, equal.paired!.onlySingle, equal.paired!.onlySwarm, equal.paired!.neither], [1, 1, 1, 1])
  assert.equal(equal.note, undefined, "nothing differs between the sides")
  assert.deepEqual(all.map((r) => [r.comparison, r.single?.run, r.swarm?.run]), [
    ["same budget", "single-2250", "ext-swarm"], ["more budget", "eq-pair", "ext-swarm"], ["same budget", "eq-pair", "eq-pair"], ["same budget", "pilot-shaped", "pilot-shaped"],
  ])
})

test("with no single agent at either budget, an extended swarm stands alone; with only its baseline, only the more-budget row", () => {
  const alone = rows(copyOf("ext-swarm"))
  assert.equal(alone.length, 1)
  assert.deepEqual([alone[0].comparison, alone[0].likeForLike, alone[0].single, alone[0].budgetRatio, alone[0].maxTokensTotal], ["none", false, undefined, null, 2250])
  assert.equal(alone[0].budgetLabel, "no comparison; swarm in extended budget mode")
  assert.match(alone[0].note ?? "", /no matching baseline: .* total token budget/)

  const baseline = rows(copyOf("ext-swarm", "eq-pair"))
  assert.deepEqual(baseline.map((r) => [r.comparison, r.single?.run, r.swarm?.run]), [["more budget", "eq-pair", "ext-swarm"], ["same budget", "eq-pair", "eq-pair"]])
})

test("a run without budget fields is a legacy run: paired at the single agent's budget and labelled", () => {
  const [legacy] = find(rows(), "pilot-shaped", "pilot-shaped")
  assert.deepEqual([legacy.comparison, legacy.likeForLike, legacy.swarmBudgetMode, legacy.budgetRatio, legacy.maxTokens, legacy.maxTokensTotal], ["same budget", true, "legacy", 1, null, 1120])
  assert.match(legacy.budgetLabel, /^same budget; swarm in legacy allocation \(run before budget modes were recorded/)
  assert.match(legacy.note ?? "", /the swarm side is a legacy run/)
  const run = listRuns({}, runs2).find((r) => r.id === "pilot-shaped")!
  const [swarm, single] = run.bySolver
  assert.deepEqual([swarm.budget.mode, swarm.budget.singleBudgetTokens, swarm.budget.totalBudgetTokens, swarm.budget.ratio, swarm.budget.reading], ["legacy", 1120, 1120, 1, null])
  assert.match(swarm.budget.label ?? "", /^legacy: run before budget modes were recorded/)
  assert.deepEqual(single.budget, { mode: null, label: null, singleBudgetTokens: 1120, totalBudgetTokens: 1120, ratio: 1, reading: null })
  assert.deepEqual(swarm.tokensByPhase, {})

  const extended = listRuns({}, runs2).find((r) => r.id === "ext-swarm")!.bySolver[0]
  assert.deepEqual([extended.budget.mode, extended.budget.singleBudgetTokens, extended.budget.totalBudgetTokens, extended.budget.ratio, extended.budget.reading], ["extended", 1000, 2250, 2.25, "more budget"])
  assert.deepEqual([extended.maxTokens, extended.maxTokensTotal], [1000, 1000], "maxTokens stays the stated single-agent budget")
  assert.deepEqual(extended.tokensByPhase, { analyst: 950, critic: 900, reconciler: 150 })
})

test("a folder shaped like the pilot: analyst and critic agreed on 6 answers, 2 correct and 4 wrong", () => {
  const loaded = loadRun("pilot-shaped", {}, runs2)!
  const swarm = loaded.run.bySolver.find((s) => s.solver === "glhf")!
  assert.deepEqual([swarm.correct, swarm.denominator], [4, 8])
  const d = swarm.design!
  assert.deepEqual([d.questions, d.compared, d.agreed, d.agreedCorrect, d.agreedWrong, d.agreedNotGraded], [8, 6, 6, 2, 4, 0])
  assert.deepEqual([d.disagreed, d.oneDerivation, d.reconcilerRan, d.reconcilerChanged, d.forced], [0, 2, 0, 0, 0])
  assert.deepEqual([d.sameMethodKnown, d.agreedSameMethod], [0, 0], "a legacy run did not record methods: 0 known, so 0 same-method says nothing")
  assert.equal(loaded.run.bySolver.find((s) => s.solver === "single")!.design, undefined, "the single agent has no design counts")
  // The capsule only the critic answered: no comparison.
  const lone = loaded.questions.find((q) => q.questionId === "p-2-q1")!.answers.glhf
  assert.deepEqual([lone.analystAnswer, lone.criticAnswer, lone.agreed, lone.sameMethod, lone.reconcilerChanged], [undefined, "0.03", null, null, false])
  const wrong = loaded.questions.find((q) => q.questionId === "p-29-q2")!.answers.glhf
  assert.deepEqual([wrong.analystAnswer, wrong.criticAnswer, wrong.agreed, wrong.sameMethod, wrong.result, wrong.runPhaseTokens], ["up", "up", true, null, "incorrect", {}])
})

test("the per-question record: both answers, agreed, same method, forced, the reconciler and what it changed", () => {
  const loaded = loadRun("eq-pair", {}, runs2)!
  const [q1, q2, q3, q4] = loaded.questions.map((q) => q.answers.glhf)
  // Agreed by the same method and reported as agreed.
  assert.deepEqual([q1.analystAnswer, q1.criticAnswer, q1.agreed, q1.sameMethod, q1.forced, q1.reconcilerAnswer, q1.reconcilerChanged, q1.result], ["10", "10", true, true, false, undefined, false, "correct"])
  assert.deepEqual([q1.sameMethodByCode, q1.sameMethodByReconciler, q1.methodSimilarity, q1.analystMethod], [true, undefined, 0.8, "count rows after the filter"])
  assert.deepEqual(q1.runPhaseTokens, { analyst: 400, critic: 350, reconciler: 150 })
  // Disagreed; the reconciler's answer replaced the analyst's.
  assert.deepEqual([q2.analystAnswer, q2.criticAnswer, q2.agreed, q2.comparison, q2.sameMethod, q2.reconcilerAnswer, q2.reconcilerChanged, q2.result], ["A", "B", false, "differ", false, "B", true, "correct"])
  assert.deepEqual([q2.reconcilerAction, q2.reconcilerCause, q2.criticMethod], ["rederived", "the analyst skipped the filter", "fit a model first"])
  // Agreed by the same method, overturned by the reconciler.
  assert.deepEqual([q3.agreed, q3.sameMethod, q3.sameMethodByReconciler, q3.reconcilerAnswer, q3.reconcilerAction, q3.reconcilerChanged, q3.answer, q3.result], [true, true, true, "8", "overturned", true, "8", "incorrect"])
  // A forced critic answer; the reconciler confirmed the analyst and changed nothing.
  assert.deepEqual([q4.agreed, q4.sameMethod, q4.analystForced, q4.criticForced, q4.forced, q4.reconcilerAnswer, q4.reconcilerChanged, q4.criticMethod], [false, null, false, true, true, "x", false, undefined])
  assert.equal(loaded.questions[0].answers.single.agreed, undefined, "none of this on the single agent's answer")
  assert.equal(loaded.questions[0].answers.single.runPhaseTokens, undefined)

  assert.deepEqual(loaded.run.bySolver.find((s) => s.solver === "glhf")!.design, {
    questions: 4, compared: 4, agreed: 2, agreedCorrect: 1, agreedWrong: 0, agreedNotGraded: 0,
    agreedSameMethod: 2, agreedSameMethodCorrect: 1, agreedSameMethodWrong: 0, sameMethodKnown: 2,
    disagreed: 2, oneDerivation: 0, forced: 1, reconcilerRan: 3, reconcilerChanged: 2, reconcilerChangedToCorrect: 1, reconcilerChangedToWrong: 1,
  })
  // The record is read from outputs/glhf/questions.json when run.json does not repeat it.
  const fromFile = loadRun("ext-swarm", {}, runs2)!
  assert.deepEqual(fromFile.questions.map((q) => [q.answers.glhf.agreed, q.answers.glhf.sameMethod]), [[true, false], [true, false], [true, false], [true, false]])
  const d = fromFile.run.bySolver[0].design!
  assert.deepEqual([d.agreed, d.agreedCorrect, d.agreedSameMethod, d.sameMethodKnown], [4, 4, 0, 4])
})

const SECOND = 1000
function markRunning(root: string, rel: string, at: Date) {
  const file = join(root, rel, "run.json")
  const run = JSON.parse(readFileSync(file, "utf8"))
  run.status = "running"; delete run.finished_at
  writeFileSync(file, JSON.stringify(run))
  utimesSync(file, at, at); utimesSync(join(root, rel), at, at)
  for (const sub of ["outputs", "outputs/answers.json", "grade.json"]) utimesSync(join(root, rel, sub), at, at)
}

test("a capsule run that says running but has been silent past its time limit plus the margin is stalled", () => {
  const root = copyOf("eq-pair")
  const quiet = new Date("2026-03-01T12:00:00Z"), rel = "eq-pair/n-1_00000001/glhf"
  markRunning(root, rel, quiet)
  const limit = (600 + STALL_MARGIN_SECONDS) * SECOND // the fixture's time limit is 600 s
  const at = (ms: number) => loadRun("eq-pair", { now: quiet.getTime() + ms }, root)!

  const early = at(limit - SECOND)
  assert.equal(early.run.state, "running")
  const going = early.run.bySolver.find((s) => s.solver === "glhf")!
  assert.deepEqual([going.capsuleRuns, going.pending, going.stalled, going.denominator], [{ done: 0, failed: 0, running: 1, stalled: 0 }, 4, 0, 0])
  assert.ok(!scoreboard([early]).some((r) => r.swarm), "a side that is still running is not on the scoreboard")

  const late = at(limit)
  assert.equal(late.run.state, "stalled")
  assert.equal(late.run.finishedAt !== null, true, "the folder is no longer at work")
  const stalled = late.run.bySolver.find((s) => s.solver === "glhf")!
  assert.deepEqual([stalled.capsuleRuns, stalled.pending, stalled.stalled, stalled.denominator, stalled.correct], [{ done: 0, failed: 0, running: 0, stalled: 1 }, 0, 4, 0, 0])
  assert.equal(late.capsuleRuns.find((r) => r.dir === "n-1_00000001/glhf")!.status, "stalled")
  assert.equal(late.questions[0].answers.glhf.result, "not_graded", "its old grade file is not counted")
  // Never paired, and labelled.
  const board = scoreboard([late])
  assert.deepEqual(board.map((r) => [r.comparison, r.single?.run, r.swarm?.run, r.paired]), [["none", undefined, "eq-pair", undefined], ["none", "eq-pair", undefined, undefined]])
  const row = board.find((r) => r.swarm)!
  assert.match(row.note ?? "", /^stalled: a capsule run of this side says it is running but has written nothing/)
  assert.equal(row.conclusion, "No comparison: this side has a stalled capsule run.")
  assert.equal(row.swarm!.failedRuns, 1)

  // Anything written below the folder counts as a sign of life: a log file touched one second ago.
  const log = join(root, rel, "outputs", "answers.json"), recent = new Date(quiet.getTime() + limit - SECOND)
  utimesSync(log, recent, recent)
  assert.equal(at(limit).run.state, "running")
  assert.equal(at(2 * limit).run.state, "stalled")
})

test("the cache serves an unchanged folder from memory and reloads when a file or folder changes", () => {
  const root = copyOf("eq-pair", "single-2250")
  clearCache()
  const first = loadRun("eq-pair", {}, root)!
  assert.deepEqual(cacheStats(), { hits: 0, misses: 1, entries: 1 })
  assert.equal(loadRun("eq-pair", {}, root), first, "the same object: nothing was read again")
  assert.equal(loadAll({}, root).find((l) => l.run.id === "eq-pair"), first)
  assert.deepEqual(cacheStats(), { hits: 2, misses: 2, entries: 2 }) // loadAll also read single-2250 for the first time
  // Another profile or the judge-text view is another entry, never a mix-up.
  assert.notEqual(loadRun("eq-pair", { withJudgeText: true }, root), first)
  assert.equal(cacheStats().entries, 3)

  // A grade changes (same length, so only the modification time says so).
  const grade = join(root, "eq-pair", "n-1_00000001", "single", "grade.json")
  const text = readFileSync(grade, "utf8")
  assert.equal(first.run.bySolver.find((s) => s.solver === "single")!.correct, 2)
  writeFileSync(grade, text.replace('"correct": true', '"correct": false'))
  const later = new Date(Date.now() + 5000)
  utimesSync(grade, later, later)
  const second = loadRun("eq-pair", {}, root)!
  assert.notEqual(second, first)
  assert.equal(second.run.bySolver.find((s) => s.solver === "single")!.correct, 1)
  assert.equal(loadRun("eq-pair", {}, root), second)

  // A new capsule run appears in the folder.
  cpSync(join(runs2, "single-2250", "n-1_00000001"), join(root, "eq-pair", "n-9_00000009"), { recursive: true })
  const third = loadRun("eq-pair", {}, root)!
  assert.notEqual(third, second)
  assert.deepEqual(third.capsuleRuns.map((r) => r.dir), ["n-1_00000001/glhf", "n-1_00000001/single", "n-9_00000009/single"])
  // And one is removed.
  rmSync(join(root, "eq-pair", "n-9_00000009"), { recursive: true })
  assert.equal(loadRun("eq-pair", {}, root)!.capsuleRuns.length, 2)
  // The untouched folder was never read again.
  const before = cacheStats().misses
  loadRun("single-2250", {}, root)
  assert.equal(cacheStats().misses, before)

  // A running capsule run: cached while it is quiet, looked at again when its folder is written to.
  markRunning(root, "eq-pair/n-1_00000001/glhf", new Date())
  const running = loadRun("eq-pair", {}, root)!
  assert.equal(running.run.state, "running")
  assert.equal(loadRun("eq-pair", {}, root), running)
  const touched = new Date(Date.now() + 9000)
  utimesSync(join(root, "eq-pair", "n-1_00000001", "glhf", "outputs", "answers.json"), touched, touched)
  assert.notEqual(loadRun("eq-pair", {}, root), running, "new activity in a running capsule run is noticed")
})

test("over HTTP: the new fields are served, and revealing ideals does not leak into the cache", async () => {
  const saved = { runs: process.env.BIXV1_RUNS_DIR, questions: process.env.BIXV1_QUESTIONS_FILE }
  const questions = join(mkdtempSync(join(tmpdir(), "bixv1-")), "questions.jsonl")
  temporary.push(dirname(questions))
  writeFileSync(questions, JSON.stringify({ question_id: "n-1-q1", ideal: "IDEAL-N1" }) + "\n")
  process.env.BIXV1_RUNS_DIR = runs2
  process.env.BIXV1_QUESTIONS_FILE = questions
  const server = createServer((req, res) => void handleBixV1(req, res, new URL(req.url ?? "/", "http://x").pathname.split("/").filter(Boolean)))
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const board = (await (await fetch(`${base}/api/bixv1/scoreboard`)).json()) as BixScoreRow[]
    assert.deepEqual(board.map((r) => r.comparison), ["same budget", "more budget", "same budget", "same budget"])
    for (let i = 0; i < 2; i++) { // twice: the second reveal is served from the cache
      const open = (await (await fetch(`${base}/api/bixv1/runs/eq-pair?ideal=1`)).json()) as BixRunDetail
      assert.deepEqual([open.idealsRevealed, open.questions[0].ideal], [true, "IDEAL-N1"])
    }
    const closed = await (await fetch(`${base}/api/bixv1/runs/eq-pair`)).text()
    assert.ok(!closed.includes("IDEAL-N1") && !closed.includes('"ideal"'))
    // The question file goes away: a cached run must not still carry what was revealed before.
    process.env.BIXV1_QUESTIONS_FILE = join(dirname(questions), "gone.jsonl")
    const gone = await (await fetch(`${base}/api/bixv1/runs/eq-pair?ideal=1`)).text()
    assert.ok(!gone.includes("IDEAL-N1"))
    assert.equal((JSON.parse(gone) as BixRunDetail).idealsRevealed, false)
    const detail = JSON.parse(closed) as BixRunDetail
    assert.equal(detail.run.bySolver[0].design!.reconcilerChangedToCorrect, 1)
    assert.equal(detail.questions[2].answers.glhf.reconcilerChanged, true)
  } finally {
    server.close()
    if (saved.runs === undefined) delete process.env.BIXV1_RUNS_DIR; else process.env.BIXV1_RUNS_DIR = saved.runs
    if (saved.questions === undefined) delete process.env.BIXV1_QUESTIONS_FILE; else process.env.BIXV1_QUESTIONS_FILE = saved.questions
  }
})
