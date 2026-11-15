// The graph model: one shape for a board run and a swarm run. Every field is read from the engine's own data
// (see model.ts for which field feeds which node and edge). Nothing here is inferred.

export type NodeKind = "run" | "agent" | "checker" | "phase" | "claim" | "source" | "test" | "issue" | "artifact"
export const NODE_KINDS: readonly NodeKind[] = ["run", "agent", "checker", "phase", "claim", "source", "test", "issue", "artifact"]

/**
 * What an edge means. Each one is a relationship the data records:
 * involves (run lists the agent), framed (lead framed the run), replied (member.replied in a round), made / proposed
 * (agent made a claim), ruled (checker ruled on a claim), retrieved (agent kept the source after a search),
 * cites (a claim of kind "brief" is checked against the brief), in-phase (logged in that round or phase), next (order of
 * rounds or phases), targets (test of a claim), registered / recorded (agent planned / ran a test), raised / resolved
 * (agent and issue), against (issue names the artefact), about (claim names the artefact), produced (run output).
 */
export type LinkKind =
  | "involves" | "framed" | "replied" | "made" | "ruled" | "retrieved" | "cites" | "in-phase" | "next"
  | "targets" | "registered" | "recorded" | "raised" | "resolved" | "against" | "about" | "produced"

/** pass: verified / supported. fail: contradicted / refuted. unknown: unsupported / insufficient / untested / unchecked. */
export type VerdictClass = "pass" | "fail" | "unknown"
export const VERDICT_CLASSES: readonly VerdictClass[] = ["fail", "unknown", "pass"]
/** Shared glyphs, as in the rest of the dashboard: readable without colour. */
export const GLYPH: Record<VerdictClass, string> = { pass: "✓", fail: "✕", unknown: "?" }
export const VERDICT_WORD: Record<VerdictClass, string> = { pass: "verified or supported", fail: "contradicted or refuted", unknown: "unsupported, insufficient or untested" }

export interface Verdict { cls: VerdictClass; /** The engine's own word, e.g. "contradicted". */ raw: string }

export interface Fact { label: string; value: string }
export interface Activity { label: string; text: string }

export interface GraphNode {
  id: string
  kind: NodeKind
  /** Short text for the hover label, the list and the 3D label. */
  label: string
  /** Untrusted model text (a claim, a problem, a source's text): always rendered as text. */
  text?: string
  /** 0 for the run; otherwise the position of the first event that mentions the node. */
  order: number
  verdict?: Verdict
  /** 2: refuted or contradicted. 1: contested (unsupported, open serious issue, planned test with no result). */
  attention: 0 | 1 | 2
  facts: Fact[]
  /** What an agent or checker did, in order. */
  activity: Activity[]
  /** http(s) address of a source, only when it is one. */
  url?: string
  /** Round or phase this belongs to, when recorded. */
  round?: number
}

export interface GraphLink {
  id: string
  /** The node that acts. */
  source: string
  target: string
  kind: LinkKind
  order: number
  /** One sentence, e.g. "made claim". */
  label: string
}

export type RunKind = "board" | "swarm"

export interface Step { label: string; at?: number }
export interface Mark { label: string; order: number }

export interface GraphModel {
  kind: RunKind
  runId: string
  title: string
  nodes: GraphNode[]
  links: GraphLink[]
  /** true: the run's own flag says scripted. false: real model. undefined: the run does not say. */
  scripted: boolean | undefined
  /** A swarm run on the built-in toy case. */
  demo: boolean
  /** "running" until the run's own finish record is seen. */
  status: "running" | "done" | "failed" | "cancelled" | "queued"
  /** One entry per ordered step; steps[i] is order i + 1. */
  steps: Step[]
  /** Round or phase starts, for the stepper. */
  marks: Mark[]
  maxOrder: number
  /** Plain statements about what this graph cannot show for this run. */
  notes: string[]
  /** Nodes left out because of the size cap. */
  hidden: number
}

export const MAX_NODES = 600

export const LINK_KINDS: readonly LinkKind[] = [
  "made", "ruled", "retrieved", "replied", "cites", "targets", "registered", "recorded", "raised", "resolved", "against", "about",
  "produced", "framed", "next", "in-phase", "involves",
]
/** Drawn only when asked for: they tie every node to a hub and bury the rest. Still listed in the connections of each node. */
export const QUIET_LINKS: readonly LinkKind[] = ["involves", "in-phase"]

export const KIND_LABEL: Record<NodeKind, string> = {
  run: "Run", agent: "Agent", checker: "Checker", phase: "Round or phase", claim: "Claim", source: "Evidence source",
  test: "Falsification test", issue: "Issue", artifact: "Artefact",
}
export const LINK_LABEL: Record<LinkKind, string> = {
  involves: "involves", framed: "framed", replied: "replied in", made: "made", ruled: "ruled on", retrieved: "retrieved",
  cites: "cites", "in-phase": "logged in", next: "was followed by", targets: "tests", registered: "planned",
  recorded: "ran", raised: "raised", resolved: "resolved", against: "is raised against", about: "depends on", produced: "produced",
}
