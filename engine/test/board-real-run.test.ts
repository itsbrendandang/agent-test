// What a first real run depends on, tested with fakes only (fetch is a spy that answers from a table, models are the
// real providers behind a faked network, keys are fake). NO_PAID_CALLS is 1 except inside the one test that needs
// paid-allowed logic (restored after it).
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { test } from "node:test"

process.env.NO_PAID_CALLS = "1"
const realFetch = globalThis.fetch
type Handler = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined
let handler: Handler = () => undefined
const requests: { url: string; method: string }[] = []
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.startsWith("http://127.0.0.1:")) return realFetch(input, init)
  requests.push({ url, method: init?.method ?? "GET" })
  const answer = await handler(url, init)
  if (answer) return answer
  throw new Error(`a test tried to reach ${url}`)
}) as typeof fetch

const board = await import("../src/board.ts")
const { startRun, runBoard, loadState, evidenceBlock, memberInput, replyPhases, summarize, providerOf } = board
const { loadConfig } = await import("../src/config.ts")
const { loadAgent, loadRoster } = await import("../src/agents.ts")
const { shortSummary } = await import("../src/claims.ts")
const { EventLog } = await import("../src/events.ts")
const { runPreflight, WORST_CASE } = await import("../src/preflight.ts")
const { FatalModelError, isFatalModelError, describeModelFailure } = await import("../src/providers.ts")
const { createApp } = await import("../src/app.ts")
const { agentsFor, efforts, planFrom, rankAgents } = await import("../src/chat/plan.ts")
const { boardMembers, buildCatalog } = await import("../src/chat/catalog.ts")
import type { BoardConfig } from "../src/config.ts"
import type { EvidenceItem } from "../src/events.ts"

const BRIEF = join(import.meta.dirname, "../../board/briefs/kras-g12c-hit-to-lead.md")
const KEYS = { ANTHROPIC_API_KEY: "fake-anthropic", OPENAI_API_KEY: "fake-openai", EXA_API_KEY: "fake-exa" }
const tempConfig = (over: Partial<BoardConfig["meeting"]> = {}): BoardConfig => {
  const base = loadConfig(), dir = mkdtempSync(join(tmpdir(), "real-run-"))
  return { ...base, paths: { ...base.paths, runs: join(dir, "runs"), expertise: join(dir, "expertise") }, meeting: { ...base.meeting, ...over } }
}
const lines = (log: string[]) => (line: string) => { log.push(line) }

// ── 7. the summary line ───────────────────────────────────────────────────────────────────────────

test("the 'In short:' line is parsed in code into `summary`; replies that do not open that way have none", async () => {
  assert.equal(shortSummary("In short: CMP-0517 fails the hERG margin.\n\nDetails follow."), "CMP-0517 fails the hERG margin.")
  assert.equal(shortSummary("**In short:** it holds up.\n\nmore"), "it holds up.")
  assert.equal(shortSummary("\n  in short : lower case works too"), "lower case works too")
  assert.equal(shortSummary("In short: " + "x".repeat(400))?.length, 300)
  for (const none of ["", "Plan: do this. In short: not at the start", "In short:", "In short:   \n", "Summary: x"]) assert.equal(shortSummary(none), undefined, JSON.stringify(none))
  // In a run: the event carries it; an old event without the field still loads and reads.
  const config = tempConfig(), brief = BRIEF
  const id = await startRun(brief, { config, mock: true })
  await runBoard(id, undefined, { config, mock: true })
  const replies = EventLog.read(join(config.paths.runs, id, "events.jsonl")).filter((e) => e.type === "member.replied") as { text: string; summary?: string }[]
  assert.ok(replies.length > 0 && replies.every((r) => typeof r.summary === "string" && r.summary.length > 0), "scripted members open with In short:")
  assert.ok(replies.every((r) => !r.text.startsWith("CLAIMS")))
  const old = join(mkdtempSync(join(tmpdir(), "old-events-")), "events.jsonl")
  writeFileSync(old, JSON.stringify({ type: "member.replied", round: 1, member: "x", text: "hello", usd: 0, key: "k", at: 1 }) + "\n")
  assert.equal((EventLog.read(old)[0] as { summary?: string }).summary, undefined)
})

// ── 4. search attribution ─────────────────────────────────────────────────────────────────────────

test("evidence events and the run summary say where the sources came from; the catalog says what a run would use", async () => {
  assert.equal(providerOf(true), "fixture"); assert.equal(providerOf(false), "exa")
  const config = tempConfig()
  const id = await startRun(BRIEF, { config, mock: true })
  await runBoard(id, undefined, { config, mock: true })
  const dir = join(config.paths.runs, id)
  const evidence = EventLog.read(`${dir}/events.jsonl`).filter((e) => e.type === "evidence.triaged") as { provider?: string; items: EvidenceItem[] }[]
  assert.ok(evidence.length >= 1)
  assert.ok(evidence.every((e) => e.provider === "fixture" && e.items.every((i) => i.provider === "fixture")), "a practice run's sources are labelled fixture")
  assert.deepEqual(summarize(dir, loadState(config, id)).search, { searches: evidence.length, provider: "fixture" })
  assert.ok(Object.values(loadState(config, id).evidence).every((i) => i.provider === "fixture"))
  // The list the dashboard reads carries it.
  const listed = createApp({ config }).listRuns().find((r) => r.id === id) as { search?: { provider?: string } }
  assert.equal(listed.search?.provider, "fixture")
  // An old run (no provider on its events) still loads: `search` has a count and no provider.
  const oldDir = join(config.paths.runs, "old"); mkdirSync(oldDir, { recursive: true })
  writeFileSync(`${oldDir}/events.jsonl`, JSON.stringify({ type: "evidence.triaged", member: "x", query: "q", kept: 1, dropped: 0, items: [], key: "e", at: 1 }) + "\n")
  assert.deepEqual(summarize(oldDir, { rounds: 0, ledger: [] }).search, { searches: 1 })
  assert.equal(summarize(join(config.paths.runs, "nothing"), { rounds: 0, ledger: [] }).search, undefined)
  // The catalog: practice-run sources while paid calls are off or the board is scripted; Exa only for a real run with the key.
  assert.equal(buildCatalog(config, { NO_PAID_CALLS: "1", EXA_API_KEY: "k" }).search.provider, "fixture")
  assert.equal(buildCatalog(config, { NO_PAID_CALLS: "0", EXA_API_KEY: "k" }).search.provider, "exa")
  assert.equal(buildCatalog(config, { NO_PAID_CALLS: "0" }).search.provider, "fixture", "no key: the run would be refused, never searched live")
  assert.equal(buildCatalog(config, { NO_PAID_CALLS: "0", EXA_API_KEY: "k", DRUG_BOARD_MOCK: "1" }).search.provider, "fixture")
  const lit = buildCatalog(config, {}).search.literature
  assert.deepEqual([lit.provider, lit.free, lit.keyNeeded], ["europepmc", true, false], "the free literature search is listed")
  assert.equal(lit.available, boardMembers(config).members.some((m) => m.tools.includes("literature_search")), "available follows the roster")
})

// ── 1. evidence reaches the members ───────────────────────────────────────────────────────────────

test("the member that searches replies first; the others get the sources in their prompt, escaped, and can cite them", async () => {
  const config = loadConfig(), roster = loadRoster(config)
  const phases = replyPhases(roster)
  assert.equal(phases.length, 2)
  assert.deepEqual(phases[0].map((a) => a.name), roster.filter((a) => a.tools.includes("exa_search")).map((a) => a.name))
  assert.ok(phases[0].some((a) => a.name === "scout") && phases[1].every((a) => !a.tools.includes("exa_search")), "the scout, who searches, speaks before the members who need what it found")
  assert.equal(phases[0].length + phases[1].length, roster.length)
  assert.equal(replyPhases(roster.filter((a) => !a.tools.includes("exa_search"))).length, 1, "no searcher: one phase")
  assert.equal(replyPhases(roster.filter((a) => a.tools.includes("exa_search"))).length, 1, "only searchers: one phase")

  const pool: Record<string, EvidenceItem> = {}
  for (let i = 0; i < 14; i++) pool[`https://x.example/${i}`] = { url: `https://x.example/${i}`, title: `Paper ${i} <b>bold</b>`, text: `Finding ${i}: IC50 was ${i} nM. ${"y".repeat(900)}`, studyType: "in_vitro", provider: i === 0 ? "fixture" : "exa" }
  const block = evidenceBlock(pool)
  assert.match(block, /^Sources the board has found so far/)
  assert.ok(block.includes("https://x.example/0") && block.includes("https://x.example/11") && !block.includes("https://x.example/12"), "12 are listed")
  assert.match(block, /\(2 more are in the pool and not listed here\)/)
  assert.ok(!block.includes("<b>") && block.includes("&lt;b>bold"), "web text is escaped: it cannot open a tag")
  assert.ok(block.includes("practice-run example source"), "a fixture source says so")
  assert.ok(block.split("\n").every((l) => l.length < 900), "each source is cut to 600 characters of text")
  assert.equal(evidenceBlock({}), "")
  // What a member is given: the pool for a non-searcher, none for the scout (it made it).
  const withPool = memberInput({ round: 2, message: "go", digest: "DIGEST", final: false, pool: block })
  assert.ok(withPool.includes("Sources the board has found so far") && withPool.includes("DIGEST") && withPool.includes("Reply with your deliverable."))
  assert.ok(!memberInput({ round: 2, message: "go", digest: "DIGEST", final: false, pool: "" }).includes("Sources the board"))
  assert.ok(memberInput({ round: 1, message: "go", digest: "", final: false, pool: block }).includes("Work independently"))

  // End to end (a scripted run, 4 members): the pool is in the stored prompts of the members that do not search, and a
  // member's [literature] claim that cites a pooled source is checked against that source's text.
  const cfg = tempConfig(); cfg.board = ["scout", "proposer", "methods-auditor", "critic"]
  const id = await startRun(BRIEF, { config: cfg, mock: true })
  await runBoard(id, undefined, { config: cfg, mock: true })
  const db = new DatabaseSync(join(cfg.paths.runs, id, "session.sqlite"))
  let withEvidence = 0
  for (const table of db.prepare("select name from sqlite_master where type='table'").all() as { name: string }[])
    for (const row of db.prepare(`select * from ${table.name}`).all()) if (JSON.stringify(row, (_k, v) => (v instanceof Uint8Array ? Buffer.from(v).toString("utf8") : v)).includes("Sources the board has found so far")) withEvidence++
  assert.ok(withEvidence >= 3, `the non-searching members were given the sources (found in ${withEvidence} stored entries)`)
  const state = loadState(cfg, id)
  const literature = state.ledger.filter((r) => r.kind === "literature")
  assert.ok(literature.length >= 2 && literature.every((r) => r.source && state.evidence[r.source]), "each literature claim cites a source that is in the pool")
  assert.ok(literature.some((r) => r.verdict === "verified" && r.quoteFound === true), "one holds up against its source")
  assert.ok(literature.some((r) => r.verdict === "contradicted" && r.quoteFound === true), "one is proven wrong by its source")
})

// ── 2. plans ──────────────────────────────────────────────────────────────────────────────────────

test("every plan, at every effort level, has the member that searches and a member that makes checkable claims, and only narrows the roster", () => {
  const config = loadConfig()
  const { lead, members } = boardMembers(config)
  const gatherer = members.find((m) => m.tools.includes("exa_search"))!
  const roster = new Set(members.map((m) => m.name))
  const questions = ["Is compound CMP-0517 a viable KRAS G12C hit?", "hERG liability of piperazine acrylamides", "zebra stripes", "", "toxicology review and critic opinion of dosing"]
  for (const effort of efforts(config)) for (const question of questions) {
    const agents = agentsFor(effort, rankAgents(question, members), lead, members)
    const names = agents.map((a) => a.name)
    assert.equal(names[0], lead.name)
    assert.ok(names.includes(gatherer.name), `${effort.id} / "${question}": the scout is in the plan`)
    assert.ok(names.some((n) => n !== lead.name && n !== gatherer.name && /claim/i.test(members.find((m) => m.name === n)?.deliverable ?? "")), `${effort.id}: a member whose deliverable is claims is in the plan: ${names}`)
    assert.ok(names.slice(1).every((n) => roster.has(n)), "only names that are on the board")
    assert.equal(new Set(names).size, names.length, "no member twice")
    if (effort.agents !== "all") assert.ok(names.length <= 1 + effort.agents, `${effort.id} has at most the lead and ${effort.agents} members`)
  }
  // The plan carries the effort's own limits, still within the config caps.
  for (const effort of efforts(config)) {
    const plan = planFrom({ config, mock: true, env: {} }, "Is compound CMP-0517 a viable KRAS G12C hit?", effort.id).plan
    assert.ok(plan.agents.some((a) => a.name === gatherer.name) && plan.limits.maxUsd <= config.meeting.max_usd && plan.limits.maxRounds <= config.meeting.max_rounds)
    assert.equal(plan.search.exa, false, "no search is claimed while paid calls are off")
  }
})

// ── 3. wording ────────────────────────────────────────────────────────────────────────────────────

test("what a person reads in a practice-run plan says 'practice run', not 'scripted'; machine fields are unchanged", () => {
  const config = loadConfig()
  const record = planFrom({ config, mock: true, env: {} }, "Is compound CMP-0517 a viable KRAS G12C hit?", "standard")
  const human = JSON.stringify({ models: record.plan.models, warnings: record.plan.warnings, estimate: record.plan.estimate })
  assert.ok(!/scripted/i.test(human), human)
  assert.match(human, /practice run/i)
  assert.match(record.plan.warnings.join(" "), /fixed example text written in advance, not research/)
  assert.deepEqual(record.plan.models, { lead: "practice run", members: "practice run", checker: "practice run" })
  assert.equal(record.plan.paid, false)
})

// ── 6. first-run safety ───────────────────────────────────────────────────────────────────────────

test("--max-usd (startRun maxUsd) can only lower a run's cap", async () => {
  const config = tempConfig({ max_usd: 5 })
  const lowered = await startRun(BRIEF, { config, mock: true, maxUsd: 0.5 })
  const { applyOverrides } = board
  assert.equal(applyOverrides(config, lowered).meeting.max_usd, 0.5)
  const same = await startRun(BRIEF, { config, mock: true, maxUsd: 50 })
  assert.equal(existsSync(join(config.paths.runs, same, "overrides.json")), false, "a value above the cap changes nothing")
  assert.equal(applyOverrides(config, same).meeting.max_usd, 5)
  for (const bad of [0, -1, NaN, Infinity]) await assert.rejects(startRun(BRIEF, { config, mock: true, maxUsd: bad }), /--max-usd must be a positive number/, String(bad))
})

test("a refused model id or key is a fatal error with a plain message naming tier, model and vendor", () => {
  for (const fatal of ["404 {\"type\":\"error\",\"error\":{\"type\":\"not_found_error\",\"message\":\"model: x\"}}", "401 Incorrect API key provided", "403 permission_error", "The model `gpt-5-mini` does not exist or you do not have access to it", "authentication_error: invalid x-api-key"])
    assert.equal(isFatalModelError(fatal), true, fatal)
  for (const transient of ["429 rate_limit_error", "503 Service Unavailable", "overloaded_error", "Connection error.", "fetch failed", "", undefined]) assert.equal(isFatalModelError(transient as string), false, String(transient))
  const config = loadConfig()
  const message = describeModelFailure(config, "anthropic", "claude-haiku-5-5", "404 not_found_error")
  assert.match(message, /tier "cheap" \(anthropic\/claude-haiku-5-5\)/); assert.match(message, /model was not found/); assert.match(message, /npm run preflight/); assert.match(message, /Nothing more was spent/)
  assert.match(describeModelFailure(config, "openai", "gpt-5-mini", "401 Incorrect API key"), /key was refused.*OPENAI_API_KEY|OPENAI_API_KEY/)
})

test("a 404 on the first model call ends the real run at once: plain message, no retries, run marked failed, not left running", async () => {
  const config = tempConfig({ max_usd: 5 })
  const saved: Record<string, string | undefined> = { NO_PAID_CALLS: process.env.NO_PAID_CALLS, ...Object.fromEntries(Object.keys(KEYS).map((k) => [k, process.env[k]])) }
  Object.assign(process.env, KEYS, { NO_PAID_CALLS: "0" }) // paid-allowed logic with fakes only: the network below is a table
  const anthropic: string[] = []
  handler = (url) => {
    if (url.includes("api.anthropic.com")) { anthropic.push(url); return new Response(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "model: claude-sonnet-5-5" } }), { status: 404, headers: { "content-type": "application/json" } }) }
    return undefined
  }
  try {
    const id = await startRun(BRIEF, { config, mock: false })
    const started = Date.now()
    await assert.rejects(runBoard(id, undefined, { config }), (error: unknown) => error instanceof FatalModelError && /tier "lead".*\(anthropic\/claude-sonnet-5-5\)/.test(error.message) && /model was not found/.test(error.message))
    assert.ok(Date.now() - started < 20_000, "it did not wait for retries")
    assert.ok(anthropic.length <= 2, `at most one failed call went out, not a retry loop: ${anthropic.length}`)
    const state = loadState(config, id)
    assert.match(state.failed ?? "", /tier "lead"/)
    assert.equal(state.finished, undefined)
    const failed = EventLog.read(join(config.paths.runs, id, "events.jsonl")).filter((e) => e.type === "run.failed") as { error: string }[]
    assert.equal(failed.length, 1); assert.match(failed[0].error, /^The run was stopped on its first failed call/)
    assert.equal(existsSync(join(config.paths.runs, id, "run.lock")), false, "the lock is released")
    const listed = createApp({ config, mock: false }).listRuns().find((r) => r.id === id) as { status: string; error?: string }
    assert.equal(listed.status, "failed"); assert.match(listed.error ?? "", /model was not found/)
    assert.equal(requests.some((r) => r.url.includes("openai.com") || r.url.includes("exa.ai")), false, "nothing else was called")
  } finally {
    handler = () => undefined
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  }
})

// ── 5. preflight ──────────────────────────────────────────────────────────────────────────────────

function listFetch(plan: { anthropic?: number | string[]; openai?: number | string[] }) {
  const sent: { url: string; method: string; headers: Record<string, string>; body?: unknown }[] = []
  const fetcher = (async (url: string, init?: RequestInit) => {
    sent.push({ url: String(url), method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body })
    const which = String(url).includes("anthropic") ? plan.anthropic : plan.openai
    if (typeof which === "number") return new Response("{}", { status: which })
    return new Response(JSON.stringify({ data: (which ?? []).map((id) => ({ id })) }), { status: 200 })
  }) as unknown as typeof fetch
  return { fetcher, sent }
}
const IDS = { anthropic: ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"], openai: ["gpt-5-mini", "gpt-4o-mini", "gpt-5.5"] }
const preflight = (env: NodeJS.ProcessEnv, fetcher: typeof fetch, config = tempConfig()) => { const out: string[] = []; return runPreflight({ env, fetch: fetcher, config, log: lines(out) }).then((result) => ({ result, out: out.join("\n") })) }

test("preflight: all good -> passes, calls only the two model-list endpoints with GET, prints caps and a worst case, never a key", async () => {
  const { fetcher, sent } = listFetch(IDS)
  const { result, out } = await preflight({ ...KEYS }, fetcher)
  assert.equal(result.ok, true, out)
  assert.deepEqual(sent.map((s) => `${s.method} ${s.url.split("?")[0]}`).sort(), ["GET https://api.anthropic.com/v1/models", "GET https://api.openai.com/v1/models"])
  assert.ok(sent.every((s) => s.body === undefined), "no request body: nothing is asked of a model")
  assert.ok(!out.includes("fake-anthropic") && !out.includes("fake-openai") && !out.includes("fake-exa"), "no key is printed")
  assert.match(out, /Endpoints called: GET https:\/\/api\.anthropic\.com\/v1\/models, GET https:\/\/api\.openai\.com\/v1\/models\. No completion, no search/)
  assert.match(out, /Caps: max_usd \$\d/); assert.match(out, /max_searches 20/); assert.match(out, /Exa: \$0\.00 used of the \$40 ceiling/)
  assert.match(out, /Worst case for one run, an ESTIMATE: about \$\d/)
  assert.ok((result.worstCaseUsd ?? 0) > 0 && WORST_CASE.inputTokens > 0)
  assert.match(out, /EXA_API_KEY: set \(not tested/)
  for (const tier of ["lead", "strong", "cheap", "rival", "first_pass.alt"]) assert.match(out, new RegExp(`✓ tier ${tier.replace(".", "\\.")}:`))
})

test("preflight: a model id the vendor does not list fails and names the tier and the id", async () => {
  const { fetcher } = listFetch({ anthropic: ["claude-sonnet-5-5"], openai: IDS.openai })
  const { result, out } = await preflight({ ...KEYS }, fetcher)
  assert.equal(result.ok, false)
  assert.ok(result.problems.some((p) => /tier cheap: anthropic\/claude-haiku-5-5 is not in anthropic's model list/.test(p)), out)
  assert.match(out, /✗ tier cheap/)
})

test("preflight: a refused key, a missing key and an unreachable vendor each fail and are named", async () => {
  let r = await preflight({ ...KEYS }, listFetch({ anthropic: 401, openai: IDS.openai }).fetcher)
  assert.equal(r.result.ok, false); assert.ok(r.result.problems.some((p) => /anthropic refused the key in ANTHROPIC_API_KEY \(HTTP 401\)/.test(p)))
  r = await preflight({ ...KEYS }, listFetch({ anthropic: IDS.anthropic, openai: 403 }).fetcher)
  assert.ok(r.result.problems.some((p) => /openai refused the key/.test(p)))
  const noOpenai = listFetch(IDS)
  r = await preflight({ ANTHROPIC_API_KEY: "k", EXA_API_KEY: "k" }, noOpenai.fetcher)
  assert.equal(r.result.ok, false); assert.ok(r.result.problems.some((p) => /OPENAI_API_KEY is not set \(needed by: rival, first_pass\.alt\)/.test(p)))
  assert.deepEqual(noOpenai.sent.map((s) => s.url.includes("openai")), [false], "a vendor with no key is not called")
  r = await preflight({ ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k" }, listFetch(IDS).fetcher)
  assert.ok(r.result.problems.some((p) => /EXA_API_KEY is not set/.test(p)), "the scout searches, so Exa's key is needed")
  const down = (async () => { throw new Error("getaddrinfo ENOTFOUND") }) as unknown as typeof fetch
  r = await preflight({ ...KEYS }, down)
  assert.ok(r.result.problems.some((p) => /did not answer the model-list request/.test(p)))
})

test("preflight refuses when the paid switch is locked, and sends nothing", async () => {
  const { fetcher, sent } = listFetch(IDS)
  for (const locked of [{ PAID_SWITCH_LOCKED: "1" }, { NODE_TEST_CONTEXT: "child-v8" }]) {
    const { result, out } = await preflight({ ...KEYS, ...locked }, fetcher)
    assert.deepEqual([result.ok, result.refused], [false, true]); assert.match(out, /Preflight refused: the paid switch is locked/)
  }
  assert.equal(sent.length, 0)
  assert.equal((await preflight({ ...KEYS, NODE_TEST_CONTEXT: "child-v8", PAID_SWITCH_LOCKED: "0" }, fetcher)).result.refused, undefined, "an explicit 0 opens it, for this test's own use")
})
