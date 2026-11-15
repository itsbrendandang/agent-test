import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useLabEvents } from "./useLabModel"

/** A stand-in for the browser's EventSource: the test sends the engine's events by hand. */
class FakeEventSource {
  static all: FakeEventSource[] = []
  onopen: (() => void) | null = null
  onmessage: ((m: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  constructor(public url: string) { FakeEventSource.all.push(this) }
  close() { this.closed = true }
  emit(e: unknown) { this.onmessage?.({ data: JSON.stringify(e) }) }
}

beforeEach(() => { FakeEventSource.all = []; vi.stubGlobal("EventSource", FakeEventSource) })
afterEach(() => vi.unstubAllGlobals())

// The engine's resume (engine/src/board/board.ts runLocked) keeps writing to the same events.jsonl after a run.failed,
// and the engine's stream sends that file in order. So the Agent Log must keep reading past a run.failed.
describe("useLabEvents for a team review that failed and was resumed", () => {
  it("keeps the events written after run.failed, and closes at run.finished", () => {
    const { result } = renderHook(() => useLabEvents("board", "r1"))
    const source = FakeEventSource.all[0]
    act(() => {
      source.emit({ type: "run.started", key: "run", at: 1 })
      source.emit({ type: "run.failed", error: "MemoMissing", key: "failed:2", at: 2 })
    })
    expect(source.closed).toBe(false)
    expect(result.current.connection).toBe("ended")
    act(() => {
      source.emit({ type: "member.replied", round: 2, member: "scout", text: "ok", usd: 0, key: "reply:2:scout", at: 3 })
    })
    expect(result.current.connection).toBe("live")
    act(() => source.emit({ type: "run.finished", usd: 0, minutes: 1, key: "finished", at: 4 }))
    expect(result.current.events.map((e) => e.type)).toEqual(["run.started", "run.failed", "member.replied", "run.finished"])
    expect(result.current.connection).toBe("ended")
    expect(source.closed).toBe(true)
  })

  it("does not open a new stream when the stream breaks after a run that failed", () => {
    vi.useFakeTimers()
    try {
      renderHook(() => useLabEvents("board", "r1"))
      const source = FakeEventSource.all[0]
      act(() => source.emit({ type: "run.failed", error: "x", key: "failed:1", at: 1 }))
      act(() => { source.onerror?.(); vi.advanceTimersByTime(20_000) })
      expect(source.closed).toBe(true)
      expect(FakeEventSource.all).toHaveLength(1)
    } finally { vi.useRealTimers() }
  })
})
