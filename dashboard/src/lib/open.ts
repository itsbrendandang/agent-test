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

// A question typed somewhere else (the Overview's chat box), handed to Research. It is put in the composer and NOT
// sent: the person presses Send on Research, where the effort and the limits are shown. Read once, then cleared.
const ASK = "open.ask"
/** The longest question the composer takes (the engine's own limit). */
const ASK_MAX = 2000
/** The level a handed-over question is to be answered at. */
export type AskEffort = "quick" | "standard" | "deep"
const LEVELS: readonly AskEffort[] = ["quick", "standard", "deep"]
/**
 * Hand a question to Research. With `send`, Research starts the search at once, as if the person had typed it there
 * and pressed Send (same token prompt, limits and refusals); without it the question only waits in the composer.
 */
export const setAsk = (question: string, options: { send?: boolean; effort?: AskEffort } = {}) => {
  try {
    const q = question.trim().slice(0, ASK_MAX)
    if (!q) { sessionStorage.removeItem(ASK); return }
    sessionStorage.setItem(ASK, options.send === true ? JSON.stringify({ question: q, send: true, ...(options.effort && LEVELS.includes(options.effort) ? { effort: options.effort } : {}) }) : q) // unsent: the plain text, as before
  } catch { /* storage off: nothing is handed over */ }
}
export function takeAsk(): { question: string; send: boolean; effort?: AskEffort } | undefined {
  try {
    const raw = sessionStorage.getItem(ASK)
    if (raw === null) return undefined
    window.setTimeout(() => sessionStorage.removeItem(ASK), 0) // after this render: a second mount in development reads the same
    // Sent: {"question", "send": true}. Anything else is the question itself, to be put in the box and not sent.
    let sent: { question?: unknown; send?: unknown; effort?: unknown } | undefined
    try { const v: unknown = JSON.parse(raw); if (v && typeof v === "object" && (v as { send?: unknown }).send === true) sent = v as { question?: unknown; effort?: unknown } } catch { /* plain text */ }
    const question = (sent ? (typeof sent.question === "string" ? sent.question : "") : raw).trim().slice(0, ASK_MAX)
    const effort = LEVELS.find((l) => l === sent?.effort)
    return question ? { question, send: !!sent, ...(effort && { effort }) } : undefined
  } catch { return undefined }
}
