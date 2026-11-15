# bulk-rnaseq-analyst

**Scope:** Public-dataset retrieval, FASTQ to counts, bulk RNA-seq differential expression, modules, consensus signatures, deconvolution and enrichment.

**Skills owned:** 7 (5 full instructions, 2 index only). Status: instructions only, packages not installed, not wired into any solver.

## Route to this agent when

- 'All available/comprehensive' public omics datasets for a disease (skill 59).
- FASTQ or SRR/GEO accession to a DE-ready count matrix; STAR or salmon; strandedness (skill 77).
- Gene modules and hub genes from >=15 samples of normalized data (skill 20).
- >=2 cohorts, effect-size meta-analysis of a disease signature (skill 21).
- Cell-type proportions from bulk with a single-cell reference (skill 22).
- Skills 7 (DESeq2 DE) and 34 (enrichment) are index only; skills 6 and 22 point to 7 for DE and skill 6 to 34 for enrichment. Chain stated in the text: 59, then 77, then DESeq2 DE, then enrichment.

## Do not route here when

- Skill 20 takes normalized data, not raw counts.
- Single-cell goes to the single-cell agents; clustering of a bulk matrix goes to omics-biomarker-integrator (skill 6).
- The work needs one of this agent's index-only skills to do anything beyond what its name says.

## Skills owned

### 7. bulk-rnaseq-counts-to-de-deseq2: index only

- Category (hub): Transcriptomics
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Pointer from other skills' text: Skills 6 and 22's text point to it for differential expression.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 20. coexpression-network: full instructions

- Category (hub): Transcriptomics
- Scope (its own text): WGCNA: weighted co-expression modules, hub genes, module-trait correlation from normalized expression data.
- Declared inputs: Normalized expression (VST/rlog/TPM/FPKM, not raw counts) + metadata
- Declared outputs: wgcna_network.rds, module and hub-gene tables, plots
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: WGCNA GPL-2+, commercial use listed as permitted

### 21. consensus-disease-signature: full instructions

- Category (hub): Transcriptomics
- Scope (its own text): Consensus transcriptional signature from >=2 bulk-transcriptome cohorts via random-effects effect-size meta-analysis (limma / limma-voom), with enrichment and literature validation.
- Declared inputs: One YAML config naming cohorts (GEO or user matrices), contrast and thresholds
- Declared outputs: meta_analysis_full.csv, consensus UP/DOWN gene lists, enrichment tables, figures, PDF
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: needs_commercial_review: KEGG removed (academic-only); MSigDB Hallmark mixed licensing; Reactome CC0

### 22. deconvolution-bulk-rnaseq: full instructions

- Category (hub): Transcriptomics
- Scope (its own text): Estimate cell-type proportions from bulk RNA-seq using a single-cell reference (BayesPrism, DWLS, optional MuSiC/Bisque) and test group differences.
- Declared inputs: Bulk matrix + annotated single-cell reference (.h5ad/.rds) + optional metadata
- Declared outputs: per-method and consensus proportions, concordance, group contrasts, figures
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: CIBERSORTx (non-commercial), EPIC (academic-only), BSeq-sc: excluded, run_deconvolution() errors if asked; the retained methods listed as permitted

### 34. functional-enrichment-from-degs: index only

- Category (hub): Functional analysis
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Pointer from other skills' text: Skill 6's text points to it for enrichment.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 59. omics-dataset-retrieval: full instructions

- Category (hub): Data discovery
- Scope (its own text): Retrieve, deduplicate, classify and relevance-audit public omics datasets for a disease/phenotype/gene across repositories (GEO, SRA, ArrayExpress/BioStudies, PRIDE, jPOST, OmicsDI, Metabolomics Workbench, CELLxGENE, GDC, ENCODE, Expression Atlas and others in tiers). Treats "all available/comprehensive" as a multi-repository request.
- Declared inputs: disease_or_topic, synonyms, omics_types, organism (default all), year_min, output_dir
- Declared outputs: `<disease>_omics_datasets_MASTER.csv`, `_VALIDATED.csv` (CORE+ADJACENT), `_omics_summary.md`, landscape PNG, optional PDF
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none raised; adds access-level column (open vs controlled-access repositories). This is silence in the Overview, not a clearance.

### 77. rnaseq-fastq-to-counts: full instructions

- Category (hub): Transcriptomics
- Scope (its own text): Bulk RNA-seq reads (FASTQ or public accession) to a DE-ready integer gene x sample count matrix with QC, strandedness auto-detection, gene metadata, DESeq2 load check, PDF. STAR or salmon paths.
- Declared inputs: Paired/single-end FASTQ or SRR/ERR/DRR/GSM/GSE accession + reference (default Ensembl GRCh38, confirm first)
- Declared outputs: counts_matrix.tsv, gene_metadata.csv, strandedness.json, assignment_summary.csv, star/ or salmon outputs, qc/, figures, report_<run>.pdf, README.md
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: "Ensembl, GENCODE and ENA are open - no access constraints for the default references"

## What this agent cannot do

- Use CIBERSORTx, EPIC or BSeq-sc in skill 22: its text excludes them and run_deconvolution() errors if asked.
- Use KEGG in skill 21 for commercial work: it was removed; MSigDB Hallmark has mixed licensing.
- Describe 7 or 34 beyond their names.
- Packages (scripts, references, assets) are not installed: nothing here can be executed. These are instructions only and nothing routes work to this agent yet. Many Overviews assume Biomni tools and paths (/mnt/results, GenerateImage, LiteratureSearch, pdf-report-generation, ManageMachine) whose availability in GLHF is not stated. Their text does not address the AGENTS.md rules (no answer sources, documentation-only search allow-list, no billed cloud runs), so any skill that searches literature, fetches public data or uses machines must be checked against them before use in a benchmark solver.
