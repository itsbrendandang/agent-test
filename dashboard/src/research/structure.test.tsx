// The Structure tab: it appears only for an answer with a protein, lists the proteins and the test proteins, and opening
// one fetches its predicted structure from the engine and names the model. The engine is a fake fetch; the 3D viewer
// (WebGL) is replaced, so no test reaches ESM Atlas, AlphaFold DB or UniProt.
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import S_REAL from "@/test/research/stream-real.jsonl?raw"
import { Inspector } from "./Inspector"
import { tabsOf, type InspectorTab } from "./inspectorState"
import { foldAnswer, fromRecord, proteinsOf, type Protein, type ResearchEvent } from "./model"
import { readStructure, structureQuery } from "./structure/api"
import StructureTab from "./structure/StructureTab"
import { TestProteinChips } from "./structure/TestProteins"

vi.mock("./structure/Viewer3D", () => ({ default: ({ label, pdb }: { label: string; pdb: string }) => <div role="img" aria-label={`3D structure of ${label}`} data-atoms={pdb.split("\n").filter((l) => l.startsWith("ATOM")).length} /> }))

const lines = (raw: string): ResearchEvent[] => raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as ResearchEvent)
const KRAS: Protein = { key: "uniprot:P01116", name: "GTPase KRas", accession: "P01116", gene: "KRAS", organism: "Homo sapiens (Human)", length: 189, from: "source", source: 1 }
const THIO: Protein = { key: "seq:0123456789ab", name: "Thioredoxin 1", accession: "P0AA25", organism: "Escherichia coli (strain K12)", length: 109, sequence: "MSDKIIHLTDDSFDTDVLKADGAILVDFWAEWCGPCKMIAPILDEIADEYQGKLTVAKLNIDQNPGTAPKYGIRGIPTLLLFKNGEVAATKVGALSKGQLKEFLDANLA", from: "question" }
const TESTS = [
  { id: "gfp", name: "Green fluorescent protein", label: "GFP (Aequorea victoria)", gene: "GFP", organism: "Aequorea victoria (Water jellyfish)", accession: "P42212", entry: "GFP_AEQVI", uniprot: "https://www.uniprot.org/uniprotkb/P42212/entry", uniprotLength: 238, length: 238, sequence: "MSKGEELFTG", question: "Show the structure of GFP from Aequorea victoria", about: "A jellyfish protein." },
  { id: "inha", name: "InhA", label: "InhA (M. tuberculosis H37Rv)", gene: "inhA", organism: "Mycobacterium tuberculosis (strain ATCC 25618 / H37Rv)", accession: "P9WGR1", entry: "INHA_MYCTU", uniprot: "https://www.uniprot.org/uniprotkb/P9WGR1/entry", uniprotLength: 269, length: 269, sequence: "MTGLLDGKRI", question: "Show the structure of InhA from Mycobacterium tuberculosis H37Rv", about: "A drug target." },
]
const PDB = ["ATOM      1  N   ALA A   1       1.000   2.000   3.000  1.00 90.00           N", "ATOM      2  CA  ALA A   1       1.000   2.000   3.000  1.00 90.00           C", "END"].join("\n")
const ESM = { model: "esmfold", modelLabel: "ESMFold (Meta AI), predicted through the ESM Metagenomic Atlas API", link: "https://esmatlas.com/about", length: 189, meanPlddt: 91.2, pdb: PDB, cached: false, at: 1 }
const AF = { model: "alphafold", modelLabel: "AlphaFold (Google DeepMind and EMBL-EBI), from the AlphaFold Protein Structure Database", link: "https://alphafold.ebi.ac.uk/entry/P01116", uniprot: "https://www.uniprot.org/uniprotkb/P01116/entry", accession: "P01116", length: 189, meanPlddt: 62, pdb: PDB, cached: true, at: 1, note: "AlphaFold DB's model is shown because ESMFold could not be used (ESMFold answered 504)." }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

/** A fake engine: the test proteins, and one answer per structure request in order. Returns the addresses asked for. */
function engine(structures: (() => Response | Promise<Response>)[]) {
  const asked: string[] = []
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(String(input), "http://x")
    asked.push(url.pathname + url.search)
    if (url.pathname === "/api/structure/tests") return reply({ items: TESTS })
    if (url.pathname === "/api/structure") return (structures.shift() ?? (() => reply({ error: "no more" }, 500)))()
    return reply({ error: "not found" }, 404)
  }))
  return asked
}
beforeEach(() => { vi.unstubAllGlobals() })

describe("the answer's proteins", () => {
  it("come from the proteins event and from a stored record; a malformed one is dropped", () => {
    const events: ResearchEvent[] = [{ type: "research.started", seq: 1, mode: "real" }, { type: "proteins", seq: 2, items: [KRAS, { key: "x" }, { ...THIO, accession: "not-one", sequence: "abc<script>" }, null] }]
    const s = foldAnswer(events)
    expect(s.proteins.map((p) => p.key)).toEqual([KRAS.key, THIO.key])
    expect(s.proteins[1].accession).toBeUndefined()
    expect(s.proteins[1].sequence).toBeUndefined()
    expect(fromRecord({ id: "a-1", status: "done", steps: [], sources: [], statements: [], proteins: [KRAS] })!.proteins).toEqual([KRAS])
    expect(fromRecord({ id: "a-1", status: "done", steps: [], sources: [], statements: [] })!.proteins).toEqual([])
    expect(proteinsOf(Array.from({ length: 12 }, (_, i) => ({ ...KRAS, key: `k${i}` })))).toHaveLength(8)
  })
  it("make the Structure tab appear; without them there is none", () => {
    const real = lines(S_REAL)
    expect(tabsOf(foldAnswer(real), real)).not.toContain("structure")
    const withProteins = [...real, { type: "proteins", seq: 10_000, items: [KRAS] }]
    expect(tabsOf(foldAnswer(withProteins), withProteins)).toEqual(["evidence", "structure", "results", "activity", "lab"])
  })
})

describe("the structure request", () => {
  it("asks for a test protein by id, a sequence with its accession, or an accession", () => {
    expect(structureQuery({ ...KRAS, key: "test:gfp", sequence: "MSK" })).toBe("test=gfp")
    expect(structureQuery(THIO)).toBe(`sequence=${THIO.sequence}&accession=P0AA25`)
    expect(structureQuery(KRAS, "alphafold")).toBe("accession=P01116&prefer=alphafold")
    expect(structureQuery(THIO, undefined, true)).toBe(`sequence=${THIO.sequence}&accession=P0AA25&retry=1`)
  })
  it("reads only a structure with atoms from one of the two models, and only the services' own links", () => {
    expect(readStructure({ ...ESM, model: "other" })).toBeUndefined()
    expect(readStructure({ ...ESM, pdb: "HEADER" })).toBeUndefined()
    expect(readStructure({ ...ESM, link: "javascript:alert(1)" })?.link).toBe("https://esmatlas.com/about")
    expect(readStructure({ ...AF, uniprot: "https://evil.example/P01116" })?.uniprot).toBeUndefined()
  })
})

describe("the Structure tab", () => {
  it("lists each protein with its organism, strain and length; opening one shows the structure, the model, the legend and the links", async () => {
    const user = userEvent.setup()
    let release = () => {}
    const held = new Promise<void>((r) => { release = r })
    const asked = engine([async () => { await held; return reply(ESM) }])
    render(<StructureTab proteins={[KRAS, THIO]} sources={[{ n: 1, url: "https://www.uniprot.org/uniprotkb/P01116/entry#function", title: "GTPase KRas (KRAS): function (UniProt P01116)", provider: "uniprot" }]} />)
    const list = within(screen.getByRole("region", { name: "Proteins in this answer" }))
    expect(list.getByText("KRAS · Homo sapiens (Human) · 189 amino acids")).toBeInTheDocument()
    expect(list.getByText("Escherichia coli (strain K12) · 109 amino acids")).toBeInTheDocument()
    expect(list.getByText(/UniProt record, source 1/)).toBeInTheDocument()
    expect(list.getByText(/Written in the question/)).toBeInTheDocument()
    expect(list.getByRole("link", { name: "UniProt P01116" })).toHaveAttribute("href", "https://www.uniprot.org/uniprotkb/P01116/entry")
    expect(asked.filter((a) => a.startsWith("/api/structure?"))).toEqual([]) // nothing is fetched until a structure is opened
    await user.click(list.getAllByRole("button", { name: "Show structure" })[0])
    expect(await screen.findByText(/Predicting the structure with ESMFold/)).toHaveAttribute("role", "status")
    release()
    expect(await screen.findByRole("img", { name: "3D structure of GTPase KRas" })).toHaveAttribute("data-atoms", "2")
    expect(asked).toContain("/api/structure?accession=P01116")
    expect(screen.getByText(/Predicted by ESMFold \(Meta AI\).*A prediction, not an experimental structure\./)).toBeInTheDocument()
    expect(screen.getByText(/189 residues · mean pLDDT/)).toHaveTextContent("91.2 (very high)")
    const legend = within(screen.getByRole("list", { name: /pLDDT/ }))
    expect(legend.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Very high (pLDDT 90 or more)", "Confident (pLDDT 70 to 90)", "Low (pLDDT 50 to 70)", "Very low (pLDDT below 50: may be disordered)"])
    expect(screen.getByRole("link", { name: "About ESMFold and the ESM Atlas" })).toHaveAttribute("href", "https://esmatlas.com/about")
    expect(list.getByRole("button", { name: "Hide structure" })).toHaveAttribute("aria-expanded", "true")
  })
  it("says why a structure could not be fetched, and offers AlphaFold DB's model for a UniProt entry, labelled as such", async () => {
    const user = userEvent.setup()
    const asked = engine([() => reply({ error: "ESMFold answered 504" }, 502), () => reply(AF)])
    render(<StructureTab proteins={[KRAS]} />)
    await user.click(screen.getByRole("button", { name: "Show structure" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("ESMFold answered 504")
    await user.click(screen.getByRole("button", { name: "Show AlphaFold DB's model instead" }))
    expect(await screen.findByRole("img", { name: "3D structure of GTPase KRas" })).toBeInTheDocument()
    expect(asked).toContain("/api/structure?accession=P01116&prefer=alphafold")
    expect(screen.getByText(/Predicted by AlphaFold \(Google DeepMind and EMBL-EBI\)/)).toBeInTheDocument()
    expect(screen.getByText(AF.note)).toBeInTheDocument()
    expect(screen.getByText(/kept from an earlier view/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "AlphaFold DB entry P01116" })).toHaveAttribute("href", "https://alphafold.ebi.ac.uk/entry/P01116")
  })
  it("offers no retry for a sequence ESMFold cannot fold, and no AlphaFold DB without an accession", async () => {
    const user = userEvent.setup()
    engine([() => reply({ error: "ESMFold's free API folds at most 400 amino acids, and this sequence has 436." }, 422)])
    render(<StructureTab proteins={[{ ...THIO, accession: undefined, length: 436, sequence: THIO.sequence!.repeat(4) }]} />)
    await user.click(screen.getByRole("button", { name: "Show structure" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("at most 400 amino acids")
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
    expect(screen.queryByRole("button", { name: /AlphaFold/ })).toBeNull()
  })
  it("says so when the engine is not running", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch") }))
    render(<StructureTab proteins={[THIO]} />)
    await user.click(screen.getByRole("button", { name: "Show structure" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("The app's engine isn't running")
  })
  it("offers the test proteins, open when the answer has none, and opens one", async () => {
    const user = userEvent.setup()
    const asked = engine([() => reply({ ...ESM, accession: "P42212" })])
    render(<StructureTab proteins={[]} />)
    const tests = within(screen.getByRole("region", { name: "Try a test protein" }))
    expect(await tests.findByText("Green fluorescent protein")).toBeInTheDocument()
    expect(tests.getByText("Try a test protein (2)")).toBeInTheDocument()
    expect(tests.getByText(/Mycobacterium tuberculosis \(strain ATCC 25618 \/ H37Rv\) · 269 amino acids/)).toBeInTheDocument()
    await user.click(tests.getAllByRole("button", { name: "Show structure" })[0])
    expect(await screen.findByRole("img", { name: "3D structure of Green fluorescent protein" })).toBeInTheDocument()
    expect(asked).toContain("/api/structure?test=gfp")
  })
  it("is a tab of the inspector for an answer with proteins", async () => {
    const user = userEvent.setup()
    engine([])
    const events = [...lines(S_REAL), { type: "proteins", seq: 10_000, items: [KRAS] }]
    function Shown() { const [tab, setTab] = useState<InspectorTab>(); return <Inspector id="a-1" state={foldAnswer(events)} events={events} tab={tab} onTab={setTab} /> }
    render(<Shown />)
    await user.click(screen.getByRole("tab", { name: "Structure" }))
    expect(await screen.findByRole("region", { name: "Proteins in this answer" })).toBeInTheDocument()
  })
})

describe("Try a test protein, on the empty page", () => {
  it("is a chip per test protein that asks its question, and a button that opens the viewer", async () => {
    const user = userEvent.setup()
    engine([])
    const onPick = vi.fn(), onOpenViewer = vi.fn()
    render(<TestProteinChips onPick={onPick} onOpenViewer={onOpenViewer} />)
    const chips = within(await screen.findByRole("group", { name: /Try a test protein/ }))
    expect(chips.getAllByRole("button").map((b) => b.textContent)).toEqual(["GFP (Aequorea victoria)", "InhA (M. tuberculosis H37Rv)"])
    await user.click(chips.getByRole("button", { name: "GFP (Aequorea victoria)" }))
    expect(onPick).toHaveBeenCalledWith("Show the structure of GFP from Aequorea victoria")
    await user.click(screen.getByRole("button", { name: "Open the structure viewer" }))
    expect(onOpenViewer).toHaveBeenCalled()
  })
  it("shows nothing when the engine has no test proteins", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: "not found" }, 404)))
    const { container } = render(<TestProteinChips onPick={() => {}} onOpenViewer={() => {}} />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
