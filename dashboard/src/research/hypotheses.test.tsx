// The hypotheses of an answer: the map above the answer and the table in the inspector. These streams are written
// by hand in the shapes research-answer specified; the engine's own fixture replaces them when it exists.
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { Hypotheses, HypothesesTable } from "./Hypotheses"
import { HYPOTHESES_NOTE } from "./hypothesisWords"
import { Inspector } from "./Inspector"
import { tabsOf } from "./inspectorState"
import { foldAnswer, fromRecord, hypothesisDoing, type ResearchEvent } from "./model"

let seq = 0
const ev = (type: string, rest: object = {}): ResearchEvent => ({ seq: ++seq, at: seq, run: "a-1", type, ...rest } as ResearchEvent)
const H = [
  { id: "h1", text: "Drug A lowers heart attacks in people without diabetes.", supportIf: "A randomised trial shows fewer events.", contradictIf: "A randomised trial shows no difference.", origin: "planner" },
  { id: "h2", text: "The benefit is explained by weight loss alone.", supportIf: "Benefit tracks weight lost.", contradictIf: "Benefit appears before weight is lost.", origin: "user" },
]
const START = (mode = "real") => [ev("research.started", { id: "a-1", thread: "t-1", question: "Does drug A protect the heart?", effort: "standard", mode, caps: { maxUsd: 0.6, maxSeconds: 240 } }),
  ev("step.started", { step: "prepare", kind: "prepare", label: "Preparing" }), ev("step.finished", { step: "prepare", status: "completed", ms: 900 }),
  ev("step.started", { step: "hypotheses", kind: "hypothesize", label: "Setting up hypotheses to test" }), ev("step.finished", { step: "hypotheses", status: "completed", ms: 1200 }),
  ev("hypotheses", { items: H, needed: true, cut: [{ text: "A third idea.", reason: "The Standard level tests at most two." }] })]
const SOURCES = ev("sources", { items: [{ n: 1, url: "https://example.org/1", title: "Trial one", provider: "europepmc", hypotheses: ["h1"] }, { n: 2, url: "https://example.org/2", title: "Trial two", provider: "exa", hypotheses: ["h1", "h2"] }, { n: 3, url: "https://example.org/3", title: "Analysis three", provider: "europepmc", hypotheses: ["h2"] }] })
const CHECKED = [
  ev("hypothesis.checked", { id: "h1", verdict: "verified", for: [1, 2], against: [], forStatements: [0, 1], againstStatements: [], note: "2 checked statements for it from 2 sources; none against." }),
  ev("hypothesis.checked", { id: "h2", verdict: "unsupported", for: [3], against: [2], forStatements: [2], againstStatements: [3], mixed: true, note: "Checked statements on both sides." }),
]
const DONE = ev("research.finished", { usd: 0.2, seconds: 40 })
const cards = () => within(screen.getByRole("region", { name: "Hypotheses" })).getAllByRole("listitem").filter((li) => li.classList.contains("hyp-card"))

describe("the hypotheses map", () => {
  it("is not shown for an answer without hypotheses", () => {
    const { container } = render(<Hypotheses state={foldAnswer([START()[0]])} />)
    expect(container).toBeEmptyDOMElement()
  })
  it("shows the question and one card per hypothesis as soon as they are set, with no mark and no result", () => {
    render(<Hypotheses state={foldAnswer(START())} />)
    const map = screen.getByRole("region", { name: "Hypotheses" })
    expect(map).toHaveTextContent("The questionDoes drug A protect the heart?")
    expect(cards()).toHaveLength(2)
    expect(cards()[0]).toHaveTextContent("Hypothesis 1Drug A lowers heart attacks in people without diabetes.Not tested yet.")
    expect(cards()[1]).toHaveTextContent("Hypothesis 2 · as you stated it")
    expect(map.querySelector(".answer-markword")).toBeNull()
    expect(map).not.toHaveTextContent(/✓|✕|Supported|Contradicted|Insufficient/)
    expect(map).toHaveTextContent("1 more hypothesis was proposed but not tested")
    expect(map).toHaveTextContent(HYPOTHESES_NOTE); expect(HYPOTHESES_NOTE).toBe("Tested against published sources, not by experiment.")
  })
  it("says what is being done for each hypothesis only from the steps that carry its tag", () => {
    const searching = [...START(), ev("step.started", { step: "search:exa:1", kind: "search", label: "Searching the web", provider: "exa", hypothesis: "h1" })]
    expect(hypothesisDoing(foldAnswer(searching), "h1")).toBe("Searching"); expect(hypothesisDoing(foldAnswer(searching), "h2")).toBeUndefined()
    const screening = [...searching, ev("step.finished", { step: "search:exa:1", status: "completed", ms: 5, found: 3 }), ev("step.started", { step: "evaluate:exa:1", kind: "evaluate", label: "Screening 3 results", hypothesis: "h1" })]
    expect(hypothesisDoing(foldAnswer(screening), "h1")).toBe("Screening results")
    const checking = [...screening, ev("step.finished", { step: "evaluate:exa:1", status: "completed", ms: 5 }), ev("step.started", { step: "check:stance", kind: "check", label: "Checking which way 4 statements point" })]
    expect(hypothesisDoing(foldAnswer(checking), "h1")).toBe("Checking")
    expect(hypothesisDoing(foldAnswer(checking), "h2")).toBeUndefined() // nothing was searched for it: the page does not say it is being checked
    render(<Hypotheses state={foldAnswer(searching)} />)
    expect(cards()[0]).toHaveTextContent("Searching…"); expect(cards()[1]).toHaveTextContent("Not tested yet.")
  })
  it("gives a hypothesis its mark only from the engine's result, with the sources on each side opening their source row", async () => {
    const onSource = vi.fn()
    render(<Hypotheses state={foldAnswer([...START(), SOURCES, ...CHECKED, DONE])} onSource={onSource} />)
    const [one, two] = cards()
    expect(one).toHaveAttribute("data-mark", "supported")
    expect(one).toHaveTextContent("✓ Supported"); expect(one).toHaveTextContent("2 sources for, 0 against")
    expect(one).toHaveTextContent("2 checked statements for it from 2 sources; none against.")
    expect(within(one).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Source 1, for", "Source 2, for"])
    expect(one).toHaveTextContent("Againstnone")
    expect(two).toHaveAttribute("data-mark", "insufficient")
    expect(two).toHaveTextContent("? Insufficient evidence: the sources disagree"); expect(two).toHaveTextContent("1 source for, 1 against")
    await userEvent.setup().click(within(two).getByRole("button", { name: "Source 2, against" }))
    expect(onSource).toHaveBeenCalledWith(2)
  })
  it("a result that arrives for one hypothesis marks that one only; one the engine never reported stays without a mark when the run ends", () => {
    render(<Hypotheses state={foldAnswer([...START(), SOURCES, CHECKED[0], DONE])} />)
    expect(cards()[0]).toHaveTextContent("Supported")
    expect(cards()[1]).toHaveTextContent("No result was recorded for this hypothesis."); expect(cards()[1].querySelector(".answer-markword")).toBeNull()
  })
  it("is the same whatever order the events arrive in, and ignores a result with a verdict it does not know", () => {
    const events = [...START(), SOURCES, ...CHECKED, DONE]
    expect(foldAnswer([...events].reverse()).hypotheses).toEqual(foldAnswer(events).hypotheses)
    const odd = foldAnswer([...START(), ev("hypothesis.checked", { id: "h1", verdict: "proven", for: [1], against: [] })])
    expect(odd.hypotheses[0].result).toBeUndefined()
  })
  it("in a practice run the results are examples: labelled, and without a check glyph or a coloured card", () => {
    render(<Hypotheses state={foldAnswer([...START("demo"), SOURCES, ...CHECKED, DONE])} />)
    const map = screen.getByRole("region", { name: "Hypotheses" })
    expect(map).toHaveTextContent("examples of a practice run")
    expect(cards()[0]).toHaveTextContent("Example result: Supported"); expect(cards()[0]).not.toHaveAttribute("data-mark")
    expect(map).not.toHaveTextContent(/✓|✕/)
  })
  it("a source number the answer does not list is shown as text, not as something to press", () => {
    render(<Hypotheses state={foldAnswer([...START(), ...CHECKED, DONE])} onSource={() => {}} />) // no sources event
    expect(within(cards()[0]).queryAllByRole("button")).toHaveLength(0); expect(cards()[0]).toHaveTextContent("For12")
  })
  it("treats hypothesis text as text", () => {
    const hostile = [START()[0], ev("hypotheses", { items: [{ id: "h1", text: "<img src=x onerror=alert(1)> [x](javascript:alert(1))", supportIf: "", contradictIf: "" }], needed: true })]
    const { container } = render(<Hypotheses state={foldAnswer(hostile)} />)
    expect(container.querySelector("img, a")).toBeNull(); expect(container).toHaveTextContent("<img src=x onerror=alert(1)>")
  })
})

describe("no hypotheses needed, and the record", () => {
  it("keeps the engine's reason when a question needed none", () => {
    const s = foldAnswer([START()[0], ev("hypotheses", { items: [], needed: false, reason: "A plain factual question." })])
    expect(s.hypotheses).toEqual([]); expect(s.hypothesesNote).toBe("A plain factual question.")
  })
  it("a saved record gives the same map as its events", () => {
    const fromEvents = foldAnswer([...START(), SOURCES, ...CHECKED, DONE]).hypotheses
    const record = { id: "a-1", thread: "t-1", question: "Does drug A protect the heart?", mode: "real", status: "done", usd: 0.2, seconds: 40,
      hypotheses: H.map((h, i) => ({ ...h, ...(CHECKED[i] as object), id: h.id })) }
    expect(fromRecord(record)?.hypotheses.map((h) => ({ id: h.id, verdict: h.result?.verdict, for: h.result?.for, mixed: h.result?.mixed })))
      .toEqual(fromEvents.map((h) => ({ id: h.id, verdict: h.result?.verdict, for: h.result?.for, mixed: h.result?.mixed })))
  })
})

describe("the inspector's Hypotheses tab", () => {
  it("exists only when the answer has hypotheses, and shows them as a table with what would support and contradict each", () => {
    const events = [...START(), SOURCES, ...CHECKED, DONE]; const s = foldAnswer(events)
    expect(tabsOf(s, events)).toContain("hypotheses"); expect(tabsOf(foldAnswer([START()[0]]), [START()[0]])).not.toContain("hypotheses")
    render(<Inspector id="a-1" state={s} events={events} tab="hypotheses" onTab={() => {}} />)
    expect(screen.getByRole("tab", { name: "Hypotheses" })).toHaveAttribute("aria-selected", "true")
    const table = within(screen.getByRole("table"))
    expect(table.getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Hypothesis", "What would support it", "What would contradict it", "Result", "Sources for", "Sources against"])
    const rows = table.getAllByRole("row").slice(1)
    expect(rows[0]).toHaveTextContent("A randomised trial shows fewer events."); expect(rows[0]).toHaveTextContent("A randomised trial shows no difference.")
    expect(within(rows[0]).getAllByRole("cell").slice(-2).map((c) => c.textContent)).toEqual(["1, 2", "none"])
    expect(rows[1]).toHaveTextContent("Insufficient evidence: the sources disagree")
    expect(screen.getByRole("region", { name: "Hypotheses" })).toHaveTextContent(HYPOTHESES_NOTE)
  })
  it("before a result the table says what is recorded, not a mark", () => {
    render(<HypothesesTable state={foldAnswer(START())} />)
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1)
    expect(rows[0]).toHaveTextContent("No result recorded"); expect(rows[0].querySelector(".answer-markword")).toBeNull()
  })
})
