// The free literature search (Europe PMC). No test here reaches the network: fetch is a fake.
import assert from "node:assert/strict"
import { test } from "node:test"
import { literatureLive, literatureOnce, parseEuropePmc, plainText, retryQueries, type LiteratureDeps } from "../src/search/literature.ts"

const record = (over: Record<string, unknown> = {}) => ({
  id: "40959979", source: "MED", pmid: "40959979", title: "Identification of KRAS mutants inhibitors.", pubYear: "2025",
  abstractText: "<h4>Aim</h4>To identify inhibitors of KRAS G12C.<h4>Results</h4>Compound 7 had an IC<sub>50</sub> of 12 nM &amp; was selective.",
  journalInfo: { journal: { title: "Future medicinal chemistry" } }, pubTypeList: { pubType: ["research-article"] }, ...over,
})
const answer = (records: unknown[]) => ({ ok: true, status: 200, json: async () => ({ resultList: { result: records } }) }) as unknown as Response

test("an abstract is turned into plain text a quote can be found in", () => {
  assert.equal(plainText("<h4>Aim</h4>To test A &amp; B.<h4>Results</h4>IC<sub>50</sub> was &lt; 5 nM."), "Aim. To test A & B. Results. IC50 was < 5 nM.")
})

test("records become evidence items: PubMed address, journal and year, preprints and reviews marked, no abstract left out", () => {
  const items = parseEuropePmc({ resultList: { result: [
    record(),
    record({ id: "PPR123", source: "PPR", pmid: undefined, title: "A preprint" }),
    record({ id: "111", pmid: "111", title: "A review", pubTypeList: { pubType: ["Review", "Journal Article"] } }),
    record({ id: "222", pmid: "222", abstractText: "" }),
    record({ id: "../../etc", pmid: "x" }),
  ] } })
  assert.equal(items.length, 3, "the record with no abstract and the one with an unsafe id are left out")
  assert.equal(items[0].url, "https://pubmed.ncbi.nlm.nih.gov/40959979/")
  assert.equal(items[0].title, "Identification of KRAS mutants inhibitors. (Future medicinal chemistry, 2025)")
  assert.match(items[0].text, /Compound 7 had an IC50 of 12 nM & was selective\./)
  assert.equal(items[0].provider, "europepmc")
  assert.equal(items[1].url, "https://europepmc.org/article/PPR/PPR123")
  assert.match(items[1].title, /\(preprint, 2025\) \[preprint\]$/)
  assert.match(items[2].title, /\[review\]$/)
  assert.deepEqual(parseEuropePmc({}), [])
  assert.deepEqual(parseEuropePmc("<html>"), [])
})

test("a query that finds nothing is tried again with fewer words, and the member is told which query answered", async () => {
  assert.deepEqual(retryQueries("KRAS G12C covalent hERG"), ["KRAS G12C covalent hERG", "KRAS G12C covalent", "KRAS G12C"])
  assert.deepEqual(retryQueries("KRAS  G12C"), ["KRAS G12C"], "never fewer than two words")
  const asked: string[] = []
  const fetchFn = (async (url: string) => {
    const q = new URL(url).searchParams.get("query") as string
    asked.push(q)
    return answer(q === "KRAS G12C covalent" ? [record()] : [])
  }) as unknown as typeof fetch
  const found = await literatureLive("KRAS G12C covalent hERG", fetchFn)
  assert.deepEqual(asked, ["KRAS G12C covalent hERG", "KRAS G12C covalent"])
  assert.equal(found.items.length, 1)
  assert.match(found.notices[0], /results for "KRAS G12C covalent"/)
  const none = await literatureLive("zz yy", (async () => answer([])) as unknown as typeof fetch)
  assert.deepEqual(none.items, [])
  assert.match(none.notices[0], /No paper/)
  await assert.rejects(literatureLive("a b", (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch), /503/)
})

function deps(over: Partial<LiteratureDeps> = {}) {
  const calls = { search: 0 }
  const d: LiteratureDeps = {
    state: {}, mock: false, maxSearches: 2,
    search: async () => { calls.search++; return { items: [{ url: "https://pubmed.ncbi.nlm.nih.gov/1/", title: "t", text: "x" }], notices: [] } },
    capReached: async () => false, paidOff: () => false, ...over,
  }
  return { d, calls }
}

test("a replayed tool call reads its stored result; it does not search again or count twice", async () => {
  const { d, calls } = deps()
  const first = await literatureOnce(d, "call-1", "kras g12c")
  const again = await literatureOnce(d, "call-1", "kras g12c")
  assert.equal(calls.search, 1)
  assert.deepEqual(again.result?.items, first.result?.items)
  assert.equal(Object.keys(d.state.literature ?? {}).length, 1)
})

test("refused past the per-run count, at the spend cap and with paid calls off; a refusal searches nothing", async () => {
  const { d, calls } = deps()
  await literatureOnce(d, "a", "q one"); await literatureOnce(d, "b", "q two")
  const third = await literatureOnce(d, "c", "q three")
  assert.match(third.refused ?? "", /2 of 2/)
  assert.equal(calls.search, 2)
  const capped = deps({ capReached: async () => true })
  assert.match((await literatureOnce(capped.d, "a", "q")).refused ?? "", /Spend cap/)
  const off = deps({ paidOff: () => true })
  assert.match((await literatureOnce(off.d, "a", "q")).refused ?? "", /switched off/)
  assert.equal(capped.calls.search + off.calls.search, 0)
})

test("a practice run gets what its scripted search returns and stores nothing", async () => {
  const { d, calls } = deps({ mock: true, maxSearches: 0 })
  const out = await literatureOnce(d, "a", "q")
  assert.equal(out.result?.items.length, 1)
  assert.equal(calls.search, 1)
  assert.equal(d.state.literature, undefined)
})

test("the service being down does not stop the run: the member is told, and the failed call is not counted or stored", async () => {
  const { d } = deps({ search: async () => { throw new Error("Europe PMC answered 503") } })
  const out = await literatureOnce(d, "a", "q")
  assert.match(out.refused ?? "", /could not be reached \(Europe PMC answered 503\)/)
  assert.equal(out.failed, true)
  assert.equal(d.state.literature, undefined)
})

test("the request asks for abstracts as JSON and sends no sort (sort=RELEVANCE is answered with 503)", async () => {
  let asked = ""
  await literatureLive("kras g12c", (async (url: string) => { asked = url; return answer([record()]) }) as unknown as typeof fetch)
  const u = new URL(asked)
  assert.equal(u.origin + u.pathname, "https://www.ebi.ac.uk/europepmc/webservices/rest/search")
  assert.deepEqual(Object.fromEntries(u.searchParams), { query: "kras g12c", resultType: "core", format: "json", pageSize: "8" })
})
