import { type FormEvent, useEffect, useRef, useState } from "react"
import { ENGINE } from "@/board/api"

interface Hit {
  kind: "swarm" | "board"; id: string; title: string; status: string; startedAt: number; score?: number
  matches: { where: string; text: string }[]
}
type Kind = "all" | "swarm" | "board"
// POST /api/ask (engine/src/ask.ts). mode "keyword" means no AI answered: no key, or the call failed.
interface Cited { kind: "swarm" | "board"; id: string; title: string; why: string }
interface Answer { answer: string; runs: Cited[]; mode: "ai" | "keyword"; note?: string }
type Asked = { state: "idle" } | { state: "loading"; question: string } | { state: "done"; question: string; result: Answer } | { state: "error"; question: string; message: string }

/** A run another view should open on its next mount. Read once, then cleared. */
export function takeOpen(kind: "swarm" | "board"): string | undefined {
  const key = `open.${kind}`
  const id = sessionStorage.getItem(key) ?? undefined
  if (id) window.setTimeout(() => sessionStorage.removeItem(key), 0) // after React's double call in development
  return id
}

// Two ways to find an experiment. Ask: a question in plain words, answered by a model from an index of every
// run, with the runs it used. Search: every word must appear.
// Search over every experiment: swarm runs (task, model, claims, problems, reports) and drug board
// runs (brief, memo, checked claims). The engine does the matching; every word must appear.
export function ExperimentsView({ onOpen }: { onOpen: (view: "Swarm" | "Board") => void }) {
  const [query, setQuery] = useState(() => sessionStorage.getItem("experiments.q") ?? "")
  useEffect(() => sessionStorage.removeItem("experiments.q"), [])
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

  const [question, setQuestion] = useState("")
  const [asked, setAsked] = useState<Asked>({ state: "idle" })
  const asking = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => asking.current?.abort(), [])
  const ask = (e: FormEvent) => {
    e.preventDefault()
    const q = question.trim()
    if (!q || asked.state === "loading") return
    asking.current?.abort()
    const stop = (asking.current = new AbortController())
    setAsked({ state: "loading", question: q })
    fetch(`${ENGINE}/api/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q, kind }), signal: stop.signal })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body.error ?? `The engine answered ${r.status}.`)
        setAsked({ state: "done", question: q, result: body as Answer })
      })
      .catch((err) => { if (err.name !== "AbortError") setAsked({ state: "error", question: q, message: err instanceof TypeError ? "Ask needs the engine. Start it with npm run engine." : String(err.message ?? err) }) })
  }

  const shown = (hits ?? []).filter((h) => kind === "all" || h.kind === kind)
  const open = (h: { kind: "swarm" | "board"; id: string }) => {
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
          <p className="muted small">Ask a question about the runs, or search them by task, model, status, or any text in their claims, problems, reports and memos.</p>
        </div>
      </header>
      <section className="exp-ask card-surface" aria-label="Ask about experiments">
        <form onSubmit={ask}>
          <label htmlFor="experiment-ask">Ask</label>
          <input id="experiment-ask" type="text" name="experiment-ask" maxLength={500} value={question} onChange={(e) => setQuestion(e.currentTarget.value)}
            placeholder="Try: which runs found a table with a header and no rows? What did the board decide about hERG?" />
          <button type="submit" className="primary" disabled={!question.trim() || asked.state === "loading"}>{asked.state === "loading" ? "Reading the runs…" : "Ask"}</button>
        </form>
        {asked.state === "idle" && <p className="muted small">A model reads a summary of every run and answers from it, naming the runs it used. Open a run to check the answer.</p>}
        {asked.state === "loading" && <p className="muted small" role="status">Reading the runs to answer “{asked.question}”…</p>}
        {asked.state === "error" && <p role="alert" className="pill" data-kind="danger">{asked.message}</p>}
        {asked.state === "done" && (
          <div className="exp-answer" aria-live="polite">
            <p className="exp-answer-head">
              {asked.result.mode === "ai"
                ? <span className="pill" data-kind="success">AI answer</span>
                : <span className="pill" data-kind="warning">Keyword search, not an AI answer</span>}
              <span className="muted small">“{asked.question}”</span>
            </p>
            <p>{asked.result.answer}</p>
            {asked.result.note && <p className="muted small">{asked.result.note}</p>}
            {asked.result.runs.length > 0 && (
              <ul className="exp-list">
                {asked.result.runs.map((r) => (
                  <li key={`${r.kind}:${r.id}`}>
                    <button type="button" className="exp-hit card-surface" onClick={() => open(r)}>
                      <span className="exp-head"><b>{r.title}</b><span className="pill">{r.kind === "swarm" ? "swarm run" : "drug board"}</span></span>
                      <span className="muted small">{r.id}</span>
                      {r.why && <span className="exp-match small">{r.why}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {asked.result.mode === "ai" && <p className="muted small">Written by a model from the run records. It can be wrong; the linked runs are the source.</p>}
          </div>
        )}
      </section>
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
