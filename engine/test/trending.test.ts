// "Try asking" from Google's trending searches (src/search/trending.ts). No test here reaches the network: fetch is a
// fake, and the feed is a written-out copy of its shape. No model is called on this path.
import assert from "node:assert/strict"
import { createServer, request } from "node:http"
import type { AddressInfo } from "node:net"
import { test } from "node:test"
import { createApp } from "../src/app.ts"
import { bioWord, createTrending, CURATED, onlyBio, parseTrends, TRENDING_COUNT, TRENDING_RETRY_MS, TRENDING_TTL_MS, trendQuestions } from "../src/search/trending.ts"

const item = (term: string, news: string[] = []) => `<item><title>${term}</title><ht:approx_traffic>500+</ht:approx_traffic>
  ${news.map((t) => `<ht:news_item><ht:news_item_title>${t}</ht:news_item_title><ht:news_item_url>https://news.example/x</ht:news_item_url></ht:news_item>`).join("")}</item>`
const feed = (...items: string[]) => `<?xml version="1.0" encoding="UTF-8"?><rss xmlns:ht="https://trends.google.com/trending/rss" version="2.0"><channel><title>Daily Search Trends</title>${items.join("")}</channel></rss>`
const BIO_FEED = feed(
  item("bills jets", ["Bills beat the Jets"]),
  item("measles outbreak", ["Measles cases rise in Texas"]),
  item("gene hackman", ["Actor remembered"]),
  item("val kilmer", ["Val Kilmer opens up about throat cancer"]),
  item("bird flu &amp; cats", ["H5N1 found in house cats"]),
  item("val kilmer cancer", ["Val Kilmer opens up about his illness"]),
  item("scottie scheffler", ["Scheffler takes two-stroke lead into the final round"]),
)
const NO_BIO_FEED = feed(item("bills jets", ["Bills beat the Jets"]), item("robert kraft", ["The Krafts propose a data center"]))

/** A fake fetch that answers with `body` (or throws `fail`) and counts its calls. */
function fakeFetch(body: string | (() => never), status = 200) {
  const calls: string[] = []
  const f = (async (url: string | URL) => {
    calls.push(String(url))
    if (typeof body === "function") body()
    return new Response(body as string, { status, headers: { "content-type": "application/rss+xml" } })
  }) as typeof fetch
  return { f, calls }
}

test("the feed's searches and their news titles are read, entities decoded", () => {
  const trends = parseTrends(BIO_FEED)
  assert.equal(trends.length, 7)
  assert.deepEqual(trends[1], { term: "measles outbreak", news: ["Measles cases rise in Texas"] })
  assert.equal(trends[4].term, "bird flu & cats")
  assert.deepEqual(parseTrends("not xml at all"), [])
})

test("only searches about biology become questions; a person's name is never the subject", () => {
  assert.equal(bioWord("measles outbreak"), "measles")
  assert.equal(bioWord("gene hackman"), undefined) // "gene" is a first name
  assert.equal(bioWord("bills jets"), undefined)
  assert.ok(onlyBio("measles outbreak"))
  assert.ok(!onlyBio("val kilmer cancer"))
  const qs = trendQuestions(parseTrends(BIO_FEED))
  assert.deepEqual(qs.map((q) => q.question), [
    "What does the latest science say about measles outbreak?", // only biology words: asked as searched
    "What does the latest science say about cancer?", // from the news; not about the person searched
    "What does the latest science say about bird flu?", // "cats" is not biology here, so only the biology word
  ]) // "val kilmer cancer" gives "cancer" again (one question), and the golfer's "two-stroke lead" gives none
  assert.deepEqual(qs.map((q) => q.topic), ["Trending: measles outbreak", "Trending: cancer", "Trending: bird flu"])
  for (const q of qs) assert.ok(q.trending && !/kilmer|hackman|scheffler|jets/i.test(q.question + q.topic), q.question)
})

test("a name with a biology word gives a question about the biology word only", () => {
  const [q] = trendQuestions([{ term: "val kilmer cancer", news: [] }])
  assert.deepEqual(q, { question: "What does the latest science say about cancer?", topic: "Trending: cancer", trending: true })
})

test("an ambiguous word in the news alone makes no suggestion; in the search itself it does", () => {
  assert.deepEqual(trendQuestions([{ term: "scottie scheffler", news: ["Scheffler takes two-stroke lead into the final round"] }]), [])
  assert.deepEqual(trendQuestions([{ term: "fed meeting", news: ["Oil and fossil fuel stocks fall", "Protein bar maker beats estimates"] }]), [])
  assert.equal(trendQuestions([{ term: "stroke symptoms", news: [] }])[0]?.question, "What does the latest science say about stroke symptoms?")
})

test("an agency or brand name in the news alone makes no suggestion; in the search itself it does", () => {
  assert.deepEqual(trendQuestions([{ term: "pfizer stock", news: ["FDA approves new weight loss pill"] }]), [])
  assert.deepEqual(trendQuestions([{ term: "senate hearing", news: ["CDC director testifies", "NIH budget cut", "Tylenol maker shares fall"] }]), [])
  assert.equal(trendQuestions([{ term: "fda", news: [] }])[0]?.topic, "Trending: fda")
  assert.equal(trendQuestions([{ term: "tylenol autism", news: [] }])[0]?.question, "What does the latest science say about tylenol autism?")
})

test("a feed bigger than the limit is cut, not read whole", async () => {
  const big = feed(item("measles", [])) + " ".repeat(3_000_000)
  let pulled = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(c) { if (pulled >= big.length) return c.close(); const part = big.slice(pulled, pulled + 65_536); pulled += part.length; c.enqueue(new TextEncoder().encode(part)) },
  })
  const a = await createTrending({ fetch: (async () => new Response(stream)) as typeof fetch }).get()
  assert.equal(a.items[0].question, "What does the latest science say about measles?")
  assert.ok(pulled < 1_200_000, `read ${pulled} characters`)
})

test("bio trends come first and curated questions fill the row; the answer is kept for an hour", async () => {
  let t = 1_000_000
  const { f, calls } = fakeFetch(BIO_FEED)
  const trending = createTrending({ fetch: f, now: () => t })
  const a = await trending.get()
  assert.equal(a.source, "google-trends")
  assert.equal(a.fetchedAt, 1_000_000)
  assert.equal(a.items.length, TRENDING_COUNT)
  assert.deepEqual(a.items.map((i) => i.trending), [true, true, true, false])
  assert.deepEqual(a.items[3], CURATED[0])
  t += TRENDING_TTL_MS - 1
  await trending.get()
  assert.equal(calls.length, 1, "read once within the hour")
  t += 1
  await trending.get()
  assert.equal(calls.length, 2, "read again after the hour")
})

test("a feed with nothing about biology gives the curated questions", async () => {
  const a = await createTrending({ fetch: fakeFetch(NO_BIO_FEED).f }).get()
  assert.equal(a.source, "curated")
  assert.deepEqual(a.items, CURATED.slice(0, TRENDING_COUNT))
})

test("a network failure, an error status or an empty feed gives the curated questions, and is tried again later", async () => {
  let t = 0
  const down = fakeFetch(() => { throw new TypeError("fetch failed") })
  const trending = createTrending({ fetch: down.f, now: () => t })
  const a = await trending.get()
  assert.deepEqual(a, { source: "curated", fetchedAt: 0, items: CURATED.slice(0, TRENDING_COUNT) })
  await trending.get()
  assert.equal(down.calls.length, 1, "a failure is not retried at once")
  t += TRENDING_RETRY_MS
  await trending.get()
  assert.equal(down.calls.length, 2)
  assert.equal((await createTrending({ fetch: fakeFetch("busy", 503).f }).get()).source, "curated")
  assert.equal((await createTrending({ fetch: fakeFetch("").f }).get()).source, "curated")
})

test("a feed that does not answer in time gives the curated questions", async () => {
  const hang = (async (_url: string | URL, init?: RequestInit) => new Promise<Response>((_, fail) => {
    init?.signal?.addEventListener("abort", () => fail(init.signal!.reason))
  })) as typeof fetch
  const a = await createTrending({ fetch: hang, timeoutMs: 20 }).get()
  assert.equal(a.source, "curated")
})

test("requests that arrive together share one reading", async () => {
  const { f, calls } = fakeFetch(BIO_FEED)
  const trending = createTrending({ fetch: f })
  await Promise.all([trending.get(), trending.get(), trending.get()])
  assert.equal(calls.length, 1)
})

test("GET /api/trending answers with the questions (fake feed, mock engine)", async () => {
  const { f } = fakeFetch(BIO_FEED)
  const app = createApp({ mock: true, env: {}, trending: { fetch: f } })
  const server = createServer((req, res) => void app.handler(req, res))
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
  try {
    const { port } = server.address() as AddressInfo
    const body = await new Promise<string>((ok, fail) => {
      request({ host: "127.0.0.1", port, path: "/api/trending", headers: { host: `127.0.0.1:${port}` } }, (res) => {
        let text = ""; res.on("data", (c) => (text += c)); res.on("end", () => (res.statusCode === 200 ? ok(text) : fail(new Error(`${res.statusCode} ${text}`))))
      }).on("error", fail).end()
    })
    const answer = JSON.parse(body) as { source: string; items: { question: string }[] }
    assert.equal(answer.source, "google-trends")
    assert.equal(answer.items[0].question, "What does the latest science say about measles outbreak?")
  } finally { server.close() }
})
