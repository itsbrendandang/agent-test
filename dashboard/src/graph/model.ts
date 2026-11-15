// Pure functions from run data to a graph. No React, no DOM, no network: tested against the real API shapes.
//
// Board run (events of GET /api/runs/:id/events, roster from GET /api/roster):
//   run.started            -> run node (title, brief, mock flag)
//   round.started          -> round node; chain of rounds
//   member.replied         -> member node; edge member -> round (replied in)
//   evidence.triaged       -> source nodes; edge member -> source (kept)
//   claim.checked          -> claim node (one per member and claim text; later rounds update it); edges member -> claim
//                             (wrote down), checker -> claim (ruled on), claim -> round; a claim of kind "brief" cites the
//                             brief; a claim with a `source` field cites that source
//   memo.written           -> output node (the decision memo)
//   run.finished / failed  -> facts of the run node
// Swarm run (GET /api/glhf/runs/:id, its ledger):
//   ledger.events phase.started / phase.skipped -> turn nodes, in order
//   claims                 -> claim nodes; role (proposed_by) -> claim; claim -> output (artifact_ids)
//   claims[].registered / tests / pending_tests -> test nodes; test -> claim; role -> test (planned, ran)
//   issues                 -> problem nodes; role -> problem (raised_by, and issue.resolved events); problem -> output
//   run.artifacts          -> output nodes with the grader's score; run -> output
// Not recorded, so never drawn: who a member replied to, which role wrote an output, which claim a problem is about, and
// (on runs from before the `source` field) which source a board claim cites.
import type { BoardEvent, RosterMember } from "@/board/api"
import type { LedgerClaim, LedgerEvent, RunDetail } from "@/swarm/api"
import { ROLES, roleOf } from "@/swarm/roles"
import { outcomeOf } from "@/lib/verdict"
import { markCounts, markOf, REAL, type Mark as Found } from "@/lib/words"
import type { Fact, GraphLink, GraphModel, GraphNode, LinkKind, Mark, NodeKind, Outcome, Stats, Step, Verdict } from "./types"
import { LINK_VERB } from "./words"

const str = (x: unknown): string => (typeof x === "string" ? x : typeof x === "number" && Number.isFinite(x) ? String(x) : "")
const num = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) ? x : undefined)
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim()
const fmt = (n: number | undefined, digits = 3) => (n === undefined ? "" : String(Number(n.toPrecision(digits))))
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim()
const quote = (s: string, n = 110) => `“${clip(oneLine(s), n)}”`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
/** A short stable code for a text, for ids. */
const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36) }
/** The node of a review's statement: who made it and what it says. Other views link to it (lib/links.ts graphLink). */
export const claimNodeId = (member: string, claim: string) => `claim:${member}:${hash(norm(claim))}`
/** The node of a source a review's search kept. */
export const sourceNodeId = (url: string) => `source:${url}`
export const safeUrl = (u: string): string | undefined => {
  try { const p = new URL(u); return p.protocol === "http:" || p.protocol === "https:" ? p.href : undefined } catch { return undefined }
}
const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p
/** The first sentence of a text, cut to fit: the board's members open their replies with a one-line summary. */
const firstSentence = (s: string, n = 140) => clip(oneLine(s).split(/(?<=[.!?])\s/)[0] ?? "", n)

const BOARD_VERDICT: Record<string, Outcome> = { verified: "holds", contradicted: "fails", unsupported: "unknown", unchecked: "unknown" }
const SWARM_VERDICT: Record<string, Outcome> = { supported: "holds", refuted: "fails", insufficient: "unknown", untested: "unknown" }
/** The class of the engine's verdict word, or "unknown" for a word this dashboard does not know (it is never guessed to hold). */
export const verdictOf = (raw: string, table: Record<string, Outcome>): Verdict => ({ cls: table[raw] ?? "unknown", raw: raw || "unknown" })
export const boardVerdict = (raw: string) => verdictOf(raw, BOARD_VERDICT)
export const swarmVerdict = (raw: string) => verdictOf(raw, SWARM_VERDICT)
export { outcomeOf }

/** "first-pass" is the cheap first checker; older runs call the same stage "jev". */
const CHECKERS: Record<string, { id: string; label: string; what: string }> = {
  "first-pass": { id: "first-pass", label: "First check", what: "A cheaper model, from another vendor than the team members', reads the statement against its source." },
  jev: { id: "first-pass", label: "First check", what: "A cheaper model, from another vendor than the team members', reads the statement against its source (called Jev in older runs)." },
  openai: { id: "openai", label: "Second, more careful check (OpenAI)", what: "Looks again at the statements the first check could not settle." },
  "claude-code": { id: "claude-code", label: "Second, more careful check (Claude Code)", what: "Recalculates a calculated statement by running code." },
  "source-check": { id: "source-check", label: "Checked against the linked record", what: "Built-in example only: each statement was compared by hand with the public record it links to, on the date the example was made. No model checked it." },
}
const checkerOf = (raw: string) => CHECKERS[raw] ?? { id: raw, label: `${raw} check`, what: "A checker named in the run." }

interface Draft extends GraphNode { count: Record<string, number>; rounds?: number[]; rulings?: { round: number; verdict: string; checker: string; note?: string; p?: number; by?: string }[] }

/** Collects nodes and links. A link to a node that does not exist is dropped, and the same link is never added twice. */
class Builder {
  nodes = new Map<string, Draft>()
  links = new Map<string, GraphLink>()
  node(id: string, kind: NodeKind, label: string, order: number, init: Partial<GraphNode> = {}): Draft {
    const old = this.nodes.get(id)
    if (old) { old.order = Math.min(old.order, order); return old }
    const n: Draft = { id, kind, label: clip(oneLine(label) || id, 80), order, attention: 0, facts: [], activity: [], count: {}, ...init }
    this.nodes.set(id, n)
    return n
  }
  link(kind: LinkKind, source: string, target: string, order: number, label?: string): void {
    if (!this.nodes.has(source) || !this.nodes.has(target) || source === target) return
    const id = `${kind}|${source}|${target}`
    if (this.links.has(id)) return
    this.links.set(id, { id, source, target, kind, order, label: label ?? LINK_VERB[kind] })
  }
  /** A link appears when both of its ends are there. */
  finish(): { nodes: GraphNode[]; links: GraphLink[] } {
    const nodes = [...this.nodes.values()].map(({ count: _count, rounds: _rounds, rulings: _rulings, ...n }) => n as GraphNode)
    const at = new Map(nodes.map((n) => [n.id, n.order]))
    const links = [...this.links.values()].map((l) => ({ ...l, order: Math.max(l.order, at.get(l.source) ?? 0, at.get(l.target) ?? 0) }))
    return { nodes, links }
  }
}

const SAYS: Record<Found, string> = { supported: "it was supported", contradicted: "it was contradicted", insufficient: "the evidence was insufficient", unchecked: "it was not checked" }
const bump = (n: Draft, key: string, by = 1) => { n.count[key] = (n.count[key] ?? 0) + by }

/** Counts of a set of nodes, for the headline. Swarm verdicts "insufficient" and "untested" are one group, as elsewhere. */
export function statsOf(nodes: readonly GraphNode[]): Stats {
  const s: Stats = { members: 0, claims: 0, byVerdict: {}, byOutcome: { holds: 0, fails: 0, unknown: 0 }, rounds: 0, problems: 0, problemsFixed: 0, outputs: 0, tests: 0 }
  for (const n of nodes) {
    if (n.kind === "agent") s.members++
    else if (n.kind === "phase") s.rounds++
    else if (n.kind === "test") s.tests++
    else if (n.kind === "artifact") s.outputs++
    else if (n.kind === "issue") { s.problems++; if (n.facts.some((f) => f.label === "Status" && f.value === "fixed")) s.problemsFixed++ }
    else if (n.kind === "claim") { s.claims++; const w = n.verdict?.raw ?? "unknown"; s.byVerdict[w] = (s.byVerdict[w] ?? 0) + 1; s.byOutcome[n.verdict?.cls ?? "unknown"]++ }
  }
  return s
}

// ── Board ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface BoardInput {
  runId: string; events: readonly BoardEvent[]; roster?: RosterMember[]
  /** The Graph view's built-in example: drawn in lanes by round, with no clock and no cost beyond $0. */
  example?: { retrievedOn: string }
}

export function buildBoardGraph({ runId, events, roster = [], example }: BoardInput): GraphModel {
  const b = new Builder()
  const rosterOf = (name: string) => roster.find((m) => m.name === name)
  // Events in the order they happened: by their own timestamp, ties by their place in the list.
  const sorted = events.map((e, i) => ({ e, i })).sort((x, y) => (num(x.e.at) ?? 0) - (num(y.e.at) ?? 0) || x.i - y.i).map((x) => x.e)
  const started = sorted.find((e): e is Extract<BoardEvent, { type: "run.started" }> => e.type === "run.started")
  const t0 = num(sorted[0]?.at)
  const run = b.node("run", "run", started?.title || runId, 0, {
    facts: [{ label: "Run", value: runId }, ...(started ? [{ label: "Brief", value: started.brief }] : [])],
  })
  const scripted: boolean | undefined = typeof started?.mock === "boolean" ? started.mock : undefined
  let status: GraphModel["status"] = "running"
  let finishedFact: Fact[] = []
  const constraints: string[] = []
  const marks: Mark[] = []
  const steps: Step[] = []
  const pendingSources: { claim: string; source: string; order: number }[] = []
  let prevRound: number | undefined
  /** The round each source was first kept in, and each round's subject: the lanes of the example. */
  const sourceRound = new Map<string, number>()
  const roundTitle = new Map<number, string>()
  const briefNode = (order: number) => b.node("source:brief", "source", "The brief", order, {
    facts: [{ label: "What it is", value: `The brief the board was given${started ? ` (${started.brief})` : ""}. Statements of kind "brief" are checked against the brief.` }],
  })
  const agent = (name: string, order: number) => {
    const r = rosterOf(name)
    const a = b.node(`agent:${name}`, "agent", r?.title || name, order, {
      facts: [{ label: "Name", value: name }, ...(r ? [{ label: "Place on the team", value: `${r.role} (from the engine's current roster)` }] : [])],
    })
    b.link("involves", "run", a.id, order)
    return a
  }
  const round = (n: number, order: number) => b.node(`phase:${n}`, "phase", `Round ${n}`, order, { round: n })

  sorted.forEach((e, idx) => {
    const order = idx + 1
    const at = !example && t0 !== undefined && num(e.at) !== undefined ? e.at - t0 : undefined
    let label = "Something was recorded."
    let involved: string[] = []
    switch (e.type) {
      case "run.started": label = `The run begins: ${e.title || runId}.`; involved = ["run"]; break
      case "run.resumed": label = "The run was resumed."; break
      case "round.started": {
        const p = round(e.round, order)
        const title = str(e.title)
        if (title) { roundTitle.set(e.round, title); p.label = clip(oneLine(`Round ${e.round}: ${title}`), 80) }
        p.facts = [{ label: "Round", value: String(e.round) }, ...(title ? [{ label: "Subject", value: title }] : []), { label: "Final positions", value: e.final ? "yes" : "no" }]
        p.text = e.message
        marks.push({ label: title ? `${e.round}. ${title}` : `Round ${e.round}`, order })
        if (prevRound === undefined) b.link("next", "run", p.id, order); else b.link("next", `phase:${prevRound}`, p.id, order)
        prevRound = e.round
        label = `Round ${e.round} opens. The lead's instruction: ${quote(firstSentence(e.message, 160), 170)}`
        involved = [p.id]
        break
      }
      case "lead.framed": {
        const r = roster.find((m) => m.role === "lead")
        const a = b.node("agent:lead", "agent", r?.title || "Lead", order, { facts: [{ label: "Place on the team", value: "lead" }] })
        b.link("framed", a.id, "run", order)
        const text = str((e as { text?: unknown }).text)
        a.activity.push({ label: "Framed the question", text })
        label = `${a.label} frames the question: ${quote(firstSentence(text))}`
        involved = [a.id]
        break
      }
      case "member.replied": {
        const a = agent(e.member, order), p = round(e.round, order)
        b.link("replied", a.id, p.id, order)
        bump(a, "replies"); bump(p, "replies")
        a.activity.push({ label: `Round ${e.round}: replied`, text: e.text })
        label = `Round ${e.round}: ${a.label} replies: ${quote(firstSentence(e.text))}`
        involved = [a.id, p.id]
        break
      }
      case "evidence.triaged": {
        const a = agent(e.member, order)
        a.activity.push({ label: "Searched", text: `${e.query} (kept ${e.kept}, dropped ${e.dropped})` })
        const ids = [a.id]
        for (const item of Array.isArray(e.items) ? e.items : []) {
          const s = b.node(sourceNodeId(item.url), "source", item.title || item.url, order, {
            url: safeUrl(item.url), text: str((item as { text?: unknown }).text) || undefined,
            facts: [
              { label: "Address", value: item.url },
              ...(item.studyType ? [{ label: "Study type", value: item.studyType }] : []),
              ...(num((item as { relevance?: unknown }).relevance) !== undefined ? [{ label: "Relevance score", value: fmt(num((item as { relevance?: unknown }).relevance), 2) }] : []),
            ],
          })
          const notice = (item as { notice?: unknown }).notice as { type?: unknown; url?: unknown; date?: unknown; what?: unknown } | undefined
          if (notice && typeof notice === "object" && str(notice.what) && !s.flag) {
            const type = notice.type === "retraction" || notice.type === "expression of concern" ? notice.type : "correction"
            s.flag = { type, what: str(notice.what), url: safeUrl(str(notice.url)), date: str(notice.date) || undefined }
            s.attention = type === "retraction" ? 2 : 1
            s.facts.push({ label: "Published notice", value: `${type}${s.flag.date ? ` (${s.flag.date})` : ""}` }, { label: "What was wrong", value: s.flag.what }, ...(s.flag.url ? [{ label: "Notice", value: s.flag.url }] : []))
          }
          if (prevRound !== undefined && !sourceRound.has(s.id)) sourceRound.set(s.id, prevRound)
          b.link("retrieved", a.id, s.id, order)
          bump(s, "retrievals"); s.activity.push({ label: "Kept after screening", text: `${a.label}, for the search "${e.query}"` })
          ids.push(s.id)
        }
        label = `${a.label} searches for ${quote(e.query, 80)}: kept ${plural(e.kept, "source")}, dropped ${e.dropped}.`
        involved = ids
        break
      }
      case "claim.checked": {
        const a = agent(e.member, order), p = round(e.round, order)
        const ck = checkerOf(e.checker)
        const id = claimNodeId(e.member, e.claim)
        const c = b.node(id, "claim", e.claim, order, { text: e.claim, round: e.round })
        const chk = b.node(`checker:${ck.id}`, "checker", ck.label, order, { facts: [{ label: "Checker", value: ck.what }] })
        c.rounds = [...(c.rounds ?? []), e.round]
        c.rulings = [...(c.rulings ?? []), { round: e.round, verdict: e.verdict, checker: ck.label, note: e.note, p: num(e.p), by: str((e as { checkedBy?: unknown }).checkedBy) || undefined }]
        c.verdict = boardVerdict(e.verdict) // the latest ruling stands
        c.attention = c.verdict.cls === "fails" ? 2 : c.verdict.cls === "unknown" ? 1 : 0
        c.facts = [{ label: "Said by", value: a.label }, { label: "Kind of statement", value: e.kind }]
        c.activity = c.rulings.map((r) => ({ label: `Round ${r.round}: ${r.verdict}`, text: `${r.checker}${r.by ? ` (${r.by})` : ""}${num(r.p) !== undefined ? `, score ${fmt(r.p)}` : ""}${r.note ? `. ${r.note}` : ""}` }))
        b.link("made", a.id, c.id, order); b.link("ruled", chk.id, c.id, order); b.link("in-phase", c.id, p.id, order)
        if (e.kind === "brief") b.link("cites", c.id, briefNode(order).id, order)
        const source = str((e as { source?: unknown }).source)
        if (source && e.kind !== "brief") pendingSources.push({ claim: id, source, order })
        bump(a, "claims:" + id); bump(chk, "ruled:" + id)
        involved = [a.id, c.id, chk.id]
        label = `Round ${e.round}: ${ck.label.charAt(0).toLowerCase()}${ck.label.slice(1)} on ${a.label}'s statement ${quote(e.claim, 90)}: ${SAYS[markOf(e.verdict)]}.`
        break
      }
      case "constraint": constraints.push(`${e.reason}: ${e.detail}`); label = `The run wraps up early (${e.reason}): ${clip(oneLine(e.detail), 140)}`; involved = ["run"]; break
      case "memo.written": {
        const m = b.node("artifact:memo", "artifact", `Decision: ${e.decision}`, order, {
          text: e.decision, facts: [{ label: "Decision", value: e.decision }, { label: "File", value: baseName(e.path) }],
        })
        b.link("produced", "run", m.id, order)
        label = `The decision memo is written. Decision: ${e.decision}.`
        involved = [m.id]
        break
      }
      case "run.finished":
        status = "done"
        if (example) { finishedFact = [{ label: "Cost", value: "$0: no model was called" }]; label = "The record ends. No model was called and nothing was paid."; involved = ["run"]; break }
        finishedFact = [{ label: "Cost", value: `$${e.usd.toFixed(2)}` }, { label: "Took", value: `${fmt(e.minutes, 2)} minutes` }]
        label = `The run ends. It took ${fmt(e.minutes, 2)} minutes and cost $${e.usd.toFixed(2)}.`; involved = ["run"]
        break
      case "run.failed": status = "failed"; finishedFact = [{ label: "Error", value: e.error }]; label = `The run failed: ${clip(oneLine(e.error), 160)}`; involved = ["run"]; break
      default: break
    }
    steps.push({ label, at, nodes: involved })
  })

  // A claim that names its source (the optional `source` field of claim.checked) cites it only when the string is the
  // address of a source a member kept: the field is whatever the member wrote, so it is never turned into a node.
  const cited = new Map<string, string>()
  for (const p of pendingSources) {
    cited.set(p.claim, p.source)
    const known = b.nodes.get(`source:${p.source}`)
    if (known?.kind === "source") { b.link("cites", p.claim, known.id, p.order) }
  }

  const nodes0 = [...b.nodes.values()]
  for (const n of nodes0) {
    if (n.kind === "claim") {
      const rs = n.rulings ?? []
      const named = cited.get(n.id)
      if (named) n.facts.push({ label: n.facts.some((f) => f.label === "Kind of statement" && f.value === "computed") ? "What was computed" : "Cited source", value: named })
      n.facts.push({ label: rs.length > 1 ? "Rounds" : "Round", value: (n.rounds ?? []).join(", ") })
      if (rs.length > 1 && new Set(rs.map((r) => r.verdict)).size > 1) n.facts.push({ label: "Verdict changed", value: rs.map((r) => `round ${r.round}: ${r.verdict}`).join("; ") })
      const last = rs[rs.length - 1]
      if (last) n.facts.push({ label: "Ruled by", value: last.checker }, ...(num(last.p) !== undefined ? [{ label: "Checker score (p)", value: fmt(last.p) }] : []), ...(last.note ? [{ label: "Checker note", value: last.note }] : []), ...(last.by ? [{ label: "Checked with", value: last.by }] : []))
    }
    if (n.kind === "agent" && n.id !== "agent:lead") {
      const mine = Object.keys(n.count).filter((k) => k.startsWith("claims:")).map((k) => b.nodes.get(k.slice(7))!)
      const by: Partial<Record<Found, number>> = {}
      for (const c of mine) { const m = markOf(c.verdict?.raw); by[m] = (by[m] ?? 0) + 1 }
      n.facts.push(
        { label: "Replies", value: String(n.count.replies ?? 0) },
        { label: "Statements", value: mine.length ? `${mine.length}: ${markCounts(by)}` : "0" },
      )
    }
    if (n.kind === "checker") {
      const mine = Object.keys(n.count).filter((k) => k.startsWith("ruled:")).map((k) => b.nodes.get(k.slice(6))!)
      n.facts.push({ label: "Statements checked", value: String(mine.length) })
    }
    if (n.kind === "phase") n.facts.push({ label: "Replies", value: String(n.count.replies ?? 0) })
    if (n.kind === "source" && n.id !== "source:brief") n.facts.push({ label: "Kept by", value: plural(n.count.retrievals ?? 0, "search", "searches") })
  }
  run.facts.push(...finishedFact, ...(scripted === false && !example ? [{ label: "Made with", value: REAL }] : []))
  if (example) run.facts.push({ label: "Made with", value: `a built-in example, assembled by hand from public records retrieved on ${example.retrievedOn}` })
  // The example's lanes: each round, and what happened in it, in its own column. Team members and checkers work across rounds, so they have none.
  const lanes = example ? [...roundTitle.keys()].sort((x, y) => x - y) : []
  const laneOf = (r: number | undefined) => { const i = r === undefined ? -1 : lanes.indexOf(r); return i < 0 ? undefined : i }
  if (lanes.length) {
    for (const n of b.nodes.values()) {
      if (n.kind === "phase") n.lane = laneOf(n.round ?? Number(n.id.slice("phase:".length)))
      else if (n.kind === "claim") n.lane = laneOf(Math.min(...(n.rounds ?? [])))
      else if (n.kind === "source") n.lane = laneOf(sourceRound.get(n.id))
      else if (n.kind === "artifact") n.lane = lanes.length - 1
    }
  }
  for (const c of constraints) run.facts.push({ label: "Wrap-up", value: c })

  const notes = [
    cited.size > 0
      ? "A statement is linked to a source only when the source it names is one a team member used. Other statements name no source, or one that is not among the sources used (what they cite is in the statement's details). Sources are also linked to the team members that used them."
      : "This run does not record which source a statement cites, so statements are not linked to sources. Sources are linked to the team members that used them.",
    "The data does not record who a team member replied to, so replies are shown per round, not person to person.",
  ]
  if (scripted === undefined) notes.push("This run's record does not say whether it is a practice run or a real one.")
  if (example) notes.unshift(`This is a built-in example, not a run. It was assembled by hand from public records retrieved on ${example.retrievedOn}, in the format of a finished review. No model wrote or checked it; the team roles show who does each part in a real review. Every statement links to the record it was checked against.`)
  const { nodes, links } = b.finish()
  return {
    kind: "board", runId, title: started?.title || runId, nodes, links, scripted: example ? undefined : scripted, demo: false, single: false, status, steps, marks,
    maxOrder: Math.max(sorted.length, ...nodes.map((n) => n.order)), notes, totals: statsOf(nodes), hidden: 0,
    ...(lanes.length ? { lanes: lanes.map((r) => roundTitle.get(r) ?? `Round ${r}`) } : {}), ...(example ? { example } : {}),
  }
}

// ── Swarm ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const turnName = (title: string) => {
  const role = ROLES.find((r) => r.key === roleOf(title))
  const n = title.match(/\d+/)?.[0]
  return role ? `${role.name}${n ? ` · review round ${n}` : ""}` : title
}
const testKey = (claim: string, name: string) => `test:${claim}:${norm(name)}`

export function buildSwarmGraph(detail: RunDetail): GraphModel {
  const { run, ledger } = detail
  const b = new Builder()
  const scripted = run.model === "mock"
  const demo = run.task === "demo"
  const status: GraphModel["status"] = run.phase === "done" ? "done" : run.phase === "failed" ? "failed" : run.phase === "cancelled" ? "cancelled" : run.phase === "queued" ? "queued" : "running"
  const runNode = b.node("run", "run", `${run.solver === "glhf" ? "Team of nine" : "Single agent"} · ${run.task}`, 0, {
    facts: [
      { label: "Run", value: run.id }, { label: "Task", value: run.task }, { label: "Solver", value: run.solver === "glhf" ? "team of nine" : "single agent" },
      { label: "Model", value: run.model }, ...(scripted ? [] : [{ label: "Made with", value: REAL }]),
      { label: "State", value: run.phase },
      ...(run.score !== undefined ? [{ label: "Score from the grader", value: fmt(run.score) }] : []),
      ...(run.error ? [{ label: "Error", value: run.error }] : []),
    ],
  })
  const events = ledger?.events ?? []
  const claimText = (id: string) => ledger?.claims.find((c) => c.id === id)?.text ?? id
  const marks: Mark[] = []
  const maxOrder = events.length
  const finishedAt = events.findIndex((e) => e.kind === "finished") + 1 || maxOrder + 1
  const notes: string[] = [
    "The data does not record which role wrote an output, so outputs are linked to the run, and to the statements and problems that name them.",
    "The data does not say which statement a problem is about: problems name outputs only.",
    "The run's shared record has an order but no clock times, so the replay steps through it, not through minutes.",
  ]
  if (!ledger) notes.push(run.solver === "single" ? "A single agent keeps no shared record, so there are no statements, tests or problems to show." : "This run has no shared record yet.")

  const agent = (name: string, order: number) => {
    const a = b.node(`agent:${name}`, "agent", name, order, { facts: [{ label: "Name", value: name }, { label: "Kind", value: "a model group named in the run's shared record; the roles it covers are not listed per name" }] })
    b.link("involves", "run", a.id, order)
    return a
  }
  const output = (id: string, order: number) => b.node(`artifact:${id}`, "artifact", id, order, { facts: [{ label: "Output", value: id }] })

  let current: string | undefined
  let prev: string | undefined
  const turn = (title: string, order: number) => b.node(`phase:${title}`, "phase", turnName(title), order, { facts: [{ label: "Role's turn", value: title }] })
  const inTurn = (id: string, order: number) => { if (current) b.link("in-phase", id, `phase:${current}`, order) }
  const claimOrder = new Map<string, number>(), issueOrder = new Map<string, number>()
  const steps: Step[] = []

  events.forEach((e, idx) => {
    const order = idx + 1
    const by = str(e.by)
    let label = humanKind(e)
    let involved: string[] = []
    switch (e.kind) {
      case "phase.started": case "phase.skipped": {
        const title = str(e.phase)
        const p = turn(title, order)
        if (e.kind === "phase.skipped") { p.facts.push({ label: "Did it run?", value: `no (${str(e.reason) || "skipped"})` }); p.muted = true }
        else { current = title; if (num(e.seconds) !== undefined) p.facts.push({ label: "Time allowed", value: `${e.seconds} s` }) }
        if (num(e.tokens_allowed) !== undefined) p.facts.push({ label: "Tokens allowed", value: String(e.tokens_allowed) })
        if (prev === undefined) b.link("next", "run", p.id, order); else if (prev !== title) b.link("next", `phase:${prev}`, p.id, order)
        prev = title
        marks.push({ label: turnName(title) + (e.kind === "phase.skipped" ? " (did not run)" : ""), order })
        const does = ROLES.find((r) => r.key === roleOf(title))?.does
        label = e.kind === "phase.skipped" ? `${turnName(title)} does not run (${str(e.reason) || "skipped"}).` : `${turnName(title)} starts${does ? `: ${does.charAt(0).toLowerCase()}${does.slice(1)}` : ""}.`
        involved = [p.id]
        break
      }
      case "phase.finished": {
        const title = str(e.phase)
        const p = b.nodes.get(`phase:${title}`)
        if (p) {
          p.facts.push({ label: "Ended", value: e.limit_hit ? "ran out of its budget" : "finished" })
          if (num(e.tokens) !== undefined) p.facts.push({ label: "Tokens used", value: String(e.tokens) })
        }
        current = undefined
        label = `${turnName(title)} ends${e.limit_hit ? ", out of budget" : ""}.`
        involved = p ? [p.id] : []
        break
      }
      case "claim.added": {
        const id = str(e.claim); claimOrder.set(id, order)
        const a = by ? agent(by, order) : undefined
        const cid = `claim:${id}`
        b.node(cid, "claim", str(e.text) || id, order); inTurn(cid, order)
        label = `${a?.label ?? "A role"} said (statement ${id}): ${quote(str(e.text) || claimText(id), 110)}`
        involved = [...(a ? [a.id] : []), cid]
        break
      }
      case "issue.raised": {
        issueOrder.set(str(e.issue), order)
        const a = by ? agent(by, order) : undefined
        const iid = `issue:${str(e.issue)}`
        b.node(iid, "issue", str(e.problem) || iid, order); inTurn(iid, order)
        label = `${a?.label ?? "A role"} raised a ${str(e.severity) || "reported"} problem: ${quote(str(e.problem), 110)}`
        involved = [...(a ? [a.id] : []), iid]
        break
      }
      case "test.registered": case "test.recorded": {
        const a = by ? agent(by, order) : undefined
        const tid = testKey(str(e.claim), str(e.name))
        b.node(tid, "test", str(e.name) || tid, order); inTurn(tid, order)
        label = e.kind === "test.registered"
          ? `${a?.label ?? "A role"} planned the test “${str(e.name)}” for statement ${str(e.claim)}, before any result.`
          : `${a?.label ?? "A role"} ran the test “${str(e.name)}” on statement ${str(e.claim)}: ${e.contradicts ? "it went against the statement" : "it did not go against the statement"}.`
        involved = [...(a ? [a.id] : []), tid, `claim:${str(e.claim)}`]
        break
      }
      case "issue.resolved": {
        const a = by ? agent(by, order) : undefined
        label = `${a?.label ?? "A role"} ${e.status === "fixed" ? "fixed" : "closed without a fix"} problem ${str(e.issue)}.`
        involved = [...(a ? [a.id] : []), `issue:${str(e.issue)}`]
        break
      }
      case "replication.failed": { if (by) agent(by, order); label = `${by || "A role"} could not reproduce statement ${str(e.claim)} independently.`; involved = [`claim:${str(e.claim)}`]; break }
      case "review.converged": label = `Review round ${str(e.round)} found nothing left to fix, so review ended.`; break
      case "review.skipped": label = `Review round ${str(e.round)} did not run: out of time.`; break
      case "finished": label = `The final check of the required outputs: ${clip(oneLine(str(e.contract)), 140)}`; involved = ["run"]; break
      case "settings": label = "The run's budget and settings are recorded."; break
      default: break
    }
    steps.push({ label, nodes: involved })
  })

  // Claims and their tests
  for (const c of ledger?.claims ?? []) {
    const cid = `claim:${c.id}`
    const order = claimOrder.get(c.id) ?? maxOrder + 1
    const n = b.node(cid, "claim", c.text, order, {})
    Object.assign(n, claimFields(c))
    if (c.proposed_by) { const a = agent(c.proposed_by, order); b.link("made", a.id, cid, order) }
    for (const art of c.artifact_ids ?? []) { const a = output(art, order); b.link("about", cid, a.id, order) }
    const regs = c.registered ?? []
    const pending = new Set((c.pending_tests ?? []).map(norm))
    const names = new Map<string, "registered" | "result">()
    for (const r of regs) names.set(norm(r.name), "registered")
    for (const t of c.tests) names.set(norm(t.name), "result")
    for (const key of pending) if (!names.has(key)) names.set(key, "registered")
    for (const [key] of names) {
      const id = testKey(c.id, key)
      const reg = regs.find((r) => norm(r.name) === key)
      const res = c.tests.find((t) => norm(t.name) === key)
      const tn = b.node(id, "test", res?.name ?? reg?.name ?? key, maxOrder + 1)
      tn.label = clip(oneLine(res?.name ?? reg?.name ?? key), 80)
      const facts: Fact[] = [{ label: "Statement", value: c.id }, { label: "Test", value: res?.name ?? reg?.name ?? key }]
      if (reg) facts.push({ label: "Planned test", value: reg.method }, { label: "Planned by", value: reg.by })
      if (res) {
        facts.push({ label: "Result", value: res.contradicts ? "went against the statement" : "did not go against the statement" }, { label: "p-value", value: fmt(res.p_value) }, { label: "Evidence score (e)", value: fmt(res.e_value) }, { label: "Recorded by", value: res.by })
        if (res.registered === false) facts.push({ label: "Planned beforehand", value: "no: a result against a statement is accepted without a plan" })
        if (res.note) facts.push({ label: "Note", value: res.note })
      } else facts.push({ label: "Result", value: "no result yet: counts as 0 in the statement's score" })
      tn.facts = facts
      tn.text = res?.note || reg?.method || undefined
      tn.verdict = res ? (res.contradicts ? { cls: "fails", raw: "went against the statement" } : undefined) : { cls: "unknown", raw: "no result yet" }
      tn.attention = res?.contradicts ? 2 : res ? 0 : 1
      b.link("targets", id, cid, tn.order)
      if (reg?.by) { const a = agent(reg.by, tn.order); b.link("registered", a.id, id, tn.order) }
      if (res?.by) { const a = agent(res.by, tn.order); b.link("recorded", a.id, id, tn.order) }
    }
  }
  // Problems
  for (const i of ledger?.issues ?? []) {
    const id = `issue:${i.id}`
    const order = issueOrder.get(i.id) ?? maxOrder + 1
    const n = b.node(id, "issue", `${i.id}: ${i.problem}`, order, {})
    n.text = i.problem
    n.attention = i.status === "open" && (i.severity === "blocking" || i.severity === "major") ? 1 : 0
    n.facts = [
      { label: "Severity", value: i.severity }, { label: "Status", value: i.status }, { label: "Raised by", value: i.raised_by },
      ...(i.evidence ? [{ label: "Evidence", value: i.evidence }] : []), ...(i.resolution ? [{ label: i.status === "fixed" ? "Fix" : "Response", value: i.resolution }] : []),
      ...((i as { rechecked?: boolean }).rechecked ? [{ label: "Re-checked", value: "a later review round completed after the fix" }] : []),
    ]
    if (i.raised_by) { const a = agent(i.raised_by, order); b.link("raised", a.id, id, order) }
    for (const art of i.artifact_ids ?? []) { const a = output(art, order); b.link("against", id, a.id, order) }
  }
  // Who resolved a problem is recorded in the issue.resolved events only.
  events.forEach((e, idx) => {
    if (e.kind === "issue.resolved" && str(e.by)) b.link("resolved", `agent:${str(e.by)}`, `issue:${str(e.issue)}`, idx + 1, e.status === "fixed" ? "fixed" : "closed")
  })
  // Graded outputs
  for (const a of run.artifacts ?? []) {
    const n = output(a.artifact_id, finishedAt)
    n.facts.push({ label: "Score from the grader", value: fmt(a.score) })
    b.link("produced", "run", n.id, finishedAt)
  }
  for (const n of b.nodes.values()) if (n.kind === "artifact" && !(run.artifacts ?? []).some((a) => `artifact:${a.artifact_id}` === n.id)) n.facts.push({ label: "Graded", value: "no score recorded" })

  // Role summaries
  for (const n of b.nodes.values()) {
    if (n.kind !== "agent") continue
    const name = n.id.slice("agent:".length)
    const mine = (ledger?.claims ?? []).filter((c) => c.proposed_by === name)
    const regs = (ledger?.claims ?? []).flatMap((c) => (c.registered ?? []).filter((r) => r.by === name))
    const results = (ledger?.claims ?? []).flatMap((c) => c.tests.filter((t) => t.by === name))
    const raised = (ledger?.issues ?? []).filter((i) => i.raised_by === name)
    n.facts.push(
      { label: "Statements made", value: String(mine.length) }, { label: "Tests planned", value: String(regs.length) },
      { label: "Test results recorded", value: `${results.length}, ${results.filter((t) => t.contradicts).length} against a statement` },
      { label: "Problems raised", value: String(raised.length) },
    )
    for (const c of mine) n.activity.push({ label: `Said (statement ${c.id})`, text: c.text })
    for (const r of regs) n.activity.push({ label: "Planned a test", text: `${r.name}: ${r.method}` })
    for (const t of results) n.activity.push({ label: `Ran ${t.name}`, text: `p = ${fmt(t.p_value)}${t.contradicts ? ", against the statement" : ""}${t.note ? `. ${t.note}` : ""}` })
    for (const i of raised) n.activity.push({ label: `Raised ${i.id} (${i.severity})`, text: i.problem })
  }
  // Outputs: who points at them
  for (const n of b.nodes.values()) {
    if (n.kind !== "artifact") continue
    const aid = n.id.slice("artifact:".length)
    const claims = (ledger?.claims ?? []).filter((c) => (c.artifact_ids ?? []).includes(aid)).map((c) => c.id)
    const issues = (ledger?.issues ?? []).filter((i) => (i.artifact_ids ?? []).includes(aid)).map((i) => i.id)
    if (claims.length) n.facts.push({ label: "Statements that depend on it", value: claims.join(", ") })
    if (issues.length) n.facts.push({ label: "Problems raised against it", value: issues.join(", ") })
  }

  const { nodes, links } = b.finish()
  while (steps.length < Math.max(0, ...nodes.map((n) => n.order))) steps.push({ label: "The outputs and the final state are recorded.", nodes: nodes.filter((n) => n.kind === "artifact").map((n) => n.id) })
  runNode.facts.push({ label: "Statements", value: String((ledger?.claims ?? []).length) }, { label: "Problems", value: String((ledger?.issues ?? []).length) })
  return {
    kind: "swarm", runId: run.id, title: runNode.label, nodes, links, scripted, demo, single: run.solver === "single", status, steps, marks,
    maxOrder: Math.max(maxOrder, ...nodes.map((n) => n.order), ...links.map((l) => l.order)), notes, totals: statsOf(nodes), score: run.score, hidden: 0,
  }
}

/** A ledger event this dashboard has no sentence for: its own name, spelled out. */
const humanKind = (e: LedgerEvent) => `${e.kind.replace(/[._]/g, " ")} was recorded.`

function claimFields(c: LedgerClaim): Partial<GraphNode> {
  const v = swarmVerdict(c.verdict)
  const pending = (c.pending_tests ?? []).length
  return {
    text: c.text, verdict: v, label: clip(oneLine(c.text), 80),
    attention: v.cls === "fails" ? 2 : v.cls === "unknown" ? 1 : 0,
    facts: [
      { label: "Said by", value: c.proposed_by },
      { label: "If the statement were false", value: c.null_hypothesis },
      { label: "Combined evidence score (e)", value: fmt(c.e_value) },
      ...(c.threshold !== undefined ? [{ label: "Needed to be supported", value: fmt(c.threshold) }] : []),
      ...(c.replication_failed ? [{ label: "Independent replication", value: "failed" }] : []),
      ...(pending ? [{ label: "Planned tests without a result", value: String(pending) }] : []),
      { label: "Outputs it depends on", value: (c.artifact_ids ?? []).join(", ") || "none" },
    ],
  }
}
