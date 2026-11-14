import { Buddy, type Mood } from "@/components/Buddy"
import type { CrewMember } from "./store"

// One look for built-in and uploaded characters, so both share the same movement animations.
export function CrewSprite({ member, mood = "happy", size = 72 }: { member: CrewMember; mood?: Mood; size?: number }) {
  if (member.image) {
    return (
      <span className="buddy buddy-custom" data-mood={mood} style={{ width: size, height: size }}>
        <img className="buddy-body" src={member.image} alt="" draggable={false} />
      </span>
    )
  }
  return <Buddy species={member.species} mood={mood} size={size} />
}
