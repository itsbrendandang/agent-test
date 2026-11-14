// Replies of the Home chat routes as the contract describes them, for tests.
import type { Catalog, ChatReply, Effort, Plan } from "@/home/api"

export const EFFORTS: Effort[] = [
  { id: "quick", label: "Quick", description: "A fast first look.", limits: { maxUsd: 0.5, maxMinutes: 5, maxRounds: 1 }, agents: 3, modelTier: "cheap", search: { exa: false, maxSearches: 0 } },
  { id: "standard", label: "Standard", description: "A full board review.", limits: { maxUsd: 5, maxMinutes: 15, maxRounds: 4 }, agents: 6, modelTier: "strong", search: { exa: true, maxSearches: 8 } },
  { id: "deep", label: "Deep", description: "Every agent, more rounds.", limits: { maxUsd: 20, maxMinutes: 60, maxRounds: 8 }, agents: "all", modelTier: "lead", search: { exa: true, maxSearches: 30 } },
]

export const CATALOG_ON: Catalog = {
  paidCalls: true,
  providers: [
    { id: "anthropic", keyPresent: true, models: ["claude-sonnet-5-5", "claude-haiku-5-5"] },
    { id: "openai", keyPresent: false, models: ["gpt-5.5"] },
    { id: "openrouter", keyPresent: false, models: [] },
  ],
  search: { exa: { keyPresent: false } },
  agents: [
    { name: "lead", title: "Lead Scientist", source: "board", role: "Runs the board and writes the memo", tools: [] },
    { name: "toxicologist", title: "Toxicologist", source: "board", role: "Judges safety margins", tools: ["exa_search"], deliverable: "A safety card" },
    { name: "pk-modeller", title: "PK Modeller", source: "specialist", role: "Fits exposure models", tools: ["python"], trigger: "the question is about dose or exposure" },
  ],
  skills: [
    { name: "herg-triage", description: "How to read hERG patch-clamp data.", installed: true },
    { name: "admet-benchmarks", description: "Public ADMET benchmark sets.", installed: false },
  ],
  efforts: EFFORTS,
  defaultEffort: "standard",
}
export const CATALOG_OFF: Catalog = { ...CATALOG_ON, paidCalls: false }

export const PLAN: Plan = {
  id: "plan-1", question: "Should we advance CMP-0423?", kind: "board", briefTitle: "KRAS G12C hit-to-lead", effort: "standard",
  brief: "# Brief\n\nDecide whether **CMP-0423** advances.\n\n- hERG IC50 6 uM",
  agents: [
    { name: "toxicologist", title: "Toxicologist", why: "The question is about a hERG liability." },
    { name: "med-chem", title: "Medicinal Chemist", why: "Potency is below the criterion." },
  ],
  skills: [{ name: "herg-triage", why: "Patch-clamp data is in the brief." }],
  search: { exa: true },
  models: { lead: "claude-opus", members: "claude-sonnet", checker: "gpt-mini" },
  limits: { maxUsd: 5, maxMinutes: 15, maxRounds: 4 },
  estimate: { usd: 1.8, basis: "6 agents, 4 rounds, list prices" },
  paid: true,
  warnings: ["Exa search has no key on this machine."],
}
export const SCRIPTED_PLAN: Plan = {
  ...PLAN, id: "plan-s", paid: false, search: { exa: false }, models: { lead: "mock", members: "mock", checker: "mock" },
  estimate: { usd: null, basis: "scripted models cost nothing" }, warnings: [],
}

export const reply = (over: Partial<ChatReply> = {}): { status: number; body: ChatReply } => ({ status: 200, body: { reply: "Here is what the records say.", mode: "ai", ...over } })
