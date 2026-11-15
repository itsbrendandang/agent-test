// Benchmarks: the record is the engine's number, a practice run or the demo task is never shown as our score, and
// only a row the engine calls like-for-like is called a same-budget comparison.
import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { routes } from "@/test/engine"
import { Benchmarks } from "./Benchmarks"
import { modelFacts, plainConclusion, pricedByToken, record3Of, rowsOf, shortModel } from "./benchmarkNumbers"

const side = (correct: number, n: number, notGraded = 0) => ({ correct, n, accuracy: correct / n, notGraded, wilson95: [0.1, 0.3], tokens: n * 1000, seconds: 600, costUsd: 1.5, failedRuns: 0 })
const BOARD = [
  { model: "mock", questions: 8, likeForLike: true, single: side(0, 8), swarm: side(0, 8), conclusion: "Scripted mock model" },
  { model: "anthropic/claude-sonnet-5-5", questions: 8, likeForLike: true, single: side(4, 8), swarm: side(4, 8), conclusion: "Too few questions to conclude anything.", capsules: ["a", "b", "c"], gradingProfile: "per-mode", answerMode: "open", timeLimit: 1800, maxTokensTotal: 1120000 },
  { model: "openai-api/openmodels/Qwen/Qwen3.6-35B-A3B-FP8", questions: 82, likeForLike: true, single: side(15, 82, 42), swarm: side(19, 82), conclusion: "No difference detected." },
  { model: "x/one-sided", questions: 5, likeForLike: false, single: side(1, 5), swarm: { correct: null, n: null }, conclusion: "" },
  { model: "x/nothing", questions: 5, likeForLike: false, single: {}, swarm: {} },
]

describe("benchmark numbers", () => {
  it("keeps real-model rows only, the largest first, and calls a row fair only when the engine does and both sides ran", () => {
    const rows = rowsOf(BOARD)
    expect(rows.map((r) => [shortModel(r.model), r.questions, r.fair])).toEqual([["Qwen3.6-35B-A3B-FP8", 82, true], ["claude-sonnet-5-5", 8, true], ["one-sided", 5, false]])
    expect(rows[0].single).toMatchObject({ correct: 15, n: 82, notGraded: 42, interval: [0.1, 0.3], tokens: 82000, costUsd: 1.5 })
    expect([rows[1].datasets, rows[1].grading, rows[1].timeLimit, rows[1].tokenBudget]).toEqual([3, "per-mode", 1800, 1120000])
    expect([pricedByToken("anthropic/x"), pricedByToken("openai/y"), pricedByToken("openai-api/openmodels/Qwen/z"), pricedByToken("ollama/q")]).toEqual([true, true, false, false])
    expect(rows[2].team).toBeUndefined()
    expect(rowsOf("nonsense")).toEqual([])
  })
  it("counts as ours on BixBench3 only a finished run of a real model on a real task", () => {
    const runs = [
      { task: "demo", model: "anthropic/x", phase: "done", score: 1 }, // the demo task
      { task: "9", model: "mock", modelClass: "scripted", phase: "done", score: 1 }, // the practice model
      { task: "9", model: "anthropic/x", phase: "failed", score: 0.2 }, // did not finish
      { task: "9", model: "anthropic/x", phase: "done" }, // no score
    ]
    expect(record3Of({ record: 0.523 }, runs)).toEqual({ record: 0.523, realRuns: 0, best: undefined })
    expect(record3Of({ record: 0.523 }, [...runs, { task: "9", model: "anthropic/x", phase: "done", score: 0.41 }, { task: "3", model: "anthropic/x", phase: "done", score: 0.3 }])).toEqual({ record: 0.523, realRuns: 2, best: 0.41 })
    expect(record3Of(undefined, undefined)).toEqual({ record: undefined, realRuns: 0, best: undefined })
  })
})

describe("who made a model", () => {
  it("is read from the id without calling an OpenAI-style endpoint OpenAI", () => {
    expect(modelFacts("openai-api/openmodels/Qwen/Qwen3.6-35B-A3B-FP8")).toEqual({ name: "Qwen3.6-35B-A3B-FP8", servedBy: "open model (Alibaba), run on Modal" })
    expect(modelFacts("openai-api/lab/mistralai/Ministral")).toEqual({ name: "Ministral", servedBy: "open model (Mistral), run on our own endpoint (lab)" })
    expect(modelFacts("openai/gpt-5.5")).toEqual({ name: "gpt-5.5", servedBy: "OpenAI's own service" })
    expect(modelFacts("ollama/qwen2.5:14b")).toEqual({ name: "qwen2.5:14b", servedBy: "an open model, run on this computer" })
    expect(modelFacts("something-else")).toEqual({ name: "something-else", servedBy: "" })
  })
})

describe("the engine's sentence in the app's words", () => {
  it("names the team of nine, one agent and datasets, and changes no number", () => {
    expect(plainConclusion("No difference detected (+4.9 percentage points). The solvers are not shown equal: swarm minus single runs from -2.4 to +12.4. The 82 questions come from 20 capsules and questions of one capsule share data."))
      .toBe("No difference detected (+4.9 percentage points). The two are not shown equal: the team of nine minus one agent runs from -2.4 to +12.4. The 82 questions come from 20 datasets and questions of one dataset share data.")
  })
})

describe("the Benchmarks card", () => {
  it("shows the record, says we have no real BixBench3 run, and shows the v1.5 rows with their counts", async () => {
    routes({
      "GET /api/glhf/status": { status: 200, body: { record: 0.523 } },
      "GET /api/glhf/runs": { status: 200, body: [{ task: "demo", model: "mock", modelClass: "scripted", phase: "done", score: 1 }] },
      "GET /api/bixv1/scoreboard": { status: 200, body: BOARD },
    })
    render(<Benchmarks />)
    await waitFor(() => expect(screen.getByText("0.523")).toBeTruthy())
    expect(screen.queryByText("1.000")).toBeNull() // the practice run on the demo task is not a score
    await screen.findByText("Qwen3.6-35B-A3B-FP8")
    expect(screen.getByText("Ours: not known (no real run yet)")).toBeTruthy()
    const text = () => document.body.textContent ?? ""
    // Set out as an evaluation: the model's full id, the setup, and a row per solver.
    // An open model reached through an OpenAI-style endpoint is not OpenAI's, and is not shown as if it were.
    expect(text()).toContain("Qwen3.6-35B-A3B-FP8 · open model (Alibaba), run on Modal")
    expect(text()).not.toContain("openai-api")
    expect(text()).toContain("claude-sonnet-5-5 · Anthropic's own service")
    expect(text()).toContain("Like for like: both had the same token limit")
    expect(text()).toContain("Not like for like")
    expect(text()).toContain("our own rules per question type")
    expect(text()).toContain("30 minutes a run; 1,120,000 tokens in all for each")
    const tables = screen.getAllByRole("table")
    expect(tables[0].textContent).toMatch(/Solver.*Correct.*Accuracy.*95% interval.*Not graded.*Tokens.*Per question.*Time.*Cost/)
    // Qwen: 42 answers had no judge, so the accuracy is a lower bound and says so; its cost is not known.
    expect(tables[0].textContent).toContain("One agent15 of 82at least 18.3%10.0% to 30.0%4282,0001,00010 minNot known")
    expect(tables[0].textContent).toContain("Team of nine19 of 8223.2%")
    expect(text()).toContain("this model ran on rented GPUs")
    expect(text()).toContain("One agent: 42 of 82 answers were not graded")
    // A model sold by the token: the engine's estimate is shown as an estimate.
    expect(tables[1].textContent).toContain("One agent4 of 850.0%10.0% to 30.0%08,0001,00010 minabout $1.50")
    expect(text()).toContain("Cost is an estimate: tokens at assumed list prices, without the judge.")
    expect(tables[2].textContent).toContain("Team of nineNot run")
    expect(screen.queryByText(/Scripted mock model/)).toBeNull()
    expect(screen.getByText(/Not comparable with published BixBench numbers/)).toBeTruthy()
  })
  it("says so when there is no real-model run and no engine answer", async () => {
    routes({})
    render(<Benchmarks />)
    await screen.findByText("No run with a real model yet.")
    expect(screen.getByText("Ours: not known (no real run yet)")).toBeTruthy()
  })
})
