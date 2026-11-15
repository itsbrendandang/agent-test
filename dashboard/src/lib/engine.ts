// Reading from the engine. Two different failures must never look the same: the engine cannot be reached (it is
// not running), or it answered with an error (it is running, and something inside it failed). The second carries
// the engine's own words, which are shown as text.
export const ENGINE = (import.meta.env.VITE_ENGINE_URL as string | undefined) ?? "http://localhost:8787"

/** `status` 0: the engine could not be reached. Otherwise the HTTP status it answered with, and its own error text. */
export class EngineError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

/** GET a JSON reply. Rejects with EngineError; an aborted request rejects with the browser's AbortError. */
export async function readEngine<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response
  try { r = await fetch(ENGINE + path, init) }
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
