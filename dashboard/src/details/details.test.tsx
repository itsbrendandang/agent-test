// The agent and entity detail panels: identifiers found only in forms that name their database, profiles built only from
// recorded events, panels that fill in while a run goes on, and the ways in (the run's cast, the Agent Log's names, a
// graph node). Fakes only: a made-up practice run (fixtures.ts) and a stubbed engine; nothing reaches the network.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { routes } from "@/test/engine"
import { EventLog } from "@/lab/EventLog"
import { eventRows } from "@/lab/logRows"
import { detailOf } from "@/graph/detailOf"
import type { GraphNode } from "@/graph/types"
import { findIdentifiers, idKey } from "./identifiers"
import { agentProfile, entityProfile, runFacts, runIdentifiers } from "./profiles"
import { LatestReview } from "./LatestReview"
import { RunCast } from "./RunCast"
import { forgetRoster } from "./roster"
import { FIXTURE_RUN, fixtureEvents, KRAS, PAPER, SOTORASIB, TRIAL } from "./fixtures"

const ROSTER = [
  { name: "lead-scientist", title: "Lead Scientist", role: "lead", model: "lead", modelId: "anthropic/claude-sonnet-5-5", tools: ["converse", "write_memo"], purpose: "Coordinates the board." },
  { name: "scout", title: "Scout (Data and Evidence)", role: "member", model: "cheap", modelId: "anthropic/claude-haiku-5-5", tools: ["exa_search", "literature_search", "database_search"], purpose: "Inspect the dataset before any research begins.", deliverable: "A data report." },
  { name: "critic", title: "Critic (Scientific Reviewer)", role: "member", model: "rival", modelId: "openai/gpt-5.5", tools: [] },
]
const board = (events = fixtureEvents()) => { const facts = runFacts(events, "board"); return { facts, rows: eventRows(events, "board") } }
const n = (find: string) => fixtureEvents().findIndex((e) => e.key === find) + 1

describe("identifiers", () => {
  it("reads the database addresses the engine's look-ups record, with the kind of thing each names", () => {
    const ids = findIdentifiers(KRAS, SOTORASIB, TRIAL, PAPER, "https://platform.opentargets.org/evidence/ENSG00000133703/EFO_0003060", "https://pubchem.ncbi.nlm.nih.gov/compound/2244", "https://www.ebi.ac.uk/chembl/explore/target/CHEMBL2189121", "https://europepmc.org/article/MED/12345678", "https://arxiv.org/abs/2401.01234v2")
    expect(ids.map((i) => [i.scheme, i.value, i.type])).toEqual([
      ["uniprot", "P01116", "target"], ["chembl", "CHEMBL4535757", "drug"], ["nct", "NCT04303780", "trial"], ["pmid", "34096690", "paper"],
      ["ensembl", "ENSG00000133703", "target"], ["efo", "EFO_0003060", "disease"], ["pubchem", "2244", "drug"], ["chembl", "CHEMBL2189121", "target"], ["pmid", "12345678", "paper"], ["arxiv", "2401.01234", "paper"],
    ])
    for (const i of ids) expect(i.href).toMatch(/^https:\/\//)
    expect(ids[0].href).toBe("https://www.uniprot.org/uniprotkb/P01116/entry")
    expect(ids[2].href).toBe("https://clinicaltrials.gov/study/NCT04303780")
  })
  it("finds identifiers in text only in forms that name their database, and never guesses a kind", () => {
    const ids = findIdentifiers("UniProt P01116 and CHEMBL4535757 in NCT04303780 (PMID: 34096690, doi: 10.1056/NEJMoa2103695.) PubChem CID 2244")
    expect(ids.map((i) => [i.scheme, i.value, i.type])).toEqual([
      ["nct", "NCT04303780", "trial"], ["chembl", "CHEMBL4535757", undefined], ["doi", "10.1056/NEJMoa2103695", "paper"], ["pmid", "34096690", "paper"], ["uniprot", "P01116", "target"], ["pubchem", "2244", "drug"],
    ])
    // A compound code, a gene name, a bare accession-shaped word, a number with units: none of them is an identifier.
    expect(findIdentifiers("CMP-0423 binds KRAS at 95 nM; P01116 alone; IC50 10.5/2; https://example.org/mock/kras")).toEqual([])
  })
  it("does not read a database's name with a year, or a ChEMBL release name, as a record", () => {
    expect(findIdentifiers("PubChem 2023 update: improved access to chemical data; ChEMBL33 and ChEMBL34 releases")).toEqual([])
  })
  it("a DOI inside a publisher's address ends before the query, the page format and the version", () => {
    const ids = findIdentifiers("https://www.science.org/doi/10.1126/science.abc1234?af=R", "https://www.biorxiv.org/content/10.1101/2024.01.01.123456v1.full.pdf", "https://doi.org/10.1126/science.abc1234")
    expect(ids.map((i) => [i.scheme, i.value])).toEqual([["doi", "10.1126/science.abc1234"], ["doi", "10.1101/2024.01.01.123456"]])
    expect(ids[1].href).toBe("https://doi.org/10.1101/2024.01.01.123456")
  })
  it("counts the same record once, and keeps the kind an address gave it", () => {
    const ids = findIdentifiers("CHEMBL4535757 again", SOTORASIB, "chembl4535757")
    expect(ids).toHaveLength(1)
    expect(ids[0].type).toBe("drug")
    expect(idKey({ scheme: "doi", value: "10.1/ABC" })).toBe(idKey({ scheme: "doi", value: "10.1/abc" }))
  })
})

describe("an agent's profile", () => {
  it("collects what the scout did: its searches, the sources it kept, its statements and its own tokens", () => {
    const { facts, rows } = board()
    const p = agentProfile(facts, rows, "scout")
    expect(p.searches.map((s) => [s.query, s.provider, s.kept, s.dropped, s.round])).toEqual([["KRAS UniProt P01116 function", "uniprot", 2, 1, 1], ["sotorasib CHEMBL4535757 trial", "chembl", 3, 0, 1]])
    expect(p.sources.map((s) => s.url)).toContain(TRIAL)
    expect(p.sources).toHaveLength(5)
    expect(p.claims.map((c) => [c.text, c.latest.verdict])).toEqual([["Sotorasib (CHEMBL4535757) reached phase 4.", "verified"]])
    expect(p.marks).toEqual({ supported: 1, contradicted: 0, insufficient: 0, unchecked: 0 })
    expect(p.usage).toEqual({ tokens: { input: 2600, output: 520, cacheRead: 0, cacheWrite: 0, totalTokens: 3120, usd: 0 }, asOf: "finished" })
    expect(p.rounds).toEqual([1, 2])
    expect(p.now).toMatchObject({ state: "done", text: "Finished. It replied in rounds 1, 2." })
    expect(p.identifiers.map(idKey)).toEqual(expect.arrayContaining(["uniprot:P01116", "chembl:CHEMBL4535757", "nct:NCT04303780"]))
    expect(p.rows.length).toBeGreaterThan(0)
    expect(p.rows.every((r) => r.agentId === "scout")).toBe(true)
  })
  it("says what the agent is doing now, from the newest events, while the run goes on", () => {
    const at = (key: string, id: string) => { const { facts, rows } = board(fixtureEvents(n(key))); return agentProfile(facts, rows, id) }
    expect(at("roster", "scout").now.state).toBe("not-started")
    expect(at("round:1", "scout").now).toMatchObject({ state: "working", text: "Working on its reply for round 1." })
    expect(at("search:2", "scout").now).toMatchObject({ state: "searching", text: "Searching for round 1: last query “sotorasib CHEMBL4535757 trial”." })
    expect(at("reply:1:scout", "scout").now).toMatchObject({ state: "waiting", text: "Replied in round 1. Waiting for the next round." })
    expect(at("reply:1:scout", "lead-scientist").now.text).toBe("Running round 1: 1 of 3 members have replied.")
    expect(at("memo", "lead-scientist").now.text).toBe("Writing the decision memo.")
    // Before the finish event, the tokens are the member's own running total from its newest reply.
    expect(at("reply:1:scout", "scout").usage).toEqual({ tokens: expect.objectContaining({ totalTokens: 1500 }), asOf: "reply", round: 1 })
  })
  it("a run that failed and was resumed is not stopped once anything newer is recorded", () => {
    const all = fixtureEvents(), i = all.findIndex((e) => e.key === "round:1")
    const T = Number(all[i].at)
    const failed = { key: "failed:1", at: T + 1, type: "run.failed", error: "The lead wrote no memo." }
    const resumed = [...all.slice(0, i + 1), failed, ...all.slice(i + 1).map((e) => ({ ...e, at: Number(e.at) + 10_000 }))]
    const stopped = board([...all.slice(0, i + 1), failed])
    expect(agentProfile(stopped.facts, stopped.rows, "scout").now.state).toBe("stopped")
    const { facts, rows } = board(resumed)
    expect(facts.failed).toBeUndefined()
    expect(agentProfile(facts, rows, "scout").now).toMatchObject({ state: "done" })
  })
  it("leaves the tokens out for a run recorded before the engine wrote them", () => {
    const old = fixtureEvents().map((e) => { const { usage: _u, members: _m, ...rest } = e; return rest })
    const { facts, rows } = board(old)
    expect(agentProfile(facts, rows, "scout").usage).toBeUndefined()
  })
  it("gives a checker its rulings, by mark", () => {
    const { facts, rows } = board()
    const p = agentProfile(facts, rows, "first-pass")
    expect(p.rulings.map((r) => [r.agent, r.verdict])).toEqual([["scout", "verified"], ["critic", "contradicted"]])
    expect(p.ruled).toMatchObject({ supported: 1, contradicted: 1 })
    expect(p.claims).toEqual([])
  })
})

describe("an entity's profile", () => {
  it("a source: who found it, the statements that rest on it with every ruling, and who touched it when", () => {
    const { facts } = board()
    const e = entityProfile(facts, { kind: "source", url: TRIAL })
    expect(e.title).toBe("CodeBreaK 200 (fixture)")
    expect(e.identifiers.map(idKey)).toEqual(["nct:NCT04303780"])
    expect(e.facts).toEqual(expect.arrayContaining([{ label: "Found through", value: "ClinicalTrials.gov" }, { label: "Search query", value: "sotorasib CHEMBL4535757 trial" }]))
    expect(e.claims).toHaveLength(1)
    expect(e.claims[0].rulings.map((r) => [r.round, r.verdict, r.checker])).toEqual([[1, "contradicted", "first-pass"], [2, "unsupported", "openai"]])
    expect(e.touches.map((t) => t.agent)).toEqual(["scout", "critic", "first-pass", "critic", "openai"])
    expect(e.touches[0].how).toBe("found it, searching “sotorasib CHEMBL4535757 trial”")
    expect(e.missing).toBe(false)
  })
  it("an identifier: every source, reply, search and statement that names it", () => {
    const { facts } = board()
    const ids = runIdentifiers(facts)
    expect(ids.find((x) => idKey(x.id) === "nct:NCT04303780")?.mentions).toBeGreaterThanOrEqual(4)
    const e = entityProfile(facts, { kind: "id", key: "nct:NCT04303780" })
    expect(e.kindWord).toBe("Clinical trial")
    expect(e.url).toBe("https://clinicaltrials.gov/study/NCT04303780")
    expect(e.sources.map((s) => s.url)).toEqual([TRIAL])
    expect(e.claims.map((c) => c.agent)).toEqual(["critic"])
    expect(new Set(e.touches.map((t) => t.agent))).toEqual(new Set(["scout", "critic", "first-pass", "openai"]))
  })
  it("fills in as the run goes on: missing before anything names it, then present", () => {
    const early = entityProfile(runFacts(fixtureEvents(n("search:1")), "board"), { kind: "id", key: "nct:NCT04303780" })
    expect(early.missing).toBe(true)
    expect(early.touches).toEqual([])
    const later = entityProfile(runFacts(fixtureEvents(n("search:2")), "board"), { kind: "id", key: "nct:NCT04303780" })
    expect(later.missing).toBe(false)
    expect(later.sources).toHaveLength(1)
  })
  it("a statement: who stated it, each ruling and the source it names", () => {
    const { facts } = board()
    const e = entityProfile(facts, { kind: "claim", agent: "critic", text: "NCT04303780 met its primary end point with a large gain." })
    expect(e.facts).toEqual(expect.arrayContaining([{ label: "Rounds", value: "1, 2" }]))
    expect(e.sources.map((s) => s.url)).toEqual([TRIAL])
    expect(e.touches.map((t) => t.how)).toEqual(["stated it in round 1", "ruled: contradicted", "stated it in round 2", "ruled: unsupported"])
  })
})

describe("the panels on screen", () => {
  beforeEach(() => { forgetRoster(); routes({ "GET /api/roster": { status: 200, body: ROSTER } }) })
  const run = { kind: "board" as const, id: FIXTURE_RUN, live: false }

  it("the run's cast lists every agent and entity, and an agent's panel shows its role, model, tools, tokens and work", async () => {
    render(<RunCast run={run} events={fixtureEvents()} />)
    const cast = screen.getByRole("region", { name: "Agents and entities in this run" })
    expect(within(cast).getByRole("button", { name: "Target: UniProt P01116" })).toBeInTheDocument()
    fireEvent.click(within(cast).getByRole("button", { name: /^Details of Scout/ }))
    const panel = await screen.findByRole("dialog")
    expect(within(panel).getByRole("heading", { name: "Scout (Data and Evidence)" })).toBeInTheDocument()
    await waitFor(() => expect(within(panel).getByText("Inspect the dataset before any research begins.")).toBeInTheDocument())
    expect(panel).toHaveTextContent("practice: no model (a real run would use anthropic/claude-haiku-5-5)")
    expect(panel).toHaveTextContent("web search (Exa), literature search, database look-up")
    expect(panel).toHaveTextContent("3,120")
    expect(panel).toHaveTextContent("$0 (practice run: a scripted model, no money spent)")
    expect(panel).toHaveTextContent("“sotorasib CHEMBL4535757 trial”")
    expect(within(panel).getByRole("button", { name: "Sotorasib (CHEMBL4535757) reached phase 4." })).toBeInTheDocument()
  })

  it("opens an identifier from an agent, then Back returns to the agent", async () => {
    render(<RunCast run={run} events={fixtureEvents()} />)
    fireEvent.click(screen.getByRole("button", { name: /^Details of Scout/ }))
    const panel = await screen.findByRole("dialog")
    fireEvent.click(within(panel).getAllByRole("button", { name: /UniProt P01116/ })[0])
    await waitFor(() => expect(within(panel).getByRole("heading", { name: "UniProt P01116" })).toBeInTheDocument())
    expect(panel).toHaveTextContent("Target · team review · practice run")
    expect(within(panel).getByRole("link", { name: "Open at UniProt" })).toHaveAttribute("href", "https://www.uniprot.org/uniprotkb/P01116/entry")
    expect(within(panel).getByRole("button", { name: "KRAS - GTPase KRas (fixture)" })).toBeInTheDocument()
    fireEvent.click(within(panel).getByRole("button", { name: "Back" }))
    expect(within(panel).getByRole("heading", { name: "Scout (Data and Evidence)" })).toBeInTheDocument()
  })

  it("an open panel fills in live as new events arrive", async () => {
    const { rerender } = render(<RunCast run={{ ...run, live: true }} events={fixtureEvents(n("search:1"))} />)
    fireEvent.click(screen.getByRole("button", { name: /^Details of Scout/ }))
    const panel = await screen.findByRole("dialog")
    expect(panel).toHaveTextContent("Searching for round 1")
    expect(panel).toHaveTextContent("Recorded with its first reply")
    rerender(<RunCast run={{ ...run, live: true }} events={fixtureEvents(n("reply:1:scout"))} />)
    await waitFor(() => expect(panel).toHaveTextContent("Replied in round 1. Waiting for the next round."))
    expect(panel).toHaveTextContent("1,500")
    expect(panel).toHaveTextContent("read when it replied in round 1")
  })

  it("a source's panel names the statements that rest on it, with each mark", async () => {
    render(<RunCast run={run} events={fixtureEvents()} />)
    fireEvent.click(screen.getByRole("button", { name: "CodeBreaK 200 (fixture)" }))
    const panel = await screen.findByRole("dialog")
    expect(within(panel).getByRole("heading", { name: "CodeBreaK 200 (fixture)" })).toBeInTheDocument()
    expect(within(panel).getByRole("button", { name: "NCT04303780 met its primary end point with a large gain." })).toBeInTheDocument()
    expect(panel).toHaveTextContent("Insufficient evidence")
    expect(panel).toHaveTextContent("2 rulings, the latest by Second check (OpenAI)")
  })
})

describe("ways in", () => {
  it("the Details button beside an agent's name in the Agent Log opens its details, when the page offers them", () => {
    const onAgent = vi.fn()
    render(<EventLog rows={eventRows(fixtureEvents(), "board")} run={{ id: FIXTURE_RUN, kind: "board" }} connection="ended" onDetails={onAgent} />)
    fireEvent.click(screen.getAllByRole("button", { name: "Details of Scout (Data and Evidence)" })[0])
    expect(onAgent).toHaveBeenCalledWith("scout")
  })
  it("without the callback the names stay plain text", () => {
    render(<EventLog rows={eventRows(fixtureEvents(), "board")} run={{ id: FIXTURE_RUN, kind: "board" }} connection="ended" />)
    expect(screen.queryByRole("button", { name: /^Details of/ })).toBeNull()
  })
  it("a graph node of a team review opens the matching panel; a round or the brief opens none", () => {
    const node = (id: string, text?: string) => ({ id, text, kind: "agent", label: id, order: 1, attention: 0, facts: [], activity: [] }) as GraphNode
    expect(detailOf(node("agent:scout"))).toEqual({ kind: "agent", id: "scout" })
    expect(detailOf(node("agent:lead"))).toEqual({ kind: "agent", id: "lead-scientist" })
    expect(detailOf(node("checker:first-pass"))).toEqual({ kind: "agent", id: "first-pass" })
    expect(detailOf(node(`source:${TRIAL}`))).toEqual({ kind: "entity", ref: { kind: "source", url: TRIAL } })
    expect(detailOf(node("claim:critic:abc123", "A statement."))).toEqual({ kind: "entity", ref: { kind: "claim", agent: "critic", text: "A statement." } })
    expect(detailOf(node("source:brief"))).toBeUndefined()
    expect(detailOf(node("phase:1"))).toBeUndefined()
  })
})

describe("the Agents view's card", () => {
  class FakeSource {
    static last: FakeSource
    url: string; onmessage?: (m: { data: string }) => void; closed = false
    constructor(url: string) { this.url = url; FakeSource.last = this }
    close() { this.closed = true }
  }
  beforeEach(() => { forgetRoster(); vi.stubGlobal("EventSource", FakeSource) })

  it("shows what the agent did in the newest team review, live from its event stream", async () => {
    routes({ "GET /api/runs": { status: 200, body: [{ id: FIXTURE_RUN, brief: "kras-g12c-hit-to-lead.md", startedAt: Date.UTC(2026, 10, 15, 9), status: "running", rounds: 1, claims: 0 }] }, "GET /api/roster": { status: 200, body: ROSTER } })
    render(<LatestReview agent="scout" />)
    await waitFor(() => expect(FakeSource.last?.url).toMatch(new RegExp(`/api/runs/${FIXTURE_RUN}/events$`)))
    act(() => { for (const e of fixtureEvents(n("search:2"))) FakeSource.last.onmessage?.({ data: JSON.stringify(e) }) })
    const part = screen.getByRole("region", { name: "In the newest team review" })
    expect(part).toHaveTextContent("Kras g12c hit to lead")
    expect(within(part).getByRole("heading", { name: "Scout (Data and Evidence)" })).toBeInTheDocument()
    expect(part).toHaveTextContent("Searching for round 1")
    act(() => { for (const e of fixtureEvents().slice(n("search:2"))) FakeSource.last.onmessage?.({ data: JSON.stringify(e) }) })
    expect(part).toHaveTextContent("Finished. It replied in rounds 1, 2.")
    expect(part).toHaveTextContent("3,120")
  })

  it("says so when there is no team review yet", async () => {
    routes({ "GET /api/runs": { status: 200, body: [] }, "GET /api/roster": { status: 200, body: ROSTER } })
    render(<LatestReview agent="scout" />)
    expect(await screen.findByText("No team review yet, so there is nothing this agent did to show.")).toBeInTheDocument()
  })
})
