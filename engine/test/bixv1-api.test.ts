// The /api/bixv1 routes on a throwaway server, reading the fixture run folders in test/fixtures/bixv1/runs.
// Nothing is written there; the one test that needs a symlink builds its own temporary folder.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, before, test } from "node:test"
import { fileURLToPath } from "node:url"
import { guard } from "../src/http.ts"
import { handleBixV1 } from "../src/bixv1/routes.ts"
import { listRuns, loadRun, runsRoot } from "../src/bixv1/store.ts"
import type { BixRun, BixRunDetail, BixScoreRow } from "../src/bixv1/types.ts"

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "bixv1")
const SECRET = "IDEAL-SECRET-42" // the ideal answer of fx-1-q2, also quoted in a judge reply in pair-a
process.env.BIXV1_RUNS_DIR = join(fixtures, "runs")
process.env.BIXV1_QUESTIONS_FILE = join(fixtures, "questions.jsonl")

let server: Server, base = ""
before(async () => {
  // still-running is "running" only while its folder was written to recently (else it is "stalled"): touch it.
  utimesSync(join(fixtures, "runs", "still-running", "fx-2_bbbb0002", "single", "run.json"), new Date(), new Date())
  // As app.ts would call it: guard first, then the handler with the path split on "/".
  server = createServer((req, res) => {
    if (!guard(req, res, {})) return
    void handleBixV1(req, res, new URL(req.url ?? "/", "http://x").pathname.split("/").filter(Boolean))
  })
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => { server.close() })

const get = async <T>(path: string, init?: RequestInit) => {
  const res = await fetch(base + path, init)
  const text = await res.text()
  return { status: res.status, text, body: JSON.parse(text) as T, headers: res.headers }
}

test("runs are listed newest first with their totals", async () => {
  const { status, body } = await get<BixRun[]>("/api/bixv1/runs")
  assert.equal(status, 200)
  // no-runs-inside has no start time of its own and sorts by its folder's time; the others by when they started.
  assert.deepEqual(body.map((r) => r.id).filter((id) => id !== "no-runs-inside"), ["still-running", "swarm-one-capsule", "swarm-other-model", "swarm-big-budget", "pair-a", "malformed"])
  assert.ok(!body.some((r) => r.id.includes("stray")), "a file next to the run folders is not a run")

  const pair = body.find((r) => r.id === "pair-a")!
  assert.deepEqual([pair.dataset, pair.datasetRevision, pair.model, pair.gradingProfile], ["BixBench v1.5 (futurehouse/BixBench)", "fixture-rev", "fixture/model-a", "per-mode"])
  assert.deepEqual([pair.solvers, pair.gradingProfiles, pair.judgeModels, pair.answerModes], [["glhf", "single"], ["per-mode"], ["fixture/judge"], ["open"]])
  assert.deepEqual([pair.state, pair.startedAt, pair.finishedAt, pair.questions, pair.capsules.length], ["done", 1_000_000, 1_350_000, 3, 2])
  assert.deepEqual([pair.tokens, pair.judgeTokens, pair.scripted, pair.error], [800, 30, false, undefined])
  const [swarm, single] = pair.bySolver
  // Single: one right, one wrong, one empty answer (a refusal). All three are in the denominator.
  assert.deepEqual([single.solver, single.questions, single.correct, single.incorrect, single.refused, single.notGraded, single.denominator], ["single", 3, 1, 1, 1, 0, 3])
  assert.ok(Math.abs(single.accuracy! - 1 / 3) < 1e-12)
  assert.deepEqual(single.wilson95, [0.0615, 0.7923])
  assert.deepEqual([single.tokens, single.seconds, single.maxTokens, single.maxTokensTotal], [250, 100, 1000, 2000])
  assert.deepEqual(single.capsuleRuns, { done: 2, failed: 0, running: 0, stalled: 0 })
  // Swarm: two right, one the judge failed on; that one counts against the accuracy and is reported apart.
  assert.deepEqual([swarm.solver, swarm.correct, swarm.incorrect, swarm.refused, swarm.notGraded, swarm.denominator], ["glhf", 2, 0, 0, 1, 3])
  assert.deepEqual(swarm.statuses, { replicated: 1, reconciled: 1, unchecked: 1 })
  // Cost from report.json's prices: per capsule run (10*3 + 20*15 + 60*0.3 + 10*3.75) / 1e6 dollars, so it rounds to 0.
  assert.equal(pair.costUsd, 0)
  assert.equal(body.find((r) => r.id === "swarm-big-budget")!.costUsd, null, "no report.json, so no prices and no cost")

  const running = body.find((r) => r.id === "still-running")!
  assert.deepEqual([running.state, running.finishedAt], ["running", null])
  const s = running.bySolver[0]
  assert.deepEqual([s.questions, s.pending, s.denominator, s.correct, s.capsuleRuns.running], [3, 1, 2, 1, 1], "questions of an unfinished capsule run are pending, not wrong")
})

test("a malformed run is listed with an error and whatever could be read", async () => {
  const { body } = await get<BixRun[]>("/api/bixv1/runs")
  const bad = body.find((r) => r.id === "malformed")!
  assert.match(bad.error ?? "", /report\.json is not a JSON object/)
  assert.match(bad.error ?? "", /fx-1_aaaa0001\/single\/run\.json is not a JSON object/)
  assert.match(bad.error ?? "", /fx-2_bbbb0002\/single\/outputs\/answers\.json is not a JSON object/)
  assert.deepEqual([bad.questions, bad.bySolver[0].correct, bad.capsules], [1, 1, ["fx-2_bbbb0002"]], "the capsule run that is fine is still counted")
  const empty = body.find((r) => r.id === "no-runs-inside")!
  assert.deepEqual([empty.state, empty.questions, empty.bySolver], ["empty", 0, []])
  assert.match(empty.error ?? "", /no capsule run/)

  const detail = await get<BixRunDetail>("/api/bixv1/runs/malformed")
  assert.equal(detail.status, 200)
  assert.equal(detail.body.questions[0].answers.single.answer, "0.31", "answers.json is broken, so the answer comes from the grade")
  assert.equal(detail.body.questions[0].answers.single.grader.kind, "range")
  assert.equal((await get("/api/bixv1/runs/no-runs-inside")).status, 200)
})

test("one run: a row per question with each solver's answer and how it was graded", async () => {
  const { status, body } = await get<BixRunDetail>("/api/bixv1/runs/pair-a")
  assert.equal(status, 200)
  assert.equal(body.run.id, "pair-a")
  assert.deepEqual(body.questions.map((q) => q.questionId), ["fx-1-q1", "fx-1-q2", "fx-2-q1"])
  const [q1, q2, q3] = body.questions
  assert.deepEqual([q1.capsuleId, q1.question, q1.evalMode, q1.answerMode], ["fx-1_aaaa0001", "How many genes pass the filter?", "str_verifier", "open"])
  assert.deepEqual([q1.answers.single.answer, q1.answers.single.result, q1.answers.single.grader], ["166", "correct", { kind: "exact_match", method: "exact" }])
  assert.deepEqual([q1.answers.single.runDir, q1.answers.single.runTokens, q1.answers.single.runSeconds, q1.answers.single.runQuestions], ["fx-1_aaaa0001/single", 100, 50, 2])
  assert.equal(q1.answers.single.analystAnswer, undefined, "the single agent has no analyst or critic")
  // Swarm, agreed.
  assert.deepEqual([q1.answers.glhf.analystAnswer, q1.answers.glhf.criticAnswer, q1.answers.glhf.agreed, q1.answers.glhf.status], ["166", "166.0", true, "replicated"])
  assert.equal(q1.answers.glhf.reconcilerAnswer, undefined)
  // Swarm, reconciled: the analyst's replaced first answer (TCA cycle) is not the one shown.
  const r = q2.answers.glhf
  assert.deepEqual([r.analystAnswer, r.criticAnswer, r.agreed, r.comparison], ["Glycolysis", "Oxidative phosphorylation", false, "unclear"])
  assert.deepEqual([r.reconcilerAnswer, r.reconcilerKeep, r.reconcilerCause, r.status], ["Oxidative phosphorylation", "B", "the analyst ranked by raw p-value", "reconciled"])
  assert.deepEqual([r.result, r.grader], ["correct", { kind: "model", method: "llm", model: "fixture/judge" }])
  assert.deepEqual([q2.answers.single.result, q2.answers.single.grader.kind, q2.answers.single.grader.model], ["incorrect", "model", "fixture/judge"])
  // No answer: a refusal decided by rule. Judge failure: not graded, and it names the judge that failed.
  assert.deepEqual([q3.evalMode, q3.answers.single.answer, q3.answers.single.result, q3.answers.single.grader, q3.answers.single.status], ["range_verifier", null, "refused", { kind: "rule", method: "empty" }, "missing"])
  assert.deepEqual([q3.answers.glhf.result, q3.answers.glhf.grader], ["not_graded", { kind: "none", method: "judge_error", model: "fixture/judge" }])
  assert.deepEqual([q3.answers.glhf.analystAnswer, q3.answers.glhf.criticAnswer, q3.answers.glhf.agreed], ["about a third", undefined, null])

  assert.equal((await get("/api/bixv1/runs/nope")).status, 404)
  assert.equal((await get("/api/bixv1/nothing")).status, 404)
  const wrongProfile = await get<{ error: string }>("/api/bixv1/runs/pair-a?profile=paper")
  assert.equal(wrongProfile.status, 400)
  assert.match(wrongProfile.body.error, /not graded with profile paper; it has: per-mode/)
  assert.equal((await get("/api/bixv1/runs/pair-a?profile=per-mode")).status, 200)
})

test("ids that could leave the runs folder are refused", async () => {
  // Dot segments are resolved by URL parsing before any route sees them: they name another path, which is not found.
  for (const id of ["..", "%2e%2e", "%2E%2E/%2E%2E/package.json"]) assert.equal((await get(`/api/bixv1/runs/${id}`)).status, 404, id)
  assert.ok(Array.isArray((await get("/api/bixv1/runs/.")).body), "runs/. is the list itself")
  for (const id of ["..%2F..%2Fpackage.json", "..%2Fpair-a", "...", "pair-a%2Ffx-1_aaaa0001", "pair-a%2F..%2Fpair-a", "%2Fetc", "pair-a%00", "a%5Cb", "%E0%A4%A", "x".repeat(201)]) {
    const res = await get<{ error: string }>(`/api/bixv1/runs/${id}`)
    assert.equal(res.status, 400, id)
    assert.equal(res.body.error, "invalid run id")
  }
  assert.equal((await get("/api/bixv1/runs/pair-a/fx-1_aaaa0001")).status, 404, "nothing below a run is served")
  assert.equal((await get("/api/bixv1/scoreboard?profile=..%2F..")).status, 400)
  assert.equal(loadRun("../runs/pair-a"), undefined)
  assert.equal(loadRun("pair-a/fx-1_aaaa0001"), undefined)
  assert.equal(loadRun("stray-file.log"), undefined, "a file is not a run")

  // A symlink in the runs folder that points outside it is neither listed nor served.
  const root = mkdtempSync(join(tmpdir(), "bixv1-"))
  try {
    mkdirSync(join(root, "real"))
    writeFileSync(join(root, "real", "note.txt"), "x")
    symlinkSync(join(fixtures, "runs", "pair-a"), join(root, "link"))
    assert.deepEqual(listRuns({}, root).map((r) => r.id), ["real"])
    assert.equal(loadRun("link", {}, root), undefined)
    assert.deepEqual(listRuns({}, join(root, "does-not-exist")), [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("the API is read-only and keeps the server's Host and Origin rules", async () => {
  for (const method of ["POST", "PUT", "DELETE"]) {
    assert.equal((await get("/api/bixv1/runs", { method, headers: { "content-type": "application/json" }, body: method === "DELETE" ? undefined : "{}" })).status, 405, method)
  }
  assert.equal((await get("/api/bixv1/runs", { headers: { origin: "https://evil.example" } })).status, 403)
  assert.equal((await get("/api/bixv1/runs", { headers: { origin: "http://127.0.0.1:5317" } })).status, 200)
})

test("single and swarm are paired only when the settings match", async () => {
  const { status, body } = await get<BixScoreRow[]>("/api/bixv1/scoreboard")
  assert.equal(status, 200)
  const paired = body.filter((r) => r.paired)
  assert.equal(paired.length, 1, "exactly one pair in the fixtures")
  const row = paired[0]
  assert.deepEqual([row.single?.run, row.swarm?.run, row.model, row.gradingProfile, row.maxTokens, row.maxTokensTotal, row.timeLimit, row.questions], ["pair-a", "pair-a", "fixture/model-a", "per-mode", 1000, 2000, 600, 3])
  const p = row.paired!
  assert.deepEqual([p.n, p.capsules, p.bothCorrect, p.onlySingle, p.onlySwarm, p.neither], [3, 2, 1, 0, 1, 1])
  assert.ok(Math.abs(p.difference - 1 / 3) < 1e-12)
  assert.deepEqual([p.pValue, p.interval95], [1, [-0.3158, 0.7178]])
  assert.deepEqual(p.capsuleBootstrap95, [0, 0.5], "report.json describes this same pair, so its capsule bootstrap is passed on")
  assert.deepEqual([row.single!.correct, row.single!.n, row.single!.tokens, row.swarm!.correct, row.swarm!.n, row.swarm!.tokens], [1, 3, 250, 2, 3, 550])
  assert.equal(row.tooSmall, true)
  assert.match(row.conclusion, /^Too few questions to conclude anything\. The solvers differed on only 1 of 3 questions/)
  assert.match(row.note ?? "", /swarm: 0 failed capsule run\(s\), 1 question\(s\) not graded/)

  // Same questions and model as pair-a's single agent, but another token budget, model or capsule set: no pair.
  for (const [run, why] of [["swarm-big-budget", "twice the token budget"], ["swarm-other-model", "another model"], ["swarm-one-capsule", "one capsule of the two"]]) {
    const alone = body.find((r) => r.swarm?.run === run)
    assert.ok(alone, `${run} has its own row`)
    assert.equal(alone.single, undefined, `${why}: not paired`)
    assert.equal(alone.paired, undefined)
    assert.equal(alone.tooSmall, true)
    assert.match(alone.note ?? "", /no matching baseline/)
    assert.match(alone.conclusion, /^No comparison/)
  }
  assert.equal(body.find((r) => r.swarm?.run === "swarm-big-budget")!.maxTokens, 2000)
  assert.ok(!body.some((r) => r.single?.run === "still-running" || r.swarm?.run === "still-running"), "an unfinished run is not on the scoreboard")
  assert.match(body.find((r) => r.single?.run === "malformed")!.note ?? "", /malformed could not be read in full/)
  // A profile no run was graded with: nothing to show.
  assert.deepEqual((await get<BixScoreRow[]>("/api/bixv1/scoreboard?profile=paper")).body, [])
})

test("ideal answers are hidden unless asked for on a finished run", async () => {
  // Default responses: no ideal, no judge reply, no grader note, anywhere.
  for (const path of ["/api/bixv1/runs", "/api/bixv1/runs/pair-a", "/api/bixv1/scoreboard", "/api/bixv1/runs/pair-a?ideal=0", "/api/bixv1/runs/pair-a?ideal"]) {
    const res = await get<unknown>(path)
    assert.equal(res.status, 200, path)
    assert.ok(!res.text.includes(SECRET), `${path} leaks an ideal answer`)
    assert.ok(!/"ideal"|judgeResponse|graderNote|judge_response/.test(res.text), `${path} has a field that can carry the ideal`)
  }
  assert.equal((await get<BixRunDetail>("/api/bixv1/runs/pair-a")).body.idealsRevealed, false)

  // The opt-in, on a finished run.
  const open = await get<BixRunDetail>("/api/bixv1/runs/pair-a?ideal=1")
  assert.equal(open.status, 200)
  assert.equal(open.body.idealsRevealed, true)
  assert.equal(open.headers.get("cache-control"), "no-store")
  assert.deepEqual(open.body.questions.map((q) => q.ideal), ["166", SECRET, "(0.2,0.4)"])
  assert.match(open.body.questions[1].answers.single.judgeResponse ?? "", /incorrect/)
  assert.equal(open.body.questions[2].answers.single.graderNote, "no answer submitted")

  // Not on a run that is still going, and not from the list or the scoreboard.
  const running = await get<{ error: string }>("/api/bixv1/runs/still-running?ideal=1")
  assert.equal(running.status, 409)
  assert.ok(!running.text.includes(SECRET))
  assert.equal((await get("/api/bixv1/runs/no-runs-inside?ideal=1")).status, 409)
  assert.equal((await get("/api/bixv1/runs?ideal=1")).status, 400)
  assert.equal((await get("/api/bixv1/scoreboard?ideal=true")).status, 400)

  // Asked for, but the question file is not on this machine: said plainly, nothing revealed.
  process.env.BIXV1_QUESTIONS_FILE = join(fixtures, "no-such-file.jsonl")
  try {
    const missing = await get<BixRunDetail>("/api/bixv1/runs/pair-a?ideal=1")
    assert.equal(missing.status, 200)
    assert.equal(missing.body.idealsRevealed, false)
    assert.match(missing.body.idealNote ?? "", /question file is not on this machine/)
    assert.ok(missing.body.questions.every((q) => q.ideal === undefined))
  } finally { process.env.BIXV1_QUESTIONS_FILE = join(fixtures, "questions.jsonl") }
})

test("the runs folder comes from BIXV1_RUNS_DIR, else glhf/bixbench_v1/runs", () => {
  assert.equal(runsRoot({ BIXV1_RUNS_DIR: "/tmp/somewhere" }), "/tmp/somewhere")
  assert.match(runsRoot({}), /glhf\/bixbench_v1\/runs$/)
})
