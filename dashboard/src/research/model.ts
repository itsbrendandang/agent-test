// A direct, sourced answer, as the engine streams it (GET /api/research/:id/events). This file is the pure part:
// the event shapes, and how a list of events becomes what the screen shows. Rules that keep it honest:
//  - the text is the revised answer when a revision ran, else the first draft, else the provisional draft so far;
//  - a statement's mark comes only from a statement.checked event (the final stage when there is one);
//  - a search that did not run is never shown as done: its reason is shown instead.
import type { Verdict } from "@/board/api"

export type Provider = string // "exa" | "europepmc" | "fixture" | a database name
export interface Source { n: number; url: string; title: string; provider: Provider; note?: string }
export interface Statement {
  stage: "draft" | "final"; index: number; text: string; sources: number[]; verdict: Verdict
  quote?: string; quoteFound: boolean; quoteSource?: number; checker: string; note?: string; carried?: boolean
}
export interface Note { index: number; reviewer: string; severity: "blocking" | "major" | "minor"; text: string; statement: number | null; resolved?: boolean; how?: string }
export interface Searched { provider: Provider; query: string; ran?: boolean; found?: number; kept?: number; reason?: string }
/** One step of the work, as the engine reports it: started, maybe progress, then finished with how it ended. */
export interface Step {
  step: string; kind: string; label: string; provider?: Provider; query?: string
  status: "running" | "completed" | "empty" | "failed" | "cancelled"
  ms?: number; found?: number; kept?: number; done?: number; total?: number; summary?: string; error?: string; consequence?: string
}
export interface Recommendation { label: string; text: string; why: string; basis: number[]; does?: string }
export interface Artifact { id: string; name: string; type: string; bytes: number }
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
  const s: AnswerState = { searches: [], sources: [], steps: [], recommendations: [], artifacts: [], markdown: "", complete: false, revised: false, statements: [], notes: [], reviewing: [], status: "starting" }
  let deltas = "", written: string | undefined, revised: string | undefined
  const draft: Statement[] = [], final: Statement[] = []
  for (const e of [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))) {
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
        if (str(e.step) && !s.steps.some((x) => x.step === e.step)) s.steps.push({ step: str(e.step)!, kind: str(e.kind) ?? "", label: str(e.label) ?? "", provider: str(e.provider), query: str(e.query), status: "running" })
        break
      case "step.progress": { const st = s.steps.find((x) => x.step === e.step); if (st) { st.done = num(e.done); st.total = num(e.total) } break }
      case "step.finished": {
        const st = s.steps.find((x) => x.step === e.step)
        const ended = e.status === "completed" || e.status === "empty" || e.status === "failed" || e.status === "cancelled" ? e.status : undefined
        if (st && ended) Object.assign(st, { status: ended, ms: num(e.ms), found: num(e.found), kept: num(e.kept), summary: str(e.summary), error: str(e.error), consequence: str(e.consequence) })
        break
      }
      case "opening": s.opening = str(e.text); break
      case "sources.cited": if (Array.isArray(e.n)) s.cited = (e.n as unknown[]).filter((n): n is number => typeof n === "number"); break
      case "recommendations":
        if (Array.isArray(e.items)) s.recommendations = (e.items as Record<string, unknown>[]).flatMap((r) => (str(r?.text) ? [{ label: str(r.label) ?? "Next step", text: str(r.text)!, why: str(r.why) ?? "", basis: Array.isArray(r.basis) ? (r.basis as unknown[]).filter((n): n is number => typeof n === "number") : [], does: str(r.does) }] : [])).slice(0, 3)
        break
      case "artifact.created": if (str(e.name) && !s.artifacts.some((a) => a.name === e.name)) s.artifacts.push({ id: str(e.id) ?? str(e.name)!, name: str(e.name)!, type: str(e.type) ?? "", bytes: num(e.bytes) ?? 0 }); break
      case "research.cancelled": s.status = "cancelled"; s.spentUsd = num(e.spentUsd); s.seconds = num(e.seconds); break
      case "search.started": if (str(e.provider) && str(e.query) !== undefined) s.searches.push({ provider: str(e.provider)!, query: str(e.query)! }); break
      case "search.finished": {
        const done: Searched = { provider: str(e.provider) ?? "", query: str(e.query) ?? "", ran: e.ran === true, found: num(e.found), kept: num(e.kept), reason: str(e.reason) }
        const at = s.searches.findIndex((x) => x.ran === undefined && x.provider === done.provider && x.query === done.query)
        if (at >= 0) s.searches[at] = done; else s.searches.push(done)
        break
      }
      case "sources":
        if (Array.isArray(e.items)) s.sources = (e.items as Record<string, unknown>[]).flatMap((i) => (num(i?.n) !== undefined && str(i.url) !== undefined ? [{ n: num(i.n)!, url: str(i.url)!, title: str(i.title) ?? "", provider: str(i.provider) ?? "", note: str(i.note) }] : []))
        break
      case "answer.delta": deltas += str(e.text) ?? ""; break
      case "answer.written": written = str(e.markdown); break
      case "answer.revised":
        revised = str(e.markdown)
        if (Array.isArray(e.notes)) for (const n of e.notes as Record<string, unknown>[]) { const hit = s.notes.find((x) => x.index === n?.index); if (hit) { hit.resolved = n.resolved === true; hit.how = str(n.how) } }
        break
      case "review.started": if (str(e.reviewer)) s.reviewing.push(str(e.reviewer)!); break
      case "statement.checked": {
        if (num(e.index) === undefined || str(e.text) === undefined || !VERDICTS.includes(e.verdict as string)) break
        const st: Statement = {
          stage: e.stage === "final" ? "final" : "draft", index: num(e.index)!, text: str(e.text)!, sources: Array.isArray(e.sources) ? (e.sources as unknown[]).filter((n): n is number => typeof n === "number") : [],
          verdict: e.verdict as Verdict, quote: str(e.quote), quoteFound: e.quoteFound === true, quoteSource: num(e.quoteSource), checker: str(e.checker) ?? "", note: str(e.note), carried: e.carried === true ? true : e.carried === false ? false : undefined,
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

const PROVIDER_VERB: Record<string, string> = { exa: "the web", europepmc: "PubMed and preprints", fixture: "the example sources" }
export const providerPlace = (p: Provider) => PROVIDER_VERB[p] ?? p

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
  const found = statements.map((st) => {
    const plain = st.text.trim()
    let at = text.indexOf(plain)
    let len = plain.length
    if (at < 0 && /[.!?]$/.test(plain)) { at = text.indexOf(plain.slice(0, -1)); len = plain.length - 1 }
    return { st, at, len }
  })
  for (const f of found.filter((x) => x.at < 0)) unplaced.push(f.st)
  for (const { st, at, len } of found.filter((x) => x.at >= 0).sort((a, b) => b.at - a.at)) {
    const rest = text.slice(at + len)
    const tail = /^[.!?]?(?:\s*\[\d+\])*[.!?]?/.exec(rest)?.[0] ?? "" // after its citations and the full stop
    const end = at + len + tail.length
    text = `${text.slice(0, end)} [check](#${key}-check-${st.index})${text.slice(end)}`
  }
  text = text.replace(/\[(\d+)\](?!\()/g, (whole, n: string) => (known.has(Number(n)) ? `[${n}](#${key}-cite-${n})` : whole))
  return { text, unplaced }
}

/** The answer as plain text with its numbered source list, for "Copy answer". */
export const copyText = (s: AnswerState): string =>
  [s.markdown.trim(), s.sources.length ? `\nSources\n${s.sources.map((x) => `[${x.n}] ${x.title || x.url} ${x.url}`).join("\n")}` : ""].join("\n").trim()
