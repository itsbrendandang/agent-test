// The engine's session token: asked for once, kept for the tab only, sent only on requests that change something.
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { TokenPrompt } from "@/components/TokenPrompt"
import { cancelRun, startRun } from "@/swarm/api"
import { routes, to } from "@/test/engine"
import { TokenRow } from "@/views/SettingsView"
import { engineFetch, forgetToken, getToken, keepToken, refuseToken, TOKEN_HEADER } from "./token"

const NEEDS = { status: 401, body: { error: "starting a run needs the session token", field: "token", needsToken: true } }
const URL_ = "http://localhost:8787/api/glhf/runs"
const post = () => engineFetch(URL_, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
const prompt = () => screen.findByRole("dialog", { hidden: true }).then((d) => (d.hasAttribute("open") ? d : Promise.reject(new Error("closed"))))

describe("keeping the token", () => {
  it("lives in sessionStorage only", () => {
    keepToken("  abc123  ")
    expect(getToken()).toBe("abc123")
    expect(JSON.stringify(Object.entries(sessionStorage))).toContain("abc123")
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain("abc123")
    forgetToken()
    expect(getToken()).toBeUndefined()
    expect(sessionStorage.length).toBe(0)
  })
  it("refuses what cannot be a token", () => {
    expect(refuseToken("")).toMatch(/Paste the token/)
    expect(refuseToken("two words")).toMatch(/one short line/)
    expect(refuseToken("a\nb")).toMatch(/one short line/)
    expect(refuseToken(" 0a1b2c3d ")).toBeUndefined()
  })
})

describe("engineFetch", () => {
  it("sends no token header when none is held", async () => {
    const sent = routes({ "POST /api/glhf/runs": { status: 201, body: { id: "a" } } })
    expect((await post()).status).toBe(201)
    expect(TOKEN_HEADER in sent[0].headers).toBe(false)
  })
  it("sends the held token, and keeps the request's own headers", async () => {
    keepToken("t0k3n")
    const sent = routes({ "POST /api/glhf/runs": { status: 201, body: { id: "a" } } })
    await post()
    expect(sent[0].headers).toEqual({ "content-type": "application/json", [TOKEN_HEADER]: "t0k3n" })
  })
  it("leaves an ordinary 401 alone", async () => {
    routes({ "POST /api/glhf/runs": { status: 401, body: { error: "no" } } })
    render(<TokenPrompt />)
    expect((await post()).status).toBe(401)
    expect(screen.getByRole("dialog", { hidden: true })).not.toHaveAttribute("open")
  })
  it("on needsToken asks once, then repeats the request with the pasted token", async () => {
    const sent = routes({ "POST /api/glhf/runs": [NEEDS, { status: 201, body: { id: "a", ids: ["a"] } }] })
    const user = userEvent.setup()
    render(<TokenPrompt />)
    const started = startRun({ mode: "local", task: "demo", model: "mock", solver: "glhf", timeLimit: 1800 })
    const dialog = await prompt()
    expect(dialog).toHaveTextContent("glhf/runs/.token")
    expect(dialog).toHaveTextContent("starting a run needs the session token")
    const field = screen.getByLabelText("Session token")
    expect(field).toHaveAttribute("type", "password")
    expect(field).toHaveAttribute("autocomplete", "off")
    await user.type(field, "s3cr3t{Enter}")
    await expect(started).resolves.toEqual(["a"])
    expect(sent).toHaveLength(2)
    expect(TOKEN_HEADER in sent[0].headers).toBe(false)
    expect(sent[1].headers[TOKEN_HEADER]).toBe("s3cr3t")
    expect(sent[1].body).toEqual(sent[0].body)
    expect(getToken()).toBe("s3cr3t")
    expect(localStorage.length).toBe(0)
    expect(screen.getByRole("dialog", { hidden: true })).not.toHaveAttribute("open")
    // afterwards: no prompt, the token goes along
    await cancelRun("a").catch(() => undefined)
    expect(sent[2].headers[TOKEN_HEADER]).toBe("s3cr3t")
  })
  it("never shows or logs the token", async () => {
    const logged = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "debug")]
    routes({ "POST /api/glhf/runs": [NEEDS, { status: 201, body: { id: "a" } }] })
    const user = userEvent.setup()
    const { container } = render(<><TokenPrompt /><ul><TokenRow /></ul></>)
    const asked = post()
    await prompt()
    await user.type(screen.getByLabelText("Session token"), "s3cr3t-value{Enter}")
    await asked
    expect(container.textContent).not.toContain("s3cr3t-value")
    expect(container.innerHTML).not.toContain("s3cr3t-value")
    for (const spy of logged) expect(JSON.stringify(spy.mock.calls)).not.toContain("s3cr3t-value")
  })
  it("'Not now' gives back the engine's 401 and keeps nothing", async () => {
    const sent = routes({ "POST /api/glhf/runs": NEEDS })
    const user = userEvent.setup()
    render(<TokenPrompt />)
    const started = startRun({ mode: "local", task: "demo", model: "mock", solver: "glhf", timeLimit: 1800 }).catch((e: unknown) => e)
    await prompt()
    await user.click(screen.getByRole("button", { hidden: true, name: "Not now" }))
    await expect(started).resolves.toMatchObject({ status: 401, field: "token", message: "starting a run needs the session token" })
    expect(sent).toHaveLength(1)
    expect(getToken()).toBeUndefined()
  })
  it("forgets a token the engine does not accept, says so, and asks once more", async () => {
    keepToken("old")
    const sent = routes({ "POST /api/glhf/runs": [NEEDS, { status: 201, body: { id: "a" } }] })
    const user = userEvent.setup()
    render(<TokenPrompt />)
    const asked = post()
    const dialog = await prompt()
    expect(dialog).toHaveTextContent("did not accept the last token")
    expect(getToken()).toBeUndefined()
    await user.type(screen.getByLabelText("Session token"), "new{Enter}")
    expect((await asked).status).toBe(201)
    expect(sent.map((s) => s.headers[TOKEN_HEADER])).toEqual(["old", "new"])
  })
  it("gives up after two refused tokens and keeps neither", async () => {
    const sent = routes({ "POST /api/glhf/runs": NEEDS })
    const user = userEvent.setup()
    render(<TokenPrompt />)
    const asked = post()
    await prompt(); await user.type(screen.getByLabelText("Session token"), "one{Enter}")
    await waitFor(() => expect(sent).toHaveLength(2))
    await prompt(); await user.type(screen.getByLabelText("Session token"), "two{Enter}")
    expect((await asked).status).toBe(401)
    expect(sent).toHaveLength(3)
    expect(getToken()).toBeUndefined()
  })
  it("answers every request that was waiting with one prompt", async () => {
    const sent = routes({ "POST /api/glhf/runs": (s) => (s.headers[TOKEN_HEADER] === "ok" ? { status: 201, body: { id: "a" } } : NEEDS) })
    const user = userEvent.setup()
    render(<TokenPrompt />)
    const both = Promise.all([post(), post()])
    await prompt()
    await user.type(screen.getByLabelText("Session token"), "ok{Enter}")
    expect((await both).map((r) => r.status)).toEqual([201, 201])
    expect(sent).toHaveLength(4)
  })
  it("will not keep text with spaces", async () => {
    routes({ "POST /api/glhf/runs": NEEDS })
    const user = userEvent.setup()
    render(<TokenPrompt />)
    const asked = post()
    await prompt()
    await user.type(screen.getByLabelText("Session token"), "not a token{Enter}")
    expect(screen.getByLabelText("Session token")).toHaveAccessibleDescription(/one short line without spaces/)
    expect(getToken()).toBeUndefined()
    await user.click(screen.getByRole("button", { hidden: true, name: "Not now" }))
    await asked
  })
})

describe("Settings: forget token", () => {
  it("shows whether a token is held, never the token, and forgets it", async () => {
    const user = userEvent.setup()
    const { container } = render(<ul><TokenRow /></ul>)
    expect(screen.getByText("not held")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Forget token" })).toBeNull()
    keepToken("s3cr3t")
    expect(await screen.findByText("held for this tab")).toBeInTheDocument()
    expect(container.innerHTML).not.toContain("s3cr3t")
    await user.click(screen.getByRole("button", { name: "Forget token" }))
    expect(getToken()).toBeUndefined()
    expect(screen.getByText("not held")).toBeInTheDocument()
  })
})

describe("reads", () => {
  it("do not carry the token", async () => {
    keepToken("t0k3n")
    const sent = routes({ "GET /api/chat/catalog": { status: 200, body: {} } })
    const home = await import("@/home/api")
    await home.getCatalog().catch(() => undefined)
    expect(to(sent, "GET", "/api/chat/catalog")[0].headers[TOKEN_HEADER]).toBeUndefined()
  })
})
