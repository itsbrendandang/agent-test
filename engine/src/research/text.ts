// Pure text work on an answer: nothing here calls a model or the network. This is where code, not a model, decides
// which markers stand, what the cited sentences are, and what a key or an over-long text is cut to.
import { PAID_KEYS } from "../paid.ts"

/** Hard size caps on text from a person or a model. */
export const MAX_ANSWER_CHARS = 12_000
export const MAX_STATEMENT_CHARS = 1_000
export const MAX_STATEMENTS = 40
export const MAX_NOTE_CHARS = 500
export const MAX_QUERY_CHARS = 300
export const MAX_SOURCE_CHARS = 3_000
export const MAX_TITLE_CHARS = 300

/** "<" escaped, as questions.ts and board.ts do for every text a model reads as data. */
export const escapeData = (text: string): string => text.replaceAll("<", "&lt;")

/** One line of plain text: control and invisible characters dropped, whitespace collapsed, cut to `max`. */
export const oneLine = (text: unknown, max: number): string =>
  String(text ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max)

/** Text that keeps its line breaks: control and invisible characters dropped (not \n), cut to `max`. */
export const plainBlock = (text: unknown, max: number): string =>
  String(text ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]+/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max)

/**
 * An error or note that may be shown: every key in the environment and anything shaped like a key or a bearer token
 * is taken out, and the text is cut. Used for every message that reaches an event, a record or an HTTP answer.
 */
export function scrub(text: unknown, env: NodeJS.ProcessEnv = process.env, max = 400): string {
  let out = String(text ?? "")
  for (const name of PAID_KEYS) { const value = env[name]?.trim(); if (value && value.length >= 6) out = out.split(value).join("[key removed]") }
  out = out.replace(/\b(sk|pk|rk|exa|key)[-_][A-Za-z0-9_\-*.]{8,}/gi, "[key removed]").replace(/\bBearer\s+[^\s"',;]+/gi, "Bearer [key removed]").replace(/(x-api-key|api[_-]?key|authorization)(["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, "$1$2[key removed]")
  return oneLine(out, max)
}

/** True for an address a source may carry: http or https, parseable, no user name or password in it. */
export function safeUrl(url: unknown): url is string {
  if (typeof url !== "string" || url.length > 2_000 || /[\s<>"'`\\\u0000-\u001f]/.test(url)) return false
  try { const u = new URL(url); return (u.protocol === "https:" || u.protocol === "http:") && !u.username && !u.password && u.hostname.includes(".") } catch { return false }
}

// ── Markers ──────────────────────────────────────────────────────────────────────────────────────

/** "[1, 2]" and "[1-3]" and "【1】" written as "[1][2]..." so that one form is left to read. */
function normalizeMarkers(text: string): string {
  return text
    .replace(/【\s*(\d{1,2})[^】]{0,12}】/g, "[$1]")
    .replace(/\[(\d{1,2})\s*[-–]\s*(\d{1,2})\]/g, (whole, a: string, b: string) => {
      const from = Number(a), to = Number(b)
      return to > from && to - from <= 8 ? Array.from({ length: to - from + 1 }, (_, i) => `[${from + i}]`).join("") : whole
    })
    .replace(/\[(\d{1,2}(?:\s*[,;]\s*\d{1,2})+)\]/g, (_whole, list: string) => list.split(/[,;]/).map((n) => `[${Number(n)}]`).join(""))
}

/**
 * The answer as it may be shown. Code, not the model, decides what stays:
 * - a marker that names no kept source (not 1..sources) is removed;
 * - Markdown links and images become their text, and a web address that is not one of the sources' is removed, so
 *   text copied from a source cannot plant a link in the answer;
 * - the text is cut to MAX_ANSWER_CHARS at a paragraph end.
 * Returns the text and how many markers were removed.
 */
export function cleanAnswer(markdown: string, sources: number, sourceUrls: string[] = []): { markdown: string; removedMarkers: number } {
  let removedMarkers = 0
  const known = new Set(sourceUrls)
  let text = plainBlock(markdown, MAX_ANSWER_CHARS * 2)
    .replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\[([^\]\d][^\]]*)\]\([^)]*\)/g, "$1").replace(/\[(\d{1,2})\]\([^)]*\)/g, "[$1]")
    .replace(/<?\bhttps?:\/\/[^\s<>)\]]+>?/gi, (url) => (known.has(url.replace(/^<|>$/g, "").replace(/[.,;:]+$/, "")) ? url : "(link removed)"))
  text = normalizeMarkers(text).replace(/\s*\[(\d{1,2})\]/g, (whole, n: string) => {
    if (Number(n) >= 1 && Number(n) <= sources) return whole
    removedMarkers++
    return ""
  })
  if (text.length > MAX_ANSWER_CHARS) {
    const cut = text.slice(0, MAX_ANSWER_CHARS)
    const at = Math.max(cut.lastIndexOf("\n\n"), cut.lastIndexOf(". ") + 1)
    text = `${cut.slice(0, at > MAX_ANSWER_CHARS / 2 ? at : MAX_ANSWER_CHARS).trimEnd()}\n\n(The text was cut here: it was longer than this app shows.)`
  }
  return { markdown: text.trim(), removedMarkers }
}

// ── Sentences ────────────────────────────────────────────────────────────────────────────────────

export interface Sentence {
  /** The sentence without markers and without Markdown emphasis: what is checked against a source. */
  text: string
  /** The sources its markers name, in order, each once. Empty for a sentence with no marker. */
  sources: number[]
}

const ABBREVIATION = /(?:\b(?:e\.g|i\.e|et al|vs|cf|ca|approx|fig|figs|no|dr|prof|st|inc|ltd|resp)|\b[A-Z])\.$/i
const stripMarkdown = (text: string) => text.replace(/\*\*|__|`/g, "").replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, "$1$2")

/** The text units of an answer: paragraphs and list items. Headings, tables, rules and code are left out. */
function units(markdown: string): string[] {
  const out: string[] = []
  let paragraph: string[] = []
  const flush = () => { if (paragraph.length) out.push(paragraph.join(" ")); paragraph = [] }
  for (const raw of markdown.split("\n")) {
    const line = raw.trim()
    if (!line) { flush(); continue }
    if (/^(#{1,6}\s|\||```|~~~|---+$|\*\*\*+$)/.test(line)) { flush(); continue }
    const item = /^(?:[-*+]|\d{1,2}[.)])\s+(.*)$/.exec(line)
    if (item) { flush(); out.push(item[1]); continue }
    paragraph.push(line.replace(/^>\s?/, ""))
  }
  flush()
  return out
}

/**
 * Every sentence of an answer, with the sources its markers name. A marker belongs to the sentence it ends: written
 * before the full stop ("... 20% [2].") or right after it ("... 20%. [2]"). Splitting is by rule: a sentence ends at
 * ". ", "! " or "? " before a capital letter or a digit, or right after a marker; common abbreviations do not end one.
 * A wrong split makes a sentence shorter or longer than the writer meant, which can only make its check harder to pass.
 */
export function sentencesOf(markdown: string): Sentence[] {
  const out: Sentence[] = []
  for (const unit of units(markdown)) {
    const text = normalizeMarkers(unit).replace(/([.!?]["'”’)]?)((?:\s*\[\d{1,2}\])+)(?=\s|$)/g, "$2$1")
    const pieces: string[] = []
    let from = 0
    const boundary = /[.!?]["'”’)*_]*\s+/g
    for (let m = boundary.exec(text); m; m = boundary.exec(text)) {
      const end = m.index + m[0].length
      const before = text.slice(from, m.index + 1), after = text.slice(end)
      const afterMarker = /\]\s*[.!?]$/.test(before.replace(/["'”’)*_]+$/, ""))
      if (!afterMarker && !/^["'“‘(*_]*[A-Z0-9]/.test(after)) continue
      if (!afterMarker && ABBREVIATION.test(before)) continue
      pieces.push(text.slice(from, end)); from = end
    }
    if (from < text.length) pieces.push(text.slice(from))
    for (const piece of pieces) {
      const sources = [...new Set([...piece.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])))]
      const plain = stripMarkdown(piece.replace(/\s*\[\d{1,2}\]/g, "")).replace(/\s+/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim()
      if (plain.replace(/[^\p{L}\p{N}]/gu, "").length < 3) continue
      out.push({ text: plain.slice(0, MAX_STATEMENT_CHARS), sources })
    }
  }
  return out
}

/** The cited sentences: those with at least one marker. Their order is their index. */
export const citedSentences = (markdown: string): Sentence[] => sentencesOf(markdown).filter((s) => s.sources.length > 0)

/** Two sentences are "the same" when they differ only in case, spacing and closing punctuation. */
export const sameText = (text: string): string => text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").replace(/[\s.!?;:,]+$/, "").trim()
export const statementKey = (s: Sentence): string => `${sameText(s.text)}|${[...s.sources].sort((a, b) => a - b).join(",")}`

/** The direct answer: the first paragraph, without markers or emphasis, cut to `max`. */
export function directAnswer(markdown: string, max = 500): string {
  const first = units(markdown)[0] ?? ""
  return stripMarkdown(normalizeMarkers(first).replace(/\s*\[\d{1,2}\]/g, "")).replace(/\s+/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim().slice(0, max)
}

export const ADVICE_LINE = "This is a research summary, not medical advice."
const HEALTH = /\b(patients?|treat(?:ment|ed|ing)?|therap(?:y|ies|eutic)|drugs?|dos(?:e|es|ing|age)|disease|disorder|syndrome|cancer|tumou?rs?|diabet|clinical|trials?|symptoms?|diagnos|medic(?:ine|ation|al)|side effects?|adverse|toxicit|safety|surgery|vaccin|infection|risk of|mortality|pregnan|inhibitors?|health)\b/i
/** A word rule for "is this about health": used with the planner's own flag, so the line is added even when the planner failed. */
export const looksMedical = (question: string): boolean => HEALTH.test(question)

/** The answer with the medical line as its last line, once. */
export function withAdviceLine(markdown: string): string {
  if (/not medical advice/i.test(markdown)) return markdown
  return `${markdown.trimEnd()}\n\n${ADVICE_LINE}`
}

/** Words of a question for a keyword query, when no planner wrote one: the longest distinct words, in their order, at most `max`. */
export function keywordsOf(question: string, max = 6): string {
  const STOP = new Set("the a an and or of in on for to with without is are was were be been does do did can could should would will what which who whom whose how why when where that this these those it its their there than then as at by from about into over under between not no any some more most less least have has had".split(" "))
  const words = oneLine(question, 400).replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w.toLowerCase()))
  const distinct = [...new Set(words)]
  const keep = new Set([...distinct].sort((a, b) => b.length - a.length).slice(0, max))
  return distinct.filter((w) => keep.has(w)).join(" ")
}
