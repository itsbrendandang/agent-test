// Where answers are kept: board/runs/.research/<id>/ with
//   events.jsonl    append-only; what the stream replays (every line has seq, at, run, type)
//   record.json     the whole answer, rewritten after every step
//   artifacts.json  the registry of the result files of a finished answer; only files named there are ever served
//   answer.md, sources.json, sources.csv   the result files
// Ids are made here and checked before any path is built.
import { randomBytes } from "node:crypto"
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import type { BoardConfig } from "../config.ts"
import { isSafeId } from "../http.ts"
import { dayStamp, researchRoot, staleAfterMs } from "./spend.ts"
import type { Artifact, ResearchEvent, ResearchRecord, Stamped } from "./types.ts"

const two = (n: number) => String(n).padStart(2, "0")
export const newAnswerId = (now = new Date()): string => `a-${dayStamp(now)}${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}-${randomBytes(4).toString("hex")}`
export const newThreadId = (): string => `t-${randomBytes(5).toString("hex")}`
export const isAnswerId = (id: unknown): id is string => isSafeId(id) && /^a-\d{14}-[0-9a-f]{8}$/.test(id)
export const isThreadId = (id: unknown): id is string => isSafeId(id) && /^t-[0-9a-f]{10}$/.test(id)

export const answerDir = (config: BoardConfig, id: string): string => `${researchRoot(config)}/${id}`
export const eventsFile = (config: BoardConfig, id: string): string => `${answerDir(config, id)}/events.jsonl`

function writeWhole(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, file)
}

/** Write the record in one step (a temp file, then a rename), so a reader never sees half a file. */
export function saveRecord(config: BoardConfig, record: ResearchRecord): void {
  mkdirSync(answerDir(config, record.id), { recursive: true })
  writeWhole(`${answerDir(config, record.id)}/record.json`, JSON.stringify(record, null, 1))
}

/** How long a queued answer may wait before it is taken for lost: every answer before it in its thread, plus a minute. */
export const queuedStaleAfterMs = (maxSeconds: number): number => (maxSeconds * 4 + 60) * 1000

/**
 * The record, or undefined when there is none or it cannot be read. A record left "running" long past its time limit,
 * or "queued" long past any wait, is given back as failed: the engine stopped while it worked. (Nothing is written
 * here: another engine process on the same folder may still be working on it.)
 */
export function loadRecord(config: BoardConfig, id: string, now = Date.now()): ResearchRecord | undefined {
  if (!isAnswerId(id)) return undefined
  let record: ResearchRecord
  try { record = JSON.parse(readFileSync(`${answerDir(config, id)}/record.json`, "utf8")) as ResearchRecord } catch { return undefined }
  if (!record || typeof record !== "object" || record.id !== id) return undefined
  const limit = record.caps?.maxSeconds ?? 120
  if (record.status === "running" && now - (record.workStartedAt ?? record.startedAt) >= staleAfterMs(limit))
    return { ...record, status: "failed", steps: (record.steps ?? []).map((s) => (s.status === "running" ? { ...s, status: "failed" as const, error: "The engine stopped during this step." } : s)), error: "The engine stopped before this answer was finished. Ask the question again." }
  if (record.status === "queued" && now - record.startedAt >= queuedStaleAfterMs(limit))
    return { ...record, status: "failed", error: "The engine stopped before this queued question was started. Ask it again." }
  return record
}

/** Every saved answer, newest first. Unreadable folders are skipped. */
export function listRecords(config: BoardConfig, now = Date.now()): ResearchRecord[] {
  const root = researchRoot(config)
  if (!existsSync(root)) return []
  return readdirSync(root).filter(isAnswerId).sort().reverse().flatMap((id) => { const r = loadRecord(config, id, now); return r ? [r] : [] })
}

/** The answers of one thread, oldest first. */
export const threadRecords = (config: BoardConfig, thread: string, now = Date.now()): ResearchRecord[] =>
  listRecords(config, now).filter((r) => r.thread === thread).sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))

export interface ThreadLine { thread: string; title: string; updatedAt: number; answers: number; status: ResearchRecord["status"] }

/** One line per thread for a sidebar, newest first: the first question as the title, the latest answer's status. */
export function threadLines(config: BoardConfig, now = Date.now()): ThreadLine[] {
  const byThread = new Map<string, ResearchRecord[]>()
  for (const r of listRecords(config, now)) byThread.set(r.thread, [...(byThread.get(r.thread) ?? []), r])
  return [...byThread].map(([thread, list]) => {
    const ordered = list.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
    const latest = ordered.at(-1) as ResearchRecord
    return { thread, title: ordered[0].question.replace(/\s+/g, " ").slice(0, 120), updatedAt: Math.max(...ordered.map((r) => r.finishedAt ?? r.workStartedAt ?? r.startedAt)), answers: ordered.length, status: latest.status }
  }).sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * The event log of one answer. Each event gets `seq` (1, 2, 3, ...), `at`, `run` and a `key`, and is appended as one
 * line. The key names what the event is about ("step.finished:write", "statement:draft:2"). An event whose key is
 * already in the log is NOT written again: `emit` gives back the stored line. That is what lets an answer be worked
 * through a second time after a restart without one duplicate event, with `seq` going on from where it was.
 */
export class ResearchLog {
  readonly file: string
  readonly run: string
  private seq = 0
  private readonly byKey = new Map<string, Stamped>()
  constructor(config: BoardConfig, id: string) {
    mkdirSync(answerDir(config, id), { recursive: true })
    this.file = eventsFile(config, id)
    this.run = id
    for (const event of ResearchLog.read(this.file)) { this.seq = Math.max(this.seq, event.seq); if (typeof event.key === "string") this.byKey.set(event.key, event) }
  }
  /** The last seq written (0 for an empty log). */
  get lastSeq(): number { return this.seq }
  has(key: string): boolean { return this.byKey.has(key) }
  /** The steps the log shows as started and not finished. */
  openSteps(): string[] {
    return [...this.byKey.keys()].filter((key) => key.startsWith("step.started:") && !this.byKey.has(`step.finished:${key.slice("step.started:".length)}`)).map((key) => key.slice("step.started:".length))
  }
  /** When the event with this key was written, if it was. */
  at(key: string): number | undefined { return this.byKey.get(key)?.at }
  emit(key: string, event: ResearchEvent): Stamped {
    const stored = this.byKey.get(key)
    if (stored) return stored
    const stamped = { seq: ++this.seq, at: Date.now(), run: this.run, key, ...event } as Stamped
    appendFileSync(this.file, JSON.stringify(stamped) + "\n")
    this.byKey.set(key, stamped)
    return stamped
  }
  static read(file: string): Stamped[] {
    if (!existsSync(file)) return []
    return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line) as Stamped] } catch { return [] } })
  }
}

// ── Result files ─────────────────────────────────────────────────────────────────────────────────

/** The only names a result file may have, and what each is. */
export const ARTIFACT_TYPES: Record<string, string> = { "answer.md": "text/markdown", "sources.json": "application/json", "sources.csv": "text/csv", "record.json": "application/json" }
export const MAX_ARTIFACT_BYTES = 5_000_000

const csvCell = (value: unknown) => { const s = String(value ?? "").replace(/\s+/g, " "); const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; return `"${safe.replaceAll('"', '""')}"` } // a leading = + - @ would run as a formula in a spreadsheet

/** The answer as a Markdown file: the question, the final text, and the numbered sources with their marks. */
export function answerFile(record: ResearchRecord): string {
  const mark = (n: number) => { const s = record.statements.filter((x) => x.sources.includes(n)); return s.length ? ` (cited by ${s.length} sentence${s.length === 1 ? "" : "s"}; ${s.filter((x) => x.verdict === "verified").length} passed the check)` : record.sources[n - 1]?.cited ? "" : " (not cited)" }
  return [
    `# ${record.question.replace(/\s+/g, " ")}`, "",
    record.mode === "demo" ? "> DEMO ANSWER. Fixed example text and example sources. Not research.\n" : "",
    record.answer?.markdown ?? record.draft ?? "(No answer was written.)", "",
    ...(record.missing?.length ? ["## What is missing", "", ...record.missing.map((m) => `- ${m.replace(/\s+/g, " ")}`), ""] : []),
    "## Sources", "",
    ...(record.sources.length ? record.sources.map((s) => `${s.n}. ${s.title.replace(/\s+/g, " ")}${s.note ? ` [${s.note}]` : ""}. ${s.url}${mark(s.n)}`) : ["None."]), "",
    "---",
    `Research summary written by a model from abstracts and excerpts, not full papers. A sentence "passed the check" when a model from another vendor quoted a passage and a program found that passage, with the sentence's numbers, in the cited source. That does not prove the sentence is true. ${record.note ?? ""}`.trim(),
    `Answer ${record.id}, ${record.mode} mode, ${new Date(record.startedAt).toISOString()}.`, "",
  ].join("\n")
}

/**
 * Write the result files of a finished answer and register them. Returns the registry: record.json (already written by
 * saveRecord) and the three files written here. Call after the record's last change.
 */
export function writeArtifacts(config: BoardConfig, record: ResearchRecord, now = Date.now()): Artifact[] {
  const dir = answerDir(config, record.id)
  const sources = record.sources.map(({ n, url, title, provider, note, cited, text }) => ({ n, url, title, provider, ...(note ? { note } : {}), cited: cited === true, text }))
  writeWhole(`${dir}/answer.md`, answerFile(record))
  writeWhole(`${dir}/sources.json`, JSON.stringify({ answer: record.id, question: record.question, mode: record.mode, sources }, null, 1))
  writeWhole(`${dir}/sources.csv`, [["n", "title", "url", "provider", "note", "cited"].map(csvCell).join(","), ...sources.map((s) => [s.n, s.title, s.url, s.provider, s.note ?? "", s.cited ? "yes" : "no"].map(csvCell).join(","))].join("\n") + "\n")
  const artifacts = Object.keys(ARTIFACT_TYPES).flatMap((name): Artifact[] => {
    try { const stat = lstatSync(`${dir}/${name}`); return stat.isFile() ? [{ id: `${record.id}/${name}`, name, type: ARTIFACT_TYPES[name], bytes: stat.size, at: now }] : [] } catch { return [] }
  })
  writeWhole(`${dir}/artifacts.json`, JSON.stringify(artifacts, null, 1))
  return artifacts
}

/** The registered result files of an answer (empty until it is saved). */
export function listArtifacts(config: BoardConfig, id: string): Artifact[] {
  if (!isAnswerId(id)) return []
  try {
    const list = JSON.parse(readFileSync(`${answerDir(config, id)}/artifacts.json`, "utf8")) as Artifact[]
    return Array.isArray(list) ? list.filter((a) => a && typeof a.name === "string" && a.name in ARTIFACT_TYPES) : []
  } catch { return [] }
}

/**
 * A registered result file, ready to send, or why not. The name must be in the answer's registry AND on the fixed
 * list; the path is built from those two checked parts only; the file must be a regular file (lstat: a symbolic
 * link is refused) and no larger than MAX_ARTIFACT_BYTES.
 */
export function readArtifact(config: BoardConfig, id: string, name: string): { ok: true; body: Buffer; type: string; name: string } | { ok: false; status: number; error: string } {
  if (!isAnswerId(id)) return { ok: false, status: 404, error: "no such answer" }
  if (!Object.hasOwn(ARTIFACT_TYPES, name) || !listArtifacts(config, id).some((a) => a.name === name)) return { ok: false, status: 404, error: "no such file is registered for this answer" }
  const file = `${answerDir(config, id)}/${name}`
  let stat
  try { stat = lstatSync(file) } catch { return { ok: false, status: 404, error: "the file is gone" } }
  if (!stat.isFile()) return { ok: false, status: 403, error: "this is not a regular file, so it is not served" }
  if (stat.size > MAX_ARTIFACT_BYTES) return { ok: false, status: 413, error: "the file is larger than this app serves" }
  return { ok: true, body: readFileSync(file), type: ARTIFACT_TYPES[name], name }
}

// ── Saved research: the hits GET /api/search adds for answers ────────────────────────────────────

export interface AnswerHit {
  kind: "answer"; id: string; title: string; status: string; startedAt: number; mode: "real" | "demo"; thread: string
  matches: { where: string; text: string }[]
}

function snippet(text: string, word: string): string {
  const at = text.toLowerCase().indexOf(word)
  const from = Math.max(0, at - 60)
  const cut = text.slice(from, at + word.length + 90).replace(/\s+/g, " ").trim()
  return (from > 0 ? "…" : "") + cut + (at + word.length + 90 < text.length ? "…" : "")
}

/** Answers in which every word of the query appears (question, answer text, source titles). An empty query lists all. The rule of search.ts. */
export function answerHits(config: BoardConfig, query: string, now = Date.now()): AnswerHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)
  const hits: AnswerHit[] = []
  for (const r of listRecords(config, now)) {
    const fields = [
      { where: "question", text: `${r.question} research answer ${r.mode} ${r.effort}` },
      { where: "answer", text: r.answer?.markdown ?? r.draft ?? "" },
      { where: "sources", text: (r.sources ?? []).map((s) => `${s.title} ${s.url}`).join(" · ") },
      { where: "error", text: r.error ?? "" },
    ]
    const lower = fields.map((f) => f.text.toLowerCase())
    if (!words.every((w) => lower.some((t) => t.includes(w)))) continue
    const matches: AnswerHit["matches"] = []
    for (const w of words) {
      const i = lower.findIndex((t) => t.includes(w))
      if (!matches.some((m) => m.where === fields[i].where)) matches.push({ where: fields[i].where, text: snippet(fields[i].text, w) })
    }
    hits.push({ kind: "answer", id: r.id, title: r.question.slice(0, 200), status: r.status, startedAt: r.startedAt, mode: r.mode, thread: r.thread, matches: matches.slice(0, 3) })
  }
  return hits
}
