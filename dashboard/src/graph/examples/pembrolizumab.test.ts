// The built-in cancer-drug example: it loads, it builds a legible graph, and every fact in it points at a real public
// record in a well-formed address. Nothing here goes on the network: the links were opened when the example was made.
import { describe, expect, it } from "vitest"
import { CANCER_DRUG, STARTERS } from "@/overview/starters"
import { buildBoardGraph, safeUrl } from "../model"
import type { GraphModel } from "../types"
import { EXAMPLE_EVENTS, EXAMPLE_ID, EXAMPLE_QUESTION, EXAMPLE_ROSTER, RETRIEVED_ON, SOURCES, STAGES } from "./pembrolizumab"

const model = (): GraphModel => buildBoardGraph({ runId: EXAMPLE_ID, events: EXAMPLE_EVENTS, roster: EXAMPLE_ROSTER, example: { retrievedOn: RETRIEVED_ON } })
const sources = Object.values(SOURCES)
/** The only places the example's records come from. */
const HOSTS = new Set(["pubmed.ncbi.nlm.nih.gov", "clinicaltrials.gov", "www.accessdata.fda.gov", "dailymed.nlm.nih.gov"])
const everyText = () => JSON.stringify(EXAMPLE_EVENTS)

describe("the cancer-drug example's record", () => {
  it("is a finished board run record, in order, with unique keys and known members", () => {
    expect(EXAMPLE_EVENTS[0].type).toBe("run.started")
    expect(EXAMPLE_EVENTS.at(-1)!.type).toBe("run.finished")
    expect(new Set(EXAMPLE_EVENTS.map((e) => e.key)).size).toBe(EXAMPLE_EVENTS.length)
    const names = new Set(EXAMPLE_ROSTER.map((m) => m.name))
    for (const e of EXAMPLE_EVENTS) if ("member" in e && typeof e.member === "string") expect(names.has(e.member), e.member).toBe(true)
    const rounds = EXAMPLE_EVENTS.filter((e) => e.type === "round.started")
    expect(rounds.map((e) => (e as { title?: string }).title)).toEqual([...STAGES])
    expect(RETRIEVED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it("costs nothing and calls no model: every ruling is the hand check against the linked record", () => {
    const finished = EXAMPLE_EVENTS.find((e) => e.type === "run.finished") as { usd: number }
    expect(finished.usd).toBe(0)
    for (const e of EXAMPLE_EVENTS) if (e.type === "claim.checked") expect(e.checker).toBe("source-check")
    for (const m of EXAMPLE_ROSTER) expect(m.modelId).toBe("none (example)")
  })

  it("links every source and notice to a real public record over https, never to a made-up or unsafe address", () => {
    for (const s of sources) {
      for (const url of [s.url, ...("notice" in s && s.notice ? [s.notice.url] : [])]) {
        const u = new URL(url)
        expect(u.protocol, url).toBe("https:")
        expect(HOSTS.has(u.hostname), url).toBe(true)
        expect(safeUrl(url)).toBe(u.href)
        if (u.hostname === "pubmed.ncbi.nlm.nih.gov") expect(u.pathname, url).toMatch(/^\/[1-9]\d{6,8}\/$/)
        if (u.hostname === "clinicaltrials.gov") expect(u.pathname, url).toMatch(/^\/study\/NCT\d{8}$/)
        if (u.hostname === "www.accessdata.fda.gov") expect(url).toMatch(/125514|761467/) // KEYTRUDA's two BLAs
      }
    }
    expect(new Set(sources.map((s) => s.url)).size).toBe(sources.length)
  })

  it("names no trial that is not one of its linked registry records", () => {
    const linked = new Set(sources.flatMap((s) => s.url.match(/NCT\d{8}/g) ?? []))
    const named = new Set([...everyText().matchAll(/NCT\d+/g)].map((m) => m[0]))
    for (const id of named) {
      expect(id, id).toMatch(/^NCT\d{8}$/)
      // The retracted pancreatic trial is named by its republished report, which is linked; every other trial has its registry record.
      if (id !== "NCT02704156") expect(linked.has(id), id).toBe(true)
    }
    expect(linked.size).toBeGreaterThanOrEqual(5)
  })

  it("cites every PubMed id it names as a link, in the PubMed id format", () => {
    const linked = new Set(sources.flatMap((s) => [s.url, "notice" in s && s.notice ? s.notice.url : ""]).map((u) => u.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/)?.[1]).filter(Boolean))
    const named = [...everyText().matchAll(/PubMed (\d+(?:, \d+)*)/g)].flatMap((m) => m[1].split(", "))
    expect(named.length).toBeGreaterThan(0)
    // Two of KEYNOTE-048's three notices are named only in the first notice's text; the rest are links.
    for (const id of named) expect(id).toMatch(/^[1-9]\d{6,8}$/)
    expect(named.filter((id) => !linked.has(id)).sort()).toEqual(["32087792", "34119067"])
  })

  it("says what was wrong for every article with a notice, or says that the free record does not say", () => {
    const flagged = sources.filter((s) => "notice" in s && s.notice)
    expect(flagged).toHaveLength(6)
    for (const s of flagged) {
      const notice = (s as { notice: { type: string; what: string; date?: string } }).notice
      expect(["retraction", "correction", "expression of concern"]).toContain(notice.type)
      expect(notice.what.length).toBeGreaterThan(20)
      expect(notice.date).toMatch(/^\d{4}/)
    }
  })

  it("is the first example question, in the words of a short chip", () => {
    expect(STARTERS[0]).toBe(CANCER_DRUG)
    expect(CANCER_DRUG.question.length).toBeLessThanOrEqual(60)
    expect(CANCER_DRUG.question).toMatch(/Pembrolizumab/)
    expect(EXAMPLE_QUESTION).toMatch(/biomanufacturing to FDA approval/)
  })
})

describe("the cancer-drug example's graph", () => {
  const g = model()
  const phases = g.nodes.filter((n) => n.kind === "phase").sort((a, b) => a.lane! - b.lane!)

  it("is labelled as an example, not as practice or live research", () => {
    expect(g.example).toEqual({ retrievedOn: RETRIEVED_ON })
    expect(g.scripted).toBeUndefined()
    expect(g.status).toBe("done")
    expect(g.notes[0]).toMatch(/built-in example, not a run/)
    const run = g.nodes.find((n) => n.kind === "run")!
    expect(run.facts.find((f) => f.label === "Cost")?.value).toBe("$0: no model was called")
    expect(run.facts.some((f) => f.label === "Took")).toBe(false)
  })

  it("draws the stages in order, one lane each, chained from first to last", () => {
    expect(g.lanes).toEqual([...STAGES])
    expect(phases.map((p) => p.lane)).toEqual(STAGES.map((_, i) => i))
    expect(phases[0].label).toBe("Round 1: Biomanufacturing and quality (CMC)")
    for (let i = 1; i < phases.length; i++) expect(g.links.some((l) => l.kind === "next" && l.source === phases[i - 1].id && l.target === phases[i].id), phases[i].label).toBe(true)
    expect(g.marks.map((m) => m.label)[2]).toBe("3. IND and Phase 1")
    for (const n of g.nodes) if (n.kind === "claim" || n.kind === "source") expect(n.lane, n.label).toBeGreaterThanOrEqual(0)
    for (const n of g.nodes) if (n.kind === "agent" || n.kind === "checker" || n.kind === "run") expect(n.lane).toBeUndefined()
  })

  it("is a long run: many statements by several roles, each checked, some failing", () => {
    expect(g.totals.claims).toBeGreaterThanOrEqual(45)
    expect(g.totals.members).toBeGreaterThanOrEqual(6)
    expect(g.totals.byOutcome.fails).toBe(1)
    expect(g.totals.byVerdict.unsupported).toBe(4)
    expect(g.totals.byVerdict.unchecked).toBe(1)
    expect(g.maxOrder).toBeGreaterThan(80)
    expect(g.steps.every((s) => s.at === undefined)).toBe(true) // no clock: nothing ran
  })

  it("links each checked statement to the record it was checked against", () => {
    const claims = g.nodes.filter((n) => n.kind === "claim")
    const cites = new Set(g.links.filter((l) => l.kind === "cites").map((l) => l.source))
    const unlinked = claims.filter((c) => !cites.has(c.id))
    expect(unlinked.map((c) => c.verdict?.raw)).toEqual(["unchecked"]) // only the forecast has no record
  })

  it("flags the articles with errors as sources, with what was wrong and the notice", () => {
    const flagged = g.nodes.filter((n) => n.flag)
    expect(flagged.every((n) => n.kind === "source")).toBe(true)
    expect(flagged.filter((n) => n.flag!.type === "retraction")).toHaveLength(4)
    expect(flagged.filter((n) => n.flag!.type === "correction")).toHaveLength(2)
    for (const n of flagged) {
      expect(n.attention).toBe(n.flag!.type === "retraction" ? 2 : 1)
      expect(n.facts.find((f) => f.label === "What was wrong")?.value).toBe(n.flag!.what)
      expect(n.flag!.url).toMatch(/^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//)
    }
    const sbrt = flagged.find((n) => n.label.startsWith("SBRT plus pembrolizumab"))!
    expect(sbrt.flag!.what).toMatch(/14\.9 versus 12\.8 months/)
  })

  it("shows the contradicted statement against the corrected report", () => {
    const wrong = g.nodes.find((n) => n.kind === "claim" && n.verdict?.cls === "fails")!
    expect(wrong.text).toMatch(/24\.9 versus 22\.4 months/)
    const cited = g.links.find((l) => l.kind === "cites" && l.source === wrong.id)!
    expect(cited.target).toBe(`source:${SOURCES.sbrtRepublished.url}`)
  })
})
