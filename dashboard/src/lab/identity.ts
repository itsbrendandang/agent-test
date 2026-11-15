// Agent Lab design by Anh Lam. WHO LOOKS LIKE WHAT: the one place that says which face an agent has. Every view
// that shows an agent (the Lab, the team review, the Agents view, the graph's legend) asks here, so the same agent
// has the same face and the same label everywhere.
//
//   agentIdentity("lead-scientist", { title: "Lead Scientist" })  ->  { label: "Lead Scientist", character: "navigator", shape, colour, ... }
//
// Rules:
//  - The NAME is the engine's name (board/agents/*.md, the swarm's roles, a checker's id, a specialist's file name).
//  - The LABEL is the engine's own title when the caller has one (the roster, the run.roster event, the catalog).
//    Without one it is the name itself, made readable ("methods-auditor" -> "Methods auditor"). No title is invented.
//  - The twelve characters are Anh's. A specialist gets one of Anh's shapes in a colour none of the twelve has.
//  - A name this file does not know gets the plain neutral face and its own name: never another agent's face.
// This file has no React and no CSS, and does not import the lab's scene.
import { CHARACTERS, type CharacterId, type Shape } from "./model"

export type FaceShape = Shape | "generic"
export interface AgentIdentity {
  /** The name that was asked about. */
  name: string
  /** What a person reads: the engine's title when given, else the name made readable. */
  label: string
  /** The label without its bracketed gloss: "Scout (Data and Evidence)" -> "Scout". For a tight place. */
  short: string
  /** Which of the lab's twelve characters this is, when it is one of them. */
  character?: CharacterId
  shape: FaceShape
  colour: string
  /** "unknown": a name this file has no face for. */
  kind: "agent" | "checker" | "specialist" | "unknown"
}

/** The engine's names for the agents and roles the twelve characters play. A swarm step's name ("audit 2") counts by its first word. */
const CHARACTER_OF: Record<string, CharacterId> = {
  "lead-scientist": "navigator", lead: "navigator", engine: "navigator",
  scout: "scout",
  proposer: "proposer", propose: "proposer", planner: "proposer",
  pilot: "pilot",
  experimenter: "experimenter", experiment: "experimenter", workup: "experimenter",
  "methods-auditor": "auditor", auditor: "auditor", audit: "auditor",
  critic: "critic", critique: "critic",
  reviser: "reviser", revise: "reviser",
  finisher: "finisher", finish: "finisher",
  reporter: "reporter", report: "reporter",
  librarian: "librarian", navigator: "navigator", guardian: "guardian",
}
/** A member that works in modes: the mode's own character (board/agents/experimenter.md). */
const MODE_OF: Record<string, Record<string, CharacterId>> = { experimenter: { pilot: "pilot", full: "experimenter", workup: "experimenter", revise: "reviser" } }
/** Who checks a statement. The engine gives these no title; the labels are the app's own words for the two stages. */
const CHECKERS: Record<string, string> = {
  "first-pass": "First check", jev: "First check",
  openai: "Second, more careful check", anthropic: "Second, more careful check", "claude-code": "Second, more careful check",
  checker: "Statement checker", "statement-checker": "Statement checker", harness: "Test runner", relevance: "Relevance judge",
}

/**
 * The specialists the catalog can add to a review (glhf/specialists and its skills folder), in a fixed order: the
 * order decides the face, so a name keeps its face when the list grows at the end. Add a new specialist at the END.
 */
export const SPECIALISTS = [
  "admet", "attending-skeptic", "bulk-rnaseq-analyst", "chief", "clinical-and-experimental-design-analyst", "compound-set-curator", "contrarian",
  "epigenomics-regulator-analyst", "immune-cell-therapy-analyst", "literature-evidence-synthesist", "medicinal-chemist", "methods-librarian",
  "omics-biomarker-integrator", "perturbation-and-crispr-specialist", "protein-and-antibody-engineer", "qsar-property-modeler", "sar-analyst",
  "single-cell-core-analyst", "single-cell-multimodal-spatial-analyst", "small-molecule-designer", "statistical-geneticist", "target-biologist",
  "target-prioritiser", "target-safety-druggability-analyst", "toxicologist", "variant-and-genome-analyst", "workflow-and-method-engineer",
] as const
const SHAPES: Shape[] = ["mushroom", "owl", "tree", "acorn", "bunny", "fuzzy", "mountain", "flame"]
/** Colours none of the twelve characters has: teal, olive, slate, rose. Eight shapes in four colours: 32 faces. */
const SPECIALIST_COLOURS = ["#6fc3b8", "#b9c46a", "#93a4bd", "#d98bb5"]
export const NEUTRAL_COLOUR = "#cfcabd"

/** "methods-auditor" -> "Methods auditor". The name itself, readable; nothing is added. */
export const readableName = (name: string): string => { const t = name.replace(/[-_]+/g, " ").trim(); return t ? t[0].toUpperCase() + t.slice(1) : name }
const shortOf = (label: string) => label.replace(/\s*\([^)]*\)\s*$/, "").trim() || label

/**
 * The face and the label of one agent. `title`: the engine's own title for it, when the caller has it. `mode`: the
 * mode a member worked in for this reply ("pilot", "revise"), when it has modes.
 */
export function agentIdentity(name: string, options: { title?: string; mode?: string } = {}): AgentIdentity {
  const key = String(name ?? "").trim().toLowerCase()
  const title = options.title?.trim()
  const made = (label: string, rest: Omit<AgentIdentity, "name" | "label" | "short">): AgentIdentity => ({ name, label, short: shortOf(label), ...rest })
  const id = (options.mode && MODE_OF[key]?.[options.mode.trim().toLowerCase()]) || CHARACTER_OF[key] || CHARACTER_OF[key.split(/\s+/)[0]]
  if (id) {
    const c = CHARACTERS.find((x) => x.id === id)!
    return made(title || readableName(key.split(/\s+/)[0] === key ? name : key.split(/\s+/)[0]), { character: id, shape: c.shape, colour: c.color, kind: "agent" })
  }
  if (CHECKERS[key]) { const c = CHARACTERS.find((x) => x.id === "guardian")!; return made(title || CHECKERS[key], { character: "guardian", shape: c.shape, colour: c.color, kind: "checker" }) }
  const at = (SPECIALISTS as readonly string[]).indexOf(key)
  if (at >= 0 && at < SHAPES.length * SPECIALIST_COLOURS.length) return made(title || readableName(name), { shape: SHAPES[at % SHAPES.length], colour: SPECIALIST_COLOURS[Math.floor(at / SHAPES.length)], kind: "specialist" })
  return made(title || readableName(name) || "Unknown", { shape: "generic", colour: NEUTRAL_COLOUR, kind: "unknown" })
}
/** Two identities show the same face. */
export const sameFace = (a: AgentIdentity, b: AgentIdentity) => a.shape === b.shape && a.colour === b.colour
