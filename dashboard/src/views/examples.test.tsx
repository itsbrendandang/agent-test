import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { ExperimentsView } from "./ExperimentsView"
import { takeOpenAnswer } from "@/lib/open"
import { provenanceOf } from "@/lib/provenance"
import { routes } from "@/test/engine"
import { foldAnswer, copyText } from "@/research/model"
import { answerLab, boardLab } from "@/lab/adapter"
import { answerRuns, boardRuns } from "@/lab/runs"
import { totalsOf } from "@/overview/model"
import { eventRows, logDownload } from "@/lab/logRows"
import { PRACTICE_ANSWER, PRACTICE_REVIEW } from "@/lab/fixtures/practice"

interface Entry { id: string; kind: "answer" | "board"; title: string; question?: string; status: string; startedAt: number }
const entries: Entry[] = [...Array.from({ length: 5 }, (_, i) => ({ id: `answer-${i}`, kind: "answer" as const, title: `Example question ${i}`, question: `Example question ${i}`, status: i === 4 ? "cancelled" : "done", startedAt: i })), { id: "board-example", kind: "board", title: "Example board", status: "done", startedAt: 6 }]
const hits = entries.map((e) => ({ ...e, title: e.question ?? e.title, mode: "demo", example: true, matches: [] }))
beforeEach(() => { sessionStorage.clear(); window.location.hash = "" })

it("shows six read-only cards in Examples and opens Research without starting a run", async () => {
  const sent = routes({ "GET /api/search": { status: 200, body: hits }, "GET /api/runs": { status: 200, body: [] }, "GET /api/glhf/runs": { status: 200, body: [] } })
  const onOpen = vi.fn()
  render(<ExperimentsView onOpen={onOpen} />)
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("0 records"))
  fireEvent.click(screen.getByRole("button", { name: "Examples" }))
  await waitFor(() => expect(document.querySelectorAll(".example-card")).toHaveLength(6))
  expect(screen.getAllByText("Example · practice, $0")).toHaveLength(6)
  expect(screen.getByText(/Stopped before completion/)).toBeInTheDocument()
  expect(screen.getAllByRole("link", { name: "Agent Log" })).toHaveLength(6)
  expect(screen.getAllByRole("link", { name: "View in Overview Lab" })).toHaveLength(6)
  fireEvent.click(screen.getByRole("button", { name: hits[0].title }))
  expect(onOpen).toHaveBeenCalledWith("Home")
  expect(takeOpenAnswer()).toEqual({ id: hits[0].id, question: hits[0].title })
  expect(sent.every((r) => r.method === "GET")).toBe(true)
})

it("keeps the empty and unavailable library states", async () => {
  routes({ "GET /api/search": { status: 200, body: [] } })
  const view = render(<ExperimentsView onOpen={vi.fn()} />)
  fireEvent.click(screen.getByRole("button", { name: "Examples" }))
  await waitFor(() => expect(screen.getByText(/Nothing has been researched yet/)).toBeInTheDocument())
  view.unmount()
  routes({ "GET /api/search": { status: 500, body: { error: "Library unavailable" } } })
  render(<ExperimentsView onOpen={vi.fn()} />)
  await waitFor(() => expect(screen.getByText(/Library unavailable/)).toBeInTheDocument())
})

it("preserves example provenance through pipeline events, records and downloads, excluding totals", () => {
  for (const e of entries) {
    const events = (e.kind === "answer" ? PRACTICE_ANSWER : PRACTICE_REVIEW).flatMap((event) => typeof event.type === "string" ? [{ ...event, type: event.type, example: true }] : [])
    const model = e.kind === "answer" ? answerLab(events, e.id) : boardLab(events, e.id)
    expect(model.provenance).toBe("example")
    const rows = eventRows(events, e.kind)
    const run = { id: e.id, kind: e.kind, provenance: "example" as const }
    expect(logDownload(rows, run, "json")).toContain("Example · practice, $0")
    expect(logDownload(rows, run, "csv")).toContain("Example · practice, $0")
    if (e.kind === "answer") {
      const record = { ...e, mode: "demo", example: true }
      const answer = foldAnswer(events)
      expect(answer.example).toBe(true)
      expect(copyText(answer)).toMatch(/^Example · practice, \$0/)
      expect(totalsOf(answerRuns({ items: [record] })).all).toBe(0)
    } else expect(totalsOf(boardRuns([{ ...e, example: true }])).all).toBe(0)
  }
  expect(provenanceOf({ mode: "real", example: true })).toBe("example")
  expect(totalsOf([]).all).toBe(0)
})
