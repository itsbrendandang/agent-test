// Agent Lab design by Anh Lam. Which run the Lab shows. Pure: the three lists the engine serves in, one list of
// runs out, newest first, and the choice: the run in progress if there is one, else the newest finished run (which
// the view offers as a replay).
import { logOfHash } from "@/lib/links"
import { provenanceOf } from "@/lib/provenance"
import { clip, type Provenance, type RunKind } from "./model"

export interface RunRef {
  kind: RunKind
  id: string
  /** The question or the brief, as the record has it. Untrusted text. */
  title: string
  startedAt: number
  /** Still going (or waiting to start). */
  live: boolean
  /** How it ended, or that it has not: in plain words. */
  status: string
  /** From the record itself. Undefined when the list does not say (a team review says it in its first event). */
  provenance?: Provenance
}

type Rec = Record<string, unknown>
const str = (v: unknown) => (typeof v === "string" ? v : undefined)
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)
const list = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter((x): x is Rec => !!x && typeof x === "object") : [])
const briefTitle = (brief: string) => { const t = brief.replace(/\.md$/, "").replace(/^chat-/, "").replace(/-[0-9a-f]{8}$/, "").replace(/[-_]+/g, " ").trim(); return t ? t[0].toUpperCase() + t.slice(1) : brief }

/** GET /api/runs: team reviews. */
export const boardRuns = (reply: unknown): RunRef[] => list(reply).flatMap((r) => {
  const id = str(r.id); if (!id) return []
  const status = str(r.status) ?? ""
  return [{ kind: "board" as const, id, title: briefTitle(str(r.brief) ?? id), startedAt: num(r.startedAt), live: status === "running", status: status === "running" ? "in progress" : status === "failed" ? "failed" : status === "paused" ? "paused" : "finished", provenance: r.example === true ? "example" as const : undefined }]
})
/** GET /api/research: research answers ({items: [...]}). */
export const answerRuns = (reply: unknown): RunRef[] => list((reply as Rec | undefined)?.items ?? reply).flatMap((r) => {
  const id = str(r.id); if (!id) return []
  const status = str(r.status) ?? ""
  return [{ kind: "answer" as const, id, title: clip(str(r.question) ?? id, 140), startedAt: num(r.startedAt), live: status === "running" || status === "queued", status: status === "running" ? "in progress" : status === "queued" ? "waiting" : status === "failed" ? "failed" : status === "cancelled" ? "cancelled" : "finished", provenance: provenanceOf({ mode: r.mode, example: r.example }) }]
})
/** GET /api/glhf/runs: swarm and single-agent runs. */
export const swarmRuns = (reply: unknown): RunRef[] => list(reply).flatMap((r) => {
  const id = str(r.id); if (!id) return []
  const phase = str(r.phase) ?? ""
  const settled = phase === "done" || phase === "failed" || phase === "cancelled"
  return [{
    kind: "swarm" as const, id, title: `${r.solver === "single" ? "One agent alone" : "Team of nine"} on ${r.task === "demo" ? "the demo task" : `task ${clip(str(r.task) ?? "?", 60)}`}`, startedAt: num(r.startedAt), live: !settled,
    status: phase === "done" ? "finished" : phase === "failed" ? "failed" : phase === "cancelled" ? "cancelled" : phase === "queued" ? "waiting" : "in progress",
    provenance: r.modelClass === "scripted" ? "practice" : r.modelClass === "local" ? "local" : provenanceOf({ model: r.model }),
  }]
})

/** One list, newest first. */
export const mergeRuns = (...lists: RunRef[][]): RunRef[] => lists.flat().sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id))
/** The run to show when none was chosen: the newest one in progress, else the newest of all. */
export const pickRun = (runs: readonly RunRef[]): RunRef | undefined => runs.find((r) => r.live) ?? runs[0]

/** "#Lab/<kind>/<run id>": the run an address names (lib/links.ts reads it). Only the characters a run id can have are accepted. */
export function runOfLabHash(hash: string): { kind: RunKind; id: string } | undefined {
  const named = logOfHash(hash)
  return named?.kind && named.id ? { kind: named.kind, id: named.id } : undefined
}
export const labHash = (kind: RunKind, id: string) => `#Lab/${kind}/${encodeURIComponent(id)}`
