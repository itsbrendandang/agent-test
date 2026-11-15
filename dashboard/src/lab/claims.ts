// Agent Lab design by Anh Lam. The fourth source: a swarm run on the CLAIMS ENGINE, where the unit of work is a
// claim that moves through states and the engine's code makes every move. Pure: the run's files in, the activity
// model out. What the files are and how to read them is the engine owner's brief; the rules followed here:
//
//   1. Read only.                          2. Only the events of the snapshot's run_id count.
//   3. Sync from the board snapshot, then apply events with a higher seq, in order, one by one.
//   4. On a gap in seq: stop and ask for the snapshot again (needsSync). Nothing after a gap is applied.
//   5. Times (`ts`, `at`) are Unix seconds.  6. The ledger's own events have no time and no seq: by position.
//
// What cannot be seen is not shown as if it were known. A role call is reported only when it ENDS (agent.call), so
// between two events an open claim is "being worked on or waiting", and no agent is drawn as working on it, with
// one exception the brief states: a pilot call starts right after a claim is moved to piloting. A long silence is
// normal (one call can take many minutes) and is never shown as a failure. No grade, no ideal answer, no judge's
// reply is read or shown here.
import { MARK_GLYPH, MARK_WORD, markOf } from "@/lib/words"
import { Build, num, str, swarmProvenance, type LabEvent, type SwarmNotes, type SwarmRun } from "./adapter"
import {
  CHARACTER_IDS, CLAIM_GLYPH, CLAIM_ROOM, CLAIM_WORD, claimOpen, clip, plural,
  type CharacterId, type ClaimCard, type ClaimState, type LabModel,
} from "./model"

/** board.json: `{ run_id, seq, claims: [...] }`. */
export interface ClaimsBoard { run_id?: unknown; seq?: unknown; claims?: unknown }
export interface ClaimsInput {
  /** The tracker's record of the run, when there is one (phase, model, start). */
  run?: SwarmRun
  /** The newest board snapshot. Without one (a replay from the first event) the claims are built from the events alone. */
  board?: ClaimsBoard | null
  /** Lines of events.jsonl. */
  events: readonly LabEvent[]
  /** The host ledger's `events` list. Scout, Planner, the relevance judge and test runner, and the Reporter appear only there. */
  notes?: SwarmNotes | null
  /** When a poll first saw each ledger note (ms), for the ones that arrived while the page watched. */
  seenAt?: readonly (number | undefined)[]
}

const STATES = Object.keys(CLAIM_WORD) as ClaimState[]
const stateOf = (v: unknown): ClaimState | undefined => (STATES.includes(v as ClaimState) ? (v as ClaimState) : undefined)
const ms = (seconds: unknown): number | undefined => { const n = num(seconds); return n === undefined ? undefined : Math.round(n * 1000) }
const word = (state: ClaimState) => `${CLAIM_GLYPH[state] ? `${CLAIM_GLYPH[state]} ` : ""}${CLAIM_WORD[state]}`

const STANDS: Partial<Record<CharacterId, string>> = {
  scout: "The Scout, which is code in this engine: it lists the data files and their problems before triage.",
  proposer: "The Planner: one model call that proposes the claims and their acuity (triage).",
  pilot: "The Experimenter's pilot call: a quick run of a claim on a small sample.",
  experimenter: "The Experimenter's workup call: the full run of a claim.",
  reviser: "The Experimenter's revise call: fixes what the review sent back.",
  auditor: "The Auditor: checks a claim's scripts in each review round.",
  critic: "The Critic: tries to disprove a claim in each review round.",
  guardian: "The relevance judge and the test runner: after a review round the planned tests are judged for relevance and run by the harness.",
  navigator: "The Engine, which is code: it alone moves a claim from one state to the next and gives each move a reason.",
  finisher: "The Finisher, which is code in this engine: it copies each required output from the best claim.",
  reporter: "The Reporter: one model call that writes up what was done.",
}
const LABELS: Partial<Record<CharacterId, string>> = { proposer: "Planner", navigator: "Engine", guardian: "Test runner" }
/** Who a finished role call belongs to. */
function actorOf(role: string | undefined, mode: string | undefined): CharacterId | undefined {
  const m = (mode ?? "").split(/\s+/)[0]
  if (role === "experimenter") return m === "pilot" ? "pilot" : m === "revise" ? "reviser" : "experimenter"
  if (role === "auditor") return "auditor"
  if (role === "critic") return "critic"
  return undefined
}
const SCRIPTED = (model: string | undefined) => model === "mock" || !!model?.startsWith("mockllm/")

/** A claim as board.json records it. Fields that are missing or malformed are left out, never guessed. */
function cardOf(raw: unknown): ClaimCard | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const r = raw as Record<string, unknown>
  const id = str(r.id), state = stateOf(r.state)
  if (!id || !state) return undefined
  const b = (r.budget ?? {}) as Record<string, unknown>
  const history = Array.isArray(r.history) ? (r.history as Record<string, unknown>[]) : []
  const last = history.at(-1)
  const attempts = Object.fromEntries(Object.entries((r.attempts ?? {}) as Record<string, unknown>).flatMap(([k, v]) => (num(v) ? [[k, num(v)!]] : []))) // a mode with no call yet is left out
  return {
    id, text: str(r.text) ?? "", acuity: str(r.acuity), state, room: CLAIM_ROOM[state], reason: str(last?.reason), movedAt: ms(last?.at), activity: "",
    budget: { tokensSpent: num(b.tokens_spent) ?? 0, tokensAlloc: num(b.tokens_alloc), secondsSpent: num(b.seconds_spent) ?? 0, secondsAlloc: num(b.seconds_alloc) },
    attempts, errors: Array.isArray(r.errors) ? (r.errors as unknown[]).flatMap((e) => (typeof e === "string" ? [clip(e, 200)] : [])) : [],
  }
}

/** One step of the run's timeline: an event of events.jsonl, or a ledger note placed where it belongs. */
export interface ClaimsItem { at: number; event?: LabEvent; note?: LabEvent; rough?: boolean }

/**
 * The run in the order things happened. Events carry `seq` and `ts`. Ledger notes carry neither, so each is placed
 * by what it must come before: the Scout and the Planner's start before the first claim, the Planner's end before
 * the switches are logged, a raised issue before the move that names it, a round's relevance and tests before that
 * round's decision, the report after the outputs are assembled. A note with no such anchor stays behind the note
 * before it. `seenAt` (a note seen arriving) gives its real time.
 */
export function claimsTimeline(events: readonly LabEvent[], notes: readonly LabEvent[] = [], seenAt: readonly (number | undefined)[] = []): ClaimsItem[] {
  const out: ClaimsItem[] = events.map((event) => ({ at: ms(event.ts) ?? 0, event }))
  if (!notes.length) return out
  const seqOf = (find: (e: LabEvent) => boolean) => num(events.find(find)?.seq)
  const firstSeq = num(events[0]?.seq) ?? 1
  // the seq each note must come BEFORE (Infinity: after everything)
  let round = 0
  const before = notes.map((n): number | undefined => {
    const kind = str(n.kind), phase = str(n.phase) ?? ""
    if (kind === "settings" || kind === "budget.plan" || kind === "scout.code") return firstSeq
    if (kind === "phase.started" && phase === "propose") return firstSeq
    if (kind === "phase.finished" && phase === "propose") return seqOf((e) => e.kind === "flags") ?? seqOf((e) => e.kind === "budget.allocated")
    if (kind === "issue.raised") return seqOf((e) => e.kind === "claim.transition" && Array.isArray((e.evidence as Record<string, unknown> | undefined)?.open_issues) && ((e.evidence as Record<string, unknown>).open_issues as unknown[]).includes(n.issue))
    if (phase.startsWith("relevance")) round = Number(phase.split(/\s+/)[1]) || round
    if (phase.startsWith("relevance") || kind === "test.relevance" || kind === "test.executed" || kind === "test.recorded")
      return round ? seqOf((e) => e.kind === "claim.transition" && e.from === "under_review" && num((e.evidence as Record<string, unknown> | undefined)?.round) === round) : undefined
    if (phase === "report" || kind === "finished") return Infinity
    return undefined
  })
  // a note without an anchor goes where the next anchored note goes; none after it: where the one before went
  for (let i = before.length - 2; i >= 0; i--) if (before[i] === undefined && before[i + 1] !== undefined && before[i + 1] !== Infinity) before[i] = before[i + 1]
  for (let i = 1; i < before.length; i++) if (before[i] === undefined) before[i] = before[i - 1]
  const merged: ClaimsItem[] = []
  let next = 0
  const flush = (upTo: number, at: number) => { while (next < notes.length && (before[next] ?? Infinity) <= upTo) { merged.push({ at: seenAt[next] ?? at, note: notes[next], rough: seenAt[next] === undefined }); next++ } }
  for (const item of out) { flush(num(item.event!.seq) ?? 0, item.at); merged.push(item) }
  const end = out.at(-1)?.at ?? 0
  while (next < notes.length) { merged.push({ at: seenAt[next] ?? end, note: notes[next], rough: seenAt[next] === undefined }); next++ }
  return merged
}

/** The events of one run, each seq once, in order. `run_id` of the snapshot decides the run; without a snapshot, the newest event's. */
export function claimsOrder(events: readonly LabEvent[], runId?: string): { events: LabEvent[]; runId?: string } {
  const good = events.filter((e) => e && typeof e === "object" && typeof e.kind === "string" && num(e.seq) !== undefined)
  const id = runId ?? str(good.reduce<LabEvent | undefined>((best, e) => (!best || (num(e.ts) ?? 0) >= (num(best.ts) ?? 0) ? e : best), undefined)?.run_id)
  const bySeq = new Map<number, LabEvent>()
  for (const e of good) if (id === undefined || e.run_id === id) bySeq.set(num(e.seq)!, e)
  return { events: [...bySeq.values()].sort((a, b) => num(a.seq)! - num(b.seq)!), runId: id }
}

/** A claims-engine run as the lab's activity. `upTo`: only the first steps of the timeline (a replay; no snapshot is used then). */
export function claimsLab(input: ClaimsInput, options: { upTo?: number } = {}): LabModel {
  const run = input.run
  const b = new Build("swarm", run?.id, STANDS, "The claims engine has no such role.", LABELS)
  const m = b.model
  const replay = options.upTo !== undefined
  const board = replay ? undefined : input.board ?? undefined
  const { events, runId } = claimsOrder(input.events, str(board?.run_id))
  const notes = (Array.isArray(input.notes?.events) ? (input.notes!.events as unknown[]) : []).filter((e): e is LabEvent => !!e && typeof e === "object")
  const timeline = claimsTimeline(events, notes, input.seenAt)
  const steps = replay ? timeline.slice(0, Math.max(0, options.upTo!)) : timeline
  const whole = !replay || options.upTo! >= timeline.length
  m.title = run?.task ? `Task: ${run.task}` : undefined
  m.startedAt = run?.startedAt ?? timeline[0]?.at
  m.roughTimes = timeline.some((s) => s.rough)
  m.status = "running"
  if (run?.phase === "queued" || run?.phase === "launching") { m.status = "waiting"; m.note = clip(run.detail ?? "Starting.", 200) }

  // ── The claims: the snapshot, then the events after it, one by one ──
  const cards = new Map<string, ClaimCard>()
  const synced = num(board?.seq) ?? 0
  if (board && Array.isArray(board.claims)) for (const raw of board.claims as unknown[]) { const c = cardOf(raw); if (c) cards.set(c.id, c) }
  let expected = board ? synced + 1 : num(events[0]?.seq) ?? 1
  if (!board && events.length && expected !== 1) m.needsSync = true // the first events are missing and there is no snapshot to stand on
  const card = (id: string | undefined) => (id ? cards.get(id) : undefined)
  let stopAt = Infinity // the seq of the first event after a gap: nothing from there on is used

  const models = new Set<string>()
  let flags: LabEvent | undefined
  const piloting = new Set<string>() // claims whose pilot call is known to be running
  let who: CharacterId | undefined
  let noteFinished = false // the ledger's own last note: the whole run is over

  for (const step of steps) {
    const at = step.at
    b.seen(at)
    if (step.note) {
      const n = step.note, kind = str(n.kind), phase = str(n.phase) ?? ""
      const by = str(n.by)
      if (kind === "scout.code") {
        const files = num(n.files) ?? 0, problems = num(n.problems) ?? 0
        b.trip("scout", { id: "scout", kind: "fetch", room: "discovery", label: `a list of ${plural(files, "data file")}`, short: plural(files, "file"), at, back: at, outcome: "carried" })
        b.set("scout", "done", `Looked at the data: ${plural(files, "file")}, ${plural(problems, "problem")}.`, at)
        b.log(at, `Scout (code) looked at the data: ${plural(files, "file")}, ${plural(problems, "problem")}.`, "Scout")
      } else if (kind === "phase.started" && phase === "propose") { b.set("proposer", "working", "Triage: proposing the claims (one model call).", at); b.log(at, "Planner started triage.", "Planner") }
      else if (kind === "phase.finished" && phase === "propose") b.set("proposer", "done", n.limit_hit === true ? "Triage stopped at its limit." : "Triage finished.", at)
      else if (kind === "phase.started" && phase.startsWith("relevance")) b.set("guardian", "working", `Judging whether the planned tests are relevant, then running them${phase.split(/\s+/)[1] ? ` (round ${phase.split(/\s+/)[1]})` : ""}.`, at)
      else if (kind === "phase.finished" && phase.startsWith("relevance")) b.set("guardian", "done", "Judged the planned tests for relevance.", at)
      else if (kind === "test.relevance") b.log(at, `The test “${clip(str(n.name) ?? "", 60)}” for claim ${clip(str(n.claim) ?? "", 12)} was judged ${n.relevant === true ? "relevant" : "not relevant"}.`, "Test runner")
      else if (kind === "test.executed") {
        const label = `the result of the test “${clip(str(n.name) ?? "a test", 60)}” for claim ${clip(str(n.claim) ?? "", 12)}: ${clip(str(n.status) ?? "ran", 20)}`
        b.trip("guardian", { id: `test:${notes.indexOf(n)}`, kind: "fetch", room: "review", label, short: `${clip(str(n.claim) ?? "", 8)} test`, at, back: at, outcome: "carried" })
        b.set("guardian", "done", `Ran the test “${clip(str(n.name) ?? "a test", 60)}” for claim ${clip(str(n.claim) ?? "", 12)}: ${clip(str(n.status) ?? "ran", 20)}.`, at)
        b.log(at, `Test runner ran ${label}.`, "Test runner")
      } else if (kind === "test.recorded") {
        const mark = markOf(n.verdict_at_the_time ?? n.verdict)
        b.log(at, `The team's shared notes now mark claim ${clip(str(n.claim) ?? "", 12)}: ${MARK_GLYPH[mark]} ${MARK_WORD[mark]} (worked out by code from the recorded test).`, "Test runner", mark === "contradicted" ? "bad" : undefined)
      } else if (kind === "issue.raised") b.log(at, `${by ? clip(by, 20) : "A reviewer"} raised a ${clip(str(n.severity) ?? "", 12)} problem: ${clip(str(n.problem) ?? "", 140)}`, undefined, "warn")
      else if (kind === "issue.resolved") b.log(at, `Problem ${clip(str(n.issue) ?? "", 12)} was marked ${clip(str(n.status) ?? "resolved", 12)}${by ? ` by the ${clip(by, 20)}` : ""}.`)
      else if (kind === "phase.started" && phase === "report") { b.set("reporter", "working", "Writing up what was done (one model call).", at); b.log(at, "Reporter started the write-up.", "Reporter") }
      else if (kind === "finished") noteFinished = true
      else if (kind === "phase.finished" && phase === "report") { b.set("reporter", "done", n.limit_hit === true ? "The write-up stopped at its limit." : "Finished the write-up.", at); b.log(at, "Reporter finished the write-up.", "Reporter") }
      continue
    }
    const e = step.event!, seq = num(e.seq)!
    if (seq >= stopAt) continue
    const apply = seq > synced // an event the snapshot already holds changes no claim; it is history only
    if (apply) {
      if (seq !== expected) { m.needsSync = true; stopAt = seq; continue } // a gap: read the snapshot again
      expected = seq + 1
    }
    const id = str(e.claim_id), c = card(id)
    switch (e.kind) {
      case "claim.added":
        if (apply && id) cards.set(id, { id, text: str(e.text) ?? "", acuity: str(e.acuity), state: "triaged", room: CLAIM_ROOM.triaged, reason: "proposed at triage", movedAt: at, activity: "", budget: { tokensSpent: 0, secondsSpent: 0 }, attempts: {}, errors: [] })
        b.set("proposer", b.who("proposer").state === "working" ? "working" : "done", `Proposed claim ${clip(id ?? "", 12)}.`, at)
        b.log(at, `Planner proposed claim ${clip(id ?? "", 12)} (acuity ${clip(str(e.acuity) ?? "not said", 12)}): “${clip(str(e.text) ?? "", 120)}”`, "Planner")
        break
      case "triage.uncovered": if (Array.isArray(e.artifacts)) b.log(at, `No claim covers ${plural(e.artifacts.length, "required output")}: ${clip(e.artifacts.join(", "), 120)}.`, undefined, "warn"); break
      case "engine.no_claims": b.log(at, "Triage made no claim. The engine has nothing to work on.", "Engine", "warn"); break
      case "flags":
        flags = e
        b.set("navigator", "working", `Running the claim loop: at most ${num(e.max_parallel) ?? "?"} claims at once, ${num(e.review_rounds) ?? "?"} review rounds.`, at)
        b.log(at, "Engine started the claim loop.", "Engine")
        break
      case "budget.allocated":
        if (apply && e.claims && typeof e.claims === "object") for (const [cid, share] of Object.entries(e.claims as Record<string, Record<string, unknown>>)) { const x = card(cid); if (x) x.budget.tokensAlloc = num(share?.tokens) ?? x.budget.tokensAlloc }
        b.log(at, "Engine gave each claim its starting budget.", "Engine")
        break
      case "claim.transition": {
        const from = stateOf(e.from), to = stateOf(e.to), reason = clip(str(e.reason) ?? "", 200)
        if (!id || !to) break
        if (apply && c) { c.state = to; c.room = CLAIM_ROOM[to]; c.reason = reason || undefined; c.movedAt = at }
        if (from && CLAIM_ROOM[from] !== CLAIM_ROOM[to]) b.trip("navigator", { id: `move:${seq}`, kind: "carry", from: CLAIM_ROOM[from], room: CLAIM_ROOM[to], claim: id, label: `claim ${id} from ${CLAIM_WORD[from]} to ${CLAIM_WORD[to]}: ${reason}`, short: id, at, back: at, outcome: "carried" })
        if (to === "piloting") piloting.add(id); else piloting.delete(id)
        b.log(at, `Engine moved claim ${clip(id, 12)} ${from ? `from ${CLAIM_WORD[from]} ` : ""}to ${word(to)}${reason ? `: ${reason}` : "."}`, "Engine", to === "rejected" ? "bad" : to === "supported" ? "good" : to === "not_established" || to === "sent_back" ? "warn" : undefined)
        break
      }
      case "budget.spent": if (apply && c) { c.budget.tokensSpent += num(e.tokens) ?? 0; c.budget.secondsSpent += num(e.seconds) ?? 0 } break
      case "agent.call": {
        const role = str(e.role), mode = str(e.mode) ?? "", outcome = str(e.outcome) ?? "", attempt = num(e.attempt) ?? 1
        const model = str(e.model); if (model) models.add(model)
        if (apply && c) { c.attempts[mode] = Math.max(c.attempts[mode] ?? 0, attempt); c.lastCall = { role: role ?? "", mode, outcome, at } }
        else if (c && (!c.lastCall || c.lastCall.at <= at)) c.lastCall = { role: role ?? "", mode, outcome, at }
        who = actorOf(role, mode)
        if (!who) break
        if (id && who === "pilot") piloting.delete(id)
        const ok = outcome === "ok"
        const line = `${ok ? "Finished" : "Ended"} its ${clip(mode, 20)} call on claim ${clip(id ?? "", 12)}: ${clip(outcome || "no outcome said", 20)}${attempt > 1 ? ` (attempt ${attempt})` : ""}.${str(e.note) ? ` ${clip(str(e.note)!, 120)}` : ""}`
        if (ok) {
          b.set(who, "handing-off", line, at)
          b.trip(who, { id: `call:${seq}`, kind: "handoff", room: "planning", to: "navigator", label: `its ${clip(mode, 20)} result on claim ${clip(id ?? "", 12)} for the Engine`, short: `${clip(id ?? "", 8)} ${clip(mode.split(/\s+/)[0], 10)}`, at })
        } else { b.set(who, "failed", line, at); b.who(who).problem = { text: line, at } }
        b.log(at, `${b.name(who)}: ${line.charAt(0).toLowerCase()}${line.slice(1)}`, b.name(who), ok ? undefined : "bad")
        break
      }
      case "claim.error":
        if (apply && c && str(e.error)) c.errors.push(clip(str(e.error)!, 200))
        b.log(at, `A call on claim ${clip(id ?? "", 12)} did not finish: ${clip(str(e.error) ?? "", 160)}`, undefined, "bad")
        break
      case "retriage":
        if (apply && e.to && typeof e.to === "object") for (const [cid, tokens] of Object.entries(e.to as Record<string, unknown>)) { const x = card(cid); if (x && num(tokens)) x.budget.tokensAlloc = (x.budget.tokensAlloc ?? 0) + num(tokens)! }
        if (e.enabled !== false) b.log(at, `Engine re-triaged the budget${num(e.moved_tokens) ? `: ${num(e.moved_tokens)!.toLocaleString("en-US")} tokens moved to open claims` : str(e.reason) ? `: ${clip(str(e.reason)!, 80)}` : ""}.`, "Engine")
        break
      case "engine.stopped": b.log(at, `Engine stopped the claim loop: ${clip(str(e.reason) ?? "", 160)}. Open claims close as not established.`, "Engine", "warn"); break
      case "engine.finished":
        if (apply && e.states && typeof e.states === "object") for (const [cid, s] of Object.entries(e.states as Record<string, unknown>)) { const x = card(cid), st = stateOf(s); if (x && st) { x.state = st; x.room = CLAIM_ROOM[st] } }
        b.set("navigator", "done", `The claim loop is over after ${plural(num(e.rounds) ?? 0, "review round")}.`, at)
        b.log(at, "Engine finished the claim loop.", "Engine")
        break
      case "finish.assembled": {
        const list = Array.isArray(e.artifacts) ? (e.artifacts as Record<string, unknown>[]) : []
        const missing = list.filter((x) => !x?.from).length
        b.trip("finisher", { id: `finish:${seq}`, kind: "fetch", room: "report", label: `${plural(list.length - missing, "required output")} copied from the best claims`, short: plural(list.length - missing, "output"), at, back: at, outcome: list.length - missing > 0 ? "carried" : "empty" })
        b.set("finisher", "done", `Copied ${plural(list.length - missing, "required output")} from the best claims${missing ? `; ${missing} could not be filled` : ""}.`, at)
        b.log(at, `Finisher (code) copied ${plural(list.length - missing, "required output")} from the best claims${missing ? `; ${missing} missing` : ""}.`, "Finisher", missing ? "warn" : undefined)
        break
      }
      case "claim.illegal_transition": b.log(at, `Engine bug: a move of claim ${clip(id ?? "", 12)} that the rules do not allow (${clip(str(e.from) ?? "?", 16)} to ${clip(str(e.to) ?? "?", 16)}).`, "Engine", "bad"); break
    }
  }

  // ── What is known about each claim now, and who may be at work ──
  const off: CharacterId[] = flags ? ([["critic", flags.critic], ["auditor", flags.auditor], ["pilot", flags.pilot]] as const).flatMap(([id, on]) => (on === false ? [id] : [])) : []
  for (const id of off) { const a = b.who(id); a.inRun = false; a.state = "idle"; a.doing = ""; a.standsFor = `${STANDS[id]} Switched off for this run.` }
  const phase = run?.phase ?? (noteFinished ? "done" : undefined) // without a tracker record, the ledger's last note ends the run
  const ended = whole && (phase === "done" || phase === "failed" || phase === "cancelled")
  const maybe = new Map<CharacterId, string[]>()
  for (const c of cards.values()) {
    if (!claimOpen(c.state)) { c.activity = "Closed. Nothing more is done on it."; continue }
    c.activity = ended ? "The run ended while it was open." : c.state === "triaged" ? "Waiting to start." : piloting.has(c.id) ? "Its pilot call is running (a pilot starts right after the claim is moved to piloting)." : "Being worked on or waiting. The engine reports a call when it ends, not when it starts."
    if (ended) continue
    const expected: CharacterId[] = c.state === "under_review" ? ["auditor", "critic"] : c.state === "in_workup" ? [c.attempts.workup ? "reviser" : "experimenter"] : []
    for (const id of expected) if (!off.includes(id)) maybe.set(id, [...(maybe.get(id) ?? []), c.id])
  }
  if (m.status === "running" && piloting.size && !off.includes("pilot") && ended) b.set("pilot", "working", `Pilot call on ${plural(piloting.size, "claim")} (${[...piloting].join(", ")}).`, b.who("pilot").since ?? m.at) // what was running when the run ended
  if (m.status === "running" && !ended) {
    if (piloting.size && !off.includes("pilot")) b.set("pilot", "working", `Pilot call on ${plural(piloting.size, "claim")} (${[...piloting].join(", ")}): a pilot starts right after the claim is moved to piloting.`, b.who("pilot").since ?? m.at)
    for (const [id, ids] of maybe) {
      const a = b.who(id)
      if (a.state === "failed") continue
      a.inRun = true; a.state = "idle"
      a.doing = `Nothing reported yet for ${ids.length === 1 ? `claim ${ids[0]}` : `claims ${ids.join(", ")}`}: ${ids.length === 1 ? "it is" : "they are"} ${CLAIM_WORD[cards.get(ids[0])!.state].toLowerCase()}, being worked on or waiting. A call is reported when it ends.`
    }
  }
  m.claims = [...cards.values()]

  // ── The lines the view must show ──
  const model = [...models][0] ?? run?.model
  const scripted = SCRIPTED(model) || SCRIPTED(run?.model) || run?.modelClass === "scripted"
  m.provenance = scripted ? "practice" : run ? swarmProvenance(run) ?? (model ? "live" : undefined) : model ? "live" : undefined
  m.labels = [
    ...(model ? [`Model: ${clip(model, 60)}`] : []),
    ...(scripted ? ["Practice: scripted run, not a benchmark result"] : []),
    ...(flags ? [(() => {
      const names = [["critic", "the Critic"], ["auditor", "the Auditor"], ["pilot", "the pilot stage"], ["retriage", "re-triage"]].flatMap(([k, n]) => (flags![k] === false ? [n] : []))
      return names.length ? `Switched off for this run: ${names.join(", ")}` : "All four switches on (Critic, Auditor, pilot, re-triage)"
    })()] : []),
  ]
  if (runId && !m.runId) m.runId = runId

  // ── The end of the run, from the tracker's record ──
  if (whole && phase === "done") { m.status = "done"; b.finish(run?.finishedAt ?? m.at, "Had nothing to do in this run."); b.log(run?.finishedAt ?? m.at, "The run finished.", undefined, "good") }
  else if (whole && phase === "failed") {
    const why = clip((run?.error ?? "The run failed.").split("\n")[0], 300)
    m.status = "failed"; m.note = why
    for (const id of CHARACTER_IDS) { const a = b.who(id); if (a.inRun && a.state === "working") { b.set(id, "failed", `The run failed during this step: ${why}`, run?.finishedAt ?? m.at); a.problem = { text: why, at: run?.finishedAt ?? m.at ?? 0 } } }
    b.log(run?.finishedAt ?? m.at, `The run failed: ${why}`, undefined, "bad")
  } else if (whole && phase === "cancelled") {
    b.cancel(run?.finishedAt ?? m.at, "This run was cancelled.")
    b.log(run?.finishedAt ?? m.at, "The run was cancelled. Everyone is back at their desks.", undefined, "warn")
  }
  return m
}
