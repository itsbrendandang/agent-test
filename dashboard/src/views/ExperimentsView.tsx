// Saved research: everything that was researched, newest first, with keyword search. Answers, team reviews and
// task runs are one list of the same compact row (components/RecordRow.tsx). Runs of the same brief made the same
// way are one row with their history folded under it; a similar name alone never groups two records. Each row's
// badge (Practice or Live research) comes from the record itself, never from the "Next run" selector.
import { useEffect, useMemo, useState } from "react"
import { ENGINE, type RunSummary } from "@/board/api"
import { RecordList, type RecordItem } from "@/components/RecordRow"
import { EngineOffline, PageHead } from "@/components/Shared"
import { problemOf, readEngine, type Problem } from "@/lib/engine"
import { fmtScore, runTitle } from "@/lib/format"
import { setOpenAnswer, viewOfKind } from "@/lib/open"
import { provenanceOf, type ProvenanceKind } from "@/lib/provenance"
import { groupRecords } from "@/lib/records"
import { boardTitles, useBoardScripted } from "@/lib/scripted"
import { runState } from "@/lib/status"
import type { GlhfRun } from "@/swarm/api"

interface Hit {
  /** "answer": a direct, sourced answer from Research. Its title is the question that was asked. */
  kind: "swarm" | "board" | "answer"; id: string; title: string; status: string; startedAt: number; score?: number; mode?: "real" | "demo"
  matches: { where: string; text: string }[]
}
type Kind = "all" | "answer" | "swarm" | "board"
const KIND_WORD: Record<Kind, string> = { all: "All", answer: "Answers", board: "Team reviews", swarm: "Task runs" }
/** How many rows before "View all N". */
const FIRST = 10

const list = <T,>(path: string, signal: AbortSignal): Promise<T[]> =>
  fetch(ENGINE + path, { signal }).then((r) => (r.ok ? r.json() : [])).then((v: unknown) => (Array.isArray(v) ? (v as T[]) : []), () => [])

export function ExperimentsView({ onOpen }: { onOpen: (view: "Home" | "Compare" | "Board") => void }) {
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

  // What each record says about itself: a task run's own model and task, a team review's own counts and first event.
  const [swarmRuns, setSwarmRuns] = useState<Record<string, GlhfRun>>({})
  const [reviews, setReviews] = useState<Record<string, RunSummary>>({})
  const anyHits = hits !== undefined
  useEffect(() => {
    if (!anyHits) return
    const stop = new AbortController()
    const byId = <T extends { id: string }>(rows: T[]) => Object.fromEntries(rows.filter((r) => r && typeof r.id === "string").map((r) => [r.id, r]))
    void list<GlhfRun>("/api/glhf/runs", stop.signal).then((rows) => { if (!stop.signal.aborted) setSwarmRuns(byId(rows)) })
    void list<RunSummary>("/api/runs", stop.signal).then((rows) => { if (!stop.signal.aborted) setReviews(byId(rows)) })
    return () => stop.abort()
  }, [anyHits])
  const shown = useMemo(() => (hits ?? []).filter((h) => kind === "all" || h.kind === kind), [hits, kind])
  const boardIds = useMemo(() => shown.filter((h) => h.kind === "board").map((h) => h.id), [shown])
  const boardFlags = useBoardScripted(boardIds)
  const questions = boardTitles(boardIds)

  const open = (h: Hit) => {
    if (h.kind === "answer") { setOpenAnswer(h.id, h.title); onOpen("Home"); return }
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

  const madeBy = (h: Hit): ProvenanceKind | undefined =>
    h.kind === "answer" ? provenanceOf({ mode: h.mode }) : h.kind === "swarm" ? provenanceOf({ model: swarmRuns[h.id]?.model }) : provenanceOf({ scripted: boardFlags[h.id] })
  const row = (h: Hit): RecordItem => {
    const run = swarmRuns[h.id], review = reviews[h.id]
    const state = runState(h.status, h.kind !== "swarm" || h.score !== undefined)
    const result = h.kind === "swarm" ? (h.score !== undefined ? <span title="From the scoring program, out of 1">Score <span className="mono">{fmtScore(h.score)}</span> out of 1</span> : undefined)
      : h.kind === "board" && review && state === "done" ? <><span className="mono">{review.claims}</span> statement{review.claims === 1 ? "" : "s"} in <span className="mono">{review.rounds}</span> round{review.rounds === 1 ? "" : "s"}</> : undefined
    return {
      key: `${h.kind}:${h.id}`,
      title: h.kind === "answer" ? h.title : h.kind === "board" ? questions[h.id] ?? runTitle(h.title) : runTitle(h.title),
      type: h.kind === "answer" ? "Answer" : h.kind === "board" ? "Team review" : run?.solver === "single" || / · single/.test(h.title) ? "Task run, one agent" : "Task run, team of nine",
      when: h.startedAt, provenance: madeBy(h), status: state, result,
      extra: h.kind === "swarm" && run?.task === "demo" ? <span className="pill" data-kind="outline" title="The demo task is a small made-up dataset, used to test that everything works. Its result is not a research result.">Demo task</span> : undefined,
      detail: (
        <>
          {h.matches.filter((m) => m.where !== "run").map((m, i) => <p key={i} className="record-match"><i>{m.where}:</i> {mark(m.text)}</p>)}
          <p className="record-match"><span className="mono run-id" title={`Run id: ${h.id}`}>{mark(h.id)}</span></p>
        </>
      ),
      onOpen: () => open(h),
    }
  }
  // The same brief, made the same way: the engine's own title for the record (a review's brief file, a task with its
  // solver and model, an answer's exact question) and its provenance. Nothing looser than that.
  const groups = groupRecords(shown, (h) => { const made = madeBy(h); return made ? `${h.kind}|${made}|${h.title}` : undefined }, (h) => h.startedAt)
  const items = groups.map((g) => ({ ...row(g.latest), history: g.history.map(row) }))

  return (
    <div className="page">
      <PageHead title="Saved research" about="Everything that was researched, newest first. Type a word to find it in a question, a result or anything that was said." />
      <div className="exp-bar">
        <input type="search" name="experiment-search" aria-label="Search saved research by word" autoComplete="off" value={query}
          placeholder="Type a word, for example: hERG" onChange={(e) => setQuery(e.currentTarget.value)} />
        <div role="group" aria-label="Kind of record" className="exp-kinds">
          {(["all", "answer", "board", "swarm"] as const).map((k) => (
            <button key={k} type="button" className="btn" aria-pressed={kind === k} onClick={() => setKind(k)}>{KIND_WORD[k]}</button>
          ))}
        </div>
      </div>
      {error && <EngineOffline needs="The list of saved research comes from the engine." said={error.said} onRetry={() => { setError(undefined); setRetry((n) => n + 1) }} />}
      {!hits && !error && <p className="muted small" role="status">Loading saved research…</p>}
      {hits && (
        <p className="muted small" role="status">
          <span className="mono">{shown.length}</span> {shown.length === 1 ? "record" : "records"}{query.trim() ? ` with “${query.trim()}”` : ""}
          {items.length < shown.length && <> in <span className="mono">{items.length}</span> rows (runs of the same brief are together)</>}
          {query.trim() && shown.length > 0 && <> · keyword matches, newest first</>}
        </p>
      )}
      {items.length > 0 && <RecordList items={items} label="Saved research" initial={FIRST} noun="row" emphasis={mark} />}
      {hits && shown.length === 0 && !error && (query.trim()
        ? <p className="empty-note">No saved research has these words. Try fewer words, or another word.</p>
        : <p className="empty-note">Nothing has been researched yet. Ask a question on <a href="#Home">Research</a>; what it finds is saved here.</p>)}
    </div>
  )
}
