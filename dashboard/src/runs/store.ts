import { useEffect, useState } from "react"

// One finished agent run or test. Agents will call recordRun() once they are connected.
export interface Run {
  id: string
  at: number // finished at, ms since epoch
  ok: boolean // passed or failed
  model: string // the AI model that did the run
  test?: string // what was run
  score?: number // evaluation score from 0 to 1, if the test gives one
  sample?: boolean // made-up preview data, never a real run
}

const KEY = "simlab.runs.v1"
const MAX = 5000

function load(): Run[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Run[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
const store = (runs: Run[]) => {
  localStorage.setItem(KEY, JSON.stringify(runs.slice(-MAX)))
  window.dispatchEvent(new StorageEvent("storage", { key: KEY }))
}

export function recordRun(run: Omit<Run, "id" | "at"> & { at?: number }) {
  store([...load(), { ...run, id: crypto.randomUUID(), at: run.at ?? Date.now() }])
}

// Made-up runs for previewing the home page. Always flagged as sample and removable in one click.
export function loadSampleRuns() {
  const models = [["Model A", 0.86], ["Model B", 0.71], ["Model C", 0.55]] as const
  const tests = ["literature-search", "reproduce-figure", "unit-tests", "data-cleaning"]
  const day = 86_400_000
  const runs: Run[] = []
  let seed = 7
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  for (let d = 181; d >= 0; d--) {
    const n = rnd() < 0.3 ? 0 : Math.floor(rnd() * rnd() * 9)
    for (let i = 0; i < n; i++) {
      const [model, rate] = models[Math.floor(rnd() * models.length)]
      const ok = rnd() < rate
      runs.push({
        id: `sample-${d}-${i}`, at: Date.now() - d * day - Math.floor(rnd() * day * 0.5), ok, model,
        test: tests[Math.floor(rnd() * tests.length)], score: Math.min(1, Math.max(0, rate + (rnd() - 0.5) * 0.3)), sample: true,
      })
    }
  }
  store([...load().filter((r) => !r.sample), ...runs].sort((a, b) => a.at - b.at))
}
export const clearSampleRuns = () => store(load().filter((r) => !r.sample))

export function useRuns() {
  const [runs, setRuns] = useState(load)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setRuns(load()) }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])
  return runs
}

const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` }

export interface DayCell { date: Date; count: number; ok: number; future: boolean }

// Weeks (Sunday first) ending with the current week, like a GitHub activity graph.
export function activityWeeks(runs: Run[], weeks = 26): DayCell[][] {
  const byDay = new Map<string, { count: number; ok: number }>()
  for (const r of runs) {
    const k = dayKey(r.at)
    const c = byDay.get(k) ?? { count: 0, ok: 0 }
    c.count++
    if (r.ok) c.ok++
    byDay.set(k, c)
  }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(today.getDate() - today.getDay() - (weeks - 1) * 7)
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = new Date(start)
      date.setDate(start.getDate() + w * 7 + d)
      const c = byDay.get(dayKey(date.getTime()))
      return { date, count: c?.count ?? 0, ok: c?.ok ?? 0, future: date > today }
    }),
  )
}

export interface ModelRow { model: string; runs: number; passed: number; rate: number; score?: number }

export function byModel(runs: Run[]): ModelRow[] {
  const map = new Map<string, { runs: number; passed: number; scores: number[] }>()
  for (const r of runs) {
    const m = map.get(r.model) ?? { runs: 0, passed: 0, scores: [] }
    m.runs++
    if (r.ok) m.passed++
    if (r.score !== undefined) m.scores.push(r.score)
    map.set(r.model, m)
  }
  return [...map].map(([model, m]) => ({
    model, runs: m.runs, passed: m.passed, rate: m.passed / m.runs,
    score: m.scores.length ? m.scores.reduce((a, b) => a + b, 0) / m.scores.length : undefined,
  })).sort((a, b) => b.rate - a.rate || b.runs - a.runs)
}
