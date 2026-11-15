// "What was checked": the evidence on the first screen. The verdict counts of the latest board review and the
// latest like-for-like score row, each labelled scripted or real from the run itself, each opening that run in its view.
import { useEffect, useState } from "react"
import { ENGINE, useRunEvents, type RunSummary } from "@/board/api"
import { ModeLabel, Verdict } from "@/components/Shared"
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
      {got && !got.review && !row && <p className="muted small">Nothing has been checked yet. Ask a question to get a plan.</p>}
      {got?.review && (
        <button type="button" className="home-checked-row" onClick={() => onOpen("board", got.review!.id)}>
          <span className="home-checked-what">Latest review <ModeLabel scripted={f.scripted} /></span>
          {events.length === 0 ? <span className="muted small">reading its checks…</span> : (
            <span className="trust">
              <Verdict verdict="verified" count={f.verified} />
              <Verdict verdict="contradicted" count={f.contradicted} />
              <Verdict verdict="unsupported" count={f.unsupported + f.unchecked} />
              <span className="muted small">of {f.claims.length} statements checked</span>
            </span>
          )}
        </button>
      )}
      {row && (
        <button type="button" className="home-checked-row" onClick={() => onOpen("swarm", row.swarm!.id)}>
          <span className="home-checked-what">One agent or a team? <ModeLabel scripted={scriptedRow} demo={row.task === "demo"} /></span>
          <span>
            <b>{fmtScore(row.swarm!.score)}</b> vs <b>{fmtScore(row.single!.score)}</b>
            {" · "}{row.diff === 0 ? "a tie" : row.diff! > 0 ? `the team ahead by ${fmtScore(row.diff)}` : `the lone agent ahead by ${fmtScore(-row.diff!)}`}
            <span className="muted small"> · team score vs lone agent score, out of 1, on the same task with the same limits</span>
          </span>
        </button>
      )}
      <p className="muted small">Every statement is checked by code or by a separate checker. No model grades its own work.</p>
    </section>
  )
}
