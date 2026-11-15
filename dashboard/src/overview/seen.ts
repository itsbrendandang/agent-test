// What the Overview says about one running run: who takes part and what is being done now. From the run's own events
// (the lab model) when they have arrived, else from what its list line recorded. Pure.
import { agentIdentity, readableName } from "@/lab/identity"
import { captionOf, CHARACTER_IDS, type LabModel, type RunKind } from "@/lab/model"
import type { Work } from "./work"

/** What a person reads for each kind of run, one at a time. */
export const KIND_WORD: Record<RunKind, string> = { answer: "Research answer", board: "Team review", swarm: "Benchmark run" }
/** The engine allows only so many event streams at once: the rows past this many show what the list says. */
export const FOLLOWED = 4

export interface Seen { agents: { name: string; label: string }[]; doing?: string }

/** Who takes part and what is being done now, from the run's events; else from what its list line says. */
export function seenOf(work: Work, model: LabModel | undefined): Seen {
  const live = model && model.status !== "empty" ? model : undefined
  if (live) {
    const members = CHARACTER_IDS.map((id) => live.characters[id]).filter((a) => a.inRun)
    // Who has worked so far (a step of its own started); a run whose events name no one yet: the list line's names, else its team.
    const worked = members.filter((a) => a.state !== "idle")
    const face = (a: (typeof members)[number]) => ({ name: a.id as string, label: captionOf(a) })
    const seenAgents = [...worked.map(face), ...live.visitors.map((v) => ({ name: v.name, label: v.title || v.name }))]
    const agents = seenAgents.length ? seenAgents : work.agents.length ? work.agents.map(answerAgent) : members.map(face)
    const active = [...members.filter((a) => a.state === "working" || a.state === "fetching"), ...live.visitors.filter((v) => v.state === "working" || v.state === "fetching")]
      .sort((a, b) => (b.since ?? 0) - (a.since ?? 0))[0]
    const who = active ? ("title" in active ? active.title : captionOf(active)) : undefined
    const doing = active?.doing ? `${who}: ${active.doing}` : live.log.at(-1)?.text ?? live.note
    if (agents.length || doing) return { agents, doing: doing ?? work.step?.label }
  }
  const agents = work.agents.map(answerAgent)
  const doing = work.step ? (work.step.agent ? `${answerAgent(work.step.agent).label}: ${work.step.label}` : work.step.label) : work.status === "waiting" ? "Waiting for an earlier answer to finish." : undefined
  return { agents, doing }
}

/** The lab's characters for an answer's investigators, in order (lab/adapter.ts gives them the same faces). */
const INVESTIGATOR_FACE = ["scout", "librarian", "auditor"]
/** The face the lab gives an answer's own step agents. */
const STEP_FACE: Record<string, string> = { planner: "proposer", searcher: "scout", writer: "reporter", checker: "checker", critic: "critic", reviser: "reviser" }
/** An agent name from a list line ("writer", "investigator-2", "specialist:toxicologist", "lead-scientist") as a face and a label. */
export function answerAgent(agent: string): { name: string; label: string } {
  const specialist = /^specialist:(.+)$/.exec(agent)?.[1]
  if (specialist) return { name: specialist, label: agentIdentity(specialist).short }
  const n = Number(/^investigator-(\d+)$/.exec(agent)?.[1])
  if (n >= 1) return { name: INVESTIGATOR_FACE[n - 1] ?? agent, label: `Investigator ${n}` }
  if (STEP_FACE[agent]) return { name: STEP_FACE[agent], label: readableName(agent) }
  return { name: agent, label: agentIdentity(agent).short }
}
