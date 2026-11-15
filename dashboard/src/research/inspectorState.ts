// The inspector's remembered state (shown or not, how wide), when there is room for it beside the conversation, and
// which of its tabs have something to show.
import { useEffect, useState } from "react"
import type { AnswerState } from "./model"

export type InspectorTab = "evidence" | "hypotheses" | "variants" | "results" | "activity"

/** The tabs that have something to show for this answer. */
export function tabsOf(s: AnswerState | undefined): InspectorTab[] {
  if (!s) return []
  return [
    ...(s.sources.length || s.statements.length || s.notes.length || s.selection ? ["evidence" as const] : []),
    ...(s.hypotheses.length ? ["hypotheses" as const] : []),
    ...(s.variants?.items.length ? ["variants" as const] : []),
    ...(s.artifacts.length ? ["results" as const] : []),
    ...(s.steps.length || s.status !== "starting" ? ["activity" as const] : []),
  ]
}


const KEY = "research.inspector"
export const MIN_WIDTH = 320, MAX_WIDTH = 640
const MIN = MIN_WIDTH, MAX = MAX_WIDTH, DEFAULT = 400
/** Below this width there is no room for the conversation and the inspector side by side. */
export const TWO_COLUMNS = 1100
export const clampWidth = (w: number) => Math.min(MAX, Math.max(MIN, Math.round(w)))

export function loadInspector(): { open: boolean; width: number } {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as { open?: unknown; width?: unknown }; return { open: v.open === true, width: typeof v.width === "number" ? clampWidth(v.width) : DEFAULT } }
  catch { return { open: false, width: DEFAULT } }
}
export function saveInspector(v: { open: boolean; width: number }) { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* private mode: not remembered */ } }

export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < TWO_COLUMNS)
  useEffect(() => { const on = () => setNarrow(window.innerWidth < TWO_COLUMNS); on(); window.addEventListener("resize", on); return () => window.removeEventListener("resize", on) }, [])
  return narrow
}

