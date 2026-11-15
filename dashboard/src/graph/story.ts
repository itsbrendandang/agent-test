// The one-sentence answer to "what happened here?", built only from counts of the run's own data. The words are the
// dashboard's shared ones (src/lib/words.ts): "held up", "was proven wrong", "had too little evidence".
import { fmtScore } from "@/lib/format"
import { verdictCount } from "@/lib/words"
import type { GraphModel, Outcome, Stats } from "./types"

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const OUTCOMES: Outcome[] = ["holds", "fails", "unknown"]

/** "9 held up, 1 was proven wrong, 2 had too little evidence". Zero counts are left out. */
export function verdictParts(byOutcome: Record<Outcome, number>): string {
  return OUTCOMES.filter((o) => byOutcome[o] > 0).map((o) => verdictCount(o, byOutcome[o])).join(", ")
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
  if (s.members === 0 && s.claims === 0) return nothing ? "Nothing has been recorded for this run yet." : model.kind === "board" ? "No team member spoke in this run." : "No role left a record in this run."
  const when = model.kind === "board" && s.rounds > 0 ? `over ${plural(s.rounds, "round")}` : ""
  const cap = (t: string) => t.replace(/^./, (c) => c.toUpperCase())
  const pre = partial ? `So far, ${when ? `${when}, ` : ""}` : when ? `${cap(when)}, ` : ""
  if (s.claims === 0) {
    return model.kind === "board"
      ? `${pre}${who} took part, but no statements were recorded, so there is nothing to check.`
      : `${pre}${who} worked on this run, but made no statements, so nothing was tested.${problemsLine(s)}`
  }
  return `${pre}${who} made ${plural(s.claims, "statement")}: ${verdictParts(s.byOutcome)}.${model.kind === "swarm" ? problemsLine(s) : ""}`
}

function problemsLine(s: Stats): string {
  if (s.problems === 0) return ""
  const open = s.problems - s.problemsFixed
  return ` The reviewers found ${plural(s.problems, "problem")}: ${s.problemsFixed} fixed${open > 0 ? `, ${open} still open` : ""}.`
}
