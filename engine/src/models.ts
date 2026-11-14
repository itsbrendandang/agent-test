// One Models collection for the whole board.
// Real mode: every chat model and Jev go through OpenRouter (one key, one bill). OpenAI is registered
// only for escalation checks, so it spends your OpenAI credits only on claims Jev could not settle.
// Mock mode (no OPENROUTER_API_KEY, or DRUG_BOARD_MOCK=1): each agent gets a scripted faux model that
// reads its conversation and acts out a plausible turn, so the whole pipeline runs with no keys.
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type Models } from "@earendil-works/pi-ai"
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai"
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter"
import type { ModelRef } from "@earendil-works/pi-durable"
import type { AgentDef } from "./agents.ts"
import { type BoardConfig, MOCK } from "./config.ts"
import { mockLeadTurn, mockMemberTurn } from "./mock.ts"
import { refusePaid } from "./paid.ts"

export function buildModels(roster: AgentDef[], mock = MOCK): Models {
  const models = createModels()
  if (!mock) {
    refusePaid("the drug board with real models (OpenRouter, OpenAI)") // no real provider is registered while paid calls are off
    models.setProvider(openrouterProvider()) // OPENROUTER_API_KEY: chat models and Jev
    if (process.env.OPENAI_API_KEY) models.setProvider(openaiProvider()) // escalation checker
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
  return MOCK
    ? { provider: `mock-${agent.name}`, modelId: "mock" }
    : { provider: "openrouter", modelId: config.models[agent.model] }
}
