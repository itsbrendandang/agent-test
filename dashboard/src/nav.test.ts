import { describe, expect, it } from "vitest"
import { DEFAULT_VIEW, initialView, LABEL, MORE, PRIMARY, runOfHash, viewOfHash, VIEWS } from "./nav"

describe("navigation", () => {
  it("keeps the view keys (they are addresses), Home first, and adds Lab", () => {
    expect(VIEWS).toEqual(["Home", "Runs", "Compare", "Board", "Agents", "Graph", "Lab", "Settings"])
  })
  it("renames on screen only: Research, Saved research, Compare first; the rest under More; Settings once", () => {
    expect(PRIMARY.map((v) => LABEL[v])).toEqual(["Research", "Saved research", "Compare"])
    expect(MORE.map((v) => LABEL[v])).toEqual(["Team review", "Agents", "Graph", "Lab"])
    expect([...PRIMARY, ...MORE, "Settings"].sort()).toEqual([...VIEWS].sort()) // every view is reachable, none twice
  })
  it("opens Home when the address names no view", () => {
    expect(DEFAULT_VIEW).toBe("Home")
    expect(initialView("")).toBe("Home")
    expect(initialView("#")).toBe("Home")
    expect(initialView("#Nowhere")).toBe("Home")
    expect(initialView("#%E0%A4%A")).toBe("Home") // a broken escape
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
    for (const gone of ["Overview", "Simulations", "Analytics"]) expect(viewOfHash(`#${gone}`)).toBeUndefined()
  })
})
