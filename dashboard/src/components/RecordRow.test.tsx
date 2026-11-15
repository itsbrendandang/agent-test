// The shared row and list, and the grouping rule behind "N runs, latest …".
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { groupRecords, stamp } from "@/lib/records"
import { RecordList, RecordRow, type RecordItem } from "./RecordRow"

const at = (d: string) => new Date(d).getTime()
const item = (over: Partial<RecordItem> = {}): RecordItem => ({ key: "k", title: "Is hERG a risk for KRAS G12C inhibitors?", type: "Answer", when: at("2026-11-14T21:02:00"), ...over })

describe("a row", () => {
  it("shows the title in full in its tooltip, the type, date and time, the record's own badge, and one Open", async () => {
    const onOpen = vi.fn()
    const long = "A very long question about whether the lead compound, at the dose proposed for the first study, keeps a safety margin over hERG ".repeat(3).trim()
    render(<ul><RecordRow item={item({ title: long, provenance: "practice", onOpen })} /></ul>)
    const row = screen.getByRole("listitem")
    expect(within(row).getByText(long).closest("[title]")).toHaveAttribute("title", long) // wraps to two lines in CSS; nothing is lost
    expect(row).toHaveTextContent("Answer")
    expect(within(row).getByText("14 Nov 21:02").tagName).toBe("TIME")
    expect(row.querySelector("[data-provenance]")).toHaveTextContent(/^Practice$/)
    const buttons = within(row).getAllByRole("button")
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveTextContent(/^Open$/)
    expect(buttons[0]).toHaveAccessibleName(`Open: ${long}`)
    await userEvent.setup().click(buttons[0])
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
  it("shows a status only when the record is not simply done, and a result only when it has one", () => {
    const { rerender } = render(<ul><RecordRow item={item({ status: "done" })} /></ul>)
    expect(screen.queryByText("done")).toBeNull()
    expect(document.querySelector(".record-result")).toBeNull()
    rerender(<ul><RecordRow item={item({ status: "failed", result: "Go with conditions" })} /></ul>)
    expect(screen.getByText("failed")).toBeInTheDocument()
    expect(screen.getByText("Go with conditions")).toBeInTheDocument()
  })
  it("shows nothing about provenance while the record has not said", () => {
    render(<ul><RecordRow item={item({ provenance: undefined })} /></ul>)
    expect(document.querySelector("[data-provenance]")).toBeNull()
  })
  it("an outside source shows its identifier and opens in a new tab, as a link", () => {
    render(<ul><RecordRow item={item({ n: 2, title: "Sotorasib in KRAS G12C lung cancer", type: "PubMed", identifier: "PMID 37952131", href: "https://pubmed.ncbi.nlm.nih.gov/37952131/" })} /></ul>)
    expect(screen.getByText("PMID 37952131")).toHaveClass("mono")
    expect(screen.getByLabelText("Source 2")).toHaveTextContent("2")
    const link = screen.getByRole("link", { name: /^Open: Sotorasib/ })
    expect(link).toHaveAttribute("href", "https://pubmed.ncbi.nlm.nih.gov/37952131/")
    expect(link).toHaveAttribute("target", "_blank"); expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"))
  })
  it("keeps untrusted title text as text", () => {
    const { container } = render(<ul><RecordRow item={item({ title: '<img src=x onerror="window.__pwned=1"> KRAS' })} /></ul>)
    expect(container.querySelector("img")).toBeNull()
    expect(screen.getByRole("listitem")).toHaveTextContent('<img src=x onerror="window.__pwned=1"> KRAS')
  })
  it("a row with history says how many runs and when the latest was, and opens the earlier ones", async () => {
    const history = [1, 2, 3, 4].map((n) => item({ key: `old-${n}`, when: at(`2026-11-1${n}T08:00:00`), onOpen: vi.fn() }))
    render(<ul><RecordRow item={item({ history })} /></ul>)
    const fold = screen.getByText((_, el) => el?.tagName === "SUMMARY" && /^5 runs, latest 14 Nov 21:02$/.test(el.textContent ?? ""))
    await userEvent.setup().click(fold)
    const earlier = within(screen.getByRole("list", { name: /^Earlier runs of:/ }))
    expect(earlier.getAllByRole("listitem")).toHaveLength(3) // three, then the rest on request
    await userEvent.setup().click(screen.getByRole("button", { name: "View all 4 earlier runs" }))
    expect(earlier.getAllByRole("listitem")).toHaveLength(4)
  })
})

describe("a list", () => {
  const five = [1, 2, 3, 4, 5].map((n) => item({ key: `r${n}`, title: `Record ${n}` }))
  it("shows three rows, then View all N, and folds again", async () => {
    render(<RecordList items={five} label="Matching saved research" />)
    const list = within(screen.getByRole("list", { name: "Matching saved research" }))
    expect(list.getAllByRole("listitem").map((li) => li.querySelector(".record-titletext")!.textContent)).toEqual(["Record 1", "Record 2", "Record 3"])
    const all = screen.getByRole("button", { name: "View all 5 results" })
    expect(all).toHaveAttribute("aria-expanded", "false")
    await userEvent.setup().click(all)
    expect(list.getAllByRole("listitem")).toHaveLength(5)
    await userEvent.setup().click(screen.getByRole("button", { name: "Show fewer" }))
    expect(list.getAllByRole("listitem")).toHaveLength(3)
  })
  it("has no View all when everything is shown, and says the order only when told to", () => {
    render(<RecordList items={five.slice(0, 3)} label="Sources" order="Newest first" />)
    expect(screen.queryByRole("button", { name: /View all/ })).toBeNull()
    expect(screen.getByText("Newest first")).toBeInTheDocument()
  })
})

describe("grouping", () => {
  interface Run { id: string; brief?: string; at: number }
  const runs: Run[] = [
    { id: "a1", brief: "kras-g12c-hit-to-lead", at: 5 }, { id: "a2", brief: "kras-g12c-hit-to-lead", at: 9 }, { id: "a3", brief: "kras-g12c-hit-to-lead", at: 1 },
    { id: "b1", brief: "kras-g12c-hit-to-lead-2", at: 7 }, // a similar name is another brief
    { id: "c1", brief: "chat-should-we-advance-a-kras-g12c-hit-that-h-1c582a84", at: 8 }, { id: "c2", brief: "chat-should-we-advance-a-kras-g12c-hit-that-h-1060e203", at: 6 },
    { id: "n1", at: 4 }, { id: "n2", at: 3 }, // no brief known: each stands alone
  ]
  const groups = groupRecords(runs, (r) => r.brief, (r) => r.at)
  it("puts runs of the same brief in one group, newest as the head, the others as its history newest first", () => {
    const kras = groups.find((g) => g.latest.id === "a2")!
    expect(kras.history.map((r) => r.id)).toEqual(["a1", "a3"])
  })
  it("never groups on a similar name, and never groups records whose brief is not known", () => {
    for (const alone of ["b1", "c1", "c2", "n1", "n2"]) expect(groups.find((g) => g.latest.id === alone)!.history).toEqual([])
  })
  it("loses no record and orders the groups by their newest record", () => {
    expect(groups.flatMap((g) => [g.latest, ...g.history]).map((r) => r.id).sort()).toEqual(runs.map((r) => r.id).sort())
    expect(groups.map((g) => g.latest.id)).toEqual(["a2", "c1", "b1", "c2", "n1", "n2"])
  })
})

describe("the date on a row", () => {
  it("is day, month and 24-hour time, with the year only when it is another year", () => {
    const now = new Date("2026-11-15T10:00:00")
    expect(stamp(at("2026-11-14T21:02:00"), now)).toBe("14 Nov 21:02")
    expect(stamp(at("2025-03-02T07:05:00"), now)).toBe("2 Mar 2025 07:05")
    expect(stamp(undefined, now)).toBe("time not recorded")
  })
})
