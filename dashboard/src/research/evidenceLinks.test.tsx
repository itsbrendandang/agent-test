// A source or a checked statement chosen in an answer is shown in the inspector's Evidence tab, and one chosen there is
// lit in the answer: the two panels of Research show the same thing for the same answer. The answer links to its
// Agent Log.
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { forgetScripted } from "@/lib/scripted"
import { routes } from "@/test/engine"
import { CATALOG_OFF } from "@/test/home"
import S_DEMO from "@/test/research/stream-demo.jsonl?raw"
import { HomeView } from "@/views/HomeView"
import { foldAnswer, type ResearchEvent } from "./model"

const EVENTS = S_DEMO.split("\n").filter(Boolean).map((l) => JSON.parse(l) as ResearchEvent)
const ID = "a-1"
const streams: { url: string; onmessage?: (m: { data: string }) => void; onerror?: () => void; close: () => void }[] = []
const wide = window.innerWidth
beforeEach(() => {
  streams.length = 0; forgetScripted(); localStorage.clear(); sessionStorage.clear()
  vi.stubGlobal("EventSource", class { url: string; onmessage?: (m: { data: string }) => void; onerror?: () => void; constructor(url: string) { this.url = url; streams.push(this) } close() {} })
  routes({ "GET /api/chat/catalog": { status: 200, body: CATALOG_OFF }, [`GET /api/research/${ID}`]: { status: 200, body: { id: ID, thread: "t-1", question: "Is hERG a risk?" } }, "GET /api/research": { status: 200, body: { items: [] } } })
  sessionStorage.setItem("open.answer", JSON.stringify({ id: ID, question: "Is hERG a risk?" }))
})
afterEach(() => { Object.defineProperty(window, "innerWidth", { configurable: true, value: wide }) })
const open = async (width: number) => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width })
  render(<HomeView onOpen={() => {}} />)
  await waitFor(() => expect(streams.some((s) => s.url.endsWith(`/api/research/${ID}/events`))).toBe(true))
  act(() => { for (const s of streams.filter((x) => x.url.includes(ID))) for (const e of EVENTS) s.onmessage?.({ data: JSON.stringify(e) }) })
  return screen.getByRole("article", { name: "Answer" })
}
const s = foldAnswer(EVENTS)
const cited = s.statements.find((x) => x.sources.length > 0)!

describe("an answer and its inspector", () => {
  it("a citation opens the Evidence tab on that source, lit in both lists", async () => {
    const answer = await open(1400)
    expect(screen.queryByRole("tablist", { name: "Inspector" })).toBeNull() // closed until something is chosen
    const n = cited.sources[0]
    await userEvent.setup().click(within(answer.querySelector(".answer-text") as HTMLElement).getAllByRole("button", { name: `Source ${n}` })[0])
    expect(await screen.findByRole("tab", { name: "Evidence" })).toHaveAttribute("aria-selected", "true")
    const panel = screen.getByRole("tabpanel", { name: "Evidence" })
    const lit = panel.querySelector(".inspector-sources > li[data-lit]")!
    expect(lit).toHaveTextContent(s.sources.find((x) => x.n === n)!.title.replace(/\s*\((?:mock|demo|scripted)\)\s*$/i, "").slice(0, 20))
    expect(answer.querySelector(`.answer-sourcelist > li[data-lit] .source-n`)).toHaveTextContent(String(n))
  })
  it("a statement chosen in the inspector opens its check in the answer, and a source chosen there is lit in the answer", async () => {
    const answer = await open(1400)
    await userEvent.setup().click(within(answer).getByRole("button", { name: "Inspect the evidence" }))
    const panel = within(await screen.findByRole("tabpanel", { name: "Evidence" }))
    await userEvent.setup().click(panel.getByRole("button", { name: `Show in the answer: ${cited.text.length > 60 ? `${cited.text.slice(0, 59)}…` : cited.text}` }))
    expect(answer.querySelector(".answer-check")).toHaveTextContent(cited.text)
    expect(document.querySelector(".inspector-statements > li[data-lit]")).toHaveTextContent(cited.text)
    const other = s.sources.at(-1)!.n
    await userEvent.setup().click(panel.getByRole("button", { name: `Show source ${other} in the answer` }))
    expect(answer.querySelector(".answer-sourcelist > li[data-lit] .source-n")).toHaveTextContent(String(other))
  })
  it("a check opened in the answer can be shown in the inspector", async () => {
    const answer = await open(1400)
    const user = userEvent.setup()
    await user.click(within(answer).getAllByRole("button", { name: /^(Example check|Check): .*Show the quoted passage/ })[0])
    await user.click(within(answer).getByRole("button", { name: "Show this check in the inspector" }))
    expect(await screen.findByRole("tab", { name: "Evidence" })).toHaveAttribute("aria-selected", "true")
    expect(document.querySelector(".inspector-statements > li[data-lit]")).not.toBeNull()
  })
  it("on a narrow window a citation stays in the answer and does not open a drawer over it", async () => {
    const answer = await open(800)
    await userEvent.setup().click(within(answer.querySelector(".answer-text") as HTMLElement).getAllByRole("button", { name: `Source ${cited.sources[0]}` })[0])
    expect(screen.queryByRole("tablist", { name: "Inspector" })).toBeNull()
    expect(answer.querySelector(".answer-sourcelist > li[data-lit]")).not.toBeNull()
  })
  it("the answer links to its Agent Log", async () => {
    const answer = await open(1400)
    expect(within(answer).getByRole("link", { name: "Open in the Agent Log" })).toHaveAttribute("href", `#Lab/answer/${ID}`)
  })
})
