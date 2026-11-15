// "What was checked": the evidence on the first screen. The verdict counts of the latest board review and the
// latest like-for-like score row, each labelled scripted or real from the run itself, each opening that run in its view.
import { useEffect, useState } from "react"
import { ENGINE, useRunEvents, type RunSummary } from "@/board/api"
import { ModeLabel } from "@/components/Shared"
import { fmtScore } from "@/lib/format"
import { boardFacts } from "@/lib/verdict"
import type { ScoreRow } from "@/swarm/api"
import { latestReview, pairedRow } from "./chat"

const read = <T,>(path: string): Promise<T | undefined> => fetch(ENGINE + path).then((r) => (r.ok ? (r.json() as Promise<T>) : undefined), () => undefined)

export function Checked({ onOpen }: { onOpen: (kind: "swarm" | "board", id: string) => void }) {
  const [got, setGot] = useState<{ review?: RunSummary; row?: ScoreRow }>()
  useEffect(() => {
    let stale = false
    void Promise.all([read<unknown>("/api/runs"), read<unknown>("/api/glhf/scoreboard")]).then(([runs, rows]) => {
      if (!stale) setGot({ review: latestReview(runs), row: pairedRow(rows) })
    })
    return () => { stale = true }
  }, [])
  const events = useRunEvents(got?.review?.id)
  const f = boardFacts(events)
  const row = got?.row
  const scriptedRow = row ? row.model === "mock" : undefined

  return (
    <section className="home-checked card-surface" aria-labelledby="home-checked-title">
      <h2 id="home-checked-title">What was checked</h2>
      {!got && <p className="muted small" role="status">Reading the latest results…</p>}
      {got && !got.review && !row && <p className="muted small">Nothing has been checked yet. Ask a question to get a plan, or start a run in Compare.</p>}
      {got?.review && (
        <button type="button" className="home-checked-row" onClick={() => onOpen("board", got.review!.id)}>
          <span className="home-checked-what">Latest board review <ModeLabel scripted={f.scripted} /></span>
          {events.length === 0 ? <span className="muted small">reading its checks…</span> : (
            <span className="trust">
              <span className="v v-verified">{f.verified} verified</span>
              <span className="v v-contradicted">{f.contradicted} contradicted</span>
              <span className="v v-unsupported">{f.unsupported + f.unchecked} unsupported</span>
              <span className="muted small">of {f.claims.length} claims</span>
            </span>
          )}
        </button>
      )}
      {row && (
        <button type="button" className="home-checked-row" onClick={() => onOpen("swarm", row.swarm!.id)}>
          <span className="home-checked-what">Swarm vs single agent <ModeLabel scripted={scriptedRow} demo={row.task === "demo"} /></span>
          <span>
            <b>{fmtScore(row.swarm!.score)}</b> vs <b>{fmtScore(row.single!.score)}</b>
            {" · "}{row.diff === 0 ? "a tie" : row.diff! > 0 ? `swarm ahead by ${fmtScore(row.diff)}` : `single agent ahead by ${fmtScore(-row.diff!)}`}
            <span className="muted small"> · same task, model, time and tokens</span>
          </span>
        </button>
      )}
      <p className="muted small">Verdicts are computed by code from registered tests or ruled by a checker. No model decides its own verdict.</p>
    </section>
  )
}
