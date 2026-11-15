// Agent files: YAML frontmatter (name, title, model tier, tools, deliverable, modes) + a Markdown system prompt.
// The harness builds each agent's instructions from its file, the shared context, its expertise file,
// and the brief, so every member starts on the same page.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { parse } from "yaml"
import { type BoardConfig, path, type Tier } from "./config.ts"
import type { Brief } from "./brief.ts"
import { SEARCH_GUIDANCE } from "./exa.ts"
import { LITERATURE_GUIDANCE } from "./literature.ts"
import { DATABASE_GUIDANCE } from "./sources/index.ts"

export interface AgentDef {
  name: string
  title: string
  role: "lead" | "member"
  model: Tier
  tools: string[]
  deliverable?: string
  /** Roles this one agent can play, as mode id -> role title (e.g. pilot -> "Pilot"). The lead names one per round. */
  modes?: Record<string, string>
  /** Set only for a method specialist added to one run (specialists.ts): why it was chosen and the methods whose notes it reads. Never read from a board agent file. */
  specialist?: { why: string; methods: { name: string; title: string }[] }
  prompt: string
}

/** Mode ids are short words; a title is plain text. Anything else in `modes:` is an error in the agent file. */
function readModes(name: string, value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Agent ${name}: modes must be a map of mode id to role title`)
  const modes = Object.entries(value as Record<string, unknown>)
  if (!modes.length || modes.some(([id, title]) => !/^[a-z][a-z0-9-]{0,30}$/.test(id) || typeof title !== "string" || !title.trim()))
    throw new Error(`Agent ${name}: each mode needs a short lowercase id and a role title`)
  return Object.fromEntries(modes.map(([id, title]) => [id, String(title).trim()]))
}

export function loadAgent(config: BoardConfig, name: string): AgentDef {
  const raw = readFileSync(path(config, "agents", `${name}.md`), "utf8")
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw)
  if (!match) throw new Error(`Agent ${name} has no frontmatter`)
  const front = parse(match[1]) as Partial<AgentDef>
  return {
    name,
    title: front.title ?? name,
    role: front.role === "lead" ? "lead" : "member",
    model: (front.model ?? "cheap") as Tier,
    tools: front.tools ?? [],
    deliverable: front.deliverable,
    ...(front.modes === undefined ? {} : { modes: readModes(name, front.modes) }),
    prompt: match[2].trim(),
  }
}

export const loadRoster = (config: BoardConfig) => config.board.map((n) => loadAgent(config, n))

function sharedContext(config: BoardConfig): string {
  const dir = path(config, "context")
  if (!existsSync(dir)) return ""
  return readdirSync(dir).filter((f) => f.endsWith(".md")).sort()
    .map((f) => `### ${f}\n${readFileSync(`${dir}/${f}`, "utf8").trim()}`).join("\n\n")
}

/** The tools that search, in the order a member uses them. The web search opens every review (the owner's rule). */
export const SEARCH_TOOLS = ["exa_search", "literature_search", "database_search"] as const

/**
 * The order of a member's searches, built from the search tools it holds: the web search first, in every review, then
 * the literature, then the databases, and the web search again only for what those cannot find. Empty for a member
 * with fewer than two search tools (there is no order to give).
 */
export function searchOrder(tools: string[]): string {
  const has = (tool: (typeof SEARCH_TOOLS)[number]) => tools.includes(tool)
  if (SEARCH_TOOLS.filter(has).length < 2) return ""
  const steps = [
    has("exa_search") && "First, in every review: one `exa_search` (a web search) on the main question of the brief.",
    has("literature_search") && "Then `literature_search` for peer-reviewed findings on each key question.",
    has("database_search") && "Then `database_search` for records: trials, bioactivity, drug labels, targets.",
    has("exa_search") && "`exa_search` again only for what the other searches cannot find.",
  ].filter(Boolean)
  return [
    "# The order of your searches",
    ...steps.map((step, i) => `${i + 1}. ${step}`),
    "When a search is refused or fails, say so plainly in your reply. Never put a source from memory in its place: a statement is checked only against sources a search returned in this review.",
  ].join("\n")
}

const CLAIMS_FORMAT = `End every reply with a "CLAIMS" section: one line per factual claim you relied on, as
- [literature] <claim> (source: <URL>)
- [computed] <claim> (source: <what you computed and from which SMILES>)
- [brief] <claim> (source: brief)
Checkers verify these lines. Claims without a line are treated as unsupported.`

export function instructionsFor(config: BoardConfig, agent: AgentDef, brief: Brief, roster: AgentDef[]): string {
  const expertiseFile = path(config, "expertise", `${agent.name}.md`)
  const expertise = existsSync(expertiseFile) ? readFileSync(expertiseFile, "utf8").trim() : ""
  const board = roster.map((m) => `- ${m.title} (${m.name}): ${m.deliverable ?? ""}`).join("\n")
  return [
    agent.prompt,
    agent.role === "member" ? `# Your deliverable\n${agent.deliverable ?? ""}\n\n# Claims\n${CLAIMS_FORMAT}` : `# Your board\n${board}`,
    searchOrder(agent.tools), // before the tools' own guidance: the web search opens every review
    agent.tools.includes("exa_search") && SEARCH_GUIDANCE,
    agent.tools.includes("literature_search") && LITERATURE_GUIDANCE,
    agent.tools.includes("database_search") && DATABASE_GUIDANCE,
    `# Shared context\n${sharedContext(config)}`,
    expertise && `# Your expertise (notes from earlier runs)\n${expertise}`,
    `# The brief\n${brief.markdown}`,
  ].filter(Boolean).join("\n\n")
}
