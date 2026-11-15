import { existsSync, readFileSync } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import { resolve } from "node:path"
import { ROOT, type BoardConfig } from "./config.ts"
import { listArtifacts, listRecords } from "./research/store.ts"
import type { ResearchRecord, Artifact } from "./research/types.ts"

const root = resolve(ROOT, "examples")
export interface Example {
  id: string; kind: "answer" | "board"; title: string; question?: string; thread?: string; startedAt: number
  status: string; brief?: string; rounds?: number; claims?: number
}
const read = (id: string, name: string) => readFileSync(resolve(root, id, name), "utf8")
export function exampleCsv(body: string): string {
  if (!body) return '"provenance"\r\n'
  const rows: string[] = []
  let quoted = false, start = 0
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '"') {
      if (quoted && body[i + 1] === '"') { i++; continue }
      quoted = !quoted
    }
    if (!quoted && (body[i] === "\r" || body[i] === "\n")) {
      rows.push(body.slice(start, i))
      if (body[i] === "\r" && body[i + 1] === "\n") i++
      start = i + 1
    }
  }
  if (quoted) throw new Error("Unterminated quoted CSV field")
  if (start < body.length) rows.push(body.slice(start))
  return rows.map((row, i) => `${row},"${i === 0 ? "provenance" : "Example · practice, $0"}"\r\n`).join("")
}
/**
 * The example library's list. A manifest that cannot be read (half written, a bad merge) shows no examples: it runs
 * before every /api request (handleExample), so it must never throw.
 */
export function exampleEntries(env: NodeJS.ProcessEnv = process.env, dir = root): Example[] {
  if (env.GLHF_HIDE_EXAMPLES === "1" || !existsSync(`${dir}/manifest.json`)) return []
  try {
    const list: unknown = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8"))
    if (Array.isArray(list)) return list as Example[]
    throw new Error("not a list")
  } catch (error) {
    console.error(`examples/manifest.json cannot be read, so no examples are shown: ${error instanceof Error ? error.message : String(error)}`)
    return []
  }
}
export const exampleRecord = (e: Example) => ({ ...JSON.parse(read(e.id, "record.json")) as ResearchRecord, example: true, readOnly: true, provenance: "Example · practice, $0", artifacts: existsSync(`${root}/${e.id}/artifacts.json`) ? JSON.parse(read(e.id, "artifacts.json")) as Artifact[] : [] })
export const exampleBoards = (env: NodeJS.ProcessEnv) => exampleEntries(env).filter((e) => e.kind === "board").map((e) => ({ ...e, example: true, readOnly: true, provenance: "Example · practice, $0", usd: 0 }))
export function exampleHits(query: string, env: NodeJS.ProcessEnv) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return exampleEntries(env).filter((e) => words.every((w) => `${e.title} ${e.question ?? ""} ${read(e.id, "events.jsonl")}`.toLowerCase().includes(w))).map((e) => ({ ...e, title: e.question ?? e.title, mode: "demo", example: true, matches: [] }))
}

/** Examples are served from the committed library, never from writable stores or durable sessions. */
export function handleExample(req: IncomingMessage, res: ServerResponse, url: URL, config: BoardConfig, env: NodeJS.ProcessEnv): boolean {
  const parts = url.pathname.split("/").filter(Boolean)
  const json = (code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); return true }
  const all = exampleEntries({ ...env, GLHF_HIDE_EXAMPLES: "0" })
  let id = ""
  try { id = decodeURIComponent(parts[2] ?? "") } catch { return false }
  const entry = all.find((e) => e.id === id && parts[1] === (e.kind === "answer" ? "research" : "runs"))
  if (entry) {
    if (req.method !== "GET") return json(403, { error: "Examples are read-only. They cannot be changed, deleted, resumed or replayed." })
    if (env.GLHF_HIDE_EXAMPLES === "1") return json(404, { error: "Examples are hidden." })
    if (parts[3] === "events" && parts.length === 4) {
      const after = Number(url.searchParams.get("after") ?? req.headers["last-event-id"] ?? 0)
      const events = read(entry.id, "events.jsonl").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>)
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
      events.forEach((event, i) => { const seq = Number(event.seq ?? i + 1); if (seq > after) res.write(`id: ${seq}\ndata: ${JSON.stringify({ ...event, example: true, readOnly: true })}\n\n`) })
      res.end(); return true
    }
    if (entry.kind === "answer") {
      const record = exampleRecord(entry)
      if (parts.length === 3) return json(200, record)
      if (parts[3] === "artifacts") {
        if (parts.length === 4) return json(200, { items: record.artifacts })
        let name = ""
        try { name = decodeURIComponent(parts[4] ?? "") } catch { return json(404, { error: "No such file" }) }
        const artifact = record.artifacts.find((a) => a.name === name)
        if (!artifact || parts.length !== 5 || !/^[\w.-]+$/.test(name)) return json(404, { error: "No such file" })
        const body = read(entry.id, name)
        res.writeHead(200, { "content-type": `${artifact.type}; charset=utf-8`, "content-disposition": `attachment; filename="example-${entry.id}-${name}"`, "x-content-type-options": "nosniff" })
        res.end(name.endsWith(".csv") ? exampleCsv(body) : name.endsWith(".md") ? `Example · practice, $0\n\n${body}` : name.endsWith(".json") ? JSON.stringify({ provenance: "Example · practice, $0", example: true, data: JSON.parse(body) }) : `Example · practice, $0\r\n${body}`); return true
      }
    } else if (parts.length === 3) return json(200, { ...JSON.parse(read(entry.id, "run.json")), title: entry.title, example: true, readOnly: true, provenance: "Example · practice, $0" })
    else if (parts[3] === "memo" && parts.length === 4) {
      res.writeHead(200, { "content-type": "text/markdown; charset=utf-8" }); res.end(`Example · practice, $0\n\n${read(entry.id, "memo.md")}`); return true
    }
    return json(404, { error: "No such example resource" })
  }
  if (req.method === "POST" && url.pathname === "/api/research") return false
  if (req.method !== "GET" || url.pathname !== "/api/research" || env.GLHF_HIDE_EXAMPLES === "1") return false
  const thread = url.searchParams.get("thread")
  const examples = exampleEntries(env).filter((e) => e.kind === "answer" && (!thread || e.thread === thread)).map(exampleRecord)
  if (thread && !examples.length) return false
  const saved = listRecords(config).filter((r) => !thread || r.thread === thread).map((r) => ({ ...r, artifacts: listArtifacts(config, r.id) }))
  const items = [...saved, ...examples].sort((a, b) => thread ? a.startedAt - b.startedAt : b.startedAt - a.startedAt)
  if (!thread && url.searchParams.get("all") === "1") return json(200, { items: items.map((r) => ({ id: r.id, thread: r.thread, question: r.question.slice(0, 200), status: r.status, mode: r.mode, startedAt: r.startedAt, finishedAt: r.finishedAt, usd: r.usd, ...("example" in r && { example: true, readOnly: true, provenance: "Example · practice, $0" }) })) })
  return json(200, { ...(thread ? { thread } : {}), items: items.slice(0, thread ? undefined : 50) })
}
