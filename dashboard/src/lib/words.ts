// The app's words, in one place, so every view says the same thing in plain language. The expert term stays
// available as a tooltip or a small second line; it is never the only thing a newcomer reads.
import type { Outcome } from "./verdict"

/** A run made with fixed, scripted text instead of a model. */
export const PRACTICE = "Practice run: fixed text, not real research"
export const PRACTICE_SHORT = "practice run"
export const REAL = "Real model"

/** What a check found, in plain words. The glyph is added by the pill's style (✓ ✕ ?). */
export const VERDICT_WORD: Record<Outcome, string> = { holds: "Holds up", fails: "Proven wrong", unknown: "Not enough evidence" }
/** "3 held up", "1 was proven wrong", "2 had too little evidence": for counts in a sentence. */
export const verdictCount = (outcome: Outcome, n: number): string =>
  outcome === "holds" ? `${n} held up` : outcome === "fails" ? `${n} ${n === 1 ? "was" : "were"} proven wrong` : `${n} had too little evidence`

/** The first sentence of a reply, for the "In short" line. Cut by code, never rewritten: it is the member's own words. */
export function inShort(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, " ").trim()
  const end = flat.search(/[.!?](\s|$)/)
  const first = end >= 0 ? flat.slice(0, end + 1) : flat
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first
}

/** Only an http(s) address becomes a link; anything else a model or a record supplied stays text. */
export const safeUrl = (value: string | undefined): string | undefined => {
  if (!value) return undefined
  try { const u = new URL(value); return u.protocol === "https:" || u.protocol === "http:" ? u.href : undefined } catch { return undefined }
}

