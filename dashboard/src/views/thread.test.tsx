// Who said what, on the AI Elements Conversation and Message components: one message per team member, model text
// kept as text, the engine's own error text when it answers with an error, and the Agents filter.
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TeamMessage } from "@/components/Thread"
import { plainCost, plainDuration, plainLimit, plainTitle, plainWhen, runTitle } from "@/lib/format"
import { forgetScripted } from "@/lib/scripted"
import { inShort, safeUrl, splitReply } from "@/lib/words"
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
    board()
    const view = render(<BoardView />)
    await waitFor(() => expect(streams.length).toBeGreaterThan(0))
    await emit({ type: "run.started", runId: "run-1", brief: "kras", title: "KRAS", mock: true })
    await emit({ type: "round.started", round: 1, message: "State your position. Then give your evidence.", final: false })
    await emit({ type: "member.replied", round: 1, member: "scout", text: "The data has 12 samples. Two are missing a label, and one file is empty." })
    await emit({ type: "member.replied", round: 1, member: "critic", text: HOSTILE })
    await emit({ type: "claim.checked", round: 1, member: "scout", claim: "The data has 12 samples", kind: "brief", verdict: "verified", checker: "first-pass", checkedBy: "scripted", source: "brief", note: 'quoted: "12 samples"' })
    await emit({ type: "claim.checked", round: 1, member: "critic", claim: "The margin is thin", kind: "web", verdict: "contradicted", checker: "openai", source: "https://example.org/paper" })
    await emit({ type: "claim.checked", round: 1, member: "critic", claim: "Nobody tested it", kind: "web", verdict: "unsupported", checker: "first-pass", source: "javascript:alert(1)" })
    return view
  }
  it("reads like a group chat: who speaks, their plain job, one sentence, the full reply folded, a chip per statement", async () => {
    await open()
    const round = within(screen.getByRole("group", { name: "Round 1" }))
    expect(round.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(["Lead Scientist", "Scout", "Critic"]) // in the order they spoke
    const scout = within(round.getByRole("article", { name: "Scout" }))
    expect(scout.getByText("looks at the data before any research begins")).toBeInTheDocument()
    expect(within(round.getByRole("article", { name: "Critic" })).getByText("tries to prove the others wrong")).toBeInTheDocument()
    expect(scout.getByText("The data has 12 samples.")).toHaveClass("thread-short") // no "In short" line in this reply: its first sentence
    const full = scout.getByText("Show full reply").closest("details")!
    expect(full).not.toHaveAttribute("open")
    expect(full).toHaveTextContent("Two are missing a label, and one file is empty.")
    const chips = within(scout.getByRole("group", { name: "What the checks found about Scout's statements" }))
    expect(chips.getByText("Holds up")).toHaveAttribute("title", "The check's own word: verified") // glyph plus plain word; the expert word stays reachable
  })
  it("a chip opens the statement, the source and why it got that result", async () => {
    await open()
    const user = userEvent.setup()
    const scout = within(screen.getByRole("article", { name: "Scout" }))
    expect(scout.queryByText("The statement")).toBeNull()
    const chip = scout.getByRole("button", { name: /Statement 1: Holds up/ })
    await user.click(chip)
    expect(chip).toHaveAttribute("aria-expanded", "true")
    const detail = scout.getByText("The statement").closest("dl")!
    expect(detail).toHaveTextContent("The statementThe data has 12 samples")
    expect(detail).toHaveTextContent('Whyquoted: "12 samples"')
    expect(detail).toHaveTextContent("Checked bythe quick first check (practice: no model)")
    expect(detail).toHaveTextContent("Sourcethe brief (the question and data the team was given)")
    expect(within(detail).getByText("verified")).toBeInTheDocument() // the expert word, as the small second text
    await user.click(chip)
    expect(scout.queryByText("The statement")).toBeNull()
  })
  it("marks the moment a check proves a statement wrong, on the message and in the headline", async () => {
    await open()
    const critic = screen.getByRole("article", { name: "Critic" })
    expect(critic).toHaveAttribute("data-wrong", "true")
    expect(critic).toHaveTextContent("A check proved one statement here wrong.")
    expect(within(critic).getByText("Proven wrong")).toBeInTheDocument()
    expect(within(critic).getByText("Not enough evidence")).toBeInTheDocument()
    expect(screen.getByRole("article", { name: "Scout" })).not.toHaveAttribute("data-wrong")
    expect(screen.getByText(/One statement was proven wrong\./)).toBeInTheDocument()
  })
  it("says in one sentence what happened", async () => {
    await open()
    await emit({ type: "run.finished", usd: 0, minutes: 0.15 })
    expect(screen.getByText(/The team has decided\./)).toHaveTextContent("2 team members made 3 statements: 1 held up, 1 was proven wrong, 1 had too little evidence.")
    expect(screen.getByRole("region", { name: "What happened" })).toHaveTextContent("took 9 seconds · cost nothing (practice run)")
    expect(screen.getByRole("heading", { name: "KRAS" })).toBeInTheDocument() // the title is the question, not the run id
  })
  it("keeps everything a model wrote as text: no HTML, no script, no image, no link from its words", async () => {
    const { container } = await open()
    const critic = screen.getByRole("article", { name: "Critic" })
    expect(critic).toHaveTextContent('<img src=x onerror="window.__pwned=1">')
    expect(critic).toHaveTextContent("[click](javascript:alert(1))")
    await userEvent.setup().click(within(critic).getByRole("button", { name: /Statement 2: Not enough evidence/ }))
    expect(critic).toHaveTextContent("Sourcejavascript:alert(1)") // shown, as text
    expect(container.querySelector("img, script, iframe, object, embed")).toBeNull() // nothing is fetched from a model-supplied address
    expect((window as { __pwned?: number }).__pwned).toBeUndefined()
    const links = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"))
    expect(links.every((href) => !/^\s*(javascript|data|vbscript):/i.test(href ?? ""))).toBe(true)
  })
})

describe("the message line", () => {
  it("is the reply's own \"In short\" sentence when it has one, and the rest is the full reply", () => {
    expect(splitReply("In short: hold CMP-0517 until the heart-safety margin is fixed.\n\nThe hERG IC50 is 6 uM. That is too close.")).toEqual({
      short: "hold CMP-0517 until the heart-safety margin is fixed.", rest: "The hERG IC50 is 6 uM. That is too close.", marked: true })
    expect(splitReply("  in short - Yes.\nMore.").short).toBe("Yes.")
    expect(splitReply("**In short:** Go ahead.\nWhy: x").short).toBe("Go ahead.")
    render(<TeamMessage name="Critic" text={"In short: hold it.\n\nThe margin is 6 uM. I disagree with Scout."} />)
    expect(screen.getByText("hold it.")).toHaveClass("thread-short")
    const full = screen.getByText("Show full reply").closest("details")!
    expect(full).toHaveTextContent("The margin is 6 uM. I disagree with Scout.")
    expect(full).not.toHaveTextContent("In short")
  })
  it("is the first sentence when the reply has no such line, and never an empty bubble", () => {
    expect(splitReply("The data is fine. Nothing is missing.")).toEqual({ short: "The data is fine.", rest: "The data is fine. Nothing is missing.", marked: false })
    expect(splitReply("In short:\nThe data is fine.").short).toBe("The data is fine.") // the sentence may start on the next line
    render(<TeamMessage name="Scout" text="   " />)
    expect(screen.getByText("(This reply was empty.)")).toBeInTheDocument()
  })
  it("a reply with HTML in it is shown as text, in the line and in the full reply", () => {
    const { container } = render(<TeamMessage name="Critic" text={'In short: <b onclick="x()">no</b> <img src=x onerror=alert(1)>.\n\n<script>alert(1)</script> <a href="javascript:alert(1)">x</a>'} />)
    expect(screen.getByText('<b onclick="x()">no</b> <img src=x onerror=alert(1)>.')).toBeInTheDocument()
    expect(container.querySelector("img, script, a, [onclick], .thread-short b, details b")).toBeNull()
    expect(container).toHaveTextContent('<script>alert(1)</script> <a href="javascript:alert(1)">x</a>')
  })
})

describe("pieces", () => {
  it("only an http(s) source becomes a link, opened safely", async () => {
    expect(safeUrl("javascript:alert(1)")).toBeUndefined()
    expect(safeUrl("data:text/html,<script>1</script>")).toBeUndefined()
    expect(safeUrl("brief")).toBeUndefined()
    expect(safeUrl("https://example.org/a")).toBe("https://example.org/a")
    render(<TeamMessage name="Scout" text="x" checks={[{ key: "k", verdict: "verified", claim: "c", source: "https://example.org/a" }]} />)
    await userEvent.setup().click(screen.getByRole("button", { name: /Statement 1/ }))
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
    expect(screen.getByText("All files are present.")).toBeInTheDocument()
    expect(screen.queryByText("Show full reply")).toBeNull()
  })
  it("says numbers the way a person does", () => {
    expect(plainDuration(9_000)).toBe("9 seconds")
    expect(plainDuration(90_000)).toBe("1 minute 30 seconds")
    expect(plainDuration(3_900_000)).toBe("1 hour 5 minutes")
    expect(plainLimit(1800)).toBe("30-minute limit")
    expect(plainCost(0, true)).toBe("cost nothing (practice run)")
    expect(plainCost(1.25)).toBe("cost $1.25")
    const now = new Date(2026, 10, 15, 18, 0)
    expect(plainWhen(new Date(2026, 10, 15, 16, 51).getTime(), now)).toBe("today at 4:51 pm")
    expect(plainWhen(new Date(2026, 10, 14, 9, 5).getTime(), now)).toBe("yesterday at 9:05 am")
    expect(plainWhen(new Date(2026, 10, 2, 12, 0).getTime(), now)).toBe("2 Nov at 12:00 pm")
    expect(plainTitle("202611150024-chat-should-we-advance-a-kras-g12c-hit-1060e203")).toBe("Should we advance a kras g12c hit")
    expect(plainTitle("kras-g12c-hit-to-lead.md")).toBe("Kras g12c hit to lead")
    expect(runTitle("Task demo · swarm · mock")).toBe("Team of nine on the demo task") // no bare "swarm" or "mock"
    expect(runTitle("Task bix-12 · single · anthropic/claude-sonnet-5-5")).toBe("One agent alone on task bix-12 (anthropic/claude-sonnet-5-5)")
    expect(runTitle("Drug board · chat should we advance")).toBe("Chat should we advance")
  })
})

describe("when the engine answers with an error", () => {
  it("shows the engine's own words, as text, and does not say the engine is not running", async () => {
    board({ "GET /api/roster": { status: 500, body: { error: 'agent "toxicologist" is not in the roster <b>now</b>' } } })
    const { container } = render(<BoardView />)
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Something went wrong inside the app's engine")
    expect(within(alert).getByText("Details").closest("details")).not.toHaveAttribute("open") // the engine's own text is kept, under Details
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument() // one clear action
    expect(alert).toHaveTextContent('agent "toxicologist" is not in the roster <b>now</b> (HTTP 500)')
    expect(alert).toHaveTextContent("The engine is running")
    expect(alert).not.toHaveTextContent("engine isn't running")
    expect(container.querySelector("b")).toBeNull()
  })
  it("still says the engine is not running when it cannot be reached at all", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))))
    render(<BoardView />)
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("The app's engine isn't running")
    expect(alert).toHaveTextContent("Start it with: npm start")
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument()
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
