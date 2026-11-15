// Pictures with a research answer: a picture comes only from what a search already returned (Exa's `image` field),
// rides on its source through the record and the `sources` event, and is left out when there is none or it is unsafe.
// Fakes only (test/fixtures/research/harness.ts): fake models, a fake fetch for Exa and Europe PMC, fake keys.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

process.env.NO_PAID_CALLS = "1"
const { engine, EUROPEPMC, EXA_RESULTS, jsonResponse, paidAllowed } = await import("./fixtures/research/harness.ts")
const { imageUrl } = await import("../src/research/text.ts")
import type { Stamped } from "../src/research/types.ts"

const Q = "Does semaglutide lower the risk of heart attack and stroke in people with obesity who do not have diabetes?"
const PICTURE = "https://www.example-cardiology.org/images/select-trial.png"
const withImage = (image: unknown) => [{ ...EXA_RESULTS[0], image }, ...EXA_RESULTS.slice(1)]
const sourcesEvent = (events: Stamped[]) => events.filter((e) => e.type === "sources").at(-1) as Extract<Stamped, { type: "sources" }>

test("imageUrl keeps an https address only", () => {
  assert.equal(imageUrl(PICTURE), PICTURE)
  for (const bad of ["http://example.org/a.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "https://user:pw@example.org/a.png", "https://example.org/a b.png", `https://example.org/${"a".repeat(1_000)}.png`, "", undefined, null, 7])
    assert.equal(imageUrl(bad), undefined, String(bad).slice(0, 40))
})

test("a picture Exa returned with a page is kept on its source, in the record, the sources event and sources.json; no extra request is made", async () => {
  const e = await engine()
  e.net.exa = [() => jsonResponse({ results: withImage(PICTURE), costDollars: { total: 0.005 } })]
  try {
    const { record, events, id } = await paidAllowed(() => e.answer({ question: Q, effort: "quick" }))
    assert.equal(record.status, "done")
    assert.equal(e.exaRequests().length, 1, "the picture came with the search: no second request")
    assert.deepEqual(e.exaRequests()[0].body?.contents, { highlights: true }, "the request asks for nothing more than before")
    const web = record.sources.find((s) => s.provider === "exa")!
    assert.equal(web.url, EXA_RESULTS[0].url)
    assert.equal(web.image, PICTURE)
    assert.ok(record.sources.filter((s) => s.provider !== "exa").every((s) => s.image === undefined), "a paper from Europe PMC has no picture")
    assert.equal(sourcesEvent(events).items.find((s) => s.n === web.n)?.image, PICTURE, "the event carries it, so a reopened answer shows it")
    const saved = JSON.parse(readFileSync(join(e.runs, ".research", id, "sources.json"), "utf8")) as { sources: { n: number; image?: string }[] }
    assert.equal(saved.sources.find((s) => s.n === web.n)?.image, PICTURE)
  } finally { await e.close() }
})

test("no picture, or one that is not https, gives a source without a picture and the answer as before", async () => {
  const e = await engine()
  try {
    for (const image of [undefined, null, "http://www.example-cardiology.org/a.png", "javascript:alert(1)"]) {
      e.net.exa = [() => jsonResponse({ results: image === undefined ? EXA_RESULTS : withImage(image), costDollars: { total: 0.005 } })]
      const { record, events } = await paidAllowed(() => e.answer({ question: Q, effort: "quick" }))
      assert.equal(record.status, "done", String(image))
      assert.ok(record.sources.length > 0)
      assert.ok(record.sources.every((s) => !("image" in s)), String(image))
      assert.ok(sourcesEvent(events).items.every((s) => !("image" in s)), String(image))
    }
  } finally { await e.close() }
})

test("pictures and the extra literature indexes both survive: the web source keeps its picture, an OpenAlex paper is numbered under its own name, and a paper both indexes found is numbered once", async () => {
  const e = await engine()
  const pmc = EUROPEPMC.resultList.result.slice(0, 2)
  const twin = pmc[0] as { doi: string; title: string }
  e.net.exa = [() => jsonResponse({ results: withImage(PICTURE), costDollars: { total: 0.005 } })]
  e.net.europepmc = () => jsonResponse({ resultList: { result: pmc } })
  e.net.openalex = () => jsonResponse({ results: [
    // The same paper as Europe PMC's first, by DOI: it must not get a second number.
    { id: "https://openalex.org/W1", doi: `https://doi.org/${twin.doi.toUpperCase()}`, title: twin.title, publication_year: 2026, type: "article", abstract_inverted_index: { Semaglutide: [0], lowered: [1], cardiovascular: [2], "events.": [3] } },
    { id: "https://openalex.org/W2", doi: "https://doi.org/10.5555/openalex.select", title: "Semaglutide in adults with obesity: cardiovascular outcomes in a pooled cohort", publication_year: 2025, type: "article", primary_location: { source: { display_name: "Obesity Reviews" } },
      abstract_inverted_index: Object.fromEntries("Semaglutide 2.4 mg lowered major adverse cardiovascular events by 18% in 9,000 adults with obesity and no diabetes.".split(" ").map((w, i) => [w, [i]])) },
  ] })
  try {
    const { record, events } = await paidAllowed(() => e.answer({ question: Q, effort: "standard" }))
    assert.equal(record.status, "done")
    const web = record.sources.find((s) => s.provider === "exa" && s.url === EXA_RESULTS[0].url)
    assert.equal(web?.image, PICTURE, "the web source keeps its picture")
    const oa = record.sources.find((s) => s.provider === "openalex")
    assert.ok(oa, `an OpenAlex paper is numbered: ${record.sources.map((s) => s.provider).join(", ")}`)
    assert.equal(oa.url, "https://doi.org/10.5555/openalex.select")
    assert.equal(oa.image, undefined, "a paper has no picture")
    const twins = record.sources.filter((s) => s.title.toLowerCase().startsWith(twin.title.toLowerCase().replace(/\.$/, "").slice(0, 40)))
    assert.equal(twins.length, 1, "the paper both indexes found is numbered once")
    assert.equal(twins[0].provider, "europepmc", "Europe PMC's copy is the one kept")
    const items = sourcesEvent(events).items
    assert.equal(items.find((s) => s.n === web!.n)?.image, PICTURE)
    assert.equal(items.find((s) => s.n === oa.n)?.provider, "openalex")
  } finally { await e.close() }
})
