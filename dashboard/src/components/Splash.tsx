import { useEffect, useState } from "react"
import { reducedMotion, useCharacters } from "@/crew/store"
import { PRODUCT } from "@/nav"
import { Buddy } from "./Buddy"
import { SPECIES } from "./species"

export const SPLASH_MIN_MS = 700 // shown at least this long once it appears, so it does not flash
export const SPLASH_MAX_MS = 2500 // and never longer than this, whatever the engine does
const FADE_MS = 450

/**
 * Loading screen: the crew hops in while the app starts. It stays until `ready` (the engine's status and catalog
 * have answered), but at least SPLASH_MIN_MS and at most SPLASH_MAX_MS. `offline` (the engine cannot be reached)
 * takes it away at once, so the "start the engine" message is not hidden. Click or press any key to skip.
 */
export function Splash({ ready, offline = false }: { ready: boolean; offline?: boolean }) {
  const [phase, setPhase] = useState<"in" | "out" | "done">("in")
  const [minOver, setMinOver] = useState(false)
  const characters = useCharacters()
  const still = reducedMotion()

  useEffect(() => {
    if (phase !== "in") return
    const skip = () => setPhase("out")
    const min = setTimeout(() => setMinOver(true), SPLASH_MIN_MS)
    const max = setTimeout(skip, SPLASH_MAX_MS)
    window.addEventListener("keydown", skip)
    return () => { clearTimeout(min); clearTimeout(max); window.removeEventListener("keydown", skip) }
  }, [phase])
  // What is on screen follows from the state: ready after the minimum means fading out; an engine that is down means gone.
  const now = phase === "in" && offline ? "done" : phase === "in" && ready && minOver ? "out" : phase
  useEffect(() => {
    if (now !== "out") return
    const t = setTimeout(() => setPhase("done"), still ? 0 : FADE_MS)
    return () => clearTimeout(t)
  }, [now, still])

  if (now === "done") return null
  return (
    <div className="splash" data-phase={now} data-still={still || undefined} role="status" aria-label={`Loading ${PRODUCT}`} onClick={() => setPhase("out")}>
      {characters && (
        <div className="splash-crew" aria-hidden="true">
          {SPECIES.map((s, i) => (
            <span key={s} className="splash-hop" style={{ animationDelay: `${i * 120}ms` }}>
              <Buddy species={s} mood="happy" size={92} />
            </span>
          ))}
        </div>
      )}
      <p className="splash-name">{PRODUCT}</p>
      <p className="splash-title">Waking up the crew…</p>
      <div className="splash-bar" aria-hidden="true"><span /></div>
      <p className="muted small">Click or press any key to skip</p>
    </div>
  )
}
