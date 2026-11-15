// The first pass of the board's evidence and claim checking: a cheap model, called directly (Anthropic or OpenAI),
// answers in strict JSON, and code decides what the answer is worth.
//
// It does two jobs on the hot path:
//   1. triage of Exa results: is this a study that reports results, what type, does it help the key question;
//   2. a first ruling on each claim against the source it cites: verified / contradicted / unsupported / escalate.
//      Only what stays "escalate" reaches the expensive checkers (checkers.ts).
//
// WHAT CODE CHECKS, AND WHAT IT CANNOT.
// A model's own confidence is not calibrated, so there are no probability thresholds. The model gives a category
// and must QUOTE the passage of the source that shows it. Code then requires:
//   - the reply is valid JSON of exactly the expected shape, one ruling per claim, no duplicates, known words only;
//   - for "supports"/"contradicts": the quote is really in the source text (whitespace and case aside), is at
//     least MIN_QUOTE characters long, has no ellipsis; and for "supports" every number in the claim appears in
//     the quote;
//   - the checker is from a different vendor than the member who made the claim (providers.ts firstPassModel).
// Anything else, including any malformed or truncated reply, is "escalate" (and "unchecked" once the escalation cap
// is used up). Nothing malformed is ever "verified".
// WEAKNESS: a quote that exists proves the model did not invent the passage. It does not prove that the passage
// supports the claim, and a web page can contain text written to be quoted (prompt injection). The number rule
// narrows this, nothing removes it. Treat "verified" here as "a different model found a real supporting passage",
// not as a proof.
import type { Models } from "@earendil-works/pi-ai"
import { type BoardConfig, MOCK } from "./config.ts"
import type { EvidenceItem, Verdict } from "./events.ts"
import { refusePaid } from "./paid.ts"
import { firstPassModel, type ModelId, parseModelId } from "./providers.ts"
import { CHECK_SYSTEM, checkPrompt, TRIAGE_SYSTEM, triagePrompt } from "./questions.ts"

export const MIN_QUOTE = 20 // characters; a shorter "quote" is a phrase, not a passage
export const MAX_QUOTE = 600

export type Raw = "supports" | "contradicts" | "not_stated" | "unclear" | "invalid"
export interface RawRuling { verdict: Raw; quote: string }
export interface FirstPassRuling {
  verdict: Verdict | "escalate"
  /** The source passage a verified or contradicted ruling rests on (checked to be in the source). */
  quote?: string
  /** Why a ruling was not accepted, when it was not. */
  reason?: string
  /** The model that gave the ruling, "vendor/model", or "scripted". */
  checkedBy: string
}

/** The JSON object in a reply: the whole reply, optionally inside one ``` fence. Anything else is undefined. */
export function parseJson(text: string): unknown {
  const body = text.trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```$/, "").trim()
  try { return JSON.parse(body) } catch { return undefined }
}

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v)
const RAW = new Set<string>(["supports", "contradicts", "not_stated", "unclear"])

/**
 * One RawRuling per claim, read strictly. A reply that is not the expected object gives "invalid" for every claim;
 * an entry with an index outside 0..n-1, a repeated index, an unknown word or a non-string quote makes that claim
 * (and for a repeated index, every claim it names) "invalid". "invalid" is never a verdict: it escalates.
 */
export function readRulings(text: string, n: number): RawRuling[] {
  const invalid = (): RawRuling => ({ verdict: "invalid", quote: "" })
  const out = Array.from({ length: n }, invalid)
  const body = parseJson(text)
  if (!isObject(body) || !Array.isArray(body.rulings)) return out
  const seen = new Map<number, number>()
  const entries = new Map<number, RawRuling>()
  for (const e of body.rulings) {
    if (!isObject(e) || typeof e.i !== "number" || !Number.isInteger(e.i) || e.i < 0 || e.i >= n) continue
    seen.set(e.i, (seen.get(e.i) ?? 0) + 1)
    if (typeof e.verdict === "string" && RAW.has(e.verdict) && typeof e.quote === "string") entries.set(e.i, { verdict: e.verdict as Raw, quote: e.quote })
  }
  for (const [i, ruling] of entries) if (seen.get(i) === 1) out[i] = ruling
  return out
}

/** Lower case, one kind of quote mark and space, so a copy that differs in layout still matches. */
const squash = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\s\u00a0]+/g, " ").trim()

/** Is `quote` a real passage of `source`? Long enough, no ellipsis, and found in the source after squashing. */
export function quoteInSource(quote: string, source: string): boolean {
  const q = squash(quote.replaceAll("&lt;", "<"))
  if (q.length < MIN_QUOTE || quote.length > MAX_QUOTE || /\.{3}|\u2026/.test(quote)) return false
  return squash(source).includes(q)
}

/** The numbers a claim states ("5.2", "300"). Each must appear in the quote that supports it. */
export const numbersIn = (text: string): string[] => text.match(/\d+(?:[.,]\d+)?/g) ?? []
const hasNumber = (quote: string, n: string) => new RegExp(`(?<![\\d.,])${n.replace(/[.,]/g, "[.,]")}(?![\\d])`).test(squash(quote))

/**
 * What one raw ruling is worth, given the claim, its source and whether the checker was independent of the claimant.
 * The only place a "verified" or "contradicted" is made.
 */
export function route(raw: RawRuling, claim: string, source: string, independent = true): { verdict: Verdict | "escalate"; quote?: string; reason?: string } {
  switch (raw.verdict) {
    case "not_stated": return { verdict: "unsupported" }
    case "unclear": return { verdict: "escalate", reason: "the checker could not tell" }
    case "invalid": return { verdict: "escalate", reason: "the checker's reply was not usable" }
    case "supports":
    case "contradicts": {
      if (!quoteInSource(raw.quote, source)) return { verdict: "escalate", reason: "the quoted passage is not in the source" }
      if (raw.verdict === "contradicts") return { verdict: "contradicted", quote: raw.quote }
      if (!independent) return { verdict: "escalate", reason: "no checker from another vendor than the claimant is configured" }
      const missing = numbersIn(claim).filter((n) => !hasNumber(raw.quote, n))
      if (missing.length) return { verdict: "escalate", reason: `the quoted passage does not contain the claim's number ${missing.join(", ")}` }
      return { verdict: "verified", quote: raw.quote }
    }
  }
}

export interface TriageEntry { answers_question: "yes" | "partly" | "no"; reports_results: "yes" | "no"; study_type: string }
const STUDY = new Set(["in_vitro", "in_vivo", "clinical", "review", "computational", "unclear"])

/** One entry per passage, or undefined for a passage whose entry is missing or malformed (it is then kept, unscreened). */
export function readTriage(text: string, n: number): (TriageEntry | undefined)[] {
  const out: (TriageEntry | undefined)[] = Array.from({ length: n }, () => undefined)
  const body = parseJson(text)
  if (!isObject(body) || !Array.isArray(body.items)) return out
  const seen = new Map<number, number>()
  const entries = new Map<number, TriageEntry>()
  for (const e of body.items) {
    if (!isObject(e) || typeof e.i !== "number" || !Number.isInteger(e.i) || e.i < 0 || e.i >= n) continue
    seen.set(e.i, (seen.get(e.i) ?? 0) + 1)
    if (["yes", "partly", "no"].includes(String(e.answers_question)) && ["yes", "no"].includes(String(e.reports_results)) && STUDY.has(String(e.study_type)))
      entries.set(e.i, { answers_question: e.answers_question as TriageEntry["answers_question"], reports_results: e.reports_results as TriageEntry["reports_results"], study_type: e.study_type as string })
  }
  for (const [i, entry] of entries) if (seen.get(i) === 1) out[i] = entry
  return out
}

/**
 * Drop only what is clearly off-topic, or on-topic with no findings of its own and not a review. A passage whose
 * screening is missing is kept: dropping it would lose evidence without anyone seeing why, and every claim made
 * from it is checked again anyway.
 */
export const keepItem = (t: TriageEntry | undefined): boolean => !t || !(t.answers_question === "no" || (t.reports_results === "no" && t.study_type !== "review"))

export const RELEVANCE = { yes: 1, partly: 0.5, no: 0 } as const // a category, not a probability

/** How many calls to the cheap model run at once (seven members search in parallel). */
export const MAX_CONCURRENT = 4

export class FirstPass {
  /** Dollars spent by this object's calls. The board adds it to the run's total. */
  usd = 0
  private models: Models
  private config: BoardConfig
  private mock: boolean
  private waiting: (() => void)[] = []
  private running = 0
  constructor(models: Models, config: BoardConfig, mock = MOCK) { this.models = models; this.config = config; this.mock = mock }

  private async slot<T>(job: () => Promise<T>): Promise<T> {
    if (this.running >= MAX_CONCURRENT) await new Promise<void>((resolve) => this.waiting.push(resolve))
    this.running++
    try { return await job() } finally { this.running--; this.waiting.shift()?.() }
  }

  /** One call to the cheap model. Throws on a transport or provider error (a failed call is never a ruling). */
  private async ask(id: ModelId, system: string, user: string, maxTokens: number): Promise<string> {
    refusePaid("the first-pass checker (the cheap tier: Anthropic or OpenAI)")
    const model = this.models.getModel(id.vendor, id.id)
    if (!model) throw new Error(`First-pass model ${id.qualified} is not in the model catalog`)
    return this.slot(async () => {
      const reply = await this.models.completeSimple(model, { systemPrompt: system, messages: [{ role: "user", content: user, timestamp: Date.now() }] },
        { signal: AbortSignal.timeout(60_000), maxTokens, ...(id.vendor === "openai" ? { reasoning: "minimal" as const } : {}) }) // reasoning tokens bill as output; the check needs none
      this.usd += reply.usage?.cost.total ?? 0
      if (reply.stopReason === "error" || reply.stopReason === "aborted") throw new Error(`First-pass check failed (${id.qualified}): ${reply.errorMessage ?? reply.stopReason}`)
      if (reply.stopReason === "length") return "" // cut off: not a usable reply, the caller escalates
      return reply.content.map((c) => (c.type === "text" ? c.text : "")).join("")
    })
  }

  /** Screen the results of one search. Returns each item with its study type, and whether to keep it. */
  async triage(items: EvidenceItem[], keyQuestion: string): Promise<{ keep: boolean; item: EvidenceItem }[]> {
    if (!items.length) return []
    const entries = this.mock ? mockTriage(items) : readTriage(await this.ask(parseModelId(this.config.models.cheap, "models.cheap"), TRIAGE_SYSTEM, triagePrompt(keyQuestion, items), 800), items.length)
    return items.map((item, i) => {
      const t = entries[i]
      return { keep: keepItem(t), item: t ? { ...item, studyType: t.study_type === "unclear" ? undefined : t.study_type, relevance: RELEVANCE[t.answers_question] } : item }
    })
  }

  /** The first ruling on each claim against one source, by a model from another vendor than `memberModel`. */
  async check(memberModel: string | undefined, claims: string[], source: string): Promise<FirstPassRuling[]> {
    if (!claims.length) return []
    if (this.mock) return mockRulings(claims, source).map((raw, i) => ({ ...route(raw, claims[i], source), checkedBy: "scripted" }))
    const { model, independent } = firstPassModel(this.config, memberModel)
    const text = await this.ask(model, CHECK_SYSTEM, checkPrompt(claims, source, this.config.checkers.first_pass.max_source_chars ?? 12_000), 1_500)
    return readRulings(text, claims.length).map((raw, i) => ({ ...route(raw, claims[i], source, independent), checkedBy: model.qualified }))
  }
}

// ── Scripted first pass: word overlap stands in for judgment, so every route and the escalation paths run. ──────────

const words = (text: string) => text.toLowerCase().split(/\W+/).filter((w) => w.length > 3)

/** The sentence of `source` that shares most words with `claim`. */
function bestSentence(claim: string, source: string): string {
  const w = new Set(words(claim))
  let best = "", score = -1
  for (const s of source.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean)) {
    const n = words(s).filter((x) => w.has(x)).length
    if (n > score) { best = s; score = n }
  }
  return best || source.slice(0, MAX_QUOTE)
}

export function mockRulings(claims: string[], source: string): RawRuling[] {
  const text = source.toLowerCase()
  return claims.map((claim) => {
    const w = words(claim)
    const overlap = w.length ? w.filter((x) => text.includes(x)).length / w.length : 0.6
    if (claim.toLowerCase().includes("no resistance")) return { verdict: "contradicts", quote: bestSentence(claim, source) }
    if (overlap > 0.7) return { verdict: "supports", quote: bestSentence(claim, source) }
    if (overlap < 0.3) return { verdict: "not_stated", quote: "" }
    return { verdict: "unclear", quote: "" }
  })
}

function mockTriage(items: EvidenceItem[]): TriageEntry[] {
  return items.map((it) => {
    const on = /kras|herg|resistance/.test(`${it.title} ${it.text}`.toLowerCase())
    return { answers_question: on ? "yes" : "no", reports_results: on ? "yes" : "no", study_type: `${it.title} ${it.text}`.toLowerCase().includes("patients") ? "clinical" : "in_vitro" }
  })
}
