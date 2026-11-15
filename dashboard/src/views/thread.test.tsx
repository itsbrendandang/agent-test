// Who said what, on the AI Elements Conversation and Message components: one message per team member, model text
// kept as text, the engine's own error text when it answers with an error, and the Agents filter.
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CheckedStatement, TeamMessage } from "@/components/Thread"
import { forgetScripted } from "@/lib/scripted"
import { inShort, safeUrl } from "@/lib/words"
import { routes } from "@/test/engine"
import { CATALOG_ON } from "@/test/home"
import { AgentsView } from "./AgentsView"
import { BoardView } from "./BoardView"

const streams: { url: string; onmessage?: (m: { data: string }) => void; close: () => void }[] = []
beforeEach(() => {
  streams.length = 0; forgetScripted()
  vi.stubGlobal("EventSource", class { url: string; onmessage?: (m: { data: string }) => void; constructor(url: string) { this.url = url; streams.push(this) } close() {} })
})
const emit = (event: object) => act(() => { for (const s of streams) s.onmessage?.({ data: JSON.stringify({ key: JSON.stringify(event), at: 0, ...event }) }) })

// The roster as the engine lists it now: the board members carry the swarm's role names.
const ROSTER = [
  { name: "lead-scientist", title: "Lead Scientist", role: "lead", model: "lead", modelId: "anthropic/claude-sonnet-5-5", tools: ["converse", "write_memo"] },
  { name: "scout", title: "Scout (Data Inspector)", role: "member", model: "cheap", modelId: "anthropic/claude-haiku-5-5", tools: [], deliverable: "A data report." },
  { name: "critic", title: "Critic (Scientific Reviewer)", role: "member", model: "rival", modelId: "openai/gpt-5-mini", tools: [], deliverable: "A list of problems." },
]
const board = (extra: Parameters<typeof routes>[0] = {}) => routes({
  "GET /api/status": { status: 200, body: { mock: true, paidCalls: false, keys: {}, meeting: { max_minutes: 15, max_usd: 5, max_rounds: 4 } } },
  "GET /api/roster": { status: 200, body: ROSTER }, "GET /api/briefs": { status: 200, body: ["kras.md"] },
  "GET /api/runs": { status: 200, body: [{ id: "run-1", brief: "kras.md", rounds: 1, startedAt: 1, status: "done", claims: 2 }] },
  "GET /api/runs/run-1/memo": { status: 200, body: "" }, ...extra,
})
const HOSTILE = 'The margin is thin. <img src=x onerror="window.__pwned=1"> <script>window.__pwned=1</script> [click](javascript:alert(1)) ![pic](https://evil.example/x.png) **bold**'

describe("the board's discussion", () => {
  const open = async () => {
    board(); localStorage.setItem("board.details", "1")
    const view = render(<BoardView />)
    await waitFor(() => expect(streams.length).toBeGreaterThan(0))
    await emit({ type: "run.started", runId: "run-1", brief: "kras", title: "KRAS", mock: true })
    await emit({ type: "round.started", round: 1, message: "State your position. Then give your evidence.", final: false })
    await emit({ type: "member.replied", round: 1, member: "scout", text: "The data has 12 samples. Two are missing a label, and one file is empty." })
    await emit({ type: "member.replied", round: 1, member: "critic", text: HOSTILE })
    await emit({ type: "claim.checked", round: 1, member: "scout", claim: "The data has 12 samples", kind: "brief", verdict: "verified", checker: "first-pass", checkedBy: "scripted", source: "brief", note: 'quoted: "12 samples"' })
    await emit({ type: "claim.checked", round: 1, member: "critic", claim: "The margin is thin", kind: "web", verdict: "contradicted", checker: "openai", source: "https://example.org/paper" })
    await emit({ type: "claim.checked", round: 1, member: "critic", claim: "Nobody tested it", kind: "web", verdict: "unsupported", checker: "first-pass", source: "javascript:alert(1)" })
    if (!screen.queryByRole("region", { name: "Discussion" })) await userEvent.setup().click(screen.getByRole("checkbox", { name: "Show the full discussion" }))
    return view
  }
  it("is one message per team member: name, plain job, the first sentence, the full reply folded, the checks under it", async () => {
    await open()
    const round = within(screen.getByRole("group", { name: "Round 1" }))
    expect(round.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(["Lead Scientist", "Scout", "Critic"]) // the roster's own names
    const scout = within(round.getByRole("article", { name: "Scout" }))
    expect(scout.getByText("Data Inspector")).toBeInTheDocument()
    expect(scout.getByText("In short").parentElement).toHaveTextContent("In short The data has 12 samples.")
    const full = scout.getByText("Read the full reply").closest("details")!
    expect(full).not.toHaveAttribute("open")
    expect(full).toHaveTextContent("Two are missing a label, and one file is empty.")
    const checks = within(scout.getByRole("list", { name: "What the checks found about Scout's statements" }))
    expect(checks.getByText("Holds up")).toHaveAttribute("title", "The check's own word: verified") // glyph plus plain word; the expert word stays reachable
    expect(checks.getByText(/Checked by the quick first check \(practice: no model\)/)).toBeInTheDocument()
    expect(checks.getByText("Source: brief")).toBeInTheDocument()
    const critic = within(round.getByRole("article", { name: "Critic" }))
    expect(critic.getByText("Proven wrong")).toBeInTheDocument()
    expect(critic.getByText("Not enough evidence")).toBeInTheDocument()
  })
  it("says in one sentence what happened", async () => {
    await open()
    await emit({ type: "run.finished", usd: 0, minutes: 1 })
    expect(screen.getByText(/The team has decided\./)).toHaveTextContent("2 team members made 3 statements: 1 held up, 1 was proven wrong, 1 had too little evidence.")
  })
  it("keeps everything a model wrote as text: no HTML, no script, no image, no link from its words", async () => {
    const { container } = await open()
    const critic = screen.getByRole("article", { name: "Critic" })
    expect(critic).toHaveTextContent('<img src=x onerror="window.__pwned=1">')
    expect(critic).toHaveTextContent("[click](javascript:alert(1))")
    expect(container.querySelector("img, script, iframe, object, embed")).toBeNull() // nothing is fetched from a model-supplied address
    expect((window as { __pwned?: number }).__pwned).toBeUndefined()
    const links = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"))
    expect(links.every((href) => !/^\s*(javascript|data|vbscript):/i.test(href ?? ""))).toBe(true)
    expect(within(critic).getByText("Source: javascript:alert(1)")).toBeInTheDocument() // shown, as text, not as a link
  })
})

describe("pieces", () => {
  it("only an http(s) source becomes a link, opened safely", async () => {
    expect(safeUrl("javascript:alert(1)")).toBeUndefined()
    expect(safeUrl("data:text/html,<script>1</script>")).toBeUndefined()
    expect(safeUrl("brief")).toBeUndefined()
    expect(safeUrl("https://example.org/a")).toBe("https://example.org/a")
    render(<ul><CheckedStatement verdict="verified" claim="c" source="https://example.org/a" /></ul>)
    await userEvent.setup().click(screen.getByRole("button", { name: "Source" }))
    const link = screen.getByRole("link")
    expect(link).toHaveAttribute("href", "https://example.org/a")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link.getAttribute("rel")).toMatch(/noreferrer/)
  })
  it("the first sentence is cut by code and never longer than the cap", () => {
    expect(inShort("Go.  Then stop.")).toBe("Go.")
    expect(inShort("No full stop here")).toBe("No full stop here")
    expect(inShort("x".repeat(400)).length).toBeLessThanOrEqual(240)
    expect(inShort("  ")).toBe("")
  })
  it("a one-sentence reply is not repeated in a fold", () => {
    render(<TeamMessage name="Scout" text="All files are present." />)
    expect(screen.getByText("In short").parentElement).toHaveTextContent("All files are present.")
    expect(screen.queryByText("Read the full reply")).toBeNull()
  })
})

describe("when the engine answers with an error", () => {
  it("shows the engine's own words, as text, and does not say the engine is not running", async () => {
    board({ "GET /api/roster": { status: 500, body: { error: 'agent "toxicologist" is not in the roster <b>now</b>' } } })
    const { container } = render(<BoardView />)
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("The engine answered with an error")
    expect(alert).toHaveTextContent('agent "toxicologist" is not in the roster <b>now</b> (HTTP 500)')
    expect(alert).toHaveTextContent("The engine is running")
    expect(alert).not.toHaveTextContent("Engine not running")
    expect(alert).not.toHaveTextContent("npm run engine")
    expect(container.querySelector("b")).toBeNull()
  })
  it("still says the engine is not running when it cannot be reached at all", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))))
    render(<BoardView />)
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Engine not running")
    expect(alert).toHaveTextContent("npm run engine")
  })
  it("an error without a message still gives the status", async () => {
    board({ "GET /api/status": { status: 502, body: "bad gateway" } })
    render(<BoardView />)
    expect(await screen.findByRole("alert")).toHaveTextContent("The engine answered 502 without saying why. (HTTP 502)")
  })
})

describe("Agents filter", () => {
  const agents = () => {
    routes({ "GET /api/chat/catalog": { status: 200, body: CATALOG_ON }, "GET /api/glhf/roles": { status: 200, body: { shared_rules: "", roles: [] } }, "GET /api/glhf/runs": { status: 200, body: [] }, "GET /api/glhf/status": { status: 200, body: {} }, "GET /api/glhf/scoreboard": { status: 200, body: [] } })
    return render(<AgentsView />)
  }
  it("has one filter box over the roles, the agents and the skills, and says how many are shown", async () => {
    const user = userEvent.setup()
    agents()
    const total = 9 + CATALOG_ON.agents.length + CATALOG_ON.skills.length
    const box = screen.getByRole("searchbox", { name: "Filter roles, agents and skills" })
    expect(await screen.findByText(`${total} of ${total} shown`)).toBeInTheDocument()
    await user.type(box, "toxicolog")
    expect(screen.getByText(`1 of ${total} shown`)).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Toxicologist" })).toBeInTheDocument()
    expect(screen.queryByText("1. Scout")).toBeNull()
    await user.clear(box); await user.type(box, "critic")
    expect(screen.getByText("6. Critic")).toBeInTheDocument() // the swarm role and the board member both match
    expect(screen.getByRole("heading", { name: "Critic (Scientific Reviewer)" })).toBeInTheDocument()
    await user.clear(box); await user.type(box, "zzzz")
    expect(screen.getByText(/Nothing matches “zzzz”/)).toBeInTheDocument()
    expect(screen.getByText(`0 of ${total} shown`)).toBeInTheDocument()
  })
})
