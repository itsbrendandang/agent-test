/** The product's name as people read it. As a slug it is "ai-scientist-bot". */
export const PRODUCT = "AI Scientist Bot"

// The views of the app, in the order of the rail. Home is first and is what opens when the address names no view.
export const VIEWS = ["Home", "Runs", "Compare", "Board", "Agents", "Graph", "Settings"] as const
export type View = (typeof VIEWS)[number]
export const DEFAULT_VIEW: View = "Home"

/** Names these views had before, so an old link or bookmark still opens the right one. */
const FORMER: Record<string, View> = { Experiments: "Runs", Swarm: "Compare", Worlds: "Graph" }

/** A hash is "#View" or "#View/<run id>": the address of a view, and of one run in it. */
const parts = (hash: string): [string, string | undefined] => {
  let label = hash.replace(/^#/, "")
  try { label = decodeURIComponent(label) } catch { /* a broken escape names no view */ }
  const cut = label.indexOf("/")
  return cut < 0 ? [label, undefined] : [label.slice(0, cut), label.slice(cut + 1) || undefined]
}
/** The view a URL hash names ("#Board", "#Board/<run id>"), or undefined when it names none. */
export function viewOfHash(hash: string): View | undefined {
  const [label] = parts(hash)
  return (VIEWS as readonly string[]).includes(label) ? (label as View) : FORMER[label]
}
/** The run a URL hash names, when it names one. Only the characters a run id can have are accepted. */
export const runOfHash = (hash: string): string | undefined => { const id = parts(hash)[1]; return id && /^[\w.-]{1,200}$/.test(id) ? id : undefined }

const LAST = "app.view"
/** Remember the view a person is on, so reopening the app returns there. */
export const rememberView = (view: View) => { try { localStorage.setItem(LAST, view) } catch { /* private mode */ } }
/** The view to show on load: the one the address names, else the last one used, else Home. */
export const initialView = (hash: string): View => {
  let last: string | null = null
  try { last = localStorage.getItem(LAST) } catch { /* private mode */ }
  return viewOfHash(hash) ?? ((VIEWS as readonly string[]).includes(last ?? "") ? (last as View) : DEFAULT_VIEW)
}
