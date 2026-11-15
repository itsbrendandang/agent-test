// One Models collection for the whole board.
// Real mode (paid calls allowed, see config.ts mockMode): every tier is called directly at its vendor, through
// pi-ai's own Anthropic and OpenAI providers (ANTHROPIC_API_KEY, OPENAI_API_KEY). The ids are in board/config.yaml
// as "<vendor>/<model>" (providers.ts). Their prices are pi-ai's bundled catalog, which the provider turns into
// usage.cost for every call; a tier whose model has no price there is refused (checkTierPrices), so max_usd binds.
// Mock mode (paid calls off, or DRUG_BOARD_MOCK=1): each agent gets a scripted faux model that
// reads its conversation and acts out a plausible turn, so the whole pipeline runs with no keys.
// Local mode (DRUG_BOARD_LOCAL_MODEL, see config.ts LOCAL): every agent is a real model served by Ollama on this
// machine, through its OpenAI-compatible endpoint. No key, no cost, nothing leaves the machine.
// Everything else stays as in mock mode: Exa returns the fixture papers, the first-pass and escalation checkers are scripted.
import { createModels, createProvider, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type Model, type Models } from "@earendil-works/pi-ai"
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy"
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic"
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai"
import type { ModelRef } from "@earendil-works/pi-durable"
import type { AgentDef } from "./agents.ts"
import { type BoardConfig, loadConfig, LOCAL, MOCK, type Tier } from "./config.ts"
import { localName, localServer } from "./local.ts"
import { mockLeadTurn, mockMemberTurn } from "./mock.ts"
import { refusePaid } from "./paid.ts"
import { modelsNeeded, parseModelId } from "./providers.ts"

export const LOCAL_PROVIDER = "ollama"
const TIERS: Tier[] = ["lead", "strong", "cheap", "rival"]

/** The Ollama model name of a tier in local mode: `local` itself (ollama/<name>), or the tier's entry in local_models when the board was asked for those. */
export function localModelFor(config: Pick<BoardConfig, "local_models">, tier: Tier, local: string, env: NodeJS.ProcessEnv = process.env): string {
  const perTier = (env.DRUG_BOARD_LOCAL_MODEL ?? "").trim() === "1" ? config.local_models?.[tier] : undefined
  const name = localName(`ollama/${perTier ?? localName(local) ?? ""}`)
  if (!name) throw new Error(`board/config.yaml local_models.${tier}: ${perTier} is not an Ollama model name`)
  return name
}

/** The provider for local mode. localServer throws for an address on another machine without LOCAL_MODEL_ALLOW_REMOTE=1. */
export function localProvider(names: string[], env: NodeJS.ProcessEnv = process.env) {
  const baseUrl = `${localServer(env).url}/v1`
  const models = [...new Set(names)].map((id): Model<"openai-completions"> => ({
    id, name: `${id} (local)`, api: "openai-completions", provider: LOCAL_PROVIDER, baseUrl, reasoning: false, input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_768, maxTokens: 4_096,
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, supportsStore: false, maxTokensField: "max_tokens" },
  }))
  // Ollama asks for no key, but the client will not send a request without one: it gets the fixed word "ollama"
  // (as Inspect's ollama provider sends). No key is read from the environment for it.
  return createProvider({ id: LOCAL_PROVIDER, name: "Ollama (this machine)", baseUrl, auth: { apiKey: { name: "Ollama", resolve: async () => ({ auth: { apiKey: "ollama" } }) } }, models, api: openAICompletionsApi() })
}

export function buildModels(roster: AgentDef[], mock = MOCK, local = LOCAL, config?: Pick<BoardConfig, "local_models">): Models {
  const models = createModels()
  if (mock && local) { // real agents on this machine; nothing paid is registered
    models.setProvider(localProvider(TIERS.map((tier) => localModelFor(config ?? loadConfig(), tier, local))))
    return models
  }
  if (!mock) {
    refusePaid("the drug board with real models (Anthropic, OpenAI)") // no real provider is registered while paid calls are off
    models.setProvider(anthropicProvider()) // ANTHROPIC_API_KEY: the lead, strong and cheap tiers
    models.setProvider(openaiProvider()) // OPENAI_API_KEY: the rival tier, the first-pass checker for Anthropic members, the literature checker
    checkTierPrices(models, loadConfig())
    return models
  }
  for (const agent of roster) {
    const faux = fauxProvider({
      provider: `mock-${agent.name}`,
      models: [{ id: "mock", cost: { input: agent.model === "lead" ? 15 : 3, output: agent.model === "lead" ? 75 : 15, cacheRead: 0, cacheWrite: 0 } }],
      tokensPerSecond: Number(process.env.DRUG_BOARD_MOCK_TPS ?? 400),
    })
    const turn = agent.role === "lead" ? mockLeadTurn : mockMemberTurn(agent)
    faux.setResponses(Array.from({ length: 200 }, () => (ctx: Parameters<typeof turn>[0]) => {
      const step = turn(ctx)
      return step.tool
        ? fauxAssistantMessage([fauxText(step.text), fauxToolCall(step.tool.name, step.tool.args as never)], { stopReason: "toolUse" })
        : fauxAssistantMessage(step.text)
    }))
    models.setProvider(faux.provider)
  }
  return models
}

export function modelFor(config: BoardConfig, agent: AgentDef): ModelRef {
  if (MOCK && LOCAL) return { provider: LOCAL_PROVIDER, modelId: localModelFor(config, agent.model, LOCAL) }
  return MOCK
    ? { provider: `mock-${agent.name}`, modelId: "mock" }
    : (({ vendor, id }) => ({ provider: vendor, modelId: id }))(parseModelId(config.models[agent.model], `board/config.yaml models.${agent.model}`))
}

/**
 * Every model the board calls must be in pi-ai's catalog with a price, or the spend caps could not see its cost
 * (usage.cost would be 0 and a run could pass max_usd for free). Throws naming the tier. This checks the catalog
 * that ships with the package: it does not ask the provider whether the id is accepted (that needs a paid call).
 */
export function checkTierPrices(models: Models, config: BoardConfig): void {
  for (const { tier, model } of modelsNeeded(config)) {
    const known = models.getModel(model.vendor, model.id)
    if (!known) throw new Error(`board/config.yaml: tier "${tier}" model ${model.qualified} is not in pi-ai's model catalog`)
    if (!(known.cost.input > 0) || !(known.cost.output > 0)) throw new Error(`board/config.yaml: tier "${tier}" model ${model.qualified} has no price in pi-ai's catalog, so the spend caps could not count it`)
  }
}
