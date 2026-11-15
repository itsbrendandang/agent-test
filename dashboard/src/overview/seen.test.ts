// Who takes part in a running run and what it does now: from its events when they came, else from its list line.
import { describe, expect, it } from "vitest"
import { answerAgent, seenOf } from "./seen"
import { emptyLab } from "@/lab/model"
import type { Work } from "./work"

const work = (more: Partial<Work> = {}): Work => ({ kind: "answer", id: "a1", title: "Q", startedAt: 1, live: true, status: "in progress", agents: [], ...more })

describe("answerAgent", () => {
  it("gives an answer's step agents the lab's faces and plain labels", () => {
    expect(answerAgent("writer")).toEqual({ name: "reporter", label: "Writer" })
    expect(answerAgent("investigator-2")).toEqual({ name: "librarian", label: "Investigator 2" })
    expect(answerAgent("specialist:toxicologist")).toEqual({ name: "toxicologist", label: "Toxicologist" })
    expect(answerAgent("lead-scientist").name).toBe("lead-scientist")
  })
})

describe("seenOf", () => {
  it("before any event: the step and agents the list line recorded, or that it waits", () => {
    expect(seenOf(work({ agents: ["planner", "writer"], step: { label: "Writing the draft", agent: "writer" } }), undefined)).toEqual({ agents: [{ name: "proposer", label: "Planner" }, { name: "reporter", label: "Writer" }], doing: "Writer: Writing the draft" })
    expect(seenOf(work({ status: "waiting" }), emptyLab()).doing).toBe("Waiting for an earlier answer to finish.")
    expect(seenOf(work(), undefined).doing).toBeUndefined() // nothing reported: nothing claimed
  })
  it("with events: who is at work now and what they do, from the lab model", () => {
    const model = emptyLab()
    model.status = "running"
    for (const a of Object.values(model.characters)) { a.inRun = false; a.state = "idle" }
    model.characters.critic = { ...model.characters.critic, inRun: true, state: "idle", doing: "" } // in the run, not at work yet
    model.characters.scout = { ...model.characters.scout, inRun: true, state: "fetching", doing: "searching Europe PMC", since: 5 }
    model.characters.proposer = { ...model.characters.proposer, inRun: true, state: "done", doing: "set two hypotheses", since: 2 }
    const seen = seenOf(work({ step: { label: "stale step from the list" } }), model)
    expect(seen.doing).toBe("Scout: searching Europe PMC")
    expect(seen.agents.map((a) => a.label)).toEqual(["Scout", "Proposer"])
    // Events that name no one at work yet: the team the run has.
    for (const id of ["scout", "proposer"] as const) model.characters[id] = { ...model.characters[id], state: "idle" }
    expect(seenOf(work(), model).agents.map((a) => a.label)).toEqual(["Scout", "Proposer", "Critic"])
  })
})
