// Exa search for the Literature Scout and researchers. Results pass through Jev triage before any LLM
// reads them, so off-topic hits never cost model tokens.
import { MOCK } from "./config.ts"
import type { EvidenceItem } from "./events.ts"
import { MOCK_EVIDENCE } from "./mock.ts"

export async function exaSearch(query: string, numResults = 5): Promise<EvidenceItem[]> {
  if (MOCK || !process.env.EXA_API_KEY) return MOCK_EVIDENCE.filter((_, i) => i < numResults)
  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.EXA_API_KEY },
    body: JSON.stringify({ query, numResults, type: "auto", contents: { text: { maxCharacters: 2000 } } }),
  })
  if (!res.ok) throw new Error(`Exa ${res.status}: ${await res.text()}`)
  const body = (await res.json()) as { results: { url: string; title?: string; text?: string }[] }
  return body.results.map((r) => ({ url: r.url, title: r.title ?? r.url, text: r.text ?? "" }))
}
