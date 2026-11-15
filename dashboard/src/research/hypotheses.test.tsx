// The hypotheses of an answer: the map above the answer and the table in the inspector. These streams are written
// by hand in the shapes research-answer specified; the engine's own fixture replaces them when it exists.
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import F_DEMO from "@/test/research/stream-hypotheses-demo.jsonl?raw"
import F_REAL from "@/test/research/stream-hypotheses.jsonl?raw"
import { Hypotheses, HypothesesTable } from "./Hypotheses"
import { agentName, HYPOTHESES_NOTE, testedWith } from "./hypothesisWords"
import { Inspector } from "./Inspector"
import { tabsOf } from "./inspectorState"
import { foldAnswer, fromRecord, hypothesisDoing, hypothesisWork, withMarks, type ResearchEvent } from "./model"

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
    expect(map).not.toHaveTextContent("Does drug A protect the heart?") // the question is in the header and the bubble: not a third time here
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
    expect(one).toHaveTextContent("✓ Supported"); expect(one).not.toHaveTextContent("2 sources for, 0 against") // the count is the For / Against row, once
    expect(within(one).getByText("Why").closest("details")).toHaveTextContent("2 checked statements for it from 2 sources; none against.") // the engine's sentence, one press away
    expect(within(one).getByText("Why").closest("details")).not.toHaveAttribute("open")
    expect(within(one).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Source 1, for", "Source 2, for"])
    expect(one).toHaveTextContent("Againstnone")
    expect(two).toHaveAttribute("data-mark", "insufficient")
    expect(two).toHaveTextContent("? Insufficient evidence: the sources disagree")
    await userEvent.setup().click(within(two).getByRole("button", { name: "Source 2, against" }))
    expect(onSource).toHaveBeenCalledWith(2)
  })
  it("says when a mark rests on one source only, as the engine flagged it", () => {
    const thin = ev("hypothesis.checked", { id: "h1", verdict: "contradicted", for: [], against: [3], forStatements: [], againstStatements: [2], thin: true, note: "1 checked statement from 1 source against it; none for it. It rests on one source only: a thin mark." })
    render(<Hypotheses state={foldAnswer([...START(), SOURCES, thin, CHECKED[1], DONE])} />)
    expect(cards()[0]).toHaveTextContent("Contradicted: one source only")
    expect(cards()[1]).not.toHaveTextContent("one source only") // mixed says "the sources disagree" instead
    expect(foldAnswer([...START(), SOURCES, ...CHECKED, DONE]).hypotheses[0].result?.thin).toBeUndefined()
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
  it("in a practice run a result is marked as not real by its outline and its name, without a check glyph or a coloured card", () => {
    render(<Hypotheses state={foldAnswer([...START("demo"), SOURCES, ...CHECKED, DONE])} />)
    const map = screen.getByRole("region", { name: "Hypotheses" })
    expect(map).not.toHaveTextContent(/practice|example|demo/i) // said once, beside the answer's badge
    const mark = cards()[0].querySelector(".answer-markword")!
    expect(mark).toHaveTextContent(/^Supported$/); expect(mark).toHaveAttribute("data-demo") // dashed, no colour, no glyph: not mistaken for a real result
    expect(mark).toHaveAccessibleName("Supported (practice: not a real result)")
    expect(cards()[0]).not.toHaveAttribute("data-mark")
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
    expect(tabsOf(s)).toContain("hypotheses"); expect(tabsOf(foldAnswer([START()[0]]))).not.toContain("hypotheses")
    render(<Inspector id="a-1" state={s} tab="hypotheses" onTab={() => {}} />)
    expect(screen.getByRole("tab", { name: "Hypotheses" })).toHaveAttribute("aria-selected", "true")
    const table = within(screen.getByRole("table"))
    expect(table.getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Hypothesis", "What would support it", "What would contradict it", "Result", "Sources for", "Sources against", "Worked on by"])
    const rows = table.getAllByRole("row").slice(1)
    expect(rows[0]).toHaveTextContent("A randomised trial shows fewer events."); expect(rows[0]).toHaveTextContent("A randomised trial shows no difference.")
    expect(within(rows[0]).getAllByRole("cell").slice(-3, -1).map((c) => c.textContent)).toEqual(["1, 2", "none"])
    expect(rows[1]).toHaveTextContent("Insufficient evidence: the sources disagree")
    expect(screen.getByRole("region", { name: "Hypotheses" })).toHaveTextContent(HYPOTHESES_NOTE)
  })
  it("before a result the table says what is recorded, not a mark", () => {
    render(<HypothesesTable state={foldAnswer(START())} />)
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1)
    expect(rows[0]).toHaveTextContent("No result recorded"); expect(rows[0].querySelector(".answer-markword")).toBeNull()
  })
})

// The engine's own streams, made by its real code (copies of engine/test/fixtures/research/stream-hypotheses*.jsonl).
describe("the engine's hypothesis streams", () => {
  const lines = (raw: string): ResearchEvent[] => raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as ResearchEvent)
  const real = lines(F_REAL), demo = lines(F_DEMO)
  it("real-shaped: three tested, one cut; Supported, the sources disagree, and no checked evidence", () => {
    const s = foldAnswer(real)
    expect(s.hypotheses.map((h) => h.id)).toEqual(["h1", "h2", "h3"]); expect(s.hypothesesCut).toHaveLength(1)
    render(<Hypotheses state={s} onSource={() => {}} />)
    const [one, two, three] = cards()
    expect(one).toHaveTextContent("✓ Supported")
    expect(within(one).getAllByRole("button").map((b) => b.textContent)).toEqual(["1", "4"])
    expect(two).toHaveTextContent("? Insufficient evidence: the sources disagree")
    expect(three).toHaveTextContent("? Insufficient evidence"); expect(three).not.toHaveTextContent("disagree"); expect(three).toHaveTextContent("No checked statement for or against it.")
    expect(three).toHaveTextContent("FornoneAgainstnone")
    expect(screen.getByRole("region", { name: "Hypotheses" })).toHaveTextContent("1 more hypothesis was proposed but not tested")
  })
  it("at every point of the stream a card has a mark only if the engine has reported that hypothesis's result", () => {
    for (let n = 1; n <= real.length; n++) {
      const part = real.slice(0, n); const s = foldAnswer(part)
      const reported = new Set(part.filter((e) => e.type === "hypothesis.checked").map((e) => e.id))
      for (const h of s.hypotheses) expect(!!h.result).toBe(reported.has(h.id))
    }
  })
  it("says Searching and Screening results for the hypothesis whose own step is running", () => {
    const at = (step: string) => real.slice(0, real.findIndex((e) => e.type === "step.started" && e.step === step) + 1)
    expect(hypothesisDoing(foldAnswer(at("search:exa:2")), "h2")).toBe("Searching")
    expect(hypothesisDoing(foldAnswer(at("evaluate:exa:3")), "h3")).toBe("Screening results")
    expect(hypothesisDoing(foldAnswer(at("check:stance")), "h1")).toBe("Checking")
  })
  it("places every checked statement's mark in the text, under its For: and Against: lines", () => {
    for (const events of [real, demo]) {
      const s = foldAnswer(events)
      const { unplaced, text } = withMarks(s.markdown, s.statements, s.sources, "k")
      expect(unplaced).toEqual([])
      expect(text).toContain("### H1:"); expect(text).toContain("**For:**")
    }
  })
  it("demo: the same map, labelled as examples, with no check glyph", () => {
    const s = foldAnswer(demo)
    render(<Hypotheses state={s} />)
    expect(cards()).toHaveLength(2)
    expect(cards().map((c) => c.querySelector(".answer-markword")!.getAttribute("aria-label"))).toEqual(["Supported (practice: not a real result)", "Contradicted (practice: not a real result)"])
    expect(cards()[0]).not.toHaveTextContent("Demo hypothesis:") // the engine's prefix is not repeated on every card
    expect(screen.getByRole("region", { name: "Hypotheses" })).not.toHaveTextContent(/✓|✕/)
  })
  it("the sources know which hypotheses found them, and the tagged statements their side", () => {
    const s = foldAnswer(real)
    expect(s.sources.some((x) => x.hypotheses?.includes("h1"))).toBe(true)
    expect(s.statements.filter((x) => x.hypothesis).every((x) => ["h1", "h2", "h3"].includes(x.hypothesis!))).toBe(true)
    expect(s.statements.some((x) => x.side === "against")).toBe(true)
  })
})

// The addendum: each hypothesis has its own investigator, working side by side with the others.
describe("the investigators", () => {
  const items = H.map((h, i) => ({ ...h, agent: `investigator-${i + 1}` }))
  const base = () => [START()[0], ev("hypotheses", { items, needed: true })]
  const step = (id: string, kind: string, hyp: string, agent: string, done?: object) => [ev("step.started", { step: id, kind, label: id, hypothesis: hyp, agent }), ...(done ? [ev("step.finished", { step: id, status: "completed", ms: 5, ...done })] : [])]
  it("names who does a step from the engine's id, and shows an id it does not know as it is", () => {
    expect([agentName("planner"), agentName("investigator-2"), agentName("checker"), agentName("critic"), agentName("writer"), agentName("searcher"), agentName("someone-new"), agentName(undefined)])
      .toEqual(["Planner", "Investigator 2", "Checker", "Critic", "Writer", "Searcher", "someone-new", undefined])
  })
  it("what an investigator has finished is counted from the steps tagged with its hypothesis only; the card says only what it is doing now", () => {
    const events = [...base(), ...step("search:exa:1", "search", "h1", "investigator-1", { found: 8 }), ...step("search:europepmc:1", "search", "h1", "investigator-1", { found: 5 }),
      ...step("evaluate:exa:1", "evaluate", "h1", "investigator-1", { found: 8, kept: 3 }), ...step("write:h1", "write", "h1", "investigator-1"), ...step("search:exa:2", "search", "h2", "investigator-2")]
    const s = foldAnswer(events)
    expect(hypothesisWork(s, "h1")).toBe("2 searches, 3 results kept after screening"); expect(hypothesisDoing(s, "h1")).toBe("Drafting its section")
    expect(hypothesisWork(s, "h2")).toBe(""); expect(hypothesisDoing(s, "h2")).toBe("Searching")
    render(<Hypotheses state={s} />)
    expect(cards()[0]).toHaveTextContent("Drafting its section…"); expect(cards()[1]).toHaveTextContent("Searching…")
    expect(cards()[0]).not.toHaveTextContent("Investigator") // who did what is in the activity view and the inspector's table
  })
  it("says what a hypothesis was tested with, and shows a kind it does not know as text instead of failing", () => {
    expect(testedWith({ kind: "sources" })).toBe("Tested against published sources")
    expect(testedWith({ kind: "swarm", run: "glhf-12" })).toBe("Tested on data by a team run (glhf-12)")
    expect(testedWith({ kind: "wet-lab" })).toBe("Tested by: wet-lab")
    const s = foldAnswer([...base(), ev("hypothesis.checked", { id: "h1", verdict: "verified", for: [1], against: [], agent: "investigator-1", testedBy: { kind: "wet-lab", run: "../../etc" } }), DONE])
    expect(s.hypotheses[0].result?.testedBy).toEqual({ kind: "wet-lab", run: undefined }) // a run id that is not an id is dropped
    render(<Hypotheses state={s} />)
    expect(cards()[0]).toHaveTextContent("Tested by: wet-lab"); expect(cards()[0]).toHaveTextContent("✓ Supported")
  })
})

describe("the engine's investigators, as streamed", () => {
  const lines = (raw: string): ResearchEvent[] => raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as ResearchEvent)
  it("the inspector's table names each hypothesis's investigator and its finished work; the steps name who did them", () => {
    const s = foldAnswer(lines(F_REAL))
    expect(s.hypotheses.map((h) => h.agent)).toEqual(["investigator-1", "investigator-2", "investigator-3"])
    render(<Hypotheses state={s} />)
    render(<HypothesesTable state={s} />)
    within(screen.getByRole("table")).getAllByRole("row").slice(1).forEach((row, i) => expect(row).toHaveTextContent(new RegExp(`Investigator ${i + 1}\\d+ search`)))
    expect(hypothesisWork(s, "h1")).toContain("section drafted")
    for (const st of s.steps.filter((x) => x.hypothesis)) expect(st.agent).toBe(`investigator-${st.hypothesis!.slice(1)}`) // a hypothesis's steps are its own investigator's
    expect(new Set(s.steps.map((x) => agentName(x.agent)))).toEqual(new Set(["Planner", "Investigator 1", "Investigator 2", "Investigator 3", "Writer", "Checker", "Critic", undefined]))
    expect(s.hypotheses.every((h) => h.result?.testedBy?.kind === "sources")).toBe(true)
  })
  it("says Drafting its section while an investigator's own draft step runs", () => {
    const real = lines(F_REAL); const at = real.findIndex((e) => e.type === "step.started" && e.step === "write:h1")
    expect(hypothesisDoing(foldAnswer(real.slice(0, at + 1)), "h1")).toBe("Drafting its section")
  })
})
