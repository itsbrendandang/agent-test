// The words for hypotheses, in one place: the Research conversation, its inspector, the Lab and the Graph view say the same.
import type { Hypothesis } from "./model"

/** The line under the map and above the inspector's table. Shared words: the Lab and the Graph view use the same. */
export const HYPOTHESES_NOTE = "Tested against published sources, not by experiment."

/** "2 sources for, 1 against". */
export const sidesLine = (r: NonNullable<Hypothesis["result"]>): string => `${r.for.length} source${r.for.length === 1 ? "" : "s"} for, ${r.against.length} against`

/** The name on screen of who does a step, from the engine's id: "investigator-2" is "Investigator 2". An id this page does not know is shown as it is. */
export function agentName(agent: string | undefined): string | undefined {
  if (!agent) return undefined
  const n = /^investigator-(\d+)$/.exec(agent)
  if (n) return `Investigator ${n[1]}`
  return ({ planner: "Planner", searcher: "Searcher", writer: "Writer", checker: "Checker", critic: "Critic" } as Record<string, string>)[agent] ?? agent
}

/** What a hypothesis was tested with, in words. Today: published sources. A kind this page does not know is said as the engine named it. */
export function testedWith(testedBy: { kind: string; run?: string } | undefined): string | undefined {
  if (!testedBy) return undefined
  if (testedBy.kind === "sources") return "Tested against published sources"
  if (testedBy.kind === "swarm") return `Tested on data by a team run${testedBy.run ? ` (${testedBy.run})` : ""}`
  return `Tested by: ${testedBy.kind}`
}
