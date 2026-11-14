// Writes the fixture run folders under runs2/ (budget modes, the per-question record, a folder shaped like the
// pilot). Run from this directory: node make-runs2.mjs. The files it writes are committed; this is how they were made.
// Every question, answer and model here is invented.
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
rmSync("runs2", { recursive: true, force: true })
const w = (f, v) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(v, null, 2) + "\n") }
const CAPS = { "p-29_00000029": ["p-29-q1", "p-29-q2", "p-29-q3", "p-29-q4"], "p-2_00000002": ["p-2-q1", "p-2-q2"], "p-46_00000046": ["p-46-q1", "p-46-q4"], "n-1_00000001": ["n-1-q1", "n-1-q2", "n-1-q3", "n-1-q4"] }
const MODE = (q) => (q.startsWith("p-46") ? "str_verifier" : q.startsWith("p-29") && q !== "p-29-q1" ? "llm_verifier" : "range_verifier")

// answers: { question: [answer, correct] }. extra: more run.json fields. swarm: { settings, budget, questions, file, ledger }
function capsuleRun(run, capsule, solver, t0, maxTokens, tokens, answers, swarm = {}) {
  const qids = CAPS[capsule], dir = `runs2/${run}/${capsule}/${solver}`
  const status = (q) => swarm.status?.[q] ?? "unchecked"
  w(`${dir}/run.json`, {
    benchmark: "BixBench v1.5 (futurehouse/BixBench)", dataset_revision: "fixture-rev", capsule, question_ids: qids,
    settings: { solver, model: "fixture/model-a", role_models: {}, answer_mode: "open", unit: "capsule", time_limit_seconds: 600, max_tokens: maxTokens, seed: 0, ...(swarm.settings ?? {}) },
    started_at: t0, status: "done", finished_at: t0 + 50, seconds: 50, total_tokens: tokens,
    answer_statuses: Object.fromEntries(qids.map((q) => [q, status(q)])),
    ...(swarm.budget ? { budget: swarm.budget } : {}), ...(swarm.questions && !swarm.file ? { questions: swarm.questions } : {}),
  })
  w(`${dir}/grade.json`, { capsule, solver, answer_mode: "open", judge_model: "fixture/judge", profiles: { "per-mode": { grades: qids.map((q) => ({
    question_id: q, eval_mode: MODE(q), predicted: answers[q][0], correct: answers[q][1], refused: false, method: MODE(q) === "llm_verifier" ? "llm" : MODE(q) === "range_verifier" ? "range" : "exact", graded: true })) } } })
  w(`${dir}/outputs/answers.json`, { solver, answers: Object.fromEntries(qids.map((q) => [q, { answer: answers[q][0], status: status(q), note: "" }])) })
  if (swarm.ledger) w(`${dir}/outputs/glhf/ledger.json`, { solver, questions: Object.fromEntries(qids.map((q) => [q, `Question text of ${q}?`])), ...swarm.ledger })
  if (swarm.file) w(`${dir}/outputs/glhf/questions.json`, { questions: swarm.questions, blind_check: {} })
}
const d = (id, q, by, answer) => ({ id, question_id: q, by, answer, route: "r", evidence: "e", superseded_by: null })

// pilot-shaped: like runs/pilot-sonnet-5-5 as the first pilot wrote it. No budget fields and no per-question
// record (a legacy run). Analyst and critic agreed on 6 answers, 2 of them correct and 4 wrong; on the third
// capsule only the critic answered. Both solvers 4 of 8.
const pilot = { "p-29-q1": ["12", false], "p-29-q2": ["up", false], "p-29-q3": ["down", false], "p-29-q4": ["none", false], "p-2-q1": ["0.03", true], "p-2-q2": ["61.7", true], "p-46-q1": ["-4.9", true], "p-46-q4": ["-4.1", true] }
const agreedLedger = (qids) => ({
  final: qids.map((q, i) => ({ question_id: q, answer: pilot[q][0], status: "replicated", comparison: "agree", derivations: [`D${i + 1}`, `D${i + 1 + qids.length}`] })),
  derivations: [...qids.map((q, i) => d(`D${i + 1}`, q, "analyst", pilot[q][0])), ...qids.map((q, i) => d(`D${i + 1 + qids.length}`, q, "critic", pilot[q][0]))], resolutions: [],
})
let t = 1000
for (const [capsule, budget] of [["p-46_00000046", 320], ["p-2_00000002", 320], ["p-29_00000029", 480]]) {
  const qids = CAPS[capsule]
  capsuleRun("pilot-shaped", capsule, "single", (t += 100), budget, 100, pilot)
  capsuleRun("pilot-shaped", capsule, "glhf", (t += 100), budget, 180, pilot, capsule.startsWith("p-2_")
    ? { ledger: { final: qids.map((q, i) => ({ question_id: q, answer: pilot[q][0], status: "unchecked", comparison: null, derivations: [`D${i + 1}`] })), derivations: qids.map((q, i) => d(`D${i + 1}`, q, "critic", pilot[q][0])), resolutions: [] } }
    : { status: Object.fromEntries(qids.map((q) => [q, "replicated"])), ledger: agreedLedger(qids) })
}

// The current swarm on one capsule of four questions, single-agent budget 1000.
const N = "n-1_00000001"
const plan = (mode, total) => ({ single_budget_tokens: 1000, total_budget_tokens: total, budget_reading: total > 1000 ? "more budget" : "same budget", critic_hints: "none",
  swarm_budget: { mode, reading: total > 1000 ? "more budget" : "same budget", single_budget_tokens: 1000, swarm_total_tokens: total, floors: { analyst: 300, critic: 300, reconciler: 100 }, final_reserve: 50 } })
const spent = (total, used, phases) => ({ solver: "glhf", single_budget_tokens: 1000, total_budget_tokens: total, reading: total > 1000 ? "more budget" : "same budget", tokens_used: used, used_vs_single_budget: used / 1000, tokens_by_phase: phases, forced_answers: {} })
const rec = (q, analyst, critic, o = {}) => ({
  question_id: q, analyst_answer: analyst, critic_answer: critic, analyst_method: "count rows after the filter", critic_method: "count rows after the filter",
  analyst_forced: false, critic_forced: false, comparison: analyst === critic ? "agree" : "differ", agreed: analyst === critic, method_similarity: 0.8,
  same_method_by_code: analyst === critic, same_method_by_reconciler: null, same_method: analyst === critic, reconciler_answer: null, reconciler_script: null, reconciler_printed: null,
  reconciler_action: null, reconciler_cause: null, reconciler_changed: false, final_answer: analyst, status: analyst === critic ? "replicated" : "reconciled", note: "", ...o })
// eq-pair: single 2 of 4; swarm (equal mode) 2 of 4:
//   q1 agreed by the same method, reported as agreed, correct
//   q2 disagreed; the reconciler's own answer replaced the analyst's and is correct
//   q3 agreed by the same method; the reconciler overturned it and its answer is wrong
//   q4 disagreed; the critic's answer was forced; the reconciler confirmed the analyst's, which is wrong
capsuleRun("eq-pair", N, "single", 2000, 1000, 800, { "n-1-q1": ["10", true], "n-1-q2": ["A", false], "n-1-q3": ["7", true], "n-1-q4": ["x", false] })
capsuleRun("eq-pair", N, "glhf", 2100, 1000, 900, { "n-1-q1": ["10", true], "n-1-q2": ["B", true], "n-1-q3": ["8", false], "n-1-q4": ["x", false] }, {
  settings: plan("equal", 1000), budget: spent(1000, 900, { analyst: 400, critic: 350, reconciler: 150 }),
  status: { "n-1-q1": "replicated", "n-1-q2": "reconciled", "n-1-q3": "reconciled", "n-1-q4": "reconciled" },
  questions: [
    rec("n-1-q1", "10", "10"),
    rec("n-1-q2", "A", "B", { same_method: false, same_method_by_reconciler: false, method_similarity: 0.2, critic_method: "fit a model first", reconciler_answer: "B", reconciler_action: "rederived", reconciler_cause: "the analyst skipped the filter", reconciler_changed: true, final_answer: "B" }),
    rec("n-1-q3", "7", "7", { same_method_by_reconciler: true, reconciler_answer: "8", reconciler_action: "overturned", reconciler_cause: "both counted duplicates", reconciler_changed: true, final_answer: "8", status: "reconciled" }),
    rec("n-1-q4", "x", "y", { critic_forced: true, same_method: null, same_method_by_code: null, method_similarity: null, critic_method: null, reconciler_answer: "x", reconciler_action: "confirmed", reconciler_cause: "the critic ran out of budget", final_answer: "x" }),
  ],
})
// ext-swarm: the swarm alone in extended mode on the same capsule: stated budget 1000, real total 2250.
// Its per-question record is only in outputs/glhf/questions.json. 4 of 4.
const all = { "n-1-q1": ["10", true], "n-1-q2": ["B", true], "n-1-q3": ["7", true], "n-1-q4": ["z", true] }
capsuleRun("ext-swarm", N, "glhf", 3000, 1000, 2000, all, {
  settings: plan("extended", 2250), budget: spent(2250, 2000, { analyst: 950, critic: 900, reconciler: 150 }), file: true,
  status: Object.fromEntries(CAPS[N].map((q) => [q, "replicated"])), questions: CAPS[N].map((q) => rec(q, all[q][0], all[q][0], { same_method: false, same_method_by_code: false, method_similarity: 0.1 })),
})
// single-2250: a single agent given the extended swarm's whole total. 3 of 4.
capsuleRun("single-2250", N, "single", 2500, 2250, 1900, { "n-1-q1": ["10", true], "n-1-q2": ["B", true], "n-1-q3": ["7", true], "n-1-q4": ["x", false] })
