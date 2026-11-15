// The addresses that tie the views together: each one is made and read back the same way, and a bad part is dropped.
import { describe, expect, it } from "vitest"
import { runOfLabHash } from "@/lab/runs"
import { runOfHash, viewOfHash } from "@/nav"
import { agentLink, agentOfHash, graphLink, graphOfHash, hasGraph, logLink, logOfHash, runLink } from "./links"

describe("the Agent Log's address", () => {
  it("names a run, a kind of run or nothing, and an agent", () => {
    expect(logLink({ kind: "board", id: "r-1" })).toBe("#Lab/board/r-1")
    expect(logLink({ kind: "answer", id: "a-1" }, "reporter")).toBe("#Lab/answer/a-1?agent=reporter")
    expect(logLink({ kind: "swarm" }, "critique")).toBe("#Lab/swarm?agent=critique")
    expect(logLink(undefined, "scout")).toBe("#Lab?agent=scout")
    expect(logLink()).toBe("#Lab")
    expect(logLink({ kind: "board", id: "r-1" }, "not a name!")).toBe("#Lab/board/r-1") // a name with spaces is dropped
  })
  it("is read back as it was made", () => {
    expect(logOfHash(logLink({ kind: "answer", id: "a-1" }, "reporter"))).toEqual({ kind: "answer", id: "a-1", agent: "reporter" })
    expect(logOfHash("#Lab/board?agent=specialist:admet")).toEqual({ kind: "board", agent: "specialist:admet" })
    expect(logOfHash("#Lab")).toEqual({})
    expect(logOfHash("#Lab/board/")).toEqual({ kind: "board" })
    for (const bad of ["#Board/x", "#Lab/other/x", "#Lab/board/../../etc", "#Lab/board/a b", "#Lab/board/%E0%A4%A", "#Lab/board/x/y"]) expect(logOfHash(bad)).toBeUndefined()
    expect(logOfHash("#Lab/board/r-1?agent=%3Cscript%3E")).toEqual({ kind: "board", id: "r-1" }) // not a name: dropped
  })
  it("keeps the run part the Agent Log has always read, and the shell still finds the view", () => {
    expect(runOfLabHash("#Lab/board/r-1?agent=scout")).toEqual({ kind: "board", id: "r-1" })
    expect(runOfLabHash("#Lab/board?agent=scout")).toBeUndefined()
    expect(viewOfHash("#Lab?agent=scout")).toBe("Lab")
    expect(viewOfHash("#Lab/answer/a-1?agent=reporter")).toBe("Lab")
    expect(viewOfHash("#Agents/scout?from=board")).toBe("Agents")
    expect(viewOfHash("#Graph/board/r-1?node=claim%3Ascout%3Aabc")).toBe("Graph")
    expect(runOfHash("#Board/r-1?x=1")).toBe("r-1") // what follows "?" is the view's own, never part of a run id
  })
})

describe("the graph's address", () => {
  it("names a review or a benchmark run, and a node; answers have no graph", () => {
    const at = graphLink("board", "r-1", "source:https://example.org/a?b=c")
    expect(at).toBe("#Graph/board/r-1?node=source%3Ahttps%3A%2F%2Fexample.org%2Fa%3Fb%3Dc")
    expect(graphOfHash(at)).toEqual({ kind: "board", id: "r-1", node: "source:https://example.org/a?b=c" })
    expect(graphOfHash(graphLink("swarm", "s-1"))).toEqual({ kind: "swarm", id: "s-1" })
    for (const bad of ["#Graph", "#Graph/answer/a-1", "#Graph/board", "#Graph/board/a b", "#Lab/board/r-1"]) expect(graphOfHash(bad)).toBeUndefined()
    expect(graphOfHash("#Graph/board/r-1?node=a%20b")).toEqual({ kind: "board", id: "r-1" }) // a node id has no spaces
    expect(graphOfHash(graphLink("board", "example:pembrolizumab", "agent:lead"))).toEqual({ kind: "board", id: "example:pembrolizumab", node: "agent:lead" })
    for (const bad of ["#Graph/swarm/example%3Apembrolizumab", "#Graph/board/example%3Aother"]) expect(graphOfHash(bad)).toBeUndefined()
    expect([hasGraph("board"), hasGraph("swarm"), hasGraph("answer")]).toEqual([true, true, false])
  })
})

describe("the Agents view's address", () => {
  it("names an agent and the kind of run it was met in", () => {
    expect(agentLink("scout", "board")).toBe("#Agents/scout?from=board")
    expect(agentOfHash(agentLink("scout", "board"))).toEqual({ name: "scout", from: "board" })
    expect(agentOfHash("#Agents/critique")).toEqual({ name: "critique" })
    expect(agentOfHash("#Agents/critique?from=nowhere")).toEqual({ name: "critique" })
    expect(agentLink("<b>")).toBe("#Agents")
    for (const bad of ["#Agents", "#Agents/a b", "#Agents/x/y", "#Lab/scout"]) expect(agentOfHash(bad)).toBeUndefined()
  })
  it("a run opens in its own view", () => {
    expect(runLink("board", "r-1")).toBe("#Board/r-1")
    expect(runLink("swarm", "s-1")).toBe("#Compare/s-1")
  })
})
