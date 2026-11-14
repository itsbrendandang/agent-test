// The BixBench v1 scoreboard: single agent against swarm, question by question. Pure functions over what
// store.ts loaded (no file or network access).
//
// PAIRING. A "side" is one solver's capsule runs in one run folder ("single" is the single agent, "glhf" the
// swarm). Two sides are compared only when all of this is equal:
//   dataset (benchmark name and dataset revision), answer mode (open, mcq, mcq-refusal),
//   the capsule set, and within each capsule the same questions asked in the same unit (per capsule or per question),
//   the solver's model, the grading profile,
//   the token budget of every capsule run (budgets may differ between capsules, not between the sides),
//   the time limit of every capsule run.
// A side with a capsule run still going is left out until it has finished. Within a group of comparable sides
// the row shows the newest single and the newest swarm side, preferring two from the same run folder.
// A side nothing matches still gets a row, with a note and no comparison: a number is never borrowed from a
// run with other settings. What may differ inside a pair is named in the row's note: role models, critic
// hints, seed, judge model.
//
// COUNTING. A question is "correct" when its grade says so. Everything else counts as not correct: wrong,
// refused, no answer, a failed capsule run, a judge error. This is the adapter's own rule (stats.py), so an
// ungraded question cannot flatter either side. The statistics are in stats.ts.
import { MIN_DISCORDANT, mcnemarExact, newcombePaired, wilson } from "./stats.ts"
import type { CapsuleRun, Loaded } from "./store.ts"
import type { BixPaired, BixScoreCell, BixScoreRow } from "./types.ts"

export const SINGLE = "single", SWARM = "glhf"
export const INTERVAL_METHOD = "Newcombe paired score interval (Newcombe 1998, method 10; Wilson intervals without continuity correction)"
export const P_METHOD = "exact McNemar test (two-sided exact sign test on the questions the solvers answered differently)"

interface Side { loaded: Loaded; solver: string; runs: CapsuleRun[]; key: string; startedAt: number }

const uniq = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => v !== null))].sort()
const round = (value: number, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits
const points = (x: number) => `${x > 0 ? "+" : ""}${round(x * 100, 1)}`

/** Sides with the same key may be compared. See the rules at the top of this file. */
export function pairKey(runs: CapsuleRun[], profile: string): string {
  const units = runs.map((r) => [r.capsule, [...r.questionIds].sort(), r.maxTokens, r.timeLimit]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return JSON.stringify([uniq(runs.map((r) => r.benchmark)), uniq(runs.map((r) => r.revision)), uniq(runs.map((r) => r.answerMode)), uniq(runs.map((r) => r.model)), profile, units])
}

function sides(all: Loaded[]): Side[] {
  const out: Side[] = []
  for (const loaded of all) {
    const profile = loaded.run.gradingProfile
    if (!profile || !loaded.run.gradingProfiles.includes(profile)) continue // not graded with the profile asked for
    for (const solver of [SINGLE, SWARM]) {
      const runs = loaded.capsuleRuns.filter((r) => r.solver === solver)
      if (!runs.length || runs.some((r) => r.status === "running")) continue
      out.push({ loaded, solver, runs, key: pairKey(runs, profile), startedAt: Math.max(0, ...runs.map((r) => r.startedAt ?? 0)) })
    }
  }
  return out.sort((a, b) => b.startedAt - a.startedAt || b.loaded.run.id.localeCompare(a.loaded.run.id))
}

function extras(side: Side): string[] {
  const out: string[] = []
  const roles = Object.entries(Object.assign({}, ...side.runs.map((r) => r.roleModels)) as Record<string, string>)
  if (roles.length) out.push(`role models: ${roles.map(([role, model]) => `${role}=${model}`).join(", ")}`)
  for (const hints of uniq(side.runs.map((r) => r.criticHints))) if (hints !== "route") out.push(`critic hints: ${hints}`)
  for (const seed of new Set(side.runs.map((r) => r.seed))) if (seed) out.push(`seed ${seed}`)
  for (const judge of uniq(side.runs.map((r) => r.judgeModel))) out.push(`judge ${judge}`)
  return out
}

/** question id -> correct, and question id -> capsule. */
function outcomes(side: Side) {
  const correct = new Map<string, boolean>(), capsule = new Map<string, string>()
  for (const r of side.runs) for (const q of r.questionIds) { correct.set(q, r.results[q] === "correct"); capsule.set(q, r.capsule) }
  return { correct, capsule }
}

function cell(side: Side): BixScoreCell {
  const results = side.runs.flatMap((r) => r.questionIds.map((q) => r.results[q]))
  const correct = results.filter((r) => r === "correct").length
  const interval = wilson(correct, results.length)
  const summary = side.loaded.run.bySolver.find((s) => s.solver === side.solver)
  return {
    run: side.loaded.run.id, solver: side.solver, correct, n: results.length,
    accuracy: results.length ? correct / results.length : null,
    wilson95: interval ? [round(interval[0]), round(interval[1])] : null,
    refused: results.filter((r) => r === "refused").length,
    notGraded: results.filter((r) => r === "not_graded").length,
    failedRuns: side.runs.filter((r) => r.status !== "done").length,
    tokens: side.runs.reduce((n, r) => n + (r.tokens ?? 0), 0),
    seconds: round(side.runs.reduce((n, r) => n + (r.seconds ?? 0), 0), 1),
    costUsd: summary?.costUsd ?? null,
    startedAt: side.startedAt || null,
    extras: extras(side),
  }
}

/** The paired table and its statistics. Exported for tests. */
export function compare(single: Map<string, boolean>, swarm: Map<string, boolean>, capsuleOf: Map<string, string>): BixPaired | undefined {
  const shared = [...single.keys()].filter((q) => swarm.has(q))
  if (!shared.length) return undefined
  let both = 0, onlySingle = 0, onlySwarm = 0, neither = 0
  for (const q of shared) {
    const a = single.get(q)!, b = swarm.get(q)!
    if (a && b) both++
    else if (a) onlySingle++
    else if (b) onlySwarm++
    else neither++
  }
  const n = shared.length
  const interval = newcombePaired({ both, onlySingle, onlySwarm, neither })!
  const p = mcnemarExact(onlySingle, onlySwarm)
  return {
    n, capsules: new Set(shared.map((q) => capsuleOf.get(q) ?? q)).size, bothCorrect: both, onlySingle, onlySwarm, neither,
    accuracySingle: (both + onlySingle) / n, accuracySwarm: (both + onlySwarm) / n,
    difference: (onlySwarm - onlySingle) / n,
    interval95: [round(interval[0]), round(interval[1])], intervalMethod: INTERVAL_METHOD,
    pValue: p === null ? null : round(p, 6), pValueMethod: P_METHOD,
  }
}

/** What a reader may conclude from a pair, in plain words; and whether the answer is "nothing". Exported for tests. */
export function conclude(p: BixPaired): { tooSmall: boolean; conclusion: string } {
  const discordant = p.onlySingle + p.onlySwarm
  const range = `the 95% interval for swarm minus single runs from ${points(p.interval95[0])} to ${points(p.interval95[1])} percentage points`
  const clustered = p.capsules < p.n ? ` The ${p.n} questions come from ${p.capsules} capsule${p.capsules === 1 ? "" : "s"} and questions of one capsule share data, so the real uncertainty is larger than these numbers say.` : ""
  if (discordant < MIN_DISCORDANT) {
    const differed = discordant === 0 ? `gave the same result on all ${p.n} questions` : `differed on only ${discordant} of ${p.n} questions`
    return {
      tooSmall: true,
      conclusion: `Too few questions to conclude anything. The solvers ${differed}; an exact test needs at least ${MIN_DISCORDANT} questions answered differently before it can reach p < 0.05. `
        + `This is compatible with either solver being better and with no difference: ${range}.${clustered}`,
    }
  }
  if (p.pValue !== null && p.pValue < 0.05) {
    const better = p.difference > 0 ? "swarm" : "single agent"
    return { tooSmall: false, conclusion: `The ${better} was correct more often (${points(p.difference)} percentage points, exact p = ${p.pValue}); ${range}.${clustered}` }
  }
  return {
    tooSmall: false,
    conclusion: `No difference detected (${points(p.difference)} percentage points, exact p = ${p.pValue}). That is not evidence that the solvers are equal: ${range}.${clustered}`,
  }
}

/** One row per group of comparable sides, newest first. */
export function scoreboard(all: Loaded[]): BixScoreRow[] {
  const groups = new Map<string, Side[]>()
  for (const side of sides(all)) groups.set(side.key, [...(groups.get(side.key) ?? []), side])
  const rows: { row: BixScoreRow; at: number }[] = []
  for (const group of groups.values()) {
    const singles = group.filter((s) => s.solver === SINGLE), swarms = group.filter((s) => s.solver === SWARM)
    // Newest first already. Prefer the newest pair from one folder: it was run as a pair.
    const together = singles.find((s) => swarms.some((w) => w.loaded === s.loaded))
    const single = together ?? singles[0]
    const swarm = together ? swarms.find((w) => w.loaded === together.loaded) : swarms[0]
    const any = (single ?? swarm)!
    const budgets = any.runs.map((r) => r.maxTokens), limits = new Set(any.runs.map((r) => r.timeLimit))
    const known = budgets.every((b): b is number => b !== null)
    const row: BixScoreRow = {
      dataset: any.loaded.run.dataset, datasetRevision: any.loaded.run.datasetRevision,
      model: uniq(any.runs.map((r) => r.model)).join(", "),
      gradingProfile: any.loaded.run.gradingProfile!,
      answerMode: uniq(any.runs.map((r) => r.answerMode)).join(", ") || null,
      capsules: uniq(any.runs.map((r) => r.capsule)),
      questions: new Set(any.runs.flatMap((r) => r.questionIds)).size,
      maxTokens: known && new Set(budgets).size === 1 ? budgets[0] : null,
      maxTokensTotal: known ? (budgets as number[]).reduce((a, b) => a + b, 0) : null,
      timeLimit: limits.size === 1 ? [...limits][0] : null,
      tooSmall: true, conclusion: "",
    }
    if (single) row.single = cell(single)
    if (swarm) row.swarm = cell(swarm)
    const scripted = [single, swarm].some((s) => s?.loaded.run.scripted)
    if (!single || !swarm) {
      const missing = single ? "swarm" : "single-agent"
      row.note = `no matching ${single ? "swarm run" : "baseline"}: no finished ${missing} run has this dataset, capsule and question set, model, grading profile, token budget and time limit`
      row.conclusion = `No comparison: there is no ${missing} run with the same settings.`
    } else {
      const a = outcomes(single), b = outcomes(swarm)
      const paired = compare(a.correct, b.correct, a.capsule)
      if (!paired) {
        row.note = "the two sides share no question"
        row.conclusion = "No comparison: the two sides share no question."
      } else {
        // The adapter's bootstrap over capsules, when report.json describes exactly this pair.
        const rp = single.loaded.reportPaired, boot = rp?.capsule_bootstrap95
        if (single.loaded === swarm.loaded && rp && single.loaded.reportProfile === row.gradingProfile && rp.n === paired.n && rp.both_correct === paired.bothCorrect
          && rp.only_a_correct === paired.onlySingle && rp.only_b_correct === paired.onlySwarm && Array.isArray(boot) && boot.length === 2 && boot.every((x) => typeof x === "number")) {
          paired.capsuleBootstrap95 = [boot[0] as number, boot[1] as number]
        }
        row.paired = paired
        Object.assign(row, conclude(paired))
        const notes: string[] = []
        const onlySwarm = row.swarm!.extras.filter((e) => !row.single!.extras.includes(e)), onlySingle = row.single!.extras.filter((e) => !row.swarm!.extras.includes(e))
        const differ = [onlySwarm.length && `swarm only: ${onlySwarm.join(", ")}`, onlySingle.length && `single agent only: ${onlySingle.join(", ")}`].filter(Boolean)
        if (differ.length) notes.push(`settings that differ. ${differ.join("; ")}`)
        if (single.loaded !== swarm.loaded) notes.push(`the sides come from different run folders (${single.loaded.run.id}, ${swarm.loaded.run.id})`)
        const unfinished = [row.single!, row.swarm!].filter((c) => c.failedRuns || c.notGraded).map((c) => `${c.solver === SINGLE ? "single agent" : "swarm"}: ${c.failedRuns} failed capsule run(s), ${c.notGraded} question(s) not graded`)
        if (unfinished.length) notes.push(`counted as not correct. ${unfinished.join("; ")}`)
        if (notes.length) row.note = notes.join(". ")
      }
    }
    // A folder that could not be read in full may be missing capsule runs: say so next to its numbers.
    const broken = [single, swarm].filter((s) => s?.loaded.run.error).map((s) => s!.loaded.run.id)
    if (broken.length) row.note = [row.note, `${[...new Set(broken)].join(", ")} could not be read in full; see its error`].filter(Boolean).join(". ")
    if (scripted) {
      row.tooSmall = true
      row.conclusion = `Scripted mock model: this tests the plumbing and is not a result. ${row.conclusion}`
    }
    rows.push({ row, at: Math.max(single?.startedAt ?? 0, swarm?.startedAt ?? 0) })
  }
  return rows.sort((a, b) => b.at - a.at).map((r) => r.row)
}
