// "Try asking" near the question box, against a stand-in engine. Nothing here talks to a real engine or to Google.
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { Hero } from "@/overview/Hero"
import { STARTERS } from "@/overview/starters"
import { routes, to } from "@/test/engine"
import { TryAsking } from "./TryAsking"
import type { TryAskingReply } from "./trending"

const TRENDING: TryAskingReply = {
  source: "google-trends", fetchedAt: 1,
  items: [
    { question: "What does the latest science say about measles outbreak?", topic: "Trending: measles outbreak", trending: true },
    { question: "How do mRNA vaccines train the immune system?", topic: "Vaccines", trending: false },
  ],
}
const CURATED: TryAskingReply = { source: "curated", fetchedAt: 0, items: [{ question: "What does the gut microbiome do for human health?", topic: "Microbiome", trending: false }] }

describe("Try asking", () => {
  it("shows the engine's questions, says they are trending, and a click hands the question over", async () => {
    const sent = routes({ "GET /api/trending": { status: 200, body: TRENDING } })
    const onPick = vi.fn()
    render(<TryAsking onPick={onPick} />)
    const chip = await screen.findByRole("button", { name: TRENDING.items[0].question })
    expect(screen.getByRole("group", { name: /Try asking · Biology trending on Google Search now/ })).toBeTruthy()
    await userEvent.click(chip)
    expect(onPick).toHaveBeenCalledWith(TRENDING.items[0].question)
    expect(to(sent, "GET", "/api/trending")).toHaveLength(1)
  })

  it("curated questions are not called trending", async () => {
    routes({ "GET /api/trending": { status: 200, body: CURATED } })
    render(<TryAsking onPick={() => {}} />)
    await screen.findByRole("button", { name: CURATED.items[0].question })
    expect(screen.queryByText(/trending on Google/i)).toBeNull()
  })

  it("no engine: no row, nothing breaks", async () => {
    const sent = routes({})
    const { container } = render(<TryAsking onPick={() => {}} />)
    await waitFor(() => expect(sent.length).toBe(1))
    expect(container.textContent).toBe("")
  })

  it("on the Overview a trending question fills the box (nothing is sent); without the engine the fixed starters stay", async () => {
    routes({ "GET /api/trending": { status: 200, body: TRENDING }, "GET /api/chat/catalog": { status: 503, body: {} } })
    const first = render(<Hero onOpen={() => {}} />)
    await userEvent.click(await screen.findByRole("button", { name: TRENDING.items[0].question }))
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(TRENDING.items[0].question)
    first.unmount()

    routes({})
    render(<Hero onOpen={() => {}} />)
    expect(await screen.findByRole("button", { name: STARTERS[0].question })).toBeTruthy()
  })
})
