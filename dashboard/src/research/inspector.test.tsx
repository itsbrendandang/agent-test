// The inspector beside the Research conversation: it shows only what the answer's own record holds.
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import S_CANCELLED from "@/test/research/stream-cancelled.jsonl?raw"
import S_DEMO from "@/test/research/stream-demo.jsonl?raw"
import S_FAILED from "@/test/research/stream-failed-source.jsonl?raw"
import S_REAL from "@/test/research/stream-real.jsonl?raw"
import { Inspector } from "./Inspector"
import { InspectorPane, InspectorToggle } from "./InspectorPane"
import { loadInspector, saveInspector, tabsOf, type InspectorTab } from "./inspectorState"
import { foldAnswer, type ResearchEvent } from "./model"

const lines = (raw: string): ResearchEvent[] => raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as ResearchEvent)
function Shown({ events, first }: { events: ResearchEvent[]; first?: InspectorTab }) {
  const [tab, setTab] = useState(first)
  return <Inspector id="a-1" state={foldAnswer(events)} tab={tab} onTab={setTab} />
}
beforeEach(() => { localStorage.clear(); vi.unstubAllGlobals() })

describe("tabs", () => {
  it("exist only when they have content", () => {
    expect(tabsOf(undefined)).toEqual([])
    const real = lines(S_REAL)
    expect(tabsOf(foldAnswer(real))).toEqual(["evidence", "results", "activity"])
    const early = real.slice(0, 3) // started and preparing: no sources, no files yet
    expect(tabsOf(foldAnswer(early))).not.toContain("results")
    expect(tabsOf(foldAnswer(early))).not.toContain("evidence")
  })
  it("are a tab list that the arrow keys move through", async () => {
    const user = userEvent.setup()
    render(<Shown events={lines(S_REAL)} />)
    const tabs = within(screen.getByRole("tablist", { name: "Inspector" })).getAllByRole("tab")
    expect(tabs.map((t) => t.textContent)).toEqual(["Evidence", "Results", "Activity"])
    expect(tabs[0]).toHaveAttribute("aria-selected", "true")
    tabs[0].focus(); await user.keyboard("{ArrowRight}")
    expect(screen.getByRole("tab", { name: "Results" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tab", { name: "Results" })).toHaveFocus()
    expect(screen.getByRole("tabpanel", { name: "Results" })).toBeInTheDocument()
  })
  it("has no Agent Lab tab, even with events and steps, and an unknown remembered tab falls back to the first", () => {
    const events = lines(S_REAL)
    expect(foldAnswer(events).steps.length).toBeGreaterThan(0)
    render(<Shown events={events} first={"lab" as string as InspectorTab} />)
    expect(screen.queryByRole("tab", { name: /Agent Lab/i })).toBeNull()
    expect(screen.getByRole("tab", { name: "Evidence" })).toHaveAttribute("aria-selected", "true")
  })
})

describe("Evidence", () => {
  it("lists the sources with found, selected and cited, each credited to the search that found it, and what was left out", () => {
    const events = lines(S_REAL); const s = foldAnswer(events)
    render(<Shown events={events} />)
    const sources = within(screen.getByRole("region", { name: "Sources" }))
    expect(sources.getAllByRole("listitem").length).toBeGreaterThanOrEqual(s.sources.length)
    expect(sources.getByText(new RegExp(`${s.sources.length} selected`))).toBeInTheDocument()
    for (const src of s.sources) expect(sources.getAllByText(src.title, { exact: false }).length).toBeGreaterThan(0)
    if (s.cited) expect(sources.getAllByText("Cited in the answer").length).toBe(s.sources.filter((x) => s.cited!.includes(x.n)).length)
    for (const a of sources.getAllByRole("link")) { expect(a).toHaveAttribute("rel", "noopener noreferrer"); expect(a.getAttribute("href")).toMatch(/^https?:/) }
    if (s.selection?.notSelected.length) expect(sources.getByText(`Found but not selected (${s.selection.notSelected.length})`)).toBeInTheDocument()
  })
  it("shows each checked statement with its mark, the quoted passage, whether it was found, and who checked", () => {
    const events = lines(S_REAL); const s = foldAnswer(events)
    render(<Shown events={events} />)
    const rows = within(screen.getByRole("region", { name: "Checked statements" })).getAllByRole("listitem")
    expect(rows).toHaveLength(s.statements.length)
    const supported = s.statements.findIndex((x) => x.verdict === "verified")
    expect(rows[supported]).toHaveTextContent("Supported"); expect(rows[supported]).toHaveTextContent(/Found in source \d+\./)
    expect(rows[supported]).toHaveTextContent(`Checked by ${s.statements[supported].checker}`)
    for (const [i, st] of s.statements.entries()) if (st.verdict !== "verified") expect(rows[i]).not.toHaveTextContent("Supported") // only the engine's own verdict makes a statement Supported
  })
  it("a practice answer's checks are called examples, and nobody is named as their checker", () => {
    render(<Shown events={lines(S_DEMO)} />)
    const region = screen.getByRole("region", { name: "Checked statements" })
    expect(region).toHaveTextContent("Example checks of a practice answer, not real ones.")
    expect(region).not.toHaveTextContent("Checked by scripted")
    expect(screen.getByRole("region", { name: "Sources" })).toHaveTextContent("Example source (practice run)")
    expect(screen.getByRole("region", { name: "Sources" })).not.toHaveTextContent(/\bExa\b/)
  })
  it("shows the critic's notes with whether each was dealt with", () => {
    const events = lines(S_REAL); const s = foldAnswer(events)
    render(<Shown events={events} />)
    if (s.notes.length === 0) { expect(screen.queryByRole("region", { name: "The critic's notes" })).toBeNull(); return }
    expect(within(screen.getByRole("region", { name: "The critic's notes" })).getAllByRole("listitem")).toHaveLength(s.notes.length)
  })
})

describe("Results", () => {
  it("lists only the files the engine registered, with type and size, a download, and a preview of text on request", async () => {
    const events = lines(S_REAL); const s = foldAnswer(events)
    const fetched = vi.fn(async () => new Response("# The answer\n<script>alert(1)</script>", { status: 200 }))
    vi.stubGlobal("fetch", fetched)
    const { container } = render(<Shown events={events} first="results" />)
    const files = within(screen.getByRole("region", { name: "Files" }))
    expect(files.getAllByRole("listitem")).toHaveLength(s.artifacts.length)
    const md = files.getByText("answer.md").closest("li")!
    expect(md).toHaveTextContent(/text\/markdown · 3\.4 kB/)
    expect(within(md).getByRole("link", { name: "Download" })).toHaveAttribute("href", expect.stringMatching(/\/api\/research\/a-1\/artifacts\/answer\.md$/))
    expect(fetched).not.toHaveBeenCalled() // nothing is fetched until asked
    await userEvent.setup().click(within(md).getByRole("button", { name: "Preview" }))
    await waitFor(() => expect(md.querySelector("pre")).toHaveTextContent("# The answer"))
    expect(container.querySelector("script")).toBeNull() // a file's text is shown as text
    expect(md.querySelector("pre")).toHaveTextContent("<script>alert(1)</script>")
  })
  it("has no Results tab for an answer with no files", () => {
    const events = lines(S_REAL).filter((e) => e.type !== "artifact.created")
    render(<Shown events={events} first="results" />)
    expect(screen.queryByRole("tab", { name: "Results" })).toBeNull()
    expect(screen.getByRole("tab", { name: "Evidence" })).toHaveAttribute("aria-selected", "true") // falls back to a tab that exists
  })
})

describe("Activity", () => {
  it("shows status, time, what was spent against the run limit, and the searches that ran", () => {
    const events = lines(S_REAL); const s = foldAnswer(events)
    render(<Shown events={events} first="activity" />)
    const run = screen.getByRole("region", { name: "Run" })
    expect(run).toHaveTextContent("StatusCompleted")
    expect(run).toHaveTextContent(/Spent: (\$\d|less than 1 cent)/)
    if (s.caps) expect(run).toHaveTextContent("Run limit: $")
    expect(run).toHaveTextContent(/Searches\d+ ran:/)
    expect(run).not.toHaveTextContent(/confidence|Thought for/i)
  })
  it("a practice answer spent nothing and names no model", () => {
    render(<Shown events={lines(S_DEMO)} first="activity" />)
    const run = screen.getByRole("region", { name: "Run" })
    expect(run).toHaveTextContent("SpentNothing: a practice answer")
    expect(run).not.toHaveTextContent("Models")
  })
  it("a failed search is shown as failed, and a stopped answer as stopped", () => {
    const a = render(<Shown events={lines(S_FAILED)} first="activity" />)
    expect(screen.getByRole("region", { name: "Run" })).toHaveTextContent(/failed/i)
    a.unmount()
    render(<Shown events={lines(S_CANCELLED)} first="activity" />)
    expect(screen.getByRole("region", { name: "Run" })).toHaveTextContent("StatusStopped")
  })
})

describe("the pane", () => {
  it("remembers whether it is shown and how wide, within limits", () => {
    expect(loadInspector()).toEqual({ open: false, width: 400 })
    saveInspector({ open: true, width: 5000 })
    expect(loadInspector()).toEqual({ open: true, width: 640 })
    localStorage.setItem("research.inspector", "{not json")
    expect(loadInspector()).toEqual({ open: false, width: 400 })
  })
  it("the header button says what it does and whether the inspector is shown", async () => {
    const onToggle = vi.fn()
    const { rerender } = render(<InspectorToggle open={false} onToggle={onToggle} />)
    const button = screen.getByRole("button", { name: /Show the inspector/ })
    expect(button).toHaveAttribute("aria-pressed", "false")
    await userEvent.setup().click(button); expect(onToggle).toHaveBeenCalledTimes(1)
    rerender(<InspectorToggle open onToggle={onToggle} />)
    expect(screen.getByRole("button", { name: "Hide the inspector" })).toHaveAttribute("aria-pressed", "true")
  })
  it("beside the conversation its width changes with the arrow keys; in a narrow window it is a dialog that Escape closes", async () => {
    const user = userEvent.setup(); const onWidth = vi.fn(); const onClose = vi.fn()
    const wide = render(<InspectorPane narrow={false} width={400} onWidth={onWidth} onClose={onClose}><p>inside</p></InspectorPane>)
    expect(screen.getByRole("complementary", { name: "Inspector" })).toHaveStyle({ width: "400px" })
    screen.getByRole("separator", { name: "Inspector width" }).focus(); await user.keyboard("{ArrowLeft}")
    expect(onWidth).toHaveBeenLastCalledWith(424)
    wide.unmount()
    render(<InspectorPane narrow width={400} onWidth={onWidth} onClose={onClose}><p>inside</p></InspectorPane>)
    expect(await screen.findByRole("dialog", { name: "Inspector" })).toHaveTextContent("inside")
    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalled()
  })
})
