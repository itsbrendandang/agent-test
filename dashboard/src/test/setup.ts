// Shared by every test file (vitest.config.ts).
import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach, beforeEach, vi } from "vitest"

// No test talks to the engine or to anything else. A test that needs a reply stubs fetch itself (see engine()).
beforeEach(() => {
  sessionStorage.clear(); localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("a test called fetch without stubbing it"))))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

// jsdom does not open or close <dialog> elements.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", "") }
}
if (!HTMLDialogElement.prototype.close) {
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")) }
}
