import { useEffect, useState } from "react"
import { ENGINE } from "@/board/api"
import { EngineOffline, ModeLabel, PageHead, StatusPill } from "@/components/Shared"
import { swarmScripted, useBoardScripted } from "@/lib/scripted"
import type { GlhfRun } from "@/swarm/api"
import { runState } from "@/lib/status"
import { problemOf, readEngine, type Problem } from "@/lib/engine"
import { fmtScore, plainWhen, runTitle } from "@/lib/format"
import { viewOfKind } from "@/lib/open"

interface Hit {
  kind: "swarm" | "board"; id: string; title: string; status: string; startedAt: number; score?: number
  matches: { where: string; text: string }[]
}
type Kind = "all" | "swarm" | "board"
// Every past run of both kinds, found by keyword: swarm runs (task, model, claims, problems, reports) and board
// reviews (brief, memo, checked claims). The engine does the matching; every word must appear. To ask a question in
// plain words, use the chat on Home.
export function ExperimentsView({ onOpen }: { onOpen: (view: "Compare" | "Board") => void }) {
  const [query, setQuery] = useState(() => sessionStorage.getItem("experiments.q") ?? "")
  useEffect(() => sessionStorage.removeItem("experiments.q"), [])
  const [kind, setKind] = useState<Kind>("all")
  const [hits, setHits] = useState<Hit[]>()
  const [error, setError] = useState<Problem>()
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const stop = new AbortController()
    const timer = window.setTimeout(() => {
      readEngine<unknown>(`/api/search?q=${encodeURIComponent(query)}`, { signal: stop.signal })
        .then((h: unknown) => { if (!Array.isArray(h)) throw new Error("not a list"); setHits(h as Hit[]); setError(undefined) })
        .catch((e: unknown) => { if ((e as Error)?.name !== "AbortError") setError(problemOf(e)) })
    }, 200)
    return () => { window.clearTimeout(timer); stop.abort() }
  }, [query, retry])

  const shown = (hits ?? []).filter((h) => kind === "all" || h.kind === kind)
  // Scripted or real is read from each run itself: a swarm run's own model, a board review's own run.started event.
  const [swarmRuns, setSwarmRuns] = useState<Record<string, GlhfRun>>({})
  const anyHits = hits !== undefined
  useEffect(() => {
    if (!anyHits) return
    let stale = false
    fetch(`${ENGINE}/api/glhf/runs`).then((r) => (r.ok ? r.json() : [])).then((list: unknown) => {
      if (!stale && Array.isArray(list)) setSwarmRuns(Object.fromEntries((list as GlhfRun[]).filter((r) => r && typeof r.id === "string").map((r) => [r.id, r])))
    }, () => undefined)
    return () => { stale = true }
  }, [anyHits])
  const boardFlags = useBoardScripted(shown.filter((h) => h.kind === "board").slice(0, 40).map((h) => h.id))
  const open = (h: { kind: "swarm" | "board"; id: string }) => {
    sessionStorage.setItem(`open.${h.kind}`, h.id)
    if (query.trim()) sessionStorage.setItem("experiments.q", query) // so Back returns to the same search
    onOpen(viewOfKind(h.kind))
  }
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const mark = (text: string) => {
    if (!words.length) return text
    const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi")
    return text.split(pattern).map((part, i) => (words.includes(part.toLowerCase()) ? <mark key={i}>{part}</mark> : part))
  }

  return (
    <div className="page">
      <PageHead title="Past runs" about="Everything that has been run so far. Type a word to find a run by its question, its result, or anything that was said in it. To ask a question in full sentences, use Home." />
      <div className="exp-bar">
        <input type="search" name="experiment-search" aria-label="Search past runs by word" autoComplete="off" value={query}
          placeholder="Type a word, for example: hERG, demo, refuted…" onChange={(e) => setQuery(e.currentTarget.value)} />
        <div role="group" aria-label="Kind of run" className="exp-kinds">
          {(["all", "swarm", "board"] as const).map((k) => (
            <button key={k} type="button" className="btn" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {k === "all" ? "All" : k === "swarm" ? "One agent or a team" : "Board reviews"}
            </button>
          ))}
        </div>
      </div>
      {error && <EngineOffline needs="The list of runs comes from the engine." said={error.said} onRetry={() => { setError(undefined); setRetry((n) => n + 1) }} />}
      {!hits && !error && <p className="muted small" role="status">Loading past runs…</p>}
      {hits && <p className="muted small">{shown.length} {shown.length === 1 ? "run" : "runs"}{query.trim() ? ` matching “${query.trim()}”` : ""}</p>}
      <ul className="exp-list" aria-label="Past runs">
        {shown.map((h) => (
          <li key={`${h.kind}:${h.id}`}>
            <button type="button" className="exp-hit card-surface" onClick={() => open(h)}>
              <span className="exp-head">
                <b>{mark(runTitle(h.title))}</b>
                <StatusPill state={runState(h.status, h.kind !== "swarm" || h.score !== undefined)} />
                <span className="pill" data-kind="outline">{h.kind === "swarm" ? "one agent or a team" : "board review"}</span>
                <ModeLabel scripted={h.kind === "swarm" ? swarmScripted(swarmRuns[h.id]) : boardFlags[h.id]} demo={h.kind === "swarm" && swarmRuns[h.id]?.task === "demo"} />
                {h.score !== undefined && <span className="exp-score" title="Score from the scoring program, out of 1">score {fmtScore(h.score)}</span>}
              </span>
              <span className="muted small">Started {plainWhen(h.startedAt)} · <span className="run-id" title={`Run id: ${h.id}`}>{mark(h.id)}</span></span>
              {h.matches.filter((m) => m.where !== "run").map((m, i) => (
                <span key={i} className="exp-match small"><i>{m.where}:</i> {mark(m.text)}</span>
              ))}
            </button>
          </li>
        ))}
      </ul>
      {hits && shown.length === 0 && !error && (query.trim()
        ? <p className="empty-note">No run matches. Every word you typed has to appear in the run. Try fewer words, or ask a question on Home.</p>
        : <p className="empty-note">Nothing has been run yet. Start one from Home, from Compare or from Board. Finished runs appear here.</p>)}
    </div>
  )
}
