# Biomni skills grouped into 19 role agents (draft, instructions only)

The 100 skills in the Biomni Skill Hub catalog (`.agents/skills/biomni-lab/references/catalog.md`) are grouped here into
19 role agents. Two sibling passes proposed groupings for skills 1-50 (`part1.md`, 14 groups) and 51-100 (`part2.md`, 10 groups);
this directory reconciles them. Each skill has exactly one primary agent. `skills-map.json` holds the same mapping for code.

## Status (read this first)

- **The skill packages (scripts, references, assets) are NOT installed.** Only the hub Overview text was copied, and for 38 skills not even that.
- **These agents are instructions only.** They are not wired into any solver, the engine or the dashboard.
- **Nothing routes work to them yet.** No run, scripted or real, has used them, and their effect on any result is untested.
- Nothing here states a benchmark score. No Overview reports one.
- For the 38 index-only skills the hub showed "No markdown preview is available for this skill yet." Their agent entries say so and give a name and category only.
- Only 15 of the 62 full-text skills have a skill-specific hub link in the source copy; every other skill's recorded URL is the hub's general listing (`https://biomni.phylo.bio/skills?section=marketplace`).
- The nine existing board profiles in `../*.md` are separate and unchanged.

## Agents

| Agent | Role | Skills | Full text | Index only |
|---|---|---|---|---|
| [`qsar-property-modeler`](qsar-property-modeler.md) | Supervised single-endpoint small-molecule ADME and affinity models built from labelled tables, plus structure-based property estimates. | 4 | 2 | 2 |
| [`sar-analyst`](sar-analyst.md) | Interpret an existing compound series: Free-Wilson, matched molecular pairs, R-group decomposition and hit-series SAR. | 4 | 2 | 2 |
| [`compound-set-curator`](compound-set-curator.md) | Filter, cluster, featurize and ring-system-profile an existing set of molecules. | 4 | 3 | 1 |
| [`small-molecule-designer`](small-molecule-designer.md) | Generate, enumerate, dock and assess small molecules and degraders. | 7 | 4 | 3 |
| [`protein-and-antibody-engineer`](protein-and-antibody-engineer.md) | Structure preparation, protein structure prediction, antibody developability/humanization and binder design. | 4 | 4 | 0 |
| [`target-prioritiser`](target-prioritiser.md) | Nominate and rank disease targets, surface antigens, indications and repurposing hypotheses. | 6 | 4 | 2 |
| [`target-safety-druggability-analyst`](target-safety-druggability-analyst.md) | Druggability, modality, tissue-expression specificity and safety signals for a chosen target or drug. | 4 | 2 | 2 |
| [`bulk-rnaseq-analyst`](bulk-rnaseq-analyst.md) | Public-dataset retrieval, FASTQ to counts, bulk RNA-seq differential expression, modules, consensus signatures, deconvolution and enrichment. | 7 | 5 | 2 |
| [`omics-biomarker-integrator`](omics-biomarker-integrator.md) | Bulk clustering, longitudinal omics, proteomics, microbiome, multi-omics integration and signature-response tests. | 7 | 6 | 1 |
| [`perturbation-and-crispr-specialist`](perturbation-and-crispr-specialist.md) | Guide and primer design, pooled CRISPR / Perturb-seq analysis, perturbation-response prediction, and compound-perturbation signatures. | 6 | 4 | 2 |
| [`epigenomics-regulator-analyst`](epigenomics-regulator-analyst.md) | ChIP-Atlas transcription-factor target, enrichment and differential analysis, and upstream-regulator inference from DE results. | 4 | 2 | 2 |
| [`single-cell-core-analyst`](single-cell-core-analyst.md) | Core scRNA-seq processing (Scanpy or Seurat), trajectories and velocity, and CELLxGENE Census queries. | 4 | 4 | 0 |
| [`single-cell-multimodal-spatial-analyst`](single-cell-multimodal-spatial-analyst.md) | scATAC / 10x Multiome, CITE-seq integration, and the spatial, regulatory-network and velocity-extension skills that are index only. | 6 | 2 | 4 |
| [`statistical-geneticist`](statistical-geneticist.md) | Two-sample Mendelian randomization and (by name only) fine-mapping, constraint gating, TWAS and polygenic risk scores. | 5 | 1 | 4 |
| [`variant-and-genome-analyst`](variant-and-genome-analyst.md) | Variant annotation and evidence, cancer-cohort genomics, rare-disease cases, variant calling and long-read analysis. | 7 | 2 | 5 |
| [`immune-cell-therapy-analyst`](immune-cell-therapy-analyst.md) | CAR construct design with CRISPR-screen reanalysis, TCR/BCR repertoire profiling, and (by name only) cell-therapy QC and flow cytometry. | 4 | 2 | 2 |
| [`clinical-and-experimental-design-analyst`](clinical-and-experimental-design-analyst.md) | Trial-design simulation, plate layout, population PK/PD, real-world-evidence cohorts and survival analysis. | 6 | 5 | 1 |
| [`literature-evidence-synthesist`](literature-evidence-synthesist.md) | Citation-verified method comparisons, ClinicalTrials.gov landscapes, meta-analysis and (by name only) literature reviews. | 5 | 3 | 2 |
| [`workflow-and-method-engineer`](workflow-and-method-engineer.md) | Nextflow pipelines, skill-package authoring and method-development loops. | 6 | 5 | 1 |
| **Total (19 agents)** | | **100** | **62** | **38** |

Full text = the hub showed an Overview (62 skills). Index only = it did not (38 skills). Totals are computed from the source files, not from the two proposals.

## Files

- One `<agent>.md` per role: scope, when to route and when not to, each owned skill (its own scope, declared inputs and outputs, hub URL, `package: not installed`, full instructions or index only, licence flag), and what the agent cannot do.
- `skills-map.json`: `agent_to_skills`, `skill_to_agent`, and `skill_text` (full or index_only) per skill name.
- `part1.md`, `part2.md`: the two input proposals with the per-skill tables. Kept unchanged as the evidence for this reconciliation.

## Reconciliation notes

Part 1 proposed 14 groups and part 2 proposed 10. They disagree on granularity more than on content, and no skill sat in a different broad domain in the two.

1. **Granularity.** 24 proposed groups became 19 agents. Part 1 itself suggested merging G7 and G8 into G6, G11 into G10 and G13 into G14. I adopted one of those as stated and changed the rest:
   - G11 long-read genomics (47, 48) went into `variant-and-genome-analyst` (adopted).
   - G7 (24, 28) went to `omics-biomarker-integrator`, not to bulk transcriptomics, because part 2's multi-omics, proteomics and microbiome group (57, 72, 53) is the closer match, and it keeps `bulk-rnaseq-analyst` on RNA-seq.
   - G8 (9, 38) joined part 2's single-cell multimodal skills in `single-cell-multimodal-spatial-analyst`. Part 1 admits the single-cell reading of 9 and 38 is from their names, not their text.
   - G13 (17, 30) joined part 2's clinical and design group (54, 67, 75, 91) in `clinical-and-experimental-design-analyst`, not G14. Skill 54's text redirects power analysis to 30, and 75's text points to 91.
2. **Bulk omics was split three ways.** Part 1 G6 (7 skills) and part 2 G4 (8 skills) overlapped. Result: `bulk-rnaseq-analyst` (retrieval, FASTQ to counts, DE, modules, consensus signature, deconvolution, enrichment), `omics-biomarker-integrator`, and the perturbation agent below.
   - 27 drug-seq-analysis moved from part 1 G6 to `perturbation-and-crispr-specialist`, with 86 signature-reversal-lincs (name only), since 27's scope is compound and dose perturbation signatures.
   - 98 upstream-regulator-analysis moved from part 2 G4 to `epigenomics-regulator-analyst`, because it runs on ChIP-Atlas data like 14-16.
   - 85 signature-response-enrichment moved from part 2 G4 to `omics-biomarker-integrator`; 6 bulk-omics-clustering stays there (catalog category Multi-omics, text says bulk).
   - 59 omics-dataset-retrieval stays with bulk RNA-seq because the text chains 59, then 77, then DESeq2 DE.
3. **80 scrna-disease-drug-discovery.** Part 2 put it with single cell; its job is target ranking and skill 10's text hands target work to it. It is owned by `target-prioritiser`. The text also says it chains from 82 (scanpy), so the single-cell agent is the natural consult.
4. **52 methods-landscape-review.** Part 2 grouped it with 63, 96, 97. It runs no analysis and compares published methods; it is owned by `literature-evidence-synthesist`. 63, 96, 97 joined the pipeline skills (64-66) in `workflow-and-method-engineer`.
5. **Virtual screening.** Part 2 found no member in 51-100; part 1 had 42 with design. 42 and 44 are in `small-molecule-designer`, together with 94, 70 and 92 from part 2's molecular-design group. Protein-side skills (71 with 2, 3, 5) form `protein-and-antibody-engineer`.
6. **Compound-set skills.** Part 1 G2 (SAR) and part 2 G9 (cheminformatics) overlapped. SAR interpretation (13, 33, 49, 73) is `sar-analyst`; set processing (50, 56, 78, 89) is `compound-set-curator`. 73 sits with 33 because 33's text requires it; 78 sits with 56 because 56's text points to it.
7. **55 molecular-property-admet.** Part 2 put it with cheminformatics; part 1 put 25 drug-bioactivity-chembl with ADME modelling. Both are index only. 55 went to `qsar-property-modeler` because skill 49's text names it for structure-based ADMET prediction, next to skill 1.
8. **91 survival-analysis-clinical.** Catalog category is Multi-omics, but its text is a clinical-table analysis, and 75 points to it. It is with `clinical-and-experimental-design-analyst`.
9. **Counts agree.** Part 1 counted 26 full and 24 index only; part 2 counted 36 and 14. Recounting from the sources gives 62 and 38, matching both and the catalog's "Overview text copied?" column.
10. **Skills the text names that are not in the catalog.** `genetic-target-hypothesis`, `pathway-enrichment`, `gene-essentiality`, `molecular-dataset-qc` and `pdf-report-generation` are referenced but are not among the 100. Part 1's open question (are `scrnaseq-*`, `open-targets`, `r-group-decomposition`, `molecular-property-admet`, `scrna-disease-drug-discovery` in 51-100?) is answered: they are skills 82, 83, 60, 73, 55 and 80.

## Licence and cost flags carried forward

Each agent file repeats the flag in its skill entry. The strongest, from the skills' own text:
- Commercial-review or exclusion statements: 21 (KEGG removed), 22 (CIBERSORTx, EPIC, BSeq-sc excluded), 41 (academic edge-license mode), 53 (KEGG removed), 84 (CRISPick research-only; Addgene MTA), 94 (ADFR Suite non-commercial).
- Policies and guardrails: 52 (exclude non-commercial resources, caveat share-alike), 75 (MIMIC-IV is credentialed), 100 (open data and MIT weights only).
- Share-alike duties: 4, 10, 42, 94 (ChEMBL / Human Protein Atlas).
- Ambiguous: 79 and 88 (CellMarker 2.0).
- Cost, not licence: 96 and 97 describe multi-machine and GPU compute and 96 names three paid LLM stages. This conflicts with the repo rule against starting billed cloud runs, so no agent should start them unless the user asks.
- Skill 11 describes a "paywall-circumventing" library reconstruction; it needs review before anyone adopts it.
- "None stated" in a skill entry means the Overview raises no flag. It does not mean the source is cleared.

## What is still open

- Whether any of the 38 index-only skills exist as packages: their Overviews were not shown.
- What the packages contain: nothing was downloaded or installed.
- How Biomni tools and paths map into GLHF; the Overviews do not say.
- Which agents, if any, to wire first and how they would be selected by code. That is a separate piece of work, and the board's rule that verdicts come from `swarm/ledger.py` and not from a model still applies.
- Whether any of this improves accuracy: untested.
