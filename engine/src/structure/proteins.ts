// The proteins of one research answer: what the Structure tab of the Search screen lists, and what it can fold.
//
// Found by code, never by a model, from three places:
//   - the answer's UniProt sources (database_search): accession, protein, gene, organism (the organism carries the strain,
//     "Escherichia coli (strain K12)"), and the length when UniProt gave it;
//   - an amino-acid sequence written in the question or the answer (one line or blocks of letters, or FASTA; a UniProt
//     FASTA header gives the accession, name and organism), and a UniProt accession written in either;
//   - a test protein (test-proteins.json) whose own question is the question asked (a chip on the empty Research page).
// The result is kept on the record as `proteins` (an older record has none: GET /api/research/:id works it out from the
// record, so stored answers show the tab too). No network, no model, no cost.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

export interface Protein {
  /** Stable within one answer: "uniprot:P01116", "test:gfp", "seq:<12 hex>". */
  key: string
  name: string
  accession?: string
  gene?: string
  /** UniProt's organism name; a strain is part of it ("Mycobacterium tuberculosis (strain ATCC 25618 / H37Rv)"). */
  organism?: string
  /** Residues, when known. */
  length?: number
  /** The amino-acid sequence, when the answer holds it (written in the text, or a test protein). Otherwise the structure route reads it from UniProt. */
  sequence?: string
  /** Where it was found. */
  from: "source" | "question" | "answer" | "test"
  /** The numbered source it came from. */
  source?: number
  /** A plain note: a fragment or a variant. */
  note?: string
}

export interface TestProtein {
  id: string; name: string; /** A short name for a chip: "GFP (Aequorea victoria)". */ label: string; gene: string; organism: string; accession: string; entry: string
  uniprotLength: number; crc64: string; range?: [number, number]; mutation?: string
  length: number; sequence: string; question: string; about: string
}

/** The most proteins one answer lists. */
export const MAX_PROTEINS = 8
/** The shortest run of residues taken for a protein sequence: shorter runs of capitals are words and codes. */
export const MIN_SEQUENCE = 30
/** The longest sequence kept on a record. */
export const MAX_SEQUENCE = 5_000
/** The 20 standard amino acids: the letters ESMFold folds. */
export const AMINO = /^[ACDEFGHIKLMNPQRSTVWY]+$/

/** UniProt's own pattern for an accession (https://www.uniprot.org/help/accession_numbers). */
export const ACCESSION = /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})$/
export const isAccession = (value: unknown): value is string => typeof value === "string" && ACCESSION.test(value)

let tests: TestProtein[] | undefined
/** The built-in test proteins (test-proteins.json): real UniProt entries, each short enough for ESMFold's free API. */
export function testProteins(): TestProtein[] {
  tests ??= (JSON.parse(readFileSync(new URL("./test-proteins.json", import.meta.url), "utf8")) as { proteins: TestProtein[] }).proteins
  return tests
}

/** A test protein as an answer lists it. */
export function fromTest(t: TestProtein): Protein {
  const note = [t.range && `Residues ${t.range[0]}-${t.range[1]} of ${t.uniprotLength}`, t.mutation && `${t.mutation} variant`].filter(Boolean).join(", ")
  return { key: `test:${t.id}`, name: t.name, accession: t.accession, ...(t.gene ? { gene: t.gene } : {}), organism: t.organism, length: t.length, sequence: t.sequence, from: "test", ...(note ? { note } : {}) }
}

const hash = (sequence: string) => createHash("sha256").update(sequence).digest("hex").slice(0, 12)
const one = (text: string, max = 200) => text.replace(/\s+/g, " ").trim().slice(0, max)

/** A run of letters as a protein sequence, or undefined: too short, not the 20 amino acids, or a nucleotide sequence. */
export function asSequence(letters: string): string | undefined {
  const s = letters.replace(/\s+/g, "").toUpperCase()
  if (s.length < MIN_SEQUENCE || s.length > MAX_SEQUENCE || !AMINO.test(s)) return undefined
  if (s.replace(/[ACGTUN]/g, "").length < s.length * 0.1) return undefined // DNA or RNA
  if (new Set(s).size < 8) return undefined // "AAAAAAAA..." or a few letters repeated
  return s
}

/** A line of a sequence listing: letters only, maybe split into blocks of ten ("MKTAYIAKQR QISFVKSHFS"), maybe ending in "*". */
const residueLine = (line: string): boolean => {
  const blocks = line.trim().replace(/\*$/, "").split(/[ \t]+/)
  return blocks[0] !== "" && blocks.every((b, i) => /^[A-Za-z]+$/.test(b) && (i === blocks.length - 1 || b.length >= 10))
}

interface Found { sequence: string; accession?: string; name?: string; gene?: string; organism?: string }

/** UniProt's FASTA header: ">sp|P0AA25|THIO_ECOLI Thioredoxin 1 OS=Escherichia coli (strain K12) OX=83333 GN=trxA PE=1 SV=2". */
function header(line: string): Omit<Found, "sequence"> {
  const m = /^>\s*(?:sp|tr)\|([A-Z0-9]{6,10})\|\S+\s+(.*?)(?:\s+OS=(.*?))?(?:\s+OX=\d+)?(?:\s+GN=(\S+))?(?:\s+PE=\d)?(?:\s+SV=\d+)?\s*$/.exec(line)
  if (m) return { ...(isAccession(m[1]) ? { accession: m[1] } : {}), ...(m[2] ? { name: one(m[2]) } : {}), ...(m[3] ? { organism: one(m[3]) } : {}), ...(m[4] ? { gene: one(m[4], 40) } : {}) }
  const name = one(line.replace(/^>\s*/, ""))
  return name ? { name } : {}
}

/** The longest letters of a line a wrapped sequence continues after (FASTA and GenBank wrap at 60, some at 50). */
const WRAPPED_LINE = 40

/**
 * The residues of a run of capital blocks, up to the first block that does not continue it: a block after a space must
 * follow a block of ten (a listing in blocks of ten), a block after a line break must follow a line of at least
 * WRAPPED_LINE letters, and a block of fewer than ten after a line break must not run on into a sentence ("I want ...").
 */
function listing(run: string, after: string): string {
  const parts = run.split(/([ \t\d]*\n[ \t\d]*|[ \t\d]+)/)
  let letters = parts[0], line = parts[0].length
  for (let i = 1; i < parts.length; i += 2) {
    const block = parts[i + 1], prev = parts[i - 1], newline = parts[i].includes("\n")
    const next = i + 2 < parts.length ? parts[i + 2] + parts[i + 3][0] : after.slice(0, 80)
    if (newline ? line < WRAPPED_LINE || (block.length < 10 && /^[ \t]+[A-Za-z]/.test(next)) : prev.length !== 10) break
    letters += block
    line = newline ? block.length : line + block.length
  }
  return letters
}

/**
 * The amino-acid sequences written in a text: FASTA records, a single run of at least MIN_SEQUENCE capitals, and blocks
 * of capitals split by spaces or line breaks ("MKTAYIAKQR QISFVKSHFS ..."). Words, gene symbols and DNA are not taken.
 */
export function sequencesIn(text: string): Found[] {
  const out: Found[] = []
  const seen = new Set<string>()
  const add = (f: Found | undefined) => { if (f && !seen.has(f.sequence)) { seen.add(f.sequence); out.push(f) } }
  const lines = text.split(/\r?\n/)
  const rest: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/^\s*(?:```\w*|`)\s*$/, "")
    if (/^\s*>\s*\S/.test(line)) { // a FASTA header, or a Markdown quote: only letters on the lines below make it a record
      const body: string[] = []
      let j = i + 1
      for (; j < lines.length && residueLine(lines[j]); j++) body.push(lines[j])
      const sequence = asSequence(body.join("").replace(/\*$/, ""))
      if (sequence) { add({ sequence, ...header(line.trim()) }); i = j - 1; continue }
    }
    rest.push(line)
  }
  // A run of capitals, maybe split into blocks by spaces or line breaks (numbers between blocks, as in a GenBank listing, are allowed).
  const all = rest.join("\n")
  for (const m of all.matchAll(/[A-Z]{10,}(?:(?:[ \t\d]*\n[ \t\d]*|[ \t\d]+)[A-Z]+(?!\w))*/g)) {
    if (/\w/.test(all[m.index - 1] ?? "") || /\w/.test(all[m.index + m[0].length] ?? "")) continue
    add(((s) => (s ? { sequence: s } : undefined))(asSequence(listing(m[0], all.slice(m.index + m[0].length)))))
  }
  return out
}

/** UniProt accessions written in a text: a P/O/Q accession anywhere, any accession when the text says "UniProt". */
export function accessionsIn(text: string): string[] {
  const any = /uniprot/i.test(text)
  return [...new Set([...text.matchAll(/\b[A-Z][0-9][A-Z0-9]{3,8}\b/g)].map((m) => m[0]).filter((a) => isAccession(a) && (any || /^[OPQ]/.test(a))))]
}

/** The test protein whose own question (its chip) is this question, any case and spacing. */
export function testAskedIn(question: string): TestProtein | undefined {
  const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase()
  return testProteins().find((p) => norm(p.question) === norm(question))
}

interface SourceLike { n: number; url: string; title: string; provider: string; text?: string }
interface RecordLike { question?: string; answer?: { markdown?: string }; sources?: SourceLike[] }

/** A UniProt source as a protein: the accession from its address, the rest from the entry's first sentence. */
export function fromSource(s: SourceLike): Protein | undefined {
  if (s.provider !== "uniprot") return undefined
  const accession = /^https:\/\/www\.uniprot\.org\/uniprotkb\/([A-Z0-9]{6,10})\//.exec(s.url)?.[1]
  if (!isAccession(accession)) return undefined
  const text = s.text ?? ""
  const protein = /\bProtein: (.+?)\.\s+(?:Gene|Organism|Length):/.exec(text)?.[1] ?? /^(.+?)(?: \([^)]*\))?: /.exec(s.title)?.[1]
  const gene = /\bGene: (.+?)\.\s+(?:Organism|Length):/.exec(text)?.[1]
  const organism = /\bOrganism: (.+?)\.(?:\s+[A-Z]|\s*$)/.exec(text)?.[1]
  const length = Number(/\bLength: (\d{1,6}) amino acids\./.exec(text)?.[1])
  return {
    key: `uniprot:${accession}`, name: one(protein || accession), accession, ...(gene ? { gene: one(gene, 40) } : {}), ...(organism ? { organism: one(organism) } : {}),
    ...(Number.isInteger(length) && length > 0 ? { length } : {}), from: "source", source: s.n,
  }
}

/**
 * Every protein of an answer, at most MAX_PROTEINS, in this order: its UniProt sources, the sequences the question and the
 * answer write, the test proteins the question names, the accessions the question and the answer write. One protein is
 * listed once: an entry with no sequence takes the sequence of the same UniProt entry found elsewhere (not of a fragment or a variant).
 */
export function proteinsOf(record: RecordLike): Protein[] {
  const out: Protein[] = []
  const push = (p: Protein | undefined) => {
    if (!p) return
    const same = out.find((o) => o.key === p.key || (p.sequence && o.sequence === p.sequence) || (p.accession && o.accession === p.accession && (!p.sequence || !o.sequence) && !p.note && !o.note))
    if (same) { if (p.sequence && !same.sequence) Object.assign(same, { sequence: p.sequence, length: p.sequence.length }); return }
    if (out.length < MAX_PROTEINS) out.push(p)
  }
  for (const s of record.sources ?? []) push(fromSource(s))
  const texts: [Protein["from"], string][] = [["question", record.question ?? ""], ["answer", record.answer?.markdown ?? ""]]
  let n = 0
  for (const [from, text] of texts) for (const f of sequencesIn(text)) {
    n++
    push({ key: `seq:${hash(f.sequence)}`, name: f.name ?? `Sequence ${n} from the ${from}`, ...(f.accession ? { accession: f.accession } : {}), ...(f.gene ? { gene: f.gene } : {}), ...(f.organism ? { organism: f.organism } : {}), length: f.sequence.length, sequence: f.sequence, from })
  }
  const test = testAskedIn(record.question ?? "")
  if (test) push(fromTest(test))
  for (const [from, text] of texts) for (const a of accessionsIn(text)) push({ key: `uniprot:${a}`, name: `UniProt ${a}`, accession: a, from })
  return out
}

/** Read a stored `proteins` field (anything not a protein is dropped). */
export function readProteins(value: unknown): Protein[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((p): p is Protein => !!p && typeof p === "object" && typeof (p as Protein).key === "string" && typeof (p as Protein).name === "string").slice(0, MAX_PROTEINS)
}
