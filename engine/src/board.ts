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
// check that was in flight when the process died is run again.) A lock file (runlock.ts) keeps two
// processes off the same run.
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
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { bool, obj, str } from "@earendil-works/pi-schema"
import { createRegistry, defineExtension, defineTool, type ConversationId, type EntryId, Harness, type ToolExecutionApi } from "@earendil-works/pi-durable"
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node"
import { type AgentDef, instructionsFor, loadAgent, loadRoster } from "./agents.ts"
import { type Brief, loadBrief } from "./brief.ts"
import { type Claim, parseClaims, stripClaims } from "./claims.ts"
import { claudeCodeCheck, openaiCheck } from "./checkers.ts"
import { type BoardConfig, loadConfig, MOCK, path } from "./config.ts"
import { refusePaid } from "./paid.ts"
import { type Checker, EventLog, type EvidenceItem, type Verdict } from "./events.ts"
import { exaSearch, OBJECTIVE_DESCRIPTION } from "./exa.ts"
import { Jev } from "./jev.ts"
import { buildModels, modelFor } from "./models.ts"
import { holder, take } from "./runlock.ts"

const ctx = BACKGROUND_CONTEXT

export interface RunState {
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
  day?: string // the local day (YYYY-MM-DD) the run last worked on, and what it had spent before that day,
  dayBase?: number // so the daily cap counts only today's part of a run that started on an earlier day
  costEstimated?: boolean // true once a model reported tokens with no cost and the fallback price was used
  mock?: boolean
  finalRound?: number // the round that asked for final positions; no round may follow it
  finished?: boolean
}

export const runDir = (config: BoardConfig, runId: string) => path(config, "runs", runId)

export class BudgetReached extends Error {}

export class RunBusy extends Error {}

/**
 * Refuse to continue a run that was started with real models while paid calls are off. Continuing it would
 * either spend, or put scripted turns into a real record. A finished run and a scripted run pass.
 */
export function refusePaidRun(state: Pick<RunState, "runId" | "finished" | "mock">): void {
  if (!state.finished && state.mock !== true) refusePaid(`continuing board run ${state.runId}, which was started with real models`)
}

/** The process that holds the run's lock (board/runs/<run>/run.lock), if it is still alive. See runlock.ts. */
export const lockHolder = (dir: string): number | undefined => holder(`${dir}/run.lock`)

/**
 * Take the run's lock and return the function that releases it. Throws RunBusy while a live process holds
 * it (also this process, if it is already working on the run). A lock left by a dead process is taken over.
 * The lock is also released when the process exits or is stopped with SIGTERM or SIGINT.
 */
export function acquireRunLock(dir: string): () => void {
  const taken = take(`${dir}/run.lock`)
  if (typeof taken === "function") return taken
  throw new RunBusy(`Run is already being worked on by process ${taken.busy}.`)
}

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

/** Note that the run is working today. On the first call of a new day, what it had spent before becomes the day's base. */
export function rollDay(state: Pick<RunState, "day" | "dayBase" | "usd" | "startedAt">, now = new Date()): void {
  const today = dayKey(now)
  if (state.day === today) return
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  // On the day a run started, everything it spends counts. On a later day, only what it spends from now on.
  state.dayBase = state.day === undefined && state.startedAt >= midnight ? 0 : state.usd ?? 0
  state.day = today
}

/** What a run spent today: all of it on the day it started, and only the part since midnight when resumed later. */
export function todaySpend(state: Partial<RunState>, spent: number, now = new Date()): number {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (state.day === dayKey(now)) return Math.max(0, spent - (state.dayBase ?? 0))
  if (state.day !== undefined) return 0 // it last worked on an earlier day
  return (state.startedAt ?? 0) >= midnight ? spent : 0 // a run from before `day` was saved
}

/**
 * Dollars counted against today's cap (local time): what every run spent today, whatever its state, from
 * the spend saved in its run.json. A run started on an earlier day and resumed today counts with what it
 * spent since the resume. A run a live process is working on counts for at least its full per-run cap, so
 * several runs started together cannot each pass the check at $0. Scripted runs reserve nothing.
 * (Two starts in the same instant can still both pass: the check and the lock are not one step.)
 */
export function spentToday(config: BoardConfig, now = new Date()): number {
  const dir = path(config, "runs")
  if (!existsSync(dir)) return 0
  let usd = 0
  for (const id of readdirSync(dir)) {
    const file = `${dir}/${id}/run.json`
    if (!existsSync(file)) continue
    let state: Partial<RunState>
    try { state = JSON.parse(readFileSync(file, "utf8")) as Partial<RunState> } catch { continue }
    let spent = state.usd
    if (spent === undefined) { // a run from before spend was saved in run.json: use its closing event
      spent = 0
      const events = `${dir}/${id}/events.jsonl`
      for (const line of existsSync(events) ? readFileSync(events, "utf8").split("\n") : []) {
        if (line.includes('"run.finished"')) try { spent = (JSON.parse(line) as { usd?: number }).usd ?? spent } catch { /* partial line */ }
      }
    }
    const today = todaySpend(state, spent, now)
    const inFlight = !state.finished && !state.mock && lockHolder(`${dir}/${id}`) !== undefined
    usd += inFlight ? Math.max(today, config.meeting.max_usd) : today
  }
  return usd
}

/** Throws BudgetReached once today's runs have used the daily cap. Scripted runs cost nothing and always pass. */
export function checkDailyBudget(config: BoardConfig, now = new Date(), mock = MOCK): void {
  if (mock) return
  const today = spentToday(config, now)
  if (today >= config.meeting.daily_usd) throw new BudgetReached(`Daily budget reached: $${today.toFixed(2)} of $${config.meeting.daily_usd} counted for today's runs (running ones count at their full cap). Raise meeting.daily_usd in board/config.yaml or wait until tomorrow.`)
}

/**
 * Rounds and checked claims of a run for the run list. Read from run.json and from the event log, and the
 * larger number wins: the two can disagree for runs written by older versions, and the event log is what
 * the dashboard shows when the run is opened.
 */
export function summarize(dir: string, state: Pick<RunState, "rounds" | "ledger">): { rounds: number; claims: number } {
  let rounds = state.rounds ?? 0
  const claims = new Set<string>()
  try {
    for (const line of readFileSync(`${dir}/events.jsonl`, "utf8").split("\n")) {
      if (!line.includes('"round.started"') && !line.includes('"claim.checked"')) continue
      try {
        const e = JSON.parse(line) as { type?: string; key?: string; round?: number }
        if (e.type === "round.started" && typeof e.round === "number") rounds = Math.max(rounds, e.round)
        if (e.type === "claim.checked") claims.add(e.key ?? line)
      } catch { /* partial line */ }
    }
  } catch { /* no event log */ }
  return { rounds, claims: Math.max(state.ledger?.length ?? 0, claims.size) }
}

/**
 * The run's model spend from the harness's usage. A model that reports tokens but no cost is charged at
 * `fallbackPerMtok` dollars per million tokens (and `estimated` is true), so it cannot run under the budget
 * for free. Scripted models cost nothing.
 */
export function usdOf(models: Record<string, { cost?: { total?: number }; totalTokens?: number }>, fallbackPerMtok: number, mock: boolean): { usd: number; estimated: boolean } {
  let usd = 0, estimated = false
  for (const u of Object.values(models)) {
    const cost = u.cost?.total ?? 0
    if (cost > 0 || mock || !u.totalTokens) { usd += cost; continue }
    usd += (u.totalTokens / 1e6) * fallbackPerMtok
    estimated = true
  }
  return { usd, estimated }
}

export type Memo = <T extends string | number>(name: string, candidate: T) => Promise<T>

/**
 * Decide whether the lead's next converse call runs a round. The round number and the decision are
 * memoised (`memo` returns the stored value on a replay), so a replay after a crash runs the same round
 * again instead of counting it as used and refusing it. Returns the refusal text, "" when the round runs.
 * - After a round that asked for final positions, no round may follow.
 * - Past a limit (rounds, minutes, dollars), only one round with final=true may still run.
 */
export async function gateRound(
  state: Pick<RunState, "rounds" | "startedAt" | "finalRound">, config: BoardConfig, final: boolean, memo: Memo, spend: () => Promise<number>,
  onLimit?: (round: number, limit: NonNullable<ReturnType<typeof overLimit>>) => void,
): Promise<{ round: number; refusal: string }> {
  const round = await memo<number>("round", state.rounds + 1)
  const fresh = round > state.rounds
  let refusal = ""
  if (fresh) {
    const limit = overLimit(config, round - 1, state.startedAt, await spend())
    if (state.finalRound !== undefined) refusal = `Final positions are in (round ${state.finalRound}). No further rounds: call write_memo now.`
    else if (limit && !final) refusal = `WRAP UP: ${limit.detail}. Call converse once with final=true to ask for final positions, then write_memo.`
    if (refusal && limit) onLimit?.(round, limit)
  }
  refusal = await memo<string>("gate", refusal)
  return { round, refusal }
}

/** What claim checking needs from the run. The checkers are passed in, so tests can count their calls. */
export interface ClaimDeps {
  state: Pick<RunState, "ledger" | "escalations" | "checkerUsd">
  maxEscalations: number
  /** Jev rules on several claims against one piece of evidence. */
  jevCheck: (claims: string[], evidence: string) => Promise<{ verdict: Verdict | "escalate"; p?: number }[]>
  computedCheck: (claim: Claim) => Promise<{ verdict: Verdict; note: string; usd: number }>
  literatureCheck: (claim: Claim, evidence: string) => Promise<{ verdict: Verdict; note: string; usd: number }>
  /** The screened evidence text for a source ("brief" for the brief), or undefined when it is not in the pool. */
  evidenceFor: (source: string) => string | undefined
  save: () => void
  emit: (key: string, event: { type: "claim.checked"; round: number; member: string; claim: string; kind: string; verdict: Verdict; checker: Checker; p?: number; note?: string }) => void
}

/**
 * Rule on a member's claims: Jev first, the expensive checkers only for what Jev leaves undecided (and for
 * computed claims). Returns one "[verdict] claim" line per claim. Each ruling is one ledger row under a
 * stable key, saved as soon as it is made. A row that exists is a ruling already made (and paid for): a
 * replay after a crash reuses it instead of calling a checker again.
 */
export async function checkClaims(deps: ClaimDeps, round: number, member: string, claims: Claim[]): Promise<string[]> {
  const { state } = deps
  const lines: string[] = []
  const keyOf = (claim: Claim) => `${round}:${member}:${createHash("sha1").update(`${claim.kind}\n${claim.text}\n${claim.source}`).digest("hex").slice(0, 16)}`
  const ruled = (claim: Claim) => {
    const row = state.ledger.find((e) => e.key === keyOf(claim))
    if (row && !lines.includes(`[${row.verdict}] ${claim.text}`)) lines.push(`[${row.verdict}] ${claim.text}`)
    return Boolean(row)
  }
  const record = (claim: Claim, verdict: Verdict, checker: Checker, p?: number, note?: string) => {
    const key = keyOf(claim)
    if (state.ledger.some((e) => e.key === key)) return // the same claim twice in one reply
    state.ledger.push({ key, round, member, claim: claim.text, kind: claim.kind, verdict, checker, p, note })
    deps.save()
    deps.emit(`claim:${key}`, { type: "claim.checked", round, member, claim: claim.text, kind: claim.kind, verdict, checker, p, note })
    lines.push(`[${verdict}] ${claim.text}`)
  }
  const escalate = async (claim: Claim, evidence: string) => {
    if (state.escalations >= deps.maxEscalations) return record(claim, "unchecked", "jev", undefined, "escalation budget used up")
    state.escalations++
    deps.save()
    const ruling = claim.kind === "computed" ? await deps.computedCheck(claim) : await deps.literatureCheck(claim, evidence)
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
    const evidence = deps.evidenceFor(source)
    if (!evidence) { for (const c of group) record(c, "unsupported", "jev", undefined, "source is not in the screened evidence pool"); continue }
    const results = await deps.jevCheck(group.map((c) => c.text), evidence)
    for (const [i, r] of results.entries()) {
      if (r.verdict === "escalate") await escalate(group[i], evidence)
      else record(group[i], r.verdict, "jev", r.p)
    }
  }
  deps.save()
  return lines
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

/**
 * Run or continue a board. Throws RunBusy if another process is on this run, BudgetReached past the daily
 * cap. `options` replace the config file and the mock switch (for tests).
 */
export async function runBoard(runId: string, onLog?: (log: EventLog) => void, options: { config?: BoardConfig; mock?: boolean } = {}): Promise<void> {
  const config = options.config ?? loadConfig()
  if (loadState(config, runId).finished) return
  refusePaidRun(loadState(config, runId))
  checkDailyBudget(config, new Date(), options.mock ?? MOCK) // also on resume, so a restart cannot spend past the cap
  const release = acquireRunLock(runDir(config, runId))
  try { await runLocked(config, runId, onLog) } finally { release() }
}

async function runLocked(config: BoardConfig, runId: string, onLog?: (log: EventLog) => void): Promise<void> {
  const state = loadState(config, runId) // read under the lock
  if (state.finished) return
  refusePaidRun(state)
  const brief = loadBrief(state.briefFile, config.brief.required_sections)
  const lead = loadAgent(config, "lead-scientist")
  const roster = loadRoster(config)
  const log = new EventLog(`${runDir(config, runId)}/events.jsonl`)
  onLog?.(log)
  const models = buildModels([lead, ...roster])
  const jev = new Jev(models, config)
  const jevBefore = state.jevUsd ?? 0
  const save = () => saveState(config, state)
  rollDay(state) // from here on the run counts against today's cap
  save()

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
      // The round number and the decision to run it are memoised first (see gateRound).
      const { round, refusal } = await gateRound(state, config, args.final, <T extends string | number>(name: string, candidate: T) => api.memo<T>(name, candidate, ctx), spend,
        (r, limit) => log.emit(`constraint:${r}`, { type: "constraint", reason: limit.reason, detail: limit.detail }))
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
        const verdicts = await checkClaims(claimDeps, round, agent.name, parseClaims(reply))
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

  // ── Claim checking: Jev first, escalate only the uncertain band (see checkClaims) ─────────────────
  const claimDeps: ClaimDeps = {
    state,
    maxEscalations: config.meeting.max_escalations ?? 12,
    jevCheck: (claims, evidence) => jev.check(claims, evidence),
    computedCheck: (claim) => claudeCodeCheck(config, claim.text, claim.source),
    literatureCheck: (claim, evidence) => openaiCheck(models, config, claim.text, evidence),
    evidenceFor: (source) => (source === "brief" ? briefEvidence(brief) : state.evidence[source]?.text),
    save: () => { state.jevUsd = jevBefore + jev.usd; save() },
    emit: (key, event) => log.emit(key, event),
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
    const models = usdOf(usage.models, config.meeting.fallback_usd_per_mtok ?? 15, MOCK)
    if (models.estimated) state.costEstimated = true
    rollDay(state) // before the total changes: a run that works past midnight starts a new day's count
    state.jevUsd = jevBefore + jev.usd
    state.usd = models.usd + state.jevUsd + state.checkerUsd
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
