// The research answer's lab protocol search: published protocols and standard operating procedures (SOPs), from
// three free sources asked at the same time and merged into one list, like the literature search (scholarly.ts).
//
//   europepmc    Europe PMC, only the protocol journals (PROTOCOL_JOURNALS): Bio-protocol, STAR Protocols, Nature
//                Protocols, JoVE, Current Protocols, Cold Spring Harbor Protocols, MethodsX, Methods in Molecular Biology
//   openalex     OpenAlex, only the same journals by ISSN, and Protocol Exchange (which Europe PMC does not index)
//   protocolsio  protocols.io, through Crossref's free index of its DOIs (prefix 10.17504). The protocols.io API itself
//                asks for a token on every request, so it is not used.
//
// RULES (tested in test/protocols.test.ts, which never reaches the network):
// - No key and no charge for any of them: this adds no paid call. Only HTTPS, only to the hosts in PROTOCOL_HOSTS; a
//   redirect is an error.
// - Each source has its own time limit. A source that fails, answers with an error or runs out of time is skipped and
//   named in a notice; the others are still used. Only when every source fails does the search fail.
// - A protocol found by two sources is listed once: same DOI, or the same title (scholarly.ts mergePapers). The
//   versions of one protocols.io protocol ("... v1", "... v2") are one protocol: the first found is kept.
// - A protocol with no abstract is left out: there is nothing to check a statement against.
// - Every item has the provider "protocols", so the answer labels it a protocol (pipeline.ts noteOf).
import type { EvidenceItem } from "../events.ts"
import type { SearchResult } from "./exa.ts"
import { cleanDoi, europePmcPapers, type FoundPaper, plainText } from "./literature.ts"
import { getFrom, inTime, json, MAX_ABSTRACT_CHARS, MAX_BODY_BYTES, mergePapers, parseOpenAlex, reason, SOURCE_TIMEOUT_MS, str, titled, titleKey, year } from "./scholarly.ts"

export const PROTOCOL_SOURCES = ["europepmc", "openalex", "protocolsio"] as const
export type ProtocolSource = (typeof PROTOCOL_SOURCES)[number]

/** The only hosts the protocol search may call, by source. */
export const PROTOCOL_HOSTS: Record<ProtocolSource, string> = {
  europepmc: "www.ebi.ac.uk",
  openalex: "api.openalex.org",
  protocolsio: "api.crossref.org",
}

export const PROTOCOL_SOURCE_NAME: Record<ProtocolSource, string> = { europepmc: "Europe PMC (protocol journals)", openalex: "OpenAlex (protocol journals)", protocolsio: "protocols.io (through Crossref)" }

/**
 * The journals that publish lab protocols. `europepmc`: the name Europe PMC's JOURNAL field matches (absent when it does
 * not index the journal); `issn`: the ISSN-L OpenAlex filters by. Each was checked live on 2026-11-15.
 */
export const PROTOCOL_JOURNALS: readonly { name: string; europepmc?: string; issn: string }[] = [
  { name: "Bio-protocol", europepmc: "Bio-protocol", issn: "2331-8325" },
  { name: "STAR Protocols", europepmc: "STAR Protoc", issn: "2666-1667" },
  { name: "Nature Protocols", europepmc: "Nat Protoc", issn: "1750-2799" },
  { name: "JoVE (Journal of Visualized Experiments)", europepmc: "J Vis Exp", issn: "1940-087X" },
  { name: "Current Protocols", europepmc: "Curr Protoc", issn: "2691-1299" },
  { name: "Cold Spring Harbor Protocols", europepmc: "Cold Spring Harb Protoc", issn: "1559-6095" },
  { name: "MethodsX", europepmc: "MethodsX", issn: "2215-0161" },
  { name: "Methods in Molecular Biology", europepmc: "Methods Mol Biol", issn: "1064-3745" },
  { name: "Protocol Exchange", issn: "2043-0116" },
]
/** The DOI prefix of protocols.io. */
export const PROTOCOLS_IO_PREFIX = "10.17504"

/** Protocols asked of OpenAlex and of Crossref. Europe PMC keeps its own 8 (literature.ts). */
export const PER_PROTOCOL_SOURCE = 5
/** Protocols in the merged list, at most. */
export const MAX_PROTOCOLS = 10

/** The Europe PMC clause that keeps only the protocol journals. */
export const EUROPE_PMC_FILTER = `(${PROTOCOL_JOURNALS.flatMap((j) => (j.europepmc ? [`JOURNAL:"${j.europepmc}"`] : [])).join(" OR ")})`

// A venue that marks a found paper as a protocol, as the literature search writes it in a title: "Title (Venue, 2024)".
// Europe PMC writes journal names in its own way ("Journal of visualized experiments : JoVE", "Current protocols").
const PROTOCOL_VENUE = /\((?:bio-protocol|star protocols|nature protocols|journal of visualized experiments|jove|current protocols|cold spring harbor protocols|methodsx|methods in molecular biology|protocol exchange|protocols\.io)\b/i
/** True when a paper's title names a protocol journal or protocols.io as its venue: the answer then labels it a protocol, whichever search found it. */
export const isProtocolTitle = (title: string): boolean => PROTOCOL_VENUE.test(title)

/** Words that ask for a protocol but would only narrow the search of protocol journals. */
const ASKING_WORDS = /\b(protocols?|sops?|standard operating procedures?|step[- ]by[- ]step|procedures?|how to)\b/gi
/** A protocol query as it is sent: no field tags or Boolean words, no words that only ask for a protocol. */
export function protocolQuery(query: string): string {
  const plain = query.replace(/[^\p{L}\p{N}\s.+-]/gu, " ").replace(/\b(AND|OR|NOT)\b/g, " ").replace(/\s+/g, " ").trim()
  const topic = plain.replace(ASKING_WORDS, " ").replace(/\s+/g, " ").trim()
  return topic.length >= 3 ? topic : plain
}

const asProtocol = (papers: FoundPaper[]): FoundPaper[] => papers.map((p) => ({ ...p, item: { ...p.item, provider: "protocols" as EvidenceItem["provider"] } }))

// ── OpenAlex ─────────────────────────────────────────────────────────────────────────────────────

async function openAlex(query: string, fetchFn: typeof fetch, signal: AbortSignal): Promise<FoundPaper[]> {
  const params = new URLSearchParams({
    search: query, per_page: String(PER_PROTOCOL_SOURCE), filter: `primary_location.source.issn:${PROTOCOL_JOURNALS.map((j) => j.issn).join("|")}`,
    select: "id,doi,title,display_name,publication_year,type,primary_location,abstract_inverted_index",
  })
  return parseOpenAlex(asJournalWorks(json(await getFrom(PROTOCOL_HOSTS.openalex, `https://${PROTOCOL_HOSTS.openalex}/works?${params}`, fetchFn, signal, { accept: "application/json" }))))
}

/**
 * OpenAlex calls some protocol journals' papers preprints (Cold Spring Harbor Protocols is one). A paper of a protocol
 * journal is not marked a preprint here; one of Protocol Exchange is, because Protocol Exchange is not peer reviewed.
 */
export function asJournalWorks(body: unknown): unknown {
  const works = (body as { results?: unknown })?.results
  if (!Array.isArray(works)) return body
  return { results: works.map((w) => {
    if (!w || typeof w !== "object") return w
    const venue = str(((w as { primary_location?: { source?: { display_name?: unknown } } }).primary_location?.source ?? {}).display_name)
    const type = str((w as { type?: unknown }).type)
    return { ...w, type: /protocol exchange/i.test(venue) ? "preprint" : type === "review" ? "review" : "article" }
  }) }
}

// ── protocols.io, through Crossref ───────────────────────────────────────────────────────────────

/** A protocols.io title without its version ("Western Blot v2" -> "Western Blot"): the versions of one protocol are one protocol. */
export const withoutVersion = (title: string): string => title.replace(/\s+v\d+(?:\.\d+)?\s*$/i, "").trim()

/** The protocols.io records of one Crossref answer. The address is the DOI; the text is the protocol's abstract. */
export function parseCrossrefProtocols(body: unknown): FoundPaper[] {
  const items = (body as { message?: { items?: unknown } })?.message?.items
  if (!Array.isArray(items)) return []
  const out: FoundPaper[] = []
  const seen = new Set<string>()
  for (const w of items as Record<string, unknown>[]) {
    if (!w || typeof w !== "object") continue
    const doi = cleanDoi(w.DOI)
    if (!doi?.startsWith(`${PROTOCOLS_IO_PREFIX}/`)) continue
    const title = plainText(str(Array.isArray(w.title) ? w.title[0] : w.title))
    const text = plainText(str(w.abstract)).slice(0, MAX_ABSTRACT_CHARS)
    const key = titleKey(withoutVersion(title))
    if (!title || text.length < 40 || seen.has(key)) continue
    seen.add(key)
    const parts = ((w.published ?? w.issued ?? w.created) as { "date-parts"?: unknown[][] } | undefined)?.["date-parts"]
    const published = year(Array.isArray(parts) && Array.isArray(parts[0]) ? parts[0][0] : undefined)
    out.push({ item: { url: `https://doi.org/${doi}`, title: titled(title, "protocols.io", published), text, provider: "protocols" as EvidenceItem["provider"] }, doi })
  }
  return out
}

async function protocolsIo(query: string, fetchFn: typeof fetch, signal: AbortSignal): Promise<FoundPaper[]> {
  const params = new URLSearchParams({ query, filter: `prefix:${PROTOCOLS_IO_PREFIX}`, rows: String(PER_PROTOCOL_SOURCE * 2), select: "DOI,title,abstract,published,issued,created" })
  return parseCrossrefProtocols(json(await getFrom(PROTOCOL_HOSTS.protocolsio, `https://${PROTOCOL_HOSTS.protocolsio}/works?${params}`, fetchFn, signal, { accept: "application/json" }))).slice(0, PER_PROTOCOL_SOURCE)
}

// ── All of them ──────────────────────────────────────────────────────────────────────────────────

export interface ProtocolOptions { fetchFn?: typeof fetch; timeoutMs?: number }

/**
 * One protocol search over every source at once. Sources that fail are skipped and named in a notice; it throws only
 * when every source failed. `fetchFn` is replaced in tests.
 */
export async function protocolsLive(query: string, options: ProtocolOptions = {}): Promise<SearchResult> {
  const fetchFn = options.fetchFn ?? fetch, ms = options.timeoutMs ?? SOURCE_TIMEOUT_MS
  const q = protocolQuery(query)
  const run = (source: ProtocolSource, signal: AbortSignal): Promise<{ papers: FoundPaper[]; notices: string[] }> => {
    if (source === "europepmc") return europePmcPapers(q, fetchFn, signal, MAX_BODY_BYTES, EUROPE_PMC_FILTER).then((r) => ({ papers: r.papers, notices: r.notices.map((n) => `Europe PMC: ${n}`) }))
    return (source === "openalex" ? openAlex(q, fetchFn, signal) : protocolsIo(q, fetchFn, signal)).then((papers) => ({ papers, notices: [] }))
  }
  const settled = await Promise.allSettled(PROTOCOL_SOURCES.map((s) => inTime((signal) => run(s, signal), ms)))
  const failed: string[] = [], lists: FoundPaper[][] = [], notices: string[] = []
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") { lists.push(asProtocol(r.value.papers)); if (r.value.papers.length) notices.push(...r.value.notices) }
    else failed.push(`${PROTOCOL_SOURCE_NAME[PROTOCOL_SOURCES[i]]} (${reason(r.reason)})`)
  })
  if (failed.length === PROTOCOL_SOURCES.length) throw new Error(`no protocol source could be used: ${failed.join("; ")}`)
  const items = mergePapers(lists, MAX_PROTOCOLS)
  const first = [...(failed.length ? [`Skipped because it could not be used: ${failed.join("; ")}.`] : []), ...(items.length ? [] : ["No protocol with an abstract was found. Try other terms."])]
  return { items, notices: [...first, ...notices] }
}
