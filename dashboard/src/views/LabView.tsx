import { useEffect, useMemo, useState, type ReactNode } from "react"
import { EngineOffline } from "@/components/Shared"
import { Provenance } from "@/components/Provenance"
import { readEngine, problemOf, type Problem } from "@/lib/engine"
import { plainWhen } from "@/lib/format"
import { provenanceOf, PROVENANCE_WORD } from "@/lib/provenance"
import { boardTitles, useBoardScripted } from "@/lib/scripted"
import { answerLab, answerOrder, boardLab, boardOrder, swarmLab, type LabEvent } from "@/lab/adapter"
import { EventLog } from "@/lab/EventLog"
import { eventRows, swarmLogEvents } from "@/lab/logRows"
import { KIND_WORD, type LabModel, type RunKind } from "@/lab/model"
import { answerRuns, boardRuns, labHash, mergeRuns, pickRun, runOfLabHash, swarmRuns, type RunRef } from "@/lab/runs"
import { claimsLab } from "@/lab/claims"
import { useClaimsRun, useLabEvents, useSwarmRun, type Connection } from "@/lab/useLabModel"
import "@/lab/lab.css"

/** The three run lists, read again every two seconds. A list the engine does not have (an older engine) counts as empty. */
function useLabRuns() {
  const [runs, setRuns] = useState<RunRef[]>()
  const [problem, setProblem] = useState<Problem>()
  const [again, setAgain] = useState(0)
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      const [board, answers, swarm] = await Promise.allSettled([readEngine<unknown>("/api/runs"), readEngine<unknown>("/api/research"), readEngine<unknown>("/api/glhf/runs")])
      if (stopped) return
      const ok = [board, answers, swarm].filter((r) => r.status === "fulfilled").length
      if (!ok) setProblem(problemOf((board as PromiseRejectedResult).reason))
      else {
        const list = mergeRuns(board.status === "fulfilled" ? boardRuns(board.value) : [], answers.status === "fulfilled" ? answerRuns(answers.value) : [], swarm.status === "fulfilled" ? swarmRuns(swarm.value) : [])
        setRuns(list); setProblem(undefined)
        // Often while the page is looked at (a practice run is over in seconds), seldom while it is hidden.
        timer = setTimeout(tick, document.hidden ? 15_000 : 2000)
        return
      }
      timer = setTimeout(tick, 10_000)
    }
    void tick()
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [again])
  return { runs, problem, retry: () => setAgain((n) => n + 1) }
}

function RunLog({ run, picker }: { run: RunRef; picker: ReactNode }) {
  const stream = useLabEvents(run.kind === "swarm" ? undefined : run.kind, run.id)
  const swarm = useSwarmRun(run.kind === "swarm" ? run.id : undefined)
  const claims = useClaimsRun(run.kind === "swarm" ? run.id : undefined, run.kind === "swarm" && swarm.connection !== "ended")
  const ordered = useMemo<LabEvent[]>(() => run.kind === "board" ? boardOrder(stream.events) : run.kind === "answer" ? answerOrder(stream.events) : [], [run.kind, stream.events])
  const full = useMemo<LabModel>(() => {
    if (run.kind === "swarm" && claims.board) return claimsLab({ run: swarm.run, board: claims.board, events: claims.events, notes: claims.notes, seenAt: claims.seenAt })
    return run.kind === "swarm" ? swarmLab(swarm.run, swarm.notes, { seenAt: swarm.seenAt }) : run.kind === "board" ? boardLab(ordered, run.id) : answerLab(ordered, run.id)
  }, [run.kind, run.id, ordered, swarm, claims])
  const notes = claims.board ? claims.notes?.events : swarm.notes?.events
  const rows = useMemo(() => eventRows(run.kind === "swarm" ? swarmLogEvents(claims.events, Array.isArray(notes) ? notes as LabEvent[] : [], claims.seenAt, claims.board && typeof claims.board.run_id === "string" ? claims.board.run_id : undefined) : ordered, run.kind), [run.kind, ordered, notes, claims.events, claims.seenAt, claims.board])
  const connection: Connection = run.kind === "swarm" ? swarm.connection : stream.connection
  const provenance = full.provenance ?? run.provenance
  return (
    <>
      <div className="lab-bar">
        {picker}
        <span className="lab-kind">{KIND_WORD[run.kind]}</span>
        <Provenance kind={provenance} />
        {(run.startedAt || full.startedAt) ? <span className="lab-when">Started {plainWhen(run.startedAt || full.startedAt)}</span> : null}
      </div>
      <header className="event-log-heading">
        <h2>{full.title ?? run.title}</h2>
        <p>{provenance === "practice" ? "Practice run · scripted example, not real research. " : ""}Every recorded event, oldest first. {run.live && connection !== "ended" ? "New events appear as the team works." : "Stored events from this run."}</p>
      </header>
      {full.note && <p className="lab-note" role={full.status === "failed" ? "alert" : undefined}>{full.note}</p>}
      <EventLog rows={rows} run={{ id: run.id, kind: run.kind, provenance }} connection={connection} />
    </>
  )
}

export function LabView() {
  const { runs, problem, retry } = useLabRuns()
  const [chosen, setChosen] = useState<{ kind: RunKind; id: string } | undefined>(() => runOfLabHash(window.location.hash))
  useEffect(() => {
    const sync = () => { const named = runOfLabHash(window.location.hash); if (named) setChosen(named) }
    window.addEventListener("hashchange", sync)
    return () => window.removeEventListener("hashchange", sync)
  }, [])
  const listed = useMemo(() => (runs ?? []).slice(0, 40), [runs])
  // A team review says whether it was a practice run in its first event, not in the list: read it for the newest few
  // and for the one that is shown.
  const boardIds = useMemo(() => [...new Set([...(chosen?.kind === "board" ? [chosen.id] : []), ...listed.filter((r) => r.kind === "board").slice(0, 8).map((r) => r.id)])], [listed, chosen])
  const scripted = useBoardScripted(boardIds)
  const titles = boardTitles(boardIds)
  const known = useMemo(() => listed.map((r) => (r.kind === "board" ? { ...r, title: titles[r.id] ?? r.title, provenance: r.provenance ?? provenanceOf({ scripted: scripted[r.id] }) } : r)), [listed, scripted, titles])

  // The run that is shown. Without a choice: the newest run in progress; else the run that was last shown in
  // progress (so the view does not jump away from a run the moment it ends); else the newest run.
  const live = known.find((r) => r.live)
  const liveKey = live && `${live.kind}/${live.id}`
  const [watched, setWatched] = useState<string>()
  if (liveKey && liveKey !== watched) setWatched(liveKey)
  const auto = live ?? known.find((r) => `${r.kind}/${r.id}` === watched) ?? pickRun(known)
  const target = chosen ? known.find((r) => r.kind === chosen.kind && r.id === chosen.id) ?? (runs ? { ...chosen, title: chosen.id, startedAt: 0, live: false, status: "" } : undefined) : auto
  const pick = (value: string) => {
    const [kind, ...rest] = value.split("/")
    const next = value ? { kind: kind as RunKind, id: rest.join("/") } : undefined
    setChosen(next)
    if (window.location.hash.startsWith("#Lab")) window.history.replaceState(null, "", next ? labHash(next.kind, next.id) : "#Lab")
  }
  const key = target && `${target.kind}/${target.id}`

  const picker = known.length > 0 && (
    <>
      <label className="lab-picker">
        <span className="sr-only">Run shown in the Agent Log</span>
        <select value={key ?? ""} onChange={(e) => pick(e.target.value)} title="Show the full event log for this run.">
          {target && !known.some((r) => `${r.kind}/${r.id}` === key) && <option value={key}>{target.title}</option>}
          {known.map((r) => (
            <option key={`${r.kind}/${r.id}`} value={`${r.kind}/${r.id}`}>
              {r.title.length > 80 ? `${r.title.slice(0, 79)}…` : r.title} · {KIND_WORD[r.kind]} · {plainWhen(r.startedAt)}{r.provenance ? ` · ${PROVENANCE_WORD[r.provenance]}` : ""}{r.status ? ` · ${r.status}` : ""}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn" aria-pressed={!chosen} onClick={() => pick(chosen ? "" : key ?? "")} title="Follow: always show the run in progress, else the newest run. Press again to stay on this run.">Follow newest</button>
    </>
  )

  return (
    <div className="page lab-page" data-wide>
      <h1>Agent Log</h1>
      {problem && !runs ? <EngineOffline needs="The log reads its runs from the engine." said={problem.said} onRetry={retry} />
        : !runs ? <p className="muted" role="status">Looking for runs…</p>
          : target ? <RunLog key={`${target.kind}/${target.id}`} run={target} picker={picker} />
            : <p className="lab-note">No run yet. Ask a question on Research or start a team review to see its full event log.</p>}
    </div>
  )
}
