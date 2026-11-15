// What every view shows in one plain line at the top: does the engine answer, and may it spend money.
// Read from the engine every few seconds. Reads only.
import { useEffect, useState } from "react"
import { problemOf, readEngine } from "@/lib/engine"
import { paidState, type PaidState } from "@/lib/paid"
import { PAID_CHANGED } from "@/lib/paidSwitch"

/** "error": the engine answered, but with an error. `said` is its own text. */
export interface Shell { engine: "online" | "offline" | "error" | "unknown"; paid: PaidState; said?: string; /** The person running the engine locked the Demo / Real switch. */ locked?: boolean }

export function useShell(everyMs = 10_000): Shell {
  const [shell, setShell] = useState<Shell>({ engine: "unknown", paid: "unknown" })
  useEffect(() => {
    let stopped = false
    const tick = async () => {
      const next: Shell = await readEngine<{ paidCalls?: unknown; paidLocked?: unknown }>("/api/glhf/status").then(
        (status) => ({ engine: "online", paid: paidState(status), locked: status.paidLocked === true }),
        (error: unknown) => { const said = problemOf(error).said; return said ? { engine: "error", paid: "unknown", said } : { engine: "offline", paid: "unknown" } })
      if (!stopped) setShell(next)
    }
    void tick()
    const timer = window.setInterval(tick, everyMs)
    window.addEventListener(PAID_CHANGED, tick) // the Demo / Real switch was used: read the state again now
    return () => { stopped = true; window.clearInterval(timer); window.removeEventListener(PAID_CHANGED, tick) }
  }, [everyMs])
  return shell
}
