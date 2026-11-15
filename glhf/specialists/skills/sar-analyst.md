# sar-analyst

**Scope:** Interpret an existing compound series: Free-Wilson, matched molecular pairs, R-group decomposition and hit-series SAR.

**Skills owned:** 4 (2 full instructions, 2 index only). Status: instructions only, packages not installed, not wired into any solver.

## Route to this agent when

- Which substituents help or hurt at each R position, and which unmade combinations of known substituents to try (skill 33).
- Which single structural changes move potency, activity cliffs, context-dependent SAR (skill 49).
- Skills 13 and 73 are index only. Skill 33's text says it must first run r-group-decomposition (73) to produce rgroup_table.csv, so 33 and 73 travel together.

## Do not route here when

- Skill 33 cannot propose new substituents or extrapolate beyond those measured.
- Skill 49 does not train or benchmark a QSAR/GNN model (its text says use binding-affinity-ml-model, owned by qsar-property-modeler), does no de novo/generative design or retrosynthesis (generative-molecule-design, owned by small-molecule-designer), and does not predict ADMET (molecular-property-admet / adme-ml-modeling, owned by qsar-property-modeler).
- The work needs one of this agent's index-only skills to do anything beyond what its name says.

## Skills owned

### 13. chembl-hit-series-sar-docking: index only

- Category (hub): Drug discovery
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 33. free-wilson-analysis: full instructions

- Category (hub): Drug discovery
- Scope (its own text): Additive Free-Wilson model of activity as a constant plus one contribution per substituent per R position; says which substituents help or hurt and which unmade combinations of known substituents to try.
- Declared inputs: rgroup_table.csv from r-group-decomposition with a log-scale activity column (pIC50, pKi)
- Declared outputs: fitted model outputs, CV, proposals (optional PDF)
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none stated (software BSD-3 / PSF-based). This is silence in the Overview, not a clearance.

### 49. matched-molecular-pairs: full instructions

- Category (hub): Drug discovery
- Scope (its own text): Matched-molecular-pair SAR from an existing bioactivity series using mmpdb: per-transformation deltas with support and bootstrap CIs, activity cliffs, context-dependent transformations.
- Declared inputs: Tidy table (compound_id, smiles, endpoint, value, unit, assay_context, censored) or ChEMBL target id
- Declared outputs: transformation, cliff and context CSVs, report_facts.json, summary.json, PDF
- Hub URL: https://biomni.phylo.bio/skills/skill_907fb984a34e5e38b4497a8966da9ff6?section=marketplace
- package: not installed
- Licence / commercial-use flag: Text points to references/biomni-usage.md for "licences"; none stated in the Overview itself

### 73. r-group-decomposition: index only

- Category (hub): Drug discovery
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Pointer from other skills' text: Skill 33's text requires it to produce rgroup_table.csv.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

## What this agent cannot do

- Claim causation, mechanism or transfer to a new core from an MMP: skill 49's text says an MMP is an association in observed data.
- Pool scaffolds in a Free-Wilson fit: skill 33's text says model one realized scaffold at a time.
- Say anything about 13 or 73 beyond their names.
- Packages (scripts, references, assets) are not installed: nothing here can be executed. These are instructions only and nothing routes work to this agent yet. Many Overviews assume Biomni tools and paths (/mnt/results, GenerateImage, LiteratureSearch, pdf-report-generation, ManageMachine) whose availability in GLHF is not stated. Their text does not address the AGENTS.md rules (no answer sources, documentation-only search allow-list, no billed cloud runs), so any skill that searches literature, fetches public data or uses machines must be checked against them before use in a benchmark solver.
