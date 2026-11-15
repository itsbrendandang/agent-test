// The picture beside an agent's message in a team conversation. A PLACEHOLDER with the props of the shared
// `AgentAvatar` that lab-view is building (one name-to-{label, character, colour} mapping for the whole app): when
// that exists this file re-exports it. The picture is decoration: the label is the text next to it. The box has a
// fixed size, so nothing moves when it is drawn. An agent that is not known gets the neutral face.
import { agentKey, FACES, NEUTRAL } from "./faces"

export function AgentFace({ agent, size = 32 }: { agent: string; size?: 24 | 32 | 40 }) {
  const key = agentKey(agent)
  const face = FACES[key] ?? NEUTRAL
  return (
    <span className="agent-face" data-face={FACES[key] ? key : "neutral"} aria-hidden="true" style={{ width: size, height: size, background: face.colour }}>
      <span style={{ fontSize: Math.round(size * 0.42) }}>{face.letter}</span>
    </span>
  )
}
