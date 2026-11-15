// Settings: the normal flow has no file names or variable names; they are under "Technical", for the person who
// runs the app. Help ("How this works") lives here.
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { routes } from "@/test/engine"
import { CATALOG_OFF } from "@/test/home"
import { SettingsView } from "./SettingsView"

const show = async () => {
  routes({
    "GET /api/glhf/status": { status: 200, body: { paidCalls: false, paidLocked: false, tools: { docker: true, uv: false }, keys: { ANTHROPIC_API_KEY: true, EXA_API_KEY: false } } },
    "GET /api/status": { status: 200, body: { keys: { OPENAI_API_KEY: true } } }, "GET /api/chat/catalog": { status: 200, body: CATALOG_OFF },
  })
  const view = render(<SettingsView />)
  await screen.findByRole("radiogroup", { name: "Next run: Demo or Real" })
  await screen.findByText(/You do not need any of this to ask a question/)
  return view
}

describe("Settings", () => {
  it("keeps developer details under a Technical disclosure that is closed at first", async () => {
    const { container } = await show()
    const technical = container.querySelector("details.technical") as HTMLDetailsElement
    expect(technical).not.toBeNull()
    expect(technical.open).toBe(false)
    expect(within(technical).getByText("Technical").tagName).toBe("SUMMARY")
    // everything outside it: no file name, no variable name, no address
    const outside = container.cloneNode(true) as HTMLElement
    outside.querySelector("details.technical")!.remove()
    outside.querySelector(".home-catalog")?.remove() // "What this can use" is the Research view's panel, with its own tests
    expect(outside.textContent).not.toMatch(/\.env|_API_KEY|HF_TOKEN|\.token|localhost|127\.0\.0\.1|npm start|config\.yaml/)
    // inside it: the tools and keys with the engine's own names, set or not set, never a value
    for (const name of ["ANTHROPIC_API_KEY", "EXA_API_KEY", "OPENAI_API_KEY"]) expect(within(technical).getByText(name)).toBeInTheDocument()
    expect(technical).toHaveTextContent(".env"); expect(technical).toHaveTextContent("glhf/runs/.token")
    const rows = within(within(technical).getByRole("list", { name: "Tools and keys the engine found" })).getAllByRole("listitem")
    expect(rows.map((li) => li.querySelector(".pill")!.textContent)).toEqual(["found", "not found", "set", "not set", "set"])
    expect(container.querySelectorAll("input:not([type=checkbox]):not([type=radio])")).toHaveLength(0) // nowhere to type a key
  })
  it("says in plain words how the next run is made, and that existing results keep their badge", async () => {
    await show()
    const mode = screen.getByRole("region", { name: "Next run: Demo or Real" })
    expect(within(mode).getByRole("radio", { name: "Demo" })).toBeChecked()
    expect(mode).toHaveTextContent("Results you already have keep their own badge.")
    expect(mode).toHaveTextContent("Demo: nothing that costs money can start.")
  })
  it("has How this works", async () => {
    const asked = vi.fn(); window.addEventListener("app.help", asked)
    await show()
    await userEvent.setup().click(screen.getByRole("button", { name: "How this works" }))
    expect(asked).toHaveBeenCalledTimes(1)
    window.removeEventListener("app.help", asked)
  })
})
