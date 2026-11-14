// GET /api/search?q=...  One search over every experiment: swarm runs and drug board runs.
// Every word in the query must appear somewhere in the run (case-insensitive). An empty query lists all.
import { existsSync, readFileSync } from "node:fs"
import { runDir as boardDir } from "./board.ts"
import { loadConfig } from "./config.ts"
import { listRuns as swarmRuns, runDetail } from "./glhf/store.ts"

export interface Hit {
  kind: "swarm" | "board"
  id: string
  title: string
  status: string
  startedAt: number
  score?: number
  /** Up to three places the query was found: where, and the text around it. */
  matches: { where: string; text: string }[]
}

type Field = { where: string; text: string }

const read = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : "")

function snippet(text: string, word: string): string {
  const at = text.toLowerCase().indexOf(word)
  const from = Math.max(0, at - 60)
  const cut = text.slice(from, at + word.length + 90).replace(/\s+/g, " ").trim()
  return (from > 0 ? "…" : "") + cut + (at + word.length + 90 < text.length ? "…" : "")
}

function match(fields: Field[], words: string[]): Hit["matches"] | undefined {
  const all = fields.map((f) => f.text.toLowerCase())
  if (!words.every((w) => all.some((t) => t.includes(w)))) return undefined
  const found: Hit["matches"] = []
  for (const w of words) {
    const i = all.findIndex((t) => t.includes(w))
    if (!found.some((m) => m.where === fields[i].where)) found.push({ where: fields[i].where, text: snippet(fields[i].text, w) })
  }
  return found.slice(0, 3)
}

export interface BoardRun { id: string; brief?: string; status: string; startedAt: number }

export function search(query: string, boardRuns: BoardRun[]): Hit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)
  const hits: Hit[] = []

  for (const run of swarmRuns()) {
    const fields: Field[] = [
      { where: "run", text: `${run.id} task ${run.task} ${run.solver === "glhf" ? "swarm glhf" : "single agent"} ${run.model} ${run.mode} ${run.phase} ${Object.values(run.roleModels ?? {}).join(" ")}` },
      { where: "error", text: run.error ?? "" },
      { where: "outputs", text: (run.artifacts ?? []).map((a) => a.artifact_id).join(" ") },
    ]
    if (words.length) {
      const detail = runDetail(run.id)
      const ledger = detail?.ledger as { claims?: { id: string; text: string; verdict: string }[]; issues?: { id: string; problem: string; resolution: string; status: string }[] } | null
      for (const c of ledger?.claims ?? []) fields.push({ where: `claim ${c.id} (${c.verdict})`, text: `${c.text} ${c.verdict}` })
      for (const i of ledger?.issues ?? []) fields.push({ where: `problem ${i.id} (${i.status})`, text: `${i.problem} ${i.resolution}` })
      fields.push({ where: "findings", text: detail?.findings ?? "" }, { where: "methods", text: detail?.methods ?? "" })
    }
    const matches = match(fields, words)
    if (matches) hits.push({
      kind: "swarm", id: run.id, status: run.phase, startedAt: run.startedAt, score: run.score, matches,
      title: `Task ${run.task} · ${run.solver === "glhf" ? "swarm" : "single agent"} · ${run.model}`,
    })
  }

  const config = loadConfig()
  for (const run of boardRuns) {
    const dir = boardDir(config, run.id)
    const fields: Field[] = [{ where: "run", text: `${run.id} ${run.brief ?? ""} drug board ${run.status}` }]
    if (words.length) {
      fields.push({ where: "memo", text: read(`${dir}/memo.md`) })
      try {
        const ledger = JSON.parse(read(`${dir}/verification_ledger.json`) || "[]") as { claim?: string; verdict?: string; member?: string }[]
        for (const e of Array.isArray(ledger) ? ledger : []) fields.push({ where: `claim (${e.verdict ?? "unchecked"})`, text: `${e.claim ?? ""} ${e.member ?? ""} ${e.verdict ?? ""}` })
      } catch { /* an unreadable ledger just is not searched */ }
    }
    const matches = match(fields, words)
    if (matches) hits.push({ kind: "board", id: run.id, status: run.status, startedAt: run.startedAt, matches, title: `Drug board · ${(run.brief ?? run.id).replace(/\.md$/, "")}` })
  }
  return hits.sort((a, b) => b.startedAt - a.startedAt)
}
