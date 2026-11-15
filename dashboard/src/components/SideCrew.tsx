import { useEffect, useRef, useState } from "react"
import type { Mood } from "./Buddy"
import { MASCOTS, useCharacters } from "@/crew/store"
import { Buddy } from "./Buddy"

const LINES = [
  "Go touch grass. I'll hold the fort.",
  "Psst. Take a break.",
  "Nothing to report. Enjoy your coffee.",
  "You again? Go outside!",
  "I like it here on the side.",
]
const SLEEP_AFTER_MS = 45_000

// The characters live quietly in the side rail, as decoration: they are not agents and report nothing. Easter eggs:
//  - poke a character: it says something; poke it 5 times and it looks startled
//  - leave the app alone for 45s: they fall asleep
export function SideCrew() {
  const shown = useCharacters()
  const [bubble, setBubble] = useState<{ id: string; text: string } | null>(null)
  const [dizzy, setDizzy] = useState<string | null>(null)
  const [asleep, setAsleep] = useState(false)
  const pokes = useRef<Record<string, number>>({})
  const timers = useRef<number[]>([])
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)) }

  useEffect(() => {
    let sleepTimer = 0
    const wake = () => {
      setAsleep(false)
      clearTimeout(sleepTimer)
      sleepTimer = window.setTimeout(() => setAsleep(true), SLEEP_AFTER_MS)
    }
    wake()
    window.addEventListener("pointermove", wake)
    window.addEventListener("keydown", wake)
    const pending = timers.current
    return () => {
      clearTimeout(sleepTimer)
      pending.forEach(clearTimeout)
      window.removeEventListener("pointermove", wake)
      window.removeEventListener("keydown", wake)
    }
  }, [])

  const poke = (id: string) => {
    const n = (pokes.current[id] = (pokes.current[id] ?? 0) + 1)
    later(() => { pokes.current[id] = Math.max(0, (pokes.current[id] ?? 1) - 1) }, 2500)
    if (n >= 5) {
      pokes.current[id] = 0
      setDizzy(id)
      setBubble({ id, text: "Okay, okay! I'm awake!" })
      later(() => setDizzy(null), 1600)
    } else {
      setBubble({ id, text: LINES[Math.floor(Math.random() * LINES.length)] })
    }
    later(() => setBubble((b) => (b?.id === id ? null : b)), 2600)
  }

  if (!shown) return null // characters turned off in Settings: no box

  return (
    <>
      <div className="side-crew">
        {MASCOTS.map((m) => {
          const mood: Mood = dizzy === m.id ? "alert" : bubble?.id === m.id ? "happy" : asleep ? "sleeping" : "happy"
          return (
            <button key={m.id} type="button" className="side-buddy" data-dizzy={dizzy === m.id || undefined}
              data-poked={bubble?.id === m.id || undefined} aria-label={m.name} title={`${m.name} (decoration: click to poke)`} onClick={() => poke(m.id)}>
              <Buddy species={m.species} mood={mood} size={36} />
              {bubble?.id === m.id && <span className="side-bubble" role="status">{bubble.text}</span>}
            </button>
          )
        })}
      </div>

    </>
  )
}
