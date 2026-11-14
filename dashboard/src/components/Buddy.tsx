import logoUrl from "@/assets/logo.png"

// Simple flat characters that stand in for agents. Pure SVG, no assets.
export const SPECIES = ["bunny", "flame", "egg", "mountain", "sprout"] as const
export type Species = (typeof SPECIES)[number]
export type Mood = "happy" | "working" | "sleeping" | "alert"

const INK = "#1b1a17"

export function speciesFor(seed: string): Species {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return SPECIES[h % SPECIES.length]
}

const FACE: Record<Species, { x: number; y: number; spread: number }> = {
  bunny: { x: 50, y: 66, spread: 11 },
  flame: { x: 50, y: 66, spread: 10 },
  egg: { x: 50, y: 54, spread: 9 },
  mountain: { x: 50, y: 72, spread: 10 },
  sprout: { x: 50, y: 46, spread: 11 },
}

// Flat, outline-free shapes: one soft colour each, plus one small detail.
function Body({ species }: { species: Species }) {
  switch (species) {
    case "bunny":
      return (
        <>
          <rect x="29" y="6" width="15" height="44" rx="7.5" transform="rotate(-8 36 28)" fill="#f6b6cd" />
          <rect x="56" y="6" width="15" height="44" rx="7.5" transform="rotate(8 64 28)" fill="#f6b6cd" />
          <rect x="16" y="38" width="68" height="56" rx="28" fill="#f6b6cd" />
        </>
      )
    case "flame":
      return (
        <>
          <path d="M50 8 C62 26 82 38 82 62 C82 80 68 94 50 94 C32 94 18 80 18 62 C18 38 38 26 50 8Z" fill="#ff7a59" />
          <path d="M50 52 C56 61 66 67 66 78 C66 87 59 94 50 94 C41 94 34 87 34 78 C34 67 44 61 50 52Z" fill="#ffc46b" opacity="0.55" />
        </>
      )
    case "egg":
      return (
        <>
          <ellipse cx="50" cy="54" rx="42" ry="38" fill="#ffffff" stroke="#e6e0d0" strokeWidth="2" />
          <circle cx="50" cy="54" r="24" fill="#ffcf4a" />
        </>
      )
    case "mountain":
      return (
        <>
          <path d="M43 20 C46 13 54 13 57 20 L88 82 C91 88 87 94 80 94 L20 94 C13 94 9 88 12 82Z" fill="#6b9bf2" />
          <path d="M43 20 C46 13 54 13 57 20 L67 40 C62 46 56 46 50 41 C44 46 38 46 33 40Z" fill="#ffffff" />
        </>
      )
    case "sprout":
      return (
        <>
          <rect x="45" y="72" width="10" height="22" rx="5" fill="#c9a27a" />
          <rect x="12" y="10" width="76" height="68" rx="34" fill="#5cc48d" />
        </>
      )
  }
}

// Two dots and a small mouth. Moods only change these.
function Face({ species, mood }: { species: Species; mood: Mood }) {
  const { x, y, spread } = FACE[species]
  const eyes = [x - spread, x + spread]
  const down = mood === "working" ? 2 : 0
  const line = { fill: "none", stroke: INK, strokeWidth: 2.6, strokeLinecap: "round" as const }
  return (
    <g>
      {eyes.map((ex) =>
        mood === "sleeping" ? (
          <path key={ex} d={`M${ex - 4} ${y - 1} Q${ex} ${y + 3} ${ex + 4} ${y - 1}`} {...line} />
        ) : (
          <circle key={ex} className="buddy-eye" style={{ transformOrigin: `${ex}px ${y}px` }} cx={ex} cy={y + down}
            r={mood === "alert" ? 4.2 : 3.4} fill={INK} />
        ),
      )}
      {[x - spread - 7, x + spread + 7].map((bx) => (
        <circle key={bx} cx={bx} cy={y + 7} r="4" fill="#ff5c8a" opacity="0.28" />
      ))}
      {mood === "happy" && <path d={`M${x - 3.5} ${y + 6} Q${x} ${y + 10} ${x + 3.5} ${y + 6}`} {...line} />}
      {mood === "working" && <path d={`M${x - 3} ${y + 8} h6`} {...line} />}
      {mood === "sleeping" && <path d={`M${x - 2.5} ${y + 7} h5`} {...line} strokeWidth={2.2} />}
      {mood === "alert" && <circle cx={x} cy={y + 9} r="2.6" fill={INK} />}
    </g>
  )
}

interface BuddyProps {
  species?: Species
  seed?: string
  mood?: Mood
  size?: number
  label?: string
  className?: string
}

export function Buddy({ species, seed = "buddy", mood = "happy", size = 64, label, className = "" }: BuddyProps) {
  const kind = species ?? speciesFor(seed)
  return (
    <svg className={`buddy ${className}`} data-mood={mood} data-species={kind} viewBox="-4 -4 108 108" width={size} height={size}
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <g className="buddy-body">
        <Body species={kind} />
        <Face species={kind} mood={mood} />
      </g>
      {mood === "sleeping" && (
        <g className="buddy-zz" fill="#a39d8e" fontFamily="inherit" fontWeight="600">
          <text x="82" y="20" fontSize="13">z</text>
          <text x="91" y="10" fontSize="9">z</text>
        </g>
      )}
      {mood === "alert" && <circle className="buddy-bang" cx="90" cy="12" r="5" fill="#ff7a59" />}
      {mood === "working" && <circle className="buddy-spark" cx="90" cy="12" r="5" fill="#ffcf4a" />}
    </svg>
  )
}

export function Mark({ size = 38 }: { size?: number }) {
  return <img className="mark" src={logoUrl} width={size} height={size} alt="" aria-hidden="true" />
}
