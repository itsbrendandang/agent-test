// The Agent Log's toolbar, on one row: what to show (search, agent, kind of step, clear) on the left; how to show it
// (View) and what to take away (Download) on the right. Every control is a 32 px shadcn control, so they line up.
import { ChevronDownIcon, DownloadIcon, SearchIcon, SlidersHorizontalIcon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { LogFilter } from "./logRows"

/** The "everything" choice of a filter menu. A Radix select cannot hold "", which the filter uses for "everything". */
const ALL = "all"

/** How the log is drawn. Not a filter: Clear filters leaves it alone. */
export interface LogView {
  /** Show tool calls, searches and system steps (the small notes between messages). */
  notes: boolean
  /** Show each message's time and cost. */
  meta: boolean
}
export const DEFAULT_VIEW: LogView = { notes: true, meta: true }

export interface FilterOption { value: string; label: string; count: number }
export interface FilterGroup { label?: string; options: FilterOption[] }

/** A filter menu: "All …" first, then each group under its label, each choice with its number of events. */
function FilterSelect({ label, all, value, groups, onChange, className }: { label: string; all: string; value: string; groups: FilterGroup[]; onChange: (value: string) => void; className?: string }) {
  const chosen = groups.flatMap((g) => g.options).find((o) => o.value === value)
  const filled = groups.filter((g) => g.options.length > 0)
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
      <SelectTrigger aria-label={label} className={cn("event-log-select", className)} data-active={value ? "" : undefined}>
        <SelectValue>{value ? chosen?.label ?? value : all}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" align="start" className="event-log-menu">
        <SelectItem value={ALL}>{all}</SelectItem>
        {filled.map((g, i) => (
          <SelectGroup key={g.label ?? i}>
            <SelectSeparator />
            {g.label && <SelectLabel>{g.label}</SelectLabel>}
            {g.options.map((o) => (
              <SelectItem key={o.value} value={o.value} textValue={o.label}>
                {o.label}<span className="event-log-count" aria-label={`${o.count} events`}>{o.count}</span>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

export function LogTools({ filter, onFilter, agents, kinds, view, onView, shown, onDownload }: {
  filter: LogFilter
  onFilter: (next: LogFilter) => void
  agents: FilterGroup[]
  kinds: FilterGroup[]
  view: LogView
  onView: (next: LogView) => void
  /** How many events are shown, which is what a download holds. */
  shown: number
  onDownload: (format: "json" | "csv") => void
}) {
  const filtered = !!(filter.agent || filter.kind || filter.query)
  return (
    <div className="event-log-tools">
      <div className="event-log-filters" role="group" aria-label="Filter the log">
        <InputGroup className="event-log-search">
          <InputGroupAddon><SearchIcon aria-hidden /></InputGroupAddon>
          <InputGroupInput type="search" aria-label="Search log" placeholder="Search messages, agents or sources…" value={filter.query} onChange={(e) => onFilter({ ...filter, query: e.target.value })} />
        </InputGroup>
        <FilterSelect label="Agent" all="All agents" value={filter.agent} groups={agents} onChange={(agent) => onFilter({ ...filter, agent })} />
        <FilterSelect label="Kind of step" all="All kinds of step" value={filter.kind} groups={kinds} onChange={(kind) => onFilter({ ...filter, kind })} />
        <Button type="button" variant="ghost" className="event-log-clear" aria-label="Clear filters" title="Clear filters" disabled={!filtered} onClick={() => onFilter({ agent: "", kind: "", query: "" })}>
          <XIcon aria-hidden />Clear
        </Button>
      </div>
      <div className="event-log-actions">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline"><SlidersHorizontalIcon aria-hidden />View<ChevronDownIcon aria-hidden className="text-muted-foreground" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="event-log-menu w-64">
            <DropdownMenuLabel>Show in the log</DropdownMenuLabel>
            <DropdownMenuCheckboxItem checked={view.notes} onCheckedChange={(on) => onView({ ...view, notes: on === true })}>
              <span className="event-log-menu-text"><span>Step notes</span><small>Tool calls, searches and system steps</small></span>
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={view.meta} onCheckedChange={(on) => onView({ ...view, meta: on === true })}>
              <span className="event-log-menu-text"><span>Times and costs</span><small>Under each message</small></span>
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" disabled={!shown}><DownloadIcon aria-hidden />Download<ChevronDownIcon aria-hidden className="text-muted-foreground" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="event-log-menu w-64">
            <DropdownMenuLabel>The {shown} shown {shown === 1 ? "event" : "events"}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onDownload("json")}>
              <span className="event-log-menu-text"><span>Download JSON</span><small>For scripts and other tools</small></span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDownload("csv")}>
              <span className="event-log-menu-text"><span>Download CSV</span><small>For a spreadsheet</small></span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
