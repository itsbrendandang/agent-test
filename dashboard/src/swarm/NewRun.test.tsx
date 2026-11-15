// The New run form as a person uses it, against a stand-in engine. Nothing here reaches the network.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { engine, PAID_OFF, PAID_ON } from "@/test/engine"
import type { GlhfStatus } from "./api"
import { NewRun } from "./NewRun"

function open(status: GlhfStatus | undefined) {
  const onStarted = vi.fn(), onOpenRun = vi.fn(), onClose = vi.fn()
  render(<NewRun open status={status} onClose={onClose} onStarted={onStarted} onOpenRun={onOpenRun} />)
  const form = within(screen.getByRole("dialog", { hidden: true }))
  return { user: userEvent.setup(), form, onStarted, onOpenRun, onClose }
}
const submit = (form: ReturnType<typeof open>["form"]) => form.getByRole("button", { hidden: true, name: /^(Start|Review)/ })
const field = (form: ReturnType<typeof open>["form"], name: RegExp) => form.getByLabelText(name) as HTMLInputElement

describe("paid calls off", () => {
  it("offers the scripted model only, and says why and who can change it", () => {
    const { form } = open(PAID_OFF)
    const model = field(form, /^Model$/) as unknown as HTMLSelectElement
    expect([...model.options].filter((o) => !o.disabled).map((o) => o.value)).toEqual(["mock"])
    expect([...model.options].find((o) => o.value === "other")).toBeDisabled()
    expect(form.queryByLabelText("Model id")).toBeNull()
    expect(form.getByText(/You are in Demo mode, so only a practice run can start/)).toHaveTextContent("Real")
    expect(form.getByText(/You are in Demo mode, so only a practice run can start/)).toHaveTextContent("choose Real in Settings first")
  })
  it("disables the Exa box with the reason", () => {
    const { form } = open(PAID_OFF)
    const exa = field(form, /Exa documentation search/)
    expect(exa).toBeDisabled()
    expect(exa).not.toBeChecked()
    expect(exa).toHaveAccessibleDescription(/cannot be used in Demo mode/)
  })
  it("starts a scripted run in one step: no cost note and no confirm step", async () => {
    const sent = engine({ status: 201, body: { id: "a", ids: ["a"] } })
    const { user, form, onStarted } = open(PAID_OFF)
    expect(form.queryByText(/costs money/)).toBeNull()
    expect(submit(form)).toHaveTextContent("Start run")
    await user.click(submit(form))
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(["a"]))
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toEqual({ mode: "local", task: "demo", model: "mock", solver: "glhf", timeLimit: 1800, reviewRounds: 3 })
    expect(form.queryByText(/Confirm a paid run/)).toBeNull()
  })
  it("starts a pair with one request", async () => {
    const sent = engine({ status: 201, body: { id: "a", ids: ["a", "b"] } })
    const { user, form, onStarted } = open(PAID_OFF)
    await user.click(field(form, /Both, to compare/))
    expect(form.getByText(/The single agent waits in the queue/)).toBeInTheDocument()
    expect(submit(form)).toHaveTextContent("Start the pair")
    await user.click(submit(form))
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(["a", "b"]))
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toEqual({ mode: "local", task: "demo", model: "mock", solvers: ["glhf", "single"], timeLimit: 1800, reviewRounds: 3 })
  })
})

describe("validation", () => {
  it("sends nothing while an input is wrong, and says what is wrong next to it", async () => {
    const sent = engine()
    const { user, form } = open(PAID_OFF)
    await user.clear(field(form, /Time limit/)); await user.type(field(form, /Time limit/), "0")
    await user.type(field(form, /Token budget/), "5")
    await user.click(submit(form))
    expect(sent).toHaveLength(0)
    expect(field(form, /Time limit/)).toBeInvalid()
    expect(field(form, /Time limit/)).toHaveAccessibleDescription("The time limit must be a whole number from 1 to 1,440.")
    expect(field(form, /Token budget/)).toHaveAccessibleDescription("The token budget must be a whole number from 1,000 to 500,000,000.")
    expect(field(form, /Seed/)).toBeValid()
  })
  it("disables the swarm-only inputs for a single agent", async () => {
    const { user, form } = open(PAID_ON)
    await user.click(field(form, /Single agent/))
    expect(field(form, /Review rounds/)).toBeDisabled()
    expect(field(form, /Use lessons from earlier runs/)).toBeDisabled()
  })
})

describe("refusals from the engine", () => {
  it("shows a refusal with a field next to that input and keeps the form open", async () => {
    engine({ status: 400, body: { error: "seed must be a whole number from 1 to 2147483647", field: "seed" } })
    const { user, form, onStarted } = open({ ...PAID_OFF, limits: undefined })
    await user.type(field(form, /Seed/), "99999999999")
    await user.click(submit(form))
    await waitFor(() => expect(field(form, /Seed/)).toBeInvalid())
    expect(field(form, /Seed/)).toHaveAccessibleDescription("seed must be a whole number from 1 to 2147483647")
    expect(form.queryByText(/The engine refused the run/)).toBeNull()
    expect(onStarted).not.toHaveBeenCalled()
  })
  it("shows a refusal about a field with no input under the form", async () => {
    engine({ status: 400, body: { error: "cloud runs are refused", field: "mode" } })
    const { user, form } = open(PAID_OFF)
    await user.click(submit(form))
    expect(await form.findByText(/The engine refused the run: cloud runs are refused/)).toBeInTheDocument()
  })
  it("on 409 shows the text and a link to the run in the way", async () => {
    engine({ status: 409, body: { error: "a local run is still going (r-7)", run: "r-7" } })
    const { user, form, onOpenRun } = open(PAID_OFF)
    await user.click(submit(form))
    expect(await form.findByText(/a local run is still going \(r-7\)/)).toBeInTheDocument()
    await user.click(form.getByRole("button", { hidden: true, name: "Open r-7" }))
    expect(onOpenRun).toHaveBeenCalledWith("r-7")
  })
  it("shows the kill switch's refusal next to the model, if the switch turned off after the form was loaded", async () => {
    const sent = engine({ status: 400, body: { error: 'runs with a real model are refused; only the scripted model "mock" may run. Paid calls are off (NO_PAID_CALLS).', field: "model" } })
    const { user, form } = open(PAID_ON)
    await user.selectOptions(field(form, /^Model$/), "anthropic/claude-haiku-5-5")
    await user.type(field(form, /Token budget/), "1000")
    await user.click(submit(form))
    await user.click(form.getByLabelText(/I understand that this spends money/))
    await user.click(submit(form))
    await waitFor(() => expect(field(form, /^Model$/)).toHaveAccessibleDescription(/Paid calls are off \(NO_PAID_CALLS\)/))
    expect(sent).toHaveLength(1)
    expect(form.queryByText("Confirm a paid run")).toBeNull() // back on the form, where the message is
  })
})

describe("paid calls on: a real model needs a second, explicit step", () => {
  const pick = async (t: ReturnType<typeof open>) => {
    await t.user.selectOptions(field(t.form, /^Model$/), "anthropic/claude-sonnet-5-5")
    await t.user.clear(field(t.form, /Time limit/)); await t.user.type(field(t.form, /Time limit/), "45")
  }
  it("lists the engine's models and warns that the run costs money", async () => {
    const t = open(PAID_ON)
    expect([...(field(t.form, /^Model$/) as unknown as HTMLSelectElement).options].map((o) => o.value)).toEqual(["mock", "anthropic/claude-sonnet-5-5", "anthropic/claude-haiku-5-5", "openai/gpt-5.5", "other"])
    await pick(t)
    expect(t.form.getByText(/This run costs money/)).toBeInTheDocument()
    expect(submit(t.form)).toHaveTextContent("Review and confirm")
  })
  it("refuses to go on without a token budget", async () => {
    const sent = engine()
    const t = open(PAID_ON)
    await pick(t)
    await t.user.click(submit(t.form))
    expect(field(t.form, /Token budget/)).toHaveAccessibleDescription(/needs a token budget/)
    expect(t.form.queryByText("Confirm a paid run")).toBeNull()
    expect(sent).toHaveLength(0)
  })
  it("restates model, runs, time limit and token budget, and sends nothing until the box is ticked", async () => {
    const sent = engine({ status: 201, body: { id: "a", ids: ["a", "b"] } })
    const t = open(PAID_ON)
    await pick(t)
    await t.user.type(field(t.form, /Token budget/), "250000")
    await t.user.click(field(t.form, /Both, to compare/))
    await t.user.click(submit(t.form))
    expect(t.form.getByText("Confirm a paid run")).toBeInTheDocument()
    const facts = t.form.getByText("Model").closest("dl")!
    expect(facts).toHaveTextContent("anthropic/claude-sonnet-5-5")
    expect(facts).toHaveTextContent("2: a swarm run first, then a single-agent run")
    expect(facts).toHaveTextContent("45:00 (45 minutes) for each run")
    expect(facts).toHaveTextContent("250,000 tokens for each run, 500,000 in total")
    const go = t.form.getByRole("button", { hidden: true, name: "Start 2 paid runs" })
    expect(go).toBeDisabled()
    await t.user.click(go)
    await t.user.keyboard("{Enter}")
    fireEvent.submit(go.closest("form")!) // a submit that does not come from the button, such as a script or an extension
    await new Promise((done) => setTimeout(done, 20))
    expect(sent).toHaveLength(0)
    await t.user.click(t.form.getByLabelText(/I understand that this spends money/))
    expect(go).toBeEnabled()
    await t.user.click(go)
    await waitFor(() => expect(t.onStarted).toHaveBeenCalledWith(["a", "b"]))
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toEqual({ mode: "local", task: "demo", model: "anthropic/claude-sonnet-5-5", solvers: ["glhf", "single"], timeLimit: 2700, maxTokens: 250_000, reviewRounds: 3 })
  })
  it("Back returns to the form without sending, and the box must be ticked again", async () => {
    const sent = engine()
    const t = open(PAID_ON)
    await pick(t)
    await t.user.type(field(t.form, /Token budget/), "1000")
    await t.user.click(submit(t.form))
    await t.user.click(t.form.getByLabelText(/I understand that this spends money/))
    await t.user.click(t.form.getByRole("button", { hidden: true, name: "Back" }))
    expect(t.form.getByText("New run")).toBeInTheDocument()
    await t.user.click(submit(t.form))
    expect(t.form.getByLabelText(/I understand that this spends money/)).not.toBeChecked()
    expect(sent).toHaveLength(0)
  })
  it("warns when the engine has no key for the chosen model", async () => {
    const t = open({ ...PAID_ON, keys: { ...PAID_ON.keys, OPENAI_API_KEY: false } })
    await t.user.selectOptions(field(t.form, /^Model$/), "openai/gpt-5.5")
    expect(t.form.getByText(/The engine has no OPENAI_API_KEY for this model/)).toBeInTheDocument()
  })
})
