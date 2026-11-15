// The views of the app, in the order of the rail. Home is first and is what opens when the address names no view.
export const VIEWS = ["Home", "Runs", "Compare", "Board", "Agents", "Graph", "Settings"] as const
export type View = (typeof VIEWS)[number]
export const DEFAULT_VIEW: View = "Home"

/** Names these views had before, so an old link or bookmark still opens the right one. */
const FORMER: Record<string, View> = { Experiments: "Runs", Swarm: "Compare", Worlds: "Graph" }

/** The view a URL hash names ("#Board"), or undefined when it names none. */
export function viewOfHash(hash: string): View | undefined {
  let label = hash.replace(/^#/, "")
  try { label = decodeURIComponent(label) } catch { /* a broken escape names no view */ }
  return (VIEWS as readonly string[]).includes(label) ? (label as View) : FORMER[label]
}
/** The view to show on load. */
export const initialView = (hash: string): View => viewOfHash(hash) ?? DEFAULT_VIEW
