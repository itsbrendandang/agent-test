import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { APPEARANCE_KEY, setAppearance, startAppearance, useAppearance, useDarkAppearance } from "./appearance"

let dark = true
const mediaListeners = new Set<() => void>()
let stop: () => void
beforeEach(() => {
  dark = true; mediaListeners.clear()
  vi.stubGlobal("matchMedia", () => ({ matches: dark, addEventListener: (_: string, fn: () => void) => mediaListeners.add(fn), removeEventListener: (_: string, fn: () => void) => mediaListeners.delete(fn) }))
  stop = startAppearance()
})
afterEach(() => { stop(); document.documentElement.classList.remove("dark") })
const changeSystem = (value: boolean) => act(() => { dark = value; mediaListeners.forEach((fn) => fn()) })
function Choice() { return <output>{useAppearance()}:{String(useDarkAppearance())}</output> }

describe("appearance", () => {
  it("defaults to Light even when the system is dark; invalid saved values also mean Light", () => {
    expect(document.documentElement).not.toHaveClass("dark")
    localStorage.setItem(APPEARANCE_KEY, "not-a-theme")
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: APPEARANCE_KEY })))
    expect(document.documentElement).not.toHaveClass("dark")
  })
  it("persists the choice and restores it at startup", () => {
    setAppearance("dark")
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe("dark")
    expect(document.documentElement).toHaveClass("dark")
    stop(); document.documentElement.classList.remove("dark"); stop = startAppearance()
    expect(document.documentElement).toHaveClass("dark")
    setAppearance("light")
    expect(document.documentElement).not.toHaveClass("dark")
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe("light")
  })
  it("Match system follows live changes, while explicit choices ignore them", () => {
    render(<Choice />)
    act(() => setAppearance("system"))
    expect(screen.getByRole("status")).toHaveTextContent("system:true")
    changeSystem(false)
    expect(document.documentElement).not.toHaveClass("dark")
    expect(screen.getByRole("status")).toHaveTextContent("system:false")
    changeSystem(true)
    expect(document.documentElement).toHaveClass("dark")
    act(() => setAppearance("light")); changeSystem(false); changeSystem(true)
    expect(document.documentElement).not.toHaveClass("dark")
    act(() => setAppearance("dark")); changeSystem(false)
    expect(document.documentElement).toHaveClass("dark")
  })
  it("follows another tab and storage clearing", () => {
    localStorage.setItem(APPEARANCE_KEY, "dark")
    window.dispatchEvent(new StorageEvent("storage", { key: APPEARANCE_KEY }))
    expect(document.documentElement).toHaveClass("dark")
    localStorage.clear(); window.dispatchEvent(new StorageEvent("storage", { key: null }))
    expect(document.documentElement).not.toHaveClass("dark")
  })
  it("works for this page when storage is blocked, and removes its listeners on cleanup", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked") })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked") })
    expect(() => setAppearance("dark")).not.toThrow()
    expect(document.documentElement).toHaveClass("dark")
    stop(); stop = startAppearance()
    expect(document.documentElement).not.toHaveClass("dark")
    stop(); expect(mediaListeners.size).toBe(0)
  })
})
