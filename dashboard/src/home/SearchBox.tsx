// Search on Home: finds what already exists (runs, agents, skills) by its words. It asks no model. The chat box
// below is for questions. Results open in the view that shows them. "/" or Cmd/Ctrl+K puts the cursor here.
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react"
import { StatusPill } from "@/components/Shared"
import { fmtScore } from "@/lib/format"
import { runState } from "@/lib/status"
import { ChatRefused, searchAll, type SearchKind, type SearchResult } from "./api"
import { highlight, KIND_LABEL, moveActive, SEARCH_KINDS } from "./chat"

const Marked = ({ text, query }: { text: string; query: string }) => <>{highlight(text, query).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : p.text))}</>

export function SearchBox({ onOpen }: { onOpen: (result: SearchResult) => void }) {
  const uid = useId()
  const field = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")
  const [kind, setKind] = useState<SearchKind | "all">("all")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  // What the engine answered, and for which question: an answer to an older question is never shown.
  const [got, setGot] = useState<{ key: string; results?: SearchResult[]; error?: string }>()

  const q = query.trim()
  const key = `${kind}\n${q}`
  useEffect(() => {
    if (!q) return
    const stop = new AbortController()
    const timer = window.setTimeout(() => {
      searchAll(q, kind, 20, stop.signal).then(
        (results) => setGot({ key, results }),
        (error: unknown) => { if ((error as Error)?.name !== "AbortError") setGot({ key, error: error instanceof ChatRefused ? error.message : String(error) }) },
      )
    }, 200)
    return () => { window.clearTimeout(timer); stop.abort() }
  }, [q, kind, key])

  useEffect(() => {
    const focus = (e: globalThis.KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))
      const slash = e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey
      const k = e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey
      if ((!slash && !k) || document.querySelector("dialog[open]")) return
      e.preventDefault(); field.current?.focus(); field.current?.select()
    }
    window.addEventListener("keydown", focus)
    return () => window.removeEventListener("keydown", focus)
  }, [])

  const current = got?.key === key ? got : undefined
  const results = current?.results ?? []
  const row = Math.min(active, results.length - 1)
  const choose = (r: SearchResult) => { setOpen(false); onOpen(r) }
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { if (open) { e.preventDefault(); setOpen(false) } return }
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || ((e.key === "Home" || e.key === "End") && open && row >= 0)) {
      e.preventDefault(); setOpen(true); setActive(moveActive(row, e.key, results.length))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const hit = results[row >= 0 ? row : 0]
      if (open && hit) choose(hit)
    }
  }
  const shown = open && q !== ""
  // Keep the row the arrow keys are on in sight in a long list.
  useEffect(() => { if (shown && row >= 0) document.getElementById(`${uid}-r${row}`)?.scrollIntoView?.({ block: "nearest" }) }, [shown, row, uid])

  return (
    <section className="home-search" aria-label="Search runs, agents and skills" data-open={open || undefined}>
      <div className="home-search-bar">
        <label htmlFor={`${uid}-q`}>Search</label>
        <input id={`${uid}-q`} ref={field} type="search" role="combobox" maxLength={200} autoComplete="off" spellCheck={false} value={query}
          placeholder="Find a run, agent or skill" aria-expanded={shown} aria-controls={`${uid}-list`} aria-autocomplete="list"
          aria-activedescendant={shown && row >= 0 ? `${uid}-r${row}` : undefined} aria-describedby={`${uid}-help`}
          onChange={(e) => { setQuery(e.currentTarget.value); setOpen(true); setActive(-1) }} onFocus={() => setOpen(true)} onKeyDown={keys}
          onBlur={() => window.setTimeout(() => { if (!field.current?.closest(".home-search")?.contains(document.activeElement)) setOpen(false) }, 0)} />
        <kbd aria-hidden="true">/</kbd>
      </div>
      {/* Open while the field has the cursor: what search is for, the kind filter, then the results. */}
      <div className="home-results card-surface" hidden={!open}>
        <p className="muted small" id={`${uid}-help`}>Search finds runs, agents and skills that already exist, by their words. No model is asked. To ask a question or plan research, use the chat box.</p>
        <div role="group" aria-label="Kind of result" className="exp-kinds">
          {SEARCH_KINDS.map((k) => (
            <button key={k.id} type="button" aria-pressed={kind === k.id} onMouseDown={(e) => e.preventDefault()} onClick={() => { setKind(k.id); setActive(-1); setOpen(true); field.current?.focus() }}>{k.label}</button>
          ))}
        </div>
        {!q && <p className="empty-note">Type a word to search: a task, a model, a claim, an agent's name, a skill. Arrow keys move through the results and Enter opens one.</p>}
        {q && (
          <p className="muted small home-results-head" role="status">
            {!current ? "Searching…" : current.error ? "" : results.length === 0 ? "" : `${results.length} result${results.length === 1 ? "" : "s"} · keyword search, no model · arrow keys to move, Enter to open`}
          </p>
        )}
        {q && current?.error && <p className="newrun-error" role="alert">Search did not work: {current.error}</p>}
        {q && current?.results && results.length === 0 && (
          <p className="empty-note">Nothing matches “{q}”{kind === "all" ? "" : ` in ${SEARCH_KINDS.find((k) => k.id === kind)!.label.toLowerCase()}`}. Try fewer words{kind === "all" ? "" : ", or All"}. To ask a question, use the chat box.</p>
        )}
        <ul role="listbox" id={`${uid}-list`} aria-label="Search results">
          {(q ? results : []).map((r, i) => (
            <li key={`${r.kind}:${r.id}`} id={`${uid}-r${i}`} role="option" aria-selected={i === row} onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()} onClick={() => choose(r)}>
              <span className="exp-head">
                <b><Marked text={r.title} query={q} /></b>
                <span className="pill exp-kind">{KIND_LABEL[r.kind]}</span>
                {r.status && <StatusPill state={runState(r.status, r.kind !== "swarm" || r.score !== undefined)} />}
                {r.score !== undefined && <span className="exp-score">{fmtScore(r.score)}</span>}
              </span>
              <span className="muted small"><span className="run-id" title={r.id}>{r.id}</span>{r.startedAt !== undefined && <> · started {new Date(r.startedAt).toLocaleString()}</>}</span>
              {r.excerpt && <span className="exp-match small"><Marked text={r.excerpt} query={q} /></span>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
