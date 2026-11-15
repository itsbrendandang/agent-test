// One wording for a practice run, in every view that shows runs: Home (the "What was checked" strip), Runs, Compare
// and Board. (The Graph view has the same check in its own tests.) Also: the Compare view's role-by-role conversation.
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Checked } from "@/home/Checked"
import { forgetScripted } from "@/lib/scripted"
import { PRACTICE } from "@/lib/words"
import { PAID_OFF, routes } from "@/test/engine"
import { BoardView } from "./BoardView"
import { ExperimentsView } from "./ExperimentsView"
import { SwarmView } from "./SwarmView"

const streams: { url: string; onmessage?: (m: { data: string }) => void; close: () => void }[] = []
beforeEach(() => {
  streams.length = 0; forgetScripted()
  vi.stubGlobal("EventSource", class { url: string; onmessage?: (m: { data: string }) => void; constructor(url: string) { this.url = url; streams.push(this) } close() {} })
})
const emit = (event: object) => act(() => { for (const s of streams) s.onmessage?.({ data: JSON.stringify({ key: JSON.stringify(event), at: 0, ...event }) }) })
const sse = (event: object) => `data: ${JSON.stringify({ key: "k", at: 0, ...event })}\n\n`

const RUN = { id: "s-mock", mode: "local", task: "demo", solver: "glhf", model: "mock", roleModels: {}, phase: "done", startedAt: Date.now() - 60_000, finishedAt: Date.now() - 43_000, score: 1, settings: { timeLimit: 1800 } }
const LEDGER = {
  alpha: 0.1, kappa: 1, issues: [],
  claims: [
    { id: "C1", text: "Counts are complete", artifact_ids: [], proposed_by: "proposer", null_hypothesis: "rows are missing", tests: [{ name: "row count", p_value: 0.001, contradicts: false, note: "", by: "critic", e_value: 20 }], replication_failed: false, e_value: 20, verdict: "supported" },
    { id: "C2", text: "The first pass is complete", artifact_ids: [], proposed_by: "proposer", null_hypothesis: "it is not", tests: [{ name: "header only", p_value: 0.01, contradicts: true, note: "", by: "critic", e_value: 0.5 }], replication_failed: false, e_value: 0.5, verdict: "refuted" },
  ],
  events: [
    { kind: "phase.started", phase: "scout" }, { kind: "phase.finished", phase: "scout" },
    { kind: "phase.started", phase: "propose" }, { kind: "claim.added", claim: "C1", text: "Counts are complete" }, { kind: "claim.added", claim: "C2", text: "The first pass is complete" },
    { kind: "phase.started", phase: "critique-1" }, { kind: "test.recorded", claim: "C2", name: "header only", p: 0.01, contradicts: true, verdict: "refuted" },
  ],
}
const SCORES = [{ task: "demo", model: "mock", timeLimit: 1800, maxTokens: 1000, diff: 0, swarm: { id: "s-mock", score: 1, extras: [] }, single: { id: "x-mock", score: 1, extras: [] } }]

describe("a practice run says so, in the same words, wherever it is shown", () => {
  it("Home: the latest review and the latest pair of runs", async () => {
    routes({ "GET /api/runs": { status: 200, body: [{ id: "r1", brief: "kras.md", rounds: 1, startedAt: 1, status: "done", claims: 1 }] }, "GET /api/glhf/scoreboard": { status: 200, body: SCORES } })
    render(<Checked onOpen={() => {}} />)
    const review = await screen.findByRole("button", { name: /Latest review/ })
    await waitFor(() => expect(streams.length).toBeGreaterThan(0))
    await emit({ type: "run.started", runId: "r1", brief: "kras", title: "KRAS", mock: true })
    expect(review).toHaveTextContent(PRACTICE)
    expect(screen.getByRole("button", { name: /One agent or a team/ })).toHaveTextContent(PRACTICE)
  })
  it("Runs: each card", async () => {
    routes({
      "GET /api/search": { status: 200, body: [{ kind: "swarm", id: "s-mock", title: "Task demo", status: "done", startedAt: 4, score: 1, matches: [] }, { kind: "board", id: "b-mock", title: "kras", status: "done", startedAt: 1, matches: [] }] },
      "GET /api/glhf/runs": { status: 200, body: [RUN] },
    })
    const plain = globalThis.fetch
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => (/\/api\/runs\/b-mock\/events$/.test(String(url))
      ? Promise.resolve(new Response(sse({ type: "run.started", runId: "b-mock", brief: "kras", title: "KRAS", mock: true }), { status: 200 })) : plain(url, init))))
    render(<ExperimentsView onOpen={() => {}} />)
    for (const id of ["s-mock", "b-mock"]) await waitFor(async () => expect((await screen.findByText(id)).closest("button")).toHaveTextContent(PRACTICE))
  })
  it("Board: the review on screen", async () => {
    routes({
      "GET /api/status": { status: 200, body: { mock: false, paidCalls: true, keys: {}, meeting: { max_minutes: 15, max_usd: 5, max_rounds: 4 } } }, "GET /api/roster": { status: 200, body: [] },
      "GET /api/briefs": { status: 200, body: [] }, "GET /api/runs": { status: 200, body: [{ id: "r1", brief: "kras.md", rounds: 1, startedAt: 1, status: "done", claims: 0 }] },
    })
    render(<BoardView />)
    await waitFor(() => expect(streams.length).toBeGreaterThan(0))
    await emit({ type: "run.started", runId: "r1", brief: "kras", title: "KRAS", mock: true })
    expect(within(screen.getByTestId("run-mode")).getByText(PRACTICE)).toBeInTheDocument()
  })
  const compare = () => {
    routes({ "GET /api/glhf/status": { status: 200, body: PAID_OFF }, "GET /api/glhf/runs": { status: 200, body: [RUN] }, "GET /api/glhf/scoreboard": { status: 200, body: SCORES },
      "GET /api/glhf/runs/s-mock": { status: 200, body: { run: RUN, ledger: LEDGER, findings: null, methods: null } } })
    return render(<SwarmView />)
  }
  it("Compare: the run on screen, and its score is not the headline", async () => {
    compare()
    const story = within(await screen.findByRole("region", { name: "Run" }))
    await waitFor(() => expect(story.getByText(new RegExp(PRACTICE))).toBeInTheDocument())
    expect(story.getByRole("status")).toHaveTextContent("The team finished this practice run. Its score, 1.000 out of 1, is not a research result.")
    expect(story.getByText(/took 17 seconds · 30-minute limit · cost nothing \(practice run\)/)).toBeInTheDocument()
  })
  it("Compare: the work reads as a conversation, one entry per role, and a failed test marks its step", async () => {
    compare()
    const talk = within(await screen.findByRole("region", { name: "What each role did" }))
    await waitFor(() => expect(talk.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(["Scout", "Proposer", "Critic, round 1"]))
    expect(within(talk.getByRole("article", { name: "Scout" })).getByText("Inspects the data and the tools before anyone plans")).toBeInTheDocument()
    expect(talk.getByRole("article", { name: "Scout" })).toHaveTextContent("Did its part. It added nothing to the team's shared notes.") // never an empty message
    const proposer = talk.getByRole("article", { name: "Proposer" })
    expect(within(proposer).getByText("Holds up")).toBeInTheDocument()
    expect(within(proposer).getByText("Proven wrong")).toBeInTheDocument()
    expect(proposer).toHaveAttribute("data-wrong", "true")
    const critic = talk.getByRole("article", { name: "Critic, round 1" })
    expect(critic).toHaveTextContent("Tested C2 and the result went against it.")
    expect(critic).toHaveAttribute("data-wrong", "true")
    await userEvent.setup().click(within(proposer).getByRole("button", { name: /Statement 2: Proven wrong/ }))
    expect(proposer).toHaveTextContent("WhyA test's result went against it.")
    expect(proposer).toHaveTextContent("Checked bycode, from the results of the team's own tests")
  })
})
