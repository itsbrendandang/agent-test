// Agent Lab design by Anh Lam. Engine events in, activity model out. No React, no clock, no network: the same
// events always give the same model, so a finished run can be replayed by giving this file a longer and longer
// prefix of its events.
//
// Three sources:
//   boardLab   a team review   GET /api/runs/:id/events        (engine/src/events.ts)
//   answerLab  a research answer   GET /api/research/:id/events   (engine/src/research/types.ts)
//   swarmLab   a swarm run     GET /api/glhf/runs/:id          (the run record and the swarm's shared notes)
//
// Rules: a teammate moves only for an event that names its agent or step. What a field does not say is not guessed.
// Text from a run (questions, statements, errors) is untrusted and is only ever passed on as text.
import { provenanceOf } from "@/lib/provenance"
import { agentIdentity } from "./identity"
import { MARK_GLYPH, MARK_WORD, markOf } from "@/lib/words"
import { HYPOTHESES_NOTE, sidesLine } from "@/research/hypothesisWords"
import {
  CHARACTER_IDS, LOG_KEPT, TRIPS_KEPT, characterOf, clip, plural,
  type Activity, type CharacterId, type LabModel, type LabState, type LogKind, type LogLine, type Provenance, type RoomId, type RunKind, type Trip, type Visitor,
} from "./model"

/** An event as it arrives: an object with a type. Every other field is checked before it is used. */
export type LabEvent = Record<string, unknown>

export const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)
export const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)

// ── Building a model ─────────────────────────────────────────────────────────────────────────────

export class Build {
  readonly model: LabModel
  /** Teammates that did something in this run. */
  readonly touched = new Set<CharacterId>()
  private lines = 0
  constructor(kind: RunKind, runId: string | undefined, standsFor: Partial<Record<CharacterId, string>>, absent: string, labels: Partial<Record<CharacterId, string>> = {}) {
    const characters = Object.fromEntries(CHARACTER_IDS.map((id): [CharacterId, Activity] => [id, {
      id, inRun: standsFor[id] !== undefined, standsFor: standsFor[id] ?? absent, state: "idle", doing: standsFor[id] !== undefined ? "At its desk. Nothing to do yet." : "", trips: [],
      ...(standsFor[id] !== undefined && labels[id] && labels[id] !== characterOf(id).name && { label: labels[id] }),
    }])) as Record<CharacterId, Activity>
    this.model = { kind, runId, status: "waiting", characters, visitors: [], log: [] }
  }
  who(id: CharacterId): Activity { return this.model.characters[id] }
  /** How this run calls a teammate: the agent it stands for, else the character's own name. */
  name(id: CharacterId): string { return this.model.characters[id].label ?? characterOf(id).name }
  seen(at: number | undefined) { if (at !== undefined) this.model.at = Math.max(this.model.at ?? at, at) }
  /** Change what a teammate is doing. A teammate that is not in the run is brought in: an event named it. */
  set(id: CharacterId, state: LabState, doing: string, at: number | undefined) {
    const a = this.who(id)
    a.inRun = true; this.touched.add(id)
    if (a.state !== state || a.doing !== doing) a.since = at ?? a.since
    a.state = state; a.doing = doing
  }
  trip(id: CharacterId, trip: Trip) {
    const a = this.who(id)
    a.inRun = true; this.touched.add(id)
    const old = a.trips.findIndex((t) => t.id === trip.id)
    if (old >= 0) a.trips[old] = trip; else a.trips.push(trip)
    if (a.trips.length > TRIPS_KEPT) a.trips.splice(0, a.trips.length - TRIPS_KEPT)
    if (trip.kind === "fetch" && trip.outcome === "carried" && trip.back !== undefined) a.lastFetched = { label: trip.label, room: trip.room, at: trip.back, ...(trip.provider && { provider: trip.provider }) }
  }
  /** One search was reported. */
  searched(provider: string | undefined) { if (provider) (this.model.searches ??= {})[provider] = (this.model.searches[provider] ?? 0) + 1 }
  /** One line of the activity log. `parts`: the same sentence in parts (what it did, what it carried, the run's text it is about), for the log's rows. */
  log(at: number | undefined, text: string, who?: string, tone?: LogLine["tone"], parts?: Pick<LogLine, "kind" | "did" | "chips" | "note">) {
    const agent = who ? CHARACTER_IDS.find((id) => this.name(id) === who) : undefined
    this.model.log.push({ id: `l${this.lines++}`, at: at ?? this.model.at ?? 0, text, ...(who && { who }), ...(tone && { tone }), ...(agent && { agent }), ...parts })
    if (this.model.log.length > LOG_KEPT) this.model.log.shift()
  }
  /** The run ended well: whoever did something is done; whoever had nothing to do stays idle and says so. */
  finish(at: number | undefined, unused: string) {
    for (const id of CHARACTER_IDS) {
      const a = this.who(id)
      if (!a.inRun || a.state === "failed") continue
      if (this.touched.has(id)) { if (a.state !== "done") { a.state = "done"; a.since = at ?? a.since } }
      else { a.state = "idle"; a.doing = unused }
    }
    for (const v of this.model.visitors) if (v.state !== "failed") { v.state = "done"; v.since = at ?? v.since }
  }
  /** The run was cancelled: everyone goes back to their desks. A trip still out comes back with nothing. */
  cancel(at: number | undefined, note: string) {
    this.model.status = "cancelled"; this.model.note = note
    for (const id of CHARACTER_IDS) {
      const a = this.who(id)
      if (!a.inRun) continue
      for (const t of a.trips) if (t.kind === "fetch" && t.back === undefined) { t.back = at ?? t.at; t.outcome = "empty" }
      a.state = "cancelled"; a.doing = "Cancelled: back at its desk."; a.since = at ?? a.since
    }
    for (const v of this.model.visitors) { v.state = "cancelled"; v.doing = "Cancelled."; v.since = at ?? v.since }
  }
}


// ── Where things come from ───────────────────────────────────────────────────────────────────────

const PLACE: Record<string, string> = {
  exa: "the web (Exa)", europepmc: "PubMed and preprints (Europe PMC)", fixture: "the example sources",
  chembl: "ChEMBL", clinicaltrials: "ClinicalTrials.gov", openfda: "openFDA", opentargets: "Open Targets", uniprot: "UniProt", pubchem: "PubChem",
}
const NOUN: Record<string, string> = { exa: "result", europepmc: "paper", fixture: "example source" }
/** One or two words for the tag over a parcel: where it came from. */
const TAG: Record<string, string> = { exa: "Exa", europepmc: "PubMed", fixture: "examples", chembl: "ChEMBL", clinicaltrials: "ClinicalTrials.gov", openfda: "openFDA", opentargets: "Open Targets", uniprot: "UniProt", pubchem: "PubChem" }
const tagOf = (n: number, provider: string | undefined) => `${plural(n, nounOf(provider))}${provider && TAG[provider] && provider !== "fixture" ? ` · ${TAG[provider]}` : ""}`
const placeOf = (provider: string | undefined) => (provider ? PLACE[provider] ?? provider : "a search")
/** "8 papers from PubMed and preprints (Europe PMC)". A practice run's example sources say what they are once: "4 example sources". */
const fromPlace = (n: number, provider: string | undefined) => (provider === "fixture" ? plural(n, nounOf(provider)) : `${plural(n, nounOf(provider))} from ${placeOf(provider)}`)
const nounOf = (provider: string | undefined) => (provider ? NOUN[provider] ?? "record" : "result")
/** Who makes a search: the Scout for the web (and for a practice run's example sources), the Librarian for the literature and the databases. */
const searcherOf = (provider: string | undefined): CharacterId => (provider === undefined || provider === "exa" || provider === "fixture" ? "scout" : "librarian")

const lower = (s: string) => `${s.charAt(0).toLowerCase()}${s.slice(1)}`
/** The kind of a research step, for the mark on the log's rail. */
const stepKind = (kind: string): LogKind => (kind === "search" || kind === "fetch" ? "search" : kind === "evaluate" ? "screen" : kind === "write" || kind === "revise" || kind === "hypothesize" || kind === "save" ? "write" : kind === "check" || kind === "review" ? "check" : "note")
const markLabel = (verdict: unknown, text: string) => { const m = markOf(verdict); return { label: `${MARK_GLYPH[m]} ${MARK_WORD[m]}: “${clip(text, 80)}”`, short: `${MARK_GLYPH[m]} ${MARK_WORD[m]}`, mark: m } }

// ── 1. A team review ─────────────────────────────────────────────────────────────────────────────

const BOARD_MEMBER: Record<string, CharacterId> = {
  "lead-scientist": "navigator", scout: "scout", proposer: "proposer", experimenter: "experimenter", pilot: "pilot",
  "methods-auditor": "auditor", auditor: "auditor", critic: "critic", reviser: "reviser", finisher: "finisher", reporter: "reporter",
}
const BOARD_STANDS: Partial<Record<CharacterId, string>> = {
  navigator: "The lead scientist: runs the discussion and writes the decision memo.",
  scout: "The scout: the one member that searches (the web through Exa, the literature, the public databases). In a practice run it gets example sources instead.",
  proposer: "The proposer: plans the research and names the statements to test.",
  experimenter: "The experimenter in its full-run mode.",
  pilot: "The experimenter in its Pilot mode: a first try on a small part of the data. The lead names the mode each round.",
  auditor: "The methods auditor: checks that the right methods were followed.",
  critic: "The critic: tries to prove the others wrong.",
  reviser: "The experimenter in its Reviser mode: fixes what the auditor and the critic flagged.",
  guardian: "The statement checker: each statement is checked against its source by a model from another vendor, and code confirms the quoted passage.",
  reporter: "The reporter, and the decision memo.",
  finisher: "The memo's completeness check: code refuses a memo with a required section missing.",
}
const BOARD_ABSENT = "A team review's searches are all made by the Scout. The Librarian works in research answers."
/** Captions before the team list arrives: each agent's own name, made readable. The team list brings the engine's titles. */
const BOARD_LABELS: Partial<Record<CharacterId, string>> = {
  navigator: agentIdentity("lead-scientist").label, auditor: agentIdentity("methods-auditor").label, guardian: agentIdentity("checker").label, finisher: "Memo check",
}
/** The experimenter's mode names, as board/agents/experimenter.md has them. */
const MODE: Record<string, CharacterId> = { pilot: "pilot", full: "experimenter", revise: "reviser" }

/** The room a visiting specialist stands in, from the words of its name and title. The bench when nothing fits. */
export function visitorRoom(nameAndTitle: string): RoomId {
  const t = nameAndTitle.toLowerCase()
  if (/literature|evidence synth|prior|librarian|search/.test(t)) return "discovery"
  if (/skeptic|contrarian|critic|review|audit/.test(t)) return "review"
  if (/chief|strateg|portfolio|plan|lead/.test(t)) return "planning"
  if (/quality|regulat|safety officer|compliance/.test(t)) return "quality"
  if (/writer|report|communicat/.test(t)) return "report"
  return "bench"
}

const NO_TASK = /^\s*no task\.?\s*$/i

/** Events of the same millisecond are put in the order the engine emits them, so the model does not depend on the order they arrive in. */
const BOARD_RANK = ["run.started", "run.resumed", "run.roster", "lead.framed", "round.started", "evidence.triaged", "member.replied", "claim.checked", "constraint", "memo.written", "run.finished", "run.failed"]
const rank = (type: unknown) => { const i = BOARD_RANK.indexOf(String(type)); return i < 0 ? BOARD_RANK.length : i }

/** Events with the same key replace each other (a replay after a crash emits the same keys); then oldest first. */
export function boardOrder(events: readonly LabEvent[]): LabEvent[] {
  const last = new Map<string, number>()
  events.forEach((e, i) => { const k = str(e?.key); if (k !== undefined) last.set(k, i) })
  return events
    .map((e, i) => ({ e, i }))
    .filter(({ e, i }) => e && typeof e.type === "string" && (str(e.key) === undefined || last.get(str(e.key)!) === i))
    .sort((a, b) => (num(a.e.at) ?? 0) - (num(b.e.at) ?? 0) || rank(a.e.type) - rank(b.e.type) || (str(a.e.key) ?? "").localeCompare(str(b.e.key) ?? "") || a.i - b.i)
    .map(({ e }) => e)
}

/** A team review's events as the lab's activity. */
export function boardLab(events: readonly LabEvent[], runId?: string): LabModel {
  const b = new Build("board", runId, BOARD_STANDS, BOARD_ABSENT, BOARD_LABELS)
  const m = b.model
  let roster: Set<string> | undefined
  const visitors = new Map<string, Visitor>()
  let round = 0, final = false
  const checked = { supported: 0, contradicted: 0, insufficient: 0, unchecked: 0 }
  let inRound = 0 // statements checked in this round
  const visitor = (member: string, title?: string, why?: string): Visitor => {
    let v = visitors.get(member)
    if (!v) { v = { id: member, name: title || member, title: title || member, why, room: visitorRoom(`${member} ${title ?? ""}`), state: "idle", doing: "Joined this review." }; visitors.set(member, v); m.visitors.push(v) }
    return v
  }
  const guardianDone = (at: number | undefined) => {
    if (b.who("guardian").state !== "fetching") return
    b.set("guardian", "done", inRound ? `Checked ${plural(inRound, "statement")} of round ${round} against ${inRound === 1 ? "its source" : "their sources"}.` : `Round ${round}: no statement to check.`, at)
  }

  for (const e of boardOrder(events)) {
    const at = num(e.at)
    b.seen(at)
    if (m.status === "waiting") { m.status = "running"; m.startedAt ??= at }
    switch (e.type) {
      case "run.started":
        m.status = "running"; m.startedAt = at ?? m.startedAt
        m.title = str(e.title)
        m.provenance = provenanceOf({ scripted: typeof e.mock === "boolean" ? e.mock : undefined })
        m.runId ??= str(e.runId)
        b.set("navigator", "working", "Framing the question for the team.", at)
        b.log(at, `The review started${m.provenance === "practice" ? " (practice run: fixed text, not research)" : ""}.`)
        break
      case "run.resumed": m.status = "running"; m.note = undefined; b.log(at, "The review was resumed."); break
      case "run.roster": {
        if (!Array.isArray(e.members)) break
        roster = new Set()
        for (const raw of e.members as Record<string, unknown>[]) {
          const member = str(raw?.name); if (!member) continue
          roster.add(member)
          if (raw.source === "specialist" || !BOARD_MEMBER[member]) visitor(member, str(raw.title), str(raw.why))
          else if (str(raw.title)) {
            // the caption is the engine's own title for the member (identity.ts), unless that is the character's name
            const id = BOARD_MEMBER[member], short = agentIdentity(member, { title: str(raw.title) }).short
            if (short === characterOf(id).name) delete b.who(id).label; else b.who(id).label = short
          }
        }
        // Who is in this run: the members the roster names, and the two steps code does (the checks, the memo's check).
        const has = (n: string) => roster!.has(n)
        const present: Record<CharacterId, boolean> = {
          navigator: has("lead-scientist"), scout: has("scout"), librarian: false, proposer: has("proposer"),
          experimenter: has("experimenter"), pilot: has("experimenter") || has("pilot"), reviser: has("experimenter") || has("reviser"),
          auditor: has("methods-auditor") || has("auditor"), critic: has("critic"), reporter: has("reporter"), guardian: true, finisher: true,
        }
        for (const id of CHARACTER_IDS) {
          const a = b.who(id)
          a.inRun = present[id] || b.touched.has(id)
          if (!a.inRun) { a.state = "idle"; a.doing = ""; a.standsFor = BOARD_STANDS[id] ? `${BOARD_STANDS[id]} That member is not on this review's team.` : BOARD_ABSENT }
        }
        break
      }
      case "lead.framed": b.set("navigator", "working", "Framed the question. Preparing the first round.", at); break
      case "round.started": {
        guardianDone(at)
        round = num(e.round) ?? round + 1; final = e.final === true; inRound = 0
        const what = final ? "Final round: writing its final position." : `Round ${round}: writing its reply.`
        b.set("navigator", "working", final ? "Asked the team for final positions." : `Running round ${round} of the discussion.`, at)
        for (const [member, id] of Object.entries(BOARD_MEMBER)) {
          if (id === "navigator" || id === "pilot" || id === "reviser" || id === "finisher") continue // modes and code steps are not asked by name
          if (roster ? !roster.has(member) : !b.who(id).inRun) continue
          b.set(id, "working", id === "scout" && !final ? `Round ${round}: searching for evidence, then writing its reply.` : what, at)
        }
        for (const v of visitors.values()) { v.state = "working"; v.doing = what; v.since = at }
        b.log(at, final ? "The lead asked for final positions." : `Round ${round} started.`, b.name("navigator"), undefined, { did: final ? "asked for final positions." : `started round ${round}.` })
        break
      }
      case "evidence.triaged": {
        const provider = str(e.provider), who: CharacterId = "scout" // every search of a review is the scout's: one agent, one face
        const kept = num(e.kept) ?? 0, dropped = num(e.dropped) ?? 0
        const place = placeOf(provider), query = str(e.query)
        const label = kept > 0 ? `${fromPlace(kept, provider)}${dropped ? ` (${dropped} more screened out)` : ""}` : `nothing kept from ${place}${dropped ? ` (${plural(dropped, "result")} screened out)` : ""}`
        b.trip(who, { id: `fetch:${str(e.key) ?? `${at}:${query ?? ""}`}`, kind: "fetch", room: "discovery", label, short: kept > 0 ? tagOf(kept, provider) : "nothing", at: at ?? 0, back: at ?? 0, outcome: kept > 0 ? "carried" : "empty", ...(provider && { provider }) })
        b.searched(provider)
        const asked = query ? ` for “${clip(query, 90)}”` : ""
        const brought = provider === "fixture" ? (kept > 0 ? `Brought back ${label}.` : `Looked at ${place}: ${label}.`) : kept > 0 ? `Searched ${place}${asked} and brought back ${label}.` : `Searched ${place}${asked}: ${label}.`
        if (b.who(who).state === "working") b.set(who, "working", `Round ${round}: ${brought.charAt(0).toLowerCase()}${brought.slice(1)} It still has its reply to write.`, at)
        else b.set(who, "done", brought, at)
        const screened = dropped ? `, screened out ${dropped}` : ""
        b.log(at, `${b.name(who)} ${brought.charAt(0).toLowerCase()}${brought.slice(1)}`, b.name(who), undefined, {
          kind: "search", ...(query && { note: clip(query, 240) }),
          ...(kept > 0 ? { did: provider === "fixture" ? `brought back${dropped ? ` (${dropped} more screened out)` : ""}` : `searched ${place}${screened} and brought back`, chips: [plural(kept, nounOf(provider))] }
            : { did: `${provider === "fixture" ? "looked at" : "searched"} ${place}: nothing kept${dropped ? ` (${plural(dropped, "result")} screened out)` : ""}.` }),
        })
        break
      }
      case "member.replied": {
        const member = str(e.member); if (!member) break
        const r = num(e.round) ?? round
        const said = str(e.summary) ?? str(e.text) ?? ""
        const none = NO_TASK.test(said)
        const mode = str(e.mode)
        let id = BOARD_MEMBER[member]
        if (id === "experimenter" && mode && MODE[mode]) {
          id = MODE[mode]
          if (id !== "experimenter") b.set("experimenter", "idle", `Round ${r}: the experimenter worked as the ${b.name(id)}.`, at)
        }
        if (!id || (roster && visitors.has(member))) {
          const v = visitor(member)
          v.state = none ? "idle" : "handing-off"; v.doing = none ? `No task in round ${r}.` : `Round ${r}: gave its reply to the lead scientist.`; v.since = at
          if (!none) b.log(at, `${v.name} replied in round ${r}.`, v.name, undefined, { kind: "write" })
        } else if (none) b.set(id, "idle", `No task in round ${r}.`, at)
        else {
          b.set(id, "handing-off", `Round ${r}: gave its reply to the lead scientist.`, at)
          b.trip(id, { id: `reply:${r}:${member}`, kind: "handoff", room: "planning", to: "navigator", label: `its round-${r} reply for the lead scientist`, short: "reply", at: at ?? 0 })
          b.log(at, `${b.name(id)} replied in round ${r}.`, b.name(id), undefined, { kind: "write" })
        }
        // The round's statements are checked once the replies are in.
        if (b.who("guardian").state !== "fetching") b.set("guardian", "fetching", `Checking round ${r}'s statements against their sources.`, at)
        break
      }
      case "claim.checked": {
        const claim = str(e.claim) ?? ""
        const { label, short, mark } = markLabel(e.verdict, claim)
        checked[mark]++; inRound++
        b.trip("guardian", { id: `check:${str(e.key) ?? `${at}:${claim}`}`, kind: "fetch", room: "review", label, short, at: at ?? 0, back: at ?? 0, outcome: "carried" })
        if (b.who("guardian").state !== "fetching") b.set("guardian", "fetching", `Checking round ${num(e.round) ?? round}'s statements against their sources.`, at)
        b.log(at, `${b.name("guardian")} checked a statement: ${label}`, b.name("guardian"), mark === "contradicted" ? "bad" : undefined, { kind: "check", did: "checked a statement:", chips: [`${MARK_GLYPH[mark]} ${MARK_WORD[mark]}`], note: clip(claim, 240) })
        break
      }
      case "constraint": b.log(at, `A limit was reached: ${clip(str(e.detail) ?? str(e.reason) ?? "", 160)}`, undefined, "warn"); break
      case "memo.written":
        guardianDone(at)
        b.set("navigator", "handing-off", "Wrote the decision memo and handed it over.", at)
        b.trip("navigator", { id: "memo", kind: "handoff", room: "report", to: "reporter", label: "the decision memo", short: "memo", at: at ?? 0 })
        if (b.who("reporter").inRun) b.set("reporter", "done", "The decision memo is written.", at)
        b.set("finisher", "done", "Checked the memo: every required section is present.", at)
        b.log(at, "The decision memo was written.", b.name("navigator"), "good", { kind: "write", did: "wrote the decision memo." })
        break
      case "run.finished": {
        guardianDone(at)
        m.status = "done"
        const total = checked.supported + checked.contradicted + checked.insufficient + checked.unchecked
        if (total) b.set("guardian", "done", `Checked ${plural(total, "statement")}: ${checked.supported} ${MARK_WORD.supported.toLowerCase()}, ${checked.contradicted} ${MARK_WORD.contradicted.toLowerCase()}, ${checked.insufficient} ${MARK_WORD.insufficient.toLowerCase()}, ${checked.unchecked} ${MARK_WORD.unchecked.toLowerCase()}.`, at)
        b.finish(at, "Had no task in this review.")
        b.log(at, "The review finished.", undefined, "good")
        break
      }
      case "run.failed": {
        const why = clip(str(e.error) ?? "The review failed.", 300)
        m.status = "failed"; m.note = why
        for (const id of CHARACTER_IDS) { const a = b.who(id); if (id !== "navigator" && a.inRun && (a.state === "working" || a.state === "fetching")) b.set(id, "idle", "Stopped: the review failed.", at) }
        for (const v of visitors.values()) if (v.state === "working") { v.state = "idle"; v.doing = "Stopped: the review failed."; v.since = at }
        b.set("navigator", "failed", `The review failed: ${why}`, at)
        b.who("navigator").problem = { text: why, at: at ?? 0 }
        b.log(at, `The review failed: ${why}`, undefined, "bad")
        break
      }
    }
  }
  return m
}

// ── 2. A research answer ─────────────────────────────────────────────────────────────────────────

const ANSWER_STANDS: Partial<Record<CharacterId, string>> = {
  navigator: "The query-planning step: turns the question into searches.",
  scout: "The web search (Exa). In a practice answer it loads example sources and nothing is searched.",
  librarian: "The literature and database searches (Europe PMC and the public databases).",
  auditor: "The screening step: decides which results help answer the question.",
  reporter: "The writing step: writes the answer from the numbered sources.",
  guardian: "The statement check: each cited sentence is checked against its source, and code confirms the quoted passage.",
  critic: "The review step: reads the whole draft for overreach and missing caveats.",
  reviser: "The revise step: rewrites the answer once, after the checks and the review.",
  finisher: "The save step: saves the answer and its files.",
}
/** The teammate that plays a step. A step kind this file does not know gets nobody. */
export function stepCharacter(kind: string | undefined, provider: string | undefined): CharacterId | undefined {
  switch (kind) {
    case "prepare": return "navigator"
    case "hypothesize": return "proposer"
    case "search": case "fetch": return searcherOf(provider)
    case "evaluate": return "auditor"
    case "write": return "reporter"
    case "check": return "guardian"
    case "review": return "critic"
    case "revise": return "reviser"
    case "save": return "finisher"
    default: return undefined
  }
}
/** What a finished step leaves for the next teammate. */
const MADE: Record<string, string> = { hypothesize: "the hypotheses to test", prepare: "the search plan", search: "the search results", fetch: "the source text", evaluate: "the kept sources", write: "the draft", check: "the check results", review: "its review notes", revise: "the revised answer", save: "the saved answer" }
const isFetch = (kind: string) => kind === "search" || kind === "fetch" || kind === "evaluate"

interface StepSeen { id: string; kind: string; label: string; provider?: string; who: CharacterId; at: number; running: boolean; /** A step of one hypothesis's investigator. */ investigator?: boolean; /** What it leaves for the next teammate, when that is not the kind's usual word. */ made?: string }
/**
 * A Standard answer with hypotheses gives each hypothesis an investigator that does all of its work (its searches,
 * the screening, its section) beside the others. Up to three: they are played by the three teammates that search
 * and screen in a plain answer, each captioned "Investigator N" for that run.
 */
const INVESTIGATORS: CharacterId[] = ["scout", "librarian", "auditor"]
const investigatorOf = (agent: string | undefined): { who: CharacterId; n: number } | undefined => { const n = Number(/^investigator-(\d)$/.exec(agent ?? "")?.[1]); return n >= 1 && n <= INVESTIGATORS.length ? { who: INVESTIGATORS[n - 1], n } : undefined }

/** `seq` is the order. A seq that arrives twice counts once (the later copy wins); events without one keep their place at the end. */
export function answerOrder(events: readonly LabEvent[]): LabEvent[] {
  const last = new Map<number, number>()
  events.forEach((e, i) => { const s = num(e?.seq); if (s !== undefined) last.set(s, i) })
  return events
    .map((e, i) => ({ e, i }))
    .filter(({ e, i }) => e && typeof e.type === "string" && (num(e.seq) === undefined || last.get(num(e.seq)!) === i))
    .sort((a, b) => (num(a.e.seq) ?? Infinity) - (num(b.e.seq) ?? Infinity) || a.i - b.i)
    .map(({ e }) => e)
}

/** A research answer's events as the lab's activity. */
export function answerLab(events: readonly LabEvent[], runId?: string): LabModel {
  const b = new Build("answer", runId, ANSWER_STANDS, "Takes part in team reviews and swarm runs. A research answer has no such step.")
  const m = b.model
  const steps = new Map<string, StepSeen>()
  const running = (who: CharacterId) => [...steps.values()].filter((s) => s.who === who && s.running)
  // Hand-offs: when a step starts, the teammate whose finished step it builds on carries that work over. Once per pair.
  const finished: StepSeen[] = [] // completed steps, in the order they ended
  const handed = new Set<string>()
  const latest = (...kinds: string[]) => finished.findLast((s) => kinds.includes(s.kind))
  /** The finished steps a starting step builds on. */
  const feeds = (id: string, kind: string, investigator: boolean): (StepSeen | undefined)[] => {
    // an investigator works down its own chain: only its first search takes something over (what to test)
    if (investigator) return kind === "search" ? [latest("hypothesize", "prepare")] : []
    switch (kind) {
      case "hypothesize": return [latest("prepare")]
      case "search": case "fetch": return [latest("hypothesize", "prepare")]
      case "evaluate": { const twin = finished.find((s) => s.id === id.replace(/^evaluate:/, "search:")); return [twin ?? latest("search", "fetch")] }
      case "write": { const sections = finished.filter((s) => s.kind === "write" && s.investigator); return sections.length ? sections : [latest("evaluate")] } // the investigators' sections, to be compared
      case "check": return [latest("write", "revise")]
      case "review": return [latest("write", "revise")] // "review:2" reads the revised text
      case "revise": return [latest("check"), latest("review")]
      case "save": return [latest("revise", "check", "review", "write")]
      default: return []
    }
  }
  let lastWho: CharacterId | undefined
  let n = 0
  // Method specialists the engine added to this answer: visitors, as in a team review. Keyed by the agent name of their steps.
  const visitors = new Map<string, Visitor>()
  const visitorSteps = new Map<string, { v: Visitor; label: string }>()

  for (const e of answerOrder(events)) {
    const at = num(e.at)
    b.seen(at); n++
    if (m.status === "waiting" && e.type !== "research.queued") { m.status = "running"; m.startedAt ??= at; m.note = undefined }
    switch (e.type) {
      case "research.queued": m.status = "waiting"; m.note = "Waiting for the answer before it to finish."; break
      case "research.resumed": b.log(at, "The answer went on after the engine restarted."); break
      case "research.started":
        m.title = str(e.question)
        m.provenance = provenanceOf({ mode: e.mode })
        m.runId ??= str(e.id) ?? str(e.run)
        m.startedAt = at ?? m.startedAt
        b.log(at, `The answer started${m.provenance === "practice" ? " (practice: fixed example text, nothing is searched)" : ""}.`)
        break
      case "specialists": {
        for (const item of Array.isArray(e.items) ? (e.items as Record<string, unknown>[]) : []) {
          const agent = str(item?.agent), title = str(item?.title) ?? str(item?.name)
          if (!agent || !title || visitors.has(agent)) continue
          const v: Visitor = { id: agent, name: title, title, why: clip(str(item.why) ?? "", 200) || undefined, room: visitorRoom(`${str(item.name) ?? ""} ${title}`), state: "idle", doing: "Joined this answer. Waiting for the sources.", since: at }
          visitors.set(agent, v); m.visitors.push(v)
          b.log(at, `${title} joined this answer as a method specialist.${v.why ? ` ${v.why}` : ""}`, title)
        }
        break
      }
      case "step.started": {
        const id = str(e.step), kind = str(e.kind) ?? "", label = str(e.label) || "Working"
        if (!id || steps.has(id)) break
        const guest = visitors.get(str(e.agent) ?? "")
        if (guest) {
          if (visitorSteps.has(id)) break
          visitorSteps.set(id, { v: guest, label })
          guest.state = "working"; guest.doing = `${label}.`; guest.since = at
          b.log(at, `${label}.`, guest.name, undefined, { kind: "write" })
          break
        }
        const provider = str(e.provider), inv = investigatorOf(str(e.agent)), hyp = clip(str(e.hypothesis) ?? "", 8)
        const who = inv?.who ?? stepCharacter(kind, provider)
        if (!who) { b.log(at, `${label}.`); break }
        if (inv && b.who(who).label !== `Investigator ${inv.n}`) {
          b.who(who).label = `Investigator ${inv.n}`
          b.who(who).standsFor = `Investigator ${inv.n} of this answer: it does all the work on one hypothesis${hyp ? ` (${hyp})` : ""}, beside the other investigators: its searches, the screening and its section.`
        }
        if (who === "proposer" && !b.who(who).inRun) b.who(who).standsFor = "The hypotheses step of a Standard answer: writes down what the answer will test against published sources."
        // the hand-off into this step
        for (const from of feeds(id, kind, !!inv)) {
          if (!from || from.who === who || handed.has(`${from.id}>${who}`)) continue
          handed.add(`${from.id}>${who}`)
          const made = from.made ?? MADE[from.kind] ?? "its work", giver = from.who
          b.trip(giver, { id: `handoff:${from.id}>${who}`, kind: "handoff", room: characterOf(who).room, to: who, label: `${made} for the ${b.name(who)}`, short: made.replace(/^(the|its) /, ""), at: at ?? 0 })
          if (!running(giver).length && b.who(giver).state !== "failed") b.set(giver, "handing-off", `Gave ${made} to the ${b.name(who)}.`, at)
          b.log(at, `${b.name(giver)} gave ${made} to the ${b.name(who)}.`, b.name(giver), undefined, { kind: "handoff", did: "gave", chips: [made.replace(/^(the|its) /, ""), `to ${b.name(who)}`] })
        }
        steps.set(id, { id, kind, label, provider, who, at: at ?? 0, running: true, ...(inv && { investigator: true }), ...(inv && kind === "write" && { made: `its section${hyp ? ` on ${hyp}` : ""}` }) })
        lastWho = who
        const query = str(e.query)
        const doing = `${label}${kind === "search" && query ? `: “${clip(query, 70)}”` : ""}.`
        if (isFetch(kind)) {
          b.trip(who, { id: `step:${id}`, kind: "fetch", room: "discovery", label, short: "…", at: at ?? 0, ...(kind !== "evaluate" && provider && { provider }) })
          if (kind === "search") b.searched(provider)
          b.set(who, "fetching", doing, at)
        } else b.set(who, "working", doing, at)
        b.log(at, `${b.name(who)}: ${doing.charAt(0).toLowerCase()}${doing.slice(1)}`, b.name(who), undefined, { kind: stepKind(kind), ...(kind === "search" && query && { did: `${lower(label)}.`, note: clip(query, 240) }) })
        break
      }
      case "step.progress": {
        const s = steps.get(str(e.step) ?? ""); if (!s?.running) break
        const done = num(e.done), total = num(e.total)
        if (done !== undefined) b.set(s.who, b.who(s.who).state === "fetching" ? "fetching" : "working", `${s.label}: ${done}${total ? ` of ${total}` : ""} so far.`, b.who(s.who).since)
        break
      }
      case "step.finished": {
        const mine = visitorSteps.get(str(e.step) ?? "")
        if (mine) {
          visitorSteps.delete(str(e.step) ?? "")
          const said = clip(str(e.summary) ?? str(e.error) ?? "", 200)
          mine.v.state = e.status === "failed" ? "failed" : e.status === "cancelled" ? "cancelled" : e.status === "empty" ? "idle" : "done"
          mine.v.doing = e.status === "completed" ? `Gave its section to the writer.${said ? ` ${said}` : ""}` : said || "Wrote nothing for this answer."
          mine.v.since = at
          b.log(at, `${mine.v.name}: ${mine.v.doing.charAt(0).toLowerCase()}${mine.v.doing.slice(1)}`, mine.v.name, e.status === "failed" ? "bad" : e.status === "empty" ? "warn" : undefined, { kind: e.status === "failed" ? "failed" : "write" })
          break
        }
        const s = steps.get(str(e.step) ?? ""); if (!s?.running) break
        s.running = false
        const status = e.status === "empty" || e.status === "failed" || e.status === "cancelled" ? e.status : "completed"
        const found = num(e.found), kept = num(e.kept), place = placeOf(s.provider)
        const error = str(e.error), consequence = str(e.consequence), summary = str(e.summary)
        let line: string, label = s.label, short = "", outcome: Trip["outcome"] = "carried"
        if (status === "failed") { line = `${s.label}: did not work.${error ? ` ${clip(error, 200)}` : ""}${consequence ? ` ${clip(consequence, 200)}` : ""}`; label = `nothing: ${s.label.charAt(0).toLowerCase()}${s.label.slice(1)} failed`; short = "failed"; outcome = "failed" }
        else if (status === "cancelled") { line = `${s.label}: stopped.`; label = "nothing (stopped)"; short = "stopped"; outcome = "empty" }
        else if (status === "empty") { line = `${s.label}: found nothing.`; label = `nothing from ${place}`; short = "nothing"; outcome = "empty" }
        else if (s.kind === "search" || s.kind === "fetch") { line = `${s.label}: found ${found ?? 0}.`; label = fromPlace(found ?? 0, s.provider); short = tagOf(found ?? 0, s.provider); outcome = (found ?? 1) > 0 ? "carried" : "empty" }
        else if (s.kind === "evaluate") { line = `${s.label}: kept ${kept ?? 0}${found !== undefined ? ` of ${found}` : ""}.`; label = `${plural(kept ?? 0, "source")} kept${found !== undefined ? ` of ${found}` : ""}`; short = `${kept ?? 0} kept`; outcome = (kept ?? 1) > 0 ? "carried" : "empty" }
        else line = `${s.label}: done.${summary ? ` ${clip(summary, 160)}` : ""}`
        if (isFetch(s.kind)) b.trip(s.who, { id: `step:${s.id}`, kind: "fetch", room: "discovery", label, short, at: s.at, back: at ?? s.at, outcome, ...(s.kind !== "evaluate" && s.provider && { provider: s.provider }) })
        if (status === "failed") b.who(s.who).problem = { text: line, at: at ?? 0 }
        const left = running(s.who)
        if (left.length) { const next = left.at(-1)!; b.set(s.who, isFetch(next.kind) ? "fetching" : "working", `${next.label}.`, b.who(s.who).since) }
        else b.set(s.who, status === "failed" ? "failed" : status === "cancelled" ? "cancelled" : "done", line, at)
        if (status === "completed") finished.push(s)
        const said = [error, consequence].filter(Boolean).map((t) => clip(t!, 240)).join(" ")
        b.log(at, `${b.name(s.who)}: ${line.charAt(0).toLowerCase()}${line.slice(1)}`, b.name(s.who), status === "failed" ? "bad" : status === "empty" ? "warn" : undefined, {
          kind: status === "failed" ? "failed" : stepKind(s.kind),
          ...(status === "failed" ? { did: `${lower(s.label)}: did not work.`, ...(said && { note: said }) }
            : status !== "completed" ? {}
            : s.kind === "search" || s.kind === "fetch" ? { did: `${lower(s.label)}: found`, chips: [plural(found ?? 0, nounOf(s.provider))] }
            : s.kind === "evaluate" ? { did: `${lower(s.label)}: kept`, chips: [`${kept ?? 0}${found !== undefined ? ` of ${found}` : ""}`] }
            : summary ? { did: `${lower(s.label)}: done.`, note: clip(summary, 240) } : {}),
        })
        break
      }
      case "statement.checked": {
        if (e.carried === true) break // a verdict copied from the draft: nothing was checked again
        const text = str(e.text); if (text === undefined) break
        const { label, short, mark } = markLabel(e.verdict, text)
        b.trip("guardian", { id: `check:${e.stage === "final" ? "final" : "draft"}:${num(e.index) ?? n}`, kind: "fetch", room: "review", label, short, at: at ?? 0, back: at ?? 0, outcome: "carried" })
        b.log(at, `${b.name("guardian")} checked a statement: ${label}`, b.name("guardian"), mark === "contradicted" ? "bad" : undefined, { kind: "check", did: "checked a statement:", chips: [`${MARK_GLYPH[mark]} ${MARK_WORD[mark]}`], note: clip(text, 240) })
        break
      }
      case "review.note": if (str(e.text)) b.log(at, `${b.name("critic")} raised a ${str(e.severity) ?? "minor"} note: ${clip(str(e.text)!, 160)}`, b.name("critic"), e.severity === "blocking" ? "warn" : undefined, { kind: e.severity === "blocking" ? "warn" : "check", did: `raised a ${str(e.severity) ?? "minor"} note:`, note: clip(str(e.text)!, 240) }); break
      case "hypotheses": if (Array.isArray(e.items)) b.log(at, e.items.length ? `${plural(e.items.length, "hypothesis", "hypotheses")} set up. ${HYPOTHESES_NOTE}` : "No hypothesis was needed for this question.", b.name("proposer"), undefined, e.items.length ? { kind: "write", did: "set up", chips: [plural(e.items.length, "hypothesis", "hypotheses")], note: HYPOTHESES_NOTE } : { did: "needed no hypothesis for this question." }); break
      case "hypothesis.checked": {
        // The mark is the engine's (code works it out); the same words as the Research view. In a practice run it
        // is an example, said without a mark.
        const id = clip(str(e.id) ?? "", 8), mark = markOf(e.verdict)
        const nums = (v: unknown) => (Array.isArray(v) ? v.filter((n): n is number => typeof n === "number") : [])
        const sides = sidesLine({ verdict: "unchecked", for: nums(e.for), against: nums(e.against), forStatements: [], againstStatements: [], mixed: e.mixed === true })
        const practice = m.provenance === "practice"
        const said = practice ? `Example result: ${MARK_WORD[mark]}` : `${MARK_GLYPH[mark]} ${MARK_WORD[mark]}${e.mixed === true ? ": the sources disagree" : ""}`
        const label = `the result for hypothesis ${id}: ${said} (${sides})`
        // code works the result out; the Guardian carries it to the investigator whose hypothesis it is, else to where the hypotheses were set up
        const to = investigatorOf(str(e.agent))?.who ?? "proposer"
        b.trip("guardian", { id: `hypothesis:${id}`, kind: "handoff", room: characterOf(to).room, to, label, short: practice ? `${id}: example` : `${id} ${MARK_GLYPH[mark]}`, at: at ?? 0 })
        b.log(at, `${b.name("guardian")} brought ${label}.`, b.name("guardian"), !practice && mark === "contradicted" ? "bad" : undefined, { kind: "check", did: `brought the result for hypothesis ${id}:`, chips: [said, `to ${b.name(to)}`], note: sides })
        break
      }
      case "review.resolved": if (Array.isArray(e.notes)) { const closed = (e.notes as Record<string, unknown>[]).filter((x) => x?.resolved === true).length; b.log(at, `${b.name("critic")} judged its notes against the revised answer: ${closed} of ${e.notes.length} resolved.`, b.name("critic"), undefined, { kind: "check", did: "judged its notes against the revised answer:", chips: [`${closed} of ${e.notes.length} resolved`] }) } break
      case "sources": if (Array.isArray(e.items)) b.log(at, `${plural(e.items.length, "source")} numbered for the writer.`); break
      case "selection": if (Array.isArray(e.selected)) b.log(at, `${plural(e.selected.length, "source")} selected${Array.isArray(e.notSelected) ? `, ${e.notSelected.length} not selected` : ""}.`, b.name("auditor"), undefined, { kind: "screen", did: "selected", chips: [Array.isArray(e.notSelected) ? `${e.selected.length} of ${plural(e.selected.length + e.notSelected.length, "source")}` : plural(e.selected.length, "source")] }); break
      case "artifact.created": { const file = str((e.artifact as Record<string, unknown> | undefined)?.name); if (file) b.log(at, `${b.name("finisher")} saved ${clip(file, 60)}.`, b.name("finisher"), undefined, { kind: "write", did: "saved", chips: [clip(file, 60)] }); break }
      case "missing": if (Array.isArray(e.items) && e.items.length) b.log(at, `Named as not found or not checked: ${plural(e.items.length, "item")}.`, undefined, "warn"); break
      case "answer.written": b.log(at, "The draft is written.", b.name("reporter"), undefined, { kind: "write", did: "wrote the draft." }); break
      case "answer.revised": b.log(at, "The answer was revised.", b.name("reviser"), undefined, { kind: "write", did: "revised the answer." }); break
      case "research.finished": {
        m.status = "done"
        const note = str(e.note); if (note) m.note = clip(note, 300)
        b.finish(at, "Was not needed in this answer.")
        b.log(at, "The answer is finished.", undefined, "good")
        break
      }
      case "research.failed": {
        const why = clip(str(e.error) ?? "The answer could not be finished.", 300)
        m.status = "failed"; m.note = why
        for (const v of visitors.values()) if (v.state === "working") { v.state = "idle"; v.doing = "Stopped: the answer failed."; v.since = at }
        const open = [...steps.values()].filter((s) => s.running)
        for (const s of open) {
          s.running = false
          if (isFetch(s.kind)) b.trip(s.who, { id: `step:${s.id}`, kind: "fetch", room: "discovery", label: "nothing: the answer failed", short: "failed", at: s.at, back: at ?? s.at, outcome: "failed" })
          b.set(s.who, "failed", `${s.label}: did not finish. ${why}`, at); b.who(s.who).problem = { text: why, at: at ?? 0 }
        }
        // The engine closes every running step before this event; only when nobody shows the failure does the last teammate carry it.
        if (!open.length && lastWho && !CHARACTER_IDS.some((id) => b.who(id).state === "failed")) { b.set(lastWho, "failed", `The answer failed after this step: ${why}`, at); b.who(lastWho).problem = { text: why, at: at ?? 0 } }
        b.log(at, `The answer failed: ${why}`, undefined, "bad")
        break
      }
      case "research.cancelled":
        for (const s of steps.values()) s.running = false
        for (const v of visitors.values()) if (v.state === "working") { v.state = "cancelled"; v.doing = "Stopped: the answer was cancelled."; v.since = at }
        b.cancel(at, "This answer was cancelled.")
        b.log(at, "The answer was cancelled. Everyone is back at their desks.", undefined, "warn")
        break
    }
  }
  return m
}

// ── 3. A swarm run ───────────────────────────────────────────────────────────────────────────────

/** The parts of the run tracker's record this file reads (engine/src/glhf/types.ts, GlhfRun). */
export interface SwarmRun { id: string; solver?: string; model?: string; modelClass?: string; task?: string; phase?: string; detail?: string; startedAt?: number; finishedAt?: number; error?: string }
/** The swarm's shared notes, as far as this file reads them: the list of what happened, in order. */
export interface SwarmNotes { events?: unknown }

const SWARM_STANDS: Partial<Record<CharacterId, string>> = {
  scout: "The scout role: inspects the data and the tools before anyone plans.",
  proposer: "The proposer role: plans the analysis and writes down statements to test.",
  pilot: "The pilot role: tries the whole analysis on a small sample first.",
  experimenter: "The experimenter role: runs the analysis and writes the results.",
  auditor: "The auditor role: checks the scripts against the stated methods.",
  critic: "The critic role: checks the work and tries to disprove each statement.",
  reviser: "The reviser role: fixes the problems the reviewers found.",
  finisher: "The finisher role: recovers any result still missing at the end.",
  reporter: "The reporter role: writes up what was actually done.",
  guardian: "The rule that turns recorded tests into a mark for each statement. Code computes it; no model decides it.",
}
/** The first word of a step's name says which role runs it ("audit 2" is the auditor's second pass). */
const SWARM_ROLE: Record<string, CharacterId> = { scout: "scout", propose: "proposer", pilot: "pilot", experiment: "experimenter", audit: "auditor", critique: "critic", revise: "reviser", finish: "finisher", report: "reporter" }
const SWARM_DOES: Record<string, string> = {
  scout: "Inspecting the data and the tools", propose: "Planning the analysis and writing down statements to test", pilot: "Trying the analysis on a small sample",
  experiment: "Running the analysis and writing the results", audit: "Checking the scripts against the stated methods", critique: "Checking the work and trying to disprove each statement",
  revise: "Fixing the problems the reviewers found", finish: "Recovering results that are still missing", report: "Writing up what was done",
}
const SWARM_BY: Record<string, CharacterId> = { planner: "proposer", proposer: "proposer", critic: "critic", auditor: "auditor", experimenter: "experimenter", reviser: "reviser", pilot: "pilot", scout: "scout", reporter: "reporter", finisher: "finisher" }
const roleKey = (phase: string | undefined) => phase?.trim().split(/\s+/)[0] ?? ""
const passOf = (phase: string) => { const n = Number(phase.trim().split(/\s+/)[1]); return Number.isInteger(n) && n > 1 ? ` (pass ${n})` : "" }

/**
 * When each note happened. The notes carry no clock: a step's end says how many seconds of the budget are left, and
 * that is the only time there is. So a note gets the time of the last step end before it. `seenAt` (when a poll first
 * saw each note, while the run is watched live) is used instead where it is given.
 */
export function swarmTimes(run: SwarmRun, events: readonly LabEvent[], seenAt?: readonly (number | undefined)[]): { at: number[]; rough: boolean } {
  const start = run.startedAt ?? 0
  const budget = num(events.find((e) => e?.kind === "settings")?.budget_seconds)
  let now = start, rough = false
  const at = events.map((e, i) => {
    const seen = seenAt?.[i]
    if (seen !== undefined) { now = Math.max(now, seen); return now }
    rough = true
    const left = num(e?.left)
    if (budget !== undefined && left !== undefined) now = Math.max(now, start + Math.max(0, budget - left) * 1000)
    return now
  })
  return { at, rough }
}

/** A swarm run's record and shared notes as the lab's activity. `upTo` reads only the first notes (a replay). */
export function swarmLab(run: SwarmRun | undefined, notes: SwarmNotes | null | undefined, options: { seenAt?: readonly (number | undefined)[]; upTo?: number } = {}): LabModel {
  const single = run?.solver === "single"
  const b = new Build("swarm", run?.id, single ? { experimenter: "The single agent: one agent alone does every step of this run." } : SWARM_STANDS,
    single ? "This run used one agent alone, not the team." : "The swarm has no such role. It takes part in team reviews and research answers.", single ? { experimenter: "Single agent" } : { guardian: "Mark rule" })
  const m = b.model
  if (!run) return m
  m.title = run.task ? `Task: ${run.task}` : undefined
  m.provenance = swarmProvenance(run)
  m.startedAt = run.startedAt
  const all = (Array.isArray(notes?.events) ? (notes!.events as unknown[]) : []).filter((e): e is LabEvent => !!e && typeof e === "object")
  const times = swarmTimes(run, all, options.seenAt)
  m.roughTimes = times.rough && all.length > 0
  const whole = options.upTo === undefined || options.upTo >= all.length
  const events = whole ? all : all.slice(0, Math.max(0, options.upTo!))
  const phase = whole ? run.phase : "running" // a replay that has not reached the end is still running
  let current: { key: string; who: CharacterId; phase: string } | undefined
  let finished: { who: CharacterId; made: string } | undefined

  if (phase === undefined) return m // the record has not been read yet: nothing is claimed
  if (phase === "queued" || phase === "launching") { m.status = "waiting"; m.note = clip(run.detail ?? (phase === "queued" ? "Waiting in the queue." : "Starting."), 200) }
  else m.status = "running"
  if (single && m.status === "running") b.set("experimenter", "working", "Working through the task alone.", run.startedAt)

  events.forEach((e, i) => {
    const at = times.at[i]
    b.seen(at)
    const by = SWARM_BY[str(e.by) ?? ""]
    switch (e.kind) {
      case "phase.started": {
        const p = str(e.phase) ?? "", key = roleKey(p), who = SWARM_ROLE[key]
        if (!who) { b.log(at, `Step started: ${clip(p, 60)}.`); break }
        if (finished && finished.who !== who) {
          b.trip(finished.who, { id: `handoff:${i}`, kind: "handoff", room: characterOf(who).room, to: who, label: `${finished.made} for the ${b.name(who)}`, short: "notes", at })
          b.set(finished.who, "handing-off", `Gave ${finished.made} to the ${b.name(who)}.`, at)
        }
        finished = undefined
        current = { key, who, phase: p }
        b.set(who, "working", `${SWARM_DOES[key]}${passOf(p)}.`, at)
        b.log(at, `${b.name(who)} started: ${SWARM_DOES[key].charAt(0).toLowerCase()}${SWARM_DOES[key].slice(1)}${passOf(p)}.`, b.name(who))
        break
      }
      case "phase.finished": {
        const p = str(e.phase) ?? "", key = roleKey(p), who = SWARM_ROLE[key]
        if (!who) break
        const limit = e.limit_hit === true
        b.set(who, "done", limit ? `Stopped at its ${str(e.limit) ?? "limit"} before it was finished${passOf(p)}.` : `Finished: ${SWARM_DOES[key].charAt(0).toLowerCase()}${SWARM_DOES[key].slice(1)}${passOf(p)}.`, at)
        if (current?.who === who) current = undefined
        finished = { who, made: "its notes" }
        b.log(at, `${b.name(who)} ${limit ? "stopped at its limit" : "finished"}${passOf(p)}.`, b.name(who), limit ? "warn" : undefined)
        break
      }
      case "claim.added": b.log(at, `${by ? b.name(by) : "The team"} wrote down statement ${clip(str(e.claim) ?? "", 12)}: “${clip(str(e.text) ?? "", 100)}”`, by && b.name(by)); break
      case "test.registered": b.log(at, `${by ? b.name(by) : "The team"} planned a test for statement ${clip(str(e.claim) ?? "", 12)}: ${clip(str(e.name) ?? "", 60)}.`, by && b.name(by)); break
      case "test.recorded": {
        const claim = clip(str(e.claim) ?? "", 12), test = clip(str(e.name) ?? "a test", 60)
        const mark = markOf(e.verdict)
        const label = `statement ${claim}: ${MARK_GLYPH[mark]} ${MARK_WORD[mark]} after the test “${test}”`
        b.trip("guardian", { id: `test:${i}`, kind: "fetch", room: "review", label, short: `${claim} ${MARK_GLYPH[mark]}`, at, back: at, outcome: "carried" })
        b.set("guardian", m.status === "running" ? "fetching" : b.who("guardian").state, `Worked out the mark of ${label}.`, at)
        b.log(at, `${b.name("guardian")} worked out a mark from a recorded test: ${label}.`, b.name("guardian"), mark === "contradicted" ? "bad" : undefined)
        break
      }
      case "issue.raised": b.log(at, `${by ? b.name(by) : "A reviewer"} raised a ${str(e.severity) ?? ""} problem: ${clip(str(e.problem) ?? "", 140)}`, by && b.name(by), "warn"); break
      case "issue.resolved": b.log(at, `Problem ${clip(str(e.issue) ?? "", 12)} was marked ${str(e.status) ?? "resolved"}.`, current && b.name(current.who)); break
      case "review.converged": b.log(at, "The reviewers have no open problems left."); break
      case "finished": b.log(at, `The swarm's work ended. ${clip(str(e.contract) ?? "", 140)}`.trim()); break
    }
  })

  if (phase === "done") { m.status = "done"; b.finish(run.finishedAt ?? m.at, "Had nothing to do in this run."); b.log(run.finishedAt ?? m.at, "The run finished.", undefined, "good") }
  else if (phase === "failed") {
    const why = clip((run.error ?? "The run failed.").split("\n")[0], 300)
    m.status = "failed"; m.note = why
    const who = current?.who ?? (single ? "experimenter" : undefined)
    if (who) { b.set(who, "failed", `The run failed during this step: ${why}`, run.finishedAt ?? m.at); b.who(who).problem = { text: why, at: run.finishedAt ?? m.at ?? 0 } }
    b.log(run.finishedAt ?? m.at, `The run failed: ${why}`, undefined, "bad")
  } else if (phase === "cancelled") {
    b.cancel(run.finishedAt ?? m.at, "This run was cancelled.")
    b.log(run.finishedAt ?? m.at, "The run was cancelled. Everyone is back at their desks.", undefined, "warn")
  } else if (phase === "completing") m.note = "Collecting the results."
  return m
}

/** Practice, live or local, from the run's own record: the scripted model is a practice run. */
export const swarmProvenance = (run: SwarmRun): Provenance | undefined => (run.modelClass === "scripted" ? "practice" : run.modelClass === "local" ? "local" : provenanceOf({ model: run.model }))
