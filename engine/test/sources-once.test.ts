// database_search inside a board run: the per-run cap and the refusals, the replay after a crash, the practice run, and
// what is kept on every source in the saved record (which search found it, and with which query).
// No test here reaches the network: globalThis.fetch throws, and every lookup is a fake.
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

process.env.NO_PAID_CALLS = "1"
const outbound: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.startsWith("http://127.0.0.1:")) return realFetch(input, init)
  outbound.push(url)
  throw new Error(`a test tried to reach ${url}`)
}) as typeof fetch

const { foundBy, loadState, poolEvidence, replyPhases, runBoard, searches, startRun, summarize } = await import("../src/board/board.ts")
const { instructionsFor, loadAgent, loadRoster } = await import("../src/board/agents.ts")
const { loadBrief } = await import("../src/brief.ts")
const { buildCatalog } = await import("../src/chat/catalog.ts")
const { loadConfig } = await import("../src/config.ts")
const { EventLog, SEARCH_PROVIDERS } = await import("../src/events.ts")
const { MOCK_EVIDENCE } = await import("../src/mock.ts")
const { runPreflight } = await import("../src/paid/preflight.ts")
const { databaseOnce, DATABASE_GUIDANCE, DEFAULT_MAX_DATABASE_SEARCHES, fixtureRecords, QUERY_DESCRIPTION, ServiceError, SOURCES } = await import("../src/sources/index.ts")
import type { BoardConfig } from "../src/config.ts"
import type { EvidenceItem, SearchProvider } from "../src/events.ts"
import type { DatabaseDeps } from "../src/sources/index.ts"
import type { DatabaseSource, SourceResult } from "../src/sources/shared.ts"

const BRIEF = join(import.meta.dirname, "../../board/briefs/kras-g12c-hit-to-lead.md")
const tempConfig = (): BoardConfig => {
  const base = loadConfig(), dir = mkdtempSync(join(tmpdir(), "sources-once-"))
  return { ...base, paths: { ...base.paths, runs: join(dir, "runs"), expertise: join(dir, "expertise") } }
}
const record = (n: number): EvidenceItem => ({ url: `https://clinicaltrials.gov/study/NCT0000000${n}`, title: `Trial ${n}`, text: `ClinicalTrials.gov record NCT0000000${n}. Enrollment: ${n}0 (ACTUAL).` })

function deps(over: Partial<DatabaseDeps> = {}) {
  const calls: { source: DatabaseSource; query: string }[] = []
  const d: DatabaseDeps = {
    state: {}, mock: false, maxSearches: 2,
    search: async (source, query) => { calls.push({ source, query }); return { items: [record(calls.length)], notices: ["a note"] } },
    capReached: async () => false, paidOff: () => false, ...over,
  }
  return { d, calls }
}

test("a replayed tool call reads its stored result: no second request, and it is not counted twice", async () => {
  const { d, calls } = deps()
  const first = await databaseOnce(d, "call-1", "clinicaltrials", "  KRAS\u0000 G12C  ")
  const again = await databaseOnce(d, "call-1", "clinicaltrials", "KRAS G12C")
  assert.deepEqual(calls, [{ source: "clinicaltrials", query: "KRAS G12C" }], "one lookup, with the query as plain text")
  assert.deepEqual(again.result, first.result)
  assert.deepEqual(d.state.databases, { "call-1": { source: "clinicaltrials", query: "KRAS G12C", items: [record(1)], notices: ["a note"] } })
  // A replay is answered from the store also when the run could no longer look anything up.
  const { d: later, calls: none } = deps({ state: d.state, maxSearches: 0, capReached: async () => true, paidOff: () => true, search: async () => { throw new Error("must not be called") } })
  assert.deepEqual((await databaseOnce(later, "call-1", "clinicaltrials", "KRAS G12C")).result, first.result)
  assert.equal(none.length, 0)
})

test("refused past the per-run cap, at the spend cap and with paid calls switched off; a refusal looks nothing up and gives no example sources", async () => {
  assert.equal(DEFAULT_MAX_DATABASE_SEARCHES, 20)
  assert.equal(loadConfig().meeting.max_database_searches, 20, "board/config.yaml sets the cap")
  let spendRead = 0
  const { d, calls } = deps({ capReached: async () => { spendRead++; return false } })
  await databaseOnce(d, "a", "chembl", "sotorasib"); await databaseOnce(d, "b", "uniprot", "KRAS")
  assert.equal(spendRead, 2)
  const third = await databaseOnce(d, "c", "pubchem", "aspirin")
  assert.equal(spendRead, 2, "past the count the run's spend is not even read")
  assert.match(third.refused ?? "", /^Database lookup budget used up: 2 of 2 for this run\. Work from what you have and say so\.$/)
  assert.equal(third.result, undefined)
  assert.equal(third.failed, undefined, "a cap refusal is a constraint the run records")
  assert.equal(calls.length, 2)
  const capped = deps({ capReached: async () => true })
  assert.match((await databaseOnce(capped.d, "a", "chembl", "x")).refused ?? "", /^Spend cap reached: database records can no longer be screened\./)
  const off = deps({ paidOff: () => true })
  assert.match((await databaseOnce(off.d, "a", "chembl", "x")).refused ?? "", /^Paid calls were switched off: database records can no longer be screened\./)
  assert.equal(capped.calls.length + off.calls.length, 0)
  assert.equal(capped.d.state.databases, undefined)
})

test("lookups made at the same moment cannot pass a cap that has room for fewer", async () => {
  let release!: () => void
  const gate = new Promise<void>((ok) => { release = ok })
  const { d, calls } = deps({ maxSearches: 2, search: async (source, query) => { calls.push({ source, query }); await gate; return { items: [record(calls.length)], notices: [] } } })
  const all = Promise.all(["a", "b", "c", "d"].map((id) => databaseOnce(d, id, "chembl", `q ${id}`)))
  await new Promise((ok) => setTimeout(ok, 5))
  release()
  const out = await all
  assert.equal(calls.length, 2)
  assert.equal(out.filter((o) => o.result).length, 2)
  assert.equal(out.filter((o) => /budget used up/.test(o.refused ?? "")).length, 2)
  assert.equal(Object.keys(d.state.databases ?? {}).length, 2)
})

test("a service that is down does not stop the run: the member is told, and the call is neither stored nor counted", async () => {
  const { d } = deps({ maxSearches: 1, search: async () => { throw new ServiceError("ChEMBL answered 503") } })
  const out = await databaseOnce(d, "a", "chembl", "sotorasib")
  assert.equal(out.refused, "ChEMBL could not be read (ChEMBL answered 503). Try another database or search, or work from what you have and say so. This call was not counted.")
  assert.equal(out.failed, true)
  assert.equal(d.state.databases, undefined)
  // An error that is not the service's (a bug) is reported the same way, without its text.
  const bug = deps({ search: async () => { throw new TypeError("Cannot read properties of undefined (reading 'secret')") } })
  assert.equal((await databaseOnce(bug.d, "a", "uniprot", "KRAS")).refused, "UniProt could not be read (the lookup failed). Try another database or search, or work from what you have and say so. This call was not counted.")
  // The cap still has room after a failure.
  const { d: ok, calls } = deps({ state: d.state, maxSearches: 1 })
  assert.ok((await databaseOnce(ok, "b", "chembl", "sotorasib")).result)
  assert.equal(calls.length, 1)
})

test("an unknown database or an unusable query is refused without a request and without using the cap", async () => {
  const { d, calls } = deps({ maxSearches: 1 })
  for (const source of ["drugbank", "", "CHEMBL", "chembl; rm -rf", null, 7, { toString: () => "chembl" }]) {
    const out = await databaseOnce(d, "a", source, "x")
    assert.match(out.refused ?? "", /^Unknown database ".*"\. Use one of: chembl, clinicaltrials, openfda, opentargets, uniprot, pubchem\. Nothing was looked up, and this call was not counted\.$/)
    assert.equal(out.failed, true)
  }
  for (const query of ["", "   ", "\u0000", "x".repeat(201), 5, null, ["KRAS"]]) assert.match((await databaseOnce(d, "a", "chembl", query)).refused ?? "", /^Write a query of 1 to 200 characters\./)
  assert.equal(calls.length, 0)
  assert.equal(d.state.databases, undefined)
  assert.ok((await databaseOnce(d, "a", "chembl", "x")).result, "the cap of one is still unused")
  assert.deepEqual([...SOURCES], ["chembl", "clinicaltrials", "openfda", "opentargets", "uniprot", "pubchem"])
})

test("at most eight items are kept from one lookup", async () => {
  const { d } = deps({ search: async () => ({ items: Array.from({ length: 12 }, (_, i) => record(i)), notices: [] }) })
  assert.equal((await databaseOnce(d, "a", "chembl", "x")).result?.items.length, 8)
  assert.equal(d.state.databases?.a.items.length, 8)
})

test("a practice run gets the example sources: no client is called, nothing is stored or counted", async () => {
  const { d, calls } = deps({ mock: true, maxSearches: 0, capReached: async () => true, paidOff: () => true, search: async () => { throw new Error("a practice run must not look anything up") } })
  const out = await databaseOnce(d, "a", "chembl", "sotorasib")
  assert.deepEqual(out.result, fixtureRecords())
  assert.deepEqual(out.result?.items.map((i) => i.url), MOCK_EVIDENCE.slice(0, 5).map((i) => i.url))
  assert.ok(out.result?.items.every((i) => i.url.startsWith("https://example.org/mock/")))
  assert.equal(calls.length, 0)
  assert.equal(d.state.databases, undefined)
})

// ── The evidence pool: which search found a source, and with which query ─────────────────────────

function pool(triage?: (items: EvidenceItem[]) => { keep: boolean; item: EvidenceItem }[]) {
  const state: { evidence: Record<string, EvidenceItem>; droppedKeys?: string[] } = { evidence: {} }
  const events: any[] = []
  let saved = 0
  const screened: string[][] = []
  const d = { state, save: () => { saved++ }, emit: (key: string, event: unknown) => { events.push({ key, ...(event as object) }) },
    triage: async (items: EvidenceItem[]) => { screened.push(items.map((i) => i.url)); return triage ? triage(items) : items.map((item) => ({ keep: true, item: { ...item, studyType: "clinical", relevance: 1 } })) } }
  return { d, state, events, screened, saved: () => saved }
}
const found = (provider: SearchProvider, query: string, over = {}) => ({ provider, member: "scout", callId: `call-${provider}`, query, keyQuestion: "Is either candidate differentiated?", ...over })
const result = (...urls: string[]): SourceResult => ({ items: urls.map((url) => ({ url, title: `Title of ${url}`, text: "Some text with 12 nM." })), notices: ["a note for the reader"] })

test("every source keeps the search that found it and the query, for all three search tools, in the pool and in the event", async () => {
  // The label each tool puts on what it found.
  assert.equal(foundBy("exa_search", false), "exa")
  assert.equal(foundBy("literature_search", false), "europepmc")
  for (const source of SOURCES) assert.equal(foundBy("database_search", false, source), source)
  for (const tool of ["exa_search", "literature_search", "database_search"] as const) assert.equal(foundBy(tool, true, "chembl"), "fixture", "a practice run's sources are example sources, whichever tool")
  assert.deepEqual([...SEARCH_PROVIDERS], ["exa", "europepmc", ...SOURCES, "fixture"])

  const { d, state, events } = pool()
  await poolEvidence(d, result("https://a.example/web"), found("exa", "KRAS G12C inhibitor hERG liability"))
  await poolEvidence(d, result("https://pubmed.ncbi.nlm.nih.gov/1/"), found("europepmc", "KRAS G12C hERG"))
  const told = await poolEvidence(d, result("https://clinicaltrials.gov/study/NCT04303780"), found("clinicaltrials", "sotorasib KRAS G12C", { records: true }))
  assert.deepEqual(Object.values(state.evidence).map((i) => [i.url, i.provider, i.query]), [
    ["https://a.example/web", "exa", "KRAS G12C inhibitor hERG liability"],
    ["https://pubmed.ncbi.nlm.nih.gov/1/", "europepmc", "KRAS G12C hERG"],
    ["https://clinicaltrials.gov/study/NCT04303780", "clinicaltrials", "sotorasib KRAS G12C"],
  ])
  assert.deepEqual(events.map((e) => [e.key, e.type, e.member, e.provider, e.query, e.kept, e.dropped, e.items.map((i: EvidenceItem) => [i.provider, i.query])]), [
    ["evidence:call-exa", "evidence.triaged", "scout", "exa", "KRAS G12C inhibitor hERG liability", 1, 0, [["exa", "KRAS G12C inhibitor hERG liability"]]],
    ["evidence:call-europepmc", "evidence.triaged", "scout", "europepmc", "KRAS G12C hERG", 1, 0, [["europepmc", "KRAS G12C hERG"]]],
    ["evidence:call-clinicaltrials", "evidence.triaged", "scout", "clinicaltrials", "sotorasib KRAS G12C", 1, 0, [["clinicaltrials", "sotorasib KRAS G12C"]]],
  ])
  assert.equal(told.output[0].text, "- Title of https://clinicaltrials.gov/study/NCT04303780 [clinical] https://clinicaltrials.gov/study/NCT04303780\n  Some text with 12 nM.\n\nNote from the search engine: a note for the reader")
  // The pool survives being saved and read: the labels are plain fields of the saved record.
  const saved = JSON.parse(JSON.stringify(state)) as typeof state
  assert.ok(Object.values(saved.evidence).every((i) => typeof i.provider === "string" && typeof i.query === "string"))
})

test("a source found again by a later search keeps its first finder, and is not screened a second time", async () => {
  const { d, state, events, screened } = pool()
  await poolEvidence(d, result("https://a.example/1", "https://a.example/2"), found("exa", "first query"))
  await poolEvidence(d, result("https://a.example/2", "https://a.example/3"), found("europepmc", "second query"))
  assert.deepEqual(screened, [["https://a.example/1", "https://a.example/2"], ["https://a.example/3"]])
  assert.deepEqual([state.evidence["https://a.example/2"].provider, state.evidence["https://a.example/2"].query], ["exa", "first query"])
  assert.deepEqual([state.evidence["https://a.example/3"].provider, state.evidence["https://a.example/3"].query], ["europepmc", "second query"])
  assert.deepEqual(events[1].items.map((i: EvidenceItem) => [i.url, i.provider]), [["https://a.example/2", "exa"], ["https://a.example/3", "europepmc"]], "the second search's event lists what it returned, each with its own finder")
})

test("screening: a paper with no results of its own is dropped; a database record is kept unless it is off-topic", async () => {
  // What the first pass says about three items: on-topic with results; on-topic with no results of its own; off-topic.
  const screen = (items: EvidenceItem[]) => items.map((item, i) => ({ keep: i === 0, item: { ...item, relevance: [1, 0.5, 0][i] } }))
  const papers = pool(screen)
  await poolEvidence(papers.d, result("https://x.example/1", "https://x.example/2", "https://x.example/3"), found("europepmc", "q"))
  assert.deepEqual(Object.keys(papers.state.evidence), ["https://x.example/1"])
  assert.equal(papers.state.droppedKeys?.length, 2)
  const records = pool(screen)
  await poolEvidence(records.d, result("https://x.example/1", "https://x.example/2", "https://x.example/3"), found("clinicaltrials", "q", { records: true }))
  assert.deepEqual(Object.keys(records.state.evidence), ["https://x.example/1", "https://x.example/2"], "the trial record with no results of its own stays; the off-topic one goes")
  assert.equal(records.events[0].dropped, 1)
  // Nothing kept: the member is told so, and still gets the notes.
  const none = pool((items) => items.map((item) => ({ keep: false, item: { ...item, relevance: 0 } })))
  const told = await poolEvidence(none.d, result("https://x.example/1"), found("chembl", "q", { records: true }))
  assert.equal(told.output[0].text, "Nothing relevant found. Say so in your reply.\n\nNote from the search engine: a note for the reader")
  // A record whose screening is missing (the checker's reply could not be read) is kept, as for every search.
  const unread = pool((items) => items.map((item) => ({ keep: true, item })))
  await poolEvidence(unread.d, result("https://x.example/1"), found("chembl", "q", { records: true }))
  assert.equal(Object.keys(unread.state.evidence).length, 1)
})

// ── In a board run ───────────────────────────────────────────────────────────────────────────────

test("the scout holds the tool, is told how to use it, and replies first; a member with only this tool also replies first", () => {
  const config = loadConfig(), roster = loadRoster(config)
  const scout = roster.find((a) => a.name === "scout")
  assert.deepEqual(scout?.tools, ["exa_search", "literature_search", "database_search"])
  const brief = loadBrief(BRIEF, config.brief.required_sections)
  const text = instructionsFor(config, scout!, brief, roster)
  assert.ok(text.includes(DATABASE_GUIDANCE))
  assert.ok(text.indexOf("# Searching the literature") < text.indexOf("# Looking up database records"), "after the literature guidance")
  assert.match(text, /3\. Then `database_search` for records: trials, bioactivity, drug labels, targets\./)
  for (const source of SOURCES) { assert.ok(DATABASE_GUIDANCE.includes(`\`${source}\``), source); assert.ok(QUERY_DESCRIPTION.includes(`${source}:`), source) }
  assert.match(DATABASE_GUIDANCE, /records, not papers/); assert.match(DATABASE_GUIDANCE, /Cite a record by its exact URL/); assert.match(DATABASE_GUIDANCE, /Do not convert or round/)
  assert.ok(!instructionsFor(config, loadAgent(config, "critic"), brief, roster).includes("database_search"))
  const only = { ...scout!, name: "registry", tools: ["database_search"] }
  assert.equal(searches(only), true)
  assert.equal(searches({ tools: ["converse"] }), false)
  assert.deepEqual(replyPhases([roster[1], only]).map((p) => p.map((a) => a.name)), [["registry"], [roster[1].name]])
})

test("a practice run: the scout searches the web first, then the literature, then a database; no network; every saved source says what found it", async () => {
  const config = tempConfig()
  const id = await startRun(BRIEF, { config, mock: true })
  await runBoard(id, undefined, { config, mock: true })
  assert.deepEqual(outbound, [], "a practice run reaches no network")
  const dir = join(config.paths.runs, id)
  const events = EventLog.read(join(dir, "events.jsonl"))
  const evidence = events.filter((e) => e.type === "evidence.triaged") as unknown as { member: string; query: string; provider: string; items: EvidenceItem[] }[]
  assert.deepEqual(evidence.map((e) => [e.member, e.provider, e.query]), [
    ["scout", "fixture", "KRAS G12C Scout (Data and Evidence) evidence"],
    ["scout", "fixture", "KRAS G12C covalent inhibitor resistance"],
    ["scout", "fixture", "KRAS G12C non-small cell lung cancer"],
    ["evidence-verifier", "fixture", "KRAS G12C covalent inhibitor resistance"],
    ["evidence-verifier", "fixture", "KRAS G12C non-small cell lung cancer"],
  ], "the scout's three searches, in the board's order, then the evidence verifier's two free ones, each labelled as example sources")
  assert.ok(events.findIndex((e) => e.type === "evidence.triaged") < events.findIndex((e) => e.type === "member.replied"), "the searches come before any reply")
  // The saved record: run.json's pool, and every event's items.
  const state = loadState(config, id)
  const pooled = Object.values(state.evidence)
  assert.equal(pooled.length, 3)
  for (const item of [...pooled, ...evidence.flatMap((e) => e.items)]) {
    assert.equal(item.provider, "fixture")
    assert.equal(item.query, "KRAS G12C Scout (Data and Evidence) evidence", "the web search found them first")
  }
  const onDisk = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as { evidence: Record<string, EvidenceItem>; databases?: unknown; literature?: unknown; searched?: unknown }
  assert.ok(Object.values(onDisk.evidence).every((i) => i.provider === "fixture" && typeof i.query === "string" && i.query.length > 0))
  assert.deepEqual([onDisk.databases, onDisk.literature, onDisk.searched], [undefined, undefined, undefined], "a practice run counts and stores no search")
  assert.deepEqual(summarize(dir, state).search, { searches: 5, provider: "fixture" })
  assert.equal(state.usd, 0)
})

test("the three search tools are wired the same way: each puts its results into the pool with its own label and the member's query", () => {
  const board = readFileSync(join(import.meta.dirname, "../src/board/board.ts"), "utf8")
  const calls = [...board.matchAll(/return intoPool\(out\.result as SearchResult, foundBy\("(\w+)", mock(, args\.source)?\), memberOf\(api\), api\.callId, args\.query, args\.key_question(, true)?\)/g)].map((m) => [m[1], Boolean(m[2]), Boolean(m[3])])
  assert.deepEqual(calls, [["exa_search", false, false], ["literature_search", false, false], ["database_search", true, true]])
  assert.equal(board.match(/intoPool\(/g)?.length, 3, "no search result reaches a member by another way")
  assert.match(board, /tools: \[exaTool, literatureTool, databaseTool, converseTool, memoTool\]/)
  assert.match(board, /tools: \[exaTool, literatureTool, databaseTool\]\.filter\(\(t\) => agent\.tools\.includes\(t\.name\)\)/)
})

test("the catalog and the preflight list the databases as free, with no key, and never call them", async () => {
  const config = loadConfig()
  assert.deepEqual(buildCatalog(config, {}).search.databases, { providers: ["chembl", "clinicaltrials", "openfda", "opentargets", "uniprot", "pubchem"], free: true, keyNeeded: false, available: true })
  assert.equal(buildCatalog({ ...config, board: config.board.filter((n) => n !== "scout" && n !== "evidence-verifier") }, {}).search.databases.available, false)
  const lines: string[] = [], asked: string[] = []
  await runPreflight({ env: { ANTHROPIC_API_KEY: "fake-a", OPENAI_API_KEY: "fake-o", EXA_API_KEY: "fake-e" }, config, log: (line) => { lines.push(line) },
    fetch: (async (url: string) => { asked.push(String(url)); return new Response(JSON.stringify({ data: [] })) }) as unknown as typeof fetch })
  assert.ok(lines.includes("- Database lookups (ChEMBL, ClinicalTrials.gov, openFDA, Open Targets, UniProt, PubChem): free, no key (not called)"), lines.join("\n"))
  assert.ok(asked.every((url) => /^https:\/\/api\.(anthropic|openai)\.com\/v1\/models/.test(url)), "only the two model-list requests")
  assert.deepEqual(outbound, [])
})
