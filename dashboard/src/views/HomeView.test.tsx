// Home as a person uses it, against a stand-in engine. Nothing here reaches the network.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TokenPrompt } from "@/components/TokenPrompt"
import type { Catalog } from "@/home/api"
import { TOKEN_HEADER } from "@/lib/token"
import { routes, to } from "@/test/engine"
import { CATALOG_OFF, CATALOG_ON, PLAN, reply, SCRIPTED_PLAN } from "@/test/home"
import { HomeView } from "./HomeView"

/** Event streams the page opened (board run progress). jsdom has no EventSource. */
const streams: { url: string; onmessage?: (m: { data: string }) => void; close: () => void }[] = []
beforeEach(() => {
  streams.length = 0
  vi.stubGlobal("EventSource", class { url: string; onmessage?: (m: { data: string }) => void; constructor(url: string) { this.url = url; streams.push(this) } close() {} })
})
const emit = (event: object) => act(() => { for (const s of streams) s.onmessage?.({ data: JSON.stringify({ key: JSON.stringify(event), at: 0, ...event }) }) })

type Table = Parameters<typeof routes>[0]
function home(catalog: Catalog | "down", table: Table = {}) {
  // These tests cover the plan path (POST /api/chat): what Deep uses, and what every depth uses on an engine that
  // cannot answer directly. So this stand-in engine has no /api/research. The direct answer has its own tests.
  const sent = routes({ ...(catalog !== "down" && { "GET /api/chat/catalog": { status: 200, body: catalog } }), ...((catalog !== "down" || "POST /api/chat" in table) && { "POST /api/research": { status: 404, body: { error: "not found" } } }), ...table })
  const onOpen = vi.fn()
  const view = render(<><TokenPrompt /><HomeView onOpen={onOpen} /></>)
  fireEvent.click(screen.getByRole("button", { name: "Recent results and setup" })) // the optional panel: closed until asked for
  const box = () => screen.getByLabelText("Ask a research question") as HTMLTextAreaElement
  const user = userEvent.setup()
  const ask = async (text: string) => { await user.type(box(), `${text}{Enter}`) }
  return { sent, onOpen, view, box, user, ask, chats: () => to(sent, "POST", "/api/chat") }
}
const planCard = async () => within(await screen.findByRole("region", { name: PLAN.briefTitle }))
const paidPlan = () => ({ "POST /api/chat": reply({ plan: PLAN }) })

describe("empty conversation", () => {
  it("shows example questions, and sends one when it is pressed", async () => {
    const t = home(CATALOG_ON, { "POST /api/chat": reply() })
    const examples = within(screen.getByRole("group", { name: "Example questions" })).getAllByRole("button")
    expect(examples.length).toBeGreaterThanOrEqual(3)
    expect(examples.length).toBeLessThanOrEqual(4)
    expect(screen.queryByRole("button", { name: "New search" })).toBeNull()
    const question = examples[1].textContent!
    await t.user.click(examples[1])
    await waitFor(() => expect(t.chats()).toHaveLength(1))
    expect(t.chats()[0].body).toMatchObject({ messages: [{ role: "user", content: question }] })
    await waitFor(() => expect(screen.queryByRole("group", { name: "Example questions" })).toBeNull())
  })
})

describe("sending", () => {
  it("Enter sends the question with the conversation so far; Shift+Enter is a new line", async () => {
    const t = home(CATALOG_ON, { "POST /api/chat": [reply({ reply: "First answer" }), reply({ reply: "Second answer" })] })
    await screen.findByRole("radio", { name: "Standard" })
    await t.user.type(t.box(), "line one{Shift>}{Enter}{/Shift}line two")
    expect(t.chats()).toHaveLength(0)
    expect(t.box().value).toBe("line one\nline two")
    await t.user.keyboard("{Enter}")
    expect(await screen.findByText("First answer")).toBeInTheDocument()
    expect(t.chats()[0].body).toEqual({ messages: [{ role: "user", content: "line one\nline two" }], effort: "standard" })
    expect(t.box().value).toBe("")
    await t.ask("And then?")
    expect(await screen.findByText("Second answer")).toBeInTheDocument()
    expect(t.chats()[1].body).toEqual({ effort: "standard", messages: [
      { role: "user", content: "line one\nline two" }, { role: "assistant", content: "First answer" }, { role: "user", content: "And then?" },
    ] })
  })
  it("sends nothing for an empty box, and says what to do", async () => {
    const t = home(CATALOG_ON)
    await t.user.type(t.box(), "   {Enter}")
    expect(t.chats()).toHaveLength(0)
    expect(t.box()).toHaveAccessibleDescription(/Type a question first/)
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled()
  })
  it("does not send text that holds an API key", async () => {
    const t = home(CATALOG_ON)
    await t.ask("use sk-ant-api03-abcdefghijklmnop please")
    expect(t.chats()).toHaveLength(0)
    expect(t.box()).toHaveAccessibleDescription(/looks like an API key, so it was not sent/)
    expect(t.view.container.querySelector("input[type=password], input[name*=key i]")).toBeNull() // the page has no place for a key
  })
  it("shows that it is waiting, and does not send a second question meanwhile", async () => {
    let answer!: (r: { status: number; body: unknown }) => void
    const t = home(CATALOG_ON, { "POST /api/chat": () => new Promise((done) => { answer = done }) })
    await t.ask("Slow question")
    expect(await screen.findByText(/Starting…|Writing a plan\. A real model usually takes about ten seconds/)).toBeInTheDocument()
    expect(screen.getByText("Slow question")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled()
    await t.user.type(t.box(), "Another{Enter}")
    expect(t.chats()).toHaveLength(1)
    answer(reply({ reply: "Done" }))
    expect(await screen.findByText("Done")).toBeInTheDocument()
    expect(screen.queryByText(/Starting…|Writing a plan\. A real model usually takes about ten seconds/)).toBeNull()
  })
  it("when the engine cannot be reached: says so, keeps the question in the box, adds nothing to the conversation", async () => {
    const t = home(CATALOG_ON)
    await t.ask("Is hERG a risk?")
    await waitFor(() => expect(t.box()).toHaveAccessibleDescription(/engine isn't running\. Start it with: npm start/))
    expect(t.box().value).toBe("Is hERG a risk?")
    expect(screen.queryByRole("article")).toBeNull()
    expect(sessionStorage.getItem("home.chat")).toBeNull()
  })
  it("shows a refusal about the model next to the model choice", async () => {
    const t = home(CATALOG_ON, { "POST /api/chat": { status: 400, body: { error: "model claude-sonnet-5-5 is not available", field: "model" } } })
    await t.user.selectOptions(await screen.findByLabelText("Model"), "claude-sonnet-5-5")
    await t.ask("q")
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveAccessibleDescription("model claude-sonnet-5-5 is not available"))
    expect(screen.getByLabelText("Model")).toBeInvalid()
    expect(t.box()).toBeValid()
    expect(t.chats()[0].body).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5" })
  })
  it("offers models only from providers whose key is present, and none while paid calls are off", async () => {
    const on = home(CATALOG_ON)
    await waitFor(() => expect([...(screen.getByLabelText("Model") as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(["Let the engine choose", "claude-sonnet-5-5", "claude-haiku-5-5"]))
    on.view.unmount()
    home(CATALOG_OFF)
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveTextContent("Not available in Demo mode"))
    expect(screen.getByLabelText("Model")).toBeDisabled()
  })
  it("keeps the conversation for the session, and Clear removes it", async () => {
    const t = home(CATALOG_ON, { "POST /api/chat": reply({ reply: "Kept answer" }) })
    await t.ask("Kept question")
    await screen.findByText("Kept answer")
    t.view.unmount()
    const again = home(CATALOG_ON)
    expect(screen.getByText("Kept question")).toBeInTheDocument()
    expect(screen.getByText("Kept answer")).toBeInTheDocument()
    expect(localStorage.getItem("home.chat")).toBeNull()
    await again.user.click(screen.getByRole("button", { name: "New search" }))
    expect(screen.queryByText("Kept answer")).toBeNull()
    expect(sessionStorage.getItem("home.chat")).toBeNull()
    expect(screen.getByRole("group", { name: "Example questions" })).toBeInTheDocument()
  })
  it("asks for the session token when the engine needs it, then sends the question again with it", async () => {
    const t = home(CATALOG_ON, { "POST /api/chat": [{ status: 401, body: { error: "chat with a model needs the session token", field: "token", needsToken: true } }, reply({ reply: "With token" })] })
    await t.ask("q")
    await t.user.type(await screen.findByLabelText("Session token"), "s3cr3t{Enter}")
    expect(await screen.findByText("With token")).toBeInTheDocument()
    expect(t.chats().map((c) => c.headers[TOKEN_HEADER])).toEqual([undefined, "s3cr3t"])
    expect(t.view.container.innerHTML).not.toContain("s3cr3t")
  })
})

describe("replies", () => {
  it.each([
    ["ai", "AI answer", "Written by an AI model."],
    ["scripted", "Demo response", "Fixed example text. Not an AI answer and not research."],
  ] as const)("a %s reply is labelled '%s' and says what produced it", async (mode, label, means) => {
    const t = home(CATALOG_ON, { "POST /api/chat": reply({ mode, note: `note for ${mode}` }) })
    await t.ask("q")
    const article = within(await screen.findByRole("article", { name: "Answer" }))
    expect(article.getByText(label)).toBeInTheDocument()
    expect(article.getByText(means)).toBeInTheDocument()
    for (const other of ["AI answer", "Demo response"]) if (other !== label) expect(article.queryByText(other)).toBeNull()
    // the engine's note names the model that wrote an AI answer; the other kind needs no second explanation
    if (mode === "ai") expect(article.getByText("note for ai")).toBeInTheDocument()
    else expect(article.queryByText(`note for ${mode}`)).toBeNull()
    expect(article.queryByText(/✓|Holds up|Supported|verified/i)).toBeNull() // no mark of a check that was not made
  })
  it("a keyword search of saved runs is shown as matches, never as an answer", async () => {
    const runs = [1, 2, 3, 4, 5].map((n) => ({ kind: "board" as const, id: `run-${n}`, title: `Drug board · brief-${n}`, why: "contains: herg" }))
    const t = home(CATALOG_ON, { "POST /api/chat": reply({ mode: "keyword", reply: "Saved research that mentions “herg”. This is a keyword match, not an answer to your question.", runs }) })
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    await t.ask("herg")
    const result = await screen.findByRole("article", { name: "Matching saved research" })
    const view = within(result)
    expect(view.getByRole("heading", { name: "Matching saved research" })).toBeInTheDocument()
    expect(result).toHaveTextContent("Found 5 matching runs. Keyword matches from saved runs.")
    expect(view.getByText("Keyword matches from saved runs.")).toHaveAttribute("title", expect.stringContaining("not ranked by relevance")) // the fuller explanation, on demand
    // it is not an answer, and it does not claim sources were used for one
    expect(screen.queryByRole("article", { name: "Answer" })).toBeNull()
    expect(result).not.toHaveTextContent(/Copy answer|this answer used|AI answer|Sources/)
    expect(view.queryByRole("button", { name: /Synthesize/ })).toBeNull() // the engine cannot do that yet
    // three rows, then the rest on request
    const rows = () => within(view.getByRole("list", { name: "Matching saved runs" })).getAllByRole("button")
    expect(rows()).toHaveLength(3)
    await t.user.click(view.getByRole("button", { name: "View all 5" }))
    expect(rows()).toHaveLength(5)
    await t.user.click(view.getByRole("button", { name: "Copy links" }))
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/Brief 1\n.*#Board\/run-1\n\nBrief 2\n/))
    expect(view.getByRole("button", { name: "Search again" })).toBeInTheDocument()
  })
  it("a keyword search that finds nothing says so, and what to try", async () => {
    const t = home(CATALOG_ON, { "POST /api/chat": reply({ mode: "keyword", reply: "No matching research found. Try a shorter question or different keywords." }) })
    await t.ask("zzzz")
    const result = await screen.findByRole("article", { name: "Matching saved research" })
    expect(result).toHaveTextContent("No matching research found. Try a shorter question or different keywords.")
    expect(within(result).queryByRole("button", { name: "Copy links" })).toBeNull()
  })
  it("formats an answer (lists, a table, code, a safe link) and lets nothing in it run, load or mislead", async () => {
    const evil = [
      "## What we found", "", "The effect is real (p < 0.05); potency is 1.2 × 10⁻⁵ M.", "", "- first point", "- second point", "",
      "| compound | IC50 |", "|---|---|", "| CMP-1 | 6 µM |", "", "```", "x < y", "```", "",
      '<img src=x onerror="window.pwned=1"><script>window.pwned=1</script> <b>raw</b>', "",
      "[bad](javascript:alert(1)) [good](https://example.org/paper) ![pic](https://evil.example/t.png)",
    ].join("\n")
    const t = home(CATALOG_ON, { "POST /api/chat": reply({ mode: "ai", reply: evil, note: "<b>note</b>" }) })
    await t.ask("q")
    const article = await screen.findByRole("article", { name: "Answer" })
    expect(within(article).getByRole("heading", { name: "What we found" })).toBeInTheDocument()
    expect(article).toHaveTextContent("The effect is real (p < 0.05); potency is 1.2 × 10⁻⁵ M.")
    expect(article.querySelectorAll(".md ul li")).toHaveLength(2)
    expect(within(article).getByRole("table")).toHaveTextContent("CMP-16 µM")
    expect(article.querySelector(".md pre")).toHaveTextContent("x < y")
    expect(article.querySelector("img, script, iframe, [onerror], .md b")).toBeNull() // raw HTML never becomes elements; no image is loaded
    const links = [...article.querySelectorAll(".md a")]
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["https://example.org/paper"])
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer"); expect(links[0]).toHaveAttribute("target", "_blank")
    expect(within(article).getByText("<b>note</b>")).toBeInTheDocument() // the engine's note is text
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined()
  })
  it("Copy copies the answer's text, and Ask again sends the same question once more", async () => {
    const t = home(CATALOG_ON, { "POST /api/chat": [reply({ reply: "First **answer**" }), reply({ reply: "Second answer" })] })
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true }) // after the test user is set up: it brings its own clipboard
    await t.ask("What about hERG?")
    const first = within(await screen.findByRole("article", { name: "Answer" }))
    await t.user.click(first.getByRole("button", { name: "Copy answer" }))
    expect(writeText).toHaveBeenCalledWith("First **answer**")
    expect(await first.findByRole("button", { name: "Copied" })).toBeInTheDocument()
    await t.user.click(first.getByRole("button", { name: "Ask again" }))
    await waitFor(() => expect(t.chats()).toHaveLength(2))
    expect((t.chats()[1].body as { messages: { content: string }[] }).messages.at(-1)).toMatchObject({ role: "user", content: "What about hERG?" })
    await waitFor(() => expect(screen.getAllByRole("article", { name: "Answer" })).toHaveLength(2))
    expect(within(screen.getAllByRole("article", { name: "Answer" })[0]).queryByRole("button", { name: "Ask again" })).toBeNull() // only on the latest answer
  })
  it("shows cited runs as cards that open the run in its view", async () => {
    const t = home(CATALOG_ON, { "POST /api/chat": reply({ runs: [
      { kind: "swarm", id: "202611141543-demo-glhf", title: "Task demo · swarm · mock", why: "claim C2 was refuted" },
      { kind: "board", id: "202611142034-kras", title: "Drug board · kras", why: "decided on hERG" },
    ] }) })
    await t.ask("q")
    const cards = within(await screen.findByRole("list", { name: "Saved research this answer used" })).getAllByRole("button")
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveTextContent("claim C2 was refuted")
    expect(t.onOpen).not.toHaveBeenCalled() // a reply never navigates away by itself
    await t.user.click(cards[1])
    expect(sessionStorage.getItem("open.board")).toBe("202611142034-kras")
    expect(t.onOpen).toHaveBeenLastCalledWith("Board")
    await t.user.click(cards[0])
    expect(sessionStorage.getItem("open.swarm")).toBe("202611141543-demo-glhf")
    expect(t.onOpen).toHaveBeenLastCalledWith("Compare")
  })
})

describe("plan card", () => {
  it("shows the question, agents and why, skills, Exa, models, limits, estimate, warnings, and the brief folded away", async () => {
    const t = home(CATALOG_ON, paidPlan())
    await t.ask("Should we advance CMP-0423?")
    const card = await planCard()
    expect(card.getByText("“Should we advance CMP-0423?”")).toBeInTheDocument()
    expect(card.getByText("Critic (Scientific Reviewer)")).toBeInTheDocument()
    expect(card.getByText("Every review gets one voice against.")).toBeInTheDocument()
    expect(card.getByText("Experimenter (Data Scientist)")).toBeInTheDocument()
    expect(card.getByText("herg-triage")).toBeInTheDocument()
    expect(card.getByText("Patch-clamp data is in the brief.")).toBeInTheDocument()
    expect(card.getByText("used (a paid service)")).toBeInTheDocument()
    expect(card.getByText("claude-opus").closest("dd")).toHaveTextContent("lead claude-opus · members claude-sonnet · checker gpt-mini")
    expect(card.getByText("at most $5.00, 15 minutes and 4 rounds of discussion")).toBeInTheDocument()
    expect(card.getAllByText(/about \$1\.80/).some((e) => e.textContent!.includes("(6 agents, 4 rounds, list prices)"))).toBe(true)
    // what it may cost and how long it may take is in the open, before anything starts
    const limits = within(card.getByLabelText("Limits and cost"))
    expect(limits.getByText("Most it can cost").nextElementSibling).toHaveTextContent("$5.00")
    expect(limits.getByText("Estimated cost").nextElementSibling).toHaveTextContent("about $1.80")
    expect(limits.getByText("Most time").nextElementSibling).toHaveTextContent("15 minutes")
    expect(limits.getByText("Rounds").nextElementSibling).toHaveTextContent("at most 4")
    expect(within(card.getByRole("list", { name: "Warnings" })).getByText("Exa search has no key on this machine.")).toBeInTheDocument()
    expect(card.getByText(/Nothing has started/)).toBeInTheDocument()
    const brief = card.getByText("Read what the team would be given (the brief)").closest("details")!
    expect(brief).not.toHaveAttribute("open")
    expect(brief.querySelector("script")).toBeNull()
    expect(card.getByRole("button", { name: "Start research" })).toBeEnabled()
    expect(card.getByRole("button", { name: "Discard" })).toBeEnabled()
    expect(to(t.sent, "POST", "/api/chat/plans/plan-1/start")).toHaveLength(0)
  })
  it("writes 'unknown' when the engine has no estimate", async () => {
    const t = home(CATALOG_OFF, { "POST /api/chat": reply({ mode: "scripted", plan: SCRIPTED_PLAN }) })
    await t.ask("q")
    expect((await planCard()).getByText(/^unknown/)).toHaveTextContent("unknown (scripted models cost nothing)")
  })
  it("Discard starts nothing and can be undone", async () => {
    const t = home(CATALOG_ON, paidPlan())
    await t.ask("q")
    const card = await planCard()
    await t.user.click(card.getByRole("button", { name: "Discard" }))
    expect(card.getByText(/Discarded\. Nothing was started\./)).toBeInTheDocument()
    expect(card.queryByRole("button", { name: "Start research" })).toBeNull()
    expect(t.sent.filter((s) => s.url.includes("/start"))).toHaveLength(0)
    await t.user.click(card.getByRole("button", { name: "Bring it back" }))
    expect(card.getByRole("button", { name: "Start research" })).toBeInTheDocument()
  })
})

describe("confirm step", () => {
  const start = (answer: Table[string]) => ({ ...paidPlan(), "POST /api/chat/plans/plan-1/start": answer })
  const toConfirm = async (t: ReturnType<typeof home>) => {
    await t.ask("q")
    const card = await planCard()
    await t.user.click(card.getByRole("button", { name: "Start research" }))
    return card
  }
  const starts = (t: ReturnType<typeof home>) => to(t.sent, "POST", "/api/chat/plans/plan-1/start")

  it("'Start research' starts nothing: it restates what will run and what it may cost", async () => {
    const t = home(CATALOG_ON, start({ status: 201, body: { kind: "board", id: "run-1" } }))
    const card = await toConfirm(t)
    const step = within(card.getByRole("group", { name: "Confirm before starting" }))
    expect(step.getByText(/This may spend money/).closest("p")).toHaveTextContent("estimated: about $1.80")
    expect(step.getByText(/A board review with 2 agents: Critic \(Scientific Reviewer\), Experimenter \(Data Scientist\)/)).toBeInTheDocument()
    expect(step.getByLabelText("Most it may cost (US dollars)")).toHaveValue(5)
    expect(step.getByLabelText("Most time it may take (minutes)")).toHaveValue(15)
    expect(step.getByLabelText("Most rounds of discussion")).toHaveValue(4)
    expect(starts(t)).toHaveLength(0)
  })
  it("a paid plan cannot start without the tick, and Enter sends nothing", async () => {
    const t = home(CATALOG_ON, start({ status: 201, body: { kind: "board", id: "run-1" } }))
    const card = await toConfirm(t)
    const go = card.getByRole("button", { name: "Start paid research" })
    expect(go).toBeDisabled()
    await t.user.click(go)
    await t.user.keyboard("{Enter}")
    await t.user.click(card.getByLabelText("Most rounds of discussion")); await t.user.keyboard("{Enter}")
    await t.user.click(card.getByLabelText("Most it may cost (US dollars)")); await t.user.keyboard("{Enter}")
    expect(starts(t)).toHaveLength(0)
    await t.user.click(card.getByLabelText(/I understand that this spends money/))
    expect(go).toBeEnabled()
    await t.user.click(go)
    await waitFor(() => expect(starts(t)).toHaveLength(1))
    expect(starts(t)[0].body).toEqual({ confirm: true, effort: "standard" })
  })
  it("Back clears the tick", async () => {
    const t = home(CATALOG_ON, start({ status: 201, body: { kind: "board", id: "run-1" } }))
    const card = await toConfirm(t)
    await t.user.click(card.getByLabelText(/I understand that this spends money/))
    await t.user.click(card.getByRole("button", { name: "Back" }))
    await t.user.click(card.getByRole("button", { name: "Start research" }))
    expect(card.getByLabelText(/I understand that this spends money/)).not.toBeChecked()
    expect(card.getByRole("button", { name: "Start paid research" })).toBeDisabled()
    expect(starts(t)).toHaveLength(0)
  })
  it("sends lowered limits and the agents that stay ticked", async () => {
    const t = home(CATALOG_ON, start({ status: 201, body: { kind: "board", id: "run-1" } }))
    const card = await toConfirm(t)
    await t.user.clear(card.getByLabelText("Most it may cost (US dollars)")); await t.user.type(card.getByLabelText("Most it may cost (US dollars)"), "2")
    await t.user.click(card.getByRole("checkbox", { name: "Experimenter (Data Scientist)" }))
    await t.user.click(card.getByLabelText(/I understand that this spends money/))
    await t.user.click(card.getByRole("button", { name: "Start paid research" }))
    await waitFor(() => expect(starts(t)).toHaveLength(1))
    expect(starts(t)[0].body).toEqual({ confirm: true, effort: "standard", limits: { maxUsd: 2, maxMinutes: 15, maxRounds: 4 }, agents: ["critic"] })
  })
  it("will not raise a limit: the message is next to the input and nothing is sent", async () => {
    const t = home(CATALOG_ON, start({ status: 201, body: { kind: "board", id: "run-1" } }))
    const card = await toConfirm(t)
    await t.user.clear(card.getByLabelText("Most it may cost (US dollars)")); await t.user.type(card.getByLabelText("Most it may cost (US dollars)"), "50")
    await t.user.click(card.getByLabelText(/I understand that this spends money/))
    await t.user.click(card.getByRole("button", { name: "Start paid research" }))
    expect(card.getByLabelText("Most it may cost (US dollars)")).toHaveAccessibleDescription(/can be lowered, not raised above 5/)
    expect(starts(t)).toHaveLength(0)
  })
  it("while paid calls are off a paid plan cannot be started, and the card says how a person turns them on", async () => {
    const t = home(CATALOG_OFF, start({ status: 201, body: { kind: "board", id: "run-1" } }))
    await t.ask("q")
    const card = await planCard()
    const note = card.getByRole("note")
    expect(note).toHaveTextContent("You are in Demo mode, so it cannot be started")
    expect(note).toHaveTextContent("Real")
    expect(note).toHaveTextContent("It asks you to confirm that it costs money.")
    const open = card.getByRole("button", { name: "Start research" })
    expect(open).toBeDisabled()
    await t.user.click(open)
    expect(card.queryByRole("group", { name: "Confirm before starting" })).toBeNull()
    expect(starts(t)).toHaveLength(0)
  })
  it("a practice plan starts in one click while paid calls are off: there is nothing for a confirm step to protect", async () => {
    const t = home(CATALOG_OFF, { "POST /api/chat": reply({ mode: "scripted", plan: SCRIPTED_PLAN }), "POST /api/chat/plans/plan-s/start": { status: 201, body: { kind: "board", id: "run-s" } } })
    await t.ask("q")
    const card = await planCard()
    expect(card.queryByRole("button", { name: "Start research" })).toBeNull() // a practice run is not called research
    expect(card.getByText("Practice run: fixed text, not real research")).toBeInTheDocument() // and it says what it is before it starts
    await t.user.click(card.getByRole("button", { name: "Start practice run" }))
    await waitFor(() => expect(to(t.sent, "POST", "/api/chat/plans/plan-s/start")).toHaveLength(1))
    expect(to(t.sent, "POST", "/api/chat/plans/plan-s/start")[0].body).toMatchObject({ confirm: true })
    expect(await card.findByRole("group", { name: "The review this plan started" })).toBeInTheDocument()
  })
  it("the limits and the team of a practice plan can still be changed first, under More options", async () => {
    const t = home(CATALOG_OFF, { "POST /api/chat": reply({ mode: "scripted", plan: SCRIPTED_PLAN }), "POST /api/chat/plans/plan-s/start": { status: 201, body: { kind: "board", id: "run-s" } } })
    await t.ask("q")
    const card = await planCard()
    await t.user.click(card.getByText("More options"))
    await t.user.click(card.getByRole("button", { name: "Change the limits or the team before starting" }))
    expect(to(t.sent, "POST", "/api/chat/plans/plan-s/start")).toHaveLength(0)
    expect(card.getByText(/costs nothing and does no real research/)).toBeInTheDocument()
    expect(card.getByLabelText("Most rounds of discussion")).toBeInTheDocument()
  })
  it("one click never starts anything that could cost money: a practice plan is confirmed when paid calls are on, a paid plan always", async () => {
    const t = home(CATALOG_ON, { "POST /api/chat": reply({ mode: "scripted", plan: SCRIPTED_PLAN }), "POST /api/chat/plans/plan-s/start": { status: 201, body: { kind: "board", id: "run-s" } } })
    await t.ask("q")
    const card = await planCard()
    expect(card.queryByRole("button", { name: "Start practice run" })).toBeNull()
    await t.user.click(card.getByRole("button", { name: "Start practice run (not research)" }))
    expect(to(t.sent, "POST", "/api/chat/plans/plan-s/start")).toHaveLength(0) // the first click only opens the confirm step
  })

  it("after 201 shows the run, follows its status, and opens it in the Board view", async () => {
    const t = home(CATALOG_ON, start({ status: 201, body: { kind: "board", id: "202611150900-kras" } }))
    const card = await toConfirm(t)
    await t.user.click(card.getByLabelText(/I understand that this spends money/))
    await t.user.click(card.getByRole("button", { name: "Start paid research" }))
    const run = within(await card.findByRole("group", { name: "The review this plan started" }))
    expect(run.getByText("running")).toBeInTheDocument()
    expect(run.getByRole("status")).toHaveTextContent("Starting the review…") // the waiting state always says where it is, in text
    expect(run.getByLabelText("202611150900-kras")).toBeInTheDocument()
    expect(streams.at(-1)!.url).toMatch(/\/api\/runs\/202611150900-kras\/events$/)
    expect(card.queryByRole("button", { name: /Start/ })).toBeNull()
    await emit({ type: "round.started", round: 1, message: "go", final: false })
    await emit({ type: "member.replied", round: 1, member: "critic", text: "x" })
    await emit({ type: "claim.checked", round: 1, member: "critic", claim: "c", kind: "k", verdict: "verified", checker: "jev" })
    expect(run.getByRole("status")).toHaveTextContent("The team is discussing: round 1 of 4 · 1 reply so far, 1 statement checked")
    expect(run.getByRole("button", { name: "Watch the discussion" })).toBeInTheDocument()
    await emit({ type: "memo.written", path: "memo.md", decision: "Go with conditions" })
    await emit({ type: "run.finished", usd: 1.25, minutes: 2 })
    expect(run.getByText("done")).toBeInTheDocument()
    expect(run.getByText("Decision: Go with conditions")).toBeInTheDocument()
    expect(run.getByRole("status")).toHaveTextContent("The review is finished. 1 statement checked: 1 held up, 0 were proven wrong, 0 had too little evidence. It took 2 minutes and cost $1.25.")
    expect(t.onOpen).not.toHaveBeenCalled() // starting a plan does not navigate away
    await t.user.click(run.getByRole("button", { name: "See what they found" }))
    expect(sessionStorage.getItem("open.board")).toBe("202611150900-kras")
    expect(t.onOpen).toHaveBeenLastCalledWith("Board")
  })
  it("shows a failed run as failed, with the engine's text", async () => {
    const t = home(CATALOG_ON, start({ status: 201, body: { kind: "board", id: "run-1" } }))
    const card = await toConfirm(t)
    await t.user.click(card.getByLabelText(/I understand that this spends money/))
    await t.user.click(card.getByRole("button", { name: "Start paid research" }))
    const run = within(await card.findByRole("group", { name: "The review this plan started" }))
    await emit({ type: "run.failed", error: "budget reached" })
    expect(run.getByText("failed")).toBeInTheDocument()
    expect(run.getByText("budget reached")).toBeInTheDocument()
  })

  const refusedWith = async (answer: { status: number; body: unknown }) => {
    const t = home(CATALOG_ON, start(answer))
    const card = await toConfirm(t)
    await t.user.click(card.getByLabelText(/I understand that this spends money/))
    await t.user.click(card.getByRole("button", { name: "Start paid research" }))
    await waitFor(() => expect(starts(t)).toHaveLength(1))
    return { t, card }
  }
  it("400 with a field: the message is next to that control, and the plan can be sent again", async () => {
    const { card } = await refusedWith({ status: 400, body: { error: "maxMinutes must be at least 5", field: "limits.maxMinutes" } })
    await waitFor(() => expect(card.getByLabelText("Most time it may take (minutes)")).toHaveAccessibleDescription("maxMinutes must be at least 5"))
    expect(card.getByLabelText("Most time it may take (minutes)")).toBeInvalid()
    expect(card.getByLabelText("Most it may cost (US dollars)")).toBeValid()
    expect(card.queryByText(/The plan was not started/)).toBeNull()
    expect(card.getByRole("button", { name: "Start paid research" })).toBeEnabled()
  })
  it("400 about the agents: next to the agents", async () => {
    const { card } = await refusedWith({ status: 400, body: { error: "the lead cannot be removed", field: "agents" } })
    expect(await card.findByText("the lead cannot be removed")).toBeInTheDocument()
    expect(card.getByRole("group", { name: "Team members to include" })).toHaveAccessibleDescription("the lead cannot be removed")
  })
  it("400 without a field: under the card", async () => {
    const { card } = await refusedWith({ status: 400, body: { error: "the brief is too long" } })
    expect(await card.findByRole("alert")).toHaveTextContent("The plan was not started: the brief is too long")
  })
  it("403: shows the engine's text and how paid calls are turned on", async () => {
    const { card } = await refusedWith({ status: 403, body: { error: "starting a board run with real models is refused." } })
    const alert = await card.findByRole("alert")
    expect(alert).toHaveTextContent("starting a board run with real models is refused.")
    expect(alert).toHaveTextContent("Real")
    expect(card.queryByRole("status")).toBeNull()
  })
  it("404: the plan has expired and can no longer be started", async () => {
    const { card } = await refusedWith({ status: 404, body: { error: "no such plan" } })
    expect(await card.findByText(/This plan has expired/)).toHaveTextContent("Ask the question again to get a new plan")
    expect(card.queryByRole("button", { name: /Start/ })).toBeNull()
    expect(card.queryByRole("button", { name: "Discard" })).toBeNull()
  })
  it("409 that names the run: follows that run instead of starting another", async () => {
    const { card, t } = await refusedWith({ status: 409, body: { error: "this plan was already started", id: "run-earlier" } })
    expect(within(await card.findByRole("group", { name: "The review this plan started" })).getByLabelText("run-earlier")).toBeInTheDocument()
    expect(starts(t)).toHaveLength(1)
  })
  it("409 without a run: says it was already started", async () => {
    const { card } = await refusedWith({ status: 409, body: { error: "this plan was already started" } })
    expect(await card.findByRole("alert")).toHaveTextContent("this plan was already started This plan was already started. Look for its run in the Board view.")
  })
  it("401 needsToken: asks for the token, then starts with it", async () => {
    const t = home(CATALOG_ON, start([{ status: 401, body: { error: "starting a paid plan needs the session token", field: "token", needsToken: true } }, { status: 201, body: { kind: "board", id: "run-1" } }]))
    const card = await toConfirm(t)
    await t.user.click(card.getByLabelText(/I understand that this spends money/))
    await t.user.click(card.getByRole("button", { name: "Start paid research" }))
    await t.user.type(await screen.findByLabelText("Session token"), "s3cr3t{Enter}")
    expect(await card.findByRole("status")).toBeInTheDocument()
    expect(starts(t).map((s) => s.headers[TOKEN_HEADER])).toEqual([undefined, "s3cr3t"])
  })
})

describe("effort", () => {
  it("is three segments with what the level implies in visible text; the choice is sent and remembered", async () => {
    const t = home(CATALOG_ON, { "POST /api/chat": reply() })
    const group = within(await screen.findByRole("group", { name: "Effort" }))
    expect(group.getAllByRole("radio").map((r) => (r as HTMLInputElement).value)).toEqual(["quick", "standard", "deep"])
    expect(group.getByRole("radio", { name: "Standard" })).toBeChecked() // the engine's default
    expect(screen.getByText(/A full board review\./)).toHaveTextContent("Limits for one research run: 6 agents · up to 4 rounds · up to 15 minutes · up to $5.00 · strong models · web search, up to 8 searches")
    await t.user.click(group.getByRole("radio", { name: "Deep" }))
    expect(screen.getByText(/Every agent, more rounds\./)).toHaveTextContent("all agents · up to 8 rounds · up to 1 hour · up to $20.00")
    expect(localStorage.getItem("home.effort")).toBe("deep")
    await t.ask("q")
    await waitFor(() => expect(t.chats()).toHaveLength(1))
    expect(t.chats()[0].body).toMatchObject({ effort: "deep" })
  })
  it("can be changed with the arrow keys", async () => {
    const t = home(CATALOG_ON)
    const standard = await screen.findByRole("radio", { name: "Standard" })
    standard.focus()
    await t.user.keyboard("{ArrowRight}")
    expect(screen.getByRole("radio", { name: "Deep" })).toBeChecked()
    await t.user.keyboard("{ArrowLeft}{ArrowLeft}")
    expect(screen.getByRole("radio", { name: "Quick" })).toBeChecked()
  })
  it("starts from the remembered choice", async () => {
    localStorage.setItem("home.effort", "quick")
    home(CATALOG_ON)
    expect(await screen.findByRole("radio", { name: "Quick" })).toBeChecked()
  })
  it("is not shown, and not sent, on an engine without effort levels", async () => {
    const t = home({ ...CATALOG_ON, efforts: undefined, defaultEffort: undefined }, { "POST /api/chat": reply() })
    await t.ask("q")
    await waitFor(() => expect(t.chats()).toHaveLength(1))
    expect("effort" in (t.chats()[0].body as object)).toBe(false)
    expect(screen.queryByRole("group", { name: "Effort" })).toBeNull()
  })
  it("a refusal about the effort is shown next to the effort choice", async () => {
    const t = home(CATALOG_ON, { "POST /api/chat": { status: 400, body: { error: "effort deep is not allowed while paid calls are off", field: "effort" } } })
    await screen.findByRole("group", { name: "Effort" })
    await t.ask("q")
    expect(await screen.findByText("effort deep is not allowed while paid calls are off")).toBeInTheDocument()
    expect(t.box()).toBeValid()
  })
  it("the plan card shows its effort; changing it asks the engine for a new plan and edits nothing locally", async () => {
    const deep = { ...PLAN, id: "plan-2", effort: "deep" as const, limits: { maxUsd: 20, maxMinutes: 60, maxRounds: 8 }, estimate: { usd: 9, basis: "all agents" } }
    const t = home(CATALOG_ON, { "POST /api/chat": [reply({ plan: PLAN }), reply({ reply: "A deeper plan.", plan: deep })], "POST /api/chat/plans/plan-2/start": { status: 201, body: { kind: "board", id: "run-2" } } })
    await t.ask("Should we advance CMP-0423?")
    let card = await planCard()
    const picker = within(card.getByRole("group", { name: "Effort for this plan" }))
    expect(picker.getByRole("radio", { name: "Standard" })).toBeChecked()
    expect(card.getByText("at most $5.00, 15 minutes and 4 rounds of discussion")).toBeInTheDocument()
    await t.user.click(picker.getByRole("radio", { name: "Deep" }))
    await waitFor(() => expect(t.chats()).toHaveLength(2))
    expect(t.chats()[1].body).toEqual({ effort: "deep", messages: [{ role: "user", content: "Should we advance CMP-0423?" }] })
    expect(await screen.findByText("A deeper plan.")).toBeInTheDocument()
    card = await planCard()
    expect(card.getByText("at most $20.00, 1 hour and 8 rounds of discussion")).toBeInTheDocument() // the engine's numbers
    expect(screen.getAllByRole("article", { name: "Answer" })).toHaveLength(1) // replaced, not added
    expect(screen.getByRole("group", { name: "Effort" }).querySelector("input:checked")).toHaveAttribute("value", "standard") // the chat's own choice is untouched
    await t.user.click(card.getByRole("button", { name: "Start research" }))
    await t.user.click(card.getByLabelText(/I understand that this spends money/))
    await t.user.click(card.getByRole("button", { name: "Start paid research" }))
    await waitFor(() => expect(to(t.sent, "POST", "/api/chat/plans/plan-2/start")).toHaveLength(1))
    expect(to(t.sent, "POST", "/api/chat/plans/plan-2/start")[0].body).toEqual({ confirm: true, effort: "deep" })
    expect(to(t.sent, "POST", "/api/chat/plans/plan-1/start")).toHaveLength(0)
  })
  it("keeps the old plan and says why when the engine sends no new one", async () => {
    const t = home(CATALOG_ON, { "POST /api/chat": [reply({ plan: PLAN }), reply({ reply: "No plan this time." })] })
    await t.ask("q")
    const card = await planCard()
    await t.user.click(within(card.getByRole("group", { name: "Effort for this plan" })).getByRole("radio", { name: "Quick" }))
    expect(await card.findByText(/answered without a plan for this effort, so the plan here is unchanged/)).toBeInTheDocument()
    expect(card.getByText("at most $5.00, 15 minutes and 4 rounds of discussion")).toBeInTheDocument()
    expect(within(card.getByRole("group", { name: "Effort for this plan" })).getByRole("radio", { name: "Standard" })).toBeChecked()
  })
})

describe("what this can use", () => {
  it("lists providers and Exa with key present or missing, and never a key", async () => {
    const t = home(CATALOG_ON)
    const panel = within(await screen.findByRole("complementary", { name: "What this can use" }))
    const row = (name: string) => panel.getByText(name).closest("li")!
    await waitFor(() => expect(row("Claude (Anthropic)")).toHaveTextContent("key present"))
    expect(row("OpenAI")).toHaveTextContent("key missing")
    expect(row("Web search (Exa)")).toHaveTextContent("key missing")
    expect(panel.getByText("Real: costs money")).toBeInTheDocument()
    expect(t.view.container.querySelectorAll("input[type=password], input[type=text], input[type=search]")).toHaveLength(0)
  })
  it("says paid calls are off and how a person turns them on", async () => {
    home(CATALOG_OFF)
    const panel = within(await screen.findByRole("complementary", { name: "What this can use" }))
    expect(await panel.findByText("Demo: practice runs only")).toBeInTheDocument()
    expect(panel.getByRole("region", { name: "Paid calls" })).toHaveTextContent("Real")
    // a key that is present is not shown as usable while paid calls are off
    const claude = panel.getByText("Claude (Anthropic)").closest("li")!
    expect(within(claude).getByText("key present · off")).toHaveAttribute("data-kind", "neutral")
    expect(panel.getByText("OpenAI").closest("li")).toHaveTextContent("key missing")
  })
  it("says plainly when board runs can only be scripted, and why", async () => {
    home(CATALOG_ON, { "GET /api/status": { status: 200, body: { mock: true, paidCalls: true, keys: { ANTHROPIC_API_KEY: true, OPENAI_API_KEY: false }, models: { lead: "anthropic/claude-sonnet-5-5", rival: "openai/gpt-5-mini" } } } })
    const panel = within(await screen.findByRole("complementary", { name: "What this can use" }))
    expect(await panel.findByRole("note")).toHaveTextContent("OpenAI key missing: board reviews are practice runs only.")
  })
  it("says nothing of the kind when the board can use real models", async () => {
    home(CATALOG_ON, { "GET /api/status": { status: 200, body: { mock: false, paidCalls: true, keys: { ANTHROPIC_API_KEY: true }, models: { lead: "anthropic/claude-sonnet-5-5" } } } })
    const panel = within(await screen.findByRole("complementary", { name: "What this can use" }))
    await panel.findByText("Real: costs money")
    expect(panel.queryByRole("note")).toBeNull()
  })
  it("groups agents as Board and Specialists, with triggers", async () => {
    home(CATALOG_ON)
    const panel = within(await screen.findByRole("complementary", { name: "What this can use" }))
    const board = (await panel.findByText("Board")).closest("details")!
    expect(board).toHaveTextContent("(2)")
    expect(board).toHaveTextContent("Lead Scientist")
    expect(board).toHaveTextContent("Critic (Scientific Reviewer)")
    const specialists = panel.getByText("Specialists").closest("details")!
    expect(specialists).toHaveTextContent("Toxicologist")
    expect(specialists).toHaveTextContent("Used when: the question is about a safety margin")
    expect(board).not.toHaveTextContent("Toxicologist")
  })
  it("marks a skill that is not installed as index only", async () => {
    home(CATALOG_ON)
    const panel = within(await screen.findByRole("complementary", { name: "What this can use" }))
    const skill = (name: string) => panel.getByText(name).closest("li")!
    await waitFor(() => expect(skill("admet-benchmarks")).toHaveTextContent("known by name only: not installed"))
    expect(skill("herg-triage")).not.toHaveTextContent("known by name only")
    expect(panel.getByText(/1 installed of 2/)).toBeInTheDocument()
  })
  it("says the engine is not running when the catalog cannot be read, and tries again", async () => {
    const t = home("down")
    const panel = within(screen.getByRole("complementary", { name: "What this can use" }))
    expect(await panel.findByText("The app's engine isn't running")).toBeInTheDocument()
    routes({ "GET /api/chat/catalog": { status: 200, body: CATALOG_ON } })
    await t.user.click(panel.getByRole("button", { name: "Try again" }))
    expect(await panel.findByText("Real: costs money")).toBeInTheDocument()
  })
})

describe("what was checked", () => {
  const BOARD = [{ id: "r-new", brief: "kras.md", rounds: 0, startedAt: 2, status: "running", claims: 0 }, { id: "r-done", brief: "kras.md", rounds: 3, startedAt: 1, status: "done", claims: 3 }]
  const ROWS = [
    { task: "demo", model: "mock", swarm: { id: "s-only", phase: "done", startedAt: 3, extras: [], score: 1 }, note: "no matching baseline" },
    { task: "demo", model: "mock", timeLimit: 1800, single: { id: "single-1", phase: "done", startedAt: 1, extras: [], score: 1 }, swarm: { id: "swarm-1", phase: "done", startedAt: 2, extras: [], score: 1 }, diff: 0 },
  ]
  it("shows the latest finished review's verdict counts with its own scripted label, and the like-for-like row", async () => {
    const t = home(CATALOG_ON, { "GET /api/runs": { status: 200, body: BOARD }, "GET /api/glhf/scoreboard": { status: 200, body: ROWS } })
    const strip = within(screen.getByRole("region", { name: "What was checked" }))
    const review = await strip.findByRole("button", { name: /Latest review/ })
    await waitFor(() => expect(streams.some((s) => s.url.endsWith("/api/runs/r-done/events"))).toBe(true)) // the finished one, not the newest
    await emit({ type: "run.started", runId: "r-done", brief: "kras", title: "KRAS", mock: true })
    for (const verdict of ["verified", "verified", "contradicted", "unsupported"]) await emit({ type: "claim.checked", round: 1, member: "m", claim: `c-${verdict}-${Math.random()}`, kind: "k", verdict, checker: "jev" })
    expect(review).toHaveTextContent("Practice run: fixed text, not real research")
    expect(review).toHaveTextContent("2 held up")
    expect(review).toHaveTextContent("1 was proven wrong")
    expect(review).toHaveTextContent("1 had too little evidence")
    expect(review).toHaveTextContent("of 4 statements checked")
    const pair = strip.getByRole("button", { name: /One agent or a team\?/ })
    expect(pair).toHaveTextContent("1.000 vs 1.000 · a tie")
    expect(pair).toHaveTextContent("Practice run: fixed text, not real research · demo case")
    expect(strip.getByText(/No model grades its own work/)).toBeInTheDocument()
    await t.user.click(pair)
    expect(sessionStorage.getItem("open.swarm")).toBe("swarm-1")
    expect(t.onOpen).toHaveBeenLastCalledWith("Compare")
    await t.user.click(review)
    expect(sessionStorage.getItem("open.board")).toBe("r-done")
    expect(t.onOpen).toHaveBeenLastCalledWith("Board")
  })
  it("labels a real review real even though paid calls are off now", async () => {
    home(CATALOG_OFF, { "GET /api/runs": { status: 200, body: [BOARD[1]] } })
    const review = await within(screen.getByRole("region", { name: "What was checked" })).findByRole("button", { name: /Latest review/ })
    await emit({ type: "run.started", runId: "r-done", brief: "kras", title: "KRAS", mock: false })
    expect(review).toHaveTextContent("real model")
    expect(review).not.toHaveTextContent("scripted")
  })
  it("says so when nothing has been checked yet", async () => {
    home(CATALOG_ON, { "GET /api/runs": { status: 200, body: [] }, "GET /api/glhf/scoreboard": { status: 200, body: [] } })
    expect(await within(screen.getByRole("region", { name: "What was checked" })).findByText(/Nothing has been checked yet/)).toBeInTheDocument()
  })
})

describe("an engine that was started before the chat routes existed", () => {
  it("says the engine has no chat routes, not that it is not running", async () => {
    const t = home("down", { "GET /api/chat/catalog": { status: 404, body: { error: "not found" } }, "POST /api/chat": { status: 404, body: { error: "not found" } } })
    const panel = within(screen.getByRole("complementary", { name: "What this can use" }))
    expect(await panel.findByText(/running, but it has no chat routes yet/)).toBeInTheDocument()
    expect(panel.queryByText("The app's engine isn't running")).toBeNull()
    await t.ask("q")
    await waitFor(() => expect(t.box()).toHaveAccessibleDescription(/it has no chat routes yet\. Stop the app and start it again/))
    expect(t.box()).toHaveValue("q")
  })
})

describe("one input", () => {
  it("has the chat box and no search field: keyword search is on Runs", () => {
    const t = home(CATALOG_ON)
    expect(t.view.container.querySelectorAll("textarea")).toHaveLength(1)
    expect(screen.queryByRole("searchbox")).toBeNull()
    expect(screen.queryByRole("combobox", { name: "Search" })).toBeNull()
    expect(t.box()).toHaveFocus()
  })
})
