// Which rows of the Agent Log belong to one agent, when another view names that agent: the Agents view by the engine's
// name ("lead-scientist", "critique"), the graph by a team member's name, the Agent Lab by its character ("navigator",
// "scout"). The agent's own name wins; a lab character finds the rows of the agents and steps it plays in the lab.
// No React here.
import { stepCharacter } from "./adapter"
import { agentIdentity, agentKey } from "./identity"
import type { EventRow } from "./logRows"
import type { CharacterId, RunKind } from "./model"

/** The lab character that plays a row's agent: an answer's step by its kind (as the lab draws it), else the agent by its name. */
export function rowCharacter(row: EventRow, run: RunKind): CharacterId | undefined {
  if (row.agentId === "engine") return undefined
  return (run === "answer" ? stepCharacter(row.kind, undefined) : undefined) ?? agentIdentity(row.agentId.replace(/^specialist:/, "")).character
}

/** The rows of one agent: by its own name; else, when nothing has that name, by the character that plays it. */
export function agentRows(rows: readonly EventRow[], name: string, run: RunKind): EventRow[] {
  const key = agentKey(name.replace(/^specialist:/, ""))
  if (!key) return []
  const own = rows.filter((r) => r.agentId !== "engine" && (agentKey(r.agentId.replace(/^specialist:/, "")) === key || agentKey(r.agent) === key))
  if (own.length) return own
  const character = agentIdentity(name).character
  return character ? rows.filter((r) => rowCharacter(r, run) === character) : []
}

/** Whether the Agents view has a card for this agent: one of the team, a review member or a specialist, not a checker or a step. */
export const hasCard = (name: string) => { const k = agentIdentity(name.replace(/^specialist:/, "")).kind; return k === "agent" || k === "specialist" }
