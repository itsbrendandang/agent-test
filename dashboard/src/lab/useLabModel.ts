// Agent Lab design by Anh Lam. Reading a run from the engine for the lab. The hooks here only READ: they open the
// run's event stream (or poll the run tracker), keep each event once, reconnect when the stream breaks, and close
// when the view goes away. Leaving the view never stops a run: nothing here calls a cancel route.
//
//   useLabEvents(kind, id)   the stored events of a team review or a research answer, replayed then live
//   useSwarmRun(id)          a swarm run's record and shared notes, polled
//   useLabModel(kind, id)    the activity model of a run in progress, for embedding the lab in another view
import { useEffect, useMemo, useRef, useState } from "react"
import { ENGINE } from "@/lib/engine"
import { answerLab, boardLab, swarmLab, type LabEvent, type SwarmNotes, type SwarmRun } from "./adapter"
import { claimsLab, type ClaimsBoard } from "./claims"
import { emptyLab, type LabModel, type RunKind } from "./model"

/** "connecting": no event yet. "live": the stream is open. "ended": the run's last event arrived. "lost": the stream broke; a new try is on its way. "offline": this browser cannot open a stream. */
export type Connection = "idle" | "connecting" | "live" | "ended" | "lost" | "offline"

const TERMINAL: Record<"board" | "answer", string[]> = { board: ["run.finished", "run.failed"], answer: ["research.finished", "research.failed", "research.cancelled"] }
const streamPath = (kind: "board" | "answer", id: string) => (kind === "board" ? `/api/runs/${encodeURIComponent(id)}/events` : `/api/research/${encodeURIComponent(id)}/events`)
/** What makes two events the same one: a team review's stable key, an answer's seq. */
export const eventId = (kind: "board" | "answer", e: LabEvent): string | undefined =>
  kind === "board" ? (typeof e.key === "string" ? e.key : undefined) : typeof e.seq === "number" ? String(e.seq) : undefined

/** Add one event to a list, replacing the copy it already holds (the stream replays everything after a reconnect). */
export function mergeEvent(kind: "board" | "answer", events: LabEvent[], e: LabEvent): LabEvent[] {
  const id = eventId(kind, e)
  if (id === undefined) return [...events, e]
  const at = events.findIndex((x) => eventId(kind, x) === id)
  if (at < 0) return [...events, e]
  if (kind === "answer") return events // a seq never changes: the copy already held stands
  const next = [...events]; next.splice(at, 1); next.push(e) // a key emitted again replaces the earlier event
  return next
}

const RETRY_MS = [1000, 2000, 5000, 10_000]

/**
 * Every event of one team review or research answer: the engine replays the stored ones, then sends new ones as
 * they happen. Each event is kept once (by key or seq). When the stream breaks it is opened again, an answer's from
 * the last seq it had. It is closed when the run's last event has arrived, and when the caller goes away.
 */
export function useLabEvents(kind: "board" | "answer" | undefined, id: string | undefined): { events: LabEvent[]; connection: Connection } {
  const [got, setGot] = useState<{ run: string; events: LabEvent[]; connection: Connection }>()
  const run = kind && id ? `${kind}/${id}` : undefined
  useEffect(() => {
    if (!kind || !id || !run) return
    if (typeof EventSource === "undefined") return // said below as "offline"
    let source: EventSource | undefined, timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false, ended = false, tries = 0, lastSeq = 0
    const patch = (change: (old: { events: LabEvent[]; connection: Connection }) => { events: LabEvent[]; connection: Connection }) =>
      setGot((old) => ({ run, ...change(old?.run === run ? old : { events: [], connection: "connecting" }) }))
    const open = () => {
      if (stopped) return
      source = new EventSource(`${ENGINE}${streamPath(kind, id)}${kind === "answer" && lastSeq ? `?after=${lastSeq}` : ""}`)
      source.onopen = () => { tries = 0; patch((old) => ({ ...old, connection: ended ? "ended" : "live" })) }
      source.onmessage = (m) => {
        let e: LabEvent
        try { e = JSON.parse(m.data) as LabEvent } catch { return } // a broken line is skipped
        if (!e || typeof e !== "object" || typeof e.type !== "string") return
        if (typeof e.seq === "number") lastSeq = Math.max(lastSeq, e.seq)
        if (TERMINAL[kind].includes(e.type)) { ended = true; source?.close() } // nothing more will come
        patch((old) => ({ events: mergeEvent(kind, old.events, e), connection: ended ? "ended" : "live" }))
      }
      source.onerror = () => {
        if (stopped || ended) return
        source?.close() // the browser's own retry would replay from the start without saying so; this one counts
        patch((old) => ({ ...old, connection: "lost" }))
        timer = setTimeout(open, RETRY_MS[Math.min(tries++, RETRY_MS.length - 1)])
      }
    }
    open()
    return () => { stopped = true; if (timer) clearTimeout(timer); source?.close() }
  }, [kind, id, run])
  return useMemo(() => (got && got.run === run ? { events: got.events, connection: got.connection } : { events: [], connection: !run ? "idle" : typeof EventSource === "undefined" ? "offline" : "connecting" }), [got, run])
}

export interface SwarmSeen { run?: SwarmRun; notes: SwarmNotes | null; /** When a poll first saw each note, for the ones that arrived while this page watched. */ seenAt: (number | undefined)[]; connection: Connection }
const settledPhase = (phase: unknown) => phase === "done" || phase === "failed" || phase === "cancelled"

/** A swarm run's record and shared notes, read again every 2 seconds while it runs. A finished run is read once. */
export function useSwarmRun(id: string | undefined): SwarmSeen {
  const [got, setGot] = useState<{ id: string } & SwarmSeen>()
  const seen = useRef<{ id?: string; at: (number | undefined)[]; polls: number }>({ at: [], polls: 0 })
  useEffect(() => {
    if (!id) return
    seen.current = { id, at: [], polls: 0 }
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined
    const stop = new AbortController()
    const tick = async () => {
      let next = 2000
      try {
        const r = await fetch(`${ENGINE}/api/glhf/runs/${encodeURIComponent(id)}`, { signal: stop.signal })
        if (!r.ok) throw new Error(String(r.status))
        const body = (await r.json()) as { run?: SwarmRun; ledger?: SwarmNotes | null }
        if (stopped) return
        const count = Array.isArray(body.ledger?.events) ? (body.ledger!.events as unknown[]).length : 0
        // Notes that were already there at the first read have no known time; later ones were seen arriving.
        const s = seen.current
        for (let i = s.at.length; i < count; i++) s.at.push(s.polls === 0 ? undefined : Date.now())
        s.polls++
        const ended = settledPhase(body.run?.phase)
        setGot({ id, run: body.run, notes: body.ledger ?? null, seenAt: [...s.at], connection: ended ? "ended" : "live" })
        if (ended) return // nothing more will change
      } catch {
        if (stopped) return
        setGot((old) => ({ id, run: old?.id === id ? old.run : undefined, notes: old?.id === id ? old.notes : null, seenAt: old?.id === id ? old.seenAt : [], connection: "lost" }))
        next = 5000
      }
      timer = setTimeout(tick, next)
    }
    void tick()
    return () => { stopped = true; stop.abort(); if (timer) clearTimeout(timer) }
  }, [id])
  return useMemo(() => (got && got.id === id ? got : { notes: null, seenAt: [], connection: id ? "connecting" : "idle" }), [got, id])
}

export interface ClaimsSeen {
  /** undefined: not asked yet. false: this run has no claims board (it is not a claims-engine run, or this engine does not serve it). */
  board: ClaimsBoard | false | undefined
  events: LabEvent[]
  /** The host ledger's events, when the engine serves them with the board. */
  notes: SwarmNotes | null
  seenAt: (number | undefined)[]
}
const listOf = (body: unknown): LabEvent[] => (Array.isArray(body) ? body : Array.isArray((body as { events?: unknown })?.events) ? ((body as { events: unknown[] }).events) : []).filter((e): e is LabEvent => !!e && typeof e === "object")

/**
 * A claims-engine run, read the way its files ask to be read: the board snapshot first, then the events with a
 * higher seq; when an event is missing between them (a gap), the snapshot is read again. Only GET requests; a run
 * that has no board answers 404 once and is not asked again.
 *   GET /api/glhf/runs/:id/board                  { run_id, seq, claims } (with `ledgerEvents` when the engine sends them)
 *   GET /api/glhf/runs/:id/claims-events?after=N  the events after seq N
 */
export function useClaimsRun(id: string | undefined, live: boolean): ClaimsSeen {
  const [got, setGot] = useState<{ id: string } & ClaimsSeen>()
  useEffect(() => {
    if (!id) return
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined
    const stop = new AbortController()
    const base = `${ENGINE}/api/glhf/runs/${encodeURIComponent(id)}`
    let board: ClaimsBoard | undefined, events: LabEvent[] = [], seen: (number | undefined)[] = [], polls = 0
    const read = async (path: string) => { const r = await fetch(base + path, { signal: stop.signal }); if (r.status === 404) return undefined; if (!r.ok) throw new Error(String(r.status)); return (await r.json()) as unknown }
    const tick = async () => {
      try {
        if (!board) {
          const body = (await read("/board")) as (ClaimsBoard & { board?: ClaimsBoard }) | undefined
          if (stopped) return
          if (!body) { setGot({ id, board: false, events: [], notes: null, seenAt: [] }); return } // not a claims run: ask no more
          board = body.board ?? body
          events = events.filter((e) => e.run_id === board!.run_id)
        }
        const last = events.reduce((n, e) => Math.max(n, typeof e.seq === "number" ? e.seq : 0), 0)
        const more = listOf(await read(`/claims-events?after=${last}`)).filter((e) => e.run_id === undefined || e.run_id === board!.run_id)
        if (stopped) return
        const have = new Set(events.map((e) => e.seq))
        events = [...events, ...more.filter((e) => !have.has(e.seq))]
        const whole = board as ClaimsBoard & { ledgerEvents?: unknown; notes?: unknown }
        const notes = Array.isArray(whole.ledgerEvents) ? whole.ledgerEvents : Array.isArray(whole.notes) ? whole.notes : []
        for (let i = seen.length; i < notes.length; i++) seen.push(polls === 0 ? undefined : Date.now())
        polls++
        const model = claimsLab({ board, events })
        setGot({ id, board, events, notes: notes.length ? { events: notes } : null, seenAt: [...seen] })
        if (model.needsSync || live) board = undefined // a gap, or a run still going: the next read starts from a new snapshot
      } catch {
        if (stopped) return
        setGot((old) => (old?.id === id && old.board ? old : { id, board: false, events: [], notes: null, seenAt: [] })) // could not be read: shown as a run without a board
      }
      if (live) timer = setTimeout(tick, 2000)
    }
    void tick()
    return () => { stopped = true; stop.abort(); if (timer) clearTimeout(timer) }
  }, [id, live])
  return useMemo(() => (got && got.id === id ? got : { board: undefined, events: [], notes: null, seenAt: [] }), [got, id])
}

/**
 * The activity model of one run, kept up to date: for a view that wants to show the lab for a run in progress and
 * does not hold the run's events itself. (A view that does hold them calls answerLab or boardLab directly, which
 * opens no second stream.)
 */
export function useLabModel(kind: RunKind | undefined, id: string | undefined): { model: LabModel; connection: Connection } {
  const stream = useLabEvents(kind === "board" || kind === "answer" ? kind : undefined, id)
  const swarm = useSwarmRun(kind === "swarm" ? id : undefined)
  return useMemo(() => {
    if (!kind || !id) return { model: emptyLab(), connection: "idle" as const }
    if (kind === "swarm") return { model: swarmLab(swarm.run ?? { id }, swarm.notes, { seenAt: swarm.seenAt }), connection: swarm.connection }
    return { model: kind === "board" ? boardLab(stream.events, id) : answerLab(stream.events, id), connection: stream.connection }
  }, [kind, id, stream, swarm])
}
