// The Structure tab of the Research inspector: the proteins of the answer (UniProt records among its sources, sequences
// written in the question or the answer, test proteins the question names), and the built-in test proteins. Opening one
// shows its predicted 3D structure: ESMFold (Meta AI) when the sequence fits its free API, else AlphaFold DB's model,
// always named. A prediction, never shown as an experimental structure.
import { lazy, Suspense, useEffect, useState } from "react"
import "@/design/structure.css"
import type { Protein, Source } from "../model"
import { fetchStructure, fetchTestProteins, type Model, type Structure, StructureFailed, testAsProtein, type TestProtein } from "./api"
import { BANDS, bandOf } from "./plddt"

const Viewer3D = lazy(() => import("./Viewer3D"))

/** ESMFold's free API folds at most this many residues (engine/src/structure/fold.ts). */
export const MAX_ESMFOLD = 400
const uniprotPage = (accession: string) => `https://www.uniprot.org/uniprotkb/${accession}/entry`

function whereFrom(p: Protein): string {
  if (p.from === "source") return p.source !== undefined ? `UniProt record, source ${p.source}` : "UniProt record"
  if (p.from === "question") return "Written in the question"
  if (p.from === "answer") return "Written in the answer"
  return "Test protein"
}

/** One line of facts: gene, organism (with the strain), length. */
const facts = (p: Protein) => [p.gene, p.organism, p.length !== undefined ? `${p.length.toLocaleString()} amino acids` : undefined].filter(Boolean).join(" · ")

export default function StructureTab({ proteins, sources = [] }: { proteins: Protein[]; sources?: Source[] }) {
  const [open, setOpen] = useState<string>() // the key of the protein whose structure is shown
  const [tests, setTests] = useState<TestProtein[]>()
  useEffect(() => { let on = true; void fetchTestProteins().then((t) => { if (on) setTests(t) }); return () => { on = false } }, [])
  const testProteins = (tests ?? []).map(testAsProtein).filter((t) => !proteins.some((p) => p.key === t.key))
  const row = (p: Protein) => {
    const src = p.source !== undefined ? sources.find((s) => s.n === p.source) : undefined
    const shown = open === p.key
    return (
      <li key={p.key} className="structure-item" data-open={shown || undefined}>
        <span className="structure-head">
          <span className="inspector-title">{p.name}</span>
          <button type="button" className="btn structure-open" aria-expanded={shown} aria-controls={`structure-${p.key}`} onClick={() => setOpen(shown ? undefined : p.key)}>{shown ? "Hide structure" : "Show structure"}</button>
        </span>
        {facts(p) && <span className="small">{facts(p)}</span>}
        <span className="muted small">
          {whereFrom(p)}{src && <> · <a href={src.url} target="_blank" rel="noopener noreferrer">{src.title || src.url}</a></>}
          {p.accession && <> · <a href={uniprotPage(p.accession)} target="_blank" rel="noopener noreferrer">UniProt {p.accession}</a></>}
          {p.note && <> · {p.note}</>}
        </span>
        {shown && <div id={`structure-${p.key}`}><StructureView protein={p} /></div>}
      </li>
    )
  }
  return (
    <>
      {proteins.length > 0 && (
        <section aria-label="Proteins in this answer">
          <h3>Proteins in this answer</h3>
          <p className="muted small">Found by the engine's code in the answer's UniProt records, its question and its text. A structure is fetched only when you open it.</p>
          <ul className="structure-list">{proteins.map(row)}</ul>
        </section>
      )}
      <section aria-label="Try a test protein">
        <details className="structure-tests" open={!proteins.length}>
          <summary>Try a test protein{testProteins.length ? ` (${testProteins.length})` : ""}</summary>
          <p className="muted small">Real UniProt entries from several organisms and strains, short enough for ESMFold. Use them to try this view.</p>
          {tests === undefined ? <p className="muted small" role="status">Loading the test proteins…</p>
            : testProteins.length ? <ul className="structure-list">{testProteins.map(row)}</ul>
            : <p className="muted small">The engine sent no test proteins. Is it running and up to date?</p>}
        </details>
      </section>
    </>
  )
}

/** One protein's structure: loading, an error with a way on, or the 3D view with its legend, model and links. */
export function StructureView({ protein }: { protein: Protein }) {
  const [prefer, setPrefer] = useState<Model>()
  const [again, setAgain] = useState(0)
  // The protein's identity, not its object: the answer's state is folded again on every event, which makes new objects.
  const ask = `${protein.key}|${protein.sequence ?? ""}|${protein.accession ?? ""}|${prefer ?? ""}|${again}`
  // The outcome of one request, marked with the request it answers: anything else is still loading.
  const [done, setDone] = useState<{ ask: string; error?: string; retry?: boolean; structure?: Structure }>()
  useEffect(() => {
    const abort = new AbortController()
    fetchStructure(protein, prefer, abort.signal).then((structure) => setDone({ ask, structure }), (error: unknown) => {
      if (!abort.signal.aborted) setDone({ ask, error: error instanceof StructureFailed ? error.message : "The structure could not be fetched.", retry: !(error instanceof StructureFailed) || error.retry })
    })
    return () => abort.abort()
  }, [ask]) // eslint-disable-line react-hooks/exhaustive-deps
  const state: { loading: true } | { error: string; retry: boolean } | { structure: Structure } = done?.ask !== ask ? { loading: true } : done.structure ? { structure: done.structure } : { error: done.error ?? "The structure could not be fetched.", retry: done.retry !== false }
  const long = (protein.length ?? protein.sequence?.length ?? 0) > MAX_ESMFOLD
  if ("loading" in state) return (
    <p className="structure-status muted small" role="status" aria-live="polite">
      {prefer === "alphafold" || long ? "Fetching AlphaFold DB's model…" : `Predicting the structure with ESMFold (Meta AI). This takes a few seconds, or up to half a minute.${protein.accession ? " If ESMFold does not answer, AlphaFold DB's model is shown instead." : ""}`}
    </p>
  )
  if ("error" in state) return (
    <div className="structure-status" role="alert">
      <p className="structure-error">{state.error}</p>
      <p className="structure-acts">
        {state.retry && <button type="button" className="link-btn" onClick={() => setAgain((n) => n + 1)}>Try again</button>}
        {protein.accession && prefer !== "alphafold" && <button type="button" className="link-btn" onClick={() => setPrefer("alphafold")}>Show AlphaFold DB's model instead</button>}
      </p>
    </div>
  )
  const s = state.structure
  const band = bandOf(s.meanPlddt)
  const accession = s.accession ?? protein.accession
  return (
    <figure className="structure-view">
      <Suspense fallback={<div className="structure-canvas structure-loading muted small" role="status">Loading the 3D viewer…</div>}>
        <Viewer3D pdb={s.pdb} label={protein.name} />
      </Suspense>
      <figcaption>
        <p className="structure-model"><span className="pill" data-model={s.model}>{s.model === "esmfold" ? "ESMFold" : "AlphaFold DB"}</span> <span className="small">Predicted by {s.modelLabel}. A prediction, not an experimental structure.</span></p>
        <p className="small">{s.length.toLocaleString()} residues · mean pLDDT <span className="mono">{s.meanPlddt.toFixed(1)}</span> ({band.label.toLowerCase()}){s.cached ? " · kept from an earlier view" : ""}</p>
        {s.note && <p className="small structure-note">{s.note}</p>}
        <ul className="structure-legend" aria-label="Colour: the model's confidence in each residue (pLDDT)">
          {BANDS.map((b) => <li key={b.label}><span className="structure-swatch" style={{ background: b.color }} aria-hidden="true" />{b.label} <span className="muted">({b.means})</span></li>)}
        </ul>
        <p className="structure-acts small">
          <a href={s.link} target="_blank" rel="noopener noreferrer">{s.model === "esmfold" ? "About ESMFold and the ESM Atlas" : `AlphaFold DB entry ${accession ?? ""}`}</a>
          {accession && <a href={s.uniprot ?? uniprotPage(accession)} target="_blank" rel="noopener noreferrer">UniProt {accession}</a>}
          {s.model === "esmfold" && accession && <button type="button" className="link-btn" onClick={() => setPrefer("alphafold")}>Compare with AlphaFold DB</button>}
          {s.model === "alphafold" && prefer === "alphafold" && !long && <button type="button" className="link-btn" onClick={() => setPrefer("esmfold")}>Predict with ESMFold</button>}
        </p>
      </figcaption>
    </figure>
  )
}
