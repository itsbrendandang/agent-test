// The board, on Pi Durable.
//
//   brief ──▶ Lead Scientist (root conversation) ──converse──▶ every member (own conversation, in parallel)
//                                                 ◀── replies + checker verdicts per claim
//             ──write_memo──▶ memo.md + verification_ledger.json
//
// Every model turn, tool call and member reply is committed to board/runs/<run>/session.sqlite before it
// is shown. Kill the process at any point and `resumeRun()` continues where it stopped: tools are
// replay-safe, member inputs carry stable request IDs, so nothing is asked or paid for twice.
//
// Lessons from multi-agent failure research (acyclic-labs/sdk research/experiments) built in:
// - Round 1 is blind: members answer before seeing each other (fan-out, not chain), against
//   sycophancy cascades.
// - Peers see each other's arguments with checker verdicts attached, never a vote tally ("the room is
//   4 to 1"), and the lead is told not to reveal its leaning early, against deference.
// - Evidence is screened by Jev before it enters the shared pool, and contradicted claims are marked
//   in every later digest, against error propagation.
// - One budget for the whole run, not per agent. Unknown cost is recorded as unknown, not zero.
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
  ledger: { round: number; member: string; claim: string; kind: string; verdict: Verdict; checker: Checker; p?: number; note?: string }[]
  escalations: number
  checkerUsd: number
  finished?: boolean
}

export const runDir = (config: BoardConfig, runId: string) => path(config, "runs", runId)

export class BudgetReached extends Error {}

/** Dollars spent by finished runs that started today (local time), from their event logs. */
export function spentToday(config: BoardConfig, now = new Date()): number {
  const dir = path(config, "runs")
  if (!existsSync(dir)) return 0
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  let usd = 0
  for (const id of readdirSync(dir)) {
    const file = `${dir}/${id}/events.jsonl`
    if (!existsSync(file) || !existsSync(`${dir}/${id}/run.json`)) continue
    if ((JSON.parse(readFileSync(`${dir}/${id}/run.json`, "utf8")) as { startedAt: number }).startedAt < midnight) continue
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.includes('"run.finished"')) usd += (JSON.parse(line) as { usd?: number }).usd ?? 0
    }
  }
  return usd
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
  let written = 0
  for (const member of new Set(ledger.map((e) => e.member))) {
    const file = `${dir}/${member}.md`
    const text = existsSync(file) ? readFileSync(file, "utf8") : `# ${member} expertise\n`
    const cut = text.indexOf(MEMORY_MARK)
    const head = (cut < 0 ? text : text.slice(0, cut)).trimEnd()
    const old = cut < 0 ? [] : text.slice(cut).split("\n").filter((l) => l.startsWith("- "))
    const seen = new Set(old.map(claimOf))
    const fresh: string[] = []
    for (const e of ledger) {
      if (e.member !== member || (e.verdict !== "verified" && e.verdict !== "contradicted") || seen.has(clean(e.claim))) continue
      seen.add(clean(e.claim))
      fresh.push(`- [${e.verdict} by ${e.checker}, run ${runId}] ${clean(e.claim)}${e.verdict === "contradicted" && e.note ? ` (why: ${clean(e.note).slice(0, 160)})` : ""}`)
    }
    if (!fresh.length) continue
    const kept = [...old, ...fresh].slice(-(config.memory.max_notes ?? 40))
    writeFileSync(file, `${head}\n\n${MEMORY_MARK}\n\nClaims you made that a checker verified or contradicted. A verified claim still needs a source in the new run. Do not repeat a contradicted one.\n\n${kept.join("\n")}\n`)
    written += fresh.length
  }
  return written
}

export async function startRun(briefFile: string): Promise<string> {
  const config = loadConfig()
  const brief = loadBrief(briefFile, config.brief.required_sections) // throws BriefRejected before anything runs
  const today = spentToday(config)
  if (today >= config.meeting.daily_usd) throw new BudgetReached(`Daily budget reached: $${today.toFixed(2)} of $${config.meeting.daily_usd} spent by runs started today. Raise meeting.daily_usd in board/config.yaml or wait until tomorrow.`)
  const runId = `${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}-${brief.id}`
  mkdirSync(runDir(config, runId), { recursive: true })
  const state: RunState = { runId, briefFile, startedAt: Date.now(), members: {}, rounds: 0, lastRound: [], evidence: {}, ledger: [], escalations: 0, checkerUsd: 0 }
  saveState(config, state)
  new EventLog(`${runDir(config, runId)}/events.jsonl`).emit("run", { type: "run.started", runId, brief: brief.id, title: brief.title, mock: MOCK })
  return runId
}

export async function runBoard(runId: string, onLog?: (log: EventLog) => void): Promise<void> {
  const config = loadConfig()
  const state = loadState(config, runId)
  if (state.finished) return
  const brief = loadBrief(state.briefFile, config.brief.required_sections)
  const lead = loadAgent(config, "lead-scientist")
  const roster = loadRoster(config)
  const log = new EventLog(`${runDir(config, runId)}/events.jsonl`)
  onLog?.(log)
  const models = buildModels([lead, ...roster])
  const jev = new Jev(models, config)
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
      const limit = overLimit(config, state, await spend())
      if (limit && !args.final) {
        log.emit(`constraint:${state.rounds}`, { type: "constraint", reason: limit.reason, detail: limit.detail })
        return { output: [{ type: "text", text: `WRAP UP: ${limit.detail}. Call converse with final=true to ask for final positions, then write_memo.` }] }
      }
      const round = await api.memo<number>("round", state.rounds + 1, ctx) // stable across a replay
      state.rounds = Math.max(state.rounds, round)
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
      save()
      const after = overLimit(config, state, await spend())
      const status = after && !args.final ? `\n\nWRAP UP: ${after.detail}. Ask for final positions with final=true.` : ""
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
    const record = (claim: Claim, verdict: Verdict, checker: Checker, p?: number, note?: string) => {
      state.ledger.push({ round, member: agent.name, claim: claim.text, kind: claim.kind, verdict, checker, p, note })
      log.emit(`claim:${round}:${agent.name}:${claim.text.slice(0, 60)}`, { type: "claim.checked", round, member: agent.name, claim: claim.text, kind: claim.kind, verdict, checker, p, note })
      lines.push(`[${verdict}] ${claim.text}`)
    }
    const escalate = async (claim: Claim, evidence: string) => {
      if (state.escalations >= (config.meeting.max_escalations ?? 12)) return record(claim, "unchecked", "jev", undefined, "escalation budget used up")
      state.escalations++
      const ruling = claim.kind === "computed"
        ? await claudeCodeCheck(config, claim.text, claim.source)
        : await openaiCheck(models, config, claim.text, evidence)
      state.checkerUsd += ruling.usd
      record(claim, ruling.verdict, claim.kind === "computed" ? "claude-code" : "openai", undefined, ruling.note)
    }

    // Group claims by the evidence they cite, so Jev reads each piece of evidence once.
    const groups = new Map<string, Claim[]>()
    for (const claim of claims) {
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
  const spend = async () => {
    const usage = await harness.usage(ctx)
    const models = Object.values(usage.models).reduce((sum, u) => sum + (u.cost?.total ?? 0), 0)
    return models + jev.usd + state.checkerUsd
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
    state.finished = true
    save()
    rememberRun(config, runId, state.ledger, MOCK ? `${runDir(config, runId)}/expertise` : undefined)
    log.emit("finished", { type: "run.finished", usd: await spend(), minutes: (Date.now() - state.startedAt) / 60_000 })
  } catch (error) {
    log.emit(`failed:${Date.now()}`, { type: "run.failed", error: String(error) })
    throw error
  } finally {
    await harness.close(ctx)
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────
function overLimit(config: BoardConfig, state: RunState, usd: number) {
  const minutes = (Date.now() - state.startedAt) / 60_000
  if (state.rounds >= config.meeting.max_rounds) return { reason: "rounds" as const, detail: `${state.rounds} of ${config.meeting.max_rounds} rounds used` }
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
