// One badge for a practice result, in every view that shows runs: Saved research, Compare and Team review. (The Graph view has the same check in its own tests.) Also: the Compare view's role-by-role conversation.
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { forgetScripted } from "@/lib/scripted"
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
/** The one badge every view shows on a practice result (components/Provenance.tsx). */
const practice = (el: HTMLElement) => expect(el.querySelector('[data-provenance="practice"]')).toHaveTextContent(/^Practice$/)
const SCORES = [{ task: "demo", model: "mock", timeLimit: 1800, maxTokens: 1000, diff: 0, swarm: { id: "s-mock", score: 1, extras: [] }, single: { id: "x-mock", score: 1, extras: [] } }]

describe("a practice run says so, in the same words, wherever it is shown", () => {
  it("Runs: each card", async () => {
    routes({
      "GET /api/search": { status: 200, body: [{ kind: "swarm", id: "s-mock", title: "Task demo", status: "done", startedAt: 4, score: 1, matches: [] }, { kind: "board", id: "b-mock", title: "kras", status: "done", startedAt: 1, matches: [] }] },
      "GET /api/glhf/runs": { status: 200, body: [RUN] },
    })
    const plain = globalThis.fetch
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => (/\/api\/runs\/b-mock\/events$/.test(String(url))
      ? Promise.resolve(new Response(sse({ type: "run.started", runId: "b-mock", brief: "kras", title: "KRAS", mock: true }), { status: 200 })) : plain(url, init))))
    render(<ExperimentsView onOpen={() => {}} />)
    for (const id of ["s-mock", "b-mock"]) await waitFor(() => practice(document.querySelector<HTMLElement>(`li[data-record$=":${id}"]`)!))
  })
  it("Board: the review on screen", async () => {
    routes({
      "GET /api/status": { status: 200, body: { mock: false, paidCalls: true, keys: {}, meeting: { max_minutes: 15, max_usd: 5, max_rounds: 4 } } }, "GET /api/roster": { status: 200, body: [] },
      "GET /api/briefs": { status: 200, body: [] }, "GET /api/runs": { status: 200, body: [{ id: "r1", brief: "kras.md", rounds: 1, startedAt: 1, status: "done", claims: 0 }] },
    })
    render(<BoardView />)
    await waitFor(() => expect(streams.length).toBeGreaterThan(0))
    await emit({ type: "run.started", runId: "r1", brief: "kras", title: "KRAS", mock: true })
    practice(screen.getByTestId("run-mode"))
  })
  const compare = () => {
    routes({ "GET /api/glhf/status": { status: 200, body: PAID_OFF }, "GET /api/glhf/runs": { status: 200, body: [RUN] }, "GET /api/glhf/scoreboard": { status: 200, body: SCORES },
      "GET /api/glhf/runs/s-mock": { status: 200, body: { run: RUN, ledger: LEDGER, findings: null, methods: null } } })
    return render(<SwarmView />)
  }
  it("Compare: the run on screen, and its score is not the headline", async () => {
    compare()
    const story = within(await screen.findByRole("region", { name: "Run" }))
    await waitFor(() => practice(story.getByTestId("run-mode")))
    expect(story.getByTestId("run-mode")).toHaveTextContent("Demo task") // the made-up dataset is said too
    expect(story.getByRole("status")).toHaveTextContent(/^The team finished this practice run\. It is not a research result\.$/)
    const whole = (await screen.findByRole("region", { name: "Run" })).textContent!
    expect((whole.match(/1\.000/g) ?? []).length).toBe(1) // the score is said once, in the result, not in the headline too
    expect((whole.match(/not a research result/g) ?? []).length).toBe(1)
    expect(within(story.getByRole("group", { name: "Result" })).getByText("1.000")).toBeInTheDocument()
    expect(story.getByText(/took 17 seconds · 30-minute limit · cost nothing \(practice run\)/)).toBeInTheDocument()
  })
  it("Compare: says once why most roles did not run, hides a row of zeros, and keeps run ids out of the text", async () => {
    const pair = { ...RUN, id: "202611142330-demo-glhf", pairedWith: "202611142330-demo-single" }
    const single = { ...RUN, id: "202611142330-demo-single", solver: "single", pairedWith: pair.id, after: pair.id }
    const ledger = (events: object[], claims: object[] = []) => ({ alpha: 0.1, kappa: 1, issues: [], claims, events })
    const skippedByPlan = ["scout", "pilot", "audit 1"].map((phase) => ({ kind: "phase.skipped", phase, reason: "plan", mode: "degraded" }))
    const show = (events: object[]) => {
      routes({ "GET /api/glhf/status": { status: 200, body: PAID_OFF }, "GET /api/glhf/runs": { status: 200, body: [pair, single] }, "GET /api/glhf/scoreboard": { status: 200, body: [] },
        [`GET /api/glhf/runs/${pair.id}`]: { status: 200, body: { run: pair, ledger: ledger(events), findings: null, methods: null } } })
      return render(<SwarmView />)
    }
    const first = show([{ kind: "phase.started", phase: "propose" }, { kind: "phase.started", phase: "experiment" }, ...skippedByPlan, { kind: "phase.skipped", phase: "critique 1", reason: "time", seconds: 4 }, { kind: "phase.started", phase: "report" }])
    const run = await screen.findByRole("region", { name: "Run" })
    // the reasons are the record's own (phase.skipped), in plain words; roles with no recorded reason are said to have none
    await waitFor(() => expect(within(run).getByTestId("not-run-why")).toHaveTextContent("Did not run: Scout (left out of this run's plan); Pilot (left out of this run's plan); Auditor (left out of this run's plan); Critic (too little time was left); the record gives no reason for the others."))
    // no statements: one plain line, not "0 supported, 0 contradicted…"
    expect(within(run).getByTestId("tested-count")).toHaveTextContent(/^No statements were tested in this run\.$/)
    expect(run).not.toHaveTextContent(/0 supported|0 contradicted|0 problems/)
    // the partner is named by what it is; its id is a tooltip, never text
    const link = within(run).getByRole("button", { name: "the one-agent run" })
    expect(link).toHaveAttribute("title", "Run id: 202611142330-demo-single")
    expect(run).toHaveTextContent("Paired with the one-agent run · same task, model, time limit, token limit and seed")
    expect(run.textContent).not.toMatch(/2026\d{8}-demo|text limit|swarm|glhf|mock/i)
    expect(within(run).getByRole("combobox", { name: "Run to show" })).toHaveTextContent("Team of nine on the demo task")
    expect(within(run).getByRole("combobox", { name: "Run to show" })).toHaveTextContent("One agent on the demo task")
    first.unmount()
    show([{ kind: "phase.started", phase: "propose" }, { kind: "phase.started", phase: "report" }])
    await waitFor(() => expect(screen.getByTestId("not-run-why")).toHaveTextContent(/^Only these roles ran in this run\.$/)) // nothing recorded: no invented reason
  })
  it("Compare: the work reads as a conversation, one entry per role, and a failed test marks its step", async () => {
    compare()
    const talk = within(await screen.findByRole("region", { name: "What each role did" }))
    await waitFor(() => expect(talk.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(["Scout", "Proposer", "Critic, round 1"]))
    expect(within(talk.getByRole("article", { name: "Scout" })).getByText("Inspects the data and the tools before anyone plans")).toBeInTheDocument()
    expect(talk.getByRole("article", { name: "Scout" })).toHaveTextContent("Did its part. It added nothing to the team's shared notes.") // never an empty message
    const proposer = talk.getByRole("article", { name: "Proposer" })
    expect(within(proposer).getByText(/^(Holds up|Supported)$/)).toBeInTheDocument()
    expect(within(proposer).getByText(/^(Proven wrong|Contradicted)$/)).toBeInTheDocument()
    expect(proposer).toHaveAttribute("data-wrong", "true")
    const critic = talk.getByRole("article", { name: "Critic, round 1" })
    expect(critic).toHaveTextContent("Tested C2 and the result went against it.")
    expect(critic).toHaveAttribute("data-wrong", "true")
    await userEvent.setup().click(within(proposer).getByRole("button", { name: /Statement 2: Contradicted/ }))
    expect(proposer).toHaveTextContent("WhyA test's result went against it.")
    expect(proposer).toHaveTextContent("Checked bycode, from the results of the team's own tests")
  })
  it("Compare: a run whose analyses ran on Modal says so, for each test and in its settings", async () => {
    const run = { ...RUN, settings: { timeLimit: 1800, analysisBackend: "modal" }, modal: { usd: 0.0123, sandboxes: 1, maxUsd: 2 } }
    const ledger = { ...LEDGER, events: [...LEDGER.events, { kind: "test.executed", claim: "C2", name: "header only", status: "ok", backend: "modal", sandbox_id: "sb-1" }] }
    routes({ "GET /api/glhf/status": { status: 200, body: PAID_OFF }, "GET /api/glhf/runs": { status: 200, body: [run] }, "GET /api/glhf/scoreboard": { status: 200, body: SCORES },
      "GET /api/glhf/runs/s-mock": { status: 200, body: { run, ledger, findings: null, methods: null } } })
    render(<SwarmView />)
    const story = within(await screen.findByRole("region", { name: "Run" }))
    await waitFor(() => expect(story.getByTestId("run-analyses")).toHaveTextContent("analyses on Modal"))
    expect(story.queryByText(/cost nothing/)).toBeNull() // Modal bills a practice run too
    const talk = within(await screen.findByRole("region", { name: "What each role did" }))
    expect(talk.getByRole("article", { name: "Critic, round 1" })).toHaveTextContent("Ran the test of C2 (header only) in a Modal sandbox (sb-1): it gave a result.")
    await userEvent.setup().click(screen.getByRole("button", { name: "See how each statement was tested" }))
    const settings = document.querySelector(".swarm-settings")!
    expect(settings).toHaveTextContent("Analyses ranin a Modal sandbox (billed by Modal)")
    expect(settings).toHaveTextContent("Modal cost$0.0123 for 1 sandbox (cap $2; Modal's bill is the authority)")
    localStorage.removeItem("swarm.details") // the button remembers itself; the next test starts closed
  })
})
