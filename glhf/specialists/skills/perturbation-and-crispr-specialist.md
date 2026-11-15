# perturbation-and-crispr-specialist

**Scope:** Guide and primer design, pooled CRISPR / Perturb-seq analysis, perturbation-response prediction, and compound-perturbation signatures.

**Skills owned:** 6 (4 full instructions, 2 index only). Status: instructions only, packages not installed, not wired into any solver.

## Route to this agent when

- 'sgRNA to knock out TP53', CRISPRa/CRISPRi guides, SpCas9/SaCas9/Cas12a (skill 84).
- Perturb-seq, CROP-seq, 10x feature barcoding (skill 69).
- Predict or benchmark perturbation responses with scGPT/GEARS (skill 100).
- DRUG-seq / plate-based compound screens: counts.tsv plus platemap.csv (skill 27).
- Skills 61 (PCR primers) and 86 (signature reversal, LINCS) are index only.

## Do not route here when

- Skill 69 is not for arrayed screens, non-transcriptional readouts, or data without sgRNA assignments.
- Skill 100 is not wet-lab design and not hit calling (hit calling goes to 69).
- MAGeCK reanalysis of a T-cell CRISPR screen and CAR design are owned by immune-cell-therapy-analyst (skill 11).
- The work needs one of this agent's index-only skills to do anything beyond what its name says.

## Skills owned

### 27. drug-seq-analysis: full instructions

- Category (hub): Transcriptomics
- Scope (its own text): DRUG-seq / plate-based bulk RNA-seq compound screens: per-well QC, compound/dose DE against matched vehicle, perturbational signatures with MoA clustering, dose-response/tPOD, pathway/TF activity.
- Declared inputs: counts.tsv (genes x wells) + platemap.csv (optional barcoded FASTQ)
- Declared outputs: de_all_contrasts, QC, null-contrast gate, activity, dose-response, MoA tables, PDF
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: LINCS L1000/CMap: clue.io terms, commercial use "no_prohibition_found", verify before commercial use; MSigDB "not_checked"

### 61. pcr-primer-design: index only

- Category (hub): Molecular design
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 69. pooled-crispr-screens: full instructions

- Category (hub): Transcriptomics
- Scope (its own text): Pooled CRISPR screens with scRNA-seq readout (Perturb-seq, CROP-seq, CRISPRi/a): tiered fast screening, target validation, rigorous DE. Not arrayed screens, non-transcriptional readouts, or data without sgRNA assignments.
- Declared inputs: 10x feature-barcode .h5 per library + sgRNA-to-cell mapping files
- Declared outputs: screening_summary.txt, validation_results.csv and further DE outputs
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none raised (example data: Papalexi 2021). This is silence in the Overview, not a clearance.

### 84. sgrna-design: full instructions

- Category (hub): Molecular design
- Scope (its own text): Three-tier sgRNA search: validated sequences first (bundled Addgene table, then required literature search), then CRISPick precomputed designs, descending only when the tier yields nothing.
- Declared inputs: Gene symbol, organism (default human), application (knockout/CRISPRa/CRISPRi), Cas enzyme (default SpCas9)
- Declared outputs: `<GENE>_selected_sgRNAs.csv`, `<GENE>_sgRNA_summary.md`, PDF report
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: **Two `needs_commercial_review` flags.** (1) CRISPick and Broad GPP Web Portal are research-purposes-only; GPP Terms of Service (effective 2025-12-08) say commercial use is not permitted and may need a separate Broad licence (partnering@broadinstitute.org). (2) Addgene plasmids need a Material Transfer Agreement (UBMTA academic/non-commercial; Industry MTA commercial); the bundled CSV holds public sequence metadata only (321 validated sgRNAs, 197 genes)

### 86. signature-reversal-lincs: index only

- Category (hub): Drug discovery
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 100. virtual-cell-perturbation: full instructions

- Category (hub): Transcriptomics
- Scope (its own text): Benchmark predicted vs measured responses to genetic perturbations on held-out perturbations with scGPT, GEARS and a control-mean baseline, on GEARS datasets (norman, adamson, dixit, replogle_k562_essential, replogle_rpe1_essential) or user AnnData. Not wet-lab design, not hit calling.
- Declared inputs: GEARS dataset name or .h5ad, model list (scgpt, gears, baseline), weights mode, split seed (default 42)
- Declared outputs: report_<dataset>_perturbation_benchmark.pdf, figures F1..F6
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: **Open data only**: defaults to open datasets and train-from-base scGPT_human (MIT) weights; flags unknown/restricted dataset licences before running; "ship any non-commercial data or weights" is listed as something the skill does not do. Needs GPU machine for scGPT/GEARS; baseline path is CPU-feasible

## What this agent cannot do

- Use skill 84's CRISPick / Broad GPP outputs commercially: research purposes only, commercial use not permitted without a Broad licence; Addgene plasmids need an MTA.
- Use skill 100 on restricted-licence datasets or non-commercial weights: its text says it ships none and flags unknown licences first; scGPT/GEARS need a GPU machine.
- Use LINCS L1000/CMap commercially without checking clue.io terms (skill 27's flag).
- Describe 61 or 86 beyond their names.
- Packages (scripts, references, assets) are not installed: nothing here can be executed. These are instructions only and nothing routes work to this agent yet. Many Overviews assume Biomni tools and paths (/mnt/results, GenerateImage, LiteratureSearch, pdf-report-generation, ManageMachine) whose availability in GLHF is not stated. Their text does not address the AGENTS.md rules (no answer sources, documentation-only search allow-list, no billed cloud runs), so any skill that searches literature, fetches public data or uses machines must be checked against them before use in a benchmark solver.
