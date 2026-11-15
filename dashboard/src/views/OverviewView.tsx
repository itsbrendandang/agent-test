// The Overview: how much has been run, how much of it is research, and when. It reads the same three lists the
// other views read (team reviews, research answers, benchmark runs) and counts them. A practice run is counted
// apart and is never added to "research done": the big number is only what real models produced.
import { CalendarDays, FlaskConical, MessageSquareText, Trophy, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Provenance } from "@/components/Provenance"
import { EngineOffline } from "@/components/Shared"
import { AgentAvatar } from "@/lab/AgentAvatar"
import { answerRuns, boardRuns, mergeRuns, swarmRuns, type RunRef } from "@/lab/runs"
import { problemOf, readEngine, type Problem } from "@/lib/engine"
import { plainWhen } from "@/lib/format"
import { useBoardScripted } from "@/lib/scripted"
import type { View } from "@/nav"
import { Credits } from "@/overview/Credits"
import { Hero } from "@/overview/Hero"
import { activityOf, KIND_LABEL, KINDS, niceTop, perDay, totalsOf, type Day } from "@/overview/model"
import "@/overview/overview.css"

const KIND_ICON = { answer: MessageSquareText, board: FlaskConical, swarm: Trophy } as const
const DAYS = 14

/** The three run lists. A list the engine does not have (an older engine) counts as empty. */
function useRuns() {
  const [runs, setRuns] = useState<RunRef[]>()
  const [problem, setProblem] = useState<Problem>()
  const [again, setAgain] = useState(0)
  useEffect(() => {
    let stopped = false
    void Promise.allSettled([readEngine<unknown>("/api/runs"), readEngine<unknown>("/api/research?all=1"), readEngine<unknown>("/api/glhf/runs")]).then(([board, answers, swarm]) => {
      if (stopped) return
      if (board.status === "rejected" && answers.status === "rejected" && swarm.status === "rejected") { setProblem(problemOf(board.reason)); return }
      setProblem(undefined)
      setRuns(mergeRuns(board.status === "fulfilled" ? boardRuns(board.value) : [], answers.status === "fulfilled" ? answerRuns(answers.value) : [], swarm.status === "fulfilled" ? swarmRuns(swarm.value) : []))
    })
    return () => { stopped = true }
  }, [again])
  return { runs, problem, retry: () => setAgain((n) => n + 1) }
}

/** Runs per day as stacked bars: research solid, practice dashed. The same numbers are in the table under it. */
function DayChart({ days }: { days: Day[] }) {
  const W = 640, H = 220, left = 30, right = 8, top = 10, bottom = 26
  const max = niceTop(Math.max(1, ...days.map((d) => d.total)))
  const slot = (W - left - right) / days.length, bar = Math.min(28, slot * 0.62)
  const y = (n: number) => top + (H - top - bottom) * (1 - n / max)
  const total = days.reduce((n, d) => n + d.total, 0)
  return (
    <svg className="ov-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Runs started on each of the last ${days.length} days: ${total} in all. The table below has the numbers.`}>
      {[0, max / 2, max].map((tick) => (
        <g key={tick}>
          <line className={tick === 0 ? "ov-axis" : "ov-grid"} x1={left} x2={W - right} y1={y(tick)} y2={y(tick)} />
          {Number.isInteger(tick) && <text x={left - 6} y={y(tick) + 4} textAnchor="end">{tick}</text>}
        </g>
      ))}
      {days.map((d, i) => {
        const x = left + slot * i + (slot - bar) / 2
        const parts: [keyof Pick<Day, "research" | "practice" | "unknown">, number][] = [["research", d.research], ["practice", d.practice], ["unknown", d.unknown]]
        let stacked = 0
        return (
          <g key={d.at}>
            {parts.map(([made, n]) => {
              if (!n) return null
              const y1 = y(stacked + n), height = y(stacked) - y1
              stacked += n
              return <rect key={made} className={`ov-bar-${made}`} x={x} y={y1} width={bar} height={height} rx="2" />
            })}
            {(i % 2 === (days.length - 1) % 2) && <text x={x + bar / 2} y={H - 8} textAnchor="middle">{d.label}</text>}
          </g>
        )
      })}
    </svg>
  )
}

export function OverviewView({ onOpen }: { onOpen: (view: View) => void }) {
  const { runs: listed, problem, retry } = useRuns()
  // A team review says how it was made in its first event; the list alone does not.
  const boardIds = useMemo(() => (listed ?? []).filter((r) => r.kind === "board").map((r) => r.id), [listed])
  const scripted = useBoardScripted(boardIds)
  const runs = useMemo<RunRef[] | undefined>(() => listed?.map((r) => (r.kind === "board" && r.provenance === undefined && scripted[r.id] !== undefined ? { ...r, provenance: scripted[r.id] ? "practice" : "live" } : r)), [listed, scripted])
  const totals = useMemo(() => totalsOf(runs ?? []), [runs])
  const days = useMemo(() => perDay(runs ?? [], DAYS), [runs])
  const log = useMemo(() => activityOf(runs ?? []), [runs])

  if (problem) return <div className="page"><EngineOffline needs="the list of runs" said={problem.said} onRetry={retry} /></div>
  return (
    <div className="page ov-page" aria-busy={!runs}>
      <h1 className="sr-only">Overview</h1>
      <Hero onOpen={onOpen} />
      <div className="ov-row-label">So far <small>Practice runs use example text and are counted apart from research.</small></div>

      <section className="ov-tiles" aria-label="Totals">
        <div className="ov-tile" data-lead><b>{runs ? totals.research : "–"}</b><span>Research runs</span><small>Made with real AI models.</small></div>
        <div className="ov-tile"><b>{runs ? totals.practice : "–"}</b><span>Practice runs</span><small>Fixed example text. Not research.</small></div>
        <div className="ov-tile"><b>{runs ? totals.inProgress : "–"}</b><span>In progress</span><small>Running or waiting now.</small></div>
        <div className="ov-tile"><b>{runs ? totals.all : "–"}</b><span>All runs</span><small>{totals.failed ? `${totals.failed} failed.` : "None failed."}{totals.unknown ? ` ${totals.unknown} not read yet.` : ""}</small></div>
      </section>

      <Credits />

      {runs && !runs.length && (
        <section className="ov-card"><h2>Nothing has been run yet</h2><p>Ask the team a question above to make the first one.</p><button type="button" className="ov-link" onClick={() => onOpen("Home")}>Go to Research</button></section>
      )}

      {!!runs?.length && (
        <>
          <div className="ov-two">
            <section className="ov-card" aria-labelledby="ov-days">
              <h2 id="ov-days">Runs per day, last {DAYS} days</h2>
              <DayChart days={days} />
              <div className="ov-legend" aria-hidden="true">
                <span><i className="ov-key" data-made="research" />Research</span>
                <span><i className="ov-key" data-made="practice" />Practice</span>
                {totals.unknown > 0 && <span><i className="ov-key" data-made="unknown" />Not read yet</span>}
              </div>
              <details>
                <summary>Show as a table</summary>
                <table className="ov-table">
                  <thead><tr><th scope="col">Day</th><th scope="col">Research</th><th scope="col">Practice</th><th scope="col">All</th></tr></thead>
                  <tbody>{days.filter((d) => d.total).map((d) => <tr key={d.at}><td>{d.label}</td><td>{d.research}</td><td>{d.practice}</td><td>{d.total}</td></tr>)}</tbody>
                </table>
              </details>
            </section>

            <section className="ov-card" aria-labelledby="ov-kinds">
              <h2 id="ov-kinds">By kind</h2>
              <div className="ov-kinds">
                {KINDS.map((kind) => {
                  const k = totals.byKind[kind]
                  return (
                    <div className="ov-kind" key={kind}>
                      <span>{KIND_LABEL[kind]}</span><b>{k.all}</b>
                      <div className="ov-track" aria-hidden="true">
                        {k.all > 0 && <><i data-made="research" style={{ width: `${(k.research / k.all) * 100}%` }} /><i data-made="practice" style={{ width: `${(k.practice / k.all) * 100}%` }} /></>}
                      </div>
                      <small>{k.research} research, {k.practice} practice</small>
                    </div>
                  )
                })}
              </div>
            </section>
          </div>

          <section className="ov-card" aria-labelledby="ov-recent">
            <h2 id="ov-recent">Activity log</h2>
            {log.map((group) => (
              <div className="ov-day" key={group.day}>
                <div className="ov-day-head"><span className="ov-dot" data-kind="day"><CalendarDays size={13} aria-hidden="true" /></span><span className="ov-day-pill">{group.day}</span></div>
                <ul className="ov-log">
                  {group.entries.map((e) => {
                    const Icon = KIND_ICON[e.kind]
                    return (
                      <li key={e.key} data-failed={e.failed || undefined}>
                        <span className="ov-dot" data-kind={e.kind}>{e.failed ? <X size={13} aria-hidden="true" /> : <Icon size={13} aria-hidden="true" />}</span>
                        <div className="ov-log-line">
                          <AgentAvatar name={e.agent} size={24} />
                          <b>{e.actor}</b>
                          <span className="ov-verb">{e.verb}</span>
                          <span className="ov-object">{e.object}</span>
                          <Provenance kind={e.provenance} compact />
                          <time className="ov-time" dateTime={new Date(e.at).toISOString()} title={plainWhen(e.at)}>{e.time}</time>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
            <button type="button" className="ov-link" onClick={() => onOpen("Runs")}>See everything in Saved research</button>
          </section>
        </>
      )}

      <button type="button" className="ov-link" onClick={() => onOpen("Benchmarks")}>See how we do on the benchmarks</button>
    </div>
  )
}
