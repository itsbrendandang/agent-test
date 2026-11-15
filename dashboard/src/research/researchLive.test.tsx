// The live Agent Lab on the Research page (ResearchLive), against the engine's own example event streams and a
// stand-in EventSource. Nothing here talks to an engine.
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { answerLab } from "@/lab/adapter"
import { CHARACTERS } from "@/lab/model"
import { routes } from "@/test/engine"
import { CATALOG_OFF } from "@/test/home"
import { HomeView } from "@/views/HomeView"
import { ResearchAnswer } from "./Answer"
import type { ResearchEvent } from "./model"
import { BLINK_MS, ResearchLive } from "./ResearchLive"
// The engine's generated example streams (engine/test/fixtures/research/), made by its real pipeline with fake models.
import S_DEMO from "@/test/research/stream-demo.jsonl?raw"
import S_REAL from "@/test/research/stream-real.jsonl?raw"

const lines = (raw: string): ResearchEvent[] => raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as ResearchEvent)
const REAL = lines(S_REAL), DEMO = lines(S_DEMO)
/** A real answer while it runs: its events up to the searches, with no end. */
const RUNNING = REAL.filter((e) => (e.seq ?? 0) <= 14)

const streams: { url: string; onmessage?: (m: { data: string }) => void; close: () => void }[] = []
const motion = (reduce: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduce && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }))
beforeEach(() => {
  streams.length = 0
  vi.stubGlobal("EventSource", class { url: string; onmessage?: (m: { data: string }) => void; constructor(url: string) { this.url = url; streams.push(this) } close() {} })
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1))
  vi.stubGlobal("cancelAnimationFrame", vi.fn())
  motion(false)
})
afterEach(() => { vi.useRealTimers() })

const feed = (events: ResearchEvent[]) => act(() => { for (const s of streams) for (const e of events) s.onmessage?.({ data: JSON.stringify(e) }) })
/** The answer and the lab beside it, as the Research page puts them. */
const page = async (events: ResearchEvent[], fresh = false) => {
  const view = render(<ResearchLive answer="a-1" fresh={fresh}><ResearchAnswer id="a-1" latest /></ResearchLive>)
  await waitFor(() => expect(streams.length).toBe(1))
  await feed(events)
  return view
}
const lab = () => screen.queryByRole("complementary", { name: "Agent Lab for this answer" })
const scene = () => document.querySelector(".research-live .lab-scene")
const toggle = () => within(lab()!).getByRole("button", { name: /the lab$/ })

describe("the live Agent Lab beside the answer", () => {
  it("is shown open while the answer runs, beside the conversation, with only the teammates that have a step", async () => {
    await page(RUNNING)
    expect(lab()).toBeInTheDocument()
    expect(document.querySelector(".research-live")).toHaveAttribute("data-lab", "open")
    expect(scene()).toBeInTheDocument()
    expect(document.querySelector(".research-lab-status")).toHaveTextContent("Team at work")
    expect(toggle()).toHaveTextContent("Hide the lab")
    expect(toggle()).toHaveAttribute("aria-expanded", "true")
    // the conversation is in the same container, beside the lab
    expect(document.querySelector(".research-live-chat")).toContainElement(screen.getByText(/Live research|Practice/))
    // a teammate works only when the engine reported a step of its own; nobody else moves or says anything
    const model = answerLab(RUNNING as never[], "a-1")
    const quiet = CHARACTERS.filter((c) => { const a = model.characters[c.id]; return a.state === "idle" && a.trips.length === 0 })
    expect(quiet.length).toBeGreaterThan(0)
    expect(quiet.length).toBeLessThan(CHARACTERS.length)
    expect(CHARACTERS.some((c) => !model.characters[c.id].inRun)).toBe(true) // and some have no part in an answer at all
    for (const c of CHARACTERS) {
      const walker = document.querySelector<HTMLElement>(`[data-walker="${c.id}"]`)!
      expect(walker).toHaveAttribute("data-in-run", String(model.characters[c.id].inRun))
      expect(walker).toHaveAttribute("data-state", model.characters[c.id].state)
      if (quiet.includes(c)) {
        expect(walker).toHaveAttribute("data-state", "idle")
        expect(walker).not.toHaveAttribute("data-moving", "true")
        expect(document.querySelector(`[data-chip="${c.id}"]`)).not.toBeVisible()
      }
    }
    expect(screen.getByRole("button", { name: "Pause motion" })).toBeInTheDocument()
  })

  it("shows nothing before the engine reports a step", async () => {
    await page(REAL.filter((e) => e.type === "research.started"))
    expect(lab()).toBeNull()
    expect(document.querySelector(".research-live")).not.toHaveAttribute("data-lab")
  })

  it("folds into one line when the answer is finished, and opens again on request", async () => {
    const user = userEvent.setup()
    await page(REAL)
    expect(document.querySelector(".research-live")).toHaveAttribute("data-lab", "closed")
    expect(scene()).toBeNull()
    expect(within(lab()!).getByText("Answer finished")).toBeInTheDocument()
    expect(within(lab()!).getByText(/took part/)).toBeInTheDocument()
    expect(toggle()).toHaveAttribute("aria-expanded", "false")
    await user.click(toggle())
    expect(scene()).toBeInTheDocument()
    await user.click(toggle())
    expect(scene()).toBeNull()
  })

  it("remembers that the person closed it during a run, and then says the latest step on its one line", async () => {
    const user = userEvent.setup()
    const view = await page(RUNNING)
    await user.click(toggle())
    expect(scene()).toBeNull()
    expect(localStorage.getItem("research.lab")).toBe("closed")
    view.unmount(); streams.length = 0
    await page(RUNNING)
    expect(document.querySelector(".research-live")).toHaveAttribute("data-lab", "closed")
    expect(document.querySelector(".research-lab-latest")?.textContent).toBeTruthy()
    await user.click(toggle())
    expect(localStorage.getItem("research.lab")).toBe("open")
    expect(scene()).toBeInTheDocument()
  })

  it("clicking a teammate shows that teammate's details", async () => {
    const user = userEvent.setup()
    await page(RUNNING)
    const scout = screen.getByRole("button", { name: /^Inspect Scout:/ })
    await user.click(scout)
    expect(scout).toHaveAttribute("aria-pressed", "true")
    expect(within(screen.getByRole("complementary", { name: "Selected teammate and activity" })).getByRole("heading", { name: "Scout" })).toBeInTheDocument()
  })

  it("Pause motion is honoured and remembered", async () => {
    const user = userEvent.setup()
    await page(RUNNING)
    await user.click(screen.getByRole("button", { name: "Pause motion" }))
    expect(screen.getByRole("button", { name: "Resume motion" })).toHaveAttribute("aria-pressed", "true")
    expect(document.querySelector(".research-live .lab")).toHaveAttribute("data-paused")
    expect(localStorage.getItem("lab.paused")).toBe("true")
  })
})

describe("a practice answer, over in a blink", () => {
  it("started on this visit, it is replayed once from its recorded events, said as a replay, then folds", async () => {
    const at = DEMO.map((e) => e.at ?? 0)
    expect(Math.max(...at) - Math.min(...at)).toBeLessThan(BLINK_MS)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await page(DEMO, true)
    expect(scene()).toBeInTheDocument()
    expect(within(lab()!).getByText(/^Replay · \d+ of 45 events/)).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(scene()).toBeNull()
    expect(within(lab()!).getByRole("button", { name: "Replay" })).toBeInTheDocument()
  })

  it("restored (not started on this visit), it is not replayed by itself", async () => {
    await page(DEMO, false)
    expect(scene()).toBeNull()
  })

  it("under reduced motion it is not replayed, and the scene says motion is off", async () => {
    motion(true)
    const user = userEvent.setup()
    await page(DEMO, true)
    expect(scene()).toBeNull()
    await user.click(toggle())
    expect(screen.getByRole("button", { name: "Reduced motion enabled" })).toBeDisabled()
    expect(document.querySelector(".research-live .lab")).toHaveAttribute("data-still")
  })
})

describe("on the Research page", () => {
  it("the lab is in the page's main area with the conversation, not in the side panel", async () => {
    routes({ "GET /api/chat/catalog": { status: 200, body: CATALOG_OFF }, "GET /api/status": { status: 200, body: {} }, "POST /api/research": { status: 202, body: { id: "a-1", thread: "t-1", mode: "demo" } } })
    render(<HomeView onOpen={() => {}} />)
    const user = userEvent.setup()
    await screen.findByRole("radio", { name: "Standard" })
    await user.type(screen.getByRole("textbox", { name: "Ask a research question" }), "Is hERG a risk?{Enter}")
    await waitFor(() => expect(streams.some((s) => s.url.endsWith("/api/research/a-1/events"))).toBe(true))
    await feed(RUNNING)
    const main = screen.getByRole("region", { name: "Search" })
    expect(within(main).getByRole("complementary", { name: "Agent Lab for this answer" })).toBeInTheDocument()
    expect(within(main).getByRole("textbox", { name: "Ask a research question" }).closest(".research-live-chat")).not.toBeNull()
  })
})
