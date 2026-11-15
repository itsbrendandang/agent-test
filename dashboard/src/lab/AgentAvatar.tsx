// Agent Lab design by Anh Lam. An agent's small picture: the head of its character, still, for a list or a
// conversation. Which face an agent has is decided in identity.ts and nowhere else. It is decoration by default
// (aria-hidden): put the agent's label next to it as text. No CSS file is needed.
import { memo } from "react"
import { agentIdentity } from "./identity"
import { MascotHead, type FaceShape } from "./Mascot"

/** The square of each shape's drawing that holds the head: x, y, size (in the character's 50 x 56 drawing). */
const BOX: Record<FaceShape, [number, number, number]> = {
  bunny: [0, 0, 48], tree: [0, -2, 51], mushroom: [1, 2, 46], flame: [1, 4, 48], mountain: [1, 3, 48], fuzzy: [0, 1, 50], acorn: [1, -1, 48], owl: [1, 5, 47], generic: [3, 7, 44],
}

export interface AgentAvatarProps {
  /** The engine's name of the agent: "lead-scientist", "scout", "medicinal-chemist", "first-pass", a swarm role. */
  name: string
  /** The mode a member worked in ("pilot", "revise"), when it has modes: the experimenter as Pilot has the Pilot's face. */
  mode?: string
  /** Pixels: 24, 32 or 40. */
  size?: 24 | 32 | 40
  /** Give the picture a name for screen readers (its label). Leave it out when the label is next to it as text. */
  labelled?: boolean
  /** The engine's title, used as the name when `labelled`. */
  title?: string
  className?: string
}

/** `<AgentAvatar name="scout" size={32} />` */
export const AgentAvatar = memo(function AgentAvatar({ name, mode, size = 32, labelled = false, title, className }: AgentAvatarProps) {
  const who = agentIdentity(name, { title, mode })
  const [x, y, box] = BOX[who.shape]
  return (
    <svg className={className} width={size} height={size} viewBox={`${x} ${y} ${box} ${box}`} data-agent={who.name} data-face={`${who.shape}:${who.colour}`}
      role={labelled ? "img" : undefined} aria-label={labelled ? who.label : undefined} aria-hidden={labelled ? undefined : true} focusable="false"
      style={{ flex: "none", display: "block", borderRadius: "50%", background: `${who.colour}2e` }}>
      <MascotHead shape={who.shape} color={who.colour} />
    </svg>
  )
})
