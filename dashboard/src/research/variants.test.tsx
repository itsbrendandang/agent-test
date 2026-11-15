// The Variants tab: known variants of the answer's protein, with citations, and their predicted confidence beside the
// reference's. Fakes only: the engine's compare answer is a stubbed fetch.
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import S_REAL from "@/test/research/stream-real.jsonl?raw"
import { Inspector } from "./Inspector"
import { tabsOf, type InspectorTab } from "./inspectorState"
import { foldAnswer, fromRecord, type ResearchEvent } from "./model"
import { comparisonOf, signed, variantsOf } from "./variants/model"

const lines = (raw: string): ResearchEvent[] => raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as ResearchEvent)
const VARIANTS = {
  accession: "P01116", protein: "GTPase KRas", gene: "KRAS", length: 5, found: 30, source: "https://www.uniprot.org/uniprotkb/P01116/entry",
  items: [
    { id: "G2D", position: 2, from: "G", to: "D", kind: "natural variant", reported: "in GASC; somatic mutation", citations: [{ label: "PubMed 16474405", url: "https://pubmed.ncbi.nlm.nih.gov/16474405/" }], record: "https://www.uniprot.org/uniprotkb/P01116/variant-viewer" },
    { id: "Q4L", position: 4, from: "Q", to: "L", kind: "mutagenesis", reported: "Promotes GTP binding.", citations: [{ label: "PubMed 1", url: "https://pubmed.ncbi.nlm.nih.gov/1/" }], record: "https://www.uniprot.org/uniprotkb/P01116/variant-viewer" },
  ],
}
const COMPARE = {
  accession: "P01116", model: "esmfold", modelLabel: "ESMFold (Meta AI)", label: "Predicted, not measurements.", length: 5,
  reference: { meanPlddt: 90, plddt: [90, 90, 90, 90, 90], cached: false },
  rows: [
    { id: "G2D", position: 2, reference: 90, variant: 50, change: -40, profile: { meanPlddt: 82, plddt: [90, 50, 90, 90, 90], cached: false } },
    { id: "Q4L", position: 4, error: "Not predicted (ESMFold answered 500)." },
  ],
}
const withVariants = (): ResearchEvent[] => { const real = lines(S_REAL); const end = real.findIndex((e) => e.type === "research.finished"); return [...real.slice(0, end), { type: "variants", ...VARIANTS }, ...real.slice(end)] }
function Shown({ events, first }: { events: ResearchEvent[]; first?: InspectorTab }) {
  const [tab, setTab] = useState(first)
  return <Inspector id="a-1" state={foldAnswer(events)} events={events} tab={tab} onTab={setTab} />
}
beforeEach(() => { vi.unstubAllGlobals() })

describe("known variants", () => {
  it("are read with care: a bad link, a made-up change or no items gives nothing", () => {
    expect(variantsOf(VARIANTS)?.items.map((v) => v.id)).toEqual(["G2D", "Q4L"])
    expect(variantsOf({ ...VARIANTS, source: "javascript:alert(1)" })).toBeUndefined()
    expect(variantsOf({ ...VARIANTS, items: [{ ...VARIANTS.items[0], id: "G2DX" }] })).toBeUndefined()
    expect(variantsOf({ ...VARIANTS, items: [{ ...VARIANTS.items[0], citations: [{ label: "x", url: "https://evil.example/" }] }] })?.items[0].citations).toEqual([])
    expect(comparisonOf(COMPARE)?.rows[0].change).toBe(-40)
    expect([signed(3.21), signed(-12), signed(0)]).toEqual(["+3.2", "−12.0", "0.0"])
  })
  it("get their own tab only when the answer has some, also from a saved record", () => {
    const real = lines(S_REAL)
    expect(tabsOf(foldAnswer(real), real)).not.toContain("variants")
    expect(tabsOf(foldAnswer(withVariants()), withVariants())).toContain("variants")
    expect(fromRecord({ id: "a", question: "q", status: "done", sources: [], statements: [], steps: [], searches: [], variants: VARIANTS })?.variants?.accession).toBe("P01116")
  })
  it("show what the source reports, its citation, the predicted confidence change, labelled as predicted; View shows the variant beside the reference", async () => {
    const asked: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { asked.push(url); return new Response(JSON.stringify(COMPARE), { status: 200 }) }))
    const user = userEvent.setup()
    render(<Shown events={withVariants()} first="variants" />)
    const panel = screen.getByRole("tabpanel", { name: "Variants" })
    expect(within(panel).getByRole("note")).toHaveTextContent(/Predicted, not measured/)
    expect(within(panel).getByText("in GASC; somatic mutation")).toBeInTheDocument()
    expect(within(panel).getByRole("link", { name: "PubMed 16474405" })).toHaveAttribute("href", "https://pubmed.ncbi.nlm.nih.gov/16474405/")
    await waitFor(() => expect(screen.getByTestId("change-G2D")).toHaveTextContent("−40.0"))
    expect(asked).toEqual(["http://localhost:8787/api/variants/compare?accession=P01116&variants=G2D%2CQ4L"])
    expect(screen.getByTestId("change-Q4L")).toHaveTextContent("ESMFold answered 500")
    const views = within(panel).getAllByRole("button", { name: "View" })
    expect(views[1]).toBeDisabled()
    await user.click(views[0])
    expect(screen.getByRole("figure", { name: /Predicted confidence of G2D beside the reference/ })).toHaveTextContent(/Reference: mean pLDDT 90.0.*G2D: mean pLDDT 82.0/)
    await user.click(within(panel).getByRole("button", { name: "Hide" }))
    expect(screen.queryByRole("figure")).not.toBeInTheDocument()
  })
  it("say so when no prediction could be made, and let the person try again", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: "UniProt answered 503" }), { status: 502 }))
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    render(<Shown events={withVariants()} first="variants" />)
    expect(await screen.findByRole("alert")).toHaveTextContent("No prediction: UniProt answered 503")
    await user.click(screen.getByRole("button", { name: "Try again" }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  })
})
