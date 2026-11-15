import { hasWords } from "@/lib/format"
import { MARK_WORD, sandboxWords, markOf, splitReply, type Mark } from "@/lib/words"
import { PROVIDERS } from "@/research/providers"
import { agentIdentity, readableName } from "./identity"
import { answerOrder, boardOrder, num, str, type LabEvent } from "./adapter"
import type { Provenance, RunKind } from "./model"
import { claimsOrder, claimsTimeline } from "./claims"

export function swarmLogEvents(events: readonly LabEvent[], notes: readonly LabEvent[] = [], seenAt: readonly (number | undefined)[] = [], runId?: string): LabEvent[] {
  const ordered = claimsOrder(events, runId).events
  return claimsTimeline(ordered, notes, seenAt)
    .map((item, index) => ({ event: (item.event ?? item.note)!, at: num((item.event ?? item.note)?.ts) !== undefined ? Math.round(num((item.event ?? item.note)!.ts)! * 1000) : num((item.event ?? item.note)?.at) ?? item.at, index }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map((item) => item.event)
}

export interface LogSource { title: string; url: string }
export interface EventRow {
  id: string
  at?: number
  agent: string
  agentId: string
  kind: string
  text: string
  usd?: number
  costScope?: "step" | "total"
  sources: LogSource[]
  /** A tool call, a search or a system step: the chat shows it as a small note, not as an agent's message. */
  note?: boolean
  /** The text after the first line is the agent's reasoning, so the chat labels it "Show thinking" (else "Show more"). */
  thought?: boolean
  /** A team review's discussion round this event belongs to: the chat draws a "Round n" line where a new one begins. */
  round?: { n: number; final?: boolean }
  /** What a check found about a statement, as one of the four marks. */
  mark?: Mark
  /** Where a search looked, as the run recorded it: the chat credits it (Exa, Europe PMC, a database, or example sources). */
  provider?: string
}
export interface LogFilter { agent: string; kind: string; query: string }
const objects = (value: unknown): LabEvent[] => Array.isArray(value) ? value.filter((v): v is LabEvent => !!v && typeof v === "object" && !Array.isArray(v)) : []
const texts = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []
const join = (...values: unknown[]) => values.filter((v) => typeof v === "string" && v).join(" ")
/** Event types that are tool calls, searches or bookkeeping rather than an agent speaking. */
const NOTE_TYPES = new Set([
  "run.started", "run.resumed", "run.finished", "run.failed", "research.started", "research.resumed", "research.queued", "research.finished", "research.failed", "research.cancelled",
  "run.roster", "specialists", "evidence.triaged", "claim.checked", "constraint", "step.started", "step.progress", "sources", "sources.cited", "artifact.created",
  "phase.started", "phase.finished", "claim.transition", "claim.illegal_transition", "test.executed", "test.recorded", "budget.allocated", "budget.spent", "flags", "triage.uncovered",
])
const NOTE_KINDS = new Set(["search", "fetch", "sources"])
/** Event types whose text is an agent's reasoning or plan, not a draft, a list or a record. */
const THOUGHT_TYPES = new Set(["opening", "lead.framed", "round.started", "member.replied", "claim.checked", "hypothesis.checked", "statement.checked", "review.note", "issue.raised"])
const STEP_AGENT: Record<string, string> = { prepare: "planner", hypothesize: "planner", search: "searcher", fetch: "searcher", evaluate: "relevance", write: "writer", check: "checker", review: "critic", revise: "writer", save: "engine" }
export function sourceLink(url: unknown, title?: unknown): LogSource[] {
  if (typeof url !== "string") return []
  try {
    const parsed = new URL(url)
    return ["http:", "https:"].includes(parsed.protocol) ? [{ title: str(title) || url, url }] : []
  } catch { return [] }
}

/** One row per stored event, with no activity-list cap or replay delay. */
export function eventRows(events: readonly LabEvent[], run: RunKind): EventRow[] {
  const ordered = run === "answer" ? answerOrder(events) : run === "board" ? boardOrder(events) : events
  const titles = new Map<string, string>()
  const steps = new Map<string, LabEvent>()
  const sources = new Map<number, LogSource[]>()
  for (const e of ordered) {
    if (e.type === "run.roster" || e.type === "specialists") {
      for (const item of objects(e.members ?? e.items)) {
        const id = str(item.agent) ?? str(item.name)
        if (id && str(item.title)) titles.set(id, str(item.title)!)
      }
    }
    if (e.type === "step.started" && str(e.step)) steps.set(str(e.step)!, e)
    if (e.type === "sources") for (const item of objects(e.items)) if (num(item.n) !== undefined) sources.set(num(item.n)!, sourceLink(item.url, item.title))
  }
  return ordered.flatMap((e, index): EventRow[] => {
    const type = str(e.type) ?? str(e.kind)
    if (!type) return []
    const step = steps.get(str(e.step) ?? "")
    const stepKind = str(step?.kind) ?? (type === "step.started" ? str(e.kind) : undefined)
    let agentId = str(e.agent) ?? str(e.member) ?? str(e.by) ?? str(step?.agent) ?? (stepKind ? STEP_AGENT[stepKind] : undefined) ?? str(e.role) ?? str(e.phase) ?? "engine"
    let kind = str(step?.kind) ?? type.split(".")[0]
    let text: string
    const query = str(e.query) ?? str(step?.query)
    const summary = join(e.summary, e.error, e.consequence)
    let links = objects(e.items).flatMap((s) => sourceLink(s.url, s.title))
    links.push(...sourceLink(e.url), ...sourceLink(e.source))
    for (const n of [...(Array.isArray(e.sources) ? e.sources : []), ...(Array.isArray(e.n) ? e.n : [])]) {
      if (typeof n === "number") links.push(...(sources.get(n) ?? []))
    }
    const names = (value: unknown) => objects(value).map((s) => str(s.title) ?? str(s.name) ?? "Unnamed specialist").join(", ")
    switch (type) {
      case "run.started": case "research.started": kind = "run"; text = `Started ${run === "board" ? "the team review" : "the research answer"}: ${str(e.question) ?? str(e.title) ?? str(e.brief) ?? ""}`; break
      case "run.resumed": case "research.resumed": kind = "run"; text = "Continued the run after a restart."; break
      case "research.queued": kind = "run"; text = "Waiting for the previous answer to finish."; break
      case "run.roster": kind = "team"; text = `Team joined: ${names(e.members)}.`; break
      case "specialists": kind = "team"; text = objects(e.items).map((s) => join(`${str(s.title) ?? str(s.name)} joined.`, s.why, names(s.methods) ? `Method skills: ${names(s.methods)}.` : "")).join("\n"); if (!text) text = "No method specialist joined."; break
      case "opening": agentId = "planner"; kind = "prepare"; text = str(e.text) ?? "Opened the research question."; break
      case "lead.framed": agentId = "lead-scientist"; kind = "prepare"; text = `Framed the question: ${str(e.text) ?? ""}`; break
      // A team review's discussion: the lead opens each round, each member replies (its one-line summary first, the
      // whole reply behind "Show thinking"), and each statement check is a quiet note under the reply it checked.
      case "round.started": agentId = "lead-scientist"; kind = "prepare"; text = (str(e.message) ?? "").replace(/^\s*Round \d+\.\s*/, "").trim() || `Started round ${num(e.round) ?? ""}.`; break
      case "member.replied": {
        kind = "write"
        // The reply's one line (the engine's summary, else its own "In short:" sentence) first, the rest behind the toggle.
        const full = (str(e.text) ?? "").trim(), reply = splitReply(full), summary = str(e.summary)?.trim()
        const line = summary || (reply.marked ? reply.short : "")
        const rest = !line ? full : reply.marked ? reply.rest : full === line ? "" : full
        text = [line, rest].filter(Boolean).join("\n") || `Replied in round ${num(e.round) ?? ""}.`
        break
      }
      case "evidence.triaged": {
        kind = "search"
        const provider = str(e.provider), place = provider === "fixture" ? "practice example sources" : provider && PROVIDERS[provider] ? PROVIDERS[provider].place : provider ?? "sources"
        text = `Searched ${place}${query ? ` for “${query}”` : ""}: kept ${num(e.kept) ?? "not recorded"}, dropped ${num(e.dropped) ?? "not recorded"}.`
        break
      }
      case "claim.checked": {
        agentId = str(e.checker) ?? "checker"; kind = "check"
        const member = str(e.member), whose = member ? `${titles.get(member) ?? agentIdentity(member).label}'s` : "a"
        const mark = markOf(e.verdict)
        const by = str(e.checkedBy), source = str(e.source)
        text = join(`${MARK_WORD[mark]}: ${whose} statement “${str(e.claim) ?? ""}”.`, e.note,
          e.quoteFound === true ? "The quoted passage was found in the source." : e.quoteFound === false ? "The quoted passage was not found in the source." : "",
          source === "brief" ? "Source: the brief." : "", by === "scripted" ? "Practice run: no model checked it." : by ? `Checked by ${by}.` : "")
        break
      }
      case "constraint": kind = "limit"; text = join("Reached a run limit.", e.detail, e.reason); break
      case "memo.written": agentId = "reporter"; kind = "save"; text = join("Saved the decision memo.", e.decision, e.path); break
      case "step.started": kind = str(e.kind) ?? "step"; text = join(`Started: ${str(e.label) ?? readableName(str(e.step) ?? "step")}.`, query ? `Query: ${query}` : ""); break
      case "step.progress": text = join(`Progress: ${num(e.done) ?? "?"}${num(e.total) !== undefined ? ` of ${num(e.total)}` : ""}.`, e.note); break
      case "step.finished": text = join(`${str(step?.label) ?? readableName(str(e.step) ?? "Step")}: ${str(e.status) ?? "finished"}.`, summary, num(e.found) !== undefined ? `Found ${num(e.found)}.` : "", num(e.kept) !== undefined ? `Kept ${num(e.kept)}.` : ""); break
      case "sources": kind = "sources"; text = `Numbered ${objects(e.items).length} sources for the answer.`; break
      case "selection": kind = "evaluate"; text = join(e.criteria, objects(e.selected).map((s) => `Source ${num(s.n) ?? "?"}: ${join(s.why, s.limitation)}`).join("\n"), objects(e.notSelected).map((s) => `Not selected: ${join(s.title, s.reason)}`).join("\n")); links.push(...objects(e.selected).flatMap((s) => sources.get(num(s.n) ?? -1) ?? []), ...objects(e.notSelected).flatMap((s) => sourceLink(s.url, s.title))); break
      case "hypotheses": kind = "hypothesize"; text = join(e.reason, objects(e.items).map((s) => join(s.id, s.text)).join("\n")) || "No hypothesis was needed."; break
      case "hypothesis.checked": kind = "check"; text = join(`Checked hypothesis ${str(e.id) ?? ""}.`, e.verdict, e.note); break
      case "answer.delta": agentId = "writer"; kind = "write"; text = str(e.text) ?? ""; break
      case "answer.written": agentId = "writer"; kind = "write"; text = ["Wrote the draft.", str(e.markdown)].filter(Boolean).join("\n"); break
      case "answer.revised": agentId = "writer"; kind = "revise"; text = ["Revised the answer.", str(e.markdown)].filter(Boolean).join("\n"); break
      case "review.started": agentId = str(e.reviewer) ?? "checker"; kind = "review"; text = `Started reviewing the answer${str(e.model) ? ` with ${str(e.model)}` : ""}.`; break
      case "statement.checked": agentId = "checker"; kind = "check"; text = join("Checked a statement:", e.text, e.verdict, e.note); break
      case "review.note": agentId = "critic"; kind = "review"; text = join(`Raised a ${str(e.severity) ?? "review"} note:`, e.text); break
      case "review.resolved": agentId = "critic"; kind = "review"; text = objects(e.notes).map((n) => join(`Note ${num(n.index) ?? "?"}: ${n.resolved === true ? "resolved" : "not resolved"}.`, n.how)).join("\n") || "Reviewed the notes."; break
      case "sources.cited": kind = "sources"; text = `Cited source numbers: ${Array.isArray(e.n) ? e.n.filter((n) => typeof n === "number").join(", ") : "none"}.`; break
      case "recommendations": kind = "write"; text = objects(e.items).map((s) => join(s.label, s.text, s.why, s.does)).join("\n") || "No recommendation recorded."; break
      case "missing": kind = "review"; text = `Not found or not checked: ${texts(e.items).join("; ")}`; break
      case "artifact.created": { kind = "save"; const a = e.artifact as LabEvent | undefined; text = `Saved result file: ${str(a?.name) ?? "unnamed file"}.`; break }
      case "run.finished": case "research.finished": kind = "run"; text = join("Run finished.", e.note); break
      case "run.failed": case "research.failed": kind = "error"; text = join("Run failed.", e.error); break
      case "research.cancelled": kind = "run"; text = "The research answer was cancelled."; break
      case "phase.started": text = `Started the ${str(e.phase) ?? "recorded"} phase.`; break
      case "phase.finished": text = join(`Finished the ${str(e.phase) ?? "recorded"} phase.`, num(e.tokens) !== undefined ? `${num(e.tokens)} tokens recorded.` : ""); break
      case "claim.added": text = `Recorded statement ${str(e.claim_id) ?? str(e.claim) ?? ""}: ${str(e.text) ?? ""}`; break
      case "claim.transition":
      case "claim.illegal_transition":
        agentId = "engine"
        text = join(`${type === "claim.illegal_transition" ? "Refused an illegal move of" : "Moved"} claim ${str(e.claim_id) ?? "(id not recorded)"} from ${str(e.from) ?? "(state not recorded)"} to ${str(e.to) ?? "(state not recorded)"}.`, e.reason)
        break
      case "agent.call":
        text = join(`Ended ${str(e.mode) ?? "(mode not recorded)"} call on claim ${str(e.claim_id) ?? "(id not recorded)"}.`, str(e.role) ? `Role: ${str(e.role)}.` : "", str(e.outcome) ? `Outcome: ${str(e.outcome)}.` : "", num(e.attempt) !== undefined ? `Attempt: ${num(e.attempt)}.` : "", str(e.model) ? `Model: ${str(e.model)}.` : "", e.note)
        break
      case "claim.error": kind = "error"; text = join(`A call on claim ${str(e.claim_id) ?? "(id not recorded)"} did not finish.`, e.error); break
      case "issue.raised": text = join(`Raised ${str(e.severity) ?? "an"} issue ${str(e.issue) ?? "(id not recorded)"}:`, e.problem); break
      case "issue.resolved": text = `Updated issue ${str(e.issue) ?? "(id not recorded)"}: ${str(e.status) ?? "status not recorded"}.`; break
      case "test.registered": text = join(`Registered test ${str(e.name) ?? "(name not recorded)"} for statement ${str(e.claim) ?? "(id not recorded)"}.`, e.method, str(e.test_null) ? `Null hypothesis: ${str(e.test_null)}` : "", e.script_path); break
      case "test.executed":
      case "test.recorded": {
        const where = type === "test.executed" ? sandboxWords(e.backend, e.sandbox_id) : undefined
        text = join(`${type === "test.executed" ? "Ran" : "Recorded"} test ${str(e.name) ?? "(name not recorded)"} for statement ${str(e.claim) ?? "(id not recorded)"}.`, where ? `Ran in ${where}.` : "", str(e.status) ? `Status: ${str(e.status)}.` : "", num(e.exit_code) !== undefined ? `Exit code: ${num(e.exit_code)}.` : "", e.detail, num(e.p) !== undefined ? `p = ${num(e.p)}.` : "", typeof e.contradicts === "boolean" ? `Contradicts the statement: ${e.contradicts ? "yes" : "no"}.` : "", num(e.e) !== undefined ? `e = ${num(e.e)}.` : "", str(e.verdict_at_the_time) ? `Verdict at the time: ${str(e.verdict_at_the_time)}.` : "")
        break
      }
      default: text = join(`${readableName(type.replaceAll(".", " "))}.`, e.message, e.summary, e.text, e.note, e.error)
    }
    const agent = agentId === "engine" ? "Engine" : titles.get(agentId) ?? agentIdentity(agentId.replace(/^specialist:/, "")).label
    const total = /^(run|research)\.(finished|failed|cancelled)$/.test(type)
    const usd = num(e.usd) ?? num(e.spentUsd)
    links = [...new Map(links.map((s) => [s.url, s])).values()]
    const note = agentId === "engine" || NOTE_TYPES.has(type) || NOTE_KINDS.has(kind)
    const round = run === "board" && num(e.round) !== undefined && ["round.started", "member.replied", "claim.checked"].includes(type) ? { n: num(e.round)!, ...(e.final === true ? { final: true } : {}) } : undefined
    return [{ id: `${index}:${str(e.key) ?? num(e.seq) ?? type}`, at: num(e.at) ?? (num(e.ts) !== undefined ? num(e.ts)! * 1000 : undefined), agentId, agent, kind, text, usd, costScope: usd === undefined ? undefined : total ? "total" : "step", sources: links, ...(note ? { note } : {}), ...(!note && THOUGHT_TYPES.has(type) ? { thought: true } : {}), ...(round ? { round } : {}), ...(type === "claim.checked" ? { mark: markOf(e.verdict) } : {}), ...(type === "evidence.triaged" && str(e.provider) ? { provider: str(e.provider) } : {}) }]
  })
}

export function filterRows(rows: readonly EventRow[], filter: LogFilter): EventRow[] {
  return rows.filter((r) => (!filter.agent || r.agentId === filter.agent) && (!filter.kind || r.kind === filter.kind) && hasWords([r.agent, r.kind, r.text, ...r.sources.flatMap((s) => [s.title, s.url])].join(" "), filter.query))
}

export function logDownload(rows: readonly EventRow[], run: { id: string; kind: RunKind; provenance?: Provenance }, format: "json" | "csv"): string {
  if (format === "json") return JSON.stringify({ run: run.provenance === "example" ? { ...run, example: true, provenanceLabel: "Example · practice, $0" } : run, rows }, null, 2)
  const cell = (v: unknown) => {
    const text = String(v ?? "")
    return `"${(/^\s*[=+@-]|^[\t\r]/.test(text) ? "'" : "") + text.replaceAll('"', '""')}"`
  }
  return [["Run", "Run kind", "Provenance", "Time (ISO)", "Agent", "Step kind", "What happened", "USD", "Cost scope", "Sources"], ...rows.map((r) => [run.id, run.kind, run.provenance === "example" ? "Example · practice, $0" : run.provenance ?? "unknown", r.at !== undefined && Number.isFinite(new Date(r.at).getTime()) ? new Date(r.at).toISOString() : "", r.agent, r.kind, r.text, r.usd, r.costScope, r.sources.map((s) => `${s.title}: ${s.url}`).join("; ")])].map((r) => r.map(cell).join(",")).join("\r\n")
}
