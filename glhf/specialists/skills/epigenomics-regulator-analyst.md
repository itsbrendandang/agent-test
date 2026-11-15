# epigenomics-regulator-analyst

**Scope:** ChIP-Atlas transcription-factor target, enrichment and differential analysis, and upstream-regulator inference from DE results.

**Skills owned:** 4 (2 full instructions, 2 index only). Status: instructions only, packages not installed, not wired into any solver.

## Route to this agent when

- Target genes of a transcription factor from public ChIP-seq (skill 16).
- A bulk DE table to driving transcription factors, activators vs repressors (skill 98).
- Skills 14 (diff analysis) and 15 (peak enrichment) are index only; skill 16's text says to use chip-atlas-peak-enrichment to find which TFs bind near your genes.

## Do not route here when

- Skill 16 is not for histone marks, offline work or raw FASTQ/BAM.
- Skill 98 is bulk only, not single-cell, not histone marks.
- scATAC / Multiome goes to single-cell-multimodal-spatial-analyst (skill 79).
- The work needs one of this agent's index-only skills to do anything beyond what its name says.

## Skills owned

### 14. chip-atlas-diff-analysis: index only

- Category (hub): Epigenomics
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 15. chip-atlas-peak-enrichment: index only

- Category (hub): Epigenomics
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 16. chip-atlas-target-genes: full instructions

- Category (hub): Epigenomics
- Scope (its own text): Find target genes for a transcription factor from pre-computed public ChIP-Atlas ChIP-seq data, ranked by MACS2 binding score.
- Declared inputs: TF symbol (case-sensitive), genome (default hg38), distance from TSS 1/5/10 kb
- Declared outputs: analysis_object.pkl and result tables
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none stated. This is silence in the Overview, not a clearance.

### 98. upstream-regulator-analysis: full instructions

- Category (hub): Multi-omics
- Scope (its own text): Infer driving transcription factors by combining ChIP-Atlas binding with bulk DE results; ranks TFs by combined regulatory score (binding enrichment, target-DE overlap by Fisher's exact test, direction); separates activators from repressors. Bulk only; not single-cell, not histone marks.
- Declared inputs: DE table (gene symbol, log2FC, adjusted p; DESeq2/edgeR/limma column names auto-detected) + genome (hg38, hg19, mm10, mm9, rn6, dm6, dm3, ce11, ce10, sacCer3)
- Declared outputs: analysis_object.pkl, tables, plots; needs internet; 15-25 min
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none raised. This is silence in the Overview, not a clearance.

## What this agent cannot do

- Run skills 16 or 98 without internet: both fetch ChIP-Atlas data (98 states 15-25 minutes).
- Describe 14 or 15 beyond their names.
- Packages (scripts, references, assets) are not installed: nothing here can be executed. These are instructions only and nothing routes work to this agent yet. Many Overviews assume Biomni tools and paths (/mnt/results, GenerateImage, LiteratureSearch, pdf-report-generation, ManageMachine) whose availability in GLHF is not stated. Their text does not address the AGENTS.md rules (no answer sources, documentation-only search allow-list, no billed cloud runs), so any skill that searches literature, fetches public data or uses machines must be checked against them before use in a benchmark solver.
