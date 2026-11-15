# single-cell-core-analyst

**Scope:** Core scRNA-seq processing (Scanpy or Seurat), trajectories and velocity, and CELLxGENE Census queries.

**Skills owned:** 4 (4 full instructions, 0 index only). Status: instructions only, packages not installed, not wired into any solver.

## Route to this agent when

- 10x/CellRanger/H5/count matrices to a processed object: Python (skill 82) or R/Seurat v5 (skill 83), by language.
- Pseudotime, branching, scVelo, CellRank on preprocessed data (skill 81; needs PCA, UMAP, clusters, from 82).
- A gene panel across cell types and tissues from CZ CELLxGENE Census, with donor-level pseudobulk DESeq2 (skill 87).

## Do not route here when

- Skill 81 is not for unprocessed data, bulk, terminally differentiated cells, or <200 cells.
- Skill 87 delegates enrichment, target prioritization, preprocessing and dataset finding to sibling skills.
- Disease-vs-control target ranking goes to target-prioritiser (skill 80).

## Skills owned

### 81. scrna-trajectory-inference: full instructions

- Category (hub): Transcriptomics
- Scope (its own text): Pseudotime, branching, driver genes, RNA velocity (scVelo) and CellRank fate probabilities on preprocessed scRNA-seq. Not for unprocessed data, bulk, terminally differentiated cells, or <200 cells.
- Declared inputs: Preprocessed .h5ad with PCA, UMAP, cluster labels (>=200 cells, >=100 genes); optional spliced/unspliced layers
- Declared outputs: adata_trajectory.h5ad, trajectory_genes.csv, plots
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none raised. This is silence in the Overview, not a clearance.

### 82. scrnaseq-scanpy-core-analysis: full instructions

- Category (hub): Transcriptomics
- Scope (its own text): Complete Scanpy workflow: QC, normalization, batch integration (scVI/scANVI/Harmony), clustering, cell-type annotation, pseudobulk DE for multi-sample data.
- Declared inputs: CellRanger output, H5, .h5ad or count matrices
- Declared outputs: adata_processed.h5ad and figures
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: text states all packages use permissive licences permitting commercial use

### 83. scrnaseq-seurat-core-analysis: full instructions

- Category (hub): Transcriptomics
- Scope (its own text): Complete Seurat v5 workflow in R: adaptive QC, doublets, Harmony/CCA/RPCA integration, graph clustering, annotation, pseudobulk DE.
- Declared inputs: CellRanger output, H5 or matrices
- Declared outputs: seurat_processed.rds and figures
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none raised. This is silence in the Overview, not a clearance.

### 87. single-cell-census-query: full instructions

- Category (hub): Transcriptomics
- Scope (its own text): Query CZ CELLxGENE Census for a gene panel across cell types in chosen tissues, then donor-level pseudobulk DESeq2 case vs control; PDF. Delegates enrichment, target prioritization, preprocessing, dataset finding to sibling skills.
- Declared inputs: GENE_PANEL, TISSUES, CASE_LABEL, CONTROL_LABEL, ORGANISM, CENSUS_VERSION, MIN_CELLS_PER_SAMPLE (10), MIN_DONORS_PER_GROUP (3), DONOR_BATCH (8), COVARIATES
- Declared outputs: `<panel>_expression_by_celltype.csv`, pseudobulk DE tables, PDF
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none raised. This is silence in the Overview, not a clearance.

## What this agent cannot do

- Run 81 on data that is not a preprocessed .h5ad with PCA, UMAP and cluster labels (>=200 cells, >=100 genes).
- Set up the multimodal or spatial analyses: those belong to single-cell-multimodal-spatial-analyst.
- Packages (scripts, references, assets) are not installed: nothing here can be executed. These are instructions only and nothing routes work to this agent yet. Many Overviews assume Biomni tools and paths (/mnt/results, GenerateImage, LiteratureSearch, pdf-report-generation, ManageMachine) whose availability in GLHF is not stated. Their text does not address the AGENTS.md rules (no answer sources, documentation-only search allow-list, no billed cloud runs), so any skill that searches literature, fetches public data or uses machines must be checked against them before use in a benchmark solver.
