// The live answer chat (LiveChat.tsx) and the Research answer while it is written: the text appears as the engine
// streams it, in order; the quiet status lines say what the team is doing; a reconnect or a reload picks the stream up
// again; a finished answer is drawn at once, never typed out. Event streams are stand-ins (a fake EventSource fed the engine's own example streams); nothing talks to an engine.
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { RunRef } from "@/lab/runs"
import { forgetScripted } from "@/lib/scripted"
import { foldAnswer, oncePractice, type ResearchEvent } from "@/research/model"
import S_DEMO from "@/test/research/stream-demo.jsonl?raw"
import DIVARASIB from "@/test/research/real-divarasib.jsonl?raw"
import { doneLine, isLive, runningAnswer, statusLines } from "./liveModel"
import { ResearchAnswer } from "./Answer"
import { LiveChat } from "./LiveChat"

const lines = (raw: string): ResearchEvent[] => raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as ResearchEvent)
const streams: { url: string; onmessage?: (m: { data: string }) => void; onerror?: () => void; close: () => void }[] = []
beforeEach(() => {
  streams.length = 0; forgetScripted()
  vi.stubGlobal("EventSource", class { url: string; onmessage?: (m: { data: string }) => void; onerror?: () => void; constructor(url: string) { this.url = url; streams.push(this) } close() {} })
})
const feed = (events: ResearchEvent[]) => act(() => { for (const s of streams.filter((x) => /\/api\/research\//.test(x.url))) for (const e of events) s.onmessage?.({ data: JSON.stringify(e) }) })
const chat = () => screen.getByRole("article", { name: "Answer" })
const text = () => chat().querySelector(".live-text")
const started = (id = "a-1"): ResearchEvent => ({ seq: 1, at: 1, run: id, type: "research.started", id, question: "Does divarasib beat sotorasib?", mode: "real", caps: { maxUsd: 0.6, maxSeconds: 120 } })
const show = async (id = "a-1") => {
  const onContinue = vi.fn()
  render(<LiveChat target={{ id, question: "Does divarasib beat sotorasib?" }} continueLabel="Ask a follow-up in Research" onContinue={onContinue} />)
  await waitFor(() => expect(streams.some((s) => s.url.endsWith(`/api/research/${id}/events`))).toBe(true))
  return onContinue
}

describe("the live answer chat", () => {
  it("shows each piece of the text as it arrives, in order, with the steps as quiet lines above it", async () => {
    const real = lines(DIVARASIB)
    const deltas = real.filter((e) => e.type === "answer.delta")
    expect(deltas.length).toBeGreaterThan(3) // a real answer, streamed in pieces by the engine
    const before = real.filter((e) => (e.seq ?? 0) < (deltas[0].seq ?? 0))
    const onContinue = await show()
    await feed(before)
    expect(screen.getByRole("heading", { name: "Does divarasib beat sotorasib?" })).toBeInTheDocument() // the question is the person's message
    const steps = within(chat()).getByRole("list", { name: "What the team is doing" })
    expect(steps.textContent).toMatch(/Writing the answer from \d+ sources…/) // the writer's step, running, in the engine's words
    expect(steps.querySelector("li[data-status=completed]")).toBeTruthy() // and the last steps that ended, quietly
    let sofar = ""
    for (const d of deltas) {
      await feed([d])
      sofar += String(d.text)
      // What has arrived is on the page, nothing more: the last words of the newest piece and not those of the next one.
      const shown = (text()?.textContent ?? "").replace(/\s+/g, " ")
      const last = String(d.text).trim().split(/\s+/).slice(-2).join(" ").replace(/[*[\]]/g, "")
      expect(shown).toContain(last.slice(-12))
      expect(text()?.getAttribute("data-live")).toBe("true")
      expect(screen.getByText("Writing now")).toBeInTheDocument()
    }
    expect((text()?.textContent ?? "").indexOf("Krascendo 1")).toBeLessThan((text()?.textContent ?? "").indexOf("This is a research summary")) // in the order written
    expect(foldAnswer([...before, ...deltas]).markdown).toBe(sofar)
    // The engine's finished text replaces the stream; then it is checked, and the chat says it is done.
    await feed(real.filter((e) => (e.seq ?? 0) > (deltas.at(-1)!.seq ?? 0)))
    expect(text()?.getAttribute("data-live")).toBeNull()
    expect(screen.queryByText("Writing now")).toBeNull()
    expect(within(chat()).queryByRole("list", { name: "What the team is doing" })).toBeNull()
    expect(within(chat()).getByRole("status").textContent).toMatch(/\d+ sources · \d+ of \d+ cited statements checked/)
    expect(within(chat()).getByRole("list", { name: "Sources" }).querySelectorAll("li").length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole("button", { name: "Ask a follow-up in Research" }))
    expect(onContinue).toHaveBeenCalled()
  })

  it("draws a finished answer at once: the whole text in the first render, never typed out", async () => {
    const demo = lines(S_DEMO)
    await show("a-20261114231843-79fc44d1")
    await feed(demo) // a reload of a finished answer: the engine replays every event at once
    expect(text()?.getAttribute("data-live")).toBeNull()
    expect(text()?.textContent).toContain("Switch to Real to ask your question for real.")
    expect(screen.queryByText("Writing now")).toBeNull()
    expect(document.querySelector(".prov")?.textContent).toContain("Practice") // a demo answer says what it is
    expect(chat().querySelectorAll(".answer-mark").length).toBeGreaterThan(0) // the checks the engine recorded
  })

  it("a reconnect replays what was already shown: nothing is shown twice, and the text goes on", async () => {
    await show()
    const piece = (seq: number, t: string): ResearchEvent => ({ seq, at: seq, run: "a-1", key: `answer.delta:${seq}`, type: "answer.delta", text: t })
    await feed([started(), { seq: 2, at: 2, run: "a-1", type: "step.started", step: "write", kind: "write", label: "Writing the answer from 3 sources" }, piece(3, "Alpha beta "), piece(4, "gamma delta ")])
    await act(() => { streams[0].onerror?.() })
    expect(screen.getByRole("alert").textContent).toContain("connection to the engine was lost")
    expect(text()?.textContent).toContain("Alpha beta gamma delta") // what arrived is kept
    // The browser reconnects with Last-Event-ID; an engine may still send a piece again. Each seq counts once.
    await feed([piece(4, "gamma delta "), piece(5, "epsilon.")])
    expect(screen.queryByRole("alert")).toBeNull()
    expect((text()?.textContent ?? "").replace(/\s+/g, " ").trim()).toBe("Alpha beta gamma delta epsilon.")
  })

  it("never turns HTML in the streamed text into elements, also while it is live", async () => {
    await show()
    await feed([started(), { seq: 2, at: 2, run: "a-1", type: "answer.delta", text: "Safe <img src=x onerror=alert(1)> text <script>alert(2)</script> and [a link](javascript:alert(3))" }])
    expect(text()?.getAttribute("data-live")).toBe("true")
    expect(text()?.querySelector("img, script")).toBeNull()
    expect(text()?.querySelector("a[href^='javascript']")).toBeNull()
  })
})

describe("the compact preview (a running item opened from a list)", () => {
  it("shows the live text without Stop or the source list, and links to the whole answer", async () => {
    const onContinue = vi.fn()
    render(<LiveChat target={{ id: "a-1", question: "Q?" }} compact level={3} onContinue={onContinue} />)
    await waitFor(() => expect(streams.length).toBe(1))
    await feed([started(), { seq: 2, at: 2, run: "a-1", type: "answer.delta", text: "Being written" }])
    expect(screen.getByRole("heading", { level: 3, name: "Q?" })).toBeInTheDocument()
    expect(text()?.getAttribute("data-live")).toBe("true")
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Open in Research" }))
    expect(onContinue).toHaveBeenCalled()
  })
})

describe("the Research answer, while it is written", () => {
  it("shows the text live under the quiet step lines, then the finished text at once", async () => {
    const real = lines(DIVARASIB)
    const deltas = real.filter((e) => e.type === "answer.delta")
    render(<ResearchAnswer id="a-1" latest />)
    await waitFor(() => expect(streams.some((s) => s.url.endsWith("/api/research/a-1/events"))).toBe(true))
    await feed(real.filter((e) => (e.seq ?? 0) <= (deltas[1].seq ?? 0)))
    const answerText = () => document.querySelector(".answer-text")
    expect(answerText()?.getAttribute("data-live")).toBe("true")
    expect(answerText()?.textContent).toContain("Krascendo 1")
    expect(document.querySelector(".working")?.textContent).toMatch(/Writing the answer/) // the running step, in its own line
    expect(screen.getByRole("list", { name: "What the team has done so far" }).querySelector("li[data-status=completed]")).toBeTruthy()
    await feed(real.filter((e) => (e.seq ?? 0) > (deltas[1].seq ?? 0)))
    expect(answerText()?.getAttribute("data-live")).toBeNull()
    expect(screen.queryByRole("list", { name: "What the team has done so far" })).toBeNull()
  })
})

describe("the chat's pure parts", () => {
  const run = (over: Partial<RunRef>): RunRef => ({ kind: "answer", id: "a", title: "Q", startedAt: 0, live: false, status: "finished", ...over })
  it("picks the newest answer in progress; never a team review or a finished one", () => {
    expect(runningAnswer([run({ id: "a-1", live: true, startedAt: 1 }), run({ id: "a-2", live: true, startedAt: 2, title: "Newest" }), run({ id: "b-1", kind: "board", live: true, startedAt: 3 }), run({ id: "a-3", startedAt: 4 })])).toEqual({ id: "a-2", question: "Newest" })
    expect(runningAnswer([run({ id: "a-3" })])).toBeUndefined()
    expect(runningAnswer(undefined)).toBeUndefined()
  })
  it("a practice answer's own demo sentence is left out also while it is still streaming, so it never shows and then vanishes", () => {
    expect(oncePractice("**Demo answer. This is fixed")).toBe("")
    expect(oncePractice("**Demo answer. This is fixed example text.** In the example")).toBe("In the example")
    expect(oncePractice("**Yes.** In a trial")).toBe("**Yes.** In a trial")
  })
  it("status lines: the running steps and the last few that ended; none once the answer has ended", () => {
    const step = (n: number, status = "completed"): ResearchEvent[] => [{ seq: n * 2, type: "step.started", step: `s${n}`, kind: "search", label: `Step ${n}` }, ...(status === "running" ? [] : [{ seq: n * 2 + 1, type: "step.finished", step: `s${n}`, status, ms: 5, found: 2, kept: 1 }])]
    const events = [started(), ...step(1), ...step(2), ...step(3), ...step(4, "failed"), ...step(5, "running")]
    const s = foldAnswer(events)
    expect(statusLines(s).map((l: { key: string; status: string }) => [l.key, l.status])).toEqual([["s2", "completed"], ["s3", "completed"], ["s4", "failed"], ["s5", "running"]])
    expect(statusLines(s)[3].text).toBe("Step 5…")
    expect(isLive(s)).toBe(true)
    const done = foldAnswer([...events, { seq: 99, type: "research.finished", usd: 0, seconds: 12 }])
    expect(statusLines(done)).toEqual([])
    expect(isLive(done)).toBe(false)
    expect(doneLine(done)).toBe("No sources were found · took 12s")
  })
})
