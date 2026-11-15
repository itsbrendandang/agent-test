/** The product's name as people read it. As a slug it is "ai-scientist-bot". */
export const PRODUCT = "AI Scientist Bot"

// The views of the app. The keys are addresses (the URL hash, stored choices, deep links): they never change.
// What a person reads is LABEL. Research is first and is what opens when the address names no view.
export const VIEWS = ["Home", "Runs", "Compare", "Board", "Agents", "Graph", "Lab", "Settings"] as const
export type View = (typeof VIEWS)[number]
export const DEFAULT_VIEW: View = "Home"
/** What a person reads in the navigation and in the header. Renames happen here only. */
export const LABEL: Record<View, string> = { Home: "Research", Runs: "Saved research", Compare: "Compare", Board: "Team review", Agents: "Agents", Graph: "Graph", Lab: "Lab", Settings: "Settings" }
/** One short line per place, for the navigation's tooltips and for screen readers. */
export const ABOUT: Record<View, string> = {
  Home: "Ask a research question and read the answer with its sources.",
  Runs: "Everything that was researched, newest first, with keyword search.",
  Compare: "One agent alone against a team of nine, on the same task.",
  Board: "One team review: the decision, the discussion and the checks.",
  Agents: "Who does the work: roles, team members, specialists and methods.",
  Graph: "One run as a graph of who said what and how it was checked.",
  Lab: "Watch the team at work in a run.",
  Settings: "What the engine can use, Demo or Real, and help.",
}
/** The everyday workflow: these three get the weight. */
export const PRIMARY: readonly View[] = ["Home", "Runs", "Compare"]
/** Advanced views: kept, quieter, under "More". */
export const MORE: readonly View[] = ["Board", "Agents", "Graph", "Lab"]

/** Names these views had before, and the words now on screen, so an old link or a typed name still opens the right one. */
const FORMER: Record<string, View> = { Experiments: "Runs", Swarm: "Compare", Worlds: "Graph", Search: "Home", Research: "Home", Saved: "Runs", Review: "Board" }

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
/** The view to show on load: the one the address names, else the last one used, else Research. */
export const initialView = (hash: string): View => {
  let last: string | null = null
  try { last = localStorage.getItem(LAST) } catch { /* private mode */ }
  return viewOfHash(hash) ?? ((VIEWS as readonly string[]).includes(last ?? "") ? (last as View) : DEFAULT_VIEW)
}
