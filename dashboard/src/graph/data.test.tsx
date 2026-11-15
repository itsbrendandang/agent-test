import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useBoardRun } from "./data"

/** A stand-in for the browser's EventSource: the test sends the engine's events by hand. */
class FakeEventSource {
  static all: FakeEventSource[] = []
  onmessage: ((m: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  readyState = 1
  closed = false
  constructor(public url: string) { FakeEventSource.all.push(this) }
  close() { this.closed = true; this.readyState = 2 }
  emit(e: unknown) { this.onmessage?.({ data: JSON.stringify(e) }) }
}

beforeEach(() => {
  FakeEventSource.all = []
  vi.stubGlobal("EventSource", FakeEventSource)
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } })))
})
afterEach(() => vi.unstubAllGlobals())

// The engine's resume (engine/src/board/board.ts runLocked) keeps writing to the same events.jsonl after a run.failed,
// and the engine's stream sends that file in order. So the graph (and its detail panels) must keep reading past it.
describe("useBoardRun for a team review that failed and was resumed", () => {
  it("keeps the events written after run.failed, and closes at run.finished", () => {
    const { result } = renderHook(() => useBoardRun("r1"))
    const source = FakeEventSource.all[0]
    act(() => {
      source.emit({ type: "run.started", key: "run", at: 1 })
      source.emit({ type: "run.failed", error: "MemoMissing", key: "failed:2", at: 2 })
    })
    expect(source.closed).toBe(false)
    act(() => {
      source.emit({ type: "member.replied", round: 2, member: "scout", text: "ok", usd: 0, key: "reply:2:scout", at: 3 })
      source.emit({ type: "run.finished", usd: 0, minutes: 1, key: "finished", at: 4 })
    })
    expect(result.current.data?.events.map((e) => e.type)).toEqual(["run.started", "run.failed", "member.replied", "run.finished"])
    expect(source.closed).toBe(true)
  })

  it("does not retry when the stream breaks right after run.failed", () => {
    const { result } = renderHook(() => useBoardRun("r1"))
    const source = FakeEventSource.all[0]
    act(() => source.emit({ type: "run.failed", error: "x", key: "failed:1", at: 1 }))
    act(() => source.onerror?.())
    expect(source.closed).toBe(true)
    expect(FakeEventSource.all).toHaveLength(1)
    expect(result.current.error).toBe(false)
  })
})
