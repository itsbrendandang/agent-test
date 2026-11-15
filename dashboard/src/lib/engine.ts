// Reading from the engine. Two different failures must never look the same: the engine cannot be reached (it is
// not running), or it answered with an error (it is running, and something inside it failed). The second carries
// the engine's own words, which are shown as text.
export const ENGINE = (import.meta.env.VITE_ENGINE_URL as string | undefined) ?? "http://localhost:8787"

/** `status` 0: the engine could not be reached. Otherwise the HTTP status it answered with, and its own error text. */
export class EngineError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

// ---- requests in flight. The shell shows a thin "Working" bar from this (components/WorkingBar.tsx): at once when
// something was sent (a request that is not a GET), and for a read only when it has been pending for a while, so the
// views' background polling never makes it flicker. Event streams are not requests of this kind and do not count.
export interface Pending { /** A request that changes or starts something (not a GET). */ write: boolean; /** When it was sent (ms). */ since: number }
const pending = new Map<number, Pending>()
const watchers = new Set<() => void>()
let nextId = 0
let snapshot: readonly Pending[] = []
const changed = () => { snapshot = [...pending.values()]; for (const w of watchers) w() }
/** The requests in flight now. The same array until something changes. */
export const pendingRequests = (): readonly Pending[] => snapshot
export const watchRequests = (fn: () => void) => { watchers.add(fn); return () => { watchers.delete(fn) } }
/**
 * Count a request while it is in flight. Wrap the fetch itself, not time spent waiting for a person:
 * `const r = await tracked(fetch(url, init), init?.method)`. Use it for any request that does not go through
 * readEngine or engineFetch.
 */
export function tracked<T>(request: Promise<T>, method?: string): Promise<T> {
  const id = nextId++
  pending.set(id, { write: (method ?? "GET").toUpperCase() !== "GET", since: Date.now() })
  changed()
  const done = () => { if (pending.delete(id)) changed() }
  request.then(done, done)
  return request
}

/** GET a JSON reply. Rejects with EngineError; an aborted request rejects with the browser's AbortError. */
export async function readEngine<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response
  try { r = await tracked(fetch(ENGINE + path, init), init?.method) }
  catch (error) {
    if ((error as Error)?.name === "AbortError") throw error
    throw new EngineError("The engine cannot be reached.", 0)
  }
  if (r.ok) return r.json() as Promise<T>
  const body = (await r.json().catch(() => undefined)) as { error?: unknown } | undefined
  throw new EngineError(typeof body?.error === "string" && body.error ? body.error.slice(0, 600) : `The engine answered ${r.status} without saying why.`, r.status)
}

/** What went wrong, for the offline card: `said` is the engine's own error text when it did answer. */
export interface Problem { said?: string }
export const problemOf = (error: unknown): Problem => (error instanceof EngineError && error.status !== 0 ? { said: `${error.message} (HTTP ${error.status})` } : {})
