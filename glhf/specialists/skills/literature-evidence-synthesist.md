# literature-evidence-synthesist

**Scope:** Citation-verified method comparisons, ClinicalTrials.gov landscapes, meta-analysis and (by name only) literature reviews.

**Skills owned:** 5 (3 full instructions, 2 index only). Status: instructions only, packages not installed, not wired into any solver.

## Route to this agent when

- A bounded map of registered ClinicalTrials.gov records for a declared query (skill 19).
- Pool effect estimates across studies, forest and funnel plots (skill 29).
- 'Compare X vs Y' / 'which method should I use': a citation-verified PDF (skill 52).
- Skills 45 and 46 are index only; skill 41's text names literature-review (46) for pure literature synthesis.

## Do not route here when

- Skill 19 is not for exhaustive asset or pipeline inventories.
- Skill 29 is not single-arm proportion, network, IPD or diagnostic-accuracy meta-analysis.
- Skill 52 does not run the compared methods on data.
- The work needs one of this agent's index-only skills to do anything beyond what its name says.

## Skills owned

### 19. clinicaltrials-landscape: full instructions

- Category (hub): Literature
- Scope (its own text): Map a bounded set of registered ClinicalTrials.gov records for a declared query, classified by study purpose and intervention type, with auditable coverage provenance.
- Declared inputs: Condition term(s) (+ optional intervention/status/phase/sponsor) or a compiled trials CSV
- Declared outputs: trials_all/by_category/by_sponsor/match_evidence CSVs, coverage_scope.json, figures, report facts, PDF
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none stated. This is silence in the Overview, not a clearance.

### 29. evidence-synthesis-meta-analysis: full instructions

- Category (hub): Data analysis
- Scope (its own text): Random-effects meta-analysis across studies (MD, SMD, OR, RR, HR; one measure per analysis) with PRISMA-style screening, heterogeneity, subgroups, robustness suite and PDF.
- Declared inputs: Extraction-table CSV, or a research question (literature-driven via LiteratureSearch)
- Declared outputs: extraction table, meta results, leave-one-out, influence, figures, PDF
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none stated. This is silence in the Overview, not a clearance.

### 45. literature-deep-review: index only

- Category (hub): Literature
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 46. literature-review: index only

- Category (hub): General
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 52. methods-landscape-review: full instructions

- Category (hub): Literature
- Scope (its own text): Search + synthesis + structured reporting that turns "which method should I use?" into a citation-verified PDF; it does not run the compared methods on data. Two modes: comparison (competing methods) and topic.
- Declared inputs: Free-text question, optional candidate methods, scope and retrieval filters
- Declared outputs: references.jsonl, corpus.csv, screening_log.csv, comparison_matrix.csv, benchmark_catalog, performance_claims, evidence_table.csv (topic mode), citation_verification.json, figures, report_<slug>.pdf
- Hub URL: https://biomni.phylo.bio/skills/skill_685b09d4f2d509ab9198bf01121d7c7d?section=marketplace
- package: not installed
- Licence / commercial-use flag: **Mandatory licensing policy**: exclude non-commercial [NC] resources (examples named: KEGG, DisGeNET, OMIM, DrugBank) with a one-line omission note; recommend ShareAlike [SA] resources (examples: ChEMBL, Human Protein Atlas, PharmGKB) only with a ShareAlike/attribution caveat. Policy lives in `references/biomni_resources_catalog.md` section 0 (file not in this repo)

## What this agent cannot do

- Be assumed safe for benchmark use: skills 19, 29 and 52 call LiteratureSearch or ClinicalTrials.gov, and their text does not address the AGENTS.md benchmark rules (no open web search; documentation allow-list only).
- Cite non-commercial resources in skill 52 reports: its mandatory policy excludes NC resources (KEGG, DisGeNET, OMIM, DrugBank named) with an omission note and requires a ShareAlike caveat for SA resources (ChEMBL, HPA, PharmGKB named).
- Describe 45 or 46 beyond their names.
- Packages (scripts, references, assets) are not installed: nothing here can be executed. These are instructions only and nothing routes work to this agent yet. Many Overviews assume Biomni tools and paths (/mnt/results, GenerateImage, LiteratureSearch, pdf-report-generation, ManageMachine) whose availability in GLHF is not stated. Their text does not address the AGENTS.md rules (no answer sources, documentation-only search allow-list, no billed cloud runs), so any skill that searches literature, fetches public data or uses machines must be checked against them before use in a benchmark solver.
