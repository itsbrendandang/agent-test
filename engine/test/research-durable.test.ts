// A research answer is a durable task (Pi Durable): an engine that stops or dies in the middle loses nothing, the answer
// continues at the next start, and no finished step is paid for twice. Here the engine is "killed" at every point
// between two steps and in the middle of a call, with fakes only (test/fixtures/research/harness.ts), and what was
// bought is counted. `research.kill()` stops the work dead at that instant (nothing more is stored or written), as a
// killed process does; `research.resume()` is what the engine calls when it starts.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

process.env.NO_PAID_CALLS = "1"
const { DEFAULTS, engine, paidAllowed } = await import("./fixtures/research/harness.ts")
import type { Role } from "./fixtures/research/harness.ts"
import type { ResearchRecord, Stamped } from "../src/research/types.ts"

const Q = "Does semaglutide lower the risk of heart attack and stroke in people with obesity who do not have diabetes?"
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const until = async (ok: () => boolean | Promise<boolean>, what: string) => { for (let i = 0; i < 500; i++) { if (await ok()) return; await sleep(10) } throw new Error(`timed out waiting for ${what}`) }
const ROLES: Role[] = ["plan", "screen", "write", "check", "critic", "revise", "rejudge"]
/** The role (or the search) a stored step belongs to, from its key "<answer>:<step>:<hash>". */
const kindOf = (key: string) => { const step = key.split(":").slice(1, -1).join(":"); return step.startsWith("search:") ? step : step.startsWith("screen") ? "screen" : step.startsWith("check") ? "check" : step }
const tally = (keys: string[]) => keys.reduce<Record<string, number>>((all, key) => ({ ...all, [kindOf(key)]: (all[kindOf(key)] ?? 0) + 1 }), {})
type E = Awaited<ReturnType<typeof engine>>
const bought = (e: E) => ({ ...Object.fromEntries(ROLES.map((r) => [r, e.count(r)])), "search:exa": e.exaRequests().length, "search:europepmc": e.pmcRequests().length }) as Record<string, number>
/** What must be the same in an answer that was interrupted and one that was not. */
const same = (r: ResearchRecord) => ({
  status: r.status, question: r.question, opening: r.opening, searches: r.searches, sources: r.sources.map(({ text: _t, ...s }) => s), selection: r.selection, draft: r.draft, answer: r.answer,
  statements: r.statements, review: r.review, recommendations: r.recommendations, missing: r.missing, counts: r.counts, usd: r.usd, note: r.note, stopped: r.stopped,
  steps: Object.fromEntries(r.steps.map((s) => [s.step, [s.kind, s.status, s.found, s.kept, s.summary]])),
})
const shapeOf = (events: Stamped[]) => events.filter((e) => e.type !== "research.resumed" && e.type !== "answer.delta").map((e) => e.key).sort()
const checkLog = (events: Stamped[], resumes: number, what: string) => {
  assert.deepEqual(events.map((e) => e.seq), events.map((_e, i) => i + 1), `${what}: seq goes on 1, 2, 3, ... with no repeat and no gap`)
  assert.equal(new Set(events.map((e) => e.key)).size, events.length, `${what}: no event is in the log twice`)
  const resumed = events.filter((e) => e.type === "research.resumed") as Extract<Stamped, { type: "research.resumed" }>[]
  assert.equal(resumed.length, resumes, `${what}: one research.resumed for each restart`)
  for (const r of resumed) assert.equal(r.afterSeq, r.seq - 1, `${what}: research.resumed names the last event before the restart`)
}

test("killed between any two steps and started again: every step that was stored is never done again, the record is the same, and no event repeats", async (t) => {
  // The answer that is never interrupted: what it buys, what it stores, what it ends as.
  const stored: string[] = []
  const calm = await engine({ onStored: (key) => void stored.push(key) })
  const reference = await paidAllowed(() => calm.answer({ question: Q, effort: "quick" }))
  const needed: Record<string, number> = tally(stored), spent = bought(calm)
  await calm.close()
  assert.deepEqual({ ...needed }, { plan: 1, "search:exa": 1, screen: 2, "search:europepmc": 2, write: 1, check: 3, critic: 1, revise: 1, rejudge: 1 }, "every paid or outside step is stored, once")
  assert.deepEqual({ ...spent }, { ...needed }, "uninterrupted: one call for each stored step")
  assert.equal(reference.record.status, "done")
  assert.equal(new Set(stored).size, stored.length)
  assert.ok(stored.every((key) => key.startsWith(`${reference.id}:`) && /:[0-9a-f]{16}$/.test(key)), "the key is the answer, the step and a hash of the step's input")

  let clean = 0
  for (let point = 1; point <= stored.length; point++) {
    const before: string[] = []
    let live = true
    // Every key that reaches the store is noted, also one whose write was already under way at the instant of the kill.
    const e = await engine({ onStored: (key) => { before.push(key); if (live && before.length === point) { live = false; return "stop" } } })
    try {
      await paidAllowed(async () => {
        const started = await e.ask({ question: Q, effort: "quick" })
        const id = started.body.id
        await e.research.idle() // the engine is dead: it holds nothing
        const what = `killed after stored step ${point} (${kindOf(before[point - 1])})`
        const atKill = bought(e), log = e.events(id), had = tally(before) // what the store held when the engine died
        const left = JSON.parse(readFileSync(join(e.runs, ".research", id, "record.json"), "utf8")) as ResearchRecord
        assert.equal(left.status, "running", `${what}: nothing marks the answer as ended`)
        assert.ok(!log.some((x) => ["research.finished", "research.failed", "research.cancelled"].includes(x.type)), what)
        assert.ok(existsSync(join(e.runs, ".research", id, "session.sqlite")), "the answer's durable session")
        await sleep(15)
        assert.deepEqual(bought(e), atKill, `${what}: a dead engine buys nothing`)

        assert.deepEqual(e.research.resume(), [id], `${what}: the start of the engine takes the answer up again`)
        await e.research.idle()
        const record = await e.record(id), events = e.events(id), total = bought(e)
        // After the restart exactly the steps that were not yet stored are done, each once. A stored step: never again.
        for (const kind of Object.keys(needed)) assert.equal(total[kind] - atKill[kind], needed[kind] - (had[kind] ?? 0), `${what}: ${kind} after the restart`)
        // A call that was in flight when the engine died had no stored result; only such a call is made a second time.
        const twice = Object.keys(needed).reduce((n, kind) => n + (atKill[kind] - (had[kind] ?? 0)), 0)
        assert.equal(Object.values(total).reduce((a, b) => a + b, 0), Object.values(needed).reduce((a, b) => a + b, 0) + twice, what)
        if (twice === 0) { clean++; assert.deepEqual(total, needed, `${what}: nothing was in flight, so the count is that of an uninterrupted answer`) }
        assert.deepEqual(same(record), same(reference.record), `${what}: the final record is the same`)
        checkLog(events, 1, what)
        assert.deepEqual(shapeOf(events), shapeOf(reference.events), `${what}: the same events as an uninterrupted answer, plus research.resumed`)
        assert.deepEqual(log, events.slice(0, log.length), `${what}: what was in the log before the restart is untouched`)
        assert.ok(record.workedMs! >= left.workedMs!, what)
        assert.deepEqual(e.research.resume(), [], "a finished answer is not taken up again")
      })
    } finally { await e.close() }
  }
  t.diagnostic(`${stored.length} kill points; at ${clean} of them nothing was in flight and the calls were exactly those of an uninterrupted answer`)
  assert.ok(clean >= 8, `at ${clean} of ${stored.length} kill points nothing was in flight and the counts were exactly those of an uninterrupted answer`)
})

test("killed in the middle of a call: that one call is made again, nothing else is, and the answer ends the same", async () => {
  const calm = await engine()
  const reference = await paidAllowed(() => calm.answer({ question: Q, effort: "quick" }))
  const needed = bought(calm)
  await calm.close()
  for (const role of ["write", "critic", "revise"] as const) {
    let dead = false
    const e = await engine({ script: { [role]: async (call: Parameters<typeof DEFAULTS.write>[0], n: number) => {
      if (!dead) { dead = true; void e.research.kill(); await new Promise<void>((resolve) => call.options.signal?.aborted ? resolve() : call.options.signal?.addEventListener("abort", () => resolve())); return "this reply never arrives" }
      return DEFAULTS[role](call, n)
    } } })
    try {
      await paidAllowed(async () => {
        const id = (await e.ask({ question: Q, effort: "quick" })).body.id
        await e.research.idle()
        assert.equal((JSON.parse(readFileSync(join(e.runs, ".research", id, "record.json"), "utf8")) as ResearchRecord).status, "running")
        const atKill = bought(e), log = e.events(id)
        assert.ok(!log.some((x) => x.type === "step.finished" && (x as { step: string }).step === (role === "critic" ? "review" : role)), `${role}: the step it died in is not closed`)
        assert.deepEqual(e.research.resume(), [id])
        await e.research.idle()
        const total = bought(e)
        assert.equal(total[role], needed[role] + 1, `${role}: the call that was in flight is made again, once`)
        // The critic and the checker work at the same time: a check in flight beside the critic may be repeated too. Nothing else is.
        for (const kind of Object.keys(needed)) if (kind !== role && !(role === "critic" && kind === "check")) assert.equal(total[kind], needed[kind], `${role}: ${kind} is not bought again`)
        assert.ok(total.check <= needed.check + (atKill.check ?? 0))
        const record = await e.record(id), events = e.events(id)
        assert.deepEqual(same(record), same(reference.record), `${role}: the final record is the same`)
        checkLog(events, 1, role)
        assert.deepEqual(shapeOf(events), shapeOf(reference.events))
      })
    } finally { await e.close() }
  }
})

test("a real process death: an engine process killed with SIGKILL in the middle of the writing, and a new process on the same folder finishes the answer without buying a stored step again", async () => {
  const runs = join(mkdtempSync(join(tmpdir(), "research-crash-")), "runs")
  const child = join(import.meta.dirname, "fixtures/research/crash-child.ts")
  const env = { ...process.env, NO_PAID_CALLS: "1", PAID_SWITCH_LOCKED: "1" }
  // The first engine process: it gets as far as the writer's call, and dies there.
  const first = spawn(process.execPath, [child, runs, "start"], { env, stdio: ["ignore", "pipe", "inherit"] })
  const id = await new Promise<string>((resolve, reject) => {
    let out = ""
    first.stdout.on("data", (d) => { out += d; const m = /WRITING (a-\d{14}-[0-9a-f]{8})/.exec(out); if (m) resolve(m[1]) })
    first.on("exit", (code) => reject(new Error(`the first process ended by itself (${code}): ${out}`)))
    setTimeout(() => reject(new Error(`the first process never reached the writer: ${out}`)), 30_000).unref()
  })
  first.removeAllListeners("exit")
  first.kill("SIGKILL")
  await new Promise((done) => first.on("close", done))
  const dir = join(runs, ".research", id)
  const left = JSON.parse(readFileSync(join(dir, "record.json"), "utf8")) as ResearchRecord
  const before = readFileSync(join(dir, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Stamped)
  assert.equal(left.status, "running", "the dead process marked nothing")
  assert.ok(existsSync(join(dir, "run.lock")), "its lock is still there, held by a process that no longer lives")
  assert.ok(before.some((x) => x.type === "step.started" && (x as { step: string }).step === "write") && !before.some((x) => x.type === "step.finished" && (x as { step: string }).step === "write"))
  // The second engine process, as after a restart.
  const second = spawn(process.execPath, [child, runs, "resume"], { env, stdio: ["ignore", "pipe", "inherit"] })
  let printed = ""
  second.stdout.on("data", (d) => { printed += d })
  const code = await new Promise<number | null>((done) => second.on("close", done))
  assert.equal(code, 0, printed)
  const out = JSON.parse(printed.trim().split("\n").at(-1)!) as { taken: string[]; bought: Record<string, number>; status: string; statements: string[]; usd: number; events: [number, string][] }
  assert.deepEqual(out.taken, [id], "the lock of the dead process is taken over")
  assert.equal(out.status, "done")
  assert.deepEqual(out.bought, { plan: 0, screen: 0, exa: 0, europepmc: 0, write: 1, check: 3, critic: 1, revise: 1, rejudge: 1 }, "the new process buys nothing that was stored (the plan, the searches, the screening) and makes the call that was in flight (the writer) once")
  assert.deepEqual(out.statements, ["verified", "verified", "verified"])
  assert.deepEqual(out.events.map((x) => x[0]), out.events.map((_x, i) => i + 1), "seq goes on with no repeat")
  assert.deepEqual(out.events.slice(0, before.length), before.map((x) => [x.seq, x.type]), "the log of the dead process is untouched")
  assert.deepEqual(out.events[before.length], [before.length + 1, "research.resumed"])
  assert.equal(out.events.filter((x) => x[1] === "research.resumed").length, 1)
  assert.equal(out.events.at(-1)?.[1], "research.finished")
  assert.ok(out.usd >= left.usd)
})

test("cancel holds across a restart: an answer cancelled while the engine was down, or right after it came back, buys nothing more", async () => {
  // The cancel mark is put on disk while the engine is down; the next start reads it before any paid step.
  let live = true, seen = 0
  const e = await engine({ onStored: () => { if (live && ++seen === 4) { live = false; return "stop" } } })
  try {
    await paidAllowed(async () => {
      const id = (await e.ask({ question: Q, effort: "quick" })).body.id
      await e.research.idle()
      const atKill = bought(e)
      writeFileSync(join(e.runs, ".research", id, "cancel"), "cancelled while the engine was down\n")
      assert.deepEqual(e.research.resume(), [id])
      await e.research.idle()
      const record = await e.record(id), events = e.events(id)
      assert.deepEqual([record.status, events.at(-1)?.type], ["cancelled", "research.cancelled"])
      assert.deepEqual(bought(e), atKill, "not one call after the restart")
      checkLog(events, 1, "cancelled while down")
      assert.ok(events.filter((x) => x.type === "step.started").every((s) => events.some((f) => f.type === "step.finished" && (f as { step: string }).step === (s as { step: string }).step)), "every step is closed")
      assert.ok(record.sources.length > 0 || record.searches.length > 0, "what was found before the engine stopped is kept")
    })
  } finally { await e.close() }
  // The engine is down and comes back only through the cancel request itself (no resume first).
  let alive = true, count = 0
  const f = await engine({ onStored: () => { if (alive && ++count === 6) { alive = false; return "stop" } } })
  try {
    await paidAllowed(async () => {
      const id = (await f.ask({ question: Q, effort: "quick" })).body.id
      await f.research.idle()
      const atKill = bought(f)
      const cancelled = await f.cancel(id)
      assert.deepEqual([cancelled.status, cancelled.body.cancelled], [200, true])
      await f.research.idle()
      assert.equal((await f.record(id)).status, "cancelled")
      assert.deepEqual(bought(f), atKill)
      assert.deepEqual(f.research.resume(), [], "a cancelled answer is not taken up again")
    })
  } finally { await f.close() }
})

test("the limits hold with what was already used: time worked before the restart counts, time while the engine was down does not", async () => {
  let live = true, seen = 0
  const e = await engine({ onStored: () => { if (live && ++seen === 5) { live = false; return "stop" } } })
  try {
    await paidAllowed(async () => {
      const id = (await e.ask({ question: Q, effort: "quick" })).body.id
      await e.research.idle()
      const file = join(e.runs, ".research", id, "record.json")
      const left = JSON.parse(readFileSync(file, "utf8")) as ResearchRecord
      assert.ok(left.workedMs! >= 0 && left.workedMs! < 5_000)
      // As if the engine had been down for an hour: the answer is not over its time limit because of that.
      writeFileSync(file, JSON.stringify({ ...left, startedAt: left.startedAt - 3_600_000, workStartedAt: left.workStartedAt! - 3_600_000 }))
      e.research.resume()
      await e.research.idle()
      const done = await e.record(id)
      assert.deepEqual([done.status, done.stopped], ["done", undefined], "an hour of down time is not an hour of work")
      assert.ok(done.seconds! < 10)
    })
  } finally { await e.close() }
  // As if it had already worked for its whole limit before the restart: it ends at once with what it has, and buys nothing.
  let alive = true, count = 0
  const f = await engine({ onStored: () => { if (alive && ++count === 5) { alive = false; return "stop" } } })
  try {
    await paidAllowed(async () => {
      const id = (await f.ask({ question: Q, effort: "quick" })).body.id
      await f.research.idle()
      const file = join(f.runs, ".research", id, "record.json")
      const atKill = bought(f)
      writeFileSync(file, JSON.stringify({ ...(JSON.parse(readFileSync(file, "utf8")) as ResearchRecord), workedMs: 121_000 }))
      f.research.resume()
      await f.research.idle()
      const done = await f.record(id)
      assert.deepEqual([done.status, done.stopped], ["done", "time"])
      assert.deepEqual(bought(f), atKill, "over the time limit: no further call")
      assert.match(done.note ?? "", /the time limit for this answer was reached/)
      assert.ok(done.usd >= 0.005, "what was spent before the restart is still counted")
    })
  } finally { await f.close() }
})

test("a real answer left unfinished waits while paid calls are off or the preview switch is off, and continues when they are on again", async () => {
  let live = true, seen = 0
  const e = await engine({ onStored: () => { if (live && ++seen === 3) { live = false; return "stop" } } })
  try {
    await paidAllowed(async () => {
      const id = (await e.ask({ question: Q, effort: "quick" })).body.id
      await e.research.idle()
      const atKill = bought(e)
      e.env.NO_PAID_CALLS = "1"
      assert.deepEqual(e.research.resume(), [], "Demo mode: a real answer is not continued")
      await sleep(20)
      assert.equal((JSON.parse(readFileSync(join(e.runs, ".research", id, "record.json"), "utf8")) as ResearchRecord).status, "running", "and it is not ended either: it waits")
      e.env.NO_PAID_CALLS = "0"
      delete e.env.RESEARCH_PREVIEW
      assert.deepEqual(e.research.resume(), [], "no preview switch: not continued")
      assert.deepEqual(bought(e), atKill)
      e.env.RESEARCH_PREVIEW = "1"
      assert.deepEqual(e.research.resume(), [id])
      await e.research.idle()
      assert.equal((await e.record(id)).status, "done")
    })
  } finally { await e.close() }
})

test("a queued follow-up survives a restart and still starts only after the answer before it", async () => {
  let release = () => {}
  const gate = new Promise<void>((r) => { release = r })
  const e = await engine({ script: { write: async (call, n) => { await gate; return DEFAULTS.write(call, n) } } })
  try {
    await paidAllowed(async () => {
      const a = await e.ask({ question: Q, effort: "quick" })
      await until(() => e.count("screen") > 0, "the first answer to be at work")
      const b = await e.ask({ question: "And in people over 75 years old?", effort: "quick", thread: a.body.thread })
      assert.equal(b.body.queued, true)
      await sleep(50)
      await e.research.kill()
      const status = (id: string) => (JSON.parse(readFileSync(join(e.runs, ".research", id, "record.json"), "utf8")) as ResearchRecord).status
      assert.deepEqual([status(a.body.id), status(b.body.id)], ["running", "queued"], "nothing is lost and nothing is ended")
      assert.deepEqual(e.research.resume(), [a.body.id, b.body.id], "both are taken up, the older first")
      await sleep(400) // longer than the queue's poll
      assert.equal(status(b.body.id), "queued", "the follow-up still waits for the answer before it")
      release()
      await e.research.idle()
      const [ra, rb] = await Promise.all([e.record(a.body.id), e.record(b.body.id)])
      assert.deepEqual([ra.status, rb.status], ["done", "done"])
      assert.ok(rb.workStartedAt! >= ra.finishedAt!)
      assert.deepEqual(e.events(b.body.id).slice(0, 2).map((x) => x.type), ["research.queued", "research.started"], "its log goes on from the line it had")
      checkLog(e.events(b.body.id), 0, "the queued answer had not started, so nothing was resumed in it")
      checkLog(e.events(a.body.id), 1, "the first answer")
      assert.equal(e.count("plan"), 2, "one plan for each answer: the first one's was stored before the kill")
    })
  } finally { release(); await e.close() }
})

test("one answer is worked on by one process: a second engine on the same folder does not take up an answer that is being written", async () => {
  let release = () => {}
  const gate = new Promise<void>((r) => { release = r })
  const first = await engine({ script: { write: async (call, n) => { await gate; return DEFAULTS.write(call, n) } } })
  try {
    await paidAllowed(async () => {
      const id = (await first.ask({ question: Q, effort: "quick" })).body.id
      await until(() => first.count("screen") > 0, "the answer to be at work")
      assert.ok(existsSync(join(first.runs, ".research", id, "run.lock")))
      const second = await engine({ runs: first.runs })
      assert.deepEqual(second.research.resume(), [], "the lock is held: nothing is taken up")
      await sleep(30)
      assert.equal(second.calls.length, 0)
      const cancelled = await second.cancel(id) // it can still leave the mark; the holder reads it
      assert.deepEqual([cancelled.status, cancelled.body.cancelled], [200, true])
      assert.match(cancelled.body.message, /Another engine process is working on it/)
      release()
      await first.research.idle()
      assert.equal((await first.record(id)).status, "cancelled", "the engine that holds the answer stopped it before its next paid step")
      assert.deepEqual([first.count("check"), first.count("critic")], [0, 0])
      assert.ok(!existsSync(join(first.runs, ".research", id, "run.lock")), "the lock is given back")
      await second.close()
    })
  } finally { release(); await first.close() }
})
