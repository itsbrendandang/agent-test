// Pure functions from run data to a graph. No React, no DOM, no network: tested against the real API shapes.
//
// Board run (events of GET /api/runs/:id/events, roster from GET /api/roster):
//   run.started            -> run node (title, brief, mock flag)
//   round.started          -> phase node "Round n"; chain of rounds
//   member.replied         -> agent node; edge agent -> round (replied in)
//   evidence.triaged       -> source nodes; edge agent -> source (retrieved)
//   claim.checked          -> claim node; edges member -> claim (made), checker -> claim (ruled), claim -> round;
//                             claim of kind "brief" -> the brief (cites)
//   memo.written           -> artefact node (the decision memo)
//   run.finished / failed  -> facts of the run node
// Swarm run (GET /api/glhf/runs/:id, its ledger):
//   ledger.events phase.started / phase.skipped -> phase nodes, in order
//   claims                 -> claim nodes; agent (proposed_by) -> claim; claim -> artefact (artifact_ids)
//   claims[].registered / tests / pending_tests -> test nodes; test -> claim; agent -> test (registered, recorded)
//   issues                 -> issue nodes; agent -> issue (raised_by, and issue.resolved events); issue -> artefact
//   run.artifacts          -> artefact nodes with the grader's score; run -> artefact
// Not recorded, so never drawn: which source a board claim cites (claim.checked has no source field), who a member
// replied to, which role wrote an artefact, which claim an issue is about.
import type { BoardEvent, RosterMember } from "@/board/api"
import type { LedgerClaim, LedgerEvent, RunDetail } from "@/swarm/api"
import { ROLES, roleOf } from "@/swarm/roles"
import { KIND_LABEL, LINK_LABEL, type Fact, type GraphLink, type GraphModel, type GraphNode, type LinkKind, type Mark, type NodeKind, type Step, type Verdict, type VerdictClass } from "./types"

const str = (x: unknown): string => (typeof x === "string" ? x : typeof x === "number" && Number.isFinite(x) ? String(x) : "")
const num = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) ? x : undefined)
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim()
const fmt = (n: number | undefined, digits = 3) => (n === undefined ? "" : String(Number(n.toPrecision(digits))))
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim()
export const safeUrl = (u: string): string | undefined => {
  try { const p = new URL(u); return p.protocol === "http:" || p.protocol === "https:" ? p.href : undefined } catch { return undefined }
}
const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p

const BOARD_VERDICT: Record<string, VerdictClass> = { verified: "pass", contradicted: "fail", unsupported: "unknown", unchecked: "unknown" }
const SWARM_VERDICT: Record<string, VerdictClass> = { supported: "pass", refuted: "fail", insufficient: "unknown", untested: "unknown" }
/** The class of the engine's verdict word, or "unknown" for a word this dashboard does not know (it is never guessed to pass). */
export const verdictOf = (raw: string, table: Record<string, VerdictClass>): Verdict => ({ cls: table[raw] ?? "unknown", raw: raw || "unknown" })
export const boardVerdict = (raw: string) => verdictOf(raw, BOARD_VERDICT)
export const swarmVerdict = (raw: string) => verdictOf(raw, SWARM_VERDICT)

interface Draft extends GraphNode { count: Record<string, number> }

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
  link(kind: LinkKind, source: string, target: string, order: number): void {
    if (!this.nodes.has(source) || !this.nodes.has(target) || source === target) return
    const id = `${kind}|${source}|${target}`
    if (this.links.has(id)) return
    this.links.set(id, { id, source, target, kind, order, label: LINK_LABEL[kind] })
  }
  /** A link appears when both of its ends are there. */
  finish(): { nodes: GraphNode[]; links: GraphLink[] } {
    const nodes = [...this.nodes.values()].map(({ count: _count, ...n }) => n as GraphNode)
    const at = new Map(nodes.map((n) => [n.id, n.order]))
    const links = [...this.links.values()].map((l) => ({ ...l, order: Math.max(l.order, at.get(l.source) ?? 0, at.get(l.target) ?? 0) }))
    return { nodes, links }
  }
}

const bump = (n: Draft, key: string, by = 1) => { n.count[key] = (n.count[key] ?? 0) + by }

function stepLabelBoard(e: BoardEvent): string {
  switch (e.type) {
    case "run.started": return "Run started"
    case "run.resumed": return "Run resumed"
    case "lead.framed": return "Lead framed the question"
    case "round.started": return `Round ${e.round} started`
    case "member.replied": return `${e.member} replied (round ${e.round})`
    case "evidence.triaged": return `${e.member} kept ${e.kept} source${e.kept === 1 ? "" : "s"}`
    case "claim.checked": return `${e.checker} ruled ${e.verdict}: ${clip(oneLine(e.claim), 60)}`
    case "constraint": return `Wrap-up: ${e.reason}`
    case "memo.written": return "Memo written"
    case "run.finished": return "Run finished"
    case "run.failed": return "Run failed"
    default: return "Event"
  }
}

export interface BoardInput { runId: string; events: BoardEvent[]; roster?: RosterMember[] }

export function buildBoardGraph({ runId, events, roster = [] }: BoardInput): GraphModel {
  const b = new Builder()
  const titleOf = (name: string) => roster.find((m) => m.name === name)
  // Events in the order they happened: by their own timestamp, ties by their place in the list.
  const sorted = events.map((e, i) => ({ e, i })).sort((x, y) => (num(x.e.at) ?? 0) - (num(y.e.at) ?? 0) || x.i - y.i).map((x) => x.e)
  const started = sorted.find((e): e is Extract<BoardEvent, { type: "run.started" }> => e.type === "run.started")
  const t0 = num(sorted[0]?.at)
  const run = b.node("run", "run", started?.title || runId, 0, {
    facts: [{ label: "Run", value: runId }, ...(started ? [{ label: "Brief", value: started.brief }] : [])],
  })
  let scripted: boolean | undefined = typeof started?.mock === "boolean" ? started.mock : undefined
  let status: GraphModel["status"] = "running"
  let finishedFact: Fact[] = []
  const constraints: string[] = []
  const marks: Mark[] = []
  const steps: Step[] = []
  let prevRound: number | undefined
  const briefNode = (order: number) => b.node("source:brief", "source", "The brief", order, {
    facts: [{ label: "What it is", value: `The brief the board was given${started ? ` (${started.brief})` : ""}. Claims of kind "brief" are checked against it.` }],
  })
  const agent = (name: string, order: number) => {
    const r = titleOf(name)
    const a = b.node(`agent:${name}`, "agent", r?.title || name, order, {
      facts: [{ label: "Name", value: name }, ...(r ? [{ label: "Role on the board", value: `${r.role} (from the engine's current roster)` }] : [])],
    })
    b.link("involves", "run", a.id, order)
    return a
  }
  const phase = (round: number, order: number) => b.node(`phase:${round}`, "phase", `Round ${round}`, order, { round })

  sorted.forEach((e, idx) => {
    const order = idx + 1
    steps.push({ label: stepLabelBoard(e), at: t0 !== undefined && num(e.at) !== undefined ? (e.at - t0) : undefined })
    switch (e.type) {
      case "round.started": {
        const p = phase(e.round, order)
        p.facts = [{ label: "Round", value: String(e.round) }, { label: "Final positions", value: e.final ? "yes" : "no" }]
        p.text = e.message
        marks.push({ label: `Round ${e.round}`, order })
        if (prevRound === undefined) b.link("next", "run", p.id, order); else b.link("next", `phase:${prevRound}`, p.id, order)
        prevRound = e.round
        break
      }
      case "lead.framed": {
        const r = roster.find((m) => m.role === "lead")
        const a = b.node("agent:lead", "agent", r?.title || "Lead", order, { facts: [{ label: "Role on the board", value: "lead" }] })
        b.link("framed", a.id, "run", order)
        a.activity.push({ label: "Framed the question", text: str((e as { text?: unknown }).text) })
        break
      }
      case "member.replied": {
        const a = agent(e.member, order), p = phase(e.round, order)
        b.link("replied", a.id, p.id, order)
        bump(a, "replies"); bump(p, "replies")
        a.activity.push({ label: `Round ${e.round}: replied`, text: e.text })
        break
      }
      case "evidence.triaged": {
        const a = agent(e.member, order)
        a.activity.push({ label: "Searched", text: `${e.query} (kept ${e.kept}, dropped ${e.dropped})` })
        for (const item of Array.isArray(e.items) ? e.items : []) {
          const s = b.node(`source:${item.url}`, "source", item.title || item.url, order, {
            url: safeUrl(item.url), text: str((item as { text?: unknown }).text) || undefined,
            facts: [
              { label: "Address", value: item.url },
              ...(item.studyType ? [{ label: "Study type", value: item.studyType }] : []),
              ...(num((item as { relevance?: unknown }).relevance) !== undefined ? [{ label: "Relevance score", value: fmt(num((item as { relevance?: unknown }).relevance), 2) }] : []),
            ],
          })
          b.link("retrieved", a.id, s.id, order)
          bump(s, "retrievals"); s.activity.push({ label: "Kept after screening", text: `${a.label}, for the search "${e.query}"` })
        }
        break
      }
      case "claim.checked": {
        const a = agent(e.member, order), p = phase(e.round, order)
        const c = b.node(`claim:${e.key}`, "claim", e.claim, order, { text: e.claim, verdict: boardVerdict(e.verdict), round: e.round })
        const ck = b.node(`checker:${e.checker}`, "checker", e.checker, order, { facts: [{ label: "Checker", value: e.checker }] })
        c.attention = c.verdict!.cls === "fail" ? 2 : c.verdict!.cls === "unknown" ? 1 : 0
        c.facts = [
          { label: "Verdict", value: e.verdict }, { label: "Round", value: String(e.round) }, { label: "Kind of claim", value: e.kind },
          { label: "Made by", value: a.label }, { label: "Ruled by", value: e.checker },
          ...(num(e.p) !== undefined ? [{ label: "Checker score (p)", value: fmt(e.p) }] : []),
          ...(e.note ? [{ label: "Checker note", value: e.note }] : []),
        ]
        b.link("made", a.id, c.id, order); b.link("ruled", ck.id, c.id, order); b.link("in-phase", c.id, p.id, order)
        if (e.kind === "brief") b.link("cites", c.id, briefNode(order).id, order)
        bump(a, "claims"); bump(a, `claims:${e.verdict}`); bump(ck, "ruled"); bump(ck, `ruled:${e.verdict}`); bump(p, "claims")
        a.activity.push({ label: `Round ${e.round}: claim, ${e.verdict}`, text: e.claim })
        ck.activity.push({ label: `Round ${e.round}: ruled ${e.verdict}`, text: e.claim })
        break
      }
      case "constraint": constraints.push(`${e.reason}: ${e.detail}`); break
      case "memo.written": {
        const m = b.node("artifact:memo", "artifact", `Decision memo: ${e.decision}`, order, {
          text: e.decision, facts: [{ label: "Decision", value: e.decision }, { label: "File", value: baseName(e.path) }],
        })
        b.link("produced", "run", m.id, order)
        break
      }
      case "run.finished":
        status = "done"; finishedFact = [{ label: "Cost", value: `$${e.usd.toFixed(2)}` }, { label: "Took", value: `${fmt(e.minutes, 2)} minutes` }]
        break
      case "run.failed":
        status = "failed"; finishedFact = [{ label: "Error", value: e.error }]
        break
      default: break
    }
  })

  const nodes0 = [...b.nodes.values()]
  for (const n of nodes0) {
    if (n.kind === "agent" && n.id !== "agent:lead") {
      const c = n.count
      n.facts.push(
        { label: "Replies", value: String(c.replies ?? 0) },
        { label: "Claims made", value: `${c.claims ?? 0}: ${c["claims:verified"] ?? 0} verified, ${c["claims:contradicted"] ?? 0} contradicted, ${(c["claims:unsupported"] ?? 0) + (c["claims:unchecked"] ?? 0)} unsupported or unchecked` },
      )
    }
    if (n.kind === "checker") n.facts.push({ label: "Claims ruled on", value: `${n.count.ruled ?? 0}: ${n.count["ruled:verified"] ?? 0} verified, ${n.count["ruled:contradicted"] ?? 0} contradicted, ${(n.count["ruled:unsupported"] ?? 0) + (n.count["ruled:unchecked"] ?? 0)} unsupported or unchecked` })
    if (n.kind === "phase") n.facts.push({ label: "Replies", value: String(n.count.replies ?? 0) }, { label: "Claims ruled on", value: String(n.count.claims ?? 0) })
    if (n.kind === "source" && n.id !== "source:brief") n.facts.push({ label: "Kept by", value: `${n.count.retrievals ?? 0} search${n.count.retrievals === 1 ? "" : "es"}` })
  }
  run.facts.push(...finishedFact, ...(scripted === undefined ? [] : [{ label: "Models", value: scripted ? "scripted (fixed text, not research)" : "real" }]))
  for (const c of constraints) run.facts.push({ label: "Wrap-up", value: c })
  const claimTotal = nodes0.filter((n) => n.kind === "claim").length
  run.facts.push({ label: "Claims checked", value: String(claimTotal) })

  const notes = [
    "The data does not record which source a claim cites, so claims are not linked to sources. Sources are linked to the agents that kept them.",
    "The data does not record who a member replied to, so replies are shown per round, not agent to agent.",
  ]
  if (scripted === undefined) notes.push("This run's record does not say whether its models were scripted or real.")
  const { nodes, links } = b.finish()
  return {
    kind: "board", runId, title: started?.title || runId, nodes, links, scripted, demo: false, status, steps, marks,
    maxOrder: Math.max(sorted.length, ...nodes.map((n) => n.order)), notes, hidden: 0,
  }
}

// ── Swarm ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const phaseName = (title: string) => {
  const role = ROLES.find((r) => r.key === roleOf(title))
  const n = title.match(/\d+/)?.[0]
  return role ? `${role.name}${n ? ` ${n}` : ""}` : title
}

function stepLabelSwarm(e: LedgerEvent): string {
  const claim = str(e.claim), by = str(e.by)
  switch (e.kind) {
    case "phase.started": return `${phaseName(str(e.phase))} started`
    case "phase.finished": return `${phaseName(str(e.phase))} finished`
    case "phase.skipped": return `${phaseName(str(e.phase))} skipped`
    case "claim.added": return `${by} wrote claim ${claim}`
    case "test.registered": return `${by} planned a test of ${claim}`
    case "test.recorded": return `${by} recorded a result for ${claim}`
    case "issue.raised": return `${by} raised ${str(e.issue)}`
    case "issue.resolved": return `${by} resolved ${str(e.issue)}`
    default: return e.kind
  }
}

const testKey = (claim: string, name: string) => `test:${claim}:${norm(name)}`

export function buildSwarmGraph(detail: RunDetail): GraphModel {
  const { run, ledger } = detail
  const b = new Builder()
  const scripted = run.model === "mock"
  const demo = run.task === "demo"
  const status: GraphModel["status"] = run.phase === "done" ? "done" : run.phase === "failed" ? "failed" : run.phase === "cancelled" ? "cancelled" : run.phase === "queued" ? "queued" : "running"
  const runNode = b.node("run", "run", `${run.solver === "glhf" ? "Swarm" : "Single agent"} · ${run.task}`, 0, {
    facts: [
      { label: "Run", value: run.id }, { label: "Task", value: run.task }, { label: "Solver", value: run.solver === "glhf" ? "swarm" : "single agent" },
      { label: "Model", value: run.model }, { label: "Models", value: scripted ? "scripted (fixed text, not research)" : "real" },
      { label: "State", value: run.phase },
      ...(run.score !== undefined ? [{ label: "Score from the grader", value: fmt(run.score) }] : []),
      ...(run.error ? [{ label: "Error", value: run.error }] : []),
    ],
  })
  const events = ledger?.events ?? []
  const steps: Step[] = events.map((e) => ({ label: stepLabelSwarm(e) }))
  const marks: Mark[] = []
  const maxOrder = events.length
  const finishedAt = events.findIndex((e) => e.kind === "finished") + 1 || maxOrder + 1
  const notes: string[] = [
    "The data does not record which role wrote an artefact, so artefacts are linked to the run, and to the claims and issues that name them.",
    "The data does not say which claim an issue is about: issues name artefacts only.",
    "The ledger log has an order but no clock times, so the scrubber steps through the log, not through minutes.",
  ]
  if (!ledger) notes.push(run.solver === "single" ? "A single agent keeps no ledger, so there are no claims, tests or issues to show." : "This run has no ledger yet.")

  const agent = (name: string, order: number) => {
    const a = b.node(`agent:${name}`, "agent", name, order, { facts: [{ label: "Name", value: name }, { label: "Kind", value: "model group named in the ledger (the roles it covers are not listed per agent)" }] })
    b.link("involves", "run", a.id, order)
    return a
  }
  const artifact = (id: string, order: number) => b.node(`artifact:${id}`, "artifact", id, order, { facts: [{ label: "Artefact", value: id }] })

  let current: string | undefined
  let prev: string | undefined
  const phaseNode = (title: string, order: number) => b.node(`phase:${title}`, "phase", phaseName(title), order, { facts: [{ label: "Phase", value: title }] })
  const inPhase = (id: string, order: number) => { if (current) b.link("in-phase", id, `phase:${current}`, order) }
  const claimOrder = new Map<string, number>(), issueOrder = new Map<string, number>()

  events.forEach((e, idx) => {
    const order = idx + 1
    const by = str(e.by)
    switch (e.kind) {
      case "phase.started": case "phase.skipped": {
        const title = str(e.phase)
        const p = phaseNode(title, order)
        if (e.kind === "phase.skipped") { p.facts.push({ label: "Skipped", value: str(e.reason) || "yes" }); p.label = `${phaseName(title)} (skipped)` }
        else { current = title; if (num(e.seconds) !== undefined) p.facts.push({ label: "Time allowed", value: `${e.seconds} s` }) }
        if (num(e.tokens_allowed) !== undefined) p.facts.push({ label: "Tokens allowed", value: String(e.tokens_allowed) })
        if (prev === undefined) b.link("next", "run", p.id, order); else if (prev !== title) b.link("next", `phase:${prev}`, p.id, order)
        prev = title
        marks.push({ label: phaseName(title) + (e.kind === "phase.skipped" ? " (skipped)" : ""), order })
        break
      }
      case "phase.finished": {
        const p = b.nodes.get(`phase:${str(e.phase)}`)
        if (p) {
          p.facts.push({ label: "Ended", value: e.limit_hit ? "ran out of its budget" : "finished" })
          if (num(e.tokens) !== undefined) p.facts.push({ label: "Tokens used", value: String(e.tokens) })
        }
        current = undefined
        break
      }
      case "claim.added": {
        const id = str(e.claim); claimOrder.set(id, order)
        if (by) agent(by, order)
        break
      }
      case "issue.raised": { issueOrder.set(str(e.issue), order); if (by) agent(by, order); break }
      case "test.registered": case "test.recorded": case "issue.resolved": case "replication.failed": if (by) agent(by, order); break
      default: break
    }
    // Which phase the event was logged in is given by its place between phase.started and phase.finished.
    if (e.kind === "claim.added") { const id = `claim:${str(e.claim)}`; b.node(id, "claim", str(e.text) || id, order); inPhase(id, order) }
    if (e.kind === "issue.raised") { const id = `issue:${str(e.issue)}`; b.node(id, "issue", str(e.problem) || id, order); inPhase(id, order) }
    if (e.kind === "test.registered" || e.kind === "test.recorded") {
      const id = testKey(str(e.claim), str(e.name))
      b.node(id, "test", str(e.name) || id, order)
      inPhase(id, order)
    }
  })

  // Claims and their tests
  for (const c of ledger?.claims ?? []) {
    const cid = `claim:${c.id}`
    const order = claimOrder.get(c.id) ?? maxOrder + 1
    const n = b.node(cid, "claim", c.text, order, {})
    Object.assign(n, claimFields(c))
    if (c.proposed_by) { const a = agent(c.proposed_by, order); b.link("made", a.id, cid, order) }
    for (const art of c.artifact_ids ?? []) { const a = artifact(art, order); b.link("about", cid, a.id, order) }
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
      const facts: Fact[] = [{ label: "Claim", value: c.id }, { label: "Test", value: res?.name ?? reg?.name ?? key }]
      if (reg) facts.push({ label: "Planned beforehand", value: reg.method }, { label: "Planned by", value: reg.by })
      if (res) {
        facts.push({ label: "Result", value: res.contradicts ? "goes against the claim" : "does not go against the claim" }, { label: "p-value", value: fmt(res.p_value) }, { label: "Evidence score (e)", value: fmt(res.e_value) }, { label: "Recorded by", value: res.by })
        if (res.registered === false) facts.push({ label: "Registered", value: "no: a result against a claim is accepted without registration" })
        if (res.note) facts.push({ label: "Note", value: res.note })
      } else facts.push({ label: "Result", value: "none recorded: counts as 0 in the claim's score" })
      tn.facts = facts
      tn.text = res?.note || reg?.method || undefined
      tn.verdict = res ? (res.contradicts ? { cls: "fail", raw: "goes against the claim" } : undefined) : { cls: "unknown", raw: "no result" }
      tn.attention = res?.contradicts ? 2 : res ? 0 : 1
      b.link("targets", id, cid, tn.order)
      if (reg?.by) { const a = agent(reg.by, tn.order); b.link("registered", a.id, id, tn.order) }
      if (res?.by) { const a = agent(res.by, tn.order); b.link("recorded", a.id, id, tn.order) }
    }
  }
  // Issues
  for (const i of ledger?.issues ?? []) {
    const id = `issue:${i.id}`
    const order = issueOrder.get(i.id) ?? maxOrder + 1
    const n = b.node(id, "issue", `${i.id}: ${i.problem}`, order, {})
    n.text = i.problem
    n.attention = i.status === "open" && (i.severity === "blocking" || i.severity === "major") ? 1 : 0
    n.facts = [
      { label: "Severity", value: i.severity }, { label: "Status", value: i.status }, { label: "Raised by", value: i.raised_by },
      ...(i.evidence ? [{ label: "Evidence", value: i.evidence }] : []), ...(i.resolution ? [{ label: i.status === "fixed" ? "Fix" : "Response", value: i.resolution }] : []),
      ...((i as { rechecked?: boolean }).rechecked ? [{ label: "Re-checked", value: "a later critic round completed after the fix" }] : []),
    ]
    if (i.raised_by) { const a = agent(i.raised_by, order); b.link("raised", a.id, id, order) }
    for (const art of i.artifact_ids ?? []) { const a = artifact(art, order); b.link("against", id, a.id, order) }
  }
  // Who resolved an issue is recorded in the issue.resolved events only.
  events.forEach((e, idx) => {
    if (e.kind === "issue.resolved" && str(e.by)) b.link("resolved", `agent:${str(e.by)}`, `issue:${str(e.issue)}`, idx + 1)
  })
  // Graded artefacts
  for (const a of run.artifacts ?? []) {
    const n = artifact(a.artifact_id, finishedAt)
    n.facts.push({ label: "Score from the grader", value: fmt(a.score) })
    b.link("produced", "run", n.id, finishedAt)
  }
  for (const n of b.nodes.values()) if (n.kind === "artifact" && !(run.artifacts ?? []).some((a) => `artifact:${a.artifact_id}` === n.id)) n.facts.push({ label: "Graded", value: "no score recorded" })

  // Agent summaries
  for (const n of b.nodes.values()) {
    if (n.kind !== "agent") continue
    const name = n.id.slice("agent:".length)
    const mine = (ledger?.claims ?? []).filter((c) => c.proposed_by === name)
    const regs = (ledger?.claims ?? []).flatMap((c) => (c.registered ?? []).filter((r) => r.by === name))
    const results = (ledger?.claims ?? []).flatMap((c) => c.tests.filter((t) => t.by === name))
    const raised = (ledger?.issues ?? []).filter((i) => i.raised_by === name)
    n.facts.push(
      { label: "Claims proposed", value: String(mine.length) }, { label: "Tests planned", value: String(regs.length) },
      { label: "Test results recorded", value: `${results.length}, ${results.filter((t) => t.contradicts).length} against a claim` },
      { label: "Issues raised", value: String(raised.length) },
    )
    for (const c of mine) n.activity.push({ label: `Proposed ${c.id}`, text: c.text })
    for (const r of regs) n.activity.push({ label: "Planned a test", text: `${r.name}: ${r.method}` })
    for (const t of results) n.activity.push({ label: `Recorded ${t.name}`, text: `p = ${fmt(t.p_value)}${t.contradicts ? ", against the claim" : ""}${t.note ? `. ${t.note}` : ""}` })
    for (const i of raised) n.activity.push({ label: `Raised ${i.id} (${i.severity})`, text: i.problem })
  }
  // Artefacts: who points at them
  for (const n of b.nodes.values()) {
    if (n.kind !== "artifact") continue
    const aid = n.id.slice("artifact:".length)
    const claims = (ledger?.claims ?? []).filter((c) => (c.artifact_ids ?? []).includes(aid)).map((c) => c.id)
    const issues = (ledger?.issues ?? []).filter((i) => (i.artifact_ids ?? []).includes(aid)).map((i) => i.id)
    if (claims.length) n.facts.push({ label: "Claims that depend on it", value: claims.join(", ") })
    if (issues.length) n.facts.push({ label: "Issues raised against it", value: issues.join(", ") })
  }

  const { nodes, links } = b.finish()
  while (steps.length < Math.max(...nodes.map((n) => n.order))) steps.push({ label: "Outputs and final state" })
  runNode.facts.push({ label: "Claims", value: String((ledger?.claims ?? []).length) }, { label: "Issues", value: String((ledger?.issues ?? []).length) })
  return { kind: "swarm", runId: run.id, title: runNode.label, nodes, links, scripted, demo, status, steps, marks, maxOrder: Math.max(maxOrder, ...nodes.map((n) => n.order), ...links.map((l) => l.order)), notes, hidden: 0 }
}

function claimFields(c: LedgerClaim): Partial<GraphNode> {
  const v = swarmVerdict(c.verdict)
  const pending = (c.pending_tests ?? []).length
  return {
    text: c.text, verdict: v, label: clip(oneLine(c.text), 80),
    attention: v.cls === "fail" ? 2 : v.cls === "unknown" ? 1 : 0,
    facts: [
      { label: "Verdict", value: c.verdict }, { label: "Proposed by", value: c.proposed_by },
      { label: "If the claim were false", value: c.null_hypothesis },
      { label: "Combined evidence score (e)", value: fmt(c.e_value) },
      ...(c.threshold !== undefined ? [{ label: "Needed to be supported", value: fmt(c.threshold) }] : []),
      ...(c.replication_failed ? [{ label: "Independent replication", value: "failed" }] : []),
      ...(pending ? [{ label: "Planned tests without a result", value: String(pending) }] : []),
      { label: "Outputs it depends on", value: (c.artifact_ids ?? []).join(", ") || "none" },
    ],
  }
}

export const kindLabel = (k: NodeKind) => KIND_LABEL[k]
