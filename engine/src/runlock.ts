// A lock file that names its holder as "<pid> <start time>" (see glhf/proc.ts), so a pid that the system
// gave to another program later does not keep the lock. Used for board runs: one process per run.
//
// Who counts as holding a lock:
// - another process whose pid and start time both match the file: yes.
// - this process, when it took the lock through take() and has not released it: yes.
// - this process's pid in the file when this process did not take it: no. That is a lock left by an earlier
//   process that had the same pid. In a container the engine is pid 1 on every start, so this is the usual
//   case after a crash or `docker compose down`.
// - a file with a pid and no start time (written by an older version) naming pid 1 or this pid: no.
//
// Limit: pids are only meaningful inside one pid namespace. A CLI on the host and an engine in a container
// that share the run folder cannot see each other's processes, so this lock does not keep those two apart.
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { alive, parseStamp, stamp } from "./glhf/proc.ts"

const held = new Set<string>() // lock files this process holds
let hooked = false

const read = (file: string) => { try { return readFileSync(file, "utf8") } catch { return null } }

/** The pid of the live process that holds `file`, or undefined when nobody does. */
export function holder(file: string): number | undefined {
  const text = read(file)
  const s = parseStamp(text)
  if (!s) return undefined
  if (s.pid === process.pid) return held.has(file) ? s.pid : undefined
  if (!s.start && s.pid === 1) return undefined // an old-format lock from a container's engine
  return alive(text) ? s.pid : undefined
}

function releaseAll() {
  for (const file of held) { try { if (parseStamp(read(file))?.pid === process.pid) rmSync(file, { force: true }) } catch { /* best effort */ } }
  held.clear()
}

// Locks are removed when the process ends normally or is asked to stop. (After kill -9 or a power cut the
// file stays; holder() then sees a dead or different process and the next take() replaces it.)
function hook() {
  if (hooked) return
  hooked = true
  process.on("exit", releaseAll)
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.once(signal, () => {
      releaseAll()
      // Our handler replaced the default action. If nothing else handles the signal, end the way it would have.
      if (process.listenerCount(signal) === 0) process.kill(process.pid, signal)
    })
  }
}

const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/**
 * Take the lock. Returns the function that releases it, or the pid of the live process that holds it.
 * A lock left by a dead process is replaced under a second, short-lived ".takeover" file, so two processes
 * that both find it stale cannot both end up holding it.
 */
export function take(file: string): (() => void) | { busy: number } {
  const me = stamp(process.pid)
  const mine = () => {
    held.add(file)
    hook()
    return () => {
      if (!held.delete(file)) return
      try { if (parseStamp(read(file))?.pid === process.pid) rmSync(file, { force: true }) } catch { /* already gone */ }
    }
  }
  const create = () => { try { writeFileSync(file, me, { flag: "wx" }); return true } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; return false } }
  if (held.has(file)) return { busy: process.pid }
  if (create()) return mine()
  const takeover = `${file}.takeover`
  for (let attempt = 0; attempt < 50; attempt++) {
    const busy = holder(file)
    if (busy !== undefined) return { busy }
    try { writeFileSync(takeover, me, { flag: "wx" }) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      // Another process is replacing the stale lock right now. If it died doing so, clear its marker.
      const age = Date.now() - (statSync(takeover, { throwIfNoEntry: false })?.mtimeMs ?? Date.now())
      const other = parseStamp(read(takeover))
      if (age > 10_000 || !other || other.pid === process.pid || !alive(read(takeover))) rmSync(takeover, { force: true })
      pause(20)
      continue
    }
    try {
      const now = holder(file) // look again: it may have changed hands while we were getting here
      if (now !== undefined) return { busy: now }
      rmSync(file, { force: true })
      if (create()) return mine()
    } finally { rmSync(takeover, { force: true }) }
  }
  throw new Error(`could not take ${file}`)
}
