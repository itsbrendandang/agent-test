# single-cell-multimodal-spatial-analyst

**Scope:** scATAC / 10x Multiome, CITE-seq integration, and the spatial, regulatory-network and velocity-extension skills that are index only.

**Skills owned:** 6 (2 full instructions, 4 index only). Status: instructions only, packages not installed, not wired into any solver.

## Route to this agent when

- scATAC/snATAC and 10x Multiome, including paired RNA+ATAC after a pairing/genome-identity gate (skill 79).
- Paired CITE-seq integration: Seurat WNN, totalVI, dsb/CLR (skill 88).
- Skills 9 (cell-cell communication), 38 (pySCENIC GRN), 76 (RegVelo), 90 (spatial transcriptomics) are index only: by name only. Their placement here follows names and category, not text.

## Do not route here when

- Skill 79's text: paired RNA+ATAC stays in 79; unpaired RNA+ATAC and CITE-seq go to single-cell-multimodal-integration (88).
- Skill 88 supports paired CITE-seq only; unpaired/diagonal and mosaic RNA+ATAC are detected only to hard-stop as unsupported.
- The work needs one of this agent's index-only skills to do anything beyond what its name says.

## Skills owned

### 9. cell-cell-communication: index only

- Category (hub): Transcriptomics
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 38. grn-pyscenic: index only

- Category (hub): Transcriptomics
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 76. regvelo: index only

- Category (hub): Transcriptomics
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 79. scatac-multiome-analysis: full instructions

- Category (hub): Epigenomics
- Scope (its own text): scATAC/snATAC and 10x Multiome: fragments-first QC, TF-IDF/LSI, MACS3 per-cluster peaks, gene activity, annotation, differential accessibility; paired RNA+ATAC joint analysis (Seurat WNN, .h5mu, scIB-style metrics, optional MultiVI) only after a pairing/genome-identity gate passes. Unpaired RNA+ATAC and CITE-seq are routed to single-cell-multimodal-integration.
- Declared inputs: filtered_feature_bc_matrix.h5 (Gene Expression + Peaks), atac_fragments.tsv.gz + .tbi, metadata.csv, independent genome-identity value
- Declared outputs: integrated outputs, PDF (full list not read)
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: **CellMarker 2.0: licence "Ambiguous"** (paper CC-BY-NC-4.0, some mirrors CC0, site shows university copyright); commercial use "not_checked"; included=false, optional only, built-in PBMC marker panel as fallback. 10x PBMC 10k Multiome dataset: 10x dataset terms (research use; "no_prohibition_found"). Software (Signac, Seurat, MACS3, scanpy etc.) permissive or GPL

### 88. single-cell-multimodal-integration: full instructions

- Category (hub): Integration
- Scope (its own text): Paired CITE-seq integration (Seurat WNN, totalVI, dsb/CLR); unpaired/diagonal and mosaic RNA+ATAC are detected only to hard-stop as unsupported; paired RNA+ATAC is routed to scatac-multiome-analysis.
- Declared inputs: CITE-seq filtered h5 (Gene Expression + Antibody Capture), optional raw h5 for dsb, metadata.csv, config naming isotype controls
- Declared outputs: report_single_cell_multimodal_integration.pdf and other outputs
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: **CellMarker 2.0 ambiguous licence** (same wording as 79; optional only). scglue and StabMap listed "for method context only; included false"

### 90. spatial-transcriptomics: index only

- Category (hub): Transcriptomics
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

## What this agent cannot do

- Use CellMarker 2.0 in 79 or 88 beyond optional use: licence ambiguous, included=false.
- Do unpaired RNA+ATAC integration (88 hard-stops).
- Describe 9, 38, 76 or 90 beyond their names.
- Packages (scripts, references, assets) are not installed: nothing here can be executed. These are instructions only and nothing routes work to this agent yet. Many Overviews assume Biomni tools and paths (/mnt/results, GenerateImage, LiteratureSearch, pdf-report-generation, ManageMachine) whose availability in GLHF is not stated. Their text does not address the AGENTS.md rules (no answer sources, documentation-only search allow-list, no billed cloud runs), so any skill that searches literature, fetches public data or uses machines must be checked against them before use in a benchmark solver.
