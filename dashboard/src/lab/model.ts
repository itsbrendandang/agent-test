// Agent Lab design by Anh Lam (https://github.com/Anhlam09/agent-lab-report): six rooms, twelve teammates.
// This file is the pure part of the dashboard's Lab: the rooms, who the teammates are, and the ACTIVITY MODEL the
// scene draws. The model is made from engine events only (adapter.ts). Nothing here invents work: a teammate that
// no event mentions stays idle at its desk.
import type { ProvenanceKind } from "@/lib/provenance"

/** The map is drawn in a 1000 x 740 box (Anh's coordinates). Everything on it is placed in these units. */
export const MAP = { width: 1000, height: 740, corridorX: 500 } as const

export type RoomId = "discovery" | "planning" | "bench" | "review" | "quality" | "report"
export interface Room { id: RoomId; name: string; x: number; y: number; accent: string }
/** Anh's six rooms, with their positions and accent colours. Each is 420 x 220 with a door on the corridor side. */
export const ROOMS: readonly Room[] = [
  { id: "discovery", name: "Discovery", x: 20, y: 20, accent: "#edb7cb" },
  { id: "planning", name: "Planning", x: 560, y: 20, accent: "#7496e8" },
  { id: "bench", name: "Experiment bench", x: 20, y: 260, accent: "#ef8262" },
  { id: "review", name: "Evidence review", x: 560, y: 260, accent: "#a99be0" },
  { id: "quality", name: "Quality control", x: 20, y: 500, accent: "#9ccc8f" },
  { id: "report", name: "Report studio", x: 560, y: 500, accent: "#f2b35e" },
]
export const roomOf = (id: RoomId): Room => ROOMS.find((r) => r.id === id)!

export type Shape = "bunny" | "tree" | "mushroom" | "flame" | "mountain" | "fuzzy" | "acorn" | "owl"
export type CharacterId =
  | "scout" | "librarian" | "proposer" | "navigator" | "experimenter" | "pilot"
  | "auditor" | "critic" | "reviser" | "guardian" | "reporter" | "finisher"
export interface Character { id: CharacterId; name: string; shape: Shape; color: string; room: RoomId; slot: 0 | 1; index: number }
/** Anh's twelve teammates: names, shapes, colours and home rooms as designed. Two desks a room; `slot` is the desk. */
export const CHARACTERS: readonly Character[] = ([
  ["scout", "Scout", "bunny", "#edb7cb", "discovery"],
  ["librarian", "Librarian", "tree", "#9ccc8f", "discovery"],
  ["proposer", "Proposer", "mushroom", "#ef9a8a", "planning"],
  ["navigator", "Navigator", "mountain", "#7496e8", "planning"],
  ["experimenter", "Experimenter", "flame", "#ef8262", "bench"],
  ["pilot", "Pilot", "flame", "#f2b35e", "bench"],
  ["auditor", "Auditor", "bunny", "#c9b5e8", "review"],
  ["critic", "Critic", "fuzzy", "#a99be0", "review"],
  ["reviser", "Reviser", "acorn", "#e3b98a", "quality"],
  ["guardian", "Guardian", "mountain", "#8aa8ee", "quality"],
  ["reporter", "Reporter", "owl", "#c3b3e6", "report"],
  ["finisher", "Finisher", "flame", "#f5a066", "report"],
] as const).map(([id, name, shape, color, room], index) => ({ id, name, shape, color, room, slot: (index % 2) as 0 | 1, index }))
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
  kind: "fetch" | "handoff"
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
}

export interface Activity {
  id: CharacterId
  /** False: no agent or step of this run is played by this teammate. It stays at its desk, marked "not in this run". */
  inRun: boolean
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
  lastFetched?: { label: string; room: RoomId; at: number }
  /** A step of its own that failed. Kept to the end of the run, also when it works again afterwards. */
  problem?: { text: string; at: number }
}

/** A method specialist that joined a team review: shown as a visitor in the room that fits, under its real name. */
export interface Visitor { id: string; name: string; title: string; why?: string; room: RoomId; state: LabState; doing: string; since?: number }

export interface LogLine { id: string; at: number; text: string; who?: string; tone?: "bad" | "good" | "warn" }

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

/** A time of day with seconds: "4:51:07 pm". Engine time, shown in the reader's time zone. */
export function clockTime(at: number | undefined): string {
  if (at === undefined || !Number.isFinite(at)) return ""
  const d = new Date(at), h = d.getHours()
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`
}
