// Was a run made by scripted models (fixed text, no research) or by real ones? The answer is a fact of the run
// itself, never of the engine's state now: a real past review stays real when paid calls are later turned off,
// and a scripted run stays scripted when they are turned on.
import { useEffect, useState } from "react"
import { ENGINE } from "@/board/api"

/** true: scripted. false: real models. undefined: the run does not say (yet). */
export type Scripted = boolean | undefined

/** A swarm run records its model; "mock" is the scripted model. */
export const swarmScripted = (run: { model?: unknown } | undefined): Scripted => (typeof run?.model === "string" ? run.model === "mock" : undefined)

/** A board run says it in its first event, run.started {mock}. Reads the event stream only until that event. */
export async function boardScripted(id: string, signal?: AbortSignal): Promise<Scripted> {
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
          const event = JSON.parse(line.slice(5)) as { type?: unknown; mock?: unknown }
          if (event.type === "run.started") return typeof event.mock === "boolean" ? event.mock : undefined
        } catch { /* a line still being received */ }
      }
      if (done) break
    }
    return undefined
  } catch { return undefined } finally { stop.abort() } // the stream stays open for live runs: close it once we know
}

const known = new Map<string, Scripted>()
/** For tests. */
export const forgetScripted = () => known.clear()

/** The scripted flag of each board run in `ids`, filled in as each is read. A run is read once per page load. */
export function useBoardScripted(ids: string[]): Record<string, Scripted> {
  const [, setTick] = useState(0)
  const key = ids.join("\n")
  useEffect(() => {
    const stop = new AbortController()
    for (const id of key ? key.split("\n") : []) {
      if (known.has(id)) continue
      known.set(id, undefined)
      void boardScripted(id, stop.signal).then((flag) => {
        if (stop.signal.aborted && flag === undefined) { known.delete(id); return } // not read: read it next time
        known.set(id, flag); setTick((n) => n + 1)
      })
    }
    return () => stop.abort()
  }, [key])
  return Object.fromEntries(ids.map((id) => [id, known.get(id)]))
}
