// `npm run preflight`: what a person runs BEFORE turning paid calls on, to learn what would fail, for free.
//
// It makes no billed call. The only requests it can send are two model-LIST requests (GET, no body, no inference):
//   GET https://api.anthropic.com/v1/models     with the Anthropic key  (only if a tier needs it)
//   GET https://api.openai.com/v1/models        with the OpenAI key     (only if a tier needs it)
// and it says which it sent. It does not search Exa (it only checks that the key is set) and starts no model.
// That these two list endpoints are free is from the vendors' public documentation, as the author remembers it: it was
// not tested here (the author may not use the keys).
//
// It checks, for each tier in board/config.yaml: the key is set and the vendor accepts it; the model id is in the
// vendor's list; the id has a price in pi-ai's catalog (so the spend caps can count it). Then it prints the caps and a
// worst-case cost for one run. It returns the problems; the CLI exits 1 if there is any.
//
// It refuses to run when the paid switch is locked (PAID_SWITCH_LOCKED=1, CI, tests): it needs real keys.
import { createModels } from "@earendil-works/pi-ai"
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic"
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai"
import { loadRoster } from "./agents.ts"
import { spentToday } from "./board.ts"
import { type BoardConfig } from "./config.ts"
import { exaAssumed, exaCeiling, exaLedgerFile, exaTotal, maxSearches } from "./exaledger.ts"
import { checkTierPrices } from "./models.ts"
import { paidSwitchLocked } from "./paid.ts"
import { modelsNeeded, parseModelId, type Vendor, VENDOR_KEY } from "./providers.ts"

export interface PreflightDeps { env: NodeJS.ProcessEnv; fetch: typeof fetch; config: BoardConfig; log: (line: string) => void }
export interface PreflightResult { ok: boolean; refused?: boolean; problems: string[]; endpoints: string[]; worstCaseUsd?: number }

/** ASSUMPTIONS for the worst case: every call is made, each with this much input and output. Not measured. */
export const WORST_CASE = { inputTokens: 30_000, outputTokens: 4_000, escalationInput: 8_000, escalationOutput: 1_000 }

const LIST: Record<Vendor, { url: string; headers: (key: string) => Record<string, string> }> = {
  anthropic: { url: "https://api.anthropic.com/v1/models?limit=1000", headers: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }) },
  openai: { url: "https://api.openai.com/v1/models", headers: (key) => ({ authorization: `Bearer ${key}` }) },
}

/** The ids a vendor lists for this key. Throws a plain sentence on a rejected key, an error status or no answer. */
async function listModels(vendor: Vendor, key: string, fetcher: typeof fetch): Promise<string[]> {
  let response: Response
  try { response = await fetcher(LIST[vendor].url, { method: "GET", headers: LIST[vendor].headers(key), signal: AbortSignal.timeout(20_000) }) }
  catch (error) { throw new Error(`${vendor} did not answer the model-list request (${String(error instanceof Error ? error.message : error).slice(0, 120)})`) }
  if (response.status === 401 || response.status === 403) throw new Error(`${vendor} refused the key in ${VENDOR_KEY[vendor]} (HTTP ${response.status})`)
  if (!response.ok) throw new Error(`${vendor} answered the model-list request with HTTP ${response.status}`)
  const body = (await response.json().catch(() => undefined)) as { data?: { id?: unknown }[] } | undefined
  if (!body || !Array.isArray(body.data)) throw new Error(`${vendor} answered the model-list request with something that is not a list of models`)
  return body.data.map((m) => m.id).filter((id): id is string => typeof id === "string")
}

export async function runPreflight(deps: PreflightDeps): Promise<PreflightResult> {
  const { env, config, log } = deps
  if (paidSwitchLocked(env)) {
    log("Preflight refused: the paid switch is locked (PAID_SWITCH_LOCKED=1, or this is a test or CI run). It needs real keys, and a locked engine is not meant to be used for real runs.")
    return { ok: false, refused: true, problems: ["locked"], endpoints: [] }
  }
  const problems: string[] = [], endpoints: string[] = []
  const needed = modelsNeeded(config)
  const searchers = loadRoster(config).some((a) => a.tools.includes("exa_search"))

  log("Preflight: nothing here makes a billed call.")
  // 1. keys, and what each vendor lists
  const vendors = [...new Set(needed.map((n) => n.model.vendor))]
  const listed = new Map<Vendor, string[]>()
  for (const vendor of vendors) {
    const key = env[VENDOR_KEY[vendor]]?.trim()
    const tiers = needed.filter((n) => n.model.vendor === vendor).map((n) => n.tier).join(", ")
    if (!key) { problems.push(`${VENDOR_KEY[vendor]} is not set (needed by: ${tiers})`); log(`✗ ${VENDOR_KEY[vendor]}: not set (needed by ${tiers})`); continue }
    endpoints.push(`GET ${LIST[vendor].url.split("?")[0]}`)
    try { listed.set(vendor, await listModels(vendor, key, deps.fetch)); log(`✓ ${VENDOR_KEY[vendor]}: set, and ${vendor} accepted it (${listed.get(vendor)!.length} models listed)`) }
    catch (error) { const m = String(error instanceof Error ? error.message : error); problems.push(m); log(`✗ ${m}`) }
  }
  // 2. each tier's model
  for (const { tier, model } of needed) {
    const ids = listed.get(model.vendor)
    if (!ids) continue // the key problem is already reported
    if (ids.includes(model.id)) log(`✓ tier ${tier}: ${model.qualified} is in ${model.vendor}'s list`)
    else { problems.push(`tier ${tier}: ${model.qualified} is not in ${model.vendor}'s model list`); log(`✗ tier ${tier}: ${model.qualified} is NOT in ${model.vendor}'s model list. Fix models.${tier} (or checkers.first_pass.alt) in board/config.yaml`) }
  }
  // 3. Exa: the key only
  if (searchers) {
    if (env.EXA_API_KEY?.trim()) log("✓ EXA_API_KEY: set (not tested: a search would cost money)")
    else { problems.push("EXA_API_KEY is not set (a member searches)"); log("✗ EXA_API_KEY: not set, and a member searches") }
  } else log("- Exa: no member has the search tool, so no key is needed")
  // 4. prices, so the caps can count every tier
  const models = createModels(); models.setProvider(anthropicProvider()); models.setProvider(openaiProvider())
  try { checkTierPrices(models, config); log("✓ every tier's model has a price in pi-ai's catalog") }
  catch (error) { const m = String(error instanceof Error ? error.message : error); problems.push(m); log(`✗ ${m}`) }

  // 5. caps and the worst case
  const m = config.meeting, roster = loadRoster(config)
  log(`Caps: max_usd $${m.max_usd} per run, daily_usd $${m.daily_usd} (spent today: $${spentToday(config).toFixed(2)}), max_searches ${maxSearches(config)} per run`)
  log(`Exa: $${exaTotal(exaLedgerFile(config), exaAssumed(config)).toFixed(2)} used of the $${exaCeiling(config)} ceiling (assumed $${exaAssumed(config)} per search until Exa reports one)`)
  const price = (id: string) => { const p = parseModelId(id); const x = models.getModel(p.vendor, p.id); return x ? { input: x.cost.input, output: x.cost.output } : undefined }
  const cost = (id: string, calls: number, inTok: number, outTok: number) => { const p = price(id); return p ? calls * (inTok * p.input + outTok * p.output) / 1e6 : 0 }
  let worst = cost(config.models.lead, m.lead_turns ?? 20, WORST_CASE.inputTokens, WORST_CASE.outputTokens)
  for (const agent of roster) worst += cost(config.models[agent.model], m.max_rounds * (m.member_turns ?? 6), WORST_CASE.inputTokens, WORST_CASE.outputTokens)
  worst += cost(`openai/${config.checkers.openai_model}`, m.max_escalations ?? 12, WORST_CASE.escalationInput, WORST_CASE.escalationOutput)
  worst += maxSearches(config) * exaAssumed(config)
  log(`Worst case for one run, an ESTIMATE: about $${worst.toFixed(2)} if every allowed call were made with ${WORST_CASE.inputTokens.toLocaleString("en")} input and ${WORST_CASE.outputTokens.toLocaleString("en")} output tokens (prices from pi-ai's bundled catalog, not from the vendors' price pages).`)
  log(`What actually stops a run is max_usd ($${m.max_usd}): no round starts that is expected to pass it and no paid check or search starts after it; the worst overshoot is the round in progress. Use \`npm run board -- run <brief> --max-usd 0.5\` to lower it for a first run.`)

  log(endpoints.length ? `Endpoints called: ${endpoints.join(", ")}. No completion, no search, no other request.` : "Endpoints called: none.")
  log(problems.length ? `Preflight FAILED: ${problems.length} problem(s). A real run would fail on: ${problems.join("; ")}.` : "Preflight passed. Paid calls are still off: turning them on is a separate decision (the dashboard's switch, or NO_PAID_CALLS=0 in .env).")
  return { ok: problems.length === 0, problems, endpoints, worstCaseUsd: worst }
}
