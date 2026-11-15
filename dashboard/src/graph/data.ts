// Loading runs for the graph. Reads only; the engine is never changed from here. Streams and timers stop when the
// view unmounts and while the browser tab is hidden.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { ENGINE, get, type BoardEvent, type RosterMember, type RunSummary } from "@/board/api"
import { settled, type GlhfRun, type RunDetail } from "@/swarm/api"
import type { RunKind } from "./types"

export interface RunRef { kind: RunKind; id: string; startedAt: number; state: string }

const subscribeVisible = (cb: () => void) => { document.addEventListener("visibilitychange", cb); return () => document.removeEventListener("visibilitychange", cb) }
/** false while the tab is in the background. */
export const useVisible = () => useSyncExternalStore(subscribeVisible, () => document.visibilityState !== "hidden", () => true)

/** Board and swarm runs in one list, newest first. */
export function mergeRuns(board: RunSummary[] | undefined, swarm: GlhfRun[] | undefined): RunRef[] {
  return [
    ...(board ?? []).map((r): RunRef => ({ kind: "board", id: r.id, startedAt: r.startedAt, state: r.status })),
    ...(swarm ?? []).map((r): RunRef => ({ kind: "swarm", id: r.id, startedAt: r.startedAt, state: r.phase })),
  ].sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id))
}

export interface RunList { runs: RunRef[] | undefined; /** Which lists failed to load. */ failed: RunKind[]; reload: () => void }
export function useRunList(): RunList {
  const [state, setState] = useState<{ runs?: RunRef[]; failed: RunKind[] }>({ failed: [] })
  const [nudge, setNudge] = useState(0)
  const visible = useVisible()
  useEffect(() => {
    if (!visible) return
    let stop = false
    void Promise.allSettled([get<RunSummary[]>("/api/runs"), get<GlhfRun[]>("/api/glhf/runs")]).then(([b, s]) => {
      if (stop) return
      const failed: RunKind[] = [b.status === "rejected" && "board", s.status === "rejected" && "swarm"].filter(Boolean) as RunKind[]
      setState({ runs: failed.length === 2 ? undefined : mergeRuns(b.status === "fulfilled" ? b.value : undefined, s.status === "fulfilled" ? s.value : undefined), failed })
    })
    return () => { stop = true }
  }, [nudge, visible])
  return { runs: state.runs, failed: state.failed, reload: useCallback(() => setNudge((n) => n + 1), []) }
}

export interface Loaded<T> { data: T | undefined; error: boolean; loading: boolean; reload: () => void }

/** A board run: the engine replays every event, then tails new ones. The stream closes when the run ends, when the tab is hidden and on unmount. */
export function useBoardRun(id: string | undefined): Loaded<{ events: BoardEvent[]; roster: RosterMember[] }> {
  const [got, setGot] = useState<{ id: string; events: BoardEvent[]; ended: boolean }>()
  const [roster, setRoster] = useState<RosterMember[]>([])
  const [error, setError] = useState(false)
  const [nudge, setNudge] = useState(0)
  const visible = useVisible()
  const ended = got !== undefined && got.id === id && got.ended
  useEffect(() => {
    if (!id) return
    let stop = false
    void get<RosterMember[]>("/api/roster").then((r) => { if (!stop) setRoster(r) }, () => undefined)
    return () => { stop = true }
  }, [id])
  useEffect(() => {
    if (!id || !visible || ended) return
    if (typeof EventSource === "undefined") return
    const source = new EventSource(`${ENGINE}/api/runs/${encodeURIComponent(id)}/events`)
    source.onmessage = (m) => {
      let e: BoardEvent
      try { e = JSON.parse(m.data) as BoardEvent } catch { return }
      setError(false)
      const done = e.type === "run.finished" || e.type === "run.failed"
      setGot((old) => ({ id, ended: done || (old?.id === id && old.ended), events: [...(old?.id === id ? old.events : []).filter((x) => x.key !== e.key), e] }))
      if (done) source.close()
    }
    source.onerror = () => { if (source.readyState === 2) setError(true) }
    return () => source.close()
  }, [id, visible, ended, nudge])
  const mine = got?.id === id ? got : undefined
  const data = useMemo(() => (mine ? { events: mine.events, roster } : undefined), [mine, roster])
  return { data, error: error || (Boolean(id) && typeof EventSource === "undefined"), loading: Boolean(id) && !mine && !error && typeof EventSource !== "undefined", reload: useCallback(() => { setGot(undefined); setError(false); setNudge((n) => n + 1) }, []) }
}

/** A swarm run: read once, then every 2 seconds while it is live and the tab is visible. */
export function useSwarmRun(id: string | undefined): Loaded<RunDetail> {
  const [got, setGot] = useState<{ id: string; detail: RunDetail }>()
  const [error, setError] = useState(false)
  const [nudge, setNudge] = useState(0)
  const visible = useVisible()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    if (!id || !visible) return
    let stop = false
    const read = async () => {
      let live = false
      try {
        const detail = await get<RunDetail>(`/api/glhf/runs/${encodeURIComponent(id)}`)
        if (stop) return
        setGot({ id, detail }); setError(false)
        live = !settled(detail.run.phase)
      } catch { if (stop) return; setError(true) }
      if (live) timer.current = setTimeout(() => void read(), 2000)
    }
    void read()
    return () => { stop = true; clearTimeout(timer.current) }
  }, [id, visible, nudge])
  const mine = got?.id === id ? got : undefined
  return { data: mine?.detail, error: error && !mine, loading: Boolean(id) && !mine && !error, reload: useCallback(() => { setError(false); setNudge((n) => n + 1) }, []) }
}
