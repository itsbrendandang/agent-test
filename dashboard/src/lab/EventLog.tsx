// The Agent Log, drawn as a group chat: each agent's turn is a message bubble beside its picture and name, a run of
// messages from the same agent is grouped, long reasoning sits behind "Show thinking", and tool calls, searches and
// system steps are small notes between the messages. Every row is still one list item, in the order eventRows gave.
import { useLayoutEffect, useMemo, useRef, useState } from "react"
import { AgentAvatar } from "./AgentAvatar"
import { chatItems, splitThought, type ChatItem } from "./chat"
import { readableName } from "./identity"
import { filterRows, logDownload, type EventRow, type LogFilter } from "./logRows"
import type { Provenance, RunKind } from "./model"
import type { Connection } from "./useLabModel"
import "../design/eventLog.css"

/** Pixels from the bottom that still count as "reading the newest message". */
const NEAR_BOTTOM = 80

const validTime = (at?: number) => at !== undefined && Number.isFinite(new Date(at).getTime())
function When({ at }: { at?: number }) {
  if (!validTime(at)) return null
  const d = new Date(at!)
  return <time className="chat-time" dateTime={d.toISOString()} title={d.toLocaleString()}>{d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</time>
}
function Cost({ row }: { row: EventRow }) {
  if (row.usd === undefined) return null
  return <span className="chat-cost">${row.usd.toFixed(4)} <small>{row.costScope === "total" ? "run total" : "this event"}</small></span>
}
function Sources({ row }: { row: EventRow }) {
  if (!row.sources.length) return null
  return <ul className="chat-sources" aria-label="Sources">{row.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></li>)}</ul>
}

function Note({ row }: { row: EventRow }) {
  return (
    <li className="event-log-row chat-note" data-kind={row.kind}>
      <div className="chat-note-line">
        {row.agentId !== "engine" && <strong>{row.agent}</strong>}
        {row.agentId === "engine" && <span className="sr-only">{row.agent}: </span>}
        <span className="chat-note-text">{row.text}</span>
        <When at={row.at} />
        <Cost row={row} />
      </div>
      <Sources row={row} />
    </li>
  )
}

function Message({ item }: { item: ChatItem }) {
  const { row, first, last } = item
  const { say, thinking } = splitThought(row.text)
  return (
    <li className="event-log-row chat-msg" data-kind={row.kind} data-first={first || undefined} data-last={last || undefined}>
      <div className="chat-face">{first && <AgentAvatar name={row.agentId.replace(/^specialist:/, "")} title={row.agent} size={32} />}</div>
      <div className="chat-body">
        {first ? <div className="chat-who"><strong>{row.agent}</strong><span>{readableName(row.kind)}</span></div> : <span className="sr-only">{row.agent}: </span>}
        <div className="chat-bubble">
          <p>{say || "(no text recorded)"}</p>
          {thinking && <details className="chat-thinking"><summary>Show thinking</summary><p>{thinking}</p></details>}
          <Sources row={row} />
        </div>
        {(validTime(row.at) || row.usd !== undefined) && <div className="chat-meta"><When at={row.at} /><Cost row={row} /></div>}
      </div>
    </li>
  )
}

export function EventLog({ rows, run, connection }: { rows: EventRow[]; run: { id: string; kind: RunKind; provenance?: Provenance }; connection: Connection }) {
  const [filter, setFilter] = useState<LogFilter>({ agent: "", kind: "", query: "" })
  const [downloadError, setDownloadError] = useState("")
  const agents = useMemo(() => [...new Map(rows.map((r) => [r.agentId, r.agent])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows])
  const kinds = useMemo(() => [...new Set(rows.map((r) => r.kind))].sort(), [rows])
  const shown = useMemo(() => filterRows(rows, filter), [rows, filter])
  const items = useMemo(() => chatItems(shown), [shown])
  const download = (format: "json" | "csv") => {
    try {
      const blob = new Blob([logDownload(shown, run, format)], { type: format === "json" ? "application/json" : "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob), a = document.createElement("a")
      a.href = url; a.download = `agent-log-${run.id.replace(/[^\w.-]/g, "_")}.${format}`
      document.body.append(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setDownloadError("")
    } catch { setDownloadError("The log could not be downloaded. Please try again.") }
  }

  // While the run is live, keep the newest message in view, unless the reader has scrolled up to read.
  // `readUpTo`: how many messages were shown when the reader scrolled up (undefined while following the newest).
  const thread = useRef<HTMLDivElement>(null)
  const [readUpTo, setReadUpTo] = useState<number>()
  const live = connection !== "ended" && connection !== "offline"
  const unread = live && readUpTo !== undefined && shown.length > readUpTo
  useLayoutEffect(() => {
    const el = thread.current
    if (live && readUpTo === undefined && el) el.scrollTop = el.scrollHeight
  }, [live, readUpTo, shown.length])
  const toBottom = () => { const el = thread.current; if (el) el.scrollTop = el.scrollHeight; setReadUpTo(undefined) }
  const onScroll = () => {
    const el = thread.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM
    setReadUpTo(atBottom ? undefined : (n) => n ?? shown.length)
  }

  return (
    <section className="event-log" aria-label="Full event log">
      <div className="event-log-tools">
        <label>Agent<select value={filter.agent} onChange={(e) => setFilter({ ...filter, agent: e.target.value })}><option value="">All agents</option>{agents.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label>Kind of step<select value={filter.kind} onChange={(e) => setFilter({ ...filter, kind: e.target.value })}><option value="">All kinds</option>{kinds.map((kind) => <option key={kind} value={kind}>{readableName(kind)}</option>)}</select></label>
        <label className="event-log-search">Search log<input type="search" placeholder="Search messages, agents or sources…" value={filter.query} onChange={(e) => setFilter({ ...filter, query: e.target.value })} /></label>
        <button type="button" className="btn" onClick={() => setFilter({ agent: "", kind: "", query: "" })}>Clear filters</button>
        <div className="event-log-downloads" role="group" aria-label="Download shown log"><button type="button" className="btn" onClick={() => download("json")}>Download JSON</button><button type="button" className="btn" onClick={() => download("csv")}>Download CSV</button></div>
      </div>
      <div className="event-log-status" role="status">
        {connection === "connecting" ? "Reading the run’s events… " : connection === "lost" ? "The event connection failed. Reconnecting; previously received rows are kept. " : connection === "offline" ? "This browser cannot follow events. Try a browser with event-stream support. " : connection === "ended" ? "Finished run · " : "Following live events · "}
        {shown.length} of {rows.length} events shown
      </div>
      {downloadError && <p role="alert">{downloadError}</p>}
      {!rows.length ? <p className="event-log-empty">{connection === "connecting" ? "Loading event log…" : "No events received for this run yet."}</p> : !shown.length ? <p className="event-log-empty">No events match these filters.</p> : (
        <div className="chat-scroll" ref={thread} onScroll={onScroll}>
          <ol className="event-log-rows chat-thread" aria-label="Run events">
            {items.map((item) => item.row.note ? <Note key={item.row.id} row={item.row} /> : <Message key={item.row.id} item={item} />)}
          </ol>
        </div>
      )}
      {unread && <button type="button" className="btn chat-jump" onClick={toBottom}>New messages ↓</button>}
    </section>
  )
}
