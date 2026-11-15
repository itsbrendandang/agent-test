# statistical-geneticist

**Scope:** Two-sample Mendelian randomization and (by name only) fine-mapping, constraint gating, TWAS and polygenic risk scores.

**Skills owned:** 5 (1 full instructions, 4 index only). Status: instructions only, packages not installed, not wired into any solver.

## Route to this agent when

- GWAS summary statistics for an exposure and an outcome; 'test causal direction'; OpenGWAS IDs (skill 51).
- Skills 31, 36, 39, 68 are index only: by name only.

## Do not route here when

- Skill 51 is not suitable for one-sample MR, non-linear MR, or multivariable MR with >2 exposures.
- The work needs one of this agent's index-only skills to do anything beyond what its name says.

## Skills owned

### 31. fine-mapping-susie: index only

- Category (hub): Genomics
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 36. genetic-constraint-gating: index only

- Category (hub): Genomics
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 39. gwas-to-function-twas: index only

- Category (hub): Genomics
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 51. mendelian-randomization-twosamplemr: full instructions

- Category (hub): Genomics
- Scope (its own text): Two-sample Mendelian randomization to test causal direction between an exposure and an outcome trait with genetic instruments. Stated as not suitable for one-sample MR, non-linear MR, multivariable MR with >2 exposures.
- Declared inputs: OpenGWAS IDs (e.g. ieu-a-300, ieu-a-7) or exposure/outcome summary-stats files (SNP, beta, se, pval, effect_allele, other_allele, eaf optional)
- Declared outputs: mr_results.csv (4 methods; beta, SE, p, nSNP, F-stat) plus figures and report
- Hub URL: https://biomni.phylo.bio/skills/skill_6655c68c5e9249eba44e6519b7c0b11e?section=marketplace
- package: not installed
- Licence / commercial-use flag: none raised (software table all permitted; MR-PRESSO install optional). This is silence in the Overview, not a clearance.

### 68. polygenic-risk-score-prs-catalog: index only

- Category (hub): Genomics
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

## What this agent cannot do

- Describe fine-mapping, constraint gating, TWAS or PRS procedures: no text for 31, 36, 39, 68.
- Packages (scripts, references, assets) are not installed: nothing here can be executed. These are instructions only and nothing routes work to this agent yet. Many Overviews assume Biomni tools and paths (/mnt/results, GenerateImage, LiteratureSearch, pdf-report-generation, ManageMachine) whose availability in GLHF is not stated. Their text does not address the AGENTS.md rules (no answer sources, documentation-only search allow-list, no billed cloud runs), so any skill that searches literature, fetches public data or uses machines must be checked against them before use in a benchmark solver.
