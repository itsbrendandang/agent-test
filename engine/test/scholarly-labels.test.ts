// Every literature source the engine searches (scholarly.ts) has a credit on the dashboard
// (dashboard/src/research/providers.ts), and the dashboard's literature step names all of them. A source added to
// the engine without a dashboard label fails here.
import assert from "node:assert/strict"
import { test } from "node:test"
import { SCHOLARLY_SOURCES, SOURCE_NAME } from "../src/search/scholarly.ts"
import { PROVIDERS, searchPlace } from "../../dashboard/src/research/providers.ts"

test("every engine literature source has a dashboard label with a link", () => {
  for (const source of SCHOLARLY_SOURCES) {
    const info = PROVIDERS[source]
    assert.ok(info, `no dashboard label for ${source}`)
    assert.equal(info.kind, "literature", source)
    assert.match(info.link ?? "", /^https:\/\//, source)
    assert.ok(info.linkText, source)
  }
  assert.equal(PROVIDERS.crossref?.link, "https://www.crossref.org")
  assert.equal(PROVIDERS.biorxiv?.link, "https://www.biorxiv.org")
})

test("the dashboard's literature step names every engine literature source", () => {
  const place = searchPlace("europepmc")
  for (const source of SCHOLARLY_SOURCES) assert.ok(place.includes(SOURCE_NAME[source]), `${SOURCE_NAME[source]} missing from "${place}"`)
})
