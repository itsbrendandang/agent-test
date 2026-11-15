// The addresses that tie the views together. One element (an agent, a run, a source, a statement, a graph node) is
// shown in several views; each view links to the others through these addresses, so the same thing opens the same
// way from everywhere, the browser's Back and Forward move between them, and a copied address opens the same place.
//
//   #Lab/<kind>/<run id>?agent=<name>     the Agent Log of one run, filtered to one agent (both parts optional)
//   #Lab/<kind>?agent=<name>              the newest run of that kind, filtered to one agent
//   #Graph/<kind>/<run id>?node=<node id> the graph of one run, with one node selected
//   #Agents/<name>                        the Agents view with that agent's details open
//   #Board/<run id>, #Compare/<run id>    a team review, a benchmark run (lib/open.ts)
//
// An agent's name is the engine's name ("lead-scientist", "critique", "checker") or a lab character ("navigator").
// Every part is checked here: a value that is not an id or a name is dropped, never passed on.
import type { RunKind } from "@/lab/model"

const KINDS: readonly RunKind[] = ["answer", "board", "swarm"]
/** What a run id can hold. The same rule as nav.ts. */
const ID = /^[\w.-]{1,200}$/
/** What an agent's name can hold: the engine's names, a specialist's "specialist:" prefix, a character id. */
const NAME = /^[\w.:-]{1,120}$/
/** A graph node id: "agent:<name>", "claim:<member>:<code>", "source:<url>". Anything printable without spaces, but not too long. */
const NODE = { test: (s: string) => s.length > 0 && s.length <= 600 && ![...s].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127) }

const decode = (s: string): string | undefined => { try { return decodeURIComponent(s) } catch { return undefined } }
const query = (values: Record<string, string | undefined>) => {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(values)) if (v) q.set(k, v)
  const s = q.toString()
  return s ? `?${s}` : ""
}
/** "#View/a/b?x=1" as its view, its path parts (each decoded) and its query. Undefined for a broken escape. */
function split(hash: string): { view: string; path: string[]; params: URLSearchParams } | undefined {
  const raw = hash.replace(/^#/, "")
  const at = raw.indexOf("?")
  const [view, ...path] = (at < 0 ? raw : raw.slice(0, at)).split("/").map(decode)
  if (view === undefined || path.some((p) => p === undefined)) return undefined
  let params: URLSearchParams
  try { params = new URLSearchParams(at < 0 ? "" : raw.slice(at + 1)) } catch { return undefined }
  const parts = path as string[]
  if (parts.at(-1) === "") parts.pop() // "#Lab/board/" is "#Lab/board"
  return { view, path: parts, params }
}
const isKind = (k: string | undefined): k is RunKind => !!k && (KINDS as readonly string[]).includes(k)

export interface LogAddress { kind?: RunKind; id?: string; agent?: string }
/** The Agent Log at one run (or the newest run of a kind, or the newest run), filtered to one agent when named. */
export function logLink(run?: { kind: RunKind; id?: string }, agent?: string): string {
  const where = run ? `/${run.kind}${run.id ? `/${encodeURIComponent(run.id)}` : ""}` : ""
  return `#Lab${where}${query({ agent: agent && NAME.test(agent) ? agent : undefined })}`
}
/** What an Agent Log address names. Undefined when the address is not the Agent Log's or names something it cannot hold. */
export function logOfHash(hash: string): LogAddress | undefined {
  const h = split(hash)
  if (!h || h.view !== "Lab") return undefined
  const [kind, id, ...rest] = h.path
  if (rest.length || (kind !== undefined && !isKind(kind)) || (id !== undefined && !ID.test(id))) return undefined
  const agent = h.params.get("agent") ?? undefined
  return { ...(kind && { kind: kind as RunKind }), ...(id && { id }), ...(agent && NAME.test(agent) && { agent }) }
}

export interface GraphAddress { kind: "board" | "swarm"; id: string; node?: string }
/** The graph of one run, with a node selected when named. Answers have no graph. */
export const graphLink = (kind: "board" | "swarm", id: string, node?: string) =>
  `#Graph/${kind}/${encodeURIComponent(id)}${query({ node: node && NODE.test(node) ? node : undefined })}`
export function graphOfHash(hash: string): GraphAddress | undefined {
  const h = split(hash)
  if (!h || h.view !== "Graph") return undefined
  const [kind, id, ...rest] = h.path
  if (rest.length || (kind !== "board" && kind !== "swarm") || !id || !ID.test(id)) return undefined
  const node = h.params.get("node") ?? undefined
  return { kind, id, ...(node && NODE.test(node) && { node }) }
}
/** Runs that have a graph. */
export const hasGraph = (kind: RunKind): kind is "board" | "swarm" => kind === "board" || kind === "swarm"

/**
 * The Agents view, with one agent's details open. `from`: the kind of run the agent was met in, so a name both teams
 * have ("scout") opens the right card: the team of nine's for a benchmark run, the team review's otherwise.
 */
export const agentLink = (name: string, from?: RunKind) => (NAME.test(name) ? `#Agents/${encodeURIComponent(name)}${query({ from })}` : "#Agents")
export function agentOfHash(hash: string): { name: string; from?: RunKind } | undefined {
  const h = split(hash)
  if (!h || h.view !== "Agents") return undefined
  const [name, ...rest] = h.path
  const from = h.params.get("from") ?? undefined
  return !rest.length && name && NAME.test(name) ? { name, ...(isKind(from) && { from }) } : undefined
}

/** The view that shows one run in full: a team review, a benchmark run. An answer opens in Research (openAnswer in lib/open.ts). */
export const runLink = (kind: "board" | "swarm", id: string) => `#${kind === "board" ? "Board" : "Compare"}/${encodeURIComponent(id)}`

/** Put this address in the bar without a new history entry: a choice inside a view, not a move to another place. */
export function replaceAddress(hash: string) {
  if (window.location.hash !== hash) window.history.replaceState(null, "", hash)
}
