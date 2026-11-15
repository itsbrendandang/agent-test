import { useMemo, useState } from "react"
import { readableName } from "./identity"
import { filterRows, logDownload, type EventRow, type LogFilter } from "./logRows"
import type { Provenance, RunKind } from "./model"
import type { Connection } from "./useLabModel"
import "../design/eventLog.css"

export function EventLog({ rows, run, connection }: { rows: EventRow[]; run: { id: string; kind: RunKind; provenance?: Provenance }; connection: Connection }) {
  const [filter, setFilter] = useState<LogFilter>({ agent: "", kind: "", query: "" })
  const [downloadError, setDownloadError] = useState("")
  const agents = useMemo(() => [...new Map(rows.map((r) => [r.agentId, r.agent])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows])
  const kinds = useMemo(() => [...new Set(rows.map((r) => r.kind))].sort(), [rows])
  const shown = useMemo(() => filterRows(rows, filter), [rows, filter])
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
  return (
    <section className="event-log" aria-label="Full event log">
      <div className="event-log-tools">
        <label>Agent<select value={filter.agent} onChange={(e) => setFilter({ ...filter, agent: e.target.value })}><option value="">All agents</option>{agents.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label>Kind of step<select value={filter.kind} onChange={(e) => setFilter({ ...filter, kind: e.target.value })}><option value="">All kinds</option>{kinds.map((kind) => <option key={kind} value={kind}>{readableName(kind)}</option>)}</select></label>
        <label className="event-log-search">Search log<input type="search" placeholder="Search actions, agents or sources…" value={filter.query} onChange={(e) => setFilter({ ...filter, query: e.target.value })} /></label>
        <button type="button" className="btn" onClick={() => setFilter({ agent: "", kind: "", query: "" })}>Clear filters</button>
        <div className="event-log-downloads" role="group" aria-label="Download shown log"><button type="button" className="btn" onClick={() => download("json")}>Download JSON</button><button type="button" className="btn" onClick={() => download("csv")}>Download CSV</button></div>
      </div>
      <div className="event-log-status" role="status">
        {connection === "connecting" ? "Reading the run’s events… " : connection === "lost" ? "The event connection failed. Reconnecting; previously received rows are kept. " : connection === "offline" ? "This browser cannot follow events. Try a browser with event-stream support. " : connection === "ended" ? "Finished run · " : "Following live events · "}
        {shown.length} of {rows.length} events shown
      </div>
      {downloadError && <p role="alert">{downloadError}</p>}
      {!rows.length ? <p className="event-log-empty">{connection === "connecting" ? "Loading event log…" : "No events received for this run yet."}</p> : !shown.length ? <p className="event-log-empty">No events match these filters.</p> : (
        <ol className="event-log-rows" aria-label="Run events">
          {shown.map((row) => <li key={row.id} className="event-log-row" data-kind={row.kind}>
            <div className="event-log-time">{row.at !== undefined && Number.isFinite(new Date(row.at).getTime()) ? <time dateTime={new Date(row.at).toISOString()} title={new Date(row.at).toLocaleString()}>{new Date(row.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}<br />{new Date(row.at).toLocaleTimeString()}</time> : "Time not recorded"}</div>
            <div className="event-log-agent"><strong>{row.agent}</strong><span>{readableName(row.kind)}</span></div>
            <div className="event-log-action"><p>{row.text}</p>{row.sources.length > 0 && <ul aria-label="Sources">{row.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></li>)}</ul>}</div>
            <div className="event-log-cost">{row.usd !== undefined ? <><span>${row.usd.toFixed(4)}</span><small>{row.costScope === "total" ? "run total" : "this event"}</small></> : <span className="muted" aria-label="Cost not recorded">—</span>}</div>
          </li>)}
        </ol>
      )}
    </section>
  )
}
