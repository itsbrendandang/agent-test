// Team review: counts that are honest about what was not checked (and why, from the check records' own notes),
// and one picture per agent, left of its label, the same picture wherever that agent is shown.
import { act, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { agentIdentity } from "@/lab/identity"
import { forgetScripted } from "@/lib/scripted"
import { uncheckedReasons } from "@/lib/verdict"
import { routes } from "@/test/engine"
import { BoardView } from "./BoardView"

const streams: { url: string; onmessage?: (m: { data: string }) => void; close: () => void }[] = []
beforeEach(() => {
  streams.length = 0; forgetScripted()
  vi.stubGlobal("EventSource", class { url: string; onmessage?: (m: { data: string }) => void; constructor(url: string) { this.url = url; streams.push(this) } close() {} })
})
const emit = (event: object) => act(() => { for (const s of streams) s.onmessage?.({ data: JSON.stringify({ key: JSON.stringify(event), at: 0, ...event }) }) })

// The notes are the engine's own, copied from the first live review (202611150251-kras-g12c-hit-to-lead).
const NOT_RUN = "computed claim not re-executed: the Claude Code checker runs --restricted and cannot run code (see checkers.claude_code_tools)"
const BUDGET_A = "escalation budget used up (first pass: the quoted passage is not in the source)"
const BUDGET_B = "escalation budget used up (first pass: the quoted passage does not contain the claim's numbers)"
const ROSTER = [
  { name: "lead-scientist", title: "Lead Scientist", role: "lead", model: "lead", modelId: "m", tools: [] },
  { name: "scout", title: "Scout (Data and Evidence)", role: "member", model: "cheap", modelId: "m", tools: [] },
  { name: "critic", title: "Critic (Scientific Reviewer)", role: "member", model: "rival", modelId: "m", tools: [] },
]
async function open() {
  routes({
    "GET /api/status": { status: 200, body: { mock: false, paidCalls: true, keys: {}, meeting: { max_minutes: 15, max_usd: 5, max_rounds: 4, max_searches: 20, max_literature_searches: 20 } } },
    "GET /api/roster": { status: 200, body: ROSTER }, "GET /api/briefs": { status: 200, body: ["kras.md"] },
    "GET /api/runs": { status: 200, body: [{ id: "run-1", brief: "kras.md", rounds: 1, startedAt: 1, status: "done", claims: 9 }] },
    "GET /api/runs/run-1/memo": { status: 200, body: "" },
  })
  render(<BoardView />)
  await waitFor(() => expect(streams.length).toBeGreaterThan(0))
  await emit({ type: "run.started", runId: "run-1", brief: "kras", title: "KRAS G12C hit-to-lead", mock: false })
  await emit({ type: "run.roster", members: [...ROSTER.map((m) => ({ name: m.name, title: m.title, role: m.role, source: "board" })), { name: "medicinal-chemist", title: "Medicinal Chemist", role: "member", source: "specialist" }] })
  await emit({ type: "round.started", round: 1, message: "Round 1.", final: false })
  await emit({ type: "evidence.triaged", member: "scout", query: "KRAS G12C hERG", kept: 1, dropped: 2, provider: "exa", items: [{ url: "https://example.org/a", title: "A", relevance: 1, provider: "exa" }] })
  await emit({ type: "member.replied", round: 1, member: "scout", text: "In short: the margin is thin." })
  await emit({ type: "member.replied", round: 1, member: "critic", text: "In short: not shown." })
  const claim = (i: number, verdict: string, note?: string) => emit({ type: "claim.checked", round: 1, member: i % 2 ? "scout" : "critic", claim: `statement ${i}`, kind: "brief", verdict, checker: "first-pass", source: "brief", note })
  await claim(1, "verified", 'quoted: "x"'); await claim(2, "verified"); await claim(3, "unsupported", "source is not in the screened evidence pool")
  await claim(4, "unchecked", NOT_RUN); await claim(5, "unchecked", NOT_RUN); await claim(6, "unchecked", NOT_RUN)
  await claim(7, "unchecked", BUDGET_A); await claim(8, "unchecked", BUDGET_B)
  await claim(9, "unchecked", "the checker timed out after 90 seconds")
  await emit({ type: "run.finished", usd: 1.2, minutes: 4 })
}

describe("counts that are honest about what was not checked", () => {
  it("says how many of the statements were checked, never a bare total, and never that all were", async () => {
    await open()
    expect(screen.getByRole("status")).toHaveTextContent("The team has decided. 2 team members made 9 statements; 3 of them were checked.")
    const found = within(screen.getByRole("group", { name: "What the checks found" }))
    expect(found.getByTestId("checked-count")).toHaveTextContent("3 of 9 statements checked.")
    expect(found.getByText("2 supported")).toBeInTheDocument(); expect(found.getByText("0 contradicted")).toBeInTheDocument()
    expect(found.getByText("1 insufficient evidence")).toBeInTheDocument(); expect(found.getByText("6 not checked")).toBeInTheDocument()
    expect(screen.getByRole("region", { name: "What happened" })).not.toHaveTextContent(/every statement|all statements|9 statements checked/i)
  })
  it("gives each reason with its count, built from the check records' own notes, and the counts add up", async () => {
    await open()
    const why = screen.getByTestId("unchecked-why")
    expect(why).toHaveTextContent("Of the 6 not checked: 3 are calculations, which the checker does not re-run; 2 were left when the second-check budget ran out; 1 was not checked (the record says: “the checker timed out after 90 seconds”).")
    const parts = [...why.querySelectorAll("span[title]")]
    expect(parts.map((p) => p.getAttribute("title"))).toEqual([`The check's own note: ${NOT_RUN}`, `The check's own note: ${BUDGET_A}`, "The check's own note: the checker timed out after 90 seconds"])
  })
  it("the grouping is by the note's own first clause; a note the page does not know is quoted, not paraphrased", () => {
    const rows = [
      ...Array(75).fill({ verdict: "unchecked", note: NOT_RUN }), ...Array(29).fill({ verdict: "unchecked", note: BUDGET_A }), { verdict: "unchecked", note: BUDGET_B },
      ...Array(71).fill({ verdict: "verified" }), ...Array(28).fill({ verdict: "unsupported", note: "" }),
    ]
    const why = uncheckedReasons(rows)
    expect(why.map((w) => [w.n, w.plain])).toEqual([[75, "are calculations, which the checker does not re-run"], [30, "were left when the second-check budget ran out"]])
    expect(why.reduce((n, w) => n + w.n, 0)).toBe(105) // 204 statements, 99 checked, 105 not: every one has a reason group
    expect(uncheckedReasons([{ verdict: "unchecked" }, { verdict: "untested", note: "  " }]).map((w) => [w.n, w.plain])).toEqual([[2, "have no reason recorded"]])
    expect(uncheckedReasons([{ verdict: "unchecked", note: "quota exceeded: try later" }])[0].plain).toBe("was not checked (the record says: “quota exceeded”)")
    expect(uncheckedReasons([{ verdict: "verified" }, { verdict: "contradicted" }])).toEqual([])
  })
})

describe("one picture per agent, left of its label", () => {
  it("the member list shows the run's own roster with each member's picture and the engine's title", async () => {
    await open()
    const members = within(screen.getByRole("list", { name: "Who took part" })).getAllByRole("listitem")
    expect(members.map((li) => li.querySelector(".board-who > span")!.textContent)).toEqual(["Scout", "Critic", "Medicinal Chemist"]) // the specialist is in the run's own roster
    for (const [i, name] of ["scout", "critic", "medicinal-chemist"].entries()) {
      const face = members[i].querySelector("svg[data-agent]")!
      expect(face).toHaveAttribute("data-agent", name)
      expect(members[i].firstElementChild).toBe(face) // the picture is first: left of the label
      const who = agentIdentity(name)
      expect(face).toHaveAttribute("data-face", `${who.shape}:${who.colour}`)
      expect(face).toHaveAttribute("aria-hidden", "true") // decoration: the label is the text beside it
    }
  })
  it("a search step carries the searcher's picture, the same one as on that member's row and message", async () => {
    await open()
    const step = screen.getByRole("note", { name: "Scout searched" })
    const face = step.querySelector("svg[data-agent]")!
    expect(step.firstElementChild).toBe(face)
    const inList = screen.getByRole("list", { name: "Who took part" }).querySelector('svg[data-agent="scout"]')!
    expect(face.getAttribute("data-face")).toBe(inList.getAttribute("data-face"))
    const inMessage = screen.getByRole("article", { name: "Scout" }).querySelector("svg[data-agent]")
    if (inMessage) expect(inMessage.getAttribute("data-face")).toBe(face.getAttribute("data-face"))
    expect(new Set([...document.querySelectorAll('svg[data-agent="scout"]')].map((f) => f.getAttribute("data-face"))).size).toBe(1) // never a second, different face
  })
  it("a source's screening result is a word with an explanation, not a number", async () => {
    await open()
    const sources = within(screen.getByRole("region", { name: "Sources" }))
    expect(sources.getByTestId("screened")).toHaveTextContent(/^Relevant$/)
    expect(screen.getByRole("region", { name: "Sources" })).not.toHaveTextContent(/relevance \d|0 to 1/)
  })
})
