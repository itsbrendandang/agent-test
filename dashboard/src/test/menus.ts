// Drive shadcn (Radix) selects and menus in jsdom the way a keyboard user does: open with Enter, then pick an item.
import { act, fireEvent, screen } from "@testing-library/react"

/** Open a select or a menu from its trigger with the keyboard. */
export function openMenu(trigger: HTMLElement) {
  act(() => { trigger.focus() })
  fireEvent.keyDown(trigger, { key: "Enter" })
}

/** Choose an option of a shadcn Select, found by its accessible name. */
export function choose(trigger: HTMLElement, option: string | RegExp) {
  openMenu(trigger)
  fireEvent.click(screen.getByRole("option", { name: option }))
}

/** Choose an item of a shadcn DropdownMenu, found by its accessible name. */
export function chooseMenuItem(trigger: HTMLElement, item: string | RegExp) {
  openMenu(trigger)
  fireEvent.click(screen.getByRole("menuitem", { name: item }))
}
