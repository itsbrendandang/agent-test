// The research answer's literature search over four free sources (scholarly.ts). No test here reaches the network:
// fetch is a fake that answers by host, and throws for any other address.
import assert from "node:assert/strict"
import { test } from "node:test"
import { LITERATURE_HOSTS, mergePapers, openAlexAbstract, parseArxiv, parseOpenAlex, parseSemanticScholar, scholarlyLive, titleKey } from "../src/search/scholarly.ts"
import { numberSources, providerOf, READ_LIMIT, selectionOf, usable } from "../src/research/pipeline.ts"

const ABSTRACT = "Semaglutide reduced major adverse cardiovascular events by 20% in adults with obesity and no diabetes."

const EUROPEPMC = { resultList: { result: [
  { id: "37952131", source: "MED", pmid: "37952131", doi: "10.1056/NEJMoa2307563", title: "Semaglutide and Cardiovascular Outcomes in Obesity without Diabetes.", pubYear: "2023", abstractText: ABSTRACT, journalInfo: { journal: { title: "N Engl J Med" } } },
] } }
const OPENALEX = { results: [
  // The same paper as Europe PMC's, by DOI (written as a link): left out.
  { id: "https://openalex.org/W1", doi: "https://doi.org/10.1056/NEJMOA2307563", title: "Semaglutide and cardiovascular outcomes in obesity without diabetes", publication_year: 2023, type: "article", abstract_inverted_index: { Semaglutide: [0], works: [1] } },
  { id: "https://openalex.org/W2", doi: "https://doi.org/10.1000/openalex.2", title: "GLP-1 agonists and heart failure", publication_year: 2022, type: "review", primary_location: { source: { display_name: "Heart" } }, abstract_inverted_index: { "GLP-1": [0], agonists: [1], reduce: [2], heart: [3], failure: [4], admissions: [5], in: [6], "adults.": [7] } },
  { id: "https://openalex.org/W3", doi: null, title: "A work without an abstract", publication_year: 2021, type: "article", abstract_inverted_index: null },
] }
const S2 = { data: [
  // The same paper as OpenAlex's W2, by DOI: left out.
  { paperId: "a", url: "https://www.semanticscholar.org/paper/a", title: "GLP-1 agonists and heart failure", year: 2022, venue: "Heart", abstract: "GLP-1 agonists reduce heart failure admissions in adults.", externalIds: { DOI: "10.1000/OPENALEX.2" } },
  { paperId: "b", url: "https://www.semanticscholar.org/paper/b", title: "Weight loss and blood pressure", year: 2020, venue: "Hypertension", abstract: "Weight loss lowered systolic blood pressure in adults.", externalIds: {}, publicationTypes: ["JournalArticle"] },
] }
const ARXIV = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><id>http://arxiv.org/abs/2401.01234v2</id><published>2024-01-03T00:00:00Z</published><title>Modelling semaglutide
  response &amp; weight</title><summary>We model the response to semaglutide in 1,000 simulated patients.</summary></entry>
<entry><id>http://arxiv.org/abs/2402.00001v1</id><published>2024-02-01T00:00:00Z</published><title>Semaglutide and cardiovascular outcomes in obesity without diabetes</title><summary>A copy of the trial's title: left out.</summary></entry>
</feed>`

type Answer = (url: URL, init?: RequestInit) => Response | Promise<Response>
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const DEFAULTS: Record<string, Answer> = {
  [LITERATURE_HOSTS.europepmc]: () => json(EUROPEPMC),
  [LITERATURE_HOSTS.openalex]: () => json(OPENALEX),
  [LITERATURE_HOSTS.semanticscholar]: () => json(S2),
  [LITERATURE_HOSTS.arxiv]: () => new Response(ARXIV, { status: 200 }),
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

test("OpenAlex abstracts are rebuilt from the inverted index, in word order", () => {
  assert.equal(openAlexAbstract({ world: [1], Hello: [0], again: [3], "hello,": [2] }), "Hello world hello, again")
  assert.equal(openAlexAbstract(null), "")
})

test("each source's records become evidence items in the literature title form; no abstract, no item", () => {
  const oa = parseOpenAlex(OPENALEX)
  assert.equal(oa.length, 2)
  assert.deepEqual(oa[1], { item: { url: "https://doi.org/10.1000/openalex.2", title: "GLP-1 agonists and heart failure (Heart, 2022) [review]", text: "GLP-1 agonists reduce heart failure admissions in adults.", provider: "openalex" }, doi: "10.1000/openalex.2" })
  const s2 = parseSemanticScholar(S2)
  assert.equal(s2[1].item.url, "https://www.semanticscholar.org/paper/b")
  assert.equal(s2[1].item.title, "Weight loss and blood pressure (Hypertension, 2020)")
  const ax = parseArxiv(ARXIV)
  assert.deepEqual(ax[0].item, { url: "https://arxiv.org/abs/2401.01234", title: "Modelling semaglutide response & weight (arXiv preprint, 2024) [preprint]", text: "We model the response to semaglutide in 1,000 simulated patients.", provider: "arxiv" })
})

test("titles are compared without case, punctuation or the (Journal, year) end", () => {
  assert.equal(titleKey("Semaglutide and Cardiovascular Outcomes. (N Engl J Med, 2023) [review]"), titleKey("semaglutide and cardiovascular outcomes"))
})

test("the four sources are merged: each paper once (by DOI or title), Europe PMC's copy first, sources taking turns", async () => {
  const { calls, fetchFn } = fakeNet()
  const result = await scholarlyLive("semaglutide cardiovascular obesity", { fetchFn })
  assert.deepEqual(result.items.map((i) => i.url), [
    "https://pubmed.ncbi.nlm.nih.gov/37952131/",
    "https://doi.org/10.1000/openalex.2",
    "https://www.semanticscholar.org/paper/b",
    "https://arxiv.org/abs/2401.01234",
  ])
  assert.deepEqual(result.items.map((i) => i.provider), ["europepmc", "openalex", "semanticscholar", "arxiv"])
  assert.deepEqual(result.notices, [])
  // Only HTTPS, only the four allowed hosts, one request each, redirects refused.
  assert.deepEqual(calls.map((c) => c.url.hostname).sort(), Object.values(LITERATURE_HOSTS).sort())
  for (const c of calls) assert.equal(c.init?.redirect, "error")
  assert.equal(calls.find((c) => c.url.hostname === LITERATURE_HOSTS.arxiv)?.url.searchParams.get("search_query"), "all:semaglutide AND all:cardiovascular AND all:obesity")
})

test("one source failing is skipped with a notice; the others are still used", async () => {
  const { fetchFn } = fakeNet({ [LITERATURE_HOSTS.semanticscholar]: () => json({ message: "Too Many Requests" }, 429) })
  const result = await scholarlyLive("semaglutide cardiovascular", { fetchFn })
  assert.deepEqual(result.items.map((i) => i.provider), ["europepmc", "openalex", "arxiv"])
  assert.ok(!result.items.some((i) => i.provider === "semanticscholar"))
  assert.match(result.notices.join(" "), /Skipped because it could not be used: Semantic Scholar \(answered 429\)/)
})

test("a source that does not answer in time is dropped at its own time limit", async () => {
  const hang: Answer = (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
  const { fetchFn } = fakeNet({ [LITERATURE_HOSTS.openalex]: hang, [LITERATURE_HOSTS.arxiv]: () => { throw new TypeError("fetch failed") } })
  const started = Date.now()
  const result = await scholarlyLive("semaglutide cardiovascular", { fetchFn, timeoutMs: 50 })
  assert.ok(Date.now() - started < 2_000)
  assert.deepEqual(result.items.map((i) => i.provider).sort(), ["europepmc", "semanticscholar", "semanticscholar"])
  assert.match(result.notices.join(" "), /OpenAlex \(did not answer within 50 ms\).*arXiv \(it could not be reached\)/)
})

test("only when every source fails does the search fail", async () => {
  const down: Answer = () => json({}, 503)
  const { fetchFn } = fakeNet(Object.fromEntries(Object.values(LITERATURE_HOSTS).map((h) => [h, down])))
  await assert.rejects(scholarlyLive("semaglutide", { fetchFn }), /no literature source could be used/)
})

test("the Semantic Scholar key is optional and read from the environment only; it never appears in a notice", async () => {
  const plain = fakeNet()
  await scholarlyLive("semaglutide", { fetchFn: plain.fetchFn, env: {} })
  const s2 = (calls: typeof plain.calls) => calls.find((c) => c.url.hostname === LITERATURE_HOSTS.semanticscholar)!.init!.headers as Record<string, string>
  assert.equal(s2(plain.calls)["x-api-key"], undefined)
  const keyed = fakeNet({ [LITERATURE_HOSTS.semanticscholar]: () => json({}, 403) })
  const result = await scholarlyLive("semaglutide", { fetchFn: keyed.fetchFn, env: { SEMANTIC_SCHOLAR_API_KEY: "fake-s2-key-0004" } })
  assert.equal(s2(keyed.calls)["x-api-key"], "fake-s2-key-0004")
  assert.ok(!JSON.stringify(result).includes("fake-s2-key-0004"))
})

test("merging keeps at most the cap, the sources taking turns", () => {
  const p = (provider: "europepmc" | "openalex", n: number) => ({ item: { url: `https://example.org/${provider}/${n}`, title: `${provider} paper number ${n} of many`, text: "x", provider } })
  const merged = mergePapers([[1, 2, 3, 4].map((n) => p("europepmc", n)), [1, 2].map((n) => p("openalex", n))], 5)
  assert.deepEqual(merged.map((i) => i.url.replace("https://example.org/", "")), ["europepmc/1", "openalex/1", "europepmc/2", "openalex/2", "europepmc/3"])
})

test("an answer's numbered sources name the index a paper came from, with its year and read limit", async () => {
  const { fetchFn } = fakeNet()
  const found = usable((await scholarlyLive("semaglutide cardiovascular", { fetchFn })).items, "europepmc")
  assert.deepEqual(found.map((i) => providerOf(i, "europepmc")), ["europepmc", "openalex", "semanticscholar", "arxiv"])
  const sources = numberSources(found.map((item, order) => ({ item, provider: "europepmc" as const, order })), 10)
  assert.deepEqual(sources.map((s) => [s.provider, s.published]), [["europepmc", "2023"], ["openalex", "2022"], ["semanticscholar", "2020"], ["arxiv", "2024"]])
  assert.equal(READ_LIMIT.arxiv, "Only the abstract was read.")
  // A web result never takes a paper index's name.
  assert.equal(providerOf({ url: "https://x.org", title: "t", text: "x", provider: "openalex" }, "exa"), "exa")
})

test("a source that sends more than the size limit is skipped, Europe PMC too", async () => {
  const huge = () => new Response("x".repeat(4_000_001), { status: 200 })
  const { fetchFn } = fakeNet({ [LITERATURE_HOSTS.europepmc]: huge, [LITERATURE_HOSTS.openalex]: huge })
  const result = await scholarlyLive("semaglutide cardiovascular obesity", { fetchFn })
  assert.deepEqual(result.items.map((i) => i.provider), ["semanticscholar", "arxiv", "semanticscholar", "arxiv"], "the sources still take turns; the arXiv copy of the trial stays, as Europe PMC sent nothing usable")
  assert.deepEqual(result.notices, ["Skipped because it could not be used: Europe PMC (sent too much); OpenAlex (sent too much)."])
})

test("one paper found by two searches, under its PubMed address and its DOI address, is numbered once", async () => {
  // Search 1: Europe PMC finds the trial (PubMed address). Search 2: only OpenAlex finds it (DOI address, no DOI match possible).
  const first = usable((await scholarlyLive("semaglutide obesity", { fetchFn: fakeNet({ [LITERATURE_HOSTS.openalex]: () => json({ results: [] }), [LITERATURE_HOSTS.semanticscholar]: () => json({ data: [] }), [LITERATURE_HOSTS.arxiv]: () => new Response("<feed></feed>") }).fetchFn })).items, "europepmc")
  const openAlexCopy = { results: [{ id: "https://openalex.org/W9", doi: "https://doi.org/10.9999/other.copy", title: "Semaglutide and Cardiovascular Outcomes in Obesity without Diabetes", publication_year: 2023, type: "article", abstract_inverted_index: { Semaglutide: [0], reduced: [1], major: [2], adverse: [3], cardiovascular: [4], events: [5], by: [6], "20%": [7], in: [8], "adults.": [9] } }] }
  const second = usable((await scholarlyLive("cardiovascular outcomes trial", { fetchFn: fakeNet({ [LITERATURE_HOSTS.europepmc]: () => json({ resultList: { result: [] } }), [LITERATURE_HOSTS.openalex]: () => json(openAlexCopy), [LITERATURE_HOSTS.semanticscholar]: () => json({ data: [] }), [LITERATURE_HOSTS.arxiv]: () => new Response("<feed></feed>") }).fetchFn })).items, "europepmc")
  assert.deepEqual(first.map((i) => i.url), ["https://pubmed.ncbi.nlm.nih.gov/37952131/"])
  assert.deepEqual(second.map((i) => i.url), ["https://doi.org/10.9999/other.copy"])
  const pool = [...first.map((item) => ({ item, provider: "europepmc" as const, order: 1_000 })), ...second.map((item) => ({ item, provider: "europepmc" as const, order: 2_000 }))]
  const sources = numberSources(pool, 10)
  assert.deepEqual(sources.map((s) => [s.n, s.url, s.provider]), [[1, "https://pubmed.ncbi.nlm.nih.gov/37952131/", "europepmc"]])
  const copy = second[0]
  const selection = selectionOf(sources, [{ title: copy.title, url: copy.url, provider: "openalex", reason: "Screened as not about the question." }], 10, "standard")
  assert.deepEqual(selection.notSelected, [], "the second copy is not listed as not selected either")
  // Two web pages with the same title are still two sources: only papers are compared by title.
  const page = (url: string) => ({ item: { url, title: "Semaglutide and cardiovascular outcomes", text: "x" }, provider: "exa" as const })
  assert.equal(numberSources([page("https://a.org/1"), page("https://b.org/1")], 10).length, 2)
})
