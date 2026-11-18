import { describe, expect, it } from "vitest"
import { engine } from "@/test/engine"
import { cancelRun, isDemo, isLive, Refused, settled, startRun, type GlhfPhase, type GlhfRun } from "./api"

const run = (over: Partial<GlhfRun>): GlhfRun => ({ id: "r", mode: "local", task: "demo", solver: "glhf", model: "mock", roleModels: {}, phase: "done", startedAt: 0, ...over })

describe("settled and isLive", () => {
  const all: GlhfPhase[] = ["queued", "launching", "running", "completing", "done", "failed", "cancelled"]
  it("treats done, failed and cancelled as settled", () => {
    expect(all.filter(settled)).toEqual(["done", "failed", "cancelled"])
  })
  it("treats every other phase as live, the queue included", () => {
    expect(all.filter((phase) => isLive(run({ phase })))).toEqual(["queued", "launching", "running", "completing"])
  })
  it("never calls a cancelled run live (a view would poll it every 2 seconds for ever)", () => {
    expect(isLive(run({ phase: "cancelled" }))).toBe(false)
  })
})

describe("isDemo", () => {
  it("is true for the demo case or the scripted model: neither is a benchmark result", () => {
    expect(isDemo(run({ task: "demo", model: "anthropic/claude-sonnet-5-5" }))).toBe(true)
    expect(isDemo(run({ task: "bix-12", model: "mock" }))).toBe(true)
    expect(isDemo(run({ task: "bix-12", model: "anthropic/claude-sonnet-5-5" }))).toBe(false)
  })
})

describe("startRun", () => {
  const body = { mode: "local", task: "demo", model: "mock", solver: "glhf", timeLimit: 1800 } as const
  it("posts the body as JSON and returns the ids in order", async () => {
    const sent = engine({ status: 201, body: { id: "a", ids: ["a", "b"] } })
    await expect(startRun({ ...body, solver: undefined, solvers: ["glhf", "single"] })).resolves.toEqual(["a", "b"])
    expect(sent).toHaveLength(1)
    expect(sent[0].method).toBe("POST")
    expect(sent[0].url).toMatch(/\/api\/glhf\/runs$/)
    expect(sent[0].body).toMatchObject({ solvers: ["glhf", "single"], model: "mock" })
  })
  it("accepts an older reply with only id", async () => {
    engine({ status: 201, body: { id: "a" } })
    await expect(startRun(body)).resolves.toEqual(["a"])
  })
  it("carries the field of a 400", async () => {
    engine({ status: 400, body: { error: "seed must be a whole number from 1 to 2147483647", field: "seed" } })
    const no = await startRun(body).catch((e: unknown) => e)
    expect(no).toBeInstanceOf(Refused)
    expect(no).toMatchObject({ status: 400, field: "seed", message: "seed must be a whole number from 1 to 2147483647" })
  })
  it("carries the run in the way of a 409", async () => {
    engine({ status: 409, body: { error: "a local run is still going (x)", run: "x" } })
    await expect(startRun(body)).rejects.toMatchObject({ status: 409, run: "x", field: undefined })
  })
  it("says so when the engine cannot be reached or answers without JSON", async () => {
    await expect(startRun(body)).rejects.toMatchObject({ status: 0, message: expect.stringContaining("engine isn't running. Start it with: npm start") })
    engine({ status: 502, body: "bad gateway" })
    await expect(startRun(body)).rejects.toMatchObject({ status: 502, message: "The engine answered 502." })
  })
  it("refuses a 2xx reply that names no run", async () => {
    engine({ status: 201, body: {} })
    await expect(startRun(body)).rejects.toBeInstanceOf(Refused)
  })
})

describe("cancelRun", () => {
  it("posts without a body to the run's cancel route", async () => {
    const sent = engine({ status: 200, body: run({ id: "a b", phase: "cancelled" }) })
    await expect(cancelRun("a b")).resolves.toMatchObject({ phase: "cancelled" })
    expect(sent[0]).toMatchObject({ method: "POST", body: undefined })
    expect(sent[0].url).toMatch(/\/api\/glhf\/runs\/a%20b\/cancel$/)
  })
  it("passes on the engine's text for a cloud run", async () => {
    engine({ status: 409, body: { error: "cloud runs are not cancelled from here. Run: uv run bixbench3 cancel --run r1" } })
    await expect(cancelRun("a")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("uv run bixbench3 cancel --run r1") })
  })
})
