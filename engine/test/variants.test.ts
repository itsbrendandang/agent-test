// Known variants and their predicted confidence (src/variants/), with fakes only: UniProt is answered from a saved entry
// (fixtures/variants/uniprot-P01116.json, KRAS, saved 2026-11-15), ESMFold by a fake that writes a small PDB file.
// Nothing here reaches the network.
import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

process.env.NO_PAID_CALLS = "1"
const { createHttp } = await import("../src/sources/shared.ts")
const { changesIn, entryUrl, geneUrl, lookupVariants, MAX_VARIANTS, pickVariants, readEntry, variantsOf, variantTarget } = await import("../src/variants/known.ts")
const { compareVariants, mutate } = await import("../src/variants/compare.ts")
const { cleanPdb, createEsmFold, ESMFOLD_URL, FoldError, MAX_ESMFOLD } = await import("../src/variants/fold.ts")
const { createVariants } = await import("../src/variants/routes.ts")
const { loadConfig } = await import("../src/config.ts")
import type { Fold, Folded } from "../src/variants/fold.ts"

const ENTRY = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/variants/uniprot-P01116.json"), "utf8")) as Record<string, unknown> & { sequence: { value: string } }
const SEQ = ENTRY.sequence.value
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

/** A fake UniProt: the saved KRAS entry, and the gene search that finds it. Counts the requests. */
function fakeUniprot() {
  const asked: string[] = []
  const fetch = (async (input: Parameters<typeof globalThis.fetch>[0]) => {
    const url = String(input)
    asked.push(url)
    if (url === entryUrl("P01116")) return json(ENTRY)
    if (url === geneUrl("KRAS")) return json({ results: [{ primaryAccession: "P01116" }] })
    if (url.startsWith("https://rest.uniprot.org/uniprotkb/search?")) return json({ results: [] })
    if (url.startsWith("https://rest.uniprot.org/uniprotkb/")) return json({ messages: ["not found"] }, 404)
    throw new Error(`a test tried to reach ${url}`)
  }) as typeof globalThis.fetch
  return { asked, http: createHttp({ fetch, minGapMs: 0, cacheMs: 60_000 }) }
}

/** A PDB text with one CA atom per residue; pLDDT `b(i)` for residue i (1-based), on ESMFold's 0-1 scale. */
const pdbOf = (sequence: string, b: (i: number) => number) => sequence.split("").map((_aa, k) => {
  const i = k + 1
  return `ATOM  ${String(i).padStart(5)}  CA  ALA A${String(i).padStart(4)}    ${"0.000".padStart(8)}${"0.000".padStart(8)}${"0.000".padStart(8)}  1.00${b(i).toFixed(2).padStart(6)}           C`
}).join("\n") + "\nEND\n"

/** A fake fold: 0.9 everywhere, except that a changed residue of a variant gets 0.5. Counts what it folded. */
function fakeFold(fail: string[] = []): { fold: Fold; folded: string[] } {
  const folded: string[] = []
  const fold: Fold = async (sequence) => {
    folded.push(sequence)
    if (fail.some((f) => sequence === f)) throw new FoldError("ESMFold answered 500")
    const { pdb, meanPlddt, residues } = cleanPdb(pdbOf(sequence, (i) => (sequence[i - 1] !== SEQ[i - 1] ? 0.5 : 0.9)))
    return { model: "esmfold", modelLabel: "ESMFold", link: "", length: residues, sequence, meanPlddt, pdb, cached: false, at: 0 } satisfies Folded
  }
  return { fold, folded }
}

test("which protein an answer is about: an accession in the question, then a gene symbol in a question about variants, then a UniProt source", () => {
  assert.deepEqual(variantTarget("What does it do?", [{ provider: "exa", url: "https://x.org/a" }, { provider: "uniprot", url: "https://www.uniprot.org/uniprotkb/P04637/entry#function" }]), { accession: "P04637" })
  assert.deepEqual(variantTarget("Structure of P01116 variants", []), { accession: "P01116" })
  assert.deepEqual(variantTarget("Which KRAS mutations are found in lung cancer?", []), { gene: "KRAS" })
  assert.deepEqual(variantTarget("Is TP53 R175H oncogenic?", []), { gene: "TP53" }, "a substitution written in the question counts as asking about variants")
  assert.equal(variantTarget("What does KRAS do in the cell?", []), undefined, "a gene without a word about variants: not looked up")
  assert.equal(variantTarget("Does semaglutide lower the risk of heart attack?", []), undefined)
  assert.equal(variantTarget("Which DNA mutations does the FDA list?", []), undefined, "common upper-case words are not genes")
  const mdm2 = { provider: "uniprot", url: "https://www.uniprot.org/uniprotkb/Q00987/entry#function", title: "E3 ubiquitin-protein ligase Mdm2 (MDM2): function (UniProt Q00987)" }
  const tp53 = { provider: "uniprot", url: "https://www.uniprot.org/uniprotkb/P04637/variant-viewer", title: "Cellular tumor antigen p53 (TP53): natural variants (UniProt P04637)" }
  assert.deepEqual(variantTarget("Do TP53 mutations change MDM2 binding?", [mdm2]), { gene: "TP53", fallback: "Q00987" }, "the gene the question names wins over another protein's source")
  assert.deepEqual(variantTarget("Do TP53 mutations change MDM2 binding?", [mdm2, tp53]), { accession: "P04637" }, "a source is used when it is the named gene's")
  assert.deepEqual(variantTarget("Which variants of P04637 bind MDM2?", [mdm2]), { accession: "P04637" }, "an accession in the question wins over the sources")
  assert.deepEqual(changesIn("Compare G12D, G13D and G12D with p53"), ["G12D", "G13D"])
})

test("the variants kept: substitutions UniProt reports with a cited paper, the ones the question names first, then by cited papers; at most 6", () => {
  const all = variantsOf(ENTRY)
  assert.ok(all.every((v) => v.citations.length >= 1 && SEQ[v.position - 1] === v.from && v.from !== v.to))
  assert.ok(!all.some((v) => v.id.startsWith("G10")), "an insertion (G10GG) is not a single substitution")
  assert.ok(!all.some((v) => v.position === 182), "a four-residue change (KIKK182RIRR) is not one either")
  assert.equal(new Set(all.map((v) => v.id)).size, all.length, "each substitution once")
  const q61l = all.find((v) => v.id === "Q61L")!
  assert.equal(q61l.kind, "mutagenesis")
  assert.equal(q61l.reported, "Promotes GTP binding.")
  const kept = pickVariants(all)
  assert.equal(kept.length, MAX_VARIANTS)
  assert.deepEqual(kept.slice(0, 3).map((v) => v.id), ["G12V", "G12D", "G13D"], "the most cited first")
  assert.ok(kept.every((v) => v.citations.length <= 3 && v.citations.every((c) => /^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d+\/$/.test(c.url))))
  assert.ok(kept.every((v) => !("cited" in v)), "the count that orders them is not kept")
  assert.deepEqual(pickVariants(all, ["Q61L", "A146T"]).slice(0, 2).map((v) => v.id), ["Q61L", "A146T"], "the ones the question names come first")
})

test("one lookup: the gene search, then the entry; kept answers are not asked again; no entry is not an error", async () => {
  const u = fakeUniprot()
  const found = await lookupVariants({ gene: "KRAS" }, ["G13D"], u.http)
  assert.equal(found?.accession, "P01116")
  assert.equal(found?.gene, "KRAS")
  assert.equal(found?.length, SEQ.length)
  assert.equal(found?.items[0].id, "G13D")
  assert.ok(found!.found > MAX_VARIANTS)
  assert.ok(!("sequence" in found!) && !("all" in found!), "an answer keeps neither the sequence nor the variants that were cut")
  assert.deepEqual(u.asked, [geneUrl("KRAS"), entryUrl("P01116")])
  await lookupVariants({ accession: "P01116" }, [], u.http)
  assert.equal(u.asked.length, 2, "the entry was kept: not asked again")
  assert.equal(await lookupVariants({ gene: "NOSUCHGENE" }, [], u.http), undefined)
  assert.equal(await readEntry({ accession: "Q99999" }, u.http), undefined)
})

test("a symbol in the question that finds an entry wins over the sources; one that finds none falls back to the first UniProt source", async () => {
  const asked: string[] = []
  const as = (accession: string, gene: string) => ({ ...ENTRY, primaryAccession: accession, genes: [{ geneName: { value: gene } }] })
  const fetch = (async (input: Parameters<typeof globalThis.fetch>[0]) => {
    const url = String(input)
    asked.push(url)
    if (url === geneUrl("TP53")) return json({ results: [{ primaryAccession: "P04637" }] })
    if (url === entryUrl("P04637")) return json(as("P04637", "TP53"))
    if (url === entryUrl("Q00987")) return json(as("Q00987", "MDM2"))
    if (url === entryUrl("P13569")) return json(as("P13569", "CFTR"))
    if (url.startsWith("https://rest.uniprot.org/uniprotkb/search?")) return json({ results: [] })
    throw new Error(`a test tried to reach ${url}`)
  }) as typeof globalThis.fetch
  const http = createHttp({ fetch, minGapMs: 0, cacheMs: 60_000 })
  const mdm2 = { provider: "uniprot", url: "https://www.uniprot.org/uniprotkb/Q00987/entry#function", title: "E3 ubiquitin-protein ligase Mdm2 (MDM2): function (UniProt Q00987)" }
  const cftr = { provider: "uniprot", url: "https://www.uniprot.org/uniprotkb/P13569/entry#disease_variants", title: "Cystic fibrosis transmembrane conductance regulator (CFTR): involvement in disease (UniProt P13569)" }
  const tp53 = await lookupVariants(variantTarget("Do TP53 mutations change MDM2 binding?", [mdm2])!, [], http)
  assert.deepEqual([tp53?.accession, tp53?.gene], ["P04637", "TP53"], "TP53 is looked up, not the MDM2 source")
  asked.length = 0
  const cf = await lookupVariants(variantTarget("Which mutations cause CF?", [cftr])!, [], http)
  assert.deepEqual([cf?.accession, cf?.gene], ["P13569", "CFTR"], "CF is not a gene: CFTR, the answer's UniProt source, is looked up")
  assert.deepEqual(asked, [geneUrl("CF"), entryUrl("P13569")], "within the lookup's two requests")
  assert.equal(await lookupVariants(variantTarget("Which mutations cause CF?", [])!, [], http), undefined, "no source to fall back to: no entry, not an error")
})

test("the comparison: the same model folds the reference and each variant; the confidence at the changed position and its change; a failure only marks its row", async () => {
  const entry = { accession: "P01116", sequence: SEQ }
  const all = variantsOf(ENTRY)
  const pick = ["G12D", "G13D"].map((id) => all.find((v) => v.id === id)!)
  const f = fakeFold([mutate(SEQ, pick[1])!])
  const c = await compareVariants(entry, pick, f.fold)
  assert.equal(c.error, undefined)
  assert.equal(f.folded[0], SEQ, "the reference first")
  assert.equal(f.folded.length, 3)
  assert.equal(mutate(SEQ, pick[0])![11], "D")
  assert.deepEqual({ ...c.rows[0], profile: undefined }, { id: "G12D", position: 12, reference: 90, variant: 50, change: -40, profile: undefined })
  assert.equal(c.rows[0].profile?.plddt.length, SEQ.length)
  assert.match(c.rows[1].error!, /Not predicted \(ESMFold answered 500\)/)
  assert.equal(c.reference?.meanPlddt, 90)
  assert.match(c.label, /not measurements/)
})

test("the comparison never throws: a protein too long for ESMFold, a reference that fails, and folds that do not finish in time", async () => {
  const v = variantsOf(ENTRY).find((x) => x.id === "G12D")!
  const long = await compareVariants({ accession: "P01116", sequence: SEQ + "A".repeat(MAX_ESMFOLD) }, [v], fakeFold().fold)
  assert.match(long.error!, /at most 400 amino acids/)
  const bad = await compareVariants({ accession: "P01116", sequence: SEQ }, [v], fakeFold([SEQ]).fold)
  assert.match(bad.error!, /reference could not be predicted/)
  const never: Fold = () => new Promise(() => {})
  const slow = await compareVariants({ accession: "P01116", sequence: SEQ }, [v], never, { timeoutMs: 20 })
  assert.match(slow.error!, /not predicted within/)
})

test("the ESMFold adapter: only api.esmatlas.com, pLDDT on 0-100, kept on disk under the Structure tab's key and read from there; a failure is not kept", async () => {
  const dir = mkdtempSync(join(tmpdir(), "variants-fold-"))
  const sent: { url: string; body: string }[] = []
  let fail = false
  const fetch = (async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    sent.push({ url: String(input), body: String(init?.body) })
    if (fail) return new Response("busy", { status: 503 })
    return new Response(pdbOf(String(init?.body), () => 0.8), { status: 200 })
  }) as typeof globalThis.fetch
  const fold = createEsmFold({ dir, fetch })
  const a = await fold("MKTAYIAK")
  assert.deepEqual([a.model, a.meanPlddt, a.cached, a.length], ["esmfold", 80, false, 8])
  assert.deepEqual(sent, [{ url: ESMFOLD_URL, body: "MKTAYIAK" }])
  const again = await fold("MKTAYIAK")
  assert.equal(again.cached, true)
  assert.equal(sent.length, 1, "read from disk")
  assert.equal(readdirSync(dir).length, 1)
  assert.match(readdirSync(dir)[0], /^[0-9a-f]{64}\.json$/)
  fail = true
  await assert.rejects(fold("MKTAYIAKQ"), /ESMFold answered 503/)
  assert.equal(readdirSync(dir).length, 1, "a failure is not kept")
  await assert.rejects(fold("A".repeat(MAX_ESMFOLD + 1)), /at most 400/)
  await assert.rejects(fold("MKXB"), /20 standard amino acids/)
  assert.equal(sent.length, 2, "a sequence it cannot fold is never sent")
})

test("GET /api/variants/compare: reported variants only (nothing new is predicted), plain errors, GET only", async () => {
  const u = fakeUniprot()
  const f = fakeFold()
  const variants = createVariants(loadConfig(), { http: u.http, fold: f.fold })
  const server = createServer((req, res) => { const url = new URL(req.url ?? "/", "http://x"); void variants.handle(req, res, url.pathname.split("/").filter(Boolean), url) })
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    const cmp = await fetch(`${base}/api/variants/compare?accession=P01116&variants=G12D,G12V`)
    const c = (await cmp.json()) as { rows: { id: string; change: number }[]; label: string }
    assert.equal(cmp.status, 200)
    assert.deepEqual(c.rows.map((r) => [r.id, r.change]), [["G12D", -40], ["G12V", -40]])
    assert.equal(f.folded.length, 3)
    const made = await fetch(`${base}/api/variants/compare?accession=P01116&variants=G12W`)
    assert.equal(made.status, 400, "a substitution UniProt does not report is refused")
    assert.match(((await made.json()) as { error: string }).error, /nothing new is predicted/)
    assert.equal(f.folded.length, 3, "and nothing was folded for it")
    assert.equal((await fetch(`${base}/api/variants/compare?accession=nope&variants=G12D`)).status, 400)
    assert.equal((await fetch(`${base}/api/variants/compare?accession=P01116&variants=G12D;DROP`)).status, 400)
    assert.equal((await fetch(`${base}/api/variants?accession=P01116`)).status, 404, "only the comparison is served")
    assert.equal((await fetch(`${base}/api/variants/compare?accession=Q99999&variants=G12D`)).status, 404)
    assert.equal((await fetch(`${base}/api/variants/compare?accession=P01116&variants=G12D`, { method: "POST" })).status, 405)
  } finally { await new Promise((done) => server.close(done)) }
})
