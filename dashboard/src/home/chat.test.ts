import { describe, expect, it } from "vitest"
import { CATALOG_ON, EFFORTS, PLAN, reply, SCRIPTED_PLAN } from "@/test/home"
import { routes } from "@/test/engine"
import { ChatRefused, getCatalog, sendChat, startPlan } from "./api"
import {
  boardScriptedWhy, keyOfModel, chatRequest, controlOf, editsOf, effortFacts, effortInEffect, estimateText, KEY_REFUSAL, loadEffort, loadTurns, looksLikeKey, MAX_HISTORY, MAX_MESSAGE,
  MODE_LABEL, refuseText, replanRequest, saveEffort, saveTurns, startBlock, startRequest, type Turn,
} from "./chat"

const turns: Turn[] = [
  { id: 1, role: "user", content: "First question" },
  { id: 2, role: "assistant", content: "First answer", reply: { reply: "First answer", mode: "keyword", note: "n", runs: [{ kind: "board", id: "r", title: "t", why: "w" }] } },
]

describe("mode labels", () => {
  it("say plainly whether a model wrote the reply", () => {
    expect(MODE_LABEL).toEqual({ ai: "AI answer", keyword: "Saved-research search", scripted: "Demo response" })
  })
})

describe("chatRequest", () => {
  it("sends role and text only, then the new question, trimmed", () => {
    expect(chatRequest(turns, "  Second question \n")).toEqual({ messages: [
      { role: "user", content: "First question" }, { role: "assistant", content: "First answer" }, { role: "user", content: "Second question" },
    ] })
  })
  it("names provider and model only when both are chosen", () => {
    expect(chatRequest([], "q", { provider: "anthropic", model: "claude-sonnet-5-5" })).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5" })
    const bare = chatRequest([], "q", { provider: "anthropic" })
    expect("provider" in bare || "model" in bare).toBe(false)
  })
  it("sends the effort when there is one", () => {
    expect(chatRequest([], "q", { effort: "deep" })).toEqual({ messages: [{ role: "user", content: "q" }], effort: "deep" })
    expect("effort" in chatRequest([], "q")).toBe(false)
  })
  it("sends the newest messages only, ending with the question", () => {
    const long: Turn[] = Array.from({ length: 100 }, (_, i) => ({ id: i, role: "user", content: `m${i}` }))
    const { messages } = chatRequest(long, "last")
    expect(messages).toHaveLength(MAX_HISTORY)
    expect(messages.at(-1)).toEqual({ role: "user", content: "last" })
  })
})

describe("what may be sent", () => {
  it("refuses empty and too long text", () => {
    expect(refuseText("   ")).toMatch(/Type a question/)
    expect(refuseText("x".repeat(MAX_MESSAGE + 1))).toMatch(/at most 2,000 characters/)
    expect(refuseText("Is hERG a risk?")).toBeUndefined()
  })
  it.each(["sk-ant-api03-abcdefghijklmnop", "my key is sk-proj-ABCDEFGHIJKLMNOPQRST", "sk-or-v1-0123456789abcdef", "AIzaSyA-0123456789abcdefghij", "xai-0123456789abcdefghij", "hf_abcdefghijklmnopqrstuv"])("refuses text that holds an API key: %s", (text) => {
    expect(looksLikeKey(text)).toBe(true)
    expect(refuseText(text)).toBe(KEY_REFUSAL)
  })
  it("does not mistake ordinary words for a key", () => {
    for (const text of ["the risk-benefit of sk-1", "ask-anthropic about hERG", "task sk- short"]) expect(looksLikeKey(text)).toBe(false)
  })
})

describe("effort", () => {
  it("uses the last choice, else the engine's default, else its first level", () => {
    expect(effortInEffect(CATALOG_ON, "deep")).toBe("deep")
    expect(effortInEffect(CATALOG_ON, undefined)).toBe("standard")
    expect(effortInEffect(CATALOG_ON, "extreme")).toBe("standard")
    expect(effortInEffect({ efforts: EFFORTS }, undefined)).toBe("quick")
  })
  it("is nothing on an engine without effort levels", () => {
    expect(effortInEffect({ ...CATALOG_ON, efforts: undefined }, "deep")).toBeUndefined()
    expect(effortInEffect(null, "deep")).toBeUndefined()
  })
  it("is remembered in localStorage", () => {
    expect(loadEffort()).toBeUndefined()
    saveEffort("quick")
    expect(loadEffort()).toBe("quick")
    expect(localStorage.getItem("home.effort")).toBe("quick")
  })
  it("says what a level implies: agents, rounds, time, cost, models, search", () => {
    expect(effortFacts(EFFORTS[0])).toBe("3 agents · up to 1 round · up to 5 minutes · up to $0.50 · small, fast models · no web search")
    expect(effortFacts(EFFORTS[2])).toBe("all agents · up to 8 rounds · up to 1 hour · up to $20.00 · the strongest models · web search, up to 30 searches")
  })
  it("asks for a plan again with the conversation as it was before that reply", () => {
    const later: Turn[] = [...turns, { id: 3, role: "user", content: "Plan it" }, { id: 4, role: "assistant", content: "Plan", reply: { reply: "Plan", mode: "ai", plan: PLAN } }, { id: 5, role: "user", content: "later" }]
    expect(replanRequest(later, 4, { effort: "deep" })).toEqual({ effort: "deep", messages: [
      { role: "user", content: "First question" }, { role: "assistant", content: "First answer" }, { role: "user", content: "Plan it" },
    ] })
    expect(replanRequest(later, 3, { effort: "deep" })).toBeUndefined()
    expect(replanRequest(later, 99, { effort: "deep" })).toBeUndefined()
  })
})

describe("starting a plan", () => {
  it("an untouched plan sends only the confirmation and the effort", () => {
    expect(startRequest(PLAN, editsOf(PLAN), "standard")).toEqual({ errors: {}, request: { confirm: true, effort: "standard" } })
    expect(startRequest(PLAN, editsOf(PLAN))).toEqual({ errors: {}, request: { confirm: true } })
  })
  it("sends lowered limits and a shorter list of agents", () => {
    const { errors, request } = startRequest(PLAN, { maxUsd: "2.5", maxMinutes: "10", maxRounds: "4", agents: ["critic"] }, "standard")
    expect(errors).toEqual({})
    expect(request).toEqual({ confirm: true, effort: "standard", limits: { maxUsd: 2.5, maxMinutes: 10, maxRounds: 4 }, agents: ["critic"] })
  })
  it("refuses to raise a limit, and wrong numbers", () => {
    expect(startRequest(PLAN, { ...editsOf(PLAN), maxUsd: "50" }).errors.maxUsd).toMatch(/can be lowered, not raised above 5/)
    expect(startRequest(PLAN, { ...editsOf(PLAN), maxUsd: "0" }).errors.maxUsd).toMatch(/number above 0/)
    expect(startRequest(PLAN, { ...editsOf(PLAN), maxMinutes: "2.5" }).errors.maxMinutes).toMatch(/whole number/)
    expect(startRequest(PLAN, { ...editsOf(PLAN), maxRounds: "" }).errors.maxRounds).toMatch(/whole number/)
  })
  it("refuses a plan with no agent, and ignores names the plan does not have", () => {
    expect(startRequest(PLAN, { ...editsOf(PLAN), agents: [] }).errors.agents).toBe("Keep at least one agent.")
    expect(startRequest(PLAN, { ...editsOf(PLAN), agents: ["critic", "intruder"] }).request.agents).toEqual(["critic"])
  })
  it("a paid plan needs the tick", () => {
    expect(startBlock(PLAN, true, false)).toMatch(/Tick the box/)
    expect(startBlock(PLAN, true, true)).toBeUndefined()
  })
  it("a paid plan cannot start while paid calls are off, ticked or not, and says how a person turns them on", () => {
    for (const agreed of [false, true]) {
      expect(startBlock(PLAN, false, agreed)).toMatch(/you are in Demo mode/)
      expect(startBlock(PLAN, false, agreed)).toMatch(/choose Real at the top of the page/)
      expect(startBlock(PLAN, false, agreed)).toMatch(/asks you to confirm that it costs money/)
    }
  })
  it("a paid plan with the switch unknown still needs the tick; the engine decides the rest", () => {
    expect(startBlock(PLAN, undefined, false)).toMatch(/Tick the box/)
    expect(startBlock(PLAN, undefined, true)).toBeUndefined()
  })
  it("a scripted plan needs no tick", () => {
    expect(startBlock(SCRIPTED_PLAN, false, false)).toBeUndefined()
    expect(startBlock(SCRIPTED_PLAN, true, false)).toBeUndefined()
  })
  it("writes the estimate as the engine gave it, or 'unknown'", () => {
    expect(estimateText(PLAN)).toBe("about $1.80")
    expect(estimateText(SCRIPTED_PLAN)).toBe("unknown")
  })
  it.each([["maxUsd", "maxUsd"], ["limits.maxUsd", "maxUsd"], ["limits.maxMinutes", "maxMinutes"], ["maxRounds", "maxRounds"], ["agents", "agents"], ["confirm", "confirm"], ["effort", "effort"]] as const)("a refusal about %s goes next to %s", (field, control) => {
    expect(controlOf(field)).toBe(control)
  })
  it("a refusal about anything else goes under the card", () => {
    expect(controlOf(undefined)).toBeUndefined()
    expect(controlOf("token")).toBeUndefined()
    expect(controlOf("brief")).toBeUndefined()
  })
})

describe("the conversation of a session", () => {
  it("is saved and read back", () => {
    saveTurns(turns)
    expect(loadTurns()).toEqual(turns)
    expect(localStorage.length).toBe(0) // the session only
    saveTurns([])
    expect(sessionStorage.getItem("home.chat")).toBeNull()
  })
  it("drops what it cannot read", () => {
    sessionStorage.setItem("home.chat", "not json")
    expect(loadTurns()).toEqual([])
    sessionStorage.setItem("home.chat", JSON.stringify([{ id: 1, role: "user", content: "ok" }, { id: 2, role: "assistant", content: "x" }, { id: 3, role: "assistant", content: "x", reply: { reply: "x", mode: "magic" } }, null, 7]))
    expect(loadTurns()).toEqual([{ id: 1, role: "user", content: "ok" }])
  })
})

describe("client", () => {
  it("POSTs the conversation and keeps only what it can read of the reply", async () => {
    const sent = routes({ "POST /api/chat": { status: 200, body: { reply: "hi", mode: "scripted", note: "", runs: [{ kind: "board", id: "a", title: "t", why: "w" }, { kind: "other" }], plan: { id: 1 }, extra: true } } })
    expect(await sendChat({ messages: [{ role: "user", content: "q" }] })).toEqual({ reply: "hi", mode: "scripted" })
    expect(sent[0]).toMatchObject({ method: "POST", body: { messages: [{ role: "user", content: "q" }] } })
  })
  it("keeps note, runs and a whole plan", async () => {
    routes({ "POST /api/chat": reply({ note: "n", runs: [{ kind: "swarm", id: "a", title: "t", why: "w" }], plan: PLAN }) })
    expect(await sendChat({ messages: [] })).toMatchObject({ note: "n", runs: [{ id: "a" }], plan: { id: "plan-1" } })
  })
  it.each([[{ reply: 5, mode: "ai" }], [{ reply: "x", mode: "other" }], [null], ["text"]])("refuses a 200 that is not a reply: %j", async (body) => {
    routes({ "POST /api/chat": { status: 200, body } })
    await expect(sendChat({ messages: [] })).rejects.toMatchObject({ message: "The engine sent a reply this page cannot read." })
  })
  it("carries status and field of a refusal", async () => {
    routes({ "POST /api/chat": { status: 400, body: { error: "unknown model", field: "model" } } })
    await expect(sendChat({ messages: [] })).rejects.toMatchObject({ status: 400, field: "model", message: "unknown model" })
    await expect(getCatalog()).rejects.toBeInstanceOf(ChatRefused) // no route: like an engine that is down
  })
  it("starts a plan at its own route", async () => {
    const sent = routes({ "POST /api/chat/plans/plan%201/start": { status: 201, body: { kind: "board", id: "run-9" } } })
    expect(await startPlan("plan 1", { confirm: true, effort: "quick" })).toEqual({ kind: "board", id: "run-9" })
    expect(sent[0].body).toEqual({ confirm: true, effort: "quick" })
  })
  it("on 409 carries the run the plan already started, when the engine names it", async () => {
    routes({ "POST /api/chat/plans/p/start": { status: 409, body: { error: "already started", id: "run-3" } } })
    await expect(startPlan("p", { confirm: true })).rejects.toMatchObject({ status: 409, run: "run-3" })
  })
  it("refuses a catalog it cannot read", async () => {
    routes({ "GET /api/chat/catalog": { status: 200, body: { paidCalls: "no" } } })
    await expect(getCatalog()).rejects.toMatchObject({ message: "The engine sent a catalog this page cannot read." })
  })
})

describe("can a board review use real models?", () => {
  const live = { mock: true, paidCalls: false, keys: { ANTHROPIC_API_KEY: true, OPENAI_API_KEY: true }, models: { lead: "anthropic/claude-sonnet-5-5", rival: "openai/gpt-5-mini" } }
  it("names the key a board model needs", () => {
    expect(keyOfModel("anthropic/claude-sonnet-5-5")).toBe("ANTHROPIC_API_KEY")
    expect(keyOfModel("openai/gpt-5-mini")).toBe("OPENAI_API_KEY")
    expect(keyOfModel("~anthropic/claude-opus-latest")).toBeUndefined() // no aliases any more
    expect(keyOfModel("ollama/qwen2.5:14b")).toBeUndefined()
  })
  it("a missing key comes before the paid switch: turning paid calls on would not be enough", () => {
    expect(boardScriptedWhy({ ...live, keys: { ANTHROPIC_API_KEY: false, OPENAI_API_KEY: true } })).toBe("Anthropic key missing: board reviews are practice runs only")
  })
  it("says paid calls are off when every key is there", () => {
    expect(boardScriptedWhy(live, [{ id: "anthropic", keyPresent: true }, { id: "openai", keyPresent: true }])).toBe("Demo mode: reviews are practice runs only")
  })
  it("says nothing when the board can use real models", () => {
    expect(boardScriptedWhy({ ...live, mock: false, paidCalls: true })).toBeUndefined()
    expect(boardScriptedWhy({ mock: true, paidCalls: true, keys: {}, models: {} })).toBe("The engine is in practice mode: board reviews are practice runs only")
  })
})
