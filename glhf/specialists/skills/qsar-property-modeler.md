# qsar-property-modeler

**Scope:** Supervised single-endpoint small-molecule ADME and affinity models built from labelled tables, plus structure-based property estimates.

**Skills owned:** 4 (2 full instructions, 2 index only). Status: instructions only, packages not installed, not wired into any solver.

## Route to this agent when

- A labelled in-vitro ADME assay table for one endpoint (skill 1).
- A target name to turn into a ChEMBL bioactivity dataset, affinity model and novel-scaffold candidate list (skill 4).
- Skills 25 and 55 are index only: route to them by name only. Skill 49's text points to molecular-property-admet (55) for structure-based ADMET prediction.

## Do not route here when

- Skill 1 says not for: unlabelled pretrained ADMET prediction, atom-level metabolism or metabolite identification, biologics, in-vivo PK time series, population PK.
- Skill 4 says not for: biologics/peptides/macrocycles as the modelling set, classification, docking, ADMET, de novo generation, multi-target selectivity.
- The work needs one of this agent's index-only skills to do anything beyond what its name says.

## Skills owned

### 1. adme-ml-modeling: full instructions

- Category (hub): Drug discovery
- Scope (its own text): Build, evaluate, save and apply supervised single-endpoint small-molecule in-vitro ADME models from a labelled assay table (one endpoint and one assay signature per run; nested inner selection, locked outer assessment, censor-aware fitting, conformal intervals, applicability-domain flags).
- Declared inputs: Labelled table (CSV/TSV/SDF/SMI, SMILES + endpoint column, optional date/assay-context/unit/qualifier/series columns)
- Declared outputs: audit, model bundle, evaluation, predictions + manifest, PDF
- Hub URL: https://biomni.phylo.bio/skills/skill_9fd3e0632ea54e148757bb2469292ab8?section=marketplace
- package: not installed
- Licence / commercial-use flag: Demo data Lipophilicity_AstraZeneca is CC BY 4.0 (attribution)

### 4. binding-affinity-ml-model: full instructions

- Category (hub): Molecular design
- Scope (its own text): Single-endpoint small-molecule affinity regression: pull ChEMBL bioactivity for a target, curate a dataset, benchmark models under scaffold-split CV, screen an external library for novel-scaffold candidates with applicability-domain tiers.
- Declared inputs: Target symbol or ChEMBL target IDs, optional config JSON and external SMILES library
- Declared outputs: curated dataset, CV metrics, scored candidates, AD tiers, figures, PDF
- Hub URL: https://biomni.phylo.bio/skills/skill_5b530f17e1aaedd0139286faf1950c3c?section=marketplace
- package: not installed
- Licence / commercial-use flag: ChEMBL CC BY-SA 3.0: attribution (cite release) and share-alike on derived datasets; commercial use permitted

### 25. drug-bioactivity-chembl: index only

- Category (hub): Drug discovery
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 55. molecular-property-admet: index only

- Category (hub): Drug discovery
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Pointer from other skills' text: Skill 49's text points to it to 'estimate structure-based molecular and ADMET properties'.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

## What this agent cannot do

- Model more than one endpoint or assay signature per run (skill 1).
- Train or benchmark anything on an index-only skill (25, 55): nothing about their method, inputs or outputs was shown.
- Packages (scripts, references, assets) are not installed: nothing here can be executed. These are instructions only and nothing routes work to this agent yet. Many Overviews assume Biomni tools and paths (/mnt/results, GenerateImage, LiteratureSearch, pdf-report-generation, ManageMachine) whose availability in GLHF is not stated. Their text does not address the AGENTS.md rules (no answer sources, documentation-only search allow-list, no billed cloud runs), so any skill that searches literature, fetches public data or uses machines must be checked against them before use in a benchmark solver.
