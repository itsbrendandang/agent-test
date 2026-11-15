import { describe, expect, it } from "vitest"
import { DEFAULT_VIEW, initialView, viewOfHash, VIEWS } from "./nav"

describe("navigation", () => {
  it("has seven views, Home first", () => {
    expect(VIEWS).toEqual(["Home", "Runs", "Compare", "Board", "Agents", "Graph", "Settings"])
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
  it("no longer has the template views", () => {
    for (const gone of ["Overview", "Simulations", "Analytics"]) expect(viewOfHash(`#${gone}`)).toBeUndefined()
  })
})
