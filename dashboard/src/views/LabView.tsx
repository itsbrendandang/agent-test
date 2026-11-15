// Agent Lab design by Anh Lam (https://github.com/Anhlam09/agent-lab-report): the six rooms, the twelve teammates,
// the walk to a room and back with a parcel, the side panel and the activity log are Anh's design, rebuilt here for
// the dashboard (src/lab/). This file is the "Lab" destination: it picks a run, reads its events from the engine,
// and shows the team at work. The teammates move only when the engine reported work.
//
// Which run: the one in progress if there is one (the newest, over team reviews, research answers and swarm runs);
// else the newest finished run, played back from its stored events and labelled "Replay of a finished run". A
// picker chooses another. The view only reads: leaving it never stops a run.
import { useEffect, useMemo, useState } from "react"
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
import { useLabEvents, useSwarmRun, type Connection } from "@/lab/useLabModel"
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
function RunLab({ run }: { run: RunRef }) {
  const stream = useLabEvents(run.kind === "swarm" ? undefined : run.kind, run.id)
  const swarm = useSwarmRun(run.kind === "swarm" ? run.id : undefined)
  const [replaying, setReplaying] = useState(() => !run.live) // a run first seen in progress is shown live, and stays so when it ends
  const ordered = useMemo<LabEvent[]>(() => (run.kind === "board" ? boardOrder(stream.events) : run.kind === "answer" ? answerOrder(stream.events) : []), [run.kind, stream.events])
  const notes = useMemo(() => (Array.isArray(swarm.notes?.events) ? (swarm.notes!.events as LabEvent[]) : []), [swarm.notes])

  // Everything the engine has said so far.
  const full = useMemo<LabModel>(() => (run.kind === "swarm" ? swarmLab(swarm.run, swarm.notes, { seenAt: swarm.seenAt }) : run.kind === "board" ? boardLab(ordered, run.id) : answerLab(ordered, run.id)), [run.kind, run.id, ordered, swarm])
  const ended = run.kind === "swarm" ? swarm.connection === "ended" : stream.connection === "ended"
  // A run with no last event (a paused review) is complete for a replay once its stored events stopped arriving.
  const [quiet, setQuiet] = useState(false)
  const size = run.kind === "swarm" ? notes.length : ordered.length
  useEffect(() => { if (!size) return; const t = setTimeout(() => setQuiet(true), 1500); return () => { clearTimeout(t); setQuiet(false) } }, [size])
  const ready = ended || (quiet && !run.live)

  // ── Replay ──
  const timeline = useMemo(() => timelineOf(run.kind === "swarm" ? (swarm.run ? swarmTimes(swarm.run, notes).at : []) : ordered.map((e) => (typeof e.at === "number" ? e.at : undefined))), [run.kind, swarm.run, notes, ordered])
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
    if (run.kind === "swarm") return swarmLab(swarm.run, swarm.notes, { upTo: count })
    return run.kind === "board" ? boardLab(ordered.slice(0, count), run.id) : answerLab(ordered.slice(0, count), run.id)
  }, [on, count, size, full, run.kind, run.id, ordered, swarm.run, swarm.notes])
  const firstAt = shown.startedAt ?? full.startedAt ?? 0
  const clock = on ? (pace === "real" ? firstAt + position : shown.at ?? firstAt) : undefined
  const jump = (to: number) => { setPosition(Math.max(0, Math.min(length, to))); setJumps((n) => n + 1) }
  const choose = (next: Pace, at: 1 | 4) => { setPace(next); setSpeed(at); setPosition(0); setJumps((n) => n + 1); setPlaying(true) }

  const model = replaying && !ready ? { ...emptyLab(), kind: run.kind, runId: run.id, status: "waiting" as const } : shown
  const title = full.title ?? run.title
  const provenance = full.provenance ?? run.provenance
  const connection = run.kind === "swarm" ? swarm.connection : stream.connection
  return (
    <>
      <div className="lab-run">
        <span className="lab-kind">{KIND_WORD[run.kind]}</span>
        <h2 className="lab-run-title">{title}</h2>
        <Provenance kind={provenance} />
        <span className="muted small">Started {plainWhen(run.startedAt || full.startedAt)}</span>
      </div>
      {replaying ? (
        <div className="lab-replay" role="group" aria-label="Replay">
          <span className="lab-replay-label">Replay of a finished run</span>
          {!ready ? <span className="muted" role="status">Reading the run's stored events…</span> : (
            <>
              <button type="button" className="btn" onClick={() => { if (over) jump(0); setPlaying(over ? true : !playing) }}>{over ? "Play again" : playing ? "Pause replay" : "Play replay"}</button>
              <span role="group" aria-label="Replay speed" className="lab-speeds">
                <button type="button" className="btn" aria-pressed={pace === "real" && speed === 1} onClick={() => choose("real", 1)}>1×</button>
                <button type="button" className="btn" aria-pressed={pace === "real" && speed === 4} onClick={() => choose("real", 4)}>4×</button>
                <button type="button" className="btn" aria-pressed={pace === "even"} onClick={() => choose("even", 1)}>Step by step</button>
              </span>
              <input type="range" aria-label="Position in the replay" min={0} max={Math.max(1, Math.round(length))} step={pace === "even" ? EVEN_GAP_MS : Math.max(1, Math.round(length / 200))} value={Math.round(position)} onChange={(e) => jump(Number(e.target.value))} />
              <span className="muted small" role="status">Event {Math.min(count, size)} of {size}</span>
              <span className="muted small lab-replay-how">
                {pace === "even"
                  ? `One event at a time, ${(EVEN_GAP_MS / 1000).toFixed(1)} seconds apart. The run itself took ${plainDuration(timeline.realMs)}.`
                  : `At ${speed === 4 ? "4 times " : ""}its real timing. The run took ${plainDuration(timeline.realMs)}.`}
                {full.roughTimes && " Times are estimates: a swarm's notes record time only when a step ends."}
              </span>
            </>
          )}
        </div>
      ) : (
        <div className="lab-replay" data-live role="group" aria-label="Live run">
          {full.status === "running" || full.status === "waiting"
            ? <><span className="lab-replay-label">Live: this run is in progress</span><span className="muted" role="status">{CONNECTION[connection]} The team moves when the engine reports work; a quiet stretch means a step is still running.</span></>
            : <><span className="lab-replay-label">This run has ended</span><span className="muted">You watched it live.</span><button type="button" className="btn" onClick={() => { setReplaying(true); setPosition(0); setPlaying(true); setJumps((n) => n + 1) }}>Replay it</button></>}
        </div>
      )}
      {model.note && <p className="lab-note" data-tone={model.status === "failed" ? "bad" : undefined}>{model.status === "failed" ? "✕ " : ""}{model.note}</p>}
      <Lab model={model} clock={clock} speed={on && pace === "real" ? speed : 1} settleKey={`${replaying}:${jumps}`} />
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
  // A team review says whether it was a practice run in its first event, not in the list: read it for the newest few.
  const boardIds = useMemo(() => listed.filter((r) => r.kind === "board").slice(0, 8).map((r) => r.id), [listed])
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

  return (
    <div className="page lab-page" data-wide>
      <h1 className="sr-only">Lab</h1>
      <div className="lab-run">
        <p className="muted small lab-about">A teammate moves only when the engine reports a step of a run: a search, a check, a hand-off.</p>
        {known.length > 0 && (
          <label className="lab-picker">
            <span className="muted small">Run </span>
            <select value={chosen ? `${chosen.kind}/${chosen.id}` : ""} onChange={(e) => pick(e.target.value)}>
              <option value="">Automatic: the run in progress, else the newest</option>
              {known.map((r) => (
                <option key={`${r.kind}/${r.id}`} value={`${r.kind}/${r.id}`}>
                  {KIND_WORD[r.kind]}: {r.title.length > 70 ? `${r.title.slice(0, 69)}…` : r.title} · {plainWhen(r.startedAt)}{r.provenance ? ` · ${r.provenance === "practice" ? "Practice" : r.provenance === "live" ? "Live research" : "Local model"}` : ""}{r.status ? ` · ${r.status}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {problem && !runs ? <EngineOffline needs="The lab reads its runs from the engine." said={problem.said} onRetry={retry} />
        : !runs ? <p className="muted" role="status">Looking for runs…</p>
          : target ? <RunLab key={`${target.kind}/${target.id}`} run={target} />
            : <><p className="lab-note">No run yet. Ask a question on Research or start a team review; the lab then shows the team as it works.</p><Lab model={emptyLab()} /></>}
    </div>
  )
}
