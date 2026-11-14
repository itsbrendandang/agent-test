import { useEffect, useState } from "react"
import { Buddy, SPECIES } from "./Buddy"

const SHOW_MS = 2200
const FADE_MS = 450

// Loading screen: the crew hops in while the app starts. Click or press any key to skip.
export function Splash() {
  const [phase, setPhase] = useState<"in" | "out" | "done">("in")

  useEffect(() => {
    if (phase === "in") {
      const skip = () => setPhase("out")
      const t = setTimeout(skip, SHOW_MS)
      window.addEventListener("keydown", skip)
      return () => { clearTimeout(t); window.removeEventListener("keydown", skip) }
    }
    if (phase === "out") {
      const t = setTimeout(() => setPhase("done"), FADE_MS)
      return () => clearTimeout(t)
    }
  }, [phase])

  if (phase === "done") return null
  return (
    <div className="splash" data-phase={phase} role="status" aria-label="Loading Sim Lab" onClick={() => setPhase("out")}>
      <div className="splash-crew">
        {SPECIES.map((s, i) => (
          <span key={s} className="splash-hop" style={{ animationDelay: `${i * 120}ms` }}>
            <Buddy species={s} mood="happy" size={92} />
          </span>
        ))}
      </div>
      <p className="splash-title">Waking up the crew…</p>
      <div className="splash-bar" aria-hidden="true"><span /></div>
    </div>
  )
}
