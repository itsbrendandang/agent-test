// The Overview: the question box, then the Agent Lab. A question asked here shows only a loading bar while it is
// researched (a click opens its Research chat early); when it ends, its Research chat opens by itself. The answer is
// never written on this page: Research shows it and continues it. The team is idle at its desks until a question is
// sent from this page; then the lab follows that answer's own events (nothing moves without one). One quiet line
// keeps the counts: a practice run is counted apart and is never added to research.
// Spend and limits are in Settings (Usage and limits), not on this page.
import { useEffect, useMemo, useState } from "react"
import { EngineOffline } from "@/components/Shared"
import { answerLab, boardLab, emptyLab, Lab, type LabEvent } from "@/lab"
import { useLabEvents } from "@/lab/useLabModel"
import { Provenance } from "@/components/Provenance"
import { answerRuns, boardRuns, mergeRuns, swarmRuns, type RunRef } from "@/lab/runs"
import { problemOf, readEngine, type Problem } from "@/lib/engine"
import { setAsk, setOpenAnswer } from "@/lib/open"
import { useBoardScripted } from "@/lib/scripted"
import type { View } from "@/nav"
import { startConversation } from "@/home/chat"
import { Hero } from "@/overview/Hero"
import { totalsOf } from "@/overview/model"
import { ResearchAnswer } from "@/research/Answer"
import { ResearchRefused, startResearch, useResearchEvents, useSeenEvents } from "@/research/api"
import "@/design/overview.css"

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

export function OverviewView({ onOpen }: { onOpen: (view: View) => void }) {
  const { runs: listed, problem, retry } = useRuns()
  // A team review says how it was made in its first event; the list alone does not.
  const boardIds = useMemo(() => (listed ?? []).filter((r) => r.kind === "board").map((r) => r.id), [listed])
  const scripted = useBoardScripted(boardIds)
  const runs = useMemo<RunRef[] | undefined>(() => listed?.map((r) => (r.kind === "board" && r.provenance === undefined && scripted[r.id] !== undefined ? { ...r, provenance: scripted[r.id] ? "practice" : "live" } : r)), [listed, scripted])
  const totals = useMemo(() => totalsOf(runs ?? []), [runs])

  // The answer asked from this page. The lab below is drawn from its events, the same ones the answer reads.
  const [asked, setAsked] = useState<{ id: string; question: string; kind?: "answer" | "board"; example?: boolean }>()
  useEffect(() => {
    const open = () => {
      const match = /^#Overview\/example\/(?:(answer|board)\/)?([\w.-]+)$/.exec(window.location.hash)
      if (!match) return
      const kind = match[1] === "board" ? "board" : "answer"
      void readEngine<{ question?: string; title?: string; example?: boolean }>(`/api/${kind === "board" ? "runs" : "research"}/${encodeURIComponent(match[2])}`).then((r) => { if (r.example) setAsked({ id: match[2], question: r.question ?? r.title ?? "Example board review", kind, example: true }) }, () => {})
    }
    open(); window.addEventListener("hashchange", open)
    return () => window.removeEventListener("hashchange", open)
  }, [])
  const [refused, setRefused] = useState<string>()
  // A question asked here is followed by its own events (no answer on the page holds them); an example by its answer card.
  const own = useResearchEvents(asked && !asked.example && asked.kind !== "board" ? asked.id : undefined).events
  const seenEvents = useSeenEvents(asked?.example && asked.kind !== "board" ? asked.id : undefined)
  const events = asked?.example ? seenEvents : own
  const board = useLabEvents(asked?.kind === "board" ? "board" : undefined, asked?.kind === "board" ? asked.id : undefined)
  const lab = useMemo(() => (asked ? asked.kind === "board" ? boardLab(board.events, asked.id) : answerLab(events as unknown as LabEvent[], asked.id) : emptyLab()), [asked, events, board.events])
  const ended = lab.status === "done" || lab.status === "failed" || lab.status === "cancelled"
  // An answer that ended is counted at once: the line of counts is read again.
  useEffect(() => { if (ended) retry() }, [ended, asked?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // A question asked here that ended (ready, failed or stopped): its Research chat opens, where the answer and follow-ups are.
  useEffect(() => { if (ended && asked && !asked.example && asked.kind !== "board") { setOpenAnswer(asked.id, asked.question); onOpen("Home") } }, [ended, asked?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const said = !asked ? "The team is at its desks. Send a question above and the agents it needs start working."
    : lab.status === "done" ? "The team finished your question. The answer is in the Research chat."
    : lab.status === "failed" ? "The answer could not be finished. What the team did is in the activity list."
    : lab.status === "cancelled" ? "The answer was stopped."
    : "The team is working on your question. Nothing here moves unless the engine reports it."
  // The question's chat in Research. A question asked here is already Research's conversation (startConversation), with its thread.
  const openChat = () => { if (asked) setOpenAnswer(asked.id, asked.question); onOpen("Home") }
  const ask = async (question: string, effort: "quick" | "standard"): Promise<boolean> => {
    setRefused(undefined)
    try {
      const started = await startResearch(question, effort)
      setAsked({ id: started.id, question })
      startConversation(question, started) // the same answer is Research's conversation: opening Research shows it, and a follow-up there continues its thread
      return true
    } catch (error) {
      // An engine without direct answers (or with them switched off): Research makes its team-review plan for the question, as before.
      if (error instanceof ResearchRefused && error.status === 404 && !error.field) { setAsk(question, { send: true, effort }); onOpen("Home"); return true }
      setRefused(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  if (problem) return <div className="page"><EngineOffline needs="the list of runs" said={problem.said} onRetry={retry} /></div>
  return (
    <div className="page ov-page" aria-busy={!runs}>
      <h1 className="sr-only">Overview</h1>
      <Hero onOpen={onOpen} onAsk={ask} />
      {refused && <p className="newrun-error" role="alert">{refused}</p>}

      {/* The answer comes first, so it is in view without scrolling past the lab. Once it ends, one line and the link to its chat. */}
      {asked && asked.kind !== "board" && !asked.example && (
        <button type="button" className="ov-card ov-loading" onClick={openChat} aria-label={`Researching: ${asked.question}. Open in Research`}>
          <span className="ov-loading-label">{asked.question}</span>
          <span className="ov-loading-bar" role="progressbar" aria-label="Researching" />
        </button>
      )}
      {asked && asked.kind !== "board" && asked.example && (
        <section className="ov-card ov-answer" aria-labelledby="ov-answer-title">
          <h2 id="ov-answer-title"><button type="button" className="ov-link ov-answer-open" onClick={openChat}>{asked.question}</button></h2>
          {ended
            ? <p className="ov-answer-status" role="status">{lab.status === "done" ? "The answer is ready in the Research chat." : lab.status === "failed" ? "The answer could not be finished." : "The answer was stopped."}</p>
            : <ResearchAnswer key={asked.id} id={asked.id} latest fresh />}
          <button type="button" className="ov-link" onClick={openChat}>Open example in Research</button>
        </section>
      )}

      <div className="ov-lab">
        <div className="ov-row-label">
          <span id="ov-lab-title">Agent Lab</span>
          {asked?.example && <Provenance kind="example" />}
          <small role="status">{said}</small>
        </div>
        <Lab model={lab} />
      </div>

      <p className="ov-counts" aria-label="Totals">
        {runs
          ? <><b>{totals.research}</b> research {totals.research === 1 ? "run" : "runs"}, <b>{totals.practice}</b> practice, <b>{totals.inProgress}</b> in progress{totals.failed ? <>, <b>{totals.failed}</b> failed</> : null}. </>
          : "Counting the runs… "}
        <button type="button" className="ov-link" onClick={() => onOpen("Runs")}>See everything in Saved research</button>
      </p>
    </div>
  )
}
