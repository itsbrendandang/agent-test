import { describe, expect, it } from "vitest"
import type { BoardEvent } from "@/board/api"
import { BOARD_EVENTS, EVIL, ROSTER, SINGLE_DETAIL, SWARM_DETAIL } from "./fixtures"
import { buildBoardGraph, buildSwarmGraph, safeUrl } from "./model"
import { NODE_KINDS, type GraphModel, type LinkKind, type NodeKind } from "./types"

const board = () => buildBoardGraph({ runId: "r1", events: BOARD_EVENTS, roster: ROSTER })
const swarm = () => buildSwarmGraph(SWARM_DETAIL)
const kinds = (g: GraphModel) => new Set(g.nodes.map((n) => n.kind))
const linkKinds = (g: GraphModel) => new Set(g.links.map((l) => l.kind))
const find = (g: GraphModel, id: string) => g.nodes.find((n) => n.id === id)!

function invariants(g: GraphModel) {
  const ids = g.nodes.map((n) => n.id)
  expect(new Set(ids).size).toBe(ids.length)
  const have = new Set(ids)
  for (const l of g.links) { expect(have.has(l.source), l.id).toBe(true); expect(have.has(l.target), l.id).toBe(true) }
  expect(new Set(g.links.map((l) => l.id)).size).toBe(g.links.length)
  for (const l of g.links) {
    expect(l.order).toBeGreaterThanOrEqual(find(g, l.source).order)
    expect(l.order).toBeGreaterThanOrEqual(find(g, l.target).order)
    expect(l.source).not.toBe(l.target)
  }
  for (const n of g.nodes) expect(n.order).toBeLessThanOrEqual(g.maxOrder)
  expect(g.steps.length).toBeGreaterThanOrEqual(g.maxOrder)
}

const claimWith = (g: GraphModel, text: string) => g.nodes.find((n) => n.kind === "claim" && n.label.includes(text))!

describe("board graph", () => {
  const g = board()
  it("has no duplicate ids and no edge to a missing node", () => invariants(g))
  it("has the run, members, checkers, rounds, claims, sources and the memo", () => {
    for (const k of ["run", "agent", "checker", "phase", "claim", "source", "artifact"] as NodeKind[]) expect(kinds(g).has(k), k).toBe(true)
    expect(kinds(g).has("test")).toBe(false)
    expect(kinds(g).has("issue")).toBe(false)
  })
  it("draws exactly the edges the events record", () => {
    expect([...linkKinds(g)].sort()).toEqual(["cites", "framed", "in-phase", "involves", "made", "next", "produced", "replied", "retrieved", "ruled"].sort())
    const has = (k: LinkKind, s: string, t: string) => g.links.some((l) => l.kind === k && l.source === s && l.target === t)
    const x = claimWith(g, "Piperazine").id
    expect(has("made", "agent:scout", x)).toBe(true)
    expect(has("ruled", "checker:first-pass", x)).toBe(true)
    expect(has("ruled", "checker:claude-code", claimWith(g, "TPSA").id)).toBe(true)
    expect(has("replied", "agent:critic", "phase:1")).toBe(true)
    expect(has("retrieved", "agent:scout", "source:https://example.org/a")).toBe(true)
    expect(has("next", "phase:1", "phase:2")).toBe(true)
    expect(has("next", "run", "phase:1")).toBe(true)
    expect(has("framed", "agent:lead", "run")).toBe(true)
    expect(has("produced", "run", "artifact:memo")).toBe(true)
  })
  it("uses the words of the shared glossary for lines", () => {
    expect(g.links.find((l) => l.kind === "made")!.label).toBe("said")
    expect(g.links.find((l) => l.kind === "ruled")!.label).toBe("checked")
    expect(g.links.find((l) => l.kind === "retrieved")!.label).toBe("used")
    expect(g.links.find((l) => l.kind === "cites")!.label).toBe("cites")
  })
  it("links a claim to a source only when the data names it, and in no other case", () => {
    const cites = g.links.filter((l) => l.kind === "cites")
    // brief claims cite the brief; a claim whose `source` is the address of a kept source cites that source
    expect(cites.map((l) => `${l.source}>${l.target}`).sort()).toEqual([
      `${claimWith(g, "Neither").id}>source:brief`, `${claimWith(g, "CMP-0517").id}>source:brief`, `${claimWith(g, "Piperazine").id}>source:https://example.org/a`,
    ].sort())
    // a source that is not among the kept ones, and a free-text one, are never turned into a node or a line
    expect(g.nodes.some((n) => n.id.includes("not-in-the-pool"))).toBe(false)
    expect(g.links.some((l) => l.source === claimWith(g, "MET").id && l.kind === "cites")).toBe(false)
    expect(g.links.some((l) => l.source === claimWith(g, "TPSA").id && l.kind === "cites")).toBe(false)
    expect(claimWith(g, "MET").facts).toContainEqual({ label: "Cited source", value: "https://not-in-the-pool.example/x" })
    expect(claimWith(g, "TPSA").facts).toContainEqual({ label: "What was computed", value: "TPSA from the SMILES with RDKit" })
    expect(g.notes.join(" ")).toMatch(/linked to a source only when/)
  })
  it("says a claim has no source when the run predates the source field", () => {
    const old = buildBoardGraph({ runId: "r1", events: BOARD_EVENTS.map((e) => { const { source: _s, ...rest } = e as BoardEvent & { source?: string }; return rest as BoardEvent }), roster: ROSTER })
    invariants(old)
    expect(old.links.filter((l) => l.kind === "cites").every((l) => l.target === "source:brief")).toBe(true)
    expect(old.notes.join(" ")).toMatch(/does not record which source a statement cites/)
  })
  it("merges a claim that comes back in a later round, and keeps the latest ruling", () => {
    expect(g.nodes.filter((n) => n.kind === "claim")).toHaveLength(5)
    const y = claimWith(g, "CMP-0517")
    expect(y.facts).toContainEqual({ label: "Rounds", value: "1, 2" })
    expect(y.activity).toHaveLength(2)
    expect(g.links.filter((l) => l.kind === "in-phase" && l.source === y.id).map((l) => l.target).sort()).toEqual(["phase:1", "phase:2"])
    const changed = BOARD_EVENTS.map((e) => (e.key === "claim:2:scout:b" ? ({ ...e, verdict: "contradicted" } as BoardEvent) : e))
    const h = buildBoardGraph({ runId: "r1", events: changed, roster: ROSTER })
    const y2 = claimWith(h, "CMP-0517")
    expect(y2.verdict?.raw).toBe("contradicted")
    expect(y2.facts.find((f) => f.label === "Verdict changed")?.value).toBe("round 1: verified; round 2: contradicted")
  })
  it("treats the old checker name jev as the first-pass checker", () => {
    expect(g.nodes.filter((n) => n.kind === "checker").map((n) => n.id).sort()).toEqual(["checker:claude-code", "checker:first-pass", "checker:openai"])
  })
  it("maps verdicts to classes and attention", () => {
    const x = claimWith(g, "Piperazine")
    expect(x.verdict).toEqual({ cls: "fails", raw: "contradicted" })
    expect(x.attention).toBe(2)
    expect(claimWith(g, "TPSA").verdict).toEqual({ cls: "holds", raw: "verified" })
    expect(claimWith(g, "Neither").verdict?.cls).toBe("unknown")
    expect(claimWith(g, "MET").verdict).toEqual({ cls: "unknown", raw: "unchecked" })
    expect(claimWith(g, "MET").attention).toBe(1)
  })
  it("orders nodes by when the events happened", () => {
    expect(find(g, "run").order).toBe(0)
    expect(find(g, "phase:1").order).toBeLessThan(find(g, "phase:2").order)
    expect(g.marks.map((m) => m.label)).toEqual(["Round 1", "Round 2"])
    expect(g.maxOrder).toBe(BOARD_EVENTS.length)
  })
  it("orders by timestamp even when the events arrive shuffled", () => {
    const h = buildBoardGraph({ runId: "r1", events: [...BOARD_EVENTS].reverse(), roster: ROSTER })
    expect(h.nodes.map((n) => [n.id, n.order]).sort()).toEqual(g.nodes.map((n) => [n.id, n.order]).sort())
  })
  it("reads the scripted flag from the run's own run.started event", () => {
    expect(g.scripted).toBe(true)
    expect(find(g, "run").facts.find((f) => f.label === "Made with")).toBeUndefined() // a practice run is stated once, by the banner
    const real = BOARD_EVENTS.map((e) => (e.type === "run.started" ? { ...e, mock: false } : e))
    const liveRun = buildBoardGraph({ runId: "r1", events: real })
    expect(liveRun.scripted).toBe(false)
    expect(find(liveRun, "run").facts.find((f) => f.label === "Made with")?.value).toMatch(/Live research/)
    const none = buildBoardGraph({ runId: "r1", events: BOARD_EVENTS.filter((e) => e.type !== "run.started") })
    expect(none.scripted).toBeUndefined()
    expect(none.notes.join(" ")).toMatch(/does not say whether/)
  })
  it("uses roster titles only for display and summarises what a member did", () => {
    const scout = find(g, "agent:scout")
    expect(scout.label).toBe("Scout (Data Inspector)")
    expect(scout.facts.find((f) => f.label === "Replies")?.value).toBe("2")
    expect(scout.facts.find((f) => f.label === "Statements")?.value).toBe("2: 1 supported, 1 contradicted")
    expect(scout.activity.length).toBeGreaterThanOrEqual(3)
    expect(buildBoardGraph({ runId: "r1", events: BOARD_EVENTS }).nodes.find((n) => n.id === "agent:critic")!.label).toBe("critic")
  })
  it("keeps untrusted text as text and links only http(s) addresses", () => {
    expect(claimWith(g, "Piperazine").text).toContain(EVIL)
    const bad = g.nodes.find((n) => n.id === "source:javascript:alert(1)")!
    expect(bad.label).toContain("<img")
    expect(bad.url).toBeUndefined()
    expect(find(g, "source:https://example.org/a").url).toBe("https://example.org/a")
    expect(safeUrl("data:text/html,x")).toBeUndefined()
    expect(safeUrl("not a url")).toBeUndefined()
  })
  it("records how the run ended", () => {
    expect(g.status).toBe("done")
    expect(find(g, "run").facts.map((f) => f.label)).toEqual(expect.arrayContaining(["Cost", "Took", "Wrap-up"]))
    expect(find(g, "artifact:memo").facts.find((f) => f.label === "File")?.value).toBe("memo.md") // not the absolute path
    const failed = buildBoardGraph({ runId: "r1", events: [...BOARD_EVENTS.slice(0, 5), { type: "run.failed", error: "boom", key: "f", at: 1 }] })
    expect(failed.status).toBe("failed")
  })
  it("counts the run for its headline before any size cap", () => {
    expect(g.totals).toMatchObject({ members: 4, claims: 5, rounds: 2, byVerdict: { verified: 2, contradicted: 1, unsupported: 1, unchecked: 1 } })
  })
  it("handles a run in progress and an empty run", () => {
    const live = buildBoardGraph({ runId: "r1", events: BOARD_EVENTS.slice(0, 8) })
    expect(live.status).toBe("running")
    invariants(live)
    const empty = buildBoardGraph({ runId: "r1", events: [] })
    expect(empty.nodes.map((n) => n.id)).toEqual(["run"])
    expect(empty.links).toEqual([])
    expect(empty.maxOrder).toBe(0)
  })
  it("survives events with missing fields", () => {
    const odd = [{ type: "evidence.triaged", member: "x", query: "q", kept: 0, dropped: 0, key: "k", at: 1 }, { type: "claim.checked", round: 1, member: "x", claim: "c", kind: "literature", verdict: "mystery", checker: "jev", key: "c", at: 2 }] as never
    const h = buildBoardGraph({ runId: "r", events: odd })
    invariants(h)
    expect(h.nodes.find((n) => n.kind === "claim")!.verdict).toEqual({ cls: "unknown", raw: "mystery" }) // an unknown word is never treated as a hold
  })
})

describe("swarm graph", () => {
  const g = swarm()
  it("has no duplicate ids and no edge to a missing node", () => invariants(g))
  it("has every node kind a swarm run records", () => {
    for (const k of ["run", "agent", "phase", "claim", "test", "issue", "artifact"] as NodeKind[]) expect(kinds(g).has(k), k).toBe(true)
    expect(kinds(g).has("source")).toBe(false)
    expect(kinds(g).has("checker")).toBe(false)
    expect(NODE_KINDS.every((k) => ["source", "checker"].includes(k) || kinds(g).has(k))).toBe(true)
  })
  it("draws exactly the edges the ledger records", () => {
    expect([...linkKinds(g)].sort()).toEqual(["about", "against", "in-phase", "involves", "made", "next", "produced", "raised", "recorded", "registered", "resolved", "targets"].sort())
    const has = (k: LinkKind, s: string, t: string) => g.links.some((l) => l.kind === k && l.source === s && l.target === t)
    expect(has("made", "agent:planner", "claim:C1")).toBe(true)
    expect(has("targets", "test:C1:label permutation", "claim:C1")).toBe(true)
    expect(has("registered", "agent:critic", "test:C1:label permutation")).toBe(true)
    expect(has("recorded", "agent:critic", "test:C1:label permutation")).toBe(true)
    expect(has("raised", "agent:critic", "issue:I1")).toBe(true)
    expect(has("resolved", "agent:experimenter", "issue:I1")).toBe(true)
    expect(has("against", "issue:I1", "artifact:gene_counts")).toBe(true)
    expect(has("about", "claim:C2", "artifact:treated_vs_control")).toBe(true)
    expect(has("produced", "run", "artifact:gene_counts")).toBe(true)
    expect(has("in-phase", "claim:C1", "phase:propose")).toBe(true)
    expect(has("in-phase", "issue:I1", "phase:critique 1")).toBe(true)
    expect(has("next", "phase:propose", "phase:pilot")).toBe(true)
  })
  it("does not invent role-to-artefact or issue-to-claim edges", () => {
    for (const l of g.links) {
      if (l.kind === "produced") expect(l.source).toBe("run")
      if (l.kind === "against") expect(l.target.startsWith("artifact:")).toBe(true)
    }
    expect(g.links.some((l) => l.source.startsWith("issue:") && l.target.startsWith("claim:"))).toBe(false)
    expect(g.notes.join(" ")).toMatch(/does not record which role wrote an output/)
    expect(g.notes.join(" ")).toMatch(/does not say which statement a problem is about/)
  })
  it("maps the ledger's verdicts and tests", () => {
    expect(find(g, "claim:C1").verdict).toEqual({ cls: "holds", raw: "supported" })
    expect(find(g, "claim:C2").verdict).toEqual({ cls: "fails", raw: "refuted" })
    expect(find(g, "claim:C2").attention).toBe(2)
    expect(find(g, "claim:C3").verdict).toEqual({ cls: "unknown", raw: "insufficient" })
    // the registered name "Row Count" and the result "row count" are one test
    expect(g.nodes.filter((n) => n.kind === "test")).toHaveLength(3)
    expect(find(g, "test:C2:row count").verdict?.cls).toBe("fails")
    expect(find(g, "test:C3:pca").verdict).toEqual({ cls: "unknown", raw: "no result yet" })
    expect(find(g, "test:C1:label permutation").verdict).toBeUndefined()
    expect(find(g, "issue:I2").attention).toBe(1)
    expect(find(g, "issue:I1").attention).toBe(0)
  })
  it("orders by the position in the ledger log", () => {
    expect(find(g, "claim:C1").order).toBeLessThan(find(g, "test:C1:label permutation").order)
    expect(find(g, "phase:propose").order).toBeLessThan(find(g, "phase:critique 1").order)
    expect(find(g, "agent:planner").order).toBe(3)
    expect(find(g, "artifact:gene_counts").order).toBeGreaterThanOrEqual(find(g, "claim:C1").order)
    expect(g.marks.map((m) => m.label)).toEqual(["Proposer", "Pilot (did not run)", "Critic · review round 1", "Reviser · review round 1"])
    expect(find(g, "phase:pilot").label).toBe("Pilot") // the label stays the plain name
    expect(find(g, "phase:pilot").muted).toBe(true)
    expect(find(g, "phase:pilot").facts).toContainEqual({ label: "Did it run?", value: "no (plan)" })
    expect(find(g, "phase:propose").muted).toBeUndefined()
    expect(g.steps).toHaveLength(g.maxOrder)
  })
  it("labels scripted and demo runs from the run's own fields", () => {
    expect(g.scripted).toBe(true)
    expect(g.demo).toBe(true)
    const real = buildSwarmGraph({ ...SWARM_DETAIL, run: { ...SWARM_DETAIL.run, model: "anthropic/claude-sonnet-5-5", task: "bixbench3-x" } })
    expect(real.scripted).toBe(false)
    expect(real.demo).toBe(false)
  })
  it("keeps untrusted text as text", () => {
    const c2 = find(g, "claim:C2")
    expect(c2.text).toContain(EVIL)
    expect(c2.label).toContain("<img")
  })
  it("shows a single agent run as the run and its graded artefacts, and says why", () => {
    const s = buildSwarmGraph(SINGLE_DETAIL)
    invariants(s)
    expect(s.nodes.map((n) => n.id).sort()).toEqual(["artifact:gene_counts", "run"])
    expect(s.notes.join(" ")).toMatch(/single agent keeps no shared record/i)
  })
  it("handles a run with no events and a run in progress", () => {
    const none = buildSwarmGraph({ ...SWARM_DETAIL, ledger: { ...SWARM_DETAIL.ledger!, claims: [], issues: [], events: [] }, run: { ...SWARM_DETAIL.run, artifacts: [] } })
    expect(none.nodes.map((n) => n.id)).toEqual(["run"])
    const live = buildSwarmGraph({ ...SWARM_DETAIL, run: { ...SWARM_DETAIL.run, phase: "running", artifacts: undefined, score: undefined }, ledger: { ...SWARM_DETAIL.ledger!, events: SWARM_DETAIL.ledger!.events.slice(0, 6) } })
    invariants(live)
    expect(live.status).toBe("running")
  })
  it("drops an edge whose node the ledger does not have", () => {
    const l = SWARM_DETAIL.ledger!
    const h = buildSwarmGraph({ ...SWARM_DETAIL, ledger: { ...l, events: [...l.events, { kind: "issue.resolved", issue: "I9", status: "fixed", by: "experimenter" }] } })
    invariants(h)
    expect(h.links.some((x) => x.target === "issue:I9")).toBe(false)
  })
  it("still draws claims from a ledger without events", () => {
    const l = SWARM_DETAIL.ledger!
    const h = buildSwarmGraph({ ...SWARM_DETAIL, ledger: { ...l, events: [] } })
    invariants(h)
    expect(h.nodes.filter((n) => n.kind === "claim")).toHaveLength(3)
    expect(h.nodes.every((n) => n.order <= h.maxOrder)).toBe(true)
  })
})

describe("board graph: stage titles, notices and lanes (optional fields)", () => {
  const titled: BoardEvent[] = BOARD_EVENTS.map((e) => {
    if (e.type === "round.started" && e.round === 1) return { ...e, title: "Preclinical" }
    if (e.type === "evidence.triaged" && e.member === "critic") return { ...e, items: [{ url: "https://example.org/a", title: "hERG of acrylamides", notice: { type: "retraction", url: "javascript:alert(1)", date: "2024", what: "Peer review was manipulated." } }] } as BoardEvent
    return e
  })
  it("names a round by its title when the run gives one, and keeps the plain name otherwise", () => {
    const g = buildBoardGraph({ runId: "r1", events: titled, roster: ROSTER })
    expect(find(g, "phase:1").label).toBe("Round 1: Preclinical")
    expect(find(g, "phase:2").label).toBe("Round 2")
    expect(g.marks.map((m) => m.label)).toEqual(["1. Preclinical", "Round 2"])
  })
  it("flags a source with a published notice, and never links an unsafe notice address", () => {
    const g = buildBoardGraph({ runId: "r1", events: titled, roster: ROSTER })
    const s = find(g, "source:https://example.org/a")
    expect(s.flag).toEqual({ type: "retraction", what: "Peer review was manipulated.", url: undefined, date: "2024" })
    expect(s.attention).toBe(2)
    expect(s.facts.find((f) => f.label === "What was wrong")?.value).toBe("Peer review was manipulated.")
    expect(s.facts.some((f) => f.label === "Notice")).toBe(false)
  })
  it("draws no lanes, keeps the clock and the run's own label for a run (lanes are the built-in example's)", () => {
    const g = board()
    expect(g.lanes).toBeUndefined()
    expect(g.example).toBeUndefined()
    expect(g.nodes.every((n) => n.lane === undefined && n.flag === undefined)).toBe(true)
    expect(g.steps.some((s) => s.at !== undefined)).toBe(true)
    expect(g.scripted).toBe(true)
  })
})
