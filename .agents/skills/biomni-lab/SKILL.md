---
name: biomni-lab
description: Index of the 100 Biomni Lab skills (biomni.phylo.bio/skills) and which of them apply to this repo's work. Use when choosing a bioinformatics or drug-discovery method, when a BixBench task needs a standard analysis workflow (RNA-seq differential expression, enrichment, clustering, single-cell), or when someone asks what Biomni skills are available. This index holds names, categories and links only; the skill packages (scripts, references, assets) are not installed here.
---

# Biomni Lab skills

## What this is, and what it is not

The Biomni Skill Hub holds 100 skills for computational biology and drug
discovery. Each one is a package: instructions plus `scripts/`, `references/`
and `assets/`. This directory holds only the catalog: names, categories and
links (`references/catalog.md`).

The packages are not installed. A Biomni skill's instructions say things like
"run `scripts/biomni_tools.py`"; those files do not exist here. Treat the
catalog as a map of available methods, not as runnable skills. To install one,
open its hub page, use the Files tab, and put the package in `.agents/skills/`.

## Which ones matter for this repo

The GLHF swarm reproduces computational biology studies. The five smallest
BixBench3 tasks are all bulk RNA-seq: reads to quality control to alignment to
counting to differential expression to enrichment. These skills cover that path:

| Task step | Skill |
|---|---|
| Reads to a count matrix | `rnaseq-fastq-to-counts` |
| Counts to differential expression | `bulk-rnaseq-counts-to-de-deseq2` |
| Enrichment of the gene list | `functional-enrichment-from-degs` |
| Sample or gene clustering | `bulk-omics-clustering` |
| Cell-type fractions from bulk | `deconvolution-bulk-rnaseq` |
| Single-cell analysis | `scrnaseq-scanpy-core-analysis`, `scrnaseq-seurat-core-analysis` |
| Pooled CRISPR screens | `pooled-crispr-screens` |

For the drug board: `open-targets`, `target-tractability-druggability`,
`med-chem-filters`, `molecular-property-admet`, `adme-ml-modeling`,
`knowledge-graph-target-reasoning`, `clinicaltrials-landscape`.

## Rules

- Do not tell an agent to load a Biomni skill unless its package is installed.
  Check `.agents/skills/<name>/SKILL.md` exists first.
- A Biomni skill's method guidance may be used as reading. Say where it came
  from, and do not claim a run used a skill whose code was never executed.
- Several Biomni skills describe data sources with licence conditions (ChEMBL
  and the Human Protein Atlas are share-alike; KEGG and DrugBank are not free
  for commercial use). Check the licence before using a source in this repo.

Catalog: [references/catalog.md](references/catalog.md)
