// Agent Lab design by Anh Lam. WHO LOOKS LIKE WHAT: the one place that says which face an agent has. Every view
// that shows an agent (the Lab, the team review, the Agents view, the graph's legend) asks here, so the same agent
// has the same face and the same label everywhere.
//
//   agentIdentity("lead-scientist", { title: "Lead Scientist" })  ->  { label: "Lead Scientist", character: "navigator", shape, colour, ... }
//
// Rules:
//  - The NAME is the engine's name (board/agents/*.md, the swarm's roles, a checker's id, a specialist's file name).
//    A caller that has only the label may pass that instead: "Methods Auditor (Quality Checker)" finds the same face.
//  - The LABEL is the engine's own title when the caller has one (the roster, the run.roster event, the catalog).
//    Without one it is the name itself, made readable ("methods-auditor" -> "Methods auditor"). No title is invented.
//  - The twelve characters are the lab's (Agent Lab 2.0's Buddy species). A specialist gets a Buddy species in a
//    colour none of the twelve has.
//  - A name this file does not know gets the plain neutral face and its own name: never another agent's face.
// This file has no React and no CSS, and does not import the lab's scene.
import { CHARACTERS, type CharacterId, type Shape } from "./model"
import { NEUTRAL_COLOUR, SHAPES, SPECIALIST_COLOURS } from "../design/identity"
export { NEUTRAL_COLOUR } from "../design/identity"

/** The five Buddy species, and one plain shape for an agent this app has no character for. */
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
/** Titles that do not spell their agent's name. A caller that knows only the label still gets the right face. */
const BY_TITLE: Record<string, string> = {
  "admet-dmpk-scientist": "admet", attending: "attending-skeptic", "chief-of-service": "chief", "prior-work-and-evidence-synthesist": "literature-evidence-synthesist",
  "bulk-rna-seq-analyst": "bulk-rnaseq-analyst", "statement-checker": "checker", "test-runner": "harness", "relevance-judge": "relevance", "first-check": "first-pass",
}
/** A name or a label as a key: lower case, the bracketed gloss dropped, everything else joined by hyphens. */
export const agentKey = (nameOrLabel: string): string => {
  const slug = String(nameOrLabel ?? "").trim().toLowerCase().replace(/\s*\([^)]*\)\s*$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return BY_TITLE[slug] ?? slug
}

/** "methods-auditor" -> "Methods auditor". The name itself, readable; nothing is added. */
export const readableName = (name: string): string => { const t = name.replace(/[-_]+/g, " ").trim(); return t ? t[0].toUpperCase() + t.slice(1) : name }
const shortOf = (label: string) => label.replace(/\s*\([^)]*\)\s*$/, "").trim() || label

/**
 * The face and the label of one agent. `title`: the engine's own title for it, when the caller has it. `mode`: the
 * mode a member worked in for this reply ("pilot", "revise"), when it has modes.
 */
export function agentIdentity(name: string, options: { title?: string; mode?: string } = {}): AgentIdentity {
  const key = agentKey(name)
  const title = options.title?.trim()
  // A label was passed as the name ("Methods Auditor (Quality Checker)"): it is the label.
  const given = title || (/[A-Z(]/.test(String(name)) ? String(name).trim() : "")
  const made = (label: string, rest: Omit<AgentIdentity, "name" | "label" | "short">): AgentIdentity => ({ name, label, short: shortOf(label), ...rest })
  const role = key.replace(/-\d+$/, "") // a swarm step: "audit 2" is the auditor's second pass
  const id = (options.mode && MODE_OF[key]?.[options.mode.trim().toLowerCase()]) || CHARACTER_OF[key] || CHARACTER_OF[role]
  if (id) {
    const c = CHARACTERS.find((x) => x.id === id)!
    return made(given || readableName(role), { character: id, shape: c.shape, colour: c.color, kind: "agent" })
  }
  if (CHECKERS[key]) { const c = CHARACTERS.find((x) => x.id === "guardian")!; return made(title || CHECKERS[key], { character: "guardian", shape: c.shape, colour: c.color, kind: "checker" }) }
  const at = (SPECIALISTS as readonly string[]).indexOf(key)
  if (at >= 0 && at < SHAPES.length * SPECIALIST_COLOURS.length) return made(given || readableName(key), { shape: SHAPES[at % SHAPES.length], colour: SPECIALIST_COLOURS[Math.floor(at / SHAPES.length)], kind: "specialist" })
  return made(given || readableName(String(name ?? "").trim()) || "Unknown", { shape: "generic", colour: NEUTRAL_COLOUR, kind: "unknown" })
}
/** Two identities show the same face. */
export const sameFace = (a: AgentIdentity, b: AgentIdentity) => a.shape === b.shape && a.colour === b.colour
