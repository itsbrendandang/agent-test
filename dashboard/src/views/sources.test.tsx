// Where sources came from, said truthfully: Exa is credited only for a live Exa search, the literature search has
// its own label, a practice run's sources are called examples, and a run recorded before the field existed still
// renders. Plus what a real run shows while it works, and when it fails at the start. All against a stand-in engine.
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SearchCredit } from "@/components/Shared"
import { CatalogPanel } from "@/home/CatalogPanel"
import { forgetScripted } from "@/lib/scripted"
import { routes } from "@/test/engine"
import { PlanCard } from "@/home/PlanCard"
import { CATALOG_ON, PLAN, SCRIPTED_PLAN } from "@/test/home"
import { BoardView } from "./BoardView"
import { HomeView } from "./HomeView"

const streams: { url: string; onmessage?: (m: { data: string }) => void; close: () => void }[] = []
beforeEach(() => {
  streams.length = 0; forgetScripted()
  vi.stubGlobal("EventSource", class { url: string; onmessage?: (m: { data: string }) => void; constructor(url: string) { this.url = url; streams.push(this) } close() {} })
})
const emit = (event: object) => act(() => { for (const s of streams) s.onmessage?.({ data: JSON.stringify({ key: JSON.stringify(event), at: 0, ...event }) }) })
const ROSTER = [
  { name: "lead-scientist", title: "Lead Scientist", role: "lead", model: "lead", modelId: "anthropic/claude-sonnet-5-5", tools: [] },
  { name: "scout", title: "Scout (Data and Evidence)", role: "member", model: "cheap", modelId: "anthropic/claude-haiku-5-5", tools: ["search"] },
]
const open = async (mock: boolean | undefined, status: "done" | "running" | "failed" = "running") => {
  routes({
    "GET /api/status": { status: 200, body: { mock: false, paidCalls: true, keys: {}, meeting: { max_minutes: 15, max_usd: 5, max_rounds: 4, max_searches: 20, max_literature_searches: 20 } } },
    "GET /api/roster": { status: 200, body: ROSTER }, "GET /api/briefs": { status: 200, body: ["kras.md"] },
    "GET /api/runs": { status: 200, body: [{ id: "run-1", brief: "kras.md", rounds: 1, startedAt: Date.now(), status, claims: 0 }] }, "GET /api/runs/run-1/memo": { status: 200, body: "" },
  })
  const view = render(<BoardView />)
  await waitFor(() => expect(streams.length).toBeGreaterThan(0))
  if (mock !== undefined) await emit({ type: "run.started", runId: "run-1", brief: "kras", title: "KRAS", mock })
  await emit({ type: "round.started", round: 1, message: "Go.", final: false })
  return view
}
const search = (provider: string | undefined, items: object[], query = "KRAS G12C hERG") => emit({ type: "evidence.triaged", member: "scout", query, kept: items.length, dropped: 2, ...(provider && { provider }), items })
const EXA_LINK = { href: "https://exa.ai", target: "_blank" }
/** The discussion is the Agent Log's chat: a search is a quiet note, and so is each statement check. */
const note = (kind: "search" | "check") => screen.getByRole("list", { name: "Run events" }).querySelector<HTMLElement>(`.chat-note[data-kind='${kind}']`)!

describe("the credit itself", () => {
  it("says exactly 'Search powered by Exa', with Exa linking to exa.ai in a new tab, and no logo", () => {
    const { container } = render(<SearchCredit provider="exa" />)
    expect(container).toHaveTextContent(/^Search powered by Exa$/)
    const link = screen.getByRole("link", { name: "Exa" })
    expect(link).toHaveAttribute("href", EXA_LINK.href); expect(link).toHaveAttribute("target", "_blank"); expect(link.getAttribute("rel")).toMatch(/noopener/)
    expect(container.querySelector("img, svg")).toBeNull()
  })
  it("labels the literature search, with Europe PMC linking to europepmc.org", () => {
    const { container } = render(<SearchCredit provider="europepmc" />)
    expect(container).toHaveTextContent(/^Found in PubMed and preprints \(Europe PMC\)$/)
    expect(screen.getByRole("link", { name: "Europe PMC" })).toHaveAttribute("href", "https://europepmc.org")
    expect(screen.getByRole("link", { name: "Europe PMC" }).getAttribute("rel")).toMatch(/noopener/)
  })
  it("calls a practice run's sources examples, and says nothing when the provider is not known", () => {
    const a = render(<SearchCredit provider="fixture" />)
    expect(a.container).toHaveTextContent(/^Example sources \(practice run\)$/)
    expect(a.container.querySelector("a")).toBeNull()
    expect(render(<SearchCredit provider={undefined} />).container).toBeEmptyDOMElement()
  })
})

describe("a review's sources", () => {
  it("a live Exa search: credited under Sources, on the search step, and beside the source in a statement's detail", async () => {
    await open(false)
    await search("exa", [{ url: "https://example.org/herg", title: "hERG margins in practice", studyType: "review", relevance: 0.5, provider: "exa" }])
    await emit({ type: "member.replied", round: 1, member: "scout", text: "In short: the margin is thin.", usd: 0.12 })
    await emit({ type: "claim.checked", round: 1, member: "scout", claim: "The margin is under 30x", kind: "literature", verdict: "verified", checker: "first-pass", source: "https://example.org/herg", note: 'quoted: "margin of 12x"', quoteFound: true })
    const step = note("search")
    expect(step.querySelector("strong")).toHaveTextContent(/^Scout$/) // who searched
    expect(step).toHaveTextContent("Searched the web for “KRAS G12C hERG”: kept 1, dropped 2.") // the query it ran and how many were kept
    expect(within(step).getByRole("link", { name: "Exa" })).toHaveAttribute("href", "https://exa.ai")
    expect(step).toHaveTextContent("Search powered by Exa")
    const sources = within(screen.getByRole("region", { name: "Sources" }))
    expect(sources.getAllByRole("link", { name: "Exa" })[0]).toHaveAttribute("href", "https://exa.ai")
    const item = sources.getByRole("link", { name: "hERG margins in practice" }).closest("li")!
    expect(item).toHaveTextContent("example.org · kind of study: review · Partly relevant") // the screening model's word, never a number
    expect(item).not.toHaveTextContent(/relevance|0\.5/)
    expect(within(item).getByTestId("screened")).toHaveAttribute("title", expect.stringContaining("not a measured score"))
    expect(within(item).getByRole("list", { name: "Statements that rest on this source" })).toHaveTextContent(/(Holds up|Supported) ?The margin is under 30xThe quoted passage was found in this source\./)
    const check = note("check")
    expect(check).toHaveTextContent("Supported: Scout's statement “The margin is under 30x”.")
    expect(check).toHaveTextContent('quoted: "margin of 12x" The quoted passage was found in the source.')
    expect(within(check).getByRole("link", { name: "https://example.org/herg" })).toHaveAttribute("href", "https://example.org/herg")
  })
  it("says when the quoted passage was not found in the source", async () => {
    await open(false)
    await search("exa", [{ url: "https://example.org/a", title: "A", provider: "exa" }])
    await emit({ type: "member.replied", round: 1, member: "scout", text: "x" })
    await emit({ type: "claim.checked", round: 1, member: "scout", claim: "c", kind: "literature", verdict: "unsupported", checker: "first-pass", source: "https://example.org/a", quoteFound: false })
    expect(within(screen.getByRole("region", { name: "Sources" })).getByText("The quoted passage was not found in the source.")).toHaveAttribute("data-found", "false")
    expect(note("check")).toHaveTextContent("The quoted passage was not found in the source.")
  })
  it("the literature search has its own label, and a preprint is marked", async () => {
    await open(false)
    await search("europepmc", [{ url: "https://europepmc.org/article/PPR/1", title: "A new KRAS inhibitor [preprint]", provider: "europepmc" }, { url: "https://europepmc.org/article/MED/2", title: "A reviewed paper", provider: "europepmc" }])
    expect(note("search")).toHaveTextContent("Searched PubMed and preprints for “KRAS G12C hERG”")
    expect(note("search")).toHaveTextContent("Found in PubMed and preprints (Europe PMC)")
    const sources = within(screen.getByRole("region", { name: "Sources" }))
    expect(sources.getByRole("link", { name: /A new KRAS inhibitor/ }).closest("li")).toHaveTextContent("Preprint: not peer reviewed")
    expect(sources.getByRole("link", { name: "A reviewed paper" }).closest("li")).not.toHaveTextContent("Preprint")
    expect(sources.queryByRole("link", { name: "Exa" })).toBeNull() // Exa is not credited for what it did not find
  })
  it("a review that used both shows both lines", async () => {
    await open(false)
    await search("exa", [{ url: "https://example.org/a", title: "A", provider: "exa" }])
    await search("europepmc", [{ url: "https://europepmc.org/b", title: "B", provider: "europepmc" }], "KRAS review")
    const lead = screen.getByRole("region", { name: "Sources" }).querySelector("p")!
    expect(lead).toHaveTextContent("Search powered by Exa.")
    expect(lead).toHaveTextContent("Found in PubMed and preprints (Europe PMC).")
  })
  it("a practice run: 'Example sources (practice run)', and Exa is never named", async () => {
    await open(true)
    await search("fixture", [{ url: "https://example.org/fixture", title: "An example source", provider: "fixture" }])
    expect(note("search")).toHaveTextContent("Searched practice example sources for “KRAS G12C hERG”")
    expect(note("search")).toHaveTextContent("Example sources (practice run)")
    const sources = screen.getByRole("region", { name: "Sources" })
    expect(sources).toHaveTextContent("Example sources (practice run)")
    expect(document.body).not.toHaveTextContent("powered by Exa")
    expect(screen.queryByRole("link", { name: "Exa" })).toBeNull()
    expect(screen.queryByTestId("search-count")).toBeNull() // example sources are not counted as web searches
  })
  it("an old practice run without the field is still not credited to Exa: it follows the run's own flag", async () => {
    await open(true)
    await search(undefined, [{ url: "https://example.org/old", title: "Old source" }])
    expect(screen.getByRole("region", { name: "Sources" })).toHaveTextContent("Example sources (practice run)")
    expect(document.body).not.toHaveTextContent("powered by Exa")
  })
  it("an old run that says neither where its sources came from nor whether it was real renders, with no credit at all", async () => {
    await open(undefined)
    await search(undefined, [{ url: "https://example.org/old", title: "Old source", studyType: "in vitro" }])
    const sources = screen.getByRole("region", { name: "Sources" })
    expect(within(sources).getByRole("link", { name: "Old source" })).toBeInTheDocument()
    expect(sources).not.toHaveTextContent(/Exa|Example sources|Europe PMC/)
  })
  it("a source's title and address are text; only an http(s) address becomes a link", async () => {
    const { container } = await open(false)
    await search("exa", [{ url: "javascript:alert(1)", title: '<img src=x onerror="window.__s=1">', provider: "exa" }, { url: "data:text/html,x", title: "", provider: "exa" }])
    const sources = screen.getByRole("region", { name: "Sources" })
    expect(sources).toHaveTextContent('<img src=x onerror="window.__s=1">')
    expect(sources).toHaveTextContent("not a web address")
    expect(container.querySelector("img, script")).toBeNull()
    const hrefs = [...sources.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "")
    expect(new Set(hrefs.filter((h) => !h.startsWith("#Graph/")))).toEqual(new Set(["https://exa.ai"])) // only the credit leaves the app
    for (const h of hrefs.filter((x) => x.startsWith("#Graph/"))) expect(h).toMatch(/^#Graph\/board\/run-1\?node=source%3A/) // "In the graph": an address inside the app, the source's text escaped
    expect((window as { __s?: number }).__s).toBeUndefined()
  })
})

describe("while a real run works, and when it cannot start", () => {
  it("shows the spend so far against the limit, and the searches against theirs", async () => {
    await open(false)
    await search("exa", [], "q1"); await search("exa", [], "q2"); await search("europepmc", [], "q3")
    await emit({ type: "member.replied", round: 1, member: "scout", text: "x", usd: 0.3 })
    await emit({ type: "member.replied", round: 1, member: "lead-scientist", text: "y", usd: 0.12 })
    const story = screen.getByRole("region", { name: "What happened" })
    expect(within(story).getByTestId("spent")).toHaveTextContent("Spent: $0.42 so far · Run limit: $5") // what was recorded, and the most the run may spend
    expect(within(story).getByTestId("search-count")).toHaveTextContent("Searching: 2 of 20 web searches, 1 of 20 literature searches")
    await emit({ type: "run.finished", usd: 0.5, minutes: 2 })
    expect(within(story).queryByTestId("spent")).toBeNull()
    expect(story).toHaveTextContent("took 2 minutes · Spent: $0.50")
    expect(within(story).getByTestId("search-count")).toHaveTextContent("Searched: 2 of 20 web searches, 1 of 20 literature searches")
  })
  it("a practice run shows no spend line", async () => {
    await open(true)
    await emit({ type: "member.replied", round: 1, member: "scout", text: "x", usd: 0 })
    expect(within(screen.getByRole("region", { name: "What happened" })).queryByTestId("spent")).toBeNull()
    expect(screen.getByRole("region", { name: "What happened" })).not.toHaveTextContent(/Spent:|Run limit:/)
  })
  it("a run that failed at the start shows the engine's plain message, what to do, and Resume", async () => {
    await open(false, "failed")
    await emit({ type: "run.failed", error: 'The provider refused the model "anthropic/claude-sonnet-9". Check the model name in board/config.yaml.' })
    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent('The provider refused the model "anthropic/claude-sonnet-9". Check the model name in board/config.yaml.')
    expect(alert).toHaveTextContent("Nothing more was spent.")
    expect(alert).toHaveTextContent("check them in Settings")
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument()
  })
})

describe("Connections: the search credit sits in the Exa row", () => {
  const panel = (search: object) => render(<CatalogPanel catalog={{ ...CATALOG_ON, search: { ...CATALOG_ON.search, ...search } } as never} onRetry={() => {}} />)
  it("credits Exa when a run started now would search with it", () => {
    panel({ provider: "exa" })
    expect(screen.getByTestId("search-credit")).toHaveTextContent("Search powered by Exa")
    expect(screen.getByTestId("search-credit").closest("li")).toHaveTextContent(/^Web search \(Exa\)/) // in the Exa row, not under Europe PMC
    expect(screen.getByRole("link", { name: "Exa" })).toHaveAttribute("href", "https://exa.ai")
  })
  it("does not in Demo", () => {
    panel({ provider: "fixture" })
    expect(screen.getByTestId("search-credit")).toHaveTextContent("Example sources (practice run): in Demo a review uses example sources, not a live web search.")
    expect(screen.queryByRole("link", { name: "Exa" })).toBeNull()
  })
  it("says nothing for an engine that does not report it", () => {
    panel({})
    expect(screen.queryByTestId("search-credit")).toBeNull()
  })
})

describe("the plan card", () => {
  const card = (plan: typeof PLAN, searchProvider: "exa" | "fixture" | undefined, paidCalls: boolean) => {
    routes({})
    return render(<PlanCard plan={{ ...plan, agents: [...plan.agents, { name: "scout", title: "Scout (Data and Evidence)", why: "Looks for sources." }] }} state={{ state: "open" }} paidCalls={paidCalls} searchProvider={searchProvider} onState={() => {}} onOpenRun={() => {}} />)
  }
  it("credits Exa when the plan has a member who searches and a run started now would use Exa", () => {
    card(PLAN, "exa", true)
    expect(screen.getByTestId("plan-search")).toHaveTextContent("The Scout looks for sources. Search powered by Exa")
  })
  it("a practice plan says example sources, never Exa", () => {
    card(SCRIPTED_PLAN, "fixture", false)
    expect(screen.getByTestId("plan-search")).toHaveTextContent("The Scout looks for sources. Example sources (practice run)")
    expect(screen.queryByRole("link", { name: "Exa" })).toBeNull()
  })
  it("a practice plan is not credited to Exa even when the engine could search with it", () => {
    card(SCRIPTED_PLAN, "exa", true)
    expect(screen.getByTestId("plan-search")).toHaveTextContent("Example sources (practice run)")
    expect(screen.queryByRole("link", { name: "Exa" })).toBeNull()
  })
  it("says nothing when the engine does not report what it would search with", () => {
    card(PLAN, undefined, true)
    expect(screen.queryByTestId("plan-search")).toBeNull()
  })
})

describe("the rows of a saved-research search", () => {
  const sse = (event: object) => `data: ${JSON.stringify({ key: "k", at: 0, ...event })}\n\n`
  it("each row can be told apart and trusted: the run's own title, when it ran, and real or practice, all from its record", async () => {
    const started = new Date(); started.setHours(16, 51, 0, 0)
    routes({
      "GET /api/chat/catalog": { status: 200, body: CATALOG_ON }, "GET /api/status": { status: 200, body: {} }, "POST /api/research": { status: 404, body: { error: "not found" } },
      "POST /api/chat": { status: 200, body: { reply: "Two reviews mention it.", mode: "keyword", runs: [
        { kind: "board", id: "b-real", title: "Drug board · chat-should-we-advance-a-kras-g12c-hit-that-h-04bb17d2", why: "contains: herg" },
        { kind: "board", id: "b-demo", title: "Drug board · chat-should-we-advance-a-kras-g12c-hit-that-h-1060e203", why: "contains: herg" },
        { kind: "swarm", id: "s-demo", title: "Task demo · swarm · mock", why: "contains: demo" },
      ] } },
      "GET /api/runs": { status: 200, body: [{ id: "b-real", brief: "x.md", rounds: 1, startedAt: started.getTime(), status: "done", claims: 0 }, { id: "b-demo", brief: "x.md", rounds: 1, startedAt: started.getTime() - 86_400_000, status: "done", claims: 0 }] },
      "GET /api/glhf/runs": { status: 200, body: [{ id: "s-demo", model: "mock", solver: "glhf", task: "demo", phase: "done", startedAt: started.getTime() }] },
    })
    const plain = globalThis.fetch
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      const m = /\/api\/runs\/(b-[a-z]+)\/events$/.exec(String(url))
      return m ? Promise.resolve(new Response(sse({ type: "run.started", runId: m[1], brief: "x", title: "Should we advance a KRAS G12C hit that has a hERG liability?", mock: m[1] === "b-demo" }), { status: 200 })) : plain(url, init)
    }))
    render(<HomeView onOpen={() => {}} />)
    await userEvent.setup().type(screen.getByRole("textbox", { name: "Ask a research question" }), "herg{Enter}")
    const rows = within(await screen.findByRole("list", { name: "Matching saved runs" }))
    await waitFor(() => expect(rows.getAllByRole("button")[0]).toHaveTextContent("Should we advance a KRAS G12C hit that has a hERG liability?")) // the real question, capitals kept, not the cut file name
    const [real, demo, team] = rows.getAllByRole("button")
    // How each was made is the shared badge (an icon and a word), read from the run's own record.
    await waitFor(() => expect(real.querySelector("[data-provenance]")).toHaveAttribute("data-provenance", "live"))
    expect(real).toHaveTextContent("Review · today at 4:51 pm"); expect(real).toHaveTextContent("Live research")
    expect(demo).toHaveTextContent("Review · yesterday at 4:51 pm"); expect(demo.querySelector("[data-provenance]")).toHaveAttribute("data-provenance", "practice")
    expect(real).toHaveAttribute("title", expect.stringContaining("Should we advance a KRAS G12C hit that has a hERG liability?")) // the whole title, if the row has to shorten it
    expect(team).toHaveTextContent("Team of nine on the demo task")
    expect(team).toHaveTextContent("One agent or a team · today at 4:51 pm"); expect(team.querySelector("[data-provenance]")).toHaveTextContent("Practice")
    for (const row of [real, demo, team]) expect(row).not.toHaveTextContent(/that h$|that h ·|04bb17d2/)
  })
})

describe("repeated runs of the same brief on Research", () => {
  const sse = (event: object) => `data: ${JSON.stringify({ key: "k", at: 0, ...event })}\n\n`
  const HOUR = 3_600_000
  const at = new Date(); at.setHours(12, 0, 0, 0)
  const RUNS = [
    { kind: "board", id: "p-new", title: "Drug board · kras-g12c-hit-to-lead", why: "contains: herg" },
    { kind: "board", id: "live-1", title: "Drug board · kras-g12c-hit-to-lead", why: "contains: herg" },
    { kind: "board", id: "p-old", title: "Drug board · kras-g12c-hit-to-lead", why: "contains: herg" },
    { kind: "board", id: "p-mid", title: "Drug board · kras-g12c-hit-to-lead", why: "contains: herg" },
    { kind: "board", id: "other", title: "Drug board · kras-g12c-hit-to-lead", why: "contains: herg" }, // the same words in its title, another brief
    { kind: "board", id: "unlisted", title: "Drug board · kras-g12c-hit-to-lead", why: "contains: herg" }, // the engine's list does not have it
    { kind: "swarm", id: "s-1", title: "Task demo · swarm · mock", why: "contains: demo" },
    { kind: "swarm", id: "s-2", title: "Task demo · swarm · mock", why: "contains: demo" },
  ]
  const LISTED = [
    { id: "p-new", brief: "kras.md", startedAt: at.getTime() }, { id: "p-mid", brief: "kras.md", startedAt: at.getTime() - HOUR }, { id: "p-old", brief: "kras.md", startedAt: at.getTime() - 2 * HOUR },
    { id: "live-1", brief: "kras.md", startedAt: at.getTime() - 3 * HOUR }, { id: "other", brief: "kras-copy.md", startedAt: at.getTime() - 4 * HOUR },
  ].map((r) => ({ ...r, rounds: 1, status: "done", claims: 0 }))
  const ask = async (mode: "keyword" | "ai" | "scripted", opts: { paidCalls?: boolean; events?: (id: string) => Promise<Response> } = {}) => {
    routes({
      "GET /api/chat/catalog": { status: 200, body: { ...CATALOG_ON, paidCalls: opts.paidCalls ?? true } }, "GET /api/status": { status: 200, body: { paidCalls: opts.paidCalls ?? true } },
      "POST /api/research": { status: 404, body: { error: "not found" } },
      "POST /api/chat": { status: 200, body: { reply: "A reply.", mode, runs: RUNS } },
      "GET /api/runs": { status: 200, body: LISTED },
      "GET /api/glhf/runs": { status: 200, body: ["s-1", "s-2"].map((id, i) => ({ id, model: "mock", solver: "glhf", task: "demo", phase: "done", startedAt: at.getTime() - i * HOUR })) },
    })
    const plain = globalThis.fetch
    const started = (id: string) => Promise.resolve(new Response(sse({ type: "run.started", runId: id, brief: "x", title: "Should we take the KRAS hit forward?", mock: id !== "live-1" }), { status: 200 }))
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      const m = /\/api\/runs\/([\w-]+)\/events$/.exec(String(url))
      return m ? (opts.events ?? started)(m[1]) : plain(url, init)
    }))
    render(<HomeView onOpen={() => {}} />)
    const user = userEvent.setup()
    await user.type(screen.getByRole("textbox", { name: "Ask a research question" }), "herg{Enter}")
    return user
  }
  const LABEL = { keyword: "Matching saved runs", ai: "Saved research this answer used", scripted: "Related saved research" }

  it("runs that share a brief and a provenance are one row with the others under it; every record is still there, each with its own time and badge", async () => {
    const user = await ask("keyword")
    const list = await screen.findByRole("list", { name: LABEL.keyword })
    await waitFor(() => expect(list).not.toHaveAttribute("aria-busy"))
    await user.click(screen.getByRole("button", { name: "View all 5" })) // 8 runs in 5 rows
    expect(screen.getByText("8 runs in 5 rows. Runs of the same brief are together.")).toBeInTheDocument()
    const rows = [...list.children] as HTMLElement[]
    expect(rows).toHaveLength(5)
    // The three practice runs of kras.md: the newest is the row, the two others are under it, newest first.
    expect(rows[0]).toHaveTextContent("3 runs, latest")
    const earlier = within(within(rows[0]).getByRole("list", { name: /^Earlier runs of: / }))
    expect(earlier.getAllByRole("listitem").map((li) => li.getAttribute("data-record"))).toEqual(["board:p-mid", "board:p-old"])
    for (const li of earlier.getAllByRole("listitem")) { expect(li.querySelector("[data-provenance]")).toHaveAttribute("data-provenance", "practice"); expect(li.querySelector("time")).not.toBeNull() }
    // The live run of the same brief is never folded under practice runs. Another brief with the same title stands alone, and so does a run the engine's list does not have.
    expect(rows[1].querySelector("[data-provenance]")).toHaveAttribute("data-provenance", "live")
    for (const row of [rows[1], rows[2], rows[3]]) expect(within(row).queryByRole("group")).toBeNull()
    expect(rows[1]).not.toHaveTextContent(/runs, latest/); expect(rows[2]).not.toHaveTextContent(/runs, latest/); expect(rows[3]).not.toHaveTextContent(/runs, latest/)
    // Task runs group on their own task, solver and model.
    expect(rows[4]).toHaveTextContent("2 runs, latest")
    // Nothing is dropped: every run of the reply can be opened, exactly once.
    const opens = within(list).getAllByRole("button").length
    expect(opens).toBe(RUNS.length)
    expect([...list.querySelectorAll("[data-record]")].map((li) => li.getAttribute("data-record")).sort()).toEqual(["board:p-mid", "board:p-old", "swarm:s-2"])
  })

  it.each([[true, "Real"], [false, "Demo"]] as const)("with the next run set to %s (%s), a practice row says Practice and a live row says Live research", async (paidCalls, _word) => {
    await ask("keyword", { paidCalls })
    const list = await screen.findByRole("list", { name: LABEL.keyword })
    await waitFor(() => expect(list).not.toHaveAttribute("aria-busy"))
    const rows = [...list.children] as HTMLElement[]
    expect(rows[0].querySelector("[data-provenance]")).toHaveTextContent("Practice")
    expect(rows[1].querySelector("[data-provenance]")).toHaveTextContent("Live research")
  })

  it("holds a row's title until the run has said its own: the file name's words are never shown first", async () => {
    let answer: (() => void) | undefined
    const gate = new Promise<void>((done) => { answer = done })
    const events = (id: string) => gate.then(() => new Response(sse({ type: "run.started", runId: id, brief: "x", title: "Should we take the KRAS hit forward?", mock: id !== "live-1" }), { status: 200 }))
    await ask("keyword", { events })
    const list = await screen.findByRole("list", { name: LABEL.keyword })
    expect(list).toHaveAttribute("aria-busy", "true")
    expect(list).toHaveTextContent("Loading saved research…")
    expect(within(list).queryAllByRole("button")).toHaveLength(0)
    expect(list).not.toHaveTextContent(/kras g12c hit to lead/i)
    await act(async () => { answer!(); await gate })
    await waitFor(() => expect(list).not.toHaveAttribute("aria-busy"))
    expect(within(list).getAllByRole("button")[0]).toHaveTextContent("Should we take the KRAS hit forward?")
  })

  it("only an AI answer says the runs were used; a demo reply lists them as related and claims nothing", async () => {
    await ask("scripted")
    const related = await screen.findByRole("region", { name: "Related saved research" })
    expect(related).toHaveTextContent("Saved research that shares words with your question. Nothing read it to write this reply.")
    expect(related).not.toHaveTextContent(/this answer used|Sources/)
    expect(within(related).getByRole("list", { name: LABEL.scripted })).toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "Sources" })).toBeNull()
  })
  it("an AI answer keeps 'Saved research this answer used'", async () => {
    await ask("ai")
    const sources = await screen.findByRole("region", { name: "Sources" })
    expect(sources).toHaveTextContent("Saved research this answer used.")
    expect(within(sources).getByRole("list", { name: LABEL.ai })).toBeInTheDocument()
  })
})

describe("the confirm step names every search the review would use", () => {
  it("says the free literature search is used when the engine says the team has it, and not otherwise", async () => {
    routes({})
    const { rerender } = render(<PlanCard plan={PLAN} state={{ state: "open" }} paidCalls literature onState={() => {}} onOpenRun={() => {}} />)
    expect(screen.getAllByText("Research papers (Europe PMC)")[0].nextElementSibling).toHaveTextContent("used when the Scout searches (free)")
    rerender(<PlanCard plan={PLAN} state={{ state: "open" }} paidCalls onState={() => {}} onOpenRun={() => {}} />)
    expect(screen.queryByText("Research papers (Europe PMC)")).toBeNull()
  })
})
