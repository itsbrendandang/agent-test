# protein-and-antibody-engineer

**Scope:** Structure preparation, protein structure prediction, antibody developability/humanization and binder design.

**Skills owned:** 4 (4 full instructions, 0 index only). Status: instructions only, packages not installed, not wired into any solver.

## Route to this agent when

- Prepare a structure for MD/MC/FEP/docking or as a design target (skill 5).
- Fold a protein; pLDDT/pTM; AlphaFold v2, Boltz-2, Chai-1, ESMCFold2 (skill 71).
- Is this antibody developable; humanize a non-human antibody; MHC-II immunogenicity (skill 2).
- Binder, mini-binder, de novo protein (Track A) or antibody, nanobody, VHH, scFv, CDR (Track B) design (skill 3).

## Do not route here when

- Skill 5 does not predict structures, dock or parameterise force fields.
- Skill 71 is not docking, MD, design, or experimental-structure comparison unless asked; complexes only via a manual path.
- Skill 3 does not predict Kd.

## Skills owned

### 2. antibody-developability-humanization: full instructions

- Category (hub): Molecular design
- Scope (its own text): Sequence-based assessment and humanization of a monoclonal antibody: developability liabilities, aggregation (AGGRESCAN a3v), MHC-II immunogenicity, and humanization with acceptor comparison for non-human antibodies.
- Declared inputs: VH+VL (or single chain; FASTA or sequences)
- Declared outputs: PDF report, master table CSV, payload, figures
- Hub URL: https://biomni.phylo.bio/skills/skill_1428c3775e3d807bc46446cc90c2a6a0?section=marketplace
- package: not installed
- Licence / commercial-use flag: IEDB: commercial use permitted, citation expected; NetMHCIIpan is licensed and never auto-downloaded

### 3. binder-antibody-design: full instructions

- Category (hub): Molecular design
- Scope (its own text): End-to-end structure-based binder design against one protein target: Track A de novo mini-binder (RFdiffusion, ProteinMPNN, Boltz-2), Track B antibody/nanobody CDR design (RFantibody); ranked candidates, epitope map, PDF.
- Declared inputs: Target PDB/mmCIF or UniProt/AlphaFold model, chain/range, optional hotspots, length or framework+CDR ranges
- Declared outputs: ranked candidate table, metrics JSON, construct/structure sidecars, figures, FASTA, PDF
- Hub URL: https://biomni.phylo.bio/skills/skill_af98a09aa8536dce4a7157f8f270a880?section=marketplace
- package: not installed
- Licence / commercial-use flag: none stated. This is silence in the Overview, not a clearance.

### 5. biomol-structure-prep: full instructions

- Category (hub): Molecular design
- Scope (its own text): Turn a deposited or uploaded structure into a clean starting model for either simulation (MD/MC/FEP/docking) or a design target (Boltz, RFdiffusion, ProteinMPNN, BindCraft).
- Declared inputs: PDB id or structure file, mode, pH, assembly/chains
- Declared outputs: prepared structure, ligand mol2/SDF, inventory.json
- Hub URL: https://biomni.phylo.bio/skills/skill_ecfd93fed75ef0dd731cba9a5bab2812?section=marketplace
- package: not installed
- Licence / commercial-use flag: none stated (a references file mentioning "commercial tools" is only named). This is silence in the Overview, not a clearance.

### 71. protein-structure-prediction: full instructions

- Category (hub): Molecular design
- Scope (its own text): Fold a protein with AlphaFold v2, Boltz-2, Chai-1 and/or ESMCFold2 (HPC jobs); per-residue pLDDT, pTM where available, confidence-band and UniProt-domain-resolved breakdowns, predictor/fallback disclosure. Not docking, MD, design, or experimental-structure comparison unless asked.
- Declared inputs: Sequence, UniProt accession/name, or FASTA (complexes manual path only)
- Declared outputs: PDB/CIF, per-residue pLDDT CSV/PNG, bands CSV, confidence_breakdown.json, run_manifest.json
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none raised. This is silence in the Overview, not a clearance.

## What this agent cannot do

- Run NetMHCIIpan in skill 2 without a licensed local copy: it is never auto-downloaded, and without it the input VH/VL sequences are sent to iedb.org (a data-leaving-the-machine fact from skill 2's text).
- Fold or design without HPC jobs: skills 3 and 71 depend on HPC tools.
- Packages (scripts, references, assets) are not installed: nothing here can be executed. These are instructions only and nothing routes work to this agent yet. Many Overviews assume Biomni tools and paths (/mnt/results, GenerateImage, LiteratureSearch, pdf-report-generation, ManageMachine) whose availability in GLHF is not stated. Their text does not address the AGENTS.md rules (no answer sources, documentation-only search allow-list, no billed cloud runs), so any skill that searches literature, fetches public data or uses machines must be checked against them before use in a benchmark solver.
