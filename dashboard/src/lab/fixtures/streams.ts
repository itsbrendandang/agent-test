// HAND-WRITTEN event streams and one hand-written activity model, for tests and the preview page. They follow the
// engine's contracts (engine/src/events.ts, engine/src/research/types.ts, the swarm's shared notes) but no model and
// no search produced them: nothing here is a research result. The questions and texts are placeholders.
import type { LabEvent, SwarmNotes, SwarmRun } from "../adapter"
import { CHARACTER_IDS, type Activity, type CharacterId, type LabModel } from "../model"

export const T0 = 1_800_000_000_000
const RUN = "a-fixture"
/** One research-answer event: `seq`, seconds after the start, type, fields. */
const a = (seq: number, s: number, type: string, fields: Record<string, unknown> = {}): LabEvent => ({ seq, at: T0 + Math.round(s * 1000), run: RUN, type, ...fields })

/**
 * A standard answer as the real pipeline shapes it: the first web search alone, then the other searches at once with
 * their screening steps overlapping, a search that finds nothing, a search that fails, the check and the review
 * overlapping, one revision, a second check, then saving.
 */
export const REAL_ANSWER: LabEvent[] = [
  a(1, 0, "research.started", { id: RUN, thread: "t-fixture", question: "Placeholder question for a hand-written stream", effort: "standard", mode: "real", caps: { maxUsd: 0.6, maxSeconds: 120 }, models: { planner: "x/planner", writer: "x/writer", checker: "y/checker", critic: "y/critic" } }),
  a(2, 0.1, "step.started", { step: "prepare", kind: "prepare", label: "Preparing the searches" }),
  a(3, 2.4, "step.finished", { step: "prepare", status: "completed", ms: 2300, summary: "3 searches planned." }),
  a(4, 2.5, "opening", { text: "I will search the web, the literature and one database." }),
  a(5, 2.6, "step.started", { step: "search:exa:1", kind: "search", label: "Searching the web", provider: "exa", query: "placeholder web query" }),
  a(6, 5.1, "step.finished", { step: "search:exa:1", status: "completed", ms: 2500, found: 6, summary: "6 results." }),
  a(7, 5.2, "step.started", { step: "evaluate:exa:1", kind: "evaluate", label: "Screening 6 results", provider: "exa" }),
  a(8, 7.0, "step.finished", { step: "evaluate:exa:1", status: "completed", ms: 1800, found: 6, kept: 4, summary: "4 of 6 kept." }),
  // the other searches start together
  a(9, 7.1, "step.started", { step: "search:europepmc:1", kind: "search", label: "Searching PubMed and preprints", provider: "europepmc", query: "placeholder literature query one" }),
  a(10, 7.1, "step.started", { step: "search:europepmc:2", kind: "search", label: "Searching PubMed and preprints", provider: "europepmc", query: "placeholder literature query two" }),
  a(11, 7.2, "step.started", { step: "search:chembl:1", kind: "search", label: "Searching ChEMBL", provider: "chembl", query: "placeholder compound" }),
  a(12, 7.2, "step.started", { step: "search:clinicaltrials:1", kind: "search", label: "Searching ClinicalTrials.gov", provider: "clinicaltrials", query: "placeholder condition" }),
  a(13, 8.9, "step.finished", { step: "search:europepmc:1", status: "completed", ms: 1800, found: 8, summary: "8 results." }),
  a(14, 9.0, "step.started", { step: "evaluate:europepmc:1", kind: "evaluate", label: "Screening 8 results", provider: "europepmc" }),
  a(15, 9.4, "step.finished", { step: "search:chembl:1", status: "empty", ms: 2200, found: 0, summary: "Nothing found." }),
  a(16, 9.8, "step.finished", { step: "search:clinicaltrials:1", status: "failed", ms: 2600, error: "The service did not answer in 15 seconds.", consequence: "The answer goes on without trial records." }),
  a(17, 10.6, "step.finished", { step: "search:europepmc:2", status: "completed", ms: 3500, found: 5, summary: "5 results." }),
  a(18, 10.7, "step.started", { step: "evaluate:europepmc:2", kind: "evaluate", label: "Screening 5 results", provider: "europepmc" }),
  a(19, 11.5, "step.finished", { step: "evaluate:europepmc:1", status: "completed", ms: 2500, found: 8, kept: 5, summary: "5 of 8 kept." }),
  a(20, 12.9, "step.finished", { step: "evaluate:europepmc:2", status: "completed", ms: 2200, found: 5, kept: 2, summary: "2 of 5 kept." }),
  a(21, 13.0, "sources", { items: Array.from({ length: 11 }, (_, i) => ({ n: i + 1, url: `https://example.org/${i + 1}`, title: `Placeholder source ${i + 1}`, provider: i < 4 ? "exa" : "europepmc" })) }),
  a(22, 13.0, "selection", { criteria: "Placeholder rule.", selected: Array.from({ length: 11 }, (_, i) => ({ n: i + 1, why: "placeholder" })), notSelected: [{ title: "x", url: "https://example.org/x", provider: "exa", reason: "placeholder" }] }),
  a(23, 13.1, "step.started", { step: "write", kind: "write", label: "Writing the answer from 11 sources" }),
  a(24, 14.0, "answer.delta", { text: "Placeholder draft text [1]." }),
  a(25, 31.0, "step.finished", { step: "write", status: "completed", ms: 17900, summary: "310 words, 4 cited sentences." }),
  a(26, 31.0, "answer.written", { markdown: "Placeholder draft text [1]." }),
  a(27, 31.1, "step.started", { step: "check", kind: "check", label: "Checking 4 statements against their sources" }),
  a(28, 31.1, "review.started", { reviewer: "checker", model: "y/checker", step: "check" }),
  a(29, 31.2, "step.started", { step: "review", kind: "review", label: "Reviewing the whole draft" }),
  a(30, 31.2, "review.started", { reviewer: "critic", model: "y/critic", step: "review" }),
  a(31, 34.0, "statement.checked", { stage: "draft", index: 0, text: "Placeholder statement one.", sources: [1], verdict: "verified", quoteFound: true, checker: "y/checker" }),
  a(32, 34.0, "step.progress", { step: "check", done: 1, total: 4 }),
  a(33, 36.5, "statement.checked", { stage: "draft", index: 1, text: "Placeholder statement two.", sources: [2], verdict: "contradicted", quoteFound: true, checker: "y/checker" }),
  a(34, 36.5, "step.progress", { step: "check", done: 2, total: 4 }),
  a(35, 38.0, "step.finished", { step: "review", status: "completed", ms: 6800, found: 1, summary: "1 note: 1 major." }),
  a(36, 38.0, "review.note", { index: 0, reviewer: "critic", severity: "major", text: "Placeholder note about a missing caveat.", statement: 1 }),
  a(37, 39.0, "statement.checked", { stage: "draft", index: 2, text: "Placeholder statement three.", sources: [5], verdict: "unsupported", quoteFound: false, checker: "y/checker" }),
  a(38, 41.0, "statement.checked", { stage: "draft", index: 3, text: "Placeholder statement four.", sources: [7], verdict: "unchecked", quoteFound: false, checker: "y/checker" }),
  a(39, 41.1, "step.finished", { step: "check", status: "completed", ms: 10000, summary: "1 holds up, 1 contradicted, 1 unsupported, 1 unchecked." }),
  a(40, 41.2, "step.started", { step: "revise", kind: "revise", label: "Revising the answer once" }),
  a(41, 52.0, "step.finished", { step: "revise", status: "completed", ms: 10800, summary: "2 cited sentences kept, 1 changed, 1 removed." }),
  a(42, 52.0, "answer.revised", { markdown: "Placeholder revised text [1].", notes: [{ index: 0, resolved: true }] }),
  a(43, 52.1, "step.started", { step: "check:2", kind: "check", label: "Checking 1 changed statement against its source" }),
  a(44, 52.2, "statement.checked", { stage: "final", index: 0, text: "Placeholder statement one.", sources: [1], verdict: "verified", quoteFound: true, checker: "y/checker", carried: true }),
  a(45, 55.0, "statement.checked", { stage: "final", index: 1, text: "Placeholder statement two, rewritten.", sources: [2], verdict: "verified", quoteFound: true, checker: "y/checker", carried: false }),
  a(46, 55.1, "step.finished", { step: "check:2", status: "completed", ms: 3000, summary: "1 holds up." }),
  a(47, 55.2, "step.started", { step: "save", kind: "save", label: "Saving the answer and its files" }),
  a(48, 55.3, "artifact.created", { artifact: { id: `${RUN}/answer.md`, name: "answer.md", type: "text/markdown", bytes: 1200, at: T0 + 55_300 } }),
  a(49, 55.4, "step.finished", { step: "save", status: "completed", ms: 200, summary: "The record and three result files." }),
  a(50, 55.5, "research.finished", { usd: 0.11, seconds: 55.5, counts: { sources: 11, statements: 2, verified: 2, contradicted: 0, unsupported: 0, unchecked: 0 }, searches: { exa: 1, europepmc: 2, chembl: 1 } }),
]

/** An answer cancelled while two searches were out: the engine first ends each running step as "cancelled". */
export const CANCELLED_ANSWER: LabEvent[] = [
  ...REAL_ANSWER.slice(0, 12),
  a(13, 8.0, "step.finished", { step: "search:europepmc:1", status: "cancelled", ms: 900 }),
  a(14, 8.0, "step.finished", { step: "search:europepmc:2", status: "cancelled", ms: 900 }),
  a(15, 8.0, "step.finished", { step: "search:chembl:1", status: "cancelled", ms: 800 }),
  a(16, 8.0, "step.finished", { step: "search:clinicaltrials:1", status: "cancelled", ms: 800 }),
  a(17, 8.1, "research.cancelled", { spentUsd: 0.01, seconds: 8.1 }),
]

/** An answer whose writing step failed: the step ends as "failed", then the answer does. */
export const FAILED_ANSWER: LabEvent[] = [
  ...REAL_ANSWER.slice(0, 8),
  a(9, 7.1, "step.started", { step: "write", kind: "write", label: "Writing the answer from 4 sources" }),
  a(10, 9.0, "step.finished", { step: "write", status: "failed", ms: 1900, error: "The model's provider refused the key.", consequence: "No answer was written." }),
  a(11, 9.1, "research.failed", { error: "The model's provider refused the key.", spentUsd: 0.02 }),
]

/** One team-review event: its stable key, seconds after the start, type, fields. */
const b = (key: string, s: number, type: string, fields: Record<string, unknown> = {}): LabEvent => ({ key, at: T0 + Math.round(s * 1000), type, ...fields })

/**
 * A team review with a method specialist on the team, the proposer left out, a literature search by the scout, the
 * experimenter in two of its modes, and every one of the four marks.
 */
export const REVIEW_WITH_VISITOR: LabEvent[] = [
  b("run", 0, "run.started", { runId: "r-fixture", brief: "placeholder", title: "Placeholder review question", mock: false }),
  b("roster", 0.1, "run.roster", { members: [
    { name: "lead-scientist", title: "Lead Scientist", role: "lead", source: "board" },
    { name: "scout", title: "Scout (Data and Evidence)", role: "member", source: "board" },
    { name: "experimenter", title: "Experimenter (Data Scientist)", role: "member", source: "board" },
    { name: "methods-auditor", title: "Methods Auditor", role: "member", source: "board" },
    { name: "critic", title: "Critic", role: "member", source: "board" },
    { name: "reporter", title: "Reporter", role: "member", source: "board" },
    { name: "toxicologist", title: "Toxicologist", role: "member", source: "specialist", why: "The question is about a safety margin." },
  ] }),
  b("round:1", 4, "round.started", { round: 1, message: "Round 1.", final: false }),
  b("evidence:1", 9, "evidence.triaged", { member: "scout", query: "placeholder web query", kept: 3, dropped: 2, provider: "exa", items: [] }),
  b("evidence:2", 14, "evidence.triaged", { member: "scout", query: "placeholder literature query", kept: 8, dropped: 4, provider: "europepmc", items: [] }),
  b("evidence:3", 16, "evidence.triaged", { member: "scout", query: "placeholder database query", kept: 0, dropped: 3, provider: "chembl", items: [] }),
  b("reply:1:scout", 40, "member.replied", { round: 1, member: "scout", text: "In short: placeholder.", summary: "Placeholder scout reply.", usd: 0.01 }),
  b("reply:1:experimenter", 40, "member.replied", { round: 1, member: "experimenter", mode: "pilot", text: "In short: placeholder.", summary: "Placeholder pilot reply.", usd: 0.02 }),
  b("reply:1:methods-auditor", 40, "member.replied", { round: 1, member: "methods-auditor", text: "No task.", summary: "No task.", usd: 0 }),
  b("reply:1:critic", 40, "member.replied", { round: 1, member: "critic", text: "No task.", usd: 0 }),
  b("reply:1:reporter", 40, "member.replied", { round: 1, member: "reporter", text: "No task.", summary: "No task.", usd: 0 }),
  b("reply:1:toxicologist", 40, "member.replied", { round: 1, member: "toxicologist", text: "In short: placeholder.", summary: "Placeholder specialist reply.", usd: 0.02 }),
  b("claim:1", 44, "claim.checked", { round: 1, member: "scout", claim: "Placeholder statement A", kind: "literature", verdict: "verified", checker: "first-pass", quoteFound: true }),
  b("claim:2", 46, "claim.checked", { round: 1, member: "experimenter", claim: "Placeholder statement B", kind: "brief", verdict: "contradicted", checker: "first-pass" }),
  b("claim:3", 52, "claim.checked", { round: 1, member: "toxicologist", claim: "Placeholder statement C", kind: "literature", verdict: "unsupported", checker: "openai" }),
  b("claim:4", 53, "claim.checked", { round: 1, member: "scout", claim: "Placeholder statement D", kind: "brief", verdict: "unchecked", checker: "first-pass" }),
  b("round:2", 70, "round.started", { round: 2, message: "Round 2.", final: true }),
  b("reply:2:scout", 95, "member.replied", { round: 2, member: "scout", text: "In short: placeholder.", summary: "Placeholder.", usd: 0.01 }),
  b("reply:2:experimenter", 95, "member.replied", { round: 2, member: "experimenter", mode: "revise", text: "In short: placeholder.", summary: "Placeholder.", usd: 0.02 }),
  b("reply:2:methods-auditor", 95, "member.replied", { round: 2, member: "methods-auditor", text: "In short: placeholder.", summary: "Placeholder.", usd: 0.02 }),
  b("reply:2:critic", 95, "member.replied", { round: 2, member: "critic", text: "In short: placeholder.", summary: "Placeholder.", usd: 0.02 }),
  b("reply:2:reporter", 95, "member.replied", { round: 2, member: "reporter", text: "In short: placeholder.", summary: "Placeholder.", usd: 0.02 }),
  b("reply:2:toxicologist", 95, "member.replied", { round: 2, member: "toxicologist", text: "In short: placeholder.", summary: "Placeholder.", usd: 0.02 }),
  b("memo", 120, "memo.written", { path: "board/runs/r-fixture/memo.md", decision: "Placeholder" }),
  b("finished", 121, "run.finished", { usd: 0.4, minutes: 2 }),
]

/** A swarm run's record and shared notes, in the shape the demo case writes them (scripted model). */
export const SWARM_RUN: SwarmRun = { id: "s-fixture", solver: "glhf", model: "mock", task: "demo", phase: "done", startedAt: T0, finishedAt: T0 + 14_000 }
export const SWARM_NOTES: SwarmNotes = { events: [
  { kind: "settings", budget_seconds: 1746, review_rounds: 3 },
  { kind: "phase.started", phase: "scout", seconds: 60 },
  { kind: "phase.finished", phase: "scout", limit_hit: false, limit: null, left: 1741, tokens: 6891 },
  { kind: "phase.started", phase: "propose", seconds: 69 },
  { kind: "claim.added", claim: "C1", by: "planner", text: "Placeholder statement one." },
  { kind: "claim.added", claim: "C2", by: "planner", text: "Placeholder statement two." },
  { kind: "phase.finished", phase: "propose", limit_hit: false, limit: null, left: 1740, tokens: 18029 },
  { kind: "phase.started", phase: "pilot", seconds: 139 },
  { kind: "phase.finished", phase: "pilot", limit_hit: false, limit: null, left: 1740, tokens: 21431 },
  { kind: "pilot.checked", contract: "0/2 required artifacts pass the shape check." },
  { kind: "phase.started", phase: "experiment", seconds: 785 },
  { kind: "phase.finished", phase: "experiment", limit_hit: false, limit: null, left: 1737, tokens: 35506 },
  { kind: "phase.started", phase: "audit 1", seconds: 134 },
  { kind: "phase.finished", phase: "audit 1", limit_hit: false, limit: null, left: 1736, tokens: 39421 },
  { kind: "phase.started", phase: "critique 1", seconds: 404 },
  { kind: "issue.raised", issue: "I1", severity: "blocking", problem: "Placeholder problem.", by: "critic" },
  { kind: "test.registered", claim: "C2", name: "row count", method: "Placeholder method.", by: "critic" },
  { kind: "test.recorded", claim: "C2", name: "row count", p: 0.01, contradicts: true, registered: true, e: 0.5, verdict: "refuted", by: "critic" },
  { kind: "phase.finished", phase: "critique 1", limit_hit: false, limit: null, left: 1735, tokens: 59972 },
  { kind: "phase.started", phase: "revise 1", seconds: 809 },
  { kind: "issue.resolved", issue: "I1", status: "fixed", by: "experimenter" },
  { kind: "phase.finished", phase: "revise 1", limit_hit: false, limit: null, left: 1735, tokens: 72162 },
  { kind: "phase.started", phase: "audit 2", seconds: 134 },
  { kind: "phase.finished", phase: "audit 2", limit_hit: false, limit: null, left: 1734, tokens: 76140 },
  { kind: "phase.started", phase: "critique 2", seconds: 404 },
  { kind: "test.registered", claim: "C1", name: "label permutation", method: "Placeholder method.", by: "critic" },
  { kind: "test.recorded", claim: "C1", name: "label permutation", p: 0.0004, contradicts: false, registered: true, e: 25, verdict: "supported", by: "critic" },
  { kind: "phase.finished", phase: "critique 2", limit_hit: false, limit: null, left: 1734, tokens: 91533 },
  { kind: "issues.rechecked", issues: ["I1"] },
  { kind: "review.converged", round: 2 },
  { kind: "phase.started", phase: "report", seconds: 1757 },
  { kind: "phase.finished", phase: "report", limit_hit: false, limit: null, left: 1733, tokens: 98027 },
  { kind: "finished", contract: "2/2 required artifacts pass the shape check.", tokens: 98027 },
] }

/**
 * A hand-written activity model with one teammate in every state, for the scene's tests and the preview page:
 * idle, working, fetching (out, and back with a parcel), handing off, done, failed, cancelled, not in this run,
 * and one visiting specialist.
 */
export function fixtureModel(change: Partial<Record<CharacterId, Partial<Activity>>> = {}, at = T0): LabModel {
  const base = (id: CharacterId, more: Partial<Activity>): Activity => ({ id, inRun: true, standsFor: `Fixture: the real agent the ${id} stands for.`, state: "idle", doing: "At its desk. Nothing to do yet.", trips: [], ...more, ...change[id] })
  const characters: Record<CharacterId, Activity> = {
    scout: base("scout", { state: "fetching", doing: "Searching the web: “placeholder query”.", since: at, trips: [{ id: "f-scout", kind: "fetch", room: "discovery", label: "Searching the web", short: "…", at }] }),
    librarian: base("librarian", { state: "done", doing: "Searching PubMed and preprints: found 8.", since: at, trips: [{ id: "f-librarian", kind: "fetch", room: "discovery", label: "8 papers from PubMed and preprints (Europe PMC)", short: "8 papers", at, back: at, outcome: "carried" }], lastFetched: { label: "8 papers from PubMed and preprints (Europe PMC)", room: "discovery", at } }),
    proposer: base("proposer", { inRun: false, standsFor: "Takes part in team reviews and swarm runs. A research answer has no such step.", doing: "" }),
    navigator: base("navigator", { state: "handing-off", doing: "Gave the search plan to the Scout.", since: at, trips: [{ id: "h-navigator", kind: "handoff", room: "discovery", to: "scout", label: "the search plan for the Scout", short: "search plan", at }] }),
    experimenter: base("experimenter", { inRun: false, standsFor: "Takes part in team reviews and swarm runs. A research answer has no such step.", doing: "" }),
    pilot: base("pilot", { inRun: false, standsFor: "Takes part in team reviews and swarm runs. A research answer has no such step.", doing: "" }),
    auditor: base("auditor", { state: "working", doing: "Screening 6 results.", since: at }),
    critic: base("critic", {}),
    reviser: base("reviser", { state: "cancelled", doing: "Cancelled: back at its desk.", since: at }),
    guardian: base("guardian", { state: "fetching", doing: "Checking 4 statements against their sources: 1 of 4 so far.", since: at, trips: [{ id: "c-guardian", kind: "fetch", room: "review", label: "✓ Supported: “Placeholder statement one.”", short: "✓ Supported", at, back: at, outcome: "carried" }], lastFetched: { label: "✓ Supported: “Placeholder statement one.”", room: "review", at } }),
    reporter: base("reporter", { state: "failed", doing: "Writing the answer: did not work. The model's provider refused the key.", since: at, problem: { text: "Writing the answer: did not work. The model's provider refused the key.", at } }),
    finisher: base("finisher", {}),
  }
  for (const id of CHARACTER_IDS) if (!characters[id]) throw new Error(`fixture misses ${id}`)
  return {
    kind: "answer", runId: "fixture", title: "Placeholder question (hand-written fixture)", provenance: "practice", status: "running", startedAt: at, at,
    characters,
    visitors: [{ id: "toxicologist", name: "Toxicologist", title: "Toxicologist", why: "Fixture.", room: "bench", state: "working", doing: "Round 1: writing its reply.", since: at }],
    log: [
      { id: "l0", at, text: "Fixture: the run started." },
      { id: "l1", at, text: "Navigator gave the search plan to the Scout.", who: "Navigator" },
      { id: "l2", at, text: "Reporter: writing the answer: did not work.", who: "Reporter", tone: "bad" },
    ],
  }
}
