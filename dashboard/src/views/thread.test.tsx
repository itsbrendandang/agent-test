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
import { agentIdentity } from "@/lab/identity"
import { BoardView } from "./BoardView"

const streams: { url: string; onmessage?: (m: { data: string }) => void; close: () => void }[] = []
beforeEach(() => {
  streams.length = 0; forgetScripted()
  vi.stubGlobal("EventSource", class { url: string; onmessage?: (m: { data: string }) => void; constructor(url: string) { this.url = url; streams.push(this) } close() {} })
})
let tick = 0 // each event a moment after the one before, as the engine records them
const emit = (event: object) => act(() => { tick++; for (const s of streams) s.onmessage?.({ data: JSON.stringify({ key: JSON.stringify(event), at: tick, ...event }) }) })

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
  // The discussion is the Agent Log's own group chat: the same rows, bubbles, notes and toolbar.
  const log = () => screen.getByRole("list", { name: "Run events" })
  const bubble = (name: string) => [...log().querySelectorAll<HTMLElement>(".chat-msg")].find((li) => li.querySelector(".chat-who strong")?.textContent === name)!
  const checks = () => [...log().querySelectorAll<HTMLElement>(".chat-note[data-kind='check']")]
  it("reads like the Agent Log: a round line, then the lead and each member as bubbles with their faces, in the order they spoke", async () => {
    await open()
    const discussion = within(screen.getByRole("region", { name: "Discussion" }))
    expect(discussion.getByRole("region", { name: "Full event log" })).toBeInTheDocument() // the Agent Log component itself, with its toolbar
    expect(discussion.getByRole("combobox", { name: "Agent" })).toBeInTheDocument()
    expect(within(log()).getByRole("heading", { name: "Round 1" })).toBeInTheDocument()
    const order = [...log().querySelectorAll(".chat-round, .chat-msg[data-first]")].map((li) => li.classList.contains("chat-round") ? li.textContent : li.querySelector(".chat-who strong")!.textContent)
    expect(order).toEqual(["Round 1", agentIdentity("lead-scientist").label, agentIdentity("scout").label, agentIdentity("critic").label])
    expect(bubble(agentIdentity("lead-scientist").label)).toHaveTextContent("State your position. Then give your evidence.")
    expect(bubble(agentIdentity("scout").label).querySelector("svg[data-agent='scout']")).not.toBeNull()
    expect(bubble(agentIdentity("scout").label)).toHaveTextContent("The data has 12 samples. Two are missing a label, and one file is empty.")
  })
  it("shows each statement check as a quiet note with its mark, the statement, why, and who checked it", async () => {
    await open()
    const [scout, critic, stretch] = checks()
    expect(scout).toHaveAttribute("data-mark", "supported")
    expect(scout).toHaveTextContent(`Supported: ${agentIdentity("scout").label}'s statement “The data has 12 samples”.`)
    expect(scout).toHaveTextContent('quoted: "12 samples"')
    expect(scout).toHaveTextContent("Source: the brief.")
    expect(scout).toHaveTextContent("Practice run: no model checked it.")
    expect(scout.querySelector(".chat-note-mark")).toHaveTextContent("✓")
    expect(critic).toHaveAttribute("data-mark", "contradicted")
    expect(within(critic).getByRole("link", { name: "https://example.org/paper" })).toHaveAttribute("href", "https://example.org/paper")
    expect(stretch).toHaveAttribute("data-mark", "insufficient")
    expect(stretch.querySelector("a")).toBeNull() // a javascript: source is never a link
  })
  it("marks the moment a check proves a statement wrong, in the log and in the headline", async () => {
    await open()
    const wrong = checks().filter((li) => li.dataset.mark === "contradicted")
    expect(wrong).toHaveLength(1)
    expect(wrong[0]).toHaveTextContent("Contradicted:")
    expect(wrong[0].querySelector(".chat-note-mark")).toHaveTextContent("✕")
    expect(screen.getByText(/One statement was contradicted\./)).toHaveTextContent("Look for the ✕ checks in the discussion below.")
  })
  it("keeps each speaker's job, the red mark on a contradicted reply, plain checker names, and the live headline", async () => {
    await open()
    expect(bubble(agentIdentity("scout").label).querySelector(".chat-who")).toHaveTextContent("looks at the data before any research begins")
    expect(bubble(agentIdentity("critic").label).querySelector(".chat-who")).toHaveTextContent("tries to prove the others wrong")
    expect(bubble(agentIdentity("critic").label)).toHaveAttribute("data-wrong")
    expect(bubble(agentIdentity("critic").label)).toHaveTextContent("A check contradicted one statement here.")
    expect(bubble(agentIdentity("scout").label)).not.toHaveAttribute("data-wrong")
    const [scout, critic, stretch] = checks()
    expect(scout.querySelector("strong")).toHaveTextContent("The quick first check")
    expect(critic.querySelector("strong")).toHaveTextContent("The second, careful check")
    expect(stretch.querySelector("strong")).toHaveTextContent("The quick first check")
    const discussion = screen.getByRole("region", { name: "Discussion" })
    expect(discussion.querySelector(".loading-text")).toHaveTextContent("The team is discussing: round 1")
    await emit({ type: "run.finished", usd: 0, minutes: 0.15 })
    expect(discussion.querySelector(".loading")).toBeNull()
  })
  it("opens the same run in the Agent Log", async () => {
    await open()
    expect(within(screen.getByRole("region", { name: "Discussion" })).getByRole("link", { name: "Open in Agent Log" })).toHaveAttribute("href", "#Lab/board/run-1")
  })
  it("says in one sentence what happened", async () => {
    await open()
    await emit({ type: "run.finished", usd: 0, minutes: 0.15 })
    expect(screen.getByRole("region", { name: "What happened" }).querySelector(".story-headline")).toHaveTextContent(/^The team has decided\.$/) // no memo to show yet: one plain line, and the count is said once, below
    const found = within(screen.getByRole("group", { name: "What the checks found" }))
    expect(found.getByTestId("checked-count")).toHaveTextContent("3 of 3 statements checked.")
    expect(found.getByText("1 supported")).toBeInTheDocument(); expect(found.getByText("1 contradicted")).toBeInTheDocument(); expect(found.getByText("1 insufficient evidence")).toBeInTheDocument()
    expect(found.queryByTestId("unchecked-why")).toBeNull() // nothing was left unchecked, so no reasons are given
    expect(screen.getByRole("region", { name: "What happened" })).toHaveTextContent("took 9 seconds · cost nothing (practice run)")
    expect(screen.getByRole("heading", { name: "KRAS" })).toBeInTheDocument() // the title is the question, not the run id
  })
  it("keeps everything a model wrote as text: no HTML, no script, no image, no link from its words", async () => {
    const { container } = await open()
    const critic = bubble(agentIdentity("critic").label)
    expect(critic).toHaveTextContent('<img src=x onerror="window.__pwned=1">')
    expect(critic).toHaveTextContent("[click](javascript:alert(1))")
    expect(log()).toHaveTextContent("javascript:alert(1)") // the check's source, shown as text
    expect(container.querySelector("img, script, iframe, object, embed")).toBeNull() // nothing is fetched from a model-supplied address
    expect((window as { __pwned?: number }).__pwned).toBeUndefined()
    const links = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"))
    expect(links.every((href) => !/^\s*(javascript|data|vbscript):/i.test(href ?? ""))).toBe(true)
  })
})

describe("the message line", () => {
  it("uses the engine's own summary of a reply when the run recorded one; the full reply is behind Show thinking, without its In short line", async () => {
    board()
    render(<BoardView />)
    await waitFor(() => expect(streams.length).toBeGreaterThan(0))
    await emit({ type: "run.started", runId: "run-1", brief: "kras", title: "KRAS", mock: false })
    await emit({ type: "round.started", round: 1, message: "Go.", final: false })
    await emit({ type: "member.replied", round: 1, member: "scout", summary: "The data is complete.", text: "In short: The data is complete.\n\nTwelve samples, none missing." })
    const scout = [...screen.getByRole("list", { name: "Run events" }).querySelectorAll<HTMLElement>(".chat-msg")].find((li) => li.textContent?.includes("The data is complete."))!
    expect(within(scout).getByText("The data is complete.")).toBeVisible()
    await userEvent.setup().click(within(scout).getByRole("button", { name: "Show thinking" }))
    expect(scout).toHaveTextContent("Twelve samples, none missing.")
    expect(scout).not.toHaveTextContent("In short")
  })
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

describe("every agent's message shows that agent's own label and face", () => {
  const ROSTER_NAMES: [string, string][] = [["lead-scientist", "Lead Scientist"], ["scout", "Scout"], ["proposer", "Proposer"], ["pilot", "Pilot"], ["experimenter", "Experimenter"],
    ["methods-auditor", "Methods Auditor"], ["critic", "Critic"], ["reviser", "Reviser"], ["finisher", "Finisher"], ["reporter", "Reporter"]]
  it.each(ROSTER_NAMES)("%s: label '%s', its own face on the left, as decoration", (agent, label) => {
    const { container } = render(<TeamMessage name={label} agent={agent} text="In short: fine." />)
    const message = screen.getByRole("article", { name: label })
    expect(message).toHaveAttribute("data-agent", agent)
    const face = container.querySelector(".thread-face .agent-face")!
    expect(face).toHaveAttribute("data-face", agent) // this agent's face, not another's and not the neutral one
    expect(face.querySelector("svg")).toHaveAttribute("aria-hidden", "true") // the picture is decoration; the label is the text
    expect(face).toHaveStyle({ width: "32px", height: "32px" }) // a fixed box: nothing moves when it is drawn
    expect(message.firstElementChild).toHaveClass("thread-face") // on the left, before the label
    expect(within(message).getByText(label)).toBeInTheDocument()
  })
  it("the same agent has the same face whether it is named by its engine name or by its label", () => {
    const { container } = render(<><TeamMessage name="Methods Auditor (Quality Checker)" text="a" /><TeamMessage name="Critic, round 2" text="b" /><TeamMessage name="Critic" agent="critic" text="c" /></>)
    expect([...container.querySelectorAll(".agent-face")].map((f) => f.getAttribute("data-face"))).toEqual(["methods-auditor", "critic", "critic"])
  })
  it("an agent that is not known gets the neutral face and keeps its own name", () => {
    const { container } = render(<TeamMessage name="Somebody New" agent="zz-nobody-known" text="x" />)
    expect(container.querySelector(".agent-face")).toHaveAttribute("data-face", "neutral")
    expect(screen.getByRole("article", { name: "Somebody New" })).toHaveTextContent("Somebody New")
  })
  it("draws the app's one shared character for each agent: the same shape and colour as in the Lab", () => {
    for (const [agent, label] of ROSTER_NAMES) {
      const { container, unmount } = render(<TeamMessage name={label} agent={agent} text="x" />)
      const who = agentIdentity(agent)
      const picture = container.querySelector(".agent-face svg")!
      expect(picture).toHaveAttribute("data-face", `${who.shape}:${who.colour}`)
      expect(picture).toHaveAttribute("aria-hidden", "true")
      unmount()
    }
    // no two different agents of the roster share both shape and colour
    const faces = ROSTER_NAMES.map(([agent]) => { const w = agentIdentity(agent); return `${w.shape}:${w.colour}` })
    expect(new Set(faces).size).toBe(faces.length)
  })
})

describe("many statements in one reply", () => {
  const checks = [...Array.from({ length: 4 }, (_, i) => ({ key: `v${i}`, verdict: "verified" as const, claim: `Supported statement ${i}`, why: "quoted" })),
    ...Array.from({ length: 5 }, (_, i) => ({ key: `u${i}`, verdict: "unchecked" as const, claim: `Calculation ${i}`, why: "computed claim not re-executed" })),
    { key: "x", verdict: "unsupported" as const, claim: "A stretch", why: "the source does not state this" }]
  it("groups the chips by mark with counts, says how many were really checked, and opens a group to its statements and their reasons", async () => {
    const user = userEvent.setup()
    render(<TeamMessage name="Experimenter" text="Many numbers." checks={checks} />)
    const group = within(screen.getByRole("group", { name: "What the checks found about Experimenter's statements" }))
    expect(group.getAllByRole("button")).toHaveLength(3) // one per mark, not ten chips
    expect(group.getByRole("button", { name: /^4 Supported\./ })).toHaveTextContent("✓ 4 supported")
    expect(group.getByRole("button", { name: /^5 Not checked\./ })).toHaveTextContent("○ 5 not checked")
    expect(screen.getByText(/5 of 10 statements checked\./)).toBeInTheDocument() // the five not checked are not counted as checked
    await user.click(group.getByRole("button", { name: /^5 Not checked\./ }))
    const list = within(screen.getByRole("list", { name: "Not checked statements" }))
    expect(list.getAllByRole("listitem")).toHaveLength(5)
    await user.click(list.getByRole("button", { name: "Calculation 2" }))
    expect(screen.getByText("The statement").closest("dl")).toHaveTextContent("Whycomputed claim not re-executed")
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
    expect(runTitle("Task bix-12 · single · anthropic/claude-sonnet-5-5")).toBe("One agent on benchmark task bix-12 (anthropic/claude-sonnet-5-5)")
    expect(runTitle("Task demo · single agent · mock")).toBe("One agent on the demo task") // the same pattern as the team's run, never the raw title
    // a brief named from a question is cut by the engine at 40 characters: the broken word goes, and "…" says so
    expect(plainTitle("202611150118-chat-should-we-advance-a-kras-g12c-hit-that-h-1c582a84")).toBe("Should we advance a kras g12c hit that…")
    expect(runTitle("Drug board · chat-should-we-advance-a-kras-g12c-hit-that-h-1c582a84")).toBe("Should we advance a kras g12c hit that…")
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
