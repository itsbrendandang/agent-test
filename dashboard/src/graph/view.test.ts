import { describe, expect, it } from "vitest"
import { BOARD_EVENTS, ROSTER, SWARM_DETAIL } from "./fixtures"
import { buildBoardGraph, buildSwarmGraph } from "./model"
import { MAX_NODES, type GraphModel, type GraphNode } from "./types"
import { ALL, applyView, byAttention, capGraph, connectionsOf, countVerdicts, layoutView, neighbourMap, reveal, searchNodes } from "./view"

const board = () => buildBoardGraph({ runId: "r1", events: BOARD_EVENTS, roster: ROSTER })
const swarm = () => buildSwarmGraph(SWARM_DETAIL)
const ids = (v: { nodes: GraphNode[] }) => v.nodes.map((n) => n.id)
const consistent = (v: ReturnType<typeof applyView>) => {
  const have = new Set(ids(v))
  for (const l of v.links) { expect(have.has(l.source)).toBe(true); expect(have.has(l.target)).toBe(true) }
}

describe("applyView: time", () => {
  const g = board()
  it("shows everything with no step and nothing but the run at step 0", () => {
    expect(applyView(g, ALL).nodes).toHaveLength(g.nodes.length)
    expect(ids(applyView(g, { ...ALL, step: 0 }))).toEqual(["run"])
  })
  it("grows monotonically with the step and never has a link to a node that is not there yet", () => {
    let last = 0, lastLinks = 0
    for (let s = 0; s <= g.maxOrder; s++) {
      const v = applyView(g, { ...ALL, step: s })
      consistent(v)
      expect(v.nodes.length).toBeGreaterThanOrEqual(last); expect(v.links.length).toBeGreaterThanOrEqual(lastLinks)
      last = v.nodes.length; lastLinks = v.links.length
    }
    expect(last).toBe(g.nodes.length)
    expect(lastLinks).toBe(g.links.length)
  })
  it("shows round 2 only from its mark on", () => {
    const r2 = g.marks[1].order
    expect(ids(applyView(g, { ...ALL, step: r2 - 1 }))).not.toContain("phase:2")
    expect(ids(applyView(g, { ...ALL, step: r2 }))).toContain("phase:2")
  })
  it("steps through a swarm log in order", () => {
    const s = swarm()
    const at = (n: number) => ids(applyView(s, { ...ALL, step: n }))
    const claimStep = s.nodes.find((n) => n.id === "claim:C1")!.order
    expect(at(claimStep - 1)).not.toContain("claim:C1")
    expect(at(claimStep)).toContain("claim:C1")
  })
})

describe("applyView: filters", () => {
  const g = board()
  it("hides a kind and what only hung on it", () => {
    const v = applyView(g, { ...ALL, hiddenKinds: new Set(["claim"]) })
    expect(v.nodes.some((n) => n.kind === "claim")).toBe(false)
    consistent(v)
    expect(v.nodes.some((n) => n.kind === "checker")).toBe(false) // checkers only ruled on claims
    expect(v.nodes.some((n) => n.kind === "agent")).toBe(true)
  })
  it("keeps the run even if its kind is hidden", () => {
    expect(ids(applyView(g, { ...ALL, hiddenKinds: new Set(["run"]) }))).toContain("run")
  })
  it("filters claims by verdict class and leaves other nodes alone", () => {
    const only = applyView(g, { ...ALL, hiddenVerdicts: new Set(["holds", "unknown"]) })
    const claims = only.nodes.filter((n) => n.kind === "claim")
    expect(claims.length).toBe(1)
    expect(claims[0].verdict?.cls).toBe("fails")
    expect(only.nodes.some((n) => n.kind === "agent")).toBe(true)
    consistent(only)
  })
  it("filters swarm tests by verdict too", () => {
    const s = swarm()
    const v = applyView(s, { ...ALL, hiddenVerdicts: new Set(["fails"]) })
    expect(ids(v)).not.toContain("claim:C2")
    expect(ids(v)).not.toContain("test:C2:row count")
    expect(ids(v)).toContain("claim:C1")
    consistent(v)
  })
  it("combines a step and a filter", () => {
    const v = applyView(g, { hiddenKinds: new Set(["source"]), hiddenVerdicts: new Set(), hiddenLinks: new Set(), step: g.marks[0].order })
    expect(v.nodes.some((n) => n.kind === "source")).toBe(false)
    expect(ids(v)).toContain("phase:1")
    consistent(v)
  })
})

describe("applyView: lines", () => {
  const g = board()
  it("hides a kind of line, keeps its nodes, and still reports it as a connection", () => {
    const v = applyView(g, { ...ALL, hiddenLinks: new Set(["in-phase", "involves"]) })
    expect(v.links.some((l) => l.kind === "in-phase" || l.kind === "involves")).toBe(false)
    expect(v.connections.some((l) => l.kind === "in-phase")).toBe(true)
    expect(v.nodes).toHaveLength(g.nodes.length)
    expect(v.links.length).toBeLessThan(v.connections.length)
  })
})

describe("neighbours, connections, search", () => {
  const g = board()
  const claim = (text: string) => g.nodes.find((n) => n.kind === "claim" && n.label.includes(text))!
  const X = claim("Piperazine").id
  it("lists neighbours both ways", () => {
    const m = neighbourMap(g.links)
    expect(m.get(X)).toEqual(new Set(["agent:scout", "checker:first-pass", "phase:1", "source:https://example.org/a"]))
    expect(m.get("agent:scout")!.has(X)).toBe(true)
  })
  it("describes a connection as a sentence from the actor's side, with the shared verbs", () => {
    const c = connectionsOf(X, g.nodes, g.links)
    const sentences = c.map((x) => x.sentence)
    expect(sentences).toContain("Scout (Data Inspector) said " + claim("Piperazine").label)
    expect(sentences.some((t) => t.startsWith("First check checked Piperazine"))).toBe(true)
    expect(sentences.some((t) => t.endsWith("cites hERG of acrylamides"))).toBe(true)
    expect(c.every((x) => !x.outgoing || x.link.source === X)).toBe(true)
    expect(connectionsOf("nope", g.nodes, g.links)).toEqual([])
  })
  it("finds nodes by any word and puts contradicted ones first", () => {
    const hits = searchNodes(g.nodes, "hERG")
    expect(hits.length).toBeGreaterThan(2)
    expect(hits[0].verdict?.cls).toBe("fails")
    expect(searchNodes(g.nodes, "herg 6 uM").every((n) => /herg/i.test(JSON.stringify(n)))).toBe(true)
    expect(searchNodes(g.nodes, "")).toEqual([])
    expect(searchNodes(g.nodes, "zzzz-nothing")).toEqual([])
    expect(searchNodes(g.nodes, "contradicted")[0].id).toBe(X)
  })
  it("sorts contradicted and refuted before the rest", () => {
    const sorted = [...g.nodes].sort(byAttention)
    expect(sorted[0].attention).toBe(2)
    const att = sorted.map((n) => n.attention)
    expect(att).toEqual([...att].sort((a, b) => b - a))
  })
  it("counts verdicts of claims only", () => {
    expect(countVerdicts(g.nodes)).toEqual({ holds: 2, fails: 1, unknown: 2 })
  })
})

describe("layoutView and reveal: a replay keeps nodes where they are", () => {
  const g = board()
  it("lays out everything that passes the filters, whatever the step", () => {
    const l = layoutView(g, { ...ALL, step: 3 })
    expect(l.nodes).toHaveLength(g.nodes.length)
  })
  it("reveals only what has happened by the step", () => {
    const l = layoutView(g, ALL)
    expect(reveal(l, null)).toEqual({ nodes: null, links: null })
    const r = reveal(l, g.marks[1].order - 1)
    expect(r.nodes!.has("phase:2")).toBe(false)
    expect(r.nodes!.has("phase:1")).toBe(true)
    const all = reveal(l, g.maxOrder)
    expect(all.nodes!.size).toBe(l.nodes.length)
    expect(all.links!.size).toBe(l.links.length)
    for (const id of r.links!) { const link = l.links.find((x) => x.id === id)!; expect(r.nodes!.has(link.source) && r.nodes!.has(link.target)).toBe(true) }
  })
})

describe("capGraph", () => {
  const big = (n: number): GraphModel => {
    const base = board()
    const claims: GraphNode[] = Array.from({ length: n }, (_, i) => ({
      id: `claim:big${i}`, kind: "claim", label: `claim ${i}`, order: i + 1, attention: i === n - 1 ? 2 : 0,
      verdict: { cls: i === n - 1 ? "fails" : "holds", raw: "x" }, facts: [], activity: [],
    }))
    const sources: GraphNode[] = Array.from({ length: n }, (_, i) => ({ id: `source:big${i}`, kind: "source", label: `s${i}`, order: i + 1, attention: 0, facts: [], activity: [] }))
    const nodes = [...base.nodes, ...claims, ...sources]
    return { ...base, nodes, links: [...base.links, { id: "x", source: "agent:skeptic", target: `claim:big${n - 1}`, kind: "made", order: n, label: "made" }, { id: "y", source: "agent:skeptic", target: "source:big0", kind: "retrieved", order: 1, label: "" }] }
  }
  it("leaves a small graph alone", () => { const g = board(); expect(capGraph(g)).toBe(g); expect(capGraph(g).hidden).toBe(0) })
  it("keeps structure and the refuted claim, drops sources first, and says so", () => {
    const g = capGraph(big(500))
    expect(g.nodes.length).toBe(MAX_NODES)
    expect(g.hidden).toBe(board().nodes.length + 1000 - MAX_NODES)
    expect(g.nodes.some((n) => n.id === `claim:big499`)).toBe(true) // the one refuted claim survives
    expect(g.nodes.filter((n) => n.kind === "agent").length).toBe(board().nodes.filter((n) => n.kind === "agent").length)
    expect(g.nodes.filter((n) => n.kind === "source").length).toBeLessThan(500)
    const have = new Set(g.nodes.map((n) => n.id))
    for (const l of g.links) { expect(have.has(l.source) && have.has(l.target)).toBe(true) }
    expect(g.notes.at(-1)).toContain(`${MAX_NODES} most important`)
    expect(new Set(g.nodes.map((n) => n.id)).size).toBe(g.nodes.length)
  })
})
