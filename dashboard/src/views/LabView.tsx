// Agent Lab design by Anh Lam (https://github.com/Anhlam09/agent-lab-report, and the look of Agent Lab 2.0,
// https://github.com/Anhlam09/agent-lab-2.0): the six rooms and their equipment, the Buddy characters, the walk to
// a room and back with something in hand, the side panel and the activity log are Anh's design, rebuilt here for
// the dashboard (src/lab/). This file is the "Lab" destination: it picks a run, reads its events from the engine,
// and shows the team at work. The teammates move only when the engine reported work.
//
// Which run: the one in progress if there is one (the newest, over team reviews, research answers and swarm runs);
// else the newest finished run, played back from its stored events and labelled "Replay of a finished run". A
// picker chooses another. The view only reads: leaving it never stops a run.
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { EngineOffline } from "@/components/Shared"
import { Provenance } from "@/components/Provenance"
import { readEngine, problemOf, type Problem } from "@/lib/engine"
import { plainDuration, plainWhen } from "@/lib/format"
import { provenanceOf } from "@/lib/provenance"
import { boardTitles, useBoardScripted } from "@/lib/scripted"
import { answerLab, answerOrder, boardLab, boardOrder, swarmLab, swarmTimes, type LabEvent } from "@/lab/adapter"
import { Lab } from "@/lab/Lab"
import { KIND_WORD, emptyLab, type LabModel, type RunKind } from "@/lab/model"
import { EVEN_GAP_MS, countAt, defaultPace, lengthOf, timelineOf, type Pace } from "@/lab/replay"
import { answerRuns, boardRuns, labHash, mergeRuns, pickRun, runOfLabHash, swarmRuns, type RunRef } from "@/lab/runs"
import { claimsLab, claimsOrder, claimsTimeline } from "@/lab/claims"
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

const prefersLessMotion = () => typeof window.matchMedia === "function" && !!window.matchMedia("(prefers-reduced-motion: reduce)")?.matches
const CONNECTION: Record<Connection, string> = { idle: "", connecting: "Connecting to the engine…", live: "Connected to the engine.", ended: "", lost: "The connection to the engine broke. Trying again…", offline: "This browser cannot follow a run as it happens." }

/** One run in the lab: live while it runs, or a replay of its stored events. Remounted for another run (key). */
function RunLab({ run, picker }: { run: RunRef; picker: ReactNode }) {
  const stream = useLabEvents(run.kind === "swarm" ? undefined : run.kind, run.id)
  const swarm = useSwarmRun(run.kind === "swarm" ? run.id : undefined)
  const [replaying, setReplaying] = useState(() => !run.live) // a run first seen in progress is shown live, and stays so when it ends
  const ordered = useMemo<LabEvent[]>(() => (run.kind === "board" ? boardOrder(stream.events) : run.kind === "answer" ? answerOrder(stream.events) : []), [run.kind, stream.events])
  const notes = useMemo(() => (Array.isArray(swarm.notes?.events) ? (swarm.notes!.events as LabEvent[]) : []), [swarm.notes])
  // A swarm run on the claims engine has a board of claims; the lab then reads that board and its events instead.
  const claims = useClaimsRun(run.kind === "swarm" ? run.id : undefined, run.kind === "swarm" && swarm.connection !== "ended")
  const claimsRun = run.kind === "swarm" && !!claims.board
  const claimsSteps = useMemo(() => (claimsRun ? claimsTimeline(claimsOrder(claims.events, typeof (claims.board as { run_id?: unknown }).run_id === "string" ? ((claims.board as { run_id: string }).run_id) : undefined).events, Array.isArray(claims.notes?.events) ? (claims.notes!.events as LabEvent[]) : [], claims.seenAt) : []), [claimsRun, claims])

  // Everything the engine has said so far.
  const full = useMemo<LabModel>(() => {
    if (claimsRun) return claimsLab({ run: swarm.run, board: claims.board || undefined, events: claims.events, notes: claims.notes, seenAt: claims.seenAt })
    return run.kind === "swarm" ? swarmLab(swarm.run, swarm.notes, { seenAt: swarm.seenAt }) : run.kind === "board" ? boardLab(ordered, run.id) : answerLab(ordered, run.id)
  }, [run.kind, run.id, ordered, swarm, claimsRun, claims])
  const ended = run.kind === "swarm" ? swarm.connection === "ended" : stream.connection === "ended"
  // A run with no last event (a paused review) is complete for a replay once its stored events stopped arriving.
  const [quiet, setQuiet] = useState(false)
  const size = claimsRun ? claimsSteps.length : run.kind === "swarm" ? notes.length : ordered.length
  useEffect(() => { if (!size) return; const t = setTimeout(() => setQuiet(true), 1500); return () => { clearTimeout(t); setQuiet(false) } }, [size])
  const ready = (ended && (run.kind !== "swarm" || claims.board !== undefined)) || (quiet && !run.live)

  // ── Replay ──
  const timeline = useMemo(() => timelineOf(claimsRun ? claimsSteps.map((step) => step.at) : run.kind === "swarm" ? (swarm.run ? swarmTimes(swarm.run, notes).at : []) : ordered.map((e) => (typeof e.at === "number" ? e.at : undefined))), [claimsRun, claimsSteps, run.kind, swarm.run, notes, ordered])
  const [paceChoice, setPace] = useState<Pace>()
  const pace = paceChoice ?? defaultPace(timeline)
  const [speed, setSpeed] = useState<1 | 4>(1)
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(() => !prefersLessMotion()) // with reduced motion a replay waits to be started
  const [jumps, setJumps] = useState(0) // goes up when the replay jumps: the scene then snaps instead of walking
  const length = lengthOf(timeline, pace)
  const on = replaying && ready
  useEffect(() => {
    if (!on || !playing) return
    let last = Date.now()
    const timer = window.setInterval(() => {
      const now = Date.now(), dt = Math.max(0, Math.min(500, now - last)) // a sleeping tab does not jump ahead
      last = now
      if (document.hidden) return
      setPosition((was) => Math.min(length, was + dt * speed))
    }, 100)
    return () => window.clearInterval(timer)
  }, [on, playing, speed, length])
  const over = position >= length
  const count = on ? countAt(timeline, pace, position) : size
  const shown = useMemo<LabModel>(() => {
    if (!on || count >= size) return full
    if (claimsRun) return claimsLab({ run: swarm.run, events: claims.events, notes: claims.notes }, { upTo: count })
    if (run.kind === "swarm") return swarmLab(swarm.run, swarm.notes, { upTo: count })
    return run.kind === "board" ? boardLab(ordered.slice(0, count), run.id) : answerLab(ordered.slice(0, count), run.id)
  }, [on, count, size, full, run.kind, run.id, ordered, swarm.run, swarm.notes, claimsRun, claims])
  const firstAt = shown.startedAt ?? full.startedAt ?? 0
  const clock = on ? (pace === "real" ? firstAt + position : shown.at ?? firstAt) : undefined
  const jump = (to: number) => { setPosition(Math.max(0, Math.min(length, to))); setJumps((n) => n + 1) }
  const choose = (next: Pace, at: 1 | 4) => { setPace(next); setSpeed(at); setPosition(0); setJumps((n) => n + 1); setPlaying(true) }

  const model = replaying && !ready ? { ...emptyLab(), kind: run.kind, runId: run.id, status: "waiting" as const } : shown
  const connection = run.kind === "swarm" ? swarm.connection : stream.connection
  const how = pace === "even"
    ? `One event at a time, ${(EVEN_GAP_MS / 1000).toFixed(1)} seconds apart. The run itself took ${plainDuration(timeline.realMs)}.`
    : `At ${speed === 4 ? "4 times " : ""}its real timing. The run took ${plainDuration(timeline.realMs)}.`
  // The bar under the scene, like a video player's.
  const player = replaying ? (
    <div className="lab-player" role="group" aria-label="Replay">
      <span className="lab-player-label">Replay of a finished run</span>
      {!ready ? <span role="status">Reading the run's stored events…</span> : (
        <>
          <button type="button" className="btn lab-play" aria-label={over ? "Play again" : playing ? "Pause replay" : "Play replay"} title={over ? "Play again" : playing ? "Pause replay" : "Play replay"} onClick={() => { if (over) jump(0); setPlaying(over ? true : !playing) }}><span aria-hidden="true">{over ? "↺" : playing ? "❚❚" : "▶"}</span></button>
          <span role="group" aria-label="Replay speed" className="lab-speeds" title={how}>
            <button type="button" className="btn" aria-pressed={pace === "real" && speed === 1} onClick={() => choose("real", 1)}>1×</button>
            <button type="button" className="btn" aria-pressed={pace === "real" && speed === 4} onClick={() => choose("real", 4)}>4×</button>
            <button type="button" className="btn" aria-pressed={pace === "even"} aria-label="Step by step" title="Step by step: one event at a time" onClick={() => choose("even", 1)}>Step</button>
          </span>
          <input type="range" aria-label="Position in the replay" min={0} max={Math.max(1, Math.round(length))} step={pace === "even" ? EVEN_GAP_MS : Math.max(1, Math.round(length / 200))} value={Math.round(position)} onChange={(e) => jump(Number(e.target.value))} />
          <span className="lab-player-count" role="status">Event {Math.min(count, size)} of {size}</span>
        </>
      )}
    </div>
  ) : (
    <div className="lab-player" role="group" aria-label="Live run">
      {full.status === "running" || full.status === "waiting"
        ? <><span className="lab-player-label"><span className="lab-live-dot" aria-hidden="true">● </span>Live: this run is in progress</span><span role="status">{CONNECTION[connection]} A quiet stretch means a step is still running.</span></>
        : <><span className="lab-player-label">This run has ended</span><span>You watched it live.</span><button type="button" className="btn" onClick={() => { setReplaying(true); setPosition(0); setPlaying(true); setJumps((n) => n + 1) }}>Replay it</button></>}
    </div>
  )
  return (
    <>
      {/* One compact toolbar: which run, what kind, how it was made (from the run's own record), when. */}
      <div className="lab-bar">
        {picker}
        <span className="lab-kind">{KIND_WORD[run.kind]}</span>
        <Provenance kind={full.provenance ?? run.provenance} />
        {(run.startedAt || full.startedAt) ? <span className="lab-when">Started {plainWhen(run.startedAt || full.startedAt)}</span> : null}
      </div>
      <h2 className="sr-only">{full.title ?? run.title}</h2>
      {full.labels && full.labels.length > 0 && <ul className="lab-labels" aria-label="About this run">{full.labels.map((l) => <li key={l} data-strong={l.startsWith("Practice") || undefined}>{l}</li>)}</ul>}
      {(model.note || (replaying && ready)) && (
        <p className="lab-note" data-tone={model.status === "failed" ? "bad" : undefined}>
          {model.note && <>{model.status === "failed" ? "✕ " : ""}{model.note} </>}
          {replaying && ready && <span>{how}{full.roughTimes && " Times are estimates: a swarm's notes record time only when a step ends."}</span>}
        </p>
      )}
      <Lab model={model} clock={clock} speed={on && pace === "real" ? speed : 1} settleKey={`${replaying}:${jumps}`} footer={player} />
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
  const known = useMemo(() => listed.map((r) => (r.kind === "board" ? { ...r, title: titles[r.id] ?? r.title, provenance: provenanceOf({ scripted: scripted[r.id] }) } : r)), [listed, scripted, titles])

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
        <span className="sr-only">Run shown in the lab</span>
        <select value={key ?? ""} onChange={(e) => pick(e.target.value)} title="A teammate moves only when the engine reports a step of this run.">
          {target && !known.some((r) => `${r.kind}/${r.id}` === key) && <option value={key}>{target.title}</option>}
          {known.map((r) => (
            <option key={`${r.kind}/${r.id}`} value={`${r.kind}/${r.id}`}>
              {r.title.length > 80 ? `${r.title.slice(0, 79)}…` : r.title} · {KIND_WORD[r.kind]} · {plainWhen(r.startedAt)}{r.provenance ? ` · ${r.provenance === "practice" ? "Practice" : r.provenance === "live" ? "Live research" : "Local model"}` : ""}{r.status ? ` · ${r.status}` : ""}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn" aria-pressed={!chosen} onClick={() => pick(chosen ? "" : key ?? "")} title="Follow: always show the run in progress, else the newest run. Press again to stay on this run.">Follow newest</button>
    </>
  )

  return (
    <div className="page lab-page" data-wide>
      <h1 className="sr-only">Lab</h1>
      {problem && !runs ? <EngineOffline needs="The lab reads its runs from the engine." said={problem.said} onRetry={retry} />
        : !runs ? <p className="muted" role="status">Looking for runs…</p>
          : target ? <RunLab key={`${target.kind}/${target.id}`} run={target} picker={picker} />
            : <><p className="lab-note">No run yet. Ask a question on Research or start a team review; the lab then shows the team as it works.</p><Lab model={emptyLab()} /></>}
    </div>
  )
}
