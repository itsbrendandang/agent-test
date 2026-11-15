import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ViewBoundary } from "./ViewBoundary"

const Broken = (): never => { throw new Error("cannot read properties of undefined (reading 'length')") }

describe("ViewBoundary", () => {
  it("shows what happened instead of a blank app, and keeps what is outside the view", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    render(<><nav>rail</nav><ViewBoundary view="Swarm"><Broken /></ViewBoundary></>)
    expect(screen.getByText("rail")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("The Swarm view stopped working")
    expect(screen.getByRole("alert")).toHaveTextContent("reading 'length'")
    expect(screen.getByRole("button", { name: "Load the page again" })).toBeInTheDocument()
  })
  it("clears when another view is opened", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { rerender } = render(<ViewBoundary view="Swarm"><Broken /></ViewBoundary>)
    rerender(<ViewBoundary view="Board"><p>board</p></ViewBoundary>)
    expect(screen.getByText("board")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
