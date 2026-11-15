/** The product's name as people read it. As a slug it is "ai-scientist-bot". */
export const PRODUCT = "AI Scientist Bot"

// The views of the app. The keys are addresses (the URL hash, stored choices, deep links): they never change.
// What a person reads is LABEL. Overview is the home page: it is first, and it is what opens when the address names
// no view (the brand in the sidebar goes there too). "Home" stays the key of Research, so old links keep working.
export const VIEWS = ["Overview", "Home", "Runs", "Compare", "Benchmarks", "Board", "Agents", "Graph", "Lab", "Settings"] as const
export type View = (typeof VIEWS)[number]
export const DEFAULT_VIEW: View = "Overview"
/** What a person reads in the navigation and in the header. Renames happen here only. */
export const LABEL: Record<View, string> = { Overview: "Overview", Home: "Research", Runs: "Saved research", Compare: "Compare", Benchmarks: "Benchmarks", Board: "Team review", Agents: "Agents", Graph: "Graph", Lab: "Agent Log", Settings: "Settings" }
/** One short line per place, for the navigation's tooltips and for screen readers. */
export const ABOUT: Record<View, string> = {
  Overview: "Home: research in progress, counts, spend and checks, and recent research.",
  Home: "Ask a research question and read the answer with its sources.",
  Runs: "Everything that was researched, newest first, with keyword search.",
  Compare: "One agent against a team of nine, on the same benchmark task.",
  Benchmarks: "Our results on the benchmarks, beside the record to beat.",
  Board: "One team review: the recommendation, the checks and the discussion.",
  Agents: "Who does the work: the nine roles, the review agents, specialists and skills.",
  Graph: "One run as a graph of who said what and how it was checked.",
  Lab: "The full event log of a run, with agent filters and downloads.",
  Settings: "Run mode (Demo or Real), the session token, and help.",
}
/** The views the navigation lists. Benchmarks and Compare open only by their address. */
export type Listed = Exclude<View, "Benchmarks" | "Compare" | "Settings">
/** The everyday loop, as in a search tool: ask, read the answer, find it again. These get the weight. */
export const PRIMARY: readonly Listed[] = ["Overview", "Home", "Runs"]
/** The quieter group under the main one, with the heading MORE_LABEL: how an answer was made. Benchmarks and Compare
 *  are not in the navigation: they open only by their address (#Benchmarks, #Compare, #Compare/<run id>). */
export const MORE_LABEL = "How it works"
export const MORE: readonly Listed[] = ["Lab", "Board", "Graph", "Agents"]

/** Names these views had before, and the words now on screen, so an old link or a typed name still opens the right one. */
const FORMER: Record<string, View> = { Experiments: "Runs", Swarm: "Compare", Worlds: "Graph", Search: "Home", Research: "Home", Saved: "Runs", Review: "Board" }

/** A hash is "#View" or "#View/<run id>": the address of a view, and of one run in it. What follows "?" is the view's own (lib/links.ts). */
const parts = (hash: string): [string, string | undefined] => {
  let label = hash.replace(/^#/, "").replace(/\?.*$/, "")
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

/** The view to show on load: the one the address names, else the home page (Overview). */
export const initialView = (hash: string): View => viewOfHash(hash) ?? DEFAULT_VIEW
