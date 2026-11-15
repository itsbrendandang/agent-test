// Team review: counts that are honest about what was not checked (and why, from the check records' own notes),
// and one picture per agent, left of its label, the same picture wherever that agent is shown.
import { act, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { agentIdentity } from "@/lab/identity"
import { forgetScripted } from "@/lib/scripted"
import { uncheckedReasons } from "@/lib/verdict"
import { routes } from "@/test/engine"
import { leadSentence } from "@/lib/words"
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
    const found = within(screen.getByRole("group", { name: "What the checks found" }))
    expect(found.getByTestId("checked-count")).toHaveTextContent("3 of 9 statements checked.")
    // the count is said once: in the row with the marks, not in a headline above it as well
    expect((screen.getByRole("region", { name: "What happened" }).textContent!.match(/statements checked|of them were checked/g) ?? [])).toHaveLength(1)
    expect(found.getByText("2 supported")).toBeInTheDocument(); expect(found.getByText("0 contradicted")).toBeInTheDocument()
    expect(found.getByText("1 insufficient evidence")).toBeInTheDocument(); expect(found.getByText("6 not checked")).toBeInTheDocument()
    expect(screen.getByRole("region", { name: "What happened" })).not.toHaveTextContent(/every statement|all (of the )?statements|(?<!of )9 statements checked/i)
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
      expect(members[i].firstElementChild!.firstElementChild).toBe(face) // the picture is first: left of the label
      expect(members[i].firstElementChild).toHaveAttribute("href", expect.stringMatching(new RegExp(`^#Lab/board/[\\w.-]+\\?agent=${name}$`))) // and opens its messages in the Agent Log
      const who = agentIdentity(name)
      expect(face).toHaveAttribute("data-face", `${who.shape}:${who.colour}`)
      expect(face).toHaveAttribute("aria-hidden", "true") // decoration: the label is the text beside it
    }
  })
  it("a search step names the searcher, and that member's picture is the same in the member list and in the discussion", async () => {
    await open()
    const step = screen.getByRole("list", { name: "Run events" }).querySelector(".chat-note[data-kind='search']")!
    expect(step).toHaveTextContent("Scout (Data and Evidence)")
    const inList = screen.getByRole("list", { name: "Who took part" }).querySelector('svg[data-agent="scout"]')!
    const inMessage = screen.getByRole("list", { name: "Run events" }).querySelector('.chat-msg svg[data-agent="scout"]')!
    expect(inMessage.getAttribute("data-face")).toBe(inList.getAttribute("data-face"))
    expect(new Set([...document.querySelectorAll('svg[data-agent="scout"]')].map((f) => f.getAttribute("data-face"))).size).toBe(1) // never a second, different face
  })
  it("a source's screening result is a word with an explanation, not a number", async () => {
    await open()
    const sources = within(screen.getByRole("region", { name: "Sources" }))
    expect(sources.getByTestId("screened")).toHaveTextContent(/^Relevant$/)
    expect(screen.getByRole("region", { name: "Sources" })).not.toHaveTextContent(/relevance \d|0 to 1/)
  })
})

describe("the page leads with the recommendation, then the counts", () => {
  it("shows what the team recommends first, the count once in the row with the marks, and no second headline", async () => {
    const MEMO = "# Memo\n\n## Decision\n- Go with conditions: advance CMP-0423. Park CMP-0517.\n\n## Rationale\nThe hERG margin is thin.\n"
    routes({
      "GET /api/status": { status: 200, body: { mock: true, paidCalls: false, keys: {}, meeting: { max_minutes: 15, max_usd: 5, max_rounds: 4 } } },
      "GET /api/roster": { status: 200, body: ROSTER }, "GET /api/briefs": { status: 200, body: ["kras.md"] },
      "GET /api/runs": { status: 200, body: [{ id: "run-1", brief: "chat-should-we-take-a-kras-g12c-inhibitor-candidat-1c582a84.md", rounds: 1, startedAt: new Date("2026-11-14T21:32:00").getTime(), status: "done", claims: 2 }] },
    })
    const plain = globalThis.fetch // the memo is Markdown text, not JSON
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => (/\/api\/runs\/run-1\/memo$/.test(String(url)) ? Promise.resolve(new Response(MEMO, { status: 200 })) : plain(url, init))))
    render(<BoardView />)
    await waitFor(() => expect(streams.length).toBeGreaterThan(0))
    await emit({ type: "run.started", runId: "run-1", brief: "chat", title: "Should we take a KRAS G12C inhibitor candidate with a hERG signal forw", mock: true })
    await emit({ type: "round.started", round: 1, message: "Round 1.", final: false })
    await emit({ type: "member.replied", round: 1, member: "scout", text: "In short: thin margin." })
    await emit({ type: "claim.checked", round: 1, member: "scout", claim: "a", kind: "brief", verdict: "verified", checker: "first-pass", source: "brief" })
    await emit({ type: "claim.checked", round: 1, member: "scout", claim: "b", kind: "brief", verdict: "unsupported", checker: "first-pass", source: "brief" })
    await emit({ type: "memo.written", path: "memo.md", decision: "Go with conditions" })
    await emit({ type: "run.finished", usd: 0, minutes: 0.1 })
    const story = screen.getByRole("region", { name: "What happened" })
    const card = await within(story).findByRole("group", { name: "Decision" })
    expect(card).toHaveTextContent("Go with conditions: advance CMP-0423.")
    const counts = within(story).getByRole("group", { name: "What the checks found" })
    expect(card.compareDocumentPosition(counts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy() // recommendation, then counts
    expect(within(story).queryByRole("status")).toBeNull() // no "The team has decided…" above it
    expect(story).not.toHaveTextContent(/The team has decided|of them were checked/)
    expect((story.textContent!.match(/2 of 2 statements checked/g) ?? [])).toHaveLength(1)
    // a title the engine cut inside a word is shown up to its last whole word, with an ellipsis
    expect(within(story).getByRole("heading", { level: 2 })).toHaveTextContent(/^Should we take a KRAS G12C inhibitor candidate with a hERG signal…$/)
    // the picker: a title cut at a word, the date and time, and no state for a run that is simply done
    expect(within(screen.getByRole("combobox", { name: "Review to show" })).getByRole("option", { selected: true })).toHaveTextContent(/^Should we take a kras g12c inhibitor… · 14 Nov 21:32$/)
    // what a new review would be: one short line, no key names
    expect(screen.getByTestId("next-mode")).toHaveTextContent(/^New reviews are practice runs in Demo mode\.$/)
    expect(document.body).not.toHaveTextContent(/key missing|board reviews/i)
  })
})

describe("the recommendation is one sentence to scan", () => {
  it("cuts at the first sentence end, and not inside a number or an abbreviation", () => {
    expect(leadSentence("No-Go for both. Neither passes all four criteria.")).toEqual(["No-Go for both.", "Neither passes all four criteria."])
    expect(leadSentence("CMP-0423 fails at 180 nM, a 1.8x gap. It passes solubility.")).toEqual(["CMP-0423 fails at 180 nM, a 1.8x gap.", "It passes solubility."])
    expect(leadSentence("Go with conditions")).toEqual(["Go with conditions", ""])
  })
})
