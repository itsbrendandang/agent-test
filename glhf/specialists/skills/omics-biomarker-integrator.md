# omics-biomarker-integrator

**Scope:** Bulk clustering, longitudinal omics, proteomics, microbiome, multi-omics integration and signature-response tests.

**Skills owned:** 7 (6 full instructions, 1 index only). Status: instructions only, packages not installed, not wired into any solver.

## Route to this agent when

- Cluster samples or features of a bulk matrix (skill 6).
- Longitudinal patient omics, pseudotime, fast vs slow progressors (skill 24).
- Two-group 16S comparison (skill 53).
- MOFA+ across 2+ omics layers (skill 57).
- TMT/LFQ proteomics differential expression (skill 72).
- Whether residual signature activity on treatment marks non-responders (skill 85).
- Skill 28 (elastic-net biomarker panel) is index only.

## Do not route here when

- Skill 24 needs >=10 patients with >=3 timepoints each.
- Skill 53 is not raw-read processing, shotgun or >2-group designs. Skill 57 is not single-omics, supervised prediction, or <10 samples per view. Skill 72 is not RNA-seq, metabolomics or pre-computed fold changes. Skill 85 is bulk longitudinal data only.
- Single-cell clustering goes to scrnaseq skills (skill 6's text).
- The work needs one of this agent's index-only skills to do anything beyond what its name says.

## Skills owned

### 6. bulk-omics-clustering: full instructions

- Category (hub): Multi-omics
- Scope (its own text): Clustering of samples or features in a bulk quantitative matrix with multiple algorithms, validation, comparison and interpretation (Python or R).
- Declared inputs: Matrix (CSV/TSV/xlsx/h5/RDS), samples x features or reverse
- Declared outputs: cluster assignments, validation metrics, plots, exported results
- Hub URL: https://biomni.phylo.bio/skills/skill_51a601b71a454a00aa0d378fe8e3205c?section=marketplace
- package: not installed
- Licence / commercial-use flag: Packages listed as permissive / commercial use permitted (BSD-3, MIT, GPL/MIT)

### 24. disease-progression-longitudinal: full instructions

- Category (hub): Multi-omics
- Scope (its own text): Reconstruct disease progression trajectories from longitudinal omics (TimeAx alignment), order samples by pseudotime, find trajectory features, stratify progressors.
- Declared inputs: Omics matrix + sample_id/patient_id/timepoint (>=10 patients, >=3 timepoints each)
- Declared outputs: pseudotime_assignments.csv, trajectory_features.csv, plots
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: listed packages permissive (MIT, BSD, Apache 2.0)

### 28. elastic-net-biomarker-panel: index only

- Category (hub): Multi-omics
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 53. microbiome-analysis: full instructions

- Category (hub): Functional analysis
- Scope (its own text): Two-group 16S comparison: diversity, 3-method differential-abundance consensus, PICRUSt2 predicted function, curated metabolite-module inference, PDF report. Not raw-read processing, shotgun, >2-group designs. Metabolite modules are "predicted genomic potential, never measured".
- Declared inputs: Processed feature table, rep-seqs FASTA, taxonomy, metadata with a 2-level group column, optional Newick tree
- Declared outputs: CSV tables, PNG/SVG figures, optional PDF
- Hub URL: https://biomni.phylo.bio/skills/skill_fd517e4fafbb82ec7030a849e0ea0c23?section=marketplace
- package: not installed
- Licence / commercial-use flag: **KEGG removed** (not licensed for commercial use). EC numbers (PICRUSt2 default) are the licence-clean feature space; KO output only for academic users covered by KEGG terms, off by default. Details in `references/DATA_SOURCES.md` (not in repo); MetaCyc/eggNOG notes also live there

### 57. multi-omics-integration: full instructions

- Category (hub): Multi-omics
- Scope (its own text): MOFA+ latent-factor analysis across 2+ omics layers on overlapping samples; handles missing views. Not for single omics, supervised prediction, or <10 samples per view.
- Declared inputs: Two or more omics matrices + metadata (CLL example data available)
- Declared outputs: factors, variance explained, plots
- Hub URL: https://biomni.phylo.bio/skills/skill_b022f7a4010244ac8956c13d9dd60967?section=marketplace
- package: not installed
- Licence / commercial-use flag: none raised. This is silence in the Overview, not a clearance.

### 72. proteomics-diff-exp: full instructions

- Category (hub): Proteomics
- Scope (its own text): Differential protein expression for TMT/LFQ mass spectrometry using limma with DEqMS PSM-count-aware variance correction. Not for RNA-seq, metabolomics, or pre-computed fold changes.
- Declared inputs: Protein intensity matrix (+ PSM-level table recommended), metadata, >=2 replicates per condition (>=3 recommended)
- Declared outputs: all_results.csv, significant_results.csv, plots
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none raised (example: A431 TMT 10-plex). This is silence in the Overview, not a clearance.

### 85. signature-response-enrichment: full instructions

- Category (hub): Transcriptomics
- Scope (its own text): Tests whether residual gene-signature activity (GSVA) on treatment marks non-responders to a drug; generalized from a psoriasis/TYK2/adalimumab replication. Bulk longitudinal data only.
- Declared inputs: drug, gene_signatures (lists, GMT or MSigDB IDs), optional response_threshold (default 0.75) with 0.90 sensitivity
- Declared outputs: outputs not read in detail
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none raised. **Validation status disclosed in text**: helper scripts only parse/help-checked, not run end-to-end on real data as one pipeline. GSVA pinned 1.50.5; text reports the pivotal p-value moved from ~0.04 to ~0.095 under GSVA 2.0.0. This is silence in the Overview, not a clearance.

## What this agent cannot do

- Present skill 53's metabolite modules as measured: its text says predicted genomic potential only.
- Output KO features from skill 53 for non-academic work: KEGG removed; EC numbers are the licence-clean default.
- Treat skill 85 as validated: its own text says its helper scripts were not run end-to-end on real data, and its pivotal p-value moved from ~0.04 to ~0.095 under GSVA 2.0.0.
- Describe 28 beyond its name.
- Packages (scripts, references, assets) are not installed: nothing here can be executed. These are instructions only and nothing routes work to this agent yet. Many Overviews assume Biomni tools and paths (/mnt/results, GenerateImage, LiteratureSearch, pdf-report-generation, ManageMachine) whose availability in GLHF is not stated. Their text does not address the AGENTS.md rules (no answer sources, documentation-only search allow-list, no billed cloud runs), so any skill that searches literature, fetches public data or uses machines must be checked against them before use in a benchmark solver.
