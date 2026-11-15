// Model and engine text is untrusted. It is rendered as Markdown, and nothing in it can become markup that runs,
// a link to anything but http(s), or an image fetched from an address the text chose.
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { SafeMarkdown } from "./SafeMarkdown"

const show = (text: string) => render(<SafeMarkdown>{text}</SafeMarkdown>).container

describe("what it renders", () => {
  it("headings, paragraphs, lists, a table and a code block", () => {
    const c = show("## Finding\n\nFirst paragraph.\n\nSecond paragraph.\n\n- one\n- two\n\n1. first\n2. second\n\n| compound | IC50 |\n|---|---|\n| CMP-1 | 6 µM |\n\n```py\nprint(1 < 2)\n```\n\nInline `code` here.")
    expect(screen.getByRole("heading", { name: "Finding" })).toBeInTheDocument()
    expect(c.querySelectorAll("p").length).toBeGreaterThanOrEqual(2)
    expect(c.querySelectorAll("ul li")).toHaveLength(2)
    expect(c.querySelectorAll("ol li")).toHaveLength(2)
    expect(screen.getByRole("table")).toHaveTextContent("compoundIC50CMP-16 µM")
    expect(c.querySelector("pre")).toHaveTextContent("print(1 < 2)")
    expect(c).toHaveTextContent("Inline code here.")
  })
  it("scientific notation as written: nothing is eaten as markup", () => {
    const c = show("The effect was significant (p < 0.05, n > 3). Potency is 1.2 × 10⁻⁵ M; IC50 = 6 µM; ΔG = −7.3 kcal/mol; H₂O; a<b and b>c; 5 * 3 * 2 = 30; x_1 and y_2; ~40%.")
    expect(c).toHaveTextContent("The effect was significant (p < 0.05, n > 3). Potency is 1.2 × 10⁻⁵ M; IC50 = 6 µM; ΔG = −7.3 kcal/mol; H₂O; a<b and b>c; 5 * 3 * 2 = 30; x_1 and y_2; ~40%.")
  })
  it("an http(s) link opens in a new tab without giving the new page a handle on this one", () => {
    show("See [the paper](https://example.org/paper).")
    const link = screen.getByRole("link", { name: "the paper" })
    expect(link).toHaveAttribute("href", "https://example.org/paper")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
  })
})

describe("what it refuses", () => {
  it("raw HTML stays text: no script, no element, no handler", () => {
    const c = show('Before <script>window.__md = 1</script> <b onclick="window.__md = 1">bold</b> <iframe src="https://evil.example"></iframe> <style>body{display:none}</style> after.')
    expect(c.querySelector("script, iframe, style, b, [onclick]")).toBeNull()
    expect(c).toHaveTextContent("after.")
    expect((window as { __md?: number }).__md).toBeUndefined()
  })
  it("an image is never loaded, from Markdown or from HTML", () => {
    const c = show('![chart](https://evil.example/track.png) and <img src=x onerror="window.__md = 1"> and ![](data:image/svg+xml,<svg onload=alert(1)>)')
    expect(c.querySelector("img, svg, picture, source")).toBeNull()
    expect(c).toHaveTextContent("[image not shown: chart]")
    expect((window as { __md?: number }).__md).toBeUndefined()
  })
  it.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)", "file:///etc/passwd", " javascript:alert(1)"])("a link to %s is not a link", (href) => {
    const c = show(`Click [here](${href}) now. <a href="${href}">or here</a>`)
    expect(c.querySelector("a")).toBeNull()
    expect(c.querySelector("button")).toBeNull() // and nothing else that could be pressed to follow it
    expect(c).toHaveTextContent("here")
  })
  it("an autolink with a script scheme is not a link either", () => {
    const c = show("<javascript:alert(1)> and https://example.org/ok")
    for (const a of c.querySelectorAll("a")) expect(a.getAttribute("href")).toMatch(/^https?:\/\//)
  })
  it("adds no controls that act on the text (no copy, download or fullscreen buttons)", () => {
    const c = show("| a |\n|---|\n| 1 |\n\n```\nx\n```")
    expect(c.querySelector("button")).toBeNull()
  })
})
