// Agent Lab design by Anh Lam (https://github.com/Anhlam09/agent-lab-report, and the look of Agent Lab 2.0,
// https://github.com/Anhlam09/agent-lab-2.0): six rooms, the Buddy characters, the lab equipment.
// This file is the pure part of the dashboard's Lab: the rooms, who the teammates are, and the ACTIVITY MODEL the
// scene draws. The model is made from engine events only (adapter.ts). Nothing here invents work: a teammate that
// no event mentions stays idle at its desk.
import type { ProvenanceKind } from "@/lib/provenance"

export type RoomId = "discovery" | "planning" | "bench" | "review" | "quality" | "report"
export interface Room { id: RoomId; name: string }
/** Anh's six rooms (stations), in map order. */
export const ROOMS: readonly Room[] = [
  { id: "discovery", name: "Discovery" }, { id: "planning", name: "Planning" }, { id: "bench", name: "Experiment bench" },
  { id: "review", name: "Evidence review" }, { id: "quality", name: "Quality control" }, { id: "report", name: "Report studio" },
]
export const roomOf = (id: RoomId): Room => ROOMS.find((r) => r.id === id)!
/** A room of Agent Lab 2.0: a 450 x 214 card. `back` is the height of its back wall; the floor is below it. */
export const ROOM = { width: 450, height: 214, back: 58 } as const

/**
 * Where the rooms are. "wide" is Anh's 2.0 map: 1000 x 706, three rooms on each side of a narrow corridor. "tall" is
 * the same rooms in one column beside the corridor, for a narrow screen, so the lab never needs a sideways scroll.
 * Everything on the map is placed in these units. A room's door is at the bottom of its corridor side.
 */
export interface LabLayout { id: "wide" | "tall"; width: number; height: number; corridorX: number; at: Record<RoomId, { x: number; y: number; door: "left" | "right" }> }
const column = (ids: RoomId[], x: number, door: "left" | "right") => Object.fromEntries(ids.map((id, i) => [id, { x, y: 16 + i * 230, door }]))
export const WIDE: LabLayout = {
  id: "wide", width: 1000, height: 706, corridorX: 500,
  at: { ...column(["discovery", "bench", "quality"], 20, "right"), ...column(["planning", "review", "report"], 530, "left") } as LabLayout["at"],
}
export const TALL: LabLayout = {
  id: "tall", width: 546, height: 1396, corridorX: 500,
  at: column(["discovery", "planning", "bench", "review", "quality", "report"], 20, "right") as LabLayout["at"],
}
/** Anh's map, for code that asks for "the" map. */
export const MAP = WIDE
/** Where a room's doorway is: 30 in from its corridor side, 34 up from its bottom edge (as in 2.0). */
export const doorOf = (layout: LabLayout, room: RoomId) => { const r = layout.at[room]; return { x: r.door === "right" ? r.x + ROOM.width - 30 : r.x + 30, y: r.y + ROOM.height - 34 } }

// ── The furniture of Agent Lab 2.0, as data: [room, type, x in the room, y of its front edge, width] ──
export type FurnType = "cabinet" | "shelf" | "labtable" | "plant" | "maptable" | "desk" | "desk2" | "microscope" | "rack" | "clipdesk" | "shielddesk" | "printer" | "easel"
export type WallType = "wallscreen" | "notes" | "whiteboard" | "panel" | "chartscreen" | "glassshelf" | "dna" | "periodic" | "hazard" | "cells"
export type CounterType = "bottles" | "beakers" | "tubes" | "sink" | "centrifuge" | "incubator" | "hood"
export const FURNITURE: readonly (readonly [RoomId, FurnType, number, number, number])[] = [
  ["discovery", "cabinet", 55, 104, 60], ["discovery", "shelf", 265, 98, 110], ["discovery", "labtable", 190, 150, 110], ["discovery", "plant", 32, 186, 26], ["discovery", "plant", 420, 104, 26],
  ["planning", "cabinet", 75, 104, 60], ["planning", "maptable", 240, 160, 120], ["planning", "plant", 425, 110, 26], ["planning", "plant", 420, 166, 26],
  ["bench", "cabinet", 50, 104, 60], ["bench", "labtable", 180, 160, 120], ["bench", "desk", 335, 150, 90], ["bench", "plant", 30, 186, 26], ["bench", "plant", 415, 100, 26],
  ["review", "desk2", 215, 150, 120], ["review", "microscope", 360, 140, 60], ["review", "rack", 425, 110, 36], ["review", "plant", 428, 196, 26],
  ["quality", "clipdesk", 145, 166, 100], ["quality", "shielddesk", 290, 172, 90], ["quality", "plant", 30, 120, 26], ["quality", "plant", 405, 100, 26],
  ["report", "shelf", 215, 98, 110], ["report", "desk2", 165, 164, 120], ["report", "printer", 395, 104, 50], ["report", "easel", 410, 178, 36], ["report", "plant", 300, 100, 26],
]
/** Things on the back wall: [room, type, x]. The room's name sits over the left of each wall. */
export const WALL_ITEMS: readonly (readonly [RoomId, WallType, number])[] = [
  ["discovery", "dna", 185], ["discovery", "glassshelf", 360], ["planning", "whiteboard", 240], ["planning", "periodic", 400], ["bench", "hazard", 395],
  ["review", "glassshelf", 260], ["review", "cells", 360], ["quality", "chartscreen", 245], ["quality", "hazard", 405], ["report", "periodic", 300], ["report", "wallscreen", 375],
]
/** Equipment on the lab counter along the back wall: [room, type, x]. */
export const COUNTER_ITEMS: readonly (readonly [RoomId, CounterType, number])[] = [
  ["discovery", "bottles", 125], ["discovery", "tubes", 175], ["discovery", "sink", 365], ["planning", "beakers", 150], ["planning", "tubes", 330], ["planning", "bottles", 250],
  ["bench", "centrifuge", 140], ["bench", "hood", 260], ["bench", "bottles", 362], ["review", "centrifuge", 205], ["review", "incubator", 335], ["review", "tubes", 100],
  ["quality", "sink", 110], ["quality", "beakers", 175], ["quality", "bottles", 330], ["report", "bottles", 105], ["report", "tubes", 320],
]
/** In each room, where a teammate stands to pick something up or to put it down: in front of the room's main table. */
export const PICK: Record<RoomId, readonly [number, number]> = { discovery: [262, 184], planning: [240, 188], bench: [205, 188], review: [215, 180], quality: [220, 190], report: [272, 188] }

/**
 * Two pick-up points in Discovery for real searches, at furniture 2.0 already has there: the computer on the cabinet
 * for the web, the bookshelf for papers and public databases. `dx`, `dy`: where a teammate stands, from the room's corner.
 */
export const SEARCH_SPOTS = {
  web: { dx: 103, dy: 112, about: "Web search" },
  papers: { dx: 338, dy: 106, about: "Literature and public databases" },
} as const
/** Which pick-up point a search uses. A practice run's example sources, and anything that is not a search, use the room's table. */
export const searchSpot = (provider: string | undefined): keyof typeof SEARCH_SPOTS | undefined =>
  provider === "exa" ? "web" : provider && provider !== "fixture" ? "papers" : undefined

/** The Buddy characters of the app (components/Buddy.tsx), which Agent Lab 2.0 draws in the lab. */
export type Shape = "bunny" | "flame" | "egg" | "mountain" | "sprout"
export type CharacterId =
  | "scout" | "librarian" | "proposer" | "navigator" | "experimenter" | "pilot"
  | "auditor" | "critic" | "reviser" | "guardian" | "reporter" | "finisher"
export interface Character { id: CharacterId; name: string; shape: Shape; color: string; room: RoomId; index: number; /** Where it stands in its room, from the room's corner. */ home: readonly [number, number] }
/**
 * The twelve teammates. Nine are the roles of Agent Lab 2.0, each with the Buddy species 2.0 gives it; where two
 * roles share a species, the first keeps the Buddy's own colour and the second gets a colour of its own, so every
 * teammate can be told apart. The Librarian, the Navigator and the Guardian are not in 2.0: they are a sprout, a
 * mountain and an egg in colours no other teammate has. Homes are 2.0's where 2.0 has one.
 */
export const CHARACTERS: readonly Character[] = ([
  ["scout", "Scout", "bunny", "#f6b6cd", "discovery", [372, 162]],
  ["librarian", "Librarian", "sprout", "#a9c56b", "discovery", [150, 172]],
  ["proposer", "Proposer", "sprout", "#5cc48d", "planning", [120, 150]],
  ["navigator", "Navigator", "mountain", "#8f7fe0", "planning", [334, 172]],
  ["experimenter", "Experimenter", "flame", "#ff7a59", "bench", [92, 165]],
  ["pilot", "Pilot", "egg", "#ffcf4a", "bench", [265, 152]],
  ["auditor", "Auditor", "sprout", "#4fb3c8", "review", [110, 152]],
  ["critic", "Critic", "mountain", "#6b9bf2", "review", [330, 174]],
  ["reviser", "Reviser", "egg", "#ff9f6b", "quality", [68, 170]],
  ["guardian", "Guardian", "egg", "#7fb2f5", "quality", [364, 176]],
  ["reporter", "Reporter", "bunny", "#c9b5e8", "report", [72, 160]],
  ["finisher", "Finisher", "flame", "#f0a23c", "report", [360, 178]],
] as const).map(([id, name, shape, color, room, home], index) => ({ id, name, shape, color, room, index, home }))
export const CHARACTER_IDS = CHARACTERS.map((c) => c.id)
export const characterOf = (id: CharacterId): Character => CHARACTERS.find((c) => c.id === id)!

/**
 * What a teammate is doing, as far as the events say.
 *  idle         in the run, nothing to do yet (or nothing more this round)
 *  working      a step of its own is running
 *  fetching     it is out getting something: a search, a screening, a check against a source
 *  handing-off  it finished and gave its work to the next teammate
 *  done         its work is finished (or the run is)
 *  failed       its step failed; this stays visible
 *  cancelled    the run was cancelled; back at its desk
 */
export type LabState = "idle" | "working" | "fetching" | "handing-off" | "done" | "failed" | "cancelled"

/**
 * One walk. A "fetch" goes to a room, waits there until what it fetches is known (`back`), then carries it home.
 * A "handoff" carries the teammate's finished work to the room of the next teammate and comes home with empty hands.
 * A trip is made by exactly one engine event (or one step's start and end); the scene walks each trip once.
 */
export interface Trip {
  id: string
  /** "carry": a claim is picked up in the room of its old state (`from`) and put down in the room of its new one. */
  kind: "fetch" | "handoff" | "carry"
  room: RoomId
  /** What is being fetched or handed over, in plain words: "8 papers from PubMed and preprints". */
  label: string
  /** A few characters for the tag over the parcel: "8 papers". */
  short: string
  /** When it set out (engine time, ms). */
  at: number
  /** A fetch: when the result was known. Undefined while it is still out. A handoff has none. */
  back?: number
  /** A fetch that came back: with something, with nothing, or it failed. */
  outcome?: "carried" | "empty" | "failed"
  /** A handoff: who it is for. */
  to?: CharacterId
  /** A search: where it looked ("exa", "europepmc", "fixture", a database), as the engine recorded it. */
  provider?: string
  /** A carry: the room the claim is picked up in, and the claim's id. */
  from?: RoomId
  claim?: string
}

export interface Activity {
  id: CharacterId
  /** False: no agent or step of this run is played by this teammate. It stays at its desk, marked "not in this run". */
  inRun: boolean
  /**
   * The caption under the character, when this run has a real agent it stands for whose name differs from the
   * character's: the engine's own title for that agent ("Lead Scientist" for the Navigator in a team review).
   * From identity.ts, so the Lab says the same as every other view. Undefined: the character's own name.
   */
  label?: string
  /** The real agent or step this teammate stands for in this run, in plain words. */
  standsFor: string
  state: LabState
  /** What it is doing now, in plain words. */
  doing: string
  /** Since when (engine time, ms). */
  since?: number
  /** Its walks, oldest first. Only the last few are kept. */
  trips: Trip[]
  /** The last thing it brought back. */
  lastFetched?: { label: string; room: RoomId; at: number; provider?: string }
  /** A step of its own that failed. Kept to the end of the run, also when it works again afterwards. */
  problem?: { text: string; at: number }
}

/** A method specialist that joined a team review: shown as a visitor in the room that fits, under its real name. */
export interface Visitor { id: string; name: string; title: string; why?: string; room: RoomId; state: LabState; doing: string; since?: number }

export interface LogLine { id: string; at: number; text: string; who?: string; tone?: "bad" | "good" | "warn" }

/** The states a claim moves through in the claims engine. Only the engine's code moves a claim; the lab shows the state it is given. */
export type ClaimState = "triaged" | "piloting" | "in_workup" | "under_review" | "sent_back" | "supported" | "rejected" | "not_established"
export const CLAIM_WORD: Record<ClaimState, string> = {
  triaged: "Triaged", piloting: "Piloting", in_workup: "In workup", under_review: "Under review", sent_back: "Sent back",
  supported: "Supported", rejected: "Rejected", not_established: "Not established",
}
/** A mark for the three states a claim ends in, so they are never told apart by colour alone. */
export const CLAIM_GLYPH: Record<ClaimState, string> = { triaged: "", piloting: "", in_workup: "", under_review: "", sent_back: "↩", supported: "✓", rejected: "✕", not_established: "?" }
/** The room a claim sits in: where the work of its state is done; a closed claim is shelved. */
export const CLAIM_ROOM: Record<ClaimState, RoomId> = {
  triaged: "planning", piloting: "bench", in_workup: "bench", sent_back: "bench", under_review: "review",
  supported: "report", rejected: "quality", not_established: "quality",
}
export const claimOpen = (state: ClaimState) => state !== "supported" && state !== "rejected" && state !== "not_established"

/** One claim of a claims-engine run, as the board snapshot and the events after it say. */
export interface ClaimCard {
  id: string
  text: string
  acuity?: string
  state: ClaimState
  room: RoomId
  /** Why it is in this state: the `reason` of its last move, in the engine's words. */
  reason?: string
  movedAt?: number
  /**
   * What is known about work on it now. The engine reports a call only when it ends, so an open claim is "being
   * worked on or waiting" between two events; no agent is named unless an event names it.
   */
  activity: string
  budget: { tokensSpent: number; tokensAlloc?: number; secondsSpent: number; secondsAlloc?: number }
  /** Calls per mode ("pilot", "workup", "audit 1", ...): 2 means it was tried again. */
  attempts: Record<string, number>
  errors: string[]
  /** The last call on it that ended. */
  lastCall?: { role: string; mode: string; outcome: string; at: number }
}

export type RunKind = "board" | "answer" | "swarm"
export const KIND_WORD: Record<RunKind, string> = { board: "Team review", answer: "Research answer", swarm: "Swarm run" }
/** How a run was made, from its own record: the shell's one vocabulary (lib/provenance.ts). */
export type Provenance = ProvenanceKind

export interface LabModel {
  kind?: RunKind
  runId?: string
  /** The question or brief, as the run recorded it. Untrusted text. */
  title?: string
  /** From the run's own record: a practice run (fixed text) or live research. Undefined until the run says. */
  provenance?: Provenance
  /** "empty": no run. "waiting": queued or starting. */
  status: "empty" | "waiting" | "running" | "done" | "failed" | "cancelled"
  /** One line about the whole run: why it failed, that it was cancelled, what it waits for. */
  note?: string
  startedAt?: number
  /** The time of the newest event the model was made from. */
  at?: number
  /** True when the times are estimates (a swarm's notes record time only when a step ends). */
  roughTimes?: boolean
  /** A claims-engine run: its claims, in the order they were proposed. */
  claims?: ClaimCard[]
  /** Lines the view must show for this run: the model, that it is a scripted run, which switches were off. */
  labels?: string[]
  /** True when an event is missing between the snapshot and the events held: the reader must read the snapshot again. */
  needsSync?: boolean
  /** The searches the run has reported so far, counted by where they looked. Only what an event said. */
  searches?: Record<string, number>
  characters: Record<CharacterId, Activity>
  visitors: Visitor[]
  /** Oldest first. */
  log: LogLine[]
}

export const STATE_WORD: Record<LabState, string> = {
  idle: "Idle", working: "Working", fetching: "Fetching", "handing-off": "Handed off", done: "Done", failed: "Failed", cancelled: "Cancelled",
}
/** A mark for each state, so a state never rests on colour alone. Idle has none. */
export const STATE_GLYPH: Record<LabState, string> = { idle: "", working: "…", fetching: "⇄", "handing-off": "→", done: "✓", failed: "✕", cancelled: "■" }
export const NOT_IN_RUN = "Not in this run"

const idleActivity = (id: CharacterId): Activity => ({ id, inRun: false, standsFor: "", state: "idle", doing: "", trips: [] })
/** The lab with nobody at work: what is shown when there is no run. */
export function emptyLab(): LabModel {
  const characters = Object.fromEntries(CHARACTER_IDS.map((id) => [id, { ...idleActivity(id), inRun: true, doing: "Waiting for the next run." }])) as Record<CharacterId, Activity>
  return { status: "empty", characters, visitors: [], log: [] }
}

/** Trips kept per teammate. Older ones are still in the log. */
export const TRIPS_KEPT = 8
/** Log lines kept. */
export const LOG_KEPT = 200

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
export const clip = (text: string, max: number) => { const flat = text.replace(/\s+/g, " ").trim(); return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat }

/** A trip that came back longer ago than this is history when the scene first sees it, and is not walked. */
export const FRESH_MS = 20_000

/** The caption of a teammate in this run: the agent it stands for, else the character's own name. */
export const captionOf = (a: Activity): string => a.label ?? characterOf(a.id).name
/** What a screen reader hears for one teammate. */
export const describeActivity = (name: string, a: Activity): string => (a.inRun ? `${name}: ${STATE_WORD[a.state]}. ${a.doing}`.trim() : `${name}: ${NOT_IN_RUN}.`)

/** The teammate whose state changed last, among those doing something. The Scout when nobody is. */
export function latestActive(model: LabModel): CharacterId {
  let best: CharacterId = "scout", at = -Infinity
  for (const id of CHARACTER_IDS) {
    const a = model.characters[id]
    if (!a.inRun || a.state === "idle" || a.since === undefined) continue
    if (a.since >= at) { best = id; at = a.since }
  }
  return best
}

/** A time of day: "4:51 pm". */
export function shortTime(at: number | undefined): string {
  if (at === undefined || !Number.isFinite(at)) return ""
  const d = new Date(at), h = d.getHours()
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`
}

/** A time of day with seconds: "4:51:07 pm". Engine time, shown in the reader's time zone. */
export function clockTime(at: number | undefined): string {
  if (at === undefined || !Number.isFinite(at)) return ""
  const d = new Date(at), h = d.getHours()
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`
}

/** The rooms where the model says someone is at work now: a working or fetching teammate's own room, and the room a fetch is out to. */
export function activeRooms(model: LabModel): RoomId[] {
  const on = new Set<RoomId>()
  for (const c of CHARACTERS) {
    const a = model.characters[c.id]
    if (!a.inRun || (a.state !== "working" && a.state !== "fetching")) continue
    on.add(c.room)
    const last = a.trips.at(-1)
    if (a.state === "fetching" && last?.kind === "fetch" && last.back === undefined) on.add(last.room)
  }
  return ROOMS.map((r) => r.id).filter((id) => on.has(id))
}

