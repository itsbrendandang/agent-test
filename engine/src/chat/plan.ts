// A Plan is a proposal for one drug board run, built from a chat question. Building a plan starts nothing: it is
// stored under board/runs/.plans/<id>.json and only POST /api/chat/plans/:id/start, with {confirm: true}, runs it.
//
// Everything a plan says about agents, skills, limits, models, search and cost is computed here from the catalog
// and board/config.yaml. A model may suggest brief text, agents and skills; its output is data and is checked
// (planFrom below): unknown names are dropped, text is cut, and it cannot set limits, `paid` or `search`.
import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import * as board from "../board/board.ts"
import { BriefRejected, loadBrief } from "../brief.ts"
import { type BoardConfig, path } from "../config.ts"
import { HttpError, isSafeId } from "../http.ts"
import { clean, loadSpecialists, matchSpecialists, MAX_METHODS, methodsFor, namesOrigin, type Specialist, SPECIALIST_TIER } from "../specialists.ts"
import { boardMembers, type CatalogSkill, loadSkills, type Member } from "./catalog.ts"

export type EffortId = "quick" | "standard" | "deep"
export interface Limits { maxUsd: number; maxMinutes: number; maxRounds: number }
export interface Effort { id: EffortId; label: string; description: string; limits: Limits; agents: number | "all"; modelTier: string; search: { exa: boolean; maxSearches: number } }
/**
 * One agent of a plan. `source` is "specialist" for a method specialist the plan adds to this one run (absent or
 * "board": a board member). A specialist carries the `methods` whose notes it will read; it has no tools.
 */
export interface PlanAgent { name: string; title: string; why: string; source?: "board" | "specialist"; methods?: { name: string; title: string }[] }
export interface Plan {
  id: string
  question: string
  kind: "board"
  effort: EffortId
  briefTitle: string
  brief: string
  agents: PlanAgent[]
  skills: { name: string; why: string }[]
  search: { exa: boolean }
  models: { lead: string; members: string; checker: string }
  limits: Limits
  estimate: { usd: number | null; basis: string }
  paid: boolean
  warnings: string[]
}
/** What is kept on disk: the plan, every agent that matched in rank order (so another effort level can be derived), and the run once started. */
export interface PlanRecord { plan: Plan; ranked: PlanAgent[]; createdAt: number; runId?: string; startedAt?: number }

export const DEFAULT_EFFORT: EffortId = "standard"
export const PLAN_TTL_MS = 24 * 3600_000
export const MAX_BRIEF = 20_000
const MAX_PLANS = 500

/** True once board.ts applies board/runs/<run>/overrides.json (it would export RUN_OVERRIDES = true). Today it does not. */
export const overridesApplied = (): boolean => (board as Record<string, unknown>).RUN_OVERRIDES === true

const round2 = (n: number) => Math.round(n * 100) / 100
const flat = (text: unknown, max: number) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max)

/**
 * The three effort levels. The one place they are defined: every number is a share of the caps in board/config.yaml
 * (meeting.max_usd, max_minutes, max_rounds), and no level is above a cap or above the daily cap.
 */
export function efforts(config: BoardConfig): Effort[] {
  const m = config.meeting, usd = Math.min(m.max_usd, m.daily_usd)
  return [
    { id: "quick", label: "Quick", description: "The lead, the member that searches, a member that makes checkable claims and the best-matched others (a method specialist when one fits); one round, the cheap model tier, a few searches.",
      limits: { maxUsd: round2(usd * 0.2), maxMinutes: Math.max(1, Math.round(m.max_minutes / 3)), maxRounds: 1 }, agents: 3, modelTier: "cheap", search: { exa: true, maxSearches: 4 } },
    { id: "standard", label: "Standard", description: "The lead, the Critic and the members and method specialists that match the question, each on its own model tier, about half the rounds the config allows.",
      limits: { maxUsd: round2(usd * 0.6), maxMinutes: Math.max(1, Math.ceil(m.max_minutes * 2 / 3)), maxRounds: Math.max(1, Math.ceil(m.max_rounds / 2)) }, agents: "all", modelTier: "per agent", search: { exa: true, maxSearches: 12 } },
    { id: "deep", label: "Deep", description: "The members and method specialists that match plus the Critic on the other vendor's model, the strong tier, and the full caps in board/config.yaml.",
      limits: { maxUsd: round2(usd), maxMinutes: m.max_minutes, maxRounds: m.max_rounds }, agents: "all", modelTier: "strong", search: { exa: true, maxSearches: 30 } },
  ]
}
export const isEffort = (value: unknown): value is EffortId => value === "quick" || value === "standard" || value === "deep"
export const effortOf = (config: BoardConfig, id: EffortId): Effort => efforts(config).find((e) => e.id === id)!

// ── Choosing agents ──────────────────────────────────────────────────────────────────────────────
const STOP = new Set("about above after again against also among because been before being below between both could does doing down during each from further have having here into itself just more most only other over same should some such than that their them then there these they this those through under until very were what when where which while with would your will candidate candidates question board decision evidence".split(" "))
const stems = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w)).map((w) => w.slice(0, 5)))

/**
 * Members whose profile shares words with the question, best first. A word that most members share says nothing
 * and is not counted. With fewer than two matches the Proposer and the Critic fill in, and say why.
 */
export function rankAgents(question: string, members: Member[]): PlanAgent[] {
  const asked = [...new Set(question.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w)))]
  const vocab = members.map((m) => stems(m.words))
  const hits = members.map((m, i) => ({ m, i, words: asked.filter((w) => vocab[i].has(w.slice(0, 5)) && vocab.filter((v) => v.has(w.slice(0, 5))).length <= members.length / 2) }))
  const ranked: PlanAgent[] = hits.filter((h) => h.words.length).sort((a, b) => b.words.length - a.words.length || a.i - b.i)
    .map((h) => ({ name: h.m.name, title: h.m.title, why: `Its profile shares words with the question: ${h.words.slice(0, 5).join(", ")}.` }))
  for (const [name, why] of [["proposer", "Added by default: turns the question into ranked claims to test."], ["critic", "Added by default: tries to disprove the claims the board makes."]] as const) {
    const m = members.find((x) => x.name === name)
    if (ranked.length < 2 && m && !ranked.some((r) => r.name === name)) ranked.push({ name, title: m.title, why })
  }
  return ranked
}

/** The specialists that may be put on the board, best match first, as plan agents with the methods they would read. */
export function rankSpecialists(question: string, specialists: Specialist[] = loadSpecialists()): PlanAgent[] {
  return matchSpecialists(question, specialists).map((m) => ({
    name: m.specialist.name, title: m.specialist.title, source: "specialist" as const, methods: m.methods.map((x) => ({ name: x.name, title: x.title })),
    why: `${m.methods.length ? `Its method notes (${m.methods.map((x) => x.title).join("; ")})` : "Its profile"} share${m.methods.length ? "" : "s"} words with the question: ${m.words.slice(0, 5).join(", ")}. It has no tools: it says which analysis would settle the question and what the data can support.`,
  }))
}

/** How many members (the lead not counted) a plan of this effort level may have: the level's own number, and never more than the board's roster. Specialists count against it. */
export const memberLimit = (effort: Effort, members: Member[]): number => (effort.agents === "all" ? members.length : Math.min(effort.agents, members.length))

/** A stored or suggested specialist entry, checked against the specialists as they are now: unknown ones and ones that may not take part are dropped, and only methods it really owns are kept. */
function checkedSpecialist(a: PlanAgent, specialists: Specialist[], members: Member[]): PlanAgent | undefined {
  const s = specialists.find((x) => x.name === a.name && x.takesPart)
  if (!s || members.some((m) => m.name === a.name)) return undefined
  const methods = (Array.isArray(a.methods) ? a.methods : []).flatMap((x) => s.methods.filter((m) => m.name === x?.name)).filter((m, i, all) => all.indexOf(m) === i).slice(0, MAX_METHODS).map((m) => ({ name: m.name, title: m.title }))
  if (s.kind === "methods" && !s.role.length && !methods.length) return undefined // a name-only skill, or none at all, never puts a method agent on the board
  const why = clean(a.why, 300)
  return { name: s.name, title: s.title, why: why || "Its notes fit the question.", source: "specialist", methods }
}

/**
 * The agents for an effort level: the lead, then the members.
 * - Always: the member that gathers evidence (the one with the search tool) and a member that makes checkable statements
 *   (one whose deliverable is claims to test, else the first other member). Without them a run has nothing to check a
 *   claim against, or nothing to check. At standard and deep also the Critic.
 * - The other places, up to memberLimit, go to the ranked board members and the ranked specialists. Specialists get at
 *   most half of those places (rounded up), so the board's own roles are not all pushed out.
 * Nothing here raises a limit: a specialist takes a place, it does not add one. It only picks names that are on the board
 * or are specialists that may take part.
 */
export function agentsFor(effort: Effort, ranked: PlanAgent[], lead: Member, members: Member[], specialists: Specialist[] = loadSpecialists()): PlanAgent[] {
  const board = ranked.filter((a) => a.source !== "specialist" && members.some((m) => m.name === a.name))
  const invited = ranked.filter((a) => a.source === "specialist").map((a) => checkedSpecialist(a, specialists, members)).filter((a): a is PlanAgent => Boolean(a))
    .filter((a, i, all) => all.findIndex((x) => x.name === a.name) === i)
  const gatherer = members.find((m) => m.tools.includes("exa_search"))
  const claimMaker = members.find((m) => m !== gatherer && /claim/i.test(m.deliverable ?? "")) ?? members.find((m) => m !== gatherer)
  const critic = effort.id === "quick" ? undefined : members.find((m) => m.name === "critic")
  const required: PlanAgent[] = []
  const need = (m: Member | undefined, why: string) => { if (m && !required.some((r) => r.name === m.name)) required.push(board.find((a) => a.name === m.name) ?? { name: m.name, title: m.title, why }) }
  need(gatherer, "Added at every effort level: the only member that can search, so the others have sources to cite.")
  need(claimMaker, "Added at every effort level: makes statements that can be checked, and proven wrong, against the evidence.")
  need(critic, "Added at standard and deep effort: tries to disprove the claims the board makes, on the other vendor's model.")
  const free = Math.max(0, memberLimit(effort, members) - required.length)
  const guests = invited.slice(0, Math.ceil(free / 2))
  const rest = board.filter((a) => !required.some((r) => r.name === a.name)).slice(0, free - guests.length)
  const chosen = [...required, ...rest].map((a) => ({ ...a, source: "board" as const }))
  // Board members in the roster's speaking order would hide the ranking; they stay in rank order, and the specialists come last, as they speak last in the run.
  return [{ name: lead.name, title: lead.title, why: "Leads every board run and writes the memo.", source: "board" }, ...chosen, ...guests]
}

/** The method notes a plan's specialists read, as plan skills (the same shape as an installed skill). */
export function methodSkills(agents: PlanAgent[]): Plan["skills"] {
  const out: Plan["skills"] = []
  for (const a of agents) for (const m of a.source === "specialist" ? a.methods ?? [] : []) {
    if (!out.some((s) => s.name === m.name)) out.push({ name: m.name, why: `Method notes read by the ${a.title} (text only: no package is installed and nothing is run).` })
  }
  return out
}

// ── The brief ────────────────────────────────────────────────────────────────────────────────────
/** One line of brief text: no line breaks, and no "<word>" that the brief check reads as an unfilled placeholder. */
export const briefLine = (text: unknown, max: number) => flat(text, max).replace(/<(?=[A-Za-z])/g, "< ")
/** Section text from a model or a person: no heading lines (they would open a new section), no placeholders. */
const sectionText = (text: unknown, max: number) => String(text ?? "").replace(/\r/g, "").split("\n").map((l) => l.replace(/^\s*#+\s*/, "")).join("\n").replace(/<(?=[A-Za-z])/g, "< ").trim().slice(0, max)

const UNSTATED: Record<string, (q: string, l: Limits) => string> = {
  "Question": (q) => q,
  "Candidates": () => "None named in the chat. If the question is about specific compounds, add a table of ID, SMILES and notes before starting.",
  "Target and Indication": () => "Not stated beyond the question above. The board should name the target and the indication it assumes, and say that it assumed them.",
  "Available Data": () => "None supplied. No assay, ADMET or in vivo data came with this question; the board has only what its members find by search.",
  "Stakes": () => "Not stated. Nobody said what a wrong answer in either direction would cost.",
  "Constraints": (_q, l) => `Run limits: at most ${l.maxRounds} round(s), ${l.maxMinutes} minutes and $${l.maxUsd}. No other constraint was stated.`,
  "Key Questions": (q) => `1. ${q}\n2. What is the strongest evidence against the answer the board prefers?`,
  "Decision Criteria": () => "Not stated. The board should state the criteria it used and mark its memo as exploratory.",
}
const fallbackText = (section: string, q: string, l: Limits) => (UNSTATED[section] ?? (() => "Not stated in the chat."))(q, l)

/** The brief as Markdown: each required section from `given` when usable, else the "not stated" text. Returns the sections that fell back. */
export function writeBrief(config: BoardConfig, title: string, question: string, limits: Limits, given: Record<string, unknown> = {}): { markdown: string; unstated: string[] } {
  const q = briefLine(question, 2_000), unstated: string[] = []
  const parts = config.brief.required_sections.map((name) => {
    let text = typeof given[name] === "string" ? sectionText(given[name], 3_000) : ""
    if (name === "Question" && !text) text = q
    if (!text) { text = fallbackText(name, q, limits); if (name !== "Constraints" && name !== "Key Questions") unstated.push(name) }
    return `## ${name}\n${text}\n`
  })
  return { markdown: `# Brief: ${briefLine(title, 80) || "Chat question"}\n\n${parts.join("\n")}`, unstated }
}

// ── Storage ──────────────────────────────────────────────────────────────────────────────────────
export const plansDir = (config: BoardConfig) => path(config, "runs", ".plans")
const planFile = (config: BoardConfig, id: string) => `${plansDir(config)}/${id}.json`
/** The brief of a plan as a file: startRun reads a brief from a file, and the run reads it again on resume. */
export const briefFile = (config: BoardConfig, plan: Pick<Plan, "id" | "briefTitle">) =>
  `${plansDir(config)}/chat-${(plan.briefTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "question")}-${plan.id.slice(0, 8)}.md`

/** Throws BriefRejected unless `markdown` passes the same check a board run applies to its brief. */
export function checkBrief(config: BoardConfig, plan: Pick<Plan, "id" | "briefTitle">, markdown: string): string {
  mkdirSync(plansDir(config), { recursive: true })
  const file = briefFile(config, plan)
  writeFileSync(file, markdown)
  loadBrief(file, config.brief.required_sections)
  return file
}

export function savePlan(config: BoardConfig, record: PlanRecord): void {
  mkdirSync(plansDir(config), { recursive: true })
  writeFileSync(planFile(config, record.plan.id), JSON.stringify(record, null, 2))
}

/** The stored plan, or undefined when there is none or it expired unstarted. */
export function loadPlan(config: BoardConfig, id: string, now = Date.now()): PlanRecord | undefined {
  if (!isSafeId(id) || !existsSync(planFile(config, id))) return undefined
  try {
    const record = JSON.parse(readFileSync(planFile(config, id), "utf8")) as PlanRecord
    return record.runId || record.createdAt + PLAN_TTL_MS > now ? record : undefined
  } catch { return undefined }
}

/** Remove unstarted plans past their time, and the oldest unstarted ones beyond MAX_PLANS. Started plans stay: the run reads their brief. */
export function sweepPlans(config: BoardConfig, now = Date.now()): void {
  const dir = plansDir(config)
  if (!existsSync(dir)) return
  const open: { id: string; record: PlanRecord }[] = []
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    try { const record = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as PlanRecord; if (!record.runId && !existsSync(`${dir}/${f.replace(/\.json$/, ".start")}`)) open.push({ id: f.replace(/\.json$/, ""), record }) } catch { /* unreadable: left alone */ }
  }
  open.sort((a, b) => a.record.createdAt - b.record.createdAt)
  open.forEach(({ id, record }, i) => {
    if (record.createdAt + PLAN_TTL_MS > now && open.length - i <= MAX_PLANS) return
    rmSync(`${dir}/${id}.json`, { force: true }); rmSync(briefFile(config, record.plan), { force: true })
  })
}

/**
 * Take the plan's start claim: a file created with the exclusive flag, so of two starts of one plan, in this
 * process or another, exactly one gets it. Returns the function that gives it back when the start fails.
 */
export function claimStart(config: BoardConfig, id: string): (() => void) | undefined {
  const file = `${plansDir(config)}/${id}.start`
  try { writeFileSync(file, String(Date.now()), { flag: "wx" }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return undefined
    throw error
  }
  return () => rmSync(file, { force: true })
}

// ── Building a plan ──────────────────────────────────────────────────────────────────────────────
export interface PlanContext { config: BoardConfig; mock: boolean; env: NodeJS.ProcessEnv }
/** What a model suggested. Every field is optional and untrusted. */
export interface Suggestion { briefTitle?: unknown; sections?: unknown; agents?: unknown; skills?: unknown }

/** The parts of a plan that follow from the effort level, the agents and the engine's state. Never from a client or a model. */
export function derive(ctx: PlanContext, effort: Effort, agents: PlanAgent[], members: Member[]): Pick<Plan, "search" | "models" | "limits" | "estimate" | "paid"> & { warnings: string[] } {
  const { config, mock, env } = ctx
  const chosen = members.filter((m) => agents.some((a) => a.name === m.name && a.source !== "specialist"))
  const guests = agents.filter((a) => a.source === "specialist")
  const searchers = chosen.filter((m) => m.tools.includes("exa_search"))
  const cap = config.meeting.max_usd
  const warnings: string[] = []
  // A specialist runs on the tier fixed in specialists.ts, whatever the level says.
  const guestTier = guests.length ? [config.models[SPECIALIST_TIER]] : []
  const tiers = (effort.modelTier === "per agent" ? [...chosen.map((m) => config.models[m.tier as keyof BoardConfig["models"]]), ...guestTier]
    : [...chosen.map((m) => (effort.id === "deep" && m.name === "critic" ? config.models.rival : config.models[effort.modelTier as keyof BoardConfig["models"]])), ...guestTier]).filter((v, i, all) => Boolean(v) && all.indexOf(v) === i)
  if (mock) warnings.push("Practice run: the board's replies are fixed example text written in advance, not research, and its search returns example sources.")
  else {
    if (searchers.length && !env.EXA_API_KEY) warnings.push("No EXA_API_KEY is set: members with the search tool get example sources, not live search results.")
    warnings.push("Board models are called directly at Anthropic and OpenAI (board/config.yaml), whichever provider wrote this plan.")
  }
  if (guests.length) warnings.push(`${guests.length} method specialist(s) take part as board members for this run: ${guests.map((g) => g.title).join(", ")}. They have no tools and cannot run code: they say which analysis would settle the question, its pitfalls and what the data can support, and report no result of their own. They take places inside this level's member limit; no limit or spend cap is raised.${mock ? " In a practice run their replies are fixed example text too." : ""}`)
  if (!overridesApplied()) warnings.push(`Not applied yet: a board run today uses every member in board/config.yaml (${members.length}), each on its own model tier, with the config's limits ($${cap}, ${config.meeting.max_minutes} min, ${config.meeting.max_rounds} rounds) and no cap on searches. This plan's agents, limits, model tier and search cap are saved with the run (overrides.json) but board.ts does not read them.`)
  else warnings.push("This plan's agents and limits are applied to the run. Its model tier and search cap are not: each agent runs on its own model tier and searches are not counted.")
  return {
    search: { exa: !mock && Boolean(env.EXA_API_KEY) && searchers.length > 0 },
    models: mock ? { lead: "practice run", members: "practice run", checker: "practice run" } : { lead: config.models.lead, members: tiers.join(", "), checker: `${config.models.cheap} / ${config.checkers.first_pass.alt}` },
    limits: { ...effort.limits },
    estimate: mock
      ? { usd: 0, basis: `A practice run calls no API, so it costs nothing. As a real run the ${effort.label} level would be capped at $${effort.limits.maxUsd}.` }
      : { usd: effort.limits.maxUsd, basis: `An upper bound, not a forecast: the ${effort.label} level's spend cap ($${effort.limits.maxUsd}, from meeting.max_usd in board/config.yaml). No past run was used to estimate.${overridesApplied() ? "" : ` Until board.ts applies per-run limits the real ceiling is the config cap, $${cap}.`}` },
    paid: !mock,
    warnings,
  }
}

/** Build and store a plan. `suggestion` is a model's output, or nothing for the template plan. Deterministic except for the id. */
export function planFrom(ctx: PlanContext, question: string, effortId: EffortId, suggestion: Suggestion = {}, skills: CatalogSkill[] = loadSkills()): PlanRecord {
  const { config } = ctx
  const q = briefLine(question, 2_000)
  const effort = effortOf(config, effortId)
  const { lead, members } = boardMembers(config)
  const specialists = loadSpecialists()
  const warnings: string[] = []

  // Agents: a model's picks count only when they name a board member or a specialist that may take part; otherwise the
  // word match decides. A specialist the model picked reads the methods that match the question (else its first ones).
  const picked: PlanAgent[] = []
  let invented = 0
  for (const item of Array.isArray(suggestion.agents) ? suggestion.agents.slice(0, 30) : []) {
    const name = typeof item === "string" ? item : (item as { name?: unknown } | null)?.name
    const said = flat((item as { why?: unknown } | null)?.why, 240)
    const why = said && !namesOrigin(said) ? said : "Chosen by the model."
    const m = members.find((x) => x.name === name)
    const s = m ? undefined : specialists.find((x) => x.name === name && x.takesPart)
    if (!m && !s) { invented++; continue }
    if (picked.some((p) => p.name === name)) continue
    if (m) picked.push({ name: m.name, title: m.title, why, source: "board" })
    else if (s) picked.push({ name: s.name, title: s.title, why, source: "specialist", methods: methodsFor(q, s).map((x) => ({ name: x.name, title: x.title })) })
  }
  if (invented) warnings.push(`${invented} agent name(s) the model gave are not board members or specialists that can take part, and were removed.`)
  const ranked = picked.length ? picked : [...rankAgents(q, members), ...rankSpecialists(q, specialists)]
  const agents = agentsFor(effort, ranked, lead, members, specialists)

  // Skills: only installed ones. Nothing in a board run loads a skill file, so the reason says what the link is.
  const usesSearch = members.some((m) => agents.some((a) => a.name === m.name) && m.tools.includes("exa_search"))
  const installed = skills.filter((s) => s.installed)
  const chosenSkills: Plan["skills"] = []
  let badSkills = 0
  for (const item of Array.isArray(suggestion.skills) ? suggestion.skills.slice(0, 30) : []) {
    const name = typeof item === "string" ? item : (item as { name?: unknown } | null)?.name
    if (!installed.some((s) => s.name === name)) { badSkills++; continue }
    if (!chosenSkills.some((s) => s.name === name)) chosenSkills.push({ name: name as string, why: flat((item as { why?: unknown } | null)?.why, 240) || "Chosen by the model." })
  }
  if (badSkills) warnings.push(`${badSkills} skill name(s) the model gave are unknown or not installed and were removed.`)
  if (!chosenSkills.length && usesSearch && installed.some((s) => s.name === "build-with-exa")) chosenSkills.push({ name: "build-with-exa", why: "The board's search tool follows this skill's request shape (engine/src/search/exa.ts). The run does not load the skill file." })
  for (const skill of methodSkills(agents)) if (!chosenSkills.some((s) => s.name === skill.name)) chosenSkills.push(skill)

  const derived = derive(ctx, effort, agents, members)
  const id = randomBytes(8).toString("hex")
  const briefTitle = briefLine(suggestion.briefTitle, 80).replace(/^#+\s*/, "") || briefLine(q, 70)
  const sections = suggestion.sections && typeof suggestion.sections === "object" && !Array.isArray(suggestion.sections) ? suggestion.sections as Record<string, unknown> : {}
  let { markdown, unstated } = writeBrief(config, briefTitle, q, derived.limits, sections)
  try { checkBrief(config, { id, briefTitle }, markdown) } catch (error) {
    if (!(error instanceof BriefRejected)) throw error
    ;({ markdown, unstated } = writeBrief(config, briefTitle, q, derived.limits)) // the model's text did not pass: the template does
    checkBrief(config, { id, briefTitle }, markdown)
    warnings.push("The model's brief did not pass the brief check and was replaced by the template.")
  }
  if (unstated.length) warnings.push(`The brief says "not stated" for: ${unstated.join(", ")}. Edit the brief before starting (send it as \`brief\` in the start body) or the board works from the question alone.`)

  const plan: Plan = { id, question: q, kind: "board", effort: effortId, briefTitle, brief: markdown, agents, skills: chosenSkills, search: derived.search, models: derived.models, limits: derived.limits, estimate: derived.estimate, paid: derived.paid, warnings: [...derived.warnings, ...warnings] }
  const record: PlanRecord = { plan, ranked, createdAt: Date.now() }
  sweepPlans(config)
  savePlan(config, record)
  return record
}

/** A limit from the client: above 0 and at most the effort level's own value (`max`), or a 400 that names the field. */
export function within(value: unknown, field: string, max: number, whole: boolean): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > max || (whole && !Number.isInteger(value)))
    throw Object.assign(new HttpError(400, `${field} must be ${whole ? "a whole number" : "a number"} above 0 and at most ${max}, this effort level's limit`), { field })
  return value
}
