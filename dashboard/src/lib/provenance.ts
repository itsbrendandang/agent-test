// How an existing result was made. This is a fact of the record itself and never of the engine's mode now:
// a practice result seen while the app is in Real mode is still Practice, and a live one stays live in Demo.

/** practice: fixed example answers, no model. live: real models and searches. local: a model on this computer. */
export type ProvenanceKind = "practice" | "live" | "local" | "example"

/** What a record says about itself. Pass only fields of the record: never the engine's current state. */
export interface Made {
  example?: unknown
  /** A research answer's own `mode`. */
  mode?: unknown
  /** A swarm run's own model: "mock" is the scripted model, "ollama/<name>" a model on this computer. */
  model?: unknown
  /** A team review's own run.started flag (`mock`). */
  scripted?: boolean
}

export function provenanceOf(made: Made | undefined): ProvenanceKind | undefined {
  if (!made) return undefined
  if (made.example === true) return "example"
  if (made.mode === "demo" || made.mode === "scripted") return "practice"
  if (made.mode === "real" || made.mode === "ai") return "live"
  if (typeof made.model === "string" && made.model) return made.model === "mock" ? "practice" : /^ollama\/[\w.:-]+$/.test(made.model) ? "local" : "live"
  if (made.scripted === true) return "practice"
  if (made.scripted === false) return "live"
  return undefined // the record does not say (yet): nothing is claimed
}

export const PROVENANCE_WORD: Record<ProvenanceKind, string> = { practice: "Practice", live: "Live research", local: "Local model", example: "Example · practice, $0" }
/** The longer line: the tooltip of the badge, and what a screen reader hears after the word. */
export const PROVENANCE_ABOUT: Record<ProvenanceKind, string> = {
  example: "Built-in, read-only scripted example. No AI model or search was used. Excluded from spending and totals.",
  practice: "Fixed example answers. No AI model or search was used, so this is not research.",
  live: "Made with real AI models and searches.",
  local: "Made with an AI model running on this computer. Free; nothing was sent out.",
}
