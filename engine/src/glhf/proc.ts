// Process identity. A pid alone is not enough to say "that process is still running": after a reboot or a
// long wait the number is reused. So every pid we store goes with the process's start time, and a process
// counts as ours only when both match.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

/** When the process started, as an opaque string that is stable for its lifetime. "" when it cannot be read. */
export function startTime(pid: number): string {
  if (!Number.isInteger(pid) || pid <= 0) return ""
  try { // Linux: field 22 of /proc/<pid>/stat, counted after the command name (which may hold spaces)
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
    const ticks = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]
    if (ticks) return `ticks:${ticks}`
  } catch { /* not Linux, or the process is gone */ }
  try {
    const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" }, stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 }).trim()
    return out ? `ps:${out}` : ""
  } catch { return "" }
}

const exists = (pid: number) => { try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM" } }

/** "<pid> <start time>", the form stored in pid and lock files. */
export const stamp = (pid: number) => `${pid} ${startTime(pid)}`.trim()

export function parseStamp(text: string | null | undefined): { pid: number; start: string } | undefined {
  const [first, ...rest] = (text ?? "").trim().split(" ")
  const pid = Number(first)
  return Number.isInteger(pid) && pid > 0 ? { pid, start: rest.join(" ") } : undefined
}

/**
 * Is the process that wrote this stamp still running? A stamp without a start time (written by an older
 * version, or where the start time could not be read) falls back to the pid alone.
 */
export function alive(text: string | null | undefined): boolean {
  const s = parseStamp(text)
  if (!s || !exists(s.pid)) return false
  if (!s.start) return true
  const now = startTime(s.pid)
  return now === "" || now === s.start
}
