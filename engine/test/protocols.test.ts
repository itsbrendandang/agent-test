// The research answer's lab protocol search (protocols.ts): protocol journals through Europe PMC and OpenAlex, and
// protocols.io through Crossref. No test here reaches the network: fetch is a fake that answers by host, and throws for
// any other address.
import assert from "node:assert/strict"
import { test } from "node:test"
import { asJournalWorks, EUROPE_PMC_FILTER, isProtocolTitle, MAX_PROTOCOLS, parseCrossrefProtocols, PROTOCOL_HOSTS, PROTOCOL_JOURNALS, PROTOCOLS_IO_PREFIX, protocolQuery, protocolsLive, withoutVersion } from "../src/search/protocols.ts"
import { parseOpenAlex } from "../src/search/scholarly.ts"
import { noteOf, numberSources, READ_LIMIT, selectionOf, sourceKeys, usable } from "../src/research/pipeline.ts"
import type { EvidenceItem } from "../src/events.ts"

const ABSTRACT = "This protocol describes the isolation of primary hepatocytes from adult mouse liver by two-step collagenase perfusion, with a yield of 20 to 30 million cells per liver."

const EUROPEPMC = { resultList: { result: [
  { id: "38000001", source: "MED", pmid: "38000001", doi: "10.21769/BioProtoc.4000", title: "Isolation of Primary Mouse Hepatocytes by Two-step Perfusion.", pubYear: "2023", abstractText: ABSTRACT, journalInfo: { journal: { title: "Bio-protocol" } } },
  { id: "38000002", source: "MED", pmid: "38000002", doi: "10.3791/60000", title: "Culturing Mouse Hepatocytes on Collagen.", pubYear: "2021", abstractText: "Here we present a protocol to culture primary mouse hepatocytes on a collagen sandwich for up to seven days.", journalInfo: { journal: { title: "Journal of visualized experiments : JoVE" } } },
] } }
const OPENALEX = { results: [
  // The same protocol as Europe PMC's first, by DOI: left out.
  { id: "https://openalex.org/W1", doi: "https://doi.org/10.21769/bioprotoc.4000", title: "Isolation of primary mouse hepatocytes by two-step perfusion", publication_year: 2023, type: "article", primary_location: { source: { display_name: "BIO-PROTOCOL" } }, abstract_inverted_index: { Isolation: [0], of: [1], hepatocytes: [2] } },
  { id: "https://openalex.org/W2", doi: "https://doi.org/10.21203/rs.3.pex-1000/v1", title: "Hepatocyte isolation without perfusion", publication_year: 2020, type: "article", primary_location: { source: { display_name: "Protocol Exchange" } }, abstract_inverted_index: { "A": [0], "protocol": [1], "that": [2], "isolates": [3], "hepatocytes": [4], "from": [5], "minced": [6], "liver": [7], "without": [8], "perfusion.": [9] } },
] }
const CROSSREF = { message: { items: [
  { DOI: "10.17504/protocols.io.abc1", title: ["Primary hepatocyte isolation v2"], abstract: "<jats:p>Isolate mouse hepatocytes by perfusion of the portal vein with collagenase buffer at 37 C.</jats:p>", published: { "date-parts": [[2022, 3, 1]] } },
  // An earlier version of the same protocol: one protocol, the first kept.
  { DOI: "10.17504/protocols.io.abc0", title: ["Primary hepatocyte isolation v1"], abstract: "<jats:p>Isolate mouse hepatocytes by perfusion of the portal vein with collagenase buffer.</jats:p>", published: { "date-parts": [[2021]] } },
  // No abstract: nothing to check a statement against.
  { DOI: "10.17504/protocols.io.abc2", title: ["Hepatocyte plating"], abstract: "<jats:p/>" },
  // Not protocols.io: left out even if Crossref returned it.
  { DOI: "10.1000/other.1", title: ["Some other record"], abstract: "<jats:p>A long enough abstract about something else that is not a protocol at all.</jats:p>" },
] } }

type Answer = (url: URL, init?: RequestInit) => Response | Promise<Response>
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const DEFAULTS: Record<string, Answer> = {
  [PROTOCOL_HOSTS.europepmc]: () => json(EUROPEPMC),
  [PROTOCOL_HOSTS.openalex]: () => json(OPENALEX),
  [PROTOCOL_HOSTS.protocolsio]: () => json(CROSSREF),
}
function fakeNet(over: Record<string, Answer> = {}) {
  const calls: { url: URL; init?: RequestInit }[] = []
  const fetchFn = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ url, init })
    const answer = { ...DEFAULTS, ...over }[url.hostname]
    if (!answer || url.protocol !== "https:") throw new Error(`a test tried to reach ${url}`)
    return answer(url, init)
  }) as typeof fetch
  return { calls, fetchFn }
}

test("each source is asked for protocols only: Europe PMC and OpenAlex with the protocol journals, Crossref with the protocols.io prefix", async () => {
  const net = fakeNet()
  await protocolsLive("hepatocyte isolation mouse", { fetchFn: net.fetchFn })
  const by = (host: string) => net.calls.find((c) => c.url.hostname === host)!.url
  const pmc = by(PROTOCOL_HOSTS.europepmc).searchParams.get("query")!
  assert.equal(pmc, `(hepatocyte isolation mouse) AND ${EUROPE_PMC_FILTER}`)
  for (const j of PROTOCOL_JOURNALS) if (j.europepmc) assert.ok(pmc.includes(`JOURNAL:"${j.europepmc}"`), j.name)
  const oa = by(PROTOCOL_HOSTS.openalex)
  assert.equal(oa.searchParams.get("search"), "hepatocyte isolation mouse")
  assert.equal(oa.searchParams.get("filter"), `primary_location.source.issn:${PROTOCOL_JOURNALS.map((j) => j.issn).join("|")}`)
  const cr = by(PROTOCOL_HOSTS.protocolsio)
  assert.equal(cr.pathname, "/works")
  assert.equal(cr.searchParams.get("filter"), `prefix:${PROTOCOLS_IO_PREFIX}`)
  // No key is sent anywhere, and no redirect is followed.
  for (const c of net.calls) {
    assert.equal(c.url.protocol, "https:")
    assert.ok(!/key|token/i.test(c.url.search), String(c.url))
    assert.ok(!Object.keys((c.init?.headers ?? {}) as Record<string, string>).some((h) => /authorization|api-key/i.test(h)))
    assert.equal(c.init?.redirect, "error")
  }
})

test("the protocols of all sources become one list: provider \"protocols\", each protocol once (DOI, title, protocols.io version)", async () => {
  const { items, notices } = await protocolsLive("hepatocyte isolation", { fetchFn: fakeNet().fetchFn })
  assert.ok(items.every((i) => i.provider === "protocols"))
  assert.deepEqual(items.map((i) => i.url), [
    "https://pubmed.ncbi.nlm.nih.gov/38000001/", // Europe PMC first
    "https://doi.org/10.21203/rs.3.pex-1000/v1", // OpenAlex: its copy of the Bio-protocol paper is left out (same DOI)
    "https://doi.org/10.17504/protocols.io.abc1", // protocols.io: v2 kept, v1 left out, no abstract left out, other prefix left out
    "https://pubmed.ncbi.nlm.nih.gov/38000002/",
  ])
  assert.equal(items[2].title, "Primary hepatocyte isolation v2 (protocols.io, 2022)")
  assert.equal(items[2].text, "Isolate mouse hepatocytes by perfusion of the portal vein with collagenase buffer at 37 C.")
  assert.deepEqual(notices, [])
  assert.ok(items.length <= MAX_PROTOCOLS)
})

test("a protocol journal's paper is not a preprint, though OpenAlex may call it one; a Protocol Exchange protocol is", () => {
  const works = { results: [
    { id: "https://openalex.org/W9", doi: "https://doi.org/10.1101/pdb.prot5439", title: "Purification of RNA Using TRIzol", publication_year: 2010, type: "preprint", primary_location: { source: { display_name: "Cold Spring Harbor Protocols" } }, abstract_inverted_index: { RNA: [0], is: [1], purified: [2] } },
    OPENALEX.results[1],
  ] }
  assert.deepEqual(parseOpenAlex(asJournalWorks(works)).map((p) => p.item.title), ["Purification of RNA Using TRIzol (Cold Spring Harbor Protocols, 2010)", "Hepatocyte isolation without perfusion (preprint, 2020) [preprint]"])
  assert.deepEqual(asJournalWorks({ nothing: true }), { nothing: true }, "a body with no list is passed on as it came")
})

test("Crossref records: only protocols.io DOIs with an abstract; versions of one protocol are one", () => {
  const found = parseCrossrefProtocols(CROSSREF)
  assert.deepEqual(found.map((p) => p.doi), ["10.17504/protocols.io.abc1"])
  assert.deepEqual(parseCrossrefProtocols({}), [])
  assert.deepEqual(parseCrossrefProtocols({ message: { items: [null, 3, { DOI: 5 }] } }), [])
  assert.equal(withoutVersion("Western Blot v12"), "Western Blot")
  assert.equal(withoutVersion("Vitamin B12"), "Vitamin B12")
})

test("a source that fails or runs out of time is skipped and named; the others are still used", async () => {
  const net = fakeNet({
    [PROTOCOL_HOSTS.protocolsio]: () => json({ error: "busy" }, 503),
    [PROTOCOL_HOSTS.openalex]: (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
  })
  const { items, notices } = await protocolsLive("hepatocyte isolation", { fetchFn: net.fetchFn, timeoutMs: 50 })
  assert.deepEqual(items.map((i) => i.url), ["https://pubmed.ncbi.nlm.nih.gov/38000001/", "https://pubmed.ncbi.nlm.nih.gov/38000002/"])
  assert.match(notices[0], /^Skipped because it could not be used: OpenAlex \(protocol journals\) \(did not answer within 50 ms\); protocols\.io \(through Crossref\) \(answered 503\)\.$/)
})

test("only when every source fails does the protocol search fail; finding nothing is said", async () => {
  const down = () => json({}, 500)
  await assert.rejects(protocolsLive("x y z", { fetchFn: fakeNet({ [PROTOCOL_HOSTS.europepmc]: down, [PROTOCOL_HOSTS.openalex]: down, [PROTOCOL_HOSTS.protocolsio]: down }).fetchFn }), /no protocol source could be used/)
  const empty = fakeNet({ [PROTOCOL_HOSTS.europepmc]: () => json({ resultList: { result: [] } }), [PROTOCOL_HOSTS.openalex]: () => json({ results: [] }), [PROTOCOL_HOSTS.protocolsio]: () => json({ message: { items: [] } }) })
  const { items, notices } = await protocolsLive("nothing here at all", { fetchFn: empty.fetchFn })
  assert.equal(items.length, 0)
  assert.ok(notices.includes("No protocol with an abstract was found. Try other terms."))
})

test("a protocol query is sent without field tags, Boolean words or the words that only ask for a protocol", () => {
  assert.equal(protocolQuery('SOP for "western blot" (JOURNAL:Nature) AND transfer'), "for western blot JOURNAL Nature transfer")
  assert.equal(protocolQuery("standard operating procedure TRIzol RNA extraction"), "TRIzol RNA extraction")
  assert.equal(protocolQuery("protocol"), "protocol") // nothing else left: the words as given
})

test("a published protocol is labelled a protocol, cited like a paper and read as an abstract", () => {
  const item: EvidenceItem = { url: "https://doi.org/10.17504/protocols.io.abc1", title: "Primary hepatocyte isolation v2 (protocols.io, 2022)", text: ABSTRACT, provider: "protocols" }
  assert.equal(noteOf(item, "protocols"), "protocol")
  // A protocol journal paper the literature search found is labelled a protocol too.
  assert.equal(noteOf({ url: "https://pubmed.ncbi.nlm.nih.gov/1/", title: "Culturing hepatocytes (Journal of visualized experiments : JoVE, 2021)", text: ABSTRACT }, "europepmc"), "protocol")
  assert.equal(noteOf({ url: "https://pubmed.ncbi.nlm.nih.gov/2/", title: "A trial (N Engl J Med, 2023)", text: ABSTRACT }, "europepmc"), undefined)
  assert.ok(isProtocolTitle("X (STAR protocols, 2024)") && isProtocolTitle("X (Bio-protocol, 2020) [review]") && !isProtocolTitle("A protocol for X (Cell, 2020)"))
  // Merged with the literature search by title, like a paper.
  assert.ok(sourceKeys(item, "protocols").some((k) => k.startsWith("title:")))
  const [source] = numberSources([{ item: usable([item], "protocols")[0], provider: "protocols" }], 5)
  assert.equal(source.provider, "protocols")
  assert.equal(source.note, "protocol")
  assert.equal(source.published, "2022")
  assert.equal(READ_LIMIT.protocols, "Only the abstract of the protocol was read, not its steps.")
  assert.match(selectionOf([source], [], 5, "quick").selected[0].limitation!, /A protocol: it describes a method, not findings\. Only the abstract of the protocol was read/)
})
