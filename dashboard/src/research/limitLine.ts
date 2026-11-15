// The one line that says, BEFORE anything is sent, what an answer on this page may cost and how long it may take
// (the engine's own limits for the level), or, in Demo, that the answer is example text. Shown under the Research
// composer and next to the Overview's send button, in the same words.
import type { Catalog } from "@/home/api"
import { plainDuration } from "@/lib/format"

export const DEMO_LINE = "Demo mode: answers are example text. Switch to Real for AI answers and web search."

/** `effort`: the level a direct answer would use (the default is Standard). Empty until the engine's catalog is known. */
export function answerLimitLine(catalog: Catalog | null | undefined, effort: "quick" | "standard" = "standard"): string {
  if (!catalog) return ""
  if (catalog.paidCalls === false) return DEMO_LINE
  const cap = catalog.research?.[effort]
  return `${effort === "quick" ? "Quick" : "Standard"} answers on this page, with sources${cap ? `: at most $${cap.maxUsd.toFixed(2)} and ${plainDuration(cap.maxSeconds * 1000)}` : ""}.`
}
