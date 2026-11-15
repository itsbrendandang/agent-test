# compound-set-curator

**Scope:** Filter, cluster, featurize and ring-system-profile an existing set of molecules.

**Skills owned:** 4 (3 full instructions, 1 index only). Status: instructions only, packages not installed, not wired into any solver.

## Route to this agent when

- Structural-alert, drug-likeness and sanity filtering of a molecule set (skill 50).
- Group molecules by similarity and show a 2-D map (skill 56).
- Per-molecule feature families (ECFP4/FCFP4/RDKit descriptors/CheMeleon embeddings) as aligned Parquet plus an HTML report (skill 89).
- Skill 78 is index only; skill 56's text says scaffold counting belongs to it.

## Do not route here when

- Skill 56 reuses molecular-dataset-qc and small-molecule-featurization; both 56 and 89 offer QC via molecular-dataset-qc, which is not one of the 100 catalog skills.
- The work needs one of this agent's index-only skills to do anything beyond what its name says.

## Skills owned

### 50. med-chem-filters: full instructions

- Category (hub): Drug discovery
- Scope (its own text): Apply structural-alert, drug-likeness and sanity filters to a molecule set, split pass/fail, keep every score and failure reason; filters are described as expert opinion that disagrees across rule sets.
- Declared inputs: SMILES list/.smi, CSV/TSV/xlsx, SDF
- Declared outputs: pass and fail sets with scores and reasons
- Hub URL: https://biomni.phylo.bio/skills/skill_9a8b4beff5684acd83e423d019d4ead1?section=marketplace
- package: not installed
- Licence / commercial-use flag: Lilly filters need `medchem install-lilly` (downloads and compiles LillyMol); no licence statement beyond that

### 56. molecule-clustering: full instructions

- Category (hub): Drug discovery
- Scope (its own text): Groups molecules by similarity and shows a 2-D map; clusters computed in the full feature space, map is display only. Reuses molecular-dataset-qc and small-molecule-featurization; scaffold counting belongs to scaffold-and-ring-systems-analysis.
- Declared inputs: `id,smiles` table (pasted or file)
- Declared outputs: clusters and map (outputs not enumerated in the part I read)
- Hub URL: https://biomni.phylo.bio/skills/skill_07ba09ea0abd44ffb709ee4b6af33668?section=marketplace
- package: not installed
- Licence / commercial-use flag: none raised. This is silence in the Overview, not a clearance.

### 78. scaffold-and-ring-systems-analysis: index only

- Category (hub): Drug discovery
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Pointer from other skills' text: Skill 56's text says scaffold counting belongs to it.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 89. small-molecule-featurization: full instructions

- Category (hub): Drug discovery
- Scope (its own text): Up to three feature families per molecule, one aligned Parquet file per family (e.g. morgan.parquet), plus an HTML report. Offers QC through molecular-dataset-qc first.
- Declared inputs: SMILES in chat, CSV/TSV/TXT, SDF, MOL (MOL2 converted to SDF first)
- Declared outputs: featurization_report.html, molecules.parquet, per-family parquet
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none raised. This is silence in the Overview, not a clearance.

## What this agent cannot do

- Treat skill 50's filters as ground truth: its text calls them expert opinion that disagrees across rule sets.
- Use the Lilly filters without `medchem install-lilly` (downloads and compiles LillyMol), per skill 50.
- Use the 2-D map of skill 56 for anything but display: clusters are computed in the full feature space.
- Describe skill 78 beyond its name.
- Packages (scripts, references, assets) are not installed: nothing here can be executed. These are instructions only and nothing routes work to this agent yet. Many Overviews assume Biomni tools and paths (/mnt/results, GenerateImage, LiteratureSearch, pdf-report-generation, ManageMachine) whose availability in GLHF is not stated. Their text does not address the AGENTS.md rules (no answer sources, documentation-only search allow-list, no billed cloud runs), so any skill that searches literature, fetches public data or uses machines must be checked against them before use in a benchmark solver.
