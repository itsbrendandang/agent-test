// Agent files: YAML frontmatter (name, title, model tier, tools, deliverable) + a Markdown system prompt.
// The harness builds each agent's instructions from its file, the shared context, its expertise file,
// and the brief, so every member starts on the same page.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { parse } from "yaml"
import { type BoardConfig, path, type Tier } from "./config.ts"
import type { Brief } from "./brief.ts"
import { SEARCH_GUIDANCE } from "./exa.ts"
import { LITERATURE_GUIDANCE } from "./literature.ts"

export interface AgentDef {
  name: string
  title: string
  role: "lead" | "member"
  model: Tier
  tools: string[]
  deliverable?: string
  prompt: string
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
    agent.tools.includes("exa_search") && SEARCH_GUIDANCE,
    agent.tools.includes("literature_search") && LITERATURE_GUIDANCE,
    `# Shared context\n${sharedContext(config)}`,
    expertise && `# Your expertise (notes from earlier runs)\n${expertise}`,
    `# The brief\n${brief.markdown}`,
  ].filter(Boolean).join("\n\n")
}
