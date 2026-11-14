import { activityWeeks, byModel, clearSampleRuns, loadSampleRuns, useRuns } from "@/runs/store"

const pct = (v: number) => `${Math.round(v * 100)}%`
const level = (count: number, max: number) => (count === 0 ? 0 : Math.min(4, Math.ceil((count / max) * 4)))

// Run history for the home page: totals, a GitHub-style activity graph, and results per AI model.
export function RunStats() {
  const runs = useRuns()
  const weeks = activityWeeks(runs)
  const max = Math.max(1, ...weeks.flat().map((c) => c.count))
  const passed = runs.filter((r) => r.ok).length
  const models = byModel(runs)
  const sample = runs.some((r) => r.sample)

  return (
    <section className="runs" aria-label="Runs">
      <header className="runs-head">
        <h2>Runs</h2>
        {sample && <span className="runs-flag">Sample data</span>}
        {sample
          ? <button type="button" className="link-btn" onClick={clearSampleRuns}>Remove</button>
          : runs.length === 0 && <button type="button" className="link-btn" onClick={loadSampleRuns}>Preview with sample data</button>}
      </header>

      <dl className="runs-totals">
        <div><dt>Total</dt><dd>{runs.length.toLocaleString()}</dd></div>
        <div><dt>Success rate</dt><dd>{runs.length ? pct(passed / runs.length) : "—"}</dd></div>
        <div><dt>Passed</dt><dd>{passed.toLocaleString()}</dd></div>
        <div><dt>Failed</dt><dd>{(runs.length - passed).toLocaleString()}</dd></div>
      </dl>

      <div className="runs-graph" role="img"
        aria-label={`${runs.length} runs in the last ${weeks.length} weeks`}>
        {weeks.map((week, w) => (
          <div key={w}>
            {week.map((c) => (
              <i key={c.date.getTime()} data-level={level(c.count, max)} data-future={c.future || undefined}
                title={c.future ? undefined : `${c.count} run${c.count === 1 ? "" : "s"}${c.count ? `, ${c.ok} passed` : ""} on ${c.date.toLocaleDateString([], { month: "short", day: "numeric" })}`} />
            ))}
          </div>
        ))}
      </div>
      <p className="runs-caption">Last {weeks.length} weeks</p>

      <table className="runs-models">
        <caption>Model evaluations</caption>
        <thead>
          <tr><th scope="col">Model</th><th scope="col">Runs</th><th scope="col">Success</th><th scope="col">Score</th></tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.model}>
              <th scope="row">{m.model}</th>
              <td>{m.runs.toLocaleString()}</td>
              <td>
                <span className="runs-bar" aria-hidden="true"><span style={{ width: pct(m.rate) }} /></span>
                {pct(m.rate)}
              </td>
              <td>{m.score === undefined ? "—" : m.score.toFixed(2)}</td>
            </tr>
          ))}
          {models.length === 0 && <tr><td colSpan={4} className="runs-empty">No runs recorded yet.</td></tr>}
        </tbody>
      </table>
    </section>
  )
}
