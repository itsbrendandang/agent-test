// Which detail panel (details/DetailSheet.tsx) a graph node of a team review opens. The ids are the ones model.ts gives.
import type { DetailTarget } from "@/details/DetailSheet"
import type { GraphNode } from "./types"

/** A team review's node as a detail panel's target: a member or checker, a kept source, or a statement. Others have none. */
export function detailOf(node: GraphNode): DetailTarget | undefined {
  const [kind, ...rest] = node.id.split(":"), tail = rest.join(":")
  if (kind === "agent") return { kind: "agent", id: tail === "lead" ? "lead-scientist" : tail }
  if (kind === "checker") return { kind: "agent", id: tail }
  if (kind === "source" && tail !== "brief") return { kind: "entity", ref: { kind: "source", url: tail } }
  if (kind === "claim" && node.text) { const cut = tail.lastIndexOf(":"); return cut > 0 ? { kind: "entity", ref: { kind: "claim", agent: tail.slice(0, cut), text: node.text } } : undefined }
  return undefined
}
