# immune-cell-therapy-analyst

**Scope:** CAR construct design with CRISPR-screen reanalysis, TCR/BCR repertoire profiling, and (by name only) cell-therapy QC and flow cytometry.

**Skills owned:** 4 (2 full instructions, 2 index only). Status: instructions only, packages not installed, not wired into any solver.

## Route to this agent when

- 'Design a CD19 CAR construct', 'run MAGeCK on a T-cell CRISPR screen' (skill 11).
- TCR/BCR clonality, diversity, V/J usage, overlap from called clonotypes (skill 40).
- Skills 12 and 32 are index only: by name only.

## Do not route here when

- Skill 40 does no SHM lineages and no FASTQ assembly.
- The work needs one of this agent's index-only skills to do anything beyond what its name says.

## Skills owned

### 11. cell-therapy-car-design: full instructions

- Category (hub): Functional genomics
- Scope (its own text): Two linked capabilities: MAGeCK reanalysis of a pooled CRISPR screen in primary human T cells (validated against DepMap), and construction of second-generation CAR constructs from a validated scFv.
- Declared inputs: Antigen/validated scFv source; screen accession (worked example GSE119450)
- Declared outputs: sgRNA library, MAGeCK tables, DepMap cross-check, protein/ORF FASTA, GenBank files, PDF
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none stated; text describes a read-driven library reconstruction for paywalled guide tables (see note 3.9). This is silence in the Overview, not a clearance.

### 12. cell-therapy-qc-scorecard: index only

- Category (hub): Transcriptomics
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 32. flow-cytometry-analysis: index only

- Category (hub): Proteomics
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 40. immune-repertoire-airr: full instructions

- Category (hub): Transcriptomics
- Scope (its own text): Descriptive TCR/BCR repertoire profiling with immunarch: clonality, diversity, V/J usage and overlap, optional group comparisons, PDF.
- Declared inputs: Clonotype files in any repLoad-detected format (Cell Ranger, immunoSEQ, MiXCR, AIRR) + optional metadata.txt
- Declared outputs: tables (diversity, clonality, gene usage, overlap), PDF
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none stated. This is silence in the Overview, not a clearance.

## What this agent cannot do

- Adopt skill 11's 'read-driven library reconstruction' (its own text calls it the paywall-circumventing technique) without review: the text does not discuss terms of use or the repo's data-source rules.
- Describe 12 or 32 beyond their names.
- Packages (scripts, references, assets) are not installed: nothing here can be executed. These are instructions only and nothing routes work to this agent yet. Many Overviews assume Biomni tools and paths (/mnt/results, GenerateImage, LiteratureSearch, pdf-report-generation, ManageMachine) whose availability in GLHF is not stated. Their text does not address the AGENTS.md rules (no answer sources, documentation-only search allow-list, no billed cloud runs), so any skill that searches literature, fetches public data or uses machines must be checked against them before use in a benchmark solver.
