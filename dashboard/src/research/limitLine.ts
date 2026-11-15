// The one line that says, BEFORE anything is sent, what an answer on this page may cost and how long it may take
// (the engine's own limits for the level), or, in Demo, that the answer is example text. Shown under the Research
// composer and next to the Overview's send button, in the same words.
import type { Catalog } from "@/home/api"
import { plainDuration } from "@/lib/format"

export const DEMO_LINE = "Demo mode: answers are example text. Switch to Real for AI answers and web search."

/**
 * `effort`: the level the question would be asked at (the default is Standard). Quick and Standard answer on the
 * page within the engine's own limits; Deep plans a team review and asks before anything starts. Empty until the
 * engine's catalog is known.
 */
export function answerLimitLine(catalog: Catalog | null | undefined, effort: string = "standard"): string {
  if (!catalog) return ""
  if (catalog.paidCalls === false) return DEMO_LINE
  if (effort === "deep") {
    const level = catalog.efforts?.find((e) => e.id === "deep")
    return `Deep plans a team review and asks you before anything starts${level ? `: at most $${level.limits.maxUsd.toFixed(2)} and ${plainDuration(level.limits.maxMinutes * 60_000)}` : ""}.`
  }
  const cap = catalog.research?.[effort === "quick" ? "quick" : "standard"]
  return `${effort === "quick" ? "Quick" : "Standard"} answers on this page, with sources${cap ? `: at most $${cap.maxUsd.toFixed(2)} and ${plainDuration(cap.maxSeconds * 1000)}` : ""}.`
}
