// Benchmarks: where we stand against the record, said plainly. Two benchmarks that must not be mixed up:
//   BixBench3 (Edison Scientific): the record the track asks us to beat. Shown with its number, and ours only when
//     a real run on a real task exists (a practice run or the demo task is never shown as a score).
//   BixBench v1.5 (public): one agent against the team of nine, from the engine's scoreboard. Rows made with the
//     practice model are left out. A row is a fair comparison only when the engine says both had the same budget.
// Everything comes from the engine (GET /api/glhf/status, /api/glhf/runs, /api/bixv1/scoreboard). No number is typed in here.
import { useEffect, useState } from "react"
import { readEngine } from "@/lib/engine"
import "@/overview/overview.css"

import { plainConclusion, pricedByToken, record3Of, rowsOf, shortModel, type Record3, type Row, type Side } from "@/overview/benchmarkNumbers"

const pct = (x: number) => `${(x * 100).toFixed(1)}%`

const UNKNOWN = "Not known"
const whole = (v: number | undefined) => (v === undefined ? UNKNOWN : Math.round(v).toLocaleString("en-US"))
const minutes = (seconds: number | undefined) => (seconds === undefined ? UNKNOWN : seconds < 90 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`)
const GRADING: Record<string, string> = { "per-mode": "our own rules per question type", official: "the official grader's rules", paper: "the paper's single judge prompt" }

/** One evaluation, set out the usual way: what was run, the setup, then a row per solver with accuracy and cost. */
function Evaluation({ row }: { row: Row }) {
  const sides: [string, Side | undefined][] = [["One agent", row.single], ["Team of nine", row.team]]
  const priced = pricedByToken(row.model)
  const ungraded = sides.filter(([, side]) => side && side.notGraded > 0)
  return (
    <div className="ov-bench-row">
      <div className="ov-bench-head"><b>{shortModel(row.model)}</b><span>{row.questions} {row.questions === 1 ? "question" : "questions"} from {row.datasets || UNKNOWN} {row.datasets === 1 ? "dataset" : "datasets"}</span></div>
      <dl className="ov-setup">
        <div><dt>Model</dt><dd>{row.model}</dd></div>
        <div><dt>Comparison</dt><dd>{row.fair ? "Like for like: both had the same token limit" : "Not like for like"}</dd></div>
        <div><dt>Graded by</dt><dd>{row.grading ? GRADING[row.grading] ?? row.grading : UNKNOWN}</dd></div>
        <div><dt>Answers</dt><dd>{row.answerMode === "open" ? "Open answers (no multiple choice)" : row.answerMode ?? UNKNOWN}</dd></div>
        <div><dt>Limits</dt><dd>{row.timeLimit ? `${Math.round(row.timeLimit / 60)} minutes a run` : UNKNOWN}; {row.tokenBudget ? `${whole(row.tokenBudget)} tokens in all for each` : "token limit not known"}</dd></div>
      </dl>
      <div className="ov-scroll">
        <table className="ov-table ov-eval">
          <thead><tr><th scope="col">Solver</th><th scope="col">Correct</th><th scope="col">Accuracy</th><th scope="col">95% interval</th><th scope="col">Not graded</th><th scope="col">Tokens</th><th scope="col">Per question</th><th scope="col">Time</th><th scope="col">Cost</th></tr></thead>
          <tbody>
            {sides.map(([name, side]) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                {side ? (
                  <>
                    <td>{side.correct} of {side.n}</td>
                    <td>{side.notGraded ? "at least " : ""}{pct(side.accuracy)}</td>
                    <td>{side.interval ? `${pct(side.interval[0])} to ${pct(side.interval[1])}` : UNKNOWN}</td>
                    <td>{side.notGraded}</td>
                    <td>{whole(side.tokens)}</td>
                    <td>{side.tokens === undefined ? UNKNOWN : whole(side.tokens / side.n)}</td>
                    <td>{minutes(side.seconds)}</td>
                    <td>{priced && side.costUsd !== undefined ? `about $${side.costUsd.toFixed(2)}` : UNKNOWN}</td>
                  </>
                ) : <td colSpan={8}>Not run</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ov-note">
        {priced ? "Cost is an estimate: tokens at assumed list prices, without the judge." : "Cost is not known here: this model ran on rented GPUs, which are paid by the second, and that bill is not in the run records."}
        {ungraded.length > 0 && ` ${ungraded.map(([name, side]) => `${name}: ${side!.notGraded} of ${side!.n}`).join("; ")} answers were not graded (they need a judge model that was not used) and count as wrong, so the accuracy is a lower bound.`}
        {sides.some(([, side]) => side && side.failedRuns > 0) && " Some runs failed; their questions count as wrong."}
      </p>
      {row.conclusion && <p className="ov-note"><b>Reading: </b>{plainConclusion(row.conclusion)}</p>}
    </div>
  )
}

export function Benchmarks() {
  const [rows, setRows] = useState<Row[]>()
  const [three, setThree] = useState<Record3>()
  useEffect(() => {
    let stopped = false
    void Promise.allSettled([readEngine<unknown>("/api/glhf/status"), readEngine<unknown>("/api/glhf/runs"), readEngine<unknown>("/api/bixv1/scoreboard")]).then(([status, runs, board]) => {
      if (stopped) return
      setThree(record3Of(status.status === "fulfilled" ? status.value : undefined, runs.status === "fulfilled" ? runs.value : undefined))
      setRows(board.status === "fulfilled" ? rowsOf(board.value) : [])
    })
    return () => { stopped = true }
  }, [])

  return (
    <section className="ov-card" aria-labelledby="ov-bench">
      <h2 id="ov-bench">Benchmarks</h2>
      <p>Two different benchmarks. A score on one says nothing about the other.</p>
      <div className="ov-stack">
        <div className="ov-bench">
          <h3>BixBench3 <small>Edison Scientific · 20 studies rebuilt from raw data</small></h3>
          <div className="ov-bench-pair">
            <div><b>{three?.record !== undefined ? three.record.toFixed(3) : "–"}</b><span>Record to beat</span></div>
            <div><b>{three?.best !== undefined ? three.best.toFixed(3) : "–"}</b><span>{three?.realRuns ? `Our best of ${three.realRuns} real ${three.realRuns === 1 ? "run" : "runs"}` : "Ours: not known (no real run yet)"}</span></div>
          </div>
          {!three?.realRuns && <p className="ov-note">We have not run a real BixBench3 task, so we do not know how we compare with the record.</p>}
        </div>
        <div className="ov-bench">
          <h3>BixBench v1.5 <small>public · 205 questions on 59 datasets</small></h3>
          {rows && !rows.length && <p className="ov-note">No run with a real model yet.</p>}
          {rows?.map((row) => <Evaluation key={`${row.model}/${row.questions}`} row={row} />)}
          {!!rows?.length && <p className="ov-note">Not comparable with published BixBench numbers: our sandbox has no network and answers that need a judge model may be ungraded (they count as wrong).</p>}
        </div>
      </div>
    </section>
  )
}
