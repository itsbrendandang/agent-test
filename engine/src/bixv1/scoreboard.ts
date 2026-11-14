// The BixBench v1 scoreboard: single agent against swarm, question by question. Pure functions over what
// store.ts loaded (no file or network access).
//
// PAIRING. A "side" is one solver's capsule runs in one run folder ("single" is the single agent, "glhf" the
// swarm). Two sides are compared like for like only when all of this is equal:
//   dataset (benchmark name and dataset revision), answer mode (open, mcq, mcq-refusal),
//   the capsule set, and within each capsule the same questions asked in the same unit (per capsule or per question),
//   the solver's model, the grading profile,
//   the EFFECTIVE token budget of every capsule run: what that solver could really spend in all. For the
//     single agent that is max_tokens. For the swarm it is its total under its budget mode: max_tokens in
//     "equal" mode, 2.25 times max_tokens in "extended" mode (store.ts). The stated max_tokens is not compared.
//   the time limit of every capsule run.
// Such a pair is a "same budget" row. Swarm sides of different budget modes never share a row: equal, extended
// and legacy (a run from before budget modes were recorded, counted as the pilot's 42/42/16% allocation inside
// max_tokens) each get their own, labelled.
//
// MORE BUDGET. An extended swarm is also shown next to the single agent it was run against: the one whose
// budget is the swarm's stated max_tokens. That is a separate row with comparison "more budget",
// likeForLike false and the budget ratio. Its numbers are computed the same way and its conclusion starts by
// saying that the swarm had more to spend. It is never merged with, or shown instead of, a "same budget" row.
//
// A side with a capsule run still going is left out until it has finished. A side with a stalled capsule run
// (store.ts) is never paired: it gets a row of its own that says so. Within a group of comparable sides the row
// shows the newest single and the newest swarm side, preferring two from the same run folder. A side nothing
// matches still gets a row, with a note and no comparison: a number is never borrowed from a run with other
// settings. What may differ inside a pair is named in the row's note: role models, critic hints, seed, judge model.
//
// COUNTING. A question is "correct" when its grade says so. Everything else counts as not correct: wrong,
// refused, no answer, a failed capsule run, a judge error. This is the adapter's own rule (stats.py), so an
// ungraded question cannot flatter either side. The statistics are in stats.ts.
import { MIN_DISCORDANT, mcnemarExact, newcombePaired, wilson } from "./stats.ts"
import { type CapsuleRun, type Loaded, SINGLE, SWARM } from "./store.ts"
import type { BixBudgetMode, BixPaired, BixScoreCell, BixScoreRow } from "./types.ts"

export { SINGLE, SWARM }
export const INTERVAL_METHOD = "Newcombe paired score interval (Newcombe 1998, method 10; Wilson intervals without continuity correction)"
export const P_METHOD = "exact McNemar test (two-sided exact sign test on the questions the solvers answered differently)"

interface Side {
  loaded: Loaded; solver: string; runs: CapsuleRun[]; startedAt: number
  /** Comparable on what each side could really spend. */
  key: string
  /** The same with the stated single-agent budget: the key of the baseline an extended swarm was run against. */
  baselineKey: string
  mode: BixBudgetMode | null
  budget: number | null
  stalled: boolean
}

const uniq = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => v !== null))].sort()
const round = (value: number, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits
const points = (x: number) => `${x > 0 ? "+" : ""}${round(x * 100, 1)}`
const total = (values: (number | null)[]) => (values.length && values.every((v): v is number => v !== null) ? (values as number[]).reduce((a, b) => a + b, 0) : null)

/**
 * Sides with the same key may be compared. `budget` says which budget of a capsule run goes into the key:
 * "effective" (what the solver could spend; the pairing rule) or "stated" (max_tokens, the single agent's).
 */
export function pairKey(runs: CapsuleRun[], profile: string, budget: "effective" | "stated" = "effective"): string {
  const units = runs.map((r) => [r.capsule, [...r.questionIds].sort(), budget === "effective" ? r.effectiveTokens : r.maxTokens, r.timeLimit]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
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
      const modes = [...new Set(runs.map((r) => r.budgetMode))]
      out.push({
        loaded, solver, runs, key: pairKey(runs, profile), baselineKey: pairKey(runs, profile, "stated"),
        mode: modes.length === 1 ? modes[0] : "mixed", budget: total(runs.map((r) => r.effectiveTokens)),
        stalled: runs.some((r) => r.status === "stalled"), startedAt: Math.max(0, ...runs.map((r) => r.startedAt ?? 0)),
      })
    }
  }
  return out.sort((a, b) => b.startedAt - a.startedAt || b.loaded.run.id.localeCompare(a.loaded.run.id))
}

function extras(side: Side): string[] {
  const out: string[] = []
  const roles = Object.entries(Object.assign({}, ...side.runs.map((r) => r.roleModels)) as Record<string, string>)
  if (roles.length) out.push(`role models: ${roles.map(([role, model]) => `${role}=${model}`).join(", ")}`)
  // The current swarm's critic is always blind ("none"). Only the first pilot showed it the analyst's route.
  if (side.runs.some((r) => r.criticHints === "route")) out.push("critic was shown the analyst's route")
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
    budgetTokens: side.budget, budgetMode: side.mode,
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

const MODE_WORDS: Record<BixBudgetMode, string> = {
  equal: "equal budget mode", extended: "extended budget mode", mixed: "mixed budget modes", unknown: "unknown budget mode",
  legacy: "legacy allocation (run before budget modes were recorded; counted as the pilot's 42/42/16% split of the single agent's budget)",
}

function buildRow(single: Side | undefined, swarm: Side | undefined, kind: BixScoreRow["comparison"]): BixScoreRow {
  const any = (single ?? swarm)!
  const budgets = any.runs.map((r) => r.effectiveTokens), limits = new Set(any.runs.map((r) => r.timeLimit))
  const ratio = single && swarm && single.budget && swarm.budget !== null ? round(swarm.budget / single.budget, 3) : null
  const mode = swarm?.mode ?? null
  const row: BixScoreRow = {
    comparison: kind, likeForLike: kind === "same budget",
    budgetLabel: kind === "none" ? `no comparison${mode ? `; swarm in ${MODE_WORDS[mode]}` : ""}`
      : kind === "same budget" ? `same budget; swarm in ${MODE_WORDS[mode!]}`
      : `more budget, not like for like: the swarm could spend ${ratio ?? "more than"}${ratio === null ? "" : " times"} the single agent's tokens (${MODE_WORDS[mode!]})`,
    budgetRatio: ratio, tokensUsedRatio: null, swarmBudgetMode: mode,
    dataset: any.loaded.run.dataset, datasetRevision: any.loaded.run.datasetRevision,
    model: uniq(any.runs.map((r) => r.model)).join(", "),
    gradingProfile: any.loaded.run.gradingProfile!,
    answerMode: uniq(any.runs.map((r) => r.answerMode)).join(", ") || null,
    capsules: uniq(any.runs.map((r) => r.capsule)),
    questions: new Set(any.runs.flatMap((r) => r.questionIds)).size,
    maxTokens: budgets.every((b) => b !== null) && new Set(budgets).size === 1 ? budgets[0] : null,
    maxTokensTotal: total(budgets),
    timeLimit: limits.size === 1 ? [...limits][0] : null,
    tooSmall: true, conclusion: "",
  }
  if (single) row.single = cell(single)
  if (swarm) row.swarm = cell(swarm)
  const notes: string[] = []
  if (!single || !swarm) {
    const missing = single ? "swarm" : "single-agent"
    if (any.stalled) {
      notes.push("stalled: a capsule run of this side says it is running but has written nothing for longer than its time limit; it probably crashed. Not compared until it is rerun")
      row.conclusion = "No comparison: this side has a stalled capsule run."
    } else {
      notes.push(`no matching ${single ? "swarm run" : "baseline"}: no finished ${missing} run has this dataset, capsule and question set, model, grading profile, total token budget and time limit`)
      row.conclusion = `No comparison: there is no ${missing} run with the same settings and the same total budget.`
    }
  } else {
    row.tokensUsedRatio = row.single!.tokens ? round(row.swarm!.tokens / row.single!.tokens, 3) : null
    const a = outcomes(single), b = outcomes(swarm)
    const paired = compare(a.correct, b.correct, a.capsule)
    if (!paired) {
      notes.push("the two sides share no question")
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
      if (kind === "more budget") {
        row.conclusion = `Not a like-for-like comparison: the swarm could spend ${ratio ?? "more than"}${ratio === null ? "" : " times"} the single agent's tokens`
          + `${row.tokensUsedRatio === null ? "" : ` and used ${row.tokensUsedRatio} times as many`}, so a difference here may be the budget and not the design. ${row.conclusion}`
      }
      const onlySwarm = row.swarm!.extras.filter((e) => !row.single!.extras.includes(e)), onlySingle = row.single!.extras.filter((e) => !row.swarm!.extras.includes(e))
      const differ = [onlySwarm.length && `swarm only: ${onlySwarm.join(", ")}`, onlySingle.length && `single agent only: ${onlySingle.join(", ")}`].filter(Boolean)
      if (differ.length) notes.push(`settings that differ. ${differ.join("; ")}`)
      if (mode === "legacy") notes.push("the swarm side is a legacy run: its budget mode was not recorded and is taken to be the pilot's allocation inside the single agent's budget")
      if (single.loaded !== swarm.loaded) notes.push(`the sides come from different run folders (${single.loaded.run.id}, ${swarm.loaded.run.id})`)
      const unfinished = [row.single!, row.swarm!].filter((c) => c.failedRuns || c.notGraded).map((c) => `${c.solver === SINGLE ? "single agent" : "swarm"}: ${c.failedRuns} failed capsule run(s), ${c.notGraded} question(s) not graded`)
      if (unfinished.length) notes.push(`counted as not correct. ${unfinished.join("; ")}`)
    }
  }
  // A folder that could not be read in full may be missing capsule runs: say so next to its numbers.
  const broken = [single, swarm].filter((s) => s?.loaded.run.error).map((s) => s!.loaded.run.id)
  if (broken.length) notes.push(`${[...new Set(broken)].join(", ")} could not be read in full; see its error`)
  if (notes.length) row.note = notes.join(". ")
  if ([single, swarm].some((s) => s?.loaded.run.scripted)) {
    row.tooSmall = true
    row.conclusion = `Scripted mock model: this tests the plumbing and is not a result. ${row.conclusion}`
  }
  return row
}

/** Rows as described at the top of this file, newest first; a "more budget" row follows its swarm's other row. */
export function scoreboard(all: Loaded[]): BixScoreRow[] {
  const every = sides(all), ready = every.filter((s) => !s.stalled)
  const rows: { row: BixScoreRow; at: number; order: number }[] = []
  const shown = new Set<Side>()
  const add = (single: Side | undefined, swarm: Side | undefined, kind: BixScoreRow["comparison"], order = 0) => {
    for (const s of [single, swarm]) if (s) shown.add(s)
    rows.push({ row: buildRow(single, swarm, kind), at: Math.max(single?.startedAt ?? 0, swarm?.startedAt ?? 0), order })
  }
  const groups = new Map<string, Side[]>()
  for (const side of ready) groups.set(side.key, [...(groups.get(side.key) ?? []), side])
  // Newest first already. Prefer the newest pair from one folder: it was run as a pair.
  const pick = (singles: Side[], swarms: Side[]): [Side | undefined, Side | undefined] => {
    const together = singles.find((s) => swarms.some((w) => w.loaded === s.loaded))
    return together ? [together, swarms.find((w) => w.loaded === together.loaded)] : [singles[0], swarms[0]]
  }
  const lone: Side[] = [] // swarm sides with no like-for-like baseline; shown alone unless a "more budget" row shows them
  const chosen: Side[] = [] // the swarm side shown for each (group, budget mode)
  for (const group of groups.values()) {
    const singles = group.filter((s) => s.solver === SINGLE)
    for (const mode of new Set(group.filter((s) => s.solver === SWARM).map((s) => s.mode))) {
      const [single, swarm] = pick(singles, group.filter((s) => s.solver === SWARM && s.mode === mode))
      chosen.push(swarm!)
      if (single) add(single, swarm, "same budget")
      else lone.push(swarm!)
    }
  }
  // A swarm that could spend more than its stated single-agent budget, next to the single agent with that budget.
  for (const swarm of chosen) {
    if (swarm.baselineKey === swarm.key) continue // its total is the single agent's budget: nothing more to show
    const [single] = pick(ready.filter((s) => s.solver === SINGLE && s.key === swarm.baselineKey), [swarm])
    if (single) add(single, swarm, "more budget", 1)
  }
  for (const swarm of lone) if (!shown.has(swarm)) add(undefined, swarm, "none")
  for (const group of groups.values()) {
    const single = group.find((s) => s.solver === SINGLE)
    if (single && !group.some((s) => shown.has(s))) add(single, undefined, "none")
  }
  for (const side of every.filter((s) => s.stalled)) add(side.solver === SINGLE ? side : undefined, side.solver === SWARM ? side : undefined, "none")
  return rows.sort((a, b) => b.at - a.at || a.order - b.order).map((r) => r.row)
}
