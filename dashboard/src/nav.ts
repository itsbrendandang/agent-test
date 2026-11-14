// The views of the app, in the order of the side rail. Home is first and is what opens when the address names no view.
export const VIEWS = ["Home", "Swarm", "Board", "Experiments", "Overview", "Simulations", "Agents", "Worlds", "Analytics", "Settings"] as const
export type View = (typeof VIEWS)[number]
export const DEFAULT_VIEW: View = "Home"

/** The view a URL hash names ("#Board"), or undefined when it names none. */
export function viewOfHash(hash: string): View | undefined {
  let label = hash.replace(/^#/, "")
  try { label = decodeURIComponent(label) } catch { /* a broken escape names no view */ }
  return (VIEWS as readonly string[]).includes(label) ? (label as View) : undefined
}
/** The view to show on load. */
export const initialView = (hash: string): View => viewOfHash(hash) ?? DEFAULT_VIEW
