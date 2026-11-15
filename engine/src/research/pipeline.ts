// One research answer, from the question to the reviewed text. docs/research-answer.md describes it in plain words.
//
//   prepare   a cheap model writes the queries and the opening sentence (a fixed fallback when its reply cannot be read)
//   search    one Exa web search opens every answer; then, at the same time, the free literature search (Europe PMC),
//             further web searches and, at the standard level, database lookups
//   evaluate  each search's results are screened by the board's first pass (triage.ts)
//   sources   what was kept is numbered [1]..[n]; the selection says why each was kept and why the others were not
//   write     the strong model writes a draft from the numbered sources only
//   review    two reviewers from another vendor than the writer look at all of it: the statement checker (every cited
//             sentence against each source it cites, with the board's quote rule) and the critic (the whole draft)
//   revise    ONE revision by the writer; every cited sentence it changed or added is checked again
//   save      the record and the result files (answer.md, sources.json, sources.csv) are written and registered
//
// Every stage is a STEP in the event log: step.started, then step.finished with a status and the measured time. A step
// that failed or could not run is still written, with a plain error and what it means for the reader.
//
// WHAT CODE DECIDES, never a model: which sources exist and their numbers; which markers stand; what the cited
// sentences are; each sentence's verdict (triage.ts `route`: a quote must be in the source, with the sentence's
// numbers); that a sentence which failed its check is not shown as holding up after the revision; the caps; what was
// searched. Models write text and give opinions; nothing they write can change a tool, a limit or an instruction.
//
// MONEY. Every paid step first passes `guard`: paid calls must still be on, the time limit not passed, and what was
// spent plus in-flight reservations and the step's worst case must fit under the answer's cap. A step that does not
// pass is not started, and the answer ends with what it has and says so. The record's `usd` is saved after every paid
// step; the board's daily cap reads it (spend.ts).
//
// DURABLE. An answer runs as a Pi Durable task (routes.ts). Every paid or outside step (the plan, each search, each
// screening, the draft, each statement check, the critic, the revision) goes through `remember` under a stable key:
// the answer id, the step, and a hash of the step's input. Its outcome is stored before anything relies on it. After a
// restart this function runs again from the top and every stored step is answered from the store, so the answer
// continues where it stopped and no finished step is paid twice. (A call that was in flight when the engine died has no
// stored outcome and is made again.) Everything between the steps is code that gives the same result from the same
// stored outcomes: sources are numbered in the order of the plan, never in the order replies happened to arrive.
// Events carry a key, and an event whose key is already in the log is not written again.
import type { Model, Models, ThinkingLevel } from "@earendil-works/pi-ai"
import type { BoardConfig } from "../config.ts"
import type { EvidenceItem } from "../events.ts"
import type { SearchResult } from "../search/exa.ts"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { exaAssumed, exaLedgerFile, reserveSearch, settleSearch } from "../paid/exaledger.ts"
import { PaidCallsOff } from "../paid/paid.ts"
import { describeModelFailure, FatalModelError, firstPassModel, isFatalModelError, type ModelId, parseModelId } from "../providers.ts"
import { type FirstPass, type FirstPassRuling, parseJson, quietReasoning } from "../board/triage.ts"
import { investigatorSystem, investigatorUser, leadSystem, leadUser, specialistSystem, specialistUser } from "./prompts.ts"
import { answerNotes, type Match } from "../specialists.ts"
import { criticSystem, criticUser, hypothesesSystem, hypothesesUser, MAX_NOTES, plannerSystem, plannerUser, providerName, rejudgeSystem, rejudgeUser, reviserSystem, reviserUser, STANCE, stanceUser, type ThreadTurn, writerSystem, writerUser } from "./prompts.ts"
import { saveRecord, writeArtifacts, type ResearchLog } from "./store.ts"
import { clip, withoutInlineTags, withoutRepeats } from "./text.ts"
import { ADVICE_LINE, citedSentences, cleanAnswer, directAnswer, keywordsOf, looksMedical, MAX_NOTE_CHARS, MAX_QUERY_CHARS, MAX_SOURCE_CHARS, MAX_STATEMENTS, MAX_TITLE_CHARS, oneLine, plainBlock, safeUrl, sameText, scrub, type Sentence, sentencesOf, statementKey, withAdviceLine } from "./text.ts"
import type { AnswerSpecialist, Counts, Hypothesis, Level, Provider, Recommendation, ResearchEvent, ResearchLimits, ResearchRecord, ReviewNote, SearchLine, Selection, Severity, Stance, Statement, StepEnd, StepRecord, StepStart, StepStatus, Stopped, StoredSource } from "./types.ts"

export const DATABASES = ["chembl", "clinicaltrials", "openfda", "opentargets", "uniprot", "pubchem"] as const
export type Database = (typeof DATABASES)[number]

/** The planner's output after code checked it. */
export interface Plan {
  keyQuestion: string
  medical: boolean
  web: { query: string; objective: string }[]
  literature: string[]
  databases: { source: Database; query: string }[]
  /** The one sentence that says what will be done. Checked by code; a code-built sentence when the planner's is not usable. */
  opening: string
  /** True when the planner's reply could not be used and the queries were made from the question's own words. */
  fallback: boolean
}

export const DEFAULT_OBJECTIVE = "Reports of original research and official sources that answer the question rank first; leave out marketing pages and news without data. Pull the reported findings with their numbers and units."

/** What a model step gave back: its text, what it cost, and whether it was cut at the token limit. */
export interface Reply { text: string; usd: number; truncated: boolean }

/** The four steps a model does. `real` below calls the vendors; demo.ts returns fixed text. */
export interface Brain {
  names: { planner: string; writer: string; checker: string; critic: string }
  /** False when no checker from another vendor than the writer is configured: then nothing can be verified. */
  checkerIndependent: boolean
  criticIndependent: boolean
  /** Worst-case dollars of one call of each step, given the size of its input in characters. */
  /** The model a method specialist runs on: the level's tier (cheap at quick, strong at standard). */
  specialistModel: string
  worstCase(step: "plan" | "hypothesize" | "write" | "section" | "specialist" | "critic" | "revise" | "rejudge" | "stance" | "screen" | "check", inputChars: number): number
  plan(system: string, user: string, signal: AbortSignal): Promise<Reply>
  write(system: string, user: string, signal: AbortSignal, onDelta: (text: string) => void): Promise<Reply>
  critique(system: string, user: string, signal: AbortSignal): Promise<Reply>
  revise(system: string, user: string, signal: AbortSignal): Promise<Reply>
  /** The critic again, after the revision: does the revised text resolve each of its notes. */
  rejudge(system: string, user: string, signal: AbortSignal): Promise<Reply>
  /** Standard level: the hypotheses to test, set before any search (the planner's model). */
  hypothesize(system: string, user: string, signal: AbortSignal): Promise<Reply>
  /** One investigator drafts the section of its hypothesis (the writer's model; its output is capped lower than a whole answer's). */
  section(system: string, user: string, signal: AbortSignal): Promise<Reply>
  /** One method specialist drafts its section (the model of the level's specialist tier; output capped like an investigator's). */
  specialist(system: string, user: string, signal: AbortSignal): Promise<Reply>
  /** Which way each checked statement points for its hypothesis (the checker's model: another vendor than the writer). */
  stance(system: string, user: string, signal: AbortSignal): Promise<Reply>
}

export interface PipelineDeps {
  config: BoardConfig
  limits: ResearchLimits
  env: NodeJS.ProcessEnv
  brain: Brain
  /**
   * Screens search results and checks sentences (triage.ts). Scripted in a demo answer. A new one for every call: its
   * `usd` after the call is what that call cost, also when several run at once.
   */
  firstPass: () => FirstPass
  /**
   * The durable store of step results (routes.ts: Pi Durable's task memo). `work` runs only when nothing is stored
   * under `key`; what it returns is stored before the pipeline relies on it, and a replay after a restart gets the
   * stored outcome without running `work`. A failure is an outcome too, so a replay takes the same path.
   */
  remember: <T>(key: string, work: () => Promise<Outcome<T>>) => Promise<Outcome<T>>
  /** The keys of the steps already stored for this answer (empty for one that starts now). Read once, at the start of an invocation. */
  stored?: () => Promise<string[]>
  /** True once a person asked to cancel this answer (kept on disk, so it holds across a restart). */
  cancelRequested?: () => boolean
  /** Aborted when the engine is stopping. The answer then stops where it is, writes nothing more, and continues at the next start. */
  interrupted?: AbortSignal
  /** The writer's model id ("vendor/model"), which the first pass uses to pick a checker from another vendor. Undefined in a demo answer. */
  writerModel?: string
  /** One live Exa search (exa.ts). Not called in a demo answer. */
  exa: (query: string, objective: string) => Promise<SearchResult>
  /** One free literature search (literature.ts). */
  literature: (query: string) => Promise<SearchResult>
  /** One database lookup (sources/), when that module is there. */
  database?: (source: Database, query: string) => Promise<SearchResult>
  /** The method specialists whose notes fit a question, best first (specialists.ts: matchSpecialists). Absent: no answer gets one. */
  specialists?: (question: string) => Match[]
  /** A demo answer's example sources. Set only in demo mode: then no other search runs. */
  fixtures?: (query: string) => Promise<SearchResult>
  /** Read live before every paid step: true once paid calls were switched off. Always false in a demo answer. */
  paidOff: () => boolean
  /** Aborted when a person cancels this answer: no further paid step starts, and requests in flight are dropped. */
  cancel?: AbortSignal
  /** Earlier finished answers of the thread, oldest first. */
  earlier: ResearchRecord[]
  now?: () => number
}

/** The answer ends here with what it has. Not an error. */
/** What a paid or outside step gave, as it is stored: its value or the plain reason it failed, and what it cost. */
export type Outcome<T> = { ok: true; value: T; usd: number } | { ok: false; error: string; usd: number }
/** The engine is stopping. Nothing more is written; the answer continues from its stored steps at the next start. */
export class Interrupted extends Error { constructor() { super("the engine is stopping") } }
/** A step failed in a way the answer goes on from (a service that is down, a reply that cannot be read). */
class StepFailed extends Error {}

type StopReason = Stopped | "cancelled"
class Stop extends Error {
  readonly reason: StopReason
  constructor(reason: StopReason) { super(reason); this.reason = reason }
}

export const STOP_WORDS: Record<StopReason, string> = {
  cap: "the spending cap for this answer was reached",
  time: "the time limit for this answer was reached",
  paid_off: "paid calls were switched off while it was being written",
  cancelled: "the answer was cancelled",
}

// ── Real models ──────────────────────────────────────────────────────────────────────────────────

/** "low" when the model has it (the writer and the critic should think a little), else the least it can do. */
const lowReasoning = (model: Pick<Model<never>, "reasoning" | "thinkingLevelMap">): ThinkingLevel | undefined => {
  if (!model.reasoning) return undefined
  const map = (model.thinkingLevelMap ?? {}) as Record<string, string | null | undefined>
  return map.low !== null ? "low" : quietReasoning(model)
}

export const PLAN_TOKENS = 700, CRITIC_TOKENS = 2_500, REJUDGE_TOKENS = 1_200, HYPOTHESES_TOKENS = 1_400, STANCE_TOKENS = 700
/** Characters per token assumed when a step's worst case is worked out. Real text is nearer 4, so this over-counts. */
export const CHARS_PER_TOKEN = 3

/** Output tokens of one investigator's section: a part of what a whole answer may use, so several sections cost no more than the limits allow. */
export const sectionTokens = (level: Pick<Level, "maxOutputTokens">): number => Math.max(800, Math.floor(level.maxOutputTokens * 0.6))
/** The investigator of a hypothesis: h1 -> investigator-1. */
/** The agent name of a method specialist in an answer's steps and events. */
export const specialistAgent = (name: string): string => `specialist:${name}`
export const investigatorOf = (hypothesis: string): string => `investigator-${hypothesis.replace(/^h/, "")}`

/** The critic's model: the rival tier when it is on another vendor than the writer, else the board's escalation choice. */
export function criticModel(config: BoardConfig, writer: ModelId): { model: ModelId; independent: boolean } {
  const rival = parseModelId(config.models.rival, "board/config.yaml models.rival")
  if (rival.vendor !== writer.vendor) return { model: rival, independent: true }
  const other = [parseModelId(`openai/${config.checkers.openai_model}`, "board/config.yaml checkers.openai_model"), parseModelId(config.models.cheap, "board/config.yaml models.cheap")].find((m) => m.vendor !== writer.vendor)
  return other ? { model: other, independent: true } : { model: rival, independent: false }
}

/** The models an answer uses, from board/config.yaml: planner = cheap tier, writer = strong tier, checker and critic from another vendor than the writer. */
export function modelNames(config: BoardConfig): { planner: string; writer: string; checker: string; critic: string } {
  const writer = parseModelId(config.models.strong, "board/config.yaml models.strong")
  return { planner: parseModelId(config.models.cheap, "board/config.yaml models.cheap").qualified, writer: writer.qualified, checker: firstPassModel(config, writer.qualified).model.qualified, critic: criticModel(config, writer).model.qualified }
}

/** The steps done by real models: planner = cheap tier, writer = strong tier, critic and checker from another vendor. */
export function realBrain(models: Models, config: BoardConfig, level: Level, refuse: (what: string) => void): Brain {
  const planner = parseModelId(config.models.cheap, "board/config.yaml models.cheap")
  const writer = parseModelId(config.models.strong, "board/config.yaml models.strong")
  const checker = firstPassModel(config, writer.qualified)
  const critic = criticModel(config, writer)
  const specialist = level.specialistTier === "cheap" ? planner : writer
  const get = (id: ModelId) => {
    const model = models.getModel(id.vendor, id.id)
    if (!model) throw new Error(`Model ${id.qualified} is not in the model catalog`)
    return model
  }
  const price = (id: ModelId, inputChars: number, outputTokens: number) => {
    const cost = get(id).cost
    const perMtok = (n: number) => (n > 0 ? n : config.meeting.fallback_usd_per_mtok ?? 15)
    return (inputChars / CHARS_PER_TOKEN / 1e6) * perMtok(cost.input) + (outputTokens / 1e6) * perMtok(cost.output)
  }
  async function ask(id: ModelId, what: string, system: string, user: string, maxTokens: number, reasoning: "quiet" | "low", signal: AbortSignal, onDelta?: (text: string) => void): Promise<Reply> {
    refuse(what) // throws PaidCallsOff while paid calls are off
    const model = get(id)
    const context = { systemPrompt: system, messages: [{ role: "user" as const, content: user, timestamp: Date.now() }] }
    const options = { signal, maxTokens, reasoning: reasoning === "low" ? lowReasoning(model as never) : quietReasoning(model as never) }
    let reply
    if (onDelta) {
      const stream = models.streamSimple(model, context, options)
      for await (const event of stream) if (event.type === "text_delta") onDelta(event.delta)
      reply = await stream.result()
    } else reply = await models.completeSimple(model, context, options)
    // What the provider says the call cost. When it reports tokens but no cost, the call is charged from the catalog
    // price of the model (and at the fallback price when it has none), so it can never run under the caps for free.
    const usage = reply.usage
    const perMtok = (n: number) => (n > 0 ? n : config.meeting.fallback_usd_per_mtok ?? 15)
    const usd = usage?.cost.total > 0 ? usage.cost.total : (((usage?.input ?? 0) + (usage?.cacheRead ?? 0) + (usage?.cacheWrite ?? 0)) / 1e6) * perMtok(model.cost.input) + ((usage?.output ?? 0) / 1e6) * perMtok(model.cost.output)
    if (reply.stopReason === "error" || reply.stopReason === "aborted") {
      if (isFatalModelError(reply.errorMessage)) throw Object.assign(new FatalModelError(describeModelFailure(config, id.vendor, id.id, reply.errorMessage)), { usd })
      throw Object.assign(new Error(`${what} did not answer (${id.qualified}): ${reply.errorMessage ?? reply.stopReason}`), { usd, aborted: reply.stopReason === "aborted" })
    }
    return { text: reply.content.map((c) => (c.type === "text" ? c.text : "")).join(""), usd, truncated: reply.stopReason === "length" }
  }
  return {
    names: { planner: planner.qualified, writer: writer.qualified, checker: checker.model.qualified, critic: critic.model.qualified },
    checkerIndependent: checker.independent,
    criticIndependent: critic.independent,
    specialistModel: specialist.qualified,
    worstCase(step, inputChars) {
      switch (step) {
        case "plan": return price(planner, inputChars, PLAN_TOKENS)
        case "write": case "revise": return price(writer, inputChars, level.maxOutputTokens)
        case "section": return price(writer, inputChars, sectionTokens(level))
        case "specialist": return price(specialist, inputChars, sectionTokens(level))
        case "critic": return price(critic.model, inputChars, CRITIC_TOKENS)
        case "rejudge": return price(critic.model, inputChars, REJUDGE_TOKENS)
        case "hypothesize": return price(planner, inputChars, HYPOTHESES_TOKENS)
        case "stance": return price(checker.model, inputChars, STANCE_TOKENS)
        case "screen": return price(planner, inputChars, 800) // triage.ts: at most 800 output tokens, on the cheap tier
        case "check": return price(checker.model, inputChars, 1_500) // triage.ts: at most 1,500 output tokens
      }
    },
    plan: (system, user, signal) => ask(planner, "the query planner", system, user, PLAN_TOKENS, "quiet", signal),
    write: (system, user, signal, onDelta) => ask(writer, "the writer", system, user, level.maxOutputTokens, "low", signal, onDelta),
    critique: (system, user, signal) => ask(critic.model, "the critic", system, user, CRITIC_TOKENS, "low", signal),
    revise: (system, user, signal) => ask(writer, "the writer (revision)", system, user, level.maxOutputTokens, "low", signal),
    rejudge: (system, user, signal) => ask(critic.model, "the critic (second look)", system, user, REJUDGE_TOKENS, "low", signal),
    section: (system, user, signal) => ask(writer, "an investigator", system, user, sectionTokens(level), "low", signal),
    specialist: (system, user, signal) => ask(specialist, "a method specialist", system, user, sectionTokens(level), "low", signal),
    hypothesize: (system, user, signal) => ask(planner, "the planner (hypotheses)", system, user, HYPOTHESES_TOKENS, "quiet", signal),
    stance: (system, user, signal) => ask(checker.model, "the stance check", system, user, STANCE_TOKENS, "quiet", signal),
  }
}

// ── Reading what models wrote ────────────────────────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v)

/** The plan when the planner's reply cannot be used: the question itself for the web search, its main words for the literature. */
export function fallbackPlan(question: string): Plan {
  const keywords = keywordsOf(question)
  return { keyQuestion: oneLine(question, 600), medical: looksMedical(question), web: [{ query: oneLine(question, MAX_QUERY_CHARS), objective: DEFAULT_OBJECTIVE }], literature: keywords.split(" ").length >= 2 ? [keywords] : [oneLine(question, 120)], databases: [], opening: openingFallback(false), fallback: true }
}

export const MAX_OPENING_CHARS = 240
/** The opening sentence built by code from what the level runs. */
export const openingFallback = (databases: boolean): string =>
  `I'll search the web and PubMed${databases ? ", look in public databases," : ""} for this question, screen what comes back, write an answer from the kept sources, and check each statement against its source.`

// Words for work this pipeline never does. An opening that uses one is not shown: it would promise a step that does not run.
const NOT_DONE = /\b(experiments?|simulat\w*|analy[sz]e the data|run (?:the |an? )?(?:analysis|code|model|pipeline)|download\w*|full[- ]text|full papers?|whole papers?|team|board|specialists?|agents?|datasets?|email|call|contact)\b/i
const DATABASE_WORDS = /\b(databases?|clinicaltrials(?:\.gov)?|chembl|uniprot|pubchem|openfda|open targets|registr(?:y|ies))\b/i

/**
 * The planner's opening, if it may be shown: one sentence, at most MAX_OPENING_CHARS, no address, and no promise of a
 * step this answer does not run (databases only when a lookup is planned). Otherwise undefined.
 */
export function readOpening(value: unknown, databases: boolean): string | undefined {
  if (typeof value !== "string") return undefined
  const text = oneLine(value, MAX_OPENING_CHARS + 1)
  if (text.length < 20 || text.length > MAX_OPENING_CHARS || !/[.!]$/.test(text)) return undefined
  if (/[.!?]["')]?\s+\S/.test(text.replace(/\b(e\.g|i\.e|vs|approx)\.\s/gi, "$1 "))) return undefined // more than one sentence
  if (/https?:|www\.|[<>{}\[\]`]/i.test(text) || NOT_DONE.test(text) || (!databases && DATABASE_WORDS.test(text))) return undefined
  return text
}

/**
 * The planner's reply, read strictly and cut to the level: at most `exaSearches` web queries (at least one, always),
 * `queries` literature queries and `databaseLookups` lookups, each a short single line. Anything unusable gives the fallback plan.
 */
export function readPlan(text: string, question: string, level: Level): Plan {
  const body = parseJson(text)
  const base = fallbackPlan(question)
  if (!isObject(body)) return base
  const line = (v: unknown, max = MAX_QUERY_CHARS) => (typeof v === "string" ? oneLine(v, max) : "")
  const web = (Array.isArray(body.web) ? body.web : []).flatMap((w) => {
    const query = isObject(w) ? line(w.query) : line(w)
    return query.length >= 3 ? [{ query, objective: (isObject(w) && line(w.objective, 400)) || DEFAULT_OBJECTIVE }] : []
  }).slice(0, level.exaSearches)
  const literature = [...new Set((Array.isArray(body.literature) ? body.literature : []).map((q) => line(q, 120).replace(/["()]/g, " ").replace(/\b(AND|OR|NOT)\b/g, " ").replace(/\s+/g, " ").trim()).filter((q) => q.length >= 3))].slice(0, level.queries)
  const databases = (Array.isArray(body.databases) ? body.databases : []).flatMap((d) => {
    if (!isObject(d) || !(DATABASES as readonly string[]).includes(String(d.source))) return []
    const query = line(d.query, 200)
    return query.length >= 2 ? [{ source: d.source as Database, query }] : []
  }).slice(0, level.databaseLookups)
  if (!web.length && !literature.length) return base
  const withDatabases = databases.length > 0
  return {
    opening: readOpening(body.opening, withDatabases) ?? openingFallback(withDatabases),
    keyQuestion: line(body.key_question, 600) || base.keyQuestion,
    medical: body.medical === true || base.medical,
    web: web.length ? web : base.web, literature: literature.length ? literature : base.literature, databases, fallback: false,
  }
}

const SEVERITIES: Severity[] = ["blocking", "major", "minor"]

/** The critic's notes, read strictly: known severities only, a sentence number that exists or null, short plain text, at most MAX_NOTES. Undefined when the reply is not the expected JSON. */
export function readNotes(text: string, cited: number): ReviewNote[] | undefined {
  const body = parseJson(text)
  if (!isObject(body) || !Array.isArray(body.notes)) return undefined
  const notes: ReviewNote[] = []
  for (const n of body.notes) {
    if (!isObject(n) || typeof n.text !== "string" || !SEVERITIES.includes(n.severity as Severity)) continue
    const note = oneLine(n.text, MAX_NOTE_CHARS)
    if (note.length < 8) continue
    const s = typeof n.statement === "number" && Number.isInteger(n.statement) && n.statement >= 1 && n.statement <= cited ? n.statement - 1 : null
    notes.push({ index: notes.length, reviewer: "critic", severity: n.severity as Severity, text: note, statement: s })
    if (notes.length >= MAX_NOTES) break
  }
  return notes
}

/** The critic's second look, read strictly: for each of its notes (1-based in the text, 0-based keys here) "resolved", "partly" or "open", and a few words why. Undefined when the reply is not the expected JSON. */
export function readRejudged(text: string, notes: number): Map<number, { status: "resolved" | "partly" | "open"; why?: string }> | undefined {
  const body = parseJson(text)
  if (!isObject(body) || !Array.isArray(body.notes)) return undefined
  const out = new Map<number, { status: "resolved" | "partly" | "open"; why?: string }>()
  for (const n of body.notes) {
    if (!isObject(n) || typeof n.note !== "number" || !Number.isInteger(n.note) || n.note < 1 || n.note > notes || out.has(n.note - 1)) continue
    if (n.status !== "resolved" && n.status !== "partly" && n.status !== "open") continue
    const why = oneLine(n.why, 200)
    out.set(n.note - 1, { status: n.status, ...(why ? { why } : {}) })
  }
  return out
}

// ── Hypotheses ───────────────────────────────────────────────────────────────────────────────────

/** A hypothesis with the searches planned for it. */
export interface PlannedHypothesis extends Pick<Hypothesis, "id" | "text" | "supportIf" | "contradictIf" | "origin"> {
  web: { query: string; objective: string }
  literature: string
  database?: { source: Database; query: string }
}
export const MAX_HYPOTHESES = 4

/**
 * The planner's hypotheses, read strictly. A hypothesis is kept only with its text and with what would support and
 * what would contradict it (both written before any search). Fewer than two usable ones means none are tested. At
 * most `fit` are tested: the rest are set aside, with the reason, and never silently dropped. `fit` is what the
 * level's own limits allow (one web search and one literature query for each).
 */
export function readHypotheses(text: string, fit: number, databases: boolean): { needed: boolean; reason?: string; items: PlannedHypothesis[]; cut: { text: string; reason: string }[] } {
  const body = parseJson(text)
  const none = (reason: string) => ({ needed: false, reason, items: [], cut: [] })
  if (!isObject(body)) return none("The planner's reply could not be read, so no hypotheses were set.")
  if (body.needed === false) return none(oneLine(body.reason, 240) || "The planner judged that this question needs no hypotheses.")
  const line = (v: unknown, max: number) => (typeof v === "string" ? oneLine(v, max) : "")
  const usable: Omit<PlannedHypothesis, "id">[] = []
  for (const h of (Array.isArray(body.hypotheses) ? body.hypotheses : []).slice(0, 8)) {
    if (!isObject(h)) continue
    const statement = line(h.text, 300), supportIf = line(h.supportIf, 300), contradictIf = line(h.contradictIf, 300)
    if (statement.length < 15 || supportIf.length < 8 || contradictIf.length < 8) continue // no hypothesis without what would support and what would contradict it
    if (usable.some((u) => sameText(u.text) === sameText(statement))) continue
    const web = isObject(h.web) ? h.web : {}
    const query = line(web.query, MAX_QUERY_CHARS)
    const literature = line(h.literature, 120).replace(/["()]/g, " ").replace(/\b(AND|OR|NOT)\b/g, " ").replace(/\s+/g, " ").trim()
    const db = isObject(h.database) && (DATABASES as readonly string[]).includes(String(h.database.source)) && line(h.database.query, 200).length >= 2 ? { source: h.database.source as Database, query: line(h.database.query, 200) } : undefined
    usable.push({
      text: statement, supportIf, contradictIf, origin: h.origin === "user" ? "user" : "planner",
      web: { query: query.length >= 3 ? query : statement, objective: line(web.objective, 400) || DEFAULT_OBJECTIVE },
      literature: literature.length >= 3 ? literature : keywordsOf(statement),
      ...(databases && db ? { database: db } : {}),
    })
    if (usable.length >= MAX_HYPOTHESES) break
  }
  if (usable.length < 2) return none("The planner did not give two usable hypotheses, so none were set.")
  const allowed = Math.max(0, Math.min(fit, MAX_HYPOTHESES))
  if (allowed < 2) return { needed: true, reason: "The level's limits do not fit two hypotheses, so none were tested.", items: [], cut: usable.map((u) => ({ text: u.text, reason: "the level's limits do not fit two hypotheses" })) }
  return {
    needed: true,
    items: usable.slice(0, allowed).map((u, i) => ({ id: `h${i + 1}`, ...u })),
    cut: usable.slice(allowed).map((u) => ({ text: u.text, reason: `the Standard level has ${plural(allowed, "web search", "web searches")} and ${plural(allowed, "literature query", "literature queries")} for hypotheses, one of each for a hypothesis` })),
  }
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The stance check's reply, read strictly: one known word for each statement index that exists, the first given. */
export function readStances(text: string, n: number): Map<number, Stance> | undefined {
  const body = parseJson(text)
  if (!isObject(body) || !Array.isArray(body.stances)) return undefined
  const out = new Map<number, Stance>()
  for (const e of body.stances) {
    if (!isObject(e) || typeof e.i !== "number" || !Number.isInteger(e.i) || e.i < 0 || e.i >= n || out.has(e.i)) continue
    if (e.stance === "supports" || e.stance === "contradicts" || e.stance === "neither") out.set(e.i, e.stance)
  }
  return out
}

/**
 * The mark of one hypothesis, given by code and by nothing else. A statement counts only when all three hold: the
 * writer filed it under this hypothesis's "For:" or "Against:" line; it passed the quote check against its source
 * ("verified"); and a model of another vendor, asked separately and not told the side, says it points that way.
 *   for >= 1, against = 0   -> verified      (Supported)
 *   against >= 1, for = 0   -> contradicted  (Contradicted)
 *   both                    -> unsupported   (Insufficient evidence), with mixed: the sources disagree
 *   neither                 -> unsupported   (Insufficient evidence)
 *   none, and statements filed under it whose direction could not be judged -> unchecked (Not checked)
 * One checked statement from one source is enough for a mark; the counts are in the note, so a thin mark is seen as thin.
 * "Tested" means checked against published sources. It is not an experiment.
 */
export function markOf(id: string, statements: Statement[]): Required<Pick<Hypothesis, "verdict" | "for" | "against" | "forStatements" | "againstStatements" | "note">> & { mixed?: boolean } {
  const filed = statements.filter((s) => s.hypothesis === id && s.side)
  const passed = filed.filter((s) => s.verdict === "verified")
  const pro = passed.filter((s) => s.side === "for" && s.stance === "supports"), con = passed.filter((s) => s.side === "against" && s.stance === "contradicts")
  const unjudged = passed.filter((s) => s.stance === undefined || s.stance === "unchecked")
  const numbers = (list: Statement[]) => [...new Set(list.flatMap((s) => s.sources))].sort((a, b) => a - b)
  const said = (list: Statement[]) => `${plural(list.length, "checked statement")} from ${plural(numbers(list).length, "source")}`
  const base = { for: numbers(pro), against: numbers(con), forStatements: pro.map((s) => s.index), againstStatements: con.map((s) => s.index) }
  const dropped = filed.length - pro.length - con.length
  const rest = dropped > 0 ? ` ${plural(dropped, "statement")} filed under it ${dropped === 1 ? "is" : "are"} not counted (not checked, not found in the source, or not pointing that way).` : ""
  if (pro.length && con.length) return { ...base, verdict: "unsupported", mixed: true, note: `The sources disagree: ${said(pro)} for it, ${said(con)} against it.${rest}` }
  if (pro.length) return { ...base, verdict: "verified", note: `${said(pro)} for it; none against it.${rest}` }
  if (con.length) return { ...base, verdict: "contradicted", note: `${said(con)} against it; none for it.${rest}` }
  if (unjudged.length) return { ...base, verdict: "unchecked", note: `${plural(unjudged.length, "statement")} filed under it passed the quote check, but which way ${unjudged.length === 1 ? "it points" : "they point"} was not judged.` }
  return { ...base, verdict: "unsupported", note: `No checked statement for or against it.${rest}` }
}

const MARKER = (name: string) => new RegExp(`(^|\\n)[ \\t>*_#]*${name}[ \\t*_:]*(\\n|$)`, "i")

/**
 * What the writer returned, split into the answer and the two blocks a program reads: the lines under NEXT STEPS
 * (proposed recommendations) and the lines under REVIEW NOTES (what it says it did about each critic note; 1-based
 * numbers in the text, 0-based keys here). Neither block is ever shown as part of the answer.
 */
export function splitBlocks(text: string): { markdown: string; nextSteps: string[]; reported: Map<number, { addressed: boolean; why?: string }> } {
  const next = text.search(MARKER("NEXT STEPS")), review = text.search(MARKER("REVIEW NOTES"))
  const starts = [next, review].filter((i) => i >= 0)
  const end = (from: number) => Math.min(...[next, review, text.length].filter((i) => i > from))
  const body = (from: number) => text.slice(from, end(from)).split("\n").slice(from === 0 ? 1 : 2).map((l) => l.trim()).filter(Boolean)
  const reported = new Map<number, { addressed: boolean; why?: string }>()
  if (review >= 0) for (const line of body(review)) {
    const m = /^\W*(\d{1,2})\s*[:.)-]\s*(not addressed|addressed)\b[\s:.-]*(.*)$/i.exec(line)
    if (m) reported.set(Number(m[1]) - 1, { addressed: m[2].toLowerCase() === "addressed", ...(m[3].trim() ? { why: oneLine(m[3], 160) } : {}) })
  }
  return { markdown: starts.length ? text.slice(0, Math.min(...starts)) : text, nextSteps: next >= 0 ? body(next) : [], reported }
}

export const MAX_RECOMMENDATIONS = 3
const ADVICE = /\b(you should|patients? should|stop taking|start taking|switch to|consult (?:a|your)|ask your doctor)\b/i

/**
 * The recommendations that may be shown, at most MAX_RECOMMENDATIONS. Code decides, in this order of right to a place:
 * - "Needs verification": built here, one for each final sentence that ended contradicted or unsupported (at most 2);
 * - "Have a team review this question": built here when the critic left a blocking or major note unresolved;
 * - the writer's proposals ("Recommended next step", "Alternative"): kept only when every number in `basis` is a
 *   kept source and at least one of them is cited by a sentence that passed its check, and the text gives no advice.
 * A recommendation with no basis is dropped. Shown order: the writer's first, then what needs verification, then the team review.
 */
export function buildRecommendations(o: { proposed: string[]; sources: number; statements: Statement[]; notes: ReviewNote[] }): Recommendation[] {
  const verifiedSources = new Set(o.statements.filter((s) => s.verdict === "verified").flatMap((s) => s.sources))
  const cited = [...new Set(o.statements.flatMap((s) => s.sources))].sort((a, b) => a - b)
  const needs: Recommendation[] = o.statements.filter((s) => s.verdict === "contradicted" || s.verdict === "unsupported").slice(0, 2).map((s) => ({
    label: "Needs verification",
    text: `Check this sentence against its source yourself: "${clip(s.text, 220)}"`,
    why: s.verdict === "contradicted" ? `The checker found that source ${s.sources.map((n) => `[${n}]`).join("")} says otherwise.` : `The check did not find it in source ${s.sources.map((n) => `[${n}]`).join("")}${s.note ? ` (${clip(s.note, 140)})` : ""}.`,
    basis: s.sources,
    does: "Opening the source shows whether the sentence can stand. Until then it is not shown as holding up.",
  }))
  const open = o.notes.find((n) => !n.resolved && (n.severity === "blocking" || n.severity === "major"))
  const basis = cited
  const team: Recommendation[] = open && basis.length ? [{
    label: "Alternative",
    text: "Have a team review this question.",
    why: `The reviewer's ${open.severity} note was not resolved: "${clip(open.text, 260)}"`,
    basis,
    does: "It drafts a plan for a board review (the Deep level): several members and a critic discuss the question in rounds. You see the plan and its cost limit before anything starts.",
  }] : []
  const proposed: Recommendation[] = []
  for (const line of o.proposed.slice(0, 6)) {
    const body = parseJson(line.replace(/^[-*\d.)\s]+(?=\{)/, ""))
    if (!isObject(body) || (body.label !== "Recommended next step" && body.label !== "Alternative")) continue
    const text = oneLine(body.text, 240), why = oneLine(body.why, 240), does = oneLine(body.does, 200)
    const numbers = Array.isArray(body.basis) ? [...new Set(body.basis)] : []
    if (text.length < 8 || why.length < 8 || !does || !numbers.length) continue
    if (!numbers.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= o.sources)) continue // names a source that does not exist
    if (!numbers.some((n) => verifiedSources.has(n as number))) continue // rests on nothing that passed a check
    if (ADVICE.test(text) || /https?:|www\./i.test(`${text} ${why} ${does}`)) continue
    if (proposed.some((p) => p.label === "Recommended next step") && body.label === "Recommended next step") continue // one recommended step
    proposed.push({ label: body.label, text, why, basis: (numbers as number[]).sort((a, b) => a - b), does })
  }
  const room = Math.max(0, MAX_RECOMMENDATIONS - needs.length - team.length)
  return [...proposed.slice(0, room), ...needs, ...team].slice(0, MAX_RECOMMENDATIONS)
}

// ── Sources ──────────────────────────────────────────────────────────────────────────────────────

const urlKey = (url: string) => { try { const u = new URL(url); return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}` } catch { return url } }

/** A search's items as they may be kept: a safe address, a title and some text; plain text, cut. Everything else is left out. */
export function usable(items: EvidenceItem[], provider: Provider): EvidenceItem[] {
  const out: EvidenceItem[] = []
  for (const item of items) {
    if (!item || !safeUrl(item.url)) continue
    const title = oneLine(withoutInlineTags(String(item.title ?? "")), MAX_TITLE_CHARS), text = plainBlock(withoutInlineTags(String(item.text ?? "")), MAX_SOURCE_CHARS)
    if (!title || text.length < 40) continue // nothing a statement could be checked against
    out.push({ url: item.url, title, text, provider: provider as EvidenceItem["provider"] })
  }
  return out
}

const STUDY_LABEL: Record<string, string> = { clinical: "clinical", in_vitro: "in vitro", in_vivo: "in vivo", computational: "computational", review: "review" }
export function noteOf(item: EvidenceItem, provider: Provider): string | undefined {
  const labels: string[] = []
  if (provider === "fixture") labels.push("example source")
  if (/\[preprint\]|\(preprint\b/i.test(item.title)) labels.push("preprint")
  if (/\[review\]/i.test(item.title) || item.studyType === "review") labels.push("review")
  const study = item.studyType && item.studyType !== "review" ? STUDY_LABEL[item.studyType] : undefined
  if (study) labels.push(study)
  return labels.length ? [...new Set(labels)].join(", ") : undefined
}

/** `order`: the place of its search in the plan, then its place in that search's results. Sources are numbered from this, so a replay numbers them the same. */
export interface Candidate { item: EvidenceItem; provider: Provider; earlier?: boolean; order?: number; /** The hypothesis whose search found it. */ hypothesis?: string }

/** What this answer has spent on Exa, from the Exa ledger's own lines for it (reservations and their corrections). */
export function exaSpentBy(config: BoardConfig, id: string): number {
  const file = exaLedgerFile(config)
  if (!existsSync(file)) return 0
  let usd = 0
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.includes(id)) continue
    try { const e = JSON.parse(line) as { runId?: string; usd?: number }; if (e.runId === id && typeof e.usd === "number" && Number.isFinite(e.usd)) usd += e.usd } catch { /* a damaged line is counted by the ledger's own total */ }
  }
  return Math.max(0, usd)
}

export const READ_LIMIT: Partial<Record<Provider, string>> = { europepmc: "Only the abstract was read.", exa: "Only excerpts of the page were read.", fixture: "An example source, not a real one." }

/**
 * Why each numbered source was selected and what limits it, and why the others were not: assembled by code from what
 * the screening returned (its yes / partly / no and the study type) and from what is known about the source. Where the
 * screening gave nothing, only that is said. No score is made up.
 */
export function selectionOf(sources: StoredSource[], notSelected: Selection["notSelected"], max: number, effort: string, results = sources.length + notSelected.length): Selection {
  // An address is listed once: not again when a second search found it too, and not as "not selected" when it was selected.
  const taken = new Set(sources.map((s) => urlKey(s.url)))
  const others = notSelected.filter((s) => { const key = urlKey(s.url); if (taken.has(key)) return false; taken.add(key); return true })
  return {
    counts: { results, unique: sources.length + others.length, selected: sources.length },
    criteria: `Kept: results that the screening model judged to help answer the question and that report findings of their own, or are reviews. At most ${max} are numbered at the ${effort} level, the most relevant first, with the searches taking turns so that one search cannot fill the list. "Relevant" is the screening model's yes, partly or no. It is not a calibrated score.`,
    selected: sources.map((s) => {
      const judged = s.relevance === 1 ? "Screened as answering the question" : s.relevance === 0.5 ? "Screened as partly answering the question" : "Not screened; kept as found"
      const study = s.studyType ? `; study type: ${STUDY_LABEL[s.studyType] ?? s.studyType}` : ""
      const limits = [/preprint/.test(s.note ?? "") && "A preprint: not peer reviewed.", /review/.test(s.note ?? "") && "A review: it summarises other studies.", READ_LIMIT[s.provider] ?? "A database record, not a paper."].filter(Boolean).join(" ")
      return { n: s.n, why: `${s.earlier ? "Listed again from the earlier answer in this thread. " : ""}${judged}${study}.`, ...(limits ? { limitation: limits } : {}) }
    }),
    notSelected: others.slice(0, 40),
  }
}

/**
 * The numbered sources: the candidates that passed screening, each address once, the most relevant first, the
 * providers taking turns inside one relevance level (so web pages cannot push every paper out), cut to `max`.
 */
export function numberSources(candidates: Candidate[], max: number, hypotheses: string[] = []): StoredSource[] {
  // Each address once. One that several hypotheses' searches found serves each of them.
  const byKey = new Map<string, Candidate & { serves: string[] }>()
  for (const c of [...candidates].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const key = urlKey(c.item.url), first = byKey.get(key)
    if (!first) byKey.set(key, { ...c, serves: c.hypothesis ? [c.hypothesis] : [] })
    else if (c.hypothesis && !first.serves.includes(c.hypothesis)) first.serves.push(c.hypothesis)
  }
  const unique = [...byKey.values()]
  const tier = (c: Candidate) => (c.item.relevance === 1 ? 0 : c.item.relevance === 0.5 ? 2 : 1) // screened "yes", not screened, screened "partly"
  /** The most relevant first; inside one relevance level the searches take turns. */
  const inOrder = (list: (Candidate & { serves: string[] })[]) => {
    const ordered: typeof list = []
    for (const t of [0, 1, 2]) {
      const queues = new Map<Provider, typeof list>()
      for (const c of list.filter((x) => tier(x) === t)) queues.set(c.provider, [...(queues.get(c.provider) ?? []), c])
      for (let more = true; more;) { more = false; for (const q of queues.values()) { const next = q.shift(); if (next) { ordered.push(next); more = true } } }
    }
    return ordered
  }
  let ordered = inOrder(unique)
  if (hypotheses.length) {
    // The hypotheses take turns too, so that each one gets its share of the numbered sources.
    const queues = hypotheses.map((id) => inOrder(unique.filter((c) => c.serves.includes(id))))
    const taken = new Set<Candidate>(), turns: typeof ordered = []
    for (let more = true; more;) { more = false; for (const q of queues) { let next = q.shift(); while (next && taken.has(next)) next = q.shift(); if (next) { taken.add(next); turns.push(next); more = true } } }
    ordered = [...turns, ...ordered.filter((c) => !taken.has(c))]
  }
  return ordered.slice(0, max).map((c, i) => {
    const note = noteOf(c.item, c.provider)
    const year = c.provider === "europepmc" ? /\((?:[^()]*, )?((?:19|20)\d{2})\)(?: \[\w+\])?$/.exec(c.item.title)?.[1] : undefined // literature.ts writes "(Journal, 2025)" at the end of a title
    const serves = hypotheses.filter((id) => c.serves.includes(id))
    return { n: i + 1, url: c.item.url, title: c.item.title, provider: c.provider, ...(note ? { note } : {}), ...(year ? { published: year } : {}), ...(serves.length ? { hypotheses: serves } : {}), ...(c.earlier ? { earlier: true } : {}), text: c.item.text, ...(c.item.studyType ? { studyType: c.item.studyType } : {}), ...(c.item.relevance === undefined ? {} : { relevance: c.item.relevance }) }
  })
}

// ── Verdicts ─────────────────────────────────────────────────────────────────────────────────────

interface SourceRuling { n: number; ruling?: FirstPassRuling; failed?: string }

/**
 * The verdict of one cited sentence from the rulings on each source it cites. Contradicted when a cited source
 * contradicts it; verified when at least one cited source states it (a real quote with the sentence's numbers);
 * unchecked when no usable check was made; unsupported otherwise. The only place a Statement gets its verdict.
 */
export function verdictOf(stage: Statement["stage"], index: number, sentence: Sentence, rulings: SourceRuling[], checker: string): Statement {
  const base = { stage, index, text: sentence.text, sources: sentence.sources, ...(sentence.hypothesis ? { hypothesis: sentence.hypothesis } : {}), ...(sentence.hypothesis && sentence.side ? { side: sentence.side } : {}) }
  const withQuote = (r: SourceRuling) => ({ ...(r.ruling?.quote ? { quote: r.ruling.quote, quoteSource: r.n } : {}), quoteFound: r.ruling?.quoteFound === true })
  const contradicted = rulings.find((r) => r.ruling?.verdict === "contradicted")
  if (contradicted) return { ...base, verdict: "contradicted", ...withQuote(contradicted), checker: contradicted.ruling!.checkedBy, note: `source [${contradicted.n}] says otherwise` }
  const verified = rulings.find((r) => r.ruling?.verdict === "verified")
  if (verified) return { ...base, verdict: "verified", ...withQuote(verified), checker: verified.ruling!.checkedBy }
  const usableRulings = rulings.filter((r) => r.ruling && r.ruling.reason !== "the checker's reply was not usable")
  if (!usableRulings.length) {
    const why = rulings.find((r) => r.failed)?.failed ?? (rulings.some((r) => r.ruling) ? "the checker's reply could not be read" : "no check was made")
    return { ...base, verdict: "unchecked", quoteFound: false, checker: rulings.find((r) => r.ruling)?.ruling?.checkedBy ?? checker, note: `not checked: ${why}` }
  }
  const first = usableRulings[0]
  return { ...base, verdict: "unsupported", quoteFound: first.ruling!.quoteFound === true, checker: first.ruling!.checkedBy, note: first.ruling!.reason ?? `source [${first.n}] does not state this` }
}

export const MAX_MISSING = 10

/**
 * "What is missing", built by code and never by a model: the searches that did not run or found nothing, the steps
 * that failed, the cited sentences of the final text that did not pass their check, the reviewer's concerns that were
 * left open, and an early end. Empty when nothing is missing. It is shown as the last part of the answer.
 */
export function missingOf(record: Pick<ResearchRecord, "searches" | "steps" | "sources" | "statements" | "review" | "stopped" | "hypotheses">, cut: { text: string; reason: string }[] = []): string[] {
  const out: string[] = []
  const quote = (text: string) => `"${clip(text, 220)}"`
  for (const h of record.hypotheses ?? []) {
    const name = h.id.toUpperCase()
    if (h.mixed) out.push(`The sources disagree on ${name}: ${quote(h.text)}`)
    else if (h.verdict === "unsupported") out.push(`No checked evidence for or against ${name}: ${quote(h.text)}`)
    else if (h.verdict === "unchecked") out.push(`${name} was not checked: ${quote(h.text)}`)
  }
  for (const c of cut) out.push(`A hypothesis that was proposed and not tested, because ${clip(c.reason, 200)}: ${quote(c.text)}`)
  for (const s of record.searches) {
    if (!s.ran) out.push(s.reason ? `${oneLine(s.reason, 260).replace(/\.$/, "")}.` : `${providerName(s.provider)} did not run.`) // the reason is a whole sentence that names the search
    else if (!s.found) out.push(`${providerName(s.provider)} found nothing for "${oneLine(s.query, 120)}".`)
  }
  if (!record.sources.length) out.push("No source passed screening, so nothing could be cited.")
  for (const step of record.steps) {
    if (step.status !== "failed" || step.kind === "search") continue
    if (step.kind === "evaluate") out.push("One search's results could not be screened for relevance; they were kept as found.")
    if (step.kind === "review") out.push(`The review of the whole draft did not run: ${oneLine(step.error ?? "no reason was recorded", 200).replace(/\.$/, "")}.`)
    if (step.kind === "revise") out.push("The revision did not run, so the first draft is shown with the marks of its review.")
    if (step.kind === "prepare") out.push("The search queries could not be planned; the question's own words were searched.")
  }
  for (const s of record.statements) {
    const cites = s.sources.map((n) => `[${n}]`).join("")
    if (s.verdict === "contradicted") out.push(`Its source says otherwise ${cites}: ${quote(s.text)}`)
    else if (s.verdict === "unsupported") out.push(`Not found in its source ${cites}: ${quote(s.text)}`)
    else if (s.verdict === "unchecked") out.push(`Not checked ${cites}: ${quote(s.text)}${s.note ? ` (${oneLine(s.note.replace(/^not checked: /, ""), 120)})` : ""}`)
  }
  for (const n of record.review.notes) if (!n.resolved && n.severity !== "minor") out.push(`A reviewer's ${n.severity} concern was not resolved: ${quote(n.text)}`)
  if (record.stopped) out.push(`The answer ended early: ${STOP_WORDS[record.stopped]}.`)
  const unique = [...new Set(out)]
  return unique.length > MAX_MISSING ? [...unique.slice(0, MAX_MISSING - 1), `And ${unique.length - MAX_MISSING + 1} more: see the marks on the sentences and the list of steps.`] : unique
}

export const countsOf = (sources: number, statements: Statement[]): Counts => ({
  sources, statements: statements.length,
  verified: statements.filter((s) => s.verdict === "verified").length, contradicted: statements.filter((s) => s.verdict === "contradicted").length,
  unsupported: statements.filter((s) => s.verdict === "unsupported").length, unchecked: statements.filter((s) => s.verdict === "unchecked").length,
})

// ── The run ──────────────────────────────────────────────────────────────────────────────────────

const SEARCH_LABEL: Partial<Record<Provider, string>> = { exa: "Searching the web", europepmc: "Searching PubMed and preprints", fixture: "Loading example sources" }
const NOT_SEARCHED: Partial<Record<Provider, string>> = {
  exa: "The web search did not run, so this answer rests on the other searches only.",
  europepmc: "PubMed and preprints were not searched, so this answer rests on the other searches only.",
}
const hash = (value: unknown) => createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 16)
/** First-pass calls that run at once, at most (as triage.ts does inside one FirstPass). */
export const MAX_FIRST_PASS = 4

/**
 * Work one answer to its end, or continue it after a restart. `record` was created and saved by the caller (routes.ts).
 * Returns the finished record. It throws only `Interrupted`, when the engine is stopping: then nothing was written past
 * the last stored step, and the next call continues from there. Any other error ends the answer as failed, with a plain
 * message that holds no key.
 */
export async function runAnswer(deps: PipelineDeps, record: ResearchRecord, log: ResearchLog): Promise<ResearchRecord> {
  const { config, brain, env } = deps
  const level = deps.limits.levels[record.effort]
  const now = deps.now ?? Date.now
  const demo = record.mode === "demo"
  const emit = (key: string, event: ResearchEvent) => log.emit(key, event)
  const resumed = log.has("started")

  // What an earlier invocation worked out is worked out again from the stored steps, so the record starts clean.
  Object.assign(record, { status: "running", steps: [], searches: [], sources: [], statements: [], recommendations: [], review: { ...record.review, revised: false, notes: [] } })
  for (const field of ["opening", "selection", "draft", "answer", "counts", "stopped", "note", "error", "finishedAt", "seconds"] as const) delete record[field]
  record.workStartedAt ??= now()

  // Time is counted while the answer is worked on, not while the engine was down.
  const workedBefore = record.workedMs ?? 0, from = performance.now()
  const worked = () => workedBefore + (performance.now() - from)
  const limitMs = record.caps.maxSeconds * 1000
  const timer = new AbortController()
  const timeout = setTimeout(() => timer.abort(), Math.max(0, limitMs - workedBefore))
  const cancel = new AbortController()
  const cancelled = () => cancel.signal.aborted || deps.cancel?.aborted === true || deps.cancelRequested?.() === true
  deps.cancel?.addEventListener("abort", () => cancel.abort(), { once: true })
  const interrupted = () => deps.interrupted?.aborted === true
  /** Aborted at the time limit, on cancel, or when the engine stops: passed to every model call. */
  const signal = AbortSignal.any([timer.signal, cancel.signal, ...(deps.interrupted ? [deps.interrupted] : [])])
  const halted = new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(interrupted() ? new Interrupted() : new Stop(cancelled() ? "cancelled" : "time")), { once: true }))
  halted.catch(() => {})
  /** A step that cannot take the abort signal (a search, the first pass) is left behind when the answer is halted. It still ends, and its cost is still counted (see `settle`). */
  const background = new Set<Promise<unknown>>()
  const inTime = <T>(work: Promise<T>): Promise<T> => { background.add(work); void work.catch(() => {}).finally(() => background.delete(work)); return Promise.race([work, halted]) }
  let slots = 0
  const waiting: (() => void)[] = []
  const slot = async <T>(work: () => Promise<T>): Promise<T> => {
    if (slots >= MAX_FIRST_PASS) await new Promise<void>((resolve) => waiting.push(resolve))
    slots++
    try { return await work() } finally { slots--; waiting.shift()?.() }
  }

  let own = 0, exaUsd = demo ? 0 : exaSpentBy(config, record.id)
  const reservations = new Map<string, number>()
  const spent = () => own + exaUsd
  let frozen = false // set when the engine is stopping: nothing more is written
  const save = () => { if (frozen) return; record.usd = Math.round(spent() * 1e6) / 1e6; record.workedMs = Math.round(worked()); saveRecord(config, record) }
  const notes: string[] = []
  let stopped: Stopped | undefined
  /** May a paid step that could cost `worst` dollars start? Returns why not, or undefined. A demo answer spends nothing. */
  const guard = (worst: number): StopReason | undefined => {
    if (interrupted()) throw new Interrupted()
    if (cancelled()) return "cancelled"
    if (worked() >= limitMs || timer.signal.aborted) return "time"
    if (demo) return undefined
    if (deps.paidOff()) return "paid_off"
    const reserved = [...reservations.values()].reduce((sum, usd) => sum + usd, 0)
    return spent() + reserved + worst > record.caps.maxUsd + 1e-9 ? "cap" : undefined
  }
  /** Note a reason to end early that was met inside a step running beside others; the answer ends once they are done. */
  let ending: StopReason | undefined
  const soft = (why: StopReason) => { ending ??= why }
  const asStop = (error: unknown): Stop | undefined => error instanceof Stop ? error : error instanceof PaidCallsOff ? new Stop("paid_off") : cancelled() ? new Stop("cancelled") : timer.signal.aborted ? new Stop("time") : undefined
  const message = (error: unknown) => scrub(error instanceof Error ? error.message : String(error), env, 200)

  /**
   * One paid or outside step, done once. Its outcome is stored under a stable key (the answer, the step, a hash of
   * its input) before anything relies on it; when an outcome is already stored, `work` is not run. A plain failure is
   * stored as an outcome. Not stored, because each ends this invocation: the engine stopping, a cancel, a limit, and
   * a key or model name a vendor refuses.
   */
  const asked = new Map<string, Promise<Outcome<unknown>>>()
  const keyOf = (step: string, input: unknown) => `${record.id}:${step}:${hash(input)}`
  /**
   * `guard` for one step: a step whose outcome is already stored costs nothing and is always let through. That is what
   * makes a restart safe with a cancel or a limit: everything that was done before is read back first, and the answer
   * ends at the first step that would have to be bought, with all it had.
   */
  const allow = (worst: number, step: string, input: unknown): StopReason | undefined => {
    if (interrupted()) throw new Interrupted()
    const key = keyOf(step, input)
    if (storedBefore.has(key) || asked.has(key) || reservations.has(key)) return undefined
    const why = guard(worst)
    if (!why && !demo) reservations.set(key, worst)
    return why
  }
  const once = async <T>(step: string, input: unknown, work: () => Promise<{ value: T; usd: number }>): Promise<T> => {
    const key = keyOf(step, input)
    // Two steps with the very same input (two searches that returned the same results) share one call and are charged once.
    const first = !asked.has(key)
    try {
      if (first) asked.set(key, deps.remember<T>(key, async () => {
        try { const done = await work(); return { ok: true, value: done.value, usd: done.usd } } catch (error) {
          const usd = Number((error as { usd?: unknown }).usd) || 0
          if (error instanceof Interrupted || interrupted()) throw new Interrupted()
          const stop = asStop(error)
          if (stop) { own += usd; throw stop }
          if (error instanceof FatalModelError) { own += usd; throw error }
          if (error instanceof Error && isFatalModelError(error.message)) { own += usd; throw new FatalModelError(`This answer was stopped on its first failed call: a model's key or name was refused by its vendor. Nothing more was spent on it. Check the keys in .env and the model ids in board/config.yaml. Vendor message: ${error.message}`) }
          return { ok: false, error: message(error), usd }
        }
      }))
      const outcome = (await asked.get(key)) as Outcome<T>
      if (first) own += outcome.usd
      save()
      if (!outcome.ok) throw new StepFailed(outcome.error)
      return outcome.value
    } finally {
      if (first) reservations.delete(key)
    }
  }
  const model = (step: string, input: unknown, ask: () => Promise<Reply>) => once(step, input, async () => { const reply = await ask(); return { value: { text: reply.text, truncated: reply.truncated }, usd: reply.usd } })
  /** A first-pass call: a FirstPass of its own, so that its cost is known exactly, also when it throws. */
  const firstPassOnce = <T>(step: string, input: unknown, ask: (firstPass: FirstPass) => Promise<T>) => inTime(once(step, input, () => slot(async () => {
    const firstPass = deps.firstPass()
    try { return { value: await ask(firstPass), usd: firstPass.usd } } catch (error) { throw Object.assign(error instanceof Error ? error : new Error(String(error)), { usd: firstPass.usd }) }
  })))

  // ── steps ────────────────────────────────────────────────────────────────────────────────────
  const running = new Map<string, { from: number; row: StepRecord }>()
  const begin = (start: StepStart) => {
    const row: StepRecord = { ...start, status: "running" }
    record.steps.push(row)
    running.set(start.step, { from: performance.now(), row })
    emit(`step.started:${start.step}`, { type: "step.started", ...start })
  }
  const end = (step: string, status: StepStatus, more: Omit<StepEnd, "step" | "status" | "ms"> = {}) => {
    const open = running.get(step)
    if (!open) return
    running.delete(step)
    const ms = Math.max(0, Math.round(performance.now() - open.from))
    const clean = { ...more, ...(more.error ? { error: scrub(more.error, env, 300) } : {}) }
    // When this step's end is already in the log (a replay after a restart), the log's line is the truth: its time was measured then.
    const { status: s, ms: m, found, kept, summary, error, consequence } = emit(`step.finished:${step}`, { type: "step.finished", step, status, ms, ...clean }) as unknown as StepEnd
    Object.assign(open.row, JSON.parse(JSON.stringify({ status: s, ms: m, found, kept, summary, error, consequence })))
  }
  /** Close a step for a reason that ends the answer: cancelled by a person, or a limit. */
  const endFor = (step: string, why: StopReason, consequence?: string) => why === "cancelled" ? end(step, "cancelled") : end(step, "failed", { error: `This step did not finish: ${STOP_WORDS[why]}.`, ...(consequence ? { consequence } : {}) })

  const thread: ThreadTurn[] = deps.earlier.filter((r) => r.mode === record.mode && r.answer && r.status === "done").slice(-5).map((r) => ({ question: oneLine(r.question, 300), direct: oneLine(r.answer?.direct, 400) }))
  const pool: Candidate[] = []
  const notSelected: (Selection["notSelected"][number] & { order: number })[] = []
  const lines: (SearchLine & { slot: number })[] = []
  let sources: StoredSource[] = []
  let reviewNotes: ReviewNote[] = []
  let tested: PlannedHypothesis[] = []
  let cut: { text: string; reason: string }[] = []
  let proposed: string[] = []
  let medical = looksMedical(record.question)
  /** Cited sentences of the shown text that no check reached are recorded as not checked: a missing check is said, never left blank. */
  const markUnchecked = (why: StopReason) => {
    if (record.statements.length || !sources.length || !record.answer) return
    record.statements = citedSentences(record.answer.markdown).map((sentence, index) => ({ stage: "draft" as const, index, text: sentence.text, sources: sentence.sources, ...(sentence.hypothesis ? { hypothesis: sentence.hypothesis } : {}), ...(sentence.hypothesis && sentence.side ? { side: sentence.side } : {}), verdict: "unchecked" as const, quoteFound: false, checker: brain.names.checker, note: `not checked: ${STOP_WORDS[why]}` }))
    for (const s of record.statements) emit(`statement:unchecked:${s.index}`, { type: "statement.checked", ...s })
  }
  /** A step that an earlier invocation started and this one never reached again (the engine stopped in it) is closed with the answer. */
  const closeLeftOpen = (status: StepStatus, error?: string) => {
    for (const step of log.openSteps()) emit(`step.finished:${step}`, { type: "step.finished", step, status, ms: 0, ...(error ? { error: scrub(error, env, 300) } : {}) })
  }
  /** Calls left behind at a halt still end and are still billed: wait for them (not for ever), so their cost is in the record. */
  const settle = async () => { if (background.size) await Promise.race([Promise.allSettled([...background]), new Promise((resolve) => setTimeout(resolve, 20_000).unref())]) }

  let storedBefore = new Set<string>()
  try {
    storedBefore = new Set(resumed && deps.stored ? await deps.stored() : [])
    if (resumed) emit(`resumed:${log.lastSeq}`, { type: "research.resumed", afterSeq: log.lastSeq })
    else emit("started", { type: "research.started", id: record.id, thread: record.thread, question: record.question, effort: record.effort, mode: record.mode, caps: record.caps, models: record.models })
    save()

    // ── prepare: the queries and the opening sentence ────────────────────────────────────────────
    const databasesOn = !demo && Boolean(deps.database) && level.databaseLookups > 0
    let plan = fallbackPlan(record.question)
    {
      const system = plannerSystem({ web: level.exaSearches, literature: level.queries, databases: databasesOn ? level.databaseLookups : 0 })
      const user = plannerUser(record.question, thread)
      begin({ step: "prepare", kind: "prepare", label: "Preparing the searches", agent: "planner", input: { model: brain.names.planner, level: record.effort, webSearches: level.exaSearches, literatureQueries: level.queries, databaseLookups: databasesOn ? level.databaseLookups : 0 } })
      const why = allow(brain.worstCase("plan", system.length + user.length), "plan", { system, user })
      if (why) { endFor("prepare", why); throw new Stop(why) }
      try {
        plan = readPlan((await model("plan", { system, user }, () => brain.plan(system, user, signal))).text, record.question, level)
        if (!databasesOn) plan = { ...plan, databases: [] }
      } catch (error) {
        if (!(error instanceof StepFailed)) { const stop = asStop(error); if (stop) endFor("prepare", stop.reason); throw stop ?? error }
        // The planner failing is not a reason to fail the answer: the question's own words are searched.
      }
      if (demo) plan = { ...plan, opening: "This is a demo: I'll go through the same steps with example sources and fixed text, so nothing is searched and no model is asked." }
      if (plan.fallback && !demo) {
        notes.push("The query planner's reply could not be used, so the question's own words were searched.")
        end("prepare", "failed", { error: "The query planner's reply could not be used.", consequence: "The question's own words are searched instead." })
      } else end("prepare", "completed", { summary: demo ? "Example sources only." : `${plural(plan.web.length, "web search", "web searches")}, ${plural(plan.literature.length, "literature query", "literature queries")}${plan.databases.length ? `, ${plural(plan.databases.length, "database lookup")}` : ""} planned.` })
      medical = medical || plan.medical
      record.opening = plan.opening
      emit("opening", { type: "opening", text: plan.opening })
      save()
    }

    // ── method specialists: chosen by code from the question, before anything is searched ─────────
    // The matcher compares the question's words with the method notes (specialists.ts). No model chooses. The chosen
    // ones are named now, so a person sees who joined; each works once the searches have given it sources.
    const invited = (level.specialists > 0 && deps.specialists ? deps.specialists(record.question) : []).slice(0, level.specialists)
    const notesOf = new Map(invited.map((m) => [m.specialist.name, answerNotes(m.specialist, m.methods)]))
    const team: AnswerSpecialist[] = invited.map((m) => ({
      name: m.specialist.name, title: m.specialist.title, agent: specialistAgent(m.specialist.name),
      why: `Its method notes match the question's words: ${m.words.slice(0, 6).join(", ")}.`, methods: m.methods.map((x) => ({ name: x.name, title: x.title })),
    }))
    if (team.length) { record.specialists = team; emit("specialists", { type: "specialists", items: team }); save() } else delete record.specialists

    // ── hypotheses (Standard level): what to test, written before anything is searched ─────────────
    // Each hypothesis needs one web search and one literature query of the level, so the level's own limits say how
    // many can be tested. No limit is raised for them; what does not fit is set aside and said.
    if (level.hypotheses > 0) {
      const fit = Math.min(level.hypotheses, level.exaSearches, level.queries, Math.floor(level.sourcesKept / 2))
      const system = hypothesesSystem({ max: MAX_HYPOTHESES, databases: databasesOn }), user = hypothesesUser(record.question, thread)
      begin({ step: "hypotheses", kind: "hypothesize", label: "Setting up hypotheses to test", agent: "planner", input: { model: brain.names.planner, atMost: fit } })
      const why = allow(brain.worstCase("hypothesize", system.length + user.length), "hypotheses", { system, user })
      if (why) { endFor("hypotheses", why); throw new Stop(why) }
      let set: ReturnType<typeof readHypotheses> = { needed: false, reason: "The hypotheses could not be set up, so the question is answered without them.", items: [], cut: [] }
      try { set = readHypotheses((await model("hypotheses", { system, user }, () => brain.hypothesize(system, user, signal))).text, fit, databasesOn) } catch (error) {
        if (!(error instanceof StepFailed)) { const stop = asStop(error); if (stop) endFor("hypotheses", stop.reason); throw stop ?? error }
      }
      tested = set.items
      record.hypotheses = tested.map(({ id, text, supportIf, contradictIf, origin }) => ({ id, text, supportIf, contradictIf, origin, agent: investigatorOf(id) }))
      const cutNote = set.cut.length ? `${plural(set.cut.length, "more hypothesis", "more hypotheses")} ${set.cut.length === 1 ? "was" : "were"} proposed and not tested, because ${set.cut[0].reason}.` : ""
      if (!tested.length || cutNote) record.hypothesesNote = [tested.length ? "" : set.reason ?? "No hypotheses were needed.", cutNote].filter(Boolean).join(" ")
      cut = set.cut
      end("hypotheses", "completed", { found: tested.length, summary: tested.length ? `${plural(tested.length, "hypothesis", "hypotheses")} to test. Each gets its own web search and literature search; the general searches planned before are not run on top.${cutNote ? ` ${cutNote}` : ""}` : `None: ${set.reason ?? "not needed"}` })
      emit("hypotheses", { type: "hypotheses", items: record.hypotheses, needed: set.needed, ...(tested.length ? {} : { reason: set.reason }), ...(set.cut.length ? { cut: set.cut } : {}) })
      save()
    }

    // ── search and evaluate ──────────────────────────────────────────────────────────────────────
    // Every search has a place in the plan (`slot`). Sources are ordered by it and results are compared only with
    // what earlier STAGES found (`known`), never with a search running beside it: so the outcome does not depend on
    // which reply arrived first, and a replay after a restart gives the same numbered list.
    interface Tag { hypothesis: PlannedHypothesis; index: number; place: number; chain: Set<string> }
    const counter = new Map<Provider, number>()
    let slotNumber = 1_000 // searches that belong to no hypothesis come after those that do
    const line = (l: SearchLine & { slot: number }) => { lines.push(l); record.searches = [...lines].sort((a, b) => a.slot - b.slot).map(({ slot: _slot, ...rest }) => rest); save() }
    const keysOf = () => new Set(pool.map((c) => urlKey(c.item.url)))
    /** Screen one search's results and add what is kept to the pool. */
    const evaluate = async (provider: Provider, i: number, place: number, query: string, found: EvidenceItem[], known: Set<string>, tag?: Tag) => {
      const fresh = found.filter((item) => !known.has(urlKey(item.url)))
      const order = (item: EvidenceItem) => place * 1_000 + found.indexOf(item)
      const hypothesis = tag?.hypothesis ? { hypothesis: tag.hypothesis.id } : {}
      const agent = tag?.hypothesis ? investigatorOf(tag.hypothesis.id) : "searcher"
      // For a hypothesis, results are screened against the hypothesis itself: does this help to test it.
      const question = tag?.hypothesis ? oneLine(`Is this so: ${tag.hypothesis.text} (Evidence for it or against it both count.)`, 600) : plan.keyQuestion
      let kept = found.length - fresh.length
      if (fresh.length) {
        const step = `evaluate:${provider}:${i}`
        begin({ step, kind: "evaluate", label: `Screening ${plural(fresh.length, "result")}`, provider, agent, input: { results: fresh.length, model: brain.names.planner, question }, ...hypothesis })
        const screening = { items: fresh.map((f) => [f.url, f.title, f.text]), question }
        const why = allow(brain.worstCase("screen", fresh.reduce((n, it) => n + Math.min(1_500, it.text.length) + Math.min(200, it.title.length) + 30, 600 + question.length)), `screen:${provider}`, screening)
        if (why) { endFor(step, why, "These results were not screened and are not used."); line({ provider, query, ran: true, found: found.length, kept, slot: place, ...(tag?.hypothesis ? { hypothesis: tag.hypothesis.id } : {}) }); throw new Stop(why) }
        try {
          let screened = await firstPassOnce(`screen:${provider}`, screening, (firstPass) => firstPass.triage(fresh, question))
          // A database record (a trial registration, a label) often "reports no results of its own": it is kept unless it is off the question, as the board keeps it.
          const record_ = (DATABASES as readonly string[]).includes(provider)
          screened = screened.map((s) => (record_ && !s.keep && s.item.relevance !== 0 ? { ...s, keep: true } : s))
          screened.forEach((s, at) => {
            if (s.keep) { pool.push({ item: s.item, provider, order: order(fresh[at]), ...hypothesis }); tag?.chain?.add(urlKey(s.item.url)); kept++ }
            else notSelected.push({ title: s.item.title, url: s.item.url, provider, order: order(fresh[at]), reason: s.item.relevance === 0 ? "Screened as not about the question." : "Screened as background only: it reports no findings of its own and is not a review." })
          })
          end(step, "completed", { found: fresh.length, kept: screened.filter((s) => s.keep).length, summary: `${screened.filter((s) => s.keep).length} of ${fresh.length} kept.` })
        } catch (error) {
          if (!(error instanceof StepFailed)) { const stop = asStop(error); if (stop) { endFor(step, stop.reason, "These results were not screened and are not used."); line({ provider, query, ran: true, found: found.length, kept, slot: place, ...(tag?.hypothesis ? { hypothesis: tag.hypothesis.id } : {}) }) } throw stop ?? error }
          for (const item of fresh) { pool.push({ item, provider, order: order(item), ...hypothesis }); tag?.chain?.add(urlKey(item.url)); kept++ } // not screened: kept, as triage.ts keeps an item whose screening is missing
          notes.push(`The results of one ${providerName(provider)} search could not be screened for relevance and were kept as found.`)
          end(step, "failed", { found: fresh.length, kept: fresh.length, error: `The screening did not answer (${error.message}).`, consequence: "These results were kept without screening, so some may be off the question." })
        }
      }
      line({ provider, query, ran: true, found: found.length, kept, slot: place, ...(tag?.hypothesis ? { hypothesis: tag.hypothesis.id } : {}) })
    }
    /**
     * One search step, then the screening of what it found. `run` gives the results or throws; `refuse` is a reason not
     * to run at all. The search's outcome is stored (also "it failed" and "it was refused"), so a replay does not search again.
     */
    const search = async (provider: Provider, query: string, input: Record<string, string | number | boolean>, known: Set<string>, run: () => Promise<SearchResult>, refuse?: () => string | undefined, tag?: Tag) => {
      // Step numbers and places come from the plan when the search belongs to a hypothesis (its chain runs beside the
      // others, so the order of calls is not the order of the plan); otherwise from the order of the calls, which is the plan's.
      const i = tag?.index ?? (counter.get(provider) ?? 0) + 1
      counter.set(provider, Math.max(counter.get(provider) ?? 0, i))
      const place = tag?.place ?? slotNumber++
      const step = `search:${provider}:${i}`
      begin({ step, kind: "search", label: SEARCH_LABEL[provider] ?? `Searching ${providerName(provider)}`, provider, query, agent: tag?.hypothesis ? investigatorOf(tag.hypothesis.id) : "searcher", input: { provider: providerName(provider), query, ...input }, ...(tag?.hypothesis ? { hypothesis: tag.hypothesis.id } : {}) })
      const stop = allow(0, `search:${provider}`, { query, input })
      if (stop) { endFor(step, stop); throw new Stop(stop) }
      let result: { items: EvidenceItem[]; notices: string[] }
      try {
        result = await inTime(once(`search:${provider}`, { query, input }, async () => {
          const refused = refuse?.()
          if (refused) throw new StepFailed(refused)
          const got = await run()
          return { value: { items: got.items, notices: got.notices }, usd: 0 } // a free search; an Exa search is counted from the Exa ledger
        }))
      } catch (error) {
        if (!(error instanceof StepFailed)) { const halt = asStop(error); if (halt) endFor(step, halt.reason); throw halt ?? error }
        const why = /did not run|refused/.test(error.message) ? error.message : `${providerName(provider)} could not be used (${error.message}).`
        end(step, "failed", { error: why, consequence: NOT_SEARCHED[provider] ?? `${providerName(provider)} was not searched, so this answer rests on the other searches only.` })
        return line({ provider, query, ran: false, found: 0, kept: 0, reason: scrub(why, env, 300), slot: place, ...(tag?.hypothesis ? { hypothesis: tag.hypothesis.id } : {}) })
      }
      const found = usable(result.items, provider)
      result.items.forEach((item, at) => { if (item && safeUrl(item.url) && !found.some((f) => f.url === item.url)) notSelected.push({ title: oneLine(item.title, MAX_TITLE_CHARS) || item.url, url: item.url, provider, order: place * 1_000 + at, reason: "No text came back for it, so nothing could be checked against it." }) })
      const said = result.notices.map((n) => oneLine(n, 200)).filter(Boolean)[0]
      if (!found.length) {
        end(step, "empty", { found: 0, summary: said ?? "The search ran and found nothing." })
        return line({ provider, query, ran: true, found: 0, kept: 0, slot: place, ...(tag?.hypothesis ? { hypothesis: tag.hypothesis.id } : {}) })
      }
      end(step, "completed", { found: found.length, summary: `${plural(found.length, "result")}.${said ? ` ${said}` : ""}` })
      await evaluate(provider, i, place, query, found, known, tag)
    }
    const web = (w: { query: string; objective: string }, known: Set<string>, tag?: Tag) => {
      const callId = `exa:${hash([w.query, w.objective])}`
      let reserved = 0
      return search("exa", w.query, { objective: w.objective, type: "auto", contents: "highlights" }, known, async () => {
        let result: SearchResult
        try { result = await deps.exa(w.query, w.objective) } catch (error) {
          settleSearch(config, record.id, callId, reserved, { failed: true }) // a search that failed is not charged
          exaUsd = exaSpentBy(config, record.id)
          throw error instanceof PaidCallsOff ? new StepFailed(`The web search did not run: ${STOP_WORDS.paid_off}.`) : error
        }
        settleSearch(config, record.id, callId, reserved, { reported: result.costUsd })
        exaUsd = exaSpentBy(config, record.id)
        save()
        return result
      }, () => {
        if (!env.EXA_API_KEY?.trim()) return "The web search did not run: EXA_API_KEY is not set."
        const why = guard(exaAssumed(config))
        if (why) return `The web search did not run: ${STOP_WORDS[why]}.`
        const reservation = reserveSearch(config, record.id, callId) // the lifetime Exa ceiling (exaledger.ts); written before the request
        if (!reservation.ok) return reservation.message
        reserved = reservation.reserved
        exaUsd = exaSpentBy(config, record.id)
        return undefined
      }, tag)
    }
    /** Run steps side by side. Each one ends its own step; the first reason to end the answer is thrown once all are done. */
    const together = async (work: Promise<void>[]) => {
      const failures = (await Promise.allSettled(work)).flatMap((r) => (r.status === "rejected" ? [r.reason as unknown] : []))
      const first = failures.find((f) => f instanceof Interrupted) ?? failures.find((f) => !(f instanceof Stop)) ?? failures[0]
      if (first) throw first
    }
    /** The searches of one hypothesis: its web search first, then its literature search and (when it has one and the level has room) its database lookup. */
    const databaseOf = new Map(tested.filter((h) => h.database).slice(0, level.databaseLookups).map((h) => [h.id, h.database!]))
    const chainOf = async (h: PlannedHypothesis, at: number) => {
      const chain = new Set<string>() // what this hypothesis's own searches already kept: nothing a search beside it found
      const tag = (stage: number, index: number): Tag => ({ hypothesis: h, index, place: at * 10 + stage, chain })
      if (deps.fixtures) return search("fixture", oneLine(h.text, MAX_QUERY_CHARS), { note: "Example sources. Nothing is searched in a demo." }, new Set(), () => deps.fixtures!(h.text), undefined, tag(0, at + 1))
      await web(h.web, new Set(), tag(0, at + 1))
      const db = databaseOf.get(h.id)
      const sameBefore = db ? tested.slice(0, at).filter((x) => databaseOf.get(x.id)?.source === db.source).length : 0
      await together([
        search("europepmc", h.literature, { maxResults: 8, text: "abstracts" }, new Set(chain), () => deps.literature(h.literature), undefined, tag(1, at + 1)),
        ...(db && deps.database ? [search(db.source, db.query, { text: "database records" }, new Set(chain), () => deps.database!(db.source, db.query), undefined, tag(2, sameBefore + 1))] : []),
      ])
    }
    if (tested.length) await together(tested.map((h, at) => chainOf(h, at))) // every hypothesis at the same time, each opened by its web search
    else if (deps.fixtures) await search("fixture", oneLine(record.question, MAX_QUERY_CHARS), { note: "Example sources. Nothing is searched in a demo." }, new Set(), () => deps.fixtures!(record.question))
    else {
      // The web search opens every answer. What it cannot do is said, and the other searches still run, all at once.
      const [first, ...moreWeb] = plan.web.slice(0, level.exaSearches)
      await web(first, new Set())
      const afterFirst = keysOf()
      await together([
        ...moreWeb.map((w) => web(w, afterFirst)),
        ...plan.literature.slice(0, level.queries).map((q) => search("europepmc", q, { maxResults: 8, text: "abstracts" }, afterFirst, () => deps.literature(q))),
        ...plan.databases.slice(0, level.databaseLookups).map((d) => search(d.source, d.query, { text: "database records" }, afterFirst, () => deps.database!(d.source, d.query))),
      ])
      // A follow-up may list sources of the answer before it again, when they pass screening for the new question.
      const last = deps.earlier.filter((r) => r.mode === "real" && r.status === "done").at(-1)
      const known = keysOf()
      const again = (last?.sources ?? []).filter((s) => s.provider !== "fixture" && !known.has(urlKey(s.url)) && safeUrl(s.url) && s.text?.length >= 40)
      const items = again.map((s) => ({ url: s.url, title: s.title, text: s.text }))
      const rescreening = { items: items.map((f) => [f.url, f.title, f.text]), question: plan.keyQuestion }
      if (again.length && !allow(brain.worstCase("screen", again.reduce((n, s) => n + Math.min(1_500, s.text.length) + 230, 600)), "screen:earlier", rescreening)) {
        const place = slotNumber++
        begin({ step: "evaluate:earlier", kind: "evaluate", agent: "searcher", label: `Screening ${plural(again.length, "source")} of the earlier answer`, input: { results: again.length, from: last!.id } })
        try {
          const screened = await firstPassOnce("screen:earlier", rescreening, (firstPass) => firstPass.triage(items, plan.keyQuestion))
          let kept = 0
          screened.forEach((s, at) => { if (s.keep && s.item.relevance === 1) { pool.push({ item: s.item, provider: again[at].provider, earlier: true, order: place * 1_000 + at }); kept++ } })
          end("evaluate:earlier", "completed", { found: again.length, kept, summary: `${kept} of ${again.length} listed again.` })
        } catch (error) {
          if (!(error instanceof StepFailed)) { const stop = asStop(error); if (stop) endFor("evaluate:earlier", stop.reason); throw stop ?? error }
          end("evaluate:earlier", "failed", { error: `The screening did not answer (${error.message}).`, consequence: "No source of the earlier answer is listed again." })
        }
      }
    }

    // ── sources and the selection ────────────────────────────────────────────────────────────────
    sources = numberSources(pool, level.sourcesKept, tested.map((h) => h.id))
    const numbered = new Set(sources.map((s) => urlKey(s.url)))
    const seen = new Set<string>()
    for (const c of [...pool].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
      const key = urlKey(c.item.url)
      if (numbered.has(key) || seen.has(key)) continue
      seen.add(key)
      notSelected.push({ title: c.item.title, url: c.item.url, provider: c.provider, order: (c.order ?? 0) + 1e9, reason: `Passed screening, but at most ${level.sourcesKept} sources are numbered at the ${record.effort} level and more relevant ones came first.` })
    }
    record.sources = sources
    record.selection = selectionOf(sources, notSelected.sort((a, b) => a.order - b.order).map(({ order: _order, ...rest }) => rest), level.sourcesKept, record.effort, lines.reduce((sum, l) => sum + l.found, 0) + notSelected.filter((n) => n.reason.startsWith("No text came back")).length)
    emit("sources", { type: "sources", items: record.sources.map(({ text: _t, studyType: _s, relevance: _r, ...s }) => s) })
    emit("selection", { type: "selection", ...record.selection })
    save()

    const searched = () => record.searches.map((s) => s.ran ? `${providerName(s.provider)} for "${s.query}" (${s.found} found, ${s.kept} kept)` : `${providerName(s.provider)} did not run (${s.reason})`).join("; ")
    if (!sources.length) {
      // Written by code: with no source there is nothing a model may say.
      const text = `**No usable source was found for this question.** The searches below returned nothing that passed screening, so no answer was written.\n\nWhat was searched: ${searched() || "nothing"}.\n\nTry the question with other words, or name the drug, gene or disease you mean.`
      record.draft = text
      record.answer = { markdown: text, direct: directAnswer(text) }
      emit("answer.written", { type: "answer.written", markdown: text })
    } else {
      // ── write ──────────────────────────────────────────────────────────────────────────────────
      const testing = record.hypotheses ?? []
      const urls = sources.map((s) => s.url)
      // ── hypotheses: one investigator per hypothesis drafts its own section, all at the same time ──────
      // An investigator is given its own hypothesis and the sources its searches found, under their numbers in the
      // answer's list. Only its section is passed on: the checker and the critic get its sentences and the sources.
      let sectionsText = ""
      if (testing.length) {
        const share = Math.max(70, Math.floor(level.words / (testing.length + 1)))
        const drafted = await Promise.allSettled(testing.map(async (h): Promise<string> => {
          const label = h.id.toUpperCase(), heading = `### ${label}: ${clip(h.text.replace(/^demo hypothesis:\s*/i, ""), 90).replace(/\.$/, "")}`
          const own = sources.filter((src) => src.hypotheses?.includes(h.id))
          if (!own.length) return `${heading}\n**Not found:** no source that passed screening was found for this hypothesis.` // written by code: there is nothing to draft from
          const step = `write:${h.id}`, agent = investigatorOf(h.id)
          const iSystem = investigatorSystem(share, label), iUser = investigatorUser({ question: record.question, hypothesis: h, searches: record.searches.filter((line) => line.hypothesis === h.id), sources })
          begin({ step, kind: "write", label: `Drafting the section for ${label} from ${plural(own.length, "source")}`, hypothesis: h.id, agent, input: { model: brain.names.writer, sources: own.length, maxOutputTokens: sectionTokens(level), words: share } })
          const why = allow(brain.worstCase("section", iSystem.length + iUser.length), step, { iSystem, iUser })
          if (why) { endFor(step, why, "No answer was written. The sources that were found are listed."); throw new Stop(why) }
          let text: string
          try { text = splitBlocks((await model(step, { iSystem, iUser }, () => brain.section(iSystem, iUser, signal))).text).markdown } catch (error) {
            if (!(error instanceof StepFailed)) { const stop = asStop(error); if (stop) endFor(step, stop.reason); else if (!(error instanceof Interrupted)) end(step, "failed", { error: "The investigator's key or model name was refused by its vendor." }); throw stop ?? error }
            notes.push(`The section for ${label} could not be drafted (${error.message}).`)
            end(step, "failed", { error: `The investigator did not answer (${error.message}).`, consequence: `${label} has no drafted section, so nothing is filed for or against it.` })
            return `${heading}\n**Not found:** the section for this hypothesis could not be drafted.`
          }
          // Code makes the section what it must be: this hypothesis's heading and no other, and only markers of sources this investigator was given.
          const allowed = new Set(own.map((src) => src.n))
          const body = cleanAnswer(text, sources.length, urls).markdown.split("\n").filter((l) => !/^\s*#{1,6}\s/.test(l) && !/not medical advice/i.test(l)).join("\n")
            .replace(/[ \t]*\[(\d{1,2})\]/g, (whole, n: string) => (allowed.has(Number(n)) ? whole : "")).trim()
          end(step, "completed", { summary: `${plural(citedSentences(`${heading}\n${body}`).length, "cited sentence")}.` })
          return `${heading}\n${body || "**Not found:** the investigator wrote nothing for this hypothesis."}`
        }))
        const failures = drafted.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason as unknown)
        if (failures.length) throw failures.find((f) => f instanceof Interrupted) ?? failures.find((f) => !(f instanceof Stop)) ?? failures[0]
        sectionsText = drafted.map((r) => (r as PromiseFulfilledResult<string>).value).join("\n\n")
      }
      // ── method specialists: each drafts one short section from the sources the searches found ─────
      // A specialist is an extra, so it never takes money the answer itself needs: it is asked only when its worst case
      // fits beside the worst case of the draft, the critic and the revision. One that is not asked is said so, and the answer goes
      // on. Its section becomes part of the draft, so the statement checker and the critic review it like the rest.
      let specialistText = ""
      if (team.length) {
        const share = Math.max(60, Math.floor(level.words / 3))
        const wSystem = writerSystem(level.words), wUser = writerUser({ question: record.question, thread, searches: record.searches, sources })
        const needed = brain.worstCase("write", wSystem.length + wUser.length) + brain.worstCase("critic", wSystem.length + wUser.length) + brain.worstCase("revise", wSystem.length + wUser.length)
        const drafted = await Promise.allSettled(team.map(async (who): Promise<string> => {
          const step = `specialist:${who.name}`, heading = `### Method view: ${who.title}`
          const sSystem = specialistSystem(share, who.title), sUser = specialistUser({ question: record.question, why: who.why, notes: notesOf.get(who.name) ?? "", searches: record.searches, sources })
          const bought = storedBefore.has(keyOf(step, { sSystem, sUser }))
          // A step that ended before with nothing stored was not asked then; a replay takes the same path.
          const passedOver = !bought && log.has(`step.finished:${step}`)
          begin({ step, kind: "write", label: `${who.title}: reading ${plural(sources.length, "source")} with its method notes`, agent: who.agent, input: { model: brain.specialistModel, sources: sources.length, maxOutputTokens: sectionTokens(level), words: share } })
          const worst = brain.worstCase("specialist", sSystem.length + sUser.length)
          const whyNot = bought ? undefined : passedOver ? "cap" : guard(worst + needed) ?? allow(worst, step, { sSystem, sUser })
          if (whyNot) { end(step, "empty", { summary: `Not asked: ${STOP_WORDS[whyNot]}.`, consequence: "The answer has no section from this specialist." }); return "" }
          let text: string
          try { text = splitBlocks((await model(step, { sSystem, sUser }, () => brain.specialist(sSystem, sUser, signal))).text).markdown } catch (error) {
            if (!(error instanceof StepFailed)) { const stop = asStop(error); if (stop) endFor(step, stop.reason); else if (!(error instanceof Interrupted)) end(step, "failed", { error: "The specialist's key or model name was refused by its vendor." }); throw stop ?? error }
            notes.push(`The ${who.title} did not answer (${error.message}), so the answer has no section from it.`)
            end(step, "failed", { error: `The specialist did not answer (${error.message}).`, consequence: "The answer has no section from this specialist." })
            return ""
          }
          const body = cleanAnswer(text, sources.length, urls).markdown.split("\n").filter((l) => !/^\s*#{1,6}\s/.test(l) && !/not medical advice/i.test(l)).join("\n").trim()
          const cited = citedSentences(`${heading}\n${body}`).length
          end(step, cited ? "completed" : "empty", { summary: cited ? `${plural(cited, "cited sentence")}.` : "It wrote no sentence with a source, so nothing from it is shown." })
          return cited ? `${heading}\n${body}` : ""
        }))
        const failures = drafted.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason as unknown)
        if (failures.length) throw failures.find((f) => f instanceof Interrupted) ?? failures.find((f) => !(f instanceof Stop)) ?? failures[0]
        specialistText = drafted.map((r) => (r as PromiseFulfilledResult<string>).value).filter(Boolean).join("\n\n")
      }
      const system = testing.length ? leadSystem(level.words) : writerSystem(level.words), user = testing.length ? leadUser({ question: record.question, thread, hypotheses: testing, searches: record.searches, sections: sectionsText }) : writerUser({ question: record.question, thread, searches: record.searches, sources })
      begin({ step: "write", kind: "write", agent: "writer", label: testing.length ? "Comparing the hypotheses" : `Writing the answer from ${plural(sources.length, "source")}`, input: { model: brain.names.writer, sources: sources.length, maxOutputTokens: level.maxOutputTokens, words: level.words } })
      const whyNot = allow(brain.worstCase("write", system.length + user.length), "write", { system, user })
      if (whyNot) { endFor("write", whyNot, "No answer was written. The sources that were found are listed."); throw new Stop(whyNot) }
      // The draft is streamed as it is written, up to the NEXT STEPS line, which a program reads and a person never sees.
      // After a restart in the middle of the writing, the text is written again and is not streamed a second time.
      const streamed = log.has("answer.delta:0")
      let all = "", sent = 0, piece = 0, last = performance.now()
      const flush = (final: boolean) => {
        if (streamed) return
        const marker = all.search(/\n[ \t>*_#]*NEXT STEPS/i)
        const upTo = marker >= 0 ? marker : final ? all.length : Math.max(sent, all.length - 16)
        if (upTo > sent) { emit(`answer.delta:${piece++}`, { type: "answer.delta", text: all.slice(sent, upTo) }); sent = upTo; last = performance.now() }
      }
      let reply: { text: string; truncated: boolean }
      try { reply = await model("write", { system, user }, () => brain.write(system, user, signal, (text) => { all += text; if (all.length - sent >= 400 || performance.now() - last >= 500) flush(false) })) } catch (error) {
        const stop = error instanceof StepFailed ? undefined : asStop(error)
        if (stop) endFor("write", stop.reason, "No answer was written. The sources that were found are listed.")
        else if (!(error instanceof Interrupted)) end("write", "failed", { error: `The writer did not answer (${message(error)}).`, consequence: "No answer was written." })
        throw stop ?? (error instanceof StepFailed ? new Error(`the writer did not answer (${error.message})`) : error)
      }
      flush(true)
      const finishText = (raw: string, truncated: boolean) => {
        let text = truncated ? raw.slice(0, Math.max(raw.lastIndexOf(". ") + 1, raw.lastIndexOf(".\n") + 1) || raw.length) : raw
        const tidy = withoutRepeats(cleanAnswer(text, sources.length, urls).markdown)
        // A specialist's heading with nothing left under it (its only sentence was a repeat, or the revision removed it) is not shown.
        text = tidy.markdown.split("\n").filter((line, i, all) => !/^### Method view: /.test(line) || !/^(#|$)/.test(all.slice(i + 1).find((l) => l.trim()) ?? "")).join("\n").replace(/\n{3,}/g, "\n\n").trim()
        if (tidy.removed.length) notes.push(`${plural(tidy.removed.length, "sentence")} that the writer wrote twice ${tidy.removed.length === 1 ? "is" : "are"} shown once.`)
        for (const phrase of tidy.repeated.slice(0, 2)) notes.push(`The text repeats a phrase: "${oneLine(phrase, 120)}".`)
        if (truncated) text += "\n\n(The text was cut here: the writer reached its length limit.)"
        return medical && !demo ? withAdviceLine(text) : text
      }
      const first = splitBlocks(reply.text)
      // In an answer that tests hypotheses the writer's part is the first paragraph; the investigators' sections follow it.
      const opening = testing.length ? first.markdown.split(/\n(?=\s*#{1,6}\s)/)[0].split("\n").filter((l) => !/not medical advice/i.test(l)).join("\n").trim() || "The sections below give what the sources found report for and against each hypothesis." : first.markdown
      const draft = finishText([testing.length ? `${opening}\n\n${sectionsText}` : opening, specialistText].filter(Boolean).join("\n\n"), reply.truncated && !first.nextSteps.length)
      if (!draft.replace(ADVICE_LINE, "").trim()) { end("write", "failed", { error: "The writer returned no text.", consequence: "No answer was written." }); throw new Error("the writer returned no text") }
      proposed = first.nextSteps
      const cited = citedSentences(draft)
      end("write", "completed", { summary: `${plural(draft.split(/\s+/).length, "word")}, ${plural(cited.length, "cited sentence")}.` })
      record.draft = draft
      record.answer = { markdown: draft, direct: directAnswer(draft) }
      emit("answer.written", { type: "answer.written", markdown: draft })
      save()

      // ── review: the statement checker and the critic, both on all of it ──────────────────────────
      const textOf = (n: number) => { const s = sources[n - 1]; return `${s.title}\n${s.text}` }
      /** Check sentences against every source each cites: one call per source, all its sentences in it. One step. */
      const checkAll = async (step: string, stage: Statement["stage"], items: { index: number; sentence: Sentence }[]): Promise<Statement[]> => {
        if (!items.length) return []
        begin({ step, kind: "check", agent: "checker", label: `Checking ${plural(items.length, stage === "final" ? "changed statement" : "statement")} against ${items.length === 1 ? "its source" : "their sources"}`, input: { statements: items.length, checker: brain.names.checker, rule: "the checker must quote a passage; a program must find it in the source, with the statement's numbers" } })
        if (stage === "draft") emit("review.started:checker", { type: "review.started", reviewer: "checker", model: brain.names.checker, step })
        const rulings = new Map<number, SourceRuling[]>(items.map((i) => [i.index, []]))
        const settled = new Map<number, Statement>()
        /** Record one source's ruling on a sentence. When every source it cites has ruled, code gives the verdict and it is sent. */
        const add = (index: number, r: SourceRuling) => {
          const it = items.find((x) => x.index === index)!, all = rulings.get(index)!
          all.push(r)
          if (settled.has(index) || all.length < it.sentence.sources.length) return
          all.sort((a, b) => it.sentence.sources.indexOf(a.n) - it.sentence.sources.indexOf(b.n)) // the order the sentence cites them in, not the order the replies came in
          const statement = { ...verdictOf(stage, index, it.sentence, all, brain.names.checker), ...(stage === "final" ? { carried: false } : {}), ...(testing.length ? { agent: stage === "draft" && it.sentence.hypothesis ? investigatorOf(it.sentence.hypothesis) : "writer" } : {}) }
          settled.set(index, statement)
          emit(`statement:${stage}:${index}`, { type: "statement.checked", ...statement })
          emit(`step.progress:${step}:${settled.size}`, { type: "step.progress", step, done: settled.size, total: items.length })
        }
        const bySource = new Map<number, { index: number; sentence: Sentence }[]>()
        items.forEach((it, position) => {
          for (const n of it.sentence.sources) {
            if (position >= MAX_STATEMENTS) add(it.index, { n, failed: `more than ${MAX_STATEMENTS} cited sentences` })
            else bySource.set(n, [...(bySource.get(n) ?? []), it])
          }
        })
        let broke: unknown
        await Promise.all([...bySource].map(async ([n, group]) => {
          const fail = (failed: string) => { for (const it of group) add(it.index, { n, failed }) }
          if (!brain.checkerIndependent) return fail("no checker from another vendor than the writer is configured")
          const claims = group.map((it) => it.sentence.text), source = textOf(n)
          let why: StopReason | undefined
          try { why = (storedBefore.has(keyOf(`check:${stage}:${n}`, { claims, source })) ? undefined : ending) ?? allow(brain.worstCase("check", 1_400 + source.length + claims.reduce((sum, c) => sum + c.length + 30, 0)), `check:${stage}:${n}`, { claims, source }) } catch (error) { broke ??= error; return }
          if (why) { soft(why); return fail(STOP_WORDS[why]) }
          try {
            const out = await firstPassOnce(`check:${stage}:${n}`, { claims, source }, (firstPass) => firstPass.check(deps.writerModel, claims, source))
            group.forEach((it, i) => add(it.index, { n, ruling: out[i] }))
          } catch (error) {
            if (error instanceof StepFailed) return fail(`the check failed (${error.message})`)
            const stop = asStop(error)
            if (stop) { soft(stop.reason); return fail(STOP_WORDS[stop.reason]) }
            broke ??= error
          }
        }))
        if (broke) { if (!(broke instanceof Interrupted)) end(step, "failed", { error: "A model's key or name was refused by its vendor." }); throw broke }
        const out = items.map((it) => settled.get(it.index) as Statement)
        const c = countsOf(0, out)
        const summary = [c.verified && `${c.verified} hold up`, c.contradicted && `${c.contradicted} contradicted`, c.unsupported && `${c.unsupported} not supported`, c.unchecked && `${c.unchecked} not checked`].filter(Boolean).join(", ") + "."
        if (ending === "cancelled") end(step, "cancelled", { summary })
        else if (c.unchecked === out.length) end(step, "failed", { summary, error: `No statement could be checked: ${out[0].note?.replace(/^not checked: /, "") ?? "the check did not run"}.`, consequence: "No statement is shown as holding up." })
        else end(step, "completed", { summary })
        return out
      }
      const critique = async (): Promise<ReviewNote[]> => {
        begin({ step: "review", kind: "review", agent: "critic", label: "Reviewing the whole draft", input: { model: brain.names.critic, looksFor: "overreach, missing caveats, weight on preprints or reviews, sources that disagree, parts of the question that were skipped" } })
        emit("review.started:critic", { type: "review.started", reviewer: "critic", model: brain.names.critic, step: "review" })
        const unreviewed = "The draft was not reviewed as a whole. The statement checks still apply."
        if (!brain.criticIndependent) { notes.push("The critic did not run: no model from another vendor than the writer is configured."); end("review", "failed", { error: "No model from another vendor than the writer is configured for the critic.", consequence: unreviewed }); return [] }
        const cSystem = criticSystem(config), cUser = criticUser({ question: record.question, searches: record.searches, sources, draft, cited, hypotheses: testing })
        const why = (storedBefore.has(keyOf("critic", { cSystem, cUser })) ? undefined : ending) ?? allow(brain.worstCase("critic", cSystem.length + cUser.length), "critic", { cSystem, cUser })
        if (why) { soft(why); notes.push(`The critic did not run: ${STOP_WORDS[why]}.`); endFor("review", why, unreviewed); return [] }
        try {
          const read = readNotes((await model("critic", { cSystem, cUser }, () => brain.critique(cSystem, cUser, signal))).text, cited.length)
          if (!read) { notes.push("The critic's reply could not be read, so its review is missing."); end("review", "failed", { error: "The critic's reply could not be read.", consequence: unreviewed }); return [] }
          end("review", "completed", { found: read.length, summary: read.length ? `${plural(read.length, "note")}: ${(["blocking", "major", "minor"] as const).map((sev) => [read.filter((n) => n.severity === sev).length, sev] as const).filter(([n]) => n).map(([n, sev]) => `${n} ${sev}`).join(", ")}.` : "No problem found." })
          return read
        } catch (error) {
          if (error instanceof StepFailed) { notes.push(`The critic did not run (${error.message}).`); end("review", "failed", { error: `The critic did not answer (${error.message}).`, consequence: unreviewed }); return [] }
          const stop = asStop(error)
          if (stop) { soft(stop.reason); notes.push(`The critic did not finish: ${STOP_WORDS[stop.reason]}.`); endFor("review", stop.reason, unreviewed); return [] }
          if (!(error instanceof Interrupted)) end("review", "failed", { error: "The critic's key or model name was refused by its vendor." })
          throw error
        }
      }
      const reviewed = await Promise.allSettled([checkAll("check", "draft", cited.map((sentence, index) => ({ index, sentence }))), critique()])
      const broken = reviewed.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason as unknown)
      if (broken.some((b) => b instanceof Interrupted)) throw new Interrupted()
      const draftStatements = reviewed[0].status === "fulfilled" ? reviewed[0].value : []
      reviewNotes = reviewed[1].status === "fulfilled" ? reviewed[1].value : []
      record.statements = draftStatements
      record.review.notes = reviewNotes
      for (const n of reviewNotes) emit(`note:${n.index}`, { type: "review.note", ...n })
      save()
      if (broken.length) throw broken[0]
      if (ending) throw new Stop(ending)

      // ── revise, once ───────────────────────────────────────────────────────────────────────────
      // The revision is for what the review found: a sentence its source does not state or contradicts, and the critic's
      // notes. A sentence whose check did not run is not rewritten for that; it stays, shown as not checked.
      const failed = draftStatements.filter((s) => s.verdict === "contradicted" || s.verdict === "unsupported")
      const notPassed = draftStatements.filter((s) => s.verdict !== "verified")
      if (failed.length || reviewNotes.length) {
        const rSystem = reviserSystem(level.words, testing.length > 0)
        const rUser = reviserUser({ question: record.question, thread, searches: record.searches, sources, draft, statements: draftStatements, notes: reviewNotes, hypotheses: testing })
        const unrevised = "The first draft is shown, with the marks of its review."
        begin({ step: "revise", kind: "revise", agent: "writer", label: "Revising the answer once", input: { model: brain.names.writer, failedStatements: failed.length, criticNotes: reviewNotes.length } })
        const why = allow(brain.worstCase("revise", rSystem.length + rUser.length), "revise", { rSystem, rUser })
        if (why) { endFor("revise", why, unrevised); throw new Stop(why) }
        let revision: { text: string; truncated: boolean } | undefined
        try { revision = await model("revise", { rSystem, rUser }, () => brain.revise(rSystem, rUser, signal)) } catch (error) {
          if (!(error instanceof StepFailed)) { const stop = asStop(error); if (stop) endFor("revise", stop.reason, unrevised); throw stop ?? error }
          notes.push(`The revision did not run (${error.message}), so the first draft is shown with the marks of its review.`)
          end("revise", "failed", { error: `The writer did not answer (${error.message}).`, consequence: unrevised })
        }
        const split = revision ? splitBlocks(revision.text) : undefined
        let final = split ? finishText(split.markdown, revision!.truncated && !split.nextSteps.length && !split.reported.size) : ""
        if (revision && !final.replace(ADVICE_LINE, "").trim()) {
          notes.push("The revision came back empty, so the first draft is shown with the marks of its review.")
          end("revise", "failed", { error: "The revision came back empty.", consequence: unrevised })
        } else if (revision && split) {
          // A failed sentence kept word for word with its marker dropped gets the marker back: it stays a cited sentence, shown as failed.
          const byText = new Map(notPassed.map((s) => [sameText(s.text), s]))
          for (const sentence of sentencesOf(final)) {
            const was = sentence.sources.length ? undefined : byText.get(sameText(sentence.text))
            if (!was) continue
            const bare = sentence.text.replace(/[.!?]+$/, "")
            const at = final.indexOf(bare)
            if (at < 0) { notes.push(`A sentence that failed its check was kept in the revision without its citation: "${oneLine(sentence.text, 160)}"`); continue }
            final = `${final.slice(0, at + bare.length)} ${was.sources.map((n) => `[${n}]`).join("")}${final.slice(at + bare.length)}`
          }
          const before = new Map(draftStatements.map((s) => [statementKey(s), s]))
          const finalCited = citedSentences(final)
          const carried = new Map<number, Statement>(), fresh: { index: number; sentence: Sentence }[] = []
          finalCited.forEach((sentence, index) => {
            const was = before.get(statementKey(sentence))
            if (was) { const { hypothesis: _h, side: _s, stance: _t, ...kept } = was; carried.set(index, { ...kept, stage: "final", index, carried: true, ...(sentence.hypothesis ? { hypothesis: sentence.hypothesis } : {}), ...(sentence.hypothesis && sentence.side ? { side: sentence.side } : {}) }) }
            else fresh.push({ index, sentence })
          })
          end("revise", "completed", { summary: `${plural(finalCited.length - fresh.length, "cited sentence")} kept, ${fresh.length} new or changed, ${Math.max(0, draftStatements.length - (finalCited.length - fresh.length))} removed or rewritten.` })
          const kept = new Set(finalCited.map(statementKey))
          reviewNotes = reviewNotes.map((n) => {
            if (n.statement !== null && draftStatements[n.statement]) {
              const gone = !kept.has(statementKey(draftStatements[n.statement]))
              if (gone) return { ...n, resolved: true, how: "the sentence was removed or rewritten", by: "code" as const }
            }
            // What the writer says it did is a report, not a check. The reviewer is asked below; this stands only when it cannot be.
            const said = split.reported.get(n.index)
            return { ...n, resolved: said?.addressed === true, how: said?.addressed ? "the writer reports it addressed this (not checked)" : said?.why ? `the writer did not address it: ${said.why}` : "the writer did not say it addressed this", by: "writer" as const }
          })
          proposed = split.nextSteps
          record.answer = { markdown: final, direct: directAnswer(final) }
          record.review = { ...record.review, revised: true, notes: reviewNotes }
          // Until the changed sentences are checked, they are recorded as not checked: never as holding up.
          const tags = (sentence: Sentence) => ({ ...(sentence.hypothesis ? { hypothesis: sentence.hypothesis } : {}), ...(sentence.hypothesis && sentence.side ? { side: sentence.side } : {}) })
          record.statements = finalCited.map((sentence, index) => carried.get(index) ?? { stage: "final", index, text: sentence.text, sources: sentence.sources, ...tags(sentence), verdict: "unchecked", quoteFound: false, checker: brain.names.checker, note: "not checked: the check of this changed sentence did not finish", carried: false })
          const resolution = () => reviewNotes.map((n) => ({ index: n.index, resolved: n.resolved === true, ...(n.how ? { how: n.how } : {}), ...(n.by ? { by: n.by } : {}) }))
          emit("answer.revised", { type: "answer.revised", markdown: final, notes: resolution() })
          for (const s of carried.values()) emit(`statement:final:${s.index}`, { type: "statement.checked", ...s })
          save()
          /**
           * The reviewer that raised the notes reads the revision and says, note by note, whether it is resolved. That is
           * the record's answer. Where it cannot be asked (a limit, a failed call, an unreadable reply), what code can
           * see and what the writer reported stay, and the record says which of the two each one is.
           */
          const rejudge = async (): Promise<void> => {
            if (!reviewNotes.length || !brain.criticIndependent) return
            const jSystem = rejudgeSystem(config), jUser = rejudgeUser({ question: record.question, notes: reviewNotes, revised: final })
            begin({ step: "review:2", kind: "review", agent: "critic", label: `Reading the revision against ${plural(reviewNotes.length, "note")} of the reviewer`, input: { model: brain.names.critic, notes: reviewNotes.length } })
            const unjudged = "Whether the revision resolved the reviewer's notes was not judged by the reviewer; the record says what code and the writer's own report show."
            const why = (storedBefore.has(keyOf("rejudge", { jSystem, jUser })) ? undefined : ending) ?? allow(brain.worstCase("rejudge", jSystem.length + jUser.length), "rejudge", { jSystem, jUser })
            if (why) { soft(why); return endFor("review:2", why, unjudged) }
            try {
              const judged = readRejudged((await model("rejudge", { jSystem, jUser }, () => brain.rejudge(jSystem, jUser, signal))).text, reviewNotes.length)
              if (!judged) return end("review:2", "failed", { error: "The reviewer's reply could not be read.", consequence: unjudged })
              reviewNotes = reviewNotes.map((n) => {
                const j = judged.get(n.index)
                return j ? { ...n, resolved: j.status === "resolved", how: `the reviewer read the revision and judged it ${j.status === "open" ? "not resolved" : j.status === "partly" ? "only partly resolved" : "resolved"}${j.why ? `: ${j.why}` : ""}`, by: "reviewer" as const } : n
              })
              end("review:2", "completed", { found: judged.size, summary: `${reviewNotes.filter((n) => n.resolved).length} of ${reviewNotes.length} resolved.` })
            } catch (error) {
              if (error instanceof StepFailed) return end("review:2", "failed", { error: `The reviewer did not answer (${error.message}).`, consequence: unjudged })
              const stop = asStop(error)
              if (stop) { soft(stop.reason); return endFor("review:2", stop.reason, unjudged) }
              if (!(error instanceof Interrupted)) end("review:2", "failed", { error: "The reviewer's key or model name was refused by its vendor." })
              throw error
            }
          }
          const second = await Promise.allSettled([checkAll("check:2", "final", fresh), rejudge()])
          const failures = second.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason as unknown)
          if (failures.some((f) => f instanceof Interrupted)) throw new Interrupted()
          const rechecked = new Map((second[0].status === "fulfilled" ? second[0].value : []).map((s) => [s.index, s]))
          record.statements = finalCited.map((sentence, index) => carried.get(index) ?? rechecked.get(index) ?? { stage: "final" as const, index, text: sentence.text, sources: sentence.sources, ...tags(sentence), verdict: "unchecked" as const, quoteFound: false, checker: brain.names.checker, note: "not checked: the check of this changed sentence did not finish", carried: false })
          record.review = { ...record.review, notes: reviewNotes }
          emit("review.resolved", { type: "review.resolved", notes: resolution() })
          save()
          if (failures.length) throw failures[0]
          if (ending) throw new Stop(ending)
        }
      }

      // ── hypotheses: which way do the checked statements point ────────────────────────────────────
      // The writer filed each sentence under "For:" or "Against:". That is the writer's word. A model of another vendor
      // is asked the same question without being told the side; a statement counts only where the two agree (markOf).
      const judged = testing.length ? record.statements.filter((st) => st.verdict === "verified" && st.side && testing.some((h) => h.id === st.hypothesis)) : []
      if (judged.length) {
        const sUser = stanceUser(testing, judged.map((st) => ({ hypothesis: st.hypothesis as string, text: st.text })))
        const unjudged = "A hypothesis whose statements could not be judged is marked Not checked."
        begin({ step: "check:stance", kind: "check", agent: "checker", label: `Checking which way ${plural(judged.length, "statement")} ${judged.length === 1 ? "points" : "point"}`, input: { statements: judged.length, hypotheses: testing.length, checker: brain.names.checker, rule: "a statement counts for or against a hypothesis only when this model, not told the writer's choice, says it points that way" } })
        if (!brain.checkerIndependent) end("check:stance", "failed", { error: "No model from another vendor than the writer is configured.", consequence: unjudged })
        else {
          const why = allow(brain.worstCase("stance", STANCE.length + sUser.length), "stance", { sUser })
          if (why) { endFor("check:stance", why, unjudged); throw new Stop(why) }
          try {
            const stances = readStances((await model("stance", { sUser }, () => brain.stance(STANCE, sUser, signal))).text, judged.length)
            if (!stances) end("check:stance", "failed", { error: "The reply could not be read.", consequence: unjudged })
            else {
              judged.forEach((st, at) => { st.stance = stances.get(at) ?? "unchecked" })
              const agree = judged.filter((st) => (st.side === "for" && st.stance === "supports") || (st.side === "against" && st.stance === "contradicts")).length
              end("check:stance", "completed", { found: judged.length, kept: agree, summary: `${agree} of ${judged.length} point the way they were filed.` })
            }
          } catch (error) {
            if (!(error instanceof StepFailed)) { const stop = asStop(error); if (stop) endFor("check:stance", stop.reason, unjudged); throw stop ?? error }
            end("check:stance", "failed", { error: `The stance check did not answer (${error.message}).`, consequence: unjudged })
          }
        }
        save()
      }
    }
  } catch (error) {
    clearTimeout(timeout)
    if (error instanceof Interrupted || interrupted()) { frozen = true; throw new Interrupted() } // the engine is stopping: nothing more is written
    const stop = asStop(error)
    if (stop?.reason === "cancelled") {
      for (const step of [...running.keys()]) end(step, "cancelled")
      closeLeftOpen("cancelled")
      if (!record.sources.length && pool.length) { // cancelled during the searches: what was found by then is kept
        sources = numberSources(pool, level.sourcesKept, tested.map((h) => h.id))
        record.sources = sources
        emit("sources", { type: "sources", items: sources.map(({ text: _t, studyType: _s, relevance: _r, ...rest }) => rest) })
      }
      markUnchecked("cancelled")
      record.status = "cancelled"; record.finishedAt = now(); record.seconds = Math.round(worked() / 100) / 10
      record.counts = countsOf(sources.length, record.statements)
      record.note = `Cancelled. ${record.draft ? "What was written by then is kept; a sentence with no passed check is not shown as holding up." : sources.length ? "The sources found by then are kept." : "Nothing had been found yet."}`
      save()
      emit("end", { type: "research.cancelled", spentUsd: record.usd, seconds: record.seconds })
      await settle()
      save()
      return record
    }
    if (!stop) {
      const text = error instanceof FatalModelError ? scrub(error.message, env, 600) : `The answer could not be finished: ${message(error)}`
      for (const step of [...running.keys()]) end(step, "failed", { error: text })
      closeLeftOpen("failed", text)
      record.status = "failed"; record.error = text; record.finishedAt = now(); record.seconds = Math.round(worked() / 100) / 10
      save()
      emit("end", { type: "research.failed", error: text, spentUsd: record.usd })
      await settle()
      save()
      return record
    }
    stopped = stop.reason as Stopped
    for (const step of [...running.keys()]) endFor(step, stopped)
    closeLeftOpen("failed", `This step did not finish: ${STOP_WORDS[stopped]}.`)
    const where = record.review.revised ? "after the revision" : record.statements.length || reviewNotes.length ? "during the review, before the revision" : record.draft ? "after the first draft, before its review was finished" : sources.length ? "before an answer was written" : "during the searches"
    notes.unshift(`This answer ended early, ${where}: ${STOP_WORDS[stopped]}. ${record.draft ? "What is shown is what was done by then; a sentence with no passed check is not shown as holding up." : "The sources found by then are listed."}`)
    markUnchecked(stopped)
    if (!record.draft) {
      const text = `**No answer was written:** ${STOP_WORDS[stopped]}.${sources.length ? ` ${plural(sources.length, "source")} ${sources.length === 1 ? "was" : "were"} found before that and ${sources.length === 1 ? "is" : "are"} listed.` : ""}`
      record.draft = text
      record.answer = { markdown: text, direct: directAnswer(text) }
      emit("answer.written", { type: "answer.written", markdown: text })
    }
    await settle() // what was left behind at the limit is counted before the answer is closed
  }
  clearTimeout(timeout)
  if (interrupted()) { frozen = true; throw new Interrupted() }

  // ── the mark of each hypothesis, from the checked statements (code, not a model) ─────────────────
  if (record.hypotheses?.length) {
    record.hypotheses = record.hypotheses.map((h) => {
      const mark = markOf(h.id, record.statements)
      // An answer that ended before the checks cannot say "no evidence": it says the hypothesis was not checked.
      const testedBy = { kind: "sources" as const } // published sources; a swarm run on data would be {kind: "swarm", run} (not built)
      return stopped && mark.verdict === "unsupported" && !mark.mixed ? { ...h, ...mark, verdict: "unchecked" as const, note: `Not checked: ${STOP_WORDS[stopped]}.`, testedBy } : { ...h, ...mark, testedBy }
    })
    for (const h of record.hypotheses) emit(`hypothesis:${h.id}`, { type: "hypothesis.checked", id: h.id, verdict: h.verdict!, for: h.for!, against: h.against!, forStatements: h.forStatements!, againstStatements: h.againstStatements!, ...(h.mixed ? { mixed: true } : {}), ...(h.note ? { note: h.note } : {}), ...(h.agent ? { agent: h.agent } : {}), testedBy: h.testedBy })
  }

  // ── what was used, what to do next, and the files ────────────────────────────────────────────────
  const final = record.answer?.markdown ?? ""
  const citedNumbers = [...new Set(citedSentences(final).flatMap((s) => s.sources))].filter((n) => n >= 1 && n <= sources.length).sort((a, b) => a - b)
  record.sources = record.sources.map((s) => ({ ...s, cited: citedNumbers.includes(s.n) }))
  emit("sources.cited", { type: "sources.cited", n: citedNumbers })
  record.recommendations = stopped && !record.statements.length ? [] : buildRecommendations({ proposed, sources: sources.length, statements: record.statements, notes: record.review.notes })
  emit("recommendations", { type: "recommendations", items: record.recommendations })

  const ran: Partial<Record<Provider, number>> = {}
  for (const s of record.searches) if (s.ran) ran[s.provider] = (ran[s.provider] ?? 0) + 1
  const missing = record.searches.filter((s) => !s.ran)
  if (missing.length) notes.push(`${missing.length === 1 ? "One search" : `${missing.length} searches`} did not run: ${[...new Set(missing.map((s) => s.reason))].join(" ")}`)
  record.counts = countsOf(sources.length, record.statements)
  if (stopped) record.stopped = stopped
  if (notes.length) record.note = notes.join(" ").slice(0, 2_000)
  record.missing = missingOf(record, cut)
  emit("missing", { type: "missing", items: record.missing })

  begin({ step: "save", kind: "save", label: "Saving the answer and its files" })
  const saving = running.get("save")!
  let filesError: string | undefined, files: ReturnType<typeof writeArtifacts> = []
  record.status = "done"
  record.finishedAt = log.at("end") ?? now()
  record.seconds = Math.round(worked() / 100) / 10
  // The save step is closed in the record before the last write, so that record.json on disk is the registered file.
  running.delete("save")
  const ms = Math.max(0, Math.round(performance.now() - saving.from))
  Object.assign(saving.row, { status: "completed", ms, summary: "The record and three result files." })
  save()
  try { files = writeArtifacts(config, record, record.finishedAt) } catch (error) { filesError = message(error) }
  for (const artifact of files) emit(`artifact:${artifact.name}`, { type: "artifact.created", artifact })
  if (filesError) { Object.assign(saving.row, { status: "failed", error: `The result files could not be written (${filesError}).`, consequence: "The answer is saved, but it has no files to download." }); delete saving.row.summary; save() }
  emit("step.finished:save", { type: "step.finished", step: "save", status: saving.row.status as StepStatus, ms, ...(saving.row.summary ? { summary: saving.row.summary } : {}), ...(saving.row.error ? { error: saving.row.error, consequence: saving.row.consequence } : {}) })
  emit("end", {
    type: "research.finished", usd: record.usd, seconds: record.seconds, counts: record.counts, searches: ran,
    review: { checker: record.review.checker, critic: record.review.critic, revised: record.review.revised, notes: { raised: record.review.notes.length, resolved: record.review.notes.filter((n) => n.resolved).length } },
    ...(stopped ? { stopped } : {}), ...(record.note ? { note: record.note } : {}),
  })
  return record
}
