# variant-and-genome-analyst

**Scope:** Variant annotation and evidence, cancer-cohort genomics, rare-disease cases, variant calling and long-read analysis.

**Skills owned:** 7 (2 full instructions, 5 index only). Status: instructions only, packages not installed, not wired into any solver.

## Route to this agent when

- One HGNC gene symbol to a ClinVar + CIViC allele table tiered by actionability (skill 18).
- An aligned, sorted, indexed ONT/PacBio BAM for dual-caller (Sniffles2 + cuteSV or user VCF) SV comparison (skill 48).
- Skills 8, 37, 47, 74, 99 are index only: by name only.

## Do not route here when

- Skill 18 does no variant calling, no patient-genotype interpretation, is not a replacement for AMP/ASCO/CAP or ACMG guidance, and is human only.
- Skill 48 starts after alignment and read QC; caller agreement is descriptive, not accuracy or clinical interpretation.
- The work needs one of this agent's index-only skills to do anything beyond what its name says.

## Skills owned

### 8. cancer-cohort-genomics: index only

- Category (hub): Genomics
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 18. clinical-variant-allelic-series: full instructions

- Category (hub): Genomics
- Scope (its own text): For one human gene, integrate every ClinVar record and CIViC curated evidence into a position-resolved allele table with actionability tier and mechanism, figures and PDF.
- Declared inputs: One HGNC gene symbol (optional NCBI email/key, UniProt override)
- Declared outputs: ClinVar and CIViC CSV/JSON, allelic_series_master.csv, 4 figures, PDF
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none stated. This is silence in the Overview, not a clearance.

### 37. genetic-variant-annotation: index only

- Category (hub): Genomics
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 47. long-read-assembly: index only

- Category (hub): Genomics
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 48. long-read-structural-variants: full instructions

- Category (hub): Genomics
- Scope (its own text): Dual-caller (Sniffles2 plus cuteSV or a user VCF) descriptive SV analysis from an already aligned, sorted, indexed ONT or PacBio BAM; caller agreement is descriptive, not accuracy or clinical interpretation.
- Declared inputs: BAM+index, reference FASTA+fai, upstream run.json and identity_check.json
- Declared outputs: normalized VCFs, counts, concordance, provenance, dependency_licenses.json, PDF
- Hub URL: https://biomni.phylo.bio/skills/skill_3c74126c13f23c21c90c86e80818ba16?section=marketplace
- package: not installed
- Licence / commercial-use flag: Workflow step audits commercial-use licence evidence of Python/runtime dependencies (output dependency_licenses.json)

### 74. rare-disease-case-prioritization: index only

- Category (hub): Genomics
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 99. variant-calling-from-sequencing: index only

- Category (hub): Genomics
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

## What this agent cannot do

- Interpret clinical variants for a patient (skill 18's own exclusion).
- Align reads or run read QC for skill 48.
- Describe 8, 37, 47, 74 or 99 beyond their names.
- Packages (scripts, references, assets) are not installed: nothing here can be executed. These are instructions only and nothing routes work to this agent yet. Many Overviews assume Biomni tools and paths (/mnt/results, GenerateImage, LiteratureSearch, pdf-report-generation, ManageMachine) whose availability in GLHF is not stated. Their text does not address the AGENTS.md rules (no answer sources, documentation-only search allow-list, no billed cloud runs), so any skill that searches literature, fetches public data or uses machines must be checked against them before use in a benchmark solver.
