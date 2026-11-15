// Development only: http://127.0.0.1:<dev port>/src/lab/preview/index.html. Not part of the built app. It shows the lab
// from the hand-written fixtures, with no engine, to look at the scene while changing it.
//   ?model=fixture            one teammate in every state (the default)
//   ?play=review|answer|real|cancelled|swarm|claims   feed a fixture stream one event at a time (&pace=700 ms an event)
import { useEffect, useMemo, useState } from "react"
import { answerLab, boardLab, swarmLab } from "../adapter"
import { claimsLab, claimsTimeline } from "../claims"
import { CLAIMS_EVENTS, CLAIMS_NOTES } from "../fixtures/claims"
import { PRACTICE_ANSWER, PRACTICE_REVIEW } from "../fixtures/practice"
import { CANCELLED_ANSWER, REAL_ANSWER, REVIEW_WITH_VISITOR, SWARM_NOTES, SWARM_RUN, fixtureModel } from "../fixtures/streams"
import { AgentAvatar } from "../AgentAvatar"
import { SPECIALISTS, agentIdentity } from "../identity"
import { Lab } from "../Lab"

const query = new URLSearchParams(window.location.search)
const play = query.get("play"), pace = Number(query.get("pace") ?? 700), compact = query.has("compact")
const STREAMS = { review: PRACTICE_REVIEW, visitor: REVIEW_WITH_VISITOR, answer: PRACTICE_ANSWER, real: REAL_ANSWER, cancelled: CANCELLED_ANSWER }

export function Preview() {
  const [n, setN] = useState(0)
  const total = play === "claims" ? claimsTimeline(CLAIMS_EVENTS, CLAIMS_NOTES).length : play === "swarm" ? (SWARM_NOTES.events as unknown[]).length : play && play in STREAMS ? STREAMS[play as keyof typeof STREAMS].length : 0
  useEffect(() => {
    if (!total) return
    const timer = window.setInterval(() => setN((was) => Math.min(total, was + 1)), pace)
    return () => window.clearInterval(timer)
  }, [total])
  const [now] = useState(() => Date.now())
  const model = useMemo(() => {
    if (play === "claims") return claimsLab({ run: { id: "preview-claims", model: "mock", task: "demo", phase: n >= total ? "done" : "running" }, events: CLAIMS_EVENTS, notes: { events: CLAIMS_NOTES } }, { upTo: n })
    if (play === "swarm") return swarmLab(n >= total ? SWARM_RUN : { ...SWARM_RUN, phase: "running" }, SWARM_NOTES, { upTo: n })
    if (play === "review" || play === "visitor") return boardLab(STREAMS[play].slice(0, n), "preview")
    if (play && play in STREAMS) return answerLab(STREAMS[play as keyof typeof STREAMS].slice(0, n), "preview")
    return fixtureModel({}, now)
  }, [n, total, now])
  if (query.has("avatars")) {
    const names = ["lead-scientist", "scout", "proposer", "experimenter", "pilot", "methods-auditor", "critic", "reviser", "finisher", "reporter", "first-pass", "librarian", ...SPECIALISTS, "someone-new"]
    return (
      <div className="page" style={{ height: "100vh" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
          {names.map((n) => <div key={n} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}><AgentAvatar name={n} size={24} /><AgentAvatar name={n} size={32} /><AgentAvatar name={n} size={40} /><span>{agentIdentity(n).label}</span></div>)}
        </div>
      </div>
    )
  }
  return (
    <div className="page" data-wide style={{ height: "100vh" }}>
      <p className="muted small">Preview (development only): {play ? `${play}, event ${n} of ${total}` : "hand-written fixture model"}</p>
      <Lab model={model} clock={play ? model.at : undefined} compact={compact} />
    </div>
  )
}
