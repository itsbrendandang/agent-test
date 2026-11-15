// Lab protocols in a research answer: a question that asks for a protocol, an SOP or how to do a lab method also
// searches the published lab protocols (search/protocols.ts), and what it finds is listed and cited as a protocol.
// Fakes only (test/fixtures/research/harness.ts): fake models, a fake fetch, fake keys. Nothing reaches the network.
import assert from "node:assert/strict"
import { test } from "node:test"

process.env.NO_PAID_CALLS = "1"
const { engine, jsonResponse, paidAllowed } = await import("./fixtures/research/harness.ts")
const { fallbackPlan, MAX_PROTOCOL_QUERIES, readPlan, shortPath, withProtocols } = await import("../src/research/pipeline.ts")
const { looksProtocol } = await import("../src/research/text.ts")
const { plannerSystem } = await import("../src/research/prompts.ts")
const { DEFAULTS: LIMITS } = await import("../src/research/types.ts")
import type { Stamped } from "../src/research/types.ts"

const Q = "What is the standard protocol for isolating primary hepatocytes from mouse liver?"
const of = <T extends Stamped["type"]>(events: Stamped[], type: T) => events.filter((e) => e.type === type) as Extract<Stamped, { type: T }>[]
const PLAN = (protocols?: string[]) => JSON.stringify({
  key_question: "How are primary hepatocytes isolated from mouse liver?", medical: false, simple: false, researchable: true,
  opening: "I'll search the web, PubMed and published lab protocols for ways to isolate mouse hepatocytes, screen what comes back, and check each statement against its source.",
  web: [{ query: "how to isolate primary hepatocytes from mouse liver, step by step protocol", objective: "Protocols and methods papers first." }],
  literature: ["primary mouse hepatocyte isolation collagenase perfusion"],
  ...(protocols ? { protocols } : {}),
})
const PROTOCOL_ABSTRACT = "Primary hepatocytes are isolated from mouse liver by two-step collagenase perfusion through the portal vein, giving 20 to 30 million viable cells per liver."
const BIOPROTOCOL = { resultList: { result: [
  { id: "38000001", source: "MED", pmid: "38000001", doi: "10.21769/BioProtoc.4000", title: "Isolation of Primary Mouse Hepatocytes by Two-step Perfusion.", pubYear: "2023", abstractText: PROTOCOL_ABSTRACT, journalInfo: { journal: { title: "Bio-protocol" } } },
] } }
const PIO = { message: { items: [
  { DOI: "10.17504/protocols.io.hep1", title: ["Mouse hepatocyte isolation v1"], abstract: "<jats:p>Perfuse the mouse liver with collagenase buffer at 37 C for 10 minutes before the hepatocytes are released.</jats:p>", published: { "date-parts": [[2022]] } },
] } }
const PAGES = [{ url: "https://www.example-lab.org/hepatocytes", title: "Hepatocyte isolation guide", highlights: ["Mouse hepatocytes are usually isolated by perfusing the liver with collagenase."] }]
/** A screener that keeps what is on hepatocytes, and says a protocol reports no results of its own (it does not). */
const screen = (call: { user: string }) => JSON.stringify({ items: [...call.user.matchAll(/<passage i="(\d+)">\n([\s\S]*?)\n<\/passage>/g)].map((p) => {
  const on = /hepatocyte/i.test(p[2])
  return { i: Number(p[1]), answers_question: on ? "yes" : "no", reports_results: "no", study_type: "unclear" }
}) })
/** Europe PMC: the protocol journals' search finds the Bio-protocol paper; the general literature search finds nothing. */
const pmc = (query: string) => jsonResponse(query.includes('JOURNAL:"Bio-protocol"') ? BIOPROTOCOL : { resultList: { result: [] } })

/** A request of the protocol search to protocols.io: the literature search also calls the Crossref host, without this filter. */
const isProtocolsIo = (url: string) => url.startsWith("https://api.crossref.org/") && new URL(url).searchParams.get("filter") === "prefix:10.17504"

test("a question that asks for a protocol searches the published lab protocols; they are kept, numbered, labelled and cited like papers", async () => {
  const e = await engine({ script: { plan: () => PLAN(["primary mouse hepatocyte isolation"]), screen } })
  e.net.exa = [() => jsonResponse({ results: PAGES, costDollars: { total: 0.005 } })]
  e.net.europepmc = pmc
  e.net.crossref = () => jsonResponse(PIO)
  try {
    const { record, events } = await paidAllowed(() => e.answer({ question: Q, effort: "quick" }))
    assert.equal(record.status, "done")
    // The planner is told it may plan protocol searches, and for which questions.
    assert.match(e.calls.find((c) => c.role === "plan")!.system, /"protocols": 0 to \d+ queries for a search of published lab protocols and SOPs/)
    // One protocol search ran, after the first web search, and asked each protocol source for protocols only.
    const started = of(events, "step.started").map((s) => s.step)
    assert.ok(started.includes("search:protocols:1"))
    assert.ok(started.indexOf("search:exa:1") < started.indexOf("search:protocols:1"))
    assert.match(of(events, "step.started").find((s) => s.step === "search:protocols:1")!.label, /lab protocols/)
    const line = record.searches.find((s) => s.provider === "protocols")!
    assert.deepEqual([line.query, line.ran, line.found, line.kept], ["primary mouse hepatocyte isolation", true, 2, 2])
    assert.ok(e.net.requests.some((r) => r.url.startsWith("https://api.crossref.org/works?") && new URL(r.url).searchParams.get("filter") === "prefix:10.17504"))
    assert.ok(e.net.requests.some((r) => r.url.startsWith("https://api.openalex.org/works?") && (new URL(r.url).searchParams.get("filter") ?? "").startsWith("primary_location.source.issn:")))
    // A protocol reports no findings of its own; it is kept anyway, as a database record is, because it is on the question.
    const protocols = record.sources.filter((s) => s.provider === "protocols")
    assert.deepEqual(protocols.map((s) => s.url).sort(), ["https://doi.org/10.17504/protocols.io.hep1", "https://pubmed.ncbi.nlm.nih.gov/38000001/"])
    for (const s of protocols) assert.equal(s.note, "protocol")
    assert.deepEqual(protocols.map((s) => s.published).sort(), ["2022", "2023"])
    // Cited like a paper: the writer is given them as numbered sources, and a sentence copied from one passes its check.
    const write = e.calls.find((c) => c.role === "write")!
    assert.ok(write.user.includes(PROTOCOL_ABSTRACT))
    assert.ok(record.statements.some((s) => s.verdict === "verified" && s.sources.some((n) => protocols.some((p) => p.n === n))))
    // The selection says what a protocol is and what was read of it.
    for (const s of protocols) assert.match(record.selection!.selected.find((x) => x.n === s.n)!.limitation!, /A protocol: it describes a method, not findings\. Only the abstract of the protocol was read, not its steps\./)
    // And the saved answer and sources list say it too.
    const csv = (await e.get<string>(`/api/research/${record.id}/artifacts/sources.csv`)).body
    assert.match(csv, /"https:\/\/doi\.org\/10\.17504\/protocols\.io\.hep1","protocols","protocol"/)
    const md = (await e.get<string>(`/api/research/${record.id}/artifacts/answer.md`)).body
    assert.match(md, /Mouse hepatocyte isolation v1 \(protocols\.io, 2022\) \[protocol\]/)
  } finally { await e.close() }
})

test("when the planner writes no protocol query, none runs, even for an SOP question; only an unreadable planner reply lets code add one", async () => {
  const sop = "Is there an SOP for mouse hepatocyte isolation?"
  const planned = await engine({ script: { plan: () => PLAN(), screen } })
  planned.net.exa = [() => jsonResponse({ results: PAGES, costDollars: { total: 0.005 } })]
  planned.net.europepmc = pmc
  try {
    const { record } = await paidAllowed(() => planned.answer({ question: sop, effort: "standard" }))
    assert.equal(record.status, "done")
    assert.ok(!record.searches.some((s) => s.provider === "protocols"))
  } finally { await planned.close() }
  const unread = await engine({ script: { plan: () => "not a plan", screen } })
  unread.net.exa = [() => jsonResponse({ results: PAGES, costDollars: { total: 0.005 } })]
  unread.net.europepmc = pmc
  try {
    const { record } = await paidAllowed(() => unread.answer({ question: sop, effort: "standard" }))
    assert.equal(record.status, "done")
    assert.ok(record.searches.some((s) => s.provider === "protocols"))
    assert.ok(record.sources.some((s) => s.provider === "protocols" && s.note === "protocol"))
  } finally { await unread.close() }
})

for (const question of ["What is the Kyoto Protocol?", "What is the TCP protocol?"]) {
  test(`"${question}" searches no protocol and keeps the short path`, async () => {
    const simple = JSON.stringify({ key_question: question, medical: false, simple: true, researchable: true, web: [{ query: question, objective: "Encyclopedia pages first." }], literature: [question.replace(/[?]/g, "")], protocols: [] })
    const e = await engine({ script: { plan: () => simple, screen: (call: { user: string }) => JSON.stringify({ items: [...call.user.matchAll(/<passage i="(\d+)">/g)].map((p) => ({ i: Number(p[1]), answers_question: "yes", reports_results: "yes", study_type: "review" })) }) } })
    e.net.exa = [() => jsonResponse({ results: [{ url: "https://www.example-encyclopedia.org/p", title: question, highlights: [`${question.replace(/^What is the |\?$/g, "")} is a well known agreement or standard.`] }], costDollars: { total: 0.005 } })]
    try {
      const { record, events } = await paidAllowed(() => e.answer({ question, effort: "standard" }))
      assert.equal(record.status, "done")
      assert.equal(record.short, true)
      assert.ok(!record.searches.some((s) => s.provider === "protocols"))
      assert.ok(!of(events, "step.started").some((s) => s.step.startsWith("search:protocols")))
    } finally { await e.close() }
  })
}

test("with hypotheses, the protocol search still runs beside their searches, and its protocols are numbered after theirs", async () => {
  const hypotheses = [
    { text: "Two-step collagenase perfusion gives more viable mouse hepatocytes than tissue digestion.", supportIf: "A protocol reports a higher yield with perfusion.", contradictIf: "A protocol reports a lower yield with perfusion.", web: { query: "hepatocyte yield perfusion", objective: "Protocols first." }, literature: "hepatocyte perfusion yield" },
    { text: "Mouse hepatocytes stay viable in culture for a week.", supportIf: "A protocol keeps them for seven days.", contradictIf: "A protocol loses them within days.", web: { query: "hepatocyte culture days", objective: "Protocols first." }, literature: "hepatocyte culture viability" },
  ]
  const e = await engine({ script: { plan: () => PLAN(["primary mouse hepatocyte isolation"]), screen, hypothesize: () => JSON.stringify({ needed: true, hypotheses }) } })
  e.net.exa = [() => jsonResponse({ results: PAGES, costDollars: { total: 0.005 } })]
  e.net.europepmc = pmc
  e.net.crossref = () => jsonResponse(PIO)
  try {
    const { record, events } = await paidAllowed(() => e.answer({ question: Q, effort: "standard" }))
    assert.equal(record.status, "done")
    assert.equal(record.hypotheses?.length, 2)
    assert.match(of(events, "step.finished").find((s) => s.step === "hypotheses")!.summary!, /except the lab protocol searches/)
    assert.equal(record.searches.filter((s) => s.provider === "protocols").length, 1)
    assert.ok(!record.searches.find((s) => s.provider === "protocols")!.hypothesis)
    assert.ok(record.sources.some((s) => s.provider === "protocols" && s.note === "protocol" && !s.hypotheses))
  } finally { await e.close() }
})

test("a question that is not about a lab method searches no protocol", async () => {
  const e = await engine()
  try {
    const { record, events } = await paidAllowed(() => e.answer({ question: "Does semaglutide lower the risk of heart attack and stroke in people with obesity who do not have diabetes?", effort: "quick" }))
    assert.equal(record.status, "done")
    assert.ok(!record.searches.some((s) => s.provider === "protocols"))
    assert.ok(!of(events, "step.started").some((s) => s.step.startsWith("search:protocols")))
    assert.ok(!e.net.requests.some((r) => isProtocolsIo(r.url) || (r.url.includes("europepmc") && r.url.includes("JOURNAL"))))
  } finally { await e.close() }
})

test("when every protocol source is down, the search is said not to have run and the answer goes on", async () => {
  const e = await engine({ script: { plan: () => PLAN(["primary mouse hepatocyte isolation"]), screen } })
  e.net.exa = [() => jsonResponse({ results: PAGES, costDollars: { total: 0.005 } })]
  e.net.europepmc = (query) => (query.includes("JOURNAL:") ? jsonResponse({}, 503) : jsonResponse(BIOPROTOCOL))
  e.net.openalex = () => jsonResponse({}, 500)
  e.net.crossref = () => jsonResponse({}, 500)
  try {
    const { record, events } = await paidAllowed(() => e.answer({ question: Q, effort: "quick" }))
    assert.equal(record.status, "done")
    const line = record.searches.find((s) => s.provider === "protocols")!
    assert.equal(line.ran, false)
    assert.match(line.reason!, /no protocol source could be used/)
    assert.equal(of(events, "step.finished").find((s) => s.step === "search:protocols:1")!.consequence, "The published lab protocols were not searched, so this answer rests on the other searches only.")
    assert.ok(record.missing?.some((m) => /no protocol source could be used/.test(m)))
    assert.ok(!record.sources.some((s) => s.provider === "protocols"))
  } finally { await e.close() }
})

test("a protocol search is stored like every outside step: after a restart it is not made again", async () => {
  let live = true
  const e = await engine({ script: { plan: () => PLAN(["primary mouse hepatocyte isolation"]), screen }, onStored: (key) => { if (live && /:search:protocols:/.test(key)) { live = false; return "stop" } } })
  e.net.exa = [() => jsonResponse({ results: PAGES, costDollars: { total: 0.005 } })]
  e.net.europepmc = pmc
  e.net.crossref = () => jsonResponse(PIO)
  const crossref = () => e.net.requests.filter((r) => isProtocolsIo(r.url)).length
  try {
    await paidAllowed(async () => {
      const id = (await e.ask({ question: Q, effort: "quick" })).body.id
      await e.research.idle()
      assert.equal(crossref(), 1)
      assert.deepEqual(e.research.resume(), [id])
      await e.research.idle()
      const record = await e.record(id)
      assert.equal(record.status, "done")
      assert.equal(crossref(), 1, "the stored protocol search is read back, not made again")
      assert.ok(record.sources.some((s) => s.provider === "protocols"))
    })
  } finally { await e.close() }
})

test("which questions ask for a lab protocol", () => {
  for (const q of ["What is the protocol for western blot transfer?", "Is there an SOP for cryopreserving PBMCs?", "Standard operating procedure for autoclave validation", "How do I extract RNA from mouse liver with TRIzol?", "How can we isolate primary hepatocytes?", "How to stain organoids for confocal microscopy?", "Step-by-step CRISPR knockout in HEK293 cells"]) assert.ok(looksProtocol(q), q)
  for (const q of ["What is the powerhouse of the cell?", "Does semaglutide lower cardiovascular risk?", "How do I lower my blood pressure?", "How can I prepare for an exam?", "Why do cells divide?", "What is the Kyoto Protocol?", "What is the TCP protocol?", "How do I get rid of mice in my house?", "What is the best way to label my files?"]) assert.ok(!looksProtocol(q), q)
})

test("the plan's protocol queries: read from the planner, cut to the limit, added by code only when the planner's reply could not be read, never on the short path", () => {
  const level = LIMITS.levels.quick
  const read = readPlan(JSON.stringify({ web: [{ query: "hepatocyte isolation" }], literature: ["hepatocyte isolation"], protocols: ["hepatocyte isolation \"mouse\"", "x", "collagenase (perfusion) AND liver", "third one here"] }), Q, level)
  assert.deepEqual(read.protocols, ["hepatocyte isolation mouse", "collagenase perfusion liver"].slice(0, MAX_PROTOCOL_QUERIES))
  assert.deepEqual(withProtocols(read, Q, { queries: 1 }).protocols, ["hepatocyte isolation mouse"], "no more protocol queries than the level's literature query limit")
  // The planner wrote none: none run, even for a protocol question. The planner decides.
  const none = { ...read, protocols: [] }
  assert.deepEqual(withProtocols(none, Q, level).protocols, [])
  // The fallback plan (the planner's reply could not be read): code searches protocols for a protocol question only.
  assert.deepEqual(withProtocols(fallbackPlan(Q), Q, level).protocols.length, 1)
  assert.deepEqual(withProtocols(fallbackPlan("What is the Kyoto Protocol?"), "What is the Kyoto Protocol?", level).protocols, [])
  // A question with protocol searches never takes the short path.
  assert.equal(shortPath({ ...read, simple: true }, false), false)
  assert.equal(shortPath({ ...read, protocols: [], simple: true }, false), true)
  // The planner hears of protocols only when the answer can search them.
  assert.ok(!plannerSystem({ web: 1, literature: 2, databases: 0 }).includes("protocols"))
  assert.match(plannerSystem({ web: 1, literature: 2, databases: 2, protocols: 2 }), /3\. "protocols"[\s\S]*4\. "databases"/)
  assert.match(plannerSystem({ web: 1, literature: 2, databases: 2 }), /3\. "databases"/)
})
