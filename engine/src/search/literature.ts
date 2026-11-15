// literature_search: a free search of the biomedical literature for the board's members.
// Source: Europe PMC (https://europepmc.org/RestfulWebService), which indexes PubMed/MEDLINE, PubMed Central and
// preprints. No key and no charge. A query that finds nothing is tried again with fewer words.
// What it returns is the paper's abstract: a "verified" statement must quote a passage that is in it.
// A scripted (practice) run never reaches the network: it gets the fixture sources.
import type { EvidenceItem } from "../events.ts"
import type { SearchResult } from "./exa.ts"

export const LITERATURE_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
export const DEFAULT_MAX_LITERATURE_SEARCHES = 20
const MAX_RESULTS = 8
const MAX_ABSTRACT_CHARS = 3000

export const LITERATURE_GUIDANCE = `# Searching the literature
\`literature_search\` searches PubMed and preprints through Europe PMC and returns abstracts. It is free. After your
opening web search, use it for anything a peer-reviewed paper would answer (assay results, mechanisms, clinical
findings), on each key question of the brief.
- Write a short keyword query, as you would type into PubMed: 3 to 6 terms, no sentences. Example: KRAS G12C covalent inhibitor hERG.
- A preprint is marked [preprint]: it has not been peer reviewed. Say so when you cite one.
- You see abstracts, not full papers. Do not state a number that is not in the abstract.
- Cite a source by its exact URL.`

interface EuropePmcRecord {
  id?: string; source?: string; pmid?: string; doi?: string; title?: string; abstractText?: string; pubYear?: string
  journalInfo?: { journal?: { title?: string } }
  pubTypeList?: { pubType?: string[] }
}

/** Text from a field that may hold HTML tags and entities (Europe PMC abstracts carry <h4>, <i>, <sub>). */
export function plainText(html: string): string {
  return html
    .replace(/<\/(h\d|p|li)>/gi, ". ").replace(/<(h\d|p|li|br)\b[^>]*>/gi, " ").replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").replace(/\.\s*\./g, ".").replace(/([:;,])\.\s/g, "$1 ").trim()
}

/** A paper found by a literature search, with its DOI (lower case, no "https://doi.org/") when the source gave one: scholarly.ts merges sources by it. */
export interface FoundPaper { item: EvidenceItem; doi?: string }

/** A DOI as a merge key: lower case, without the resolver prefix. Undefined when it does not look like a DOI. */
export function cleanDoi(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const doi = value.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:/i, "").toLowerCase()
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : undefined
}

/** The records of one Europe PMC answer as evidence items. A record with no abstract is left out: there is nothing to check a statement against. */
export function parseEuropePmc(body: unknown): EvidenceItem[] {
  return parseEuropePmcPapers(body).map((p) => p.item)
}

/** parseEuropePmc, with each record's DOI kept beside its item. */
export function parseEuropePmcPapers(body: unknown): FoundPaper[] {
  const records = (body as { resultList?: { result?: EuropePmcRecord[] } })?.resultList?.result
  if (!Array.isArray(records)) return []
  const items: FoundPaper[] = []
  for (const r of records) {
    const text = plainText(String(r.abstractText ?? "")).slice(0, MAX_ABSTRACT_CHARS)
    const title = plainText(String(r.title ?? ""))
    if (!text || !title || !r.id || !/^[\w.-]+$/.test(r.id)) continue
    const preprint = r.source === "PPR"
    const url = r.source === "MED" && /^\d+$/.test(r.pmid ?? "") ? `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/` : `https://europepmc.org/article/${encodeURIComponent(r.source ?? "MED")}/${r.id}`
    const where = [preprint ? "preprint" : r.journalInfo?.journal?.title, /^\d{4}$/.test(r.pubYear ?? "") ? r.pubYear : undefined].filter(Boolean).join(", ")
    const review = (r.pubTypeList?.pubType ?? []).some((t) => /review/i.test(t))
    const doi = cleanDoi(r.doi)
    items.push({ item: { url, title: `${title}${where ? ` (${where})` : ""}${preprint ? " [preprint]" : review ? " [review]" : ""}`.slice(0, 300), text, provider: "europepmc" }, ...(doi ? { doi } : {}) })
  }
  return items
}

/** The queries to try, in order: the query as given, then with words dropped from the end (never fewer than two words). */
export function retryQueries(query: string, retries = 2): string[] {
  const words = query.trim().split(/\s+/).filter(Boolean)
  const out = [words.join(" ")]
  for (let drop = 1; drop <= retries && words.length - drop >= 2; drop++) out.push(words.slice(0, words.length - drop).join(" "))
  return out
}

/** One live literature search. Throws on a non-2xx answer. `fetchFn` is replaced in tests. */
export async function literatureLive(query: string, fetchFn: typeof fetch = fetch): Promise<SearchResult> {
  const { papers, notices } = await europePmcPapers(query, fetchFn)
  return { items: papers.map((p) => p.item), notices }
}

/** A response's body as text, read no further than `maxBytes`; undefined when it is longer. */
export async function readCapped(res: Response, maxBytes: number): Promise<string | undefined> {
  if (Number(res.headers.get("content-length") ?? 0) > maxBytes) { await res.body?.cancel(); return undefined }
  if (!res.body) return ""
  const reader = res.body.getReader(), decoder = new TextDecoder()
  let size = 0, text = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return text + decoder.decode()
    size += value.byteLength
    if (size > maxBytes) { await reader.cancel(); return undefined }
    text += decoder.decode(value, { stream: true })
  }
}

/**
 * literatureLive, with each paper's DOI kept (scholarly.ts). `signal` (optional) ends the search early; `maxBytes`
 * (optional) refuses redirects and a body longer than that.
 */
export async function europePmcPapers(query: string, fetchFn: typeof fetch = fetch, signal?: AbortSignal, maxBytes?: number): Promise<{ papers: FoundPaper[]; notices: string[] }> {
  const notices: string[] = []
  for (const q of retryQueries(query)) {
    const url = `${LITERATURE_URL}?${new URLSearchParams({ query: q, resultType: "core", format: "json", pageSize: String(MAX_RESULTS) })}` // no `sort`: relevance is the default, and sort=RELEVANCE is answered with 503
    const timeout = AbortSignal.timeout(15_000)
    const res = await fetchFn(url, { headers: { accept: "application/json" }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout, ...(maxBytes ? { redirect: "error" as const } : {}) })
    if (!res.ok) throw new Error(`Europe PMC answered ${res.status}`)
    const body = maxBytes ? await readCapped(res, maxBytes) : undefined
    if (maxBytes && body === undefined) throw new Error("Europe PMC sent too much")
    const papers = parseEuropePmcPapers(body === undefined ? await res.json() : JSON.parse(body))
    if (papers.length) {
      if (q !== query.trim().split(/\s+/).join(" ")) notices.push(`Nothing was found for the full query; these are the results for "${q}".`)
      return { papers, notices }
    }
  }
  return { papers: [], notices: ["No paper with an abstract was found, also with fewer words. Try other terms."] }
}

export interface LiteratureDeps {
  state: { literature?: Record<string, { items: EvidenceItem[]; notices: string[] }> }
  mock: boolean
  maxSearches: number
  search: (query: string) => Promise<SearchResult>
  /** True once the run has spent max_usd: the search is free, but screening its results is not. */
  capReached: () => Promise<boolean>
  /** True when paid calls were switched off during a real run: its results could not be screened. */
  paidOff?: () => boolean
}

/**
 * One literature search for a tool call. A call id that already has a stored result (a crash replay) returns it
 * without a second request. Refused past the per-run count, the spend cap, or with paid calls switched off; a
 * refusal never falls back to fixture sources.
 */
export async function literatureOnce(deps: LiteratureDeps, callId: string, query: string): Promise<{ result?: SearchResult; refused?: string; failed?: boolean }> {
  const { state } = deps
  if (deps.mock) return { result: await deps.search(query) }
  const stored = state.literature?.[callId]
  if (stored) return { result: stored }
  const used = Object.keys(state.literature ?? {}).length
  if (deps.paidOff?.()) return { refused: "Paid calls were switched off: search results can no longer be screened. Work from what you have and say so." }
  if (used >= deps.maxSearches) return { refused: `Literature search budget used up: ${used} of ${deps.maxSearches} for this run. Work from what you have and say so.` }
  if (await deps.capReached()) return { refused: "Spend cap reached: search results can no longer be screened. Work from what you have and say so." }
  // The service being down is not a reason to stop the run: the member is told, and the failed call is not counted.
  let result: SearchResult
  try { result = await deps.search(query) } catch (error) {
    return { refused: `The literature search could not be reached (${error instanceof Error ? error.message : String(error)}). Use another search if you have one, or work from what you have and say so.`, failed: true }
  }
  state.literature = { ...state.literature, [callId]: { items: result.items, notices: result.notices } }
  return { result }
}
