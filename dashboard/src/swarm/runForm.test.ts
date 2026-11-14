import { describe, expect, it } from "vitest"
import { PAID_OFF, PAID_ON } from "@/test/engine"
import type { StartField } from "./api"
import { DEFAULTS, inputOf, minuteRange, missingKey, OTHER, paidOff, plan, whole, type FormValues } from "./runForm"

const form = (over: Partial<FormValues> = {}): FormValues => ({ ...DEFAULTS, ...over })

describe("defaults", () => {
  it("are the free scripted model on the swarm, with no extras", () => {
    expect(DEFAULTS).toMatchObject({ who: "glhf", choice: "mock", exa: false, memory: false, tokens: "", seed: "" })
    const p = plan(DEFAULTS, PAID_OFF)
    expect(p.errors).toEqual({})
    expect(p.real).toBe(false)
    expect(p.request).toEqual({ mode: "local", task: "demo", model: "mock", solver: "glhf", timeLimit: 1800, reviewRounds: 3 })
  })
})

describe("request body: one run", () => {
  it("single agent: no review rounds, Exa or memory, even when they were ticked", () => {
    const p = plan(form({ who: "single", exa: true, memory: true, rounds: "5" }), PAID_ON)
    expect(p.errors).toEqual({})
    expect(p.request).toEqual({ mode: "local", task: "demo", model: "mock", solver: "single", timeLimit: 1800 })
  })
  it("swarm: review rounds, and the extras that are ticked", () => {
    const p = plan(form({ rounds: "2", exa: true, memory: true, minutes: "10", tokens: "250000", seed: "7" }), PAID_ON)
    expect(p.request).toEqual({ mode: "local", task: "demo", model: "mock", solver: "glhf", timeLimit: 600, maxTokens: 250_000, seed: 7, reviewRounds: 2, exa: true, memory: true })
  })
  it("sends the time limit in seconds", () => {
    expect(plan(form({ minutes: "1" }), PAID_OFF).request.timeLimit).toBe(60)
    expect(plan(form({ minutes: "1440" }), PAID_OFF).request.timeLimit).toBe(86_400)
  })
  it("leaves out the token budget and the seed when they are empty", () => {
    const { request } = plan(form(), PAID_OFF)
    expect("maxTokens" in request).toBe(false)
    expect("seed" in request).toBe(false)
  })
  it("is always local, on the demo case", () => {
    for (const who of ["glhf", "single", "both"] as const) expect(plan(form({ who }), PAID_ON).request).toMatchObject({ mode: "local", task: "demo" })
  })
})

describe("request body: a pair", () => {
  it("is one request with both solvers, swarm first, and no `solver`", () => {
    const { request, errors } = plan(form({ who: "both", seed: "3", tokens: "5000" }), PAID_OFF)
    expect(errors).toEqual({})
    expect(request).toEqual({ mode: "local", task: "demo", model: "mock", solvers: ["glhf", "single"], timeLimit: 1800, maxTokens: 5000, seed: 3, reviewRounds: 3 })
    expect("solver" in request).toBe(false)
  })
  it("sends the swarm-only settings once; the engine applies them to the swarm only", () => {
    expect(plan(form({ who: "both", memory: true, exa: true }), PAID_ON).request).toMatchObject({ solvers: ["glhf", "single"], memory: true, exa: true, reviewRounds: 3 })
  })
})

describe("paid calls off", () => {
  it("is off only when the engine says false", () => {
    expect(paidOff(PAID_OFF)).toBe(true)
    expect(paidOff(PAID_ON)).toBe(false)
    expect(paidOff(undefined)).toBe(false)
    expect(paidOff({})).toBe(false)
  })
  it("runs the scripted model whatever model was chosen or typed before", () => {
    for (const v of [form({ choice: "anthropic/claude-sonnet-5-5" }), form({ choice: OTHER, custom: "openai/gpt-5.5" }), form({ choice: OTHER, custom: "" })]) {
      const p = plan(v, PAID_OFF)
      expect(p.model).toBe("mock")
      expect(p.real).toBe(false)
      expect(p.request.model).toBe("mock")
      expect(p.errors).toEqual({})
    }
  })
  it("never sends Exa, for one run or for a pair", () => {
    for (const who of ["glhf", "both"] as const) {
      const p = plan(form({ who, exa: true }), PAID_OFF)
      expect(p.exa).toBe(false)
      expect("exa" in p.request).toBe(false)
    }
  })
  it("still sends memory, which costs nothing", () => {
    expect(plan(form({ memory: true }), PAID_OFF).request.memory).toBe(true)
  })
  it("does not ask for a token budget, because nothing is spent", () => {
    expect(plan(form({ choice: "anthropic/claude-sonnet-5-5", tokens: "" }), PAID_OFF).errors.tokens).toBeUndefined()
  })
})

describe("paid calls on", () => {
  it("marks a listed or typed model as real", () => {
    expect(plan(form({ choice: "anthropic/claude-haiku-5-5", tokens: "1000" }), PAID_ON)).toMatchObject({ model: "anthropic/claude-haiku-5-5", real: true, errors: {} })
    expect(plan(form({ choice: OTHER, custom: "  openai/gpt-5.5  ", tokens: "1000" }), PAID_ON)).toMatchObject({ model: "openai/gpt-5.5", real: true, errors: {} })
    expect(plan(form(), PAID_ON).real).toBe(false)
  })
  it("refuses a real model without a token budget", () => {
    const p = plan(form({ choice: "anthropic/claude-sonnet-5-5" }), PAID_ON)
    expect(p.errors.tokens).toMatch(/needs a token budget/)
    expect(plan(form({ choice: "anthropic/claude-sonnet-5-5", tokens: "500000" }), PAID_ON).errors).toEqual({})
  })
  it("refuses an empty model id and one with spaces", () => {
    expect(plan(form({ choice: OTHER, custom: "  " }), PAID_ON).errors.model).toMatch(/Type a model id/)
    expect(plan(form({ choice: OTHER, custom: "bad model" }), PAID_ON).errors.model).toMatch(/no spaces/)
  })
  it("does not send Exa when the engine has no Exa key", () => {
    const noKey = { ...PAID_ON, keys: { ...PAID_ON.keys, EXA_API_KEY: false } }
    expect("exa" in plan(form({ exa: true }), noKey).request).toBe(false)
    expect(plan(form({ exa: true }), PAID_ON).request.exa).toBe(true)
  })
})

describe("validation against the engine's limits", () => {
  it.each([
    ["minutes", "0"], ["minutes", "1441"], ["minutes", "1.5"], ["minutes", ""], ["minutes", "abc"],
    ["tokens", "999"], ["tokens", "500000001"], ["tokens", "1e3.5"],
    ["rounds", "0"], ["rounds", "11"], ["rounds", ""],
    ["seed", "0"], ["seed", "-1"], ["seed", "2147483648"], ["seed", "1.5"],
  ] as const)("refuses %s = %j", (input, text) => {
    expect(plan(form({ [input]: text }), PAID_OFF).errors[input]).toMatch(/must be a whole number/)
  })
  it.each([
    ["minutes", "1"], ["minutes", "1440"], ["tokens", "1000"], ["tokens", "500000000"], ["rounds", "1"], ["rounds", "10"], ["seed", "1"], ["seed", "2147483647"],
  ] as const)("accepts %s = %j, the edge of the range", (input, text) => {
    expect(plan(form({ [input]: text }), PAID_OFF).errors).toEqual({})
  })
  it("names the range in the message", () => {
    expect(plan(form({ tokens: "5" }), PAID_OFF).errors.tokens).toBe("The token budget must be a whole number from 1,000 to 500,000,000.")
    expect(plan(form({ minutes: "0" }), PAID_OFF).errors.minutes).toBe("The time limit must be a whole number from 1 to 1,440.")
  })
  it("does not check review rounds for a single agent, which has none", () => {
    expect(plan(form({ who: "single", rounds: "99" }), PAID_OFF).errors).toEqual({})
  })
  it("reports every wrong input at once", () => {
    expect(Object.keys(plan(form({ minutes: "0", tokens: "1", rounds: "0", seed: "0" }), PAID_OFF).errors).sort()).toEqual(["minutes", "rounds", "seed", "tokens"])
  })
  it("without published limits (older engine) only asks for whole numbers of 1 or more; the engine decides the rest", () => {
    const old = { ...PAID_ON, limits: undefined }
    expect(plan(form({ minutes: "99999", tokens: "5", rounds: "50", seed: "99999999999" }), old).errors).toEqual({})
    expect(plan(form({ minutes: "0" }), old).errors.minutes).toBe("The time limit must be a whole number.")
    expect(plan(form({ minutes: "30" }), undefined).errors).toEqual({})
  })
})

describe("whole", () => {
  it("returns the number, or a sentence that says what is wrong", () => {
    expect(whole("12", "X")).toBe(12)
    expect(whole(" 12 ", "X")).toBe(12)
    expect(whole("12", "X", [1, 10])).toBe("X must be a whole number from 1 to 10.")
    expect(whole("", "X")).toBe("X must be a whole number.")
    expect(whole("1.2", "X")).toBe("X must be a whole number.")
  })
})

describe("minuteRange", () => {
  it("turns the engine's seconds into minutes, rounding inwards", () => {
    expect(minuteRange(PAID_OFF)).toEqual([1, 1440])
    expect(minuteRange({ ...PAID_OFF, limits: { ...PAID_OFF.limits!, timeLimit: [90, 3_630] } })).toEqual([2, 60])
    expect(minuteRange(undefined)).toBeUndefined()
  })
})

describe("refusal to field: where an engine message is shown", () => {
  it.each([
    ["solver", "who"], ["model", "model"], ["timeLimit", "minutes"], ["maxTokens", "tokens"], ["reviewRounds", "rounds"], ["seed", "seed"], ["exa", "exa"], ["memory", "memory"],
  ] as const)("%s goes next to the %s input", (field, input) => {
    expect(inputOf(field)).toBe(input)
  })
  it.each(["mode", "caseDir", "maxMessagesPerRole"] as const)("%s has no input, so it goes under the form", (field) => {
    expect(inputOf(field)).toBeUndefined()
  })
  it("a refusal without a field, or with a field this form does not know, goes under the form", () => {
    expect(inputOf(undefined)).toBeUndefined()
    expect(inputOf("somethingNew" as StartField)).toBeUndefined()
  })
})

describe("missingKey", () => {
  const none = { ...PAID_ON.keys, ANTHROPIC_API_KEY: false, OPENAI_API_KEY: false }
  it("names the key a model needs when the engine does not have it", () => {
    expect(missingKey("anthropic/claude-sonnet-5-5", none)).toBe("ANTHROPIC_API_KEY")
    expect(missingKey("openai/gpt-5.5", none)).toBe("OPENAI_API_KEY")
  })
  it("says nothing for the scripted model, a set key, an unknown provider, or unknown keys", () => {
    expect(missingKey("mock", none)).toBeUndefined()
    expect(missingKey("anthropic/claude-sonnet-5-5", PAID_ON.keys)).toBeUndefined()
    expect(missingKey("mistral/large", none)).toBeUndefined()
    expect(missingKey("anthropic/claude-sonnet-5-5", undefined)).toBeUndefined()
  })
})
