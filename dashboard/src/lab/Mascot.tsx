// Agent Lab design by Anh Lam. The Buddy characters, as Agent Lab 2.0 draws them in the lab: the same shapes and
// faces as the app's Buddy (components/Buddy.tsx: bunny, flame, egg, mountain, sprout, in its 100 x 100 box), with
// the colour as a parameter so that two teammates of one species can be told apart. Pure SVG, still, decoration
// only: a teammate's name and state are always in text beside it.
import type { ReactNode } from "react"
import type { FaceShape } from "./identity"
import { FACE, INK } from "../design/mascot"

/** How a Buddy looks at the moment: 2.0's four moods. */
export type Mood = "happy" | "working" | "sleeping" | "alert"


// Flat, outline-free shapes: one soft colour each, plus one small detail.
function body(shape: FaceShape, color: string): ReactNode {
  switch (shape) {
    case "bunny": return <><rect x="29" y="6" width="15" height="44" rx="7.5" transform="rotate(-8 36 28)" fill={color} /><rect x="56" y="6" width="15" height="44" rx="7.5" transform="rotate(8 64 28)" fill={color} /><rect x="16" y="38" width="68" height="56" rx="28" fill={color} /></>
    case "flame": return <><path d="M50 8 C62 26 82 38 82 62 C82 80 68 94 50 94 C32 94 18 80 18 62 C18 38 38 26 50 8Z" fill={color} /><path d="M50 52 C56 61 66 67 66 78 C66 87 59 94 50 94 C41 94 34 87 34 78 C34 67 44 61 50 52Z" fill="#ffd98a" opacity="0.6" /></>
    case "egg": return <><ellipse cx="50" cy="54" rx="42" ry="38" fill="#ffffff" stroke="#e6e0d0" strokeWidth="2" /><circle cx="50" cy="54" r="24" fill={color} /></>
    case "mountain": return <><path d="M43 20 C46 13 54 13 57 20 L88 82 C91 88 87 94 80 94 L20 94 C13 94 9 88 12 82Z" fill={color} /><path d="M43 20 C46 13 54 13 57 20 L67 40 C62 46 56 46 50 41 C44 46 38 46 33 40Z" fill="#ffffff" /></>
    case "sprout": return <><rect x="45" y="72" width="10" height="22" rx="5" fill="#c9a27a" /><rect x="12" y="10" width="76" height="68" rx="34" fill={color} /></>
    case "generic": return <rect x="18" y="26" width="64" height="68" rx="30" fill={color} />
  }
}

// Two dots and a small mouth. Moods only change these.
function face(shape: FaceShape, mood: Mood): ReactNode {
  const { x, y, spread } = FACE[shape]
  const down = mood === "working" ? 2 : 0
  const line = { fill: "none", stroke: INK, strokeWidth: 2.6, strokeLinecap: "round" as const }
  return (
    <g>
      {[x - spread, x + spread].map((ex) => (mood === "sleeping"
        ? <path key={ex} d={`M${ex - 4} ${y - 1} Q${ex} ${y + 3} ${ex + 4} ${y - 1}`} {...line} />
        : <circle key={ex} cx={ex} cy={y + down} r={mood === "alert" ? 4.2 : 3.4} fill={INK} />))}
      {[x - spread - 7, x + spread + 7].map((bx) => <circle key={bx} cx={bx} cy={y + 7} r="4" fill="#ff5c8a" opacity="0.28" />)}
      {mood === "happy" && <path d={`M${x - 3.5} ${y + 6} Q${x} ${y + 10} ${x + 3.5} ${y + 6}`} {...line} />}
      {mood === "working" && <path d={`M${x - 3} ${y + 8} h6`} {...line} />}
      {mood === "sleeping" && <path d={`M${x - 2.5} ${y + 7} h5`} {...line} strokeWidth={2.2} />}
      {mood === "alert" && <circle cx={x} cy={y + 9} r="2.6" fill={INK} />}
    </g>
  )
}

/** A Buddy's body and face in its 100 x 100 box: what the scene, the side panel and the small avatar all draw. */
export function MascotHead({ shape, color, mood = "happy" }: { shape: FaceShape; color: string; mood?: Mood }) {
  return <>{body(shape, color)}{face(shape, mood)}</>
}

/** One character, with the small sign of its mood beside its head (2.0's zz, spark and alert dot). */
export function Mascot({ shape, color, mood = "happy" }: { shape: FaceShape; color: string; mood?: Mood }) {
  return (
    <svg viewBox="-4 -4 108 108" aria-hidden="true" focusable="false" data-mood={mood}>
      <MascotHead shape={shape} color={color} mood={mood} />
      {mood === "sleeping" && <g fill="#a39d8e" fontWeight="600"><text x="82" y="20" fontSize="13">z</text><text x="91" y="10" fontSize="9">z</text></g>}
      {mood === "alert" && <circle className="lab-mood-dot" cx="90" cy="12" r="5" fill="#ff7a59" />}
      {mood === "working" && <circle className="lab-mood-dot" cx="90" cy="12" r="5" fill="#ffcf4a" />}
    </svg>
  )
}
