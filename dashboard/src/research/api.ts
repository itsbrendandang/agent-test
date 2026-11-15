// Calls for a direct, sourced answer: start one (POST /api/research), follow its events, read a saved one.
// Starting one in Real mode needs the session token, like every action that can cost money; engineFetch asks for
// it and sends the question again, so the question is never lost.
import { useEffect, useMemo, useState } from "react"
import { ENGINE } from "@/lib/engine"
import { engineFetch } from "@/lib/token"
import type { ResearchEvent } from "./model"

export class ResearchRefused extends Error {
  status: number; field?: string
  constructor(message: string, status: number, field?: string) { super(message); this.status = status; this.field = field }
}
export interface Started { id: string; thread: string; mode?: "real" | "demo" }

/** Plain words for the refusals a person can act on. The engine's own text is kept as the detail. */
const WHY: Record<string, string> = {
  rate: "Too many questions in a short time. Wait a minute, then ask again.",
  busy: "Three answers are already being written. Wait for one to finish, then ask again.",
  budget: "Today's spending limit would be passed, so this answer was not started. Try again tomorrow, or ask the person who runs the engine to raise the limit.",
  queue: "Three follow-ups are already waiting in this conversation. Wait for one to finish, then ask again.",
  token: "The session token was missing or not accepted, so nothing was sent to a model. Ask again and paste the token when asked.",
}

/** Start an answer. Rejects with ResearchRefused; status 404 means this engine has no such route (the caller falls back). */
export async function startResearch(question: string, effort: "quick" | "standard", thread?: string): Promise<Started> {
  let r: Response
  try { r = await engineFetch(`${ENGINE}/api/research`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, effort, ...(thread && { thread }) }) }) }
  catch { throw new ResearchRefused("The app's engine isn't running. Start it with: npm start. Then send your question again.", 0) }
  const body = (await r.json().catch(() => undefined)) as { id?: unknown; thread?: unknown; mode?: unknown; error?: unknown; field?: unknown } | undefined
  if (r.ok && typeof body?.id === "string" && typeof body.thread === "string") return { id: body.id, thread: body.thread, mode: body.mode === "demo" ? "demo" : body.mode === "real" ? "real" : undefined }
  // Real mode before the owner has switched direct answers on: not an error. The caller uses the team-review plan instead.
  if (r.status === 503 && (body as { preview?: unknown } | undefined)?.preview === false) throw new ResearchRefused("Direct answers are not switched on yet.", 404)
  const field = typeof body?.field === "string" ? body.field : undefined
  const said = typeof body?.error === "string" ? body.error.slice(0, 400) : `The engine answered ${r.status}.`
  throw new ResearchRefused((field && WHY[field]) ?? said, r.status, field)
}

/** Every event of one answer, replayed then live. `lost` is true when the stream could not be opened or broke before the end. */
export function useResearchEvents(id: string | undefined): { events: ResearchEvent[]; lost: boolean } {
  const [got, setGot] = useState<{ id: string; events: ResearchEvent[]; lost: boolean }>()
  useEffect(() => {
    if (!id) return
    const source = new EventSource(`${ENGINE}/api/research/${encodeURIComponent(id)}/events`)
    let ended = false
    source.onmessage = (m) => {
      let e: ResearchEvent
      try { e = JSON.parse(m.data) as ResearchEvent } catch { return }
      if (!e || typeof e.type !== "string") return
      if (e.type === "research.finished" || e.type === "research.failed" || e.type === "research.cancelled") { ended = true; source.close() } // nothing more will come
      setGot((old) => ({ id, lost: false, events: [...(old?.id === id ? old.events : []).filter((x) => x.seq === undefined || x.seq !== e.seq), e] }))
    }
    source.onerror = () => { if (!ended) setGot((old) => ({ id, events: old?.id === id ? old.events : [], lost: true })) }
    return () => source.close()
  }, [id])
  return useMemo(() => (got && got.id === id ? { events: got.events, lost: got.lost } : { events: [], lost: false }), [got, id])
}

/** Stop an answer that is being made or is waiting. Resolves to the engine's plain message. */
export async function cancelResearch(id: string): Promise<string> {
  try {
    const r = await engineFetch(`${ENGINE}/api/research/${encodeURIComponent(id)}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    const body = (await r.json().catch(() => undefined)) as { message?: unknown; error?: unknown } | undefined
    return typeof body?.message === "string" ? body.message : typeof body?.error === "string" ? body.error : r.ok ? "Stopped." : `The engine answered ${r.status}.`
  } catch { return "The app's engine isn't running, so nothing could be stopped." }
}
/** Where a file the answer registered can be downloaded. */
export const artifactUrl = (id: string, name: string) => `${ENGINE}/api/research/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(name)}`
