// A made-up team review for the detail panels' tests and screenshots: a practice run (mock: true) whose scout looked up
// records in public databases, so its sources carry UniProt, ChEMBL, ClinicalTrials.gov, PubMed and Open Targets
// addresses. Not a real run and not research: the titles say "(fixture)". `upTo` cuts it to the first N events, to
// play a run that is still going.
import type { LabEvent } from "@/lab/adapter"

export const FIXTURE_RUN = "202611150900-details-fixture"
const T0 = Date.UTC(2026, 10, 15, 9, 0, 0)
const at = (s: number) => T0 + s * 1000
const usage = (input: number, output: number, usd = 0) => ({ input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output, usd })

export const KRAS = "https://www.uniprot.org/uniprotkb/P01116/entry"
export const SOTORASIB = "https://www.ebi.ac.uk/chembl/explore/compound/CHEMBL4535757"
export const TRIAL = "https://clinicaltrials.gov/study/NCT04303780"
export const PAPER = "https://pubmed.ncbi.nlm.nih.gov/34096690/"
export const EVIDENCE = "https://platform.opentargets.org/evidence/ENSG00000133703/EFO_0003060"

const ALL: LabEvent[] = [
  { key: "start", at: at(0), type: "run.started", runId: FIXTURE_RUN, brief: "kras-g12c-hit-to-lead.md", title: "KRAS G12C hit-to-lead (fixture)", mock: true },
  { key: "roster", at: at(1), type: "run.roster", members: [
    { name: "lead-scientist", title: "Lead Scientist", role: "lead", source: "board" },
    { name: "scout", title: "Scout (Data and Evidence)", role: "member", source: "board" },
    { name: "critic", title: "Critic (Scientific Reviewer)", role: "member", source: "board" },
    { name: "medicinal-chemist", title: "Medicinal Chemist", role: "member", source: "specialist", why: "The brief asks about covalent warheads.", methods: [{ name: "sar", title: "SAR analysis" }] },
  ] },
  { key: "round:1", at: at(2), type: "round.started", round: 1, message: "Round 1. Scout: look up the target, the drug and its trial.", final: false },
  { key: "search:1", at: at(3), type: "evidence.triaged", member: "scout", query: "KRAS UniProt P01116 function", kept: 2, dropped: 1, provider: "uniprot", items: [
    { url: KRAS, title: "KRAS - GTPase KRas (fixture)", text: "UniProt P01116. Small GTPase; G12C is an activating mutation in lung cancer.", provider: "uniprot", query: "KRAS UniProt P01116 function", relevance: 1 },
    { url: EVIDENCE, title: "KRAS and non-small cell lung carcinoma (fixture)", text: "Target ENSG00000133703, disease EFO_0003060: genetic and drug evidence.", provider: "opentargets", query: "KRAS UniProt P01116 function", relevance: 0.5 },
  ] },
  { key: "search:2", at: at(5), type: "evidence.triaged", member: "scout", query: "sotorasib CHEMBL4535757 trial", kept: 3, dropped: 0, provider: "chembl", items: [
    { url: SOTORASIB, title: "Sotorasib (fixture)", text: "CHEMBL4535757, covalent KRAS G12C inhibitor, max phase 4.", provider: "chembl", studyType: "record" },
    { url: TRIAL, title: "CodeBreaK 200 (fixture)", text: "NCT04303780: sotorasib versus docetaxel in KRAS G12C NSCLC.", provider: "clinicaltrials", studyType: "trial" },
    { url: PAPER, title: "Sotorasib for lung cancers with KRAS p.G12C (fixture)", text: "PMID: 34096690. doi: 10.1056/NEJMoa2103695.", provider: "europepmc", studyType: "clinical" },
  ] },
  { key: "reply:1:scout", at: at(8), type: "member.replied", round: 1, member: "scout", text: "In short: KRAS (UniProt P01116) is the target; sotorasib (CHEMBL4535757) was tested in NCT04303780.\n\nDetails follow.", summary: "KRAS (UniProt P01116) is the target; sotorasib (CHEMBL4535757) was tested in NCT04303780.", usd: 0, usage: usage(1200, 300) },
  { key: "reply:1:critic", at: at(9), type: "member.replied", round: 1, member: "critic", text: "In short: The trial NCT04303780 shows a modest gain only.", summary: "The trial NCT04303780 shows a modest gain only.", usd: 0, usage: usage(900, 150) },
  { key: "reply:1:medicinal-chemist", at: at(9), type: "member.replied", round: 1, member: "medicinal-chemist", text: "In short: The acrylamide warhead binds Cys12.", usd: 0, usage: usage(400, 90) },
  { key: "claim:1:scout:a", at: at(10), type: "claim.checked", round: 1, member: "scout", claim: "Sotorasib (CHEMBL4535757) reached phase 4.", kind: "literature", verdict: "verified", checker: "first-pass", checkedBy: "scripted", source: SOTORASIB, quoteFound: true, note: "quoted: \"max phase 4\"" },
  { key: "claim:1:critic:a", at: at(11), type: "claim.checked", round: 1, member: "critic", claim: "NCT04303780 met its primary end point with a large gain.", kind: "literature", verdict: "contradicted", checker: "first-pass", checkedBy: "scripted", source: TRIAL, quoteFound: false, note: "the record reports a modest gain" },
  { key: "round:2", at: at(12), type: "round.started", round: 2, message: "Round 2. Final positions.", final: true },
  { key: "reply:2:scout", at: at(14), type: "member.replied", round: 2, member: "scout", text: "In short: Go with a resistance panel first.", usd: 0, usage: usage(2600, 520) },
  { key: "claim:2:critic:a", at: at(15), type: "claim.checked", round: 2, member: "critic", claim: "NCT04303780 met its primary end point with a large gain.", kind: "literature", verdict: "unsupported", checker: "openai", checkedBy: "scripted", source: TRIAL },
  { key: "memo", at: at(16), type: "memo.written", path: "memo.md", decision: "Go, with a resistance panel" },
  { key: "finished", at: at(17), type: "run.finished", usd: 0, minutes: 0.3, members: { "lead-scientist": usage(3000, 800), scout: usage(2600, 520), critic: usage(900, 150), "medicinal-chemist": usage(400, 90) } },
]

/** The fixture's events; `upTo` keeps the first N (a run still going). */
export const fixtureEvents = (upTo = ALL.length): LabEvent[] => ALL.slice(0, upTo)
