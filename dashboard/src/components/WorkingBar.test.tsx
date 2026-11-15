// The "Working" bar: there when something was sent, not for a fast read, up for its minimum time, then gone.
import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ENGINE, pendingRequests, readEngine, tracked } from "@/lib/engine"
import { engineFetch } from "@/lib/token"
import { MIN_SHOWN_MS, SHOW_READ_AFTER_MS, useWorking } from "@/lib/working"
import { WorkingBar } from "./WorkingBar"

function Shell() { const working = useWorking(); return <><WorkingBar working={working} /><main aria-busy={working || undefined}>view</main></> }
/** A request the test finishes by hand. */
const request = (method?: string) => { let finish!: () => void; const p = new Promise<void>((r) => { finish = r }); void tracked(p, method); return () => act(async () => { finish(); await p }) }
const bar = () => screen.queryByRole("progressbar", { name: "Working" })
const pass = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe("the Working bar", () => {
  it("appears at once for something that was sent, stays its minimum time, then goes away", async () => {
    render(<Shell />)
    expect(bar()).toBeNull()
    const finish = request("POST")
    await pass(1)
    expect(bar()).toBeInTheDocument()
    expect(bar()).not.toHaveAttribute("aria-valuenow") // indeterminate: it never claims how far along
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true")
    await finish() // the engine answered after a moment
    await pass(MIN_SHOWN_MS - 50)
    expect(bar()).toBeInTheDocument() // still up: long enough to be noticed
    await pass(60)
    expect(bar()).toBeNull()
    expect(screen.getByRole("main")).not.toHaveAttribute("aria-busy")
  })
  it("does not appear for a fast read, such as a view's background polling", async () => {
    render(<Shell />)
    const finish = request("GET")
    await pass(SHOW_READ_AFTER_MS - 50)
    expect(bar()).toBeNull()
    await finish()
    await pass(1000)
    expect(bar()).toBeNull()
  })
  it("appears for a read that takes long, and goes when it ends", async () => {
    render(<Shell />)
    const finish = request() // no method: a GET
    await pass(SHOW_READ_AFTER_MS + 10)
    expect(bar()).toBeInTheDocument()
    await finish()
    await pass(MIN_SHOWN_MS + 10)
    expect(bar()).toBeNull()
  })
  it("stays up across requests that follow each other, and does not restart its minimum for each", async () => {
    render(<Shell />)
    const first = request("POST")
    await pass(1)
    await first()
    const second = request("POST")
    await pass(MIN_SHOWN_MS + 200)
    expect(bar()).toBeInTheDocument() // the second is still in flight
    await second()
    await pass(1)
    expect(bar()).toBeNull() // it had been up longer than the minimum already
  })
})

describe("what counts as a request in flight", () => {
  it("a POST through engineFetch and a GET through readEngine are counted while in flight, as a write and a read", async () => {
    vi.useRealTimers()
    let answer!: (r: Response) => void
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => { answer = r })))
    const sent = engineFetch(`${ENGINE}/api/research`, { method: "POST", body: "{}" })
    expect(pendingRequests().map((p) => p.write)).toEqual([true])
    answer(new Response("{}", { status: 200 })); await sent
    expect(pendingRequests()).toEqual([])
    const read = readEngine("/api/search?q=")
    expect(pendingRequests().map((p) => p.write)).toEqual([false])
    answer(new Response("[]", { status: 200 })); await read
    expect(pendingRequests()).toEqual([])
  })
  it("a request that fails is no longer counted", async () => {
    vi.useRealTimers()
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("down"))))
    await expect(readEngine("/api/status")).rejects.toThrow("The engine cannot be reached.")
    expect(pendingRequests()).toEqual([])
  })
})
