// A direct, sourced answer, as the engine streams it (GET /api/research/:id/events). This file is the pure part:
// the event shapes, and how a list of events becomes what the screen shows. Rules that keep it honest:
//  - the text is the revised answer when a revision ran, else the first draft, else the provisional draft so far;
//  - a statement's mark comes only from a statement.checked event (the final stage when there is one);
//  - a search that did not run is never shown as done: its reason is shown instead.
import type { Verdict } from "@/board/api"
import { PROVIDERS } from "./providers"

export type Provider = string // "exa" | "europepmc" | "fixture" | a database name
export interface Source { n: number; url: string; title: string; provider: Provider; note?: string; /** The year (or date) the search gave for it, when it gave one. */ published?: string; /** The hypotheses whose searches found it. */ hypotheses?: string[] }
export interface Statement {
  stage: "draft" | "final"; index: number; text: string; sources: number[]; verdict: Verdict
  quote?: string; quoteFound: boolean; quoteSource?: number; checker: string; note?: string; carried?: boolean
  /** The hypothesis this sentence was filed under, on which side, and which way a second model says it points. */
  hypothesis?: string; side?: "for" | "against"; stance?: "supports" | "contradicts" | "neither" | "unchecked"
  /** Who wrote the sentence: an investigator ("investigator-1") or the writer. */
  agent?: string
}
/** One hypothesis the answer tests against published sources. `result` exists only once the engine reported `hypothesis.checked`. */
export interface Hypothesis {
  id: string; text: string; supportIf: string; contradictIf: string; origin?: "planner" | "user"
  /** The investigator that works on this hypothesis ("investigator-1"). */
  agent?: string
  result?: { /** What it was tested with: "sources" today; a kind this page does not know is shown as text. */ testedBy?: { kind: string; run?: string }; verdict: Verdict; for: number[]; against: number[]; forStatements: number[]; againstStatements: number[]; mixed: boolean; note?: string }
}
export interface Note { index: number; reviewer: string; severity: "blocking" | "major" | "minor"; text: string; statement: number | null; resolved?: boolean; how?: string
  /** Who says so: the critic re-reading the revision ("reviewer"), the engine's code ("code"), or only the writer's own report ("writer"). */
  by?: "reviewer" | "code" | "writer" }
export interface Searched { provider: Provider; query: string; ran?: boolean; found?: number; kept?: number; reason?: string }
/** One step of the work, as the engine reports it: started, maybe progress, then finished with how it ended. */
export interface Step {
  step: string; kind: string; label: string; provider?: Provider; query?: string
  /** The hypothesis this search, screening or section draft belongs to, when it belongs to one. */
  hypothesis?: string
  /** Who does the step: "planner", "investigator-1", "searcher", "writer", "checker", "critic". */
  agent?: string
  /** A safe summary of what the step was given (never a key or a prompt), for a details view. */
  input?: Record<string, string | number | boolean>
  status: "running" | "completed" | "empty" | "failed" | "cancelled"
  ms?: number; found?: number; kept?: number; done?: number; total?: number; summary?: string; error?: string; consequence?: string
}
export interface Recommendation { label: string; text: string; why: string; basis: number[]; does?: string }
export interface Artifact { id: string; name: string; type: string; bytes: number; at?: number }
export interface Selection { criteria: string; /** The engine's own counts: results the searches returned, different sources among them, and how many were selected. */ counts?: { results: number; unique: number; selected: number }; selected: { n: number; why: string; limitation?: string }[]; notSelected: { title: string; url: string; provider: Provider; reason: string }[] }
export type ResearchEvent = { type: string; at?: number; seq?: number } & Record<string, unknown>

export interface AnswerState {
  mode?: "real" | "demo"; question?: string; effort?: string
  caps?: { maxUsd: number; maxSeconds: number }; models?: Record<string, string>
  searches: Searched[]; sources: Source[]; steps: Step[]
  /** One sentence from the engine saying what will be done. */
  opening?: string
  /** The source numbers the final text cites, when the engine said. */
  cited?: number[]
  recommendations: Recommendation[]; artifacts: Artifact[]
  /** The hypotheses being tested (empty: the question needed none, or the level sets none), why none, and those left out. */
  hypotheses: Hypothesis[]; hypothesesNote?: string; hypothesesCut: { text: string; reason: string }[]
  /** "What is missing": plain sentences the engine's code wrote (searches that did not run, failed checks, open concerns). */
  missing: string[]
  /** Why these sources were chosen, and what was found but left out. Written by the engine's code, not by a model. */
  selection?: Selection
  /** The engine restarted while this answer was being made, and went on with it. */
  resumed?: boolean
  /** The answer this one waits for (a follow-up sent while the thread was busy). */
  queuedAfter?: string
  /** The text to show now, and whether it is the engine's complete text (false: still being written). */
  markdown: string; complete: boolean; revised: boolean
  statements: Statement[]; notes: Note[]; reviewing: string[]
  status: "starting" | "queued" | "running" | "done" | "failed" | "cancelled"
  seconds?: number
  finished?: { usd: number; seconds: number; counts?: Record<string, number>; searches?: Record<string, number>; review?: { checker?: string; critic?: string; revised?: boolean; notes?: { raised: number; resolved: number } }; stopped?: string; note?: string }
  error?: string; spentUsd?: number
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
const VERDICTS = ["verified", "contradicted", "unsupported", "unchecked"]

/** What the events so far add up to. Unknown event types and malformed fields are ignored, never guessed at. */
export function foldAnswer(events: ResearchEvent[]): AnswerState {
  const s: AnswerState = { searches: [], sources: [], steps: [], recommendations: [], artifacts: [], hypotheses: [], hypothesesCut: [], missing: [], markdown: "", complete: false, revised: false, statements: [], notes: [], reviewing: [], status: "starting" }
  let deltas = "", written: string | undefined, revised: string | undefined
  const draft: Statement[] = [], final: Statement[] = []
  const results = new Map<string, Hypothesis["result"]>()
  const nums = (v: unknown): number[] => (Array.isArray(v) ? v.filter((n): n is number => typeof n === "number") : [])
  const judged = new Set<number>() // notes the critic has judged after the revision
  const by = (v: unknown): Note["by"] => (v === "reviewer" || v === "code" || v === "writer" ? v : undefined)
  // In order of seq, each seq once: a replay after a reconnect, or events that arrive out of order, change nothing.
  const once = new Map<number, ResearchEvent>(); const loose: ResearchEvent[] = []
  for (const e of events) { if (typeof e.seq === "number") { if (!once.has(e.seq)) once.set(e.seq, e) } else loose.push(e) }
  for (const e of [...[...once.values()].sort((a, b) => a.seq! - b.seq!), ...loose]) {
    if (s.status === "starting" || (s.status === "queued" && e.type !== "research.queued")) s.status = "running"
    switch (e.type) {
      case "research.started":
        s.mode = e.mode === "demo" ? "demo" : e.mode === "real" ? "real" : undefined
        s.question = str(e.question); s.effort = str(e.effort)
        if (e.caps && typeof e.caps === "object") { const c = e.caps as Record<string, unknown>; const maxUsd = num(c.maxUsd), maxSeconds = num(c.maxSeconds); if (maxUsd !== undefined && maxSeconds !== undefined) s.caps = { maxUsd, maxSeconds } }
        if (e.models && typeof e.models === "object") s.models = Object.fromEntries(Object.entries(e.models as object).filter(([, v]) => typeof v === "string")) as Record<string, string>
        break
      case "research.queued": s.status = "queued"; s.queuedAfter = str(e.after); break
      case "step.started":
        if (str(e.step) && !s.steps.some((x) => x.step === e.step)) s.steps.push({ step: str(e.step)!, kind: str(e.kind) ?? "", label: str(e.label) ?? "", provider: str(e.provider), query: str(e.query), hypothesis: str(e.hypothesis), agent: str(e.agent), status: "running",
          input: e.input && typeof e.input === "object" ? Object.fromEntries(Object.entries(e.input as object).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))) as Step["input"] : undefined })
        break
      case "step.progress": { const st = s.steps.find((x) => x.step === e.step); if (st) { st.done = num(e.done); st.total = num(e.total) } break }
      case "step.finished": {
        const st = s.steps.find((x) => x.step === e.step)
        const ended = e.status === "completed" || e.status === "empty" || e.status === "failed" || e.status === "cancelled" ? e.status : undefined
        if (st && ended) Object.assign(st, { status: ended, ms: num(e.ms), found: num(e.found), kept: num(e.kept), summary: str(e.summary), error: str(e.error), consequence: str(e.consequence) })
        break
      }
      case "opening": s.opening = str(e.text); break
      case "selection":
        s.selection = {
          criteria: str(e.criteria) ?? "",
          counts: ((c) => (c && num(c.results) !== undefined && num(c.unique) !== undefined && num(c.selected) !== undefined ? { results: num(c.results)!, unique: num(c.unique)!, selected: num(c.selected)! } : undefined))(e.counts as Record<string, unknown> | undefined),
          selected: Array.isArray(e.selected) ? (e.selected as Record<string, unknown>[]).flatMap((x) => (num(x?.n) !== undefined ? [{ n: num(x.n)!, why: str(x.why) ?? "", limitation: str(x.limitation) }] : [])) : [],
          notSelected: Array.isArray(e.notSelected) ? (e.notSelected as Record<string, unknown>[]).flatMap((x) => (str(x?.title) !== undefined || str(x?.url) ? [{ title: plainTitle(str(x.title) ?? ""), url: str(x.url) ?? "", provider: str(x.provider) ?? "", reason: str(x.reason) ?? "" }] : [])) : [],
        }
        break
      case "sources.cited": if (Array.isArray(e.n)) s.cited = (e.n as unknown[]).filter((n): n is number => typeof n === "number"); break
      case "recommendations":
        if (Array.isArray(e.items)) s.recommendations = (e.items as Record<string, unknown>[]).flatMap((r) => (str(r?.text) ? [{ label: str(r.label) ?? "Next step", text: str(r.text)!, why: str(r.why) ?? "", basis: Array.isArray(r.basis) ? (r.basis as unknown[]).filter((n): n is number => typeof n === "number") : [], does: str(r.does) }] : [])).slice(0, 3)
        break
      case "artifact.created": {
        // The file is nested ({artifact: {...}}), because the envelope already uses `type` and `at`. The flat form is read too.
        const f = (e.artifact && typeof e.artifact === "object" ? e.artifact : e) as Record<string, unknown>
        if (str(f.name) && !s.artifacts.some((a) => a.name === f.name)) s.artifacts.push({ id: str(f.id) ?? str(f.name)!, name: str(f.name)!, type: e.artifact ? str(f.type) ?? "" : "", bytes: num(f.bytes) ?? 0, at: num(f.at) })
        break
      }
      case "research.resumed": s.resumed = true; break
      case "missing": if (Array.isArray(e.items)) s.missing = (e.items as unknown[]).filter((x): x is string => typeof x === "string" && x.trim() !== ""); break
      case "research.cancelled": s.status = "cancelled"; s.spentUsd = num(e.spentUsd); s.seconds = num(e.seconds); break
      case "search.started": if (str(e.provider) && str(e.query) !== undefined) s.searches.push({ provider: str(e.provider)!, query: str(e.query)! }); break
      case "search.finished": {
        const done: Searched = { provider: str(e.provider) ?? "", query: str(e.query) ?? "", ran: e.ran === true, found: num(e.found), kept: num(e.kept), reason: str(e.reason) }
        const at = s.searches.findIndex((x) => x.ran === undefined && x.provider === done.provider && x.query === done.query)
        if (at >= 0) s.searches[at] = done; else s.searches.push(done)
        break
      }
      case "sources":
        if (Array.isArray(e.items)) s.sources = (e.items as Record<string, unknown>[]).flatMap((i) => (num(i?.n) !== undefined && str(i.url) !== undefined ? [{ n: num(i.n)!, url: str(i.url)!, title: plainTitle(str(i.title) ?? ""), provider: str(i.provider) ?? "", note: str(i.note), published: str(i.published)?.slice(0, 20), hypotheses: Array.isArray(i.hypotheses) ? (i.hypotheses as unknown[]).filter((h): h is string => typeof h === "string") : undefined }] : []))
        break
      case "answer.delta": deltas += str(e.text) ?? ""; break
      case "answer.written": written = str(e.markdown); break
      case "answer.revised":
        revised = str(e.markdown)
        if (Array.isArray(e.notes)) for (const n of e.notes as Record<string, unknown>[]) { const hit = s.notes.find((x) => x.index === n?.index); if (hit && !judged.has(hit.index)) { hit.resolved = n.resolved === true; hit.how = str(n.how); hit.by = by(n.by) } }
        break
      // The critic read the revision and judged each of its own notes: this is the final word on a note.
      case "review.resolved":
        if (Array.isArray(e.notes)) for (const n of e.notes as Record<string, unknown>[]) { const hit = s.notes.find((x) => x.index === n?.index); if (hit) { hit.resolved = n.resolved === true; hit.how = str(n.how); hit.by = by(n.by); judged.add(hit.index) } }
        break
      case "hypotheses":
        s.hypotheses = (Array.isArray(e.items) ? (e.items as Record<string, unknown>[]) : []).flatMap((h) => (str(h?.id) && str(h.text) ? [{ id: str(h.id)!, text: str(h.text)!, supportIf: str(h.supportIf) ?? "", contradictIf: str(h.contradictIf) ?? "", origin: h.origin === "user" ? "user" as const : h.origin === "planner" ? "planner" as const : undefined, agent: str(h.agent), result: results.get(str(h.id)!) }] : []))
        s.hypothesesNote = e.needed === false ? str(e.reason) ?? "This question needed no hypotheses." : undefined
        s.hypothesesCut = (Array.isArray(e.cut) ? (e.cut as Record<string, unknown>[]) : []).flatMap((c) => (str(c?.text) ? [{ text: str(c.text)!, reason: str(c.reason) ?? "" }] : []))
        break
      // The result of testing one hypothesis, computed by the engine's code from the checked statements. The only place a hypothesis's mark comes from.
      case "hypothesis.checked": {
        if (!str(e.id) || !VERDICTS.includes(e.verdict as string)) break
        const result: Hypothesis["result"] = { verdict: e.verdict as Verdict, for: nums(e.for), against: nums(e.against), forStatements: nums(e.forStatements), againstStatements: nums(e.againstStatements), mixed: e.mixed === true, note: str(e.note),
          testedBy: ((t) => (t && str(t.kind) ? { kind: str(t.kind)!.slice(0, 40), run: str(t.run) && /^[\w.-]{1,120}$/.test(str(t.run)!) ? str(t.run) : undefined } : undefined))(e.testedBy as Record<string, unknown> | undefined) }
        results.set(str(e.id)!, result)
        const hit = s.hypotheses.find((h) => h.id === e.id); if (hit) hit.result = result
        break
      }
      case "review.started": if (str(e.reviewer)) s.reviewing.push(str(e.reviewer)!); break
      case "statement.checked": {
        if (num(e.index) === undefined || str(e.text) === undefined || !VERDICTS.includes(e.verdict as string)) break
        const st: Statement = {
          stage: e.stage === "final" ? "final" : "draft", index: num(e.index)!, text: str(e.text)!, sources: Array.isArray(e.sources) ? (e.sources as unknown[]).filter((n): n is number => typeof n === "number") : [],
          verdict: e.verdict as Verdict, quote: str(e.quote), quoteFound: e.quoteFound === true, quoteSource: num(e.quoteSource), checker: str(e.checker) ?? "", note: str(e.note), carried: e.carried === true ? true : e.carried === false ? false : undefined,
          agent: str(e.agent), hypothesis: str(e.hypothesis), side: e.side === "for" || e.side === "against" ? e.side : undefined,
          stance: e.stance === "supports" || e.stance === "contradicts" || e.stance === "neither" || e.stance === "unchecked" ? e.stance : undefined,
        }
        const list = st.stage === "final" ? final : draft
        const at = list.findIndex((x) => x.index === st.index); if (at >= 0) list[at] = st; else list.push(st)
        break
      }
      case "review.note":
        if (num(e.index) !== undefined && str(e.text)) s.notes.push({ index: num(e.index)!, reviewer: str(e.reviewer) ?? "critic", severity: e.severity === "blocking" || e.severity === "major" ? e.severity : "minor", text: str(e.text)!, statement: num(e.statement) ?? null })
        break
      case "research.finished":
        s.status = "done"
        s.finished = { usd: num(e.usd) ?? 0, seconds: num(e.seconds) ?? 0, counts: e.counts as Record<string, number> | undefined, searches: e.searches as Record<string, number> | undefined, review: e.review as NonNullable<AnswerState["finished"]>["review"], stopped: str(e.stopped), note: str(e.note) }
        break
      case "research.failed": s.status = "failed"; s.error = str(e.error) ?? "The answer could not be finished."; s.spentUsd = num(e.spentUsd); break
    }
  }
  s.markdown = revised ?? written ?? deltas
  s.complete = revised !== undefined || written !== undefined
  s.revised = revised !== undefined
  // Final-stage checks replace the draft's. Without a revision the draft is the final text and its checks stand.
  s.statements = (final.length ? final : revised === undefined ? draft : []).sort((a, b) => a.index - b.index)
  return s
}

export const providerPlace = (p: Provider) => PROVIDERS[p]?.place ?? p

/** How one step ended, or what it is doing, in a few words. Never "done" for a step that failed or found nothing. */
export function stepLine(st: Step): string {
  if (st.status === "running") return `${st.label}${st.total ? `: ${st.done ?? 0} of ${st.total}` : ""}…`
  if (st.status === "failed") return `${st.label}: did not work${st.error ? `. ${st.error}` : "."}${st.consequence ? ` ${st.consequence}` : ""}`
  if (st.status === "cancelled") return `${st.label}: stopped.`
  if (st.status === "empty") return `${st.label}: found nothing.`
  if (st.kind === "search") return `${st.label}: found ${st.found ?? 0}${st.kept !== undefined ? `, kept ${st.kept}` : ""}.`
  if (st.kind === "evaluate" && st.kept !== undefined) return `${st.label}: kept ${st.kept}.`
  return `${st.label}: done${st.summary ? `. ${st.summary}` : "."}`
}

/** One honest line about what is happening now, from the events alone. */
export function progressLine(s: AnswerState): string {
  if (s.status === "starting") return "Starting…"
  if (s.status === "queued") return "Waiting for the answer before it to finish…"
  // An engine that reports steps: say what is running now (several can run at once), else how the last one ended.
  if (s.steps.length) {
    const running = s.steps.filter((x) => x.status === "running")
    if (running.length) return running.map((x) => stepLine(x).replace(/…$/, "")).join(" · ") + "…"
    return stepLine(s.steps.at(-1)!)
  }
  if (s.statements.length || s.reviewing.length) {
    if (s.revised) return `Checking the revised answer: ${s.statements.length} statement${s.statements.length === 1 ? "" : "s"} checked so far…`
    if (s.notes.length) return "Revising the answer after review…"
    return s.statements.length ? `Checking statements against the sources: ${s.statements.length} checked so far…` : "Two reviewers are checking the answer…"
  }
  if (s.markdown) return "Writing…"
  if (s.sources.length) return `Kept ${s.sources.length} source${s.sources.length === 1 ? "" : "s"}. Writing…`
  const last = s.searches.at(-1)
  if (!last) return "Getting ready…"
  if (last.ran === undefined) return `Searching ${providerPlace(last.provider)}…`
  if (!last.ran) return `The search of ${providerPlace(last.provider)} did not run${last.reason ? `: ${last.reason}` : "."}`
  return `Found ${last.found ?? 0} in ${providerPlace(last.provider)}, kept ${last.kept ?? 0}.`
}

/** Markdown read as plain text: emphasis marks, code ticks and "[n]" citation markers left out. `at[i]` is where plain character i sits in the Markdown. */
export function plainReading(markdown: string): { plain: string; at: number[] } {
  let plain = ""; const at: number[] = []
  for (let i = 0; i < markdown.length; i++) {
    const c = markdown[i]
    if (c === "*" || c === "`" || (c === "_" && (markdown[i + 1] === "_" || markdown[i - 1] === "_"))) continue
    const cite = /^\s*\[\d+\]/.exec(markdown.slice(i, i + 12))
    if (cite && (c === "[" || /\s/.test(c))) { i += cite[0].length - 1; continue }
    plain += c; at.push(i)
  }
  return { plain, at }
}

/**
 * The answer's Markdown with its citation markers and check marks turned into private links the renderer knows:
 * "[2]" becomes a citation chip, and each checked statement gets a mark after its sentence. The private address
 * carries a key made for this render, so text a model wrote cannot place a chip or a mark itself.
 * Returns the statements that could not be found in the text; the caller lists those below the answer instead.
 */
export function withMarks(markdown: string, statements: Statement[], sources: Source[], key: string): { text: string; unplaced: Statement[] } {
  let text = markdown.replaceAll(`#${key}`, "#") // nothing the text says can use the key
  const unplaced: Statement[] = []
  const known = new Set(sources.map((s) => s.n))
  // statements first, from the end of the text, so earlier positions stay valid
  // The engine's statement is the sentence as plain text: without the emphasis marks and citation markers the
  // answer's Markdown has around and inside it. So it is looked for in a plain reading of the Markdown, and the
  // place found is carried back to the Markdown.
  const read = plainReading(text)
  const found = statements.map((st) => {
    const plain = plainReading(st.text.trim()).plain
    let at = plain ? read.plain.indexOf(plain) : -1
    let size = plain.length
    if (at < 0 && /[.!?]$/.test(plain)) { at = read.plain.indexOf(plain.slice(0, -1)); size = plain.length - 1 }
    if (at < 0) return { st, at: -1, len: 0 }
    const end = read.at[at + size - 1] + 1
    return { st, at: read.at[at], len: end - read.at[at] }
  })
  for (const f of found.filter((x) => x.at < 0)) unplaced.push(f.st)
  for (const { st, at, len } of found.filter((x) => x.at >= 0).sort((a, b) => b.at - a.at)) {
    const rest = text.slice(at + len)
    const tail = /^[*_`]*[.!?]?[*_`]*(?:\s*\[\d+\])*[.!?]?/.exec(rest)?.[0] ?? "" // after its citations and the full stop
    const end = at + len + tail.length
    text = `${text.slice(0, end)} [check](#${key}-check-${st.index})${text.slice(end)}`
  }
  text = text.replace(/\[(\d+)\](?!\()/g, (whole, n: string) => (known.has(Number(n)) ? `[${n}](#${key}-cite-${n})` : whole))
  return { text, unplaced }
}

/** The answer as plain text with its numbered source list, for "Copy answer". */
export const copyText = (s: AnswerState): string =>
  [s.markdown.trim(), s.sources.length ? `\nSources\n${s.sources.map((x) => `[${x.n}] ${x.title || x.url} ${x.url}`).join("\n")}` : ""].join("\n").trim()

/** The measured preparation phase: the engine's "prepare" step. undefined when the engine reported none. */
export const preparation = (s: AnswerState): { running: boolean; ms?: number; failed?: boolean } | undefined => {
  const p = s.steps.find((x) => x.kind === "prepare")
  return p ? { running: p.status === "running", ms: p.ms, failed: p.status === "failed" } : undefined
}
/** Found, selected and cited are three different things. Counts only what the engine reported. */
/**
 * What is being done for one hypothesis right now, from the steps that carry its tag: "Searching" or "Screening
 * results" while one of its own steps runs, "Checking" while a check step runs after its searches. undefined when
 * nothing reported says so. Never a result: that comes only from `hypothesis.checked`.
 */
export function hypothesisDoing(s: AnswerState, id: string): string | undefined {
  if (s.status !== "running") return undefined
  const mine = s.steps.filter((x) => x.hypothesis === id)
  if (mine.some((x) => x.status === "running" && x.kind === "search")) return "Searching"
  if (mine.some((x) => x.status === "running" && x.kind === "write")) return "Drafting its section"
  if (mine.some((x) => x.status === "running")) return "Screening results"
  if (mine.length > 0 && s.steps.some((x) => x.status === "running" && x.kind === "check")) return "Checking"
  return undefined
}

/**
 * What one hypothesis's investigator has done so far, counted from the finished steps that carry the hypothesis's
 * tag: "2 searches, 9 results screened, section drafted". Empty when no step reported anything.
 */
export function hypothesisWork(s: AnswerState, id: string): string {
  const mine = s.steps.filter((x) => x.hypothesis === id && x.status !== "running")
  const searches = mine.filter((x) => x.kind === "search")
  const failed = searches.filter((x) => x.status === "failed").length
  const screened = mine.filter((x) => x.kind === "evaluate" && x.status === "completed")
  const kept = screened.reduce((n, x) => n + (x.kept ?? 0), 0)
  const drafted = mine.find((x) => x.kind === "write")
  return [
    searches.length ? `${searches.length} search${searches.length === 1 ? "" : "es"}${failed ? ` (${failed} failed)` : ""}` : "",
    screened.length ? `${kept} result${kept === 1 ? "" : "s"} kept after screening` : "",
    drafted ? (drafted.status === "completed" ? "section drafted" : `section draft ${drafted.status}`) : "",
  ].filter(Boolean).join(", ")
}

/** How a critic's note ended, in words. Only a check (the critic re-reading, or the engine's code) makes it "dealt with"; the writer saying so is only a report. */
export const noteOutcome = (n: Note): { word: string; kind: "success" | "warning" | "neutral" } =>
  n.resolved === undefined ? { word: "raised", kind: "neutral" }
    : !n.resolved ? { word: "not dealt with", kind: "warning" }
      : n.by === "writer" ? { word: "reported addressed by the writer, not re-checked", kind: "neutral" }
        : { word: n.by === "reviewer" ? "dealt with, confirmed by the critic" : "dealt with", kind: "success" }

/** A title as text: a database title can carry markup ("<i>KRAS</i>"), which is never rendered and reads badly as text. */
export function plainTitle(title: string): string { return title.replace(/<\/?(?:i|b|em|strong|sub|sup|u)>/gi, "").replace(/\s+/g, " ").trim() }

export const sourceCounts = (s: AnswerState): { found?: number; selected: number; cited?: number } => {
  const searches = s.steps.filter((x) => x.kind === "search" && x.found !== undefined)
  return { found: searches.length ? searches.reduce((n, x) => n + (x.found ?? 0), 0) : s.selection ? s.selection.selected.length + s.selection.notSelected.length : undefined, selected: s.sources.length, cited: s.cited?.length }
}

/**
 * A stored record (GET /api/research/:id, or an item of GET /api/research?thread=) as the same state the events
 * give. This is how a reload shows a finished answer at once, before or without its event stream.
 */
export function fromRecord(record: unknown): AnswerState | undefined {
  const r = record as Record<string, unknown> | null
  if (!r || typeof r.id !== "string") return undefined
  const events: ResearchEvent[] = []
  let seq = 0
  const push = (type: string, rest: object) => events.push({ ...rest, type, seq: ++seq }) // a record field named "type" or "seq" cannot displace these
  push("research.started", { id: r.id, thread: r.thread, question: r.question, effort: r.effort, mode: r.mode, caps: r.caps, models: r.models })
  if (r.status === "queued") push("research.queued", { after: r.after })
  for (const st of Array.isArray(r.steps) ? (r.steps as Record<string, unknown>[]) : []) { push("step.started", st); if (st.status !== "running") push("step.finished", st) }
  if (typeof r.opening === "string") push("opening", { text: r.opening })
  if (Array.isArray(r.sources) && r.sources.length) push("sources", { items: r.sources })
  if (r.selection) push("selection", r.selection as object)
  const answer = r.answer as { markdown?: unknown } | undefined
  if (typeof r.draft === "string") push("answer.written", { markdown: r.draft })
  else if (typeof answer?.markdown === "string") push("answer.written", { markdown: answer.markdown })
  const review = r.review as { notes?: unknown[]; revised?: unknown } | undefined
  for (const n of Array.isArray(review?.notes) ? (review!.notes as object[]) : []) push("review.note", n)
  const statements = Array.isArray(r.statements) ? (r.statements as Record<string, unknown>[]) : []
  const revised = review?.revised === true && typeof r.draft === "string" && typeof answer?.markdown === "string" && answer.markdown !== r.draft
  if (revised) push("answer.revised", { markdown: answer!.markdown, notes: Array.isArray(review?.notes) ? review!.notes : [] })
  for (const st of statements) push("statement.checked", { ...st, stage: revised ? "final" : st.stage ?? "draft" })
  const cited = (Array.isArray(r.sources) ? (r.sources as Record<string, unknown>[]) : []).filter((x) => x.cited === true).map((x) => x.n)
  if ((Array.isArray(r.sources) ? (r.sources as Record<string, unknown>[]) : []).some((x) => typeof x.cited === "boolean")) push("sources.cited", { n: cited })
  if (Array.isArray(r.hypotheses)) {
    push("hypotheses", { items: r.hypotheses, ...(r.hypotheses.length === 0 && typeof r.hypothesesNote === "string" ? { needed: false, reason: r.hypothesesNote } : {}) })
    for (const h of r.hypotheses as Record<string, unknown>[]) if (h && typeof h.verdict === "string") push("hypothesis.checked", h)
  }
  if (Array.isArray(r.recommendations)) push("recommendations", { items: r.recommendations })
  if (Array.isArray(r.missing)) push("missing", { items: r.missing })
  for (const a of Array.isArray(r.artifacts) ? (r.artifacts as object[]) : []) push("artifact.created", { artifact: a })
  if (r.status === "done") push("research.finished", { usd: r.usd, seconds: r.seconds, counts: r.counts, searches: {}, review: r.review, stopped: r.stopped, note: r.note })
  else if (r.status === "failed") push("research.failed", { error: r.error, spentUsd: r.usd })
  else if (r.status === "cancelled") push("research.cancelled", { spentUsd: r.usd, seconds: r.seconds })
  return foldAnswer(events)
}

/** A duration the engine measured, short, for a label: "0.3s", "2s", "41s", "2m 5s". */
export function seconds(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "–"
  if (ms < 950) return `${Math.max(0.1, Math.round(ms / 100) / 10).toFixed(1)}s`
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}
