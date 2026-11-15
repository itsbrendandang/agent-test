// The Demo / Real switch. Every request here goes to a stand-in engine; no test (and no person testing) turns Real
// on against a real engine.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ModeLabel } from "@/components/Shared"
import { useShell } from "@/lib/shell"
import { keepToken } from "@/lib/token"
import { routes, to } from "@/test/engine"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ModeSwitch, NextRun } from "./PaidSwitch"

const CAPS = { maxUsd: 5, dailyUsd: 20, spentTodayUsd: 1.5, exaUsedUsd: 0, exaCeilingUsd: 40 }
const DEMO = { paid: false, source: "env", locked: false, board: "scripted", missingKeys: [], missing: [], caps: CAPS }
const REAL = { ...DEMO, paid: true, source: "switch", board: "real" }
const TOKEN = "t".repeat(48)
const show = (table: Parameters<typeof routes>[0], paid: "off" | "on" = "off", locked = false) => {
  const sent = routes(table)
  render(<ModeSwitch paid={paid} locked={locked} />)
  return { sent, user: userEvent.setup(), posts: () => to(sent, "POST", "/api/paid"), demo: () => screen.getByRole("radio", { name: "Demo" }), real: () => screen.getByRole("radio", { name: "Real" }) }
}
afterEach(() => vi.useRealTimers())

describe("the control", () => {
  it("the selector in the header is labelled Next run: a radio group that shows the state, and its label explains Demo and Real", async () => {
    routes({})
    render(<TooltipProvider><NextRun paid="off" /></TooltipProvider>)
    const group = screen.getByRole("radiogroup", { name: "Next run: Demo or Real" })
    expect(within(group).getByRole("radio", { name: "Demo" })).toBeChecked()
    expect(within(group).getByRole("radio", { name: "Real" })).not.toBeChecked()
    expect(group).toHaveAccessibleDescription("Practice runs. Fixed example answers. Free.")
    const label = screen.getByRole("button", { name: "Next run: what Demo and Real mean" })
    expect(label).toHaveTextContent("Next run")
    fireEvent.click(label) // a press (touch has no hover); keyboard focus and hover open it too
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Demo: fixed example answers, free. Real: real models and searches, costs money.")
    fireEvent.click(label)
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull())
    await userEvent.setup().tab() // the label is the first thing in the selector the keyboard reaches
    expect(label).toHaveFocus()
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Demo: fixed example answers, free.")
  })
  it("choosing Real in the header opens the same confirm dialog and sends nothing", async () => {
    const sent = routes({ "GET /api/paid": { status: 200, body: DEMO } })
    render(<TooltipProvider><NextRun paid="off" /></TooltipProvider>)
    await userEvent.setup().click(screen.getByRole("radio", { name: "Real" }))
    expect(await screen.findByRole("dialog", { name: "Switch to Real?" })).toBeInTheDocument()
    expect(await screen.findByRole("checkbox", { name: "I understand this costs money" })).not.toBeChecked()
    expect(screen.getByRole("button", { name: "Switch to Real" })).toBeDisabled()
    expect(screen.getByRole("radio", { name: "Real" })).not.toBeChecked()
    expect(to(sent, "POST", "/api/paid")).toHaveLength(0)
  })
  it("says Real plainly while it is on", () => {
    show({}, "on")
    expect(screen.getByRole("radio", { name: "Real" })).toBeChecked()
    expect(screen.getByRole("radiogroup")).toHaveAccessibleDescription("Real AI models and web search. Costs money.")
  })
  it("is disabled and says who locked it when the engine reports a lock", () => {
    const t = show({}, "off", true)
    expect(t.demo()).toBeDisabled(); expect(t.real()).toBeDisabled()
    expect(screen.getByRole("radiogroup")).toHaveAccessibleDescription(/Locked by the person running the engine\./)
  })
  it("is disabled when the engine did not say", () => {
    routes({})
    render(<ModeSwitch paid="unknown" />)
    expect(screen.getByRole("radio", { name: "Real" })).toBeDisabled()
    expect(screen.getByRole("radio", { name: "Demo" })).not.toBeChecked() // unknown is not shown as Demo
  })
})

describe("switching to Real is never one click", () => {
  it("choosing Real opens a dialog and changes nothing: what changes, the limits, what was spent today", async () => {
    const t = show({ "GET /api/paid": { status: 200, body: DEMO } })
    await t.user.click(t.real())
    const dialog = within(await screen.findByRole("dialog", { name: "Switch to Real?" }))
    expect(await dialog.findByText(/new runs use real AI models and web search, and they cost money/)).toBeInTheDocument()
    const caps = within(dialog.getByLabelText("The limits that apply"))
    expect(caps.getByText("Most one run may cost").nextElementSibling).toHaveTextContent("$5")
    expect(caps.getByText("Most in one day").nextElementSibling).toHaveTextContent("$20")
    expect(caps.getByText("Spent today").nextElementSibling).toHaveTextContent("$1.50")
    expect(caps.getByText("Web searches (Exa)").nextElementSibling).toHaveTextContent("$0 of $40 used")
    expect(dialog.getByText(/Real stays on until the engine restarts or you switch back\./)).toBeInTheDocument()
    expect(dialog.getByText(/Each run still shows its own cost and asks you to confirm/)).toBeInTheDocument()
    expect(t.real()).not.toBeChecked() // the control still shows the engine's state
    expect(t.posts()).toHaveLength(0)
  })
  it("cannot be turned on without the tick", async () => {
    keepToken(TOKEN)
    const t = show({ "GET /api/paid": { status: 200, body: DEMO }, "POST /api/paid": { status: 200, body: REAL } })
    await t.user.click(t.real())
    const turnOn = await screen.findByRole("button", { name: "Switch to Real" })
    const tick = screen.getByRole("checkbox", { name: "I understand this costs money" })
    expect(tick).not.toBeChecked()
    expect(turnOn).toBeDisabled()
    await t.user.click(turnOn)
    expect(t.posts()).toHaveLength(0)
    await t.user.click(tick); await t.user.click(turnOn)
    await waitFor(() => expect(t.posts()).toHaveLength(1))
    expect(t.posts()[0].body).toEqual({ on: true, confirm: "I will be charged" })
    expect(t.posts()[0].headers["x-glhf-token"]).toBe(TOKEN)
    expect(await screen.findByText(/Real is on\. New runs use real AI models and cost money\./)).toBeInTheDocument()
  })
  it("cannot be turned on without the session token: the engine's 401 leaves it in Demo and says so", async () => {
    const t = show({ "GET /api/paid": { status: 200, body: DEMO }, "POST /api/paid": { status: 401, body: { error: "token required", field: "token" } } })
    await t.user.click(t.real())
    await t.user.click(await screen.findByRole("checkbox", { name: "I understand this costs money" }))
    await t.user.click(screen.getByRole("button", { name: "Switch to Real" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("The session token was missing or not accepted, so nothing was changed.")
    expect(t.posts()[0].headers["x-glhf-token"]).toBeUndefined()
    expect(screen.queryByText(/Real is on/)).toBeNull()
  })
  it("the tick is cleared every time the dialog opens, and Stay in Demo sends nothing", async () => {
    const t = show({ "GET /api/paid": { status: 200, body: DEMO } })
    await t.user.click(t.real())
    await t.user.click(await screen.findByRole("checkbox", { name: "I understand this costs money" }))
    await t.user.click(screen.getByRole("button", { name: "Stay in Demo" }))
    await t.user.click(t.real())
    expect(await screen.findByRole("checkbox", { name: "I understand this costs money" })).not.toBeChecked()
    expect(t.posts()).toHaveLength(0)
  })
  it("missing keys: says which, offers no way to turn it on, and no place to type a key", async () => {
    const t = show({ "GET /api/paid": { status: 200, body: { ...DEMO, missingKeys: ["OPENAI_API_KEY"], missing: [{ tier: "rival", model: "openai/gpt-5-mini", key: "OPENAI_API_KEY" }] } } })
    await t.user.click(t.real())
    const dialog = await screen.findByRole("dialog")
    expect(await within(dialog).findByRole("note")).toHaveTextContent("Real cannot be turned on: the engine has no OPENAI_API_KEY.")
    expect(within(dialog).getByRole("note")).toHaveTextContent("This page never asks for a key.")
    expect(within(dialog).queryByRole("button", { name: "Switch to Real" })).toBeNull()
    expect(dialog.querySelector("input")).toBeNull()
  })
  it("locked, as the engine reports it when asked: no way to turn it on", async () => {
    const t = show({ "GET /api/paid": { status: 200, body: { ...DEMO, locked: true } } })
    await t.user.click(t.real())
    const dialog = await screen.findByRole("dialog")
    expect(await within(dialog).findByRole("note")).toHaveTextContent("Locked by the person running the engine.")
    expect(within(dialog).queryByRole("button", { name: "Switch to Real" })).toBeNull()
  })
  it.each([
    [{ status: 409, body: { error: "keys missing", field: "keys", missingKeys: ["ANTHROPIC_API_KEY"] } }, /the engine has no ANTHROPIC_API_KEY\. Nothing was changed/],
    [{ status: 403, body: { error: "locked", field: "locked", locked: true } }, /Locked by the person running the engine\. Nothing was changed/],
    [{ status: 429, body: { error: "slow down", field: "rate" } }, /Too many tries.*Nothing was changed/],
    [{ status: 500, body: { error: "audit log could not be written", field: "audit" } }, /audit log could not be written Nothing was changed\./],
  ])("a refusal says why and changes nothing: %j", async (refusal, text) => {
    keepToken(TOKEN)
    const t = show({ "GET /api/paid": { status: 200, body: DEMO }, "POST /api/paid": refusal })
    await t.user.click(t.real())
    await t.user.click(await screen.findByRole("checkbox", { name: "I understand this costs money" }))
    await t.user.click(screen.getByRole("button", { name: "Switch to Real" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(text)
  })
})

describe("switching to Demo is immediate", () => {
  it("one click, no dialog: sends {on:false} and says what stopped", async () => {
    keepToken(TOKEN)
    const changed = vi.fn(); window.addEventListener("paid.changed", changed)
    const t = show({ "POST /api/paid": { status: 200, body: { ...DEMO, source: "switch", stoppedRuns: ["run-1"] } } }, "on")
    await t.user.click(t.demo())
    await waitFor(() => expect(t.posts()).toHaveLength(1))
    expect(t.posts()[0].body).toEqual({ on: false })
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(await screen.findByRole("status")).toHaveTextContent("Demo is on. Nothing can cost money now. 1 paid run was asked to stop.")
    expect(changed).toHaveBeenCalled() // everything that shows the state reads it again
    window.removeEventListener("paid.changed", changed)
  })
})

describe("the state is the engine's, read again and again", () => {
  function Line() { const shell = useShell(1000); return <TooltipProvider><NextRun paid={shell.paid} locked={shell.locked} /></TooltipProvider> }
  const real = () => screen.getByRole("radio", { name: "Real" }), demo = () => screen.getByRole("radio", { name: "Demo" })
  it("a change made elsewhere shows up on the next poll, and nothing is stored in the browser", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let paidCalls = false
    routes({ "GET /api/glhf/status": () => ({ status: 200, body: { paidCalls, paidLocked: false } }) })
    render(<Line />)
    await waitFor(() => expect(demo()).toBeChecked())
    expect(real()).not.toBeChecked()
    paidCalls = true // someone else switched, or the engine was restarted with another setting
    await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
    await waitFor(() => expect(real()).toBeChecked())
    expect(screen.getByRole("radiogroup")).toHaveAccessibleDescription("Real AI models and web search. Costs money.")
    paidCalls = false
    await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
    await waitFor(() => expect(demo()).toBeChecked())
    expect(Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter((k) => /paid|mode|real|demo/i.test(k))).toEqual([])
  })
  it("a lock reported by the engine disables the control", async () => {
    routes({ "GET /api/glhf/status": { status: 200, body: { paidCalls: false, paidLocked: true } } })
    render(<Line />)
    await waitFor(() => expect(screen.getByRole("radiogroup")).toHaveAccessibleDescription(/Locked/))
    expect(real()).toBeDisabled(); expect(demo()).toBeDisabled()
    expect(screen.getByRole("radiogroup")).toHaveAccessibleDescription(/Locked by the person running the engine/)
  })
})

describe("past runs keep their own label", () => {
  it.each(["off", "on"] as const)("a practice run and a real run read the same with the switch %s", (paid) => {
    routes({})
    render(<><ModeSwitch paid={paid} /><span data-testid="practice"><ModeLabel scripted /></span><span data-testid="real"><ModeLabel scripted={false} /></span></>)
    expect(screen.getByTestId("practice")).toHaveTextContent("Practice run: fixed text, not real research")
    expect(screen.getByTestId("real")).toHaveTextContent("real model")
  })
})

describe("when the engine cannot answer", () => {
  it("an older engine without the switch: says to restart the app", async () => {
    const t = show({ "GET /api/paid": { status: 404, body: { error: "not found" } } })
    await t.user.click(t.real())
    expect(await screen.findByRole("alert")).toHaveTextContent("This engine is too old to have the switch. Stop the app and start it again with: npm start.")
  })
})
