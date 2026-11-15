// The wait before an answer has anything to show: a small row of the agents, bouncing, with one line under it that
// says what is really happening (the engine's current step; never an invented one). The line is the status; the
// agents are decoration and stand still under reduced motion.
import type { ReactNode } from "react"
import { agentIdentity } from "@/lab/identity"
import { Mascot } from "@/lab/Mascot"

/** The six of the home page, in its order. */
const SIX = ["scout", "proposer", "experimenter", "critic", "methods-auditor", "reporter"].map((name) => agentIdentity(name))

export function AgentsWorking({ children }: { children: ReactNode }) {
  return (
    <div className="agents-working" role="status" aria-live="polite">
      <div className="agents-row" aria-hidden="true">
        {SIX.map((who, i) => <span key={who.name} className="agents-one" style={{ animationDelay: `${i * 0.11}s` }}><Mascot shape={who.shape} color={who.colour} /></span>)}
      </div>
      <span className="agents-line">{children}</span>
    </div>
  )
}
