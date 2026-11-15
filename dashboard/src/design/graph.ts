// How a node looks. Colour is never the only signal: every kind has its own shape, and claims and tests carry the
// verdict glyph in their label, in the side panel and in the list. Colours come from the app's own palette (index.css).
import type { GraphNode, NodeKind, Outcome } from "../graph/types"

export type Shape = "dodecahedron" | "capsule" | "cylinder" | "torus" | "sphere" | "octahedron" | "cube" | "tetrahedron" | "cone" | "slab"

/** Verdict-bearing nodes (claims, tests) take their shape from the verdict. */
export const VERDICT_SHAPE: Record<Outcome, Shape> = { holds: "sphere", fails: "octahedron", unknown: "cube" }
export const KIND_SHAPE: Record<NodeKind, Shape> = {
  run: "dodecahedron", agent: "capsule", checker: "cylinder", phase: "torus", claim: "sphere", source: "tetrahedron",
  test: "sphere", issue: "cone", artifact: "slab",
}
/** Used when the page's CSS variables cannot be read (tests, a failed stylesheet). They are the values in index.css. */
const FALLBACK = { brand: "#ffd23f", ink: "#1b1a17", surface: "#fffdf6", bg: "#f6f3ec", muted: "#6a6457", edge: "#e2dccb", success: "#17824d", warning: "#c26a00", danger: "#d6293e", pink: "#ff9ecb" }
export interface Palette {
  kind: Record<NodeKind, string>; verdict: Record<Outcome, string>
  background: string; line: string; lineDim: string; lineHot: string; lineRefuted: string; label: string; labelBg: string; dim: string
}
const cssVar = (name: keyof typeof FALLBACK): string => {
  try { return getComputedStyle(document.documentElement).getPropertyValue(`--${name === "muted" ? "text-muted" : name}`).trim() || FALLBACK[name] } catch { return FALLBACK[name] }
}
const graphVar = (name: string, fallback: string): string => {
  try { return getComputedStyle(document.documentElement).getPropertyValue(`--graph-${name}`).trim() || fallback } catch { return fallback }
}
export function palette(): Palette {
  const [brand, ink, surface, muted, success, warning, danger, pink] = (["brand", "ink", "surface", "muted", "success", "warning", "danger", "pink"] as const).map(cssVar)
  const verdict = { holds: success, fails: danger, unknown: warning }
  return {
    verdict,
    kind: { run: brand, agent: ink, checker: graphVar("checker", "#3f7cc4"), phase: "#b9b2a0", claim: success, source: "#8a909c", test: muted, issue: pink, artifact: graphVar("artifact", "#8a6d3b") },
    background: surface, line: muted, lineDim: graphVar("line", "#e6e0d0"), lineHot: ink, lineRefuted: danger, label: ink, labelBg: graphVar("label-bg", "rgba(255,253,246,0.88)"), dim: graphVar("dim", "#d9d3c2"),
  }
}

export const shapeOf = (n: GraphNode): Shape => (n.verdict && (n.kind === "claim" || n.kind === "test") ? VERDICT_SHAPE[n.verdict.cls] : KIND_SHAPE[n.kind])
/** A source with a published notice is drawn in the warning colours: red for a retraction, amber for a correction or an expression of concern. */
export const flagColour = (flag: NonNullable<GraphNode["flag"]>, p: Palette): string => (flag.type === "retraction" ? p.verdict.fails : p.verdict.unknown)
export const colourOf = (n: GraphNode, p: Palette): string => (n.verdict && (n.kind === "claim" || n.kind === "test") ? p.verdict[n.verdict.cls] : n.flag ? flagColour(n.flag, p) : p.kind[n.kind])

const SIZE: Record<NodeKind, number> = { run: 7, agent: 3.6, checker: 3, phase: 3.2, claim: 2, source: 2, test: 1.6, issue: 2.4, artifact: 2.6 }
/**
 * Node size grows with the number of connections, as in Obsidian's graph: a member with many claims is bigger than a
 * claim with two lines. `emphasis` draws contradicted and refuted things larger, the rest slightly smaller.
 */
export const sizeOf = (n: GraphNode, emphasis: boolean, degree = 0): number =>
  SIZE[n.kind] * (1 + 0.22 * Math.sqrt(degree)) * (emphasis ? (n.attention === 2 ? 1.7 : n.attention === 1 ? 1.2 : n.kind === "claim" || n.kind === "test" ? 0.9 : 1) : 1)

/** Spring length per kind of line: the run is far from everything, claims sit close to who wrote them down. */
export const LINK_DISTANCE: Record<string, number> = {
  involves: 70, framed: 50, next: 45, replied: 40, "in-phase": 55, made: 28, ruled: 55, retrieved: 40, cites: 60,
  targets: 20, registered: 24, recorded: 24, raised: 30, resolved: 30, against: 30, about: 34, produced: 40,
}
