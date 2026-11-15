export const fmtMetric = (v: number | undefined) =>
  v === undefined ? "—" : Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2)

// One way to write each kind of number, used by every view.
/** A grader score: three decimals. */
export const fmtScore = (x: number | undefined) => (x === undefined || Number.isNaN(x) ? "–" : x.toFixed(3))
/** A token count: whole number with thousands separators. */
export const fmtTokens = (n: number | undefined) => (n === undefined || Number.isNaN(n) ? "–" : Math.round(n).toLocaleString("en-US"))
/** A duration as m:ss, or h:mm:ss from one hour up. */
export function fmtDuration(ms: number | undefined): string {
  if (ms === undefined || Number.isNaN(ms) || ms < 0) return "–"
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60
  const ss = String(s).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

/** Does this text have every word of the filter? Case does not matter. An empty filter matches everything. */
export const hasWords = (text: string, filter: string): boolean => {
  const hay = text.toLowerCase()
  return filter.toLowerCase().split(/\s+/).filter(Boolean).every((word) => hay.includes(word))
}

// ---- numbers the way a person says them
const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
/** "9 seconds", "2 minutes", "1 minute 30 seconds", "1 hour 5 minutes". */
export function plainDuration(ms: number | undefined): string {
  if (ms === undefined || Number.isNaN(ms) || ms < 0) return "an unknown time"
  const total = Math.round(ms / 1000)
  if (total < 1) return "less than a second"
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60
  if (h) return m ? `${unit(h, "hour")} ${unit(m, "minute")}` : unit(h, "hour")
  if (m) return s && m < 10 ? `${unit(m, "minute")} ${unit(s, "second")}` : unit(m, "minute")
  return unit(s, "second")
}
/** "30-minute limit", "24-hour limit", "90-second limit". */
export function plainLimit(seconds: number | undefined): string {
  if (seconds === undefined || Number.isNaN(seconds)) return "no time limit recorded"
  if (seconds % 3600 === 0) return `${seconds / 3600}-hour limit`
  if (seconds % 60 === 0) return `${seconds / 60}-minute limit`
  return `${seconds}-second limit`
}
/** "cost nothing (practice run)", "cost nothing", "cost $1.25", "cost less than 1 cent". */
export function plainCost(usd: number | undefined, practice?: boolean): string {
  if (practice) return "cost nothing (practice run)"
  if (usd === undefined || Number.isNaN(usd)) return "cost not recorded"
  if (usd === 0) return "cost nothing"
  return usd < 0.01 ? "cost less than 1 cent" : `cost $${usd.toFixed(2)}`
}
/** "today at 4:51 pm", "yesterday at 9:05 am", "12 Nov at 4:51 pm", "12 Nov 2025 at 4:51 pm". */
export function plainWhen(at: number | string | undefined, now: Date = new Date()): string {
  const d = new Date(at ?? NaN)
  if (Number.isNaN(d.getTime())) return "at an unknown time"
  const h = d.getHours(), time = `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day(now) - day(d)) / 86_400_000)
  const date = days === 0 ? "today" : days === 1 ? "yesterday"
    : `${d.getDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]}${d.getFullYear() === now.getFullYear() ? "" : ` ${d.getFullYear()}`}`
  return `${date} at ${time}`
}
/** A file name or an id as a title a person can read: "kras-g12c-hit-to-lead.md" -> "Kras g12c hit to lead". */
export const plainTitle = (name: string): string => {
  const t = name.replace(/\.md$/, "").replace(/^\d{8,}-/, "").replace(/-[0-9a-f]{8}$/, "").replace(/^chat-/, "").replace(/[-_]+/g, " ").trim()
  return t ? t[0].toUpperCase() + t.slice(1) : name
}

/**
 * A run's title as a person would say it. The engine titles a review "Drug board · <brief>" and a task run
 * "Task <task> · <swarm|single> · <model>"; this says the same without the internal words.
 */
export function runTitle(title: string): string {
  const task = /^Task (.+?) · (swarm|glhf|single)(?: · (.+))?$/i.exec(title)
  if (task) return `${/single/i.test(task[2]) ? "One agent alone" : "Team of nine"} on ${task[1] === "demo" ? "the demo task" : `task ${task[1]}`}${task[3] && task[3] !== "mock" ? ` (${task[3]})` : ""}`
  return plainTitle(title.replace(/^Drug board · /i, ""))
}
