// Pictures beside a research answer: shown only when a source carries one (https), each linked to and credited with
// its source; an answer recorded before pictures shows no strip; a picture that does not load is left out.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ResearchAnswer } from "./Answer"
import { answerImages, foldAnswer, fromRecord, imageOf, type ResearchEvent } from "./model"
import REAL_LINES from "@/test/research/example-real.jsonl?raw"

const REAL = REAL_LINES.split("\n").filter(Boolean).map((l) => JSON.parse(l) as ResearchEvent)
const PICTURE = "https://www.example-heart-society.org/img/select.png"
/** The real-shaped stream with a picture on source 2 (a web page) and an http one on source 3, which is not shown. */
const WITH_IMAGES = REAL.map((e) => e.type !== "sources" ? e : { ...e, items: (e.items as { n: number }[]).map((s) => s.n === 2 ? { ...s, image: PICTURE } : s.n === 3 ? { ...s, image: "http://example.org/x.png" } : s) })

const streams: { url: string; onmessage?: (m: { data: string }) => void }[] = []
beforeEach(() => {
  streams.length = 0
  vi.stubGlobal("EventSource", class { url: string; onmessage?: (m: { data: string }) => void; constructor(url: string) { this.url = url; streams.push(this) } close() {} })
})
const show = async (events: ResearchEvent[]) => {
  const view = render(<ResearchAnswer id="a-1" latest />)
  await waitFor(() => expect(streams.length).toBe(1))
  await act(() => { for (const e of events) streams[0].onmessage?.({ data: JSON.stringify(e) }) })
  return view
}

describe("pictures from the sources", () => {
  it("keeps https pictures only, one per picture, in the order of the sources", () => {
    expect(imageOf(PICTURE)).toBe(PICTURE)
    for (const bad of ["http://example.org/a.png", "javascript:alert(1)", "data:image/png;base64,AA", "https://u:p@example.org/a.png", 7, undefined]) expect(imageOf(bad)).toBeUndefined()
    const s = foldAnswer(WITH_IMAGES)
    expect(s.sources.map((x) => x.image)).toEqual([undefined, PICTURE, undefined, undefined])
    expect(answerImages([...s.sources, { ...s.sources[0], n: 9, image: PICTURE }]).map((x) => x.n)).toEqual([2])
  })

  it("shows a strip linked to and credited with each source", async () => {
    await show(WITH_IMAGES)
    const strip = screen.getByRole("region", { name: "Images from the sources" })
    const img = within(strip).getByRole("img")
    expect(img).toHaveAttribute("src", PICTURE)
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer")
    expect(img.getAttribute("alt")).toMatch(/^Image from source 2: SELECT trial/)
    const link = within(strip).getByRole("link")
    expect(link).toHaveAttribute("href", "https://www.example-heart-society.org/news/select-trial-summary")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
    expect(link).toHaveTextContent("example-heart-society.org")
    fireEvent.error(img)
    expect(screen.queryByRole("region", { name: "Images from the sources" })).toBeNull()
  })

  it("an answer recorded before pictures, or with none, shows no strip and works as before", async () => {
    await show(REAL)
    expect(screen.queryByRole("region", { name: "Images from the sources" })).toBeNull()
    expect(screen.getByRole("region", { name: "Sources" })).toBeInTheDocument()
  })

  it("a reopened record keeps its pictures", () => {
    const s = fromRecord({ id: "r-1", question: "Q?", mode: "real", status: "done", answer: { markdown: "Text [1].", direct: "Text." }, sources: [{ n: 1, url: "https://example.org/page", title: "Page", provider: "exa", image: PICTURE, cited: true }], statements: [], steps: [], searches: [] })
    expect(s?.sources[0].image).toBe(PICTURE)
  })
})
