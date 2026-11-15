# small-molecule-designer

**Scope:** Generate, enumerate, dock and assess small molecules and degraders.

**Skills owned:** 7 (4 full instructions, 3 index only). Status: instructions only, packages not installed, not wired into any solver.

## Route to this agent when

- Computational molecular ideas from seed structures with a scorer (skill 35).
- Dock a compound library against a PDB target with AutoDock Vina, redock-validate, triage hits (skill 42).
- Positional analogs of a parent SMILES: substituent addition, aromatic [cH] to N walks, [*] attachment points (skill 70).
- PROTAC / bifunctional degrader design and triage (skill 94).
- Skills 43, 44, 92 are index only: by name only.

## Do not route here when

- Skill 42 says not for FEP/MM-PBSA, covalent docking, metalloprotein parameterization, PROTAC or MD.
- Skill 94 does not predict DC50/Dmax, kinetics, synthetic accessibility, or de novo glue discovery.
- The work needs one of this agent's index-only skills to do anything beyond what its name says.

## Skills owned

### 35. generative-molecule-design: full instructions

- Category (hub): Molecular design
- Scope (its own text): Agent-led generative small-molecule design: agree the task, choose scoring and a generator (graph GA, STONED/SELFIES, REINVENT), assess candidates, gentle med-chem filtering, select top set.
- Declared inputs: Seed/reference structures, task, constraints, scorer
- Declared outputs: generated_candidates.csv, selected_candidates.csv, report.html (PDF on request), run metadata
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none stated. This is silence in the Overview, not a clearance.

### 42. large-scale-virtual-screening: full instructions

- Category (hub): Drug discovery
- Scope (its own text): Dock a compound library against a protein target with AutoDock Vina, validate by redock, rank and triage hits, summarize SAR, PDF; scales to tens of thousands of compounds.
- Declared inputs: PDB id or .pdb (co-crystal ligand preferred) + library (SMILES/CSV, ChEMBL pull, DUD-E-style, Enamine subset)
- Declared outputs: master library, scores, redock validation, top hits, scaffold clusters, PDF
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: ChEMBL CC BY-SA 3.0 (attribution + share-alike); DUD-E free for research, verify before commercial use; Enamine per its terms; TDC data CC BY 4.0; HPA (if added) CC BY-SA 4.0

### 43. library-design-enumeration: index only

- Category (hub): Molecular design
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 44. ligand-binding-mode-analysis: index only

- Category (hub): Molecular design
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 70. positional-analog-scanning: full instructions

- Category (hub): Molecular design
- Scope (its own text): Enumerate positional analogs of a parent molecule with RDKit (substituent addition, aromatic [cH] -> N walks, explicit [*] attachment points), compare with parent, export an interactive HTML report.
- Declared inputs: SMILES, CSV or SDF (user selects salt component)
- Declared outputs: CSV + SDF + interactive HTML, parent preview
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none raised (RDKit BSD-3-Clause). This is silence in the Overview, not a clearance.

### 92. synthesizability-and-building-block-scoring: index only

- Category (hub): Molecular design
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 94. targeted-degrader-design: full instructions

- Category (hub): Molecular design
- Scope (its own text): PROTAC design/triage keeping computed results (chemistry, docking, ADMET) separate from precedent-reasoned heuristics: E3/warhead/linker choice, exit-vector docking, RDKit library assembly, bRo5 + ADMET profiling, scored shortlist, optional ternary-complex tier. Does not predict DC50/Dmax, kinetics, synthetic accessibility, or de novo glue discovery.
- Declared inputs: Target (name, ChEMBL/UniProt ID), optional E3/warhead/linker/oral intent, optional PDB
- Declared outputs: `<TARGET>_PROTAC/` tables, figures, data, report PDF
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: **ADFR Suite (prepare_receptor/prepare_ligand) prohibited for commercial use** (MGLTOOLS licence: "used only for NON COMMERCIAL purposes"; consulting and selling applications built on it count as commercial; commercial licence from Scripps Research/Michel Sanner, or substitute Meeko, OpenBabel or RDKit prep). **ChEMBL CC BY-SA 3.0** and **Human Protein Atlas** (current CC BY 4.0; archived releases CC BY-SA 3.0): attribution plus share-alike on any redistributed derived dataset; verify the exact HPA release. UniProt CC BY 4.0; PubChem public domain; RCSB PDB public domain/CC0. Text notes some ChEMBL computed-property fields derive from commercial software with extra restrictions. Other engines (RDKit BSD-3, Vina Apache 2.0, DeepPurpose BSD-3, OpenBabel GPL-2.0) permitted. Report must flag any `needs_commercial_review` dependency

## What this agent cannot do

- Run skill 94's docking with ADFR Suite for commercial work (see licence flag); Meeko, OpenBabel or RDKit prep are the substitutes its text names.
- Score synthesizability, enumerate libraries or analyse binding modes from skills 43, 44, 92: index only.
- Run REINVENT-style generation without HPC/GPU tools: skill 35 uses them (part1 note 6).
- Packages (scripts, references, assets) are not installed: nothing here can be executed. These are instructions only and nothing routes work to this agent yet. Many Overviews assume Biomni tools and paths (/mnt/results, GenerateImage, LiteratureSearch, pdf-report-generation, ManageMachine) whose availability in GLHF is not stated. Their text does not address the AGENTS.md rules (no answer sources, documentation-only search allow-list, no billed cloud runs), so any skill that searches literature, fetches public data or uses machines must be checked against them before use in a benchmark solver.
