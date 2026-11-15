/** A run another view should open on its next mount (set by Experiments and Home). Read once, then cleared. */
export function takeOpen(kind: "swarm" | "board"): string | undefined {
  const key = `open.${kind}`
  const id = sessionStorage.getItem(key) ?? undefined
  if (id) window.setTimeout(() => sessionStorage.removeItem(key), 0) // after React's double call in development
  return id
}
/** Ask the Swarm or Board view to open this run when it mounts. The caller then switches to that view. */
export const setOpen = (kind: "swarm" | "board", id: string) => sessionStorage.setItem(`open.${kind}`, id)
/** The view that shows a run of this kind. */
export const viewOfKind = (kind: "swarm" | "board") => (kind === "swarm" ? "Compare" : "Board") as "Compare" | "Board"

/** The run a view showed last, so reopening the app returns to it. */
export const lastRun = (kind: "swarm" | "board"): string | undefined => { try { return localStorage.getItem(`last.${kind}`) ?? undefined } catch { return undefined } }
/** Record the run a view is showing: remembered for next time, and put in the address so the link can be copied. */
export function showing(kind: "swarm" | "board", id: string | undefined) {
  if (!id) return
  try { localStorage.setItem(`last.${kind}`, id) } catch { /* private mode */ }
  const hash = `#${viewOfKind(kind)}/${encodeURIComponent(id)}`
  if (window.location.hash.startsWith(`#${viewOfKind(kind)}`) && window.location.hash !== hash) window.history.replaceState(null, "", hash)
}
/** The address that opens this run. */
export const linkTo = (kind: "swarm" | "board", id: string) => `${window.location.origin}${window.location.pathname}#${viewOfKind(kind)}/${encodeURIComponent(id)}`

/** A saved answer the Search screen should show when it opens (set by Saved research). Read once, then cleared. */
const ANSWER = "open.answer"
export const setOpenAnswer = (id: string, question: string) => sessionStorage.setItem(ANSWER, JSON.stringify({ id, question }))
export function takeOpenAnswer(): { id: string; question: string } | undefined {
  try {
    const saved = JSON.parse(sessionStorage.getItem(ANSWER) ?? "null") as { id?: unknown; question?: unknown } | null
    if (saved) window.setTimeout(() => sessionStorage.removeItem(ANSWER), 0)
    return saved && typeof saved.id === "string" && /^[\w.-]{1,120}$/.test(saved.id) && typeof saved.question === "string" ? { id: saved.id, question: saved.question } : undefined
  } catch { return undefined }
}
