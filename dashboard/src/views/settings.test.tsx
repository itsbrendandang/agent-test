// Settings, as the owner's brief sets it out: five sections in order, one heading style, exact copy, the cost said
// once (Run mode), the API key statement once (Connections), and developer details under a closed "Technical".
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { keepToken } from "@/lib/token"
import { routes, to } from "@/test/engine"
import { CATALOG_ON } from "@/test/home"
import { SettingsView } from "./SettingsView"

const CATALOG = { ...CATALOG_ON, search: { exa: { keyPresent: true, usedUsd: 0.04, ceilingUsd: 40 }, provider: "exa", literature: { provider: "europepmc", free: true, keyNeeded: false, available: true } } }
const CAPS = { maxUsd: 5, dailyUsd: 20, spentTodayUsd: 1.5, exaUsedUsd: 0, exaCeilingUsd: 40 }
const PAID = { paid: false, source: "env", locked: false, board: "scripted", missingKeys: [], missing: [], caps: CAPS }
const show = async (over: { paidLocked?: boolean; catalog?: object; paidCalls?: boolean | (() => boolean); table?: Parameters<typeof routes>[0] } = {}) => {
  const paidCalls = () => (typeof over.paidCalls === "function" ? over.paidCalls() : over.paidCalls ?? true)
  const sent = routes({
    "GET /api/glhf/status": () => ({ status: 200, body: { paidCalls: paidCalls(), paidLocked: over.paidLocked ?? false, tools: { docker: true, uv: false }, keys: { ANTHROPIC_API_KEY: true, EXA_API_KEY: false } } }),
    "GET /api/status": { status: 200, body: { keys: { OPENAI_API_KEY: true } } }, "GET /api/chat/catalog": { status: 200, body: over.catalog ?? CATALOG },
    ...over.table,
  })
  const view = render(<SettingsView />)
  await screen.findByText("Web search (Exa)")
  await screen.findByRole("list", { name: "Tools and keys the engine found" })
  await waitFor(() => expect(screen.getByRole("radio", { name: paidCalls() ? "Real" : "Demo" })).toBeChecked())
  return { ...view, sent }
}
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length

describe("structure", () => {
  it("has Run mode, Session token, Appearance, Help, then Technical, each with the same heading level", async () => {
    const { container } = await show()
    const sections = [...container.querySelectorAll(".page > .set-section")]
    expect(sections.map((s) => s.querySelector("h2")!.textContent)).toEqual(["Run mode", "Session token", "Appearance", "Help", "Technical"])
    expect(sections.map((s) => s.tagName)).toEqual(["SECTION", "SECTION", "SECTION", "SECTION", "DETAILS"])
    expect([...container.querySelectorAll("h2")].filter((h) => !h.closest("dialog"))).toHaveLength(5) // one heading style: every section title is an h2, nothing else on the page is
    expect(screen.queryByText("Next run: Demo or Real")).toBeNull(); expect(screen.queryByText("How the next run is made")).toBeNull()
    expect(screen.getByText("Choose how runs are made and see what the app is connected to.")).toBeInTheDocument()
  })
  it("Technical is closed at first and holds the whole Connections card and the developer details", async () => {
    const { container } = await show()
    const technical = container.querySelector("details.technical") as HTMLDetailsElement
    expect(technical.open).toBe(false)
    const card = within(technical).getByRole("complementary", { name: "Connections" })
    expect(card).toHaveTextContent("Models, agents and skills available on this computer.")
    expect(container.querySelectorAll('[aria-labelledby="home-catalog-title"]')).toHaveLength(1)
    // outside Technical: no file name, variable name, address or model id
    const outside = container.cloneNode(true) as HTMLElement
    outside.querySelector("details.technical")!.remove()
    expect(outside.textContent).not.toMatch(/\.env|_API_KEY|HF_TOKEN|\.token|localhost|127\.0\.0\.1|npm start|config\.yaml|claude-|gpt-/)
    for (const name of ["ANTHROPIC_API_KEY", "EXA_API_KEY", "OPENAI_API_KEY"]) expect(within(technical).getByText(name)).toBeInTheDocument()
    expect(technical).toHaveTextContent("glhf/runs/.token") // Technical does show where the token is
    const rows = within(within(technical).getByRole("list", { name: "Tools and keys the engine found" })).getAllByRole("listitem")
    expect(rows.map((li) => li.querySelector(".pill")!.textContent)).toEqual(["found", "not found", "set", "not set", "set"])
    expect(container.querySelectorAll("input:not([type=checkbox]):not([type=radio])")).toHaveLength(0) // nowhere to type a key
    expect(screen.getAllByRole("radiogroup")).toHaveLength(1) // one mode control on the page
  })
  it("one Agents and skills group holds Board, Specialists and Skills; there is no separate Skills heading", async () => {
    await show()
    const group = screen.getByRole("region", { name: "Agents and skills" })
    expect([...group.querySelectorAll("details > summary")].map((s) => s.textContent!.replace(/\s*\(.*$/, ""))).toEqual(["Board", "Specialists", "Skills"])
    expect(screen.queryByRole("heading", { name: "Skills" })).toBeNull()
    expect(document.body).not.toHaveTextContent(/team members/i) // "Agents" everywhere
  })
})

describe("copy", () => {
  it("Run mode: the two lines as written, beside the one working Demo | Real control", async () => {
    await show()
    const mode = screen.getByRole("region", { name: "Run mode" })
    expect(mode).toHaveTextContent("Past results keep the mode they were run in.")
    expect(mode).toHaveTextContent("Real uses live AI models and web search, which cost money. You confirm before each run.")
    const group = within(mode).getByRole("radiogroup", { name: "Run mode: Demo or Real" })
    expect(group).toHaveAccessibleDescription(/Demo uses fixed example answers and is free\. Real uses live AI models and web search, which cost money\. You confirm before each run\./)
    expect(mode).not.toHaveTextContent(/top of the page|Locked/)
  })
  it("says when the person running the engine locked the mode, and the control cannot be used", async () => {
    await show({ paidLocked: true })
    const mode = screen.getByRole("region", { name: "Run mode" })
    await waitFor(() => expect(mode).toHaveTextContent("Locked by the person running the engine."))
    for (const name of ["Demo", "Real"]) expect(within(mode).getByRole("radio", { name })).toBeDisabled()
  })
  it("Session token: a filled neutral pill 'Not entered yet', the body as written, no 'password' line and no pointer", async () => {
    await show()
    const token = screen.getByRole("region", { name: "Session token" })
    const pill = within(token).getByText("Not entered yet")
    expect(pill).toHaveClass("pill"); expect(pill).toHaveAttribute("data-kind", "neutral") // filled, not the dashed outline
    expect(token).toHaveTextContent("Required for Real runs. You'll be asked for it once, and it stays in this browser tab only. Ask whoever runs the app if you don't have it.")
    expect(token).not.toHaveTextContent(/A password for this session|see Technical|not held/)
    keepToken("t".repeat(48))
    expect(await within(token).findByText("Entered for this tab")).toBeInTheDocument()
    await userEvent.setup().click(within(token).getByRole("button", { name: "Forget token" }))
    expect(within(token).getByText("Not entered yet")).toBeInTheDocument()
    expect(token.innerHTML).not.toContain("tttt")
  })
  it("Connections: Connected and Free pills, the key note, and no cost badge or plan-spend line", async () => {
    await show()
    const card = within(screen.getByRole("complementary", { name: "Connections" }))
    expect(within(card.getByText("Claude (Anthropic)").closest("li")!).getByText("Connected")).toBeInTheDocument()
    expect(card.getByText("OpenAI").closest("li")).toHaveTextContent("Not connected")
    expect(within(card.getByText("Research papers (Europe PMC)").closest("li")!).getByText("Free")).toBeInTheDocument()
    expect(card.getByTestId("key-note")).toHaveTextContent(/^API keys stay in the engine and are never shown here\.$/)
    for (const gone of ["Real: costs money", "A started plan can spend money", "key present", "free, no key needed", "What this can use"]) expect(screen.queryByText(new RegExp(gone))).toBeNull()
  })
  it("the Exa row carries the search credit and a labelled budget bar with its numbers in text", async () => {
    await show()
    const exa = screen.getByText("Web search (Exa)").closest("li")!
    expect(within(exa).getByTestId("search-credit")).toHaveTextContent("Search powered by Exa")
    expect(screen.getByText("Research papers (Europe PMC)").closest("li")).not.toHaveTextContent("Exa")
    const bar = within(exa).getByRole("progressbar", { name: "Search budget" })
    expect(bar).toHaveAttribute("value", "0.04"); expect(bar).toHaveAttribute("max", "40") // the engine's own numbers
    expect(bar).toHaveAccessibleDescription("$0.04 of $40 used")
    expect(exa).toHaveTextContent("Search budget"); expect(exa).toHaveTextContent("$0.04 of $40 used") // never the bar alone
  })
  it("shows no budget bar when the engine did not report the numbers", async () => {
    await show({ catalog: CATALOG_ON })
    expect(screen.queryByRole("progressbar")).toBeNull()
    expect(screen.queryByText("Search budget")).toBeNull()
  })
  it("says the cost once (in Run mode) and the API key statement once (in Connections)", async () => {
    const { container } = await show()
    const text = container.textContent ?? ""
    expect(count(text, /cost money|costs money|spend money/g)).toBe(1)
    expect(screen.getByRole("region", { name: "Run mode" })).toHaveTextContent("which cost money")
    expect(count(text, /API keys? /g)).toBe(1)
    expect(screen.getByRole("complementary", { name: "Connections" })).toHaveTextContent("API keys stay in the engine")
  })
  it("uses no em dash anywhere on the page", async () => {
    const { container } = await show()
    expect(container.textContent).not.toMatch(/\u2014/)
    for (const el of container.querySelectorAll("[title], [aria-label]")) expect(`${el.getAttribute("title") ?? ""}${el.getAttribute("aria-label") ?? ""}`).not.toMatch(/\u2014/)
  })
  it("Appearance names the four characters as decoration", async () => {
    await show()
    const look = screen.getByRole("region", { name: "Appearance" })
    expect(look).toHaveTextContent("Momo, Ember, Fuji and Sage are decoration, not the agents that do the work.")
    expect(within(look).getByRole("checkbox", { name: "Show characters" })).toBeChecked()
  })
  it("Help is unchanged and opens How this works", async () => {
    const asked = vi.fn(); window.addEventListener("app.help", asked)
    await show()
    expect(screen.getByRole("region", { name: "Help" })).toHaveTextContent("Four plain steps: you ask, it searches and writes, statements are checked, you read the answer.")
    await userEvent.setup().click(screen.getByRole("button", { name: "How this works" }))
    expect(asked).toHaveBeenCalledTimes(1)
    window.removeEventListener("app.help", asked)
  })
})

describe("Run mode is the one place to switch, and it cannot show a stale state", () => {
  it("choosing Real opens the confirm dialog with the limits and sends nothing until the box is ticked", async () => {
    const t = await show({ paidCalls: false, table: { "GET /api/paid": { status: 200, body: PAID } } })
    const user = userEvent.setup()
    await user.click(screen.getByRole("radio", { name: "Real" }))
    const dialog = within(await screen.findByRole("dialog", { name: "Switch to Real?" }))
    expect(within(await dialog.findByLabelText("The limits that apply")).getByText("Most one run may cost").nextElementSibling).toHaveTextContent("$5")
    expect(dialog.getByRole("checkbox", { name: "I understand this costs money" })).not.toBeChecked()
    expect(dialog.getByRole("button", { name: "Switch to Real" })).toBeDisabled()
    expect(screen.getByRole("radio", { name: "Real" })).not.toBeChecked() // still the engine's state
    expect(to(t.sent, "POST", "/api/paid")).toHaveLength(0)
  })
  it("confirming sends the engine's sentence with the token, and the control then shows what the engine says", async () => {
    keepToken("t".repeat(48))
    let on = false
    const t = await show({ paidCalls: () => on, table: { "GET /api/paid": { status: 200, body: PAID }, "POST /api/paid": () => { on = true; return { status: 200, body: { ...PAID, paid: true, source: "switch", board: "real" } } } } })
    const user = userEvent.setup()
    await user.click(screen.getByRole("radio", { name: "Real" }))
    await user.click(await screen.findByRole("checkbox", { name: "I understand this costs money" }))
    await user.click(screen.getByRole("button", { name: "Switch to Real" }))
    await waitFor(() => expect(to(t.sent, "POST", "/api/paid")).toHaveLength(1))
    expect(to(t.sent, "POST", "/api/paid")[0].body).toEqual({ on: true, confirm: "I will be charged" })
    expect(to(t.sent, "POST", "/api/paid")[0].headers["x-glhf-token"]).toBe("t".repeat(48))
    await waitFor(() => expect(screen.getByRole("radio", { name: "Real" })).toBeChecked()) // read again right after the switch
  })
  it("back to Demo is one click, and the engine's refusal leaves the control where the engine is", async () => {
    keepToken("t".repeat(48))
    const t = await show({ paidCalls: true, table: { "POST /api/paid": { status: 403, body: { error: "locked", field: "locked", locked: true } } } })
    await userEvent.setup().click(screen.getByRole("radio", { name: "Demo" }))
    await waitFor(() => expect(to(t.sent, "POST", "/api/paid")).toHaveLength(1))
    expect(to(t.sent, "POST", "/api/paid")[0].body).toEqual({ on: false })
    expect(await screen.findByRole("status")).toHaveTextContent("Locked by the person running the engine. Nothing was changed.")
    expect(screen.getByRole("radio", { name: "Real" })).toBeChecked()
  })
  it("a change made elsewhere shows up on the next read, and nothing about the mode is stored in the browser", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let on = false
    await show({ paidCalls: () => on })
    on = true // another tab switched, or the engine was restarted with another setting
    await act(async () => { await vi.advanceTimersByTimeAsync(10_100) })
    await waitFor(() => expect(screen.getByRole("radio", { name: "Real" })).toBeChecked())
    expect(Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter((k) => /paid|mode|real|demo/i.test(k))).toEqual([])
    vi.useRealTimers()
  })
})
