// How a node looks. Colour is never the only signal: every kind has its own shape, and claims and tests carry the
// verdict glyph in their label, in the side panel and in the list.
import type { GraphNode, NodeKind, VerdictClass } from "./types"

export type Shape = "dodecahedron" | "capsule" | "cylinder" | "torus" | "sphere" | "octahedron" | "cube" | "tetrahedron" | "cone" | "slab"

/** Verdict-bearing nodes (claims, tests) take their shape from the verdict. */
export const VERDICT_SHAPE: Record<VerdictClass, Shape> = { pass: "sphere", fail: "octahedron", unknown: "cube" }
export const KIND_SHAPE: Record<NodeKind, Shape> = {
  run: "dodecahedron", agent: "capsule", checker: "cylinder", phase: "torus", claim: "sphere", source: "tetrahedron",
  test: "sphere", issue: "cone", artifact: "slab",
}
export const KIND_COLOUR: Record<NodeKind, string> = {
  run: "#ffd23f", agent: "#8ab4ff", checker: "#b79cff", phase: "#aab0b8", claim: "#3ddc97", source: "#e8e3d0",
  test: "#d6d3c8", issue: "#ff9ecb", artifact: "#6fe0e0",
}
export const VERDICT_COLOUR: Record<VerdictClass, string> = { pass: "#3ddc97", fail: "#ff5a6e", unknown: "#ffb454" }
export const BACKGROUND = "#14130f"

export const shapeOf = (n: GraphNode): Shape => (n.verdict && (n.kind === "claim" || n.kind === "test") ? VERDICT_SHAPE[n.verdict.cls] : KIND_SHAPE[n.kind])
export const colourOf = (n: GraphNode): string => (n.verdict && (n.kind === "claim" || n.kind === "test") ? VERDICT_COLOUR[n.verdict.cls] : KIND_COLOUR[n.kind])

const SIZE: Record<NodeKind, number> = { run: 9, agent: 6, checker: 5, phase: 4.5, claim: 3.5, source: 3, test: 2.5, issue: 3.5, artifact: 4 }
/** `emphasis`: refuted and contested things are drawn larger, the rest slightly smaller. */
export const sizeOf = (n: GraphNode, emphasis: boolean): number =>
  SIZE[n.kind] * (emphasis ? (n.attention === 2 ? 1.9 : n.attention === 1 ? 1.25 : n.kind === "claim" || n.kind === "test" ? 0.85 : 1) : 1)

/** Spring length per kind of link: the run is far from everything, claims sit close to who made them. */
export const LINK_DISTANCE: Record<string, number> = {
  involves: 70, framed: 50, next: 45, replied: 40, "in-phase": 55, made: 28, ruled: 55, retrieved: 40, cites: 60,
  targets: 20, registered: 24, recorded: 24, raised: 30, resolved: 30, against: 30, about: 34, produced: 40,
}
