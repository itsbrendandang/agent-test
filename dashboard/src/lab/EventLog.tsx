// The Agent Log, drawn as a group chat: each agent's turn is a message bubble beside its picture and name, a run of
// messages from the same agent is grouped, long reasoning sits behind "Show thinking" (other long text behind "Show
// more"), and tool calls, searches and system steps are small notes between the messages. Every row is still one list item, in the order eventRows gave.
// Built from the dashboard's AI Elements and shadcn parts: Reasoning for "Show thinking", Collapsible for "Show more",
// and the toolbar in LogTools.tsx. Each bubble keeps its own open or closed state.
import { ArrowDownIcon, ChevronDownIcon, CogIcon, SearchIcon, TriangleAlertIcon, WrenchIcon } from "lucide-react"
import { useLayoutEffect, useMemo, useRef, useState } from "react"
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { agentLink } from "@/lib/links"
import { AgentAvatar } from "./AgentAvatar"
import { agentRows, hasCard } from "./agentFocus"
import { chatItems, splitMessage, type ChatItem } from "./chat"
import { readableName } from "./identity"
import { filterRows, logDownload, type EventRow, type LogFilter } from "./logRows"
import { LogTools, type FilterGroup, type FilterOption } from "./LogTools"
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

/** A note's mark: what kind of step it was, at a glance (the AI Elements Tool header's icon, without its card). */
function NoteIcon({ row }: { row: EventRow }) {
  const Icon = row.kind === "error" || row.kind === "limit" ? TriangleAlertIcon
    : ["search", "fetch", "sources", "evaluate"].includes(row.kind) ? SearchIcon
      : row.agentId === "engine" ? CogIcon : WrenchIcon
  return <Icon aria-hidden className="chat-note-icon" />
}

/** An agent's name or face as a button: it filters the log to that agent. */
type OnAgent = (row: EventRow) => void
const onlyLabel = (row: EventRow) => `Show only ${row.agent}'s messages`

function Note({ row, onAgent }: { row: EventRow; onAgent: OnAgent }) {
  return (
    <li className="event-log-row chat-note" data-kind={row.kind}>
      <NoteIcon row={row} />
      <div className="chat-note-body">
        <div className="chat-note-line">
          {row.agentId !== "engine" && <button type="button" className="chat-name" title={onlyLabel(row)} onClick={() => onAgent(row)}><strong>{row.agent}</strong></button>}
          {row.agentId === "engine" && <span className="sr-only">{row.agent}: </span>}
          <span className="chat-note-text">{row.text}</span>
          <When at={row.at} />
          <Cost row={row} />
        </div>
        <Sources row={row} />
      </div>
    </li>
  )
}

/** The rest of a long message that is not reasoning, such as a list of resolved notes. Each bubble keeps its own state. */
function More({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="chat-more">
      <CollapsibleTrigger className="chat-toggle">
        <span>{open ? "Show less" : "Show more"}</span>
        <ChevronDownIcon aria-hidden className="chat-toggle-chevron" data-open={open || undefined} />
      </CollapsibleTrigger>
      <CollapsibleContent className="chat-more-text"><p>{text}</p></CollapsibleContent>
    </Collapsible>
  )
}

function Message({ item, onAgent }: { item: ChatItem; onAgent: OnAgent }) {
  const { row, first, last } = item
  const { say, more } = splitMessage(row.text)
  return (
    <li className="event-log-row chat-msg" data-kind={row.kind} data-first={first || undefined} data-last={last || undefined}>
      <div className="chat-face">{first && (
        // The face and the name filter the log to this agent; the line above the log then links to its details.
        <button type="button" className="chat-face-btn" aria-label={onlyLabel(row)} title={onlyLabel(row)} onClick={() => onAgent(row)}>
          <AgentAvatar name={row.agentId.replace(/^specialist:/, "")} title={row.agent} size={32} />
        </button>
      )}</div>
      <div className="chat-body">
        {first ? <div className="chat-who"><button type="button" className="chat-name" title={onlyLabel(row)} onClick={() => onAgent(row)}><strong>{row.agent}</strong></button><span>{readableName(row.kind)}</span></div> : <span className="sr-only">{row.agent}: </span>}
        <div className="chat-bubble">
          <p>{say || "(no text recorded)"}</p>
          {more && (row.thought
            ? <Reasoning className="chat-thinking"><ReasoningTrigger className="chat-toggle" /><ReasoningContent className="chat-more-text"><p>{more}</p></ReasoningContent></Reasoning>
            : <More text={more} />)}
          <Sources row={row} />
        </div>
        {(validTime(row.at) || row.usd !== undefined) && <div className="chat-meta"><When at={row.at} /><Cost row={row} /></div>}
      </div>
    </li>
  )
}

/** The agent menu's choices, one per agent id: the team first, then the engine's own steps; each with its number of
 * events. Two ids with the same name (two checkers both called "Second, more careful check") get "#2", "#3"… */
function agentGroups(rows: readonly EventRow[]): FilterGroup[] {
  const seen = new Map<string, FilterOption>()
  for (const r of rows) {
    const o = seen.get(r.agentId)
    if (o) o.count++
    else seen.set(r.agentId, { value: r.agentId, label: r.agent, count: 1 })
  }
  const all = [...seen.values()].sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value))
  const named = new Map<string, number>()
  for (const o of all) {
    const n = (named.get(o.label) ?? 0) + 1
    named.set(o.label, n)
    if (n > 1) o.label = `${o.label} #${n}`
  }
  return [{ label: "Team", options: all.filter((o) => o.value !== "engine") }, { label: "System", options: all.filter((o) => o.value === "engine") }]
}
function kindGroups(rows: readonly EventRow[]): FilterGroup[] {
  const seen = new Map<string, number>()
  for (const r of rows) seen.set(r.kind, (seen.get(r.kind) ?? 0) + 1)
  return [{ options: [...seen].map(([value, count]) => ({ value, label: readableName(value), count })).sort((a, b) => a.label.localeCompare(b.label)) }]
}

export function EventLog({ rows, run, connection, agent, onAgent }: {
  rows: EventRow[]; run: { id: string; kind: RunKind; provenance?: Provenance }; connection: Connection
  /** An agent another view named (the address's "agent"): its engine name or its lab character. The agent menu starts on it. */
  agent?: string
  /** Called with the agent's name when the agent filter changes (undefined: every agent), so the address can say it. */
  onAgent?: (name: string | undefined) => void
}) {
  const [filter, setFilterState] = useState<LogFilter>({ agent: "", kind: "", query: "" })
  const [downloadError, setDownloadError] = useState("")
  const agents = useMemo(() => agentGroups(rows), [rows])
  const kinds = useMemo(() => kindGroups(rows), [rows])
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
  // The agent menu and the address say the same: a name from the address picks the menu's choice for that agent, and a
  // choice made here goes back into the address as the agent's own name.
  const setFilter = (next: LogFilter) => {
    setFilterState(next); setReadUpTo(undefined)
    if (next.agent !== filter.agent) onAgent?.(next.agent || undefined) // the menu's value is the agent's own name
  }
  const named = useMemo(() => {
    if (!agent) return undefined
    const mine = agentRows(rows, agent, run.kind)
    if (!mine.length) return null // nothing of this agent in the run (yet)
    const counts = new Map<string, number>()
    for (const r of mine) counts.set(r.agentId, (counts.get(r.agentId) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1])[0][0]
  }, [agent, rows, run.kind])
  const [applied, setApplied] = useState<string>() // the menu choice the address's agent was last turned into
  if (named && named !== applied) { setApplied(named); setFilterState((f) => (f.agent === named ? f : { ...f, agent: named })) }
  const focusOn = (row: EventRow) => setFilter({ ...filter, agent: row.agentId })
  const focused = filter.agent ? rows.find((r) => r.agentId === filter.agent) : undefined
  const live = connection !== "ended" && connection !== "offline"
  const unread = live && readUpTo !== undefined && shown.length > readUpTo
  useLayoutEffect(() => {
    const el = thread.current
    if (live && readUpTo === undefined && el) el.scrollTop = el.scrollHeight
  }, [live, readUpTo, shown])
  const toBottom = () => { const el = thread.current; if (el) el.scrollTop = el.scrollHeight; setReadUpTo(undefined) }
  const onScroll = () => {
    const el = thread.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM
    setReadUpTo(atBottom ? undefined : (n) => n ?? shown.length)
  }

  return (
    <section className="event-log" aria-label="Full event log">
      <LogTools filter={filter} onFilter={setFilter} agents={agents} kinds={kinds} shown={shown.length} onDownload={download} />
      <div className="event-log-status" role="status">
        {connection === "connecting" ? "Reading the run’s events… " : connection === "lost" ? "The event connection failed. Reconnecting; previously received rows are kept. " : connection === "offline" ? "This browser cannot follow events. Try a browser with event-stream support. " : connection === "ended" ? "Finished run · " : "Following live events · "}
        {shown.length} of {rows.length} events shown
      </div>
      {focused && focused.agentId !== "engine" && (
        <p className="event-log-focus">
          <AgentAvatar name={focused.agentId.replace(/^specialist:/, "")} size={24} />
          <span>Only <b>{focused.agent}</b>.</span>
          {run.kind !== "answer" && hasCard(focused.agentId) && <a href={agentLink(focused.agentId, run.kind)}>About this agent</a>}
          <button type="button" className="link-btn" onClick={() => setFilter({ ...filter, agent: "" })}>Show every agent</button>
        </p>
      )}
      {agent && named === null && rows.length > 0 && !filter.agent && <p className="event-log-focus muted">The agent the link named has no events in this run, so every agent is shown.</p>}
      {downloadError && <p role="alert" className="event-log-error">{downloadError}</p>}
      {!rows.length ? <p className="event-log-empty">{connection === "connecting" ? "Loading event log…" : "No events received for this run yet."}</p> : !shown.length ? <p className="event-log-empty">No events match these filters.</p> : (
        <div className="chat-scroll" ref={thread} onScroll={onScroll}>
          <ol className="event-log-rows chat-thread" aria-label="Run events">
            {items.map((item) => item.row.note ? <Note key={item.row.id} row={item.row} onAgent={focusOn} /> : <Message key={item.row.id} item={item} onAgent={focusOn} />)}
          </ol>
        </div>
      )}
      {unread && <Button type="button" variant="outline" size="sm" className="chat-jump" onClick={toBottom}><ArrowDownIcon aria-hidden />New messages</Button>}
    </section>
  )
}
