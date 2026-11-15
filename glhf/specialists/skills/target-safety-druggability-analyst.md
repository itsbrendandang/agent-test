# target-safety-druggability-analyst

**Scope:** Druggability, modality, tissue-expression specificity and safety signals for a chosen target or drug.

**Skills owned:** 4 (2 full instructions, 2 index only). Status: instructions only, packages not installed, not wired into any solver.

## Route to this agent when

- 'Is KRAS druggable? Which modality?' small molecule vs antibody vs degrader scorecard (skill 93).
- Adverse-event signals for a drug, class or target in FAERS via OpenFDA, labeled vs unlabeled triage (skill 62).
- Skills 58 and 95 are index only: by name only.

## Do not route here when

- Skill 62: FAERS is spontaneous reporting with no denominator, so output is not causal risk.
- Skill 93 is a 'search + compose' skill that draws on Open Targets tractability, DepMap essentiality, known drugs, safety liabilities, fpocket and LiteratureSearch.
- The work needs one of this agent's index-only skills to do anything beyond what its name says.

## Skills owned

### 58. off-target-safety-pharmacology: index only

- Category (hub): Drug discovery
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 62. pharmacovigilance-ae-signal-detection: full instructions

- Category (hub): Drug discovery
- Scope (its own text): Adverse-event signal detection in FAERS via OpenFDA: single drug, class-wide, target-anchored (via Open Targets), labeled vs unlabeled triage, disproportionality (ROR/PRR/chi-square/FDR). States FAERS is spontaneous reporting with no denominator, so not causal risk.
- Declared inputs: Drug name / class / target, optional active comparator, optional OpenFDA key
- Declared outputs: PDF, 5 figures, tables (disproportionality_full.csv, top signals, unlabeled-signals shortlist)
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none raised for the data; text says the SOC grouping is a curated fallback map, "not the licensed MedDRA hierarchy". This is silence in the Overview, not a clearance.

### 93. target-tractability-druggability: full instructions

- Category (hub): Drug discovery
- Scope (its own text): Druggability verdict and modality scorecard (0-3 per dimension) for a human protein-coding target from Open Targets tractability, DepMap essentiality, known drugs, safety liabilities, fpocket on the best PDB (AlphaFold fallback) and LiteratureSearch. "Search + compose" skill.
- Declared inputs: Gene symbol or Ensembl ID, optional disease context
- Declared outputs: report_<SYMBOL>_druggability.pdf, <SYMBOL>_druggability.json, scorecard (most_viable, frontier)
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none raised. This is silence in the Overview, not a clearance.

### 95. tissue-expression-specificity: index only

- Category (hub): Drug discovery
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

## What this agent cannot do

- State a risk or safety conclusion from FAERS disproportionality (skill 62's own caveat).
- Use the MedDRA hierarchy: skill 62's SOC grouping is a curated fallback map, not the licensed MedDRA hierarchy.
- Describe 58 or 95 beyond their names.
- Packages (scripts, references, assets) are not installed: nothing here can be executed. These are instructions only and nothing routes work to this agent yet. Many Overviews assume Biomni tools and paths (/mnt/results, GenerateImage, LiteratureSearch, pdf-report-generation, ManageMachine) whose availability in GLHF is not stated. Their text does not address the AGENTS.md rules (no answer sources, documentation-only search allow-list, no billed cloud runs), so any skill that searches literature, fetches public data or uses machines must be checked against them before use in a benchmark solver.
