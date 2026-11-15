// When the shell's "Working" bar is shown (components/WorkingBar.tsx): at once while a request that sends something
// is in flight, for a read only when it has been pending for a while, and for a minimum time once shown.
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { pendingRequests, watchRequests } from "@/lib/engine"

/** A read (GET) shows the bar only after it has been pending this long. */
export const SHOW_READ_AFTER_MS = 400
/** Once shown, the bar stays at least this long. */
export const MIN_SHOWN_MS = 600

/** True while the app is waiting on the engine for something worth showing (the rule above). */
export function useWorking(): boolean {
  const pending = useSyncExternalStore(watchRequests, pendingRequests, pendingRequests)
  const [shown, setShown] = useState(false)
  const shownAt = useRef(0)
  useEffect(() => {
    const show = () => { if (!shownAt.current) shownAt.current = Date.now(); setShown(true) }
    if (pending.some((p) => p.write)) { const now = window.setTimeout(show, 0); return () => window.clearTimeout(now) }
    if (pending.length > 0) {
      // only reads are in flight: wait until the oldest has been pending long enough
      const oldest = Math.min(...pending.map((p) => p.since))
      const timer = window.setTimeout(show, Math.max(0, oldest + SHOW_READ_AFTER_MS - Date.now()))
      return () => window.clearTimeout(timer)
    }
    // nothing in flight: take it away, but not before it has been up for its minimum time
    const timer = window.setTimeout(() => { shownAt.current = 0; setShown(false) }, shownAt.current ? Math.max(0, shownAt.current + MIN_SHOWN_MS - Date.now()) : 0)
    return () => window.clearTimeout(timer)
  }, [pending])
  return shown
}
