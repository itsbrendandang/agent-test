// The picture beside an agent's message in a team conversation: the app's one shared avatar (src/lab/AgentAvatar),
// so a face in a message is the same character as in the Lab and everywhere else. The picture is decoration: the
// label is the text next to it. The box has a fixed size, so nothing moves when it is drawn. An agent that is not
// known gets the neutral face and keeps its own name.
import { AgentAvatar } from "@/lab/AgentAvatar"
import { agentIdentity } from "@/lab/identity"
import { agentKey } from "./faces"

/** `agent`: the engine's own name when the caller has it, else the label shown (a swarm role's "Critic, round 2"). */
export function AgentFace({ agent, mode, size = 32 }: { agent: string; mode?: string; size?: 24 | 32 | 40 }) {
  const name = agentKey(agent)
  const who = agentIdentity(name, { mode })
  return (
    <span className="agent-face" data-face={who.kind === "unknown" ? "neutral" : name} data-agent-kind={who.kind} style={{ width: size, height: size }}>
      <AgentAvatar name={name} mode={mode} size={size} />
    </span>
  )
}
