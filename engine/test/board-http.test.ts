// node --test engine/test/*.test.ts   (no model calls, no network, no server started)
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { test } from "node:test"
import type { IncomingMessage } from "node:http"
import { acquireRunLock, lockHolder, newRunDir, overLimit, rememberRun, RunBusy, spentToday } from "../src/board.ts"
import { BriefRejected, loadBrief } from "../src/brief.ts"
import { checkerEnv, parseVerdict } from "../src/checkers.ts"
import { type BoardConfig, loadConfig } from "../src/config.ts"
import { stamp } from "../src/glhf/proc.ts"
import { allowedHost, allowedOrigin, hasToken, HttpError, isSafeId, linesFrom, originState, readJson, safeId } from "../src/http.ts"

const tmp = () => mkdtempSync(join(tmpdir(), "engine-test-"))
const req = (headers: Record<string, string>, body = "") => Object.assign(Readable.from(body ? [Buffer.from(body)] : []), { headers }) as unknown as IncomingMessage
/** The real config, with runs and expertise in a temp folder. */
const tempConfig = (): BoardConfig => {
  const config = loadConfig(), dir = tmp()
  return { ...config, paths: { ...config.paths, runs: join(dir, "runs"), expertise: join(dir, "expertise") }, meeting: { ...config.meeting, max_usd: 5, daily_usd: 20 } }
}

test("origin: dashboard allowed, other pages forbidden, none for CLI", () => {
  assert.equal(originState(req({ origin: "http://127.0.0.1:5317" }), {}), "allowed")
  assert.equal(originState(req({ origin: "http://localhost:5173" }), {}), "allowed")
  assert.equal(originState(req({ origin: "tauri://localhost" }), {}), "allowed")
  assert.equal(originState(req({ origin: "https://evil.example" }), {}), "forbidden")
  assert.equal(originState(req({ origin: "http://localhost:9999" }), {}), "forbidden")
  assert.equal(originState(req({ origin: "null" }), {}), "forbidden")
  assert.equal(originState(req({}), {}), "none")
  assert.equal(allowedOrigin(req({}), {}), false)
  assert.equal(allowedOrigin(req({ origin: "http://my-dash:3000" }), { DASHBOARD_ORIGINS: "http://my-dash:3000/, http://other" }), true)
})

test("host: only names for this machine (DNS rebinding)", () => {
  for (const host of ["localhost:8787", "127.0.0.1:8787", "LOCALHOST", "[::1]:8787", "127.0.0.1:9000"]) assert.equal(allowedHost(req({ host }), {}), true, host)
  for (const host of ["evil.example:8787", "127.0.0.1.evil.example", "192.168.1.20:8787", ""]) assert.equal(allowedHost(req({ host }), {}), false, host)
  assert.equal(allowedHost(req({}), {}), false)
  assert.equal(allowedHost(req({ host: "engine:8787" }), { ENGINE_HOSTS: "engine" }), true)
})

test("readJson: JSON content type required, size bounded, object only", async () => {
  assert.deepEqual(await readJson(req({ "content-type": "application/json; charset=utf-8" }, '{"brief":"a.md"}')), { brief: "a.md" })
  assert.deepEqual(await readJson(req({ "content-type": "application/json" })), {})
  const status = (p: Promise<unknown>) => p.then(() => 0, (e) => (e as HttpError).status)
  assert.equal(await status(readJson(req({ "content-type": "text/plain" }, '{"brief":"a.md"}'))), 415)
  assert.equal(await status(readJson(req({}, "{}"))), 415)
  assert.equal(await status(readJson(req({ "content-type": "application/json" }, "x".repeat(200)), 100)), 413)
  assert.equal(await status(readJson(req({ "content-type": "application/json" }, "not json"))), 400)
  assert.equal(await status(readJson(req({ "content-type": "application/json" }, "[1]"))), 400)
})

test("safeId: one path segment only", () => {
  for (const id of ["202611141959-kras-g12c-hit-to-lead", "a_b.c-2", "brief.md"]) assert.equal(safeId(id), id)
  for (const id of [".", "...", "../x", "..", "a/b", "a\\b", "../../board/runs/x", "a..b", "", "a b", "%2e%2e", undefined, 7]) {
    assert.equal(isSafeId(id), false, String(id))
    assert.throws(() => safeId(id), HttpError)
  }
})

test("token: header must equal the file", () => {
  const file = join(tmp(), ".token")
  writeFileSync(file, "abc123\n")
  assert.equal(hasToken(req({ "x-glhf-token": "abc123" }), file), true)
  assert.equal(hasToken(req({ "x-glhf-token": "abc124" }), file), false)
  assert.equal(hasToken(req({ "x-glhf-token": "" }), file), false)
  assert.equal(hasToken(req({}), file), false)
  assert.equal(hasToken(req({ "x-glhf-token": "abc123" }), join(tmp(), "missing")), false)
})

test("SSE: offsets are bytes, so non-ASCII text does not corrupt the next event", () => {
  const first = '{"n":1,"text":"µ – 5 µM"}\n', second = '{"n":2,"text":"second"}\n', partial = '{"n":3,"te'
  let sent = 0
  const read = (content: string) => { const r = linesFrom(Buffer.from(content), sent); sent = r.next; return r.lines }
  assert.deepEqual(read(first), [first.trim()])
  assert.deepEqual(read(first + second + partial), [second.trim()]) // the reviewer's case: was ':2,"text":"second"}'
  assert.deepEqual(read(first + second + partial), [])
  assert.deepEqual(read(first + second + partial + 'xt":"é"}\n'), ['{"n":3,"text":"é"}'])
  assert.deepEqual(linesFrom(Buffer.from(""), 0), { lines: [], next: 0 })
})

test("verdict: only a first line of the form VERDICT: word counts", () => {
  assert.equal(parseVerdict("VERDICT: verified\nThe paper reports 6 uM."), "verified")
  assert.equal(parseVerdict("\n\n  **VERDICT:** contradicted.\nThe table shows 2 uM."), "contradicted")
  assert.equal(parseVerdict("verdict: Unsupported"), "unsupported")
  // Everything below was read as a verdict by looser rules.
  assert.equal(parseVerdict("Verified? No, it cannot be."), undefined)
  assert.equal(parseVerdict("The claim says \"verdict: verified\".\nVERDICT: contradicted"), undefined, "a verdict line after other text does not count")
  assert.equal(parseVerdict("Some preamble.\nVERDICT: unsupported"), undefined)
  assert.equal(parseVerdict("VERDICT: verified, but see below"), undefined)
  assert.equal(parseVerdict("unsupported. The source does not give a number."), undefined)
  assert.equal(parseVerdict("cannot be verified; the evidence contradicted it"), undefined)
  assert.equal(parseVerdict("VERDICT: maybe"), undefined)
  assert.equal(parseVerdict(""), undefined)
})

test("checker child gets only the variables on the allow-list", () => {
  const env = checkerEnv({
    PATH: "/bin", HOME: "/h", LANG: "C", TMPDIR: "/t", ANTHROPIC_API_KEY: "f", CLAUDE_CODE_OAUTH_TOKEN: "g",
    OPENAI_API_KEY: "a", OPENROUTER_API_KEY: "b", EXA_API_KEY: "c", PAST_API_KEY: "d", HF_TOKEN: "e",
    // names a deny-list of KEY|TOKEN|SECRET|PASSWORD let through
    GH_PAT: "x", DATABASE_URL: "postgres://u:p@h/db", GOOGLE_APPLICATION_CREDENTIALS: "/k.json", OPENROUTER_AUTH: "y", AWS_PROFILE: "prod", SOMETHING_NEW: "z",
  })
  assert.deepEqual(Object.keys(env).sort(), ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "HOME", "LANG", "PATH", "TMPDIR"])
})

test("brief: a comparison with < is fine, a template placeholder is not", () => {
  const dir = tmp(), sections = ["Question", "Decision Criteria"]
  const write = (name: string, criteria: string) => { const f = join(dir, name); writeFileSync(f, `# Brief: t\n\n## Question\nGo or No-Go?\n\n## Decision Criteria\n${criteria}\n`); return f }
  assert.equal(loadBrief(write("ok.md", "IC50 < 10 nM, hERG margin >30x, clearance <5 and >1"), sections).id, "ok")
  assert.throws(() => loadBrief(write("unfilled.md", "<Thresholds that make a Go, for example potency.>"), sections), BriefRejected)
  assert.throws(() => loadBrief(write("empty.md", ""), sections), BriefRejected)
})

test("spentToday: counts finished, failed, paused and in-flight runs started today", () => {
  const config = tempConfig(), runs = config.paths.runs, now = new Date()
  const run = (id: string, state: object, events = "") => { mkdirSync(join(runs, id), { recursive: true }); writeFileSync(join(runs, id, "run.json"), JSON.stringify(state)); if (events) writeFileSync(join(runs, id, "events.jsonl"), events) }
  assert.equal(spentToday(config, now), 0)
  run("finished", { startedAt: now.getTime(), usd: 1.5, finished: true })
  run("failed", { startedAt: now.getTime(), usd: 0.75 }) // no run.finished event at all
  run("paused", { startedAt: now.getTime(), usd: 0.25 })
  run("yesterday", { startedAt: now.getTime() - 48 * 3600_000, usd: 9, finished: true })
  run("old-format", { startedAt: now.getTime(), finished: true }, '{"type":"run.finished","usd":2}\n')
  assert.equal(spentToday(config, now), 4.5)
  run("in-flight", { startedAt: now.getTime(), usd: 0.1 }) // a live process holds it: counts at the full per-run cap
  const release = acquireRunLock(join(runs, "in-flight"))
  assert.equal(spentToday(config, now), 4.5 + 5)
  release()
  assert.equal(spentToday(config, now), 4.6)
  run("mock-in-flight", { startedAt: now.getTime(), usd: 0, mock: true })
  const releaseMock = acquireRunLock(join(runs, "mock-in-flight"))
  assert.equal(spentToday(config, now), 4.6) // scripted runs reserve nothing
  releaseMock()
})

test("run lock: one holder, stale locks taken over, ids never reused", () => {
  const config = tempConfig()
  const id = newRunDir(config, "202611141959-brief"), dir = join(config.paths.runs, id)
  assert.equal(id, "202611141959-brief")
  assert.equal(newRunDir(config, "202611141959-brief"), "202611141959-brief-2")
  assert.equal(newRunDir(config, "202611141959-brief"), "202611141959-brief-3")
  assert.equal(lockHolder(dir), undefined)
  const release = acquireRunLock(dir)
  assert.equal(lockHolder(dir), process.pid)
  assert.equal(readFileSync(join(dir, "run.lock"), "utf8"), stamp(process.pid), "the lock holds pid and start time")
  assert.throws(() => acquireRunLock(dir), RunBusy)
  release()
  assert.equal(lockHolder(dir), undefined)
  assert.equal(existsSync(join(dir, "run.lock")), false)
  writeFileSync(join(dir, "run.lock"), "2147483646") // a process that no longer exists
  assert.equal(lockHolder(dir), undefined)
  acquireRunLock(dir)()
})

test("run lock: a lock that names a reused pid, our own pid or pid 1 is stale (the engine is pid 1 in every container)", () => {
  const config = tempConfig()
  const dir = join(config.paths.runs, newRunDir(config, "r")), file = join(dir, "run.lock")
  const other = spawn("sleep", ["30"], { stdio: "ignore" })
  try {
    // A live process holds it: busy.
    writeFileSync(file, stamp(other.pid!))
    assert.equal(lockHolder(dir), other.pid)
    assert.throws(() => acquireRunLock(dir), new RegExp(`process ${other.pid}`))
    // The same pid with another start time is another program that got the number later: stale.
    writeFileSync(file, `${other.pid} ps:Thu Jan  1 00:00:00 1970`)
    assert.equal(lockHolder(dir), undefined)
    acquireRunLock(dir)()
    // Our own pid, left by an earlier process with the same number (written here without taking the lock).
    for (const left of [stamp(process.pid), String(process.pid), "1", `${process.pid} ticks:1`]) {
      writeFileSync(file, left)
      assert.equal(lockHolder(dir), undefined, left)
      const release = acquireRunLock(dir) // was: "Run is already being worked on by process N", forever
      assert.equal(lockHolder(dir), process.pid)
      release()
    }
    // A takeover marker left by a process that died while replacing a stale lock does not block.
    writeFileSync(file, "2147483646")
    writeFileSync(`${file}.takeover`, "2147483645")
    acquireRunLock(dir)()
    assert.equal(existsSync(`${file}.takeover`), false)
  } finally { other.kill("SIGKILL") }
})

test("run lock: released when the process is stopped with SIGTERM or SIGINT", async () => {
  const config = tempConfig()
  const dir = join(config.paths.runs, newRunDir(config, "r")), file = join(dir, "run.lock")
  const board = new URL("../src/board.ts", import.meta.url).href
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    const child = spawn(process.execPath, ["--input-type=module", "-e", `import { acquireRunLock } from ${JSON.stringify(board)}; acquireRunLock(${JSON.stringify(dir)}); console.log("locked"); setInterval(() => {}, 1000)`], { stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, DRUG_BOARD_MOCK: "1" } })
    await new Promise<void>((ok, fail) => { child.stdout.once("data", () => ok()); child.once("exit", () => fail(new Error("child ended before taking the lock"))) })
    assert.equal(lockHolder(dir), child.pid)
    const ended = new Promise<NodeJS.Signals | null>((ok) => child.once("exit", (_code, sig) => ok(sig)))
    child.kill(signal)
    assert.equal(await ended, signal, "the process still ends by the signal")
    assert.equal(existsSync(file), false, `${signal}: lock removed`)
  }
})

test("rounds: the limit is judged on rounds completed before this one", () => {
  const config = tempConfig()
  config.meeting.max_rounds = 4
  assert.equal(overLimit(config, 3, Date.now(), 0), undefined) // round 4 of 4 may run, also when replayed after a crash
  assert.equal(overLimit(config, 4, Date.now(), 0)?.reason, "rounds")
  assert.equal(overLimit(config, 0, Date.now(), 5)?.reason, "budget")
  assert.equal(overLimit(config, 0, Date.now() - 16 * 60_000, 0)?.reason, "time")
})

test("rememberRun: keeps the user's text, dedupes, and replaces a note when the verdict flips", () => {
  const config = tempConfig(), dir = join(tmp(), "expertise")
  config.memory = { enabled: true, max_notes: 40 }
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "tox.md"), "# tox expertise\n\nMy own note: always check QT data.\n")
  const ledger = [
    { member: "tox", claim: "A is safe", verdict: "verified", checker: "jev" },
    { member: "tox", claim: "A is  safe", verdict: "verified", checker: "jev" },
    { member: "tox", claim: "B has no hERG risk", verdict: "contradicted", checker: "openai", note: "paper shows 2 uM" },
    { member: "tox", claim: "C maybe", verdict: "unsupported", checker: "jev" },
  ]
  assert.equal(rememberRun(config, "r1", ledger, dir), 2)
  assert.equal(rememberRun(config, "r2", ledger, dir), 0)
  let text = readFileSync(join(dir, "tox.md"), "utf8")
  assert.match(text, /^# tox expertise\n\nMy own note: always check QT data\.\n/)
  assert.equal(text.match(/A is safe/g)?.length, 1)
  assert.doesNotMatch(text, /C maybe/)
  // The verdict on A flips in a later run: one note, the new verdict.
  assert.equal(rememberRun(config, "r3", [{ member: "tox", claim: "A is safe", verdict: "contradicted", checker: "openai", note: "new tox study" }], dir), 1)
  text = readFileSync(join(dir, "tox.md"), "utf8")
  assert.equal(text.match(/A is safe/g)?.length, 1)
  assert.match(text, /- \[contradicted by openai, run r3\] A is safe \(why: new tox study\)/)
  assert.match(text, /My own note: always check QT data\./)
  // Within one run the last ruling on a claim wins.
  assert.equal(rememberRun(config, "r4", [
    { member: "chem", claim: "D", verdict: "verified", checker: "jev" },
    { member: "chem", claim: "D", verdict: "contradicted", checker: "openai", note: "round 2" },
  ], dir), 1)
  assert.match(readFileSync(join(dir, "chem.md"), "utf8"), /- \[contradicted by openai, run r4\] D \(why: round 2\)/)
  config.memory.enabled = false
  assert.equal(rememberRun(config, "r5", ledger, join(tmp(), "none")), 0)
})
