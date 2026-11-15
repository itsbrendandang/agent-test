// The hypotheses an answer tests, as a small map: the question, and under it one card per hypothesis with what the
// test found and the sources on each side. Everything here is the engine's: the hypotheses are set by a
// `hypotheses` event, what is being done comes from the steps tagged with a hypothesis, and a mark comes only from
// `hypothesis.checked` (computed by the engine's code from checked statements). The page never works out a mark.
// "Tested" means checked against published sources; nothing here is an experiment, and the map says so.
import { MARK_GLYPH, MARK_WORD, markOf } from "./marks"
import { agentName, HYPOTHESES_NOTE, testedWith } from "./hypothesisWords"
import { hypothesisDoing, hypothesisWork, oncePractice, type AnswerState, type Hypothesis } from "./model"

/**
 * The mark of a tested hypothesis: glyph and word. In a practice run it has a dashed outline and no colour, and its
 * name for a screen reader says it is not a real result (the answer's Practice badge says so once in words).
 */
export function HypothesisMark({ hypothesis: h, demo }: { hypothesis: Hypothesis; demo: boolean }) {
  if (!h.result) return null
  const m = markOf(h.result.verdict)
  const word = `${MARK_WORD[m]}${h.result.mixed ? ": the sources disagree" : ""}`
  if (demo) return <span className="answer-markword" data-mark="unchecked" data-demo="" title="Practice: not a real result" aria-label={`${word} (practice: not a real result)`}>{word}</span>
  return <span className="answer-markword" data-mark={m}><span aria-hidden="true">{MARK_GLYPH[m]}</span> {word}</span>
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

/**
 * One card per hypothesis: its text, its mark, and the sources for and against. The engine's sentence on how the
 * mark was reached is one press away ("Why"); who worked on it is in the activity view.
 */
export function Hypotheses({ state: s, onSource }: { state: AnswerState; onSource?: (n: number) => void }) {
  if (s.hypotheses.length === 0) return null
  const demo = s.mode === "demo"
  const ended = s.status === "done" || s.status === "failed" || s.status === "cancelled"
  const known = (n: number) => s.sources.find((x) => x.n === n)?.title
  return (
    <section className="hyp" aria-label="Hypotheses" data-count={s.hypotheses.length}>
      <h2 className="hyp-title">Hypotheses</h2>
      <ol className="hyp-cards">
        {s.hypotheses.map((h, i) => {
          const doing = hypothesisDoing(s, h.id)
          const why = [h.result?.note, h.result?.testedBy && h.result.testedBy.kind !== "sources" ? testedWith(h.result.testedBy) : undefined].filter(Boolean).join(" ")
          return (
            <li key={h.id} className="hyp-card" data-mark={h.result && !demo ? markOf(h.result.verdict) : undefined}>
              <span className="story-eyebrow">Hypothesis {i + 1}{h.origin === "user" && " · as you stated it"}</span>
              <p className="hyp-text">{demo ? oncePractice(h.text) : h.text}</p>
              {h.result ? (
                <>
                  <p className="hyp-result"><HypothesisMark hypothesis={h} demo={demo} /></p>
                  <div className="hyp-sides">
                    <Chips label="For" numbers={h.result.for} known={known} onSource={onSource} />
                    <Chips label="Against" numbers={h.result.against} known={known} onSource={onSource} />
                  </div>
                  {why && <details className="hyp-why"><summary>Why</summary><p className="muted small">{why}</p></details>}
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
      <p className="muted small">{HYPOTHESES_NOTE}</p>
      <div className="hyp-tablewrap" tabIndex={0} role="group" aria-label="Hypotheses table, scrolls sideways">
        <table className="hyp-table">
          <thead><tr><th scope="col">Hypothesis</th><th scope="col">What would support it</th><th scope="col">What would contradict it</th><th scope="col">Result</th><th scope="col">Sources for</th><th scope="col">Sources against</th><th scope="col">Worked on by</th></tr></thead>
          <tbody>
            {s.hypotheses.map((h, i) => (
              <tr key={h.id}>
                <th scope="row"><span className="muted small">{i + 1}.</span> {demo ? oncePractice(h.text) : h.text}</th>
                <td>{h.supportIf || "not recorded"}</td>
                <td>{h.contradictIf || "not recorded"}</td>
                <td>{h.result ? <><HypothesisMark hypothesis={h} demo={demo} />{h.result.note && <span className="muted small hyp-tablenote">{h.result.note}</span>}</> : <span className="muted small">{hypothesisDoing(s, h.id) ?? "No result recorded"}</span>}</td>
                <td className="mono">{h.result ? h.result.for.join(", ") || "none" : "–"}</td>
                <td className="mono">{h.result ? h.result.against.join(", ") || "none" : "–"}</td>
                <td>{agentName(h.agent) ?? "not recorded"}{hypothesisWork(s, h.id) && <span className="muted small hyp-tablenote">{hypothesisWork(s, h.id)}</span>}{h.result?.testedBy && <span className="muted small hyp-tablenote">{testedWith(h.result.testedBy)}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.hypothesesCut.length > 0 && <><h3>Proposed but not tested</h3><ul className="inspector-notselected">{s.hypothesesCut.map((c, i) => <li key={i}>{c.text}<span className="muted small"> {c.reason}</span></li>)}</ul></>}
    </section>
  )
}
