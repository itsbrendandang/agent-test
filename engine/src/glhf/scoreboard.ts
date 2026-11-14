// The scoreboard: single agent against swarm. Pure functions (no file or network access), shared by the CLI
// and GET /api/glhf/scoreboard, so the dashboard and the terminal always agree.
//
// Two runs are compared only when they had the same task, model, time limit and token budget. Within such a
// group the row shows the latest settled run of each solver, also when that run failed: an older success
// never stands in for a newer failure. Extras that one side had and the other did not are listed per run.
import type { GlhfRun } from "./types.ts"

export interface Cell {
  id: string
  phase: "done" | "failed"
  score?: number
  startedAt: number
  /** What this run had beyond the shared settings, in plain words: "Exa search", "memory", "3 review rounds", ... */
  extras: string[]
}

export interface Row {
  task: string
  model: string
  timeLimit?: number
  maxTokens?: number
  single?: Cell
  swarm?: Cell
  /** swarm minus single, only when both ran with the same settings, both finished and both were graded. */
  diff?: number
  /** Why there is no difference to show, or what to keep in mind when reading it. */
  note?: string
}

export function extras(run: GlhfRun): string[] {
  const s = run.settings ?? {}
  const out: string[] = []
  if (s.exa) out.push("Exa search")
  if (s.memory) out.push("memory")
  if (run.solver === "glhf") out.push(`${s.reviewRounds ?? 3} review rounds`)
  if (s.maxMessagesPerRole) out.push(`${s.maxMessagesPerRole} messages per role`)
  const roles = Object.entries(run.roleModels ?? {})
  if (roles.length) out.push(`role models: ${roles.map(([role, model]) => `${role}=${model}`).join(", ")}`)
  if (s.seed) out.push(`seed ${s.seed}`)
  if (s.effort) out.push(`effort ${s.effort}`)
  if (run.mode === "cloud") out.push("cloud")
  return out
}

/** Runs with the same key may be compared. */
export const pairKey = (run: GlhfRun) => JSON.stringify([run.task, run.model, run.settings?.timeLimit ?? null, run.settings?.maxTokens ?? null])

const cell = (run: GlhfRun): Cell => {
  const out: Cell = { id: run.id, phase: run.phase as "done" | "failed", startedAt: run.startedAt, extras: extras(run) }
  if (typeof run.score === "number") out.score = run.score
  return out
}

/** One row per group of comparable runs, newest group first. `runs` may be in any order. */
export function scoreboard(runs: GlhfRun[]): Row[] {
  const rows = new Map<string, Row>()
  const settled = runs.filter((r) => r.phase === "done" || r.phase === "failed").sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id))
  for (const run of settled) {
    const key = pairKey(run)
    let row = rows.get(key)
    if (!row) {
      row = { task: run.task, model: run.model }
      if (run.settings?.timeLimit) row.timeLimit = run.settings.timeLimit
      if (run.settings?.maxTokens) row.maxTokens = run.settings.maxTokens
      rows.set(key, row)
    }
    if (run.solver === "single") row.single ??= cell(run) // newest first, so the first one seen is the latest
    else row.swarm ??= cell(run)
  }
  for (const row of rows.values()) {
    const { single, swarm } = row
    if (!single || !swarm) {
      row.note = `no matching ${single ? "swarm run" : "baseline"}: no ${single ? "swarm" : "single-agent"} run has this task, model, time limit and token budget`
      continue
    }
    const failed = [single.phase === "failed" && "single agent", swarm.phase === "failed" && "swarm"].filter(Boolean)
    if (failed.length) { row.note = `the latest ${failed.join(" and ")} run failed`; continue }
    if (single.score === undefined || swarm.score === undefined) { row.note = "not graded"; continue }
    row.diff = swarm.score - single.score
    const only = swarm.extras.filter((e) => /^(Exa search|memory|role models)/.test(e))
    if (only.length) row.note = `the swarm also had ${only.join(", ")}; the single agent did not`
  }
  return [...rows.values()].sort((a, b) => Math.max(b.single?.startedAt ?? 0, b.swarm?.startedAt ?? 0) - Math.max(a.single?.startedAt ?? 0, a.swarm?.startedAt ?? 0))
}
