// Engine events in, activity model out: one block of tests for each of the three sources.
import { describe, expect, it } from "vitest"
import { answerLab, boardLab, stepCharacter, swarmLab, swarmProvenance, swarmTimes, visitorRoom, type LabEvent } from "./adapter"
import { PRACTICE_ANSWER, PRACTICE_REVIEW } from "./fixtures/practice"
import { CANCELLED_ANSWER, FAILED_ANSWER, REAL_ANSWER, REVIEW_WITH_VISITOR, SWARM_NOTES, SWARM_RUN, T0 } from "./fixtures/streams"
import { CHARACTER_IDS, type CharacterId, type LabModel } from "./model"

const states = (m: LabModel) => Object.fromEntries(CHARACTER_IDS.map((id) => [id, m.characters[id].inRun ? m.characters[id].state : "not in run"]))
const upTo = (events: LabEvent[], seq: number) => events.filter((e) => (e.seq as number) <= seq)
const trips = (m: LabModel, id: CharacterId) => m.characters[id].trips
const shuffled = <T,>(list: T[]): T[] => list.map((v, i) => ({ v, k: (i * 7919) % list.length })).sort((a, b) => a.k - b.k).map((x) => x.v)
const text = (m: LabModel) => m.log.map((l) => l.text).join("\n")

describe("a team review (boardLab)", () => {
  it("is nobody's work before any event", () => {
    const m = boardLab([], "r1")
    expect(m.status).toBe("waiting")
    expect(CHARACTER_IDS.every((id) => m.characters[id].state === "idle" && m.characters[id].trips.length === 0)).toBe(true)
    expect(m.log).toHaveLength(0)
  })

  it("reads a practice review as Practice, from the run's own first event", () => {
    const m = boardLab(PRACTICE_REVIEW.slice(0, 1))
    expect(m.provenance).toBe("practice")
    expect(m.title).toBe("KRAS G12C hit-to-lead (illustrative data)")
    expect(m.status).toBe("running")
    expect(m.characters.navigator).toMatchObject({ state: "working", doing: "Framing the question for the team." })
    expect(boardLab([{ key: "run", at: T0, type: "run.started", title: "x", mock: false }]).provenance).toBe("live")
    expect(boardLab([{ key: "run", at: T0, type: "run.started", title: "x" }]).provenance).toBeUndefined() // not said: not guessed
  })

  it("puts the team to work when a round starts, and the modes and code steps wait", () => {
    const m = boardLab(PRACTICE_REVIEW.slice(0, 3))
    expect(states(m)).toMatchObject({ navigator: "working", scout: "working", proposer: "working", experimenter: "working", auditor: "working", critic: "working", reporter: "working", pilot: "idle", reviser: "idle", guardian: "idle", finisher: "idle", librarian: "not in run" })
    expect(m.characters.scout.doing).toBe("Round 1: searching for evidence, then writing its reply.")
    expect(m.characters.scout.since).toBe(PRACTICE_REVIEW[2].at)
  })

  it("sends the Scout to fetch when a search result is reported, with what it carried back", () => {
    const m = boardLab(PRACTICE_REVIEW.slice(0, 4))
    expect(trips(m, "scout")).toEqual([expect.objectContaining({ kind: "fetch", room: "discovery", label: "3 example sources from the example sources (practice) (1 more screened out)", short: "3 example sources", outcome: "carried" })])
    expect(m.characters.scout.lastFetched?.label).toMatch(/^3 example sources/)
    expect(m.characters.scout.state).toBe("working") // it still has its reply to write
  })

  it("hands each reply to the lead, gives the reply to the mode that wrote it, and leaves a member with no task idle", () => {
    const m = boardLab(PRACTICE_REVIEW.slice(0, 10)) // round 1 replies
    expect(states(m)).toMatchObject({ scout: "handing-off", proposer: "handing-off", pilot: "handing-off", experimenter: "idle", auditor: "idle", critic: "idle", reporter: "idle" })
    expect(m.characters.pilot.doing).toBe("Round 1: gave its reply to the lead scientist.")
    expect(m.characters.experimenter.doing).toBe("Round 1: the experimenter worked as the Pilot.")
    expect(m.characters.auditor.doing).toBe("No task in round 1.")
    expect(trips(m, "pilot")).toEqual([expect.objectContaining({ kind: "handoff", room: "planning", to: "navigator" })])
    expect(trips(m, "auditor")).toHaveLength(0)
    expect(m.characters.guardian).toMatchObject({ state: "fetching", doing: "Checking round 1's statements against their sources." })
  })

  it("walks the Guardian to Evidence review once for each checked statement, with the app's four marks", () => {
    const m = boardLab(REVIEW_WITH_VISITOR.slice(0, 16))
    const walked = trips(m, "guardian")
    expect(walked).toHaveLength(4)
    expect(walked.every((t) => t.kind === "fetch" && t.room === "review" && t.outcome === "carried")).toBe(true)
    expect(walked.map((t) => t.short)).toEqual(["✓ Supported", "✕ Contradicted", "? Insufficient evidence", "○ Not checked"])
    expect(m.characters.guardian.lastFetched?.label).toBe("○ Not checked: “Placeholder statement D”")
    expect(m.log.find((l) => l.text.includes("Contradicted"))?.tone).toBe("bad")
  })

  it("plays the whole practice review to the end: memo, completeness check, everyone done", () => {
    const m = boardLab(PRACTICE_REVIEW)
    expect(m.status).toBe("done")
    expect(m.characters.navigator.trips.at(-1)).toMatchObject({ kind: "handoff", room: "report", label: "the decision memo" })
    expect(m.characters.finisher).toMatchObject({ state: "done", doing: "Checked the memo: every required section is present." })
    expect(m.characters.guardian.doing).toBe("Checked 13 statements: 9 supported, 2 contradicted, 2 insufficient evidence, 0 not checked.")
    expect(m.characters.reviser.state).toBe("done") // the experimenter's Reviser mode replied in round 2
    expect(m.characters.librarian).toMatchObject({ inRun: false, state: "idle" }) // a review's searches are the scout's
    expect(CHARACTER_IDS.filter((id) => m.characters[id].state === "working" || m.characters[id].state === "fetching")).toEqual([])
  })

  it("gives every search of a review to the Scout, the one member that searches; nothing kept is an empty trip", () => {
    const m = boardLab(REVIEW_WITH_VISITOR.slice(0, 6))
    expect(trips(m, "scout").map((t) => [t.label, t.outcome])).toEqual([
      ["3 results from the web (Exa) (2 more screened out)", "carried"],
      ["8 papers from PubMed and preprints (Europe PMC) (4 more screened out)", "carried"],
      ["nothing kept from ChEMBL (3 results screened out)", "empty"],
    ])
    expect(m.characters.scout.lastFetched).toMatchObject({ provider: "europepmc" })
    expect(trips(m, "scout").map((t) => [t.short, t.provider])).toEqual([["3 results · Exa", "exa"], ["8 papers · PubMed", "europepmc"], ["nothing", "chembl"]])
    expect(m.searches).toEqual({ exa: 1, europepmc: 1, chembl: 1 }) // each search the run reported, by where it looked
    expect(boardLab(REVIEW_WITH_VISITOR.slice(0, 4)).characters.scout.doing).toBe("Round 1: searched the web (Exa) for “placeholder web query” and brought back 3 results from the web (Exa) (2 more screened out). It still has its reply to write.")
    expect(m.log.at(-1)?.text).toBe("Scout searched ChEMBL for “placeholder database query”: nothing kept from ChEMBL (3 results screened out).")
    expect(m.characters.librarian).toMatchObject({ inRun: false, trips: [] }) // not a second face for the scout
    expect(m.characters.librarian.standsFor).toMatch(/all made by the Scout/)
  })

  it("captions each character with the engine's title of the agent it shows", () => {
    const m = boardLab(REVIEW_WITH_VISITOR.slice(0, 3))
    expect(m.characters.navigator.label).toBe("Lead Scientist")
    expect(m.characters.auditor.label).toBe("Methods Auditor")
    expect(m.characters.scout.label).toBeUndefined() // "Scout (Data and Evidence)" is the Scout: the character's own name
    expect(m.characters.guardian.label).toBe("Statement checker")
    expect(m.characters.finisher.label).toBe("Memo check")
    expect(m.log.find((l) => l.text === "Round 1 started.")?.who).toBe("Lead Scientist")
    // before the team list arrives: the agent's own name, made readable; no title is invented
    expect(boardLab(REVIEW_WITH_VISITOR.slice(0, 1)).characters.navigator.label).toBe("Lead scientist")
    // an answer has steps, not agents: Anh's names stand
    expect(answerLab(REAL_ANSWER).characters.navigator.label).toBeUndefined()
    expect(swarmLab(SWARM_RUN, SWARM_NOTES).characters.guardian.label).toBe("Mark rule")
  })

  it("shows a specialist that joined as a visitor under its real name, and a member that is not on the team as not in this run", () => {
    const m = boardLab(REVIEW_WITH_VISITOR)
    expect(m.visitors).toEqual([expect.objectContaining({ id: "toxicologist", name: "Toxicologist", room: "bench", why: "The question is about a safety margin.", state: "done" })])
    expect(m.characters.proposer).toMatchObject({ inRun: false, state: "idle" })
    expect(m.characters.proposer.standsFor).toMatch(/not on this review's team/)
    expect(m.characters.proposer.trips).toHaveLength(0)
    expect(states(m).proposer).toBe("not in run")
    expect(m.provenance).toBe("live")
    // mid-run: the visitor works with the team and replies
    const mid = boardLab(REVIEW_WITH_VISITOR.slice(0, 12))
    expect(mid.visitors[0]).toMatchObject({ state: "handing-off", doing: "Round 1: gave its reply to the lead scientist." })
    expect(visitorRoom("literature-evidence-synthesist Literature Evidence Synthesist")).toBe("discovery")
    expect(visitorRoom("attending-skeptic Attending Skeptic")).toBe("review")
    expect(visitorRoom("medicinal-chemist Medicinal Chemist")).toBe("bench")
  })

  it("keeps a failure on the lead and stops the others, and a resume clears the run's status", () => {
    const failed = [...REVIEW_WITH_VISITOR.slice(0, 3), { key: "failed:1", at: T0 + 6000, type: "run.failed", error: "The model's provider refused the key." }]
    const m = boardLab(failed)
    expect(m.status).toBe("failed")
    expect(m.note).toBe("The model's provider refused the key.")
    expect(m.characters.navigator).toMatchObject({ state: "failed", problem: { text: "The model's provider refused the key.", at: T0 + 6000 } })
    expect(m.characters.scout).toMatchObject({ state: "idle", doing: "Stopped: the review failed." })
    const resumed = boardLab([...failed, { key: "resumed", at: T0 + 9000, type: "run.resumed" }, { key: "round:1", at: T0 + 9500, type: "round.started", round: 1, final: false }])
    expect(resumed.status).toBe("running")
    expect(resumed.characters.navigator.state).toBe("working")
    expect(resumed.characters.navigator.problem).toBeDefined() // what failed stays visible
  })

  it("counts an event once when it arrives twice, and gives the same model whatever order events arrive in", () => {
    const whole = boardLab(REVIEW_WITH_VISITOR)
    expect(boardLab([...REVIEW_WITH_VISITOR, ...REVIEW_WITH_VISITOR.slice(3, 20)])).toEqual(whole)
    expect(boardLab(shuffled(REVIEW_WITH_VISITOR))).toEqual(whole)
    expect(trips(whole, "guardian")).toHaveLength(4)
    // a crash replay emits the same key again: the later copy replaces the earlier
    const again = boardLab([...REVIEW_WITH_VISITOR.slice(0, 14), { ...REVIEW_WITH_VISITOR[13], verdict: "verified", at: T0 + 47_000 }])
    expect(trips(again, "guardian").map((t) => t.short)).toEqual(["✓ Supported", "✓ Supported"])
  })

  it("ignores events it does not know and fields that are malformed", () => {
    const m = boardLab([{ type: "run.started", at: T0, key: "run", title: 5, mock: "yes" }, { type: "something.new", at: T0 + 1 }, null as unknown as LabEvent, { at: T0 + 2 }, { type: "member.replied", at: T0 + 3, key: "x" }, { type: "evidence.triaged", at: T0 + 4, key: "e", kept: "many" }])
    expect(m.status).toBe("running")
    expect(m.title).toBeUndefined()
    expect(m.provenance).toBeUndefined()
    expect(trips(m, "scout")[0]).toMatchObject({ outcome: "empty" })
  })

  it("recognises older reviews whose pilot, reviser and finisher were members of their own", () => {
    const old: LabEvent[] = [
      { key: "run", at: T0, type: "run.started", title: "old", mock: true },
      { key: "round:1", at: T0 + 1, type: "round.started", round: 1, final: false },
      { key: "reply:1:pilot", at: T0 + 2, type: "member.replied", round: 1, member: "pilot", text: "In short: x." },
      { key: "reply:1:reviser", at: T0 + 2, type: "member.replied", round: 1, member: "reviser", text: "In short: x." },
    ]
    const m = boardLab(old)
    expect(states(m)).toMatchObject({ pilot: "handing-off", reviser: "handing-off" })
    expect(CHARACTER_IDS.filter((id) => !m.characters[id].inRun)).toEqual(["librarian"]) // no team list: no member is ruled out
  })
})

describe("a research answer (answerLab)", () => {
  it("names the teammate for each kind of step", () => {
    expect([stepCharacter("prepare", undefined), stepCharacter("search", "exa"), stepCharacter("search", "fixture"), stepCharacter("search", "europepmc"), stepCharacter("search", "chembl"), stepCharacter("fetch", "europepmc"), stepCharacter("evaluate", "exa"), stepCharacter("write", undefined), stepCharacter("check", undefined), stepCharacter("review", undefined), stepCharacter("revise", undefined), stepCharacter("save", undefined), stepCharacter("dance", undefined)])
      .toEqual(["navigator", "scout", "scout", "librarian", "librarian", "librarian", "auditor", "reporter", "guardian", "critic", "reviser", "finisher", undefined])
  })

  it("marks who has no part in an answer, and says what each of the others stands for", () => {
    const m = answerLab(REAL_ANSWER.slice(0, 1))
    expect(states(m)).toMatchObject({ proposer: "not in run", experimenter: "not in run", pilot: "not in run", navigator: "idle", scout: "idle", guardian: "idle" })
    expect(m.characters.guardian.standsFor).toMatch(/statement check/)
    expect(m.characters.pilot.standsFor).toMatch(/A research answer has no such step/)
    expect(m.provenance).toBe("live")
    expect(m.title).toBe("Placeholder question for a hand-written stream")
  })

  it("follows a search out and back: fetching while it runs, then the parcel with what was found", () => {
    const out = answerLab(upTo(REAL_ANSWER, 5))
    expect(out.characters.scout).toMatchObject({ state: "fetching", doing: "Searching the web: “placeholder web query”.", since: T0 + 2600 })
    expect(trips(out, "scout")).toEqual([expect.objectContaining({ id: "step:search:exa:1", kind: "fetch", room: "discovery", at: T0 + 2600 })])
    expect(trips(out, "scout")[0].back).toBeUndefined()
    const back = answerLab(upTo(REAL_ANSWER, 6))
    expect(trips(back, "scout")[0]).toMatchObject({ id: "step:search:exa:1", back: T0 + 5100, outcome: "carried", label: "6 results from the web (Exa)", short: "6 results · Exa", provider: "exa" })
    expect(back.characters.scout).toMatchObject({ state: "done", lastFetched: { label: "6 results from the web (Exa)", room: "discovery", at: T0 + 5100, provider: "exa" } })
    expect(back.searches).toEqual({ exa: 1 })
  })

  it("hands work on when one step finishes and the next starts", () => {
    const m = answerLab(upTo(REAL_ANSWER, 7))
    expect(trips(m, "navigator")).toEqual([expect.objectContaining({ kind: "handoff", room: "discovery", to: "scout", label: "the search plan for the Scout" })])
    expect(m.characters.navigator.state).toBe("handing-off")
    expect(trips(m, "scout").at(-1)).toMatchObject({ kind: "handoff", room: "review", to: "auditor", label: "the search results for the Auditor" })
    expect(m.characters.scout).toMatchObject({ state: "handing-off", doing: "Gave the search results to the Auditor." })
    expect(m.characters.auditor).toMatchObject({ state: "fetching", doing: "Screening 6 results." })
  })

  it("keeps overlapping steps apart: two searches on one teammate, a screening while another search runs", () => {
    const m = answerLab(upTo(REAL_ANSWER, 14))
    // the Librarian has four searches; one came back, three are out
    const lib = trips(m, "librarian").filter((t) => t.kind === "fetch")
    expect(lib.map((t) => [t.id, t.back !== undefined])).toEqual([["step:search:europepmc:1", true], ["step:search:europepmc:2", false], ["step:search:chembl:1", false], ["step:search:clinicaltrials:1", false]])
    expect(m.characters.librarian.state).toBe("fetching") // still out for the others
    expect(m.characters.auditor.state).toBe("fetching") // screening the first results meanwhile
    expect(lib[0]).toMatchObject({ label: "8 papers from PubMed and preprints (Europe PMC)", short: "8 papers · PubMed", outcome: "carried", provider: "europepmc" })
    expect(m.searches).toEqual({ exa: 1, europepmc: 2, chembl: 1, clinicaltrials: 1 })
    // the Navigator gave its plan to the Scout and then to the Librarian, once each
    expect(trips(m, "navigator").map((t) => t.to)).toEqual(["scout", "librarian"])
  })

  it("brings an empty search back with nothing and says so", () => {
    const m = answerLab(upTo(REAL_ANSWER, 15))
    const empty = trips(m, "librarian").find((t) => t.id === "step:search:chembl:1")
    expect(empty).toMatchObject({ outcome: "empty", label: "nothing from ChEMBL", short: "nothing" })
    expect(m.log.at(-1)).toMatchObject({ text: "Librarian: searching ChEMBL: found nothing.", tone: "warn" })
    expect(m.characters.librarian.problem).toBeUndefined() // nothing found is not a failure
  })

  it("keeps a failed step on its teammate to the end, also when it works again and the answer finishes", () => {
    const at16 = answerLab(upTo(REAL_ANSWER, 16))
    expect(trips(at16, "librarian").find((t) => t.id === "step:search:clinicaltrials:1")).toMatchObject({ outcome: "failed" })
    expect(at16.characters.librarian.state).toBe("fetching") // one search is still out
    expect(at16.characters.librarian.problem?.text).toBe("Searching ClinicalTrials.gov: did not work. The service did not answer in 15 seconds. The answer goes on without trial records.")
    const done = answerLab(REAL_ANSWER)
    expect(done.status).toBe("done")
    expect(done.characters.librarian.problem?.text).toMatch(/ClinicalTrials\.gov: did not work/)
    expect(done.log.some((l) => l.tone === "bad" && l.text.includes("ClinicalTrials.gov"))).toBe(true)
  })

  it("shows a teammate whose only step failed as failed, and the answer as failed", () => {
    const m = answerLab(FAILED_ANSWER)
    expect(m.status).toBe("failed")
    expect(m.note).toBe("The model's provider refused the key.")
    expect(m.characters.reporter).toMatchObject({ state: "failed", doing: "Writing the answer from 4 sources: did not work. The model's provider refused the key. No answer was written." })
    expect(CHARACTER_IDS.filter((id) => m.characters[id].state === "failed")).toEqual(["reporter"]) // nobody else is blamed
    expect(m.characters.guardian.state).toBe("idle") // the check never started
  })

  it("lets the check and the review overlap, and walks the Guardian to Evidence review for each statement", () => {
    const m = answerLab(upTo(REAL_ANSWER, 34))
    expect(m.characters.guardian).toMatchObject({ state: "working", doing: "Checking 4 statements against their sources: 2 of 4 so far." })
    expect(m.characters.critic).toMatchObject({ state: "working", doing: "Reviewing the whole draft." })
    expect(trips(m, "guardian").map((t) => [t.room, t.short])).toEqual([["review", "✓ Supported"], ["review", "✕ Contradicted"]])
    // the draft went to both reviewers
    expect(trips(m, "reporter").filter((t) => t.kind === "handoff").map((t) => t.to)).toEqual(["guardian", "critic"])
  })

  it("does not walk for a mark that was only copied from the draft", () => {
    const m = answerLab(REAL_ANSWER)
    const checks = m.characters.guardian.trips.filter((t) => t.id.startsWith("check:"))
    expect(checks.map((t) => t.id)).toEqual(["check:draft:0", "check:draft:1", "check:draft:2", "check:draft:3", "check:final:1"])
    expect(checks.map((t) => t.short)).toEqual(["✓ Supported", "✕ Contradicted", "? Insufficient evidence", "○ Not checked", "✓ Supported"])
  })

  it("finishes with everyone done, and whoever was not needed says so", () => {
    const m = answerLab(REAL_ANSWER)
    expect(states(m)).toMatchObject({ navigator: "done", scout: "done", librarian: "done", auditor: "done", reporter: "done", guardian: "done", critic: "done", reviser: "done", finisher: "done", proposer: "not in run" })
    const quick = answerLab(PRACTICE_ANSWER.filter((e) => !/revise|check:2/.test(String(e.step ?? ""))))
    expect(quick.characters.reviser).toMatchObject({ inRun: true, state: "idle", doing: "Was not needed in this answer." })
  })

  it("sends everyone back to their desks when the answer is cancelled, with trips still out coming back empty", () => {
    const m = answerLab(CANCELLED_ANSWER)
    expect(m.status).toBe("cancelled")
    expect(m.note).toBe("This answer was cancelled.")
    for (const id of ["navigator", "scout", "librarian", "auditor", "reporter", "guardian"] as const) expect(m.characters[id]).toMatchObject({ state: "cancelled", doing: "Cancelled: back at its desk." })
    expect(m.characters.proposer).toMatchObject({ inRun: false, state: "idle" })
    expect(trips(m, "librarian").filter((t) => t.kind === "fetch").every((t) => t.back !== undefined && t.outcome === "empty")).toBe(true)
    expect(m.log.at(-1)?.text).toBe("The answer was cancelled. Everyone is back at their desks.")
    // a stream that ends without the step ends (an older engine): the trip is closed here
    const abrupt = answerLab([...REAL_ANSWER.slice(0, 5), { seq: 6, at: T0 + 3000, type: "research.cancelled" }])
    expect(trips(abrupt, "scout")[0]).toMatchObject({ outcome: "empty", back: T0 + 3000 })
  })

  it("counts a seq once and does not depend on the order events arrive in", () => {
    const whole = answerLab(REAL_ANSWER)
    expect(answerLab([...REAL_ANSWER, ...REAL_ANSWER.slice(10, 30)])).toEqual(whole)
    expect(answerLab(shuffled(REAL_ANSWER))).toEqual(whole)
    expect(answerLab([...REAL_ANSWER.slice(20), ...REAL_ANSWER.slice(0, 20)])).toEqual(whole)
    expect(trips(whole, "scout").filter((t) => t.kind === "fetch")).toHaveLength(1)
  })

  it("ignores a step that ends without having started, a second start, and unknown kinds", () => {
    const m = answerLab([
      REAL_ANSWER[0],
      { seq: 2, at: T0 + 1, type: "step.finished", step: "ghost", status: "completed" },
      { seq: 3, at: T0 + 2, type: "step.started", step: "prepare", kind: "prepare", label: "Preparing the searches" },
      { seq: 4, at: T0 + 3, type: "step.started", step: "prepare", kind: "prepare", label: "Again" },
      { seq: 5, at: T0 + 4, type: "step.started", step: "odd", kind: "dance", label: "Dancing" },
      { seq: 6, at: T0 + 5, type: "wholly.unknown" },
    ])
    expect(m.characters.navigator).toMatchObject({ state: "working", doing: "Preparing the searches." })
    expect(CHARACTER_IDS.filter((id) => m.characters[id].state !== "idle")).toEqual(["navigator"])
    expect(text(m)).toContain("Dancing.")
  })

  it("plays the practice answer as Practice: example sources, nothing searched", () => {
    const m = answerLab(PRACTICE_ANSWER)
    expect(m.provenance).toBe("practice")
    expect(m.status).toBe("done")
    expect(trips(m, "scout").find((t) => t.kind === "fetch")).toMatchObject({ label: "4 example sources from the example sources (practice)" })
    expect(m.characters.librarian).toMatchObject({ inRun: true, state: "idle", doing: "Was not needed in this answer." })
    expect(m.log[0].text).toBe("The answer started (practice: fixed example text, nothing is searched).")
  })

  it("gives the hypotheses step to the Proposer and has the Guardian carry each hypothesis's mark there", () => {
    const h = (seq: number, type: string, fields: Record<string, unknown>): LabEvent => ({ seq, at: T0 + seq * 1000, run: "a-h", type, ...fields })
    const events = [
      REAL_ANSWER[0], REAL_ANSWER[1], REAL_ANSWER[2],
      h(4, "step.started", { step: "hypotheses", kind: "hypothesize", label: "Setting up hypotheses to test" }),
      h(5, "hypotheses", { items: [{ id: "h1", text: "Placeholder hypothesis one", supportIf: "x", contradictIf: "y", origin: "planner" }, { id: "h2", text: "Placeholder hypothesis two", supportIf: "x", contradictIf: "y", origin: "planner" }], needed: true }),
      h(6, "step.finished", { step: "hypotheses", status: "completed", ms: 900, summary: "2 hypotheses." }),
      h(7, "step.started", { step: "search:exa:1", kind: "search", label: "Searching the web", provider: "exa", query: "q", hypothesis: "h1" }),
      h(8, "step.started", { step: "search:exa:2", kind: "search", label: "Searching the web", provider: "exa", query: "q2", hypothesis: "h2" }),
      h(9, "hypothesis.checked", { id: "h1", verdict: "verified", for: [1, 2], against: [], forStatements: 2, againstStatements: 0 }),
      h(10, "hypothesis.checked", { id: "h2", verdict: "contradicted", for: [], against: [3], forStatements: 0, againstStatements: 1 }),
    ]
    const m = answerLab(events)
    expect(m.characters.proposer).toMatchObject({ inRun: true, state: "handing-off", doing: "Gave the hypotheses to test to the Scout." })
    expect(m.characters.proposer.standsFor).toMatch(/hypotheses step of a Standard answer/)
    expect(trips(m, "navigator").map((t) => t.to)).toEqual(["proposer"]) // the plan goes to the hypotheses first
    expect(trips(m, "scout").filter((t) => t.kind === "fetch")).toHaveLength(2) // the two hypotheses' web searches overlap
    expect(trips(m, "guardian").map((t) => [t.kind, t.to, t.short])).toEqual([["handoff", "proposer", "h1 ✓"], ["handoff", "proposer", "h2 ✕"]])
    expect(trips(m, "guardian")[0].label).toBe("the mark of hypothesis h1: ✓ Supported (2 sources for, 0 against)")
    expect(m.log.some((l) => l.text === "2 hypotheses set up to test against published sources.")).toBe(true)
    // an answer without the step keeps the Proposer out of the run
    expect(answerLab(REAL_ANSWER).characters.proposer.inRun).toBe(false)
  })

  it("waits while a follow-up is queued", () => {
    const m = answerLab([{ seq: 1, at: T0, type: "research.queued", after: "a-1" }])
    expect(m).toMatchObject({ status: "waiting", note: "Waiting for the answer before it to finish." })
    expect(answerLab([{ seq: 1, at: T0, type: "research.queued", after: "a-1" }, REAL_ANSWER[0] && { ...REAL_ANSWER[0], seq: 2 }]).status).toBe("running")
  })
})

describe("a swarm run (swarmLab)", () => {
  const notesUpTo = (n: number) => ({ run: { ...SWARM_RUN, phase: "running", finishedAt: undefined }, notes: { events: (SWARM_NOTES.events as unknown[]).slice(0, n) } })

  it("has no run to show, or a run that waits", () => {
    expect(swarmLab(undefined, null).status).toBe("waiting")
    const queued = swarmLab({ ...SWARM_RUN, phase: "queued", detail: "waiting for s-other to finish" }, null)
    expect(queued).toMatchObject({ status: "waiting", note: "waiting for s-other to finish" })
    expect(CHARACTER_IDS.every((id) => queued.characters[id].state === "idle")).toBe(true)
  })

  it("puts the role of the current step to work and hands over between roles", () => {
    const { run, notes } = notesUpTo(4) // settings, scout started, scout finished, propose started
    const m = swarmLab(run, notes)
    expect(m.status).toBe("running")
    expect(m.characters.proposer).toMatchObject({ state: "working", doing: "Planning the analysis and writing down statements to test." })
    expect(m.characters.scout).toMatchObject({ state: "handing-off", doing: "Gave its notes to the Proposer." })
    expect(trips(m, "scout")).toEqual([expect.objectContaining({ kind: "handoff", room: "planning", to: "proposer" })])
    expect(states(m)).toMatchObject({ navigator: "not in run", librarian: "not in run", experimenter: "idle", guardian: "idle" })
    expect(m.characters.navigator.standsFor).toMatch(/The swarm has no such role/)
  })

  it("walks the Guardian for each mark that code worked out from a recorded test", () => {
    const m = swarmLab(SWARM_RUN, SWARM_NOTES)
    expect(trips(m, "guardian").map((t) => [t.room, t.short])).toEqual([["review", "C2 ✕"], ["review", "C1 ✓"]])
    expect(trips(m, "guardian")[0].label).toBe("statement C2: ✕ Contradicted after the test “row count”")
    expect(m.characters.guardian.standsFor).toMatch(/Code computes it; no model decides it/)
  })

  it("ends a finished run with every role that worked done, and labels the scripted model as Practice", () => {
    const m = swarmLab(SWARM_RUN, SWARM_NOTES)
    expect(m.status).toBe("done")
    expect(m.provenance).toBe("practice")
    expect(states(m)).toMatchObject({ scout: "done", proposer: "done", pilot: "done", experimenter: "done", auditor: "done", critic: "done", reviser: "done", reporter: "done", guardian: "done", finisher: "idle" })
    expect(m.characters.finisher.doing).toBe("Had nothing to do in this run.")
    expect(m.characters.auditor.doing).toBe("Gave its notes to the Critic.")
    expect(m.characters.reporter.doing).toBe("Finished: writing up what was done.")
    expect(swarmProvenance({ id: "x", model: "anthropic/claude-sonnet-5-5" })).toBe("live")
    expect(swarmProvenance({ id: "x", model: "ollama/qwen2.5:14b" })).toBe("local")
    expect(swarmProvenance({ id: "x" })).toBeUndefined()
  })

  it("keeps a failure on the role that was working", () => {
    const { notes } = notesUpTo(11) // experiment started
    const m = swarmLab({ ...SWARM_RUN, phase: "failed", error: "the local runner stopped without finishing\nmore detail" }, notes)
    expect(m.status).toBe("failed")
    expect(m.characters.experimenter).toMatchObject({ state: "failed", problem: { text: "the local runner stopped without finishing" } })
    expect(m.characters.scout).toMatchObject({ state: "handing-off", doing: "Gave its notes to the Proposer." })
    expect(CHARACTER_IDS.filter((id) => m.characters[id].state === "failed")).toEqual(["experimenter"])
  })

  it("sends everyone home when the run was cancelled", () => {
    const { notes } = notesUpTo(11)
    const m = swarmLab({ ...SWARM_RUN, phase: "cancelled" }, notes)
    expect(m.status).toBe("cancelled")
    for (const id of ["scout", "proposer", "pilot", "experimenter", "guardian"] as const) expect(m.characters[id].state).toBe("cancelled")
    expect(states(m).navigator).toBe("not in run")
  })

  it("shows a single agent as one teammate working alone", () => {
    const m = swarmLab({ id: "s1", solver: "single", model: "mock", phase: "running", startedAt: T0 }, null)
    expect(CHARACTER_IDS.filter((id) => m.characters[id].inRun)).toEqual(["experimenter"])
    expect(m.characters.experimenter).toMatchObject({ state: "working", standsFor: "The single agent: one agent alone does every step of this run." })
    expect(swarmLab({ id: "s1", solver: "single", model: "mock", phase: "done", startedAt: T0, finishedAt: T0 + 9000 }, null).characters.experimenter.state).toBe("done")
  })

  it("replays a prefix of the notes as a run still going, and notes arriving twice change nothing", () => {
    const part = swarmLab(SWARM_RUN, SWARM_NOTES, { upTo: 16 }) // up to the critic's first problem
    expect(part.status).toBe("running")
    expect(part.characters.critic.state).toBe("working")
    expect(part.log.at(-1)?.text).toMatch(/Critic raised a blocking problem/)
    expect(swarmLab(SWARM_RUN, SWARM_NOTES, { upTo: 999 })).toEqual(swarmLab(SWARM_RUN, SWARM_NOTES))
    expect(swarmLab(SWARM_RUN, SWARM_NOTES)).toEqual(swarmLab(SWARM_RUN, SWARM_NOTES)) // the same snapshot polled again
  })

  it("takes its times from the end of each step, and says they are rough", () => {
    const events = SWARM_NOTES.events as LabEvent[]
    const { at, rough } = swarmTimes(SWARM_RUN, events)
    expect(rough).toBe(true)
    expect(at[1]).toBe(T0) // scout started
    expect(at[2]).toBe(T0 + 5000) // scout finished with 1741 of 1746 seconds left
    expect(at.every((t, i) => i === 0 || t >= at[i - 1])).toBe(true)
    expect(swarmLab(SWARM_RUN, SWARM_NOTES).roughTimes).toBe(true)
    const seen = events.map((_, i) => T0 + i * 1000)
    expect(swarmTimes(SWARM_RUN, events, seen)).toEqual({ at: seen, rough: false })
  })

  it("ignores notes of a shape it does not know", () => {
    const m = swarmLab({ ...SWARM_RUN, phase: "running" }, { events: [null, 7, { kind: "budget.plan", floors: {} }, { kind: "phase.started", phase: "mystery 1" }, { kind: "phase.started" }, { kind: "phase.started", phase: "scout" }] })
    expect(m.characters.scout.state).toBe("working")
    expect(CHARACTER_IDS.filter((id) => m.characters[id].state !== "idle")).toEqual(["scout"])
    expect(swarmLab({ ...SWARM_RUN, phase: "running" }, { events: "broken" }).status).toBe("running")
  })
})
