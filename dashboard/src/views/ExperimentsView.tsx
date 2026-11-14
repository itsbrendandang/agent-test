import { useEffect, useState } from "react"
import { ENGINE } from "@/board/api"

interface Hit {
  kind: "swarm" | "board"; id: string; title: string; status: string; startedAt: number; score?: number
  matches: { where: string; text: string }[]
}
type Kind = "all" | "swarm" | "board"

/** A run another view should open on its next mount. Read once, then cleared. */
export function takeOpen(kind: "swarm" | "board"): string | undefined {
  const key = `open.${kind}`
  const id = sessionStorage.getItem(key) ?? undefined
  sessionStorage.removeItem(key)
  return id
}

// Search over every experiment: swarm runs (task, model, claims, problems, reports) and drug board
// runs (brief, memo, checked claims). The engine does the matching; every word must appear.
export function ExperimentsView({ onOpen }: { onOpen: (view: "Swarm" | "Board") => void }) {
  const [query, setQuery] = useState("")
  const [kind, setKind] = useState<Kind>("all")
  const [hits, setHits] = useState<Hit[]>()
  const [error, setError] = useState(false)

  useEffect(() => {
    const stop = new AbortController()
    const timer = window.setTimeout(() => {
      fetch(`${ENGINE}/api/search?q=${encodeURIComponent(query)}`, { signal: stop.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((h: Hit[]) => { setHits(h); setError(false) })
        .catch((e) => { if (e.name !== "AbortError") setError(true) })
    }, 200)
    return () => { window.clearTimeout(timer); stop.abort() }
  }, [query])

  const shown = (hits ?? []).filter((h) => kind === "all" || h.kind === kind)
  const open = (h: Hit) => {
    sessionStorage.setItem(`open.${h.kind}`, h.id)
    onOpen(h.kind === "swarm" ? "Swarm" : "Board")
  }
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const mark = (text: string) => {
    if (!words.length) return text
    const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi")
    return text.split(pattern).map((part, i) => (words.includes(part.toLowerCase()) ? <mark key={i}>{part}</mark> : part))
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Experiments</h1>
          <p className="muted small">Search every run by task, model, status, or any text in its claims, problems, reports and memos.</p>
        </div>
      </header>
      <div className="exp-bar">
        <input type="search" name="experiment-search" aria-label="Search experiments" autoFocus value={query}
          placeholder="Try: demo, single agent, refuted, hERG, header rows…" onChange={(e) => setQuery(e.currentTarget.value)} />
        <div role="group" aria-label="Kind of experiment" className="exp-kinds">
          {(["all", "swarm", "board"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {k === "all" ? "All" : k === "swarm" ? "Swarm runs" : "Drug board"}
            </button>
          ))}
        </div>
      </div>
      {error && <p role="alert" className="pill pill-warning">Search needs the engine. Start it with npm run engine.</p>}
      {hits && <p className="muted small">{shown.length} {shown.length === 1 ? "experiment" : "experiments"}{query.trim() ? ` matching “${query.trim()}”` : ""}</p>}
      <ul className="exp-list">
        {shown.map((h) => (
          <li key={`${h.kind}:${h.id}`}>
            <button type="button" className="exp-hit card-surface" onClick={() => open(h)}>
              <span className="exp-head">
                <b>{mark(h.title)}</b>
                <span className="pill" data-kind={h.status === "failed" ? "danger" : undefined}>{h.status}</span>
                {h.score !== undefined && <span className="exp-score">{h.score.toFixed(3)}</span>}
              </span>
              <span className="muted small">{mark(h.id)} · {new Date(h.startedAt).toLocaleString()}</span>
              {h.matches.filter((m) => m.where !== "run").map((m) => (
                <span key={m.where} className="exp-match small"><i>{m.where}:</i> {mark(m.text)}</span>
              ))}
            </button>
          </li>
        ))}
      </ul>
      {hits && shown.length === 0 && !error && <p className="muted">No experiments match. Every word has to appear in the run.</p>}
    </div>
  )
}
