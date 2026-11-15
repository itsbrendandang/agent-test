// The built-in example for the Graph view: a cancer drug, pembrolizumab (KEYTRUDA), from biomanufacturing to FDA
// approval, with its interactions, the articles about it that carry a published correction or retraction, and possible
// clinical trials. It is written as a board run record (the events a finished review produces, see board/api.ts), so it
// draws, narrates and replays like a long review run by the team.
//
// How it was made: assembled by hand on RETRIEVED_ON from free public records, with no key and no paid call
// (openFDA labels and Drugs@FDA, FDA approval letters and reviews, ClinicalTrials.gov API v2, Europe PMC, PubMed,
// Crossref). Every statement links to the record it was checked against. No model wrote or checked any of it: the
// team roles show who does each part in a real review. Nothing here is invented: no NCT id, citation, notice or date
// that is not in the linked record. When a free record does not say what a correction changed, the source says so.
import type { BoardEvent, EvidenceItem, RosterMember, SearchProvider, Verdict } from "@/board/api"

export const EXAMPLE_ID = "example:pembrolizumab"
export const RETRIEVED_ON = "2026-11-15"
export const EXAMPLE_TITLE = "Example: a cancer drug from biomanufacturing to FDA approval (pembrolizumab)"
/** The question the example answers: the lead frames the review with it. */
export const EXAMPLE_QUESTION = "We are testing a cancer drug (pembrolizumab): what are the steps from biomanufacturing to FDA approval, its interactions, articles with errors about it, and possible clinical trials?"

/** The stages, in order. Each one is a round of the review and a lane of the picture. */
export const STAGES = [
  "Biomanufacturing and quality (CMC)",
  "Preclinical pharmacology and toxicology",
  "IND and Phase 1",
  "Phase 2 and Phase 3",
  "BLA submission and FDA review",
  "Approval and post-marketing",
  "Interactions in the label",
  "New uses: possible clinical trials",
  "Summary",
] as const

export const EXAMPLE_ROSTER: RosterMember[] = [
  { name: "lead-scientist", title: "Lead Scientist", role: "lead", model: "lead", modelId: "none (example)", tools: [] },
  { name: "scout", title: "Scout (Data and Evidence)", role: "member", model: "cheap", modelId: "none (example)", tools: ["literature_search", "database_search"] },
  { name: "proposer", title: "Proposer (Triage)", role: "member", model: "strong", modelId: "none (example)", tools: [] },
  { name: "methods-auditor", title: "Methods Auditor (Quality Checker)", role: "member", model: "strong", modelId: "none (example)", tools: [] },
  { name: "critic", title: "Critic (Scientific Reviewer)", role: "member", model: "rival", modelId: "none (example)", tools: [] },
  { name: "reporter", title: "Reporter (Research Writer)", role: "member", model: "strong", modelId: "none (example)", tools: [] },
]

const pubmed = (pmid: string) => `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
const trial = (nct: string) => `https://clinicaltrials.gov/study/${nct}`
const fda = (path: string) => `https://www.accessdata.fda.gov/drugsatfda_docs/${path}`

type Source = EvidenceItem & { text: string }
/** Every source the example uses. `notice` marks an article with a published correction or retraction. */
export const SOURCES = {
  label: { url: "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=9333c79b-d487-4538-a9f0-71b91a02b287", title: "KEYTRUDA prescribing information (current label, effective 16 Oct 2026)", studyType: "FDA label", provider: "openfda",
    text: "Sections used: 5.3 Complications of allogeneic HSCT, 5.4 Increased mortality in multiple myeloma with a thalidomide analogue and dexamethasone, 5.5 Embryo-fetal toxicity, 1.16 Renal cell carcinoma, 2 Dosage modifications, 11 Description (CHO cells), 12.1 Mechanism of action, 13.1 and 13.2 Nonclinical toxicology. The current label has no Drug Interactions section." },
  label2014: { url: fda("label/2014/125514lbl.pdf"), title: "KEYTRUDA label at first approval (September 2014)", studyType: "FDA label", provider: "openfda",
    text: "Section 7 Drug Interactions: No formal pharmacokinetic drug interaction studies have been conducted with KEYTRUDA." },
  letter2014: { url: fda("appletter/2014/125514Orig1s000ltr.pdf"), title: "FDA accelerated approval letter, BLA 125514 (4 September 2014)", studyType: "FDA approval letter", provider: "openfda",
    text: "Licensing, 18-month dating period at 5 ± 3 °C, no FDA lot release, no advisory committee, accelerated approval requirement 2770-1, commitments 2770-2 to 2770-6." },
  review2014: { url: fda("nda/2014/125514Orig1s000SumR.pdf"), title: "FDA Division Director summary review, BLA 125514 (2014)", studyType: "FDA review", provider: "openfda",
    text: "Regulatory history (IND 110080, CMC meetings, rolling submission), CMC, nonclinical pharmacology and toxicology, clinical pharmacology, orphan designation." },
  letter2015: { url: fda("appletter/2015/125514Orig1s004s006ltr.pdf"), title: "FDA supplement approval S-4 and S-6: fulfilment of postmarketing requirements (18 December 2015)", studyType: "FDA approval letter", provider: "openfda",
    text: "Removes the accelerated-approval limits from the melanoma indication; requirement 2770-1: You are no longer required to report on this requirement." },
  drugsAtFda: { url: "https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=125514", title: "Drugs@FDA: BLA 125514, KEYTRUDA (all submissions)", studyType: "FDA database record", provider: "openfda",
    text: "Original application approved 4 September 2014, review priority PRIORITY, type 1 new molecular entity (openFDA drugsfda record)." },
  qlex: { url: fda("appletter/2025/761467Orig1s000ltr.pdf"), title: "FDA approval letter, BLA 761467 KEYTRUDA QLEX (19 September 2025)", studyType: "FDA approval letter", provider: "openfda",
    text: "KEYTRUDA QLEX: pembrolizumab with berahyaluronidase alfa for subcutaneous use (openFDA label and drugsfda record: original approval 19 September 2025, priority review)." },
  ct001: { url: trial("NCT01295827"), title: "KEYNOTE-001 (NCT01295827): Phase 1, completed", studyType: "trial registry", provider: "clinicaltrials",
    text: "Phase 1; status Completed; start 4 March 2011; completion 11 December 2018; 1,260 participants; sponsor Merck Sharp & Dohme LLC." },
  hamid2013: { url: pubmed("23724846"), title: "Safety and tumor responses with lambrolizumab (anti-PD-1) in melanoma. N Engl J Med 2013", studyType: "Phase 1 report", provider: "europepmc",
    text: "135 patients with advanced melanoma; confirmed response rate across dose cohorts 38% (95% CI 25 to 44) by central review (RECIST 1.1)." },
  ct002: { url: trial("NCT01704287"), title: "KEYNOTE-002 (NCT01704287): Phase 2, completed", studyType: "trial registry", provider: "clinicaltrials",
    text: "Phase 2; status Completed; 540 participants; pembrolizumab versus chemotherapy in advanced melanoma." },
  ribas2015: { url: pubmed("26115796"), title: "Pembrolizumab versus investigator-choice chemotherapy for ipilimumab-refractory melanoma (KEYNOTE-002). Lancet Oncol 2015", studyType: "Phase 2 report", provider: "europepmc",
    text: "540 patients. Progression-free survival improved with pembrolizumab 2 mg/kg (HR 0.57, 95% CI 0.45-0.73) and 10 mg/kg (HR 0.50, 0.39-0.64) versus chemotherapy." },
  ct006: { url: trial("NCT01866319"), title: "KEYNOTE-006 (NCT01866319): Phase 3, completed", studyType: "trial registry", provider: "clinicaltrials",
    text: "Phase 3; status Completed; 834 participants; two pembrolizumab schedules versus ipilimumab in advanced melanoma." },
  robert2015: { url: pubmed("25891173"), title: "Pembrolizumab versus ipilimumab in advanced melanoma (KEYNOTE-006). N Engl J Med 2015", studyType: "Phase 3 report", provider: "europepmc",
    text: "834 patients. Estimated 6-month progression-free survival 47.3% (every 2 weeks) and 46.4% (every 3 weeks) with pembrolizumab versus 26.5% with ipilimumab." },
  k048: { url: pubmed("31679945"), title: "Pembrolizumab alone or with chemotherapy versus cetuximab with chemotherapy for head and neck cancer (KEYNOTE-048). Lancet 2019", studyType: "Phase 3 report", provider: "europepmc",
    text: "Crossref lists three errata for this article (published January 2020, February 2020 and June 2021).",
    notice: { type: "correction", date: "2020-2021", url: pubmed("31982072"), what: "Three 'Department of Error' notices (PubMed 31982072, 32087792, 34119067). The free records (PubMed, Europe PMC, Crossref) do not say what was corrected, so this example does not say either." } },
  fae: { url: pubmed("40769354"), title: "Temperature promotes Fab-arm exchange in pembrolizumab. Int J Biol Macromol 2025", studyType: "laboratory study", provider: "europepmc",
    text: "A study of Fab-arm exchange in pembrolizumab, an IgG4 antibody. A corrigendum was published in September 2025.",
    notice: { type: "correction", date: "2025-09", url: pubmed("40946082"), what: "A corrigendum (PubMed 40946082). The free record does not say what was corrected." } },
  mir128: { url: pubmed("33791361"), title: "Upregulating hsa-miR-128a increased the effects of pembrolizumab on laryngeal cancer cells via the p53 pathway. Biomed Res Int 2021", studyType: "cell study", provider: "europepmc",
    text: "Retracted in January 2024.",
    notice: { type: "retraction", date: "2024-01", url: pubmed("38249635"), what: "Retracted by the publisher after an investigation found evidence of systematic manipulation of the publication and peer-review process." } },
  mir20b: { url: pubmed("34968160"), title: "microRNA-20b-5p overexpression combining pembrolizumab potentiates cancer cells to radiation therapy. Bioengineered 2022", studyType: "cell and mouse study", provider: "europepmc",
    text: "Retracted: a statement of retraction was published in November 2026.",
    notice: { type: "retraction", date: "2026-11", url: pubmed("42987297"), what: "A statement of retraction (PubMed 42987297). The free record does not give the reason." } },
  oral: { url: pubmed("35048002"), title: "Tumor microenvironment in oral cancer following neoadjuvant pembrolizumab: preliminary analysis. Front Oral Health 2021", studyType: "clinical case series", provider: "europepmc",
    text: "Retracted in March 2022.",
    notice: { type: "retraction", date: "2022-03", url: pubmed("35392378"), what: "Retracted because the authors were told by the supplier of the drug that they were not entitled to publish the raw data underlying the findings." } },
  sbrt: { url: pubmed("34237249"), title: "SBRT plus pembrolizumab and trametinib versus SBRT plus gemcitabine for locally recurrent pancreatic cancer (phase 2). Lancet Oncol 2021", studyType: "Phase 2 report", provider: "europepmc",
    text: "Original report: median follow-up 23.3 months; median overall survival 24.9 versus 22.4 months (HR 0.60, 95% CI 0.44-0.82; p=0.0012).",
    notice: { type: "retraction", date: "2022-03", url: pubmed("35241252"), what: "Retracted and republished in March 2022 (PubMed 35240087). The republished report gives a median follow-up of 13.1 months and a median overall survival of 14.9 versus 12.8 months (HR 0.69, 95% CI 0.51-0.95; p=0.021), not 24.9 versus 22.4 months (HR 0.60)." } },
  sbrtRepublished: { url: pubmed("35240087"), title: "Retraction and republication: SBRT plus pembrolizumab and trametinib (phase 2, NCT02704156). Lancet Oncol 2022", studyType: "Phase 2 report (corrected)", provider: "europepmc",
    text: "Republished report: median follow-up 13.1 months; median overall survival 14.9 months with SBRT plus pembrolizumab and trametinib versus 12.8 months with SBRT plus gemcitabine (HR 0.69, 95% CI 0.51-0.95; p=0.021)." },
  k183: { url: pubmed("31327687"), title: "Pembrolizumab plus pomalidomide and dexamethasone in multiple myeloma (KEYNOTE-183). Lancet Haematol 2019", studyType: "Phase 3 report", provider: "europepmc",
    text: "On July 3, 2017, the FDA established that risks associated with the triple combination outweighed benefits and halted the study." },
  k185: { url: pubmed("31327689"), title: "Pembrolizumab plus lenalidomide and dexamethasone in multiple myeloma (KEYNOTE-185). Lancet Haematol 2019", studyType: "Phase 3 report", provider: "europepmc",
    text: "On July 3, 2017, the FDA decided to halt the study because of the imbalance in the proportion of death between groups." },
  ct183: { url: trial("NCT02576977"), title: "KEYNOTE-183 (NCT02576977): Phase 3, terminated", studyType: "trial registry", provider: "clinicaltrials",
    text: "Status Terminated. Why stopped: The study was terminated early due to business reasons." },
  ct185: { url: trial("NCT02579863"), title: "KEYNOTE-185 (NCT02579863): Phase 3, terminated", studyType: "trial registry", provider: "clinicaltrials",
    text: "Status Terminated. Why stopped: The study was terminated early due to business reasons." },
  t009: { url: trial("NCT06623422"), title: "INTerpath-009 (NCT06623422): pembrolizumab with or without intismeran autogene (V940), NSCLC", studyType: "trial registry", provider: "clinicaltrials",
    text: "Phase 3; Recruiting; start 21 October 2024; 680 planned; non-small cell lung cancer; sponsor Merck Sharp & Dohme LLC." },
  t004: { url: trial("NCT06345729"), title: "KANDLELIT-004 (NCT06345729): calderasib (MK-1084) plus pembrolizumab, KRAS G12C NSCLC", studyType: "trial registry", provider: "clinicaltrials",
    text: "Phase 3; Recruiting; start 24 May 2024; 348 planned; KRAS G12C mutant NSCLC with PD-L1 TPS of 50% or more." },
  t033: { url: trial("NCT06952504"), title: "TroFuse-033 (NCT06952504): sacituzumab tirumotecan plus pembrolizumab, endometrial cancer", studyType: "trial registry", provider: "clinicaltrials",
    text: "Phase 3; Recruiting; start 22 May 2025; 1,123 planned; mismatch repair proficient endometrial cancer." },
  t012: { url: trial("NCT06393374"), title: "MK-2870-012 (NCT06393374): sacituzumab tirumotecan plus pembrolizumab, TNBC without pCR", studyType: "trial registry", provider: "clinicaltrials",
    text: "Phase 3; Recruiting; start 24 June 2024; 1,530 planned; triple-negative breast cancer that did not reach a pathological complete response." },
  t014: { url: trial("NCT07513376"), title: "INTerpath-014 (NCT07513376): adjuvant intismeran with or without subcutaneous pembrolizumab (MK-3475A), stage I NSCLC", studyType: "trial registry", provider: "clinicaltrials",
    text: "Phase 3; Recruiting; start 4 May 2026; 876 planned; high-risk stage I non-small cell lung cancer." },
} satisfies Record<string, Source>
type Key = keyof typeof SOURCES

// ── The run record ────────────────────────────────────────────────────────────────────────────────────────────────

const events: BoardEvent[] = []
let n = 0
/** The record has an order, not a clock: no model ran, so every event carries the same time and the replay shows no seconds. */
const push = (e: Record<string, unknown>) => { n++; events.push({ key: `ex:${n}`, at: 0, ...e } as BoardEvent) }
let round = 0
const stage = (message: string) => { round++; push({ type: "round.started", round, title: STAGES[round - 1], message, final: round === STAGES.length }) }
const search = (provider: SearchProvider, query: string, keys: Key[], dropped = 0) =>
  push({ type: "evidence.triaged", member: "scout", query, kept: keys.length, dropped, provider, items: keys.map((k) => ({ ...SOURCES[k] })) })
const reply = (member: string, text: string) => push({ type: "member.replied", round, member, text })
const claim = (member: string, text: string, verdict: Verdict, source: Key | null, note?: string) =>
  push({ type: "claim.checked", round, member, claim: text, kind: "literature", verdict, checker: "source-check", ...(source ? { source: SOURCES[source].url } : {}), ...(note ? { note } : {}) })

push({ type: "run.started", runId: EXAMPLE_ID, brief: "example-pembrolizumab", title: EXAMPLE_TITLE, mock: true })
push({ type: "lead.framed", text: `${EXAMPLE_QUESTION} Map each stage in order, with the record that shows it. Name the interactions in the label, the articles about the drug that were corrected or retracted, and trials that could lead to new uses.` })

stage("Methods Auditor: how is the antibody made and released? Scout: find the label and the approval letter.")
search("openfda", "KEYTRUDA label description and approval letter", ["label", "letter2014", "review2014"])
search("europepmc", "pembrolizumab Fab-arm exchange correction", ["fae"], 3)
reply("methods-auditor", "Pembrolizumab is a humanized IgG4 antibody made in CHO cells. The approval letter sets its shelf life, its lot release and four quality commitments.")
claim("methods-auditor", "Pembrolizumab is a humanized monoclonal IgG4 kappa antibody of about 149 kDa, produced in recombinant Chinese hamster ovary (CHO) cells.", "verified", "label")
claim("methods-auditor", "FDA set a dating period of 18 months from manufacture for Keytruda stored at 5 ± 3 °C.", "verified", "letter2014")
claim("methods-auditor", "FDA did not require Merck to send samples of each lot for release by CDER; each lot must still pass its release tests.", "verified", "letter2014")
claim("methods-auditor", "Before the BLA, a 2013 CMC meeting discussed Fab-arm exchange data, the host cell protein and potency assays, and the viral clearance strategy.", "verified", "review2014")
claim("methods-auditor", "Quality commitments at approval: a more sensitive process-specific host cell protein assay (2770-3), a review of drug substance and drug product specifications after 30 commercial lots (2770-4, 2770-5) and an endotoxin recovery study (2770-6).", "verified", "letter2014")
reply("critic", "One 2025 laboratory article on Fab-arm exchange in pembrolizumab has a published corrigendum. Use the corrected version.")
claim("critic", "The 2025 article on Fab-arm exchange in pembrolizumab (Int J Biol Macromol) has a published corrigendum.", "verified", "fae", "Europe PMC links the corrigendum (PubMed 40946082) to the article. What it corrected is not in the free record.")

stage("Proposer: list the nonclinical studies. Critic: check the laboratory papers the team might cite.")
search("openfda", "pembrolizumab nonclinical toxicology", ["label", "review2014"])
search("europepmc", "pembrolizumab microRNA retracted", ["mir128", "mir20b"], 4)
reply("proposer", "The nonclinical package was small, as usual for an antibody against late-stage cancer: mechanism, infection models and two monkey toxicology studies.")
claim("proposer", "The BLA held in vitro mechanism studies, animal infection models, and 1-month and 6-month repeat-dose toxicology studies.", "verified", "review2014")
claim("proposer", "No carcinogenicity or genotoxicity studies were done: FDA did not require them for this indication and this class of drug.", "verified", "review2014")
claim("proposer", "Reproductive risk was judged from the literature: blocking PD-1 signalling increases the loss of allogeneic pregnancy in mice, which led to the embryo-fetal toxicity warning.", "verified", "review2014")
claim("proposer", "In chimpanzees with chronic hepatitis B, pembrolizumab raised serum ALT, AST and GGT in two of four animals.", "verified", "label")
claim("proposer", "Raising miR-128a increases the effect of pembrolizumab on laryngeal cancer cells.", "unsupported", "mir128", "The only source was retracted in 2024 (manipulated peer review). A retracted article cannot support a statement.")
claim("proposer", "Overexpressing miR-20b-5p with pembrolizumab makes cancer cells more sensitive to radiation.", "unsupported", "mir20b", "The only source has a statement of retraction (November 2026).")
reply("critic", "Two laboratory papers on pembrolizumab and microRNAs were retracted. Neither can support a statement.")

stage("Scout: find the first trial and the IND. Proposer: say how the dose was chosen.")
search("openfda", "pembrolizumab IND 110080 first trial", ["review2014"])
search("clinicaltrials", "KEYNOTE-001", ["ct001"])
search("europepmc", "lambrolizumab melanoma phase 1", ["hamid2013"], 2)
reply("proposer", "The first trial, KEYNOTE-001, came with the IND in 2010 and grew by amendments into the trial that supported approval.")
claim("proposer", "The first clinical trial, PN001 (KEYNOTE-001), was submitted with the original IND 110080 on 9 December 2010.", "verified", "review2014")
claim("scout", "KEYNOTE-001 (NCT01295827) is a Phase 1 study that started on 4 March 2011, enrolled 1,260 participants and is completed.", "verified", "ct001")
claim("proposer", "In 135 patients with advanced melanoma (the drug was then called lambrolizumab), the confirmed response rate across dose cohorts was 38%.", "verified", "hamid2013")
claim("proposer", "The 2 mg/kg every-3-weeks dose came from dose escalation at 1, 3 and 10 mg/kg and pharmacodynamic data; it gave response rates similar to 10 mg/kg.", "verified", "review2014")

stage("Scout: find the confirmatory trials. Critic: check their reports for corrections.")
search("clinicaltrials", "KEYNOTE-002 KEYNOTE-006", ["ct002", "ct006"])
search("europepmc", "KEYNOTE-002 KEYNOTE-006 results", ["ribas2015", "robert2015"], 3)
search("europepmc", "pembrolizumab phase 3 erratum Lancet", ["k048"], 6)
reply("scout", "KEYNOTE-002 (Phase 2) and KEYNOTE-006 (Phase 3) are both completed and published.")
claim("scout", "KEYNOTE-002 (NCT01704287) is a completed Phase 2 trial with 540 participants.", "verified", "ct002")
claim("scout", "In KEYNOTE-002, pembrolizumab 2 mg/kg improved progression-free survival over chemotherapy in ipilimumab-refractory melanoma (HR 0.57).", "verified", "ribas2015")
claim("scout", "KEYNOTE-006 (NCT01866319) is a completed Phase 3 trial with 834 participants.", "verified", "ct006")
claim("scout", "In KEYNOTE-006, 6-month progression-free survival was 47.3% and 46.4% with pembrolizumab versus 26.5% with ipilimumab.", "verified", "robert2015")
reply("critic", "The KEYNOTE-048 report in The Lancet has three errata. The free records do not say what they changed, so check the corrected article before quoting numbers from it.")
claim("critic", "The KEYNOTE-048 report (Lancet 2019) has three published errata.", "verified", "k048", "Crossref lists three erratum updates (2020-01-25, 2020-02-22, 2021-06-12).")

stage("Lead: trace the BLA through FDA review. Proposer: what did the label say about interactions?")
search("openfda", "BLA 125514 review priority and history", ["drugsAtFda", "review2014", "letter2014", "label2014"])
reply("proposer", "Merck sent the BLA in modules. FDA gave it priority review and did not call an advisory committee.")
claim("proposer", "The BLA was a rolling submission: first module on 22 November 2013, final module on 27 February 2014.", "verified", "review2014")
claim("proposer", "FDA reviewed the original BLA as a priority review of a new molecular entity.", "verified", "drugsAtFda")
claim("proposer", "The application was not referred to an advisory committee: FDA said there were no controversial issues that would benefit from one.", "verified", "letter2014")
claim("proposer", "Orphan drug designation for stage IIB to IV melanoma (19 November 2012) exempted the application from the pediatric study requirement.", "verified", "review2014")
claim("proposer", "The 2014 label said that no formal pharmacokinetic drug interaction studies had been conducted.", "verified", "label2014")
claim("proposer", "Strong CYP3A4 inhibitors raise pembrolizumab levels, so the dose must be lowered with them.", "unsupported", "label2014", "No FDA label for pembrolizumab says this. The 2014 label reports no formal pharmacokinetic interaction studies, and the current label has no Drug Interactions section.")
reply("critic", "The CYP3A4 statement has no source: no pembrolizumab label says it.")

stage("Lead: what did approval require, and what came after? Approval came early, on response rates, with a duty to prove a survival benefit. KEYNOTE-002 and KEYNOTE-006 met that duty in December 2015. Methods Auditor: check the commitments.")
search("openfda", "KEYTRUDA accelerated approval requirement fulfilment", ["letter2014", "letter2015", "qlex"])
claim("proposer", "FDA granted accelerated approval on 4 September 2014 for unresectable or metastatic melanoma after ipilimumab (and a BRAF inhibitor if BRAF V600 positive).", "verified", "letter2014")
claim("proposer", "Requirement 2770-1: a randomized trial showing superiority over standard therapy in melanoma, with trial completion in March 2016 and a final report in January 2017.", "verified", "letter2014")
claim("methods-auditor", "On 18 December 2015 FDA approved supplements 4 and 6, removed the accelerated-approval limits from the melanoma indication and said requirement 2770-1 no longer had to be reported on.", "verified", "letter2015")
claim("methods-auditor", "Commitment 2770-2: an animal study of how PD-1 inhibition changes primary and recall antibody responses to an antigen such as tetanus toxoid.", "verified", "letter2014")
claim("methods-auditor", "A subcutaneous form, KEYTRUDA QLEX (pembrolizumab with berahyaluronidase alfa, BLA 761467), was approved on 19 September 2025.", "verified", "qlex")

stage("Proposer: list the interactions the label names. Critic: compare them with the trial records.")
search("openfda", "KEYTRUDA warnings multiple myeloma HSCT corticosteroids", ["label"])
search("europepmc", "KEYNOTE-183 KEYNOTE-185 FDA halted", ["k183", "k185"], 2)
search("clinicaltrials", "NCT02576977 NCT02579863", ["ct183", "ct185"])
reply("proposer", "The label names one drug-combination danger (thalidomide analogues with dexamethasone in myeloma), one procedure (allogeneic stem cell transplant) and how steroids are used to manage side effects.")
claim("proposer", "Adding pembrolizumab to a thalidomide analogue plus dexamethasone increased mortality in two randomized multiple myeloma trials; the label advises against it outside controlled trials.", "verified", "label")
claim("scout", "On 3 July 2017 the FDA halted KEYNOTE-183 (with pomalidomide and dexamethasone) because the risks of the combination outweighed its benefits.", "verified", "k183")
claim("scout", "On 3 July 2017 the FDA halted KEYNOTE-185 (with lenalidomide and dexamethasone) because of an imbalance in deaths between the groups.", "verified", "k185")
claim("critic", "ClinicalTrials.gov gives the reason KEYNOTE-183 stopped as business reasons, and does not mention the FDA hold.", "verified", "ct183", "The registry's 'why stopped' field and the published report disagree. Both are shown.")
claim("critic", "ClinicalTrials.gov gives the reason KEYNOTE-185 stopped as business reasons, and does not mention the FDA hold.", "verified", "ct185")
claim("proposer", "Allogeneic stem cell transplant before or after a PD-1 blocking antibody can cause fatal complications, including hyperacute graft-versus-host disease.", "verified", "label")
claim("proposer", "Immune-mediated side effects are treated with systemic corticosteroids; pembrolizumab is stopped for good if the dose cannot be brought to 10 mg of prednisone a day or less within 12 weeks.", "verified", "label")
claim("proposer", "Pembrolizumab is approved with axitinib and with lenvatinib for first-line advanced renal cell carcinoma.", "verified", "label")
claim("proposer", "In mouse tumour models, a PD-1 blocking antibody with lenvatinib reduced tumour growth more than either alone.", "verified", "label")

stage("Scout: find trials now recruiting for new uses and combinations. Critic: check combination reports for retractions.")
search("clinicaltrials", "pembrolizumab phase 3 recruiting combination", ["t009", "t004", "t033", "t012", "t014"], 85)
search("europepmc", "pembrolizumab combination retraction", ["sbrt", "sbrtRepublished", "oral"], 5)
reply("scout", "Five Phase 3 trials now recruiting test pembrolizumab with new partners: intismeran autogene (V940), calderasib (MK-1084) and sacituzumab tirumotecan (MK-2870).")
claim("scout", "INTerpath-009 (NCT06623422) is a recruiting Phase 3 trial of pembrolizumab with or without intismeran autogene (V940) in non-small cell lung cancer, with 680 planned.", "verified", "t009")
claim("scout", "KANDLELIT-004 (NCT06345729) is a recruiting Phase 3 trial of calderasib plus pembrolizumab in KRAS G12C mutant NSCLC with PD-L1 TPS of 50% or more.", "verified", "t004")
claim("scout", "TroFuse-033 (NCT06952504) is a recruiting Phase 3 trial of sacituzumab tirumotecan plus pembrolizumab in mismatch repair proficient endometrial cancer.", "verified", "t033")
claim("scout", "MK-2870-012 (NCT06393374) is a recruiting Phase 3 trial of sacituzumab tirumotecan plus pembrolizumab in triple-negative breast cancer without a pathological complete response.", "verified", "t012")
claim("scout", "INTerpath-014 (NCT07513376) is a recruiting Phase 3 trial of adjuvant intismeran with or without subcutaneous pembrolizumab (MK-3475A) in high-risk stage I NSCLC.", "verified", "t014")
claim("proposer", "SBRT plus pembrolizumab and trametinib gave a median overall survival of 24.9 versus 22.4 months (HR 0.60) in locally recurrent pancreatic cancer.", "contradicted", "sbrtRepublished", "The 2021 report was retracted and republished in 2022. The republished report gives 14.9 versus 12.8 months (HR 0.69).")
claim("proposer", "Neoadjuvant pembrolizumab changes the tumour microenvironment of oral cancer.", "unsupported", "oral", "The only source was retracted in 2022: the authors could not publish the raw data.")
reply("critic", "The pancreatic cancer combination report was retracted and republished with shorter survival. The oral cancer report was retracted.")
claim("reporter", "Which of these trials will lead to a new approval is not known yet.", "unchecked", null, "A forecast: no record can check it yet.")

stage("Reporter: write the summary. Everyone: final positions.")
reply("reporter", "Eight stages are mapped from CHO-cell manufacturing to accelerated approval in 2014, full approval in 2015 and a subcutaneous form in 2025. The label names interactions with thalidomide analogues, transplant and steroids. Six articles carry a correction or retraction. Five recruiting Phase 3 trials test new combinations.")
reply("critic", "One statement was contradicted (the retracted pancreatic cancer numbers) and four had no usable source. The rest match their records.")
push({ type: "memo.written", path: "example-pembrolizumab/memo.md", decision: "Map complete: 8 stages, the interactions in the label, 6 articles with a correction or retraction, 5 possible trials" })
push({ type: "run.finished", usd: 0, minutes: 0 })

/** The example's run record, in the format of a finished board run. */
export const EXAMPLE_EVENTS: readonly BoardEvent[] = events
