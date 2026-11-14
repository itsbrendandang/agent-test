import { type FormEvent, useEffect, useRef, useState } from "react"
import { ENGINE } from "@/board/api"
import { EngineOffline, PageHead, runState, StatusPill } from "@/components/Shared"
import { fmtScore } from "@/lib/format"

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

// The last answer is kept for the browser session, so coming back from a cited run does not cost a second model call.
const ASKED = "experiments.ask"
function lastAsked(): Asked {
  try {
    const saved = JSON.parse(sessionStorage.getItem(ASKED) ?? "null") as { question?: unknown; result?: unknown } | null
    if (saved && typeof saved.question === "string" && isAnswer(saved.result)) return { state: "done", question: saved.question, result: saved.result }
  } catch { /* unreadable: start empty */ }
  return { state: "idle" }
}
const isAnswer = (x: unknown): x is Answer => {
  const a = x as Answer | null
  return !!a && typeof a.answer === "string" && Array.isArray(a.runs) && (a.mode === "ai" || a.mode === "keyword")
}

// Two ways to find an experiment. Ask: a question in plain words, answered by a model from an index of every
// run, with the runs it used. Search: over swarm runs (task, model, claims, problems, reports) and drug board
// runs (brief, memo, checked claims). The engine does the matching; every word must appear.
export function ExperimentsView({ onOpen }: { onOpen: (view: "Swarm" | "Board") => void }) {
  const [query, setQuery] = useState(() => sessionStorage.getItem("experiments.q") ?? "")
  useEffect(() => sessionStorage.removeItem("experiments.q"), [])
  const [kind, setKind] = useState<Kind>("all")
  const [hits, setHits] = useState<Hit[]>()
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const stop = new AbortController()
    const timer = window.setTimeout(() => {
      fetch(`${ENGINE}/api/search?q=${encodeURIComponent(query)}`, { signal: stop.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((h: unknown) => { if (!Array.isArray(h)) throw new Error("not a list"); setHits(h as Hit[]); setError(false) })
        .catch((e) => { if (e.name !== "AbortError") setError(true) })
    }, 200)
    return () => { window.clearTimeout(timer); stop.abort() }
  }, [query, retry])

  const [asked, setAsked] = useState<Asked>(lastAsked)
  const [question, setQuestion] = useState(() => (asked.state === "done" ? asked.question : ""))
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
        if (!r.ok) throw new Error(typeof body.error === "string" ? body.error : `The engine answered ${r.status}.`)
        if (!isAnswer(body)) throw new Error("The engine sent an answer this page cannot read.")
        sessionStorage.setItem(ASKED, JSON.stringify({ question: q, result: body }))
        setAsked({ state: "done", question: q, result: body })
      })
      .catch((err) => { if (err.name !== "AbortError") setAsked({ state: "error", question: q, message: err instanceof TypeError ? "Ask needs the engine. Start it with npm run engine." : String(err.message ?? err) }) })
  }

  const clearAsked = () => {
    asking.current?.abort()
    sessionStorage.removeItem(ASKED)
    setAsked({ state: "idle" }); setQuestion("")
    document.getElementById("experiment-ask")?.focus()
  }
  const scope = kind === "swarm" ? "swarm runs only" : kind === "board" ? "drug board runs only" : ""

  const shown = (hits ?? []).filter((h) => kind === "all" || h.kind === kind)
  const open = (h: { kind: "swarm" | "board"; id: string }) => {
    sessionStorage.setItem(`open.${h.kind}`, h.id)
    if (query.trim()) sessionStorage.setItem("experiments.q", query) // so Back returns to the same search
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
      <PageHead title="Experiments" about="Find any past run. Ask a question in plain words, or search by task, model, status, or any text in the claims, problems, reports and memos." />
      <section className="exp-ask card-surface" aria-label="Ask about experiments">
        <form onSubmit={ask}>
          <label htmlFor="experiment-ask">Ask</label>
          <input id="experiment-ask" type="text" name="experiment-ask" maxLength={500} autoComplete="off" value={question} onChange={(e) => setQuestion(e.currentTarget.value)}
            aria-describedby="experiment-ask-help"
            placeholder="Try: which runs found a table with a header and no rows? What did the board decide about hERG?" />
          <button type="submit" className="exp-ask-go" disabled={!question.trim() || asked.state === "loading"}>{asked.state === "loading" ? "Asking…" : "Ask"}</button>
          {(asked.state === "done" || asked.state === "error") && <button type="button" className="link-btn" onClick={clearAsked}>Clear</button>}
        </form>
        <p id="experiment-ask-help" className="muted small" hidden={asked.state !== "idle"}>
          A model reads a summary of {scope || "every run"} and answers from it, naming the runs it used. Open a run to check the answer. Press Enter to ask.
        </p>
        <div className="exp-answer" aria-live="polite" aria-busy={asked.state === "loading"}>
          {asked.state === "loading" && <p className="muted small exp-loading"><span className="exp-spinner" aria-hidden="true" />Reading {scope || "the runs"} to answer “{asked.question}”. This can take up to a minute.</p>}
          {asked.state === "error" && (
            <p role="alert" className="exp-error">Could not answer “{asked.question}”: {asked.message}</p>
          )}
          {asked.state === "done" && (
            <>
              <p className="exp-answer-head">
                {asked.result.mode === "ai"
                  ? <span className="pill" data-kind="success">AI answer</span>
                  : <span className="pill" data-kind="warning">Keyword search, not an AI answer</span>}
                <span className="muted small">“{asked.question}”</span>
              </p>
              <p className="exp-answer-text">{asked.result.answer}</p>
              {asked.result.note && <p className="muted small">{asked.result.note}</p>}
              {asked.result.runs.length > 0 ? (
                <ul className="exp-list exp-cited" aria-label="Runs the answer used">
                  {asked.result.runs.map((r) => (
                    <li key={`${r.kind}:${r.id}`}>
                      <button type="button" className="exp-hit card-surface" onClick={() => open(r)}>
                        <span className="exp-head"><b>{r.title}</b><span className="pill exp-kind">{r.kind === "swarm" ? "swarm run" : "drug board"}</span></span>
                        <span className="muted small run-id" title={r.id}>{r.id}</span>
                        {r.why && <span className="exp-match small">{r.why}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted small">No runs were cited for this answer.</p>}
              {asked.result.mode === "ai" && <p className="muted small">Written by a model from the run records. It can be wrong; the linked runs are the source.</p>}
            </>
          )}
        </div>
      </section>
      <div className="exp-bar">
        <input type="search" name="experiment-search" aria-label="Search experiments by keyword" autoFocus autoComplete="off" value={query}
          placeholder="Try: demo, single agent, refuted, hERG, header rows…" onChange={(e) => setQuery(e.currentTarget.value)} />
        <div role="group" aria-label="Kind of experiment" className="exp-kinds">
          {(["all", "swarm", "board"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {k === "all" ? "All" : k === "swarm" ? "Swarm runs" : "Drug board"}
            </button>
          ))}
        </div>
      </div>
      {error && <EngineOffline needs="Search and Ask read the runs through the engine." onRetry={() => { setError(false); setRetry((n) => n + 1) }} />}
      {!hits && !error && <p className="muted small" role="status">Loading experiments…</p>}
      {hits && <p className="muted small">{shown.length} {shown.length === 1 ? "experiment" : "experiments"}{query.trim() ? ` matching “${query.trim()}”` : ""}</p>}
      <ul className="exp-list" aria-label="Experiments">
        {shown.map((h) => (
          <li key={`${h.kind}:${h.id}`}>
            <button type="button" className="exp-hit card-surface" onClick={() => open(h)}>
              <span className="exp-head">
                <b>{mark(h.title)}</b>
                <StatusPill state={runState(h.status, h.kind !== "swarm" || h.score !== undefined)} />
                <span className="pill exp-kind">{h.kind === "swarm" ? "swarm run" : "drug board"}</span>
                {h.score !== undefined && <span className="exp-score" title="Score from the grader, out of 1">{fmtScore(h.score)}</span>}
              </span>
              <span className="muted small"><span className="run-id" title={h.id}>{mark(h.id)}</span> · started {new Date(h.startedAt).toLocaleString()}</span>
              {h.matches.filter((m) => m.where !== "run").map((m, i) => (
                <span key={i} className="exp-match small"><i>{m.where}:</i> {mark(m.text)}</span>
              ))}
            </button>
          </li>
        ))}
      </ul>
      {hits && shown.length === 0 && !error && (query.trim()
        ? <p className="empty-note">No experiments match. Every word has to appear in the run. Try fewer words, or ask a question in the box above.</p>
        : <p className="empty-note">No {kind === "swarm" ? "swarm runs" : kind === "board" ? "drug board reviews" : "experiments"} yet. Start a run in the Swarm view, or convene the board in the Board view. Finished runs appear here.</p>)}
    </div>
  )
}
