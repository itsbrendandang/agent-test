// What a run recorded about one agent or one entity (a source, a statement, an identifier such as a UniProt accession),
// gathered from the run's own events for the detail panels. Pure: events in, plain objects out; no React, no network.
// A panel built from these fills in while the run goes on, because it is rebuilt from the events each time one arrives.
//
// Only recorded fields are used. Where a run does not record something (the tokens of an agent in a run made before
// the engine wrote them, who a statement is about), the profile leaves it out and the panel says it is not recorded.
//
// Team review (board) events: run.started, run.roster, round.started, member.replied (with `usage` in newer runs),
// evidence.triaged, claim.checked, memo.written, run.finished (with `members` in newer runs), run.failed.
// Research answer events: step.started / step.finished (a step's agent and query), sources, statement.checked.
// Anything else, and every swarm run, is read through the Agent Log's rows (lab/logRows.ts): what each agent did, in order.
import type { LabEvent } from "@/lab/adapter"
import type { EventRow } from "@/lab/logRows"
import type { RunKind } from "@/lab/model"
import { markOf, type Mark } from "@/lib/words"
import { findIdentifiers, idKey, idLabel, SCHEME_NAME, TYPE_WORD, type EntityType, type Identifier } from "./identifiers"

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
const objects = (v: unknown): LabEvent[] => (Array.isArray(v) ? v.filter((x): x is LabEvent => !!x && typeof x === "object" && !Array.isArray(x)) : [])
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim()

/** One agent's own model use, as the engine recorded it (engine/src/events.ts MemberUsage). */
export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; usd: number }
const usageOf = (v: unknown): Usage | undefined => {
  if (!v || typeof v !== "object") return undefined
  const u = v as Record<string, unknown>
  const n = (k: string) => num(u[k])
  if (n("totalTokens") === undefined) return undefined
  return { input: n("input") ?? 0, output: n("output") ?? 0, cacheRead: n("cacheRead") ?? 0, cacheWrite: n("cacheWrite") ?? 0, totalTokens: n("totalTokens")!, usd: n("usd") ?? 0 }
}

export interface SourceFact {
  url: string; title: string
  /** The text the search returned (untrusted). */
  text?: string
  provider?: string; studyType?: string
  /** 1: the screening model said relevant; 0.5: partly. Never a measured score. */
  relevance?: number
  query?: string
  /** The agent whose search kept it first. */
  foundBy?: string
  at?: number
  /** Its number in a research answer. */
  n?: number
}
export interface SearchFact { key: string; agent: string; query?: string; provider?: string; kept?: number; dropped?: number; at?: number; round?: number; urls: string[]; label?: string }
export interface ClaimFact {
  key: string; agent: string; text: string; verdict: string; checker?: string; checkedBy?: string; note?: string; p?: number
  kind?: string; round?: number; sources: string[]; quoteFound?: boolean; at?: number
}
export interface ReplyFact { key: string; agent: string; round?: number; text: string; summary?: string; mode?: string; at?: number; usage?: Usage }
export interface RosterFact { name: string; title?: string; role?: string; source?: string; why?: string; methods?: string[] }

/** Everything a run recorded that the panels use, read once per change of the events. */
export interface RunFacts {
  kind: RunKind
  sources: Map<string, SourceFact>
  searches: SearchFact[]
  claims: ClaimFact[]
  replies: ReplyFact[]
  roster: RosterFact[]
  scripted?: boolean
  round?: number
  memoAt?: number
  finished?: { at?: number; usd?: number; members?: Record<string, Usage> }
  failed?: { at?: number; error?: string }
  /** Agent id -> the model a research step recorded it used. */
  models: Map<string, string>
}

const FINISHED = new Set(["run.finished", "research.finished", "research.cancelled"])
const FAILED = new Set(["run.failed", "research.failed"])
/** The research answer's steps and who works them (the Agent Log uses the same names). */
const STEP_AGENT: Record<string, string> = { prepare: "planner", hypothesize: "planner", search: "searcher", fetch: "searcher", evaluate: "relevance", write: "writer", check: "checker", review: "critic", revise: "writer" }

/** Read a run's events once. Events with the same key replace each other, as the engine replays them. */
export function runFacts(events: readonly LabEvent[], kind: RunKind): RunFacts {
  const facts: RunFacts = { kind, sources: new Map(), searches: [], claims: [], replies: [], roster: [], models: new Map() }
  const latest = new Map<string, LabEvent>()
  const list: LabEvent[] = []
  for (const e of events) { const k = str(e.key); if (k) { if (!latest.has(k)) list.push(e); latest.set(k, e) } else list.push(e) }
  const ordered = list.map((e) => (str(e.key) ? latest.get(str(e.key)!)! : e))
  const numbered = new Map<number, string>()
  const steps = new Map<string, LabEvent>()
  let lastAt: number | undefined
  for (const e of ordered) {
    const type = str(e.type) ?? ""
    const at = num(e.at)
    if (type === "run.started") facts.scripted = typeof e.mock === "boolean" ? e.mock : facts.scripted
    if (type === "research.started" && str(e.model)) facts.scripted = e.model === "scripted"
    if (type === "run.roster") facts.roster = objects(e.members).flatMap((m) => str(m.name) ? [{ name: str(m.name)!, title: str(m.title), role: str(m.role), source: str(m.source), why: str(m.why), methods: objects(m.methods).flatMap((x) => str(x.title) ?? str(x.name) ?? []) }] : [])
    if (type === "round.started" && num(e.round) !== undefined) facts.round = Math.max(facts.round ?? 0, num(e.round)!)
    if (type === "memo.written") facts.memoAt = at
    if (FINISHED.has(type)) {
      const members: Record<string, Usage> = {}
      for (const [name, u] of Object.entries((e.members && typeof e.members === "object" ? e.members : {}) as Record<string, unknown>)) { const got = usageOf(u); if (got) members[name] = got }
      facts.finished = { at, usd: num(e.usd), members: Object.keys(members).length ? members : undefined }
    }
    if (FAILED.has(type)) facts.failed = { at, error: str(e.error) }
    else if (at !== undefined) lastAt = Math.max(lastAt ?? at, at)
    if (type === "member.replied" && str(e.member)) facts.replies.push({ key: str(e.key) ?? `reply:${facts.replies.length}`, agent: str(e.member)!, round: num(e.round), text: str(e.text) ?? "", summary: str(e.summary), mode: str(e.mode), at, usage: usageOf(e.usage) })
    if (type === "evidence.triaged" && str(e.member)) {
      const agent = str(e.member)!, provider = str(e.provider) ?? (facts.scripted === true ? "fixture" : undefined)
      const items = objects(e.items)
      for (const item of items) {
        const url = str(item.url)
        if (!url || facts.sources.has(url)) continue
        facts.sources.set(url, { url, title: str(item.title) ?? url, text: str(item.text), provider: str(item.provider) ?? provider, studyType: str(item.studyType), relevance: num(item.relevance), query: str(item.query) ?? str(e.query), foundBy: agent, at })
      }
      facts.searches.push({ key: str(e.key) ?? `search:${facts.searches.length}`, agent, query: str(e.query), provider, kept: num(e.kept), dropped: num(e.dropped), at, round: facts.round, urls: items.flatMap((i) => str(i.url) ?? []) })
    }
    if (type === "claim.checked" && str(e.member) && str(e.claim)) {
      facts.claims.push({ key: str(e.key) ?? `claim:${facts.claims.length}`, agent: str(e.member)!, text: str(e.claim)!, verdict: str(e.verdict) ?? "unchecked", checker: str(e.checker), checkedBy: str(e.checkedBy), note: str(e.note), p: num(e.p), kind: str(e.kind), round: num(e.round), sources: str(e.source) && e.kind !== "brief" ? [str(e.source)!] : [], quoteFound: typeof e.quoteFound === "boolean" ? e.quoteFound : undefined, at })
    }
    // Research answer.
    if (type === "step.started" && str(e.step)) {
      steps.set(str(e.step)!, e)
      const agent = str(e.agent) ?? STEP_AGENT[str(e.kind) ?? ""] ?? "engine"
      const input = (e.input && typeof e.input === "object" ? e.input : {}) as Record<string, unknown>
      if (str(input.model)) facts.models.set(agent, str(input.model)!)
      if (str(e.kind) === "search" || str(e.kind) === "fetch") facts.searches.push({ key: str(e.key) ?? `step:${str(e.step)}`, agent, query: str(e.query), provider: str(e.provider), at, urls: [], label: str(e.label) })
    }
    if (type === "step.finished" && str(e.step)) {
      const s = facts.searches.find((x) => x.key === (str(steps.get(str(e.step)!)?.key) ?? `step:${str(e.step)}`))
      if (s) { s.kept = num(e.kept) ?? num(e.found) ?? s.kept }
    }
    if (type === "sources") {
      for (const item of objects(e.items)) {
        const url = str(item.url), n = num(item.n)
        if (!url) continue
        if (n !== undefined) numbered.set(n, url)
        if (!facts.sources.has(url)) facts.sources.set(url, { url, title: str(item.title) ?? url, text: str(item.note), provider: str(item.provider), foundBy: "searcher", at, n })
      }
    }
    if (type === "statement.checked" && str(e.text)) {
      const urls = (Array.isArray(e.sources) ? e.sources : []).flatMap((n) => (typeof n === "number" && numbered.get(n) ? [numbered.get(n)!] : []))
      facts.claims.push({ key: str(e.key) ?? `statement:${facts.claims.length}`, agent: "writer", text: str(e.text)!, verdict: str(e.verdict) ?? "unchecked", checker: "checker", checkedBy: str(e.model), note: str(e.note), kind: str(e.stage), sources: urls, quoteFound: typeof e.quoteFound === "boolean" ? e.quoteFound : undefined, at })
    }
  }
  if (facts.failed?.at !== undefined && lastAt !== undefined && lastAt > facts.failed.at) facts.failed = undefined
  return facts
}

/** One statement across the rounds it was checked in: who wrote it, every ruling, and the sources it names. */
export interface ClaimGroup { id: string; agent: string; text: string; kind?: string; rounds: number[]; rulings: ClaimFact[]; latest: ClaimFact; sources: string[]; firstAt?: number }
export const claimId = (agent: string, text: string) => `${agent}\u0000${norm(text)}`
export function claimGroups(claims: readonly ClaimFact[]): ClaimGroup[] {
  const groups = new Map<string, ClaimGroup>()
  for (const c of claims) {
    const id = claimId(c.agent, c.text)
    const g = groups.get(id)
    if (!g) groups.set(id, { id, agent: c.agent, text: c.text, kind: c.kind, rounds: c.round !== undefined ? [c.round] : [], rulings: [c], latest: c, sources: [...c.sources], firstAt: c.at })
    else {
      g.rulings.push(c); g.latest = c
      if (c.round !== undefined && !g.rounds.includes(c.round)) g.rounds.push(c.round)
      for (const s of c.sources) if (!g.sources.includes(s)) g.sources.push(s)
    }
  }
  return [...groups.values()]
}
export const markCounts = (verdicts: readonly string[]): Record<Mark, number> => {
  const out: Record<Mark, number> = { supported: 0, contradicted: 0, insufficient: 0, unchecked: 0 }
  for (const v of verdicts) out[markOf(v)]++
  return out
}

// ── Agents ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type NowState = "working" | "searching" | "waiting" | "done" | "not-started" | "absent" | "stopped" | "unknown"
export interface AgentProfile {
  id: string
  roster?: RosterFact
  /** Where it is now, from the newest events. */
  now: { state: NowState; text: string; at?: number }
  searches: SearchFact[]
  /** Sources its own searches kept first. */
  sources: SourceFact[]
  /** Statements it wrote, each with every ruling. */
  claims: ClaimGroup[]
  /** Its statements by the latest ruling's mark. */
  marks: Record<Mark, number>
  /** Rulings it made, as a checker. */
  rulings: ClaimFact[]
  ruled: Record<Mark, number>
  replies: ReplyFact[]
  rounds: number[]
  /** Its own model use: from the finish event when there is one, else from its newest reply. */
  usage?: { tokens: Usage; asOf: "finished" | "reply"; round?: number }
  /** Dollars the run recorded on its own steps (a research answer's steps), when any. */
  stepUsd?: number
  /** The model a research step said it used. */
  model?: string
  /** Its rows in the Agent Log, oldest first. */
  rows: EventRow[]
  /** Identifiers it named in what it wrote or searched for. */
  identifiers: Identifier[]
  firstAt?: number
  lastAt?: number
}

/** The checkers by name: the engine gives them no title, and two of them are "the second, careful check". */
export const CHECKER_NAME: Record<string, string> = { "first-pass": "First check", jev: "First check", openai: "Second check (OpenAI)", anthropic: "Second check (Anthropic)", "claude-code": "Second check (Claude Code)" }
const isChecker = (id: string) => ["first-pass", "jev", "openai", "anthropic", "claude-code", "checker"].includes(id)
const roundsWord = (rounds: number[]) => (rounds.length === 1 ? `round ${rounds[0]}` : `rounds ${rounds.join(", ")}`)

/** One agent's part in a run. `rows`: the run's Agent Log rows (eventRows); this agent's rows are picked from them. */
export function agentProfile(facts: RunFacts, rows: readonly EventRow[], id: string): AgentProfile {
  const mine = rows.filter((r) => r.agentId === id)
  const searches = facts.searches.filter((s) => s.agent === id)
  const sources = [...facts.sources.values()].filter((s) => s.foundBy === id)
  const claims = claimGroups(facts.claims.filter((c) => c.agent === id))
  const rulings = facts.claims.filter((c) => (c.checker === id || (id === "first-pass" && c.checker === "jev")) && c.agent !== id)
  const replies = facts.replies.filter((r) => r.agent === id)
  const rounds = [...new Set(replies.flatMap((r) => (r.round !== undefined ? [r.round] : [])))].sort((a, b) => a - b)
  const finishedUsage = facts.finished?.members?.[id]
  const lastReplyUsage = [...replies].reverse().find((r) => r.usage)
  const usage = finishedUsage ? { tokens: finishedUsage, asOf: "finished" as const } : lastReplyUsage?.usage ? { tokens: lastReplyUsage.usage, asOf: "reply" as const, round: lastReplyUsage.round } : undefined
  const stepUsd = mine.reduce((n, r) => n + (r.costScope === "step" && r.usd !== undefined ? r.usd : 0), 0)
  const times = [...mine.map((r) => r.at), ...replies.map((r) => r.at), ...searches.map((s) => s.at)].filter((t): t is number => t !== undefined)
  return {
    id, roster: facts.roster.find((m) => m.name === id),
    now: nowOf(facts, id, { mine, searches, replies, rounds, rulings }),
    searches, sources, claims, marks: markCounts(claims.map((c) => c.latest.verdict)), rulings, ruled: markCounts(rulings.map((r) => r.verdict)),
    replies, rounds, usage, stepUsd: stepUsd > 0 ? stepUsd : undefined, model: facts.models.get(id), rows: mine,
    identifiers: findIdentifiers(...replies.map((r) => r.text), ...claims.map((c) => c.text), ...searches.map((s) => s.query)),
    firstAt: times.length ? Math.min(...times) : undefined, lastAt: times.length ? Math.max(...times) : undefined,
  }
}

function nowOf(facts: RunFacts, id: string, a: { mine: EventRow[]; searches: SearchFact[]; replies: ReplyFact[]; rounds: number[]; rulings: ClaimFact[] }): AgentProfile["now"] {
  const lastRow = a.mine.at(-1)
  if (facts.failed) return { state: "stopped", text: `Stopped: the run failed${facts.failed.error ? ` (${facts.failed.error})` : ""}.`, at: facts.failed.at }
  if (facts.finished) {
    if (a.rounds.length) return { state: "done", text: `Finished. It replied in ${roundsWord(a.rounds)}.`, at: facts.finished.at }
    if (a.mine.length || a.rulings.length) return { state: "done", text: `Finished. It recorded ${a.mine.length || a.rulings.length} step${(a.mine.length || a.rulings.length) === 1 ? "" : "s"}.`, at: facts.finished.at }
    return { state: "absent", text: "Did not take part in this run.", at: facts.finished.at }
  }
  if (facts.kind === "board") {
    const round = facts.round
    const lead = id === "lead-scientist" || facts.roster.find((m) => m.name === id)?.role === "lead"
    if (lead) {
      if (facts.memoAt !== undefined) return { state: "working", text: "Writing the decision memo.", at: facts.memoAt }
      if (round === undefined) return { state: "working", text: "Framing the question before the first round.", at: lastRow?.at }
      const replied = new Set(facts.replies.filter((r) => r.round === round).map((r) => r.agent)).size
      const members = facts.roster.filter((m) => m.role === "member").length
      return { state: "waiting", text: `Running round ${round}: ${replied}${members ? ` of ${members}` : ""} members have replied.`, at: lastRow?.at }
    }
    if (isChecker(id)) {
      const last = a.rulings.at(-1)
      return last ? { state: "working", text: `Checking statements. Last: ${last.verdict} on a statement by ${last.agent}.`, at: last.at } : { state: "not-started", text: "Has not checked a statement yet.", at: undefined }
    }
    if (round === undefined) return { state: "not-started", text: "Not started: the first round has not opened yet.", at: undefined }
    if (a.replies.some((r) => r.round === round)) return { state: "waiting", text: `Replied in round ${round}. Waiting for the next round.`, at: a.replies.at(-1)?.at }
    const search = a.searches.at(-1)
    if (search && search.round === round) return { state: "searching", text: `Searching for round ${round}${search.query ? `: last query “${search.query}”` : ""}.`, at: search.at }
    return { state: "working", text: `Working on its reply for round ${round}.`, at: lastRow?.at }
  }
  if (lastRow) return { state: "working", text: `Last step: ${lastRow.text.split("\n")[0]}`, at: lastRow.at }
  return { state: "unknown", text: "Nothing recorded for this agent yet.", at: undefined }
}

// ── Entities ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type EntityRef = { kind: "source"; url: string } | { kind: "claim"; agent: string; text: string } | { kind: "id"; key: string }
export const refKey = (r: EntityRef) => (r.kind === "source" ? `source:${r.url}` : r.kind === "claim" ? `claim:${claimId(r.agent, r.text)}` : `id:${r.key}`)

export interface Touch { agent: string; how: string; at?: number; round?: number }
export interface EntityProfile {
  ref: EntityRef
  /** "Source", "Statement", or the identifier's kind ("Target"). */
  kindWord: string
  title: string
  text?: string
  url?: string
  type?: EntityType
  identifiers: Identifier[]
  facts: { label: string; value: string }[]
  /** Sources that mention it (for an identifier or a statement). */
  sources: SourceFact[]
  /** Statements about it: those that cite the source, name the identifier, or the statement itself. */
  claims: ClaimGroup[]
  /** Who touched it, how and when, oldest first. */
  touches: Touch[]
  /** Not in the run yet: nothing recorded mentions it. */
  missing: boolean
  firstAt?: number
  lastAt?: number
}

const providerWord: Record<string, string> = {
  exa: "Exa web search", europepmc: "Europe PMC literature search", openalex: "OpenAlex", semanticscholar: "Semantic Scholar", arxiv: "arXiv",
  chembl: "ChEMBL", clinicaltrials: "ClinicalTrials.gov", openfda: "openFDA", opentargets: "Open Targets", uniprot: "UniProt", pubchem: "PubChem", fixture: "Example source (practice run)",
}
export const providerName = (p?: string) => (p ? providerWord[p] ?? p : undefined)
const span = (touches: Touch[]) => { const t = touches.map((x) => x.at).filter((x): x is number => x !== undefined); return { firstAt: t.length ? Math.min(...t) : undefined, lastAt: t.length ? Math.max(...t) : undefined } }
const byTime = (a: Touch, b: Touch) => (a.at ?? Infinity) - (b.at ?? Infinity)

/** Every identifier the run's sources, statements, replies and searches name, with how often each is mentioned. */
export function runIdentifiers(facts: RunFacts): { id: Identifier; mentions: number }[] {
  const out = new Map<string, { id: Identifier; mentions: number }>()
  const add = (ids: Identifier[]) => { for (const id of ids) { const k = idKey(id), o = out.get(k); if (o) { o.mentions++; if (!o.id.type && id.type) o.id = id } else out.set(k, { id, mentions: 1 }) } }
  for (const s of facts.sources.values()) add(findIdentifiers(s.url, s.title, s.text))
  for (const c of claimGroups(facts.claims)) add(findIdentifiers(c.text))
  for (const r of facts.replies) add(findIdentifiers(r.text))
  for (const s of facts.searches) add(findIdentifiers(s.query))
  return [...out.values()].sort((a, b) => b.mentions - a.mentions || idLabel(a.id).localeCompare(idLabel(b.id)))
}

export function entityProfile(facts: RunFacts, ref: EntityRef): EntityProfile {
  const groups = claimGroups(facts.claims)
  if (ref.kind === "source") {
    const s = facts.sources.get(ref.url)
    const citing = groups.filter((g) => g.sources.includes(ref.url))
    const touches: Touch[] = [
      ...(s?.foundBy ? [{ agent: s.foundBy, how: s.query ? `found it, searching “${s.query}”` : "found it", at: s.at }] : []),
      ...facts.searches.filter((x) => x.urls.includes(ref.url) && !(x.agent === s?.foundBy && x.at === s?.at)).map((x) => ({ agent: x.agent, how: `found it again${x.query ? `, searching “${x.query}”` : ""}`, at: x.at, round: x.round })),
      ...citing.flatMap((g) => g.rulings.filter((r) => r.sources.includes(ref.url)).flatMap((r) => [
        { agent: r.agent, how: `cited it in a statement${r.round !== undefined ? ` (round ${r.round})` : ""}`, at: r.at, round: r.round },
        ...(r.checker ? [{ agent: r.checker, how: `checked a statement against it: ${r.verdict}${r.quoteFound === undefined ? "" : r.quoteFound ? ", quoted passage found" : ", quoted passage not found"}`, at: r.at, round: r.round }] : []),
      ])),
    ].sort(byTime)
    return {
      ref, kindWord: "Source", title: s?.title ?? ref.url, text: s?.text, url: ref.url,
      identifiers: findIdentifiers(ref.url, s?.title, s?.text),
      facts: [
        ...(s?.provider ? [{ label: "Found through", value: providerName(s.provider)! }] : []),
        ...(s?.query ? [{ label: "Search query", value: s.query }] : []),
        ...(s?.studyType ? [{ label: "Kind of study", value: s.studyType }] : []),
        ...(s?.relevance === 1 ? [{ label: "Screening", value: "Relevant (a screening model's judgement in words, not a score)" }] : s?.relevance === 0.5 ? [{ label: "Screening", value: "Partly relevant (a screening model's judgement in words, not a score)" }] : []),
        ...(s?.n !== undefined ? [{ label: "Number in the answer", value: `[${s.n}]` }] : []),
      ],
      sources: [], claims: citing, touches, missing: !s && !citing.length, ...span(touches),
    }
  }
  if (ref.kind === "claim") {
    const id = claimId(ref.agent, ref.text)
    const g = groups.find((x) => x.id === id)
    const touches: Touch[] = (g?.rulings ?? []).flatMap((r) => [
      { agent: r.agent, how: `stated it${r.round !== undefined ? ` in round ${r.round}` : ""}`, at: r.at, round: r.round },
      ...(r.checker ? [{ agent: r.checker, how: `ruled: ${r.verdict}`, at: r.at, round: r.round }] : []),
    ]).sort(byTime)
    const latest = g?.latest
    return {
      ref, kindWord: "Statement", title: ref.text, identifiers: findIdentifiers(ref.text),
      facts: [
        ...(g?.kind ? [{ label: "Kind of statement", value: g.kind }] : []),
        ...(g?.rounds.length ? [{ label: g.rounds.length > 1 ? "Rounds" : "Round", value: g.rounds.join(", ") }] : []),
        ...(latest?.p !== undefined ? [{ label: "Checker's score", value: String(Number(latest.p.toPrecision(3))) }] : []),
        ...(latest?.quoteFound !== undefined ? [{ label: "Quoted passage", value: latest.quoteFound ? "found in the source" : "not found in the source" }] : []),
      ],
      sources: (g?.sources ?? []).map((u) => facts.sources.get(u) ?? { url: u, title: u }), claims: g ? [g] : [], touches, missing: !g, ...span(touches),
    }
  }
  // An identifier: everything that names it.
  const has = (...parts: (string | undefined)[]) => findIdentifiers(...parts).some((x) => idKey(x) === ref.key)
  const all = runIdentifiers(facts).find((x) => idKey(x.id) === ref.key)?.id
  const sources = [...facts.sources.values()].filter((s) => has(s.url, s.title, s.text))
  const claims = groups.filter((g) => has(g.text))
  const touches: Touch[] = [
    ...sources.flatMap((s) => (s.foundBy ? [{ agent: s.foundBy, how: `found a source that names it: “${s.title}”`, at: s.at }] : [])),
    ...facts.searches.filter((s) => has(s.query)).map((s) => ({ agent: s.agent, how: `searched for it: “${s.query}”`, at: s.at, round: s.round })),
    ...facts.replies.filter((r) => has(r.text)).map((r) => ({ agent: r.agent, how: `named it in a reply${r.round !== undefined ? ` (round ${r.round})` : ""}`, at: r.at, round: r.round })),
    ...claims.flatMap((g) => g.rulings.flatMap((r) => [
      { agent: r.agent, how: `made a statement about it${r.round !== undefined ? ` (round ${r.round})` : ""}`, at: r.at, round: r.round },
      ...(r.checker ? [{ agent: r.checker, how: `checked that statement: ${r.verdict}`, at: r.at, round: r.round }] : []),
    ])),
  ].sort(byTime)
  const [scheme, ...rest] = ref.key.split(":")
  const fallback = { scheme, value: rest.join(":") } as Identifier
  const id = all ?? fallback
  return {
    ref, kindWord: id.type ? TYPE_WORD[id.type] : "Record (its kind is not in the identifier)",
    title: idLabel(id), url: id.href, type: id.type, identifiers: all ? [all] : [],
    facts: [{ label: "Database", value: SCHEME_NAME[id.scheme] ?? id.scheme }, { label: "Identifier", value: id.value }],
    sources, claims, touches, missing: !all, ...span(touches),
  }
}
