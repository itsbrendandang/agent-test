// The graph model: one shape for a board run and a swarm run. Every field is read from the engine's own data
// (see model.ts for which field feeds which node and edge). Nothing here is inferred.
import type { Outcome } from "@/lib/verdict"
export type { Outcome }
export { GLYPH } from "@/lib/verdict"

export type NodeKind = "run" | "agent" | "checker" | "phase" | "claim" | "source" | "test" | "issue" | "artifact"
export const NODE_KINDS: readonly NodeKind[] = ["run", "agent", "checker", "phase", "claim", "source", "test", "issue", "artifact"]

/**
 * What an edge means. Each one is a relationship the data records:
 * involves (the run lists the member or role), framed (the lead framed the run), replied (member.replied, in a round),
 * made (member or role wrote down a claim), ruled (a checker ruled on a claim), retrieved (member kept the source after a
 * search), cites (a claim names its source: kind "brief", or the `source` field of claim.checked when the run has it),
 * in-phase (logged in that round or turn), next (order of rounds or turns), targets (a test of a claim), registered / recorded
 * (planned / ran a test), raised / resolved (member or role and problem), against (a problem names the output),
 * about (a claim names the output), produced (output of the run).
 */
export type LinkKind =
  | "involves" | "framed" | "replied" | "made" | "ruled" | "retrieved" | "cites" | "in-phase" | "next"
  | "targets" | "registered" | "recorded" | "raised" | "resolved" | "against" | "about" | "produced"

export const LINK_KINDS: readonly LinkKind[] = [
  "made", "ruled", "retrieved", "replied", "cites", "targets", "registered", "recorded", "raised", "resolved", "against", "about",
  "produced", "framed", "next", "in-phase", "involves",
]
/** Not drawn at first: they tie every claim to a round and bury the rest. Still named in each node's connections. */
export const QUIET_LINKS: readonly LinkKind[] = ["in-phase"]

/** holds: verified / supported. fails: contradicted / refuted. unknown: unsupported / insufficient / untested / unchecked. */
export const VERDICT_CLASSES: readonly Outcome[] = ["fails", "unknown", "holds"]

export interface Verdict { cls: Outcome; /** The engine's own word, e.g. "contradicted". */ raw: string }

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
  /** 2: contradicted or refuted. 1: contested (unsupported, open serious problem, planned test with no result). */
  attention: 0 | 1 | 2
  facts: Fact[]
  /** What a member or checker did, in order. */
  activity: Activity[]
  /** http(s) address of a source, only when it is one. */
  url?: string
  /** Round, when recorded. */
  round?: number
  /** A step that did not run: drawn faded, and its panel says why. Its label stays the plain name. */
  muted?: boolean
  /** A source with a published retraction, correction or expression of concern: drawn in the warning colours, with the notice in its panel. */
  flag?: { type: "retraction" | "correction" | "expression of concern"; url?: string; date?: string; what: string }
  /** The lane (stage) the node is drawn in, left to right, when the model has lanes. */
  lane?: number
}

export interface GraphLink {
  id: string
  /** The node that acts. */
  source: string
  target: string
  kind: LinkKind
  order: number
  /** The verb, e.g. "wrote down". */
  label: string
}

export type RunKind = "board" | "swarm"

/** One recorded event, told in a sentence made only from what the event says. `nodes` are the nodes it concerns. */
export interface Step { label: string; at?: number; nodes: string[] }
export interface Mark { label: string; order: number }

/** Counts for the one-sentence summary. */
export interface Stats {
  members: number
  claims: number
  /** Claims by the engine's own verdict word, e.g. { verified: 9, contradicted: 1 }. */
  byVerdict: Record<string, number>
  /** The same claims in three groups, as the graph draws them: supported, contradicted, and the rest (insufficient evidence or not checked). */
  byOutcome: Record<Outcome, number>
  rounds: number
  problems: number
  problemsFixed: number
  outputs: number
  tests: number
}

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
  /** A single agent: no ledger, so no claims. */
  single: boolean
  /** "running" until the run's own finish record is seen. */
  status: "running" | "done" | "failed" | "cancelled" | "queued"
  /** One entry per ordered step; steps[i] is order i + 1. */
  steps: Step[]
  /** Round or turn starts, for the stepper. */
  marks: Mark[]
  maxOrder: number
  /** Plain statements about what this graph cannot show for this run. */
  notes: string[]
  /** Counts of the whole run, taken before the size cap. */
  totals: Stats
  /** The grader's score, for a swarm or single-agent run that has one. */
  score?: number
  /** Nodes left out because of the size cap. */
  hidden: number
  /** Stage names, left to right: the picture puts each round and what happened in it in its own lane. */
  lanes?: string[]
  /** A built-in example, not a run: assembled by hand from public records on this date. No model was called. */
  example?: { retrievedOn: string }
}

export const MAX_NODES = 600
/** The flag before the name of a source with a published retraction, correction or expression of concern. */
export const FLAG = "⚑"
