// The board, on Pi Durable.
//
//   brief ──▶ Lead Scientist (root conversation) ──converse──▶ every member (own conversation, in parallel)
//                                                 ◀── replies + checker verdicts per claim
//             ──write_memo──▶ memo.md + verification_ledger.json
//
// Every model turn, tool call and member reply is committed to board/runs/<run>/session.sqlite before it
// is shown. Kill the process at any point and `resumeRun()` continues where it stopped: tools are
// replay-safe, member inputs carry stable request IDs, and every claim ruling is saved under a stable key
// as soon as it is made, so a finished model turn or claim check is not asked or paid for again. (A
// check that was in flight when the process died is run again.) A lock file keeps two processes off the
// same run.
//
// Lessons from multi-agent failure research (acyclic-labs/sdk research/experiments) built in:
// - Round 1 is blind: members answer before seeing each other (fan-out, not chain), against
//   sycophancy cascades.
// - Peers see each other's arguments with checker verdicts attached, never a vote tally ("the room is
//   4 to 1"), and the lead is told not to reveal its leaning early, against deference.
// - Evidence is screened by Jev before it enters the shared pool, and contradicted claims are marked
//   in every later digest, against error propagation.
// - One budget for the whole run, not per agent. Spend is saved in run.json as it accrues. A model that
//   reports tokens but no cost is charged at meeting.fallback_usd_per_mtok and the run is marked
//   costEstimated, so an unpriced model still reaches the budget.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { bool, obj, str } from "@earendil-works/pi-schema"
import { createRegistry, defineExtension, defineTool, type ConversationId, type EntryId, Harness, type ToolExecutionApi } from "@earendil-works/pi-durable"
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node"
import { type AgentDef, instructionsFor, loadAgent, loadRoster } from "./agents.ts"
import { type Brief, loadBrief } from "./brief.ts"
import { type Claim, parseClaims, stripClaims } from "./claims.ts"
import { claudeCodeCheck, openaiCheck } from "./checkers.ts"
import { type BoardConfig, loadConfig, MOCK, path } from "./config.ts"
import { type Checker, EventLog, type EvidenceItem, type Verdict } from "./events.ts"
import { exaSearch, OBJECTIVE_DESCRIPTION } from "./exa.ts"
import { Jev } from "./jev.ts"
import { buildModels, modelFor } from "./models.ts"

const ctx = BACKGROUND_CONTEXT

interface RunState {
  runId: string
  briefFile: string
  startedAt: number
  members: Record<string, number> // agent name -> conversation id
  rounds: number
  lastRound: { member: string; reply: string; verdicts: string[] }[]
  evidence: Record<string, EvidenceItem>
  ledger: { key?: string; round: number; member: string; claim: string; kind: string; verdict: Verdict; checker: Checker; p?: number; note?: string }[]
  escalations: number
  checkerUsd: number
  jevUsd?: number // Jev spend, kept here because the Jev client's own counter restarts with the process
  usd?: number // running total for the run: models + Jev + escalation checkers
  costEstimated?: boolean // true once a model reported tokens with no cost and the fallback price was used
  mock?: boolean
  finalRound?: number // the round that asked for final positions; no round may follow it
  finished?: boolean
}

export const runDir = (config: BoardConfig, runId: string) => path(config, "runs", runId)

export class BudgetReached extends Error {}

export class RunBusy extends Error {}

const alive = (pid: number) => {
  try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM" }
}

/** The process that holds the run's lock, if it is still alive. */
export function lockHolder(dir: string): number | undefined {
  try {
    const pid = Number(readFileSync(`${dir}/run.lock`, "utf8").trim())
    return Number.isInteger(pid) && pid > 0 && alive(pid) ? pid : undefined
  } catch { return undefined }
}

/**
 * Take the run's lock (board/runs/<run>/run.lock holds our pid) and return the function that releases it.
 * Throws RunBusy while a live process holds it. A lock left by a dead process is taken over.
 */
export function acquireRunLock(dir: string): () => void {
  const file = `${dir}/run.lock`
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      writeFileSync(file, String(process.pid), { flag: "wx" })
      return () => { try { if (readFileSync(file, "utf8").trim() === String(process.pid)) rmSync(file, { force: true }) } catch { /* already gone */ } }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      const holder = lockHolder(dir)
      if (holder !== undefined) throw new RunBusy(`Run is already being worked on by process ${holder}.`)
      // Stale. Only one process wins this rename, so two cannot both take the lock over.
      try { renameSync(file, `${file}.stale.${process.pid}`); rmSync(`${file}.stale.${process.pid}`, { force: true }) } catch { /* another process took it */ }
    }
  }
  throw new RunBusy("Could not take the run lock.")
}

/**
 * Dollars counted against today's cap: every run started today (local time), whatever its state, at the
 * spend saved in its run.json. A run a live process is working on counts for at least its full per-run
 * cap, so several runs started together cannot each pass the check at $0. Scripted runs reserve nothing.
 */
export function spentToday(config: BoardConfig, now = new Date()): number {
  const dir = path(config, "runs")
  if (!existsSync(dir)) return 0
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  let usd = 0
  for (const id of readdirSync(dir)) {
    const file = `${dir}/${id}/run.json`
    if (!existsSync(file)) continue
    let state: Partial<RunState>
    try { state = JSON.parse(readFileSync(file, "utf8")) as Partial<RunState> } catch { continue }
    if ((state.startedAt ?? 0) < midnight) continue
    let spent = state.usd
    if (spent === undefined) { // a run from before spend was saved in run.json: use its closing event
      spent = 0
      const events = `${dir}/${id}/events.jsonl`
      for (const line of existsSync(events) ? readFileSync(events, "utf8").split("\n") : []) {
        if (line.includes('"run.finished"')) try { spent = (JSON.parse(line) as { usd?: number }).usd ?? spent } catch { /* partial line */ }
      }
    }
    const inFlight = !state.finished && !state.mock && lockHolder(`${dir}/${id}`) !== undefined
    usd += inFlight ? Math.max(spent, config.meeting.max_usd) : spent
  }
  return usd
}

/** Throws BudgetReached once today's runs have used the daily cap. Scripted runs cost nothing and always pass. */
export function checkDailyBudget(config: BoardConfig, now = new Date()): void {
  if (MOCK) return
  const today = spentToday(config, now)
  if (today >= config.meeting.daily_usd) throw new BudgetReached(`Daily budget reached: $${today.toFixed(2)} of $${config.meeting.daily_usd} counted for runs started today (running ones count at their full cap). Raise meeting.daily_usd in board/config.yaml or wait until tomorrow.`)
}

const MEMORY_MARK = "## From earlier runs"

/**
 * Long-term memory: add each member's checked claims from this run to its expertise file, which is read
 * into that member's instructions next run. Text above the "## From earlier runs" heading is yours and is
 * kept as it is. Scripted (mock) runs write to the run folder instead, so made-up claims never reach it.
 */
export function rememberRun(config: BoardConfig, runId: string, ledger: { member: string; claim: string; verdict: string; checker: string; note?: string }[], dir = path(config, "expertise")): number {
  if (!config.memory?.enabled) return 0
  mkdirSync(dir, { recursive: true })
  const clean = (t: string) => t.replace(/\s+/g, " ").trim()
  const claimOf = (line: string) => line.replace(/^- \[[^\]]*\] /, "").replace(/ \(why: .*\)$/, "")
  const verdictOf = (line: string) => /^- \[(\w+)/.exec(line)?.[1]
  let written = 0
  for (const member of new Set(ledger.map((e) => e.member))) {
    const file = `${dir}/${member}.md`
    const text = existsSync(file) ? readFileSync(file, "utf8") : `# ${member} expertise\n`
    const cut = text.indexOf(MEMORY_MARK)
    const head = (cut < 0 ? text : text.slice(0, cut)).trimEnd()
    const notes = cut < 0 ? [] : text.slice(cut).split("\n").filter((l) => l.startsWith("- "))
    // The last ruling on each claim in this run is the one to remember.
    const latest = new Map<string, (typeof ledger)[number]>()
    for (const e of ledger) if (e.member === member && (e.verdict === "verified" || e.verdict === "contradicted")) latest.set(clean(e.claim), e)
    let changed = 0
    for (const [claim, e] of latest) {
      const note = `- [${e.verdict} by ${e.checker}, run ${runId}] ${claim}${e.verdict === "contradicted" && e.note ? ` (why: ${clean(e.note).slice(0, 160)})` : ""}`
      const at = notes.findIndex((l) => claimOf(l) === claim)
      if (at < 0) notes.push(note)
      else if (verdictOf(notes[at]) !== e.verdict) notes.splice(at, 1), notes.push(note) // the verdict flipped: the new one replaces the old note
      else continue
      changed++
    }
    if (!changed) continue
    const kept = notes.slice(-(config.memory.max_notes ?? 40))
    writeFileSync(file, `${head}\n\n${MEMORY_MARK}\n\nClaims you made that a checker verified or contradicted. A verified claim still needs a source in the new run. Do not repeat a contradicted one.\n\n${kept.join("\n")}\n`)
    written += changed
  }
  return written
}

export async function startRun(briefFile: string): Promise<string> {
  const config = loadConfig()
  const brief = loadBrief(briefFile, config.brief.required_sections) // throws BriefRejected before anything runs
  checkDailyBudget(config)
  const runId = newRunDir(config, `${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}-${brief.id}`)
  const state: RunState = { runId, briefFile, startedAt: Date.now(), members: {}, rounds: 0, lastRound: [], evidence: {}, ledger: [], escalations: 0, checkerUsd: 0, jevUsd: 0, usd: 0, mock: MOCK }
  saveState(config, state)
  new EventLog(`${runDir(config, runId)}/events.jsonl`).emit("run", { type: "run.started", runId, brief: brief.id, title: brief.title, mock: MOCK })
  return runId
}

/** Create the run's folder and return its id. A second run of the same brief in the same minute gets "-2", "-3"... */
export function newRunDir(config: BoardConfig, base: string): string {
  mkdirSync(path(config, "runs"), { recursive: true })
  for (let n = 1; ; n++) {
    const runId = n === 1 ? base : `${base}-${n}`
    try { mkdirSync(runDir(config, runId)); return runId } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    }
  }
}

/** Run or continue a board. Throws RunBusy if another process is on this run, BudgetReached past the daily cap. */
export async function runBoard(runId: string, onLog?: (log: EventLog) => void): Promise<void> {
  const config = loadConfig()
  if (loadState(config, runId).finished) return
  checkDailyBudget(config) // also on resume, so a restart cannot spend past the cap
  const release = acquireRunLock(runDir(config, runId))
  try { await runLocked(config, runId, onLog) } finally { release() }
}

async function runLocked(config: BoardConfig, runId: string, onLog?: (log: EventLog) => void): Promise<void> {
  const state = loadState(config, runId) // read under the lock
  if (state.finished) return
  const brief = loadBrief(state.briefFile, config.brief.required_sections)
  const lead = loadAgent(config, "lead-scientist")
  const roster = loadRoster(config)
  const log = new EventLog(`${runDir(config, runId)}/events.jsonl`)
  onLog?.(log)
  const models = buildModels([lead, ...roster])
  const jev = new Jev(models, config)
  const jevBefore = state.jevUsd ?? 0
  const save = () => saveState(config, state)

  // ── Tools ──────────────────────────────────────────────────────────────────────────────────────
  const exaTool = defineTool({
    name: "exa_search",
    description: "Search the live web and the scientific literature and return the most relevant URLs with excerpts. Results are screened for relevance before you see them.",
    parameters: obj({
      query: str({ description: "What to retrieve, as plain natural-language intent" }),
      objective: str({ description: OBJECTIVE_DESCRIPTION }),
      key_question: str({ description: "The one question from the brief this search serves" }),
    }),
    replay: "safe",
    execute: async (args, api) => {
      const member = memberOf(api)
      const found = await exaSearch(args.query, args.objective)
      const triaged = await Promise.all(found.items.map((item) => jev.triage(item, args.key_question)))
      const kept = triaged.filter((t) => t.keep).map((t) => t.item)
      for (const item of kept) state.evidence[item.url] = item
      save()
      log.emit(`evidence:${api.callId}`, { type: "evidence.triaged", member, query: args.query, kept: kept.length, dropped: found.items.length - kept.length, items: kept })
      const results = kept.length
        ? kept.map((i) => `- ${i.title} [${i.studyType ?? "?"}] ${i.url}\n  ${i.text}`).join("\n")
        : "Nothing relevant found. Say so in your reply."
      const text = [results, ...found.notices.map((n) => `Note from the search engine: ${n}`)].join("\n\n")
      return { output: [{ type: "text", text }] }
    },
  })

  const converseTool = defineTool({
    name: "converse",
    description: "Address the whole board. Every member replies in parallel; you get their replies with checker verdicts on each claim.",
    parameters: obj({ message: str(), final: bool({ description: "true to ask for final positions" }) }),
    replay: "safe",
    execute: async (args, api) => {
      // The round number and the decision to run it are memoised first, so a replay after a crash runs
      // the same round again instead of counting it as used and refusing it.
      const round = await api.memo<number>("round", state.rounds + 1, ctx)
      const fresh = round > state.rounds
      let refusal = ""
      if (fresh) {
        const limit = overLimit(config, round - 1, state.startedAt, await spend())
        if (state.finalRound !== undefined) refusal = `Final positions are in (round ${state.finalRound}). No further rounds: call write_memo now.`
        else if (limit && !args.final) refusal = `WRAP UP: ${limit.detail}. Call converse once with final=true to ask for final positions, then write_memo.`
        if (refusal && limit) log.emit(`constraint:${round}`, { type: "constraint", reason: limit.reason, detail: limit.detail })
      }
      refusal = await api.memo<string>("gate", refusal, ctx)
      if (refusal) { save(); return { output: [{ type: "text", text: refusal }] } }
      state.rounds = Math.max(state.rounds, round)
      if (args.final) state.finalRound = round // one final round may pass the limits; nothing runs after it
      save()
      log.emit(`round:${round}`, { type: "round.started", round, message: args.message, final: args.final })

      const digest = round === 1 ? "" : peerDigest(state)
      const input = [
        `Round ${round}. Lead Scientist to the board:`,
        args.message,
        round === 1 ? "Work independently: you have not seen the other members' views, on purpose." : digest,
        args.final ? "Give your final position in two sentences." : "Reply with your deliverable.",
      ].filter(Boolean).join("\n\n")

      const replies = await Promise.all(roster.map(async (agent) => {
        const conversation = await api.conversation(state.members[agent.name] as ConversationId, ctx)
        if (!conversation) throw new Error(`No conversation for ${agent.name}`)
        const submission = await conversation.submit({ type: "input", content: input, requestId: `${runId}:r${round}:${agent.name}` }, ctx)
        const settled = await submission.wait(ctx)
        const reply = settled.status === "done" && settled.answer !== undefined ? await answerText(api, settled.answer) : `(no answer: ${"reason" in settled ? settled.reason : "unknown"})`
        return { agent, reply }
      }))

      state.lastRound = []
      for (const { agent, reply } of replies) {
        log.emit(`reply:${round}:${agent.name}`, { type: "member.replied", round, member: agent.name, text: stripClaims(reply), usd: 0 })
        const verdicts = await checkClaims(round, agent, parseClaims(reply))
        state.lastRound.push({ member: agent.title, reply: stripClaims(reply), verdicts })
      }
      const after = overLimit(config, state.rounds, state.startedAt, await spend())
      save()
      const status = args.final ? "\n\nFinal positions are in. Call write_memo now."
        : after ? `\n\nWRAP UP: ${after.detail}. Ask for final positions with final=true.` : ""
      return { output: [{ type: "text", text: peerDigest(state) + status }] }
    },
  })

  const memoTool = defineTool({
    name: "write_memo",
    description: "Write the final memo. Call once, after final positions.",
    parameters: obj({ decision: str({ description: "Go, No-Go, or Go with conditions" }), memo: str({ description: "The full memo in Markdown" }) }),
    replay: "safe",
    execute: async (args) => {
      const dir = runDir(config, runId)
      writeFileSync(`${dir}/memo.md`, args.memo)
      writeFileSync(`${dir}/verification_ledger.json`, JSON.stringify(state.ledger, null, 2))
      log.emit("memo", { type: "memo.written", path: `${dir}/memo.md`, decision: args.decision })
      return { output: [{ type: "text", text: "Memo saved." }], control: { terminate: true } }
    },
  })

  // ── Claim checking: Jev first, escalate only the uncertain band ────────────────────────────────
  async function checkClaims(round: number, agent: AgentDef, claims: Claim[]): Promise<string[]> {
    const lines: string[] = []
    // One ledger row per claim per round, under a stable key. A row that exists is a ruling already made
    // (and paid for): a replay after a crash reuses it instead of calling the checker again.
    const keyOf = (claim: Claim) => `${round}:${agent.name}:${createHash("sha1").update(`${claim.kind}\n${claim.text}\n${claim.source}`).digest("hex").slice(0, 16)}`
    const ruled = (claim: Claim) => {
      const row = state.ledger.find((e) => e.key === keyOf(claim))
      if (row && !lines.includes(`[${row.verdict}] ${claim.text}`)) lines.push(`[${row.verdict}] ${claim.text}`)
      return Boolean(row)
    }
    const record = (claim: Claim, verdict: Verdict, checker: Checker, p?: number, note?: string) => {
      const key = keyOf(claim)
      if (state.ledger.some((e) => e.key === key)) return // the same claim twice in one reply
      state.ledger.push({ key, round, member: agent.name, claim: claim.text, kind: claim.kind, verdict, checker, p, note })
      state.jevUsd = jevBefore + jev.usd
      save()
      log.emit(`claim:${key}`, { type: "claim.checked", round, member: agent.name, claim: claim.text, kind: claim.kind, verdict, checker, p, note })
      lines.push(`[${verdict}] ${claim.text}`)
    }
    const escalate = async (claim: Claim, evidence: string) => {
      if (state.escalations >= (config.meeting.max_escalations ?? 12)) return record(claim, "unchecked", "jev", undefined, "escalation budget used up")
      state.escalations++
      save()
      const ruling = claim.kind === "computed"
        ? await claudeCodeCheck(config, claim.text, claim.source)
        : await openaiCheck(models, config, claim.text, evidence)
      state.checkerUsd += ruling.usd
      record(claim, ruling.verdict, claim.kind === "computed" ? "claude-code" : "openai", undefined, ruling.note)
    }

    // Group claims by the evidence they cite, so Jev reads each piece of evidence once.
    const groups = new Map<string, Claim[]>()
    for (const claim of claims) {
      if (ruled(claim)) continue
      if (claim.kind === "computed") { await escalate(claim, ""); continue } // Jev is not a calculator
      const key = claim.kind === "brief" ? "brief" : claim.source
      groups.set(key, [...(groups.get(key) ?? []), claim])
    }
    for (const [source, group] of groups) {
      const evidence = source === "brief" ? briefEvidence(brief) : state.evidence[source]?.text
      if (!evidence) { for (const c of group) record(c, "unsupported", "jev", undefined, "source is not in the screened evidence pool"); continue }
      const results = await jev.check(group.map((c) => c.text), evidence)
      for (const [i, r] of results.entries()) {
        if (r.verdict === "escalate") await escalate(group[i], evidence)
        else record(group[i], r.verdict, "jev", r.p)
      }
    }
    save()
    return lines
  }

  // ── Harness ────────────────────────────────────────────────────────────────────────────────────
  const registry = createRegistry()
  registry.install(defineExtension({ name: "board", tools: [exaTool, converseTool, memoTool] }))
  const harness = await Harness.open(await openNodeSqliteStorage(`${runDir(config, runId)}/session.sqlite`), {
    models, registry,
    identity: { attribution: { name: "drug-board", url: "https://github.com/" } },
    settings: { retry: { maxRetries: 3 }, toolExecution: "parallel" },
  }, ctx)
  // The run's spend so far, also kept in state.usd (callers save). A model that reports tokens but no
  // cost is charged at the fallback price, so it cannot run under the budget for free.
  const spend = async () => {
    const usage = await harness.usage(ctx)
    let usd = 0
    for (const u of Object.values(usage.models)) {
      const cost = u.cost?.total ?? 0
      if (cost > 0 || MOCK || !u.totalTokens) { usd += cost; continue }
      usd += (u.totalTokens / 1e6) * (config.meeting.fallback_usd_per_mtok ?? 15)
      state.costEstimated = true
    }
    state.jevUsd = jevBefore + jev.usd
    state.usd = usd + state.jevUsd + state.checkerUsd
    return state.usd
  }

  const leadConversation = await harness.root(ctx, {
    agent: { model: modelFor(config, lead), instructions: instructionsFor(config, lead, brief, roster), tools: [converseTool, memoTool], maxTurns: config.meeting.lead_turns ?? 20 },
  })
  for (const agent of roster) {
    if (state.members[agent.name]) continue
    const c = await harness.createConversation({
      ownership: { kind: "ownerless" },
      agent: { model: modelFor(config, agent), instructions: instructionsFor(config, agent, brief, roster), tools: agent.tools.includes("exa_search") ? [exaTool] : [], maxTurns: config.meeting.member_turns ?? 6 },
    }, ctx)
    state.members[agent.name] = c.id
    save()
  }
  const memberOf = (api: ToolExecutionApi) =>
    Object.entries(state.members).find(([, id]) => id === api.conversationId)?.[0] ?? "lead-scientist"

  harness.resume() // continue anything a previous process left unfinished
  try {
    const kickoff = await leadConversation.submit({ type: "input", content: "Begin. Frame the decision in one paragraph, then run the board.", requestId: `${runId}:begin` }, ctx)
    const settled = await kickoff.wait(ctx)
    if (settled.status !== "done") throw new Error(`Lead stopped: ${settled.reason}`)
    // Spend, memory and the closing event are written before the run is marked finished. A crash in
    // between repeats these three steps on resume, and each is safe to repeat.
    const usd = await spend()
    save()
    rememberRun(config, runId, state.ledger, MOCK ? `${runDir(config, runId)}/expertise` : undefined)
    log.emit("finished", { type: "run.finished", usd, minutes: (Date.now() - state.startedAt) / 60_000 })
    state.finished = true
    save()
  } catch (error) {
    try { await spend(); save() } catch { /* keep the last saved spend */ }
    log.emit(`failed:${Date.now()}`, { type: "run.failed", error: String(error) })
    throw error
  } finally {
    await harness.close(ctx)
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────
/** The limit reached after `rounds` completed rounds, if any. */
export function overLimit(config: BoardConfig, rounds: number, startedAt: number, usd: number) {
  const minutes = (Date.now() - startedAt) / 60_000
  if (rounds >= config.meeting.max_rounds) return { reason: "rounds" as const, detail: `${rounds} of ${config.meeting.max_rounds} rounds used` }
  if (minutes >= config.meeting.max_minutes) return { reason: "time" as const, detail: `${minutes.toFixed(1)} of ${config.meeting.max_minutes} minutes used` }
  if (usd >= config.meeting.max_usd) return { reason: "budget" as const, detail: `$${usd.toFixed(2)} of $${config.meeting.max_usd} spent` }
  return undefined
}

// Arguments with verdicts, never a tally.
function peerDigest(state: RunState): string {
  return "What the board said last round (checker verdicts in brackets; treat [contradicted] as false):\n\n" +
    state.lastRound.map((r) => `### ${r.member}\n${r.reply}${r.verdicts.length ? "\n" + r.verdicts.map((v) => `  ${v}`).join("\n") : ""}`).join("\n\n")
}

const briefEvidence = (brief: Brief) => [brief.sections["Candidates"], brief.sections["Available Data"]].join("\n")

async function answerText(api: ToolExecutionApi, entryId: EntryId): Promise<string> {
  const entry = await api.commit((tx) => tx.entry(entryId), ctx)
  const message = entry?.model?.find((m: { role: string }) => m.role === "assistant")
  if (!message || message.role !== "assistant") return ""
  return message.content.map((c: { type: string; text?: string }) => (c.type === "text" ? c.text ?? "" : "")).join("")
}

function saveState(config: BoardConfig, state: RunState) {
  writeFileSync(`${runDir(config, state.runId)}/run.json`, JSON.stringify(state, null, 2))
}

export function loadState(config: BoardConfig, runId: string): RunState {
  const file = `${runDir(config, runId)}/run.json`
  if (!existsSync(file)) throw new Error(`No run ${runId}`)
  return JSON.parse(readFileSync(file, "utf8")) as RunState
}
