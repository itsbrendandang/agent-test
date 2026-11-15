// GET /api/chat/catalog: what a chat plan can be built from. Providers and whether their key is set (never the
// key), the board's agents (board/agents), the specialists (glhf/specialists: a plan can add those marked
// `takesPart` to a board run, with the notes of their methods; see ../specialists.ts), and the skills under
// .agents/skills. The method library is named by its neutral title only: where its text was taken from is not
// part of any response.
import { existsSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { loadAgent, loadRoster } from "../agents.ts"
import { clean, frontmatter, LIBRARY_ID, LIBRARY_TITLE, loadSpecialists as loadAllSpecialists, namesOrigin, section, type Specialist as LoadedSpecialist, SPECIALISTS_DIR } from "../specialists.ts"
import { type BoardConfig, mockMode, ROOT } from "../config.ts"
import { exaAssumed, exaCeiling, exaLedgerFile, exaTotal } from "../exaledger.ts"
import { MODEL_CHOICES } from "../glhf/types.ts"
import { paidCallsOff, paidState } from "../paid.ts"

export type ProviderId = "anthropic" | "openai"
export interface Provider { id: ProviderId; keyPresent: boolean; models: string[] }
export interface CatalogAgent {
  name: string; title: string; source: "board" | "specialist"; role: string; tools: string[]; trigger?: string; deliverable?: string
  /** Specialists only. `takesPart`: a plan can add it to a board run. `whyNot`: the reason when it cannot. */
  takesPart?: boolean; whyNot?: string
  /** Specialists only: the methods whose notes it can read on a board run (text only; nothing is installed or run), and how many. Skills that are a name only are not listed. */
  methods?: { name: string; title: string }[]; fullTextMethods?: number
}
export interface CatalogSkill { name: string; title: string; description: string; installed: boolean }
/** The method library in numbers: how many specialists can take part, how many methods have notes, how many are a name only. */
export interface MethodLibrary { id: string; title: string; specialists: number; methods: number; nameOnly: number }
export interface Catalog {
  paidCalls: boolean
  /** Where paidCalls comes from: "env" (NO_PAID_CALLS) or "switch" (POST /api/paid, this process only). */
  paidSource: "env" | "switch"
  providers: Provider[]
  /** exa.usedUsd: Exa spend this engine has recorded in board/runs/.exa-ledger.jsonl; ceilingUsd: the lifetime limit it enforces (meeting.exa_ceiling_usd). */
  /** `provider`: what a board run started now would search with: "exa" (live search; paid calls on, and the key is set) or "fixture" (a practice run's example sources). */
  search: { provider: "exa" | "fixture"; exa: { keyPresent: boolean; usedUsd: number; ceilingUsd: number }; literature: { provider: "europepmc"; free: true; keyNeeded: false; available: boolean } }
  agents: CatalogAgent[]
  skills: CatalogSkill[]
  methodLibrary: MethodLibrary
}

export const PROVIDER_KEY: Record<ProviderId, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" }
export { SPECIALISTS_DIR }
export const SKILLS_DIR = resolve(ROOT, ".agents/skills")

const flat = (text: unknown, max: number) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max)
const unique = <T>(items: T[]) => [...new Set(items)]

/** The model ids a chat call may use, per provider. They come from the engine's own lists and config, never from the client. */
export function providers(config: BoardConfig, env: NodeJS.ProcessEnv = process.env): Provider[] {
  const choices = (prefix: string) => MODEL_CHOICES.filter((m) => m.id.startsWith(`${prefix}/`)).map((m) => m.id.slice(prefix.length + 1))
  const models: Record<ProviderId, string[]> = {
    anthropic: unique([env.ASK_MODEL || "claude-haiku-5-5", ...choices("anthropic")]),
    openai: unique([config.checkers.openai_model, ...choices("openai")]),
  }
  return (Object.keys(models) as ProviderId[]).map((id) => ({ id, keyPresent: Boolean(env[PROVIDER_KEY[id]]), models: models[id] }))
}

/** A specialist as the catalog lists it, with the board portfolio a profile was taken from and its words for matching. */
export interface Specialist extends CatalogAgent { basedOn?: string; purpose: string }

/** Every specialist, as catalog entries. On the board a specialist has no tools, so `tools` is empty. */
export function loadSpecialists(dir = SPECIALISTS_DIR, loaded: LoadedSpecialist[] = loadAllSpecialists(dir)): Specialist[] {
  return loaded.map((s) => ({
    name: s.name, title: s.title, source: "specialist" as const, role: "specialist", tools: [],
    trigger: s.trigger || s.does, deliverable: s.deliverable,
    takesPart: s.takesPart, ...(s.whyNot ? { whyNot: s.whyNot } : {}),
    methods: s.methods.map((m) => ({ name: m.name, title: m.title })), fullTextMethods: s.methods.length,
    basedOn: s.basedOn, purpose: s.role[0] ?? "",
  }))
}

export function methodLibrary(loaded: LoadedSpecialist[] = loadAllSpecialists()): MethodLibrary {
  return { id: LIBRARY_ID, title: LIBRARY_TITLE, specialists: loaded.filter((s) => s.takesPart && s.methods.length).length, methods: loaded.reduce((n, s) => n + s.methods.length, 0), nameOnly: loaded.reduce((n, s) => n + s.nameOnly, 0) }
}

/**
 * The skills under .agents/skills. The folder that holds the index of the method library is listed under the
 * library's neutral id and title with a description written here; it is never `installed` (its packages are not on
 * disk), so no plan chooses it as a skill. Its methods reach a run through the specialists instead.
 */
export function loadSkills(dir = SKILLS_DIR, library: MethodLibrary = methodLibrary()): CatalogSkill[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).sort().flatMap((name): CatalogSkill[] => {
    const file = `${dir}/${name}/SKILL.md`
    const parsed = existsSync(file) ? frontmatter(file) : undefined
    if (!parsed) return []
    const raw = flat(parsed.front.description, 600)
    if (namesOrigin(name) || namesOrigin(raw)) return [{ name: LIBRARY_ID, title: LIBRARY_TITLE, installed: false,
      description: `An index of method skills for computational biology and drug discovery. ${library.methods} methods have notes that a specialist can read on a board review (${library.specialists} specialists hold them); ${library.nameOnly} are a name only. The notes are text: no package is installed and nothing is run.` }]
    return [{ name, title: name, description: clean(raw, 600) || raw, installed: !/\bnot installed\b/i.test(raw) }]
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
  const loaded = loadAllSpecialists(), specialists = loadSpecialists(SPECIALISTS_DIR, loaded), library = methodLibrary(loaded)
  const { lead, members } = boardMembers(config, specialists)
  const board: CatalogAgent[] = [lead, ...members].map((m, i) => ({ name: m.name, title: m.title, source: "board", role: i === 0 ? "lead" : "member", tools: m.tools, ...(m.deliverable ? { deliverable: m.deliverable } : {}) }))
  return {
    paidCalls: !paidCallsOff(env),
    paidSource: paidState(env).source,
    providers: providers(config, env),
    search: { provider: mockMode(env) || !env.EXA_API_KEY ? "fixture" : "exa", exa: { keyPresent: Boolean(env.EXA_API_KEY), usedUsd: Math.round(exaTotal(exaLedgerFile(config), exaAssumed(config)) * 1e6) / 1e6, ceilingUsd: exaCeiling(config) },
      // Europe PMC literature search (PubMed abstracts and preprints): free, no key. `available` is true when a board member has the tool.
      literature: { provider: "europepmc", free: true, keyNeeded: false, available: members.some((m) => m.tools.includes("literature_search")) } },
    agents: [...board, ...specialists.map(({ basedOn: _b, purpose: _p, ...agent }) => agent)],
    skills: loadSkills(SKILLS_DIR, library),
    methodLibrary: library,
  }
}
