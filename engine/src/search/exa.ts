// Exa web search for board members. Follows Exa's build-with-exa skill (.agents/skills/build-with-exa):
// the request is the query, the objective the model wrote, type "auto" and highlights, and nothing else.
// Results pass through the cheap first-pass triage (triage.ts) before any member reads them, so off-topic hits never cost the members' tokens.
import { MOCK } from "../config.ts"
import type { EvidenceItem } from "../events.ts"
import { MOCK_EVIDENCE } from "../mock.ts"
import { refusePaid } from "../paid/paid.ts"

/** Verbatim from Exa: the description of the `objective` tool parameter. Do not reword. */
export const OBJECTIVE_DESCRIPTION =
  "Goal for this search turn; say which documents should rank first, which should be excluded, and what specific facts or figures to pull from them."

/** What an agent with the search tool is told about using it. */
export const SEARCH_GUIDANCE = `# Searching
\`exa_search\` searches the live web. Use it for evidence; do not answer from memory when a source can be found.
- \`query\`: plain natural-language intent. Name the subject and the constraint, and a time window only if recency matters. Do not put instructions in the query.
- \`objective\`: the goal this search serves: which documents should rank first (for example primary research over news), which to exclude, and the facts or figures you need from them.
- \`key_question\`: the one question from the brief this search is for.
- Keep each search focused on one question. Cite only URLs a search returned, and say so when a search finds nothing relevant.`

export interface SearchResult {
  items: EvidenceItem[]
  /** Written by Exa for the model that reads the results; passed on with them. */
  notices: string[]
  /** What Exa says this request cost (costDollars in its response), when it says. Undefined for fixtures and when the field is absent or unreadable. */
  costUsd?: number
}

interface ExaResponse {
  results: { url: string; title?: string | null; highlights?: string[]; publishedDate?: string }[]
  notices?: { code: string; message: string }[]
  costDollars?: unknown
  warnings?: { code: string; message: string }[]
}

/**
 * How long one Exa request may take, the response body included. Without a limit a connection that never answers holds
 * a board round open with no end: the round waits for every member, and max_minutes is checked only between rounds.
 */
export const EXA_TIMEOUT_MS = 30_000

/** One live Exa search. Throws on a non-2xx response, and after `timeoutMs` (a TimeoutError). */
export async function exaLive(query: string, objective: string, apiKey: string, highlightChars?: number, timeoutMs = EXA_TIMEOUT_MS): Promise<SearchResult> {
  refusePaid("Exa search (api.exa.ai)")
  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    // Bare highlights (Exa's recommendation) unless the board asks for a size: highlights are what a claim is checked against.
    body: JSON.stringify({ query, objective, type: "auto", contents: { highlights: highlightChars ? { maxCharacters: highlightChars } : true } }),
  })
  if (!res.ok) throw new Error(`Exa ${res.status}: ${(await res.text()).slice(0, 500)}`)
  const body = (await res.json()) as ExaResponse
  // Warnings are about our request and are for developers; they never go to a model.
  for (const w of body.warnings ?? []) console.warn(`exa warning ${w.code}: ${w.message}`)
  return {
    items: body.results.map((r) => ({ url: r.url, title: r.title || r.url, text: (r.highlights ?? []).join("\n") })),
    notices: (body.notices ?? []).map((n) => n.message),
    costUsd: reportedCost(body.costDollars),
  }
}

/** The cost in a response's `costDollars`: a number, or an object with a numeric `total`. Anything else is "not reported". */
export function reportedCost(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : value && typeof value === "object" ? (value as { total?: unknown }).total : undefined
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined
}

/** A real board run needs EXA_API_KEY and does not have it. */
export class MissingExaKey extends Error {
  constructor() { super("Exa search: EXA_API_KEY is not set. A real run does not fall back to example sources; set the key in .env, or do a practice run.") }
}

/**
 * Fixture papers in scripted mode (the run itself is labelled scripted: run.started.mock, run.json mock); a live
 * search otherwise. A real run with no key throws: fixture papers presented as search results would be fake evidence.
 */
export async function exaSearch(query: string, objective: string, mock = MOCK, env: NodeJS.ProcessEnv = process.env, highlightChars?: number): Promise<SearchResult> {
  if (mock) return { items: MOCK_EVIDENCE.slice(0, 5), notices: [] }
  const key = env.EXA_API_KEY?.trim()
  if (!key) throw new MissingExaKey()
  return exaLive(query, objective, key, highlightChars)
}
