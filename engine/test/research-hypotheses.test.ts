// Hypotheses in a Standard answer: set before any search, each with its own searches inside the level's limits, and a
// mark that code gives from the checked statements. Fakes only (test/fixtures/research/harness.ts).
import assert from "node:assert/strict"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

process.env.NO_PAID_CALLS = "1"
const { DEFAULTS, engine, jsonResponse, paidAllowed, sourcesIn, containsKey } = await import("./fixtures/research/harness.ts")
const { markOf, missingOf, numberSources, readHypotheses, readStances } = await import("../src/research/pipeline.ts")
const { hypothesesSystem, STANCE, stanceUser, writerSystem } = await import("../src/research/prompts.ts")
const { citedSentences, sentencesOf, withoutRepeats } = await import("../src/research/text.ts")
const { DEFAULTS: LIMITS, limitsOf } = await import("../src/research/types.ts")
import type { Hypothesis, Stamped, Statement } from "../src/research/types.ts"

const Q = "Why do patients on KRAS G12C inhibitors relapse: new KRAS mutations, bypass signalling, or drug exposure that is too low?"
const of = <T extends Stamped["type"]>(events: Stamped[], type: T) => events.filter((e) => e.type === type) as Extract<Stamped, { type: T }>[]
const DIR = join(import.meta.dirname, "fixtures/research")

// Four proposals; the Standard level has three web searches and three literature queries, so three are tested.
const PROPOSED = [
  { text: "Relapse on KRAS G12C inhibitors is caused by secondary KRAS mutations in the drug-binding pocket.", supportIf: "Sequencing of tumours at relapse finds new KRAS mutations in the switch-II pocket.", contradictIf: "Sequencing at relapse finds no new KRAS mutations.", origin: "planner", web: { query: "secondary KRAS mutations at relapse on KRAS G12C inhibitors", objective: "Sequencing studies first." }, literature: "KRAS G12C inhibitor acquired resistance secondary mutations" },
  { text: "Relapse on KRAS G12C inhibitors is caused by bypass signalling through MET amplification.", supportIf: "Tumours at relapse show MET amplification.", contradictIf: "Tumours at relapse show no MET change.", origin: "planner", web: { query: "MET amplification bypass resistance KRAS G12C inhibitors", objective: "Sequencing studies first." }, literature: "KRAS G12C inhibitor resistance MET amplification bypass", database: { source: "clinicaltrials", query: "KRAS G12C MET inhibitor combination" } },
  { text: "Relapse on KRAS G12C inhibitors is caused by drug exposure that is too low.", supportIf: "Patients who relapse have lower measured drug levels than patients who do not.", contradictIf: "Drug levels do not differ between patients who relapse and those who do not.", origin: "planner", web: { query: "drug exposure and relapse on KRAS G12C inhibitors pharmacokinetics", objective: "Pharmacokinetic studies first." }, literature: "sotorasib exposure response pharmacokinetics relapse" },
  { text: "Relapse on KRAS G12C inhibitors is caused by a change of tumour type to squamous histology.", supportIf: "Biopsies at relapse show squamous transformation.", contradictIf: "Biopsies at relapse show the original histology.", origin: "planner", web: { query: "histologic transformation KRAS G12C inhibitor resistance", objective: "Case series first." }, literature: "KRAS G12C histologic transformation squamous resistance" },
]
const PAGES: Record<string, { url: string; title: string; highlights: string[] }[]> = {
  secondary: [{ url: "https://www.example-journal.org/kras-secondary", title: "Acquired KRAS mutations at relapse", highlights: ["Sequencing of 38 patients at relapse found secondary KRAS mutations Y96D and R68S in the switch-II pocket in 7 patients."] }],
  MET: [{ url: "https://www.example-journal.org/met-bypass", title: "MET amplification after KRAS G12C inhibition", highlights: ["MET amplification was found in 2 of 38 patients at relapse.", "In 30 of 38 patients no MET change was detected at relapse."] }],
  exposure: [{ url: "https://www.example-journal.org/exposure", title: "Dose and schedule of KRAS G12C inhibitors", highlights: ["The approved dose of sotorasib is 960 mg once daily. This page reports no measured drug levels in patients who relapsed."] }],
}
const paper = (id: string, title: string, abstractText: string) => ({ id, source: "MED", pmid: id, title, abstractText, pubYear: "2024", journalInfo: { journal: { title: "Example journal" } }, pubTypeList: { pubType: ["research-article"] } })
const PAPERS: Record<string, unknown[]> = {
  secondary: [paper("90000001", "Resistance mutations in the switch-II pocket.", "Compounds binding a different pocket region retained activity against the Y96D mutation in cell assays. Secondary KRAS mutations were detected in 18% of tumours sequenced at relapse.")],
  MET: [paper("90000002", "Bypass signalling in KRAS G12C resistance.", "MET amplification restored downstream signalling in two cell line models of resistance to KRAS G12C inhibition.")],
  exposure: [],
}
const topic = (query: string) => (/MET/.test(query) ? "MET" : /exposure|pharmacokinetic/i.test(query) ? "exposure" : "secondary")
const first = (text: string) => (/^(.{20,400}?[.!?])(?:\s|$)/.exec(text)?.[1] ?? text).trim().replace(/[.!?]$/, "")
/** The fake investigators: each drafts its own section from the sources it was given. H1's files a sentence from each of its sources; H2's files one on each side, one that does not bear on it, and tries to cite a source it was never given; H3's finds nothing to file. */
const section = (call: { system: string; user: string }) => {
  const label = /Yours is (H\d)\./.exec(call.system)![1], own = sourcesIn(call.user)
  if (label === "H1") return [`### H1: secondary KRAS mutations`, `**For:** ${own.map((s) => `${first(s.text)} [${s.n}].`).join(" ")}`, "**Not found:** a study that sequenced relapsed tumours and found no new KRAS mutation."].join("\n")
  if (label === "H2") {
    const met = own.find((s) => /In 30 of 38/.test(s.text))!, record = own.find((s) => /ClinicalTrials\.gov record/.test(s.text))!
    return ["### H9: a heading that is not this investigator's", `**For:** MET amplification was found in 2 of 38 patients at relapse [${met.n}]. Secondary KRAS mutations were seen in 7 patients [1].`, `**Against:** In 30 of 38 patients no MET change was detected at relapse [${met.n}]. ClinicalTrials.gov record NCT00000001 [${record.n}].`, "", "NEXT STEPS", "{\"label\":\"Recommended next step\"}"].join("\n")
  }
  return ["### H3: low drug exposure", "**Not found:** measured drug levels in patients who relapsed; the closest source gives only the approved dose."].join("\n")
}
/** The fake writer of the comparison: the first paragraph only. */
const comparison = () => "The sources found report findings for H1 and on both sides of H2, and nothing that bears on H3.\n\n### H1: a section the writer must not write\n**For:** A sentence that is not the writer's to file [1].\n\nNEXT STEPS"
/** The fake stance check: agrees with a sentence about what its hypothesis names, and says "neither" for the sentence filed against H2 that is about KRAS mutations. */
const stances = (call: { user: string }) => JSON.stringify({ stances: [...call.user.matchAll(/<statement i="(\d+)" hypothesis="(H\d)">([^<]*)<\/statement>/g)].map((m) => {
  const text = m[3], h = m[2]
  const stance = h === "H1" ? "supports" : h === "H2" && /no MET change/.test(text) ? "contradicts" : h === "H2" && /MET amplification was found/.test(text) ? "supports" : "neither"
  return { i: Number(m[1]), stance }
}) })
/** The fake screening: everything is on the question and reports findings. */
const keepAll = (call: { user: string }) => JSON.stringify({ items: [...call.user.matchAll(/<passage i="(\d+)">/g)].map((m) => ({ i: Number(m[1]), answers_question: "yes", reports_results: "yes", study_type: "clinical" })) })
const script = { hypothesize: () => JSON.stringify({ needed: true, hypotheses: PROPOSED }), screen: keepAll, section, write: comparison, stance: stances, critic: () => JSON.stringify({ notes: [] }) }
async function tested(options: Parameters<typeof engine>[0] = {}) {
  const e = await engine({ script, deps: { database: async () => ({ items: [{ url: "https://clinicaltrials.gov/study/NCT00000001", title: "A KRAS G12C inhibitor with a MET inhibitor (NCT00000001)", text: "ClinicalTrials.gov record NCT00000001. Status: Recruiting. Phase: Phase 1. Intervention: a KRAS G12C inhibitor with a MET inhibitor in patients with MET amplification at relapse." }], notices: [] }) }, ...options })
  e.net.exa = [(body) => jsonResponse({ results: PAGES[topic(String(body.query))], costDollars: { total: 0.006 } })]
  e.net.europepmc = (query) => jsonResponse({ resultList: { result: PAPERS[topic(query)] } })
  return e
}

test("hypotheses are read strictly: text, what would support and contradict it, at most what the level's limits fit; what does not fit is set aside and said", () => {
  const all = readHypotheses(JSON.stringify({ needed: true, hypotheses: PROPOSED }), 3, true)
  assert.deepEqual(all.items.map((h) => [h.id, h.origin, h.text === PROPOSED[Number(h.id[1]) - 1].text, h.web.query.length > 5, h.literature.length > 5, h.database?.source]), [["h1", "planner", true, true, true, undefined], ["h2", "planner", true, true, true, "clinicaltrials"], ["h3", "planner", true, true, true, undefined]])
  assert.deepEqual(all.cut.map((c) => [c.text, c.reason]), [[PROPOSED[3].text, "the Standard level has 3 web searches and 3 literature queries for hypotheses, one of each for a hypothesis"]])
  assert.equal(readHypotheses(JSON.stringify({ needed: true, hypotheses: PROPOSED }), 3, false).items[1].database, undefined, "no database lookup when the level has none")
  assert.equal(readHypotheses(JSON.stringify({ needed: true, hypotheses: PROPOSED }), 2, true).items.length, 2)
  const none = readHypotheses(JSON.stringify({ needed: false, reason: "One number to look up." }), 3, true)
  assert.deepEqual([none.needed, none.reason, none.items], [false, "One number to look up.", []])
  // No hypothesis without what would support it and what would contradict it; one alone is not a test; a repeat is one.
  const weak = readHypotheses(JSON.stringify({ needed: true, hypotheses: [{ ...PROPOSED[0], supportIf: "" }, { ...PROPOSED[1], contradictIf: undefined }, PROPOSED[2], { ...PROPOSED[2] }, { text: "short" }, "nonsense"] }), 3, true)
  assert.deepEqual([weak.needed, weak.items.length, weak.reason], [false, 0, "The planner did not give two usable hypotheses, so none were set."])
  for (const bad of ["", "not json", "[]", JSON.stringify({ needed: true }), JSON.stringify({ needed: true, hypotheses: "h" })]) assert.equal(readHypotheses(bad, 3, true).items.length, 0, bad)
  const user = readHypotheses(JSON.stringify({ needed: true, hypotheses: [{ ...PROPOSED[0], origin: "user", web: {}, literature: "" }, { ...PROPOSED[1], origin: "someone" }] }), 3, true)
  assert.deepEqual(user.items.map((h) => [h.origin, h.web.query === h.text, h.literature.length > 5]), [["user", true, true], ["planner", false, true]], "the person's own hypotheses keep their origin; a missing query falls back to the hypothesis's own words")
  assert.equal(readHypotheses(JSON.stringify({ needed: true, hypotheses: PROPOSED }), 1, true).items.length, 0, "limits that fit fewer than two test none")
  assert.equal(readHypotheses(JSON.stringify({ needed: true, hypotheses: [...PROPOSED, ...PROPOSED.map((p) => ({ ...p, text: `${p.text} Again.` }))] }), 9, true).items.length, 4, "never more than four")
  assert.deepEqual([limitsOf({}).levels.quick.hypotheses, limitsOf({}).levels.standard.hypotheses, limitsOf({ research: { quick: { hypotheses: 3 }, standard: { hypotheses: 9 } } }).levels.quick.hypotheses, limitsOf({ research: { standard: { hypotheses: 9 } } }).levels.standard.hypotheses], [0, 3, 0, 3], "quick tests none; a value out of bounds is ignored")
  assert.deepEqual(LIMITS.levels.standard.hypotheses, 3)
})

const st = (over: Partial<Statement>): Statement => ({ stage: "final", index: 0, text: "A finding.", sources: [1], verdict: "verified", quoteFound: true, checker: "openai/gpt-4o-mini", hypothesis: "h1", side: "for", stance: "supports", ...over })

test("the mark of a hypothesis is given by code: a statement counts only when it is filed on a side, passed the quote check, and a second model agrees which way it points", () => {
  const forIt = [st({ index: 0, sources: [1] }), st({ index: 1, sources: [2, 1] })]
  assert.deepEqual(markOf("h1", forIt), { for: [1, 2], against: [], forStatements: [0, 1], againstStatements: [], verdict: "verified", note: "2 checked statements from 2 sources for it; none against it." })
  const againstIt = [st({ index: 3, side: "against", stance: "contradicts", sources: [4] })]
  assert.deepEqual(markOf("h1", againstIt), { for: [], against: [4], forStatements: [], againstStatements: [3], verdict: "contradicted", note: "1 checked statement from 1 source against it; none for it." })
  const mixed = markOf("h1", [...forIt, ...againstIt])
  assert.deepEqual([mixed.verdict, mixed.mixed, mixed.note], ["unsupported", true, "The sources disagree: 2 checked statements from 2 sources for it, 1 checked statement from 1 source against it."])
  // What does not count: not verified by the quote check; the second model disagrees or says neither; filed under another hypothesis; no side.
  const not = [st({ verdict: "unsupported" }), st({ verdict: "unchecked" }), st({ verdict: "contradicted" }), st({ stance: "neither" }), st({ stance: "contradicts" }), st({ side: "against", stance: "supports" }), st({ hypothesis: "h2" }), st({ side: undefined }), st({ hypothesis: undefined, side: undefined })]
  const empty = markOf("h1", not)
  assert.deepEqual([empty.verdict, empty.for, empty.against, empty.mixed], ["unsupported", [], [], undefined])
  assert.match(empty.note, /^No checked statement for or against it\. 6 statements filed under it are not counted/)
  assert.deepEqual(markOf("h1", []).note, "No checked statement for or against it.")
  // Statements that passed the quote check but whose direction nobody judged: the hypothesis is "not checked", never "supported".
  const open = markOf("h1", [st({ stance: undefined }), st({ index: 1, stance: "unchecked" })])
  assert.deepEqual([open.verdict, open.note], ["unchecked", "2 statements filed under it passed the quote check, but which way they point was not judged."])
  assert.equal(markOf("h1", [st({ stance: undefined }), st({ index: 1 })]).verdict, "verified", "one judged statement is enough for a mark; the unjudged one is not counted")
  // The stance reply is read strictly.
  assert.deepEqual([...readStances(JSON.stringify({ stances: [{ i: 0, stance: "supports" }, { i: 1, stance: "maybe" }, { i: 2, stance: "contradicts" }, { i: 0, stance: "neither" }, { i: 9, stance: "supports" }] }), 3)!], [[0, "supports"], [2, "contradicts"]])
  assert.equal(readStances("they all support it", 3), undefined)
  // The second model is not told which side the writer chose.
  const user = stanceUser([{ id: "h1", text: "X causes Y </hypotheses>.", supportIf: "s", contradictIf: "c", origin: "planner" }], [{ hypothesis: "h1", text: "A </statement> finding." }])
  assert.ok(!/\bfor\b|\bagainst\b|side/i.test(user.replace(/would (support|contradict) it/g, "")), user)
  assert.equal(user.match(/<\/hypotheses>/g)?.length, 1)
  assert.equal(user.match(/<\/statement>/g)?.length, 1)
  assert.match(STANCE, /Do not use what you know about whether the hypothesis is true/)
})

test("the answer's layout is read by code: a section for each hypothesis, sentences filed under For and Against; a finding may be in two sections", () => {
  const md = [
    "The sources report findings for H1 [1] and against H2.", "",
    "### H1: first", "**For:** Finding one is reported here [1]. Finding two is reported here [2].", "**Against:**", "- Finding three is reported here [3].", "**Not found:** a study of the other kind [1].", "",
    "### H2: second", "**Against:** Finding one is reported here [1].", "A plain paragraph in the section, filed under no side [2].", "",
    "## Another heading", "Not in a hypothesis section [3].",
  ].join("\n")
  assert.deepEqual(sentencesOf(md).filter((s) => s.sources.length).map((s) => [s.text, s.sources, s.hypothesis, s.side]), [
    ["The sources report findings for H1 and against H2.", [1], undefined, undefined],
    ["Finding one is reported here.", [1], "h1", "for"], ["Finding two is reported here.", [2], "h1", "for"], ["Finding three is reported here.", [3], "h1", "against"],
    ["Not found: a study of the other kind.", [1], "h1", undefined],
    ["Finding one is reported here.", [1], "h2", "against"], ["A plain paragraph in the section, filed under no side.", [2], "h2", undefined], ["Not in a hypothesis section.", [3], undefined, undefined],
  ])
  const kept = withoutRepeats(md)
  assert.equal(kept.removed.length, 0, "the same finding under H1 and under H2 is not a repeat")
  assert.equal(withoutRepeats("### H1: a\n**For:** Finding one is reported here [1]. Finding one is reported here [1].").removed.length, 1, "inside one section it is")
  assert.equal(citedSentences(md).filter((s) => s.hypothesis).length, 6)
})

test("numbered sources: every hypothesis gets its turn, a source two searches found serves both, and the prompts say what a test is", () => {
  const c = (url: string, hypothesis: string, order: number) => ({ item: { url, title: url, text: "t".repeat(60), relevance: 1 }, provider: "exa" as const, order, hypothesis })
  const pool = [c("https://a.org/1", "h1", 0), c("https://a.org/2", "h1", 1), c("https://a.org/3", "h1", 2), c("https://a.org/4", "h1", 3), c("https://b.org/1", "h2", 10), c("https://a.org/1", "h2", 11), c("https://c.org/1", "h3", 20)]
  const four = numberSources(pool, 4, ["h1", "h2", "h3"])
  assert.deepEqual(four.map((s) => [s.url, s.hypotheses]), [["https://a.org/1", ["h1", "h2"]], ["https://b.org/1", ["h2"]], ["https://c.org/1", ["h3"]], ["https://a.org/2", ["h1"]]], "h1 found four, yet h2 and h3 each have a source among the first four")
  assert.deepEqual(numberSources(pool, 4).map((s) => s.hypotheses), [undefined, undefined, undefined, undefined], "no hypotheses: no tag")
  const system = writerSystem(380, true)
  for (const rule of ["# This answer tests hypotheses", "It is not an experiment", "### H1:", "**For:**", "**Against:**", "**Not found:**", "Give no marks", "A program gives each hypothesis its mark"]) assert.ok(system.includes(rule), rule)
  assert.ok(!writerSystem(380).includes("tests hypotheses"))
  const planner = hypothesesSystem({ max: 4, databases: false })
  for (const rule of ["It is not an experiment", "{\"needed\": false", "before anything is searched", "Do not say which hypothesis you think is right", "use those, in the person's own words"]) assert.ok(planner.includes(rule), rule)
  assert.ok(!planner.includes("{{") && !planner.includes("clinicaltrials"))
  assert.ok(hypothesesSystem({ max: 4, databases: true }).includes("\"clinicaltrials\""))
  const hyp = (over: Partial<Hypothesis>): Hypothesis => ({ id: "h1", text: "X causes Y.", supportIf: "s", contradictIf: "c", origin: "planner", ...over })
  assert.deepEqual(missingOf({ searches: [], steps: [], sources: [{ n: 1, url: "u", title: "t", provider: "exa", text: "x" }], statements: [], review: { checker: "c", critic: "k", revised: false, notes: [] }, hypotheses: [hyp({ verdict: "verified" }), hyp({ id: "h2", verdict: "unsupported" }), hyp({ id: "h3", verdict: "unsupported", mixed: true }), hyp({ id: "h4", verdict: "unchecked" })] }, [{ text: "Z causes Y.", reason: "the level has 3 web searches" }]), [
    "No checked evidence for or against H2: \"X causes Y.\"", "The sources disagree on H3: \"X causes Y.\"", "H4 was not checked: \"X causes Y.\"", "A hypothesis that was proposed and not tested, because the level has 3 web searches: \"Z causes Y.\"",
  ])
})

test("a Standard answer with hypotheses: set before any search, one investigator for each working at the same time inside the level's limits, marked by code; the fourth proposal is set aside and said", async () => {
  const e = await tested()
  try {
    const { record, events } = await paidAllowed(() => e.answer({ question: Q, effort: "standard" }))
    assert.equal(record.status, "done")
    // The hypotheses are set, with what would support and contradict each, before the first search starts.
    const set = of(events, "hypotheses")[0]
    assert.deepEqual(set.items.map((h) => [h.id, h.text, h.supportIf, h.contradictIf, h.origin, h.agent]), PROPOSED.slice(0, 3).map((p, i) => [`h${i + 1}`, p.text, p.supportIf, p.contradictIf, "planner", `investigator-${i + 1}`]))
    assert.deepEqual([set.needed, set.cut?.map((c) => c.text)], [true, [PROPOSED[3].text]])
    const steps = of(events, "step.started")
    assert.ok(set.seq < Math.min(...steps.filter((s) => s.kind === "search").map((s) => s.seq)), "before any search")
    assert.deepEqual(steps.filter((s) => s.step === "hypotheses").map((s) => [s.kind, s.label]), [["hypothesize", "Setting up hypotheses to test"]])
    // Each hypothesis has its own searches, tagged; the three web searches open the answer together; the limits are the level's own.
    const searches = steps.filter((s) => s.kind === "search")
    assert.deepEqual(searches.map((s) => [s.step, s.hypothesis]).sort(), [["search:clinicaltrials:1", "h2"], ["search:europepmc:1", "h1"], ["search:europepmc:2", "h2"], ["search:europepmc:3", "h3"], ["search:exa:1", "h1"], ["search:exa:2", "h2"], ["search:exa:3", "h3"]])
    assert.ok(steps.filter((s) => s.kind === "evaluate").every((s) => /^h[123]$/.test(s.hypothesis ?? "")))
    const exaEnds = of(events, "step.finished").filter((s) => s.step.startsWith("search:exa")).map((s) => s.seq)
    assert.ok(searches.filter((s) => s.provider === "exa").every((s) => s.seq < Math.min(...exaEnds)), "the web searches of the three hypotheses start before any of them ends")
    for (const id of ["1", "2", "3"]) assert.ok(steps.find((s) => s.step === `search:europepmc:${id}`)!.seq > of(events, "step.finished").find((s) => s.step === `search:exa:${id}`)!.seq, "a hypothesis's literature search follows its own web search")
    const asked = e.pmcRequests().map((r) => new URL(r.url).searchParams.get("query"))
    assert.deepEqual([e.exaRequests().length, PROPOSED.slice(0, 3).every((p) => asked.includes(p.literature)), asked.every((q) => PROPOSED.slice(0, 3).some((p) => p.literature.startsWith(q ?? "?")))], [3, true, true], "three web searches and three literature queries: the Standard limits, not one more (a query that finds nothing is tried again with fewer words, which is the same query)")
    assert.deepEqual(e.exaRequests().map((r) => r.body?.query).sort(), PROPOSED.slice(0, 3).map((p) => p.web.query).sort(), "the hypotheses' own searches; the general plan's are not run on top")
    assert.deepEqual(record.caps, { maxUsd: 0.6, maxSeconds: 120 })
    assert.ok(record.usd < 0.6 && record.sources.length <= 12)
    // Sources say which hypothesis they serve.
    assert.deepEqual(record.sources.map((s) => [s.n, s.provider, s.hypotheses]), [[1, "exa", ["h1"]], [2, "exa", ["h2"]], [3, "exa", ["h3"]], [4, "europepmc", ["h1"]], [5, "europepmc", ["h2"]], [6, "clinicaltrials", ["h2"]]])
    assert.deepEqual(of(events, "sources")[0].items.map((s) => s.hypotheses), record.sources.map((s) => s.hypotheses))
    // WHO DID WHAT. Every step names its agent: the planner, one investigator for each hypothesis, the writer, the shared checker and critic.
    const agentsOf = (kind: string) => [...new Set(steps.filter((x) => x.kind === kind).map((x) => x.agent))].sort()
    assert.deepEqual([agentsOf("prepare"), agentsOf("hypothesize"), agentsOf("search"), agentsOf("evaluate"), agentsOf("check"), agentsOf("review")], [["planner"], ["planner"], ["investigator-1", "investigator-2", "investigator-3"], ["investigator-1", "investigator-2", "investigator-3"], ["checker"], ["critic"]])
    assert.ok(steps.filter((x) => x.hypothesis).every((x) => x.agent === `investigator-${x.hypothesis!.slice(1)}`), "an investigator works on its own hypothesis and on no other")
    assert.deepEqual(steps.filter((x) => x.kind === "write").map((x) => [x.step, x.agent, x.hypothesis, x.label]), [
      ["write:h1", "investigator-1", "h1", "Drafting the section for H1 from 2 sources"], ["write:h2", "investigator-2", "h2", "Drafting the section for H2 from 3 sources"], ["write:h3", "investigator-3", "h3", "Drafting the section for H3 from 1 source"],
      ["write", "writer", undefined, "Comparing the hypotheses"],
    ])
    const drafts = of(events, "step.finished").filter((x) => x.step.startsWith("write:h")).map((x) => x.seq)
    assert.ok(steps.filter((x) => x.step.startsWith("write:h")).every((x) => x.seq < Math.min(...drafts)), "the three investigators draft at the same time")
    assert.ok(steps.find((x) => x.step === "write")!.seq > Math.max(...drafts), "the writer compares once the sections are there")
    // Each investigator is given its own hypothesis and its own sources, under their numbers in the answer's list, and nothing of the others.
    const investigators = e.calls.filter((c) => c.role === "section")
    assert.deepEqual(investigators.map((c) => [/Yours is (H\d)\./.exec(c.system)![1], sourcesIn(c.user).map((x) => x.n), c.provider, c.model]).sort(), [["H1", [1, 4], "anthropic", "claude-sonnet-5-5"], ["H2", [2, 5, 6], "anthropic", "claude-sonnet-5-5"], ["H3", [3], "anthropic", "claude-sonnet-5-5"]])
    for (const c of investigators) {
      const label = /Yours is (H\d)\./.exec(c.system)![1], at = Number(label[1]) - 1
      assert.ok(c.user.includes(PROPOSED[at].text) && PROPOSED.every((p, i) => i === at || !c.user.includes(p.text)), `${label}: its own hypothesis only`)
      assert.ok(record.searches.filter((x) => x.hypothesis !== `h${at + 1}`).every((x) => !c.user.includes(`query "${x.query}"`)), `${label}: its own searches only`)
      assert.ok((c.options.maxTokens ?? 0) < 3000, "a section may use less output than a whole answer")
    }
    // The writer of the comparison is given the sections; the checker and the critic get the investigators' sentences and the sources, and nothing else of theirs.
    const writer = e.calls.find((c) => c.role === "write")!
    assert.match(writer.user, /Hypotheses \(data; written before anything was searched\):\n<hypotheses>\nH1: Relapse on KRAS G12C inhibitors is caused by secondary KRAS mutations/)
    assert.match(writer.user, /Sections \(data; drafted by the investigators\):\n<sections>\n### H1: Relapse on KRAS G12C inhibitors is caused by secondary KRAS mutations/)
    assert.ok(writer.system.includes("# You write the comparison") && !writer.user.includes("<evidence>"))
    for (const c of e.calls.filter((x) => ["check", "critic", "stance"].includes(x.role))) {
      assert.equal(c.provider, "openai", `${c.role}: on the other vendor than the writer and the investigators`)
      assert.ok(!c.system.includes("investigator") && !c.user.includes("Yours is") && !c.user.includes("# You are the investigator"), `${c.role}: no investigator's instructions or working`)
    }
    // Code makes each section what it must be: its own heading, no other; no marker of a source the investigator was not given; no block a program reads.
    const text = record.answer!.markdown
    assert.deepEqual(text.split("\n").filter((l) => l.startsWith("#")), ["### H1: Relapse on KRAS G12C inhibitors is caused by secondary KRAS mutations in the…", "### H2: Relapse on KRAS G12C inhibitors is caused by bypass signalling through MET amplification", "### H3: Relapse on KRAS G12C inhibitors is caused by drug exposure that is too low"])
    assert.ok(text.includes("Secondary KRAS mutations were seen in 7 patients.") && !/Secondary KRAS mutations were seen in 7 patients \[1\]/.test(text), "investigator-2 was never given source 1: its marker is removed and the sentence is not a cited one")
    assert.ok(!/NEXT STEPS|not the writer's to file|H9/.test(text))
    assert.ok(text.startsWith("The sources found report findings for H1 and on both sides of H2, and nothing that bears on H3.\n\n### H1:"))
    const stance = e.calls.filter((c) => c.role === "stance")
    assert.deepEqual([stance.length, stance[0].provider, stance[0].model], [1, "openai", "gpt-4o-mini"], "one call, to a model of another vendor than the writer")
    assert.ok(!/filed|\*\*For|\*\*Against/.test(stance[0].user))
    // Statements carry their hypothesis, the side they were filed under, and which way the second model says they point.
    assert.deepEqual(record.statements.map((s) => [s.hypothesis, s.side, s.verdict, s.stance, s.sources, s.agent]), [
      ["h1", "for", "verified", "supports", [1], "investigator-1"], ["h1", "for", "verified", "supports", [4], "investigator-1"],
      ["h2", "for", "verified", "supports", [2], "investigator-2"], ["h2", "against", "verified", "contradicts", [2], "investigator-2"], ["h2", "against", "verified", "neither", [6], "investigator-2"],
    ])
    // The marks, by code: H1 has two checked statements for it; H2 has one on each side; H3 has none.
    const marks = of(events, "hypothesis.checked")
    assert.deepEqual(marks.map((m) => [m.id, m.verdict, m.for, m.against, m.forStatements, m.againstStatements, m.mixed]), [["h1", "verified", [1, 4], [], [0, 1], [], undefined], ["h2", "unsupported", [2], [2], [2], [3], true], ["h3", "unsupported", [], [], [], [], undefined]])
    assert.equal(marks[0].note, "2 checked statements from 2 sources for it; none against it.")
    assert.deepEqual(marks.map((m) => [m.agent, m.testedBy]), [1, 2, 3].map((n) => [`investigator-${n}`, { kind: "sources" }]), "the mark rests on published sources; a later swarm run on data would be named here")
    assert.deepEqual(record.hypotheses?.map((h) => [h.agent, h.testedBy]), [1, 2, 3].map((n) => [`investigator-${n}`, { kind: "sources" }]))
    assert.match(marks[1].note ?? "", /^The sources disagree: 1 checked statement from 1 source for it, 1 checked statement from 1 source against it\. 1 statement filed under it is not counted/)
    assert.deepEqual(record.hypotheses?.map((h) => [h.id, h.verdict, h.mixed, h.for]), [["h1", "verified", undefined, [1, 4]], ["h2", "unsupported", true, [2]], ["h3", "unsupported", undefined, []]])
    assert.ok(marks[2].seq < of(events, "sources.cited")[0].seq && marks[0].seq > of(events, "step.finished").find((s) => s.step === "check:stance")!.seq)
    assert.equal(of(events, "step.started").find((s) => s.step === "check:stance")?.label, "Checking which way 5 statements point")
    // What is missing says what was left open and what was not tested.
    assert.deepEqual(record.missing?.filter((m) => /H\d|hypothesis/.test(m)), [
      `The sources disagree on H2: "${PROPOSED[1].text}"`, `No checked evidence for or against H3: "${PROPOSED[2].text}"`,
      `A hypothesis that was proposed and not tested, because the Standard level has 3 web searches and 3 literature queries for hypotheses, one of each for a hypothesis: "${PROPOSED[3].text}"`,
    ])
    assert.match(record.hypothesesNote ?? "", /^1 more hypothesis was proposed and not tested/)
    assert.ok(!/\[\d\]/.test(record.answer!.markdown.split("\n").filter((l) => l.startsWith("**Not found:**")).join(" ")), "no marker in a Not found line")
    assert.equal(containsKey(JSON.stringify(events)), false)
    if (process.env.WRITE_RESEARCH_STREAMS === "1") writeFileSync(join(DIR, "stream-hypotheses.jsonl"), events.map((x) => JSON.stringify(x)).join("\n") + "\n")
    const stored = readFileSync(join(DIR, "stream-hypotheses.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Stamped)
    const shape = (list: Stamped[]) => list.map((x) => `${x.type}${"step" in x ? `(${x.step})` : ""} {${Object.keys(x).sort().join(",")}}`).sort()
    assert.deepEqual(shape(events), shape(stored), "stream-hypotheses.jsonl is what the code emits (WRITE_RESEARCH_STREAMS=1 writes it again)")
  } finally { await e.close() }
})

test("hypotheses and honesty: a statement the quote check rejects never counts; with no second model nothing is marked; Quick tests none; the person's own hypotheses are kept", async () => {
  // The checker finds none of the statements in their sources: every hypothesis is left with no evidence, whatever was written.
  const strict = await tested({ script: { ...script, check: (call) => JSON.stringify({ rulings: [...call.user.matchAll(/<claim i="(\d+)">/g)].map((m) => ({ i: Number(m[1]), verdict: "not_stated", quote: "" })) }), revise: (call) => `${/<draft>\n([\s\S]*?)\n<\/draft>/.exec(call.user)![1]}\n\nREVIEW NOTES` } })
  try {
    const { record, events } = await paidAllowed(() => strict.answer({ question: Q, effort: "standard" }))
    assert.deepEqual(record.hypotheses?.map((h) => h.verdict), ["unsupported", "unsupported", "unsupported"])
    assert.equal(strict.count("stance"), 0, "nothing passed the quote check, so there is nothing to ask the second model")
    assert.equal(of(events, "step.started").some((s) => s.step === "check:stance"), false)
    assert.match(record.hypotheses![0].note ?? "", /^No checked statement for or against it\. 2 statements filed under it are not counted/)
    assert.equal(strict.count("section"), 3)
  } finally { await strict.close() }
  // The second model's reply cannot be read: the statements passed the quote check, but no hypothesis is marked as supported.
  const mute = await tested({ script: { ...script, stance: () => "I think they all support it." } })
  try {
    const { record, events } = await paidAllowed(() => mute.answer({ question: Q, effort: "standard" }))
    assert.deepEqual(record.hypotheses?.map((h) => h.verdict), ["unchecked", "unchecked", "unsupported"])
    assert.equal(of(events, "step.finished").find((s) => s.step === "check:stance")?.status, "failed")
    assert.ok(record.missing?.some((m) => m.startsWith("H1 was not checked:")))
  } finally { await mute.close() }
  // The answer ends at its spending limit before anything is written: the hypotheses are "not checked", never "no evidence".
  const dear = await tested({ prices: { anthropic: { "claude-haiku-5-5": [0.1, 0.5], "claude-sonnet-5-5": [2, 400] }, openai: { "gpt-4o-mini": [0.15, 0.6], "gpt-5-mini": [0.25, 2] } } })
  try {
    const { record, events } = await paidAllowed(() => dear.answer({ question: Q, effort: "standard" }))
    assert.deepEqual([record.stopped, dear.count("write")], ["cap", 0])
    assert.deepEqual(of(events, "hypothesis.checked").map((m) => [m.verdict, m.note]), [1, 2, 3].map(() => ["unchecked", "Not checked: the spending cap for this answer was reached."]))
    assert.ok(record.missing?.some((m) => m.startsWith("H1 was not checked:")))
  } finally { await dear.close() }
  // A hypothesis whose searches found nothing has no investigator's draft: code writes its section, and no model is asked.
  const bare = await tested()
  bare.net.exa = [(body) => jsonResponse({ results: /exposure/.test(String(body.query)) ? [] : PAGES[topic(String(body.query))], costDollars: { total: 0.006 } })]
  try {
    const { record, events } = await paidAllowed(() => bare.answer({ question: Q, effort: "standard" }))
    assert.deepEqual([bare.count("section"), of(events, "step.started").some((x) => x.step === "write:h3")], [2, false])
    assert.match(record.answer!.markdown, /### H3: [^\n]*\n\*\*Not found:\*\* no source that passed screening was found for this hypothesis\./)
    assert.deepEqual(record.hypotheses?.map((h) => h.verdict), ["verified", "unsupported", "unsupported"])
    assert.equal(record.sources.some((x) => x.hypotheses?.includes("h3")), false)
  } finally { await bare.close() }
  // Quick: the stage does not exist.
  const quick = await tested()
  try {
    const { record, events } = await paidAllowed(() => quick.answer({ question: Q, effort: "quick" }))
    assert.deepEqual([quick.count("hypothesize"), quick.count("stance"), of(events, "hypotheses").length, record.hypotheses], [0, 0, 0, undefined])
    assert.equal(quick.exaRequests().length, 1)
  } finally { await quick.close() }
  // The person stated the hypotheses: they are tested in the person's words, marked as theirs.
  const own = await tested({ script: { ...script, hypothesize: () => JSON.stringify({ needed: true, hypotheses: PROPOSED.slice(0, 2).map((p) => ({ ...p, origin: "user" })) }) } })
  try {
    const { record } = await paidAllowed(() => own.answer({ question: `Test these two: (1) ${PROPOSED[0].text} (2) ${PROPOSED[1].text}`, effort: "standard" }))
    assert.deepEqual(record.hypotheses?.map((h) => [h.origin, h.text]), PROPOSED.slice(0, 2).map((p) => ["user", p.text]))
    assert.match(own.calls.find((c) => c.role === "hypothesize")!.user, /Test these two/)
    assert.equal(own.exaRequests().length, 2)
  } finally { await own.close() }
})

test("an answer with hypotheses is durable too: killed while the hypotheses' searches run, it ends the same and buys no stored step again", async () => {
  const calm = await tested()
  const reference = await paidAllowed(() => calm.answer({ question: Q, effort: "standard" }))
  await calm.close()
  for (const point of [2, 5, 9]) {
    let stored = 0, live = true
    const e = await tested({ onStored: () => { stored++; if (live && stored === point) { live = false; return "stop" } } })
    try {
      await paidAllowed(async () => {
        const id = (await e.ask({ question: Q, effort: "standard" })).body.id
        await e.research.idle()
        const plans = e.count("hypothesize")
        assert.deepEqual(e.research.resume(), [id])
        await e.research.idle()
        const record = await e.record(id), events = e.events(id)
        assert.equal(e.count("hypothesize"), plans, `killed at ${point}: the hypotheses are not asked for again`)
        assert.ok(e.exaRequests().length <= 3 + 1 && e.count("write") === 1 && e.count("section") === 3 && e.count("stance") === 1, `killed at ${point}`)
        assert.deepEqual(record.hypotheses, reference.record.hypotheses, `killed at ${point}: the same hypotheses with the same marks`)
        assert.deepEqual(record.sources.map((s) => [s.n, s.url, s.hypotheses]), reference.record.sources.map((s) => [s.n, s.url, s.hypotheses]), `killed at ${point}: the same numbered sources`)
        assert.deepEqual(record.statements, reference.record.statements)
        assert.deepEqual(events.map((x) => x.seq), events.map((_x, i) => i + 1))
        assert.deepEqual(events.filter((x) => x.type !== "research.resumed" && x.type !== "answer.delta").map((x) => x.key).sort(), reference.events.filter((x) => x.type !== "answer.delta").map((x) => x.key).sort())
      })
    } finally { await e.close() }
  }
})

test("Demo at the Standard level shows the same shapes from fixtures: two example hypotheses, one statement set aside by the stance check, no network", async () => {
  const e = await engine({ demo: true })
  try {
    const { record, events } = await e.answer({ question: "Do KRAS G12C inhibitors work, and does resistance occur?", effort: "standard" })
    assert.deepEqual([e.net.requests.length, e.calls.length, record.mode, record.usd], [0, 0, "demo", 0])
    assert.deepEqual(of(events, "hypotheses")[0].items.map((h) => [h.id, h.text.startsWith("Demo hypothesis:"), h.origin]), [["h1", true, "planner"], ["h2", true, "planner"]])
    assert.deepEqual(of(events, "step.started").filter((s) => s.kind === "search").map((s) => [s.step, s.provider, s.hypothesis, s.agent]).sort(), [["search:fixture:1", "fixture", "h1", "investigator-1"], ["search:fixture:2", "fixture", "h2", "investigator-2"]])
    assert.deepEqual(of(events, "step.started").filter((s) => s.kind === "write").map((s) => [s.step, s.agent]), [["write:h1", "investigator-1"], ["write:h2", "investigator-2"], ["write", "writer"]])
    assert.deepEqual(record.sources.map((s) => [s.n, s.provider, s.hypotheses]), [[1, "fixture", ["h1", "h2"]], [2, "fixture", ["h1", "h2"]], [3, "fixture", ["h1", "h2"]]])
    assert.deepEqual(record.statements.map((s) => [s.hypothesis, s.side, s.verdict, s.stance, s.checker]), [["h1", "for", "verified", "supports", "scripted"], ["h2", "for", "verified", "neither", "scripted"], ["h2", "against", "verified", "contradicts", "scripted"]])
    assert.deepEqual(of(events, "hypothesis.checked").map((m) => [m.id, m.verdict, m.for, m.against, m.agent, m.testedBy]), [["h1", "verified", [1], [], "investigator-1", { kind: "sources" }], ["h2", "contradicted", [], [3], "investigator-2", { kind: "sources" }]])
    assert.match(record.answer!.markdown, /^\*\*Demo answer\. This is fixed example text, not research\./)
    assert.equal(record.review.revised, false)
    if (process.env.WRITE_RESEARCH_STREAMS === "1") writeFileSync(join(DIR, "stream-hypotheses-demo.jsonl"), events.map((x) => JSON.stringify(x)).join("\n") + "\n")
    assert.ok(existsSync(join(DIR, "stream-hypotheses-demo.jsonl")))
    const stored = readFileSync(join(DIR, "stream-hypotheses-demo.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Stamped)
    assert.deepEqual(events.map((x) => x.key).sort(), stored.map((x) => x.key).sort(), "stream-hypotheses-demo.jsonl is what the code emits")
    // Quick in demo stays as it was: no hypotheses.
    const quick = await e.answer({ question: "Is hERG a risk?", effort: "quick" })
    assert.deepEqual([of(quick.events, "hypotheses").length, quick.record.hypotheses], [0, undefined])
  } finally { await e.close() }
})
