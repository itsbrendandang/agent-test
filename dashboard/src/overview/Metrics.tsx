// The home page's numbers, from what the engine recorded and nothing else. Example runs are never counted; spend today and the limits are the engine's own figures (GET /api/paid); the rest is counted from
// the run lists for research runs or for practice runs, never the two mixed. A number with nothing behind it says so.
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { plainDuration } from "@/lib/format"
import { checksOfAll, countsOf, perAnswer, recentSpend, sourcesOf, usdText, type Paid, type Scope, type Work } from "./work"

const share = (part: number | undefined, whole: number | undefined) => (part === undefined || !whole ? 0 : Math.min(100, (part / whole) * 100))
const many = (n: number, one: string, more = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : more}`

function Tile({ label, value, children, empty }: { label: string; value: string; children?: React.ReactNode; empty?: boolean }) {
  return (
    <div className="ov-tile ov-metric" data-empty={empty || undefined}>
      <span>{label}</span>
      <b>{value}</b>
      {children}
    </div>
  )
}

export function Metrics({ works, paid, scope, onScope }: { works: Work[]; paid: Paid | null | undefined; scope: Scope; onScope: (scope: Scope) => void }) {
  const counts = countsOf(works, scope)
  const week = recentSpend(works, 7)
  const answer = perAnswer(works, scope)
  const sources = sourcesOf(works, scope)
  const checks = checksOfAll(works, scope)
  const which = scope === "research" ? "research" : "practice"
  return (
    <div className="ov-metrics">
      <div className="ov-tiles" data-cols="3">
        <Tile label="Spent today" value={paid ? usdText(paid.spentToday) : "Not known"} empty={!paid || paid.spentToday === undefined}>
          {paid ? <>
            <small>{paid.daily !== undefined ? `of a ${usdText(paid.daily)} daily limit, for all runs.` : "No daily limit was reported."}{paid.real === false ? " Demo mode: nothing can be spent." : " Until each one ends, a running real team review counts at the limit per team review and a running real answer at its own cap."}</small>
            <div className="ov-track" role="img" aria-label={`${Math.round(share(paid.spentToday, paid.daily))}% of the daily limit`}><i data-made="research" style={{ width: `${share(paid.spentToday, paid.daily)}%` }} /></div>
          </> : <small>The engine did not report its spend.</small>}
        </Tile>
        <Tile label="Last 7 days" value={week ? usdText(week.usd) : "Nothing recorded"} empty={!week}>
          <small>{week ? `Recorded by ${many(week.runs, "research answer or review", "research answers and reviews")} started in the last 7 days.` : "No research answer or team review in the last 7 days recorded a cost."} Benchmark runs do not record dollars.</small>
        </Tile>
        <Tile label="Limit per team review" value={paid ? usdText(paid.perRun) : "Not known"} empty={!paid || paid.perRun === undefined}>
          <small>A team review stops when it reaches it. Each answer stops at its own level's cap.</small>
          {paid && paid.exaCeiling !== undefined && <>
            <small>Web search (Exa): {usdText(paid.exaUsed)} of a {usdText(paid.exaCeiling)} ceiling, all time</small>
            <div className="ov-track" role="img" aria-label={`${Math.round(share(paid.exaUsed, paid.exaCeiling))}% of the web search ceiling`}><i data-made="research" style={{ width: `${share(paid.exaUsed, paid.exaCeiling)}%` }} /></div>
          </>}
        </Tile>
      </div>

      <div className="ov-scope">
        <h3 id="ov-scope-title">Which runs are counted</h3>
        <ButtonGroup aria-labelledby="ov-scope-title">
          <Button size="sm" variant={scope === "research" ? "secondary" : "outline"} aria-pressed={scope === "research"} onClick={() => onScope("research")}>Research runs</Button>
          <Button size="sm" variant={scope === "practice" ? "secondary" : "outline"} aria-pressed={scope === "practice"} onClick={() => onScope("practice")}>Practice runs</Button>
        </ButtonGroup>
      </div>
      <div className="ov-tiles" data-cols="5">
        <Tile label="Runs" value={many(counts.done + counts.running + counts.failed + counts.stopped, "run")}>
          <small className="ov-split"><span><b>{counts.done}</b> done</span><span><b>{counts.running}</b> running</span><span data-tone={counts.failed ? "bad" : undefined}><b>{counts.failed}</b> failed</span>{counts.stopped > 0 && <span><b>{counts.stopped}</b> stopped</span>}</small>
          <small>{scope === "research" ? "Research runs only: practice runs are counted apart." : "Practice runs only: scripted models, $0."}</small>
        </Tile>
        <Tile label="Average time per answer" value={answer.seconds === undefined ? "No data" : plainDuration(answer.seconds * 1000)} empty={answer.seconds === undefined}>
          <small>{answer.timed ? `Over ${many(answer.timed, `finished ${which} answer`)}.` : `No finished ${which} answer recorded its time yet.`}</small>
        </Tile>
        <Tile label="Average cost per answer" value={scope === "practice" && answer.answers ? "$0" : answer.usd === undefined ? "No data" : usdText(answer.usd)} empty={answer.usd === undefined}>
          <small>{scope === "practice" ? "Practice answers use scripted models and cost nothing." : answer.priced ? `Over ${many(answer.priced, "finished research answer")}.` : "No finished research answer recorded a cost yet."}</small>
        </Tile>
        <Tile label="Sources" value={sources.from ? many(sources.cited, "cited", "cited") : "No data"} empty={!sources.from}>
          <small>{sources.from ? `${many(sources.searches, "search", "searches")} run, ${many(sources.kept, "source")} kept${sources.answers ? ` across ${many(sources.answers, "answer")}` : ""}. Cited counts answers only.` : `No ${which} run recorded a search yet.`}</small>
        </Tile>
        <Tile label="Checks" value={checks.total ? `${checks.passed} of ${checks.total} passed` : "No data"} empty={!checks.total}>
          {checks.total ? <>
            <small className="ov-split"><span><b>{checks.passed}</b> passed</span><span data-tone={checks.failed ? "bad" : undefined}><b>{checks.failed}</b> failed</span><span><b>{checks.unchecked}</b> not checked</span></small>
            <div className="ov-track ov-checks" role="img" aria-label={`${checks.passed} passed, ${checks.failed} failed, ${checks.unchecked} not checked`}>
              <i data-tone="good" style={{ width: `${share(checks.passed, checks.total)}%` }} /><i data-tone="bad" style={{ width: `${share(checks.failed, checks.total)}%` }} />
            </div>
            <small>Cited sentences of answers and claims of team reviews, by the verdict each was given.</small>
          </> : <small>No {which} sentence or claim has been checked yet.</small>}
        </Tile>
      </div>
    </div>
  )
}
