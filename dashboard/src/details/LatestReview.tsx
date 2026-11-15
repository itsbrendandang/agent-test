// On an agent's card in the Agents view: what it did in the newest team review, with the same details as the review's
// own panel (DetailView). It follows that review live while it runs. Nothing is shown for a review that is not there.
import { useEffect, useState } from "react"
import { get, useRunEvents, type RunSummary } from "@/board/api"
import type { LabEvent } from "@/lab/adapter"
import { plainTitle, plainWhen } from "@/lib/format"
import { runLink } from "@/lib/links"
import { DetailView } from "./DetailSheet"
import { useEngineRoster } from "./roster"

export function LatestReview({ agent }: { agent: string }) {
  const [run, setRun] = useState<RunSummary | null>()
  useEffect(() => {
    let stale = false
    get<RunSummary[]>("/api/runs").then((r) => { if (!stale) setRun(Array.isArray(r) && r[0] ? r[0] : null) }, () => { if (!stale) setRun(null) })
    return () => { stale = true }
  }, [])
  const events = useRunEvents(run?.id)
  const roster = useEngineRoster()
  if (run === undefined) return <p className="muted small" role="status">Looking for the newest team review…</p>
  if (run === null) return <p className="detail-unknown">No team review yet, so there is nothing this agent did to show.</p>
  return (
    <section className="detail-latest" aria-label="In the newest team review">
      <h3 className="detail-latest-head">In the newest team review</h3>
      <p className="muted small">{plainTitle(run.brief)} · started {plainWhen(run.startedAt)}{run.example ? " · Example · practice, $0" : ""} · <a href={runLink("board", run.id)}>Open the review</a></p>
      <DetailView target={{ kind: "agent", id: agent }} run={{ kind: "board", id: run.id, live: run.status === "running", practice: run.example ? true : undefined }} events={events as unknown as LabEvent[]} roster={roster} parts={{ Title: "h4", Description: "p" }} />
    </section>
  )
}
