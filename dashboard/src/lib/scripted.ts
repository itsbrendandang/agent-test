// Was a run made by scripted models (fixed text, no research) or by real ones? The answer is a fact of the run
// itself, never of the engine's state now: a real past review stays real when paid calls are later turned off,
// and a scripted run stays scripted when they are turned on.
import { useEffect, useState } from "react"
import { ENGINE } from "@/board/api"

/** true: scripted. false: real models. undefined: the run does not say (yet). */
export type Scripted = boolean | undefined

/** A swarm run records its model; "mock" is the scripted model. */
export const swarmScripted = (run: { model?: unknown } | undefined): Scripted => (typeof run?.model === "string" ? run.model === "mock" : undefined)

/** What a board run says about itself in its first event, run.started: whether it was a practice run, and its title. */
export interface RunStart { scripted: Scripted; title?: string }
/** Reads the event stream only until that first event. */
export async function boardStart(id: string, signal?: AbortSignal): Promise<RunStart | undefined> {
  const stop = new AbortController()
  signal?.addEventListener("abort", () => stop.abort())
  try {
    const r = await fetch(`${ENGINE}/api/runs/${encodeURIComponent(id)}/events`, { signal: stop.signal })
    if (!r.ok || !r.body) return undefined
    const reader = r.body.getReader(), decode = new TextDecoder()
    let text = ""
    for (let read = 0; read < 200_000;) {
      const { done, value } = await reader.read()
      if (value) { read += value.length; text += decode.decode(value, { stream: true }) }
      for (const line of text.split("\n")) {
        if (!line.startsWith("data:")) continue
        try {
          const event = JSON.parse(line.slice(5)) as { type?: unknown; mock?: unknown; title?: unknown }
          if (event.type === "run.started") return { scripted: typeof event.mock === "boolean" ? event.mock : undefined, title: typeof event.title === "string" && event.title.trim() ? event.title.trim().slice(0, 300) : undefined }
        } catch { /* a line still being received */ }
      }
      if (done) break
    }
    return undefined
  } catch { return undefined } finally { stop.abort() } // the stream stays open for live runs: close it once we know
}
export const boardScripted = async (id: string, signal?: AbortSignal): Promise<Scripted> => (await boardStart(id, signal))?.scripted

const known = new Map<string, Scripted>()
const starts = new Map<string, RunStart>()
/** Runs whose first event was asked for and the engine answered, with or without one. */
const asked = new Set<string>()
/** For tests. */
export const forgetScripted = () => { known.clear(); starts.clear(); asked.clear() }
/** The engine allows only so many event streams at once, so the runs are read a few at a time. */
const AT_ONCE = 4

/** The scripted flag of each board run in `ids`, filled in as each is read. A run that was read is not read again. */
export function useBoardScripted(ids: string[]): Record<string, Scripted> {
  const [, setTick] = useState(0)
  const key = ids.join("\n")
  useEffect(() => {
    const stop = new AbortController()
    const todo = (key ? key.split("\n") : []).filter((id) => !known.has(id))
    const worker = async () => {
      for (let id = todo.shift(); id !== undefined && !stop.signal.aborted; id = todo.shift()) {
        const start = await boardStart(id, stop.signal)
        if (stop.signal.aborted) return
        if (start) starts.set(id, start)
        asked.add(id)
        const flag = start?.scripted
        if (flag !== undefined) known.set(id, flag) // a run that could not be read is tried again later
        setTick((n) => n + 1)
      }
    }
    for (let i = 0; i < AT_ONCE; i++) void worker()
    return () => stop.abort()
  }, [key])
  return Object.fromEntries(ids.map((id) => [id, known.get(id)]))
}

/** The title each of these board runs gave itself (the question that was asked), for the ones already read by useBoardScripted. */
export const boardTitles = (ids: string[]): Record<string, string | undefined> => Object.fromEntries(ids.map((id) => [id, starts.get(id)?.title]))
/** True once every one of these board runs has been asked for (useBoardScripted does the asking): its title and flag will not change after that. */
export const boardsRead = (ids: string[]): boolean => ids.every((id) => asked.has(id))
