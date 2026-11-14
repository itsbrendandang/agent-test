import { describe, expect, it } from "vitest"
import { DEFAULT_VIEW, initialView, viewOfHash, VIEWS } from "./nav"

describe("navigation", () => {
  it("has Home first", () => {
    expect(VIEWS[0]).toBe("Home")
    expect(VIEWS).toContain("Swarm")
    expect(VIEWS).toContain("Board")
    expect(new Set(VIEWS).size).toBe(VIEWS.length)
  })
  it("opens Home when the address names no view", () => {
    expect(DEFAULT_VIEW).toBe("Home")
    expect(initialView("")).toBe("Home")
    expect(initialView("#")).toBe("Home")
    expect(initialView("#Nowhere")).toBe("Home")
    expect(initialView("#%E0%A4%A")).toBe("Home") // a broken escape
  })
  it("opens the view the address names", () => {
    expect(initialView("#Swarm")).toBe("Swarm")
    expect(initialView("#Board")).toBe("Board")
    expect(viewOfHash("#Settings")).toBe("Settings")
    expect(viewOfHash("#swarm")).toBeUndefined()
  })
})
