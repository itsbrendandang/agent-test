// The board's decisions that cost money, tested without a model, a harness or a server: which rounds may
// run, which claim checks are paid for, what an unpriced model costs, when a run may continue, and how the
// escalation checker's child process is confined.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { BudgetReached, checkClaims, type ClaimDeps, gateRound, type Memo, rollDay, runBoard, spentToday, summarize, todaySpend, usdOf } from "../src/board.ts"
import { claudeCodeCheck } from "../src/checkers.ts"
import type { Claim } from "../src/claims.ts"
import { type BoardConfig, loadConfig, ROOT } from "../src/config.ts"

const tmp = () => mkdtempSync(join(tmpdir(), "board-core-"))
const tempConfig = (): BoardConfig => {
  const config = loadConfig(), dir = tmp()
  return { ...config, paths: { ...config.paths, runs: join(dir, "runs"), expertise: join(dir, "expertise") }, meeting: { ...config.meeting, max_usd: 5, daily_usd: 20, max_rounds: 4, max_minutes: 15 }, checkers: { ...config.checkers } }
}
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms))

/** api.memo as Pi Durable gives it: the first value stored under a name is returned on every later call. */
const memory = (stored: Record<string, string | number> = {}) => {
  const memo: Memo = async (name, candidate) => (name in stored ? stored[name] : (stored[name] = candidate)) as typeof candidate
  return { memo, stored }
}
const noSpend = async () => 0

test("rounds: a new round past the limit is refused unless it asks for final positions", async () => {
  const config = tempConfig(), limits: string[] = []
  const state = { rounds: 4, startedAt: Date.now(), finalRound: undefined as number | undefined }
  const refused = await gateRound(state, config, false, memory().memo, noSpend, (_r, l) => limits.push(l.reason))
  assert.equal(refused.round, 5)
  assert.match(refused.refusal, /^WRAP UP: 4 of 4 rounds used/)
  assert.deepEqual(limits, ["rounds"])
  assert.equal((await gateRound(state, config, true, memory().memo, noSpend)).refusal, "", "one final round may pass the limit")
  assert.equal((await gateRound({ ...state, rounds: 2 }, config, false, memory().memo, noSpend)).refusal, "")
  assert.match((await gateRound({ ...state, rounds: 1 }, config, false, memory().memo, async () => 5)).refusal, /\$5\.00 of \$5 spent/)
})

test("rounds: after the final round nothing more runs, also with final=true (the lead has up to 20 turns)", async () => {
  const config = tempConfig()
  const state = { rounds: 2, startedAt: Date.now(), finalRound: 2 }
  for (const final of [true, false]) {
    const gate = await gateRound(state, config, final, memory().memo, noSpend)
    assert.match(gate.refusal, /Final positions are in \(round 2\)\. No further rounds: call write_memo now\./)
  }
})

test("rounds: a replay after a crash runs the same round again instead of refusing it", async () => {
  const config = tempConfig()
  // Crash in round 4 of 4, after the round was counted (state.rounds = 4) and its decision stored.
  let replay = memory({ round: 4, gate: "" })
  assert.deepEqual(await gateRound({ rounds: 4, startedAt: Date.now(), finalRound: undefined }, config, false, replay.memo, noSpend), { round: 4, refusal: "" })
  // Crash in the final round, after it was marked final but before its decision was stored: still that round, not "no further rounds".
  replay = memory({ round: 4 })
  assert.deepEqual(await gateRound({ rounds: 4, startedAt: Date.now(), finalRound: 4 }, config, true, replay.memo, noSpend), { round: 4, refusal: "" })
  // A stored refusal is repeated as it was, whatever the limits say now.
  replay = memory({ round: 5, gate: "WRAP UP: stored" })
  assert.equal((await gateRound({ rounds: 4, startedAt: Date.now(), finalRound: undefined }, config, true, replay.memo, noSpend)).refusal, "WRAP UP: stored")
  // The replayed round does not ask for the spend again.
  let asked = 0
  await gateRound({ rounds: 3, startedAt: Date.now(), finalRound: undefined }, config, false, memory({ round: 3, gate: "" }).memo, async () => { asked++; return 0 })
  assert.equal(asked, 0)
})

const claim = (text: string, kind: Claim["kind"] = "literature", source = "https://a.example/paper"): Claim => ({ kind, text, source })

function claimDeps(over: Partial<ClaimDeps> = {}) {
  const calls = { jev: 0, computed: 0, literature: 0, saved: 0, events: [] as string[] }
  const deps: ClaimDeps = {
    state: { ledger: [], escalations: 0, checkerUsd: 0 },
    maxEscalations: 12,
    jevCheck: async (claims) => { calls.jev++; return claims.map((c) => (c.includes("unsure") ? { verdict: "escalate" as const } : { verdict: "verified" as const, p: 0.9 })) },
    computedCheck: async () => { calls.computed++; return { verdict: "verified", note: "recomputed", usd: 0.2 } },
    literatureCheck: async () => { calls.literature++; return { verdict: "contradicted", note: "the paper says otherwise", usd: 0.1 } },
    evidenceFor: (source) => (source === "https://a.example/paper" || source === "brief" ? "evidence text" : undefined),
    save: () => { calls.saved++ },
    emit: (key) => { calls.events.push(key) },
    ...over,
  }
  return { deps, calls }
}

test("claims: a ruling already in the ledger is reused on replay; no checker is called or paid again", async () => {
  const { deps, calls } = claimDeps()
  const claims = [claim("A is potent"), claim("B is unsure"), claim("logP is 3.1", "computed", "calc"), claim("not in pool", "literature", "https://other.example")]
  const first = await checkClaims(deps, 1, "tox", claims)
  assert.deepEqual(first, ["[verified] logP is 3.1", "[verified] A is potent", "[contradicted] B is unsure", "[unsupported] not in pool"])
  assert.deepEqual([calls.jev, calls.computed, calls.literature], [1, 1, 1])
  assert.equal(deps.state.escalations, 2)
  assert.ok(Math.abs(deps.state.checkerUsd - 0.3) < 1e-9)
  assert.equal(deps.state.ledger.length, 4)
  assert.equal(new Set(deps.state.ledger.map((r) => r.key)).size, 4)
  // The process dies and the round is replayed with the same reply.
  const again = await checkClaims(deps, 1, "tox", claims)
  assert.deepEqual([...again].sort(), [...first].sort())
  assert.deepEqual([calls.jev, calls.computed, calls.literature], [1, 1, 1], "no checker was called a second time")
  assert.equal(deps.state.escalations, 2, "escalations are not counted twice")
  assert.ok(Math.abs(deps.state.checkerUsd - 0.3) < 1e-9)
  assert.equal(deps.state.ledger.length, 4, "no duplicate ledger rows")
  assert.equal(calls.events.length, 4)
  // A crash half-way: only the claim without a row is checked on replay.
  const half = claimDeps()
  await checkClaims(half.deps, 1, "tox", [claim("A is potent")])
  await checkClaims(half.deps, 1, "tox", [claim("A is potent"), claim("C is selective")])
  assert.equal(half.calls.jev, 2)
  assert.equal(half.deps.state.ledger.length, 2)
  // The same claim in another round or by another member is a new ruling.
  await checkClaims(half.deps, 2, "tox", [claim("A is potent")])
  await checkClaims(half.deps, 1, "chem", [claim("A is potent")])
  assert.equal(half.deps.state.ledger.length, 4)
})

test("claims: past the escalation budget a claim is recorded as unchecked, and no expensive checker runs", async () => {
  const { deps, calls } = claimDeps({ maxEscalations: 1 })
  const lines = await checkClaims(deps, 1, "chem", [claim("x", "computed", "calc"), claim("y", "computed", "calc")])
  assert.deepEqual(lines, ["[verified] x", "[unchecked] y"])
  assert.equal(calls.computed, 1)
  assert.equal(deps.state.ledger[1].note, "escalation budget used up")
})

test("cost: a model that reports tokens but no price is charged at the fallback price", () => {
  assert.deepEqual(usdOf({ a: { cost: { total: 1.25 }, totalTokens: 1000 } }, 15, false), { usd: 1.25, estimated: false })
  const unpriced = usdOf({ a: { cost: { total: 1.25 }, totalTokens: 1000 }, b: { cost: { total: 0 }, totalTokens: 2_000_000 }, c: { totalTokens: 500_000 } }, 15, false)
  assert.ok(Math.abs(unpriced.usd - (1.25 + 30 + 7.5)) < 1e-9, "was 1.25: unpriced models ran under the budget for free")
  assert.equal(unpriced.estimated, true)
  assert.deepEqual(usdOf({ b: { cost: { total: 0 }, totalTokens: 2_000_000 } }, 15, true), { usd: 0, estimated: false }, "scripted models cost nothing")
  assert.deepEqual(usdOf({ b: { cost: { total: 0 }, totalTokens: 0 } }, 15, false), { usd: 0, estimated: false })
})

const addRun = (config: BoardConfig, id: string, state: object) => {
  const dir = join(config.paths.runs, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "run.json"), JSON.stringify({ runId: id, briefFile: "/x/brief.md", startedAt: Date.now(), members: {}, rounds: 0, lastRound: [], evidence: {}, ledger: [], escalations: 0, checkerUsd: 0, ...state }))
  return dir
}

test("resume: a run does not continue past the daily cap, and takes no lock when refused", async () => {
  const config = tempConfig()
  const dir = addRun(config, "paused", { usd: 1 })
  addRun(config, "spent", { usd: 19.5, finished: true })
  await assert.rejects(runBoard("paused", undefined, { config, mock: false }), BudgetReached)
  assert.equal(existsSync(join(dir, "run.lock")), false)
  assert.equal(existsSync(join(dir, "session.sqlite")), false, "nothing was opened")
  addRun(config, "done", { finished: true })
  await runBoard("done", undefined, { config, mock: false }) // a finished run returns at once, cap or not
})

test("daily cap: a run started on an earlier day counts with what it spends today, not with nothing", () => {
  const config = tempConfig()
  const now = new Date(2026, 10, 14, 15, 0, 0), yesterday = new Date(2026, 10, 13, 22, 0, 0)
  // Started yesterday and spent $3 then; resumed today and has spent $4.50 in total.
  const state = { startedAt: yesterday.getTime(), usd: 3, day: undefined as string | undefined, dayBase: undefined as number | undefined }
  rollDay(state, yesterday)
  assert.deepEqual([state.day, state.dayBase], ["2026-11-13", 0])
  assert.equal(todaySpend(state, 3, yesterday), 3)
  assert.equal(todaySpend(state, 3, now), 0, "before it is resumed, none of it is today's")
  rollDay(state, now) // the resume
  assert.deepEqual([state.day, state.dayBase], ["2026-11-14", 3])
  rollDay(state, now)
  assert.equal(state.dayBase, 3, "rolled once per day")
  state.usd = 4.5
  assert.equal(todaySpend(state, 4.5, now), 1.5)
  addRun(config, "resumed", { ...state })
  addRun(config, "old", { startedAt: yesterday.getTime(), usd: 9, finished: true, day: "2026-11-13", dayBase: 0 })
  addRun(config, "old-format-yesterday", { startedAt: yesterday.getTime(), usd: 9, finished: true })
  addRun(config, "today", { startedAt: now.getTime(), usd: 2, day: "2026-11-14", dayBase: 0 })
  assert.equal(spentToday(config, now), 1.5 + 2) // was 2: the resumed run's spend was not counted at all
  // A run written before `day` existed, started on an earlier day and resumed now: only what it spends from here on.
  const legacy = { startedAt: yesterday.getTime(), usd: 3, day: undefined as string | undefined, dayBase: undefined as number | undefined }
  rollDay(legacy, now)
  assert.equal(legacy.dayBase, 3)
})

test("run list numbers come from the event log when run.json has fewer", () => {
  const dir = tmp()
  assert.deepEqual(summarize(dir, { rounds: 3, ledger: [] }), { rounds: 3, claims: 0 }, "no event log")
  writeFileSync(join(dir, "events.jsonl"), '{"key":"round:1","type":"round.started","round":1}\n{"key":"claim:a","type":"claim.checked"}\n{"key":"claim:a","type":"claim.checked"}\n{"key":"claim:b","type":"claim.checked"}\nnot json "claim.checked"\n')
  assert.deepEqual(summarize(dir, { rounds: 0, ledger: [] }), { rounds: 1, claims: 2 })
  assert.deepEqual(summarize(dir, { rounds: 3, ledger: [{}, {}, {}] as never }), { rounds: 3, claims: 3 })
})

// A stand-in for the `claude` command: it records where it runs and what it was given, starts a child of
// its own that would run for a minute, and then either answers or hangs.
function fakeClaude(mode: "answer" | "hang") {
  const dir = tmp(), report = join(dir, "report.json"), script = join(dir, "fake-claude.mjs")
  writeFileSync(script, `
import { spawn } from "node:child_process"
import { writeFileSync, readFileSync } from "node:fs"
const grandchild = spawn("sleep", ["60"], { stdio: "ignore" })
const prompt = readFileSync(0, "utf8")
writeFileSync(${JSON.stringify(report)}, JSON.stringify({ pid: process.pid, cwd: process.cwd(), argv: process.argv.slice(2), env: Object.keys(process.env), grandchild: grandchild.pid, prompt }))
if (${JSON.stringify(mode)} === "answer") { console.log(JSON.stringify({ result: "VERDICT: contradicted\\nRecomputed 2.9, not 3.4.", total_cost_usd: 0.07 })); grandchild.unref(); process.exit(0) }
setInterval(() => {}, 1000)
`)
  return { cmd: `${process.execPath} ${script} -p --restricted`, report: () => JSON.parse(readFileSync(report, "utf8")) as { pid: number; cwd: string; argv: string[]; env: string[]; grandchild: number; prompt: string } }
}
const running = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
/** Stop whatever a stand-in left running, so a failing test ends instead of hanging. */
const cleanUp = (fake: ReturnType<typeof fakeClaude>) => { try { const r = fake.report(); for (const pid of [r.pid, r.grandchild]) try { process.kill(pid, "SIGKILL") } catch { /* gone */ } } catch { /* never started */ } }

test("checker child: runs in an empty scratch folder, without the engine's secrets, and leaves nothing behind", async () => {
  const config = tempConfig(), fake = fakeClaude("answer")
  config.checkers.claude_code_cmd = fake.cmd
  config.checkers.claude_code_tools = "Read Write"
  process.env.BOARD_TEST_DATABASE_URL = "postgres://secret"
  try {
    const ruling = await claudeCodeCheck(config, "logP is 3.4", "calc", false)
    assert.deepEqual(ruling, { verdict: "contradicted", note: "VERDICT: contradicted\nRecomputed 2.9, not 3.4.", usd: 0.07 })
    const seen = fake.report()
    assert.notEqual(realpathSync(process.cwd()), seen.cwd)
    assert.ok(!seen.cwd.startsWith(ROOT), `the child must not run in the repo, where .env is: ${seen.cwd}`)
    assert.match(seen.cwd, /board-check-/)
    assert.equal(existsSync(seen.cwd), false, "the scratch folder is removed")
    assert.deepEqual(seen.argv.slice(-2), ["--allowedTools", "Read Write"])
    assert.ok(seen.argv.includes("--restricted"))
    for (const name of ["BOARD_TEST_DATABASE_URL", "OPENAI_API_KEY", "EXA_API_KEY", "PAST_API_KEY", "OPENROUTER_API_KEY"]) assert.ok(!seen.env.includes(name), name)
    assert.ok(seen.env.includes("PATH"))
    assert.match(seen.prompt, /Claim: logP is 3\.4\. Source: calc\./)
    await sleep(150)
    assert.equal(running(seen.grandchild), false, "a process the checker started does not outlive it")
  } finally { delete process.env.BOARD_TEST_DATABASE_URL; cleanUp(fake) }
})

test("checker child: at the time limit the whole process group is killed and the claim is unsupported", { timeout: 20_000 }, async () => {
  const config = tempConfig(), fake = fakeClaude("hang")
  config.checkers.claude_code_cmd = fake.cmd
  config.checkers.timeout_seconds = 1
  try {
    const started = Date.now()
    const ruling = await claudeCodeCheck(config, "logP is 3.4", "calc", false)
    assert.ok(Date.now() - started < 5_000)
    assert.equal(ruling.verdict, "unsupported")
    assert.match(ruling.note, /checker failed: timed out after 1 s/)
    const seen = fake.report()
    await sleep(200)
    assert.equal(running(seen.pid), false, "the checker's process was killed at the limit")
    assert.equal(running(seen.grandchild), false, "its own child was killed too (it used to survive)")
    assert.equal(existsSync(seen.cwd), false)
  } finally { cleanUp(fake) }
})

test("checker: the default command confines Claude Code, and the default tools cannot run code", () => {
  const config = loadConfig()
  assert.match(config.checkers.claude_code_cmd, /--restricted\b/)
  assert.match(config.checkers.claude_code_cmd, /--strict-mcp-config\b/)
  assert.doesNotMatch(config.checkers.claude_code_tools ?? "", /Bash|WebFetch|WebSearch/)
})
