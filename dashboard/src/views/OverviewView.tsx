// The Overview: the app's home page. Top to bottom: a one-line question box (it starts the answer and opens it in
// Research, where its thread continues), the research still being done (every running answer, team review and
// benchmark run, each following its own events), the numbers (counts, spend against the engine's limits, time and
// cost per answer, sources and checks: recorded figures only), the newest research that ended, and a compact Agent
// Lab that shows one running run. A practice run is counted apart and is never added to research; an example run is
// never counted.
import { useCallback, useEffect, useMemo, useState } from "react"
import { EngineOffline } from "@/components/Shared"
import { Provenance } from "@/components/Provenance"
import { Skeleton } from "@/components/ui/skeleton"
import { emptyLab, Lab, type LabModel } from "@/lab"
import { problemOf, readEngine, type Problem } from "@/lib/engine"
import { setOpen, setOpenAnswer } from "@/lib/open"
import { boardTitles, useBoardScripted } from "@/lib/scripted"
import type { View } from "@/nav"
import { Metrics } from "@/overview/Metrics"
import { QuickAsk } from "@/overview/QuickAsk"
import { Recent } from "@/overview/Recent"
import { Follow, Running } from "@/overview/Running"
import { FOLLOWED } from "@/overview/seen"
import { firstScope, paidOf, recent, running, workOf, type Paid, type Scope, type Work } from "@/overview/work"
import "@/design/overview.css"

/** How often the lists are read again: often while something runs (its spend and step change), rarely otherwise. */
export const POLL_LIVE_MS = 5_000
export const POLL_IDLE_MS = 10_000

/** The three run lists and the engine's spend, read again on a timer. A list the engine does not have counts as empty. */
function useWork() {
  const [works, setWorks] = useState<Work[]>()
  const [paid, setPaid] = useState<Paid | null>()
  const [problem, setProblem] = useState<Problem>()
  const [again, setAgain] = useState(0)
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = () => {
      void Promise.allSettled([readEngine<unknown>("/api/runs"), readEngine<unknown>("/api/research?all=1"), readEngine<unknown>("/api/glhf/runs"), readEngine<unknown>("/api/paid")]).then(([board, answers, swarm, spend]) => {
        if (stopped) return
        if (board.status === "rejected" && answers.status === "rejected" && swarm.status === "rejected") { setProblem(problemOf(board.reason)); return }
        setProblem(undefined)
        const next = workOf(board.status === "fulfilled" ? board.value : undefined, answers.status === "fulfilled" ? answers.value : undefined, swarm.status === "fulfilled" ? swarm.value : undefined)
        setWorks(next)
        setPaid(spend.status === "fulfilled" ? paidOf(spend.value) : null)
        timer = setTimeout(read, next.some((w) => w.live) ? POLL_LIVE_MS : POLL_IDLE_MS)
      })
    }
    read()
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [again])
  return { works, paid, problem, retry: useCallback(() => setAgain((n) => n + 1), []) }
}

/** "#Overview/example/<kind>/<id>": an example run from the library, shown in the lab. */
function useExample(): { kind: "answer" | "board"; id: string; title: string } | undefined {
  const [example, setExample] = useState<{ kind: "answer" | "board"; id: string; title: string }>()
  useEffect(() => {
    const open = () => {
      const match = /^#Overview\/example\/(?:(answer|board)\/)?([\w.-]+)$/.exec(window.location.hash)
      if (!match) return
      const kind = match[1] === "board" ? "board" : "answer"
      void readEngine<{ question?: string; title?: string; example?: boolean }>(`/api/${kind === "board" ? "runs" : "research"}/${encodeURIComponent(match[2])}`).then((r) => { if (r.example) setExample({ kind, id: match[2], title: r.question ?? r.title ?? "Example board review" }) }, () => {})
    }
    open(); window.addEventListener("hashchange", open)
    return () => window.removeEventListener("hashchange", open)
  }, [])
  return example
}

export function OverviewView({ onOpen }: { onOpen: (view: View) => void }) {
  const { works: listed, paid, problem, retry } = useWork()
  // An older engine does not say in the list whether a team review used scripted models: its first event does.
  const unknownBoards = useMemo(() => (listed ?? []).filter((w) => w.kind === "board" && w.provenance === undefined).map((w) => w.id), [listed])
  const boardIds = useMemo(() => (listed ?? []).filter((w) => w.kind === "board").map((w) => w.id), [listed])
  const scripted = useBoardScripted(unknownBoards)
  const titles = boardTitles(boardIds)
  const works = useMemo<Work[] | undefined>(() => listed?.map((w) => {
    if (w.kind !== "board") return w
    const provenance = w.provenance ?? (scripted[w.id] === undefined ? undefined : scripted[w.id] ? "practice" as const : "live" as const)
    return { ...w, provenance, title: titles[w.id] ?? w.title }
  }), [listed, scripted, titles]) // eslint-disable-line react-hooks/exhaustive-deps
  const going = useMemo(() => running(works ?? []), [works])
  const ended = useMemo(() => recent(works ?? []), [works])

  // A clock for the time each running run has taken. It ticks only while something runs.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!going.length) return
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [going.length])

  // The live model of each followed run, from its own events: the rows and the lab read the same one.
  const [models, setModels] = useState<Record<string, LabModel>>({})
  const onModel = useCallback((key: string, model: LabModel) => setModels((old) => (old[key] === model ? old : { ...old, [key]: model })), [])
  const followed = going.slice(0, FOLLOWED)
  // A followed run that ended: the lists are read again at once, so the counts and the row move without waiting.
  const endedKeys = followed.filter((w) => { const s = models[`${w.kind}/${w.id}`]?.status; return s === "done" || s === "failed" || s === "cancelled" }).map((w) => `${w.kind}/${w.id}`).join(",")
  useEffect(() => { if (endedKeys) retry() }, [endedKeys, retry])

  const example = useExample()
  const [picked, setPicked] = useState<string>()
  const watched = picked && going.some((w) => `${w.kind}/${w.id}` === picked) ? picked : example ? `${example.kind}/${example.id}` : going[0] ? `${going[0].kind}/${going[0].id}` : undefined
  const watchedWork = going.find((w) => `${w.kind}/${w.id}` === watched)
  const exampleWork: Work | undefined = example && !watchedWork ? { kind: example.kind, id: example.id, title: example.title, startedAt: 0, live: false, status: "finished", provenance: "example", agents: [] } : undefined
  const labWork = watchedWork ?? exampleWork
  const labModel = (labWork && models[`${labWork.kind}/${labWork.id}`]) || emptyLab()
  // The watched run is followed even when it is past the first few rows (or is the example).
  const extraFollow = labWork && !followed.includes(labWork) ? labWork : undefined

  // Research when there is any, else practice, until a person picks one.
  const [chosen, setScope] = useState<Scope>()
  const scope = chosen ?? (works ? firstScope(works) : undefined)

  const openRun = (work: Work) => {
    if (work.kind === "answer") { setOpenAnswer(work.id, work.title); onOpen("Home") }
    else if (work.kind === "board") { setOpen("board", work.id); onOpen("Board") }
    else { setOpen("swarm", work.id); onOpen("Compare") }
  }

  if (problem) return <div className="page"><EngineOffline needs="the list of runs" said={problem.said} onRetry={retry} /></div>
  return (
    <div className="page ov-page ov-home" aria-busy={!works}>
      <h1 className="sr-only">Overview</h1>
      {followed.map((w) => <Follow key={`${w.kind}/${w.id}`} work={w} onModel={onModel} />)}
      {extraFollow && <Follow key={`${extraFollow.kind}/${extraFollow.id}`} work={extraFollow} onModel={onModel} />}

      <QuickAsk onOpen={onOpen} />

      <section className="ov-section" aria-labelledby="ov-running-title">
        <header className="ov-section-head">
          <h2 id="ov-running-title">In progress</h2>
          <small role="status">{!works ? "Reading the runs…" : going.length ? `${going.length} running now` : "Nothing running"}</small>
        </header>
        {works ? <Running works={going} models={models} now={now} watched={watched} onWatch={setPicked} onOpenRun={openRun} /> : <Skeleton className="ov-skeleton" />}
      </section>

      <section className="ov-section" aria-labelledby="ov-metrics-title">
        <header className="ov-section-head">
          <h2 id="ov-metrics-title">Metrics</h2>
          <small>From the engine's own records. Example runs are not counted.</small>
        </header>
        {works && scope ? <Metrics works={works} paid={paid} scope={scope} onScope={setScope} /> : <Skeleton className="ov-skeleton" />}
      </section>

      <section className="ov-section" aria-labelledby="ov-recent-title">
        <header className="ov-section-head">
          <h2 id="ov-recent-title">Recent research</h2>
          <button type="button" className="ov-link" onClick={() => onOpen("Runs")}>See everything in Saved research</button>
        </header>
        {works ? <Recent works={ended} onOpenRun={openRun} /> : <Skeleton className="ov-skeleton" />}
      </section>

      {/* Not a second "Agent Lab" region: the scene inside is that region. */}
      <div className="ov-section ov-lab">
        <header className="ov-section-head">
          <h2 id="ov-lab-title">Agent Lab</h2>
          {labWork?.provenance === "example" && <Provenance kind="example" />}
          <small role="status">{labWork ? `${labWork.provenance === "example" ? "Example" : "Showing"}: ${labWork.title}` : "Nothing is running. The team is at its desks."}</small>
        </header>
        <Lab model={labModel} compact panel={false} />
      </div>
    </div>
  )
}
