// The hypotheses an answer tests, as a small map: the question, and under it one card per hypothesis with what the
// test found and the sources on each side. Everything here is the engine's: the hypotheses are set by a
// `hypotheses` event, what is being done comes from the steps tagged with a hypothesis, and a mark comes only from
// `hypothesis.checked` (computed by the engine's code from checked statements). The page never works out a mark.
// "Tested" means checked against published sources; nothing here is an experiment, and the map says so.
import { MARK_GLYPH, MARK_WORD, markOf } from "./marks"
import { HYPOTHESES_NOTE, sidesLine } from "./hypothesisWords"
import { hypothesisDoing, type AnswerState, type Hypothesis } from "./model"

/** The mark of a tested hypothesis: glyph and word. In a practice run it is an example and carries no check glyph. */
export function HypothesisMark({ hypothesis: h, demo }: { hypothesis: Hypothesis; demo: boolean }) {
  if (!h.result) return null
  const m = markOf(h.result.verdict)
  if (demo) return <span className="answer-markword" data-mark="unchecked" data-demo="">Example result: {MARK_WORD[m]}</span>
  return <span className="answer-markword" data-mark={m}><span aria-hidden="true">{MARK_GLYPH[m]}</span> {MARK_WORD[m]}{h.result.mixed && ": the sources disagree"}</span>
}

function Chips({ label, numbers, known, onSource }: { label: string; numbers: number[]; known: (n: number) => string | undefined; onSource?: (n: number) => void }) {
  return (
    <div className="hyp-side">
      <span className="hyp-sidename">{label}</span>
      {numbers.length === 0 ? <span className="muted small">none</span> : (
        <span className="hyp-chips">
          {numbers.map((n) => onSource && known(n) !== undefined
            ? <button key={n} type="button" className="answer-cite" aria-label={`Source ${n}, ${label.toLowerCase()}`} title={known(n)} onClick={() => onSource(n)}>{n}</button>
            : <span key={n} className="answer-cite" data-static="">{n}</span>)}
        </span>
      )}
    </div>
  )
}

export function Hypotheses({ state: s, onSource }: { state: AnswerState; onSource?: (n: number) => void }) {
  if (s.hypotheses.length === 0) return null
  const demo = s.mode === "demo"
  const ended = s.status === "done" || s.status === "failed" || s.status === "cancelled"
  const known = (n: number) => s.sources.find((x) => x.n === n)?.title
  return (
    <section className="hyp" aria-label="Hypotheses" data-count={s.hypotheses.length}>
      <h2 className="hyp-title">Hypotheses{demo && <span className="muted small"> · examples of a practice run</span>}</h2>
      {s.question && <p className="hyp-question"><span className="story-eyebrow">The question</span>{s.question}</p>}
      {/* the branches from the question to each card: decoration */}
      <div className="hyp-branches" aria-hidden="true">{s.hypotheses.map((h) => <span key={h.id} />)}</div>
      <ol className="hyp-cards">
        {s.hypotheses.map((h, i) => {
          const doing = hypothesisDoing(s, h.id)
          return (
            <li key={h.id} className="hyp-card" data-mark={h.result && !demo ? markOf(h.result.verdict) : undefined}>
              <span className="story-eyebrow">Hypothesis {i + 1}{h.origin === "user" && " · as you stated it"}</span>
              <p className="hyp-text">{h.text}</p>
              {h.result ? (
                <>
                  <p className="hyp-result"><HypothesisMark hypothesis={h} demo={demo} /> <span className="muted small">{sidesLine(h.result)}</span></p>
                  {h.result.note && <p className="muted small">{h.result.note}</p>}
                  <div className="hyp-sides">
                    <Chips label="For" numbers={h.result.for} known={known} onSource={onSource} />
                    <Chips label="Against" numbers={h.result.against} known={known} onSource={onSource} />
                  </div>
                </>
              ) : (
                <p className="hyp-result muted small" role="status">
                  {doing ? `${doing}…` : ended ? "No result was recorded for this hypothesis." : s.status === "queued" ? "Waiting to start." : "Not tested yet."}
                </p>
              )}
            </li>
          )
        })}
      </ol>
      {s.hypothesesCut.length > 0 && (
        <details className="hyp-cut">
          <summary>{s.hypothesesCut.length} more {s.hypothesesCut.length === 1 ? "hypothesis was" : "hypotheses were"} proposed but not tested</summary>
          <ul>{s.hypothesesCut.map((c, i) => <li key={i}>{c.text}{c.reason && <span className="muted small"> {c.reason}</span>}</li>)}</ul>
        </details>
      )}
      <p className="muted small hyp-note">{HYPOTHESES_NOTE}</p>
    </section>
  )
}

/** The same data as a table, for the inspector. */
export function HypothesesTable({ state: s }: { state: AnswerState }) {
  const demo = s.mode === "demo"
  return (
    <section aria-label="Hypotheses">
      <h3>Hypotheses</h3>
      <p className="muted small">{demo ? "Examples of a practice run, not real results. " : ""}{HYPOTHESES_NOTE}</p>
      <div className="hyp-tablewrap" tabIndex={0} role="group" aria-label="Hypotheses table, scrolls sideways">
        <table className="hyp-table">
          <thead><tr><th scope="col">Hypothesis</th><th scope="col">What would support it</th><th scope="col">What would contradict it</th><th scope="col">Result</th><th scope="col">Sources for</th><th scope="col">Sources against</th></tr></thead>
          <tbody>
            {s.hypotheses.map((h, i) => (
              <tr key={h.id}>
                <th scope="row"><span className="muted small">H{i + 1}</span> {h.text}</th>
                <td>{h.supportIf || "not recorded"}</td>
                <td>{h.contradictIf || "not recorded"}</td>
                <td>{h.result ? <><HypothesisMark hypothesis={h} demo={demo} />{h.result.note && <span className="muted small hyp-tablenote">{h.result.note}</span>}</> : <span className="muted small">{hypothesisDoing(s, h.id) ?? "No result recorded"}</span>}</td>
                <td className="mono">{h.result ? h.result.for.join(", ") || "none" : "–"}</td>
                <td className="mono">{h.result ? h.result.against.join(", ") || "none" : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.hypothesesCut.length > 0 && <><h3>Proposed but not tested</h3><ul className="inspector-notselected">{s.hypothesesCut.map((c, i) => <li key={i}>{c.text}<span className="muted small"> {c.reason}</span></li>)}</ul></>}
    </section>
  )
}
