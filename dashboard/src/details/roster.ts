// The engine's standing roster for the detail panels: each board agent's purpose, model tier and id, and tools.
import { useEffect, useState } from "react"
import { get, type RosterMember } from "@/board/api"

/** The engine's standing roster (purpose, model tier and id, tools), read once per page and shared by every panel. */
let rosterOnce: Promise<RosterMember[]> | undefined
export function useEngineRoster(enabled = true): RosterMember[] | undefined {
  const [roster, setRoster] = useState<RosterMember[]>()
  useEffect(() => {
    if (!enabled) return
    let stale = false
    rosterOnce ??= get<RosterMember[]>("/api/roster").then((r) => (Array.isArray(r) ? r : []), () => { rosterOnce = undefined; return [] })
    void rosterOnce.then((r) => { if (!stale) setRoster(r) })
    return () => { stale = true }
  }, [enabled])
  return roster
}
/** For tests: forget the roster read so far. */
export const forgetRoster = () => { rosterOnce = undefined }
