// "Your profile" and the profile row: not set at first, saved in Settings, shown in the row and its menu, cleared
// again, kept in this browser only and never sent to the engine. The menu has only rows that do something.
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { charactersShown } from "@/crew/store"
import { initials, readProfile, saveProfile } from "@/lib/profile"
import { routes } from "@/test/engine"
import { SettingsView } from "@/views/SettingsView"
import { ProfileMenu } from "./ProfileMenu"

const engine = () => routes({
  "GET /api/glhf/status": { status: 200, body: { paidCalls: false, paidLocked: false, tools: {}, keys: {} } },
  "GET /api/status": { status: 200, body: { keys: {} } }, "GET /api/chat/catalog": { status: 404, body: {} },
})
const row = () => screen.getByRole("button", { name: /profile and settings$/ })
const open = async (user = userEvent.setup()) => { await user.click(row()); return within(await screen.findByRole("menu")) }

describe("the profile row", () => {
  it("until a profile is set it says so, with a neutral picture and the mode of the next run", () => {
    render(<ProfileMenu paid="off" onSettings={() => {}} />)
    expect(row()).toHaveAccessibleName("Set up your profile: profile and settings")
    expect(row()).toHaveTextContent("Set up your profile"); expect(row()).toHaveTextContent("This computer")
    expect(row().querySelector(".profile-avatar")).not.toHaveAttribute("data-set")
    expect(row().querySelector(".mode-badge")).toHaveTextContent(/^Demo$/)
  })
  it.each([["on", "Real"], ["off", "Demo"]] as const)("the badge is the engine's mode for the next run (%s: %s), and nothing while the engine has not said", (paid, word) => {
    const view = render(<ProfileMenu paid={paid} onSettings={() => {}} />)
    expect(row().querySelector(".mode-badge")).toHaveTextContent(word)
    view.rerender(<ProfileMenu paid="unknown" onSettings={() => {}} />)
    expect(row().querySelector(".mode-badge")).toBeNull()
  })
  it("shows the saved name, initials and organisation; folded to icons it is only the picture, still named", () => {
    saveProfile({ name: "Brendan Dang", organisation: "Acme Bio", role: "Lead" })
    const view = render(<ProfileMenu paid="on" onSettings={() => {}} />)
    expect(row()).toHaveAccessibleName("Brendan Dang: profile and settings")
    expect(row().querySelector(".profile-avatar")).toHaveTextContent(/^BD$/)
    expect(row()).toHaveTextContent("Acme Bio")
    view.rerender(<ProfileMenu paid="on" collapsed onSettings={() => {}} />)
    expect(row().textContent).toBe("BD")
    expect(row()).toHaveAccessibleName("Brendan Dang: profile and settings")
  })
  it("opens a menu with only rows that do something, by mouse or keyboard; Escape closes it and focus returns", async () => {
    const onSettings = vi.fn(), help = vi.fn(); window.addEventListener("app.help", help)
    saveProfile({ name: "Brendan Dang", organisation: "", role: "Lead" })
    render(<ProfileMenu paid="off" onSettings={onSettings} />)
    const user = userEvent.setup()
    const trigger = row() // while the menu is open the rest of the page is hidden from assistive technology, so keep the element
    expect(trigger).toHaveAttribute("aria-haspopup", "menu"); expect(trigger).toHaveAttribute("aria-expanded", "false")
    trigger.focus(); await user.keyboard("{Enter}")
    const menu = within(await screen.findByRole("menu"))
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("menu")).toHaveTextContent("Brendan Dang"); expect(screen.getByRole("menu")).toHaveTextContent("Lead · This computer")
    expect(menu.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Settings", "How this works"])
    expect(menu.getByRole("menuitemcheckbox", { name: "Show characters" })).toHaveAttribute("aria-checked", "false")
    for (const none of [/log ?out/i, /language/i, /dark mode/i, /terms/i]) expect(screen.getByRole("menu")).not.toHaveTextContent(none) // no control that does nothing
    expect(screen.getByRole("menu")).toHaveTextContent(/v\d+\.\d+\.\d+|vdev/) // the app's version, and nothing else in the footer
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())
    expect(trigger).toHaveFocus()
    await (await open(user)).getByRole("menuitem", { name: "How this works" }).click()
    expect(help).toHaveBeenCalledTimes(1)
    await user.click((await open(user)).getByRole("menuitem", { name: "Settings" }))
    expect(onSettings).toHaveBeenCalledTimes(1)
    window.removeEventListener("app.help", help)
  })
  it("Show characters in the menu is the existing setting, and the menu stays open while it is switched", async () => {
    render(<ProfileMenu paid="off" onSettings={() => {}} />)
    const user = userEvent.setup()
    const menu = await open(user)
    await user.click(menu.getByRole("menuitemcheckbox", { name: "Show characters" }))
    expect(charactersShown()).toBe(true); expect(localStorage.getItem("app.characters")).toBe("1")
    expect(screen.getByRole("menuitemcheckbox", { name: "Show characters" })).toHaveAttribute("aria-checked", "true")
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Show characters" }))
    expect(charactersShown()).toBe(false)
  })
})

describe("Your profile, in Settings", () => {
  it("saves in this browser, shows in the row at once, clears again, and sends nothing to the engine", async () => {
    const sent = engine()
    render(<><SettingsView /><ProfileMenu paid="off" onSettings={() => {}} /></>)
    const user = userEvent.setup()
    const section = within(screen.getByRole("region", { name: "Your profile" }))
    expect(section.getByLabelText("Name")).toHaveValue("")
    expect(section.queryByRole("button", { name: "Clear" })).toBeNull() // nothing to clear yet
    await user.click(section.getByRole("button", { name: "Save" })) // a profile needs a name
    expect(section.getByRole("status")).toHaveTextContent("Type a name first. Nothing was saved.")
    expect(readProfile()).toBeUndefined()
    await user.type(section.getByLabelText("Name"), "  Brendan   Dang ")
    await user.type(section.getByLabelText("Organisation or client"), "Acme Bio")
    await user.type(section.getByLabelText(/^Role/), "Lead")
    await user.click(section.getByRole("button", { name: "Save" }))
    expect(section.getByRole("status")).toHaveTextContent("Saved in this browser.")
    expect(readProfile()).toEqual({ name: "Brendan Dang", organisation: "Acme Bio", role: "Lead" })
    expect(JSON.parse(localStorage.getItem("app.profile")!)).toEqual({ name: "Brendan Dang", organisation: "Acme Bio", role: "Lead" })
    expect(row()).toHaveAccessibleName("Brendan Dang: profile and settings") // the row follows at once
    expect(row()).toHaveTextContent("Acme Bio")
    // nothing about the profile went to the engine: only reads, and no request carries the name
    expect(sent.every((r) => r.method === "GET")).toBe(true)
    expect(JSON.stringify(sent)).not.toMatch(/Brendan|Acme|profile/i)
    await user.click(section.getByRole("button", { name: "Clear" }))
    expect(section.getByRole("status")).toHaveTextContent("Cleared.")
    expect(localStorage.getItem("app.profile")).toBeNull()
    expect(section.getByLabelText("Name")).toHaveValue("")
    expect(row()).toHaveAccessibleName("Set up your profile: profile and settings")
    expect(sent.every((r) => r.method === "GET")).toBe(true)
  })
  it("reads what was saved before, and ignores a stored value it cannot use", () => {
    localStorage.setItem("app.profile", JSON.stringify({ name: "Ada Lovelace", organisation: "Analytical Engines", role: "" }))
    expect(readProfile()).toEqual({ name: "Ada Lovelace", organisation: "Analytical Engines", role: "" })
    for (const bad of ["not json", JSON.stringify({ organisation: "no name" }), JSON.stringify(null), JSON.stringify({ name: 5 })]) { localStorage.setItem("app.profile", bad); expect(readProfile()).toBeUndefined() }
    expect(initials("Brendan Dang")).toBe("BD"); expect(initials("brendan")).toBe("B"); expect(initials("Mary-Jane van der Berg")).toBe("MB")
  })
})
