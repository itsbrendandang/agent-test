// Pure helpers over a GraphModel: what is visible at a step and under the filters, neighbours, search, the size cap
// and the list of connections used by the non-visual view.
import { LINK_LABEL, MAX_NODES, type GraphLink, type GraphModel, type GraphNode, type LinkKind, type NodeKind, type VerdictClass } from "./types"

export interface ViewState {
  hiddenKinds: ReadonlySet<NodeKind>
  /** Verdict classes to hide. Only nodes that carry a verdict are affected. */
  hiddenVerdicts: ReadonlySet<VerdictClass>
  /** Kinds of line not to draw. Nodes stay, and the lists and panels still name these connections. */
  hiddenLinks: ReadonlySet<LinkKind>
  /** Show what happened up to and including this step. null: everything. */
  step: number | null
}
export const ALL: ViewState = { hiddenKinds: new Set(), hiddenVerdicts: new Set(), hiddenLinks: new Set(), step: null }

/** `links` are drawn; `connections` are all links among the shown nodes, drawn or not, for the list and the panel. */
export interface Visible { nodes: GraphNode[]; links: GraphLink[]; connections: GraphLink[] }

/**
 * The nodes and links to show. A node is shown when it has happened (order <= step) and passes the kind and verdict
 * filters. A node whose every neighbour was removed by a filter is removed too (the run itself always stays), so
 * hiding the claims does not leave their tests floating.
 */
export function applyView(model: Pick<GraphModel, "nodes" | "links">, state: ViewState): Visible {
  const passes = (n: GraphNode) =>
    n.kind === "run" || (!state.hiddenKinds.has(n.kind) && !(n.verdict && state.hiddenVerdicts.has(n.verdict.cls)))
  const filtered = new Set(model.nodes.filter(passes).map((n) => n.id))
  const hasLink = new Set<string>(), hasFilteredNeighbour = new Set<string>()
  for (const l of model.links) {
    hasLink.add(l.source); hasLink.add(l.target)
    if (filtered.has(l.target)) hasFilteredNeighbour.add(l.source)
    if (filtered.has(l.source)) hasFilteredNeighbour.add(l.target)
  }
  const keep = new Set(model.nodes.filter((n) => filtered.has(n.id) && (n.kind === "run" || !hasLink.has(n.id) || hasFilteredNeighbour.has(n.id))).map((n) => n.id))
  const step = state.step
  const nodes = model.nodes.filter((n) => keep.has(n.id) && (step === null || n.order <= step))
  const shown = new Set(nodes.map((n) => n.id))
  const connections = model.links.filter((l) => shown.has(l.source) && shown.has(l.target) && (step === null || l.order <= step))
  return { nodes, links: connections.filter((l) => !state.hiddenLinks.has(l.kind)), connections }
}

export function neighbourMap(links: readonly GraphLink[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>()
  const add = (a: string, b: string) => { (m.get(a) ?? m.set(a, new Set()).get(a)!).add(b) }
  for (const l of links) { add(l.source, l.target); add(l.target, l.source) }
  return m
}

export interface Connection { link: GraphLink; other: GraphNode; /** true: this node is the actor. */ outgoing: boolean; sentence: string }
export function connectionsOf(id: string, nodes: readonly GraphNode[], links: readonly GraphLink[]): Connection[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const self = byId.get(id)
  if (!self) return []
  const out: Connection[] = []
  for (const link of links) {
    const outgoing = link.source === id
    if (!outgoing && link.target !== id) continue
    const other = byId.get(outgoing ? link.target : link.source)
    if (!other) continue
    const [a, b] = outgoing ? [self, other] : [other, self]
    out.push({ link, other, outgoing, sentence: `${a.label} ${LINK_LABEL[link.kind]} ${b.label}` })
  }
  return out
}

/** Most important first: refuted, then contested, then everything else in the order it happened. */
export const byAttention = (a: GraphNode, b: GraphNode) => b.attention - a.attention || a.order - b.order || a.id.localeCompare(b.id)

/** Nodes whose label, text, id or facts contain every word of the query. Refuted and contested ones come first. */
export function searchNodes(nodes: readonly GraphNode[], query: string): GraphNode[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const hay = (n: GraphNode) => [n.label, n.text ?? "", n.id, n.verdict?.raw ?? "", ...n.facts.map((f) => f.value)].join(" ").toLowerCase()
  return nodes.filter((n) => { const h = hay(n); return words.every((w) => h.includes(w)) }).sort(byAttention)
}

const KEEP_ALWAYS: readonly NodeKind[] = ["run", "agent", "checker", "phase"]
const RANK: Record<NodeKind, number> = { run: 0, agent: 0, checker: 0, phase: 0, claim: 1, issue: 2, test: 3, artifact: 4, source: 5 }

/**
 * A run with more than `max` nodes keeps the run, agents, checkers and phases, then the most important of the rest:
 * refuted and contested first, then claims, issues, tests, artefacts, sources. Links to dropped nodes go too.
 * `hidden` says how many nodes were left out.
 */
export function capGraph(model: GraphModel, max = MAX_NODES): GraphModel {
  if (model.nodes.length <= max) return model
  const fixed = model.nodes.filter((n) => KEEP_ALWAYS.includes(n.kind))
  const rest = model.nodes.filter((n) => !KEEP_ALWAYS.includes(n.kind)).sort((a, b) => b.attention - a.attention || RANK[a.kind] - RANK[b.kind] || a.order - b.order)
  const kept = new Set([...fixed, ...rest.slice(0, Math.max(0, max - fixed.length))].map((n) => n.id))
  const nodes = model.nodes.filter((n) => kept.has(n.id))
  return {
    ...model, nodes, links: model.links.filter((l) => kept.has(l.source) && kept.has(l.target)),
    hidden: model.nodes.length - nodes.length,
    notes: [...model.notes, `This run has ${model.nodes.length} nodes. The graph shows the ${nodes.length} most important: refuted and contested first. The rest are left out.`],
  }
}

export function countVerdicts(nodes: readonly GraphNode[]): Record<VerdictClass, number> {
  const c: Record<VerdictClass, number> = { pass: 0, fail: 0, unknown: 0 }
  for (const n of nodes) if (n.kind === "claim" && n.verdict) c[n.verdict.cls]++
  return c
}
