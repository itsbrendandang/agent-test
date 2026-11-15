// The Home view's chat (see README.md in this folder).
//
//   GET  /api/chat/catalog            providers, agents, skills, effort levels. Never a key.
//   GET  /api/chat/search?q=          keyword search over runs, agents and skills. No model.
//   GET  /api/chat/roster?run=<id>    who takes part in a run: board members and the specialists a plan added.
//   POST /api/chat {messages}         an answer from past runs, or a Plan for a new board run. Starts nothing.
//   POST /api/chat/plans/:id/start    {confirm: true}: starts the plan's board run, once.
//
// Every route needs the dashboard's Origin or the session token. Anything that can spend needs the token.
import { existsSync } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import { buildIndex, keywordAnswer, parseReply, renderIndex } from "../search/ask.ts"
import { BudgetReached, checkDailyBudget, OverridesUnreadable, RunBusy, runDir } from "../board/board.ts"
import { BriefRejected } from "../brief.ts"
import { writeWhole } from "../fsx.ts"
import type { BoardConfig } from "../config.ts"
import { access, allowedOrigin, HttpError, isSafeId, readJson, tokenNeeded } from "../http.ts"
import { PaidCallsOff, paidCallsOff } from "../paid/paid.ts"
import { type BoardRun, search } from "../search/search.ts"
import { boardMembers, buildCatalog, type Catalog, loadSkills, PROVIDER_KEY, type ProviderId, providers } from "./catalog.ts"
import { callModel, type Fetch, prompt, readReply, type Turn } from "./model.ts"
import { loadSpecialists } from "../specialists.ts"
import { rosterFor } from "./roster.ts"
import { agentsFor, checkBrief, claimStart, DEFAULT_EFFORT, derive, effortOf, efforts, type EffortId, isEffort, type Limits, loadPlan, MAX_BRIEF, methodSkills, overridesApplied, type Plan, planFrom, savePlan, within } from "./plan.ts"

export interface ChatDeps {
  config: BoardConfig
  /** Scripted board models (no cost): the engine's mode. */
  mock: boolean
  env: NodeJS.ProcessEnv
  hasToken: (req: IncomingMessage) => boolean
  /** The same two functions POST /api/runs uses: create the run from a brief file, then run it in this process. */
  start: (briefFile: string) => Promise<string>
  launch: (runId: string) => void
  listRuns: () => BoardRun[]
  /** For tests: the model API. */
  fetch?: Fetch
}

export interface Cited { kind: "swarm" | "board"; id: string; title: string; why: string }
export interface ChatReply { reply: string; mode: "ai" | "keyword" | "scripted"; note?: string; runs?: Cited[]; plan?: Plan }
export interface SearchResult { kind: "swarm" | "board" | "agent" | "skill"; id: string; title: string; excerpt: string; status?: string; score?: number; startedAt?: number }

const MAX_MESSAGES = 20, MAX_MESSAGE = 4_000, MAX_QUESTION = 2_000, MAX_QUERY = 200
const NOTHING_STARTED = "Nothing has started. Review the plan, then confirm to start it."
const SCRIPTED_RUN = "If you start it now it is a practice run: the replies are fixed example text written in advance, not research."

/** A refusal that names the input it is about. */
class FieldError extends HttpError {
  readonly field: string
  readonly extra: Record<string, unknown>
  constructor(status: number, message: string, field: string, extra: Record<string, unknown> = {}) { super(status, message); this.field = field; this.extra = extra }
}
const bad = (field: string, message: string) => new FieldError(400, message, field)

// ── Trust ────────────────────────────────────────────────────────────────────────────────────────
// The single call site of the engine's trust rule (http.ts access): "scripted" needs the dashboard's Origin or the
// token; "spend" needs the token, because an Origin header is not a credential outside a browser. A page with the
// right Origin and no token gets 401 {field: "token", needsToken: true} and can ask the person for it.
function trust(req: IncomingMessage, deps: ChatDeps, need: "scripted" | "spend", what: string): void {
  const state = access({ origin: allowedOrigin(req, deps.env), token: deps.hasToken(req) }, need)
  if (state === "token") { const { error, ...extra } = tokenNeeded(what); throw new FieldError(401, error, "token", extra) }
  if (state === "forbidden") throw new HttpError(403, `${what} needs the dashboard's Origin or the x-glhf-token header`)
}

// ── Rate limits, counted in this process (as ask.ts does) ───────────────────────────────────────
const windows = { chat: [] as number[], search: [] as number[] }
const LIMIT = { chat: 20, search: 60 }
export function allow(bucket: keyof typeof windows, now = Date.now()): boolean {
  const recent = windows[bucket]
  while (recent.length && recent[0] <= now - 60_000) recent.shift()
  if (recent.length >= LIMIT[bucket]) return false
  recent.push(now)
  return true
}
/** For tests. */
export const resetRate = () => { windows.chat.length = 0; windows.search.length = 0 }

// ── Intent without a model ───────────────────────────────────────────────────────────────────────
const RESEARCH = /^\s*(research|investigate|plan|start|launch|run|look into|study|evaluate|assess|review|should we|new run)\b|\bshould we\b|\b(start|launch|begin|do|run)\s+(a|the|another)\s+(new\s+)?(run|review|board|study)\b/i
const PAST = /\b(past|previous|earlier|prior|last|latest|recent|existing|old|finished|failed)\s+(runs?|experiments?|reviews?|results?|memos?|boards?)\b|\b(which|what|any|how many|list|show|find|search)\b.*\b(runs?|experiments?)\b|\b(did|have|has)\s+(we|you|the\s+(board|swarm|lab))\b|\bwhat did\b|\b(run|task|swarm)\b.*\bscored?\b|\bscored?\b.*\b(run|task|swarm)\b/i
/** A crude word rule, used only when no model reads the question. A question it cannot place is new research. */
export const intentOf = (question: string): "past" | "research" => (RESEARCH.test(question) ? "research" : PAST.test(question) ? "past" : "research")

// ── POST /api/chat ───────────────────────────────────────────────────────────────────────────────
function readMessages(body: Record<string, unknown>): { turns: Turn[]; question: string } {
  const list = body.messages
  if (!Array.isArray(list) || !list.length) throw bad("messages", "messages must be a list with the person's question last")
  if (list.length > MAX_MESSAGES) throw bad("messages", `at most ${MAX_MESSAGES} messages`)
  const turns = list.map((m: unknown) => {
    const { role, content } = (m ?? {}) as { role?: unknown; content?: unknown }
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") throw bad("messages", "each message is {role: \"user\" | \"assistant\", content: string}")
    if (content.length > MAX_MESSAGE) throw bad("messages", `a message is longer than ${MAX_MESSAGE} characters`)
    return { role, content } as Turn
  })
  const last = turns.pop()!
  const question = last.content.replace(/\s+/g, " ").trim()
  if (last.role !== "user" || !question) throw bad("messages", "the last message must be the person's question")
  if (question.length > MAX_QUESTION) throw bad("messages", `the question is longer than ${MAX_QUESTION} characters`)
  return { turns, question }
}

/** The provider and model for the call. Both must be on the engine's own lists: a client names one, it never supplies one. */
function chooseModel(body: Record<string, unknown>, deps: ChatDeps): { provider: ProviderId; model: string; key: string } | undefined {
  const list = providers(deps.config, deps.env)
  if (body.provider !== undefined && !list.some((p) => p.id === body.provider)) throw bad("provider", `provider must be one of ${list.map((p) => p.id).join(", ")}`)
  const provider = body.provider === undefined ? list.find((p) => p.keyPresent) ?? list[0] : list.find((p) => p.id === body.provider)!
  if (body.model !== undefined && !provider.models.includes(body.model as string)) throw bad("model", `model must be one of ${provider.models.join(", ")} for ${provider.id}`)
  const key = deps.env[PROVIDER_KEY[provider.id]]
  return key ? { provider: provider.id, model: (body.model as string | undefined) ?? provider.models[0], key } : undefined
}

function planReply(plan: Plan, lead: string): string {
  const guests = plan.agents.filter((a) => a.source === "specialist")
  const invited = guests.length ? `${guests.length} of them ${guests.length === 1 ? "is a method specialist" : "are method specialists"} (${guests.map((g) => g.title).join(", ")}): no tools, method notes only.` : ""
  return [lead, `${plan.agents.length} agents at the ${plan.effort} effort level.`, invited, NOTHING_STARTED, plan.paid ? "" : SCRIPTED_RUN].filter(Boolean).join(" ")
}

/** No model: a keyword answer for a question about past runs, a template plan for a new one. */
function scripted(question: string, effort: EffortId, deps: ChatDeps, why: string): ChatReply {
  const boardRuns = deps.listRuns()
  const found = keywordAnswer(question, boardRuns, "all", why)
  if (intentOf(question) === "past") return { reply: found.answer, mode: "keyword", note: found.note, runs: found.runs }
  const { plan } = planFrom(deps, question, effort)
  return { reply: planReply(plan, "No model read this question. This plan was filled from a template: the agents were chosen by matching words in the question against each profile."), mode: "scripted", note: why, plan, ...(found.runs.length ? { runs: found.runs.slice(0, 5) } : {}) }
}

async function chat(req: IncomingMessage, body: Record<string, unknown>, deps: ChatDeps, signal: AbortSignal): Promise<ChatReply> {
  const { turns, question } = readMessages(body)
  if (body.effort !== undefined && !isEffort(body.effort)) throw bad("effort", "effort must be quick, standard or deep")
  const effort: EffortId = (body.effort as EffortId | undefined) ?? DEFAULT_EFFORT
  const choice = chooseModel(body, deps) // also checks provider and model when no call will be made
  // Before any key is used: with paid calls off there is no model call, whoever asks.
  if (paidCallsOff(deps.env)) return scripted(question, effort, deps, "Paid calls are off (NO_PAID_CALLS), so no model was asked.")
  if (!choice) return scripted(question, effort, deps, "No key is set for that provider, so no model was asked.")
  trust(req, deps, "spend", "a chat answer from a model") // a model call costs money: 401 without the token
  try {
    const entries = buildIndex(deps.listRuns(), "all")
    const { text, used } = renderIndex(entries, 40_000)
    const { members } = boardMembers(deps.config)
    const catalog = {
      members: members.map((m) => ({ name: m.name, title: m.title, deliverable: m.deliverable })),
      // Specialists a plan may add: only those that can take part, with only the methods that have notes (a name-only skill is never offered).
      specialists: loadSpecialists().filter((s) => s.takesPart).map((s) => ({ name: s.name, title: s.title, does: s.does.slice(0, 300), methods: s.methods.map((m) => m.name) })),
      skills: loadSkills().filter((s) => s.installed).map((s) => ({ name: s.name, description: s.description.slice(0, 200) })),
      briefSections: deps.config.brief.required_sections,
    }
    const raw = await callModel(choice.provider, choice.model, choice.key, prompt(catalog, text, turns, question), { fetch: deps.fetch, signal, env: deps.env })
    const parsed = readReply(raw)
    if (!parsed) throw new Error("the model's reply could not be read")
    if (parsed.intent === "past") {
      // The same check /api/ask applies: only runs that are in the index are kept.
      const cited = parseReply(JSON.stringify({ answer: parsed.reply, runs: parsed.runs }), used)
      if (!cited) throw new Error("the model's reply could not be read")
      const notes = [cited.dropped ? `${cited.dropped} run id(s) named by the model do not exist and were removed.` : "", used.length < entries.length ? `Only the newest ${used.length} runs were read.` : ""].filter(Boolean)
      return { reply: cited.answer, mode: "ai", runs: cited.runs, ...(notes.length ? { note: notes.join(" ") } : {}) }
    }
    const { plan } = planFrom(deps, question, effort, parsed.plan)
    return { reply: planReply(plan, parsed.reply), mode: "ai", plan, note: `Written by ${choice.provider} ${choice.model}. The plan's agents, limits and cost were checked and set by the engine.` }
  } catch (error) {
    if (signal.aborted) throw error
    return scripted(question, effort, deps, `The model call failed (${(error instanceof Error ? error.message : String(error)).slice(0, 120)}), so no model wrote this.`)
  }
}

// ── POST /api/chat/plans/:id/start ───────────────────────────────────────────────────────────────
async function startPlan(req: IncomingMessage, id: string, body: Record<string, unknown>, deps: ChatDeps): Promise<{ status: number; body: Record<string, unknown> }> {
  const { config, mock, env } = deps
  const record = isSafeId(id) ? loadPlan(config, id) : undefined
  if (!record) throw new HttpError(404, "no such plan, or it expired; ask again to get a new one")
  const already = () => new FieldError(409, record.runId ? "this plan was already started" : "this plan is being started", "plan", record.runId ? { kind: "board", id: record.runId } : {})
  if (record.runId) throw already()
  if (body.confirm !== true) throw bad("confirm", "starting a plan needs {\"confirm\": true}")

  // What the client may change: the effort level, a subset of the level's agents, lower limits, and the brief text.
  if (body.effort !== undefined && !isEffort(body.effort)) throw bad("effort", "effort must be quick, standard or deep")
  const effort = effortOf(config, (body.effort as EffortId | undefined) ?? record.plan.effort)
  const { lead, members } = boardMembers(config)
  let agents = agentsFor(effort, record.ranked, lead, members)
  const full = agents
  if (body.agents !== undefined) {
    if (!Array.isArray(body.agents) || body.agents.some((a) => typeof a !== "string")) throw bad("agents", "agents must be a list of agent names from the plan")
    const unknown = (body.agents as string[]).filter((a) => !agents.some((p) => p.name === a))
    if (unknown.length) throw bad("agents", `not in this plan at the ${effort.id} level: ${unknown.slice(0, 5).join(", ")}`)
    agents = agents.filter((a) => a.name === lead.name || (body.agents as string[]).includes(a.name)) // the lead always stays
    if (agents.filter((a) => a.source !== "specialist").length < 2) throw bad("agents", "keep at least one board member besides the lead")
  }
  const limits: Limits = { ...effort.limits }
  if (body.limits !== undefined) {
    const given = body.limits as Record<string, unknown> | null
    if (!given || typeof given !== "object" || Array.isArray(given)) throw bad("limits", "limits must be an object")
    for (const key of Object.keys(given)) if (!(key in limits)) throw bad("limits", `unknown limit ${key.slice(0, 40)}`)
    if (given.maxUsd !== undefined) limits.maxUsd = within(given.maxUsd, "limits.maxUsd", effort.limits.maxUsd, false)
    if (given.maxMinutes !== undefined) limits.maxMinutes = within(given.maxMinutes, "limits.maxMinutes", effort.limits.maxMinutes, false)
    if (given.maxRounds !== undefined) limits.maxRounds = within(given.maxRounds, "limits.maxRounds", effort.limits.maxRounds, true)
  }
  if (body.brief !== undefined && (typeof body.brief !== "string" || !body.brief.trim() || body.brief.length > MAX_BRIEF)) throw bad("brief", `brief must be Markdown text of at most ${MAX_BRIEF} characters`)
  // The plan's own brief names the level's limits in its Constraints line; keep that line true when the level changed.
  const brief = (body.brief as string | undefined) ?? record.plan.brief.replace(/^Run limits: at most .*? No other constraint was stated\.$/m,
    `Run limits: at most ${limits.maxRounds} round(s), ${limits.maxMinutes} minutes and $${limits.maxUsd}. No other constraint was stated.`)

  // The same refusals as POST /api/runs (app.ts), in the same order: trust, the paid switch, the brief, the daily cap.
  if (record.plan.paid && paidCallsOff(env)) throw new PaidCallsOff("starting this plan, which was made for real models")
  if (!mock && paidCallsOff(env)) throw new PaidCallsOff("starting a board run with real models")
  if (record.plan.paid !== !mock) throw bad("plan", `this plan was made for a ${record.plan.paid ? "real" : "practice"} run and the engine now does ${mock ? "practice" : "real"} runs; ask again to get a plan that says what will happen`)
  if (!mock) trust(req, deps, "spend", "starting a board run with real models")

  const release = claimStart(config, id)
  if (!release) throw already() // another request holds the claim: one plan, one run
  let runId: string
  try {
    const file = checkBrief(config, record.plan, brief) // BriefRejected -> 400, before anything runs
    checkDailyBudget(config, new Date(), mock) // BudgetReached -> 429
    runId = await deps.start(file) // startRun: checks both again, creates the run folder
  } catch (error) {
    if (body.brief !== undefined) try { checkBrief(config, record.plan, record.plan.brief) } catch { /* the stored brief is put back when it still passes */ }
    release()
    throw error instanceof BriefRejected ? Object.assign(error, { field: "brief" }) : error
  }
  const derived = derive(deps, effort, agents, members)
  // The plan's skills follow its agents: the method notes of a specialist that was taken out are taken out too.
  const dropped = methodSkills(full).filter((s) => !methodSkills(agents).some((k) => k.name === s.name)).map((s) => s.name)
  const skills = [...record.plan.skills.filter((s) => !dropped.includes(s.name)), ...methodSkills(agents).filter((s) => !record.plan.skills.some((k) => k.name === s.name))]
  const plan: Plan = { ...record.plan, effort: effort.id, brief, agents, skills, limits, search: derived.search, models: derived.models, estimate: derived.estimate }
  savePlan(config, { ...record, plan, runId, startedAt: Date.now() })
  // For board.ts, once it reads them: this run's members and limits. Written before the run is launched.
  const dir = runDir(config, runId)
  // `specialists` (only when the plan has some): board.ts adds them as members with no tools (specialists.ts runSpecialists checks every name and method again).
  const guests = agents.filter((a) => a.source === "specialist")
  if (existsSync(dir)) writeWhole(`${dir}/overrides.json`, JSON.stringify({ planId: id, effort: effort.id, board: agents.slice(1).filter((a) => a.source !== "specialist").map((a) => a.name), meeting: { max_usd: limits.maxUsd, max_minutes: limits.maxMinutes, max_rounds: limits.maxRounds }, modelTier: effort.modelTier, maxSearches: effort.search.maxSearches,
    ...(guests.length ? { specialists: guests.map((a) => ({ name: a.name, why: a.why, methods: (a.methods ?? []).map((m) => m.name) })) } : {}) }, null, 2))
  deps.launch(runId)
  const warnings = [...new Set(derived.warnings)]
  return { status: 201, body: { kind: "board", id: runId, scripted: mock, effort: effort.id, limits, agents: agents.map((a) => a.name), ...(guests.length ? { specialists: guests.map((a) => a.name) } : {}),
    note: mock ? "Started as a practice run: the replies are fixed example text written in advance, not research. Nothing is spent." : `Started with real models. ${overridesApplied() ? `It stops at $${limits.maxUsd}.` : `It stops at the config cap, $${config.meeting.max_usd}.`}`,
    ...(warnings.length ? { warnings } : {}) } }
}

// ── GET /api/chat/search ─────────────────────────────────────────────────────────────────────────
const KINDS = ["all", "swarm", "board", "agent", "skill"] as const
/** Text from run records and profiles: one line, no control characters, cut. Plain text, to be shown as text. */
const plain = (text: unknown, max: number) => String(text ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202f\ufeff]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max)

export function chatSearch(query: string, kind: (typeof KINDS)[number], limit: number, deps: Pick<ChatDeps, "config" | "env" | "listRuns">, catalog: Catalog = buildCatalog(deps.config, deps.env)): SearchResult[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)
  if (!words.length) return []
  const results: SearchResult[] = []
  // Runs: the search behind the Experiments view (search.ts), unchanged.
  if (kind === "all" || kind === "swarm" || kind === "board") for (const hit of search(words.join(" "), deps.listRuns())) {
    if (kind !== "all" && hit.kind !== kind) continue
    results.push({ kind: hit.kind, id: hit.id, title: plain(hit.title, 200), excerpt: plain(hit.matches.map((m) => `${m.where}: ${m.text}`).join(" · "), 400), status: plain(hit.status, 40), ...(hit.score === undefined ? {} : { score: hit.score }), startedAt: hit.startedAt })
  }
  const has = (text: string) => words.every((w) => text.toLowerCase().includes(w))
  if (kind === "all" || kind === "agent") for (const a of catalog.agents) {
    if (!has([a.name, a.title, a.role, a.trigger, a.deliverable, a.tools.join(" "), a.source, ...(a.methods ?? []).flatMap((m) => [m.name, m.title])].join(" "))) continue
    const what = a.source === "board" ? "Board member." : a.takesPart ? `Method specialist: a plan can add it to a board review (no tools; ${a.fullTextMethods ?? 0} method note(s)).` : `Specialist profile, not used on the board. ${a.whyNot ?? ""}`
    results.push({ kind: "agent", id: `${a.source}:${a.name}`, title: plain(a.title, 200), excerpt: plain([what, a.trigger && `Called when: ${a.trigger}`, a.deliverable && `Delivers: ${a.deliverable}`].filter(Boolean).join(" "), 400) })
  }
  if (kind === "all" || kind === "skill") for (const s of catalog.skills) {
    if (!has(`${s.name} ${s.title} ${s.description}`)) continue
    results.push({ kind: "skill", id: s.name, title: plain(s.title || s.name, 200), excerpt: plain(`${s.installed ? "Installed." : "Not installed (index only)."} ${s.description}`, 400), status: s.installed ? "installed" : "not installed" })
  }
  return results.slice(0, limit)
}

// ── The handler ──────────────────────────────────────────────────────────────────────────────────
export async function handleChat(req: IncomingMessage, res: ServerResponse, parts: string[], deps: ChatDeps): Promise<void> {
  const json = (code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)) }
  const route = parts.slice(2).join("/") // "", "catalog", "search", "plans/<id>/start"
  try {
    trust(req, deps, "scripted", "the chat routes")
    if (route === "catalog" && req.method === "GET") return json(200, { ...buildCatalog(deps.config, deps.env), efforts: efforts(deps.config), defaultEffort: DEFAULT_EFFORT })
    // The members of one run (the lead, the board members it kept, the specialists a plan added), or of the config when no run is named.
    if (route === "roster" && req.method === "GET") return json(200, rosterFor(deps.config, new URL(req.url ?? "/", "http://x").searchParams.get("run")))
    if (route === "search" && req.method === "GET") {
      const params = new URL(req.url ?? "/", "http://x").searchParams
      const q = (params.get("q") ?? "").replace(/\s+/g, " ").trim(), kind = params.get("kind") ?? "all", limit = params.get("limit") === null ? 20 : Number(params.get("limit"))
      if (q.length > MAX_QUERY) throw bad("q", `the query is longer than ${MAX_QUERY} characters`)
      if (!(KINDS as readonly string[]).includes(kind)) throw bad("kind", `kind must be one of ${KINDS.join(", ")}`)
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw bad("limit", "limit must be a whole number from 1 to 50")
      if (!allow("search")) return json(429, { error: "too many searches; wait a minute" })
      return json(200, { results: chatSearch(q, kind as (typeof KINDS)[number], limit, deps), mode: "keyword" })
    }
    if (route === "" && req.method === "POST") {
      const body = await readJson<Record<string, unknown>>(req, 65_536)
      if (!allow("chat")) return json(429, { error: "too many messages; wait a minute" })
      const gone = new AbortController() // the model call stops when the browser leaves
      res.on("close", () => { if (!res.writableEnded) gone.abort() })
      try { return json(200, await chat(req, body, deps, gone.signal)) } catch (error) { if (gone.signal.aborted) return void res.destroy(); throw error }
    }
    if (parts[2] === "plans" && parts[3] && parts[4] === "start" && parts.length === 5 && req.method === "POST") {
      const body = await readJson<Record<string, unknown>>(req, 65_536)
      if (!allow("chat")) return json(429, { error: "too many requests; wait a minute" })
      let id = ""
      try { id = decodeURIComponent(parts[3]) } catch { /* 404 below */ }
      const out = await startPlan(req, id, body, deps)
      return json(out.status, out.body)
    }
    json(404, { error: "not found" })
  } catch (error) {
    if (res.headersSent) return void res.end()
    const code = error instanceof HttpError ? error.status : error instanceof BriefRejected ? 400 : error instanceof BudgetReached ? 429 : error instanceof RunBusy || error instanceof OverridesUnreadable ? 409 : error instanceof PaidCallsOff ? 403 : 500
    const field = (error as { field?: unknown }).field
    json(code, { error: code === 500 ? "the chat route failed" : String(error instanceof Error ? error.message : error), ...(typeof field === "string" ? { field } : {}), ...(error instanceof FieldError ? error.extra : {}) })
    if (code === 500) console.error("chat route failed:", error)
  }
}
