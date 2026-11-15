# Biomni skills 1-50: source material and grouping proposal

Source text: `.agents/skills/biomni-lab/references/overviews-part1.md` (hub Overview copies). Catalog: `.agents/skills/biomni-lab/references/catalog.md`.
Nothing here is invented: scope, inputs/outputs, licence flags and triggers are paraphrased from the Overview text. Where the hub showed "No markdown preview is available for this skill yet." the skill is **index only**: the scope, inputs, outputs and licence cells are blank, and its placement in a group rests on its name and catalogue category alone (marked `[name only]` in section 2).

Split: **26 full Overview, 24 index only.**
Index only: 7, 8, 9, 12, 13, 14, 15, 23, 25, 26, 28, 30, 31, 32, 34, 36, 37, 38, 39, 43, 44, 45, 46, 47.

Hub pages carry a Files tab (scripts, references, assets) that is not in this repo; every script, reference-file and asset name below is only what the Overview text mentions.

## 1. Skill table

Licence column = flag the text itself raises. "none stated" = the Overview text raises none (not a clearance).

| # | Name | Category | Hub text | Scope (from its own text) | Inputs -> outputs | Licence flag in text |
|---|---|---|---|---|---|---|
| 1 | adme-ml-modeling | Drug discovery | Full | Build, evaluate, save and apply supervised single-endpoint small-molecule in-vitro ADME models from a labelled assay table (one endpoint and one assay signature per run; nested inner selection, locked outer assessment, censor-aware fitting, conformal intervals, applicability-domain flags). | Labelled table (CSV/TSV/SDF/SMI, SMILES + endpoint column, optional date/assay-context/unit/qualifier/series columns) -> audit, model bundle, evaluation, predictions + manifest, PDF | Demo data Lipophilicity_AstraZeneca is CC BY 4.0 (attribution) |
| 2 | antibody-developability-humanization | Molecular design | Full | Sequence-based assessment and humanization of a monoclonal antibody: developability liabilities, aggregation (AGGRESCAN a3v), MHC-II immunogenicity, and humanization with acceptor comparison for non-human antibodies. | VH+VL (or single chain; FASTA or sequences) -> PDF report, master table CSV, payload, figures | IEDB: commercial use permitted, citation expected; NetMHCIIpan is licensed and never auto-downloaded |
| 3 | binder-antibody-design | Molecular design | Full | End-to-end structure-based binder design against one protein target: Track A de novo mini-binder (RFdiffusion, ProteinMPNN, Boltz-2), Track B antibody/nanobody CDR design (RFantibody); ranked candidates, epitope map, PDF. | Target PDB/mmCIF or UniProt/AlphaFold model, chain/range, optional hotspots, length or framework+CDR ranges -> ranked candidate table, metrics JSON, construct/structure sidecars, figures, FASTA, PDF | none stated |
| 4 | binding-affinity-ml-model | Molecular design | Full | Single-endpoint small-molecule affinity regression: pull ChEMBL bioactivity for a target, curate a dataset, benchmark models under scaffold-split CV, screen an external library for novel-scaffold candidates with applicability-domain tiers. | Target symbol or ChEMBL target IDs, optional config JSON and external SMILES library -> curated dataset, CV metrics, scored candidates, AD tiers, figures, PDF | ChEMBL CC BY-SA 3.0: attribution (cite release) and share-alike on derived datasets; commercial use permitted |
| 5 | biomol-structure-prep | Molecular design | Full | Turn a deposited or uploaded structure into a clean starting model for either simulation (MD/MC/FEP/docking) or a design target (Boltz, RFdiffusion, ProteinMPNN, BindCraft). | PDB id or structure file, mode, pH, assembly/chains -> prepared structure, ligand mol2/SDF, inventory.json | none stated (a references file mentioning "commercial tools" is only named) |
| 6 | bulk-omics-clustering | Multi-omics | Full | Clustering of samples or features in a bulk quantitative matrix with multiple algorithms, validation, comparison and interpretation (Python or R). | Matrix (CSV/TSV/xlsx/h5/RDS), samples x features or reverse -> cluster assignments, validation metrics, plots, exported results | Packages listed as permissive / commercial use permitted (BSD-3, MIT, GPL/MIT) |
| 7 | bulk-rnaseq-counts-to-de-deseq2 | Transcriptomics | Index only | index only | | |
| 8 | cancer-cohort-genomics | Genomics | Index only | index only | | |
| 9 | cell-cell-communication | Transcriptomics | Index only | index only | | |
| 10 | cell-surface-antigen-discovery | Drug discovery | Full | Nominate antibody-accessible cell-surface antigens for ADC, CAR-T, bispecific and radioligand development, ranked by tumor-surface specificity and normal-tissue therapeutic index (essentiality is annotation only). | Verified disease label(s) (CELLxGENE Census default), bundled surfaceome seed, known-target validation list -> ranked_surface_targets.csv, compartment expression, topology and annotation tables, PDF | CC BY-SA share-alike: Human Protein Atlas (CC BY-SA) and ChEMBL via Open Targets (CC BY-SA 3.0); others CC BY 4.0; text points to DATA_SOURCES.md |
| 11 | cell-therapy-car-design | Functional genomics | Full | Two linked capabilities: MAGeCK reanalysis of a pooled CRISPR screen in primary human T cells (validated against DepMap), and construction of second-generation CAR constructs from a validated scFv. | Antigen/validated scFv source; screen accession (worked example GSE119450) -> sgRNA library, MAGeCK tables, DepMap cross-check, protein/ORF FASTA, GenBank files, PDF | none stated; text describes a read-driven library reconstruction for paywalled guide tables (see note 3.9) |
| 12 | cell-therapy-qc-scorecard | Transcriptomics | Index only | index only | | |
| 13 | chembl-hit-series-sar-docking | Drug discovery | Index only | index only | | |
| 14 | chip-atlas-diff-analysis | Epigenomics | Index only | index only | | |
| 15 | chip-atlas-peak-enrichment | Epigenomics | Index only | index only | | |
| 16 | chip-atlas-target-genes | Epigenomics | Full | Find target genes for a transcription factor from pre-computed public ChIP-Atlas ChIP-seq data, ranked by MACS2 binding score. | TF symbol (case-sensitive), genome (default hg38), distance from TSS 1/5/10 kb -> analysis_object.pkl and result tables | none stated |
| 17 | clinical-trial-design-simulation | Experimental design | Full | Simulate and evaluate two-arm confirmatory trial designs with one primary endpoint: power, operating characteristics under user effect scenarios, two validation gates (FWER and rpact benchmark), PDF. | JSON config of assumptions, no patient data -> gate and operating-characteristic tables, sensitivity table, figures, PDF | none stated |
| 18 | clinical-variant-allelic-series | Genomics | Full | For one human gene, integrate every ClinVar record and CIViC curated evidence into a position-resolved allele table with actionability tier and mechanism, figures and PDF. | One HGNC gene symbol (optional NCBI email/key, UniProt override) -> ClinVar and CIViC CSV/JSON, allelic_series_master.csv, 4 figures, PDF | none stated |
| 19 | clinicaltrials-landscape | Literature | Full | Map a bounded set of registered ClinicalTrials.gov records for a declared query, classified by study purpose and intervention type, with auditable coverage provenance. | Condition term(s) (+ optional intervention/status/phase/sponsor) or a compiled trials CSV -> trials_all/by_category/by_sponsor/match_evidence CSVs, coverage_scope.json, figures, report facts, PDF | none stated |
| 20 | coexpression-network | Transcriptomics | Full | WGCNA: weighted co-expression modules, hub genes, module-trait correlation from normalized expression data. | Normalized expression (VST/rlog/TPM/FPKM, not raw counts) + metadata -> wgcna_network.rds, module and hub-gene tables, plots | WGCNA GPL-2+, commercial use listed as permitted |
| 21 | consensus-disease-signature | Transcriptomics | Full | Consensus transcriptional signature from >=2 bulk-transcriptome cohorts via random-effects effect-size meta-analysis (limma / limma-voom), with enrichment and literature validation. | One YAML config naming cohorts (GEO or user matrices), contrast and thresholds -> meta_analysis_full.csv, consensus UP/DOWN gene lists, enrichment tables, figures, PDF | needs_commercial_review: KEGG removed (academic-only); MSigDB Hallmark mixed licensing; Reactome CC0 |
| 22 | deconvolution-bulk-rnaseq | Transcriptomics | Full | Estimate cell-type proportions from bulk RNA-seq using a single-cell reference (BayesPrism, DWLS, optional MuSiC/Bisque) and test group differences. | Bulk matrix + annotated single-cell reference (.h5ad/.rds) + optional metadata -> per-method and consensus proportions, concordance, group contrasts, figures | CIBERSORTx (non-commercial), EPIC (academic-only), BSeq-sc: excluded, run_deconvolution() errors if asked; the retained methods listed as permitted |
| 23 | direction-of-effect-concordance | Drug discovery | Index only | index only | | |
| 24 | disease-progression-longitudinal | Multi-omics | Full | Reconstruct disease progression trajectories from longitudinal omics (TimeAx alignment), order samples by pseudotime, find trajectory features, stratify progressors. | Omics matrix + sample_id/patient_id/timepoint (>=10 patients, >=3 timepoints each) -> pseudotime_assignments.csv, trajectory_features.csv, plots | listed packages permissive (MIT, BSD, Apache 2.0) |
| 25 | drug-bioactivity-chembl | Drug discovery | Index only | index only | | |
| 26 | drug-repurposing-indication-expansion | Drug discovery | Index only | index only | | |
| 27 | drug-seq-analysis | Transcriptomics | Full | DRUG-seq / plate-based bulk RNA-seq compound screens: per-well QC, compound/dose DE against matched vehicle, perturbational signatures with MoA clustering, dose-response/tPOD, pathway/TF activity. | counts.tsv (genes x wells) + platemap.csv (optional barcoded FASTQ) -> de_all_contrasts, QC, null-contrast gate, activity, dose-response, MoA tables, PDF | LINCS L1000/CMap: clue.io terms, commercial use "no_prohibition_found", verify before commercial use; MSigDB "not_checked" |
| 28 | elastic-net-biomarker-panel | Multi-omics | Index only | index only | | |
| 29 | evidence-synthesis-meta-analysis | Data analysis | Full | Random-effects meta-analysis across studies (MD, SMD, OR, RR, HR; one measure per analysis) with PRISMA-style screening, heterogeneity, subgroups, robustness suite and PDF. | Extraction-table CSV, or a research question (literature-driven via LiteratureSearch) -> extraction table, meta results, leave-one-out, influence, figures, PDF | none stated |
| 30 | experimental-design-statistics | Experimental design | Index only | index only | | |
| 31 | fine-mapping-susie | Genomics | Index only | index only | | |
| 32 | flow-cytometry-analysis | Proteomics | Index only | index only | | |
| 33 | free-wilson-analysis | Drug discovery | Full | Additive Free-Wilson model of activity as a constant plus one contribution per substituent per R position; says which substituents help or hurt and which unmade combinations of known substituents to try. | rgroup_table.csv from r-group-decomposition with a log-scale activity column (pIC50, pKi) -> fitted model outputs, CV, proposals (optional PDF) | none stated (software BSD-3 / PSF-based) |
| 34 | functional-enrichment-from-degs | Functional analysis | Index only | index only | | |
| 35 | generative-molecule-design | Molecular design | Full | Agent-led generative small-molecule design: agree the task, choose scoring and a generator (graph GA, STONED/SELFIES, REINVENT), assess candidates, gentle med-chem filtering, select top set. | Seed/reference structures, task, constraints, scorer -> generated_candidates.csv, selected_candidates.csv, report.html (PDF on request), run metadata | none stated |
| 36 | genetic-constraint-gating | Genomics | Index only | index only | | |
| 37 | genetic-variant-annotation | Genomics | Index only | index only | | |
| 38 | grn-pyscenic | Transcriptomics | Index only | index only | | |
| 39 | gwas-to-function-twas | Genomics | Index only | index only | | |
| 40 | immune-repertoire-airr | Transcriptomics | Full | Descriptive TCR/BCR repertoire profiling with immunarch: clonality, diversity, V/J usage and overlap, optional group comparisons, PDF. | Clonotype files in any repLoad-detected format (Cell Ranger, immunoSEQ, MiXCR, AIRR) + optional metadata.txt -> tables (diversity, clonality, gene usage, overlap), PDF | none stated |
| 41 | knowledge-graph-target-reasoning | Drug discovery | Full | Rank targets for a disease by Random-Walk-with-Restart over PrimeKG (optional TxGNN layer), with multi-hop evidence paths, known-target validation and literature support. | PrimeKG CSV, disease name resolved to PrimeKG node id(s), optional TxGNN pickles / Open Targets -> ranked_targets.csv, meta.json, figures, PDF | Explicit: --edge-license commercial (default) vs academic. Academic mode (DrugBank, TxGNN, DisGeNET-derived seeds) = needs_commercial_review. PrimeKG dataset CC BY 4.0; Open Targets CC0; GO/MONDO CC BY 4.0 |
| 42 | large-scale-virtual-screening | Drug discovery | Full | Dock a compound library against a protein target with AutoDock Vina, validate by redock, rank and triage hits, summarize SAR, PDF; scales to tens of thousands of compounds. | PDB id or .pdb (co-crystal ligand preferred) + library (SMILES/CSV, ChEMBL pull, DUD-E-style, Enamine subset) -> master library, scores, redock validation, top hits, scaffold clusters, PDF | ChEMBL CC BY-SA 3.0 (attribution + share-alike); DUD-E free for research, verify before commercial use; Enamine per its terms; TDC data CC BY 4.0; HPA (if added) CC BY-SA 4.0 |
| 43 | library-design-enumeration | Molecular design | Index only | index only | | |
| 44 | ligand-binding-mode-analysis | Molecular design | Index only | index only | | |
| 45 | literature-deep-review | Literature | Index only | index only | | |
| 46 | literature-review | General | Index only | index only | | |
| 47 | long-read-assembly | Genomics | Index only | index only | | |
| 48 | long-read-structural-variants | Genomics | Full | Dual-caller (Sniffles2 plus cuteSV or a user VCF) descriptive SV analysis from an already aligned, sorted, indexed ONT or PacBio BAM; caller agreement is descriptive, not accuracy or clinical interpretation. | BAM+index, reference FASTA+fai, upstream run.json and identity_check.json -> normalized VCFs, counts, concordance, provenance, dependency_licenses.json, PDF | Workflow step audits commercial-use licence evidence of Python/runtime dependencies (output dependency_licenses.json) |
| 49 | matched-molecular-pairs | Drug discovery | Full | Matched-molecular-pair SAR from an existing bioactivity series using mmpdb: per-transformation deltas with support and bootstrap CIs, activity cliffs, context-dependent transformations. | Tidy table (compound_id, smiles, endpoint, value, unit, assay_context, censored) or ChEMBL target id -> transformation, cliff and context CSVs, report_facts.json, summary.json, PDF | Text points to references/biomni-usage.md for "licences"; none stated in the Overview itself |
| 50 | med-chem-filters | Drug discovery | Full | Apply structural-alert, drug-likeness and sanity filters to a molecule set, split pass/fail, keep every score and failure reason; filters are described as expert opinion that disagrees across rule sets. | SMILES list/.smi, CSV/TSV/xlsx, SDF -> pass and fail sets with scores and reasons | Lilly filters need `medchem install-lilly` (downloads and compiles LillyMol); no licence statement beyond that |

## 2. Proposed role groups (each skill in exactly one)

`[name only]` = index-only skill placed by name and catalogue category; its text was not shown on the hub, so the router must not assume any behaviour beyond the name.

### G1. ADME and bioactivity QSAR modelling (3)
- Scope: supervised small-molecule property and affinity models with honest evaluation.
- Skills: 1 adme-ml-modeling; 4 binding-affinity-ml-model; 25 drug-bioactivity-chembl [name only].
- Triggers (from text): a labelled in-vitro ADME assay table for a single endpoint (1); a target name to turn into a ChEMBL dataset, affinity model and novel-scaffold list (4). Skill 1 says NOT for unlabelled pretrained ADMET, atom-level metabolism, biologics, in-vivo PK time series or popPK. Skill 4 says NOT for biologics/peptides/macrocycles as the modelling set, classification, docking, ADMET, de novo generation or multi-target selectivity.

### G2. SAR and med-chem series analysis (4)
- Scope: interpret an existing compound series and filter molecules.
- Skills: 33 free-wilson-analysis; 49 matched-molecular-pairs; 50 med-chem-filters; 13 chembl-hit-series-sar-docking [name only].
- Triggers: "which substituents help or hurt at each position" and unmade combinations of known substituents (33; cannot propose new substituents); which single structural changes move potency, activity cliffs, context-dependent SAR (49); structural-alert/drug-likeness pass-fail of a molecule set (50).

### G3. Molecule design, library and virtual screening (4)
- Scope: generate, enumerate and dock small molecules.
- Skills: 35 generative-molecule-design; 42 large-scale-virtual-screening; 43 library-design-enumeration [name only]; 44 ligand-binding-mode-analysis [name only].
- Triggers: computational molecular ideas from seeds with a scorer (35); dock a library against a PDB target with AutoDock Vina and triage hits (42; not FEP/MM-PBSA, covalent docking, metalloprotein parameterization, PROTAC or MD).

### G4. Structure preparation and biologic design (3)
- Scope: structure cleanup and sequence/structure design of antibodies and protein binders.
- Skills: 5 biomol-structure-prep; 2 antibody-developability-humanization; 3 binder-antibody-design.
- Triggers: prepare a structure for MD/docking/FEP or as a design target (5; does not predict structures, dock or parameterise force fields); "Is this antibody developable", humanize a murine antibody, T-cell epitopes, humanness score (2); "binder", "mini-binder", "de novo protein" (Track A) or "antibody", "nanobody", "VHH", "scFv", "CDR" (Track B) (3; does not predict Kd).

### G5. Target prioritisation and repurposing (4)
- Scope: nominate and rank targets or indications.
- Skills: 10 cell-surface-antigen-discovery; 41 knowledge-graph-target-reasoning; 23 direction-of-effect-concordance [name only]; 26 drug-repurposing-indication-expansion [name only].
- Triggers: cell-surface targets for ADC/CAR-T/bispecific/radioligand in a tumor type (10); "what to drug", "which genes drive <disease>", KG-based target ranking, repurposing-informed hypotheses (41). Skill 10 hands small-molecule/degrader and general genetic-evidence target work to scrna-disease-drug-discovery or genetic-target-hypothesis. Skill 41 hands target-disease association lookup to an open-targets skill.

### G6. Bulk transcriptomics (7)
- Scope: bulk expression analysis from clustering to enrichment.
- Skills: 6 bulk-omics-clustering; 7 bulk-rnaseq-counts-to-de-deseq2 [name only]; 20 coexpression-network; 21 consensus-disease-signature; 22 deconvolution-bulk-rnaseq; 27 drug-seq-analysis; 34 functional-enrichment-from-degs [name only].
- Triggers: group samples/features or find subtypes (6; single-cell goes to scrnaseq skills); gene modules and hub genes with >=15 samples of normalized data (20); >=2 cohorts, same-direction changes, effect-size meta-analysis (21); cell-type proportions from bulk with a single-cell reference (22); compound/dose screens on plates (27). Skills 6 and 22 point to 7 for DE and 6 to 34 for enrichment.

### G7. Biomarkers and longitudinal omics (2)
- Skills: 24 disease-progression-longitudinal; 28 elastic-net-biomarker-panel [name only].
- Triggers: longitudinal patient omics, pseudotime, fast vs slow progressors (24; needs >=10 patients with >=3 timepoints).

### G8. Single-cell and regulatory networks (2)
- Skills: 9 cell-cell-communication [name only]; 38 grn-pyscenic [name only].
- Triggers: not stated in text. Catalogue category only (Transcriptomics). Note that the single-cell assumption is from the names, not the text.

### G9. Epigenomics (ChIP-Atlas) (3)
- Skills: 16 chip-atlas-target-genes; 14 chip-atlas-diff-analysis [name only]; 15 chip-atlas-peak-enrichment [name only].
- Triggers: target genes of a TF from public ChIP-seq (16). Skill 16 says to use chip-atlas-peak-enrichment to find which TFs bind near your genes; not for histone marks, offline work or raw FASTQ/BAM.

### G10. Human genetics and variants (6)
- Skills: 18 clinical-variant-allelic-series; 8 cancer-cohort-genomics [name only]; 31 fine-mapping-susie [name only]; 36 genetic-constraint-gating [name only]; 37 genetic-variant-annotation [name only]; 39 gwas-to-function-twas [name only].
- Triggers: one gene symbol to get all ClinVar/CIViC alleles tiered by actionability (18; no variant calling, no patient genotype interpretation, not a replacement for AMP/ASCO/CAP or ACMG guidance, human only).

### G11. Long-read genomics (2)
- Skills: 48 long-read-structural-variants; 47 long-read-assembly [name only].
- Triggers: aligned, sorted, indexed ONT/PacBio BAM for dual-caller SV comparison (48; alignment and read QC are upstream).

### G12. Immune and cell-therapy analysis (4)
- Skills: 11 cell-therapy-car-design; 40 immune-repertoire-airr; 12 cell-therapy-qc-scorecard [name only]; 32 flow-cytometry-analysis [name only].
- Triggers: "Design a CD19 CAR construct" (4-1BB and CD28 versions, GenBank/codon-optimized DNA), "run MAGeCK on a T-cell CRISPR screen" (11); TCR/BCR clonality, diversity, V/J usage, overlap from called clonotypes (40; no SHM lineages, no FASTQ assembly).

### G13. Experimental and clinical-trial design (2)
- Skills: 17 clinical-trial-design-simulation; 30 experimental-design-statistics [name only].
- Triggers: power and operating characteristics of a two-arm confirmatory design from assumptions (17; not completed-trial analysis, multi-arm/platform, Bayesian, dose-finding, basket/umbrella).

### G14. Clinical evidence synthesis and literature (4)
- Skills: 19 clinicaltrials-landscape; 29 evidence-synthesis-meta-analysis; 45 literature-deep-review [name only]; 46 literature-review [name only].
- Triggers: bounded map of registered ClinicalTrials.gov records for a declared condition query (19; not exhaustive asset or pipeline inventories); pool effect estimates across studies, forest/funnel plots (29; not single-arm proportion, network, IPD or diagnostic-accuracy meta-analysis). Skill 41 names literature-review for "pure literature synthesis".

Counts: G1 3, G2 4, G3 4, G4 3, G5 4, G6 7, G7 2, G8 2, G9 3, G10 6, G11 2, G12 4, G13 2, G14 4 = 50.

Weak groups: G7, G8 and G10-G14 have mostly index-only members. Fourteen groups may be more than the later agent wants; the natural merges are G7 into G6, G8 into G6, G11 into G10, G13 into G14 (this is the proposer's suggestion, not the text's).

## 3. What the text does not say

1. **Index-only skills (24)**: no scope, inputs, outputs, triggers, thresholds or licences were shown. Anything about them beyond the name and category is unknown here; their packages live on the hub Files tab.
2. **Routing between groups**: the text names some hand-offs (listed above) but gives no routing table. Group names and triggers are the proposer's synthesis of each skill's own "when to use" lines.
3. **Skills not in this scope are referenced** by name inside the text (for example scrnaseq-scanpy-core-analysis, scrnaseq-seurat-core-analysis, spatial-transcriptomics, scrna-disease-drug-discovery, genetic-target-hypothesis, open-targets, r-group-decomposition, molecular-dataset-qc, molecular-property-admet, pdf-report-generation, literature-review). Whether they sit in skills 51-100 or elsewhere was not checked here.
4. **Runtime availability**: many Overviews assume Biomni infrastructure (HPC tools via `biomni.tool`, GenerateImage, LiteratureSearch, /mnt/results, a data lake, pdf-report-generation, Phylo-branded PDFs). The text does not say which of these exist in GLHF, so none can be assumed.
5. **Network and cost**: several skills fetch at run time (ChEMBL, ClinicalTrials.gov, NCBI, CELLxGENE Census, GEO, IEDB web API, ChIP-Atlas, PDB). The text does not give costs, rate budgets (beyond NCBI 3 vs 10 req/s in skill 18) or an offline mode except where stated (skill 19 offline CSV; skill 1 has no network-free demo). Skill 2 states that without a local NetMHCIIpan it sends the input VH/VL sequences to iedb.org.
6. **GPU/compute**: skills 3 and 35 (REINVENT) use HPC/GPU tools; skills 4 and 41 give modest runtime figures only. No uniform compute requirement is stated.
7. **Licences**: only the flags in the table are stated. "none stated" does not mean cleared. The Overviews defer full source-by-source licence detail to DATA_SOURCES.md / license-notes.md files that are not reproduced. Skills 21, 41 and 22 are the most explicit about commercial-review status; skills 4, 10 and 42 carry CC BY-SA share-alike duties.
8. **Evaluation**: the text gives no benchmark scores for these skills and no statement of how well any works; validation claims quoted (for example skill 18 validated on BRAF, KIT, STK11) are the skills' own.
9. **Skill 11 caution**: the text describes a "read-driven library reconstruction" technique for when a screen's guide-to-gene table is paywalled or missing and calls it "the paywall-circumventing technique". The text does not discuss terms of use or the repo rule on data sources; a later agent should review that before adopting it.
10. **Benchmark rule**: the text does not address the AGENTS.md rules (no answer sources, doc-only search allow-list). Skills that call literature search or web data (11, 18, 19, 21, 29, 41, 42 and the index-only literature skills) would need checking against those rules before use in a benchmark solver.
11. **Thresholds** quoted in the text exist (for example skill 20: >=15 samples, 5,000-15,000 variable genes; skill 24: >=10 patients, >=3 timepoints; skill 35 consensus rejection at 5 of 9 expert sets; skill 50 Lilly demerit cutoff 100, NIBR severity 10; skill 48 support ceil 10%). They are recorded here only where cited above; check the Overview before reusing any number.
