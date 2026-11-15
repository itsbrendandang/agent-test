// The direct, sourced answer on Search, against the engine's two example event streams (real-shaped and demo) and
// a stand-in engine. Nothing here talks to a real engine.
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TokenPrompt } from "@/components/TokenPrompt"
import { forgetScripted } from "@/lib/scripted"
import { routes, to } from "@/test/engine"
import { CATALOG_OFF, CATALOG_ON, reply, PLAN } from "@/test/home"
import { ExperimentsView } from "@/views/ExperimentsView"
import { HomeView } from "@/views/HomeView"
import { ResearchAnswer } from "./Answer"
import { copyText, foldAnswer, progressLine, withMarks, type ResearchEvent } from "./model"
// Copies of the engine's own example streams (engine/test/fixtures/research/): the shapes this screen is built against.
import DEMO_LINES from "@/test/research/example-demo.jsonl?raw"
import REAL_LINES from "@/test/research/example-real.jsonl?raw"

const lines = (raw: string): ResearchEvent[] => raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as ResearchEvent)
const REAL = lines(REAL_LINES), DEMO = lines(DEMO_LINES)

const streams: { url: string; onmessage?: (m: { data: string }) => void; onerror?: () => void; close: () => void }[] = []
beforeEach(() => {
  streams.length = 0; forgetScripted()
  vi.stubGlobal("EventSource", class { url: string; onmessage?: (m: { data: string }) => void; onerror?: () => void; constructor(url: string) { this.url = url; streams.push(this) } close() {} })
})
const feed = (events: ResearchEvent[], url = /\/api\/research\//) => act(() => { for (const s of streams.filter((x) => url.test(x.url))) for (const e of events) s.onmessage?.({ data: JSON.stringify(e) }) })
const show = async (events: ResearchEvent[], props: Partial<Parameters<typeof ResearchAnswer>[0]> = {}) => {
  const view = render(<ResearchAnswer id="a-1" latest {...props} />)
  await waitFor(() => expect(streams.length).toBe(1))
  expect(streams[0].url).toMatch(/\/api\/research\/a-1\/events$/)
  await feed(events)
  return view
}

describe("what the events add up to", () => {
  it("the text is the revised answer, and only the final checks count", () => {
    const s = foldAnswer(REAL)
    expect(s.status).toBe("done"); expect(s.mode).toBe("real"); expect(s.revised).toBe(true)
    expect(s.markdown).toContain("The mean follow-up was 39.8 months")
    expect(s.markdown).not.toContain("This proves the benefit holds for everyone") // the first draft's overclaim is gone
    expect(s.statements.map((x) => [x.stage, x.verdict])).toEqual([["final", "verified"], ["final", "verified"], ["final", "verified"], ["final", "verified"]])
    expect(s.sources.map((x) => x.n)).toEqual([1, 2, 3, 4])
    expect(s.finished).toMatchObject({ usd: 0.0932, seconds: 22.2 })
  })
  it("without a revision the draft is final and its checks stand; before it is complete nothing is checked", () => {
    const upToDraftChecks = REAL.filter((e) => (e.seq ?? 0) <= 15)
    expect(foldAnswer(upToDraftChecks).statements.map((x) => x.verdict)).toEqual(["verified", "verified", "verified", "unsupported", "unsupported"])
    const writing = foldAnswer(REAL.filter((e) => (e.seq ?? 0) <= 6))
    expect(writing.complete).toBe(false); expect(writing.statements).toEqual([])
    // a revision with no final checks yet shows no marks at all, rather than the draft's marks on other sentences
    expect(foldAnswer(REAL.filter((e) => (e.seq ?? 0) <= 18)).statements).toEqual([])
  })
  it("says what is happening from the events alone, and never calls a search done that did not run", () => {
    const at = (seq: number) => progressLine(foldAnswer(REAL.filter((e) => (e.seq ?? 0) <= seq)))
    expect(progressLine(foldAnswer([]))).toBe("Starting…")
    expect(at(1)).toBe("Searching the web…")
    expect(at(2)).toBe("Found 10 in the web, kept 2.")
    expect(at(3)).toBe("Searching PubMed and preprints…")
    expect(at(5)).toBe("Kept 4 sources. Writing…")
    expect(at(8)).toBe("Writing…")
    expect(at(10)).toBe("Two reviewers are checking the answer…")
    expect(at(13)).toBe("Checking statements against the sources: 3 checked so far…")
    expect(at(17)).toBe("Revising the answer after review…")
    const skipped = foldAnswer([REAL[0], { type: "search.started", seq: 1, provider: "exa", query: "q" }, { type: "search.finished", seq: 2, provider: "exa", query: "q", ran: false, found: 0, kept: 0, reason: "the Exa spending ceiling was reached" }])
    expect(progressLine(skipped)).toBe("The search of the web did not run: the Exa spending ceiling was reached")
    expect(progressLine(skipped)).not.toMatch(/Found|kept/)
  })
  it("ignores events it does not know and fields that are not what they should be", () => {
    const s = foldAnswer([{ type: "something.new", seq: 0 }, { type: "statement.checked", seq: 1, index: 0, text: "x", verdict: "certainly true", sources: [1] }, { type: "sources", seq: 2, items: [{ n: "1", url: 3 }, null] } as never])
    expect(s.statements).toEqual([]); expect(s.sources).toEqual([])
  })
})

describe("citations and marks in the text", () => {
  const s = foldAnswer(REAL)
  it("a known [n] becomes a citation and each checked statement gets one mark after its sentence", () => {
    const { text, unplaced } = withMarks(s.markdown, s.statements, s.sources, "KEY")
    expect(unplaced).toEqual([])
    expect(text).toContain("compared with placebo [1](#KEY-cite-1). [check](#KEY-check-0)") // after its citation and the full stop
    expect(text.match(/#KEY-check-\d/g)).toHaveLength(4)
    expect(withMarks("See [9] and [1].", [], s.sources, "KEY").text).toBe("See [9] and [1](#KEY-cite-1).") // no source 9: left as text
  })
  it("text from a model cannot place a mark or a citation itself", () => {
    const forged = "This is certain [check](#KEY-check-0) and cited [1](#KEY-cite-1)."
    const { text } = withMarks(forged, [], [], "KEY")
    expect(text).not.toContain("#KEY-")
  })
  it("a checked statement that is not found in the text is handed back, not dropped", () => {
    const { unplaced } = withMarks("Other words entirely.", s.statements.slice(0, 1), s.sources, "KEY")
    expect(unplaced).toHaveLength(1)
  })
})

describe("the answer on the page", () => {
  it("a real answer: label, citations, marks only from recorded checks, sources with where they came from, and the cost", async () => {
    const { container } = await show(REAL)
    expect(screen.getByText("AI answer")).toBeInTheDocument()
    expect(container).toHaveTextContent("A second AI, from another company, checked each cited statement against its source.")
    expect(container.querySelectorAll(".md .answer-mark")).toHaveLength(4)
    expect(screen.getAllByRole("button", { name: /^Check: Holds up\./ })).toHaveLength(4)
    expect(container).not.toHaveTextContent("This proves the benefit holds for everyone") // only the final text is shown
    expect(screen.getByRole("status")).toHaveTextContent("Checked against the sources: 4 held up, 0 were proven wrong, 0 had too little evidence. A sentence without a mark was not checked.")
    const sources = within(screen.getByRole("region", { name: "Sources" }))
    expect(sources.getAllByRole("listitem")).toHaveLength(4)
    expect(sources.getAllByRole("link", { name: "Europe PMC" })[0]).toHaveAttribute("href", "https://europepmc.org")
    expect(sources.getAllByRole("link", { name: "Exa" })[0]).toHaveAttribute("href", "https://exa.ai")
    const paper = sources.getByRole("link", { name: /Semaglutide and Cardiovascular Outcomes/ })
    expect(paper).toHaveAttribute("href", "https://pubmed.ncbi.nlm.nih.gov/37952131/"); expect(paper).toHaveAttribute("target", "_blank"); expect(paper).toHaveAttribute("rel", "noopener noreferrer")
    expect(sources.getByText("Preprint: not peer reviewed")).toBeInTheDocument()
    expect(container).toHaveTextContent("It cost $0.09 and took 22 seconds. A critic raised 2 points; 2 were dealt with in one revision.")
  })
  it("pressing a mark opens the statement, the quoted passage and who checked it; pressing a citation points at its source", async () => {
    const { container } = await show(REAL)
    const user = userEvent.setup()
    await user.click(screen.getAllByRole("button", { name: /^Check: Holds up\./ })[1])
    const detail = screen.getByLabelText("The check on this statement")
    expect(detail).toHaveTextContent("The statementThe primary study is a randomized trial of 17,604 patients.")
    expect(detail).toHaveTextContent("“A total of 17,604 patients were enrolled” Found in source 1.")
    expect(detail).toHaveTextContent("Checked byopenai/gpt-4o-mini (checked on the first draft; the sentence did not change)")
    expect(within(detail).getByText("verified")).toBeInTheDocument() // the checker's own word, as secondary text
    await user.click(container.querySelector(".md .answer-cite")!)
    expect(container.querySelector(".answer-sourcelist li[data-lit]")).toHaveTextContent("Semaglutide and Cardiovascular Outcomes")
  })
  it("while it works: an honest progress line, and a draft is not shown as checked", async () => {
    const { container } = await show(REAL.filter((e) => (e.seq ?? 0) <= 3))
    expect(screen.getByRole("status")).toHaveTextContent("Searching PubMed and preprints…")
    await feed(REAL.filter((e) => (e.seq ?? 0) > 3 && (e.seq ?? 0) <= 7))
    expect(screen.getByRole("status")).toHaveTextContent("Writing…")
    expect(container).toHaveTextContent("Still being written. It has not been checked yet.")
    expect(container.querySelector(".answer-mark")).toBeNull()
    expect(screen.queryByText(/It cost/)).toBeNull()
  })
  it("a demo answer is labelled a demo, credits no search engine, and its marks are not shown as real checks", async () => {
    const { container } = await show(DEMO)
    expect(screen.getByText("Demo response")).toBeInTheDocument()
    expect(screen.queryByText("AI answer")).toBeNull()
    expect(container).toHaveTextContent("Fixed example text and example sources. No search ran and no AI model was asked.")
    expect(screen.getAllByRole("button", { name: /^Demo check: Holds up\./ }).length).toBeGreaterThan(0)
    expect(screen.queryByRole("button", { name: /^Check:/ })).toBeNull()
    expect(screen.getByRole("status")).toHaveTextContent("Demo checks, not real ones:")
    expect(container).toHaveTextContent("Example sources (practice run)")
    expect(screen.queryByRole("link", { name: "Exa" })).toBeNull(); expect(container).not.toHaveTextContent("powered by Exa")
    expect(container).toHaveTextContent("Demo: it cost nothing.")
    await userEvent.setup().click(screen.getAllByRole("button", { name: /^Demo check/ })[0])
    expect(screen.getByLabelText("The check on this statement")).toHaveTextContent("Demo: this is an example, not a real check.")
    expect(screen.getByLabelText("The check on this statement")).toHaveTextContent("Checked bynobody: demo text")
  })
  it("a search that did not run is said so with its reason, under the sources", async () => {
    await show([REAL[0], { type: "search.started", seq: 1, provider: "exa", query: "q" }, { type: "search.finished", seq: 2, provider: "exa", query: "q", ran: false, found: 0, kept: 0, reason: "the Exa spending ceiling was reached" },
      { type: "answer.written", seq: 3, markdown: "Nothing could be cited." }, { type: "research.finished", seq: 4, usd: 0.01, seconds: 3, counts: {}, searches: {} }])
    expect(screen.getByRole("region", { name: "Sources" })).toHaveTextContent("The search of the web did not run: the Exa spending ceiling was reached The answer was written without it.")
    expect(screen.getByRole("status")).toHaveTextContent("No statement in this answer was checked against a source. Nothing was found to cite, so treat this as unsourced.")
    expect(screen.queryByText(/powered by Exa/)).toBeNull() // no web search happened, so none is credited
  })
  it("says when it stopped early at a limit", async () => {
    const { container } = await show([REAL[0], { type: "answer.written", seq: 1, markdown: "Short." }, { type: "research.finished", seq: 2, usd: 0.6, seconds: 40, counts: {}, searches: {}, stopped: "cap" }])
    expect(container).toHaveTextContent("It cost $0.60 and took 40 seconds. It stopped at its spending limit, so it is shorter than planned.")
  })
  it("a failed answer shows the engine's plain message and offers to ask again", async () => {
    const onAgain = vi.fn()
    await show([REAL[0], { type: "research.failed", seq: 1, error: "The provider refused the model openai/gpt-4o-mini. Check the model name.", spentUsd: 0.02 }], { onAgain })
    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("This answer could not be finished. The provider refused the model openai/gpt-4o-mini. Check the model name. It had cost $0.02 when it stopped.")
    await userEvent.setup().click(within(alert).getByRole("button", { name: "Ask again" }))
    expect(onAgain).toHaveBeenCalled()
  })
  it("a lost connection is said, with what arrived so far", async () => {
    await show(REAL.filter((e) => (e.seq ?? 0) <= 7), { onAgain: () => {} })
    act(() => streams[0].onerror?.())
    expect(screen.getByRole("alert")).toHaveTextContent("The connection to the engine was lost while this answer was being made. What arrived so far is below.")
  })
  it("answer text is untrusted: nothing in it runs, loads or forges a mark", async () => {
    const hostile = 'Fine [1]. <img src=x onerror="window.__r=1"><script>window.__r=1</script> [go](javascript:alert(1)) ![p](https://evil.example/p.png) [check](#x-check-0)'
    const { container } = await show([REAL[0], REAL[5], { type: "answer.written", seq: 8, markdown: hostile }, { type: "research.finished", seq: 9, usd: 0, seconds: 1, counts: {}, searches: {} }])
    expect(container.querySelector("img, script, .md a")).toBeNull()
    expect(container.querySelector(".answer-mark")).toBeNull() // no check was recorded, so no mark, whatever the text says
    expect(container.querySelectorAll(".md .answer-cite")).toHaveLength(1)
    expect((window as { __r?: number }).__r).toBeUndefined()
  })
  it("Copy answer copies the text with its numbered source list", () => {
    const text = copyText(foldAnswer(REAL))
    expect(text).toContain("The mean follow-up was 39.8 months")
    expect(text).toMatch(/Sources\n\[1\] Semaglutide and Cardiovascular Outcomes.*https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/37952131\//)
  })
})

describe("asking on Search", () => {
  const home = (catalog: typeof CATALOG_ON, table: Parameters<typeof routes>[0] = {}) => {
    const sent = routes({ "GET /api/chat/catalog": { status: 200, body: catalog }, "GET /api/status": { status: 200, body: {} }, "POST /api/research": { status: 202, body: { id: "a-1", thread: "t-1", mode: "real" } }, ...table })
    render(<><TokenPrompt /><HomeView onOpen={() => {}} /></>)
    const user = userEvent.setup()
    const box = () => screen.getByRole("textbox", { name: "Ask a research question" }) as HTMLTextAreaElement
    return { sent, user, box, ask: async (q: string) => { await user.type(box(), `${q}{Enter}`) }, research: () => to(sent, "POST", "/api/research"), chats: () => to(sent, "POST", "/api/chat") }
  }
  it("Standard sends the question for a direct answer, shows it under the question, and a follow-up carries the thread", async () => {
    const t = home(CATALOG_ON, { "POST /api/research": [{ status: 202, body: { id: "a-1", thread: "t-1", mode: "real" } }, { status: 202, body: { id: "a-2", thread: "t-1", mode: "real" } }] })
    await screen.findByRole("radio", { name: "Standard" })
    await t.ask("Does semaglutide lower heart risk?")
    await waitFor(() => expect(t.research()).toHaveLength(1))
    expect(t.research()[0].body).toEqual({ question: "Does semaglutide lower heart risk?", effort: "standard" })
    expect(t.chats()).toHaveLength(0) // no plan is made for a direct answer
    await waitFor(() => expect(streams.some((s) => s.url.endsWith("/api/research/a-1/events"))).toBe(true))
    await feed(REAL, /a-1\/events$/)
    expect(within(screen.getByRole("article", { name: "Answer" })).getByText("AI answer")).toBeInTheDocument()
    await t.ask("And in people without heart disease?")
    await waitFor(() => expect(t.research()).toHaveLength(2))
    expect(t.research()[1].body).toEqual({ question: "And in people without heart disease?", effort: "standard", thread: "t-1" })
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(["You asked", "Answer", "You asked", "Answer"])
  })
  it("Quick is sent as quick; Deep keeps the team-review plan with its confirm step and sends nothing to /api/research", async () => {
    const t = home(CATALOG_ON, { "POST /api/chat": reply({ plan: PLAN }) })
    await t.user.click(await screen.findByRole("radio", { name: "Quick" }))
    expect(screen.getByText(/Quick answers on this page, with sources/)).toBeInTheDocument()
    await t.ask("q1")
    await waitFor(() => expect(t.research()).toHaveLength(1))
    expect(t.research()[0].body).toMatchObject({ effort: "quick" })
    await t.user.click(screen.getByRole("radio", { name: "Deep" }))
    expect(screen.getByText(/Deep plans a team review and asks you before anything starts: at most \$20\.00 and 1 hour\./)).toBeInTheDocument()
    await t.ask("q2")
    await waitFor(() => expect(t.chats()).toHaveLength(1))
    expect(t.research()).toHaveLength(1)
    const card = within(await screen.findByRole("region", { name: PLAN.briefTitle }))
    await t.user.click(card.getByRole("button", { name: "Start research" }))
    expect(card.getByRole("button", { name: "Start paid research" })).toBeDisabled() // the tick is still required
    expect(to(t.sent, "POST", `/api/chat/plans/${PLAN.id}/start`)).toHaveLength(0)
  })
  it("in Real mode the token is asked for, the question is kept, and it is sent again with the token", async () => {
    const t = home(CATALOG_ON, { "POST /api/research": [{ status: 401, body: { error: "needs the token", field: "token", needsToken: true, tokenFile: "glhf/runs/.token" } }, { status: 202, body: { id: "a-1", thread: "t-1", mode: "real" } }] })
    await screen.findByRole("radio", { name: "Standard" })
    await t.ask("A costly question")
    const prompt = within(await screen.findByRole("dialog"))
    expect(screen.getByText("A costly question")).toBeInTheDocument() // still on screen while the token is asked for
    await t.user.type(prompt.getByLabelText("Session token"), "s3cr3t-token-value")
    await t.user.click(prompt.getByRole("button", { name: "Use this token" }))
    await waitFor(() => expect(t.research()).toHaveLength(2))
    expect(t.research().map((r) => r.headers["x-glhf-token"])).toEqual([undefined, "s3cr3t-token-value"])
    expect(t.research()[1].body).toEqual({ question: "A costly question", effort: "standard" })
  })
  it.each([
    [{ status: 429, body: { error: "daily cap", field: "budget" } }, /Today's spending limit would be passed, so this answer was not started/],
    [{ status: 429, body: { error: "busy", field: "busy" } }, /Three answers are already being written/],
    [{ status: 429, body: { error: "slow", field: "rate" } }, /Too many questions in a short time/],
    [{ status: 500, body: { error: "the research route failed" } }, /the research route failed/],
  ])("a refusal says what to do and keeps the question in the box: %j", async (refusal, text) => {
    const t = home(CATALOG_ON, { "POST /api/research": refusal })
    await screen.findByRole("radio", { name: "Standard" })
    await t.ask("Keep me")
    await waitFor(() => expect(t.box()).toHaveAccessibleDescription(text))
    expect(t.box()).toHaveValue("Keep me")
    expect(screen.queryByRole("article")).toBeNull() // nothing was added to the thread
  })
  it("an engine that is not running: says how to start it, and keeps the question", async () => {
    const sent = routes({ "GET /api/chat/catalog": { status: 200, body: CATALOG_ON }, "GET /api/status": { status: 200, body: {} } })
    render(<HomeView onOpen={() => {}} />)
    await screen.findByRole("radio", { name: "Standard" })
    const box = screen.getByRole("textbox", { name: "Ask a research question" })
    await userEvent.setup().type(box, "Keep me{Enter}")
    await waitFor(() => expect(box).toHaveAccessibleDescription(/engine isn't running\. Start it with: npm start/))
    expect(box).toHaveValue("Keep me"); expect(to(sent, "POST", "/api/chat")).toHaveLength(0)
  })
  it("'Have a team review this' makes the existing plan for the same question; nothing starts without the confirm", async () => {
    const t = home(CATALOG_ON, { "POST /api/chat": reply({ plan: PLAN }) })
    await screen.findByRole("radio", { name: "Standard" })
    await t.ask("Does semaglutide lower heart risk?")
    await waitFor(() => expect(streams.length).toBeGreaterThan(0))
    await feed(REAL)
    await t.user.click(screen.getByRole("button", { name: "Have a team review this" }))
    await waitFor(() => expect(t.chats()).toHaveLength(1))
    expect((t.chats()[0].body as { messages: { content: string }[] }).messages.at(-1)!.content).toBe("Does semaglutide lower heart risk?")
    expect(await screen.findByRole("region", { name: PLAN.briefTitle })).toBeInTheDocument()
    expect(to(t.sent, "POST", `/api/chat/plans/${PLAN.id}/start`)).toHaveLength(0)
  })
  it("Demo mode uses the same screen, and the answer is labelled a demo", async () => {
    const t = home(CATALOG_OFF, { "POST /api/research": { status: 202, body: { id: "a-9", thread: "t-9", mode: "demo" } } })
    await screen.findByRole("radio", { name: "Standard" })
    expect(screen.getByText(/Standard answers on this page, with sources\. In Demo it is example text\./)).toBeInTheDocument()
    await t.ask("Is hERG a risk?")
    await waitFor(() => expect(streams.length).toBeGreaterThan(0))
    await feed(DEMO)
    const answer = within(screen.getByRole("article", { name: "Answer" }))
    expect(answer.getByText("Demo response")).toBeInTheDocument()
    expect(answer.queryByRole("button", { name: /^Check:/ })).toBeNull()
  })
})

describe("Saved research", () => {
  it("lists answers by their question, labelled real or demo, and reopens one on Search", async () => {
    routes({
      "GET /api/search": { status: 200, body: [
        { kind: "answer", id: "a-real", title: "Does semaglutide lower heart risk?", status: "done", startedAt: Date.now(), mode: "real", thread: "t-1", matches: [] },
        { kind: "answer", id: "a-demo", title: "Is hERG a risk for KRAS G12C inhibitors?", status: "done", startedAt: Date.now(), mode: "demo", thread: "t-2", matches: [] },
      ] },
      "GET /api/glhf/runs": { status: 200, body: [] }, "GET /api/chat/catalog": { status: 200, body: CATALOG_ON }, "GET /api/status": { status: 200, body: {} },
    })
    const onOpen = vi.fn()
    const list = render(<ExperimentsView onOpen={onOpen} />)
    const real = (await screen.findByText("Does semaglutide lower heart risk?")).closest("button")!
    expect(real).toHaveTextContent("AI answer"); expect(real).not.toHaveTextContent("Demo response")
    expect(screen.getByText("Is hERG a risk for KRAS G12C inhibitors?").closest("button")).toHaveTextContent("Demo response")
    await userEvent.setup().click(real)
    expect(onOpen).toHaveBeenCalledWith("Home")
    list.unmount()
    render(<HomeView onOpen={() => {}} />)
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(["You asked", "Answer"])
    expect(screen.getByText("Does semaglutide lower heart risk?")).toBeInTheDocument()
    await waitFor(() => expect(streams.some((s) => s.url.endsWith("/api/research/a-real/events"))).toBe(true)) // the saved answer is replayed from the engine
    await feed(REAL, /a-real\/events$/)
    expect(screen.getByText("AI answer")).toBeInTheDocument()
  })
})
