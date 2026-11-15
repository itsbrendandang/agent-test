# target-prioritiser

**Scope:** Nominate and rank disease targets, surface antigens, indications and repurposing hypotheses.

**Skills owned:** 6 (4 full instructions, 2 index only). Status: instructions only, packages not installed, not wired into any solver.

## Route to this agent when

- Antibody-accessible cell-surface antigens for ADC, CAR-T, bispecific, radioligand in a tumor type (skill 10).
- 'What to drug', 'which genes drive <disease>', knowledge-graph target ranking (skill 41).
- Disease EFO/MONDO ID to target ranking via Open Targets (skill 60).
- Disease vs control scRNA-seq to ranked targets with human genetic evidence (skill 80; needs an annotated .h5ad).
- Skills 23 and 26 are index only: by name only.

## Do not route here when

- Skill 10 hands small-molecule/degrader and general genetic-evidence target work to scrna-disease-drug-discovery (80, here) or genetic-target-hypothesis (not in the catalog). Skill 41 hands target-disease association lookup to open-targets (60, here).
- Skill 60 is not for causal inference, clinical recommendation, participant-level analysis or raw GWAS summary-statistic retrieval.
- Skill 80 is not annotation only, genetic-only, GRN or spatial work.
- The work needs one of this agent's index-only skills to do anything beyond what its name says.

## Skills owned

### 10. cell-surface-antigen-discovery: full instructions

- Category (hub): Drug discovery
- Scope (its own text): Nominate antibody-accessible cell-surface antigens for ADC, CAR-T, bispecific and radioligand development, ranked by tumor-surface specificity and normal-tissue therapeutic index (essentiality is annotation only).
- Declared inputs: Verified disease label(s) (CELLxGENE Census default), bundled surfaceome seed, known-target validation list
- Declared outputs: ranked_surface_targets.csv, compartment expression, topology and annotation tables, PDF
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: CC BY-SA share-alike: Human Protein Atlas (CC BY-SA) and ChEMBL via Open Targets (CC BY-SA 3.0); others CC BY 4.0; text points to DATA_SOURCES.md

### 23. direction-of-effect-concordance: index only

- Category (hub): Drug discovery
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 26. drug-repurposing-indication-expansion: index only

- Category (hub): Drug discovery
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 41. knowledge-graph-target-reasoning: full instructions

- Category (hub): Drug discovery
- Scope (its own text): Rank targets for a disease by Random-Walk-with-Restart over PrimeKG (optional TxGNN layer), with multi-hop evidence paths, known-target validation and literature support.
- Declared inputs: PrimeKG CSV, disease name resolved to PrimeKG node id(s), optional TxGNN pickles / Open Targets
- Declared outputs: ranked_targets.csv, meta.json, figures, PDF
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: Explicit: --edge-license commercial (default) vs academic. Academic mode (DrugBank, TxGNN, DisGeNET-derived seeds) = needs_commercial_review. PrimeKG dataset CC BY 4.0; Open Targets CC0; GO/MONDO CC BY 4.0

### 60. open-targets: full instructions

- Category (hub): Drug discovery
- Scope (its own text): Prioritize targets for a disease through the Open Targets GraphQL API: association scores, evidence rows, GWAS study metadata, credible sets. Not for causal inference, clinical recommendation, participant-level analysis or raw GWAS summary-stat retrieval. API queries only, bounded samples, immutable operation ledger.
- Declared inputs: EFO/MONDO disease ID, optional GWAS Catalog study ID, optional top-N (default 10)
- Declared outputs: target_ranking.csv, evidence_rows.csv, operation_ledger.json, provenance.json, report_facts.json, report_content.json, report_structure.json, root_bundle.json, report_open-targets.pdf
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: Open Targets data under **CC0 1.0**, API free without authentication; Ensembl/UniProt/ChEMBL identifiers integrated via the API (see DATA_SOURCES.md, not in repo)

### 80. scrna-disease-drug-discovery: full instructions

- Category (hub): Transcriptomics
- Scope (its own text): Prioritize drug targets from disease-vs-control scRNA-seq by combining DE, pathway enrichment and ligand-receptor evidence with human genetic evidence (Open Targets GWAS/ClinVar, GeneBass, TWAS, eQTL), cell-type resolved. Not annotation only, genetic-only, GRN or spatial work.
- Declared inputs: Annotated .h5ad with cell type, condition and donor labels (chains from scrnaseq-scanpy-core-analysis)
- Declared outputs: ranked_targets.csv, target_evidence_cards.json, 7+ PNG/SVG plots, per-cell-type DE CSVs, GSEA, L-R, analysis_manifest.json
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none raised beyond routine software table (demo: GSE195452 SSc). This is silence in the Overview, not a clearance.

## What this agent cannot do

- Treat Open Targets association scores as causal proof: skill 60's text calls them prioritization metrics.
- Run skill 41 in academic edge-license mode for commercial work (flagged needs_commercial_review).
- Say what 23 or 26 do beyond their names.
- Packages (scripts, references, assets) are not installed: nothing here can be executed. These are instructions only and nothing routes work to this agent yet. Many Overviews assume Biomni tools and paths (/mnt/results, GenerateImage, LiteratureSearch, pdf-report-generation, ManageMachine) whose availability in GLHF is not stated. Their text does not address the AGENTS.md rules (no answer sources, documentation-only search allow-list, no billed cloud runs), so any skill that searches literature, fetches public data or uses machines must be checked against them before use in a benchmark solver.
