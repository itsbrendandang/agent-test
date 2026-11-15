// Protein structures for the Search screen's Structure tab: which proteins an answer lists (code only), the built-in test
// proteins, and the structure route (ESMFold, AlphaFold DB as the fallback, UniProt for a sequence, the disk cache).
// Fakes only: every fetch is a fake and every folder a temp folder. No request reaches ESM Atlas, AlphaFold DB or UniProt.
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

process.env.NO_PAID_CALLS = "1"
const { DEFAULTS, engine, paidAllowed } = await import("./fixtures/research/harness.ts")
const { accessionsIn, AMINO, fromSource, isAccession, MAX_PROTEINS, proteinsOf, sequencesIn, testAskedIn, testProteins } = await import("../src/structure/proteins.ts")
const { cleanPdb, createFolder, ESMFOLD_URL, HOSTS, MAX_ESMFOLD, MODEL_LABEL } = await import("../src/structure/fold.ts")
const { createApp } = await import("../src/app.ts")
const { loadConfig } = await import("../src/config.ts")
import type { Stamped } from "../src/research/types.ts"

const THIOREDOXIN = "MSDKIIHLTDDSFDTDVLKADGAILVDFWAEWCGPCKMIAPILDEIADEYQGKLTVAKLNIDQNPGTAPKYGIRGIPTLLLFKNGEVAATKVGALSKGQLKEFLDANLA"
const UNIPROT_TEXT = "UniProtKB entry P01116 (RASK_HUMAN), reviewed (Swiss-Prot). Protein: GTPase KRas. Gene: KRAS. Organism: Homo sapiens (Human). Length: 189 amino acids. Function: Ras proteins bind GDP/GTP."
const ECOLI_TEXT = "UniProtKB entry P0AA25 (THIO_ECOLI), reviewed (Swiss-Prot). Protein: Thioredoxin 1. Gene: trxA. Organism: Escherichia coli (strain K12). Function: Participates in redox reactions."

/** A PDB file of `n` residues, three atoms each, with these B-factors. */
function pdbOf(n: number, b: (i: number) => number, title = "ESMFOLD V1 PREDICTION FOR INPUT"): string {
  const lines = [`HEADER    ${title}`, "REMARK   1 <script>alert(1)</script>"]
  let serial = 1
  for (let i = 1; i <= n; i++) for (const atom of [" N  ", " CA ", " C  "]) {
    lines.push(`ATOM  ${String(serial++).padStart(5)} ${atom} ALA A${String(i).padStart(4)}    ${"1.000".padStart(8)}${"2.000".padStart(8)}${"3.000".padStart(8)}${"1.00".padStart(6)}${b(i).toFixed(2).padStart(6)}           ${atom.trim()[0]}  `)
  }
  return [...lines, "TER", "END"].join("\n")
}

interface Sent { url: string; method: string; body?: string; headers: Record<string, string>; redirect?: string }
/** A fake fetch: answers by host and path from `routes`, and records every request. */
function fakeFetch(routes: Record<string, (url: URL, init: RequestInit) => Response | Promise<Response>>) {
  const sent: Sent[] = []
  const fn = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    sent.push({ url: url.href, method: init.method ?? "GET", body: typeof init.body === "string" ? init.body : undefined, headers: init.headers as Record<string, string>, redirect: init.redirect })
    const key = Object.keys(routes).find((k) => url.href.startsWith(k))
    if (!key) throw new Error(`unexpected request to ${url.href}`)
    return routes[key](url, init)
  }) as typeof fetch
  return { fn, sent }
}
const text = (body: string, status = 200) => new Response(body, { status })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const temp = () => mkdtempSync(join(tmpdir(), "structure-test-"))

// ── Which proteins an answer lists ─────────────────────────────────────────────────────────────────

test("a UniProt source gives its accession, protein, gene, organism with the strain, and length", () => {
  assert.deepEqual(fromSource({ n: 2, url: "https://www.uniprot.org/uniprotkb/P01116/entry#function", title: "GTPase KRas (KRAS): function (UniProt P01116)", provider: "uniprot", text: UNIPROT_TEXT }),
    { key: "uniprot:P01116", name: "GTPase KRas", accession: "P01116", gene: "KRAS", organism: "Homo sapiens (Human)", length: 189, from: "source", source: 2 })
  assert.deepEqual(fromSource({ n: 1, url: "https://www.uniprot.org/uniprotkb/P0AA25/variant-viewer", title: "Thioredoxin 1 (trxA): natural variants (UniProt P0AA25)", provider: "uniprot", text: ECOLI_TEXT }),
    { key: "uniprot:P0AA25", name: "Thioredoxin 1", accession: "P0AA25", gene: "trxA", organism: "Escherichia coli (strain K12)", from: "source", source: 1 }, "no Length sentence: no length")
  assert.equal(fromSource({ n: 1, url: "https://www.uniprot.org/uniprotkb/P01116/entry", title: "x", provider: "chembl", text: UNIPROT_TEXT }), undefined, "only a UniProt source")
  assert.equal(fromSource({ n: 1, url: "https://evil.example/uniprotkb/P01116/entry", title: "x", provider: "uniprot", text: UNIPROT_TEXT }), undefined, "only UniProt's own address")
})

test("sequences written in a text: FASTA with UniProt's header, one run, blocks of ten; never words, codes or DNA", () => {
  const fasta = `Fold this:\n>sp|P0AA25|THIO_ECOLI Thioredoxin 1 OS=Escherichia coli (strain K12) OX=83333 GN=trxA PE=1 SV=2\n${THIOREDOXIN.slice(0, 60)}\n${THIOREDOXIN.slice(60)}\n`
  assert.deepEqual(sequencesIn(fasta), [{ sequence: THIOREDOXIN, accession: "P0AA25", name: "Thioredoxin 1", organism: "Escherichia coli (strain K12)", gene: "trxA" }])
  assert.deepEqual(sequencesIn(`The protein ${THIOREDOXIN} is small.`), [{ sequence: THIOREDOXIN }])
  const blocks = THIOREDOXIN.match(/.{1,10}/g)!.join(" ")
  assert.deepEqual(sequencesIn(`Sequence: ${blocks}.`), [{ sequence: THIOREDOXIN }])
  assert.deepEqual(sequencesIn(`>my protein\n${THIOREDOXIN.toLowerCase()}`), [{ sequence: THIOREDOXIN, name: "my protein" }], "a lower-case FASTA record")
  for (const none of [
    "KRAS TP53 EGFR BRAF and ALK are genes.", "> A quoted line of a Markdown answer.\n> Another quoted line.",
    "ATGCGTACGTAGCTAGCTAGCTAGCTAGCATCGATCGATCGTAGCTAGCTAG", "THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG AGAIN AND AGAIN",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "MSDKIIHLTDDSFDTDVLKADG",
  ]) assert.deepEqual(sequencesIn(none), [], none)
  assert.deepEqual(sequencesIn(`x${THIOREDOXIN}`), [], "glued to a word before")
  assert.deepEqual(sequencesIn(`Fold this:\n${THIOREDOXIN}\nThe protein is small.`), [{ sequence: THIOREDOXIN }], "a capitalised word on the next line")
  assert.deepEqual(sequencesIn(`Fold ${THIOREDOXIN} Is it stable?`), [{ sequence: THIOREDOXIN }], "a capitalised word after a space")
  assert.deepEqual(sequencesIn(`Sequence: ${THIOREDOXIN.match(/.{1,10}/g)!.join(" ")}\nIs it stable?`), [{ sequence: THIOREDOXIN }], "blocks, then a capitalised word")
})

test("sequencesIn takes linear time on a long run of capitals glued to a letter or a digit", () => {
  for (const tail of ["a", "1", "_"]) {
    const started = performance.now()
    assert.deepEqual(sequencesIn(`${"MKTAYIAKQRQISFVKSHFSRQ".repeat(20)}${tail}`), [], tail)
    assert.deepEqual(sequencesIn(`${THIOREDOXIN.match(/.{1,10}/g)!.join(" ")}${tail}`).map((f) => f.sequence), [THIOREDOXIN.slice(0, 100)], `blocks, the last glued to ${tail}: that block is not taken`)
    assert.deepEqual(sequencesIn(`${THIOREDOXIN.match(/.{1,10}/g)!.join(" ")} ${tail}`).map((f) => f.sequence), [THIOREDOXIN], `blocks, then ${tail}`)
    assert.ok(performance.now() - started < 500, `${tail}: ${Math.round(performance.now() - started)} ms`)
  }
})

test("accessions in a text, and the test proteins a question names", () => {
  assert.deepEqual(accessionsIn("KRAS (P01116) and Q9UQ13; A2BC19 may be a code, H1N1 is a virus"), ["P01116", "Q9UQ13"], "without the word UniProt only P/O/Q accessions")
  assert.deepEqual(accessionsIn("UniProt H1N1 and C57BL6"), [], "not the accession pattern")
  assert.deepEqual(accessionsIn("UniProt entry A2BC19"), ["A2BC19"])
  assert.equal(testAskedIn("Show the structure of GFP from Aequorea victoria")?.id, "gfp")
  assert.equal(testAskedIn("  show the structure of KRAS   G12C ")?.id, "kras-g12c", "any case and spacing")
  for (const real of ["What does KRAS do?", "KRAS inhibitors in pancreatic cancer", "How does KRAS G12C fold?", "What causes insulin resistance?", "How does the spike protein bind ACE2?", "Show the structure of GFP. Also fold it", "Does semaglutide lower the risk of stroke?"])
    assert.equal(testAskedIn(real), undefined, real)
})

test("proteinsOf: sources first, then sequences, test proteins and accessions; one entry per protein; at most MAX_PROTEINS", () => {
  const kras = { n: 1, url: "https://www.uniprot.org/uniprotkb/P01116/entry#function", title: "GTPase KRas (KRAS): function (UniProt P01116)", provider: "uniprot", text: UNIPROT_TEXT }
  const out = proteinsOf({ question: `Show the structure of GFP. Also fold ${THIOREDOXIN}`, answer: { markdown: "GFP is UniProt P42212; KRAS is P01116 [1]." }, sources: [kras, { ...kras, n: 2, url: "https://www.uniprot.org/uniprotkb/P01116/variant-viewer" }] })
  assert.deepEqual(out.map((p) => [p.key, p.from, p.length]), [["uniprot:P01116", "source", 189], [out[1].key, "question", 109], ["uniprot:P42212", "answer", undefined]], "two sources of one entry, and the accessions already listed, give no second entry; naming GFP gives no test protein")
  assert.match(out[1].key, /^seq:[0-9a-f]{12}$/)
  assert.equal(out[1].name, "Sequence 1 from the question")
  const chip = proteinsOf({ question: "Show the structure of GFP from Aequorea victoria" })
  assert.deepEqual(chip.map((p) => [p.key, p.from, p.length, p.organism]), [["test:gfp", "test", 238, "Aequorea victoria (Water jellyfish)"]])
  // A test protein of the same entry as a source gives the source its sequence; a variant stays apart.
  const thio = { n: 1, url: "https://www.uniprot.org/uniprotkb/P0AA25/entry#function", title: "t", provider: "uniprot", text: ECOLI_TEXT }
  assert.deepEqual(proteinsOf({ question: "Show the structure of thioredoxin from E. coli K-12", sources: [thio] }).map((p) => [p.key, Boolean(p.sequence), p.note]), [["uniprot:P0AA25", true, undefined]])
  assert.deepEqual(proteinsOf({ question: "Show the structure of KRAS G12C", sources: [kras] }).map((p) => [p.key, Boolean(p.sequence), p.note]), [["uniprot:P01116", false, undefined], ["test:kras-g12c", true, "G12C variant"]])
  for (const question of ["What does KRAS do?", "What causes insulin resistance?", "How does the spike protein bind ACE2?", "What does ubiquitin do?"])
    assert.ok(!proteinsOf({ question, sources: [kras] }).some((p) => p.from === "test"), question)
  const many = proteinsOf({ question: Array.from({ length: 12 }, (_, i) => `P0${String(1000 + i)}`).join(" ") })
  assert.equal(many.length, MAX_PROTEINS)
  assert.deepEqual(proteinsOf({ question: "Does semaglutide lower the risk of stroke?", sources: [{ n: 1, url: "https://example.org/a", title: "a", provider: "exa", text: "no proteins" }] }), [])
})

test("the test proteins: 5 to 8 real UniProt entries, short enough for ESMFold, each with a question that names it", () => {
  const all = testProteins()
  assert.ok(all.length >= 5 && all.length <= 8)
  assert.equal(new Set(all.map((t) => t.id)).size, all.length)
  assert.ok(new Set(all.map((t) => t.organism)).size >= 5, "several organisms and strains")
  for (const t of all) {
    assert.ok(isAccession(t.accession), t.id)
    assert.ok(AMINO.test(t.sequence), t.id)
    assert.equal(t.sequence.length, t.length, t.id)
    assert.ok(t.length <= MAX_ESMFOLD, `${t.id} fits ESMFold's free API`)
    assert.match(t.crc64, /^[0-9A-F]{16}$/, t.id)
    if (t.range) assert.ok(t.range[0] >= 1 && t.range[1] <= t.uniprotLength && t.range[1] - t.range[0] + 1 === t.length, t.id)
    else assert.equal(t.length, t.uniprotLength, `${t.id}: the whole entry`)
    if (t.mutation) { const [, from, at, to] = /^([A-Z])(\d+)([A-Z])$/.exec(t.mutation)!; assert.equal(t.sequence[Number(at) - 1], to, t.id); assert.notEqual(from, to) }
    assert.equal(testAskedIn(t.question)?.id, t.id, `${t.id}: its question gives it`)
  }
})

// ── The structure route ────────────────────────────────────────────────────────────────────────────

test("ESMFold: the sequence is posted to the one allowed address; pLDDT becomes 0-100; only coordinates are kept; the result is kept on disk", async () => {
  const dir = temp()
  const net = fakeFetch({ [ESMFOLD_URL]: () => text(pdbOf(3, (i) => [0.9, 0.6, 0.3][i - 1])) })
  const folder = createFolder({ dir, fetch: net.fn, now: () => 1_000 })
  const s = await folder.structure({ sequence: ` ${THIOREDOXIN.toLowerCase().slice(0, 40)}\n${THIOREDOXIN.slice(40)} ` })
  assert.deepEqual(net.sent.map((r) => [r.url, r.method, r.body, r.redirect]), [[ESMFOLD_URL, "POST", THIOREDOXIN, "error"]])
  assert.match(net.sent[0].headers["user-agent"], /ai-scientist-bot/)
  assert.deepEqual([s.model, s.modelLabel, s.link, s.length, s.meanPlddt, s.cached, s.at, s.accession], ["esmfold", MODEL_LABEL.esmfold, "https://esmatlas.com/about", 3, 60, false, 1_000, undefined])
  assert.ok(!s.pdb.includes("script") && !s.pdb.includes("HEADER"), "only coordinate lines")
  assert.deepEqual(s.pdb.split("\n").filter((l) => l.startsWith("ATOM")).map((l) => l.slice(60, 66).trim()).filter((_, i) => i % 3 === 1), ["90.00", "60.00", "30.00"])
  assert.equal(readdirSync(dir).length, 1)
  const again = await createFolder({ dir, fetch: net.fn }).structure({ sequence: THIOREDOXIN })
  assert.deepEqual([again.cached, net.sent.length, again.pdb], [true, 1, s.pdb], "read from disk: nothing sent")
})

test("a UniProt accession: its sequence is read from UniProt once, then folded by ESMFold", async () => {
  const net = fakeFetch({
    "https://rest.uniprot.org/uniprotkb/P0AA25.json": () => json({ primaryAccession: "P0AA25", sequence: { value: THIOREDOXIN, length: 109 } }),
    [ESMFOLD_URL]: () => text(pdbOf(2, () => 0.8)),
  })
  const folder = createFolder({ dir: temp(), fetch: net.fn })
  const s = await folder.structure({ accession: "P0AA25" })
  assert.deepEqual(net.sent.map((r) => [new URL(r.url).host, r.body]), [[HOSTS.uniprot, undefined], [HOSTS.esmfold, THIOREDOXIN]])
  assert.deepEqual([s.model, s.accession, s.uniprot, s.meanPlddt], ["esmfold", "P0AA25", "https://www.uniprot.org/uniprotkb/P0AA25/entry", 80])
  await folder.structure({ accession: "P0AA25" })
  assert.equal(net.sent.length, 2, "the sequence and the structure are both kept")
})

test("too long for ESMFold: AlphaFold DB with an accession (and it says why), a plain refusal without one; ESMFold failing falls back too", async () => {
  const long = THIOREDOXIN.repeat(4) // 436 residues
  const afApi = (url: URL) => json([{ uniprotAccession: url.pathname.split("/").pop(), sequence: url.pathname.endsWith("P0AA25") ? THIOREDOXIN : "MEEPQSDPSV", pdbUrl: `https://alphafold.ebi.ac.uk/files/AF-${url.pathname.split("/").pop()}-F1-model_v6.pdb` }])
  const net = fakeFetch({ "https://alphafold.ebi.ac.uk/api/prediction/": afApi, "https://alphafold.ebi.ac.uk/files/": () => text(pdbOf(2, () => 70)), [ESMFOLD_URL]: () => text("upstream timed out", 504) })
  const folder = createFolder({ dir: temp(), fetch: net.fn })
  await assert.rejects(folder.structure({ sequence: long }), (e: Error & { status?: number }) => e.status === 422 && /at most 400 amino acids, and this sequence has 436/.test(e.message))
  assert.equal(net.sent.length, 0, "nothing sent for a sequence that cannot be folded")
  const af = await folder.structure({ sequence: long, accession: "P04637" })
  assert.deepEqual([af.model, af.modelLabel, af.link, af.meanPlddt], ["alphafold", MODEL_LABEL.alphafold, "https://alphafold.ebi.ac.uk/entry/P04637", 70])
  assert.match(af.note ?? "", /AlphaFold DB's model is shown because this protein has 436 amino acids/)
  assert.ok(!net.sent.some((r) => r.url === ESMFOLD_URL))
  const fallback = await folder.structure({ sequence: THIOREDOXIN, accession: "P0AA25" })
  assert.equal(fallback.model, "alphafold")
  assert.equal(fallback.note, "AlphaFold DB's model is shown because ESMFold could not be used (ESMFold answered 504).", "the same sequence as the entry: no caveat")
  const fragment = await folder.structure({ sequence: THIOREDOXIN.slice(10), accession: "P0AA25" })
  assert.match(fragment.note ?? "", /\. It is the model of the whole UniProt entry, which differs from the sequence asked for\.$/)
  await assert.rejects(folder.structure({ sequence: THIOREDOXIN }), (e: Error & { status?: number }) => e.status === 502 && e.message === "ESMFold answered 504", "no accession: no fallback, a plain error")
  const esmCalls = net.sent.filter((r) => r.url === ESMFOLD_URL).length
  await assert.rejects(folder.structure({ sequence: THIOREDOXIN }), /ESMFold answered 504/)
  assert.equal(net.sent.filter((r) => r.url === ESMFOLD_URL).length, esmCalls, "a recent failure is remembered in memory: ESMFold is not asked again at once")
  await assert.rejects(folder.structure({ sequence: THIOREDOXIN, retry: true }), /ESMFold answered 504/)
  assert.equal(net.sent.filter((r) => r.url === ESMFOLD_URL).length, esmCalls + 1, "a person asking again reaches ESMFold")
  const forced = await folder.structure({ accession: "P0AA25", prefer: "alphafold" })
  assert.equal(forced.model, "alphafold")
})

test("refusals: bad input, a structure file on another host, no atoms; a failure is never kept; at most two at once", async () => {
  const dir = temp()
  const folder = createFolder({ dir, fetch: fakeFetch({}).fn })
  for (const [ask, status] of [[{}, 400], [{ sequence: "MKT<script>" }, 400], [{ accession: "not-one" }, 400], [{ sequence: "", accession: undefined }, 400], [{ sequence: THIOREDOXIN, prefer: "alphafold" as const }, 400]] as const)
    await assert.rejects(folder.structure(ask), (e: Error & { status?: number }) => e.status === status, JSON.stringify(ask))
  const evil = fakeFetch({ "https://alphafold.ebi.ac.uk/api/prediction/": () => json([{ uniprotAccession: "P0AA25", pdbUrl: "https://evil.example/x.pdb" }]) })
  await assert.rejects(createFolder({ dir, fetch: evil.fn }).structure({ accession: "P0AA25", prefer: "alphafold" }), /no structure file/)
  assert.equal(evil.sent.length, 1, "the other host is never called")
  const empty = fakeFetch({ [ESMFOLD_URL]: () => text("HEADER only") })
  await assert.rejects(createFolder({ dir, fetch: empty.fn }).structure({ sequence: THIOREDOXIN }), /no atoms/)
  assert.ok(!existsSync(dir) || readdirSync(dir).length === 0, "nothing kept after a failure")
  let release = () => {}
  const gate = new Promise<void>((r) => { release = r })
  const slow = fakeFetch({ [ESMFOLD_URL]: async () => { await gate; return text(pdbOf(1, () => 0.5)) } })
  const busy = createFolder({ dir: temp(), fetch: slow.fn })
  const a = busy.structure({ sequence: THIOREDOXIN }), same = busy.structure({ sequence: THIOREDOXIN }), b = busy.structure({ sequence: THIOREDOXIN.slice(1) })
  await assert.rejects(busy.structure({ sequence: THIOREDOXIN.slice(2) }), (e: Error & { status?: number }) => e.status === 429)
  release()
  await Promise.all([a, same, b])
  assert.equal(slow.sent.length, 2, "the same structure asked twice at once is fetched once")
  assert.equal(cleanPdb(pdbOf(1, () => 55), 100).meanPlddt, 55)
})

test("HTTP: GET /api/structure/tests lists the test proteins; GET /api/structure?test= folds one; only GET", async () => {
  const base = loadConfig()
  const runs = join(temp(), "runs")
  const net = fakeFetch({ [ESMFOLD_URL]: () => text(pdbOf(2, () => 0.95)) })
  const app = createApp({ config: { ...base, paths: { ...base.paths, runs } }, mock: true, env: { NO_PAID_CALLS: "1" }, structure: { fetch: net.fn } })
  const { createServer } = await import("node:http")
  const server = createServer(app.handler)
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    const list = await (await fetch(`${url}/api/structure/tests`)).json() as { items: { id: string; sequence: string; uniprot: string; aliases?: unknown }[] }
    assert.equal(list.items.length, testProteins().length)
    assert.ok(list.items.every((t) => t.sequence && t.uniprot.startsWith("https://www.uniprot.org/uniprotkb/") && t.aliases === undefined))
    const gfp = await fetch(`${url}/api/structure?test=gfp`)
    const body = await gfp.json() as { model: string; accession: string; meanPlddt: number }
    assert.deepEqual([gfp.status, body.model, body.accession, body.meanPlddt], [200, "esmfold", "P42212", 95])
    assert.equal(net.sent[0].body, testProteins().find((t) => t.id === "gfp")!.sequence)
    assert.ok(existsSync(join(runs, ".structures")), "kept under the runs folder")
    assert.equal((await fetch(`${url}/api/structure?test=nope`)).status, 404)
    assert.equal((await fetch(`${url}/api/structure?sequence=${"X".repeat(10)}`)).status, 400)
    assert.equal((await fetch(`${url}/api/structure?accession=P42212&prefer=other`)).status, 400)
    assert.equal((await fetch(`${url}/api/structure?test=gfp`, { method: "POST", headers: { origin: "http://127.0.0.1:5317" } })).status, 405)
  } finally { await new Promise((done) => server.close(done)) }
})

// ── The answer records its proteins ────────────────────────────────────────────────────────────────

test("a demo answer to a question that names a test protein records it, streams it, and sends nothing anywhere", async () => {
  const e = await engine({ demo: true })
  try {
    const { record, events } = await e.answer({ question: "Show the structure of GFP from Aequorea victoria", effort: "quick" })
    assert.equal(record.status, "done")
    assert.deepEqual(record.proteins?.map((p) => [p.key, p.accession, p.length]), [["test:gfp", "P42212", 238]])
    const streamed = events.filter((x) => x.type === "proteins") as Extract<Stamped, { type: "proteins" }>[]
    assert.deepEqual(streamed.map((x) => x.items.map((p) => p.key)), [["test:gfp"]])
    assert.equal(e.net.requests.length, 0, "no structure is fetched while an answer is made")
    const plain = await e.answer({ question: "Does semaglutide lower the risk of stroke?", effort: "quick" })
    assert.deepEqual([plain.record.proteins, plain.events.some((x) => x.type === "proteins")], [[], false])
  } finally { await e.close() }
})

test("a real answer with a UniProt record lists that protein; an older record without `proteins` gets them worked out on read", async () => {
  const plan = (call: Parameters<typeof DEFAULTS.plan>[0], n: number) => JSON.stringify({ ...JSON.parse(DEFAULTS.plan(call, n)), databases: [{ source: "uniprot", query: "trxA" }] })
  const screen = (call: { user: string }) => JSON.stringify({ items: [...call.user.matchAll(/<passage i="(\d+)">/g)].map((m) => ({ i: Number(m[1]), answers_question: "yes", reports_results: "no", study_type: "other" })) })
  const item = { url: "https://www.uniprot.org/uniprotkb/P0AA25/entry#function", title: "Thioredoxin 1 (trxA): function (UniProt P0AA25)", text: ECOLI_TEXT }
  const e = await engine({ script: { plan, screen }, deps: { database: async () => ({ items: [item], notices: [] }) } })
  try {
    const { id, record } = await paidAllowed(() => e.answer({ question: "What does thioredoxin do in E. coli K-12?", effort: "standard" }))
    assert.deepEqual(record.proteins?.find((p) => p.key === "uniprot:P0AA25")?.organism, "Escherichia coli (strain K12)")
    assert.ok(!e.net.requests.some((r) => /esmatlas|alphafold|rest\.uniprot/.test(r.url)), "nothing is folded while the answer is made")
    // An answer saved before the field existed.
    const { readFileSync, writeFileSync } = await import("node:fs")
    const file = join(e.runs, ".research", id, "record.json")
    const old = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
    delete old.proteins
    writeFileSync(file, JSON.stringify(old))
    const read = await e.record(id)
    assert.ok(read.proteins?.some((p) => p.key === "uniprot:P0AA25"), "worked out from the stored sources")
  } finally { await e.close() }
})
