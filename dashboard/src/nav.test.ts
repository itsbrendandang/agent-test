import { describe, expect, it } from "vitest"
import { DEFAULT_VIEW, initialView, LABEL, MORE, PRIMARY, runOfHash, viewOfHash, VIEWS } from "./nav"

describe("navigation", () => {
  it("keeps the view keys (they are addresses), with Overview first and Home still the key of Research", () => {
    expect(VIEWS).toEqual(["Overview", "Home", "Runs", "Compare", "Benchmarks", "Board", "Agents", "Graph", "Lab", "Settings"])
  })
  it("renames on screen only: Overview, Research, Saved research, Compare first; Benchmarks and the rest under More; Settings once", () => {
    expect(PRIMARY.map((v) => LABEL[v])).toEqual(["Overview", "Research", "Saved research", "Compare"])
    expect(MORE.map((v) => LABEL[v])).toEqual(["Team review", "Agents", "Graph", "Lab", "Benchmarks"])
    expect([...PRIMARY, ...MORE, "Settings"].sort()).toEqual([...VIEWS].sort()) // every view is reachable, none twice
  })
  it("opens Overview when the address names no view and nothing is remembered", () => {
    expect(DEFAULT_VIEW).toBe("Overview")
    expect(initialView("")).toBe("Overview")
    expect(initialView("#")).toBe("Overview")
    expect(initialView("#Nowhere")).toBe("Overview")
    expect(initialView("#%E0%A4%A")).toBe("Overview") // a broken escape
    localStorage.setItem("app.view", "Runs") // a place used before wins over the default
    expect(initialView("")).toBe("Runs")
    expect(initialView("#Home")).toBe("Home") // and the address wins over both: Research keeps its key
  })
  it("opens the view the address names", () => {
    expect(initialView("#Compare")).toBe("Compare")
    expect(initialView("#Board")).toBe("Board")
    expect(viewOfHash("#Settings")).toBe("Settings")
    expect(viewOfHash("#compare")).toBeUndefined()
  })
  it("still opens links made with the former names", () => {
    expect(viewOfHash("#Swarm")).toBe("Compare")
    expect(viewOfHash("#Experiments")).toBe("Runs")
    expect(viewOfHash("#Worlds")).toBe("Graph")
  })
  it("opens the words now on screen too, and a run inside a view", () => {
    expect(viewOfHash("#Research")).toBe("Home")
    expect(viewOfHash("#Search")).toBe("Home")
    expect(viewOfHash("#Saved")).toBe("Runs")
    expect(viewOfHash("#Review")).toBe("Board")
    expect(viewOfHash("#Lab/board/202611150232-kras")).toBe("Lab")
    expect(viewOfHash("#Board/202611150232-kras")).toBe("Board")
    expect(runOfHash("#Board/202611150232-kras")).toBe("202611150232-kras")
    expect(runOfHash("#Compare/..%2F..%2Fetc")).toBeUndefined()
  })
  it("no longer has the template views", () => {
    for (const gone of ["Simulations", "Analytics", "Parade"]) expect(viewOfHash(`#${gone}`)).toBeUndefined()
    expect(viewOfHash("#Overview")).toBe("Overview")
    expect(viewOfHash("#Benchmarks")).toBe("Benchmarks") // a new view with real counts, not the template's
  })
})
