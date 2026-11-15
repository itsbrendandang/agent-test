// The one-sentence answer to "what happened here?", built only from counts of the run's own data. The words are the
// dashboard's shared ones (src/lib/words.ts): supported, contradicted, insufficient evidence, not checked.
import { fmtScore } from "@/lib/format"
import { markCounts, markOf, type Mark } from "@/lib/words"
import type { GraphModel, Stats } from "./types"

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "9 supported, 1 contradicted, 2 insufficient evidence, 1 not checked", from the checks' own words. Zero counts are left out. */
export function verdictParts(byVerdict: Record<string, number>): string {
  const by: Partial<Record<Mark, number>> = {}
  for (const [word, n] of Object.entries(byVerdict)) { const m = markOf(word); by[m] = (by[m] ?? 0) + n }
  return markCounts(by)
}

/**
 * What happened, in one or two sentences. `partial` is true while a run is still going or the scrubber is part of the way
 * through ("So far, ..."). A run with no statements says so plainly.
 */
export function headline(model: Pick<GraphModel, "kind" | "single" | "status" | "score">, s: Stats, partial = false): string {
  if (model.single) {
    const out = s.outputs > 0 ? ` It produced ${plural(s.outputs, "required output")}${model.score !== undefined ? `, and the grader scored them ${fmtScore(model.score)}` : ""}.` : ""
    return `One agent worked alone, so there are no statements to check.${out}`
  }
  const nothing = partial || model.status === "running" || model.status === "queued"
  const who = model.kind === "board" ? plural(s.members, "team member") : plural(s.members, "role")
  if (s.members === 0 && s.claims === 0) return nothing ? "Nothing has been recorded for this run yet." : NOTHING_RECORDED
  const when = model.kind === "board" && s.rounds > 0 ? `over ${plural(s.rounds, "round")}` : ""
  const cap = (t: string) => t.replace(/^./, (c) => c.toUpperCase())
  const pre = partial ? `So far, ${when ? `${when}, ` : ""}` : when ? `${cap(when)}, ` : ""
  if (s.claims === 0) {
    return model.kind === "board"
      ? `${pre}${who} took part, but no statements were recorded, so there is nothing to check.`
      : `${pre}${who} worked on this run, but made no statements, so nothing was tested.${problemsLine(s)}`
  }
  return `${pre}${who} made ${plural(s.claims, "statement")}: ${verdictParts(s.byVerdict)}.${model.kind === "swarm" ? problemsLine(s) : ""}`
}

function problemsLine(s: Stats): string {
  if (s.problems === 0) return ""
  const open = s.problems - s.problemsFixed
  return ` The reviewers found ${plural(s.problems, "problem")}: ${s.problemsFixed} fixed${open > 0 ? `, ${open} still open` : ""}.`
}

/** The one quiet line for a run that left no record. */
export const NOTHING_RECORDED = "Nothing was recorded in this run, so there is little to show."

/** Replay speed: about 30 seconds for a whole run, never faster than 3 steps a second or slower than 1. */
export const stepMs = (max: number) => Math.max(280, Math.min(900, Math.round(30_000 / Math.min(100, Math.max(1, max)))))
/** A long run replays several steps at a time, so that a replay never takes much longer than half a minute. */
export const stepsPerTick = (max: number) => Math.max(1, Math.ceil(max / 100))
export const replaySeconds = (max: number) => Math.max(5, Math.round((Math.ceil(max / stepsPerTick(max)) * stepMs(max)) / 1000))

/** What the replay is showing, in one sentence of the run's own recorded events. */
export function narration(model: Pick<GraphModel, "steps" | "maxOrder">, step: number | null): string {
  if (step === null) return ""
  if (step === 0) return "Before anything happened."
  return model.steps[step - 1]?.label ?? ""
}

