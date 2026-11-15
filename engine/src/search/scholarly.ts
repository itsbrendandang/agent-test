// The research answer's literature search: Europe PMC (literature.ts) and three more free scholarly indexes, searched
// at the same time and merged into one list. Taken from Anh Lam's glhf/scripts/fetch_literature.py.
//
//   europepmc        PubMed/MEDLINE, PubMed Central and preprints (literature.ts)
//   openalex         OpenAlex: journals of every field, abstracts rebuilt from its inverted index
//   semanticscholar  Semantic Scholar: works without a key; SEMANTIC_SCHOLAR_API_KEY (or S2_API_KEY) from the
//                    environment only raises its rate limit. The key is free and is never logged.
//   arxiv            arXiv preprints (physics, computing, quantitative biology)
//
// RULES (tested in test/scholarly.test.ts, which never reaches the network):
// - No key and no charge for any of them: this adds no paid call. Only HTTPS, only to the hosts in LITERATURE_HOSTS; a
//   redirect is an error.
// - Each source has its own time limit. A source that fails, answers with an error or runs out of time is skipped and
//   named in a notice; the others are still used. Only when every source fails does the search fail.
// - A paper found by two sources is listed once: same DOI, or the same title once case, accents and punctuation are
//   set aside. Europe PMC's copy wins (its PubMed address), then the order of SCHOLARLY_SOURCES.
// - A paper with no abstract is left out: there is nothing to check a statement against.
// - The sources take turns in the merged list, which holds at most MAX_MERGED papers, so the screening that follows
//   (a paid model step) reads about as much as before.
import type { EvidenceItem } from "../events.ts"
import type { SearchResult } from "./exa.ts"
import { cleanDoi, europePmcPapers, type FoundPaper, plainText, readCapped } from "./literature.ts"

export const SCHOLARLY_SOURCES = ["europepmc", "openalex", "semanticscholar", "arxiv"] as const
export type ScholarlySource = (typeof SCHOLARLY_SOURCES)[number]

/** The only hosts the literature search may call, by source. */
export const LITERATURE_HOSTS: Record<ScholarlySource, string> = {
  europepmc: "www.ebi.ac.uk",
  openalex: "api.openalex.org",
  semanticscholar: "api.semanticscholar.org",
  arxiv: "export.arxiv.org",
}

export const SOURCE_NAME: Record<ScholarlySource, string> = { europepmc: "Europe PMC", openalex: "OpenAlex", semanticscholar: "Semantic Scholar", arxiv: "arXiv" }

/** Papers asked of each added source. Europe PMC keeps its own 8 (literature.ts). */
export const PER_SOURCE = 5
/** Papers in the merged list, at most. */
export const MAX_MERGED = 12
/** Time limit of one source, in milliseconds. Europe PMC also keeps literature.ts's 15 s limit on each request. */
export const SOURCE_TIMEOUT_MS = 12_000
const MAX_ABSTRACT_CHARS = 3000
const MAX_BODY_BYTES = 4_000_000
const USER_AGENT = "ai-scientist-bot/0.1 (research answer literature search; +https://github.com/itsbrendandang/agent-test)"

export interface ScholarlyOptions {
  fetchFn?: typeof fetch
  /** Read for the optional Semantic Scholar key only. */
  env?: Record<string, string | undefined>
  timeoutMs?: number
}

/** A source that could not be used. The message says why, without the source's name. */
class SourceFailed extends Error {}

/** One GET to a source's own host. Anything but HTTPS to that host is refused before a request is made. */
async function get(source: ScholarlySource, url: string, fetchFn: typeof fetch, signal: AbortSignal, headers: Record<string, string> = {}): Promise<string> {
  const u = new URL(url)
  if (u.protocol !== "https:" || u.hostname !== LITERATURE_HOSTS[source]) throw new SourceFailed("address not allowed")
  const res = await fetchFn(url, { headers: { "user-agent": USER_AGENT, ...headers }, redirect: "error", signal })
  if (!res.ok) throw new SourceFailed(`answered ${res.status}`)
  const text = await readCapped(res, MAX_BODY_BYTES)
  if (text === undefined) throw new SourceFailed("sent too much")
  return text
}

const json = (text: string): unknown => {
  try { return JSON.parse(text) } catch { throw new SourceFailed("sent something that is not JSON") }
}
const str = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "")
const year = (value: unknown): string | undefined => { const y = str(value).slice(0, 4); return /^(19|20)\d{2}$/.test(y) ? y : undefined }

/** "Title (Venue, 2024) [preprint]": the form literature.ts writes, which the answer reads the year and the marks from. */
function titled(title: string, venue: string | undefined, published: string | undefined, mark?: "preprint" | "review"): string {
  const where = [venue, published].filter(Boolean).join(", ")
  return `${title}${where ? ` (${where})` : ""}${mark ? ` [${mark}]` : ""}`.slice(0, 300)
}

function paper(provider: ScholarlySource, url: string, title: string, text: string, doi?: string): FoundPaper | undefined {
  const t = plainText(title), body = plainText(text).slice(0, MAX_ABSTRACT_CHARS)
  if (!t || !body) return undefined
  try { if (new URL(url).protocol !== "https:") return undefined } catch { return undefined }
  return { item: { url, title: t, text: body, provider: provider as EvidenceItem["provider"] }, ...(doi ? { doi } : {}) }
}

// ── OpenAlex ─────────────────────────────────────────────────────────────────────────────────────

/** An OpenAlex abstract from its inverted index ({ word: [positions] }). */
export function openAlexAbstract(index: unknown): string {
  if (!index || typeof index !== "object" || Array.isArray(index)) return ""
  const words: string[] = []
  for (const [word, places] of Object.entries(index as Record<string, unknown>)) {
    if (!Array.isArray(places)) continue
    for (const p of places) if (Number.isInteger(p) && (p as number) >= 0 && (p as number) < 5_000) words[p as number] = word
  }
  return words.filter(Boolean).join(" ")
}

export function parseOpenAlex(body: unknown): FoundPaper[] {
  const works = (body as { results?: unknown })?.results
  if (!Array.isArray(works)) return []
  const out: FoundPaper[] = []
  for (const w of works as Record<string, unknown>[]) {
    if (!w || typeof w !== "object") continue
    const doi = cleanDoi(w.doi)
    const id = /^https:\/\/openalex\.org\/W\d+$/.test(str(w.id)) ? str(w.id) : undefined
    const url = doi ? `https://doi.org/${doi}` : id
    if (!url) continue
    const type = str(w.type)
    const venue = str(((w.primary_location as { source?: { display_name?: unknown } } | undefined)?.source ?? {}).display_name) || undefined
    const mark = type === "preprint" ? "preprint" : type === "review" ? "review" : undefined
    const p = paper("openalex", url, titled(plainText(str(w.title ?? w.display_name)), mark === "preprint" ? "preprint" : venue, year(w.publication_year), mark), openAlexAbstract(w.abstract_inverted_index), doi)
    if (p) out.push(p)
  }
  return out
}

async function openAlex(query: string, fetchFn: typeof fetch, signal: AbortSignal): Promise<FoundPaper[]> {
  const params = new URLSearchParams({ search: query, per_page: String(PER_SOURCE), select: "id,doi,title,display_name,publication_year,type,primary_location,abstract_inverted_index" })
  return parseOpenAlex(json(await get("openalex", `https://${LITERATURE_HOSTS.openalex}/works?${params}`, fetchFn, signal, { accept: "application/json" })))
}

// ── Semantic Scholar ─────────────────────────────────────────────────────────────────────────────

export function parseSemanticScholar(body: unknown): FoundPaper[] {
  const papers = (body as { data?: unknown })?.data
  if (!Array.isArray(papers)) return []
  const out: FoundPaper[] = []
  for (const p of papers as Record<string, unknown>[]) {
    if (!p || typeof p !== "object") continue
    const ids = (p.externalIds ?? {}) as Record<string, unknown>
    const doi = cleanDoi(ids.DOI)
    const own = /^https:\/\/www\.semanticscholar\.org\/paper\/[\w-]+$/.test(str(p.url)) ? str(p.url) : undefined
    const url = doi ? `https://doi.org/${doi}` : own
    if (!url) continue
    const types = Array.isArray(p.publicationTypes) ? p.publicationTypes.map(str) : []
    const found = paper("semanticscholar", url, titled(plainText(str(p.title)), str(p.venue) || undefined, year(p.year), types.includes("Review") ? "review" : undefined), str(p.abstract), doi)
    if (found) out.push(found)
  }
  return out
}

async function semanticScholar(query: string, fetchFn: typeof fetch, signal: AbortSignal, env: Record<string, string | undefined>): Promise<FoundPaper[]> {
  const params = new URLSearchParams({ query, limit: String(PER_SOURCE), fields: "title,year,venue,abstract,externalIds,url,publicationTypes" })
  const key = (env.SEMANTIC_SCHOLAR_API_KEY ?? env.S2_API_KEY ?? "").trim()
  const headers: Record<string, string> = { accept: "application/json", ...(key ? { "x-api-key": key } : {}) }
  return parseSemanticScholar(json(await get("semanticscholar", `https://${LITERATURE_HOSTS.semanticscholar}/graph/v1/paper/search?${params}`, fetchFn, signal, headers)))
}

// ── arXiv ────────────────────────────────────────────────────────────────────────────────────────

const XML_ENTITIES: Record<string, string> = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" }
const xmlText = (value: string) => value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&(lt|gt|quot|apos|amp);/g, (_m, e: string) => XML_ENTITIES[e]).replace(/\s+/g, " ").trim()
const tag = (entry: string, name: string) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(entry); return m ? xmlText(m[1]) : "" }

/** The entries of one arXiv Atom feed. The address is the abstract page without its version. */
export function parseArxiv(xml: string): FoundPaper[] {
  const out: FoundPaper[] = []
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const entry = m[1]
    const id = /^https?:\/\/arxiv\.org\/abs\/([\w./-]+?)(?:v\d+)?$/.exec(tag(entry, "id"))?.[1]
    if (!id) continue
    const doi = cleanDoi(tag(entry, "arxiv:doi"))
    const p = paper("arxiv", `https://arxiv.org/abs/${id}`, titled(tag(entry, "title"), "arXiv preprint", year(tag(entry, "published")), "preprint"), tag(entry, "summary"), doi)
    if (p) out.push(p)
  }
  return out
}

async function arxiv(query: string, fetchFn: typeof fetch, signal: AbortSignal): Promise<FoundPaper[]> {
  const words = query.replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 8)
  if (!words.length) return []
  const params = new URLSearchParams({ search_query: words.map((w) => `all:${w}`).join(" AND "), start: "0", max_results: String(PER_SOURCE), sortBy: "relevance" })
  return parseArxiv(await get("arxiv", `https://${LITERATURE_HOSTS.arxiv}/api/query?${params}`, fetchFn, signal, { accept: "application/atom+xml" }))
}

// ── Merge ────────────────────────────────────────────────────────────────────────────────────────

/** A title as a merge key: lower case, accents and punctuation set aside, and without the "(Journal, 2024) [mark]" end. */
export function titleKey(title: string): string {
  return title.replace(/(?: \([^()]*\))?(?: \[\w+\])?$/, "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
}

/** The sources' papers as one list: each paper once (by DOI or title), the sources taking turns, at most `max`. */
export function mergePapers(lists: FoundPaper[][], max = MAX_MERGED): EvidenceItem[] {
  const seenDoi = new Set<string>(), seenTitle = new Set<string>(), seenUrl = new Set<string>()
  const unique = lists.map((list) => list.filter((p) => {
    const t = titleKey(p.item.title)
    if ((p.doi && seenDoi.has(p.doi)) || (t.length >= 12 && seenTitle.has(t)) || seenUrl.has(p.item.url)) return false
    if (p.doi) seenDoi.add(p.doi)
    if (t.length >= 12) seenTitle.add(t)
    seenUrl.add(p.item.url)
    return true
  }))
  const out: EvidenceItem[] = []
  for (let at = 0; out.length < max && unique.some((l) => at < l.length); at++) {
    for (const list of unique) if (at < list.length && out.length < max) out.push(list[at].item)
  }
  return out
}

/** Ends with SourceFailed once `ms` have passed; aborts `controller` so the request is dropped too. */
function inTime<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new SourceFailed(`did not answer within ${ms < 1000 ? `${ms} ms` : `${Math.round(ms / 1000)} s`}`)) }, ms) })
  return Promise.race([work(controller.signal), late]).finally(() => clearTimeout(timer))
}

/**
 * One literature search over every source at once. Sources that fail are skipped and named in a notice; it throws only
 * when every source failed. `fetchFn` is replaced in tests.
 */
export async function scholarlyLive(query: string, options: ScholarlyOptions = {}): Promise<SearchResult> {
  const fetchFn = options.fetchFn ?? fetch, env = options.env ?? {}, ms = options.timeoutMs ?? SOURCE_TIMEOUT_MS
  const sources = SCHOLARLY_SOURCES
  const run = (source: ScholarlySource, signal: AbortSignal): Promise<{ papers: FoundPaper[]; notices: string[] }> => {
    if (source === "europepmc") return europePmcPapers(query, fetchFn, signal, MAX_BODY_BYTES)
    const work = source === "openalex" ? openAlex(query, fetchFn, signal) : source === "semanticscholar" ? semanticScholar(query, fetchFn, signal, env) : arxiv(query, fetchFn, signal)
    return work.then((papers) => ({ papers, notices: [] }))
  }
  const settled = await Promise.allSettled(sources.map((s) => inTime((signal) => run(s, signal), ms)))
  const failed: string[] = []
  const lists: FoundPaper[][] = []
  const notices: string[] = []
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") { lists.push(r.value.papers); if (r.value.papers.length) notices.push(...r.value.notices) }
    else failed.push(`${SOURCE_NAME[sources[i]]} (${reason(r.reason)})`)
  })
  if (failed.length === sources.length) throw new Error(`no literature source could be used: ${failed.join("; ")}`)
  const items = mergePapers(lists)
  if (failed.length) notices.push(`Skipped because it could not be used: ${failed.join("; ")}.`)
  if (!items.length) notices.unshift("No paper with an abstract was found in any literature source. Try other terms.")
  return { items, notices }
}

/** A short reason without a key: only the message of our own errors, a fixed phrase for anything else. */
function reason(error: unknown): string {
  if (error instanceof SourceFailed) return error.message
  if (error instanceof Error && /^Europe PMC (answered \d+|sent too much)$/.test(error.message)) return error.message.replace("Europe PMC ", "")
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) return "it ran out of time"
  return "it could not be reached"
}
