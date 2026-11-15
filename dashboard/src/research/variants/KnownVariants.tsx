// The Variants tab of the inspector: known variants of the answer's protein, as UniProt reports them with their cited
// papers, and their PREDICTED structures beside the reference's, compared by the model's confidence (pLDDT) at the
// changed position. Nothing here is new: every row is a reported variant. Predictions are made only when this tab is
// opened (GET /api/variants/compare); the engine keeps them, so a second look is quick.
//
// "View" shows the variant's predicted confidence beside the reference's along the protein. When the Structure tab
// (branch fm/research-esm-structure) is in, `onView` opens the variant's 3D prediction there instead.
import { type ReactNode, useEffect, useState } from "react"
import { tracked } from "@/lib/engine"
import { compareUrl, comparisonOf, NOT_MEASURED, signed, type Comparison, type ConfidenceRow, type KnownVariant, type KnownVariants as Known, type Profile } from "./model"

type Load = { state: "loading" } | { state: "done"; comparison: Comparison } | { state: "failed"; error: string }

export function KnownVariants({ variants, onView }: { variants: Known; onView?: (variant: KnownVariant) => void }) {
  const [load, setLoad] = useState<Load>({ state: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState<string>()
  const url = compareUrl(variants)
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const r = await tracked(fetch(url))
        const body = (await r.json().catch(() => undefined)) as { error?: unknown } | undefined
        const comparison = r.ok ? comparisonOf(body) : undefined
        if (!live) return
        setLoad(comparison ? { state: "done", comparison } : { state: "failed", error: typeof body?.error === "string" ? body.error.slice(0, 400) : `The engine answered ${r.status}.` })
      } catch { if (live) setLoad({ state: "failed", error: "The app's engine isn't running, so no structure could be predicted." }) }
    })()
    return () => { live = false }
  }, [url, attempt])

  const retry = () => { setLoad({ state: "loading" }); setAttempt((n) => n + 1) }
  const rowOf = (id: string): ConfidenceRow | undefined => (load.state === "done" ? load.comparison.rows.find((r) => r.id === id) : undefined)
  const name = [variants.protein, variants.gene && `(${variants.gene})`].filter(Boolean).join(" ") || variants.accession
  return (
    <section aria-label="Known variants" className="variants">
      <h3>Known variants of {name}</h3>
      <p className="variants-label" role="note"><strong>Predicted, not measured.</strong> {NOT_MEASURED}</p>
      <p className="muted small">
        {variants.items.length} of {variants.found} single-residue variants that <a href={variants.source} target="_blank" rel="noopener noreferrer">UniProt {variants.accession}</a> reports with cited papers. Nothing here is a new or proposed variant.
        {load.state === "done" && <> Predicted by {load.comparison.modelLabel}.</>}
      </p>
      {load.state === "loading" && <p className="muted small" role="status">Predicting the reference and each variant. This can take a minute the first time.</p>}
      {load.state === "failed" && <p className="small" role="alert">No prediction: {load.error} <button type="button" className="link-btn" onClick={retry}>Try again</button></p>}
      {load.state === "done" && load.comparison.error && <p className="small" role="alert">{load.comparison.error} {/again/i.test(load.comparison.error) && <button type="button" className="link-btn" onClick={retry}>Try again</button>}</p>}
      <table className="variants-table">
        <thead><tr><th scope="col">Variant</th><th scope="col">What the source reports</th><th scope="col">Citation</th><th scope="col">Confidence at that position</th><th scope="col"><span className="sr-only">View</span></th></tr></thead>
        <tbody>
          {variants.items.map((v) => {
            const row = rowOf(v.id)
            const viewable = Boolean(row?.profile && load.state === "done" && load.comparison.reference)
            return (
              <tr key={v.id}>
                <th scope="row" className="mono">{v.id}<span className="muted small"> {v.kind}</span></th>
                <td className="small">{v.reported}</td>
                <td className="small">{v.citations.map((c) => <a key={c.url} href={c.url} target="_blank" rel="noopener noreferrer">{c.label}</a>).reduce<ReactNode[]>((all, a, i) => (i ? [...all, ", ", a] : [a]), [])}{" · "}<a href={v.record} target="_blank" rel="noopener noreferrer">UniProt</a></td>
                <td className="small mono" data-testid={`change-${v.id}`}>{row?.change !== undefined ? <>{signed(row.change)}<span className="muted"> ({row.reference?.toFixed(1)} → {row.variant?.toFixed(1)})</span></> : row?.error ? <span className="muted">{row.error}</span> : load.state === "loading" ? <span className="muted">predicting…</span> : <span className="muted">not predicted</span>}</td>
                <td><button type="button" className="link-btn" aria-pressed={open === v.id} disabled={!viewable} onClick={() => { if (onView) onView(v); else setOpen(open === v.id ? undefined : v.id) }}>{open === v.id ? "Hide" : "View"}</button></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {open && load.state === "done" && load.comparison.reference && rowOf(open)?.profile && (
        <ConfidenceView id={open} position={rowOf(open)!.position} reference={load.comparison.reference} variant={rowOf(open)!.profile!} />
      )}
    </section>
  )
}

/** The predicted confidence of the reference and of one variant, side by side along the protein, the changed position marked. */
function ConfidenceView({ id, position, reference, variant }: { id: string; position: number; reference: Profile; variant: Profile }) {
  const w = 320, h = 90, n = Math.max(reference.plddt.length, variant.plddt.length, 1)
  const x = (i: number) => (i / Math.max(1, n - 1)) * w
  const y = (v: number) => h - (Math.min(100, Math.max(0, v)) / 100) * h
  const line = (p: number[]) => p.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")
  return (
    <figure className="variants-view" aria-label={`Predicted confidence of ${id} beside the reference`}>
      <div className="variants-side">
        <div><span className="variants-key" data-line="reference" /> Reference: mean pLDDT {reference.meanPlddt.toFixed(1)}</div>
        <div><span className="variants-key" data-line="variant" /> {id}: mean pLDDT {variant.meanPlddt.toFixed(1)}</div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={`pLDDT along the protein; position ${position} is marked`}>
        <line x1={x(position - 1)} x2={x(position - 1)} y1={0} y2={h} className="variants-mark" />
        <path d={line(reference.plddt)} className="variants-line" data-line="reference" />
        <path d={line(variant.plddt)} className="variants-line" data-line="variant" />
      </svg>
      <figcaption className="muted small">Model confidence (pLDDT) per residue, predicted, not measured. Position {position} is marked.</figcaption>
    </figure>
  )
}
