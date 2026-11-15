import { describe, expect, it } from "vitest"
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

describe("board graph", () => {
  const g = board()
  it("has no duplicate ids and no edge to a missing node", () => invariants(g))
  it("has the run, agents, checkers, rounds, claims, sources and the memo", () => {
    for (const k of ["run", "agent", "checker", "phase", "claim", "source", "artifact"] as NodeKind[]) expect(kinds(g).has(k), k).toBe(true)
    expect(kinds(g).has("test")).toBe(false)
    expect(kinds(g).has("issue")).toBe(false)
  })
  it("draws exactly the edges the events record", () => {
    expect([...linkKinds(g)].sort()).toEqual(["cites", "framed", "in-phase", "involves", "made", "next", "produced", "replied", "retrieved", "ruled"].sort())
    const has = (k: LinkKind, s: string, t: string) => g.links.some((l) => l.kind === k && l.source === s && l.target === t)
    expect(has("made", "agent:toxicologist", "claim:claim:1:tox:a")).toBe(true)
    expect(has("ruled", "checker:jev", "claim:claim:1:tox:a")).toBe(true)
    expect(has("ruled", "checker:claude-code", "claim:claim:1:mc:a")).toBe(true)
    expect(has("replied", "agent:skeptic", "phase:1")).toBe(true)
    expect(has("retrieved", "agent:toxicologist", "source:https://example.org/a")).toBe(true)
    expect(has("next", "phase:1", "phase:2")).toBe(true)
    expect(has("next", "run", "phase:1")).toBe(true)
    expect(has("framed", "agent:lead", "run")).toBe(true)
    expect(has("produced", "run", "artifact:memo")).toBe(true)
  })
  it("never links a claim to a source the data does not name", () => {
    // claim.checked has no source field: only claims of kind "brief" cite something (the brief)
    const cites = g.links.filter((l) => l.kind === "cites")
    expect(new Set(cites.map((l) => l.target))).toEqual(new Set(["source:brief"]))
    expect(cites.map((l) => l.source).sort()).toEqual(["claim:claim:1:sk:a", "claim:claim:1:tox:b", "claim:claim:2:tox:b"].sort())
    for (const l of g.links) if (l.kind === "retrieved") expect(l.source.startsWith("agent:")).toBe(true)
    expect(g.notes.join(" ")).toMatch(/does not record which source a claim cites/)
  })
  it("keeps each ruling as its own claim node and maps verdicts to classes and attention", () => {
    expect(g.nodes.filter((n) => n.kind === "claim")).toHaveLength(6)
    const contradicted = find(g, "claim:claim:1:tox:a")
    expect(contradicted.verdict).toEqual({ cls: "fail", raw: "contradicted" })
    expect(contradicted.attention).toBe(2)
    expect(find(g, "claim:claim:1:tox:b").verdict).toEqual({ cls: "pass", raw: "verified" })
    expect(find(g, "claim:claim:1:sk:a").verdict?.cls).toBe("unknown")
    expect(find(g, "claim:claim:1:sk:b").verdict).toEqual({ cls: "unknown", raw: "unchecked" })
    expect(find(g, "claim:claim:1:sk:b").attention).toBe(1)
  })
  it("orders nodes by when the events happened", () => {
    expect(find(g, "run").order).toBe(0)
    expect(find(g, "phase:1").order).toBeLessThan(find(g, "phase:2").order)
    expect(find(g, "claim:claim:1:tox:a").order).toBeLessThan(find(g, "claim:claim:2:tox:b").order)
    expect(g.marks.map((m) => m.label)).toEqual(["Round 1", "Round 2"])
    expect(g.maxOrder).toBe(BOARD_EVENTS.length)
  })
  it("orders by timestamp even when the events arrive shuffled", () => {
    const shuffled = [...BOARD_EVENTS].reverse()
    const h = buildBoardGraph({ runId: "r1", events: shuffled, roster: ROSTER })
    expect(h.nodes.map((n) => [n.id, n.order]).sort()).toEqual(g.nodes.map((n) => [n.id, n.order]).sort())
  })
  it("reads the scripted flag from the run's own run.started event", () => {
    expect(g.scripted).toBe(true)
    expect(find(g, "run").facts.find((f) => f.label === "Models")?.value).toMatch(/scripted/)
    const real = BOARD_EVENTS.map((e) => (e.type === "run.started" ? { ...e, mock: false } : e))
    expect(buildBoardGraph({ runId: "r1", events: real }).scripted).toBe(false)
    const none = buildBoardGraph({ runId: "r1", events: BOARD_EVENTS.filter((e) => e.type !== "run.started") })
    expect(none.scripted).toBeUndefined()
    expect(none.notes.join(" ")).toMatch(/does not say whether/)
  })
  it("uses roster titles only for display and summarises what an agent did", () => {
    const tox = find(g, "agent:toxicologist")
    expect(tox.label).toBe("Toxicologist")
    expect(tox.facts.find((f) => f.label === "Replies")?.value).toBe("2")
    expect(tox.facts.find((f) => f.label === "Claims made")?.value).toContain("3: 2 verified, 1 contradicted")
    expect(tox.activity.length).toBeGreaterThan(3)
    expect(find(g, "agent:skeptic").label).toBe("Skeptic")
    expect(buildBoardGraph({ runId: "r1", events: BOARD_EVENTS }).nodes.find((n) => n.id === "agent:skeptic")!.label).toBe("skeptic")
  })
  it("keeps untrusted text as text and links only http(s) addresses", () => {
    const claim = find(g, "claim:claim:1:tox:a")
    expect(claim.text).toContain(EVIL)
    const bad = g.nodes.find((n) => n.id === "source:javascript:alert(1)")!
    expect(bad.label).toContain("<img")
    expect(bad.url).toBeUndefined()
    expect(find(g, "source:https://example.org/a").url).toBe("https://example.org/a")
    expect(safeUrl("data:text/html,x")).toBeUndefined()
    expect(safeUrl("not a url")).toBeUndefined()
  })
  it("records how the run ended", () => {
    expect(g.status).toBe("done")
    expect(find(g, "run").facts.map((f) => f.label)).toEqual(expect.arrayContaining(["Cost", "Took", "Wrap-up", "Claims checked"]))
    expect(find(g, "artifact:memo").facts.find((f) => f.label === "File")?.value).toBe("memo.md") // not the absolute path
    const failed = buildBoardGraph({ runId: "r1", events: [...BOARD_EVENTS.slice(0, 5), { type: "run.failed", error: "boom", key: "f", at: 1 }] })
    expect(failed.status).toBe("failed")
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
    expect(find(h, "claim:c").verdict).toEqual({ cls: "unknown", raw: "mystery" }) // an unknown word is never treated as a pass
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
    expect(g.notes.join(" ")).toMatch(/does not record which role wrote an artefact/)
    expect(g.notes.join(" ")).toMatch(/does not say which claim an issue is about/)
  })
  it("maps the ledger's verdicts and tests", () => {
    expect(find(g, "claim:C1").verdict).toEqual({ cls: "pass", raw: "supported" })
    expect(find(g, "claim:C2").verdict).toEqual({ cls: "fail", raw: "refuted" })
    expect(find(g, "claim:C2").attention).toBe(2)
    expect(find(g, "claim:C3").verdict).toEqual({ cls: "unknown", raw: "insufficient" })
    // the registered name "Row Count" and the result "row count" are one test
    expect(g.nodes.filter((n) => n.kind === "test")).toHaveLength(3)
    expect(find(g, "test:C2:row count").verdict?.cls).toBe("fail")
    expect(find(g, "test:C3:pca").verdict).toEqual({ cls: "unknown", raw: "no result" })
    expect(find(g, "test:C1:label permutation").verdict).toBeUndefined()
    expect(find(g, "issue:I2").attention).toBe(1)
    expect(find(g, "issue:I1").attention).toBe(0)
  })
  it("orders by the position in the ledger log", () => {
    expect(find(g, "claim:C1").order).toBeLessThan(find(g, "test:C1:label permutation").order)
    expect(find(g, "phase:propose").order).toBeLessThan(find(g, "phase:critique 1").order)
    expect(find(g, "agent:planner").order).toBe(3)
    expect(find(g, "artifact:gene_counts").order).toBeGreaterThanOrEqual(find(g, "claim:C1").order)
    expect(g.marks.map((m) => m.label)).toEqual(["Proposer", "Pilot (skipped)", "Critic 1", "Reviser 1"])
    expect(find(g, "phase:pilot").label).toBe("Pilot (skipped)")
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
    expect(s.notes.join(" ")).toMatch(/single agent keeps no ledger/i)
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
