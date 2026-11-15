// What the six database clients share: the limits, the one way a request is sent, and the text helpers.
//
// RULES every client keeps (tested in test/sources-*.test.ts):
// - Only HTTPS, only to the six hosts in HOSTS; a redirect is an error (it is never followed to another host).
// - A 15-second timeout, a User-Agent that names this project, no retries. At most one request at a time to a host,
//   and at most one every MIN_GAP_MS (1.5 s, so 40 a minute): far below every documented limit (PubChem: 5 a second;
//   openFDA: 240 a minute and 1,000 a day without a key).
// - At most MAX_REQUESTS_PER_CALL requests and MAX_ITEMS items for one tool call; text is cut to MAX_TEXT_CHARS.
// - The live object keeps a good answer for CACHE_MS (10 minutes), so the same request made again (another member, a
//   later round, another answer) is read from memory: nothing is sent and no gap is waited. Two identical requests made
//   at the same moment share one. A failure is never kept. At most CACHE_ENTRIES answers and CACHE_BYTES of text.
// - Numbers are kept as the service wrote them ("4.0" stays "4.0"): parseJson gives every JSON number back as its
//   source text. Nothing is converted or rounded. A field that is missing is left out of the text.
// - Text from a service is data: HTML tags are removed, entities decoded, control and invisible characters dropped,
//   whitespace collapsed. It is shown to models only inside the board's escaped evidence block.
import type { EvidenceItem } from "../events.ts"

export const SOURCES = ["chembl", "clinicaltrials", "openfda", "opentargets", "uniprot", "pubchem"] as const
export type DatabaseSource = (typeof SOURCES)[number]
export const isSource = (value: unknown): value is DatabaseSource => typeof value === "string" && (SOURCES as readonly string[]).includes(value)

export const MAX_ITEMS = 8
export const MAX_TEXT_CHARS = 3000
export const MAX_TITLE_CHARS = 300
export const MAX_QUERY_CHARS = 200
export const TIMEOUT_MS = 15_000
export const MIN_GAP_MS = 1_500
export const MAX_REQUESTS_PER_CALL = 4
export const MAX_BODY_BYTES = 4_000_000
export const CACHE_MS = 10 * 60_000
export const CACHE_ENTRIES = 200
export const CACHE_BYTES = 20_000_000
export const USER_AGENT = "ai-scientist-bot/0.1 (drug board evidence lookup; +https://github.com/itsbrendandang/agent-test)"

/** The only hosts a client may call, by source. */
export const HOSTS: Record<DatabaseSource, string> = {
  chembl: "www.ebi.ac.uk",
  clinicaltrials: "clinicaltrials.gov",
  openfda: "api.fda.gov",
  opentargets: "api.platform.opentargets.org",
  uniprot: "rest.uniprot.org",
  pubchem: "pubchem.ncbi.nlm.nih.gov",
}

/** What one lookup gives back: the records as evidence items, and plain notes for the member that asked (never stored as evidence). */
export interface SourceResult { items: EvidenceItem[]; notices: string[] }

/** A service that did not answer, or answered with something that cannot be used. The run goes on; the member is told. */
export class ServiceError extends Error {}

// ── JSON ─────────────────────────────────────────────────────────────────────────────────────────

const NUMBER = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/

/**
 * JSON.parse, but every number comes back as the text the service wrote (a string), so "560.60" is never turned into
 * 560.6 and 1e-5 never into 0.00001. Throws on text that is not JSON.
 */
export function parseJson(text: string): unknown {
  const reviver = (_key: string, value: unknown, context?: { source?: string }) =>
    typeof value === "number" ? (typeof context?.source === "string" && NUMBER.test(context.source) ? context.source : String(value)) : value
  return JSON.parse(text, reviver as (key: string, value: unknown) => unknown)
}

export type Json = Record<string, unknown>
export const rec = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {})
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
/** A number as the service wrote it, or "" when the value is not a number. */
export const num = (value: unknown): string => (typeof value === "string" && NUMBER.test(value) ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "")

// ── Text ─────────────────────────────────────────────────────────────────────────────────────────

const TAGS = "a|abbr|b|big|blockquote|body|br|caption|center|code|col|colgroup|content|dd|div|dl|dt|em|font|footnote|h[1-6]|head|hr|html|i|iframe|img|item|li|link|linkhtml|list|meta|object|ol|p|paragraph|pre|s|script|small|span|strong|style|sub|sup|table|tbody|td|tfoot|th|thead|title|tr|tt|u|ul"
// A tag is removed only when it is written like a tag: a known name, then ">" or attributes with "=". So "ALT <3 x ULN
// or >5" and "<a and b>" are kept as they are (they are text, and every "<" is escaped where a model reads it).
const TAG = new RegExp(`<\\/?(?:${TAGS})(?:\\s+[^<>]*=[^<>]*|\\s*\\/?)?>`, "gi")
const BLOCK = new RegExp(`<\\/?(?:br|p|div|li|tr|td|th|h[1-6]|table|caption|paragraph|item|dd|dt)(?:\\s+[^<>]*=[^<>]*|\\s*\\/?)?>`, "gi")
const ENTITIES: Record<string, string> = { lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", amp: "&" }

/**
 * Plain text from a field of a service's answer. Not a string (or a number written as text): "". HTML tags go (a
 * script or style element goes with its content), entities are decoded once, control characters and invisible
 * formatting characters (zero-width, direction marks) are dropped, whitespace becomes single spaces.
 */
export function clean(value: unknown, max = Infinity): string {
  if (typeof value !== "string") return ""
  const text = value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ")
    .replace(BLOCK, " ").replace(TAG, "")
    .replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|lt|gt|quot|apos|nbsp|amp);/gi, (whole, name: string) => {
      const key = name.toLowerCase()
      if (!key.startsWith("#")) return ENTITIES[key] ?? whole
      const code = key.startsWith("#x") ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10)
      return code > 0x1f && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : " "
    })
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g, "")
    .replace(/\s+/g, " ").trim()
  return text.length > max ? cut(text, max) : text
}

export const CUT_MARK = " [...]"

/**
 * At most `max` characters, never cut inside a word or a number: the cut is at the last sentence end in the last
 * third, else at the last space, and CUT_MARK is added so a reader sees the text goes on.
 */
export function cut(text: string, max: number): string {
  if (text.length <= max) return text
  const room = Math.max(1, max - CUT_MARK.length)
  const window = text.slice(0, room + 1)
  const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("; "))
  const space = window.lastIndexOf(" ")
  const at = sentence >= room * (2 / 3) ? sentence + 1 : space > 0 ? space : 0
  return text.slice(0, at).trimEnd() + CUT_MARK
}

/** "Label: value." when there is a value, "" when there is none (a missing field is left out, never written as a placeholder). */
export function say(label: string, value: string): string {
  const v = value.trim()
  return v ? `${label}: ${v}${/[.!?]$/.test(v) ? "" : "."}` : ""
}
/** The parts that are not empty, joined with a space. */
export const join = (parts: (string | false | undefined)[], separator = " ") => parts.filter(Boolean).join(separator)

/** An evidence item, or undefined when it has no text or title. `url` must already be built from a validated id. */
export function record(url: string, title: string, text: string): EvidenceItem | undefined {
  const t = cut(title.replace(/\s+/g, " ").trim(), MAX_TITLE_CHARS), body = cut(text.replace(/\s+/g, " ").trim(), MAX_TEXT_CHARS)
  return t && body ? { url, title: t, text: body } : undefined
}

/** The member's query as one line of plain text: control characters dropped, whitespace collapsed. "" when nothing is left or it is too long. */
export function plainQuery(query: unknown): string {
  if (typeof query !== "string") return ""
  const q = clean(query)
  return q.length > MAX_QUERY_CHARS ? "" : q
}
/**
 * Words for a search field, in lower case: only letters, digits and - . ' inside a word. So none of a service's query
 * syntax can be written: no quotes, brackets, colons, slashes or wildcards, no leading + or -, and no AND / OR / NOT
 * (those are operators only in upper case).
 */
export const words = (query: string): string[] => query.toLowerCase().split(/[^\p{L}\p{N}.'-]+/u).map((w) => w.replace(/^[.'-]+|[.'-]+$/g, "")).filter(Boolean)

// ── Requests ─────────────────────────────────────────────────────────────────────────────────────

export interface Answer { status: number; body: unknown }
export interface Http {
  /**
   * GET `url` (or POST `post` as JSON) and parse the JSON answer. Throws ServiceError unless the status is 2xx.
   * `emptyOn`: statuses with which this service says "nothing found" (404 at openFDA and PubChem); the answer then
   * has that status and no body, and nothing is thrown.
   */
  json(source: DatabaseSource, url: string, options?: { post?: unknown; emptyOn?: number[] }): Promise<Answer>
}
export interface HttpOptions {
  fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number; minGapMs?: number
  /** How long a good answer is kept and given again for the same request. 0 (the default): nothing is kept. */
  cacheMs?: number
}

const NAMES: Record<DatabaseSource, string> = { chembl: "ChEMBL", clinicaltrials: "ClinicalTrials.gov", openfda: "openFDA", opentargets: "Open Targets", uniprot: "UniProt", pubchem: "PubChem" }
export const serviceName = (source: DatabaseSource) => NAMES[source]

async function readBody(response: Response, source: DatabaseSource): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ""
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) { await reader.cancel().catch(() => {}); throw new ServiceError(`${NAMES[source]} sent more than ${MAX_BODY_BYTES} bytes`) }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString("utf8")
}

/**
 * The one way a client sends a request. Requests to one host wait for each other and start at least `minGapMs` apart
 * (the object keeps the time of the last one, so the live object below spaces every run in this process).
 */
export function createHttp(options: HttpOptions = {}): Http {
  const fetchFn = options.fetch ?? fetch
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const now = options.now ?? Date.now
  const gap = options.minGapMs ?? MIN_GAP_MS
  const last = new Map<string, number>()
  const queue = new Map<string, Promise<unknown>>()
  const keep = options.cacheMs ?? 0
  const kept = new Map<string, { at: number; size: number; answer: Answer }>() // oldest first
  const pending = new Map<string, Promise<Answer>>()
  let keptBytes = 0
  const drop = (key: string) => { const old = kept.get(key); if (old) { keptBytes -= old.size; kept.delete(key) } }
  const store = (key: string, answer: Answer, size: number) => {
    drop(key)
    if (size > CACHE_BYTES) return
    kept.set(key, { at: now(), size, answer })
    keptBytes += size
    for (const [oldest] of kept) { if (kept.size <= CACHE_ENTRIES && keptBytes <= CACHE_BYTES) break; drop(oldest) }
  }
  // Each caller gets its own copy: one lookup can never change what the next one reads.
  const copy = (answer: Answer): Answer => ({ status: answer.status, body: answer.body === undefined ? undefined : structuredClone(answer.body) })
  return {
    json(source, url, opts = {}) {
      let target: URL
      try { target = new URL(url) } catch { return Promise.reject(new ServiceError(`${NAMES[source]}: not a valid address`)) }
      // A client can only reach its own service: a wrong host here is a bug in the client, and nothing is sent.
      if (target.protocol !== "https:" || target.host !== HOSTS[source] || target.username || target.password) return Promise.reject(new ServiceError(`${NAMES[source]}: refused to call ${target.host}`))
      const host = target.host
      const key = keep > 0 ? JSON.stringify([source, target.href, opts.post ?? null, opts.emptyOn ?? []]) : ""
      if (key) {
        const hit = kept.get(key)
        if (hit && now() - hit.at < keep) return Promise.resolve(copy(hit.answer))
        if (hit) drop(key)
        const same = pending.get(key)
        if (same) return same.then(copy)
      }
      let size = 0
      const run = async (): Promise<Answer> => {
        const wait = (last.get(host) ?? -Infinity) + gap - now()
        if (wait > 0) await sleep(wait)
        last.set(host, now())
        let response: Response
        try {
          response = await fetchFn(target.href, {
            method: opts.post === undefined ? "GET" : "POST",
            headers: { accept: "application/json", "user-agent": USER_AGENT, ...(opts.post === undefined ? {} : { "content-type": "application/json" }) },
            ...(opts.post === undefined ? {} : { body: JSON.stringify(opts.post) }),
            redirect: "error",
            signal: AbortSignal.timeout(TIMEOUT_MS),
          })
        } catch (error) {
          const name = error instanceof Error ? error.name : ""
          throw new ServiceError(name === "TimeoutError" || name === "AbortError" ? `${NAMES[source]} did not answer in ${TIMEOUT_MS / 1000} seconds` : `${NAMES[source]} could not be reached`)
        }
        if (opts.emptyOn?.includes(response.status)) { await response.body?.cancel().catch(() => {}); return { status: response.status, body: undefined } }
        if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new ServiceError(`${NAMES[source]} answered ${response.status}`) }
        let text: string
        try { text = await readBody(response, source) } catch (error) {
          throw error instanceof ServiceError ? error : new ServiceError(`${NAMES[source]} stopped answering part-way`)
        }
        size = text.length
        try { return { status: response.status, body: parseJson(text) } } catch { throw new ServiceError(`${NAMES[source]} answered with something that is not JSON`) }
      }
      const next = (queue.get(host) ?? Promise.resolve()).then(run, run)
      queue.set(host, next.catch(() => {}))
      if (!key) return next
      pending.set(key, next)
      const settled = () => { if (pending.get(key) === next) pending.delete(key) }
      next.then((answer) => { settled(); store(key, answer, size) }, settled)
      return next.then(copy)
    },
  }
}

/**
 * The same `http`, but it refuses the request after `max` (one tool call can never turn into a stream of requests), and
 * every request once `signal` is aborted (a lookup that ran out of time sends nothing more).
 */
export function limited(http: Http, max = MAX_REQUESTS_PER_CALL, signal?: AbortSignal): Http {
  let sent = 0
  return {
    json: (source, url, options) =>
      signal?.aborted ? Promise.reject(new ServiceError(`${NAMES[source]}: the lookup ran out of time`))
      : ++sent > max ? Promise.reject(new ServiceError(`${NAMES[source]}: more than ${max} requests for one lookup`))
      : http.json(source, url, options),
  }
}

/** The object live lookups use: one for the process, so its spacing and its kept answers cover every run. */
export const liveHttp = createHttp({ cacheMs: CACHE_MS })
