// GET /api/chat/catalog: what a chat plan can be built from. Providers and whether their key is set (never the
// key), the board's agents (board/agents, what a board run uses today), the draft specialist profiles
// (glhf/specialists, listed only: no code runs them), and the skills under .agents/skills.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parse } from "yaml"
import { loadAgent, loadRoster } from "../agents.ts"
import { type BoardConfig, ROOT } from "../config.ts"
import { MODEL_CHOICES } from "../glhf/types.ts"
import { paidCallsOff } from "../paid.ts"

export type ProviderId = "anthropic" | "openai" | "openrouter"
export interface Provider { id: ProviderId; keyPresent: boolean; models: string[] }
export interface CatalogAgent { name: string; title: string; source: "board" | "specialist"; role: string; tools: string[]; trigger?: string; deliverable?: string }
export interface CatalogSkill { name: string; description: string; installed: boolean }
export interface Catalog {
  paidCalls: boolean
  providers: Provider[]
  search: { exa: { keyPresent: boolean } }
  agents: CatalogAgent[]
  skills: CatalogSkill[]
}

export const PROVIDER_KEY: Record<ProviderId, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", openrouter: "OPENROUTER_API_KEY" }
export const SPECIALISTS_DIR = resolve(ROOT, "glhf/specialists")
export const SKILLS_DIR = resolve(ROOT, ".agents/skills")

/** Skills whose SKILL.md is a catalog of packages that are not on disk. They are listed, never chosen for a plan. */
const INDEX_ONLY = new Set(["biomni-lab"])

const flat = (text: unknown, max: number) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max)
const unique = <T>(items: T[]) => [...new Set(items)]

function frontmatter(file: string): { front: Record<string, unknown>; body: string } | undefined {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(readFileSync(file, "utf8"))
  if (!match) return undefined
  try {
    const front: unknown = parse(match[1])
    return front && typeof front === "object" && !Array.isArray(front) ? { front: front as Record<string, unknown>, body: match[2] } : undefined
  } catch { return undefined }
}
const section = (body: string, heading: string) => new RegExp(`^# ${heading}\\n([\\s\\S]*?)(?=^# |$(?![\\s\\S]))`, "m").exec(body)?.[1].trim() ?? ""
const tools = (value: unknown) => (Array.isArray(value) ? value.map((t) => flat(t, 60)).filter(Boolean) : [])

/** The model ids a chat call may use, per provider. They come from the engine's own lists and config, never from the client. */
export function providers(config: BoardConfig, env: NodeJS.ProcessEnv = process.env): Provider[] {
  const choices = (prefix: string) => MODEL_CHOICES.filter((m) => m.id.startsWith(`${prefix}/`)).map((m) => m.id.slice(prefix.length + 1))
  const models: Record<ProviderId, string[]> = {
    anthropic: unique([env.ASK_MODEL || "claude-haiku-5-5", ...choices("anthropic")]),
    openai: unique([config.checkers.openai_model, ...choices("openai")]),
    openrouter: unique([config.models.strong, config.models.lead, config.models.cheap, config.models.rival]),
  }
  return (Object.keys(models) as ProviderId[]).map((id) => ({ id, keyPresent: Boolean(env[PROVIDER_KEY[id]]), models: models[id] }))
}

/** A specialist profile, with the board portfolio it was taken from and its words for matching. */
export interface Specialist extends CatalogAgent { basedOn?: string; purpose: string }

export function loadSpecialists(dir = SPECIALISTS_DIR): Specialist[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md").sort().flatMap((f) => {
    const parsed = frontmatter(`${dir}/${f}`)
    if (!parsed) return []
    const { front, body } = parsed
    const name = f.replace(/\.md$/, "")
    return [{
      name, title: flat(front.title ?? name, 120), source: "specialist" as const, role: flat(front.er_role ?? "specialist", 120), tools: tools(front.tools),
      ...(front.trigger ? { trigger: flat(front.trigger, 400) } : {}), ...(front.deliverable ? { deliverable: flat(front.deliverable, 400) } : {}),
      basedOn: /board\/agents\/([\w-]+)\.md/.exec(String(front.based_on ?? ""))?.[1], purpose: flat(section(body, "Purpose"), 800),
    }]
  })
}

export function loadSkills(dir = SKILLS_DIR): CatalogSkill[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).sort().flatMap((name) => {
    const file = `${dir}/${name}/SKILL.md`
    const parsed = existsSync(file) ? frontmatter(file) : undefined
    if (!parsed) return []
    const description = flat(parsed.front.description, 600)
    return [{ name, description, installed: !INDEX_ONLY.has(name) && !/\bnot installed\b/i.test(description) }]
  })
}

/** A board member with the words a question is matched against: its own file plus the specialist profile taken from it. */
export interface Member { name: string; title: string; tools: string[]; tier: string; deliverable?: string; words: string }

/** Lead first, then the members in board/config.yaml order (a benched member is not listed). */
export function boardMembers(config: BoardConfig, specialists = loadSpecialists()): { lead: Member; members: Member[] } {
  const member = (a: ReturnType<typeof loadAgent>): Member => {
    const s = specialists.find((p) => p.basedOn === a.name)
    return { name: a.name, title: a.title, tools: a.tools, tier: a.model, deliverable: a.deliverable,
      words: [a.title, a.deliverable ?? "", section(a.prompt, "Purpose"), s?.trigger ?? "", s?.purpose ?? ""].join(" ") }
  }
  return { lead: member(loadAgent(config, "lead-scientist")), members: loadRoster(config).map(member) }
}

export function buildCatalog(config: BoardConfig, env: NodeJS.ProcessEnv = process.env): Catalog {
  const specialists = loadSpecialists()
  const { lead, members } = boardMembers(config, specialists)
  const board: CatalogAgent[] = [lead, ...members].map((m, i) => ({ name: m.name, title: m.title, source: "board", role: i === 0 ? "lead" : "member", tools: m.tools, ...(m.deliverable ? { deliverable: m.deliverable } : {}) }))
  return {
    paidCalls: !paidCallsOff(env),
    providers: providers(config, env),
    search: { exa: { keyPresent: Boolean(env.EXA_API_KEY) } },
    agents: [...board, ...specialists.map(({ basedOn: _b, purpose: _p, ...agent }) => agent)],
    skills: loadSkills(),
  }
}
