// The Agent Log's run bar: which run the log shows (runs in progress first, then finished ones, newest first in each),
// and Follow newest. The same 32 px shadcn controls as the log's toolbar, on the same left edge.
import { LocateFixedIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { plainWhen } from "@/lib/format"
import { PROVENANCE_WORD } from "@/lib/provenance"
import { KIND_WORD } from "./model"
import type { RunRef } from "./runs"

const runKey = (r: { kind: string; id: string }) => `${r.kind}/${r.id}`
const short = (title: string) => (title.length > 80 ? `${title.slice(0, 79)}…` : title)

function RunItem({ run }: { run: RunRef }) {
  const facts = [KIND_WORD[run.kind], run.startedAt ? plainWhen(run.startedAt) : "", run.provenance ? PROVENANCE_WORD[run.provenance] : "", run.status].filter(Boolean).join(" · ")
  return (
    <SelectItem value={runKey(run)} textValue={run.title} className="lab-run-item">
      <span className="lab-run-text"><span className="lab-run-title">{short(run.title)}</span><small>{facts}</small></span>
    </SelectItem>
  )
}

export function RunPicker({ runs, target, following, onPick }: {
  runs: RunRef[]
  /** The run shown, which may not be in the list (an address that names an older run). */
  target?: RunRef
  /** True while no run is chosen: the log shows the run in progress, else the newest run. */
  following: boolean
  /** A run's "kind/id", or "" to follow the newest run again. */
  onPick: (value: string) => void
}) {
  const key = target && runKey(target)
  const live = runs.filter((r) => r.live), done = runs.filter((r) => !r.live)
  const unlisted = target && !runs.some((r) => runKey(r) === key)
  return (
    <div className="lab-bar" role="group" aria-label="Run">
      <Select value={key ?? ""} onValueChange={onPick}>
        <SelectTrigger aria-label="Run shown in the Agent Log" title="Show the full event log for this run." className="lab-picker">
          <SelectValue placeholder="Choose a run">{target ? short(target.title) : undefined}</SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" align="start" className="lab-run-menu">
          {unlisted && target && <SelectGroup><RunItem run={target} /></SelectGroup>}
          {live.length > 0 && <SelectGroup><SelectLabel>In progress</SelectLabel>{live.map((r) => <RunItem key={runKey(r)} run={r} />)}</SelectGroup>}
          {live.length > 0 && done.length > 0 && <SelectSeparator />}
          {done.length > 0 && <SelectGroup><SelectLabel>Finished</SelectLabel>{done.map((r) => <RunItem key={runKey(r)} run={r} />)}</SelectGroup>}
        </SelectContent>
      </Select>
      <Button type="button" variant={following ? "secondary" : "outline"} aria-pressed={following} onClick={() => onPick(following ? key ?? "" : "")}
        title="Follow: always show the run in progress, else the newest run. Press again to stay on this run.">
        <LocateFixedIcon aria-hidden />Follow newest
      </Button>
    </div>
  )
}
