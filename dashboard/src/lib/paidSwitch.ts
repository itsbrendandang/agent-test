// The Demo / Real switch: the engine's in-app switch for paid calls (GET and POST /api/paid). The page never
// remembers the state: it is read from the engine each time, because an engine restart puts it back to what its
// .env file says. Turning Real on needs the session token and the exact sentence below, typed by the person.
import { ENGINE, EngineError, readEngine } from "@/lib/engine"
import { engineFetch } from "@/lib/token"

/** The sentence the engine requires, word for word, before it turns paid calls on. Never sent without the person typing it. */
export const CONFIRM_TEXT = "I will be charged"

export interface PaidFacts {
  paid: boolean; source: "env" | "switch"; locked: boolean; board: "scripted" | "local" | "real"
  missingKeys: string[]; missing: { tier: string; model: string; key: string }[]
  caps: { maxUsd: number; dailyUsd: number; spentTodayUsd: number; exaUsedUsd: number; exaCeilingUsd: number }
  /** Only in the reply to turning it off: paid runs the engine asked to stop. */
  stoppedRuns?: string[]
}
const usable = (v: unknown): v is PaidFacts => {
  const f = v as Partial<PaidFacts> | null
  return !!f && typeof f.paid === "boolean" && typeof f.locked === "boolean" && Array.isArray(f.missingKeys) && !!f.caps && typeof f.caps.maxUsd === "number"
}

/** Why a change was refused: the engine's words, and what it was about. */
export class SwitchRefused extends Error {
  status: number; field?: string; missingKeys?: string[]
  constructor(message: string, status: number, field?: string, missingKeys?: string[]) { super(message); this.status = status; this.field = field; this.missingKeys = missingKeys }
}

export async function readPaid(): Promise<PaidFacts> {
  const facts = await readEngine<unknown>("/api/paid")
  if (!usable(facts)) throw new EngineError("The engine's reply about paid calls could not be read.", 200)
  return facts
}

/** Ask the engine to switch. `typed` is what the person typed; it is sent only when turning on. */
export async function setPaid(on: boolean, typed?: string): Promise<PaidFacts> {
  let r: Response
  try {
    r = await engineFetch(`${ENGINE}/api/paid`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(on ? { on: true, confirm: typed } : { on: false }) })
  } catch { throw new SwitchRefused("The app's engine isn't running. Start it with: npm start. Nothing was changed.", 0) }
  const body = (await r.json().catch(() => undefined)) as (Partial<PaidFacts> & { error?: unknown; field?: unknown }) | undefined
  if (r.ok && usable(body)) { window.dispatchEvent(new Event(PAID_CHANGED)); return body }
  const said = typeof body?.error === "string" ? body.error.slice(0, 400) : `The engine answered ${r.status}.`
  throw new SwitchRefused(said, r.status, typeof body?.field === "string" ? body.field : undefined, Array.isArray(body?.missingKeys) ? body.missingKeys.filter((k): k is string => typeof k === "string") : undefined)
}

/** Fired after a switch, so everything that shows the paid state reads it again at once. */
export const PAID_CHANGED = "paid.changed"
