// What every view shows in one plain line at the top: does the engine answer, and may it spend money.
// Read from the engine every few seconds. Reads only.
import { useEffect, useState } from "react"
import { ENGINE } from "@/board/api"
import { paidState, type PaidState } from "@/lib/paid"

export interface Shell { engine: "online" | "offline" | "unknown"; paid: PaidState }

export function useShell(everyMs = 10_000): Shell {
  const [shell, setShell] = useState<Shell>({ engine: "unknown", paid: "unknown" })
  useEffect(() => {
    let stopped = false
    const tick = async () => {
      const status = await fetch(`${ENGINE}/api/glhf/status`).then((r) => (r.ok ? (r.json() as Promise<{ paidCalls?: unknown }>) : undefined), () => undefined)
      if (!stopped) setShell({ engine: status ? "online" : "offline", paid: paidState(status) })
    }
    void tick()
    const timer = window.setInterval(tick, everyMs)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [everyMs])
  return shell
}
