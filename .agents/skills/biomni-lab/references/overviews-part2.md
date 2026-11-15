Part 2 of 2 · Skills 51–100 · Copied November 14, 2026

Full Overview instructions for all 100 skills listed in the Biomni Skill Hub. Original wording and code text are preserved as displayed. Supporting scripts, datasets, and reference-file contents are not reproduced; open each source skill’s Files tab for those package materials.

Return to Part 1: https://docs.google.com/document/d/1F6eZ9oHG0Qn1hD0cYlwPeWf7xdJbmSR5ugG5HR-GfBw/edit
Skill Hub: https://biomni.phylo.bio/skills

51. mendelian-randomization-twosamplemr
Category: GENOMICS & GENETICS
Source: https://biomni.phylo.bio/skills/skill_6655c68c5e9249eba44e6519b7c0b11e?section=marketplace

Two-Sample Mendelian Randomization
When to Use This Skill
You have GWAS summary statistics for an exposure and outcome trait
You want to test causal direction between two traits (not just correlation)
You need to assess whether an observed association is likely causal or confounded
You want to use genetic variants as instrumental variables (natural experiment)
You have OpenGWAS trait IDs or your own GWAS summary statistics files

Not suitable for: One-sample MR (individual-level data), non-linear MR, multivariable MR with >2 exposures

Installation
install.packages(c("remotes", "ggplot2", "ggprism", "dplyr", "rmarkdown"))
remotes::install_github("MRCIEU/TwoSampleMR")
# For packaged RMarkdown PDF fallback:
# install.packages("tinytex"); tinytex::install_tinytex()
# For MR-PRESSO outlier detection (optional but recommended):
# remotes::install_github("rondolab/MR-PRESSO")
Software    Version    License    Commercial Use
TwoSampleMR    ≥0.5.6    GPL-3    ✅ Permitted
ieugwasr    ≥0.2.1    MIT    ✅ Permitted
ggplot2    ≥3.4.0    MIT    ✅ Permitted
ggprism    ≥1.0.3    GPL (≥3)    ✅ Permitted
dplyr    ≥1.1.0    MIT    ✅ Permitted
rmarkdown    ≥2.20    GPL-3    ✅ Permitted
Inputs

Option A — OpenGWAS IDs (recommended):

Exposure ID (e.g., "ieu-a-300" for LDL cholesterol)
Outcome ID (e.g., "ieu-a-7" for coronary heart disease)
Browse available traits at: https://gwas.mrcieu.ac.uk/

Option B — User-provided files (CSV/TSV):

Exposure GWAS summary statistics
Outcome GWAS summary statistics
Required Column    Description    Example
SNP    rsID    rs1234567
beta    Effect estimate    0.05
se    Standard error    0.01
pval    P-value    5e-10
effect_allele    Effect allele    A
other_allele    Other allele    G
eaf    Effect allele frequency (optional)    0.3
Outputs

Results (CSV):

mr_results.csv — MR estimates from all 4 methods (beta, SE, p-value, nSNP, F-statistics)
heterogeneity_results.csv — Cochran's Q test for instrument heterogeneity
pleiotropy_results.csv — MR-Egger intercept test for directional pleiotropy
directionality_results.csv — Steiger test confirming causal direction
harmonized_data.csv — SNP-level harmonized exposure-outcome data
single_snp_results.csv — Per-SNP Wald ratio estimates
leaveoneout_results.csv — Leave-one-out robustness estimates
MR-PRESSO outlier results (if heterogeneity significant and MRPRESSO installed)

Plots (PNG + SVG):

mr_scatter_plot — SNP-exposure vs SNP-outcome with method regression lines
mr_forest_plot — Individual + combined SNP effect estimates
mr_funnel_plot — Precision vs effect size (asymmetry = pleiotropy)
mr_leaveoneout_plot — Effect stability when removing each SNP

Report:

mr_report.pdf — PDF report created with pdf-report-generation; packaged RMarkdown output is a fallback if the dedicated reporting skill is unavailable

Analysis objects (RDS):

mr_object.rds — Complete analysis (results, sensitivity, harmonized data)
Load with: mr_obj <- readRDS("mr_results/mr_object.rds")
Report Packaging

When the user requests a PDF report, run the analysis first, then load and use the Biomni pdf-report-generation skill for the final PDF deliverable. Build the PDF from this skill's markdown summary, result tables, and generated figures, and save it using the PDF filename listed in Outputs, or a stable descriptive filename when Outputs does not define one.

Keep this skill focused on scientific workflow and artifact content. Do not add custom figure appearance or report layout instructions here; those are handled by the platform prompt and dedicated reporting skills. If pdf-report-generation is unavailable, use the packaged markdown/HTML/script fallback when present and clearly disclose the fallback.

Clarification Questions

Input Data (ASK THIS FIRST):

Do you have specific GWAS summary statistics or OpenGWAS trait IDs?
If files uploaded: Are these the exposure and outcome GWAS files?
Expected formats: CSV/TSV with SNP, beta, se, pval, effect_allele, other_allele
Or use example data? LDL Cholesterol → Coronary Heart Disease demo (drug-target validation example)

Exposure and Outcome:

(If using example data) Pre-set: Exposure = LDL Cholesterol, Outcome = Coronary Heart Disease — no need to specify
(If using your own data) What is the exposure (potential cause)? What is the outcome (potential effect)?

Parameters (defaults usually fine):

P-value threshold for instruments? (default: 5×10⁻⁸)
LD clumping r²? (default: 0.001)
Standard Workflow

🚨 MANDATORY: USE SCRIPTS EXACTLY AS SHOWN — DO NOT WRITE INLINE CODE 🚨

Step 1 — Load and harmonize data:

source("scripts/load_data.R")
dat <- load_example_data()
# OR: dat <- load_from_opengwas("ieu-a-300", "ieu-a-7")
# OR: dat <- load_from_files("exposure.csv", "outcome.csv")

DO NOT write inline data loading or harmonization code. Use the functions above.

✅ VERIFICATION: You MUST see "✓ Data loaded and harmonized successfully!"

Step 2 — Run MR analysis:

source("scripts/run_mr_analysis.R")
mr_results <- run_mr(dat)
sensitivity <- run_sensitivity(dat, mr_results)

DO NOT write inline MR code. Just source the script and call the functions.

✅ VERIFICATION: You MUST see "✓ MR analysis completed successfully!" AND "✓ Sensitivity analyses completed successfully!"

Step 3 — Generate visualizations:

source("scripts/mr_plots.R")
generate_all_plots(mr_results, dat, sensitivity$singlesnp, sensitivity$leaveoneout, output_dir = "mr_results")

🚨 DO NOT write inline plotting code (ggsave, ggplot, etc.). Just use the function. 🚨

✅ VERIFICATION: You MUST see "✓ All MR plots generated successfully!"

Step 4 — Export results and generate report:

source("scripts/export_results.R")
export_all(mr_results, sensitivity, dat, output_dir = "mr_results")

DO NOT write custom export code. Use export_all() for packaged tables, plots, and fallback reports, then use pdf-report-generation for the final PDF when requested.

✅ VERIFICATION: You MUST see "✓ Report generated successfully!" AND "=== Export Complete ==="

❌ IF YOU DON'T SEE VERIFICATION MESSAGES: You wrote inline code. Stop and use the scripts.

⚠️ CRITICAL — DO NOT:

❌ Write inline MR analysis code → STOP: Use run_mr() and run_sensitivity()
❌ Write inline plotting code → STOP: Use generate_all_plots()
❌ Write custom export code → STOP: Use export_all()
❌ Write custom report code → STOP: Use pdf-report-generation for the final PDF; packaged report scripts are fallback only
❌ Try to install system dependencies → Scripts handle package installation

⚠️ IF SCRIPTS FAIL — Script Failure Hierarchy:

Fix and Retry (90%) — Install missing R package, re-run script
Modify Script (5%) — Edit the script file, document changes
Use as Reference (4%) — Read script, adapt approach, cite source
Write from Scratch (1%) — Only if genuinely impossible, explain why
Common Issues
Issue    Cause    Solution
"No instruments found"    No SNPs below p-value threshold    Try a less stringent threshold or check trait ID
LD clumping API fails    OpenGWAS/IEU API temporarily down    Script falls back to no clumping with warning; results may be affected by LD
"Only N SNPs retained"    Allele harmonization removed most SNPs    Check if exposure/outcome are from same genome build
Steiger test fails    Sample sizes unavailable in metadata    Normal for some datasets; other sensitivity tests still valid
SVG export error    Missing optional dependency    Normal — generate_all_plots() falls back to base R svg() automatically
OpenGWAS rate limiting    Too many API requests    Wait a few minutes and retry
PDF report fails    Dedicated report generation unavailable or rendering failed    Use packaged HTML/markdown/base R fallback and disclose it
Steiger R² warning for binary outcome    Outcome is case-control, not quantitative    Use get_r_from_lor() with prevalence to compute liability-scale R² before directionality test
MR-PRESSO not available    MRPRESSO package not installed    remotes::install_github('rondolab/MR-PRESSO') — optional but recommended when heterogeneity is significant
"Cannot find function"    Script not sourced    Run source("scripts/load_data.R") before calling functions
Interpreting Results

See references/interpretation-guide.md for detailed guidance.

Quick interpretation:

Concordant methods (IVW, Egger, WM, WMode agree on direction + significance) → stronger evidence
Any method non-significant or discordant → must be discussed explicitly, not dismissed
IVW significant + no heterogeneity + no pleiotropy → strongest evidence
Egger intercept p < 0.05 → directional pleiotropy may bias IVW
High heterogeneity (Q p < 0.05) → run MR-PRESSO, flag outlier instruments
Steiger direction incorrect → reverse causation concern (check binary outcome R² correction)
F-statistic < 10 → weak instrument bias toward the null
Suggested Next Steps
Multiple exposures? → Run bidirectional MR (swap exposure/outcome)
Pleiotropy detected? → Consider MR-PRESSO or multivariable MR
Significant result? → Replicate with independent GWAS datasets
Drug target validation? → Use cis-MR with variants near gene of interest
Pathway analysis? → Combine with functional enrichment skills
Related Skills
polygenic-risk-score — Polygenic risk score computation (LDpred2)
polygenic-risk-score-prs-catalog — PRS from pre-computed PGS Catalog weights
eqtl-colocalization-coloc — eQTL colocalization analysis (MR follow-up)
References
Sanderson E, et al. (2022). Mendelian randomization. Nat Rev Methods Primers. PMC7384151
Hemani G, et al. (2018). The MR-Base platform supports systematic causal inference across the human phenome. eLife. DOI: 10.7554/eLife.34408
TwoSampleMR package: https://github.com/MRCIEU/TwoSampleMR
OpenGWAS database: https://gwas.mrcieu.ac.uk/
STROBE-MR guidelines: https://doi.org/10.1001/jama.2023.1788

52. methods-landscape-review
Category: LITERATURE
Source: https://biomni.phylo.bio/skills/skill_685b09d4f2d509ab9198bf01121d7c7d?section=marketplace

Comparative Methods & Benchmark Landscape

Turn a fuzzy "which method should I use?" or "what does the literature say about X?" into a decision-complete, citation-honest PDF grounded in the published record. This skill generalizes a benchmark-synthesis workflow: retrieve → screen → extract → verify every claim → visualize → recommend → report.

This skill is search + synthesis + structured reporting, not an analysis that runs the methods on data. It tells the user which method to use and why, and points them to the Biomni resources/skills that actually run the chosen method.

When to Use This Skill

Trigger on requests like:

Comparison mode (primary): "Compare DESeq2 vs edgeR vs limma-voom", "which aligner should I use for RNA-seq?", "benchmark batch-integration methods for scRNA-seq", "pros/cons of Harmony vs scVI", "best variant caller for long reads", "methods landscape for imputation".
Topic mode: "synthesize the evidence on ambient-RNA removal in droplet scRNA-seq", "state of the art in spatial deconvolution", "what does the literature say about X".

If the request names competing methods/tools OR asks which to use for a task → comparison mode. If it asks to survey/summarize a topic without a method-vs-method framing → topic mode. If ambiguous, ask one short clarifying question.

Do not use this skill to actually execute a method on the user's data — hand off to the relevant sibling skill for that (see Step 7).

Scope
Does: multi-query literature retrieval, PRISMA-style screening, method/benchmark/claim extraction, a blocking citation-verification gate, data-driven + conceptual figures, a Biomni-resource inventory.
Does NOT: run the compared methods on data, download datasets for analysis, fabricate any number or citation, or re-implement PDF chrome (that is delegated to pdf-report-generation).
Inputs
A task / question (free text). For comparison mode, optionally an explicit set of candidate methods/tools; if not given, propose a canonical set and confirm with the user.
Optional scope boundaries (e.g., "bulk RNA-seq only; not single-cell"), and optional retrieval filters (year range, study type, journal quartile, human-only, min sample size).
Outputs (all under /mnt/results/<run_dir>/)
references.jsonl (structured retrieved records; written by LiteratureSearch to /mnt/results/execution_trace/references.jsonl) + a consolidated corpus.csv.
screening_log.csv, and for comparison mode: comparison_matrix.csv, benchmark_catalog.{json,csv}, performance_claims.{json,csv}; for topic mode: evidence_table.csv.
citation_verification.json (reports doi_layer_status: clean / partial / failed).
Figures (.png + .svg) + fig_manifest.csv, and one infographic (.png).
Final report_<slug>.pdf.
Workflow

Run steps in order. Create a run directory first, e.g. RUN=/mnt/results/methods_landscape_<slug> and mkdir -p $RUN. All scripts live in this skill's scripts/; reference docs in references/.

Step 0 — Align (brief)

Confirm mode, candidate methods (comparison mode), scope boundaries, and depth (abstract-level vs. targeted full-text on pivotal benchmarks). Keep it to 1–2 questions; if the user already gave enough, proceed.

Step 1 — Plan queries (anti-recency-bias)

python scripts/plan_queries.py --task "<task>" --methods "<m1,m2,...>" --mode <comparison|topic> --out $RUN/queries.json Produces a multi-query set: foundational/tool papers, benchmark/comparison papers, and recent advances. Do NOT over-restrict year_min — foundational method papers are often 2009–2014 and must not be filtered out (a real failure mode: recency-biased search buries the classics). See references/citation_integrity.md.

Step 2 — Retrieve (LiteratureSearch-first)

Use the Biomni LiteratureSearch tool for each planned query (it writes structured records + abstracts to /mnt/results/execution_trace/references.jsonl). Then consolidate & dedup: python scripts/retrieve_literature.py --refs /mnt/results/execution_trace/references.jsonl --out $RUN/corpus.csv (optional: --curated curated_records.json to fold in any hand-added records).

Retrieval is peer-reviewed-first. WebSearch/WebFetch are allowed only to read the full text of an already-identified paper (for exact numbers), never as the primary discovery channel — this keeps every citation grounded in a retrieved record.
Expose optional filters (year, study type, sjr_max, human, sample_size_min).
Step 3 — Screen & extract

python scripts/screen_and_extract.py --corpus $RUN/corpus.csv --task "<task>" --methods "<...>" --mode <...> --out $RUN

PRISMA-style include/exclude with reasons → screening_log.csv.
Comparison mode → per-method extraction, benchmark_catalog, and performance_claims tagged by evidence thickness (head_to_head > multi_benchmark > single_benchmark).
Topic mode → evidence_table.csv (theme, finding, study type, effect, citation). For the topic-mode figures (Step 6), also derive theme_table.csv by aggregating the populated evidence_table.csv per theme (theme, n_papers[, consensus_level, evidence_quality]).
Schemas: references/schemas.md.
Step 4 — Targeted full-text (optional, pivotal only)

For the handful of pivotal benchmark/keystone papers, read full text via WebFetch to pull exact numbers (sample sizes, FDR, concordance, effect sizes). Record each number with its source DOI into the performance_claims / evidence_table. Do not scale this to the whole corpus.

Step 5 — CITATION-VERIFICATION GATE (mandatory, blocking)

python scripts/verify_citations.py --run $RUN --refs /mnt/results/execution_trace/references.jsonl --transcript /mnt/results/execution_trace/transcript.jsonl

Confirms every quantitative value AND every citation field (title, authors, year, journal, DOI, accession/NCT) against the retrieved records, and re-checks against the working transcript.jsonl (essential after a session has been compacted). See references/citation_integrity.md.
Emits citation_verification.json with doi_layer_status ∈ {clean, partial, failed} and a list of any dropped/flagged items. Exits non-zero when status is not clean/empty, so it acts as a real blocking gate — do not proceed to the report until it returns clean (or partial with every remaining flag consciously resolved).
The gate flags a genuinely unverifiable DOI or a fabricated full title, but does not false-flag legitimate short-form citation labels (e.g. "Schurch et al. 2016") in the defining_paper/source fields.
Any claim that cannot be verified is dropped or explicitly flagged — never guessed. Titles in particular must be copied verbatim from the record, never paraphrased (a known post-compaction failure is a correct DOI paired with an invented title).
Step 6 — Figures (data-driven) + infographic (GenerateImage)

Rscript scripts/make_figures.R --run $RUN (Python fallback: python scripts/make_figures.py --run $RUN). Mode is auto-detected from which artifacts exist (comparison-mode vs theme_table.csv); an optional --title-prefix "..." prepends a label to every figure title. Each script writes .png+.svg plus a fig_manifest.csv (file, mode, caption).

Comparison mode: comparison-matrix heatmap, ordinal performance scorecard (label it explicitly as a qualitative synthesis of published findings, not re-measured metrics), benchmark-design catalog, evidence-thickness distribution, method/benchmark timeline, and any quantitative head-to-head panel the evidence supports.
Topic mode: theme map, evidence-quality panel, timeline.
After each figure, run Read followed by direct visual inspection; regenerate on failure.
Infographic: build the one-page conceptual summary with the GenerateImage tool (task, contenders, headline tradeoffs, decision rule) — do NOT hand-draw it in matplotlib/ggplot. A prompt template is in references/reporting_notes.md.
Step 7 — Inventory Biomni resources (deep)

Start from references/biomni_resources_catalog.md; verify packages with direct imports and HPC tools with hpc_search_tools. Use Skill to find sibling skills relevant to the task. Produce a short "Relevant Biomni resources & how to run this" mapping, and cross-reference the sibling skill(s) that actually execute the recommended method (e.g., DE-tool comparison → bulk-rnaseq-differential-expression, bulk-rnaseq-counts-to-de-deseq2, functional-enrichment-from-degs; enrichment topic → pathway-enrichment; scRNA integration → scrnaseq-scanpy-core-analysis).

Licensing / commercial-use policy (mandatory). Apply the licensing policy in references/biomni_resources_catalog.md (§0) to every resource you would recommend, including anything found during direct runtime verification. Exclude non-commercial [NC] resources (e.g. KEGG, DisGeNET, OMIM, DrugBank) from the recommendation and add a one-line note that they were omitted for commercial-licensing reasons (do not curate a substitute). Recommend ShareAlike [SA] resources (e.g. ChEMBL, Human Protein Atlas, PharmGKB) only with an explicit ShareAlike/attribution caveat. Untagged resources are permissive and may be recommended normally.

Step 8 — Assemble the PDF

Use pdf-report-generation unless otherwise specified, with the verified evidence, references, figures, tables, infographic, retrieval and verification methods, regime-conditional decision guidance, limitations, next steps, and relevant Biomni resources. Every scientific statement must already be source-bound and past the Step 5 gate.

Validate: pypdf structural check (page count, extractable text) and a direct visual inspection with Read of the final PDF. Fix and re-check on any failure.
Scientific Caveats & Integrity Rules
No unconditional "winner." Method recommendations are regime-conditional (sample size, data quality, design). State the conditions.
Present genuine disagreements as disagreements, not resolved facts (e.g., a debated benchmark recommendation should show both sides with citations).
Every figure value traces to a specific paper. Ordinal scorecards are qualitative syntheses and must be labeled as such — never presented as re-measured metrics.
Citation honesty is non-negotiable (Step 5). Report the real doi_layer_status. Copy titles verbatim from records. Prefer dropping a claim over guessing.
Benchmarks have caveats (self-referential gold standards, simulation assumptions, permutation nulls, preprocessing sensitivity) — surface them.
Failure Modes to Avoid
Recency-biased retrieval that buries foundational papers (mitigate in Step 1).
Hallucinated/paraphrased citation fields after compaction (mitigate in Step 5 + transcript re-check).
Empty/placeholder figure panels or noisy auto-extracted tokens (mitigate with the media check in Step 6; prefer curated, source-bound values over raw abstract mining).
Over-restricting year_min or study-type filters and starving the corpus.
Environment Notes
Python: reportlab, pypdf, pandas, requests (all preinstalled). R: ggplot2, ggprism, dplyr, tidyr, patchwork, ggrepel, RColorBrewer (preinstalled).
Compute is trivial (API calls + light plotting + PDF). Runs on the default sandbox; no GPU/HPC needed.
R file.copy() to /mnt/results yields 0-byte files — write figures directly to /mnt/results/... or stage in /workspace then shell cp.

53. microbiome-analysis
Category: FUNCTIONAL ANALYSIS
Source: https://biomni.phylo.bio/skills/skill_fd517e4fafbb82ec7030a849e0ea0c23?section=marketplace

16S Microbiome: Differential Abundance + Predicted Function + Metabolite Inference

A modular, adaptive workflow. The stages below are independent — ask the user which they want and run only those. A user with two 16S groups who wants "differentially abundant genera" needs only Stage 1–2; someone asking about SCFA capacity needs Stage 3–4; a full study report needs all of it plus the report stage.

Scope
Does: two-group 16S comparison — community diversity, taxa differential abundance (3-method consensus), PICRUSt2 predicted function, curated microbial metabolite module inference, literature grounding, and a branded PDF report with an infographic.
Does NOT: raw-read processing (DADA2/Deblur), public-data acquisition, shotgun metagenomics, >2-group / continuous-outcome designs (extendable, not default), or functional validation. Metabolite modules are predicted genomic potential, never measured metabolites.
Inputs (entry point)

Assume the user already has processed data:

Input    Format    Used by
Feature table    TSV, features × samples, integer counts; first-col header #OTU ID for PICRUSt2    all stages
Representative sequences    FASTA, headers = feature IDs    PICRUSt2 (Stage 3)
Taxonomy    TSV, feature ID + ranks (Kingdom…Genus/Species)    Stage 2
Sample metadata    TSV, first col = sample ID; must include a 2-level group column; ideally subject ID + covariates    all stages
Phylogenetic tree (optional)    Newick    Faith's PD + UniFrac

If the user lacks processed data, tell them raw processing is out of scope and point them to DADA2/Deblur first (or a public accession + QIIME2). If they only have a raw-read accession, note that read QC/assembly-adjacent tooling exists in the Biomni HPC cluster (FastQC/MultiQC, and QIIME2-style upstream steps are still their responsibility) — see references/biomni_resources.md.

Outputs

CSV tables + PNG/SVG figures under results/ (or /mnt/results/... for user-facing deliverables), and an optional PDF report with an infographic summary page. Save durable deliverables to /mnt/results; keep heavy intermediates (PICRUSt2 output) on /mnt/shared-workspace.

Bundled assets
scripts/da_diversity.R — Stage 1–2 (alpha LMM, beta PERMANOVA, 3-method DA consensus). R-first.
scripts/functional_da.R — Stage 3 functional DA (ALDEx2 on the EC unstratified table by default).
scripts/metabolite_modules.py — Stage 4 metabolite module scoring (EC-keyed; route-split, EC:1.3.1.114 excluded, bai gated off, domination audit; off-by-default academic KO mode).
scripts/build_report.py — reusable Phylo-branded PDF module (implements the pdf-report-generation skill's patterns; adds an infographic page, a references block, and a next-steps block).
references/metabolite_modules.md + references/metabolite_modules_ec.csv — EC-keyed metabolite module sets + the EC:1.3.1.114 exclusion rationale + bai gating + interpretation guardrails.
references/DATA_SOURCES.md — licensing & attribution: why KEGG was removed (not licensed for commercial use), why EC/PICRUSt2 defaults are used, MetaCyc/eggNOG notes, and the academic KO opt-in.
references/commands_and_environment.md — install recipes, OOM-safe PICRUSt2 command, machine sizing, FUSE gotchas, preinstalled-package notes, free EC verification recipe.
references/biomni_resources.md — which Biomni-installed tools, databases, and packages this skill uses at each stage, and how to discover more.

Edit the CONFIG block at the top of each script (file paths, group column, reference level, subject column, covariates, thresholds) — they are templates, not hardcoded to any dataset.

Use the Biomni environment, don't reinvent it

This skill runs inside Biomni/Phylo, which ships a large catalog of tools, databases, and packages. Prefer them over ad-hoc installs. Two rules:

Discover before assuming. Start from references/biomni_resources.md. Verify Python packages with imports, R packages with requireNamespace(), and upstream HPC tools with hpc_search_tools.
Route external knowledge through the right tool. Use LiteratureSearch (not model memory) for any background/mechanistic/citation claim. Verify or refresh the module EC numbers against a free enzyme database (ExplorEnz / IUBMB Enzyme Nomenclature / Rhea) before trusting a module definition. Do not use KEGG — it is not licensed for commercial use (see DATA_SOURCES.md).

Key preinstalled resources this skill leans on (verify directly): Python scikit-bio (diversity metrics, ordination), biom-format (BIOM I/O), gseapy (optional EC/pathway gene-set enrichment), statsmodels/scipy (tests, FDR), reportlab/pypdf/pillow (PDF); R phyloseq, ComplexHeatmap, clusterProfiler, ggplot2/ggprism; free enzyme databases (ExplorEnz/IUBMB/Rhea) for EC verification; and the HPC read-alignment/assembly tools for any upstream work the user may need. Bioconductor stats packages (ANCOM-BC2, ALDEx2, MaAsLin2) are installed per references/commands_and_environment.md.

Language

R-first for statistics (phyloseq, ANCOM-BC2, ALDEx2, MaAsLin2, lme4/vegan). Python only where required: PICRUSt2 CLI orchestration, metabolite-module scoring, scikit-bio diversity helpers, and the reportlab PDF. The metabolite-module math is language-agnostic (a small R port is trivial if the user insists on all-R).

Workflow
Step 0 — Clarify, discover resources, and inspect (always)
Confirm the two groups and which is the reference/control level.
Confirm repeated measures: do subjects contribute multiple samples? If yes, you MUST use subject random effects / subject-level permutation / subject-mean tests — never treat samples as independent. Identify the subject-ID column.
Confirm covariates to adjust for (sex, BMI, sequencing run, etc.).
Ask which stages the user wants (diversity / taxa DA / function / metabolites / literature grounding / report).
Discover environment resources with the direct checks in references/biomni_resources.md so you use installed packages/databases instead of assuming or re-installing.
Inspect the feature table (dims, integer counts?), metadata columns and group sizes, and whether a tree is available. Report the number of independent subjects per group, not just sample counts — small subject counts (e.g. few healthy controls) drive the main caveat.
Step 0.5 — Literature grounding (optional but recommended; feeds intro + references)

Use the LiteratureSearch tool (never model memory) to build the evidence base the report's Introduction, interpretation, and References sections draw on. Do this once up front so later mechanistic claims are already grounded.

Background/context queries, e.g. "gut microbiome dysbiosis <disease>", "16S microbiome <disease> case control". Prefer human studies for clinical framing; use sjr_max/study_types to bias toward strong evidence.
Mechanistic queries to support Stage-4 interpretation, run only for the axes your data actually implicates: butyrate → "butyrate regulatory T cells HDAC GPR43 intestinal"; indole/AhR → "indole aryl hydrocarbon receptor IL-22 intestinal barrier"; bile acids → "secondary bile acids gut microbiome".
Method citations if asked: ANCOM-BC2, ALDEx2, MaAsLin2, PICRUSt2, PERMANOVA.

LiteratureSearch writes structured records (authors, journal, DOI, year) to /mnt/results/execution_trace/references.jsonl. Cite with inline [N] and carry the same references into the PDF's References section. Do not fabricate citations; if a claim isn't supported by a retrieved paper, mark it as hypothesis or omit it. For current, non-paper context (e.g. a database version), WebSearch/WebFetch are the right tools instead.

Step 1 — Community diversity (optional)

Run da_diversity.R (alpha + beta portions). Defaults:

Alpha: rarefy (default depth 10,000), compute Observed / Shannon / InvSimpson (+ Faith's PD if a tree is attached). Test with a linear mixed model (subject random effect) when repeated measures; add subject-mean Wilcoxon as a sensitivity check. BH-correct across metrics.
Beta: Bray-Curtis (+ unweighted/weighted UniFrac if a tree is attached); PERMANOVA (adonis2) with subject-blocked permutation, plus a one-sample-per-subject baseline for robustness.
The R path uses phyloseq/vegan. If you prefer Python for ordination/diversity, scikit-bio gives the same metrics (skbio.diversity.alpha_diversity, beta_diversity, pcoa) and permanova; results should agree — pick one and state it.
Interpretation cue: if presence/absence distances (unweighted UniFrac, Observed richness) separate groups more than abundance-weighted ones, the signal is loss of rare taxa rather than dominance shifts.
Step 2 — Differential abundance of taxa (optional)

Run the DA portion of da_diversity.R. Three-method consensus:

ANCOM-BC2 (primary; subject random effect; covariate-adjusted),
ALDEx2 (CLR; Welch + Wilcoxon),
MaAsLin2 (TSS/log linear model; covariates + subject).
Prevalence filter (default ≥10%). A genus is a consensus hit when flagged significant by ≥2 methods with concordant direction. Report LFC/effect/coef side by side. BH-FDR, q<0.05 default (offer 0.01 / 0.1).
Visualize with ggplot2 (LFC forest/bar); for a taxa×sample abundance heatmap, R ComplexHeatmap is installed.
Step 3 — PICRUSt2 predicted function (optional; compute-heavy)

See references/commands_and_environment.md for the exact recipe.

Install PICRUSt2 in its own env (picrust2=2.5.2).
Run WITHOUT --stratified (the stratified flag OOM-killed a 32 GB machine in prior use). Command: micromamba run -n picrust2 picrust2_pipeline.py -s <seqs.fasta> -i <table.tsv> -o picrust2_out -p 4 --max_nsti 2.0 --verbose
Provision ≥32 GB (64 GB for large ASV counts) via ManageMachine before this step; placement peaked ~14 GB on ~7.5k ASVs. Memory scales with ASV count.
Report mean weighted NSTI as a QC metric (<0.15 = reliable; a prior run hit 0.073).
Back up PICRUSt2 outputs to /mnt/shared-workspace immediately.
PICRUSt2 outputs EC numbers by default (EC_metagenome_out/...); that is the license-clean feature space this skill uses. (KO output is optional and only for academic users covered by KEGG's terms — see DATA_SOURCES.md; not the default.)
Functional DA: run functional_da.R (ALDEx2) on the EC unstratified table. Expect a very large number of significant gene families — they reflect correlated, community-wide taxonomic shifts, not many independent changes. Emphasize curated gene-set direction (Step 4) over raw counts.
Optional: EC/pathway gene-set enrichment on the ranked functional table with gseapy (preinstalled) — treat as descriptive, given the correlated-shift caveat.
Step 4 — Inferred microbial metabolites (optional; the distinctive core)

Run metabolite_modules.py. Read references/metabolite_modules.md first. Modules are keyed on EC numbers (PICRUSt2's default output), not KEGG/KO. Before trusting any EC→reaction mapping, verify it against a free enzyme database (ExplorEnz / IUBMB Enzyme Nomenclature / Rhea) — the bundled CSV was built this way; refresh it the same way if you extend the modules. Do not use KEGG (not licensed for commercial use; see DATA_SOURCES.md). Non-negotiable correctness rules (all baked into the script):

Split butyrate into two routes. but (EC:2.8.3.8/2.8.3.9, health-associated CoA-transferase) vs buk (EC:2.7.2.7 + EC:2.3.1.19, dysbiosis-associated kinase). The aggregate can look flat while the routes move in opposite directions (a "route switch"). Report the routes separately; the aggregate only alongside.
The bai (secondary bile acid) module is GATED OFF by default, and the promiscuous EC:1.3.1.114 is excluded. Two reasons the operon can't be trusted from 16S: only one of its enzymes (baiH, EC:1.3.1.116) has a clean EC while the rest have none, and 16S/PICRUSt2 cannot resolve this low-abundance operon. Additionally, the promiscuous 3-dehydro-bile-acid reductase (EC:1.3.1.114, formerly KO K07007) is ~360× more abundant than the next bai enzyme and, if present, produces a spurious secondary-bile-acid "depletion" — so it is excluded from the module. Do not report secondary bile-acid depletion from 16S prediction. Enable the module (INCLUDE_BAI=True) only with explicit low-confidence caveats.
Single-enzyme domination audit. The script prints the top-EC fraction for each multi-EC module. If one EC dominates (e.g. acetate kinase EC:2.7.2.1, shared between the acetate and propionate modules), temper the claim and note it.
Test method: subject-mean Wilcoxon (repeated measures) with BH correction (routes corrected within their own family).
Framing: predicted potential, not measured metabolites → hypothesis- generating. For gut studies, connect reduced but-route butyrate to weaker Treg induction (HDAC inhibition; GPR43/GPR109A) and impaired barrier as mechanistic context — and cite the supporting literature from Step 0.5 (LiteratureSearch), not memory.

Taxon → metabolite attribution (since we don't use stratified PICRUSt2): cross-reference the DA results (Step 2) with known metabolite-producing genera (e.g. butyrate producers: Faecalibacterium, Roseburia, Gemmiger, Coprococcus, Agathobacter, Anaerobutyricum, Anaerostipes). Directional consistency between a depleted functional route and coordinated depletion of its producer genera is a strong triangulated signal even when individual genus tests miss significance.

Step 5 — Literature-grounded PDF report with infographic (optional)

Delegate branding and layout to the pdf-report-generation skill — load it and follow its Phylo palette, typography, header/footer, table, callout, and validation conventions. scripts/build_report.py is a ready-made implementation of exactly those patterns (same colors/fonts/margins), so you can either import it or hand-build per that skill. Either way, produce the full required structure below, in order:

Infographic summary page — a one-page visual synopsis generated with the GenerateImage tool (schematic/infographic, NOT a matplotlib plot). Prompt it with the concrete study result: the two groups and n (subjects, not just samples), the headline diversity/DA finding, the number of consensus DA taxa with direction, and the metabolite-route story (e.g. but-route down / buk-route up). Keep labels factual and derived from the actual results — never invent numbers. Save as PNG and embed as the report's opening figure (or a facing summary page). build_report.py has an infographic() helper that embeds a full-width image with a caption.
Introduction / Background — 1–2 short paragraphs framing the disease/ question and why the microbiome matters, grounded in LiteratureSearch results with inline [N] citations (Step 0.5).
Methods — inputs, tools, and key parameters, including a cohort table with subject counts per group (not just samples) and the software/DB versions used.
Results — the analytical core: diversity, beta, DA (+ figure), composition (+ figures), function + metabolites (+ figure), taxon→metabolite link. Tables and captioned figures.
Conclusions / Discussion — what the results mean biologically (host-immune interpretation), with citations for mechanistic claims.
Figures — every figure captioned and co-located with its caption (see layout lessons). Data plots come from Stages 1–4; the infographic from GenerateImage.
References — the papers retrieved via LiteratureSearch, rendered as a numbered list matching the inline [N] markers. build_report.py has a references_block() helper.
Next steps — concrete follow-ups (e.g. shotgun metagenomics or targeted metabolomics to confirm predicted functions; validation of specific taxa; larger control arm). build_report.py has a nextsteps_block() helper.

Layout lessons baked into build_report.py (and consistent with pdf-report-generation):

figel() preserves image aspect ratio and wraps image+caption in KeepTogether so captions never orphan and figures never distort.
Build the story fresh each run — reportlab consumes flowables during build(); calling it twice on the same list yields a 0-byte PDF.
After building, run the direct visual inspection using ordinary Read on the PDF (or key pages, especially the infographic page) to confirm figures render, captions align, and no page is broken — regenerate if not. This is the validation step the pdf-report-generation skill requires.
Figure conventions
Data plots: seaborn/matplotlib (Python) or ggplot2 (R). Fonts "Liberation Sans"/"Arimo"/"DejaVu Sans"; svg.fonttype='none'; export PNG+SVG.
Colorblind-safe palette: two groups → control #75A025 (green) vs case #FF9400 (orange); up/down/n.s. → #FF9400 / #0279EE / #BBBBBB.
The infographic is the one figure made with GenerateImage (schematic), not a data plot — everything else is plotted from the data.
Visually inspect every figure; regenerate if blank/clipped/unreadable.
Scientific caveats (state these in outputs)
Predicted ≠ measured. PICRUSt2 = genomic potential; rare functions (bai) predicted poorly. All function/metabolite results are hypothesis-generating.
Repeated measures. Never treat multiple samples per subject as independent.
Small n. Report independent subject counts per group; flag underpowered arms.
Effect sizes. Stool case-control PERMANOVA R² is typically small (~1–3%); significant ≠ large.
Reference consistency. Keep the taxonomy reference (e.g. SILVA v138.2), the PICRUSt2 version, and the enzyme-database source/date behind the EC modules consistent and stated. (Functional analysis uses free EC numbers, not KEGG.)
EC:1.3.1.114 / route-split. The two most common ways to get a wrong metabolite conclusion (a promiscuous enzyme faking bile-acid depletion, and a masked butyrate route switch); both are guarded in the bundled script and reference.
Citations. Ground background and mechanism in LiteratureSearch results with inline [N]; do not cite from memory.

54. microplate-layout-design
Category: EXPERIMENTAL DESIGN
Source: https://biomni.phylo.bio/skills/skill_ea62d879a7384219a92cf683a8b63013?section=marketplace

Microplate Layout Design

Generate optimized well-plate layouts that minimize positional bias, handle edge effects, balance covariates, and distribute controls across the plate. Exports lab-ready plate maps (images, CSV, Excel) and educates users on common design pitfalls.

When to Use This Skill

Use this skill when you need to:

✅ Design a plate layout for any 96-well or 384-well experiment
✅ Randomize sample placement to prevent positional confounding
✅ Handle edge effects by reserving outer wells or placing controls strategically
✅ Balance covariates across plate positions (treatment, replicate, batch)
✅ Place controls optimally distributed across all plate quadrants
✅ Generate plate maps for the lab bench (images, color-coded Excel, CSV)
✅ Learn plate design principles — edge effects, pseudoreplication, randomization

Don't use this skill for:

❌ Genomics-specific power analysis (RNA-seq depth, ATAC-seq peaks) → Use experimental-design-statistics
❌ Batch assignment across experiments → Use experimental-design-statistics
❌ Analyzing plate reader data → Use assay-specific analysis skills
Installation
Required Software
Software    Version    License    Commercial Use    Installation
designit    ≥0.5.0    MIT    ✅ Permitted    install.packages('designit')
ggplot2    ≥3.3.0    MIT    ✅ Permitted    install.packages('ggplot2')
ggprism    ≥1.0.3    GPL (≥3)    ✅ Permitted    install.packages('ggprism')
jsonlite    ≥1.7.0    MIT    ✅ Permitted    install.packages('jsonlite')
pwr    ≥1.3.0    GPL (≥3)    ✅ Permitted    install.packages('pwr')
ggplate    ≥0.1.0    MIT    ✅ Permitted    install.packages('ggplate')
Optional (for enhanced output)
Software    Version    License    Commercial Use    Installation
openxlsx    ≥4.2.0    MIT    ✅ Permitted    install.packages('openxlsx')
agricolae    ≥1.3.0    GPL-2    ✅ Permitted    install.packages('agricolae')
plater    ≥1.0.0    GPL-2    ✅ Permitted    install.packages('plater')
patchwork    ≥1.1.0    MIT    ✅ Permitted    install.packages('patchwork')

Quick install:

install.packages(c("designit", "ggplot2", "ggprism", "jsonlite", "ggplate",
                    "openxlsx", "agricolae", "plater", "patchwork", "pwr"))
Inputs

Required (via define_experiment()):

plate_format — integer, 96 or 384
treatments — character vector of treatment group names (≥ 2). For dose-response assays, encode concentration in the label (e.g. "Drug_10uM", "Compound_0.316uM") so the power path and tidy export can parse it
n_replicates — integer ≥ 1, technical replicates per treatment per plate
controls — list with named elements positive, negative, blank; each is a character vector of control names or NULL
n_controls — list with named elements positive, negative, blank; each is an integer count (ignored when the corresponding controls entry is NULL)
edge_strategy — one of "controls_only", "empty", "include"
n_plates — integer ≥ 1
assay_type — one of "general", "dose_response", "qpcr", "elisa", "cell_viability"

Recommended (via define_experiment()):

n_biological — integer, number of independent preparations (defaults to n_plates if omitted; flagged as inferred in provenance)
n_technical — integer, technical replicates within a plate (defaults to n_replicates)

Optional:

Sample metadata file (CSV/TSV) — if the user supplies a metadata file, expected columns: sample_id (character), treatment (character), replicate (integer), and any covariate columns (numeric or character). The agent should map these into define_experiment() arguments rather than passing the file directly
covariates — data.frame with one row per sample, columns are covariate names
reserved_wells — data.frame with columns plate, row, col (or well) specifying wells to exclude
measurands, normalization, reference_measurands, interplate_calibrator — for ratiometric / multi-measurand designs (e.g. qPCR ddCt)
batch_design.rds from experimental-design-statistics for multi-plate experiments
Outputs

Visualizations (PNG + SVG):

plate_treatment_map — Color-coded plate layout by treatment group
plate_sample_type_map — Layout showing samples, controls, empty wells
plate_replicate_map — Distribution of replicates across the plate
plate_edge_risk — Heatmap of edge effect susceptibility
plate_quality_dashboard — Quality scores and layout summary
Multi-plate: Per-plate images (plate_treatment_map_plate1, etc.) using ggplate round wells for high quality

Data files:

plate_layout.csv — Tidy format (one row per well with all metadata; includes measurand and bio_sample columns for ratiometric/multi-measurand designs)
plate_layout_grid.csv — Plate-shaped CSV (rows = plate rows, cols = plate columns). For multi-plate designs the export writes per-plate files plate_layout_grid_plate1.csv … plate_layout_grid_plateN.csv (one grid per plate); a single plate_layout_grid.csv is written only for single-plate designs.
plate_layout.xlsx — Color-coded Excel workbook for the lab bench (export is verified non-empty; falls back to CSV-only on failure)
experiment_parameters.json — All design parameters incl. declared n_biological/n_technical, measurands/normalization, and export status (human-readable)
layout_quality_report.txt — Quality metrics, replication design with provenance, well-census breakdown (edge vs interior), co-location/power notes, recommendations, and an Export Status section
design_provenance.csv — One row per design parameter with its source (user / example_default / function_default / inferred) and derivation

Analysis objects (RDS):

layout_object.rds — Complete layout for downstream use (includes power analysis and well census)
Load with: layout <- readRDS('layout_object.rds')

Report:

analysis_report.pdf — Use the pdf-report-generation skill to generate a pdf report with infographics (use the Biomni GenerateImage tool), methods, results, conclusions, figures, references, and next steps from all of the analyses.

Power analysis outputs (requires pwr package):

power_curve.png + .svg — Power vs. replicates curve with current design highlighted
Power metrics included in layout_quality_report.txt and experiment_parameters.json
Clarification Questions

🚨 ALWAYS ask Question 1 FIRST. Do not ask about treatments, plate format, or experiment parameters before the user has answered Question 1.

1. Input Files (ASK THIS FIRST):
Do you have a sample metadata file (CSV/TSV) defining your experiment?
If uploaded: Does it contain treatment/condition columns and sample IDs?
Expected formats: CSV/TSV with treatment assignments and covariates
Or use example data for testing?
Available: dose_response_96 (6-plate, non-ratiometric), qpcr_96 (ratiometric ΔΔCt: target + housekeeping genes, inter-plate calibrator, split-by-sample across 2 plates), cell_viability_384, simple_96
Use load_example_experiment("dose_response_96") — all parameters pre-defined

🚨 IF EXAMPLE DATA SELECTED: All parameters are pre-defined. DO NOT ask questions 2-7. Proceed directly to Step 1 with load_example_experiment().

Questions 2-7 are ONLY for users providing their own data:

2. Plate Format: 96-well (8×12, most common) or 384-well (16×24)?
3. Experiment Type: Cell-based assay, qPCR, ELISA, drug screening, or other?
4. Treatments and Replicates: How many conditions? Names? Replicates per condition? Unsure → run power analysis (small/medium/large effect).
5. Controls: Positive control? Negative/vehicle? Blanks? (names and well counts)
6. Edge Effect Strategy:
"controls_only" (recommended) — Edge wells for controls only; ~62% sample utilization on 96-well but high protection
"empty" — Edge wells left empty; same utilization, highest protection
"include" — All wells used; 100% utilization but vulnerable to edge effects (10-30% evaporation bias)
7. Additional Parameters (only if user mentions): Multi-plate, covariates, pipetting constraints, reserved wells?
Standard Workflow

🚨 MANDATORY: USE SCRIPTS EXACTLY AS SHOWN - DO NOT WRITE INLINE CODE 🚨

This skill uses low-freedom script execution. You must:

Source the scripts using the exact commands below
Wait for verification messages after each step
NOT write inline code for any step
NOT modify commands unless explicitly adapting for user-specific data

The plate layout workflow follows 5 steps: Define → Generate → Visualize → Export → Report

Optional: Pre-Design Power Analysis

If the user is unsure about how many replicates to use:

source("scripts/power_analysis.R")
suggestion <- suggest_replicates(
    n_treatments = 3,
    effect_size = "medium",
    plate_format = 96,
    edge_strategy = "controls_only"
)

Use suggestion$required_n as n_replicates in Step 1.

✅ VERIFICATION: You MUST see: "✓ Power-based replicate suggestion completed successfully!"

Step 1 - Define Experiment
source("scripts/load_example_experiment.R")
experiment <- load_example_experiment("dose_response_96")

Or define interactively:

source("scripts/load_example_experiment.R")
experiment <- define_experiment(
    plate_format = 96,
    treatments = c("Drug", "Vehicle"),
    n_replicates = 5,
    controls = list(positive = "Staurosporine", negative = "DMSO", blank = "Media"),
    n_controls = list(positive = 4, negative = 4, blank = 4),
    edge_strategy = "controls_only",
    n_plates = 6
)

DO NOT write inline experiment definition code. Use load_example_experiment() or define_experiment().

✅ VERIFICATION: You MUST see: "✓ Experiment defined successfully!"

Available examples: dose_response_96, qpcr_96 (ratiometric ΔΔCt), cell_viability_384, simple_96

Replicate vocabulary: n_biological vs n_technical

define_experiment() accepts explicit replicate counts that are the single source of truth for every downstream report:

n_technical — technical replicate wells per group within a plate (measurement precision). Falls back to n_replicates.
n_biological — independent biological preparations / days (generalizability). Falls back to n_plates for multi-plate designs, else 1.

The quality report, plate summary, and experiment_parameters.json all print these DECLARED values and must agree. For a multi-plate design that distributes biological reps, the report states e.g. "Plate 1 holds biological reps 1,3,5 of the n_biological=6 design" — never the old misleading "biological n=1".

Ratiometric / multi-measurand designs (e.g. qPCR ΔΔCt)

For assays that read multiple measurands per sample and form a ratio (e.g. a target gene normalized to housekeeping genes), set:

measurands — the targets/genes/channels measured per sample (e.g. c("MYC","GAPDH","ACTB")). Each biological sample × technical replicate is expanded into one well per measurand.
normalization = "ratiometric" — enables co-location enforcement (requires ≥2 measurands).
reference_measurands — the normalizer subset (housekeeping genes), must be ⊆ measurands.
interplate_calibrator — a shared calibrator sample label (or TRUE to auto-name "InterplateCalibrator"). In multi-plate designs it is added to every plate to bridge plate-to-plate batch effects.
experiment <- define_experiment(
    plate_format = 96,
    treatments = c("Treated", "Untreated"),
    n_replicates = 6,                         # biological reps per treatment
    measurands = c("MYC", "GAPDH", "ACTB"),
    reference_measurands = c("GAPDH", "ACTB"),
    normalization = "ratiometric",
    interplate_calibrator = TRUE,             # on every plate
    n_biological = 6, n_technical = 3,
    edge_strategy = "include",                # sealed qPCR plates
    n_plates = 2
)

Co-location rules (enforced automatically):

All wells of one biological sample (every measurand × tech rep) stay on the same plate.
Multi-plate ratiometric designs split by whole sample (a sample's full block is never split across plates; a gene/measurand is never split).
generate_plate_layout() raises a clear error if co-location is violated; use method = "osat_spatial" or "block_random" (NOT latin_square, which assigns by grid position).
check_all_confounding() includes a co-location check that FAILS if any sample spans >1 plate or a multi-plate ratiometric design lacks the calibrator on every plate.
Step 2 - Generate Layout
source("scripts/generate_layout.R")
layout <- generate_plate_layout(
    experiment,
    method = "osat_spatial",
    seed = 42
)

DO NOT write inline randomization or assignment code. Use the script.

Methods:

"osat_spatial" (default) — OSAT + spatial optimization via designit
"block_random" — Block randomization with spatial constraints
"latin_square" — Latin square mapped to plate coordinates
"manual_template" — Start from a template, modify manually

⚠️ CRITICAL - DO NOT:

❌ Write inline sample assignment code → STOP: Use generate_plate_layout()
❌ Manually place samples in wells → STOP: Use the optimization methods
❌ Skip randomization → confounds treatment with plate position

✅ VERIFICATION: You MUST see: "✓ Layout generated successfully!"

Quality check: Score should be ≥80%. If lower, try: different seed, more iterations (max_iter = 2000), or different method.

Then complete ALL sub-steps 2a–2e in order:

Step 2a — Assess statistical power (MANDATORY):

source("scripts/power_analysis.R")
layout <- assess_layout_power(layout, effect_size = "medium")

Dose-response headline power (automatic). When assay_type == "dose_response" with ≥4 dose levels, assess_layout_power() reports the 1-df trend test across the ordered doses as the headline technical power and demotes the omnibus one-way ANOVA to an explicit model-free lower bound — because a dose series is analysed with a monotone trend (or 4PL) fit, not an ANOVA that treats ordered doses as unordered categories. Both numbers and the trend's monotonicity assumption are printed and carried into the report. This does not touch the biological-power gate: with no biological SD, biological power stays UNVERIFIED (see below). See Scientific caveats → dose-response trend vs ANOVA.

Effect size options: "small" (subtle differences), "medium" (typical/moderate), "large" (obvious). Resolves to Cohen's d (t-test) or Cohen's f (ANOVA) automatically.

SD-explicit power (recommended for biological claims): Instead of a bare Cohen's value, specify the raw effect you care about (delta, in the assay's own units) and the SD it is measured against:

# Cohen's d = delta / SD, with SD provenance tracked
layout <- assess_layout_power(layout, delta = 1.0, biological_sd = 0.7, test_type = "t")

🚨 Biological power REQUIRES a biological SD. Wells within a plate share a biological source, so their (technical) SD understates true biological variability.

If you pass only technical_sd, the biological-power result is labeled "NOT VALID (technical SD used)" and you MUST NOT report it as biological power.
If you pass a bare string/numeric effect_size (no SD), biological power is labeled "UNVERIFIED" — pass delta + biological_sd to validate it.
qPCR ΔCt prior: biological SD is typically ~0.5–1.0 Ct, well above the ~0.4 Ct technical (pipetting/instrument) floor. Powering a biological claim off the technical SD overstates power.

When delta is supplied, assess_layout_power() also surfaces a power-vs-biological-SD sensitivity table (sensitivity_over_sd()), making the SD assumption explicit. Present it to the user. You can also call it standalone:

sensitivity_over_sd(delta = 1.0, n = 4, sd_range = c(0.4, 0.6, 0.8, 1.0))

Choose effect size by assay type:

Dose-response / cell viability: For full dose-response curves (concentrations spanning IC50), use "large" (d=0.8) or a numeric value like 2.0 for strong cytotoxic effects (>50% viability change). For sub-IC50 screening or assays targeting subtle viability shifts, use "medium" (d=0.5) — not all dose points produce large effects.
Gene expression / proteomics: Use "medium" — moderate fold-changes between conditions
Subtle phenotypes / biomarkers: Use "small" — detecting weak effects requires more replicates

🚨 DO NOT skip power assessment. ALWAYS run assess_layout_power() after generating the layout. 🚨

✅ VERIFICATION: You MUST see: "✓ Power assessment completed successfully!"

⚠️ MANDATORY: If power < 0.80, you MUST stop and present the user with options:

Add plates — Increase n_plates in Step 1 to spread replicates across multiple plates (use suggest_replicates() to find the right total n, then divide across plates)
Increase replicates per plate — If wells are available, increase n_replicates
Accept underpowered design — Proceed only with explicit user acknowledgment that the design may miss real effects
Target larger effect size — Re-run assess_layout_power(layout, effect_size = "large") to check if adequate for large effects only

DO NOT silently proceed with an underpowered design. DO NOT reassure the user that low power is "typical" or "expected."

⚠️ MANDATORY — Biological Replication Plan: assess_layout_power() reports a Biological Replication Plan showing how many independent experiments are needed for adequate biological power. You MUST:

Present the biological replication plan prominently — not as a footnote
State the required number of independent preparations for 80% biological power
Show power at 3 and 5 independent preparations so the user understands the tradeoff
Explain: Technical power validates the plate layout; biological power requires independent experimental days/cell preparations. Wells within a plate are technical replicates — they cannot substitute for biological replication.

DO NOT present technical power alone as evidence the design is adequate. DO NOT minimize the biological power limitation. A well-designed plate with 86% technical power but 8% biological power means: the plate layout is efficient, but you need more independent experiments for generalizable conclusions.

⚠️ DO NOT claim power for effect sizes that were NOT tested. If you only ran effect_size = "medium", you may NOT state the design is "well-powered for large effects" without running assess_layout_power(layout, effect_size = "large") to verify.

⚠️ MANDATORY — Effect Size Sensitivity Table: assess_layout_power() automatically computes a sensitivity table showing power at small, medium, large, and your chosen effect size. You MUST:

Present the sensitivity table to the user — do NOT only report the chosen effect size's power
Discuss whether the chosen effect size is realistic for the user's assay. For example, d=2.0 assumes >50% viability change; many drug treatments produce smaller effects
Flag when medium-effect biological power is low — the script warns automatically, but you should explain what this means practically

Step 2b — Power curve plot:

plot_power_curve(layout, output_dir = "layout_results")

When layout is supplied as the first argument, plot_power_curve() derives n_treatments, effect_size, test_type, alpha, and current_n from layout$power_analysis so the curve's subtitle matches the headline power in the same report.

✅ VERIFICATION: You MUST see: "✓ Power curve generated successfully!"

CRITICAL — Two Kinds of Power:

Technical power (well-level): Validates the plate layout — enough wells to measure precisely within each experiment. This is what the script checks against 80%.
Biological power (experiment-level): Determines ability to generalize conclusions. Requires independent experiments (different days, cell passages, preparations). Almost always requires 3+ independent preparations.

A design can have 86% technical power and 8% biological power simultaneously. Both numbers are correct but answer different questions. The agent MUST present the full Biological Replication Plan from assess_layout_power() showing power at 3, 5, and the required number of independent preparations.

Step 2c — Comprehensive confounding check (MANDATORY):

confounding <- check_all_confounding(layout)

✅ VERIFICATION: You MUST see: "✓ Comprehensive confounding check completed successfully!" This tests quadrant, row, column, edge, and plate-level (if multi-plate) confounding. If any check reports FAILED (p ≤ 0.05), re-run generate_plate_layout() with a different seed or method.

⚠️ IF CONFOUNDING DETECTED AND YOU CHANGE THE SEED: You MUST re-run ALL of Steps 2a-2c with the new layout:

Re-run assess_layout_power() — power analysis from the old seed is invalid
Re-run plot_power_curve() — the old power curve belongs to the old layout
Re-run check_all_confounding() — verify the new seed passes Do NOT reuse power curves, power analysis results, or visualizations from a previous layout/seed.

IF confounding is detected (seed fails): Explain to the user why this matters — the initial seed produced a layout with positional confounding (treatment correlated with plate position). This demonstrates that not all random layouts are confounding-free, which is why automated confounding checks are essential. The layout may look acceptable visually but harbor hidden statistical biases.

Step 2d — Explain design principles to user (MANDATORY):

🚨 You MUST Read("references/design_principles.md") and quote specific numbers from it. Do NOT explain from memory or from this SKILL.md. 🚨

Read references/design_principles.md and explain to the user:

Quote the 10-30% evaporation bias figure from Section 1 (Edge Effects)
Present the full 3-row edge well utilization comparison table from Section 1 (the one with Strategy / Protection / Usable Wells / When to Use columns) — do NOT summarize in prose; show the complete table so users can compare strategies at a glance
Quote the pseudoreplication definition from Section 3 — wells on the same plate are technical replicates. With a single plate, biological n = 1 per treatment regardless of well count. Multi-plate experiments with independent preparations provide true biological replication.

Step 2e — Discuss edge strategy tradeoff:

🚨 Read references/design_principles.md Section 1 and present the edge strategy table from the reference document. Do NOT reproduce from memory. 🚨

Present the full edge strategy tradeoff table for the user's specific assay type (do not summarize — show the complete table):

Assay Type    Recommended Strategy    Rationale
Cell viability (open plate, >24h)    empty or controls_only    10-30% evaporation bias in outer wells
qPCR (sealed plates)    include    Sealed plates minimize evaporation; recovers ~38% more wells
ELISA (short incubation)    controls_only    Controls in edges detect plate-level drift
Drug screen (384-well)    empty    384-well plates have more severe edge effects
Cell-based (sealed, <6h)    include or controls_only    Minimal edge bias with sealed short incubations

Why controls_only over empty? Both strategies reserve edge wells and yield the same number of interior wells for samples. The difference: controls_only places controls in edge wells, providing quantitative data about edge-specific behavior (evaporation, signal drift) that can inform normalization. With empty, those wells generate no data. Use empty only when reagent cost prohibits edge controls or when edge contamination risk is severe.

For details, read references/design_principles.md Section 1 (Edge Effects).

Step 3 - Generate Visualizations
source("scripts/visualize_plate.R")
visualize_all_plates(layout, output_dir = "layout_results")

🚨 DO NOT write inline plotting code (ggsave, ggplot, geom_tile, geom_point, etc.). Just use the script. 🚨

🚨 DO NOT create your own plate map plots. The script uses packaged plate-map plotting helpers. 🚨

The script generates 5 analysis-ready plots using ggplate (round wells) from the packaged plotting scripts, plus PNG + SVG export with graceful fallback.

✅ VERIFICATION: You MUST see: "✓ All plots generated successfully!"

Step 4 - Export Results
source("scripts/export_layout.R")
result <- export_all(layout, output_dir = "layout_results")

DO NOT write custom export code. Use export_all().

✅ VERIFICATION: You MUST see: "=== Export Complete ==="

Export verification (automatic): export_all() verifies every written file is non-empty (and the .xlsx is a valid >1 KB workbook). It returns a status list — check it:

result$excel — "ok", "failed: ...", or "skipped (...)".
result$warnings — any export problems (e.g. a failed Excel write).
result$offenders — any empty/invalid files.
result$census — the well census (edge vs interior breakdown); confirm it is present and that layout$well_census is non-null before proceeding to the report.

If the Excel export fails, the skill falls back to CSV-only (the .csv/grid exports are always written) and surfaces the failure in both result and the --- Export Status --- section of layout_quality_report.txt. It is NOT silently swallowed. If result$warnings is non-empty, report it to the user rather than claiming a clean export.

DEMO DATA DISCLAIMER (MANDATORY): If example data was used, you MUST include this notice prominently in your final summary: "This layout was generated using the built-in [example_name] demo dataset for demonstration purposes only. To design a layout for your actual experiment, re-run from Step 1 with define_experiment() using your own treatments, replicates, and controls."

Step 5 - Generate PDF Report (MANDATORY — terminal step)

The run is not complete until this step has happened. Use the pdf-report-generation skill to generate a pdf report with infographics (use the Biomni GenerateImage tool), methods, results, conclusions, figures, references, and next steps from all of the analyses.

This skill ships no packaged PDF-generation script; load the reporting skill with Skill(action="load", name="pdf-report-generation") and build the PDF from the artifacts produced in Steps 2–4.

🚨 Figure integrity gate (MANDATORY — run BEFORE assembling the PDF): Every figure that depicts plate wells must either be a script-generated plate map (rendered from the actual layout table) or be an explicitly-marked schematic. A picture of a plate on page 1 that does not show the real assignment is a genuine misreading risk. In particular, if you add a page-1 conceptual infographic (e.g. via GenerateImage), it MUST:

carry an in-figure label "Schematic — illustrative only, not a data figure" (in the image itself, not only the caption) — mirrors the sibling-skill pattern;
show no specific well-colour assignment that could be misread as the real layout (the real assignment is plate_treatment_map.png);
print the run's real counts beside it (# treatments, # sample wells, # controls, edge-vs-interior census from layout_quality_report.txt);
be named with a schematic marker (e.g. workflow_schematic.png).

Then verify the figure set programmatically before building the PDF:

source("scripts/export_layout.R")   # if not already sourced
verify_report_figures(c(
    "layout_results/plate_treatment_map.png",
    "layout_results/plate_sample_type_map.png",
    "layout_results/plate_replicate_map.png",
    "layout_results/plate_edge_risk.png",
    "layout_results/plate_quality_dashboard.png",
    "layout_results/power_curve.png",
    "layout_results/workflow_schematic.png"    # include the infographic, if any
))

verify_report_figures() stops if any figure is neither a script-generated plate map nor a marked schematic. Also run Read(file_path=...) on the infographic to confirm the in-figure "Schematic — illustrative only" label is actually present.

✅ VERIFICATION: verify_report_figures() must pass (any plate-like infographic is a marked schematic, not a data figure) and analysis_report.pdf is produced with its figures embedded. Confirm the page count and that figures are present before declaring the report complete.

⚠️ CRITICAL - DO NOT:

❌ Skip power assessment → STOP: ALWAYS run assess_layout_power() and plot_power_curve() in Step 2
❌ Write inline experiment definition code → STOP: Use define_experiment() or load_example_experiment()
❌ Write inline sample assignment or randomization code → STOP: Use generate_plate_layout()
❌ Write inline plotting code (ggsave, ggplot, geom_tile, geom_point, plate maps, etc.) → STOP: Use visualize_all_plates() — it uses packaged plate-map plotting helpers
❌ Write custom export code → STOP: Use export_all()
❌ Put a plate-like infographic on page 1 that looks like the real layout → STOP: run verify_report_figures() before the PDF; any infographic must carry an in-figure "Schematic — illustrative only, not a data figure" marker (real layout = plate_treatment_map.png)
❌ Try to install svglite → script handles SVG fallback automatically
❌ Use absolute paths or setwd() → use relative paths only
❌ Claim power for untested effect sizes → STOP: If you only tested "medium", you CANNOT claim "well-powered for large effects" without running assess_layout_power(layout, effect_size = "large")
❌ Proceed silently when underpowered (power < 0.80) → STOP: You MUST present options to the user (add plates, increase replicates, accept, or test different effect size)
❌ Skip confounding check → STOP: ALWAYS run check_all_confounding(layout) in Step 2c

✅ VERIFICATION - You MUST see ALL of these:

After Step 1: "✓ Experiment defined successfully!"
After Step 2: "✓ Layout generated successfully!" AND "✓ Power assessment completed successfully!" AND "✓ Power curve generated successfully!" AND "✓ Comprehensive confounding check completed successfully!"
After Step 3: "✓ All plots generated successfully!"
After Step 4: "=== Export Complete ==="
After Step 5: analysis_report.pdf produced via the pdf-report-generation skill

❌ IF YOU DON'T SEE THESE MESSAGES: You wrote inline code. Stop and use source() with the scripts above.

⚠️ IF SCRIPTS FAIL - Script Failure Hierarchy:

Fix and Retry (90%) - Install missing package, re-run script
Modify Script (5%) - Edit the script file itself, document changes
Use as Reference (4%) - Read script, adapt approach, cite source
Write from Scratch (1%) - Only if genuinely impossible, explain why

NEVER skip directly to writing inline code without trying the script first.

Common Issues
Issue    Cause    Solution
"Not enough available wells"    Too many samples for plate format    Reduce replicates, add plates (n_plates), or switch to 384-well
Low quality score (<80%)    Poor spatial distribution    Increase max_iter, try different seed, or use osat_spatial method
Controls not in all quadrants    Not enough control wells    Increase n_controls (minimum 4 per type for 96-well)
designit not found    Package not installed    install.packages('designit')
ggplate not found    Required package missing    install.packages('ggplate') — required for plate visualizations
SVG export error    Missing svglite dependency    Normal — scripts fall back to base R svg() or skip SVG. PNG always works.
Excel export skipped    openxlsx not installed    install.packages('openxlsx') — CSV exports always available
Power < 0.80    Insufficient replicates for effect size    Add plates (n_plates), increase n_replicates, or use suggest_replicates() to find optimal n
pwr not installed    Required power analysis package missing    install.packages('pwr') — needed for mandatory power assessment
Suggested Next Steps

After generating your plate layout:

Print the plate map — Use plate_treatment_map.png or the Excel file for the bench
Review the quality report — Check layout_quality_report.txt for recommendations
Run the experiment — Follow the plate map for sample placement
After data collection — Use plate_layout.csv to merge layout with reader data
Consider b-score normalization — If edge effects detected in data, use platetools::b_score()
Related Skills

Upstream:

experimental-design-statistics — Power analysis, sample size, batch assignment across plates
Its batch_design.rds can inform multi-plate sample assignment

Downstream:

de-results-to-plots — Visualize experimental results
bulk-rnaseq-counts-to-de-deseq2 — If the plate experiment feeds into RNA-seq
Scientific Caveats

The following assumptions and limitations apply to every output this skill produces. Surface them to the user when the relevant number appears in a report or figure.

Technical vs biological power answer different questions. Technical power (well-level, n = replicates per group within a plate) measures whether you can detect an effect within a single preparation. Biological power (n = independent preparations) measures whether the effect will reproduce across separate days/passages/batches. A design can have 86% technical power and 8% biological power simultaneously; both numbers are correct but neither alone justifies a biological claim.

pwr assumes normality and equal variance. All power figures come from the pwr package's parametric tests (t-test, one-way ANOVA), which assume normally distributed residuals with homogeneous variance. If your assay has heavy-tailed errors or variance that scales with the mean (common in fluorescence and luminescence readouts), actual power will be lower than reported.

The layout quality score is an unvalidated internal heuristic. The score combines balance, edge-effect mitigation, and spatial randomness into a single number. It is useful for comparing candidate layouts from the same generator, but it has no external validation against experimental outcomes and should not be cited as evidence of design quality in a publication.

Dose-response power uses a trend test, not an omnibus ANOVA (trend vs ANOVA). A dose series is analysed with a monotone trend test across the ordered dose levels — or a four-parameter-logistic (4PL) curve fit — never a one-way ANOVA that treats the ordered doses as unordered categories. Treating k ordered doses as k unordered groups spreads the alternative across k−1 numerator degrees of freedom and discards the dose ordering, which is the entire information content of a dose series; that omnibus ANOVA is therefore reported only as a model-free lower bound. The headline dose-response power comes from the 1-df linear trend: it reuses the same between-group noncentrality as the omnibus (λ = k·n·f²) but credits it to the single linear-trend degree of freedom — i.e. it assumes the dose-group means are monotone and approximately linear on the ordered-dose scale. No effect size is inflated; the extra power comes only from not throwing away the ordering. If the true curve is non-monotone or the tested concentrations miss the dynamic range, the linear component captures less of the signal and the true power lies between the trend value and the omnibus lower bound. (The package computes the trend power in closed form from the noncentral F; it does not currently fit a 4PL curve or run a dose-response simulation.) Like every pwr/noncentral-F figure here, the trend power also assumes normally distributed, equal-variance residuals.

A plate-like schematic in the report is illustrative, not the layout. If the report's page-1 infographic shows a grid of wells, it is a schematic ("Schematic — illustrative only, not a data figure"), not the assignment your samples will follow. The authoritative, machine-generated layout is plate_treatment_map.png (Figure 2) and plate_layout.csv. The verify_report_figures() gate (Step 5) blocks any plate-depicting figure that is neither generated from the layout table nor marked as a schematic.

Edge-effect magnitudes are literature ranges, not measurements of the user's assay. The edge-effect mitigation strategies and the 10-30% evaporation figure cited in references/design_principles.md are drawn from published studies of typical plate-based assays, not from the user's specific experimental conditions. The actual edge effect in a given assay may be larger, smaller, or absent.

Any figure whose provenance row reads example_default or inferred is an assumption, not a fact about the user's experiment. The design_provenance.csv file and the provenance table in the PDF report tag every design parameter with its source. Parameters sourced from example_default (built-in demo values) or inferred (derived from another parameter, e.g. n_biological inferred from n_plates) carry assumptions that the user has not confirmed. Do not present these as user-declared facts.

References

Scripts: See scripts/ for all functions:

load_example_experiment.R — Example experiments + define_experiment()
generate_layout.R — Layout generation engine
visualize_plate.R — Plate visualizations
export_layout.R — Multi-format export
power_analysis.R — Power analysis, replicate suggestion, confounding check

Reference docs:

design_principles.md — Edge effects, pseudoreplication, randomization, controls
plate_formats.md — 96-well and 384-well specifications
common_assay_layouts.md — qPCR, ELISA, dose-response templates
advanced_designs.md — Latin square, multi-plate, OSAT details

Key papers:

Francisco Rodríguez MA, Carreras-Puigvert J, Spjuth O (2023) Artificial Intelligence in the Life Sciences — AI-optimized microplate layouts (PLAID)
Borges H et al. (2021) Bioinformatics — Well Plate Maker randomization
Lazic SE (2010) BMC Neuroscience — Pseudoreplication in biological experiments
Murphy TJ — Sampling and Experimental Units

55. molecular-property-admet
Category: DRUG DISCOVERY
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

56. molecule-clustering
Category: DRUG DISCOVERY
Source: https://biomni.phylo.bio/skills/skill_07ba09ea0abd44ffb709ee4b6af33668?section=marketplace

Molecule Clustering

Groups molecules by similarity and shows the groups on a 2-D map. Clusters are computed in the full feature space; the map is only for display. Reuses molecular-dataset-qc for cleaning and small-molecule-featurization for features. references/choosing-methods.md explains the trade-offs behind every default.

Use the printed Skill Directory as SKILL_DIR. Scaffold counting belongs to scaffold-and-ring-systems-analysis.

1. Check the data

Pasted SMILES: write them to input.csv with columns id,smiles, using any names the user gave. Files: run

python3 "$SKILL_DIR/scripts/precheck.py" --input <file>

It counts unparseable structures, multi-component structures (salts), charged structures, undefined stereocentres, radicals and duplicate structures, and lists the columns.

Any of these found, or the file is a raw export: recommend QC. Load molecular-dataset-qc and follow the "QC confirmation" rules in small-molecule-featurization (QC plan stated in the message text above the first question, label column passed when there is one, follow-ups only for facts that cannot be read from the file). Cluster the cleaned_data/cleaned_data.parquet table.
Clean, or the user declines QC: continue with the file as given and say so in one line.

Clusters follow the table that was featurized, so after QC the rows are the cleaned table. Map back to the upload with qc_details/row_audit.csv.

2. Choose the approach

Read the prompt first and ask only about what it leaves open. When the prompt already names a featurization, algorithm or map, use it, say so, and do not ask. Always list the recommended option first, labelled "(Recommended)". Questions are single-select, in two rounds because the algorithm recommendation depends on the features.

Let N be the number of molecules after QC.

Round 1: Which features? Put the QC plan in the message text above it.

Option    Pros and cons
ECFP4 fingerprints (Recommended)    Standard structural similarity; fast; interpretable by shared substructures
FCFP4 fingerprints    Pharmacophore-typed atoms, groups different cores with similar features; fuzzier
RDKit descriptors    Groups by physicochemical properties (size, polarity, logP) rather than structure
CheMeleon embeddings    Learned similarity, good on small property datasets; not interpretable, slower

Round 2: Which algorithm and which map? Two questions in one round. The question tool allows four options, so list the recommended option and the next three most suitable for the data, and accept any other method the user names in free text.

Algorithm    Recommend when    Pros and cons
Butina    Fingerprints, N up to ~15k    Every member within the cutoff of its centre; many singletons at tight cutoffs
Hierarchical    Granularity not known in advance, N up to ~15k    Cut by cutoff or number of clusters; chaining at high cutoffs
HDBSCAN    Embeddings or descriptors, any N (above ~15k, embeddings use normalised Euclidean distance)    Density-based, leaves outliers as noise; on data without density structure it can return one large cluster or mostly noise
K-means    Embeddings or descriptors when a fixed number of groups is wanted    You set k, or a silhouette scan over k = 2 to 24 picks it; assumes compact, roughly spherical groups; every molecule is assigned; on fingerprint bits it uses Euclidean, not Tanimoto, distance
BitBIRCH    Fingerprints, N above ~15k    Needs no distance matrix, so it scales beyond ~15k (not benchmarked here beyond 10k); beta package, extra install
Map    Recommend when    Pros and cons
MDS    N up to ~3k    Distances roughly proportional, so global layout is meaningful; slow and O(N²)
UMAP    N from ~3k to 100k    Fast, clear local neighbourhoods; distorts distances between clusters
t-SNE    N from ~1k to 50k, as an alternative to UMAP    Strong local separation; cluster sizes, gaps and distances between clusters are meaningless; stochastic; slower than UMAP
TMAP    N above 100k, fingerprints    Branching tree layout at very large scale; extra install, pre-1.0
PCA    A quick linear look    Instant; usually crowded for fingerprints

Cutoff and number of clusters are not questions. State the default in the message ("Butina with a Tanimoto distance cutoff of 0.65; comment to change"). Butina and hierarchical reports include a cutoff sweep that shows how granularity responds to it. Fingerprints are ECFP4, 2048 bits, binary, chirality on.

When N is above the dense limit (~15k), say which options that rules out and recommend BitBIRCH (fingerprints) or HDBSCAN (embeddings, descriptors).

With fewer than ~10 molecules, recommend Butina or hierarchical with MDS or PCA. UMAP needs at least 5 molecules and HDBSCAN at least --min-cluster-size (default 5), so they do not suit very small sets.

3. Featurize

Load small-molecule-featurization and use its printed Skill Directory (FEAT_DIR). Skip its own question rounds and QC: both are handled above. Compute only the chosen family:

Features    Flags
ECFP4    --families morgan
FCFP4    --families morgan --morgan-invariants feature
RDKit descriptors    --families descriptors
CheMeleon embeddings    --families embedding
python3 "$FEAT_DIR/scripts/featurize.py" --input <table> --output-dir /mnt/results/featurization <flags>

When the user names another embedding model or descriptor set, follow small-molecule-featurization for it. Pass --color-col with the numeric activity or property column when the user wants the map coloured by it. Set --smiles-col and --id-col when auto-detection picks the wrong one.

4. Cluster and map

Install the optional packages only when chosen: uv pip install bblean (BitBIRCH), uv pip install tmap2 (TMAP). UMAP, scikit-learn and RDKit are installed.

python3 "$SKILL_DIR/scripts/cluster.py" \
  --molecules /mnt/results/featurization/molecules.parquet \
  --features /mnt/results/featurization/morgan.parquet \
  --output-dir /mnt/results/clustering \
  --algorithm butina --map umap
Option    Use
--features    morgan.parquet, descriptors.parquet or embeddings_<model>.parquet, from the same featurization run as --molecules; sets the distance
--algorithm    butina, hierarchical, hdbscan, bitbirch, kmeans
--map    mds, umap, tsne, tmap (fingerprints), pca
--cutoff    Distance cutoff for butina, hierarchical, bitbirch. Default 0.65 for fingerprints, otherwise the 5th percentile of pairwise distances. BitBIRCH's threshold does not mean the same as Butina's, so calibrate it separately
--n-clusters, --linkage    --n-clusters fixes the number of clusters for hierarchical (instead of a cutoff) and k-means (instead of the silhouette scan); --linkage is average (default) or complete
--min-cluster-size    HDBSCAN (default 5)
--color-col    Numeric column of molecules.parquet for map colour and per-cluster means

The script drops molecules without features (listed in the report), fails with a clear message when a method needs a distance matrix larger than the dense limit, and writes the outputs below. Use a fresh output directory per run. To compare settings, rerun with a different cutoff or algorithm into a new directory.

5. Report back

Point to clustering_report.html first. Then give a short summary from clustering_summary.json: clusters, singletons (or noise for HDBSCAN), largest cluster, silhouette, and the settings used (molecules analyzed, assigned to clusters and, for HDBSCAN, noise). Name the largest few clusters with their representatives (cluster_summary.csv). Frame cluster descriptions as observations, not conclusions, and always state:

that the cutoff or algorithm settings set the granularity: the cutoff sweep (Butina and hierarchical) shows how it responds, not whether membership is stable, and cluster counts are not a measure of diversity;
the map caveat from the summary (for UMAP: distances between clusters are not meaningful; for MDS: the stress-1 value);
molecules left out, with reasons, and that rows follow the cleaned table when QC ran.

Offer to rerun with a different cutoff, algorithm or map.

6. PDF (on request)

Build a PDF only when the user asks. Load and follow pdf-report-generation with default Phylo styling and write report_molecule-clustering.pdf next to the outputs.

Content: input and QC summary, methods from clustering_methods.md, the summary numbers, the cutoff sweep (when the report has one), the largest clusters with representative structures, and the caveats above.
Figures: draw the map with matplotlib from clusters.csv (x, y, cluster).
Numbers: take every number from clustering_summary.json and cluster_summary.csv.
Outputs (under --output-dir)
File    Content
clustering_report.html    Self-contained overview: tiles, interactive map with structures on hover and highlighting of any cluster by number, sortable cluster table with representatives and member grids, size histogram, cutoff sweep (Butina and hierarchical), methods, molecules left out
clusters.csv    row, id, smiles, cluster (0 is the largest, -1 is noise), cluster_size, is_representative, x, y, and the colour column
cluster_summary.csv    Per cluster: size, representative, mean within-cluster distance, mean of the colour column
clustering_summary.json    Parameters, featurization settings, counts, silhouette, cutoff sweep, MDS stress, software versions, input hashes
clustering_methods.md    Methods paragraph, ready to paste
tmap.html    Full-size TMAP tree (TMAP only)
Caveats
Cluster counts are not a finding. They follow the cutoff. Butina also depends on row order when neighbour counts tie.
The map is a drawing. Only MDS keeps distances roughly proportional. UMAP, t-SNE and TMAP distort distances between clusters, and the HTML map shows a random sample of up to 5000 molecules.
K-means imposes k. It always returns k groups. The scan's best k is a starting point; silhouette often changes little between neighbouring k, and the report flags a best k at either end of the scanned range.
Folded fingerprints collide. Similarities are approximate; compare a longer fingerprint when a borderline cutoff matters.
Descriptors dominate by count. Z-scoring gives every kept descriptor equal weight, so correlated groups (for example many size descriptors) carry more weight in the distance.
Silhouette is a weak guide for chemical clusters; it excludes noise and singletons and uses the clustering distance.
Not validated for any endpoint. Clusters group similar structures; they do not show that members share activity.
Sources
RDKit (BSD-3-Clause), https://www.rdkit.org. Fingerprints and structure handling.
Butina: D. Butina, J. Chem. Inf. Comput. Sci. 1999, 39, 747-750.
SciPy hierarchical clustering and scikit-learn HDBSCAN, KMeans, MDS, t-SNE, silhouette (BSD-3-Clause).
BitBIRCH: Digital Discovery 2025, doi 10.1039/D5DD00030K; bblean (GPL-3.0, installed on demand only).
UMAP: L. McInnes et al., arXiv:1802.03426; umap-learn (BSD-3-Clause).
t-SNE: L. van der Maaten and G. Hinton, J. Mach. Learn. Res. 2008, 9, 2579-2605; scikit-learn TSNE.
K-means: scikit-learn KMeans (BSD-3-Clause); silhouette-based choice of k as in P. Walters, practical_cheminformatics_tutorials.
TMAP: D. Probst and J.-L. Reymond, J. Cheminform. 2020, 12, 12; tmap2.
Features and embeddings: see small-molecule-featurization.

57. multi-omics-integration
Category: MULTI-OMICS
Source: https://biomni.phylo.bio/skills/skill_b022f7a4010244ac8956c13d9dd60967?section=marketplace

Multi-Omics Integration (MOFA+)

Identify latent factors driving variation across 2+ omics layers using MOFA+ (Multi-Omics Factor Analysis). Decomposes multi-omics data into interpretable factors, each capturing shared or view-specific biological signal. Handles missing data across views natively.

When to Use This Skill

Use when you:

✅ Have 2+ omics layers measured on overlapping samples (RNA-seq + proteomics, methylation + mutations, etc.)
✅ Want to find shared sources of variation across omics (not just per-omics analysis)
✅ Need to identify which omics layers contribute to each source of variation
✅ Have incomplete data (not all samples measured in all views) — MOFA handles this
✅ Want factor scores for downstream patient stratification or survival analysis

Don't use for:

❌ Single omics data (use bulk-rnaseq-counts-to-de-deseq2 or bulk-omics-clustering)
❌ Supervised prediction (use elastic-net-biomarker-panel instead)
❌ Single-cell multi-modal (MOFA2 supports it, but consider scrna-trajectory-inference)
❌ Fewer than 10 samples per view

Runtime: ~5-8 minutes total (CLL example). First run adds ~1-3 min for Python environment setup.

Installation
# Bioconductor packages
if (!requireNamespace("BiocManager", quietly = TRUE)) install.packages("BiocManager")
BiocManager::install(c("MOFA2", "MOFAdata", "ComplexHeatmap"))

# CRAN packages
install.packages(c("ggprism", "circlize", "reshape2", "RColorBrewer"))
Package    Version    License    Commercial Use    Installation
MOFA2    ≥1.12.0    LGPL (≥3)    ✅ Permitted    BiocManager::install("MOFA2")
MOFAdata    ≥1.8.0    Artistic-2.0    ✅ Permitted    BiocManager::install("MOFAdata") (example data)
ComplexHeatmap    ≥2.18.0    MIT    ✅ Permitted    BiocManager::install("ComplexHeatmap")
ggprism    ≥1.0.3    GPL (≥3)    ✅ Permitted    install.packages("ggprism")
circlize    ≥0.4.15    MIT    ✅ Permitted    install.packages("circlize")
reshape2    ≥1.4.4    MIT    ✅ Permitted    install.packages("reshape2")
RColorBrewer    ≥1.1    Apache-2.0    ✅ Permitted    install.packages("RColorBrewer")
rmarkdown    ≥2.25    GPL-3    ✅ Permitted    install.packages("rmarkdown") (optional, PDF)
Inputs
Multi-omics data: Named list of matrices (features × samples), one per omics view
Minimum 2 views, any combination of omics types
Samples as columns, features as rows
Missing samples across views OK (MOFA handles incomplete overlap)
Sample metadata (optional): CSV/TSV with sample IDs + clinical variables (for factor-trait associations)
Supported formats: R matrices, CSV/TSV files, or MultiAssayExperiment
Outputs

Analysis objects (RDS):

mofa_model.rds — Complete trained MOFA model for downstream use
Load with: model <- readRDS('mofa_results/mofa_model.rds')
Required for: bulk-omics-clustering (factor-based clustering), elastic-net-biomarker-panel (feature selection)

CSV results:

factor_values.csv — Sample factor scores (samples × factors)
weights_*.csv — Feature weights per view (features × factors)
variance_explained_per_factor.csv — R² per factor per view
variance_explained_total.csv — Total R² per view
top_features_per_factor.csv — Top 20 features per factor per view

Visualizations (PNG + SVG):

mofa_variance_per_factor — Heatmap: R² per factor per view (signature MOFA plot)
mofa_total_variance — Bar chart: total R² per view
mofa_factor_scatter — Scatter: Factor 1 vs 2 colored by clinical variable
mofa_factor_correlation — Tile: factor-factor correlations
mofa_top_weights — Faceted bar: top feature weights per factor
mofa_factor_heatmap — ComplexHeatmap: factors × samples with annotations
mofa_factor_clinical — Box plots: factor values by clinical groups

Reports:

analysis_report.md — Markdown summary with methods, results, references
analysis_report.pdf — PDF report created with pdf-report-generation; packaged RMarkdown output is a fallback if the dedicated reporting skill is unavailable
Report Packaging

When the user requests a PDF report, run the analysis first, then load and use the Biomni pdf-report-generation skill for the final PDF deliverable. Build the PDF from this skill's markdown summary, result tables, and generated figures, and save it using the PDF filename listed in Outputs, or a stable descriptive filename when Outputs does not define one.

Keep this skill focused on scientific workflow and artifact content. Do not add custom figure appearance or report layout instructions here; those are handled by the platform prompt and dedicated reporting skills. If pdf-report-generation is unavailable, use the packaged markdown/HTML/script fallback when present and clearly disclose the fallback.

Clarification Questions
Input Files (ASK THIS FIRST):
Do you have multi-omics data matrices to integrate?
Expected: Named list of matrices (features × samples), or CSV files per omics view
Or use example data? CLL blood cancer dataset (200 patients: mRNA, methylation, mutations, drug response)

🚨 IF EXAMPLE DATA SELECTED: Skip questions 3-4. Proceed directly to Step 1.

Analysis Options:

(If using example data) Number of factors:
a) 15 factors — standard analysis (recommended)
b) 5 factors — quick demo (~2 min faster)
(If using own data) Number of factors:
a) 15 (recommended starting point)
b) Custom number

(Own data only) Data types per view:

Which omics types? (RNA-seq, proteomics, methylation, mutations, metabolomics, drug response, other)
Are any views binary (0/1)? MOFA uses Bernoulli likelihood for binary data.

(Own data only) Sample metadata:

Do you have a sample metadata file (CSV/TSV) with clinical variables?
Variables for factor-trait associations (e.g., disease status, treatment, subtype)?
Standard Workflow

🚨 MANDATORY: USE SCRIPTS EXACTLY AS SHOWN - DO NOT WRITE INLINE CODE 🚨

Step 1 - Load data:

# For CLL example data:
source("scripts/load_example_data.R")
cll <- load_cll_data()

# For user data:
# source("scripts/load_example_data.R")
# cll <- load_user_data(
#   file_paths = list(RNA = "rna.csv", Protein = "protein.csv"),
#   metadata_path = "metadata.csv"
# )

✅ VERIFICATION: "✓ Data loaded successfully!" with per-view dimensions

Step 2 - Run MOFA analysis:

source("scripts/mofa_workflow.R")
model <- run_mofa_analysis(
    data_list = cll$data,
    metadata = cll$metadata,
    n_factors = 15,
    output_dir = "mofa_results"
)

DO NOT write inline MOFA code. Just call run_mofa_analysis().

⏱️ Takes ~2-5 min (+ ~1-3 min extra on first run for Python environment setup via basilisk).

✅ VERIFICATION: "✓ MOFA model trained successfully!" with variance explained summary

Step 3 - Generate visualizations:

source("scripts/mofa_plots.R")
generate_all_plots(model, output_dir = "mofa_results")

🚨 DO NOT write inline plotting code (ggsave, ggplot, Heatmap, etc.). Just use the script. 🚨

The script handles PNG + SVG export with graceful fallback for SVG dependencies.

✅ VERIFICATION: "✓ All plots generated successfully!" with file count

Step 4 - Export results:

source("scripts/export_results.R")
export_all(model, output_dir = "mofa_results")

DO NOT write custom export code. Use export_all().

✅ VERIFICATION: "=== Export Complete ===" with file list

⚠️ CRITICAL - DO NOT:

❌ Write inline MOFA code → STOP: Use run_mofa_analysis()
❌ Write inline plotting code (ggsave, ggplot, Heatmap, etc.) → STOP: Use generate_all_plots()
❌ Write custom export code → STOP: Use export_all()
❌ Try to install basilisk/reticulate manually → MOFA2 handles Python automatically

⚠️ IF SCRIPTS FAIL - Script Failure Hierarchy:

Fix and Retry (90%) — Install missing package, re-run script
Modify Script (5%) — Edit the script file itself, document changes
Use as Reference (4%) — Read script, adapt approach, cite source
Write from Scratch (1%) — Only if genuinely impossible, explain why

NEVER skip directly to writing inline code without trying the script first.

Common Issues
Error    Cause    Solution
basilisk Python env setup slow    First-time setup of Python backend    Normal — wait 1-3 minutes. Only happens once per R installation.
run_mofa hangs at "Training model..."    Model training in progress    Normal — wait 2-5 min. Training is compute-intensive.
Error in py_call_impl: Python error    basilisk environment issue    Restart R session, retry. If persistent: BiocManager::install("MOFA2", force = TRUE)
Metadata download failed    EBI FTP blocked or offline    Normal fallback. Analysis runs without trait plots. Metadata is optional.
"No convergence"    Too many factors or too few samples    Reduce n_factors (try 5-10). Ensure ≥10 samples.
SVG export failed    Missing svglite/cairo    Normal. PNG always generated. generate_all_plots() handles fallback automatically.
Memory error    Dataset too large    Filter features to top 5,000 most variable per view before MOFA.
Interpretation Guide
Variance Decomposition (Key MOFA Output)
High R² in one view: Factor captures view-specific variation
High R² across views: Factor captures shared cross-omics signal (most interesting)
Low total R²: MOFA explains little variation in that view — consider adding features or views
Factor Interpretation
Pattern    Meaning
Factor active in mRNA + methylation    Epigenetic regulation of transcription
Factor active in mutations + drug response    Genetic determinants of drug sensitivity
Factor correlates with clinical subtype    Biologically meaningful patient stratification
Factor active in only one view    View-specific technical or biological variation

See: references/mofa-interpretation-guide.md for detailed downstream analysis.

Suggested Next Steps

After running MOFA:

Patient stratification: Use bulk-omics-clustering on factor scores to define molecular subtypes
Biomarker discovery: Use elastic-net-biomarker-panel on top-weighted features per factor
Pathway enrichment: Use functional-enrichment-from-degs on top mRNA features per factor
Network analysis: Use coexpression-network on factor-associated genes
Survival analysis: Use survival-analysis-clinical with factor scores as covariates
Related Skills
Skill    Relationship
bulk-omics-clustering    Downstream: cluster on MOFA factor scores
elastic-net-biomarker-panel    Downstream: select biomarkers from top factor features
disease-progression-longitudinal    Complementary: trajectory analysis on factor scores
coexpression-network    Downstream: network analysis on factor-associated genes
functional-enrichment-from-degs    Downstream: pathway enrichment on top factor features
bulk-rnaseq-counts-to-de-deseq2    Upstream: generate DE results as one omics view
References
Argelaguet R, et al. (2020) MOFA+: a statistical framework for comprehensive integration of multi-modal single-cell data. Genome Biology 21:111.
Argelaguet R, et al. (2018) Multi-Omics Factor Analysis—a framework for unsupervised integration of multi-omics data sets. Molecular Systems Biology 14:e8124.
Dietrich S, et al. (2018) Drug-perturbation-based stratification of blood cancer. Journal of Clinical Investigation 128(1):427-445.

58. off-target-safety-pharmacology
Category: DRUG DISCOVERY
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

59. omics-dataset-retrieval
Category: DATA DISCOVERY
Source: https://biomni.phylo.bio/skills?section=marketplace

Omics Dataset Retrieval Skill
Scope

Systematically retrieve, deduplicate, classify, and relevance-audit publicly available omics datasets for a user-specified disease, phenotype, gene, or biological process. Covers all major omics types (transcriptomics, proteomics, metabolomics, epigenomics, genomics, single-cell, spatial transcriptomics, lipidomics, multi-omics) and the broadest possible set of public repositories. Does not download raw data files or perform downstream analysis.

Use this skill when curating a data atlas or assembling a comprehensive multi-study cohort. Treat requests for “all available,” “all relevant,” or “comprehensive” data as requiring a multi-repository search, even when the user does not name specific datasets or repositories. Do not treat a single CELLxGENE result as exhaustive; check for complete or original study releases and relevant tissue or cell-type coverage across the repository tiers below. For atlas requests, produce a study-level cross-repository ledger. For every relevant non-CELLxGENE candidate, record exactly one outcome: matched to an included CELLxGENE study; ineligible and excluded with study-specific evidence; or unmatched and eligible, surfaced for retrieval. Do not declare CELLxGENE sufficient based on convenience or metadata quality.

Inputs
Parameter    Type    Description
disease_or_topic    string    Disease name, phenotype, gene, or biological process (e.g., "sickle cell disease", "Alzheimer's disease", "BCL11A")
synonyms    list[str]    Alternative names, abbreviations, gene symbols (e.g., ["SCD", "SCA", "HbSS", "sickle cell anemia"])
omics_types    list[str] or "all"    Restrict to specific omics types, or "all" (default)
organism    string    "all" (default) — includes human, mouse, and all other organisms; restrict to "human" or "mouse" only if explicitly requested
year_min    int    Earliest publication year to include (default: no limit)
output_dir    path    Where to save outputs (default: /mnt/results/)
Outputs
File    Description
<disease>_omics_datasets_MASTER.csv    Full catalog with all metadata and relevance labels
<disease>_omics_datasets_VALIDATED.csv    Filtered to CORE + ADJACENT only
<disease>_omics_summary.md    Markdown summary: counts by omics type, repository, top datasets, limitations
<disease>_omics_landscape.png    Overview figure: donut chart + repository bar + timeline (if requested)
report_<disease>_omics_landscape.pdf    PDF report (when the user requests a PDF report)

PDF reports: When the user requests a PDF report (e.g. "Generate a PDF report with an intro, methods, results, conclusions and figures"), load the pdf-report-generation skill and use it to produce a PDF with intro, methods, results, conclusions, and at least one figure (the landscape PNG). Before passing any DataFrame-derived text to ReportLab Paragraph(), coerce nullable/NaN values to safe strings (e.g. str(v) if pd.notna(v) else "") to avoid TypeError crashes on float('nan').

Repository Coverage Map

Work through repositories in priority order. Tier 1 repositories have programmatic APIs and are the highest-yield sources. Tier 2 have APIs but are more specialized. Tier 3 require web search or manual curation. Always attempt all tiers — rare diseases often have data only in Tier 2/3 repositories.

Tier 1 — High-yield, programmatic APIs (always query)
Repository    Omics Focus    API Base URL    Notes
GEO (NCBI)    All transcriptomics, epigenomics    https://eutils.ncbi.nlm.nih.gov/entrez/eutils/    Largest source; run 20–40 targeted queries
SRA (NCBI)    Raw sequencing reads    https://eutils.ncbi.nlm.nih.gov/entrez/eutils/ (db=sra)    Complements GEO; finds studies not deposited as GEO series
ArrayExpress / BioStudies (EBI)    Transcriptomics, functional genomics    https://www.ebi.ac.uk/biostudies/api/v1/search    European mirror of GEO; many unique studies
PRIDE / ProteomeXchange    Proteomics (MS)    https://www.ebi.ac.uk/pride/ws/archive/v3/projects    Primary proteomics repository; v2 endpoint deprecated (404)
OmicsDI (aggregator)    Multi-omics aggregator    https://www.omicsdi.org/ws/dataset/search    Covers MetaboLights, MassIVE, GNPS, Metabolomics Workbench, ArrayExpress, GEO, PRIDE — use to catch metabolomics and avoid re-querying individual repos
CZ CELLxGENE    scRNA-seq, spatial    https://api.cellxgene.cziscience.com/curation/v1/collections    33M+ cells; query by disease using cellxgene_census Python package
GDC / TCGA (NCI)    Cancer multi-omics    https://api.gdc.cancer.gov/    Best for cancer diseases; covers TCGA, TARGET, CGCI, CPTAC-GDC
Tier 2 — Specialized APIs (query when relevant to disease/omics type)
Repository    Omics Focus    API / Access    When to use
ENCODE    Epigenomics (ChIP-seq, ATAC-seq, RNA-seq)    https://www.encodeproject.org/search/?format=json    Regulatory genomics; TF binding; chromatin accessibility
Expression Atlas (EBI)    Bulk + single-cell RNA-seq    https://www.ebi.ac.uk/gxa/json/experiments    Curated, baseline + differential expression experiments
Human Cell Atlas (HCA)    scRNA-seq, spatial    https://service.azul.data.humancellatlas.org/index/projects    Reference cell type atlases; healthy tissue baselines
Metabolomics Workbench (NIH)    Metabolomics, lipidomics    https://www.metabolomicsworkbench.org/rest/study/study_id/ST/named_json    NIH-funded metabolomics; REST API available
MetaboLights (EBI)    Metabolomics    https://www.ebi.ac.uk/metabolights/ws/studies/    European metabolomics repository
MassIVE / GNPS    Metabolomics, lipidomics    https://massive.ucsd.edu/ProteoSAFe/datasets.jsp    MS-based metabolomics; use OmicsDI to search
jPOST    Proteomics (MS)    https://repository.jpostdb.org/search    Japanese proteomics repository; ProteomeXchange member
iProX    Proteomics (MS)    https://www.iprox.cn/page/project.html    Chinese proteomics repository; ProteomeXchange member
cBioPortal    Cancer multi-omics    https://www.cbioportal.org/api/    Cancer genomics; mutation, CNA, expression, methylation
EpiRR / IHEC    Epigenomics reference    https://www.ebi.ac.uk/epirr/api/    IHEC reference epigenomes; healthy tissue baselines
Human Protein Atlas (HPA)    Proteomics, RNA-seq    https://www.proteinatlas.org/api/    Tissue/cell-type protein and RNA expression
ENA (EBI)    Raw sequencing    https://www.ebi.ac.uk/ena/portal/api/search    European mirror of SRA; raw reads
Tier 3 — Web search + manual curation (always attempt via WebSearch tool)
Repository    Omics Focus    Search Strategy
Zenodo    All types    WebSearch: "{disease}" omics dataset site:zenodo.org
Figshare    All types    WebSearch: "{disease}" RNA-seq proteomics site:figshare.com
Dryad    All types    WebSearch: "{disease}" omics data site:datadryad.org
OSF (Open Science Framework)    All types    WebSearch: "{disease}" omics dataset site:osf.io
Harvard Dataverse    All types    WebSearch: "{disease}" omics dataset site:dataverse.harvard.edu
Synapse (Sage Bionetworks)    Neuroscience, cancer    WebSearch: "{disease}" omics dataset site:synapse.org
ICGC Data Portal    Cancer genomics    WebSearch: "{disease}" ICGC site:dcc.icgc.org
CPTAC (NCI)    Cancer proteomics    WebSearch: "{disease}" CPTAC proteomics site:proteomics.cancer.gov
AWS Open Data Registry    All types    WebSearch: "{disease}" omics site:registry.opendata.aws
dbGaP (NIH, controlled)    Genomics, WGS    WebSearch: "{disease}" WGS genomics site:ncbi.nlm.nih.gov/gap
EGA (EBI, controlled)    Genomics, WGS    WebSearch: "{disease}" genome sequencing site:ega-archive.org
JGA (Japan, controlled)    Genomics    WebSearch: "{disease}" genomics site:ddbj.nig.ac.jp/jga
UK Biobank    Population genomics    WebSearch: "{disease}" UK Biobank omics
FinnGen    Population genomics    WebSearch: "{disease}" FinnGen GWAS
Workflow
Step 1 — Ask upfront clarification questions (MANDATORY before any search)

This step is not optional. Before running any queries, use AskUserQuestion to collect the information below. Do not assume defaults — the answers materially affect which repositories are queried, how many results are returned, and how the relevance audit is tuned.

Ask ALL of the following in a single AskUserQuestion call (skip any already answered in the user's initial message, but always ask the rest):

Q1 — Disease / topic (if not already provided)

What disease, phenotype, gene, or biological process should we search for?
Any synonyms, abbreviations, or alternative names to include? (e.g., "SCD", "SCA", "HbSS" for sickle cell disease — more synonyms = better recall)
Any key genes or pathways central to this topic? (used to build additional targeted GEO queries beyond the disease name alone)

Q2 — Omics types

Which omics types should be included?
All types (default) — transcriptomics, proteomics, metabolomics, epigenomics, genomics, single-cell, spatial, multi-omics
Transcriptomics only — bulk RNA-seq, microarray, scRNA-seq, spatial
Epigenomics only — ChIP-seq, ATAC-seq, methylation, CUT&RUN, Hi-C
Proteomics / metabolomics only — MS proteomics, metabolomics, lipidomics
Custom — user specifies which types to include

Q3 — Organism

Which organisms should be included?
All organisms (default) — human, mouse, and any other species
Human only — Homo sapiens studies only
Specific species — user specifies (e.g., mouse only, zebrafish only)

Q4 — Year range

Any restriction on publication/deposit year?
No restriction (default) — all years
Recent only — e.g., 2018 onwards, 2020 onwards
Custom range — user specifies start and/or end year

Q5 — Controlled-access repositories

Should we include controlled-access repositories (dbGaP, EGA, JGA)? These require institutional data access agreements to download data, but we can still catalog their existence and metadata.
Yes, include and flag them (default) — catalog with "Controlled" label
No, open-access only — skip dbGaP, EGA, JGA entirely

Q6 — Goal / output format

What is the primary goal?
Browse and select (default) — CSV catalog + Markdown summary for review
Landscape overview — also generate a visual overview figure (donut + timeline + repository bar)
Download and analyze — also include direct download links and file formats where available
All of the above

Q7 — Tissue or cell type focus (optional but significantly improves recall)

Are there specific tissues, cell types, or sample sources to prioritize? (e.g., "whole blood", "brain cortex", "CD34+ HSCs", "plasma", "tumor") These are added as targeted search terms to GEO and other repositories. If none specified, broad disease-name queries are used.

Only proceed to Step 2 once all answers are collected. If the user provides partial information upfront (e.g., just the disease name), ask only the remaining unanswered questions.

Step 2 — Build search term matrix

Generate a comprehensive set of search queries by combining:

Primary disease name + synonyms
Omics-type-specific terms (RNA-seq, microarray, ChIP-seq, ATAC-seq, scRNA-seq, proteomics, metabolomics, methylation, WGS, SNP array, CUT&RUN, Hi-C, spatial transcriptomics, lipidomics)
Tissue/cell-type terms relevant to the disease
Clinical context terms (treatment, crisis, biomarker, pediatric, longitudinal)
Key gene/pathway terms central to the disease

GEO query syntax tips:

Use [Title] field tag for high-precision hits: "sickle cell"[Title] AND "RNA-seq"
Use [DataSet Type] for omics filtering: "expression profiling by array"[DataSet Type]
Use retmax=100 per query; run 20–40 queries to maximize recall
Deduplicate by GEO UID across all queries
Step 3 — Query GEO (NCBI E-utilities) — PRIMARY SOURCE
import requests, time, pandas as pd

BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"

# Build 20-40 queries combining disease + omics + tissue + gene terms
# Example for any disease:
search_queries = {
    "title_rnaseq":    f'"{disease}"[Title] AND "RNA-seq"',
    "title_scrna":     f'"{disease}"[Title] AND "single cell"',
    "title_array":     f'"{disease}"[Title] AND "expression profiling by array"[DataSet Type]',
    "title_chip":      f'"{disease}" AND "ChIP-seq"',
    "title_atac":      f'"{disease}" AND "ATAC-seq"',
    "title_methyl":    f'"{disease}" AND "methylation"',
    "title_wgs":       f'"{disease}" AND "whole genome sequencing"',
    "title_proteom":   f'"{disease}" AND "proteomics"',
    "title_metabolom": f'"{disease}" AND "metabolomics"',
    # Add synonym-based queries:
    # f'"{synonym}"[Title] AND "RNA-seq"' for each synonym
    # Add tissue-specific queries:
    # f'"{disease}" AND "{tissue_term}"' for key tissues
    # Add gene-specific queries:
    # f'"{disease}" AND "{key_gene}"' for key disease genes
}

all_ids = set()
for label, query in search_queries.items():
    r = requests.get(f"{BASE}esearch.fcgi",
                     params={"db": "gds", "term": query, "retmax": 100, "retmode": "json"})
    ids = r.json().get("esearchresult", {}).get("idlist", [])
    all_ids.update(ids)
    time.sleep(0.34)  # Stay under NCBI rate limit (3 req/sec without API key)

# Fetch summaries in batches of 20
records = []
for i in range(0, len(list(all_ids)), 20):
    batch = list(all_ids)[i:i+20]
    r = requests.get(f"{BASE}esummary.fcgi",
                     params={"db": "gds", "id": ",".join(batch), "retmode": "json"})
    result = r.json().get("result", {})
    for uid in result.get("uids", []):
        item = result[uid]
        records.append({
            "Accession": item.get("accession", ""),
            "Title": item.get("title", ""),
            "GEO_Type": item.get("gdstype", ""),
            "Organism": item.get("taxon", ""),
            "N_Samples": item.get("n_samples", ""),
            "Date": item.get("pdat", ""),
            "Summary": item.get("summary", "")[:500],
            "Repository": "GEO",
        })
    time.sleep(0.34)

df_geo = pd.DataFrame(records)
# Filter: GSE/GDS accessions only (exclude GPL platform records)
# By default, keep ALL organisms. Only filter by organism if user explicitly requested a specific species.
# Example organism filter (apply only if requested):
#   df_geo = df_geo[df_geo["Organism"].str.contains("Homo sapiens", na=False)]
df_geo = df_geo[df_geo["Accession"].str.startswith(("GSE", "GDS"))]

NCBI API key: Set api_key param to increase rate limit to 10 req/sec (register free at NCBI).

Step 4 — Query SRA (NCBI) for raw sequencing studies not in GEO
import xml.etree.ElementTree as ET

# SRA catches studies deposited as raw reads without a GEO series.
#
# IMPORTANT — SRA esummary response shape (verified against the live API):
# Unlike GEO esummary (which returns nested dicts), the SRA esummary returns
# XML *strings* in the "expxml" and "runs" fields. The top-level item has only
# {uid, expxml, runs, extlinks, createdate, updatedate} — there are NO
# "experiment"/"study"/"sample"/"organism"/"title"/"summary" dict fields.
# Parsing expxml/runs as nested dicts (the old code) therefore yields 0 records.
# Parse the XML strings with xml.etree.ElementTree instead.
sra_records = []
for query in [disease] + synonyms[:3]:
    # Default: search all organisms. Add AND "Homo sapiens"[Organism] only if user requested human-only.
    r = requests.get(f"{BASE}esearch.fcgi",
                     params={"db": "sra", "term": f'"{query}"',
                             "retmax": 100, "retmode": "json"})
    ids = r.json().get("esearchresult", {}).get("idlist", [])
    if ids:
        # Fetch in batches of 50 to stay within esummary limits
        for bi in range(0, len(ids), 50):
            batch = ids[bi:bi+50]
            r2 = requests.get(f"{BASE}esummary.fcgi",
                              params={"db": "sra", "id": ",".join(batch), "retmode": "json"})
            result = r2.json().get("result", {})
            for uid in result.get("uids", []):
                item = result[uid]
                expxml = item.get("expxml", "") or ""
                runs_xml = item.get("runs", "") or ""

                # Parse the expxml XML string for metadata.
                title = ""
                exp_acc = ""
                study_acc = ""
                sample_acc = ""
                organism_name = "unknown"
                exptype = ""
                try:
                    root = ET.fromstring(f"<root>{expxml}</root>")
                    summary_el = root.find(".//Summary")
                    if summary_el is not None:
                        title_el = summary_el.find("Title")
                        if title_el is not None:
                            title = title_el.text or ""
                    exp_el = root.find(".//Experiment")
                    if exp_el is not None:
                        exp_acc = exp_el.get("acc", "")
                    study_el = root.find(".//Study")
                    if study_el is not None:
                        study_acc = study_el.get("acc", "")
                    sample_el = root.find(".//Sample")
                    if sample_el is not None:
                        sample_acc = sample_el.get("acc", "")
                    org_el = root.find(".//Organism")
                    if org_el is not None:
                        organism_name = org_el.get("ScientificName", "unknown")
                    lib_el = root.find(".//LIBRARY_STRATEGY")
                    if lib_el is not None and lib_el.text:
                        exptype = lib_el.text
                except ET.ParseError:
                    pass

                # Parse the runs XML string for the run accession + spot count.
                run_acc = ""
                n_spots = ""
                try:
                    run_root = ET.fromstring(f"<root>{runs_xml}</root>")
                    run_el = run_root.find(".//Run")
                    if run_el is not None:
                        run_acc = run_el.get("acc", "")
                        n_spots = run_el.get("total_spots", "")
                except ET.ParseError:
                    pass

                # Prefer the most specific real accession; fall back through the chain
                accession = run_acc or exp_acc or study_acc or sample_acc or ""
                # Drop rows where ALL metadata fields are empty — these are just
                # numeric internal IDs with no usable information.
                if not any([accession, title, organism_name != "unknown"]):
                    continue
                sra_records.append({
                    "Accession": accession,
                    "Title": title,
                    "GEO_Type": exptype,
                    "Organism": organism_name,
                    "N_Samples": n_spots,
                    "Date": item.get("createdate", ""),
                    "Summary": "",
                    "Repository": "SRA",
                })
        time.sleep(0.34)
Step 5 — Query ArrayExpress / BioStudies (EBI)
import re

# BioStudies API — covers ArrayExpress functional genomics collection
# Source: https://www.ebi.ac.uk/biostudies/api/v1/search
#
# IMPORTANT — search-hit response shape (verified against the live API):
# each hit exposes: accession, title, type (always "study"), release_date, files,
# links, and `content` — a free-text blob containing the assay type
# (e.g. "transcription profiling by array"), EFO ontology terms, organism, and the
# study description. There is NO releaseDate / description / numberOfSamples /
# organism field on the hit — those live only at /studies/{accession}, which is too
# expensive to fetch per row. So we read release_date + mine `content` instead.
biostudies_url = "https://www.ebi.ac.uk/biostudies/api/v1/search"
biostudies_records = []

# Best-effort organism surfacing from the free-text `content` blob. The search snippet is
# truncated and query-centered, so it often omits the species (~64% coverage). Step 15
# backfills the authoritative organism from /studies/{accession} for the high-relevance
# rows, bringing those to ~100%.
ORGANISM_PATTERNS = ["Homo sapiens", "Mus musculus", "Rattus norvegicus", "Danio rerio",
                     "Drosophila melanogaster", "Saccharomyces cerevisiae",
                     "Caenorhabditis elegans", "Gallus gallus", "Sus scrofa",
                     "Macaca mulatta", "Pan troglodytes", "Arabidopsis thaliana"]

for keyword in [disease] + synonyms[:2]:
    r = requests.get(biostudies_url,
                     params={"query": keyword, "collection": "arrayexpress",
                             "pageSize": 100, "page": 1},
                     headers={"Accept": "application/json"}, timeout=60)
    if r.status_code == 200:
        data = r.json()
        for hit in data.get("hits", []):
            content = hit.get("content", "") or ""
            organism = "; ".join([o for o in ORGANISM_PATTERNS if o in content])
            biostudies_records.append({
                "Accession": hit.get("accession", ""),
                "Title": hit.get("title", ""),
                # `type` is always "study"; the real assay type is inside `content`
                # (e.g. "transcription profiling by array") and is recovered by
                # classify_omics in Step 13, which reads Title + Summary.
                "GEO_Type": "",
                "Organism": organism,
                "N_Samples": "",  # not in the search response; only files/links counts
                "Date": hit.get("release_date", ""),
                "Summary": content[:500],
                "Repository": "ArrayExpress/BioStudies",
            })
    time.sleep(1)

df_biostudies = pd.DataFrame(biostudies_records).drop_duplicates(subset="Accession")
# Do NOT drop E-GEOD- accessions here. ~60% of ArrayExpress hits are E-GEOD-* (GEO
# studies mirrored into ArrayExpress), but many of those are studies the GEO step
# missed (different search terms / indexing), and dropping them here is the original
# bug that made this source effectively disappear from the catalog. Instead, we let
# them through and dedupe against native GEO records at assembly (Step 15) via
# accession normalization: E-GEOD-41575  <->  GSE41575.
# Keep all organisms by default. Apply organism filter only if user explicitly requested a specific species.
# Example: df_biostudies = df_biostudies[df_biostudies["Organism"].str.contains("Homo sapiens|human", case=False, na=False)]
Step 6 — Query PRIDE / ProteomeXchange (proteomics)
import re

# PRIDE REST API v3
# Source: https://www.ebi.ac.uk/pride/ws/archive/v3/projects
# NOTE: the v2 endpoint (https://www.ebi.ac.uk/pride/ws/archive/v2/projects/search)
# returns HTTP 404 — it has been deprecated/moved. Use v3 instead.
# The v3 keyword filter does not reliably filter server-side, so we fetch projects
# and apply client-side word-boundary filtering by disease terms in title/description.
pride_url = "https://www.ebi.ac.uk/pride/ws/archive/v3/projects"
pride_records = []
disease_terms = [disease.lower()] + [s.lower() for s in synonyms]

for keyword in [disease] + synonyms:
    r = requests.get(pride_url,
                     params={"keyword": keyword, "pageSize": 100, "page": 0},
                     headers={"Accept": "application/json"}, timeout=60)
    if r.status_code == 200:
        data = r.json()
        # Handle both list and dict response formats
        projects = data if isinstance(data, list) else data.get("_embedded", {}).get("projects", [])
        for p in projects:
            title = p.get("title", "") or ""
            desc = p.get("projectDescription", "") or ""
            # Client-side word-boundary filter: the v3 keyword param returns generic
            # projects regardless of keyword, so re-check title+description ourselves.
            ptext = (title + " " + desc).lower()
            if not any(re.search(r'\b' + re.escape(t) + r'\b', ptext) for t in disease_terms):
                continue
            # organisms may be a list of strings or list of dicts with a "species" field
            orgs = p.get("organisms", [])
            if orgs and isinstance(orgs[0], dict):
                orgs = [o.get("species", "") for o in orgs]
            pride_records.append({
                "Accession": p.get("accession", ""),
                "Title": title,
                "GEO_Type": "Proteomics (MS)",
                "Organism": "; ".join(orgs) if isinstance(orgs, list) else str(orgs),
                "N_Samples": p.get("numberOfSamples", "") or p.get("sampleCount", ""),
                "Date": p.get("submissionDate", "") or p.get("projectDate", ""),
                "Summary": desc[:500],
                "Repository": "PRIDE",
            })
    time.sleep(1)

df_pride = pd.DataFrame(pride_records).drop_duplicates(subset="Accession")
# Keep all organisms by default. Apply organism filter only if user explicitly requested a specific species.
# Example: df_pride = df_pride[df_pride["Organism"].str.contains("Homo sapiens|human", case=False, na=False)]

Also check jPOST and iProX (ProteomeXchange members not always in PRIDE search):

# jPOST REST API
# Source: https://repository.jpostdb.org/search
jpost_records = []
for keyword in [disease] + synonyms[:2]:
    r = requests.get("https://repository.jpostdb.org/search",
                     params={"keyword": keyword, "format": "json"}, timeout=30)
    if r.status_code == 200:
        for p in r.json().get("projects", []):
            jpost_records.append({
                "Accession": p.get("projectId", ""),
                "Title": p.get("title", ""),
                "GEO_Type": "Proteomics (MS)",
                "Organism": p.get("organism", ""),
                "N_Samples": "",
                "Date": p.get("releaseDate", ""),
                "Summary": p.get("description", "")[:500],
                "Repository": "jPOST",
            })
    time.sleep(1)
Step 7 — Query OmicsDI (metabolomics aggregator)

OmicsDI is the single best entry point for metabolomics — it aggregates MetaboLights, MassIVE, GNPS, Metabolomics Workbench, and Metabolon. Filter by source to avoid GEO duplicates.

# OmicsDI aggregator
# Source: https://www.omicsdi.org/ws/dataset/search
omicsdi_url = "https://www.omicsdi.org/ws/dataset/search"
omicsdi_records = []
METABOLOMICS_REPOS = {"MetaboLights", "MassIVE", "GNPS", "Metabolon",
                      "Metabolomics Workbench", "HMDB", "Lipidmaps"}

for keyword in [disease] + synonyms[:2]:
    r = requests.get(omicsdi_url,
                     params={"query": keyword, "size": 100, "start": 0},
                     headers={"Accept": "application/json"}, timeout=60)
    if r.status_code == 200:
        for ds in r.json().get("datasets", []):
            repo = ds.get("source", "")
            if repo in METABOLOMICS_REPOS:
                # organisms may be a dict with "name" list, a list, or a string;
                # guard against all shapes to avoid str.join iterating a string char-by-char.
                orgs = ds.get("organisms", {})
                if isinstance(orgs, dict):
                    org_names = orgs.get("name", [])
                elif isinstance(orgs, list):
                    org_names = orgs
                else:
                    org_names = [str(orgs)] if orgs else []
                # OmicsDI often returns an empty "name" field (especially for
                # MetaboLights, jPOST, and some ArrayExpress records). Fall back
                # to the description (stripped of HTML tags) so the Title column
                # is never blank, which would make relevance auditing impossible.
                title = ds.get("name", "") or ""
                if not title.strip():
                    desc = ds.get("description", "") or ""
                    # Strip simple HTML tags for a cleaner title
                    import re as _re
                    title = _re.sub(r"<[^>]+>", "", desc).strip()[:200]
                if not title.strip():
                    title = f"Untitled — see {ds.get('id', '')}"
                omicsdi_records.append({
                    "Accession": ds.get("id", ""),
                    "Title": title,
                    "GEO_Type": "Metabolomics",
                    "Organism": "; ".join(org_names) if isinstance(org_names, list) else str(org_names),
                    "N_Samples": "",
                    "Date": ds.get("publicationDate", ""),
                    "Summary": ds.get("description", "")[:500],
                    "Repository": repo,
                })
    time.sleep(1)

df_metabolomics = pd.DataFrame(omicsdi_records).drop_duplicates(subset="Accession")

Also query Metabolomics Workbench REST API directly for NIH-funded studies:

# Metabolomics Workbench REST API
# Source: https://www.metabolomicsworkbench.org/tools/mw_rest.php
mw_url = "https://www.metabolomicsworkbench.org/rest/study/study_title"
for keyword in [disease] + synonyms[:2]:
    r = requests.get(f"{mw_url}/{requests.utils.quote(keyword)}/summary/json", timeout=30)
    if r.status_code == 200 and r.text.strip():
        # Response is a dict of study_id -> study metadata
        for sid, meta in r.json().items():
            omicsdi_records.append({
                "Accession": sid,
                "Title": meta.get("study_title", ""),
                "GEO_Type": "Metabolomics",
                "Organism": meta.get("subject_species", ""),
                "N_Samples": meta.get("subject_count", ""),
                "Date": meta.get("submit_date", ""),
                "Summary": meta.get("study_summary", "")[:500],
                "Repository": "Metabolomics Workbench",
            })
Step 8 — Query CZ CELLxGENE (single-cell)
import re

# CZ CELLxGENE Collections API
# Source: https://api.cellxgene.cziscience.com/curation/v1/collections
cxg_url = "https://api.cellxgene.cziscience.com/curation/v1/collections"
r = requests.get(cxg_url, headers={"Accept": "application/json"}, timeout=60)
cxg_records = []
if r.status_code == 200:
    for col in r.json():
        title = col.get("name", "")
        desc = col.get("description", "")
        # Filter by disease keywords using word-boundary matching to avoid
        # short-synonym false positives (e.g. bare "ALS" inside "animals").
        text = (title + " " + desc).lower()
        if any(re.search(r'\b' + re.escape(kw.lower()) + r'\b', text) for kw in [disease] + synonyms):
            # d.get("organism") can return a list (not a string), which makes the
            # set comprehension raise "unhashable type: 'list'". Guard with isinstance.
            organisms = sorted({d.get("organism","") for d in col.get("datasets",[])
                                if isinstance(d.get("organism"), str) and d.get("organism")})
            cxg_records.append({
                "Accession": col.get("collection_id", ""),
                "Title": title,
                "GEO_Type": "scRNA-seq",
                "Organism": "; ".join(organisms) or "unknown",
                "N_Samples": col.get("cell_count", ""),
                "Date": col.get("published_at", ""),
                "Summary": desc[:500],
                "Repository": "CZ CELLxGENE",
            })

# Also use cellxgene_census Python package for cell-level metadata queries:
# import cellxgene_census
# census = cellxgene_census.open_soma()
# obs = census["census_data"]["homo_sapiens"].obs.read(
#     value_filter=f'disease == "{disease_ontology_term}"'
# ).concat().to_pandas()
Step 9 — Query GDC / TCGA (cancer diseases)

Only relevant for cancer diseases. Skip for non-cancer diseases.

# GDC REST API
# Source: https://api.gdc.cancer.gov/
gdc_url = "https://api.gdc.cancer.gov/projects"
r = requests.get(gdc_url,
                 params={"filters": json.dumps({"op": "in", "content": {
                             "field": "disease_type", "value": [disease] + synonyms}}),
                         "fields": "project_id,name,disease_type,primary_site,summary",
                         "format": "json", "size": 100},
                 timeout=60)
# Parse and add to records with Repository = "GDC/TCGA"
Step 10 — Query ENCODE (epigenomics)

Only relevant when the disease has known epigenomic/regulatory components.

# ENCODE REST API — rate limit: 10 req/sec
# Source: https://www.encodeproject.org/help/rest-api
encode_url = "https://www.encodeproject.org/search/"
r = requests.get(encode_url,
                 params={"searchTerm": disease, "type": "Experiment",
                         "status": "released", "format": "json", "limit": 100},
                 headers={"Accept": "application/json"}, timeout=60)
if r.status_code == 200:
    for exp in r.json().get("@graph", []):
        encode_records.append({
            "Accession": exp.get("accession", ""),
            "Title": exp.get("description", ""),
            "GEO_Type": exp.get("assay_title", ""),
            "Organism": exp.get("organism", {}).get("scientific_name", ""),
            "N_Samples": len(exp.get("replicates", [])),
            "Date": exp.get("date_released", ""),
            "Summary": exp.get("biosample_summary", "")[:500],
            "Repository": "ENCODE",
        })
Step 11 — Query Expression Atlas (EBI)
import re

# Expression Atlas REST API
# Source: https://www.ebi.ac.uk/gxa/json/experiments
# Default: no species filter — returns all organisms. Add species param only if user requested a specific organism.
atlas_url = "https://www.ebi.ac.uk/gxa/json/experiments"
r = requests.get(atlas_url, timeout=60)  # omit species= to get all organisms
atlas_records = []
if r.status_code == 200:
    for exp in r.json().get("experiments", []):
        text = (exp.get("experimentDescription","") + " " +
                " ".join(exp.get("factors",[])) + " " +
                " ".join(exp.get("experimentalFactors",[]))).lower()
        # Use word-boundary matching for disease keywords to avoid short-synonym
        # false positives (e.g. bare "ALS" matching inside "animals", "reveals").
        if any(re.search(r'\b' + re.escape(kw.lower()) + r'\b', text) for kw in [disease] + synonyms):
            # species may be a list OR a string; str.join iterates a string
            # character-by-character, corrupting "Homo sapiens" -> "H; o; m; o; ...".
            sp = exp.get("species", [])
            if isinstance(sp, list):
                organism = "; ".join(sp) if sp else "unknown"
            elif sp:
                organism = str(sp)
            else:
                organism = "unknown"
            atlas_records.append({
                "Accession": exp.get("experimentAccession", ""),
                "Title": exp.get("experimentDescription", ""),
                "GEO_Type": exp.get("experimentType", ""),
                "Organism": organism,
                "N_Samples": exp.get("numberOfAssays", ""),
                "Date": exp.get("lastUpdate", ""),
                "Summary": "",
                "Repository": "Expression Atlas",
            })
Step 12 — Web search for Tier 3 repositories

Use the WebSearch tool for repositories without disease-specific APIs. Run all of these:

# Open repositories
WebSearch: "{disease}" omics dataset site:zenodo.org
WebSearch: "{disease}" RNA-seq proteomics site:figshare.com
WebSearch: "{disease}" omics data site:datadryad.org
WebSearch: "{disease}" omics dataset site:osf.io
WebSearch: "{disease}" omics dataset site:dataverse.harvard.edu
WebSearch: "{disease}" omics dataset site:synapse.org

# Controlled-access repositories
WebSearch: "{disease}" WGS genomics site:ncbi.nlm.nih.gov/gap
WebSearch: "{disease}" genome sequencing site:ega-archive.org
WebSearch: "{disease}" genomics site:ddbj.nig.ac.jp/jga

# Consortium/specialized
WebSearch: "{disease}" ICGC genomics dataset
WebSearch: "{disease}" CPTAC proteomics dataset
WebSearch: "{disease}" UK Biobank omics
WebSearch: "{disease}" AWS open data omics

Extract accession IDs, titles, and descriptions from search results. Add as rows with the appropriate Repository label. Flag dbGaP/EGA/JGA as Access = "Controlled".

Step 13 — Classify omics type

Apply rule-based classification to each record's GEO_Type, Title, and Summary. The GEO gdstype field is unreliable — always use title + summary as primary signal.

import re

def classify_omics(row):
    combined = (str(row.get("GEO_Type","")) + " " +
                str(row.get("Title","")) + " " +
                str(row.get("Summary",""))).lower()

    # Single-cell (check before bulk RNA-seq)
    if any(x in combined for x in ["single cell", "scrna", "10x chromium", "dropseq",
                                    "smart-seq", "single-nucleus", "snrna"]):
        return "scRNA-seq"
    # Spatial transcriptomics
    elif any(x in combined for x in ["spatial transcriptom", "visium", "slide-seq",
                                      "merfish", "seqfish", "stereo-seq"]):
        return "Spatial Transcriptomics"
    # Chromatin accessibility
    elif "atac" in combined:
        return "ATAC-seq"
    # CUT&RUN / CUT&TAG
    elif any(x in combined for x in ["cut&run", "cut and run", "cutana", "cut&tag"]):
        return "CUT&RUN/CUT&TAG"
    # ChIP-seq
    elif any(x in combined for x in ["chip-seq", "chip seq", "binding/occupancy",
                                      "chromatin immunoprecipitation"]):
        return "ChIP-seq"
    # 3D genome — use word-boundary regex for short ambiguous substrings.
    # Bare "hic" matches inside "sclerosis" (sclero-hic), causing massive false positives.
    elif any(re.search(r'\b' + re.escape(x) + r'\b', combined) for x in ["hi-c", "hic", "3d genome", "chromatin conformation",
                                      "capture-c", "4c-seq", "5c"]):
        return "Hi-C / 3D Genome"
    # DNA methylation
    elif any(x in combined for x in ["methylat", "bisulfite", "wgbs", "rrbs",
                                      "epic array", "850k", "450k", "dnmt"]):
        return "DNA Methylation"
    # miRNA / ncRNA
    elif any(x in combined for x in ["mirna", "microrna", "ncrna", "lncrna",
                                      "small rna", "pirna", "circrna"]):
        return "miRNA/ncRNA"
    # Ribo-seq / RIP-seq
    elif any(x in combined for x in ["ribo-seq", "ribosome profiling", "rip-seq",
                                      "clip-seq", "iclip"]):
        return "Other (Ribo/RIP/CLIP-seq)"
    # Bulk RNA-seq
    elif any(x in combined for x in ["high throughput sequencing", "rna-seq", "rnaseq",
                                      "mrna-seq", "total rna", "poly-a"]):
        return "Bulk RNA-seq"
    # Microarray (note: ArrayExpress labels these "transcription profiling by array")
    elif any(x in combined for x in ["expression profiling by array",
                                      "transcription profiling by array", "microarray",
                                      "affymetrix", "illumina beadchip", "agilent"]):
        return "Microarray"
    # Genomics (ArrayExpress uses "comparative genomic hybridization" for CNV/CGH arrays)
    elif any(x in combined for x in ["wgs", "whole genome sequencing", "whole-genome",
                                      "snp array", "genotyping", "gwas", "exome",
                                      "comparative genomic hybridization"]):
        return "Genomics (WGS/SNP/Exome)"
    # Proteomics
    elif any(x in combined for x in ["proteom", "mass spectrometry", "lc-ms", "tmtpro",
                                      "label-free", "dia-ms", "dda-ms", "phosphoproteom"]):
        return "Proteomics (MS)"
    # Metabolomics / lipidomics
    elif any(x in combined for x in ["metabolom", "metabolite", "nmr", "gcms", "lcms",
                                      "lipidom", "lipidome", "untargeted ms"]):
        return "Metabolomics/Lipidomics"
    # Multi-omics
    elif any(x in combined for x in ["multi-omics", "multiomics", "multi omics",
                                      "integrat", "joint profil"]):
        return "Multi-omics"
    else:
        return "Other/Mixed"
Step 14 — Relevance audit (4-tier classification)

Classify each dataset into one of four relevance tiers based on keyword analysis of title + summary. Tune keyword lists for each disease — the examples below are for SCD.

import re

def _word_match(keyword, text):
    """Word-boundary match: prevents short synonyms like 'ALS', 'AD', 'SCD'
    from matching inside common English words ('animals', 'reveals', 'muscles').
    Multi-word phrases use the first token as the boundary anchor."""
    return bool(re.search(r'\b' + re.escape(keyword.lower()) + r'\b', text))

def audit_relevance(row, disease_keywords, weak_keywords, exclude_keywords):
    """
    disease_keywords: strings confirming direct disease relevance (patient data or validated model)
    weak_keywords:    strings indicating adjacent/tangential relevance
    exclude_keywords: strings indicating the dataset is NOT about the disease (false positives)

    All keyword matching uses word boundaries to avoid short-synonym false positives
    (e.g. bare 'als' matching inside 'animals', 'reveals', 'individuals').
    """
    text = (str(row.get("Title","")) + " " + str(row.get("Summary",""))).lower()

    # Hard exclusion: only exclude if NO disease keyword matches AND an exclude
    # keyword is present. This prevents excluding genuine disease studies that
    # also mention a comparator disease.
    has_disease = any(_word_match(kw, text) for kw in disease_keywords)
    if not has_disease and any(_word_match(kw, text) for kw in exclude_keywords):
        return "REMOVE"

    strong_hits = sum(1 for kw in disease_keywords if _word_match(kw, text))
    weak_hits   = sum(1 for kw in weak_keywords    if _word_match(kw, text))

    if strong_hits >= 2:
        return "CORE/DIRECT"
    elif strong_hits == 1 and weak_hits >= 1:
        return "CORE/DIRECT"
    elif strong_hits == 1 and weak_hits == 0:
        return "ADJACENT"
    elif weak_hits >= 1 and strong_hits == 0:
        return "WEAK"
    else:
        return "WEAK"

Relevance tier definitions:

Tier    Meaning    Action
CORE/DIRECT    Actual disease patient samples or validated disease model (e.g., HbSS mice)    Include in primary catalog
ADJACENT    Mechanistically relevant (e.g., HbF reactivation, globin switching) but no patient data    Include with flag; useful for mechanism studies
WEAK    Epidemiologically linked condition (e.g., sickle cell trait, RMC) or only tangentially related    Include with flag; user decides
REMOVE    False positive — no disease connection    Exclude; always manually review before deleting

Example keyword lists for SCD:

disease_keywords = ["sickle cell", "sickle-cell", "HbSS", "hemoglobin S",
                    "vaso-occlus", "sickling", "SCA patient", "SCD patient",
                    "sickle cell anemia", "sickle cell disease"]
weak_keywords    = ["sickle cell trait", "HbAS", "renal medullary carcinoma",
                    "RMC", "beta-thalassemia", "thalassemia only"]
exclude_keywords = ["lung cancer", "gastric cancer", "colon cancer",
                    "BACH1 lung", "unrelated disease"]  # tune per run

Short-synonym warning: Disease abbreviations like ALS, AD, SCD, MND, FTD are short enough to match inside common English words when used as bare substrings (ALS → animals, reveals, individuals; AD → loaded, reading; SCD → muscle-derived). The audit_relevance function above uses word-boundary regex (\b) for all keyword matching to prevent this. When tuning keyword lists for a new disease, prefer full disease names over abbreviations wherever possible, and always test short synonyms against a sample of known false-positive titles.

Always manually review REMOVE candidates before deleting — keyword matching produces false negatives.

Step 15 — Assemble master catalog
import pandas as pd, re

# Combine all sources. Order matters for dedup: list df_geo BEFORE df_biostudies so
# that when a study exists in both (e.g. GSE41575 and its E-GEOD-41575 mirror), the
# richer native GEO record is the one kept.
all_dfs = [df for df in [df_geo, df_sra, df_biostudies, df_pride, df_jpost,
                          df_metabolomics, df_cxg, df_encode, df_atlas,
                          df_zenodo, df_figshare, df_controlled]
           if df is not None and len(df) > 0]
df_all = pd.concat(all_dfs, ignore_index=True)

# Deduplicate across repositories. The same study can appear under different accession
# formats — most commonly a GEO series (GSE41575) and its ArrayExpress mirror
# (E-GEOD-41575). Normalize to a common key so these collapse, while genuinely unique
# ArrayExpress studies (E-MTAB-, E-MEXP-, E-TABM-, …) are retained.
def dedup_key(acc):
    acc = str(acc)
    m = re.match(r"^E-GEOD-(\d+)$", acc)
    return f"GSE{m.group(1)}" if m else acc
df_all["_dedup"] = df_all["Accession"].apply(dedup_key)
df_all = df_all.drop_duplicates(subset="_dedup").drop(columns=["_dedup"])

# Apply omics classification
df_all["Omics_Type"] = df_all.apply(classify_omics, axis=1)

# Apply relevance audit
df_all["Relevance"] = df_all.apply(
    lambda row: audit_relevance(row, disease_keywords, weak_keywords, exclude_keywords), axis=1
)

# --- Organism accuracy pass for ArrayExpress/BioStudies ---
# ArrayExpress search hits don't expose organism reliably — Step 5 mines a truncated,
# query-centered text snippet that often omits the species (≈64% coverage). For the rows
# that matter most (CORE/DIRECT + ADJACENT), fetch the authoritative organism from the
# per-study endpoint. Scoped to the validated subset so this stays cheap (a handful of
# calls) instead of one call per catalog row, which would be too slow at catalog scale.
def fetch_biostudies_organism(accession):
    """Return '; '-joined organism(s) from the BioStudies per-study record, walking
    nested subsections (sample-level organism attributes). '' on any failure."""
    try:
        r = requests.get(f"https://www.ebi.ac.uk/biostudies/api/v1/studies/{accession}",
                         headers={"Accept": "application/json"}, timeout=30)
        if r.status_code != 200:
            return ""
        organisms, stack = [], [r.json().get("section", {})]
        while stack:
            node = stack.pop()
            if isinstance(node, dict):
                for a in node.get("attributes", []) or []:
                    if str(a.get("name", "")).strip().lower() == "organism" and a.get("value"):
                        organisms.append(a["value"].strip())
                if node.get("subsections"):
                    stack.append(node["subsections"])
            elif isinstance(node, list):
                stack.extend(node)
        seen, out = set(), []
        for o in organisms:
            if o.lower() not in seen:
                seen.add(o.lower()); out.append(o)
        return "; ".join(out)
    except Exception:
        return ""

needs_organism = df_all[
    (df_all["Repository"] == "ArrayExpress/BioStudies")
    & (df_all["Relevance"].isin(["CORE/DIRECT", "ADJACENT"]))
    & (df_all["Organism"].fillna("").str.strip() == "")
]
for idx, row in needs_organism.iterrows():
    org = fetch_biostudies_organism(row["Accession"])
    if org:
        df_all.at[idx, "Organism"] = org
    time.sleep(0.2)  # be gentle on the EBI API

# Add access level column
CONTROLLED_REPOS = {"dbGaP", "EGA", "JGA", "UK Biobank", "FinnGen"}
df_all["Access"] = df_all["Repository"].apply(
    lambda r: "Controlled" if any(c in r for c in CONTROLLED_REPOS) else "Open"
)

# --- Date normalization ---
# Different repositories return dates in different formats: GEO uses YYYY/MM/DD,
# ArrayExpress uses YYYY-MM-DD, SRA/OmicsDI use compact YYYYMMDD, and some rows
# are year-only floats or ISO datetimes. Normalize everything to YYYY-MM-DD so
# the Date column is consistent and sorts correctly. Empty/invalid dates stay "".
def normalize_date(v):
    s = str(v).strip() if pd.notna(v) else ""
    if not s or s.lower() in ("nan", "none", "nat"):
        return ""
    # YYYY/MM/DD -> YYYY-MM-DD
    m = re.match(r"^(\d{4})/(\d{2})/(\d{2})", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    # compact YYYYMMDD -> YYYY-MM-DD
    m = re.match(r"^(\d{4})(\d{2})(\d{2})", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    # ISO datetime YYYY-MM-DDTHH:... -> YYYY-MM-DD
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", s)
    if m:
        return m.group(1)
    # year-only float like 2024.0 -> "" (not a full date)
    if re.match(r"^\d{4}\.0$", s):
        return ""
    # already YYYY-MM-DD
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return s
    return s  # leave unrecognized values as-is rather than dropping data

df_all["Date"] = df_all["Date"].apply(normalize_date)

# Sort: relevance tier first, then year descending
tier_order = {"CORE/DIRECT": 0, "ADJACENT": 1, "WEAK": 2, "REMOVE": 3}
df_all["_tier"] = df_all["Relevance"].map(tier_order)
df_all = df_all.sort_values(["_tier", "Date"], ascending=[True, False]).drop(columns=["_tier"])

# Save outputs
df_all.to_csv(f"{output_dir}/{disease_slug}_omics_datasets_MASTER.csv", index=False)
df_validated = df_all[df_all["Relevance"].isin(["CORE/DIRECT", "ADJACENT"])]
df_validated.to_csv(f"{output_dir}/{disease_slug}_omics_datasets_VALIDATED.csv", index=False)

print(f"Total datasets: {len(df_all)}")
print(f"CORE/DIRECT: {(df_all.Relevance=='CORE/DIRECT').sum()}")
print(f"ADJACENT: {(df_all.Relevance=='ADJACENT').sum()}")
print(f"WEAK: {(df_all.Relevance=='WEAK').sum()}")
print(f"REMOVE: {(df_all.Relevance=='REMOVE').sum()}")
Step 16 — Generate Markdown summary report

Write <disease>_omics_summary.md with these sections:

Overview: total datasets found, repositories searched, date of search
By repository: table of dataset counts per repository
By omics type: table of dataset counts per omics type (CORE/DIRECT only)
Relevance breakdown: counts per tier with brief explanation
Top datasets: largest N, most recent, most cited (if available)
Controlled-access datasets: list with access instructions
Coverage gaps and limitations: which repositories failed, which APIs require keys, which omics types are data-sparse for this disease

When writing DataFrame-derived values into the Markdown or PDF report, coerce nullable values to safe strings first: str(v) if pd.notna(v) else "" (or "N/A"). ReportLab Paragraph() raises TypeError on float('nan'), and CSV/Markdown cells render as literal nan if not coerced.

Step 17 — Generate overview figure (if requested)

Create a 3-panel figure saved as <disease>_omics_landscape.png:

import matplotlib.pyplot as plt, matplotlib
matplotlib.rcParams['font.family'] = ['Liberation Sans', 'Arimo', 'DejaVu Sans']
matplotlib.rcParams['svg.fonttype'] = 'none'

fig, axes = plt.subplots(1, 3, figsize=(18, 6))

# Panel A: Donut chart — CORE/DIRECT datasets by omics type
# Panel B: Horizontal bar chart — all datasets by repository
# Panel C: Stacked bar timeline — datasets per year, colored by omics type

fig.savefig(f"{output_dir}/{disease_slug}_omics_landscape.png", dpi=150, bbox_inches="tight")

After saving, run Read(file_path=...) to verify the figure renders correctly.

Known API Limitations and Workarounds
Repository    Issue    Workaround
GEO    retmax=100 per query cap    Run 20–40 targeted queries; use [Title] field tags
PRIDE    v2 endpoint returns HTTP 404 (deprecated/moved); v3 keyword filter does not filter server-side    Use v3 endpoint (https://www.ebi.ac.uk/pride/ws/archive/v3/projects); apply client-side word-boundary filtering by disease terms in title/description
MetaboLights    Direct search API returns 404    Use OmicsDI aggregator instead
Metabolomics Workbench    REST API requires exact study title match    Use keyword search via OmicsDI; use REST for known study IDs
ArrayExpress/BioStudies    Search hits do NOT expose releaseDate/description/organism/numberOfSamples — only release_date + a free-text content blob    Read release_date; mine content for summary/organism/assay type (Step 5). Organism mining is ~64% (truncated snippet); Step 15 backfills organism from /studies/{accession} for CORE/ADJACENT rows → ~100% where it matters, without a per-row cost on the full catalog
ArrayExpress/BioStudies    ~60% of hits are E-GEOD-* GEO mirrors    Do NOT drop them at query time; dedupe against GEO at assembly via E-GEOD-NNN → GSENNN normalization (Step 15) so unique studies survive
DISGENET    API v7 requires paid API key; returns HTML without key    Skip; use GEO + PubMed searches instead
GWAS Catalog    findByDiseaseTrait returns 0 for many disease names (trait name mismatch)    Search by EFO ontology ID; browse manually at https://www.ebi.ac.uk/gwas/
CellxGene    No disease-specific collection tagging for rare diseases    Filter by disease field in Census cell metadata
ENCODE    Rate limit 10 req/sec    Add time.sleep(0.1) between requests
dbGaP / EGA / JGA    No open programmatic search API    Web search + manual curation; flag as Controlled access
Zenodo / Figshare / Dryad    No disease-specific API    WebSearch with site: operator
Synapse    Requires login for some datasets    Web search for public projects; note login requirement
GDC/TCGA    Only relevant for cancer diseases    Skip for non-cancer diseases
jPOST / iProX    API may be unstable    Fall back to ProteomeCentral search at http://central.proteomexchange.org
Scientific Caveats

GEO gdstype field is unreliable: Often says "Other" or "Expression profiling by high throughput sequencing" for ChIP-seq, ATAC-seq, and Ribo-seq studies. Always re-classify using title + summary text. Many studies are misclassified as "Hi-C" when they are RNA-seq.

Cross-repository duplicates are common: The same study may appear in GEO, ArrayExpress, SRA, and OmicsDI. GEO accessions (GSE) and ArrayExpress accessions (E-GEOD-) frequently refer to the same study under different accession formats. Step 15 normalizes E-GEOD-NNN → GSENNN before deduplicating so these collapse to one record — while native ArrayExpress studies (E-MTAB-, E-MEXP-, E-TABM-) are kept. Do NOT pre-filter E-GEOD- accessions at query time: doing so silently drops studies the GEO step may have missed.

Controlled-access datasets: dbGaP, EGA, and JGA studies require institutional data access agreements. Include them in the catalog but clearly label as "Controlled" access.

Relevance audit is keyword-based: Automated scoring produces false positives (unrelated studies mentioning disease keywords) and false negatives (relevant studies with unusual terminology). Always manually review REMOVE candidates before excluding.

Short-synonym false positives: Disease abbreviations like ALS, AD, SCD, MND, FTD are short enough to match inside common English words when used as bare substrings (ALS → animals, reveals, individuals; AD → loaded, reading; SCD → muscle-derived). All keyword matching in the query steps (3, 5, 8, 11) and the relevance audit (Step 14) uses word-boundary regex (\b) to prevent this. When tuning keyword lists for a new disease, prefer full disease names over abbreviations, and always test short synonyms against a sample of known false-positive titles before trusting the catalog.

GEO retmax cap: Each individual query is capped at 100 results. For common diseases (e.g., Alzheimer's, cancer), run many targeted queries to maximize recall.

PRIDE sample counts: Not always reported in the API response. Report as "N/A" when missing.

CellxGene disease ontology: CellxGene uses MONDO ontology terms for disease annotation. Look up the correct MONDO ID for your disease before filtering cell metadata.

Metabolomics is data-sparse: For most rare diseases, metabolomics datasets are few. Check Metabolomics Workbench and HMDB disease pages manually if OmicsDI returns nothing.

Spatial transcriptomics is emerging: Most spatial data (Visium, MERFISH) is in GEO or CellxGene. The field is growing rapidly — search with recent year filters.

Example Usage

User prompt: "Find all publicly available omics datasets for Alzheimer's disease"

Skill execution:

Synonyms: ["AD", "Alzheimer", "LOAD", "EOAD", "dementia", "amyloid", "tau"]
Tissue terms: brain, cortex, hippocampus, CSF, blood, iPSC neurons, microglia, astrocytes
Gene terms: APOE, APP, PSEN1, PSEN2, TREM2, BIN1, CLU, ABCA7
Run 30+ GEO queries, ArrayExpress, PRIDE, OmicsDI, CellxGene, Expression Atlas, Zenodo, Figshare
Classify omics types, audit relevance
Output: alzheimers_omics_datasets_MASTER.csv, alzheimers_omics_datasets_VALIDATED.csv, alzheimers_omics_summary.md

User prompt: "What RNA-seq data is available for BCL11A in erythroid cells?"

Skill execution:

Topic: BCL11A erythroid
Synonyms: ["BCL11A", "CTIP1", "fetal hemoglobin", "HbF", "globin switching"]
Tissue terms: erythroid, HUDEP, CD34, erythroblast, reticulocyte
Run targeted GEO + ArrayExpress queries; skip PRIDE/metabolomics (RNA-seq focus)
Output: bcl11a_erythroid_omics_datasets_MASTER.csv

User prompt: "Survey all cancer proteomics datasets for pancreatic ductal adenocarcinoma"

Skill execution:

Synonyms: ["PDAC", "pancreatic cancer", "pancreatic adenocarcinoma"]
Query PRIDE, jPOST, iProX, GDC/TCGA (PAAD project), CPTAC, cBioPortal
Skip metabolomics-only repos; focus on MS proteomics
Output: pdac_omics_datasets_MASTER.csv

60. open-targets
Category: DRUG DISCOVERY
Source: https://biomni.phylo.bio/skills?section=marketplace

<!-- archetype: analysis-workflow --> <!-- contract: evidence-v1 -->
When to Use This Skill

Use this skill to prioritize therapeutic targets for a disease by querying the Open Targets Platform GraphQL API for target-disease associations, evidence rows, GWAS study metadata, and credible sets. It is suited to early target identification when you have an EFO disease identifier and want an integrated, datasource-aware ranking backed by public evidence.

Do not use this skill for causal inference, clinical recommendation, participant-level analysis, or raw GWAS summary-statistics retrieval. It retrieves public integrated association evidence only.

Why X, not Y (READ FIRST)
API queries, not bulk download. The Open Targets Platform GraphQL API returns bounded, structured records with release metadata. Bulk data dumps (e.g. FTP parquet) are a different access mode with different provenance; this skill stays in the API zone and labels any over-budget need explicitly rather than silently switching modes.
Bounded samples, not exhaustive sweeps. Every paginated call is capped by configurable budgets (max_entities, max_pages, max_rows, max_bytes, max_elapsed). A retrieved target set is labelled complete or bounded_sample; it is never labelled exhaustive unless the API confirms it.
Discriminated semantics, not flat rows. Each evidence record carries a record_type, datasource_id, datatype, metric, scale, and an interpretation boundary. Association scores are integrated prioritization metrics on a 0-1 scale, not effect estimates, replication, or causal proof.
Immutable operation ledger, not ad-hoc calls. Every API operation is recorded in an append-only ledger with request hash, response hash, counts, and budget status. Bare HTTP POST calls bypass the ledger and are rejected by the shipped client helper.
Inputs
An EFO disease ID (e.g. MONDO_0004975 for Alzheimer disease).
Optionally a GWAS Catalog study ID (e.g. GCST005194).
Optionally the number of top targets to retrieve (default 10).
Outputs
target_ranking.csv — bounded top-N targets with overall and per-datatype association scores.
evidence_rows.csv — bounded evidence rows for the top target, with discriminated datasource and datatype semantics.
operation_ledger.json — immutable record of every API attempt with query, canonical request-body, and exact response-body hashes; byte counts, terminal state, and explicit retry/recovery links.
provenance.json — API release label, version, access date, declared source mode, operation-ledger hash, and infographic prompt hash.
report_facts.json — gated facts artifact feeding the report and source-witness checks.
report_content.json — presentation-independent content shared by every compatible report-style provider.
report_structure.json — provider-independent section and figure-placement contract.
root_bundle.json — authoritative source mode, input identity, operation lineage, and member hashes for the complete root deliverable set.
report_open-targets.pdf — the single canonical, provider-styled PDF report with task context, methods, results, deterministic figures, a GenerateImage infographic, references, and next steps.
Use the report-style provider selected for this run to generate a pdf report with infographics (use the Biomni GenerateImage tool), methods, results, conclusions, figures, references (cited inline with [N] markers), and next steps from all of the analyses. If no provider was explicitly selected, use the default pdf-report-generation provider. Never infer a provider from customer, tenant, project, or account context. If an explicitly selected provider is unavailable or incompatible, stop and report a missing-provider error rather than falling back. Regenerate any figure whenever its underlying data changes.
Figures
Step    File    Description
Target ranking    figures/figure_1_target_ranking.png    Top targets ranked by overall association score (deterministic bar chart from report_facts.json).
Datatype contribution    figures/figure_2_datatype_heatmap.png    Per-datatype contribution scores for top targets (deterministic heatmap from report_facts.json).
Workflow infographic    infographic_open_targets_workflow.png    Qualitative, non-data-bearing infographic of the API workflow and API/bulk boundary, generated by the Biomni GenerateImage tool.

All quantitative figures are deterministic and derived from report_facts.json. The infographic is qualitative only and carries no run-specific numbers, scores, rankings, variant IDs, or p-values.

Clarification Questions

Resolve the complete user prompt with scripts/prompt_contract.py before asking anything. If its status is ready, execute immediately with the returned inputs and record its selected_branch_ids; do not ask for confirmation, alternative inputs, validation depth, or preferences already fixed by the prompt. Apply the documented default top_n=10 and the evidence-only branch without asking when no GWAS/credible-set work was requested.

Ask one concise question naming only the unresolved field when the resolver returns clarify. That state is reserved for a missing required disease identifier, conflicting disease/top-N/study values, conflicting scope instructions, or a credible-set request with no GCST study identifier.

scope (single-select):

evidence_only — Retrieve evidence for the top target only.
with_credible_sets — Retrieve evidence plus GWAS credible sets and L2G predictions for the given study ID.

Derive with_credible_sets when the prompt supplies a GCST identifier or explicitly requests GWAS or credible-set analysis. Otherwise derive evidence_only. Record the resulting <question_id>:<choice_id> value in selected_branch_ids for the run receipt.

Standard Workflow
Step 0 — Resolve supplied inputs; ask only when required

Pass the full user prompt to prompt_contract.resolve_prompt. A ready result is authorization to run the declared workflow with those values immediately. A clarify result identifies the exact missing or ambiguous field; do not expand that into optional preference questions.

Step 1 — Capture API release metadata

Run the meta query to capture dataVersion and apiVersion, binding them to the operation ledger and provenance.

from open_targets_client import OpenTargetsClient
client = OpenTargetsClient()
meta = client.capture_release()
Step 2 — Resolve disease identity and rank targets

Query associatedTargets for the given EFO ID, retrieving a bounded top-N set with datatype scores.

from queries import REGISTRY
result = client.request(
    "meta_and_associated_targets",
    REGISTRY["meta_and_associated_targets"]["query"],
    {"efoId": disease_id, "size": top_n},
)
Step 3 — Retrieve evidence for the top target

Query evidences for the top-ranked target with cursor pagination, bounded by configured budgets.

evidence = client.request(
    "evidence", REGISTRY["evidence"]["query"],
    {"efoId": disease_id, "ensemblId": top_target_id, "size": 25, "cursor": None},
)
Step 4 — Inspect GWAS study and credible sets

Query study metadata and credible_sets with L2G and colocalisation for the given study ID. Before integrating the study into the disease context, run_analysis.py checks concordance: the study's returned traitFromSource and diseases list are compared to the queried EFO ID. If concordance cannot be established, the study is labeled independent_study_context and excluded from target-support conclusions.

study = client.request("study", REGISTRY["study"]["query"], {"studyId": study_id})
cred = client.request(
    "credible_sets", REGISTRY["credible_sets"]["query"],
    {"studyIds": [study_id], "size": 10},
)
Step 5 — Serialize records through the discriminated schema

Pass all records through semantics.py serializers with record_type, metric, scale, datasource_id, and interpretation boundary. L2G and colocalisation records carry a null datasource_id with an explicit not-applicable reason.

Step 6 — Build deterministic figures

Run visualize.py to produce the target-ranking bar chart and datatype heatmap from report_facts.json.

Step 7 — Generate the qualitative infographic

Call the Biomni GenerateImage tool with the fixed prompt from assets/infographic_prompt.txt to produce infographic_open_targets_workflow.png. The prompt is qualitative and non-data-bearing; it is built from fixed package text, not from run results. Read the prompt file immediately before calling GenerateImage; do not edit it afterward. The prompt SHA256 and delivered image SHA256 are derived into provenance.json and the run receipt, pairing the tool-use id, exact prompt, requested filename, and successful result id.

Step 8 — Build presentation-independent report content

After scientific lineage is finalized, run report_content.py to derive report_content.json and report_structure.json from report_facts.json and provenance.json. These files contain no palette, typography, logo, or customer styling. Every provider must render this same content and the existing deterministic figures; styling must not change, omit, or reinterpret scientific content.

Step 9 — Final report (MANDATORY TERMINAL STEP)

The run is not complete until this step has produced report_open-targets.pdf at the results root.

Use the report-style provider selected for this run to generate a pdf report with infographics (use the Biomni GenerateImage tool), methods, results, conclusions, figures, references (cited inline with [N] markers), and next steps from all of the analyses. If no provider was explicitly selected, use the default pdf-report-generation provider. Never infer a provider from customer, tenant, project, or account context. If an explicitly selected provider is unavailable or incompatible, stop and report a missing-provider error rather than falling back. Regenerate any figure whenever its underlying data changes.

Resolve the provider only from immutable user-message evidence using report_render_plan. The bundled build_report.py is the renderer for the default provider only. When an explicit compatible provider is selected, render report_content.json through that provider and pass its completed PDF with --provider-rendered-report. That path is an artifact input, never provider-selection evidence.

For an explicit provider, run run_analysis.py --content-only first. This completes the unchanged scientific analysis and leaves the style-free content without publishing a PDF. After the selected provider renders that content, run finalize_report.py --provider-rendered-report <workspace-pdf> with genuine visual-review evidence. This second phase does not repeat API queries or scientific calculations. The default provider may complete both phases in the ordinary run_analysis.py invocation.

Publish exactly one file as report_open-targets.pdf. Do not preserve a Phylo canonical report and create an enterprise-styled companion. Do not overwrite the canonical PDF after finalization; render and inspect the selected provider's completed file first, stage it once, and then call finalize_report_artifacts.

Render the PDF to a fresh workspace file named by workspace_report_file; do not open or truncate an existing PDF on the object-backed results mount. The staged_copy call below publishes the completed file under its declared results-root name.

Then verify the run and write its receipt. write_receipt runs every gate — the report exists at the results root and is big enough, each declared figure is present and non-blank, the infographic lineage resolves to a fail-closed three-state outcome (verified when there is a unique same-id GenerateImage call/result pair with the exact prompt/filename and a delivered-image hash; not_evaluable_platform_trace when a genuine event is present but truncated/id-less/agent-writable/hashless; failed for contradictory or fabricated evidence), its decoded pixels match an embedded image on page 1, and the finished PDF carries the selected provider's required markers — then records what each one returned. A not_evaluable_platform_trace lineage is release-blocking unless report_facts.json, provenance.json, and the report all disclose that provenance is not independently verified. Run bundled commands through run_bundled, which writes the QC-owned qc_run_log.json from the subprocess result and output hashes. Do not author execution events or copy transcript identifiers. Record PDF visual review with an explicit state: only pass may complete the mandatory gate; not_evaluable remains false and blocks a successful receipt. Produce every source-witness artifact declared in skill_contract.json. Receipt v3 rejects unmatched hashes, unavailable provider evidence, partial page coverage, or source-value disagreement. It raises if any mandatory gate is not pass, after writing the receipt, so a failed run leaves the diagnostic behind.

from report_content import write_report_content
from report_qc import (finalize_report_artifacts, finalize_root_bundle,
                       record_pdf_review, report_render_plan, run_bundled,
                       staged_copy, write_receipt)

# Build figures and scientific lineage before presentation.
run_bundled(
    ["python3", "scripts/visualize.py", "--facts", "report_facts.json", "--outdir", str(outdir)],
    "scripts/visualize.py",
    ["figures/figure_1_target_ranking.png", "figures/figure_2_datatype_heatmap.png"],
)
scientific_artifacts = [
    "target_ranking.csv", "evidence_rows.csv", "operation_ledger.json",
    "provenance.json", "report_facts.json", "figure_payloads.json",
    "figures/figure_1_target_ranking.png", "figures/figure_2_datatype_heatmap.png",
    "infographic_open_targets_workflow.png",
]
finalize_root_bundle(scientific_artifacts)
report_content = write_report_content(outdir)
render_plan = report_render_plan()
bundled_files = ["scripts/visualize.py"]
if render_plan["render_with_bundled"]:
    run_bundled(
        ["python3", "scripts/build_report.py", "--content", str(report_content),
         "--output", str(workspace_report_file)],
        "scripts/build_report.py",
        [str(workspace_report_file)],
    )
    bundled_files.append("scripts/build_report.py")
else:
    workspace_report_file = provider_rendered_report
staged_copy(workspace_report_file, "report_open-targets.pdf")
finalize_report_artifacts("report_open-targets.pdf")
root_artifacts = [
    *scientific_artifacts, "report_content.json", "report_structure.json",
    "report_open-targets.pdf",
]

# OT-R2-05: bind every review event to the current final-PDF SHA256 and artifact SHA256s
record_pdf_review(
    report_name="report_open-targets.pdf",
    text_artifact=extracted_text_file,
    rendered_page_files=rendered_page_files,
    reviewed_page_numbers=reviewed_page_numbers,
    review_attestation=visual_review_notes,
    review_state="pass",  # only after inspecting every rendered page
    pdf_sha256=current_pdf_sha256,
    artifact_sha256s=artifact_sha256s,
)
# OT-R2-02: pass infographic_prompt so the receipt pairs prompt+image hashes with the tool-use
write_receipt(
    report_name="report_open-targets.pdf",
    figures=figures,
    bundled_files=tuple(bundled_files),
    outputs=("figures/figure_1_target_ranking.png", "figures/figure_2_datatype_heatmap.png"),
    infographics=("infographic_open_targets_workflow.png",),
    infographic_prompt="assets/infographic_prompt.txt",
    qc_run_log="qc_run_log.json",
    narrative_facts="report_facts.json",
    narrative_provenance="provenance.json",
    root_artifacts=root_artifacts,
)

The v3 receipt is run_receipt.json at the results root, not beside this SKILL.md. It records report_content_complete and root_lineage_verified in addition to the execution, output, figure, provider-style, rendering, visual-review, source, and infographic gates. Do not write this file by hand. check_skill.py --require-run-receipt requires the schema marker and per-outcome evidence, so a hand-written block of trues fails.

Scientific caveats
Association scores are integrated prioritization metrics on a 0-1 scale, not effect estimates, replication, causal proof, or clinical validation. The overall_association_score field in report_facts.json records the value; the INTERPRETATION_BOUNDARIES in semantics.py record the boundary.
The target sample is bounded, not exhaustive. The completeness field in report_facts.json is complete or bounded_sample; it is never labelled exhaustive unless the API confirms it. The max_entities budget in open_targets_client.py is 50.
L2G and colocalisation records carry a null datasource_id with an explicit not-applicable reason. The FORBIDDEN_DATASOURCE_IDS set in semantics.py is {"ot_genetics_l2g", "ot_genetics_colocalisation"}.
GWAS Catalog study IDs are study-specific. GCST005194 is coronary artery disease, not Alzheimer disease; do not conflate study disease with the queried EFO disease. The studies field in report_facts.json records the study trait. The study_concordance field records whether the study's returned trait/ontology matches the queried disease; non-concordant studies are labeled independent_study_context and excluded from target-support conclusions.
The report derives executed-operation counts from operation_ledger.json. Five operations are executed in the representative run (meta, meta_and_associated_targets, evidence, study, credible_sets); nine operation families are registered and separately validated by live schema smoke. The report states these counts separately; no hard-coded executed count remains.
Machine-readable JSON artifacts (figure_payloads.json) are serialized with allow_nan=False; non-finite floats are converted to null and remain visually distinct from numeric zero in the heatmap.
PDF review evidence (text extraction, page renders, visual review) is hash-bound to the current final-PDF SHA256 and every artifact SHA256. A PDF overwrite, text substitution, or stale event fails the receipt gate.
Visual review of rendered PDF pages is not_evaluable when inspection is unavailable. The receipt records that typed state as a false mandatory outcome; it never converts unavailable evidence to success. A separate reviewer must inspect every rendered page and record review_state="pass".
Infographic provenance is a fail-closed three-state outcome (verified / not_evaluable_platform_trace / failed) recorded identically in report_facts.json (infographic_lineage), provenance.json, the report, and the run receipt. When the platform trace truncates the GenerateImage args (or the event is id-less, agent-writable, or hashless) the state is not_evaluable_platform_trace: it is never reported as verified, and the run may complete only when every surface discloses that the image provenance is not independently verified and makes no verification claim. A failed state (contradictory, paraphrased, mismatched, duplicate, or fabricated evidence) is always release-blocking. The exact prompt is never inferred from a truncated string.
Evidence Tier

Contract maturity: evidence_validated

This package carries a skill_contract.json (phylo-skill-evidence/1) with tested capabilities, source assertions with runtime witnesses, clarification branches, external-dependency budgets, and a PDF review specification. The auto validation matrix records not_run until the offline eval suite and a representative run have been executed; maturity upgrades to evidence_validated once they pass.

Data Sources & Licenses
Open Targets Platform GraphQL API — https://api.platform.opentargets.org/api/v4/graphql. Data under CC0 1.0 Universal (Public Domain Dedication); the API is free with no authentication. See references/licensing-and-access.md for access terms and verification.
GWAS Catalog (integrated by Open Targets) — https://www.ebi.ac.uk/gwas/. CC0 1.0. Study metadata and credible sets are retrieved through the Open Targets API, not directly from the GWAS Catalog.
Ensembl / UniProt / ChEMBL (integrated by Open Targets) — identifiers resolved through the API. See DATA_SOURCES.md for the full source list and licenses.

No participant-level data, raw GWAS summary statistics, or controlled-access data are retrieved.

Common Issues
HTTP 200 with a body-level error. The client rejects responses where data is null or errors is present, even with HTTP 200. See failure_body_error.json.
Empty semantic payload. The client rejects responses that parse but carry no semantic content. See failure_empty_semantic.json.
Pagination overrun. If a query exceeds max_pages or max_rows, the ledger records bounded_sample and the run continues; it does not silently loop. See test_pagination.py.
Missing infographic. If infographic_open_targets_workflow.png is absent, blank, or corrupt, build_report.py raises InfographicError and the report is not published. The receipt's infographics_generated_by_tool gate also verifies prompt/tool/image lineage and content-identity embedding. See test_infographic.py.
Truncated GenerateImage args in the platform trace. The platform execution trace can truncate the GenerateImage tool-call arguments (the fixed prompt is ~1124 chars; the trace caps args near 600 chars and appends a literal [truncated N chars] marker), so the exact prompt cannot be read. The infographics_generated_by_tool gate returns a fail-closed three-state outcome — verified, not_evaluable_platform_trace, or failed — computed by report_qc.classify_infographic_lineage. A truncated (or id-less, agent-writable, or hashless) but otherwise genuine event is not_evaluable_platform_trace: it never counts as verified, and it is release-blocking unless report_facts.json, provenance.json, and the report all disclose that provenance is not independently verified. Contradictory, paraphrased, mismatched, duplicate, or fabricated evidence is failed (always release-blocking). The truncated args string is never reconstructed into a prompt. See test_repair_r4.py.
Non-concordant GWAS study. If the study's returned trait does not match the queried disease, it is labeled independent_study_context and excluded from target-support conclusions. See test_repair_r2.py.
Stale PDF review events. If the PDF is overwritten after review events are recorded, the hash-binding check in _pdf_review_evidence fails the receipt. See test_repair_r2.py.
Suggested Next Steps
Run schema_smoke.py against the live API to verify all nine operations return schema-compatible records.
Increase --top-n within budget to widen the target set, then re-run.
Cross-reference top targets with druggability or tractability skills for modality assessment.
Export target_ranking.csv into a downstream prioritization workflow.
Related Skills
target-tractability-druggability — assess druggability and modality tractability of ranked targets.
knowledge-graph-target-reasoning — multi-hop target reasoning over integrated evidence.
gwas-to-function-twas — identify causal genes from GWAS using transcriptome-wide association studies.
colocalization-susie — test whether two association signals share causal variants.

61. pcr-primer-design
Category: MOLECULAR DESIGN
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

62. pharmacovigilance-ae-signal-detection
Category: DRUG DISCOVERY
Source: https://biomni.phylo.bio/skills?section=marketplace

Pharmacovigilance Adverse-Event Signal Detection
When to Use This Skill
Post-market safety scan for a single drug (generic or brand): "What adverse-event signals show up for semaglutide in FAERS?"
Class-wide signal detection: "Compare safety signals across SGLT2 inhibitors" / "anti-TNF biologics"
Target-anchored safety review: "What safety signals do JAK1 inhibitors share?" — resolves target → drugs via Open Targets, then pools them
Labeled vs. unlabeled triage: separate expected on-label adverse events from potentially novel (unlabeled) signals worth follow-up
Disproportionality analysis: compute ROR / PRR / chi-square / FDR against the whole FAERS background or a custom active comparator

Do NOT use for:

Causal risk or incidence estimates — FAERS is a spontaneous-reporting system with no denominator; disproportionality measures differential reporting, not risk. (See Interpretation Guidelines.)
Controlled-trial safety analysis (use a clinical-trial or survival-analysis skill)
Individual case narrative review or regulatory case processing
Efficacy comparisons (use literature-review / clinicaltrials-landscape)
Installation
Software    Version    License    Commercial Use    Installation
pandas    ≥1.3    BSD-3    ✅ Permitted    pip install pandas
numpy    ≥1.20    BSD-3    ✅ Permitted    pip install numpy
scipy    ≥1.7    BSD-3    ✅ Permitted    pip install scipy
statsmodels    ≥0.13    BSD-3    ✅ Permitted    pip install statsmodels
requests    ≥2.25    Apache-2.0    ✅ Permitted    pip install requests
matplotlib    ≥3.4    PSF    ✅ Permitted    pip install matplotlib
reportlab    ≥3.6    BSD    ✅ Permitted    pip install reportlab
pypdf    ≥3.0    BSD-3    ✅ Permitted    pip install pypdf
pip install pandas numpy scipy statsmodels requests matplotlib reportlab pypdf

System requirements: Internet connection for the OpenFDA API (api.fda.gov) and, for target mode, the Open Targets GraphQL API. No API key is required, but an optional free OpenFDA key raises rate limits (pass api_key=).

Inputs

Required:

query — one of:
a drug name (str): "semaglutide", "Humira" (explicit mode)
a list of drug names: ["upadacitinib", "tofacitinib"] (explicit mode, pooled)
a drug class (str): "SGLT2 inhibitors", "anti-TNF", "statins" (class mode)
a molecular target symbol (str): "JAK1", "EGFR" (target mode)

Optional:

mode — force "explicit" | "class" | "target" (default: auto-detect via detect_mode)
comparator — custom background drug list for an active-comparator analysis (default: whole FAERS)
criteria — SignalCriteria(...) to change signal thresholds (defaults below)
api_key — OpenFDA API key for higher rate limits
top_n_events — reaction terms pulled per drug (default 500, the OpenFDA facet cap)
Outputs

Written under out_dir:

Report:

report_<subject>.pdf — Phylo-branded PDF: infographic (optional) + executive summary, methods, results, figures, tables, limitations, conclusions, references, next steps

Figures (PNG + SVG, 120 DPI):

figures/fig1_top_signals_bar — top signals by ROR, colored by label status
figures/fig2_volcano — log2(ROR) vs. −log10(FDR q), diamonds on a labeled ladder
figures/fig3_forest — ROR point estimates with 95% CI whiskers
figures/fig4_soc_heatmap — drug × event ROR heatmap (multi-drug/class only)
figures/fig5_summary_panel — 4-panel overview (signal counts, label split, category mix, SOC)

Tables (CSV):

disproportionality_full.csv — every (drug, event) with a,b,c,d, ROR (+CI), PRR, chi2, p, FDR q, signal flag, label status, noise flag, category, SOC, low_count / extreme_ror / low_confidence / low_confidence_reason
table1_overview.csv — study parameters + the single-source-of-truth count breakdown (signals passing criteria = genuine + artifacts; genuine = labeled + unlabeled + unknown; plus low-confidence count)
table2_top_signals.csv — top genuine ADR signals (noise-filtered), with a Conf. column marking low-confidence rows (retained, not removed)
table3_unlabeled_signals.csv — potentially unlabeled signals shortlist
Clarification Questions

Ask before running if unclear:

Subject type — is the target a single drug, a class, or a molecular target? (auto-detected, but confirm for ambiguous strings like an all-caps drug code)
Comparator — whole FAERS background (standard, default) or a specific active-comparator drug set?
Signal thresholds — standard rule (ROR CI lower > 1, PRR ≥ 2, χ² ≥ 4, ≥ 3 cases, FDR q < 0.05) or custom?
Depth — full PDF report with figures + literature grounding + infographic, or just the signal table?
Standard Workflow

🚨 USE THE SCRIPTS. Do not re-implement disproportionality math, the OpenFDA query rules, or the figure/report styling inline — they encode hard-won API and statistical correctness. 🚨

The pipeline is orchestrated by run_analysis.py. Two steps need agent tools (LiteratureSearch, GenerateImage) that a plain Python module cannot call — the orchestrator hands you the exact query/prompt strings and you feed the results back.

Step 1 — Run the deterministic pipeline (resolve → query → compute → annotate → figures → tables → draft report):

import sys; sys.path.insert(0, ".")
from scripts.run_analysis import run_analysis, AnalysisConfig

cfg = AnalysisConfig(
    query="upadacitinib",                 # str | list | class | target
    out_dir="pv_results/upadacitinib",
    # mode="target",                       # optional: force a mode
    # comparator=["tofacitinib", "baricitinib"],   # optional active comparator
)
result = run_analysis(cfg)

✅ VERIFICATION: prints [1/6] Resolving ... through [6/6] Building PDF report ... and a final report path with page count. result["results"] is the full annotated DataFrame; result["report"] is the draft PDF path.

Step 2 — Ground the top signals in the literature (agent tool LiteratureSearch):

q = result["literature_query"]     # pre-built query string from the orchestrator
print(q)

Now call the LiteratureSearch tool with that query. Collect the returned records into a list of dicts with at least title, authors, year, journal (and doi/url if present).

Step 3 — Generate the mechanism/summary infographic (agent tool GenerateImage):

print(result["infographic_prompt"])   # pre-built schematic prompt

Call the GenerateImage tool with that prompt; save the PNG to out_dir (e.g. pv_results/upadacitinib/infographic.png).

Step 4 — Rebuild the final report with references + infographic:

from scripts.run_analysis import finalize_report

final_pdf = finalize_report(
    result["context"], cfg.out_dir,
    references=lit_records,                 # from Step 2
    infographic_path="pv_results/upadacitinib/infographic.png",  # from Step 3
)
print("Final report:", final_pdf)

✅ VERIFICATION: validate_pdf(final_pdf)["ok"] is True (≥ 2 pages, extractable text). The report now includes the References section and the infographic on page 1.

Skip Steps 2–4 if the user only wants the signal table/figures — run_analysis already produced a complete report without literature/infographic. finalize_report and the two agent tools are purely additive.

⚠️ CRITICAL — DO NOT:
❌ Manually URL-encode search terms then wrap them in quotes → double-encodes spaces inside quoted phrases and silently returns 0 hits. The scripts handle encoding; pass raw terms.
❌ Resolve a drug class from the /drug/event.json endpoint → co-reported drugs (metformin, aspirin) contaminate results. resolve_class_members uses /drug/label.json — do not change it.
❌ Treat ROR/PRR as risk or causal effect → they measure differential reporting. State this in every deliverable.
❌ Derive event totals by summing a across your drug set unless the set partitions all of FAERS → pass whole-universe event totals (the orchestrator does this via a background facet + single-term fallback).
❌ Report DRUG INEFFECTIVE / OFF LABEL USE / DEATH / PRODUCT QUALITY ISSUE as safety signals → these are administrative/non-clinical terms. flag_noise marks them; top-signal tables must filter is_noise.
❌ Mix the noise-included signal total with noise-excluded breakdowns in one statement (e.g. "68 signals (21 labeled + 36 unlabeled)" where 21+36=57) → always pull counts from run_analysis.signal_counts, which guarantees pass_criteria = genuine + artifacts and genuine = labeled + unlabeled + unknown. Report the genuine count as the headline.
❌ Treat an extreme ROR as a strong signal without checking low_confidence → very large RORs are often notoriety/stimulated-reporting or mechanism/efficacy-adjacent artifacts. flag_low_confidence marks them; surface the flag, do not silently drop or over-interpret.
❌ Write ReportLab PDFs or HDF-like files directly onto /mnt (S3 FUSE has no random-access writes) → build in /workspace then cp. build_report already does this.
❌ Use sed -i or cat >> append on files under /mnt → S3 FUSE returns "Function not implemented" / silently no-ops. Use the Write/Edit tools.
❌ Put Unicode superscripts/subscripts in the PDF → use HTML entities (&#967;=χ, &#178;=², &#177;=±). The report helpers already do.
⚠️ IF SCRIPTS FAIL — Failure Hierarchy:
Fix and Retry (90%) — install a missing package, re-run (OpenFDA 429 → the client already backs off; just retry).
Modify Script (5%) — edit the script, document the change.
Use as Reference (4%) — read the script, adapt, cite it.
Write from Scratch (1%) — only if genuinely impossible; explain why.

Never skip to inline disproportionality/query code without trying the scripts.

Common Issues
Error / Symptom    Cause    Solution
0 drugs resolved (class mode)    Informal class name not in OpenFDA EPC vocabulary    Add/point to canonical label via _CLASS_SYNONYMS; or pass drugs explicitly
0 drugs resolved (target mode)    Symbol not found in Open Targets, or no approved/clinical drugs    Verify the gene symbol; try a class or explicit list
A resolved drug has 0 FAERS reports    Not yet marketed / no spontaneous reports    The orchestrator drops 0-report drugs automatically (see result["dropped"])
HTTP 429    OpenFDA rate limit    Client retries with backoff; pass api_key= for higher limits
HTTP 400 on a term    Special characters (apostrophes) in the MedDRA term    count_single_term retries apostrophe variants automatically
All-NaN heatmap column    A drug shares no tested events with others    fig_soc_heatmap drops all-NaN columns automatically
Empty top-signal table    Every top-ROR term was a noise term    Expected for some drugs; inspect disproportionality_full.csv
PDF is 0 bytes on /mnt    Wrote ReportLab directly to S3 FUSE    Use build_report (builds in /workspace then copies)
Interpretation Guidelines
Disproportionality ≠ risk. ROR/PRR/χ² quantify whether an event is reported more often than expected for a drug relative to the background — a hypothesis-generating signal, not incidence, causation, or absolute risk. Confounding by indication, notoriety/stimulated reporting, and channelling all inflate ROR.
No denominator. FAERS has no exposure denominator, so rates cannot be computed. Counts are reports, not patients or events.
Label grounding is heuristic. label_status (boxed / labeled / unlabeled) is a text match against the OpenFDA structured product label of a representative member; wording mismatches can misclassify. "Unlabeled" means not found in that label, not proven novel.
SOC is a curated fallback map, not the licensed MedDRA hierarchy — a coarse grouping for readability.
Noise filtering is deliberately conservative but broad on artifacts. Administrative/product-quality terms (DRUG INEFFECTIVE, OFF LABEL USE, product quality), surgical/interventional procedures (colectomy, ileostomy, colonoscopy — reflect surgical history, not drug toxicity), the treated indication itself (rheumatoid arthritis, ulcerative colitis, psoriasis — confounding by indication), nonspecific terms (DEATH), and isolated lab markers are flagged (is_noise) and excluded from top-signal tables but retained in the full CSV. This matters: without it, the treated disease and its procedures dominate the top ROR list.
Standard signal rule (Evans-style, EMA-aligned): ROR 95% CI lower bound > 1, PRR ≥ 2, χ² ≥ 4, ≥ 3 cases, plus BH-FDR q < 0.05 to control multiplicity. Small-count signals (a < ~10) are fragile even when they pass.
Low-confidence flag (marks, never removes). Every signal is additionally checked for fragility/inflation via low_confidence = low_count (a < min_cases_confident, default 10) OR extreme_ror (ROR above a per-drug Tukey far-out fence on ln ROR, with an absolute floor). These rows stay in all outputs but are marked (a Conf. column, hatched bars, forest diamonds/rings, volcano rings) and named in the report. An implausibly large ROR is usually notoriety/stimulated reporting or a mechanism/efficacy-adjacent term, not a stable safety effect — treat flagged rows as hypothesis-fragile. Note: because the OpenFDA facet returns only the top ~500 most-frequent reactions, the small-count trigger mainly matters for rarely reported drugs; for high-volume drugs the dominant trigger is extreme ROR.
Signal counts are derived from a single source of truth (run_analysis.signal_counts): signals passing criteria = genuine + non-clinical artifacts, and genuine = labeled + unlabeled + unknown. The headline count is the genuine (noise-excluded) number; the artifacts-excluded count is always shown alongside. Never mix the noise-included total with noise-excluded breakdowns in the same statement.
Pooled (class/target) rows use a representative member's label for grounding; per-drug rows use each drug's own label.
Suggested Next Steps
Deep-dive an unlabeled signal — use literature-review to check whether the top unlabeled events have published mechanistic or epidemiologic support.
Map the competitive/clinical context — use clinicaltrials-landscape for the drug class's trial landscape.
Target biology — use open-targets to explore the target's genetic/mechanistic associations behind a class effect.
Active-comparator refinement — re-run with comparator=[...] to reduce indication confounding against a same-class or same-indication set.
Related Skills
open-targets — target → drug resolution and target biology (used internally for target mode)
clinicaltrials-landscape — trial-level landscape for a drug class
literature-review — evidence grounding for individual signals
pdf-report-generation — general Phylo-branded PDF patterns
References
OpenFDA drug API: https://open.fda.gov/apis/drug/
FAERS: https://www.fda.gov/drugs/surveillance/questions-and-answers-fdas-adverse-event-reporting-system-faers
Open Targets Platform API: https://platform.opentargets.org/api
Evans SJW et al. Pharmacoepidemiol Drug Saf 2001 (PRR method); van Puijenbroek EP et al. 2002 (ROR).
See references/api-parameters.md for OpenFDA/Open Targets query rules and gotchas
See references/methodology.md for the disproportionality math and signal criteria
See references/output-schema.md for full column/output definitions
See references/config-pattern.md for AnalysisConfig / SignalCriteria usage and the agent-tool integration pattern

63. phylo-create-skill
Category: GENERAL
Source: https://biomni.phylo.bio/skills?section=marketplace

Phylo Create Skill

Create one immediately usable, production-only skill package, not a transcript of one run. The same package may be refined, frozen, independently tested, reviewed, and eventually shipped; never add validation-only material to it.

Use the printed Skill Directory as SKILL_DIR. Commands start from /workspace.

Boundaries
Draft only beneath /mnt/results/skills/<slug>/; never alter installed or supplied packages.
Never put test data, fixtures, expected or truth values, oracle/evaluator code, test scripts, receipts, campaign evidence, run outputs, environments, caches, or repository tests in a skill.
Never register, publish, deploy, open a pull request, or upload a personal skill without explicit approval for that action.
Present the package or analytical specification for review before freezing or registration unless the brief explicitly authorizes an unattended pass.
Use default Phylo styling for reader-facing artifacts unless the user explicitly requests a compatible named provider. Tenant, company, project, audience, or instance context is not a style request.
1. Choose the authoring path

Use executable analysis only when a stable file or directory enters a repeatable computation, success produces declared files, and one public domain entrypoint can own the computation.

Use general workflow for instruction-only guidance, protocols, literature or data retrieval, reporting, API/tool use, and orchestration, including remote side effects. A PDF, table, figure, or helper script does not by itself make a workflow an executable analysis.

Read references/general-authoring.md for general workflows and references/interview.md for executable analyses. Ask only questions that materially change the package and cannot be inferred safely.

Repair an existing skill

Enter repair work only when the user explicitly asks to repair, revise, update, or migrate a supplied skill. Read references/repair-existing.md, copy the source to /mnt/results/skills/<slug>/, and inventory its identity, interface, science, scripts, references, and presentation before editing the copy.

Preserve identity, scientific behavior, inputs, parameters, outputs, and their meanings unless the user approves a change. Route the copied package by what it does, not by its current files. A legacy analysis can migrate to the canonical specification and one public entrypoint while retaining useful scripts as private helpers. Externalize any legacy validation material instead of moving it into the repaired package.

Styling is the deliberate exception: repaired reader-facing artifacts adopt current Phylo styling by default. A compatible enterprise provider requires an explicit named request. Styling must not change scientific outputs, facts, figures, or analysis hashes.

2. Author the package
Starting prompt

Write starting-prompt as one concise, concrete, natural prompt that the skill can address. It may be a scientific question or a direct task instruction. Preserve a usable user-supplied prompt and keep its scope consistent with the skill's supported inputs, methods, and outputs. Do not turn a task into a question by simply appending ? or rewrite a valid question as a task.

Task: "Clean this molecular dataset and flag QC issues before SAR analysis."
Question: "Which QC issues in this molecular dataset could affect SAR analysis?"

For executable analyses, set starting_prompt in the specification; the scaffolder renders it unchanged into the starting-prompt frontmatter field.

General workflow

Author /mnt/results/skills/<slug>/SKILL.md directly. Use the canonical six-field Phylo frontmatter shown above and keep it below 500 lines. Include only relevant purpose, scope, prerequisites, stepwise instructions or decision criteria, outputs or actions, caveats, stopping conditions, and authorization boundaries.

Use progressive disclosure: keep shared decisions in SKILL.md; add references/, scripts/, assets/, templates, source documentation, or licensing files only when they have a concrete use. General packages do not need an analytical specification, canonical runner, report QC, or package manifest.

For external API or tool mutations, require approval immediately before the mutation or cost, use environment-based credentials, bound retries, and state when to stop. Retrieval skills may use declared network resources and should record source, version, query, and retrieval date when needed for interpretation or reproducibility.

Executable analysis

Start from the matching complete phylo-analysis-spec/1 example:

python3 "$SKILL_DIR/scripts/scaffold_skill.py" --example scientific-report \
  > /mnt/results/skill-spec.json

# Or, for an explicitly requested or clearly justified machine-output-only workflow:
python3 "$SKILL_DIR/scripts/scaffold_skill.py" --example artifacts \
  > /mnt/results/skill-spec.json

Tailor identity, objective, invariant input guidance, ordered scientific workflow, one public entrypoint, parameters, declared outputs, scientific caveats, sources, presentation, and optional conditional guidance. The specification contains runtime declarations only—never examples, fixtures, assertions, expected answers, or evaluation routes.

Default newly authored analyses to scientific-report: analysis outputs plus canonical facts, an opening infographic, a PDF, provider binding, and objective report validation.
Choose artifacts-only when explicitly requested or clearly appropriate for machine-output-only work, such as pipeline intermediates or format conversion. It permits machine outputs and optional PNG figures without report code. Ask when intended deliverables are ambiguous or conflicting.
Record presentation_profile explicitly; missing values are not defaults. This authoring default does not change existing package contracts or require reports for general workflows.
Parameters state their scientific effect. Represent supported method, algorithm, or tool choices as bounded values dispatched behind the one entrypoint.
Optional guidance entries link substantial conditional domain instructions under references/.
Snapshot remote inputs when practical; otherwise declare provenance outputs covering provider, query, version, and raw inputs. Use the general route for side-effectful remote workflows.

Scaffold the package:

python3 "$SKILL_DIR/scripts/scaffold_skill.py" \
  --spec /mnt/results/skill-spec.json \
  --dest /mnt/results/skills

Implement the generated entrypoint so it:

accepts --input plus only declared parameters;
writes every declared output beneath BIOMNI_RESULTS;
validates the complete input before writing success artifacts;
rejects missing, ambiguous, unsafe, or scientifically invalid inputs clearly;
contains no customer name, one-off filename, fixed result, hidden dependency installation, validation-only route, or undeclared network dependency;
derives behavior from the declared input contract rather than recognizing example data; and
writes strict machine-readable outputs alongside figures or reports.

Private helpers are allowed, but there is one public domain entrypoint. Do not copy or modify the canonical runner or report helper. At application time, map user requests only to declared parameters; an unsupported method or changed interface requires a new package revision.

3. Inspect and freeze

Run the route-aware static checker:

python3 "$SKILL_DIR/scripts/check_skill.py" /mnt/results/skills/<slug>

Review the checked package with the user when required. Then freeze it once:

python3 "$SKILL_DIR/scripts/finalize_skill.py" /mnt/results/skills/<slug>

Finalization performs structural checks and records immutable identity. For an analytical package it adds the canonical package manifest; for a general package it keeps the package unchanged and writes an external inventory. It then creates a deterministic ZIP and an external freeze summary containing tree, manifest when applicable, and archive hashes. It reports frozen, never scientific approval, and refuses to overwrite an archive or summary for the same slug in that results directory.

4. Keep testing downstream and external

The generated skill must work without its own tests. If the user or a Phylo campaign needs stronger evidence, create proportional tests afterward in a campaign workspace or separate task. Bind them to the exact candidate hash and keep their inputs, invalid cases, expected answers, oracle code, evaluation scripts, and outputs outside the package and outside later neutral application prompts.

A failing external test does not authorize an invisible edit. Obtain approval for the repair, create a new candidate identity, and rerun the required evidence. Apply frozen packages in fresh tasks with automatic repair disabled when first-run behavior matters.

Code can establish package identity, runtime binding, hashes, structured-artifact validity, report lineage, and renderability. Scientific adequacy, generalizability, licensing sufficiency, and visual quality require proportionate external review; see references/evidence-and-maturity.md.

5. Present the result

Return the package path, route, capability, explicit limits, and any pending external review. If it was frozen, also return the ZIP, archive SHA-256, package tree hash, external freeze-summary path, and analytical manifest hash when applicable.

To show the Save Skill / View Skill card, finish by calling the Skill tool with action="create" and folder_paths=["skills/<slug>"] for a new package. For a repaired owned skill, use action="update" with its ID (or exact owned name) and the package path. Put the complete result summary in final_response and make this tool call alone. The card lets the user save or apply the draft; do not report it as saved or updated until the user completes that action.

Do not imply that generation or freezing registered, published, deployed, scientifically validated, or approved the skill.

64. pipeline-from-analysis
Category: DATA ANALYSIS
Source: https://biomni.phylo.bio/skills?section=marketplace

Turn this session's analysis into a Nextflow pipeline

Use the printed Skill Directory as SKILL_DIR. Pick a short kebab-case NAME. Paths:

REPO=/workspace/$NAME: the local build. Write, lint and stub-run the pipeline only here.
STAGED=/mnt/results/$NAME: the copy submitted to HPC and handed to the user (step 6).
REPORTS=/workspace/$NAME-reports: steps.json, plan.json and reports. Mirror whole report files to /mnt/results at handoff.

/mnt/results is an S3-backed mount: chmod is silently ignored, rename and symlinks fail, and zip can't write there directly, so building, nextflow run and zip fail there. If REPO is gone, rebuild it from STAGED (see pipeline-hpc-validate). Read references/step-mapping.md before step 2. This skill works with two others: pipeline-module-author (components) and pipeline-hpc-validate (validation). Load each when its step comes, and use its own printed Skill Directory: call them MOD_DIR and VAL_DIR below.

Whenever the workflow needs a user decision before continuing, call AskUserQuestion with structured choices and wait for the answer. Do not ask blocking questions as chat text.

Time each step with a local log: python3 "$SKILL_DIR/scripts/timings.py" start <step> --reports "$REPORTS" --log "$REPORTS/timings.jsonl" before it and ... end <step> ... after it, for extract, map, gate (add --wait to its start: that's the user's time, not yours), and compose. The orchestrator owns the complete validate interval: start it immediately before step 5, keep it open across preflight, the stub run, staging/submission, HPC execution and any correction cycles, and end it after concordance and handoff. The handoff copies the complete local log and includes timings.py summary.

1. Extract
mkdir -p "$REPORTS"
python3 "$SKILL_DIR/scripts/extract_trace.py" /mnt/results/execution_trace/*.ipynb --transcript /mnt/results/execution_trace/transcript.jsonl --out "$REPORTS/steps.json"
Confirm the final analysis deliverables with AskUserQuestion. Offer detected files and folders under /mnt/results that no later cell reads as choices, with multiSelect: true so the user can select multiple outputs. If candidates exceed the four-choice limit, split them across questions or collect selected paths as free text. Preserve every selected path when rerunning extract_trace.py with --target.
Read every kept cell, every possibly_state cell, every unresolved_names entry and every unmatched_targets entry. Lineage is a heuristic (file paths, folders, and variables shared between python/R cells); check that no step the targets depend on was dropped.
The notebook may not hold every step: the agent can run tools through its Bash tool, outside the notebook. --transcript adds Bash-tool commands as timestamped bash cells; cross-check steps.json against NOTES.md and the session's outputs. Any step that produced a deliverable (or an input to one) but isn't in kept is an open question at the gate; never drop it silently.
If the user supplied scripts or notebooks instead, treat them the same way.
2. Map and write the checked plan

Group the kept cells into steps, and choose a component for each one using references/step-mapping.md (subworkflow → module → local). Use pipeline-module-author nfcore_index.py search/show for every choice (search asks the Nextflow Registry first and falls back to the offline index), then nfcore_index.py freshness <name> --save /workspace/nfcore-latest for each chosen nf-core component to decide its commit. Sort every nf-core step's command with module_flags.py: use --name <module> (the pinned index) for current, pinned_newer or unknown, and --main-nf <component.saved_to>/main.nf for newer_available or not_in_index. Neither needs a repo yet. Never pick a module or its inputs from memory.

After mapping, write $REPORTS/plan.json with its components list (schema in the reference), each local step's session code next to it (code is relative to plan.json), and the session's input file names in session_inputs. For DESeq2 VST, compute and record data_checks.deseq2.vst_eligible_rows before the gate. Run:

python3 "$SKILL_DIR/scripts/compose.py" "$REPORTS/plan.json" --check-plan

Fix every reported error and repeat until it is clean. A non-FASTQ .gz input needs nf-core gunzip (unless its consumer reads .gz: list it in gz_ok), and vst_nsub must leave a margin.

3. Approval gate

Containers are not a gate question: every step gets an existing image (biocontainers, then a recorded mirror, then the module's pinned upstream image), chosen without asking. Only when no existing image can run a local step's code does the gate offer: split the step, a user-supplied image URI, or drop the step. Treat custom image builds as unavailable unless the user says builds are enabled; the presence of hpc_build_image is not availability, and a build is never the default. Show the user everything listed under "Approval gate" in references/step-mapping.md, including the validation-level choice (Build only / Build + stub run / Full validation). Then call AskUserQuestion with separate questions for explicit plan approval (approve / request changes) and validation level (Build only / Build + stub run / Full validation), marking the recommended level and why as references/step-mapping.md describes. STOP. Do not write the pipeline until the user explicitly approves. Revise and re-present if asked. If any component, flag, default, or wiring changes after approval, show the concise diff and stop for approval again before composing.

4. Compose

After approval, pick each local module's container with pipeline-module-author's find_container.py (its step 2b), then build everything in one command:

python3 "$SKILL_DIR/scripts/compose.py" "$REPORTS/plan.json" --repo "$REPO" \
  --module-author-dir "$MOD_DIR" --validate-dir "$VAL_DIR" \
  --reports "$REPORTS" --timing-log "$REPORTS/timings.jsonl" > "$REPORTS/compose.json"

It copies the template (first run only), vendors every nf-core component, scaffolds the local modules, replaces Seqera-hosted images, renders the configs and README, then runs validate_local_scripts.py, preflight, lint_module.py on modules/local/*, check_ext_args.py and the typed static wiring check. Read its JSON: vendored[].source (flag container-only in the plan; exit 3), container_overrides (replacements written to conf/modules.config), retained_upstream_images (images it couldn't replace, with the reason; informational), checks (exit 1 if any failed) and next_steps. The wiring check is conservative and heuristic: it does not evaluate closures or operators beyond its listed forms, and unverified means the stub run decides. It respects NEXTFLOW_SKILLS_OFFLINE=1; pass --offline to force offline mode (snapshot, then container-only).

Do the next_steps: keep the generated argument parser in each new bin/ script, put the session logic below it, and wire the steps in workflows/pipeline.nf in plan order (includes with ../modules/... relative paths, structural inputs passed explicitly). Adapt subworkflows/local/samplesheet_fastq if the analysis doesn't start from FASTQ. For each GPU step, give its process a GPU label (for example, label 'process_gpu') and record that label in the plan's GPU resource list. The platform adds the Batch accelerator and GPU queue for labels listed in the submitted resources.gpu_process_labels; a process accelerator directive alone does not choose the queue.

Rerun the same compose.py command after wiring workflows/pipeline.nf. It never overwrites an existing module or bin/ script and doesn't re-fetch vendored components; it re-renders and re-checks. Repeat until it exits 0 with no next_steps.

Keep the template's modules/local/software_versions and its SOFTWARE_VERSIONS(channel.topic('versions')...) wiring exactly as shipped. It reads the versions topic, so giving it a meta input or a versions output deadlocks the run.

Fallback, if compose.py can't be used: copy templates/pipeline/. into REPO, then run the same scripts one by one: vendor_nfcore.py and scaffold_local_module.py per component (pipeline-module-author), render_configs.py plan.json --repo "$REPO", lint_module.py, check_ext_args.py, check_wiring.py and preflight.py.

Never add platform-owned settings (executor, queue, workDir, errorStrategy, maxRetries, resourceLimits, wave, fusion, …) to nextflow.config or conf/base.config / conf/modules.config, not even in comments. They belong only in conf/portable.config.

Before HPC, give every local module a data run: python3 "$MOD_DIR/scripts/smoke_local_module.py" on the exact upstream output (or a session intermediate reshaped to that output), recorded in $REPORTS/local-module-runs.json with a cheap invariant such as row count. Compose lists a local module without one as a warning; the stub run never executes scripts, so this is the only check that runs them on data.

Also run the final analysis steps implemented by vendored nf-core script/template modules on session-equivalent intermediate data when the sandbox has the required runtime packages. Render the module template with the pipeline's effective ext.args/params, run it, and record the result and cheap invariants in the reports. This applies to R/Python templates such as deseq2/differential; a successful stub run is not evidence that their real data behavior works.

5. Validate (only the level the user chose)
python3 "$SKILL_DIR/scripts/timings.py" start validate --reports "$REPORTS" --log "$REPORTS/timings.jsonl"

Load pipeline-hpc-validate and run exactly the level chosen at the gate (if none was chosen, the one recommended there). Never go past it without asking.

Build only: its step 1 without the stub run (preflight, then nextflow lint).
Build + stub run: its step 1 (preflight, then the time-boxed stub run; no nextflow lint).
Full validation: step 1, stage to STAGED, one HPC run on the approved data with hpc_run_pipeline(pipeline_files=…) (HPC runs custom repos; hpc_search_pipelines and hpc_get_pipeline_guide cover only curated pipelines), wait for the platform's message, at most 3 correction cycles (hpc_resubmit_pipeline for fixes, hpc_resume_pipeline only for infrastructure failures), then the concordance report.

For each HPC correction cycle, keep the same validate timing interval open; do not add timing imports or flags to the validation package scripts. End the interval after step 6 is complete.

If submission gets 429 "Pipeline capacity reached" or a busy-slot response, keep the validate step open and use a bounded poll-and-retry: check capacity/status, wait a short interval, and retry submission up to 3 times over at most 15 minutes. Do not stop the validation turn merely because another run is in flight. If capacity is still full at the bound, hand off the staged pipeline and report the bounded wait and last response.

6. Hand off
Re-stage the final repo and write the zip, with pipeline-hpc-validate's submission.py: python3 "$VAL_DIR/scripts/submission.py" "$REPO" --staged-prefix "$STAGED" --stage --zip "/mnt/results/$NAME.zip" > "$REPORTS/handoff.json" The zip is written through a local temporary file and copied over, and it keeps bin/ scripts executable; the STAGED folder can't.
Tell the user:
where the repo (STAGED) and the zip are, and which validation level ran and what it showed;
for Full validation: where the HPC outputs (/mnt/results/pipeline-<run_id>/outputs/) and the concordance report are, and what's identical, what differs (with the likely cause from the provenance table) and what wasn't compared;
for the other levels: that no HPC run was made, and ask whether they want one now (and on which data);
how to run it elsewhere (README "Run it elsewhere");
copy whole report files, including timings.jsonl, to /mnt/results/$NAME-reports/, then run python3 "$SKILL_DIR/scripts/timings.py" summary --reports "$REPORTS" --log "$REPORTS/timings.jsonl".
python3 "$SKILL_DIR/scripts/timings.py" end validate --reports "$REPORTS" --log "$REPORTS/timings.jsonl"

Don't say the pipeline is validated or scientifically equivalent. Say what was run and what the comparison shows.

Critical Rules
Search (Registry first, offline index as fallback) before choosing any component; never guess module inputs or flags.
STOP at the approval gate and wait for an explicit yes; run only the validation level chosen there.
nf-core first (subworkflow, then module), splitting session code at every stage a module covers; local modules only for what's left, written to nf-core conventions and run in an existing image. Resolve containers in this order: biocontainers replacement, exact-version quay.io build, a usable recorded mirror, then retain the pinned upstream image. Custom image builds may be unavailable; use one only when the user explicitly confirms that builds are enabled and approves it. Never call the Seqera Containers or Wave API to build or fetch a new image.
Vendor everything; the Registry is for discovery only, so never use Registry includes or nextflow module install; the pipeline must run with no network access to nf-core or the Registry.
Submitted configs contain no platform-owned keys; conf/portable.config is never submitted or included.
Build in /workspace, never on /mnt/results; only the staged copy is submitted and handed off. Keep stub inputs/config outside the repo.
No hard-coded /mnt paths in pipeline code, and no input data in the repo.
Concordance is evidence for the user, not a verdict.
The pipeline's software is its container images. Never ship or rely on a conda or PATH-based profile (locally installed tools) as the tested software, and never install tools in the sandbox during conversion. Stub runs stay container-less and only create files; real execution is the HPC run. A local smoke run happens only if the user asks, is labelled as such, and never counts as validation.
A custom pipeline always runs on HPC through hpc_run_pipeline(pipeline_files=…); hpc_search_pipelines lists curated pipelines only.
For every GPU stage, record its process label and the matching resources in the approval plan. Use a process label such as gpu; the platform-generated config maps that label to the GPU queue and adds the accelerator directive. A process-level accelerator directive alone does not select the GPU queue. Pass the exact resource object from pipeline-hpc-validate/scripts/submission.py to hpc_run_pipeline as resources=sub["resources"]; do not hand-copy the values.
List nf-core defaults and script-added flags that differ from the session at the gate; decide keep, set to the session value via ext.args/params, or document expected drift. Never ship a known data-dependent default that fails on the validation data.
Attribution

The plan → approval → per-component validation → compose → end-to-end run process is adapted from Seqera's create-workflow skill (nextflow-io/agent-skills, Apache-2.0).

65. pipeline-hpc-validate
Category: DATA ANALYSIS
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

66. pipeline-module-author
Category: DATA ANALYSIS
Source: https://biomni.phylo.bio/skills?section=marketplace

Author one Nextflow component the nf-core way

Use the printed Skill Directory as SKILL_DIR. REPO is the pipeline repo's local build, e.g. /workspace/<name>. Never build on /mnt/results: it is an S3-backed mount where chmod is silently ignored, so bin/ scripts can't be made executable there. If the user points at a pipeline under /mnt (e.g. a staged copy in /mnt/results/<name>), copy it to local scratch first and work on the copy: mkdir -p "$REPO" && cp -R /mnt/results/<name>/. "$REPO/" && if [ -d "$REPO/bin" ]; then chmod +x "$REPO"/bin/*; fi. Re-stage it with pipeline-hpc-validate's submission.py --stage when you're done. Read references/nf-core-module-conventions.md before writing or wiring any module. The Nextflow Registry is used for discovery and freshness only; the shipped offline index is the discovery fallback; vendoring needs GitHub (or a shipped snapshot, if the package includes one). Read references/offline-and-registry.md for what each source provides and how to run fully offline (NEXTFLOW_SKILLS_OFFLINE=1).

1. Search first; never guess parameters
python3 "$SKILL_DIR/scripts/nfcore_index.py" search "salmon quant" --kind module
python3 "$SKILL_DIR/scripts/nfcore_index.py" show salmon/quant
python3 "$SKILL_DIR/scripts/nfcore_index.py" freshness salmon/quant --save /workspace/nfcore-latest
search asks the Registry first. "source": "offline" means it answered from the offline index instead, and reason says why (offline mode, nextflow missing, Registry unreachable, no match). Either answer is valid. A Registry hit with "in_index": false is missing from the offline index: run freshness on it before using it.
show prints the module's inputs, outputs, containers, conda pins and the flags its script already sets, from the offline index. container_replacements (when present) lists recorded deployment replacements for a Seqera-hosted image: a biocontainers entry is usable anywhere; a mirror entry lives in a deployment-specific ECR that a custom bundle cannot name.
show and freshness also report deprecated: true and optional_input_hazards. Resolve either before the approval gate; do not carry a deprecated module or an unsafe empty optional input into the approved plan.
freshness compares the offline index's pinned copy with the commit the Registry publishes, by file contents. Act on its status:
current, pinned_newer (the Registry's commit is older than the pin) or unknown (offline, a source was unreachable, or the commit order is unclear): use show and the pinned commit. Flag unknown at the approval gate.
removed_upstream (not in the index, and the Registry commit is behind the pin, so nf-core removed or renamed it): don't vendor it. Search for its replacement.
newer_available (the files differ and the Registry commit is ahead of the pin) or not_in_index (added after the pin): use the returned component in place of show (same fields, read from the files at registry_sha), and vendor with --sha <registry_sha>. Record the commit in the plan. These are the only statuses that lead to --sha.

Prefer a subworkflow (--kind subworkflow) when one covers several consecutive steps exactly.

When pipeline-from-analysis builds a whole plan, its compose.py runs 2a, 2b (scaffold only) and 3 for every component in one command, using these scripts from this skill's directory. The steps below are the per-component path, and the fallback.

2a. The step has an nf-core component → vendor it
python3 "$SKILL_DIR/scripts/vendor_nfcore.py" --repo "$REPO" --name salmon/quant --kind module [--sha <registry_sha>]

Without --sha it vendors the index's pinned commit. modules.json records the commit each component was actually vendored at; a subworkflow's modules come from the subworkflow's commit.

Check the source field of each result:

github or snapshot: the files are in modules/nf-core/... and recorded in modules.json. Include the module as include { SALMON_QUANT } from '../modules/nf-core/salmon/quant/main', using a ./ or ../ relative path, never from 'nf-core/...'.
A result with requested_sha got the pinned snapshot copy because GitHub couldn't serve that commit (or offline mode is on): take inputs and flags from show, not from the freshness component.
container-only (exit 3): the source can't be reached. Go to 2b and reuse the returned nf-core containers.docker URI (if it is Seqera-hosted, the index's biocontainers replacement instead) and the index's conda pins (for a not_in_index module, the freshness component's), then flag this in the plan.
For a subworkflow, vendor its modules one by one instead.

Then sort the session's flags for this tool. During planning (no repo yet) read the module from the offline index with --name; for a newer_available or not_in_index module pass --main-nf with the file under the component.saved_to folder from freshness --save; once it's vendored you can pass --main-nf "$REPO/modules/nf-core/salmon/quant/main.nf":

python3 "$SKILL_DIR/scripts/module_flags.py" --name salmon/quant \
  --command "salmon quant -i idx -l A -1 r1.fq -2 r2.fq -p 8 --validateMappings -o out"

The script separates flags the module already sets (drop them, and record any conflict) from remaining flags:

set_by_module_as maps a session alias to the module's spelling (salmon -p → --threads, -i → --index).
unparsed lists every positional token not attached to a flag. Account for each one (usually an input file).
Aliases, boolean and multi-value flags are built in only for common tools. For any other tool, check <tool> --help for short/long spellings and boolean flags before trusting the split.
A flag the module sets only when ext.args doesn't already contain it (look for args.contains('--flag') in its main.nf, e.g. STAR --outSAMtype) may go in ext.args; allow it with check_ext_args.py --allow <flag>.

You then decide for each remaining flag:

structural (a file or val in the module's input: block, from show or the freshness component): wire it in the workflow;
fixed option: a literal in ext.args;
user-tunable (thresholds, library type, strandedness): a new params.* with the session's value as its default, read from an ext.args closure.
2b. No nf-core component → scaffold a local module

Save the session code for this step (from steps.json) to a file.

Pick an existing image, in this order. Building an image is a last resort.

An nf-core image from the offline index whose conda pins cover every package the code loads, including known runtime dependencies (for example, tximport may read Salmon inferential replicates through jsonlite):

python3 "$SKILL_DIR/scripts/find_container.py" --package deseq2 --package limma

Use the first covering image, with the module's conda pins for environment.yml. Seqera-hosted images rank last and are marked "seqera": true: use its replacement (a digest-only quay.io image) when set, otherwise try 2b.2 before settling for it. To reuse the image of a module vendored at a newer commit (or saved by freshness --save), read its own pins with find_container.py --module-dir <module folder>. Pins list top-level packages only, so a package's own dependencies are in the image too (e.g. DESeq2 brings ggplot2): if the only missing package is such a dependency, the image covers it. partial shows the closest images and what each lacks; if one step's code needs packages no single image has, split the step so each part fits one image.

A quay.io/biocontainers image for the package, when no nf-core image fits:

python3 "$SKILL_DIR/scripts/find_container.py" --biocontainers bioconductor-deseq2 [--version 1.42.0]

It lists quay.io/biocontainers/<package>:<tag> builds, newest first, each with its manifest_digest and the digest-only pinned URI; --version keeps only builds of that version. Pick the build closest to the session's version and use its pinned URI (AWS Batch rejects name:tag@digest). Biocontainers hold one package each, so split the step if the code needs more than one package that isn't a dependency of the first.

Otherwise ask the user: drop the step, keep it as a documented manual step, provide an image URI, or (for a multi-package step) split the step. Treat image builds as unavailable unless the user explicitly says builds are enabled or a no-cost status probe reports enabled; function presence is not availability. Never put a build in the default plan. If the user says it is enabled and approves, build from the module's environment.yml (add conda-forge::procps-ng; Nextflow needs ps) with this Dockerfile, then take image_uri from hpc_get_build_status:

FROM mambaorg/micromamba:1.5.10
COPY --chown=$MAMBA_USER:$MAMBA_USER environment.yml /tmp/environment.yml
RUN micromamba install -y -n base -f /tmp/environment.yml && micromamba clean --all --yes
ENV PATH=/opt/conda/bin:$PATH

Prefer quay.io/biocontainers or the index's recorded replacement for local modules, and never call the Seqera Containers or Wave API to build or fetch a new image. A vendored nf-core module keeps its pinned upstream image in main.nf (never edit it): pipeline-from-analysis's compose.py overrides it in conf/modules.config when possible and reports any retained image. Custom bundles do not receive platform image overrides, so every retained upstream image must be usable by the target HPC environment. Never install packages when the task starts (BiocManager::install, pip install in the script). Never leave a module without a container.

Scaffold, then lint:

python3 "$SKILL_DIR/scripts/scaffold_local_module.py" --repo "$REPO" --name deseq2_contrast --tool deseq2 \
  --version-cmd 'Rscript --version' --language r \
  --code /tmp/cells_7_8.R --container <URI> --conda bioconda::bioconductor-deseq2=1.42.0 \
  --input counts --input samplesheet --output results='*.results.tsv' --label process_medium --cells 7,8
Keep the generated argument parser in bin/<name>.<ext> and put the session logic below it. The parser accepts --prefix value and one --<input> value per input, matching the scaffolded main.nf; it must not be replaced with --flag=value parsing or extra shebang arguments. The session logic writes outputs that match the --output globs. Version commands are quote-free and pipe-free because they are embedded in Nextflow's single-quoted eval(); use Rscript --version, python3 --version, bash --version, or a helper script for package-specific reporting.
python3 "$SKILL_DIR/scripts/lint_module.py" "$REPO/modules/local/<name>" must pass, then run python3 "$SKILL_DIR/scripts/validate_local_scripts.py" "$REPO" --module-author-dir "$SKILL_DIR". The validator parses every local script, render-checks version commands, checks publish patterns, and closes direct imports against environment pins/index metadata. Missing interpreters are reported as not_checkable, never as a silent pass.
3. Check
python3 "$SKILL_DIR/scripts/check_ext_args.py" "$REPO" must pass after conf/modules.config is written.
python3 "$SKILL_DIR/scripts/check_wiring.py" "$REPO" --json must report no errors after wiring. It is static and heuristic: it does not evaluate closures or operators beyond its listed forms, and unverified means the stub run decides.
Unless the user chose Build only, each new local module gets a stub run once it is wired in: from REPO, with the stub inputs and stub config kept outside the repo, as pipeline-hpc-validate step 1 describes (NXF_VER=26.04.6 NXF_SYNTAX_PARSER=v1 nextflow run main.nf -stub-run -c <stub.config> ...).
Before HPC, each local module also gets a required data smoke run with scripts/smoke_local_module.py. Feed it the exact upstream output when cheaply reproducible, otherwise a session intermediate reshaped to the declared output. Record command status, table IDs, and a cheap invariant such as row count in $REPORTS/local-module-runs.json; a missing report is a gate warning.
Critical Rules
Search before choosing a component; take inputs and flags from show (or the freshness component for the Registry commit), never from memory.
The Registry is for discovery and freshness only. Always vendor; never use Registry-managed includes (from 'nf-core/x') and never run nextflow module install into the repo.
Never edit a vendored nf-core file in place.
Never pass a flag the module already sets; tool options go through ext.args.
Every local module passes lint_module.py and has an existing container: an nf-core image from find_container.py, then quay.io/biocontainers, then a recorded mirror, then the pinned upstream image. Custom image builds may be unavailable; never assume they can be used. Never call the Seqera Containers or Wave API, and never install packages at task start.
Flag every container-only fallback, every unknown freshness, every non-pinned commit and every version difference from the session in the plan.
With NEXTFLOW_SKILLS_OFFLINE=1 (or --offline) nothing touches the network: search reads the offline index and vendoring uses a shipped snapshot if present, otherwise container-only. Never work around offline mode.
Attribution

"Search first, never guess parameters" and the per-module validation idea are adapted from Seqera's run-module and create-workflow skills (nextflow-io/agent-skills, Apache-2.0). Vendored components come from nf-core/modules (MIT).

67. pkpd-pharmacometrics
Category: DRUG DISCOVERY
Source: https://biomni.phylo.bio/skills?section=marketplace

Population PK/PD Modeling & Exposure-Response Dose Analysis
Scope

What this skill does. A staged, general-purpose population pharmacometrics pipeline: ingest & validate concentration-time (± response) data → diagnose the concentration→effect delay → fit a population PK model → optionally fit a PD model whose structure is chosen from the data → evaluate (goodness-of-fit + parameter precision + VPC) → optionally run exposure-response simulation and a target-gated dose recommendation → produce a Phylo-branded PDF report (infographic, intro, methods, results, conclusions, next steps, references) by delegating to the pdf-report-generation skill.

What this skill does NOT do.

It does not produce clinical dosing guidance. Every dose output is a model-based extrapolation labeled "methodological illustration, not clinical dosing guidance."
It does not invent therapeutic target windows (see the hard guardrail below).
It does not write NONMEM control streams, run population meta-analyses across studies, or do physiologically-based PK (PBPK). It is nonlinear mixed-effects (NLME) modeling of a single dataset.

Engine. R with nlmixr2 / rxode2 (FOCEi estimation; rxode2 for simulation). Figures use ggplot2/ggprism. VPC uses vpc/tidyvpc.

CRITICAL environment note — the stack is NOT preinstalled

The Biomni base R environment is RNA-seq / single-cell focused (DESeq2, Seurat, clusterProfiler). The pharmacometric stack (nlmixr2, rxode2, nlmixr2est, nlmixr2data, vpc) is not preinstalled. rxode2 compiles ODE models on the fly, so a C compiler (gcc/cc) and gfortran are mandatory (both are present in the standard sandbox).

Always install into a persistent library and set the path in every R invocation:

# Stage 0 — run scripts/00_setup_env.sh (idempotent; slow first time → run in background)
export R_LIBS_USER=/workspace/.Rlib
# Top of EVERY R script/invocation in this skill:
.libPaths(c("/workspace/.Rlib", .libPaths()))

Verified working versions in this environment: rxode2 5.1.2, nlmixr2est 6.0.1, nlmixr2 5.0.0 on R 4.4.2. The install takes ~10–20 min the first time — launch it in the background and treat it as a prerequisite gate: do not start modeling until library(nlmixr2) loads and a trivial rxode2({d/dt(x) <- -x}) compiles.

Inputs — the schema contract (validate loudly, never drop silently)

Accept a tidy long-format table (CSV/TSV/data.frame) using NONMEM-style data items. Map the user's columns to these canonical names and report every mapping, coercion, and dropped row:

Item    Meaning    Required    Notes
ID    Subject identifier    yes    any type; kept as factor/int
TIME    Time since first dose (h)    yes    numeric, monotonic within ID
DV    Dependent variable (obs)    yes    concentration and/or response value
AMT    Dose amount    yes (≥1 dose row)    0/NA on observation rows
EVID    Event ID    recommended    0 = obs, 1 = dose; derived if absent
CMT    Compartment    for multi-endpoint    must equal the endpoint name for obs (see gotcha)
DVID    DV type label    for PK+PD    e.g. cp/conc vs pca/effect; splits endpoints
MDV    Missing DV flag    optional    1 = ignore row
WT,AGE,SEX,...    Covariates    optional    for allometric scaling / covariate testing

Validation rules (see references/schema_contract.md; implemented in scripts/01_ingest_validate.R):

Confirm required items exist (or can be derived); fail loudly with a clear message if not.
Count and report: n subjects, n dose events, n observations per endpoint, rows with missing/zero DV, negative/duplicated times, subjects with no dose or no obs.
Never silently discard rows. If rows are excluded, list how many and why in a validation summary that is printed AND embedded in the report Methods.
If no distinct response endpoint is present (only concentrations), set PK_ONLY = TRUE and skip PD/dose stages gracefully (still produce a report).

Public example data for demos/QA (via nlmixr2data): theo_sd/Theoph (PK-only, single oral dose) and warfarin (PK cp + PD pca, indirect-response signature).

Outputs
tables/ — tidy validated dataset, validation summary, PK parameter table, PD parameter table (if fit), exposure-response / dose tables.
figures/ — raw-data spaghetti, PK GOF, individual fits, VPC, PD GOF (if fit), exposure-response, steady-state profile (PNG + SVG each).
report_<drug>_popPKPD.pdf — the Phylo-branded report (see Report section).
Saved model objects (.rds) for reproducibility.
Workflow (staged; degrades gracefully to PK-only)

Track progress with TodoWrite. Adapt the reference scripts in scripts/ to the dataset — they are templates, not a rigid CLI.

Stage 0 — Environment gate

Run scripts/00_setup_env.sh (background). Verify nlmixr2 loads and rxode2 compiles a trivial model before proceeding.

Stage 1 — Ingest & validate (scripts/01_ingest_validate.R)

Apply the schema contract. Emit the validation summary. Set PK_ONLY if there is no response endpoint. Save the tidy dataset.

Stage 2 — EDA & delay diagnosis (scripts/02_eda_delay_diagnose.R)

Plot concentration (and response) vs time (individual + mean). Compute the delay signature: the lag between concentration Tmax and the response peak/nadir, and inspect the concentration–effect relationship for hysteresis. This drives PD-structure selection. If PK_ONLY, skip the effect analysis.

Stage 3 — Population PK (scripts/03_fit_pk.R)

Fit a 1- or 2-compartment model with first-order absorption (choose by inspection / OBJF). Random effects (log-normal BSV) on ka/CL/V; combined additive+proportional residual error. Offer allometric weight scaling (exponent 0.75 on CL, 1 on V, referenced to 70 kg) when a weight covariate exists. Estimate with est="focei"; if convergence is poor (false convergence), refit with foceiControl(outerOpt="bobyqa"). Report parameters with asymptotic %RSE and 95% CI, BSV %CV, shrinkage. Produce GOF plots, individual fits, and a VPC (default tier).

Stage 4 — Population PD (optional; skip if PK_ONLY) (scripts/04_fit_pd.R)

Fit sequentially: fix individual PK parameters at their PK estimates; estimate only PD parameters + PD BSV. Choose the PD structure from Stage 2's delay signature — do NOT hardcode (templates in references/model_library.md):

Direct Emax / Imax — negligible delay; effect tracks concentration instantaneously.
Effect-compartment (link) model — moderate hysteresis; add a ke0 link compartment.
Indirect-response / turnover — large delay (e.g. warfarin ~42 h); drug inhibits/stimulates a synthesis (kin) or loss (kout) rate. Surface the recommended structure to the user with the measured delay as justification; let them override. Fix a boundary/unidentifiable Imax/Emax at 1 only when justified (restores a well-conditioned covariance step). Report PD parameters (%RSE, CI, BSV), GOF, individual fits, and a PD VPC.
Stage 5 — Exposure-response & dose (optional; target-gated) (scripts/05_exposure_response.R)

Simulate regimens with rxode2 (steady-state and/or multiple-dose) across a dose grid; summarize steady-state exposure and predicted effect. Before emitting any dose, obtain an explicit therapeutic target window (see guardrail). Solve for the dose(s) achieving the target (interpolate); report by body weight if allometric scaling was used. Include time-to-steady-state.

Stage 6 — PDF report (scripts/06_report.py)

Build the report by following the pdf-report-generation skill (load it). See Report section.

HARD GUARDRAIL — dose is target-in-required, never target-invented

The skill must refuse to output any numeric dose (mg, mg/kg, mg/day) unless a therapeutic target window is supplied by one of:

User-supplied target on the modeled endpoint (e.g. "keep INR 2–3", "trough > 5 mg/L, peak < 20 mg/L", "effect 20–30% of baseline"), or
Literature-cited target found via the LiteratureSearch tool, with the citation recorded and shown in the report (e.g. for warfarin: PCA 20–30% of control as an INR 2–3 surrogate, O'Leary & Abbrecht 1981; INR≈1/PCA, Xue/Holford 2017).

If neither is available, do not print a plausible-looking dose. Instead, either run LiteratureSearch to find a sourced window, or ask the user for one. This prevents the failure mode of inventing a target and printing a clinical-looking mg/day for a real drug.

Every dose output — in chat, tables, and the report — must carry the disclaimer: "Model-based extrapolation for methodological illustration; not clinical dosing guidance." State the observed-design limits (e.g. "only a single dose level was studied, so alternative doses are extrapolation").

Model evaluation tiers
Default (always): goodness-of-fit plots (OBS vs PRED/IPRED, CWRES vs time & vs PRED), parameter precision (asymptotic %RSE + 95% CI), condition number, and a Visual Predictive Check (VPC) — simulation-only, cheap, and the single most informative diagnostic.
Opt-in upgrade (only if the user asks): bootstrap confidence intervals (many model refits — computationally expensive; document runtime and consider a larger machine). Do not run bootstrap by default.
PDF report (delegate to pdf-report-generation)

Load the pdf-report-generation skill and follow its Phylo branding, ReportLab patterns, and validation. The report MUST contain, in order:

Infographic / one-page visual summary — headline: chosen PK & PD model structures, key parameter values (CL/V/ka; PD params), the exposure-response headline (recommended dose + target window + its citation), and the disclaimer. Built with ReportLab callout + key-number "cards" + a small chart (per the pdf skill), hAlign="CENTER" on every element.
Introduction — drug/endpoint context and modeling objectives.
Methods — data + validation summary, PK model, PD-structure choice with the measured-delay justification, estimation settings, evaluation approach, dose-target source.
Results — parameter tables + all figures with captions: raw data, PK GOF, individual fits, VPC, PD GOF (if fit), exposure-response, steady-state profile, dose-by-weight table.
Conclusions — key parameters, headline dose (target-gated, disclaimed).
Next steps — prospective dose levels to study, external validation, covariate/PGx expansion, sequential→simultaneous fit, bootstrap upgrade.
References — verified via LiteratureSearch; inline-numbered; DOIs where available.

Validate the PDF (pypdf: ≥2 pages, >5 kB, extractable text) and run Read(file_path=...) on representative pages; regenerate if defects.

Scientific caveats (carry into every run)
Sequential PK→PD fixes PK and does not propagate PK uncertainty into PD/dose. Note it; offer a simultaneous fit as a next step.
Single-dose-level designs make dose recommendations extrapolations beyond observed data.
Small / imbalanced cohorts limit covariate and pharmacogenetic (e.g. CYP2C9/VKORC1) inference — flag as discovery-only.
Surrogate endpoints (e.g. PCA for INR) are explicit modeling assumptions; state them.
rxode2/nlmixr2 have sharp edges — see references/troubleshooting.md before debugging blindly.
References within this skill
references/schema_contract.md — data-item dictionary + validation rules + example-data mapping.
references/model_library.md — PK and the three PD structure templates + init heuristics.
references/troubleshooting.md — verified nlmixr2/rxode2 gotchas and fixes.
scripts/ — staged reference implementations to adapt.
examples/example_prompts.md — trigger prompts for QA.

68. polygenic-risk-score-prs-catalog
Category: GENOMICS & GENETICS
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

69. pooled-crispr-screens
Category: TRANSCRIPTOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

Pooled CRISPR Screen Analysis

Analyze pooled CRISPR screens with single-cell RNA-seq readout using a tiered workflow: fast screening → target validation → rigorous differential expression.

When to Use This Skill

Use this skill when you have:

✅ Pooled CRISPR screens with scRNA-seq (Perturb-seq, CROP-seq, CRISPRi/a)
✅ 10X Feature Barcoding data (sgRNA captured as feature barcodes)
✅ Multi-library experiments with biological replicates
✅ sgRNA-to-cell mapping files (already assigned)

Don't use this skill for:

❌ Arrayed CRISPR screens (separate wells per perturbation) → use bulk RNA-seq DE skills
❌ Non-transcriptional readouts (e.g., protein, flow cytometry)
❌ Data without sgRNA assignments → use CellRanger or CROP-seq pipeline first
Quick Start (Example Data)

Test this skill with a real CRISPRi Perturb-seq dataset (~10 minutes):

from scripts.load_example_data import load_example_data
data = load_example_data()  # Downloads Papalexi 2021 (~140MB, cached after first run)

adata_list = data['adata_list']  # List of AnnData objects (one per batch)
mapping_files = data['mapping_files']  # sgRNA mapping files

What you get:

Dataset: Papalexi & Satija 2021 ECCITE-seq CRISPRi screen (THP-1 cells)
Size: ~20,700 cells x 18,649 genes across 4 batches
Perturbations: 25 target genes (~4 guides each) targeting immune checkpoint regulators + non-targeting controls
Screen type: CRISPRi (expected knockdown direction: down)
Reference: Papalexi et al. (2021) Nature Genetics 53:322-331

For offline testing: Use load_example_data(dataset='demo') for a small synthetic dataset.

For your own data: Replace with your 10X feature-barcode matrices and sgRNA mapping files (see Inputs).

Installation

Core packages (required):

# Create conda environment
conda create -n crispr-screen python=3.8
conda activate crispr-screen

# Install packages
pip install scanpy==1.9+ anndata==0.8+ pandas numpy scipy
pip install scikit-learn  # For outlier detection
pip install diffxpy  # For differential expression

Visualization packages (required):

pip install matplotlib seaborn

Optional packages:

# For glmGamPoi (requires R ≥4.0)
# Install R, then:
# install.packages("BiocManager")
# BiocManager::install("glmGamPoi")
pip install rpy2  # Python-R interface

# For PDF report generation (optional, recommended)
pip install reportlab

Version requirements:

Software    Version    License    Commercial Use    Install
scanpy    ≥1.9    BSD-3    ✅ Permitted    pip install scanpy
anndata    ≥0.8    BSD-3    ✅ Permitted    pip install anndata
matplotlib    ≥3.5    PSF    ✅ Permitted    pip install matplotlib
seaborn    ≥0.12    BSD-3    ✅ Permitted    pip install seaborn
scikit-learn    ≥1.0    BSD-3    ✅ Permitted    pip install scikit-learn
diffxpy    ≥0.7    BSD-3    ✅ Permitted    pip install diffxpy
reportlab    ≥3.6    BSD    ✅ Permitted    pip install reportlab (optional)
rpy2    ≥3.5    GPL-2    ✅ Permitted    pip install rpy2 (optional)
Inputs

Required:

10X Feature-Barcode matrices (.h5 format, one per library)
Contains gene expression + sgRNA counts
From CellRanger with Feature Barcoding
sgRNA mapping files (TSV with cell-sgRNA assignments)
Format: cell_barcode sgRNA_id
One file per library
Should filter to single sgRNA assignments (doublets removed)

sgRNA naming conventions:

With gene names: GENE_sgRNA1, GENE_sgRNA2 (delimiter: _)
Without gene names: Requires separate gene lookup table

Alternative inputs: CROP-seq pipeline output, custom sgRNA assignment files

See references/crispr_screen_best_practices.md for data format details.

Outputs

Primary results:

screening_summary.txt - Per-perturbation DE statistics from t-test
validation_results.csv - Target gene knockdown/activation validation
glmgampoi/ - Batch-corrected DE results (top hits)
hit_list.csv - Final validated hits with DE gene counts

Processed data:

adata_normalized.h5ad - Normalized AnnData object for downstream analysis
Load with: adata = sc.read_h5ad('adata_normalized.h5ad')
Required for: Clustering, pseudotime, trajectory analysis
adata_processed.h5ad - Final processed data with all annotations

Analysis objects (pickle):

analysis_objects.pkl - Analysis results for downstream skills
Load with: import pickle; objs = pickle.load(open('analysis_objects.pkl', 'rb'))
Contains: perturbation_summary, de_results, outlier_cells
Required for: functional-enrichment-from-degs, coexpression-network

Report:

crispr_screen_report.pdf - Publication-quality PDF with Introduction, Methods, Results, Conclusions
Requires: pip install reportlab (optional — text report generated regardless)

QC plots (PNG + SVG format):

qc_metrics/ - Cell counts, mapping rates, doublet rates per library
volcano_plots/ - Per-perturbation volcano plots (top hits)
target_validation/ - Target gene expression heatmaps

DE results (per perturbation):

initial_screening/ - Fast t-test results (CSV per perturbation)
glmgampoi/ - Rigorous DE with batch correction (top 50-100 hits)
Clarification Questions

🚨 ALWAYS ask Question 1 FIRST. Do not ask about screen type, library details, or analysis goals before the user has answered Question 1.

1. Input Files (ASK THIS FIRST):
Do you have 10X Feature-Barcode matrix files (.h5) to analyze?
If uploaded: How many libraries/replicates?
Expected format: raw_feature_bc_matrix.h5 from CellRanger
Do you have sgRNA-to-cell mapping files?
If yes: Format? (TSV with barcode-sgRNA pairs). Doublets already filtered?
Or use example data for testing? (Papalexi 2021 CRISPRi dataset — real data, ~140MB download)

🚨 IF EXAMPLE DATA SELECTED: All parameters are pre-defined (CRISPRi, THP-1 immune cells, 25 target genes). DO NOT ask questions 2-6. Proceed directly to Step 1.

Questions 2-6 are ONLY for users providing their own data:

2. Screen Type: CRISPRi (knockdown), CRISPRa (activation), CRISPRko (knockout), or other?
3. Library Information: How many biological replicates? Non-targeting controls present? Approximate perturbations (10-100, 100-1000, 1000+)? sgRNAs per gene (1-2, 3-5, 5+)?
4. Cell Type: Primary neurons, iPSC-derived, immune cells, cancer cell lines, other? Expected phenotype (cell death, differentiation, activation, subtle)?
5. sgRNA Naming: Do sgRNA IDs include gene names (e.g., "GENE_sgRNA1")? If not, need gene lookup table?
6. Analysis Goals (skip for example data):
Primary goal?
a) Identify all hits with transcriptional phenotypes (standard)
b) Compare specific perturbations against each other
c) Focus on a known gene set
Run downstream pathway enrichment?
a) Yes (recommended)
b) No, just hit identification
Typical Complete Workflow

This skill performs core Perturb-seq analysis: screening, validation, and hit identification. For a complete CRISPR screen workflow:

This skill: Screen analysis → validated hits with transcriptional phenotypes (H5AD + hit lists)
functional-enrichment-from-degs: Pathway enrichment on hit perturbations → biological interpretation
coexpression-network: Network analysis from perturbed cells → regulatory relationships
bulk-omics-clustering: Cluster perturbations by signature → functional groups

Quick start: "Analyze my pooled CRISPR screen and identify hits with pathway enrichment"

Why separate skills? Modular design works across screen types (CRISPRi/a/ko) and readouts (scRNA-seq, bulk). See Suggested Next Steps for details.

Standard Workflow

🚨 MANDATORY: USE SCRIPTS EXACTLY AS SHOWN - DO NOT WRITE INLINE CODE 🚨

This skill uses low-freedom script execution. Pooled CRISPR screen analysis requires careful multi-step processing with QC checkpoints. Scripts handle:

Multi-library loading and concatenation
sgRNA doublet filtering
Cell-type specific QC thresholds
Batch effect handling
Target validation checks

Step 1 - Load data and map sgRNAs:

For example data:

from scripts.load_example_data import load_example_data
data = load_example_data()  # Papalexi 2021 CRISPRi (~140MB, cached)
adata_list = data['adata_list']
mapping_files = data['mapping_files']

For your own data:

from scripts.load_10x_libraries import load_multiple_libraries
from scripts.map_sgrna_to_cells import map_sgrna_to_adata
from scripts.qc_filtering import apply_qc_filters
from scripts.concatenate_libraries import concatenate_libraries

# Load, map, filter, concatenate
adata_list = load_multiple_libraries(["lib1.h5", "lib2.h5"])
adata_mapped = [map_sgrna_to_adata(ad, mf, sgrna_delimiter="_")
                for ad, mf in zip(adata_list, mapping_files)]
adata_filtered = [apply_qc_filters(ad, min_genes=2000, min_counts=8000, max_mito_pct=0.15)
                  for ad in adata_mapped]
adata = concatenate_libraries(adata_filtered, batch_labels=["lib1", "lib2"])

DO NOT write inline loading/QC code. Use the functions above.

✅ VERIFICATION: You should see "✓ sgRNA mapping complete: [N] cells retained" for each library, then "✓ Libraries concatenated: [N] total cells"

Step 2 - Preprocess and normalize:

from scripts.gene_name_corrections import correct_gene_names
from scripts.expression_filtering import filter_by_expression
from scripts.normalize_and_scale import normalize_only

# Preprocessing pipeline
adata = correct_gene_names(adata, corrections={}, gene_col='gene')
adata = filter_by_expression(adata, group_key='sgRNA', min_mean_expression=0.5)
adata = normalize_only(adata, target_sum=1e6, exclude_highly_expressed=True)

DO NOT write inline preprocessing code. Use the functions above.

✅ VERIFICATION: You should see "✓ Gene name corrections applied", then "✓ Expression filtering: [N] genes retained", then "✓ Normalization complete"

Step 3 - Run tiered analysis:

from scripts.screen_all_perturbations import screen_all_perturbations, call_hits
from scripts.validate_perturbations import validate_target_effect
from scripts.differential_expression_glmgampoi import run_glmgampoi_batch

# Fast screening → preliminary hits → validation
de_results = screen_all_perturbations(adata, control_group='non-targeting',
                                       gene_col='gene', test_method='t-test',
                                       output_dir='results/initial_screening/')
preliminary_hits = call_hits(de_results, min_de_genes=10)
validation = validate_target_effect(de_results, expected_direction='down',  # 'up' for CRISPRa
                                     min_log2fc=-0.5)
validated_hits = preliminary_hits[
    preliminary_hits['perturbation'].isin(
        validation[validation['target_affected']]['perturbation']
    )
]

# Rigorous DE for top hits (optional, requires R + glmGamPoi)
top_hits = validated_hits.head(50)
glmgampoi_results = run_glmgampoi_batch(adata, perturbations=top_hits['perturbation'].tolist(),
                                         donor_col='batch', output_dir='results/glmgampoi/')

DO NOT write inline DE code. Use the functions above.

✅ VERIFICATION: You should see "✓ Screening complete: [N] perturbations tested", then "Validated hits: [N]/[M]", then (if glmGamPoi runs) "✓ glmGamPoi complete"

Step 4 - Visualize and export:

from scripts.visualize_perturbations import create_volcano_plots
from scripts.export_results import export_all_results

# Volcano plots for top hits
for gene in top_hits['perturbation'].head(10):
    create_volcano_plots(de_results[gene], perturbation=gene, output_dir='figures/')

# Export all results (CSV, H5AD, pickle, PDF report, hit lists)
export_all_results(adata=adata, perturbation_summary=validated_hits,
                   de_results=de_results, output_dir='results/')

DO NOT write custom export code. Use export_all_results().

✅ VERIFICATION: You should see "✓ Volcano plots generated: [N] perturbations", then "=== Export Complete ===" with list of files saved

❌ IF YOU DON'T SEE VERIFICATION MESSAGES: You wrote inline code instead of using the functions. Stop and use the provided functions.

⚠️ CRITICAL - DO NOT:

❌ Write inline data loading code → STOP: Use load_multiple_libraries() and map_sgrna_to_adata()
❌ Write inline QC/filtering code → STOP: Use apply_qc_filters() and filter_by_expression()
❌ Write inline DE screening code → STOP: Use screen_all_perturbations() and validate_target_effect()
❌ Write custom export code → STOP: Use export_all_results()

⚠️ IF SCRIPTS FAIL - Script Failure Hierarchy:

Fix and Retry (90%) - Install missing package, re-run script
Modify Script (5%) - Edit the script file itself, document changes
Use as Reference (4%) - Read script, adapt approach, cite source
Write from Scratch (1%) - Only if genuinely impossible, explain why

NEVER skip directly to writing inline code without trying the script first.

📁 QC Thresholds by Cell Type:

Cell Type    min_genes    min_counts    max_mito_pct
Primary neurons    2000-3000    8000-10000    0.10-0.15
iPSC-derived    1500-2500    5000-8000    0.15-0.20
Immune cells    1000-1500    3000-5000    0.15-0.20
Macrophages    1000    3000-5000    0.18-0.20
Cancer cell lines    1500-2500    5000-8000    0.15-0.25

See references/qc_guidelines.md for detailed thresholds.

Common Issues
Issue    Cause    Solution
Low sgRNA mapping rate (<30%)    Poor capture efficiency, wrong mapping file    Check feature barcode library prep, verify sgRNA reference matches
High doublet rate (>10%)    High MOI, barcode collisions    Lower viral MOI in future screens, filter doublets computationally
Target gene not DE    Incomplete knockdown, ineffective sgRNA, compensation    Check sgRNA design, validate with protein, check for paralogs
Low validation rate (<50%)    Weak perturbations, wrong expected direction    Check CRISPRi vs CRISPRa, adjust log2fc threshold, check positive controls
Memory errors    Large dataset (>100k cells)    Process libraries separately, use backed mode (adata = sc.read_h5ad('file.h5ad', backed='r'))
Inconsistent replicates    Batch effects, population drift    Check batch balance, perform batch correction, analyze replicates separately first
glmGamPoi fails    R not installed, missing package    Install R ≥4.0 and glmGamPoi, or skip and use t-test results
SVG export failed    Missing SVG backend    Normal — script falls back automatically. Both PNG and SVG attempted.

See references/troubleshooting_guide.md for detailed solutions.

Suggested Next Steps

After running this skill:

functional-enrichment-from-degs - Pathway enrichment on hit perturbations
coexpression-network - Build gene regulatory networks from perturbed cells
bulk-omics-clustering - Cluster perturbations by transcriptional signature

Related analyses:

Compare hit genes to GWAS loci (genetic-variant-annotation)
Investigate heterogeneous responses (use Step 12 optional heterogeneity analysis in references/statistical_methods.md)
Related Skills
functional-enrichment-from-degs - Pathway enrichment on DE genes
de-results-to-plots - Advanced visualization (heatmaps, custom plots)
coexpression-network - Gene regulatory network inference
bulk-omics-clustering - Cluster samples/perturbations by expression
References

Key Papers:

Dixit et al. (2016) "Perturb-Seq" Cell 167:1853-1866
Datlinger et al. (2017) "Pooled CRISPR screening with single-cell readout" Nature Methods 14:297-301
Papalexi et al. (2021) "Characterizing the molecular regulation of inhibitory immune checkpoints" Nature Genetics 53:322-331 (example dataset)
Replogle et al. (2020) "Direct guide RNA capture" Nature Biotechnology 38:954-961
Peidli et al. (2024) "scPerturb: harmonized single-cell perturbation data" Nature Methods 21:531-540 (data source)

Online Resources:

10X Feature Barcoding: https://support.10xgenomics.com/single-cell-gene-expression/software/pipelines/latest/algorithms/crispr
CROP-seq pipeline: https://github.com/argschwind/CROP-seq-pipeline
Alector Perturb-seq analysis: https://github.com/Alector-BIO/CRISPR_PerturbSeq_pHM_publication

See references/crispr_screen_best_practices.md for comprehensive guidelines.

70. positional-analog-scanning
Category: MOLECULAR DESIGN
Source: https://biomni.phylo.bio/skills?section=marketplace

Positional Analog Scanning

Generate positional molecular ideas with RDKit. Use the conversation to choose chemistry, then the helper to enumerate, compare with the parent, and export an interactive HTML report. Read method notes for attachment examples and count formulas.

Propose a scan

Obtain the structure first: pasted SMILES, CSV (SMILES column and optional IDs), or SDF. Ask the user to select the intended component of a salt or mixture; do not silently strip it.

For an unspecified concrete-molecule scan, propose aromatic C–H, F/Cl/Me/OMe/CN/CF3, one change per candidate, CSV + SDF + interactive HTML. Run --preview-only, display the parent-preview artifact with highlighted eligible sites, and ask once whether to use or adjust that proposal. Honor already-specified choices without another confirmation. The panel is a conversational proposal; the helper requires explicit substituent arguments. If there are no aromatic sites, explain this and offer all-carbon C–H scanning as an opt-in.

Prefer chemical descriptions and SMARTS to bare indices: translate requests such as “ortho to the amide” into a validated single-atom query or selected sites and show the selection. Clarify ambiguous rings or reference groups. Indices are an advanced option: they are RDKit parsed-parent indices + 1, not IUPAC locants or input atom maps.

Support addition, aromatic [cH] → n nitrogen walks, both as separate families, and explicit [*] scaffold attachment points. Nitrogen-only walks need no substituent panel. For multiple changes, ask only for missing maximum-change and repeated/mixed-group choices. For wildcard scaffolds, scan selected dummy points and cap unmodified points with hydrogen.

Choose chemistry by site type. Keep multi-N walks small and flag adjacent-N-rich products for chemical review. For N/O–H addition, propose simple alkyl groups first. Halogen or O/N-linked groups can create N/O-halogen bonds, peroxides, hydrazines, or hydroxylamines: discuss their purpose and flag concerning products in the interpretation. Graph validity alone does not establish chemical usefulness. Keep explicitly requested products; do not add a hardcoded plausibility filter.

Execute

Use the printed Skill Directory as SKILL_DIR. Requires Python 3.11+ and RDKit (BSD-3-Clause). If absent, install RDKit in the analysis environment with uv pip install rdkit. Use -B; keep inputs, environments, results, and temporary checks outside the package.

python3 -B "$SKILL_DIR/scripts/scan.py" \
  --smiles "$SMILES" --mode addition \
  --substituent 'fluoro=[*]F' --substituent 'methoxy=[*]OC' \
  --preview-only --preview-dir "$RESULTS/previews"

The example illustrates an explicitly selected panel. After selection, remove --preview-only and add --output "$RESULTS/positional_scan" for enumeration. Use a new/empty results subdirectory beneath BIOMNI_RESULTS, or /mnt/results in Biomni. Preview needs no --output and ignores it if supplied. It writes parent_preview.html and parent_preview.json. Stdout contains only the paths, parent/site counts, attempt estimate, and warnings. Link/display the HTML directly; do not read or re-emit SVG text. Read the small metadata JSON only when needed for numbered-site selection. Set --preview-dir to a session directory beneath the runtime results root and reuse it during site selection; each call overwrites only those two files. Without it, each call creates a new system temporary directory. Keep preview scratch separate from the enumeration output directory.

Option    Meaning / default
--smiles SMILES or --input PATH    Repeatable SMILES, or CSV/SDF input.
--mode addition|nitrogen|both|attachment    Required. both produces separate addition and nitrogen families.
--substituent NAME=SMILES    Repeat each group; exactly one terminal [*] and single attachment bond. Required except nitrogen-only.
--sites aromatic-h|carbon-h|hetero-h|all-h    Addition preset; default aromatic-h. Hetero means N/O–H.
--site-smarts SMARTS    One-atom selector; recursive SMARTS provides context. Overrides addition preset; intersects nitrogen/dummy eligibility.
--include-atoms 1,4, --exclude-atoms 2,5    Optional 1-based parsed-parent indices. Attachment mode uses dummy indices.
--max-changes N    Enumerate 1 through N distinct positions; default 1.
--combinations repeated|mixed    Repeat one group, or allow mixed groups; default repeated.
--max-attempts N    Full-run pre-deduplication limit; default 10,000.
--format csv|sdf|both    Default both; HTML and JSON always produced.
--smiles-column NAME, --id-column NAME    Exact CSV column names; defaults smiles, compound_id. Missing ID column uses row identifiers.
--preview-only    Write preview HTML/metadata to scratch and print paths/counts; no enumeration.
--preview-dir PATH    Reusable preview directory; overwrites preview HTML/JSON. Default: new system temp directory.
--max-drawings N    Embed up to N product drawings, rotating across parents and scan families; default 200. Does not limit candidates.
--output PATH    Required only for enumeration; new or empty directory.

Embedded drawings grow HTML size roughly linearly; reports above 20 MB trigger a stderr note.

Use identical parsing/selection settings for preview and execution. Index lists apply to every parent in a batch; run separately when different parents need different lists. Explicit includes must be eligible for each selected scan family after intentional exclusions. Ineligible requested atoms cause one error listing parent, family, and atom numbers. Split both into separate runs if addition/nitrogen need different sites. The helper rejects invalid inputs and excessive estimates before writing success outputs. If the estimate exceeds the limit, offer fewer sites/groups/changes or an explicitly higher bound. Never silently sample, truncate, raise limits, or change scan chemistry.

Deliver and interpret
candidates.csv and/or candidates.sdf: generated analogs only, deduplicated per parent. Stable IDs, canonical SMILES, MW/Crippen logP/TPSA/HBD/HBA and delta_* fields (candidate minus reference), plus new_stereocenter_unspecified. LogP columns are crippen_logp and delta_crippen_logp. scan_type, semicolon-separated positions/substituents, and modification_count describe the first deterministic route; route_count counts all routes and routes_json retains every paired position/group assignment. For nitrogen walks, flat substituents are N replacements, not attached amino groups. already_in_input flags exact canonical isomeric SMILES matches to any concrete input molecule; matching_input_ids_json lists those IDs. These rows are retained, not claimed as new ideas. Hydrogen-capped scaffold references are not input molecules.
summary.json: parent reference rows/descriptors under references, inputs/settings, version, export/reference/report counts, bounded rejection examples (20 across the run), complete rejection counts and omitted-example count. References stay out of CSV/SDF; wildcard references are H-capped and have zero descriptor deltas.
summary.html: standalone, offline, interactive Phylo report containing every candidate and the parent references. Sort/filter/paginate, copy SMILES, and select routes to highlight parent positions. Up to 200 candidates, selected round-robin across parents and scan families, have embedded product thumbnails with changed atoms highlighted; click to enlarge. --max-drawings changes this cap. Missing drawings are labeled; they do not remove rows. Depictions and flat columns use the first generating route; alternate routes continue to highlight the parent.

Return links plus concise coverage and chemistry caveats. Review flagged new unspecified tetrahedral centers with the user: the flag means at least one generating route created an unspecified potential center absent from the parent reference. Pre-existing unspecified centers are not flagged as new. Do not choose enantiomers automatically. If no candidates survive, report that outcome; references remain in the report/JSON; CSV is header-only and SDF is empty. Preserve charge, isotopes, tautomers, and existing stereo. Descriptors do not predict pKa, potency, stability, synthesizability, novelty, or binding. Add no invented score or extra modeling workflow.

For evidence-based follow-up, use matched-molecular-pairs with comparable measured bioactivity data to assess supported transformations, or r-group-decomposition to analyze an existing congeneric series. Neither workflow runs automatically from this skill.

71. protein-structure-prediction
Category: MOLECULAR DESIGN
Source: https://biomni.phylo.bio/skills?section=marketplace

Protein Structure Prediction (multi-method, HPC)

Fold a protein with one or more of four state-of-the-art predictors and report per-residue confidence (pLDDT), plus pTM where available, a confidence-band breakdown, and a domain-resolved breakdown keyed to UniProt annotations. All four predictors run as HPC jobs via biomni.tool HPC helpers. This skill was built and verified end-to-end on real jobs (human B2M, mature chain); the exact commands, output-file layouts, and pLDDT scales in references/methods_reference.md are copied from verified runs, not from memory.

Anti-improvisation contract. Three summaries that used to be hand-rolled by the agent — the confidence-band counts, the per-domain breakdown, and the predictor/fallback disclosure — are now packaged functions that derive from the run's own produced files (the pLDDT CSV, the fetched UniProt feature table, and the run manifest). Do not re-implement any of them ad hoc; an earlier audited run that did so contradicted its own fetched data (wrong domain boundaries; band labels that did not match the binning).

Scope
Does: run AlphaFold v2, Boltz-2, Chai-1, and/or ESMCFold2 on a protein sequence; extract per-residue pLDDT normalized to 0–100; report pTM; save structure files (PDB/CIF), a per-residue CSV, and a confidence plot; produce a confidence-band breakdown and a UniProt-domain-resolved breakdown from packaged functions; disclose the predictor actually used and any fallback from the run manifest; and assemble a final PDF report (required terminal step). The automated orchestrator (fold_orchestrate.py: size default + poll-timeout + fallback) is a single-chain monomer path and rejects complexes rather than silently mis-folding them. Multi-chain complexes are supported only via a documented manual path (AlphaFold-multimer / Boltz / Chai per references/methods_reference.md; ESMCFold2 is monomer-only), not by the automated loop.
Does NOT: dock small molecules as a primary task, run MD, do experimental structure comparison (RMSD/TM-align to a PDB) unless the user asks, or design sequences. Cross-method comparison is opt-in, not automatic. It does not fabricate domain boundaries: if no UniProt feature table is available, the domain breakdown is omitted with a stated reason, never approximated.
Inputs (accept any one)
Raw amino-acid sequence — a plain protein string pasted by the user.
UniProt accession or gene/protein name — fetch the sequence from UniProt (https://rest.uniprot.org/uniprotkb/<acc>.fasta). For a gene/name, resolve to an accession first (UniProt search API, prefer reviewed/Swiss-Prot human unless told otherwise). Default to the full canonical sequence. Only use the mature chain (signal peptide / propeptide removed) if the user explicitly asks — and if you do, state which residues you removed. An accession is also what unlocks the domain-resolved breakdown (its feature table is fetched from UniProt).
Uploaded FASTA — one or more sequences from /mnt/user-uploads/.
Multi-chain complex — two or more chains (homo- or hetero-oligomer), optionally with ligands for Boltz/Chai (manual path only).

Report the resolved accession, length, and first/last residues so the choice is auditable. In interactive use you may confirm the sequence before submitting (folding jobs are GPU-expensive); for unattended runs, do not block on confirmation — proceed with the resolved canonical sequence and record it in the run manifest.

Outputs (saved to /mnt/results/)
Structure file(s): top-ranked model per method (*.pdb / *.cif).
<name>_<method>_plddt.csv — per-residue pLDDT on a 0–100 scale.
<name>_<method>_plddt.png — per-residue confidence plot.
<name>_<method>_bands.csv — confidence-band counts/percent/mean, written by extract_plddt.py from the canonical band_breakdown() (item 2 below).
<name>_confidence_breakdown.json — combined band + domain-resolved breakdown from confidence_breakdown.py. The domain section reports domain-tier features, a separate sequence_features category (signal peptide / propeptide / transit peptide / chain), per-segment no_domain_feature gaps (each listing any covering sequence-level feature), and truly uncovered residues; present when a UniProt feature table is available and omitted-with-reason otherwise.
<name>_run_manifest.json — the chosen predictor, every attempt (method, job_id, status, seconds, outcome, n_files), the poll_timeout_s actually used, and the fallback_trail. Always written by the orchestrator so an unattended run is auditable.
Use the pdf-report-generation skill to generate a pdf report with infographics (use the Biomni GenerateImage tool), methods, results, conclusions, figures, references, and next steps from all of the analyses.
Report the mean pLDDT, pTM (if available), the confidence-band breakdown, the domain-resolved breakdown, and which predictor was used / whether a fallback occurred in chat.
Method selection (size-first default)

This skill is built to run unattended and robustly. The default predictor is chosen by sequence length, not by asking, because the fast MSA-free predictor finishes reliably while the MSA-based predictors can stall on the cluster's genetic-search step. Always announce the chosen predictor and why.

Model identity. The fast MSA-free default is ESMCFold2 (built on EvolutionaryScale's ESM‑C / ESM Cambrian language model), submitted to the cluster as tool_id="esmcfold2" (esmc fold …). This is not the older 2022 ESMFold (ESM‑2-based, Meta) — it is a newer, distinct model. The CLI method token and orchestrator parameters keep the legacy spelling (--methods esmfold, --esmfold-max-len) for backward compatibility, but they select ESMCFold2.

Default rule (monomer):

Sequence length    Default predictor    Why
≤ 400 aa    ESMCFold2    Single-sequence LM, no MSA → finishes in seconds and never blocks on the MSA server. Strong accuracy on well-folded compact proteins. Pass --max-length <len> so 201–400 aa is accepted.
> 400 aa    AlphaFold v2 (primary)    Beyond ESMCFold2's default range; MSA + templates. Runs under the poll-timeout + fallback guard (see Workflow) so a stalled MSA still yields a result.

Overrides:

If the user explicitly names a method (or asks for "highest accuracy" / AlphaFold), use it — but still run it under the poll-timeout + fallback guard. AlphaFold on a ≤ 400 aa protein is therefore opt-in, not the default.
Complexes (multi-chain): the automated orchestrator (fold_orchestrate.py) is single-chain only and rejects complexes (it would otherwise silently fold one chain as a monomer). For a complex, build the multimer job manually per references/methods_reference.md (AlphaFold-multimer: --model_preset=multimer with one FASTA record per chain copy; or Boltz/Chai with one block per chain), poll it with a bounded timeout the same way, and extract with scripts/extract_plddt.py. ESMCFold2 is monomer- only and is never a complex option.
Ligands / nucleic acids: use Boltz-2 or Chai-1 — also via the manual path (the orchestrator's automated loop is protein-monomer only).

The default esmfold_max_len boundary (400) is a parameter of the orchestrator; raise or lower it if the user requests. Above the boundary, ESMCFold2 is still the last-resort fallback (with --max-length <len>, accepting OOM risk).

Rationale for the size-first default (recorded assumption): ESMCFold2's inference is ~seconds and MSA-free, so for the common case (small/medium monomers) it is both the fastest and the most reliable choice; AlphaFold's advantage is mainly on hard/low-homology or larger targets and depends on a healthy MSA server.

Confidence metrics — and what the numbers do and do not mean
pLDDT — per-residue local confidence, reported on a 0–100 scale (some methods emit 0–1 natively; extract_plddt.py normalizes). pLDDT is the model's estimate of its own local accuracy (calibrated to lDDT-Cα), NOT a measurement of correctness. A residue can be confidently wrong — high pLDDT does not verify the fold against experiment, the biological conformational state, or the effect of missing partners/ligands. Never present pLDDT as "accuracy."
A low-confidence region is often biology, not failure. Intrinsically disordered regions, flexible loops, linkers, and termini genuinely lack a single fixed structure and should score low pLDDT — that is the model correctly reporting disorder. Treat low-pLDDT stretches as candidate disorder/flexibility and cross-check annotations before calling a prediction "bad."
The predictor changes what the number means. MSA-based methods (AlphaFold, Boltz-2, Chai-1) draw confidence partly from evolutionary-coupling depth; single-sequence ESMCFold2 has no MSA and no pTM, so its pLDDT is calibrated differently. A pLDDT of 80 from ESMCFold2 is not interchangeable with 80 from AlphaFold. Always report which predictor produced the number.
Confidence bands (item 2 — one function, unambiguous boundaries). Bands are AlphaFold-calibrated: very high, confident, low, very low. Compute every band count with the single packaged function confidence_breakdown.band_breakdown(plddt) — never an ad-hoc cut()/ histogram. Its stated convention is lower-bound inclusive, upper-bound exclusive, so the label always matches the computation: very_high = pLDDT ≥ 90, confident = 70 ≤ pLDDT < 90, low = 50 ≤ pLDDT < 70, very_low = pLDDT < 50 (exactly 50 → low, 70 → confident, 90 → very high). State that these cutoffs are AlphaFold-calibrated and only approximately transfer to Boltz-2 / Chai-1 / ESMCFold2.
pTM — global fold confidence (0–1); available for AlphaFold (ptm preset), Boltz-2, and Chai-1. Not available for ESMCFold2.
ipTM — interface confidence for complexes (Boltz/Chai).
Workflow
Resolve the input to a sequence. Get the raw sequence (paste, UniProt fetch, gene→accession lookup, or FASTA). Report accession, length, and the first/last few residues. Flag signal peptides if the user wants a mature chain. Why: residue numbering in every output is 1..N of the submitted sequence; if you trim it, all downstream positions (and domain ranges) shift, so record what was submitted.
Choose the predictor by size (see Method selection). len ≤ 400 → ESMCFold2; len > 400 → AlphaFold v2; honor explicit user picks. A complex is not handled by the automated orchestrator — route it to the manual multimer path (the orchestrator rejects complexes). Announce the choice and the reason. Why: the predictor determines both reliability (MSA server dependence) and the meaning of the confidence number (see Confidence metrics).
Check the ESMCFold2 length. ESMCFold2's stock --max-length is 200; this skill passes --max-length <len> so anything ≤ the esmfold_max_len boundary (400 by default) is accepted. For very long sequences the orchestrator uses an MSA-based predictor instead (with ESMCFold2 as last-resort fallback).
Run the orchestrator — DO NOT wait for a completion callback. Prefer scripts/fold_orchestrate.py (orchestrate_fold(...) or its CLI). It performs the whole robust loop in one call: submit → poll hpc_get_job_results() with a bounded timeout → detect stall/timeout/empty-output → fall back to a faster predictor → run the extractor on the winning output → write a run manifest. It uses the exact verified commands/flags from references/methods_reference.md (AlphaFold --use_gpu_relax=false, --model_preset=monomer_ptm; Boltz-2 --num_workers 0 --use_msa_server --no_kernels; Chai --num-diffn-samples N, never --num-samples; ESMCFold2 --max-length <len>), persists job IDs to /mnt/shared-workspace/shared/, and respects the 3-concurrent-GPU-job limit (HTTP 429 → defer). Poll parameters (defaults): poll_timeout_s=900 (~15 min/job), poll_interval_s=30, with an early-exit when a job is still searching with 0 output files at the timeout bound. Raise poll_timeout_s for large/low-homology MSA targets that legitimately need longer. Fallback chain: ≤ 400 aa → ESMCFold2; > 400 aa → Boltz-2 then ESMCFold2 (--max-length <len>); if all fail → proceed with whatever completed, else report a structured failure. A method is tried at most once and never falls back to itself. This design means the run always produces a deliverable and never hangs on a callback.
Read the results from the orchestrator. It returns / records mean pLDDT, pTM (if available), the selected model, the structure/CSV/plot paths, and a <name>_run_manifest.json capturing chosen_predictor, every attempt (method, job_id, status, seconds, n_files, outcome), the poll_timeout_s actually used, and the fallback_trail. (If you run a single method by hand instead of the orchestrator, still poll hpc_get_job_results() with a bounded timeout — never block on a callback — then run scripts/extract_plddt.py on its output directory.)
Confidence-band breakdown (required whenever bands are reported). Take band counts from <name>_<method>_bands.csv (written by extract_plddt.py) or call confidence_breakdown.band_breakdown(plddt) directly. Do not re-bin pLDDT with an ad-hoc cut()/histogram — the packaged function is the single source and its boundary convention is fixed and labelled (see Confidence metrics). Why: bands communicate what fraction of the model is backbone-reliable vs. likely disordered; if the printed cutoffs do not match the computation the summary is not reproducible.
Domain-resolved breakdown (required whenever a domain breakdown is reported). Fetch the UniProt feature table with confidence_breakdown.fetch_uniprot_features(accession) and compute confidence_breakdown.domain_breakdown(plddt, features). The ranges MUST come from that fetched feature table — never a partition you compose by eye. The function fetches two tiers and handles the real shape of UniProt data: domain-tier overlapping features (reported as belonging to both, or flagged as an overlap segment listing every covering feature — never silently assigned to one); sequence-level features (signal peptide, propeptide, transit peptide, chain) reported in their own sequence_features category rather than dropped; domain gaps labelled no_domain_feature, each listing any covering sequence-level feature (so a low-pLDDT signal peptide reads as a signal peptide, not a blank); and only residues covered by no feature at all are flagged uncovered — never given an invented boundary. If no feature table is available (no accession, or UniProt returns none), the breakdown is omitted with a stated reason — never approximated. Why: proteins are modular — prodomains, linkers, and termini fold with different intrinsic order than catalytic cores — so per-domain confidence localizes where the model is trustworthy vs. where it reports genuine flexibility. Using self-composed bins instead of the annotated boundaries misattributes (dis)order to the wrong domain (the exact error this step prevents: residues at a domain seam were assigned to one domain when UniProt annotates two).
Run-provenance disclosure + gate (required). Read the manifest and, when fallback_trail is non-empty (the delivered numbers did not come from the requested/primary predictor), disclose it in the results narrative — not only a caveats footnote — using run_provenance.render_run_provenance(manifest). The disclosure must state: which method was requested, that it was cancelled at the poll bound while still running with 0 output files, which method actually produced every reported number, the poll bound actually used (from the manifest's poll_timeout_s, not a documented default), and that the requested method may have been obtainable with a longer bound. Before finalizing the report, run the gate run_provenance.check_report(manifest, report_text) (CLI: python scripts/run_provenance.py --manifest <json> --report <file>); it fails loudly if a fallback is present but the disclosure is missing. Why: a stalled MSA can silently swap the predictor the user asked for; an undisclosed swap makes the confidence numbers mean something different from what was requested.
Comparison (ONLY if the user asked). After ≥2 methods finish, align all per-residue pLDDT vectors by residue index (they must be equal length — same input sequence), then compute: overall mean per-residue pLDDT, per-residue cross-method mean and SD, and the highest-disagreement residues (largest SD). Produce a per-residue overlay plot, a distribution plot, and a summary-stats table. Do not compute inter-method RMSD/TM-score unless explicitly asked (that is structural superposition, out of default scope).
Figure/infographic value integrity (required whenever a figure or infographic states a number). Every number shown on the summary infographic or a figure caption MUST be read from the exported tables at generation time, never typed by hand. Get the canonical label: value strings with figure_value_guard.derive_infographic_values(<bands_csv|breakdown_json>) and paste them into the GenerateImage prompt; do not type a percentage. Before finalizing, run the gate figure_value_guard.check_infographic(prompt_text, <bands_csv|breakdown_json>) (CLI: python scripts/figure_value_guard.py --breakdown <table> --infographic-text <file>); it fails loudly if any stated value disagrees with the exported table. Why: a hand-typed, silently-rounded value on the headline figure contradicts the very band table the report is built from (the exact defect this prevents: an infographic reading "Confident 70-90: 30%" when the band table says 29.48%).
Final report (required terminal step — the run is not complete until it is produced). Use the pdf-report-generation skill to generate a pdf report with infographics (use the Biomni GenerateImage tool), methods, results, conclusions, figures, references, and next steps from all of the analyses.
Scientific caveats
pLDDT is confidence, not correctness. It is the model's self-estimate of local accuracy; it does not verify the fold experimentally or confirm the biological conformational state. Do not report it as accuracy.
Low pLDDT often means genuine disorder/flexibility, not a failed prediction. Disordered regions, loops, and termini legitimately score low; treat them as candidate flexible/disordered regions rather than errors.
pLDDT bands are AlphaFold-calibrated; treat cross-method band comparisons as approximate. Use the single band_breakdown() convention so labels always match the binning.
Domain breakdown depends on UniProt annotation. Ranges are taken verbatim from the fetched feature table; overlaps and gaps are real and reported as such. If you trimmed the sequence, UniProt feature coordinates will not line up with the submitted 1..N numbering — re-map or note the offset. With no feature table the breakdown is omitted, not approximated.
ESMCFold2 (single-sequence) is typically less accurate than MSA-based methods on hard/low-homology targets and has no pTM; expect lower, differently-calibrated pLDDT.
MSA-based methods depend on the MSA server being reachable; a failed MSA silently degrades quality — check logs (hpc_get_logs) if pLDDT is unexpectedly low.
Use the full canonical sequence unless a mature/domain chain is explicitly requested; residue numbering in all outputs is 1..N of the submitted sequence, which will differ from UniProt numbering if you trimmed it.
Complexes: ESMCFold2 is monomer-only; use AlphaFold-multimer, Boltz, or Chai via the manual path.
Folding jobs are GPU-expensive and rate-limited (3 concurrent). Avoid redundant runs.
Unattended robustness (this skill's contract): never block on a completion callback. Always poll with a bounded timeout and fall back to a faster predictor (or proceed with whatever finished) so a stalled MSA/genetic-search step can never hang the run. When a fallback fires, the delivered model is whatever finished — record it in the manifest and disclose it in the results (step 8), noting the size/quality tradeoff (e.g. ESMCFold2 has no pTM and is single-sequence) and that the requested method might have finished with a longer poll bound.
Files in this skill
scripts/fold_orchestrate.py — the robust unattended driver. One call resolves the sequence, picks the predictor by size, submits the HPC job, polls hpc_get_job_results() with a bounded timeout, falls back to a faster predictor on stall/timeout/empty output, runs extract_plddt.py on the winner, and writes <name>_run_manifest.json (chosen predictor + every attempt + poll_timeout_s + fallback trail). Python: from fold_orchestrate import orchestrate_fold; CLI: python fold_orchestrate.py --seq <SEQ> --name <NAME> --out <DIR> [--methods esmfold|alphafold|boltz|chai ...] [--esmfold-max-len 400] [--poll-timeout-s 900] [--poll-interval-s 30]. Use this by default instead of hand-submitting jobs and waiting for callbacks.
scripts/extract_plddt.py — unified per-residue pLDDT extractor for all four methods (auto-detects method from an output dir, normalizes to 0–100, writes CSV + plot, and a <prefix>_bands.csv from the canonical band_breakdown()). CLI: python extract_plddt.py --method auto --job-dir <dir> --out-prefix <prefix>. Verified to reproduce AlphaFold 97.16, Boltz-2 93.73, Chai-1 95.95, ESMCFold2 86.47 on the B2M validation set. Called automatically by fold_orchestrate.py.
scripts/confidence_breakdown.py — canonical confidence breakdowns (single source). band_breakdown(plddt) for AlphaFold-calibrated band counts with a fixed, labelled boundary convention; fetch_uniprot_features(accession) to pull the feature table (domain tier + a separate sequence-level tier: signal peptide, propeptide, transit peptide, chain); domain_breakdown(plddt, features) for the overlap-aware per-domain breakdown that reports sequence_features in their own category, labels domain gaps no_domain_feature (listing any covering sequence-level feature), and flags only truly uncovered residues. CLI: python confidence_breakdown.py --plddt-csv <csv> --accession <ACC> [--name <NAME>] [--features-json <json>] --out <json>. Use these instead of hand-rolling bands or domain bins.
scripts/run_provenance.py — predictor/fallback disclosure + gate. render_run_provenance(manifest) builds the disclosure text from the manifest; check_report(manifest, report_text) fails loudly if a fallback occurred but the report omits it. CLI: python run_provenance.py --manifest <json> [--report <file> | --render].
scripts/figure_value_guard.py — figure/infographic value integrity + gate. derive_infographic_values(<bands_csv|breakdown_json>) returns the canonical label: value strings (band percents at the exported precision) to paste into the GenerateImage prompt so no number is typed; `check_infographic(prompt_text, <table>)` fails loudly if any value stated on the figure/infographic disagrees with the exported table. CLI: `python figure_value_guard.py --breakdown <table> [--infographic-text <file> | --render]`.
references/methods_reference.md — verified commands, mandatory flags, input formats, output-file layouts, pLDDT extraction, band/domain breakdown semantics, and the poll-timeout + fallback policy. Read this before submitting any job.
assets/eval/ — offline unit tests for the band boundaries, the domain-breakdown overlap / no-domain-feature / sequence-level-category logic (the real Q8NBP7 case), the provenance gate, and the figure-value guard.

72. proteomics-diff-exp
Category: PROTEOMICS & METABOLOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

Proteomics Differential Expression (limma + DEqMS)

Differential protein expression analysis for TMT/LFQ mass spectrometry proteomics data using limma linear models with DEqMS PSM-count-aware variance correction.

When to Use This Skill

Use this skill when you have:

✅ Protein quantification data from TMT or LFQ mass spectrometry
✅ PSM/peptide counts per protein (for DEqMS variance correction)
✅ Biological replicates (≥2 per condition, ≥3 recommended)
✅ Need for PSM-aware statistical testing (improved power over standard limma)

Don't use this skill for:

❌ RNA-seq data → use bulk-rnaseq-counts-to-de-deseq2
❌ Metabolomics data → different normalization/statistics needed
❌ Pre-computed fold changes without raw intensities
Quick Start (Example Data)

Test this skill with real TMT proteomics data in ~2 minutes:

source("scripts/load_example_data.R")
data <- load_example_data()    # Auto-downloads A431 TMT 10-plex data (~30s)
psm_data <- data$psm_data      # 316,726 PSMs × 10 TMT channels
metadata <- data$metadata       # 4 conditions: ctrl, miR191, miR372, miR519

# Run complete workflow
source("scripts/basic_workflow.R")  # Creates fit_deqms, deqms_results + prints summary

What you get:

Dataset: A431 human epidermoid carcinoma cells treated with miRNAs (TMT 10-plex)
Comparison: miR372 vs ctrl (3 vs 3 replicates)
Expected results: ~9,000 proteins quantified, significant DE proteins at adj.p < 0.05

For your own data: Replace data loading with your protein intensity matrix and metadata (see Inputs section).

Installation

Core packages (required):

options(repos = c(CRAN = "https://cloud.r-project.org"))
if (!require('BiocManager', quietly = TRUE)) install.packages('BiocManager')
BiocManager::install(c('limma', 'DEqMS', 'ExperimentHub'))

Visualization packages (required):

install.packages(c('ggplot2', 'ggprism', 'ggrepel', 'circlize', 'matrixStats'))
BiocManager::install('ComplexHeatmap')

Optional packages:

install.packages(c('rmarkdown', 'knitr'))        # fallback script PDF report
BiocManager::install(c('impute', 'vsn'))          # kNN imputation, VSN normalization
Software    Version    License    Commercial Use    Installation
limma    ≥3.50.0    GPL (≥2)    ✅ Permitted    BiocManager::install('limma')
DEqMS    ≥1.12.0    LGPL    ✅ Permitted    BiocManager::install('DEqMS')
ExperimentHub    ≥2.0.0    Artistic-2.0    ✅ Permitted    BiocManager::install('ExperimentHub')
ggplot2    ≥3.4.0    MIT    ✅ Permitted    install.packages('ggplot2')
ggprism    ≥1.0.3    GPL (≥3)    ✅ Permitted    install.packages('ggprism')
ggrepel    ≥0.9.0    GPL-3    ✅ Permitted    install.packages('ggrepel')
ComplexHeatmap    ≥2.10.0    MIT    ✅ Permitted    BiocManager::install('ComplexHeatmap')
circlize    ≥0.4.15    MIT    ✅ Permitted    install.packages('circlize')
matrixStats    ≥0.60.0    Artistic-2.0    ✅ Permitted    install.packages('matrixStats')
rmarkdown    ≥2.20    GPL-3    ✅ Permitted    Optional

Note: Scripts automatically generate both PNG and SVG formats. SVG export uses base R svg() device (always available) or svglite if installed. No additional setup needed.

Inputs

Required:

Protein intensity matrix: Rows = proteins, Columns = samples
PSM-level table with gene/protein column (recommended — enables medianSweeping aggregation)
OR protein-level intensities (log2 or raw)
Sample metadata: data.frame with condition column

Optional but recommended:

PSM/peptide counts per protein (critical for DEqMS variance correction)

Supported formats: MaxQuant proteinGroups.txt, Proteome Discoverer export, generic CSV/TSV

Outputs

Result tables (CSV):

all_results.csv — Full DEqMS results (logFC, sca.P.Value, sca.adj.pval, count)
significant_results.csv — Filtered by adjusted p-value and fold change
normalized_protein_matrix.csv — Log2 normalized protein intensities
psm_counts.csv — PSM counts per protein
top100_proteins.csv — Top 100 by DEqMS adjusted p-value

Analysis objects (RDS):

analysis_object.rds — Complete analysis object for downstream skills
Load with: obj <- readRDS('results/analysis_object.rds')
Contains: fit_deqms, deqms_results, protein_matrix, metadata, psm_counts

Plots (PNG + SVG):

intensity_distribution — Before/after normalization boxplots
missing_values_heatmap — Missing value pattern across samples
pca_plot — PCA colored by condition
sample_correlation_heatmap — Pearson correlation between samples
volcano_plot — Differential expression with labeled top hits
ma_plot — Log2 fold change vs average expression
variance_psm_plot — DEqMS variance vs PSM count relationship

Reports:

analysis_report.pdf — final PDF report. When the user requests a PDF report, use the pdf-report-generation skill to create the final report from analysis_report.md, exported CSVs, and generated figures. The RMarkdown PDF path in scripts/generate_report.R is a fallback when pdf-report-generation is unavailable.
analysis_report.md — Markdown report (always generated)
Report Packaging

When the user requests a PDF report, run the analysis first, then load and use the Biomni pdf-report-generation skill for the final PDF deliverable. Build the PDF from this skill's markdown summary, result tables, and generated figures, and save it using the PDF filename listed in Outputs, or a stable descriptive filename when Outputs does not define one.

Keep this skill focused on scientific workflow and artifact content. Do not add custom figure appearance or report layout instructions here; those are handled by the platform prompt and dedicated reporting skills. If pdf-report-generation is unavailable, use the packaged markdown/HTML/script fallback when present and clearly disclose the fallback.

Clarification Questions
1. Input Files (ASK THIS FIRST):
Do you have proteomics data files to analyze?
If uploaded: What format? (MaxQuant proteinGroups.txt / Proteome Discoverer / CSV)
Expected: protein intensity matrix + sample metadata
Or use example data? TMT 10-plex A431 cancer cell line dataset (auto-downloads ~30s)
2. Analysis Options (structured):
(If using example data) The demo dataset contains A431 human cancer cells treated with miRNAs (3 ctrl + 3 miR372 replicates). Choose analysis mode:
a) Standard analysis with default comparison miR372 vs ctrl (recommended)
b) Custom comparison (miR191 vs ctrl or miR519 vs ctrl)
(If using your own data) Which conditions to compare? (e.g., Treatment-Control)
3. Thresholds:
a) Standard: adjusted p-value < 0.05, |log2FC| > 0.58 / 1.5-fold change (recommended)
b) Relaxed: adjusted p-value < 0.1, |log2FC| > 0 (any fold change)
c) Stringent: adjusted p-value < 0.01, |log2FC| > 1 (2-fold change)
Standard Workflow

🚨 MANDATORY: USE SCRIPTS EXACTLY AS SHOWN - DO NOT WRITE INLINE CODE 🚨

Step 1 - Load data:

source("scripts/load_example_data.R")
data <- load_example_data()
psm_data <- data$psm_data
metadata <- data$metadata

For your own data: Replace with your loading code, then call validate_input_data().

Step 2 - Run DE analysis:

source("scripts/basic_workflow.R")

DO NOT expand this into inline code. DO NOT write limma/DEqMS steps manually. Just source the script.

Step 3 - Generate plots:

source("scripts/qc_plots.R")
generate_all_plots(fit_deqms, deqms_results, protein_matrix,
                    metadata, output_dir = "results", raw_matrix = raw_matrix)

🚨 DO NOT write inline plotting code (ggsave, ggplot, Heatmap, etc.). Just use the script. 🚨

Step 4 - Export results:

source("scripts/export_results.R")
export_all(fit_deqms, deqms_results, protein_matrix, metadata,
            output_dir = "results")

DO NOT write custom export code. Use export_all() to save all outputs including RDS.

Step 5 - Generate the final PDF report when requested:

If the user asks for a PDF report, use the pdf-report-generation skill after export_all() completes.
Build the report from results/analysis_report.md, results/all_results.csv, results/significant_results.csv, results/top100_proteins.csv, and the generated PNG figures.
The final PDF must include an infographic or summary figure plus introduction, methods, results, conclusions, figures, references, and next steps.
Save or rename the final report as results/analysis_report.pdf so the expected artifact name stays stable.
If pdf-report-generation is unavailable, use the fallback PDF created by scripts/generate_report.R and state that fallback clearly.

✅ VERIFICATION - You should see:

After Step 1: "✓ Example data loaded successfully" with PSM/protein counts
After Step 2: "✓ Proteomics DE analysis completed successfully!" with summary
After Step 3: "✓ All plots generated successfully!"
After Step 4: "=== Export Complete ===" with file list
If PDF was requested: analysis_report.pdf exists and was created with pdf-report-generation, or the fallback path is clearly disclosed

❌ IF YOU DON'T SEE THESE MESSAGES: You wrote inline code. Stop and use source().

⚠️ CRITICAL - DO NOT:

❌ Write inline limma/DEqMS code → STOP: Use source("scripts/basic_workflow.R")
❌ Write inline plotting code → STOP: Use generate_all_plots()
❌ Write custom export code → STOP: Use export_all()
❌ Try to install svglite → scripts handle SVG fallback automatically
❌ Skip pdf-report-generation when the user requested a PDF report → use it for the final PDF unless unavailable, then disclose fallback
❌ Use absolute paths → Always use scripts/file.R

⚠️ IF SCRIPTS FAIL - Script Failure Hierarchy:

Fix and Retry (90%) - Install missing package, re-run script
Modify Script (5%) - Edit the script file itself, document changes
Use as Reference (4%) - Read script, adapt approach, cite source
Write from Scratch (1%) - Only if genuinely impossible, explain why

NEVER skip directly to writing inline code without trying the script first.

What the scripts provide:

scripts/load_example_data.R — load_example_data(), validate_input_data()
scripts/basic_workflow.R — Complete limma+DEqMS pipeline with PSM aggregation, imputation, normalization
scripts/qc_plots.R — Analysis-ready plots with ggprism/ComplexHeatmap (PNG + SVG with automatic fallback)
scripts/export_results.R — export_all() saves core outputs (CSV, RDS, markdown report, and fallback PDF when available)
Customizing the Analysis

To change the comparison (before sourcing basic_workflow.R):

comparison_name <- "miR519-ctrl"  # or any valid contrast
source("scripts/basic_workflow.R")

To change imputation/normalization:

imputation_method <- "kNN"         # "MinProb" (default) or "kNN"
normalization_method <- "quantile" # "median" (default), "quantile", or "none"
source("scripts/basic_workflow.R")

For detailed method documentation: See references/proteomics-reference.md For normalization guidance: See references/normalization-guide.md

Common Issues
Issue    Cause    Fix
Not seeing verification messages    Wrote inline code instead of source()    Stop and use Standard Workflow commands exactly
"cannot open file" error    Using absolute paths    Use relative paths: source("scripts/file.R")
ExperimentHub download fails    Network timeout    Set options(timeout = 300) and retry
Missing package errors    Package not installed    BiocManager::install('package') or install.packages('package')
SVG export error "svglite required"    Missing optional dependency    Use generate_all_plots() — it handles fallback automatically. DO NOT try to install svglite manually
svglite dependency conflict    System library version mismatch    Normal — generate_all_plots() falls back to base R svg() device automatically. Both PNG and SVG will be created
All proteins filtered out    Too stringent missing value filter    Adjust filter threshold in basic_workflow.R
No significant proteins    Weak effect or wrong comparison    Check PCA for condition separation; try relaxed thresholds
Suggested Next Steps

After running this skill:

Pathway enrichment → functional-enrichment skill with significant proteins
Biomarker panel → elastic-net-biomarker-panel with DE proteins as features
Network analysis → coexpression-network with protein matrix
Gene list processing → de-results-to-gene-lists for annotation
Related Skills
Skill    Relationship    When to Use
bulk-rnaseq-counts-to-de-deseq2    Alternative    RNA-seq count data (not proteomics)
elastic-net-biomarker-panel    Downstream    Build biomarker panel from DE proteins
coexpression-network    Downstream    Protein co-expression modules
References
DEqMS: Zhu Y, et al. Molecular & Cellular Proteomics. 2020;19(6):1047-1057
limma: Ritchie ME, et al. Nucleic Acids Research. 2015;43(7):e47
Detailed method reference
Normalization guide

73. r-group-decomposition
Category: DRUG DISCOVERY
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

74. rare-disease-case-prioritization
Category: GENOMICS & GENETICS
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

75. real-world-evidence
Category: DATA ANALYSIS
Source: https://biomni.phylo.bio/skills?section=marketplace

Real-World Evidence (RWE) Clinical Cohort Study

A config-driven pipeline for retrospective cohort studies on structured EHR / claims-style data. You define one study configuration (disease codes, treatment classes, comparator, endpoint); the pipeline builds the cohort, a baseline Table 1, treatment-pattern summaries, Kaplan-Meier / landmark survival with an EPV-gated Cox model, and a Phylo-branded PDF report with a data-faithful infographic. Nothing disease-, drug-, or dataset-specific is hardcoded — the same scripts run for sepsis, oncology, cardiology, or any code-defined cohort.

When to Use This Skill

Use this when you need to:

Define a patient cohort by diagnosis codes (ICD-9/10 or other) and compare it to a contemporaneous comparator group
Build an auto-typed Table 1 (median [IQR] + Wilcoxon; n (%) + Fisher)
Profile treatment patterns — drug-class classification, combination therapy, time-to-first-exposure — with a swappable treatment map
Analyze time-to-event outcomes with Kaplan-Meier, landmark survival, and log-rank, plus multivariable Cox only when statistically defensible (EPV gate)
Produce a shareable branded PDF with an infographic, methods, results, discussion, conclusions, literature-grounded references, and next steps
Reproduce a worked example end-to-end on the open-access MIMIC-IV demo

Don't use this skill for:

❌ Single-cohort survival with pre-cleaned time/event columns and no cohort building → use survival-analysis-clinical
❌ Omics-based biomarker panel selection → use elastic-net-biomarker-panel
❌ Differential expression → use bulk-rnaseq-counts-to-de-deseq2
❌ Formal causal effect estimation / target-trial emulation with propensity weighting → this pipeline is descriptive; see references/rwe-methodology.md for why and what to do next
Design Philosophy (read this first)
One config, no hardcoding. Everything study-specific lives in a single CFG list (scripts/00_config_template.R). Analysis scripts read from CFG and never contain disease/drug/dataset values. To adapt to a new study you edit only the config.
Honest defaults. Descriptive stats + KM + landmark + log-rank always run. Multivariable Cox runs only if events-per-variable ≥ CFG$epv_min (default 10); otherwise it is suppressed with a note. All p-values are labeled exploratory; no multiple-testing correction by default.
The infographic never lies. It is assembled from the real computed numbers with ggplot2 (infographic_mode = "composed_panel"). An image-generation model must NEVER render actual numbers or proportional bars — at most it may draw an empty design shell with values overlaid programmatically ("generated_shell"). See "Infographic rule" below.
Arms are defined by exposure, not by code vintage. For a comparative drug study (drug A vs drug B), the two arms must be defined by what patients received. Use comparator = "active_comparator": cohort_codes become eligibility (the disease pool), and the arms come from exposure_cohort_map / exposure_comparator_map. Never split arms by ICD-code vintage (e.g. ICD-10 E11 vs ICD-9 250 for the same disease) — coding version is an era/site artifact, not a treatment distinction, and the comparator setting must match the arms you actually analyze (don't narrate an active comparator while configuring "rest of population").
Installation
options(repos = c(CRAN = "https://cloud.r-project.org"))
install.packages(c("data.table", "survival", "ggplot2", "patchwork",
                   "scales", "jsonlite", "dplyr"))
# optional: parquet input support
install.packages("arrow")
# PDF builder (Python)
pip install reportlab pypdf pandas pillow
Software    Version    License    Commercial Use
data.table    >=1.14    MPL-2.0    ✅
survival    >=3.5    LGPL (>=2)    ✅
ggplot2    >=3.4    MIT    ✅
patchwork    >=1.1    MIT    ✅
jsonlite    >=1.8    MIT    ✅
dplyr    >=1.1    MIT    ✅
reportlab (py)    >=4.0    BSD    ✅
pypdf (py)    >=4.0    BSD    ✅
Inputs

Structured, patient-level tables (CSV or parquet), mapped to a canonical schema via CFG$cols (edit the right-hand side to match YOUR column names):

Required:

patients — one row per patient: subject_id, sex, age or date-of-birth, date-of-death (optional)
encounters — one row per admission: subject_id, hadm_id, admit time, discharge time, in-hospital death time / expiry flag
diagnoses — long: subject_id, hadm_id, icd_code, icd_version
drugs — long: subject_id, hadm_id, drug, route, start time

Optional:

icu_stays — subject_id, hadm_id, stay_id, intime, outtime, LOS (needed for ICU-anchored time origin or "rest of ICU" comparator)

Formats: CSV/TSV or parquet. Minimum ~50 patients recommended; Cox needs ≥ epv_min events per candidate covariate or it is suppressed.

Outputs (written to CFG$paths$out_dir)

Tables (tables/): cohort_flow.csv, table1_cohort.csv, treatment_class_summary.csv, treatment_top_agents.csv, treatment_summary.csv, survival_landmark_cohort.csv, survival_logrank.csv, cohort_vs_comparator.csv, and cox_results.csv (only if EPV gate passes).

Figures (figures/): infographic_summary.png/.svg (data-faithful composed panel) plus any KM/treatment figures you add.

Report: report_<slug>.pdf — Phylo-branded, with infographic summary page, executive summary, methods (+ parameter table), results (tables + figures), discussion, limitations, conclusions, next steps, and a References section populated from LiteratureSearch.

Intermediates (/workspace/rwe/*.RData): analysis objects for reuse.

Clarification Questions

🚨 ALWAYS ask Question 1 FIRST.

1. Example or own data? (ASK FIRST)
a) MIMIC-IV demo — sepsis worked example (recommended; no credentialing). Downloads the open-access demo (100 ICU patients) and reproduces the sepsis analysis. Runs in minutes. → use examples/mimic_sepsis_config.R Licensing note: only the 100-patient demo is open-access (ODbL v1.0). The full MIMIC-IV is restricted-access (PhysioNet credentialing
signed DUA required; redistribution prohibited). Never use the full MIMIC-IV from an unauthorized mirror.
b) I have my own clinical data. → continue to Questions 2–3
2. Study definition (own data — free text OK)
Cohort: which diagnosis codes define it (ICD version + prefixes/exact codes)?
Comparator: rest of population, or rest of ICU?
Treatment class of interest and the drug substrings that define each class?
Primary endpoint and time origin (admission vs first ICU stay)?
3. Column mapping (own data)
Confirm the column names for each input table so CFG$cols can be filled.
Standard Workflow

🚨 Adapt the CONFIG, then run the scripts as-is. Do not rewrite the analysis scripts inline. The scripts are config-driven; the correct way to change behavior is to edit the config, not the scripts.

Step 1 — Copy and edit the config.

cp scripts/00_config_template.R my_study_config.R

Edit my_study_config.R: set study identity, paths (input files + out_dir), cols (map your column names), cohort_codes, optional severity_tiers, comparator, treatment_label + treatment_map, primary_endpoint, landmark_times, epv_min, and literature_queries. Every field is documented in references/config-reference.md.

Two ways to define the groups (pick the one that fits your question):

Disease cohort vs everyone else (comparator = "rest_of_population" or "rest_of_icu"): cohort_codes define the cohort; the comparator is the rest of the population / ICU. This is the sepsis worked example.
Drug A vs drug B — active comparator (comparator = "active_comparator"): cohort_codes define eligibility (the disease pool, e.g. all type-2 diabetes = E11 + 250); the two arms are defined by exposure via exposure_cohort_map / exposure_comparator_map, with new-user time zero at the first qualifying fill and exposure_overlap_rule for patients exposed to both. Use this for any comparative drug-effectiveness question — never encode the arms as different ICD-code versions. See config-reference.md §6b.

For the worked example, skip copying and use examples/mimic_sepsis_config.R directly (first fetch the demo data — see Step 2).

Step 2 — (worked example only) download the open MIMIC-IV demo.

source("scripts/load_mimic_demo.R")
download_mimic_demo("/workspace/mimic")   # open access, no credentialing

This writes the hosp/ and icu/ tables the sepsis config points to.

⚠️ Data-source guardrail (HARD CONSTRAINT). The MIMIC-IV demo (100 patients) is open-access under the PhysioNet Open Data Commons ODbL v1.0 license — no credentialing required. The full MIMIC-IV is a credentialed, restricted-access dataset under the PhysioNet Credentialed Health Data Use Agreement 1.5.0; access requires PhysioNet credentialing, a signed DUA, and CITI training, and the DUA prohibits redistribution and sharing with third parties (including via APIs or online platforms).

If physionet.org is unreachable from the sandbox, do NOT substitute the full MIMIC-IV or any other restricted-access dataset from an unauthorized mirror (e.g. a HuggingFace dataset mirror). Using restricted data from an unauthorized mirror does not constitute lawful access under the DUA and is a commercial-use violation. Instead, either (a) report the network failure clearly and skip the run, explaining the blocker, or (b) run the pipeline on a small synthetic fixture that matches the canonical schema (see references/config-reference.md § 1). Never let a network outage pressure you into using data you are not licensed to use.

Step 3 — Ground the report in literature (agent step). Call Biomni LiteratureSearch with the terms in CFG$literature_queries (disease + treatment + outcome). Write the formatted citation strings, one per line, to <out_dir>/tables/references.txt. 06_manifest.R picks them up and the PDF gets a real References section. (Skip only if the user does not want a literature-grounded report.)

Step 4 — Run the full pipeline.

Rscript scripts/run_all.R my_study_config.R
# worked example:
# Rscript scripts/run_all.R examples/mimic_sepsis_config.R

This runs cohort → treatment → Table 1 → survival → comparison → infographic → manifest, then shells out to scripts/build_report.py to build the PDF. Treatment patterns run before Table 1 so that the treatment-use row is available when Table 1 is built.

✅ VERIFICATION: you should see == pipeline complete == and [build_report] OK -> .../report_<slug>.pdf with pages>=2.

Step 5 — Validate the PDF (MANDATORY). Run the visual media check on the generated PDF (Read followed by direct visual inspection). Confirm: infographic present and non-blank; all tables within margins; prose sections flow normally (not one char per line); no blank/filler pages. Regenerate and re-check if any issue is reported.

Running individual steps (optional)

Each script is standalone and takes the config as its first argument, e.g.:

Rscript scripts/02_table1.R my_study_config.R
python scripts/build_report.py /path/to/out_dir
Infographic rule (HARD CONSTRAINT)

Image-generation models must NEVER render actual numbers or proportional bar heights — those values are unverifiable and non-reproducible. Two allowed modes:

composed_panel (DEFAULT): make_infographic.R builds the summary figure from the computed CSVs with ggplot2. Data-faithful by construction.
generated_shell (opt-in): GenerateImage may draw ONLY an empty layout (boxes, arrows, labels, no numbers); every value is then overlaid programmatically from the same outputs.

If you are ever tempted to "just have the image model add the numbers" — don't. That is the one thing this skill forbids.

Common Issues
Symptom    Cause    Fix
Two drug arms coded as different ICD versions (e.g. arm A = ICD-10 E11, arm B = ICD-9 250 for the same disease)    Trying to force an exposure contrast through the code-based cohort builder; coding vintage is an era/site artifact, not a treatment    Use comparator = "active_comparator": put all disease codes in cohort_codes (eligibility) and define arms with exposure_cohort_map / exposure_comparator_map. See Design Philosophy #4 and config-reference.md §6b.
comparator doesn't match the narrative (config says rest_of_population but the report describes an active drug comparator)    Group definition and write-up drifted apart    Set comparator to the design you actually analyze; for drug-vs-drug use active_comparator so the comparator arm is the specific comparator drug class.
active_comparator errors: "requires exposure_*_map / a drugs table"    Mode selected without the exposure maps or a drugs table    Provide exposure_cohort_map, exposure_comparator_map, and CFG$paths$drugs. Keep the two maps mutually exclusive at the drug level.
0-byte PNG in figures/    R file.copy() to S3-backed /mnt/results yields 0 bytes    Already handled: make_infographic.R stages the PNG on /workspace and moves it with a shell cp. If you add figures, follow the same pattern.
Conclusions/section text prints one character per line    A single-element text field was auto-unboxed to a JSON string and iterated char-by-char    Already handled on both sides (as.list() in 06_manifest.R; mget() in build_report.py). Keep those guards if you edit manifest fields.
build_report.py "Style 'X' already defined"    Custom ParagraphStyle name collides with a ReportLab built-in (e.g. Bullet, Title)    Use a distinct prefix (the builder uses RWEBullet, RTitle, etc.).
DataFrame truthiness ValueError    csv(a) or csv(b) on pandas DataFrames    Use the provided csv_first(...) helper (None-safe).
Cox suppressed / no cox_results.csv    EPV below threshold, or cox_covariates empty    Expected and correct. Reduce covariates, get more events, or raise epv_min deliberately. See references/survival-guardrails.md.
Comparator in-hospital deaths look too low    Non-ICU first admission chosen for an ICU-anchored study    Set time_origin="index_icu_in" or comparator="rest_of_icu"; the cohort builder then selects each comparator's first ICU admission.
Antibiotic/exposure count differs from expectation    treatment_exposure_scope mismatch    index_encounter (default, rigorous) vs any_encounter (ever-exposed) answer different questions — pick deliberately.
Median survival is NA    KM never crosses 50% (small cohort)    Not a bug — report landmark survival (the pipeline already does).
PhysioNet unreachable / load_mimic_demo() fails (connection refused)    physionet.org blocked by sandbox network policy    Do NOT substitute the full MIMIC-IV or any restricted-access dataset from an unauthorized mirror (e.g. HuggingFace) — the full MIMIC-IV requires PhysioNet credentialing + a signed DUA that prohibits redistribution. Instead, report the network failure clearly and either skip the run or use a small synthetic fixture matching the canonical schema. See the data-source guardrail in Step 2.
Agent Summary Guidelines

When presenting results, the agent MUST:

Copy every number from the CSV outputs or console — never estimate, round from memory, or recalculate group sizes. If a value is not in the output, re-run the step or read the file.
Report the cohort flow (screened → cohort → with-index-encounter) and the patient-level denominators used for Table 1 and survival.
Report landmark survival with 95% CI and N-at-risk, not fragile medians. If a median's upper CI is NA, say "not reached" and use landmark rates.
State whether Cox ran or was suppressed, with the EPV value. If it ran, report the PH check; if EPV < 10 was overridden, caveat the estimates.
Label all p-values exploratory and state that no multiple-testing correction was applied.
Distinguish a single-timepoint proportion test (Fisher) from the log-rank — they can disagree without contradiction (see references/survival-guardrails.md).
State the mortality denominator (patient- vs admission-level) explicitly whenever quoting a mortality figure.
Report the phenotype limitation — the cohort is code-defined and should be validated; recommend it as a next step.
Never describe the infographic or figures from memory — reference the actual generated files.
If the intended data source is unreachable, report the failure clearly. Do not substitute restricted-access or unauthorized-mirror datasets (e.g. the full MIMIC-IV from a HuggingFace mirror). Use a synthetic fixture matching the canonical schema, or skip the run and explain the blocker. The full MIMIC-IV is credentialed data under the PhysioNet DUA, which prohibits redistribution and third-party sharing.
Interpretation Guidelines
EPV < 10: any Cox output is potentially overfitted; describe it as such, never as "good discrimination". Prefer descriptive + KM.
Log-rank p vs Fisher p: different estimands (survival curve over time vs proportion at one timepoint); report both for what they are.
In-hospital vs all-cause survival curves diverge: expected when deaths occur post-discharge (captured by linked date-of-death). Not a bug.
Wide late-time CIs: small at-risk set; interpret tails cautiously.
Confounding by indication is intrinsic: all cohort-vs-comparator contrasts are descriptive, not causal.
Suggested Next Steps
Validate the cohort definition against chart review or a published, validated phenotype; run a sensitivity analysis with an alternative code set.
Scale to the full data source (e.g. credentialed MIMIC-IV) to increase power and EPV, enabling adjusted models. Note: the full MIMIC-IV requires PhysioNet credentialing and a signed DUA; obtain access lawfully through PhysioNet, never through unauthorized mirrors.
Move toward causal inference — target-trial emulation with pre-specified eligibility, treatment strategies, time zero, and propensity/regression adjustment. See references/rwe-methodology.md.
Search the trial landscape for related interventional evidence → clinicaltrials-landscape.
Detailed time-to-event modeling on the cleaned cohort → survival-analysis-clinical.
Related Skills
Skill    Relationship
survival-analysis-clinical    Downstream/complementary — deeper Cox/risk-stratification on the cohort this skill builds
clinicaltrials-landscape    Complementary — interventional evidence for the same disease/treatment
elastic-net-biomarker-panel    Downstream — if omics are available for the cohort
pdf-report-generation    Used by — this skill's PDF builder follows its Phylo brand system
References

See references/ for the full methodology:

config-reference.md — every CFG field, with examples
rwe-methodology.md — study design, code-based phenotyping, confounding by indication, comparator/time-zero alignment, RECORD reporting
survival-guardrails.md — EPV gate, PH assumption, KM/landmark, the Fisher-vs-log-rank distinction, mortality denominators, censoring

Key methodological citations (refresh with LiteratureSearch per study):

Peduzzi P, Concato J, et al. Importance of events per independent variable in proportional hazards regression. J Clin Epidemiol. 1995.
Stürmer T, et al. Methodological considerations when analysing and interpreting real-world data. Rheumatology. 2020.
Zhao R, et al. Reporting quality of cohort studies using real-world data based on RECORD: a systematic review. BMC Med Res Methodol. 2023.

76. regvelo
Category: TRANSCRIPTOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

77. rnaseq-fastq-to-counts
Category: TRANSCRIPTOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

Bulk RNA-seq: FASTQ → DE-ready count matrix
Scope

Take raw bulk RNA-seq reads (uploaded FASTQ or a public accession) all the way to a DE-ready integer gene × sample count matrix, with QC, strandedness auto-detection, gene metadata, a DESeq2 load check, and a Phylo PDF report (infographic + intro/methods/ results/conclusions/figures/references/next-steps). It does NOT run the differential- expression contrast itself — that is the downstream bulk-rnaseq-counts-to-de-deseq2 / bulk-rnaseq-differential-expression skills. Not for single-cell (use STARsolo/CellBender), de novo transcriptome assembly (Trinity), or fusion calling (STAR-Fusion).

This skill is the upstream bridge in the pipeline: omics-dataset-retrieval (find data) → [this skill: FASTQ → counts] → DESeq2 DE skills → enrichment.

When to use

Trigger on any of: uploaded .fastq/.fastq.gz; a run accession (SRR…, ERR…, DRR…) or GEO id (GSM…, GSE…); phrases like "align/map/quantify RNA-seq", "build a count matrix", "ReadsPerGene", "gene counts", "STAR", "salmon", "detect strandedness", or "counts ready for DESeq2/edgeR". If the user only has a count matrix already, skip to the DESeq2 skill instead.

Inputs
Input    Notes
Reads    Paired-end (_R1/_R2 or _1/_2) or single-end .fastq.gz; or a public accession (resolve to FASTQ via ENA; a GEO GSM/GSE → SRR runs).
Reference (STAR)    Genome FASTA + matching GTF. Confirm organism + build + release with the user. Default: Ensembl GRCh38 (latest release) — but ask before building.
Transcriptome (salmon)    Transcript FASTA (+ genome as decoy, recommended) and a tx2gene map from the same GTF.
Fast/CI mode (optional)    Target chromosome (e.g. 22/chr22) + read-subset size (e.g. 4M pairs) to keep runtime/compute small for validation/demos.
Outputs (saved under /mnt/results/<run>/)
counts_matrix.tsv — integer gene × sample matrix (DESeq2/edgeR input; STAR special rows excluded).
gene_metadata.csv — gene_id → name, biotype, chrom/start/end/strand.
strandedness.json — empirical strandedness call + forward/reverse evidence.
assignment_summary.csv — assigned / no_feature / ambiguous / multimapping / unmapped.
star/ — Log.final.out, ReadsPerGene.out.tab, SJ.out.tab (STAR path); or salmon quant.sf + lib_format_counts.json.
qc/ — FastQC HTML.
figures/ — 4 figure groups (PNG + editable SVG).
report_<run>.pdf — Phylo-branded report with infographic.
README.md — downstream DESeq2 load snippet + scope note.
Environment & resource discovery (do this first)
Check local tool availability with Bash (command -v STAR salmon samtools fastqc seqkit) and verify required R packages with Rscript. Use hpc_search_tools("STAR") / hpc_search_tools("salmon") to confirm the HPC signatures.
Pick an execution path:
Local (default, self-contained): conda/mamba STAR + salmon on a chromosome-subset reference. Best for validation, demos, and single small samples. Size a worker ~8 CPU / 32 GB. Full-genome STAR indexing needs ~30+ GB RAM — only do full-genome locally on a big worker.
HPC (production): full-genome STAR via hpc_run_tool("star", …) with the prebuilt index --genomeDir /mnt/fsx/dbs/star/GRCh38_v2.7.11b; salmon via hpc_run_tool("salmon", …). Use for real analyses, full genomes, and many samples.
Install local tools if needed: conda install -c bioconda star salmon seqkit samtools fastqc (or confirm they are already present).
Workflow
1. Resolve & validate inputs
If given an accession, fetch FASTQ from ENA (fast, no prefetch): https://ftp.sra.ebi.ac.uk/vol1/fastq/<SRR[0:6]>/00<last digit>/<SRR>/<SRR>_{1,2}.fastq.gz (query https://www.ebi.ac.uk/ena/portal/api/filereport?accession=<SRR>&result=read_run&fields=fastq_ftp,library_layout,read_count to get exact URLs, layout, and read count). A GEO GSM/GSE → map to SRR runs first.
Verify gzip integrity (gzip -t), detect layout (paired vs single), and read length (zcat R1 | head -2 | tail -1 | wc -c, minus 1). Read length sets --sjdbOverhang.
Confirm organism, genome build, and annotation release with the user before downloading a reference.
2. Acquire reference & enforce naming consistency
Download FASTA + GTF for the confirmed build (Ensembl or GENCODE).
CRITICAL: FASTA seqnames and GTF seqnames must match exactly (Ensembl 22 vs UCSC chr22) and be the same build (GRCh38 ≠ GRCh37). A mismatch silently yields zero counts. Verify: compare grep '^>' fasta | head against cut -f1 gtf | sort -u | head.
For subset mode, subset the GTF to the target chromosome: zcat ann.gtf.gz | awk -F' ' '$1=="22" || /^#/' > chr22.gtf (match the FASTA's seqname).
3. Read QC (FastQC)
fastqc reads_R1.fastq.gz reads_R2.fastq.gz -o qc/. Read length drives --sjdbOverhang = len − 1. Note adapter content / overrepresentation; trim (Trimmomatic) only if clearly needed.
4. (Fast/CI mode) subset reads and/or reference
Subset reads with seqkit sequentially (not with shell &, which corrupts timing/pairing): seqkit head -n <N> R1.fastq.gz -o sub_R1.fastq.gz then the same for R2 (same N).
Compute the small-genome SA index size: genomeSAindexNbases = min(14, floor(log2(genomeLength)/2 − 1)) (chr22 → 11; full genome → 14).
5a. STAR path — index, align, quantify
Build index (local subset):
STAR --runMode genomeGenerate --genomeDir star_index \
  --genomeFastaFiles chr.fa --sjdbGTFfile chr.gtf \
  --sjdbOverhang <readlen-1> --genomeSAindexNbases <n> --runThreadN 8
Align + count:
STAR --genomeDir star_index --readFilesIn sub_R1.fastq.gz sub_R2.fastq.gz \
  --readFilesCommand zcat --runThreadN 8 --quantMode GeneCounts \
  --outSAMtype BAM SortedByCoordinate --outFileNamePrefix star/<sample>_
(HPC full genome: swap --genomeDir /mnt/fsx/dbs/star/GRCh38_v2.7.11b and run via hpc_run_tool.)
Validate BAM: samtools quickcheck …_Aligned.sortedByCoord.out.bam && samtools flagstat ….
Runtime note: STAR is slow when most reads are off-target (subset mode). Aligning a fixed read head-subset (e.g. 4M pairs) to a chr index runs in ~30 min on 8 CPU; run long alignments as a background job.
5b. salmon path (optional, fast) — index, quant, tximport
Build a decoy-aware index (recommended): make gentrome.fa (transcripts + genome) and decoys.txt, then salmon index -t gentrome.fa -i salmon_idx --decoys decoys.txt -k 31 -p 8.
Quantify with auto library-type detection: salmon quant -i salmon_idx -l A -1 R1.fq.gz -2 R2.fq.gz --validateMappings -p 8 -o salmon/<sample> (add --gcBias on real data). -l A records the inferred library type in lib_format_counts.json.
Aggregate to gene level: build tx2gene from the GTF, then Rscript scripts/tximport_salmon_to_counts.R --quant-dirs <name>=salmon/<sample>/quant.sf --tx2gene tx2gene.tsv --outdir /mnt/results/<run>.
Do not mix STAR and salmon counts in one matrix (union-exon vs transcript-EM).
6. Strandedness auto-detection & matrix
Run the packaged builder (STAR path):
python scripts/detect_strandedness_build_matrix.py \
  --reads-per-gene star/<sample>_ReadsPerGene.out.tab \
  --gtf chr.gtf --sample-name <sample> --outdir /mnt/results/<run>
It picks the strand column (frac_fwd ≥0.8 → forward, ≤0.2 → reverse, else unstranded), writes counts_matrix.tsv, strandedness.json, assignment_summary.csv, gene_metadata.csv. For multiple samples pass repeated --reads-per-gene (or --samples S1=…,S2=…) → one merged matrix.
For salmon, trust the -l A inferred library type (report it) — no column selection needed.
7. DE-readiness check
Rscript scripts/deseq_smoketest.R --counts /mnt/results/<run>/counts_matrix.tsv. Asserts the matrix loads into DESeqDataSetFromMatrix, is integer, non-negative, no NA/dupes. (A single sample can't be DE-tested — this only proves the matrix is a valid input.)
8. Figures + PDF report
Figures: python scripts/make_figures.py --log-final … --reads-per-gene … --strandedness … --assignment … --gene-metadata … --fastqc-r1 qc/<sample>_R1_fastqc.zip --sample-name <sample> --outdir /mnt/results/<run> → fig1_qc, fig2_alignment, fig3_counts, fig4_assignment (PNG + SVG).
Infographic: use GenerateImage (load via ToolSearch) to draw a clean schematic of the workflow (FASTQ → QC → align → quantify → matrix → DE) annotated with this run's headline metrics. Do NOT hand-draw this with matplotlib.
References: use LiteratureSearch to pull canonical method papers (STAR = Dobin 2013; salmon = Patro 2017; tximport = Soneson 2015; DESeq2 = Love 2014; dataset paper if applicable). Verify each citation from the returned record before putting it in the report.
Report: follow the pdf-report-generation skill for branding. Write the run's numbers into a metrics.json and call: python scripts/make_report.py --metrics metrics.json --fig-qc … --fig-align … --fig-counts … --fig-assign … --infographic … --title "…" --out /mnt/results/report_<run>.pdf.
Mandatory: run a Read(file_path=...) on every figure PNG and the final PDF; regenerate if blank/clipped/low-quality.
9. Hand-off README
Write README.md with the exact DESeq2 load snippet (below) and the scope note, so the user can move straight to the DE skill.
Downstream hand-off (put in README.md)
library(DESeq2)
counts  <- as.matrix(read.delim("counts_matrix.tsv", row.names = 1, check.names = FALSE))
colData <- data.frame(row.names = colnames(counts), condition = factor(c(...)))  # >=2 reps/group
dds <- DESeqDataSetFromMatrix(countData = counts, colData = colData, design = ~ condition)
dds <- DESeq(dds); res <- results(dds)
Scientific caveats
Subset mode is for validation, not biology. Aligning to one chromosome makes ~95% of reads correctly go unmapped-too-short (e.g. chr22 ≈ 94.6%). Never interpret subset counts as expression.
Genome-build & seqname mismatch is the #1 silent failure — always verify FASTA vs GTF seqnames and build before indexing (Ensembl 22 vs UCSC chr22; GRCh37 vs GRCh38).
Strandedness needs enough reads — with few gene-assigned reads the call is unreliable; STAR and featureCounts both mis-count if the wrong strand column/setting is used.
STAR vs salmon counts differ (union-exon vs transcript-level EM); never combine them.
Real DE needs replicates — a single sample gives a valid matrix but no differential test; defer the contrast, dispersion, and FDR to the DESeq2 skill (use adjusted p-values there).
Licensing: Ensembl, GENCODE, and ENA are open — no access constraints for the default references.
Test prompts (representative)
Simple: "Align this airway RNA-seq sample SRR1039508 to chr22 and give me a DESeq2-ready count matrix with a PDF report." → local STAR subset path, full deliverables.
Edge / multi-sample: "I have 4 paired-end FASTQ samples (2 control, 2 treated). Quantify them with salmon and build one gene count matrix ready for DESeq2." → salmon + tximport, merged matrix, library-type reported.
Could-go-wrong scientifically: "Build a STAR count matrix for this mouse RNA-seq using GENCODE — my last run gave all-zero counts." → confirm GRCm39 build, enforce FASTA/GTF seqname consistency, catch the build/naming mismatch.
Canonical method references (verified DOIs — use in the report)

Pull these with LiteratureSearch and cite the ones actually used in the run; do not invent DOIs. Verified:

STAR — Dobin A, et al. STAR: ultrafast universal RNA-seq aligner. Bioinformatics 2013;29(1):15–21. doi:10.1093/bioinformatics/bts635
Salmon — Patro R, et al. Salmon provides fast and bias-aware quantification of transcript expression. Nat Methods 2017;14(4):417–419. doi:10.1038/nmeth.4197
tximport — Soneson C, Love MI, Robinson MD. Differential analyses for RNA-seq: transcript-level estimates improve gene-level inferences. F1000Research 2015;4:1521. doi:10.12688/f1000research.7563.2
DESeq2 — Love MI, Huber W, Anders S. Moderated estimation of fold change and dispersion for RNA-seq data with DESeq2. Genome Biol 2014;15(12):550. doi:10.1186/s13059-014-0550-8
Worked-example dataset (SRP033351/GSE52778) — Himes BE, et al. RNA-Seq transcriptome profiling identifies CRISPLD2 as a glucocorticoid responsive gene… PLoS ONE 2014;9(6):e99625. doi:10.1371/journal.pone.0099625
Packaged scripts
scripts/detect_strandedness_build_matrix.py — STAR ReadsPerGene → strandedness call + matrix + metadata.
scripts/tximport_salmon_to_counts.R — salmon quant → gene-level counts via tximport.
scripts/make_figures.py — the 4 figure groups.
scripts/make_report.py — Phylo-branded PDF (data-driven via metrics.json).
scripts/deseq_smoketest.R — DE-readiness assertion.
references/parameters.md — parameter rules (sjdbOverhang, genomeSAindexNbases, library type, decoys).
references/worked_example.md — grounded SRR1039508/chr22 oracle with expected numbers.

78. scaffold-and-ring-systems-analysis
Category: DRUG DISCOVERY
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

79. scatac-multiome-analysis
Category: EPIGENOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

<!-- archetype: analysis-workflow --> <!-- contract: evidence-v1 -->
scATAC-seq & 10x Multiome Analysis

Use ordinary Read with an image-capable model to inspect the actual image or every rendered PDF page. Loading media or extracting text alone is not a passing visual review. Fix visible defects before delivery; if visual input is unavailable, state that limitation. The programmatic receipt validates artifacts and provenance, and does not attest visual quality.

When to Use This Skill

Use this skill for single-cell/single-nucleus chromatin accessibility and paired 10x Multiome analysis:

scATAC-seq / snATAC-seq (fragments or Cell Ranger ATAC output) — fragments-first QC, TF-IDF/LSI clustering, per-cluster MACS3 peak recalling, gene-activity scoring, annotation, and differential accessibility.
10x Multiome, RNA-assisted ATAC annotation — use the RNA modality to annotate cells and transfer labels to the ATAC assay (the existing multiome behavior).
10x Multiome, genuine paired RNA+ATAC joint analysis — after a pairing/genome-identity gate passes: per-modality QC, a Seurat WNN joint embedding with per-cell modality weights, an integrated .h5mu, scIB-style integration metrics, an optional MultiVI sensitivity route, and replicate-aware differential abundance (Milo) plus cross-modality differential expression.

Does not do (routed out or out of scope): unpaired/diagonal RNA+ATAC and CITE-seq (Antibody Capture) are directed to single-cell-multimodal-integration rather than force-integrated; trimodal, spatial-multimodal, and perturbation-multimodal designs, and raw base-calling / cellranger-arc counting, are out of scope.

Why This, Not The Obvious Thing (READ FIRST)

Treating a paired Multiome as scATAC-with-RNA-annotation, or integrating both modalities before confirming they came from the same cells and genome build, invents structure: the pairing and genome-identity gate must pass first, or the run stops and hands off rather than fabricating a joint embedding.

Inputs
A 10x Multiome filtered_feature_bc_matrix.h5 with both Gene Expression and Peaks feature types (joint/annotate route), or ATAC peaks/fragments only (scATAC route).
atac_fragments.tsv.gz with a matching .tbi tabix index.
For a Cell Ranger ARC combined matrix, its per-barcode metrics CSV with atac_peak_region_fragments and atac_fragments; combined-matrix Peaks values are cut-site counts and are never substituted for fragment-unit FRiP inputs.
metadata.csv with per-cell or per-sample replicate and condition columns for replicate-aware differential abundance.
An independent input genome identity: /matrix/features/genome in a combined 10x H5, a unique genome value in metadata, or genome.input_build for fragments-only input. chr* style alone does not distinguish hg19 from hg38.
A config file (scripts/config.example.yaml) setting the annotation genome build and the route, pairing, QC, WNN, integration, MultiVI, and differential-abundance parameters.
Outputs
report_scatac-multiome-analysis.pdf — Generate the PDF with pdf-report-generation by default. When the user explicitly selects a compatible installed report-styling skill, use that provider for presentation only; keep every scientific result, artifact, infographic, review, and receipt requirement unchanged.
joint_cluster_celltype_assignment.csv — the machine-readable joint result: one row per joint WNN cluster with cluster id, assigned cell type, top marker genes, and cell count
top_DA_peaks_per_celltype.csv — per-cell-type ATAC differential-accessibility evidence produced by both the joint and scATAC-only routes when that block runs
joint_qc_scorecard.csv, modality_weights_summary.csv, atac_initial_cluster_summary.json, and atac_recalled_cluster_summary.json — current-run evidence that keeps WNN clusters, ATAC-only cluster stages, and modality-weight means/medians distinct
integrated.h5mu — paired RNA/ATAC object for the joint route
report_facts.json — evidence-bearing claims, operational definitions, provenance, and validated denominator/completion partitions
run_receipt.json and delivery_authorization.json — strict terminal receipt and its report/receipt-bound authorization

Write the report to the results root under the name above. Data tables, figures and intermediates go in data/, figures/, tables/. Note that GenerateImage strips directory components, so schematics always land at the root regardless of the path you pass it.

Clarification Questions
How should the run obtain its input bundle? (select one)
user_paired — Use a user-provided paired 10x Multiome bundle; runtime branch ID input_mode:user_paired
Which analysis route should run? (select one)
auto — Detect the regime automatically (recommended); runtime branch ID route_override:auto
joint — Force the paired RNA+ATAC joint route; runtime branch ID route_override:joint
atac_only — Force the scATAC-only route; runtime branch ID route_override:atac_only
Standard Workflow

Single-invocation boundary. Install every dependency before analysis, then invoke scripts/run_all.sh exactly once through report_qc.run_bundled. Derive expected_outputs from the selected branch IDs with execution_contract.command_outputs_for_selected_branches; never hand-select a subset. This records every current-run output hash needed by the stage-status receipt, including joint-route ATAC differential accessibility. The non-installing scripts/preflight_dependencies.R first checks route-discovery libraries, then checks the resolved analysis route before any downstream stage. Its branch-derived contract includes biovizBase, requires miloR and SingleCellExperiment only when a joint input has at least two biological replicates per condition, and otherwise preserves the documented Milo/pseudobulk skip. A failed or duplicate run_all event invalidates the run; do not install a dependency, clean outputs, and retry in place.

from execution_contract import command_outputs_for_selected_branches
from report_qc import run_bundled

expected_outputs = command_outputs_for_selected_branches(selected_branch_ids)
run_bundled(
    ["bash", run_all_path, config_path],
    "scripts/run_all.sh",
    expected_outputs,
    invocation_id=run_invocation_id,
)

Step 1 — Load and validate the input. Enforce every item in ## Inputs; stop with not_computable on a mismatch.

Step 2 — Validate pairing and resolve the analysis route. Run scripts/00_route.R to detect feature types and barcode overlap, compare an independent matrix/metadata/explicit input genome identity with the configured annotation build, check seqlevel style separately, and evaluate sample identity. An absent or ambiguous input build is a machine not_evaluable hard stop; never infer hg19 versus hg38 from shared chr* style.

Step 3 — QC and normalize each modality. Run scripts/01_ingest_qc.R for fragments-first ATAC QC (TSS enrichment, nucleosome signal, FRiP, fragment counts) and scripts/07_rna_qc.R for RNA QC. FRiP uses the authoritative fragment-unit pair for the input type: atac_peak_region_fragments / atac_fragments for Cell Ranger ARC or peak_region_fragments / passed_filters for Cell Ranger ATAC. Only non-ARC peak matrices may fall back to compatible peak-matrix fragment counts over independently counted fragments. Missing, partial, or unit-incompatible pairs fail closed.

Step 4 — Cluster open chromatin with TF-IDF and LSI. Run scripts/02_lsi_cluster.R: TF-IDF normalization, singular value decomposition (LSI), drop the depth-correlated first component, and build the ATAC neighbor graph, UMAP, and clusters.

Step 5 — Recall peaks and score gene activity. Run scripts/03_recall_peaks.R for per-cluster MACS3 peak recalling on the fragments and scripts/04_annotate.R for gene-activity scoring and marker-based annotation using the genome triad and the bundled PBMC panel.

Step 6 — Build the WNN joint embedding. Run scripts/08_wnn_joint.R: intersect paired barcodes, recompute RNA PCA and ATAC LSI, run FindMultiModalNeighbors, and produce a joint UMAP, joint clusters, and per-cell modality weights asserted to lie in the closed unit interval.

Step 7 — Assemble the integrated object and integration metrics. Run scripts/09_integrate_bridge.py: assemble an integrated .h5mu; compute kNN metrics on the exported WNN weighted.nn graph and coordinate silhouettes on the WNN UMAP; and bind both inputs to barcode order, shape, and SHA-256 evidence. Label metrics require labels independent of WNN clustering, while single-level/missing labels or batches emit explicit non-evaluable/degenerate states instead of numeric scores.

Step 8 — Test replicate-aware differential abundance. Run scripts/10_diff_abundance.R: build Milo neighborhoods on the joint embedding and test differential abundance with spatial FDR when at least two biological replicates per condition exist, add pseudobulk RNA differential expression and preserved per-cell-type ATAC differential accessibility, and skip and flag rather than fabricate when replication is insufficient.

Step 9 — Generate and validate figures. Render only results produced by the preceding validated steps, write figures/manifest.json, then validate every declared artifact before facts or the receipt can use it. Render the integration-metrics figure only when at least one metric has a finite numeric score. When every integration metric is non-evaluable or structurally degenerate, do not create an annotation-only plotting frame: account for step 7 in the manifest with "file": null and the reason All integration metrics are non-evaluable or structurally degenerate; no finite numeric score is available to plot. Keep the individual statuses and reasons in the scorecard and summarize them in report prose or a compact table.

from report_qc import assert_figures
figures = assert_figures("figures/manifest.json")
Figures

One representative figure per result-producing step, showing this run's actual result — not a schematic, not an illustrative example. Every figure needs a caption stating what it shows. If a step genuinely has nothing to plot, replace its row with a one-line reason. A caption is required at run time, so fill these in before the first run.

Step    File    What it must make visible
3    figures/figure_3_qc_and_normalize.png    Per-modality QC after filtering: RNA counts, features, and percent mitochondrial; ATAC TSS enrichment, nucleosome signal, and FRiP, with retained-cell thresholds.
4    figures/figure_4_cluster_open_chromatin.png    ATAC LSI UMAP colored by cluster, computed after dropping the depth-correlated first LSI component.
5    figures/figure_5_recall_peaks_and.png    Per-cluster MACS3-recalled peak counts alongside the gene-activity marker evidence used to label each cluster.
6    figures/figure_6_build_the_wnn.png    WNN joint UMAP colored by joint cluster, with the per-cell RNA/ATAC modality-weight distribution (weights in the closed unit interval).
7    figures/figure_7_assemble_the_integrated.png    Joint QC scorecard when at least one WNN-graph or WNN-UMAP metric has a finite numeric score; label individual unavailable metrics. If none is numeric, use a reasoned file: null manifest entry and report the statuses as text or a compact table instead of rendering empty axes.
8    figures/figure_8_test_replicate_aware.png    Milo neighborhood differential-abundance beeswarm across conditions with spatial-FDR significance.

The report reads this inventory from report_facts.json's figures array rather than restating it, so it cannot claim a figure that was never produced.

Step 10 — Write report_facts.json from the runtime payload. The workflow must produce facts_payload.json with every headline, denominator, and partition-member field declared in skill_contract.json. Semantic gates run before the facts artifact is written, so a failing run never produces claims a report could quote.

from report_qc import write_facts_from_artifact
write_facts_from_artifact('report_facts.json', source='facts_payload.json', figures=figures, contract="skill_contract.json")

Step 10a — Derive pipeline-status prose from current-run evidence. Write the package-owned stage receipt after run_all.sh and before report assembly. It derives required outputs and block applicability from selected_branch_ids plus the recorded replicate-design gate, reconciles the overall command event with the inner Milo, pseudobulk, ATAC-DA, and MultiVI status artifacts, and hash-binds every required selected-branch output. A documented single-sample Milo/pseudobulk skip is not_applicable, not failed or missing. Use the canonical sentence verbatim in Results; never infer “all nine stages succeeded” from the shell exit code alone.

from report_qc import write_stage_status_receipt, derive_stage_status_statement
write_stage_status_receipt(selected_branch_ids, "stage_status_receipt.json")
stage_status_sentence = derive_stage_status_statement("stage_status_receipt.json")

Step 10b — Derive report facts from current artifacts. Use both canonical sentences from scripts/report_grounding.py verbatim. They distinguish mean from median WNN modality weights and the initial-ATAC, recalled-ATAC, and later WNN cluster counts. Never infer these values from plot appearance or rewrite the labels by hand. WNN weights describe contributions within the joint graph; without an explicit unimodal comparator they cannot show that WNN is preferred, superior, or more informative. Similar pre/post peak-recall cluster counts are descriptive and cannot establish structural stability without a cellwise stability statistic. The report gate rejects either overclaim.

from pathlib import Path
from report_grounding import derive_report_grounding
grounding = derive_report_grounding(Path(results_root))
modality_weight_sentence = grounding["sentences"]["modality_weights"]
cluster_stage_sentence = grounding["sentences"]["cluster_stages"]
Step 11 — Final report (MANDATORY TERMINAL STEP)

The run is not complete until this step has produced report_scatac-multiome-analysis.pdf at the results root. Generate the PDF with pdf-report-generation by default. When the user explicitly selects a compatible installed report-styling skill, use that provider for presentation only; keep every scientific result, artifact, infographic, review, and receipt requirement unchanged.

Resolve any override only from an affirmative user message in the immutable execution transcript. A tenant, customer, project, account, or dataset name is context, not a style selection. Before rendering, load the resolved provider's complete SKILL.md and applicable assets and follow them as a unit; never reconstruct a provider from marker colors or a sample receipt. Missing, malformed, conflicting, or unavailable provider evidence blocks the run rather than falling back.

Produce one combined PDF with a short narrative. Place the qualitative GenerateImage infographic near the beginning as the first substantive visual; rendered page images are inspection evidence only, never substitutes for the PDF. End the task with a concise conclusion and links to the PDF and supporting artifacts, not a bare file listing.

The PDF must use these visible top-level sections in this order, adapting their contents to this skill rather than adding generic filler:

Task Context — the research or practitioner question, supplied inputs, scope, and decision the output informs.
Methods & Sources — Methods & Sources covers data provenance, filtering, parameters, software, and the analysis design; Results reports validated quantitative findings and figures.
Results — the run's actual outputs and evidence, never a description of what the skill could do.
Conclusions & Interpretation — supported takeaways, their practical meaning, and appropriate next steps.
Limitations — run-specific uncertainty, missing coverage, failed or unavailable checks, and claims the evidence does not support.

Include the method citations from references/citations.md as a numbered References section, cited inline (e.g., [1], [2]) where each method is first described in Methods & Sources. Also cite the input dataset accession (from config.yaml -> report.dataset_accession) as the final numbered reference. Include a compact output-artifact table. Empty boilerplate does not satisfy a section.

Generate infographic.png with Biomni GenerateImage before report assembly. Read assets/infographic_prompt.txt and submit it verbatim: it is the package-fixed qualitative workflow prompt, contains no data/results/outcomes or branding, and includes the visible “not evidence that any step passed” disclaimer. Do not add numbers, result plots, weights, clusters, cell types, significance, completion, verification language, logos, watermarks, tables, dashboards, or report-page facsimiles. Immediately after the tool returns—and before any transformation or replacement—snapshot its prompt trace and pixels:

from report_qc import record_generated_infographic
record_generated_infographic(
    "infographic.png",
    prompt_file="assets/infographic_prompt.txt",
    log_path="qc_run_log.json",
)

Load the generated image with ordinary Read and inspect the pixels directly. It must be workflow-only, contain no result-like plots or values and no outcome/completion claims, and visibly carry the disclaimer. If visual input is unavailable, state that limitation; do not claim a passing semantic review.

Render the PDF to a fresh workspace file named by workspace_report_file; do not open or truncate an existing PDF on the object-backed results mount. The staged_copy call below publishes the completed file under its declared results-root name.

Then verify the run and authorize delivery with one finalize_delivery call. It runs the strict receipt, verifies the report facts and exactly one successful run_all event, then creates delivery_authorization.json bound to the current report and receipt. strict=False is not a delivery path. Do not catch its GateFailure, advertise a failed receipt, author execution events, copy transcript identifiers, or retry the remote run. Visual inspection belongs to the agent and is not attested by the delivery authorization.

Record each answer from ## Clarification Questions in selected_branch_ids using the displayed <question_id>:<choice_id> value. The receipt derives its required outputs only from those selected branches; do not union mutually exclusive branch artifacts.

from report_qc import (assert_figures, authorize_delivery, outputs_for_selected_branches,
                       record_pdf_review, staged_copy, write_facts_from_artifact,
                       write_receipt)
selected_outputs = outputs_for_selected_branches(selected_branch_ids)
figures = assert_figures("figures/manifest.json")
write_facts_from_artifact(
    "report_facts.json", source="facts_payload.json", figures=figures,
    contract="skill_contract.json",
)
staged_copy(workspace_report_file, "report_scatac-multiome-analysis.pdf")
record_pdf_review(
    report_name="report_scatac-multiome-analysis.pdf", text_artifact=extracted_text_file,
    rendered_page_files=rendered_page_files,
)
receipt = write_receipt(
    report_name="report_scatac-multiome-analysis.pdf",
    figures=figures,
    figure_not_applicable_reason=None,
    bundled_files=['scripts/run_all.sh'],
    outputs=selected_outputs,
    infographics=["infographic.png"],
    qc_run_log="qc_run_log.json",
    strict=True,
)
authorization = authorize_delivery(
    "report_scatac-multiome-analysis.pdf",
    receipt_path=receipt,
)
print(authorization["terminal_message"])

The receipt is run_receipt.json at the results root, not beside this SKILL.md. It records execution_contract_satisfied, outputs_appeared, report_at_results_root, figure_contract_satisfied, facts_artifact_verified, report_style_verified, report_content_within_margins, text_extracted, pages_rendered, visual_review_attested, report_sections_present, stage_status_prose_verified, report_facts_grounded, source_assertions_verified, infographic_lineage_verified, and infographic_semantics_verified. Every required true outcome must carry non-empty package-derived evidence, and execution_contract_satisfied requires exactly one raw successful run_all.sh event rather than a failed attempt followed by a retry. Lineage must be fully verified. visual_review_attested and infographic_semantics_verified are not_applicable: the receipt makes no visual-quality claim. Only the package-generated delivery_authorization.json permits terminal success.

Do not write this file by hand. check_skill.py --require-run-receipt requires the schema marker and per-outcome evidence, so a hand-written block of trues fails. Whatever did not hold is recorded false with a <key>_reason; fix the run rather than the receipt.

Step 12 — Validate the infographic embedding claim against the receipt (MANDATORY)

The report narrative, the closing summary, and any infographic embedding/identity sentence must be derived from run_receipt.json, never asserted from memory. Reserve "pixel-identical" — or any equivalent decoded-pixel-identity phrasing — for a completed decoded-pixel comparison that bound the generated infographic to exactly one first image on page 1 with both hashes recorded, i.e. only when infographic_lineage_verified is true with a matching evidence item. If the comparison did not run (false/not-evaluable) or is not_applicable, state that honest status and its reason; the count-only figures_embedded result does not establish image identity.

from embedding_statement import derive_embedding_statement, assert_embedding_prose_supported
claim = derive_embedding_statement("run_receipt.json")   # honest sentence; strong phrase only if verified
# Use claim["sentence"] verbatim for the embedding statement, then gate the finished prose before finishing:
assert_embedding_prose_supported(final_report_text, "run_receipt.json")
assert_embedding_prose_supported(closing_summary_text, "run_receipt.json")

assert_embedding_prose_supported raises if any pixel-identity claim is unproven, and also if the receipt records true without the backing decoded-pixel hashes (a receipt may not out-run its evidence). Do not weaken the production gate, disable the infographic requirement, or hand-author lineage evidence to make the claim pass: when platform join IDs are unavailable the honest state is not_evaluable, and a fresh supported-environment run is required before promotion.

Bundled implementation
scripts/00_route.R and scripts/_route.R establish modality, pairing, genome, and supported-route identity before integration.
scripts/01_ingest_qc.R through scripts/10_diff_abundance.R implement QC, ATAC analysis, paired WNN integration, metrics, and replicate-aware inference.
scripts/stage_status_grounding.py binds report prose to actual stage outcomes; scripts/table_layout.py protects wide diagnostic tables from page clipping.
scripts/report_qc.py owns terminal scientific, lineage, source, style, and review gates.
Scientific caveats
Treating a paired Multiome as scATAC-with-RNA-annotation, or integrating both modalities before confirming they came from the same cells and genome build, invents structure: the pairing and genome-identity gate must pass first, or the run stops and hands off rather than fabricating a joint embedding. Evidence: report_facts.json (pairing_barcode_overlap).
Per-cell modality weights are asserted to lie in the closed unit interval and describe how much each modality drove the joint neighbor graph; a near-degenerate weight distribution means one modality dominated and the joint embedding is close to a single-modality result. They do not establish that WNN is preferred, superior, or more informative than either modality without an explicit unimodal comparison. Evidence: modality_weights_summary.csv.
Initial and recalled-peak cluster counts describe two analysis stages but do not establish peak-recall structural stability without a cellwise correspondence or stability statistic. Evidence: atac_initial_cluster_summary.json and atac_recalled_cluster_summary.json.
MultiVI outputs are model predictions, not measurements, and run only when assumptions are met; otherwise a documented skip is recorded rather than a fabricated latent space. Evidence: multivi_status.json.
Milo differential abundance and pseudobulk differential expression require at least two biological replicates per condition; with insufficient replication they are skipped and flagged, never reported with a fabricated FDR. Evidence: diffabund_status.json.
The genome gate compares an independent matrix/metadata/explicit input build with the configured annotation build and checks seqlevel style separately. Missing, ambiguous, or mismatched identity hard-stops; chr* style alone is never treated as hg19/hg38 identity. Evidence: provenance_manifest.json (genome.comparison_status, genome.identity_violations).
Label-purity and label-silhouette metrics require an independent reference label; marker annotations derived from WNN clusters are never reused to validate those clusters. Single-level batch/label inputs are recorded as non-evaluable or structurally degenerate. Evidence: joint_qc_scorecard.json (integration_metrics.*_status, *_reason).
This skill is hypothesis-generating: joint clusters, integration metrics, and neighborhoods are exploratory and are not validated at any threshold. Evidence: report_facts.json.
Infographic embedding/identity statements are derived from the receipt: "pixel-identical" is used only for a completed decoded-pixel comparison that bound the generated image to one page-1 embedding with both hashes recorded; otherwise the honest not-evaluable/not-applicable status and its reason are stated, and the count-only figures_embedded result is never treated as image identity. Evidence: run_receipt.json (infographic_lineage_verified).

Each caveat must name the artifact field or the number that says whether it fired. An unbound caveat is prose; a bound one is a gate.

Evidence Tier

Contract maturity: evidence_validated. Run-specific support is limited to the sealed inputs, route and dependency provenance, facts, figures, report, and receipt.

Data Sources & Licenses
EnsDb.Hsapiens.v86 (2.99.0): https://bioconductor.org/packages/EnsDb.Hsapiens.v86/ — license Artistic-2.0; commercial use allowed (Artistic-2.0 is an OSI-approved permissive license permitting commercial use; Bioconductor package DESCRIPTION.); included false; verify with references/licenses.md.
BSgenome.Hsapiens.UCSC.hg38 (1.4.5): https://bioconductor.org/packages/BSgenome.Hsapiens.UCSC.hg38/ — license Artistic-2.0 (package); UCSC hg38 data terms (sequence); commercial use allowed (Package code is Artistic-2.0; the underlying UCSC hg38/GRCh38 assembly is freely available including for commercial use per UCSC data-use policy. Source vs assembly-data terms recorded separately.); included false; verify with references/licenses.md.
CellMarker 2.0 (2.0): http://bio-bigdata.hrbmu.edu.cn/CellMarker/ — license Ambiguous: source paper CC-BY-NC-4.0; some mirrors CC0; site shows university copyright with no explicit reuse grant; commercial use not_checked (Conflicting signals: the CellMarker 2.0 NAR paper is CC-BY-NC-4.0 (non-commercial), aggregators list CC0, and the CellMarker2 website shows a Harbin Medical University copyright with no explicit data-reuse license; commercial reuse could not be unambiguously verified.); included false; verify with references/licenses.md.
10x Genomics PBMC 10k Multiome public dataset (2.0.0): https://www.10xgenomics.com/datasets — license 10x Genomics dataset terms; commercial use no_prohibition_found (10x Genomics public datasets are provided for research use under 10x dataset terms with no redistribution prohibition found for internal analysis; never shipped.); included false; verify with references/licenses.md.
Signac (>=1.12): https://github.com/stuart-lab/signac — license MIT; commercial use allowed (MIT license (GitHub LICENSE); commercial use permitted.); included false; verify with references/licenses.md.
Seurat (>=5.0): https://github.com/satijalab/seurat — license MIT; commercial use allowed (MIT license (GitHub LICENSE); WNN implementation.); included false; verify with references/licenses.md.
MACS3 (>=3.0): https://github.com/macs3-project/MACS — license BSD-3-Clause; commercial use allowed (BSD 3-Clause (GitHub LICENSE); commercial use permitted.); included false; verify with references/licenses.md.
presto (1.0.0): https://github.com/immunogenomics/presto — license GPL-3.0-only; commercial use allowed (GPL-3.0-only (bioconda r-presto; GitHub); copyleft, commercial use allowed under GPL terms.); included false; verify with references/licenses.md.
scvi-tools (MultiVI) (>=1.1): https://github.com/scverse/scvi-tools — license BSD-3-Clause; commercial use allowed (BSD 3-Clause (GitHub LICENSE); MultiVI sensitivity route.); included false; verify with references/licenses.md.
mudata / muon (>=0.2): https://github.com/scverse/mudata — license BSD-3-Clause; commercial use allowed (BSD 3-Clause (GitHub LICENSE); .h5mu container.); included false; verify with references/licenses.md.
scanpy (>=1.9): https://github.com/scverse/scanpy — license BSD-3-Clause; commercial use allowed (BSD 3-Clause (GitHub LICENSE).); included false; verify with references/licenses.md.
scib-metrics (>=0.5): https://github.com/YosefLab/scib-metrics — license BSD-3-Clause; commercial use allowed (BSD 3-Clause (GitHub LICENSE / pyproject); scIB-style integration metrics.); included false; verify with references/licenses.md.
miloR (>=1.10): https://github.com/MarioniLab/miloR — license GPL-3; commercial use allowed (GPL-3 (Bioconductor DESCRIPTION); copyleft, commercial use allowed under GPL terms.); included false; verify with references/licenses.md.
Resource Identity

Resolve genome.build to the registry triad, then compare it against an independent build identity from the 10x matrix, metadata, or genome.input_build. Record the evidence, canonical input build, comparison status, seqlevel-style status, and derived violation rows in provenance_manifest.json. Missing/ambiguous identity is not_evaluable; disagreement is failed; both stop before facts or report assembly.

Common Issues
Symptom    Cause    Fix
Route resolves to stop with a barcode-overlap reason    RNA and ATAC barcodes do not overlap — not truly paired, or mismatched files    Confirm both modalities come from the same 10x Multiome run; verify the h5 carries Gene Expression + Peaks and the fragments match; use single-cell-multimodal-integration for deliberate diagonal integration
Route directs the input elsewhere    CITE-seq (Antibody Capture) or two separate single-modality inputs    Use single-cell-multimodal-integration; this skill only analyzes genuinely paired RNA+ATAC
stop with a genome not-evaluable/mismatch reason    No independent input build was provided, declarations disagree, or the canonical input build differs from genome.build    Preserve /matrix/features/genome, provide one unique metadata genome, or set the actual genome.input_build; align input and annotation rather than inferring from chr*
Milo / pseudobulk DA skipped and flagged    fewer than two biological replicates per condition    Add replicates, or accept the documented skip in diffabund_status.json; DA is never fabricated
MultiVI skipped    fewer cells than multivi.min_cells, or a modality missing    WNN remains the default embedding; lower multivi.min_cells only with justification (multivi_status.json records the reason)
Missing .tbi error at ingest    fragments file lacks a tabix index    bgzip the fragments if needed, then tabix -p bed atac_fragments.tsv.gz
Suggested Next Steps
Add motif / TF-activity analysis (chromVAR) and peak-to-gene linkage on the integrated object.
Confirm exploratory joint clusters and differential abundance in an independent replicate cohort before treating them as validated.
Feed joint RNA differential-expression results into functional-enrichment-from-degs for pathway context.
For trajectory structure on the joint embedding, continue with scrna-trajectory-inference.
Related Skills
single-cell-multimodal-integration — analyze CITE-seq and separately measured multimodal inputs; this skill stops and points there rather than force-integrating.
scrnaseq-seurat-core-analysis / scrnaseq-scanpy-core-analysis — RNA-only single-cell analysis.
chip-atlas-peak-enrichment — external ChIP/ATAC peak-set context for called peaks.
functional-enrichment-from-degs — enrichment on joint RNA differential expression.

80. scrna-disease-drug-discovery
Category: TRANSCRIPTOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

scRNA-seq Disease Drug Discovery Pipeline

Identify and prioritize drug targets from disease scRNA-seq data by integrating transcriptomic evidence (differential expression, pathway enrichment, ligand-receptor interactions) with human genetic evidence (Open Targets GWAS/ClinVar, GeneBass rare variant burden, TWAS, eQTL). Targets with convergent multi-omics evidence receive the highest priority.

When to Use This Skill
You have scRNA-seq data from a disease vs. control comparison and want therapeutic targets
You want multi-omics target prioritization combining expression + genetic evidence
You need cell-type-resolved drug discovery insights (which cell types drive disease?)
You want to identify druggable targets with convergent transcriptomic and genetic support

Chains from scrnaseq-scanpy-core-analysis output (adata_processed.h5ad) or accepts raw data.

Don't use for:

Cell type annotation only (use scrnaseq-scanpy-core-analysis)
Genetic-only target discovery (use genetic-target-hypothesis)
Gene regulatory networks (use grn-pyscenic)
Spatial transcriptomics (use spatial-transcriptomics)
Quick Start (Demo Data)

Test the full pipeline on SSc demo data (~20-40 min including API queries):

# Load demo dataset (GSE195452 SSc skin biopsies)
from load_data import load_demo_ssc_data
adata = load_demo_ssc_data()

# Run full pipeline
from pseudobulk_de import run_pseudobulk_de, get_disease_signature_genes
de_results = run_pseudobulk_de(adata, reference="Healthy", layer="counts")

from pathway_enrichment import run_pathway_analysis
pathway_results = run_pathway_analysis(adata, de_results)

from ligand_receptor import run_lr_analysis
lr_results = run_lr_analysis(adata)

sig_genes = get_disease_signature_genes(de_results)
candidate_genes = list(set(g for genes in sig_genes.values() for g in genes))[:200]

from genetic_evidence import collect_genetic_evidence
genetic_results = collect_genetic_evidence(candidate_genes, "systemic sclerosis")

from query_opentargets import query_target_annotations
ot_annotations = query_target_annotations(candidate_genes[:50])

from target_scoring import score_targets
scores = score_targets(de_results, pathway_results, lr_results, genetic_results, ot_annotations)

from generate_visualizations import generate_all_plots
generate_all_plots(adata, de_results, pathway_results, lr_results, genetic_results, scores)

from export_results import export_all
export_all(adata, de_results, pathway_results, lr_results, genetic_results, scores, ot_annotations)

What you get:

Dataset: 277K cells from 165 SSc + healthy skin biopsies (subsampled for compute)
Expected results: 100-700 DEGs across fibroblast subtypes, TGF-beta/ECM/IFN pathway enrichment, 15+ MEDIUM/HIGH priority targets with convergent genetic + transcriptomic evidence
Outputs: ranked_targets.csv, 7+ PNG/SVG visualizations, per-cell-type DE CSVs, GSEA results, L-R interactions, genetic evidence summary, analysis_manifest.json
Installation
Package    Version    License    Commercial Use    Installation
scanpy    >=1.9    BSD-3-Clause    Permitted    pip install scanpy
anndata    >=0.8    BSD-3-Clause    Permitted    pip install anndata
pydeseq2    >=0.4    MIT    Permitted    pip install pydeseq2
decoupler    >=1.4    MIT    Permitted    pip install decoupler
liana-py    >=0.1.7    BSD-3-Clause    Permitted    pip install liana
gseapy    >=1.0    BSD-3-Clause    Permitted    pip install gseapy
requests    >=2.28    Apache-2.0    Permitted    pip install requests
pyarrow    >=10.0    Apache-2.0    Permitted    pip install pyarrow
matplotlib    >=3.4    PSF    Permitted    pip install matplotlib
seaborn    >=0.12    BSD-3-Clause    Permitted    pip install seaborn
adjustText    >=0.8    MIT    Permitted    pip install adjustText
numpy    >=1.20    BSD-3-Clause    Permitted    pip install numpy
pandas    >=1.3    BSD-3-Clause    Permitted    pip install pandas

Install all: pip install scanpy anndata pydeseq2 decoupler liana gseapy requests pyarrow matplotlib seaborn adjustText

Optional (for preprocessing raw data): pip install scrublet celltypist harmonypy

Inputs

Required:

Annotated AnnData (.h5ad) with cell type labels, condition labels, and sample/donor IDs
Expected from scrnaseq-scanpy-core-analysis or equivalent pipeline
Minimum: 3 cell types, >=10 cells per type, 2 conditions (disease + control)

OR:

Raw/filtered count matrix (10X, H5, CSV) -- the skill will preprocess internally

Required metadata columns:

cell_type (or user-specified) -- cell type annotations
condition (or user-specified) -- disease status (e.g., "SSc", "Healthy")
sample_id (or user-specified) -- biological replicate IDs for pseudobulk DE

Optional:

Disease name for genetic evidence matching (default: inferred from condition labels)
Species: Human (default) or Mouse
Outputs

Ranked target list:

ranked_targets.csv -- All scored targets with evidence columns: DE score, pathway score, L-R score, genetic score, druggability score, composite score, priority tier, convergence flag
target_evidence_cards.json -- Per-target evidence summaries for report generation

Differential expression:

de_results_{celltype}.csv -- Per-cell-type DE results (gene, log2FC, padj, baseMean)
de_summary.csv -- Cross-cell-type DEG summary

Pathway analysis:

pathway_enrichment_{celltype}.csv -- GSEA results per cell type
pathway_activity_scores.csv -- decoupler pathway activity matrix

Ligand-receptor interactions:

lr_interactions.csv -- Significant L-R pairs with source/target cell types, methods, consensus rank
lr_disease_specific.csv -- Disease-enriched interactions (disease vs control comparison)

Genetic evidence:

genetic_ot_disease_genetics.csv -- Open Targets GWAS/ClinVar/gene burden evidence
genetic_twas_associations.csv -- TWAS Atlas results
genetic_summary.csv -- Integrated genetic evidence per gene

Analysis objects:

adata_analyzed.h5ad -- AnnData with DE results, pathway scores in .uns
Load with: import scanpy as sc; adata = sc.read_h5ad('adata_analyzed.h5ad')
analysis_manifest.json -- Provenance: timestamp, parameters, step timing, output paths

Visualizations (PNG + SVG):

UMAP overview (cell type + condition)
Volcano plots per cell type
DEG heatmap across cell types (gene symbols, sorted by significance)
Pathway activity heatmap (sorted by max |NES|, not alphabetical)
L-R dot plot (disease-relevant interactions prioritized)
Multi-omics convergence heatmap (targets x evidence types)
Target ranking bar chart

Reports:

drug_discovery_report.pdf -- PDF report created with pdf-report-generation from the generated disease/drug discovery artifacts
Report Packaging

Generate a PDF report using pdf-report-generation unless otherwise specified, with the available scientific outputs, generated figures, and relevant references. The workflow is not complete until the report is generated.

Decision Guide
Decision    Quick Guide    Reference
Data type    10X Chromium (default). Smart-seq2/plate: lower min_cells to 3-5    references/workflow-details.md
Subsampling    >50K cells: subsample to 2-5K per cell type per condition. Do NOT use flat global cap    references/workflow-details.md
DE layer    Always pass layer="counts" if .X is log-normalized. Auto-detected if layers["counts"] exists    references/workflow-details.md
GSEA ranking    Combined stat sign(LFC) x -log10(padj) (default). Skips cell types with failed DE    references/workflow-details.md
Genetic evidence    Open Targets GWAS/ClinVar is primary; GeneBass if disease is in UKB; TWAS/eQTL supplementary    references/genetic_evidence_guide.md
Analysis scope    Full pipeline (default). Transcriptomics-only if no genetic evidence needed    Below
Clarification Questions

Default settings (use unless user specifies otherwise):

Species: Human | Genetic evidence: Enabled | All analyses: Enabled
1. Input Files (ASK THIS FIRST):
Do you have an annotated scRNA-seq AnnData (.h5ad) with disease and control conditions?
Or use demo data? GSE195452: Systemic sclerosis skin biopsies (SSc + healthy controls)
If your own data: provide path to .h5ad file
2. Metadata columns (own data only):
Which column contains cell type labels? (default: cell_type)
Which column contains disease/condition labels? (default: condition)
Which column contains sample/donor IDs? (default: sample_id)
3. Disease context (own data only):
What disease are you studying? (needed for Open Targets genetic evidence and pathway context)
Species: Human (default) or Mouse?
4. Analysis scope:
a) Full pipeline with genetic evidence (recommended)
b) Transcriptomics only (DE + pathways + L-R, no genetic evidence)
c) Custom: specify which analyses

:warning: IF DEMO DATA SELECTED: All parameters are pre-defined (SSc, human, full pipeline). DO NOT ask questions 2-4. Proceed directly to Step 1.

Data Integrity Rules

:rotating_light: NEVER reconstruct results from memory, notes, or session summaries. :rotating_light:

If you cannot find the expected output CSV files after a crash or restart:

STOP immediately -- do NOT type quantitative values from memory
Check standard locations: results/, ./results/, /mnt/results/, the working directory
Each analysis step saves CSVs incrementally (DE per cell type, GSEA per cell type, ranked_targets.csv) -- check for partial results
If files are truly missing, re-run the analysis step from the saved h5ad
NEVER hardcode target data like [('GENE1', 0.82, 'HIGH'), ...] from session notes

Every quantitative value in the final report must be read from a CSV file on disk, not from session memory.

If the session crashed (OOM, kernel restart): Partial CSVs from completed steps are on disk. Re-run only the steps that didn't complete. The h5ad file is the checkpoint -- all analysis can be re-derived from it.

Standard Workflow

:rotating_light: MANDATORY: USE SCRIPTS EXACTLY AS SHOWN - DO NOT WRITE INLINE CODE :rotating_light:

Detailed step-by-step code: references/workflow-details.md

CRITICAL - DO NOT:

Write inline analysis code -- STOP: Use the script functions
Write custom export code -- STOP: Use export_all()
Skip verification messages -- STOP: Check for verification messages after each step
Reconstruct values from memory after a crash -- STOP: Read from saved CSVs or re-run

IF SCRIPTS FAIL - Script Failure Hierarchy:

Fix and Retry (90%) - Install missing package, re-run script
Modify Script (5%) - Edit the script file itself, document changes
Use as Reference (4%) - Read script, adapt approach, cite source
Write from Scratch (1%) - Only if genuinely impossible, explain why

NEVER skip directly to writing inline code without trying the script first.

Step 1 -- Load and validate data:

# Option A: Demo data (GSE195452 SSc)
from load_data import load_demo_ssc_data
adata = load_demo_ssc_data()

# Option B: Pre-annotated h5ad
from load_data import load_annotated_h5ad
adata = load_annotated_h5ad("path/to/adata.h5ad",
                             celltype_key="cell_type",
                             condition_key="condition",
                             sample_key="sample_id")

# Option C: Raw data (will preprocess)
from load_data import load_raw_data
from preprocess import run_preprocessing_pipeline
adata = load_raw_data("path/to/data")
adata = run_preprocessing_pipeline(adata, species="human")

# CHECKPOINT: Save AnnData to disk immediately (OOM/timeout resilience)
# If the kernel restarts, reload from this file instead of rebuilding.
adata.write_h5ad("results/adata_processed.h5ad")
print("Checkpoint saved: results/adata_processed.h5ad")

DO NOT write inline data loading code. CHECKPOINT: After loading, ALWAYS save the AnnData to disk. If the kernel restarts later, reload with sc.read_h5ad("results/adata_processed.h5ad") instead of re-downloading and rebuilding from GEO.

VERIFICATION: You MUST see: "Data loaded successfully! N cells, M genes, K cell types, C conditions" If you don't see this: Check file path, verify .h5ad has required metadata columns (cell_type, condition, sample_id).

Step 2 -- Run analysis:

Sample selection: Use ALL available samples — statistical power depends on biological replicates, not cell count. Subsample CELLS within samples if needed for memory, but do NOT drop samples. For datasets with >100K cells, subsample to ~3000-5000 cells per cell type per condition while keeping all samples represented. For plate-based data (Smart-seq2), use patient_id (not amplification batch) as the pseudobulk grouping variable. See references/workflow-details.md for details.

GSEA thresholds: GSEA output tables report all pathways with FDR < 0.25 (standard for GSEA reporting and exploration). Target scoring uses stricter FDR < 0.05 for pathway_score contribution. Both thresholds are intentional.

# 2a. Differential expression (disease vs control per cell type)
# IMPORTANT: pass layer="counts" if adata.X is log-normalized
from pseudobulk_de import run_pseudobulk_de, get_disease_signature_genes
de_results = run_pseudobulk_de(adata,
                                condition_key="condition",
                                sample_key="sample_id",
                                celltype_key="cell_type",
                                reference="Healthy",
                                layer="counts")

# 2b. Pathway enrichment (uses combined ranking: sign(LFC) x -log10(padj))
from pathway_enrichment import run_pathway_analysis
pathway_results = run_pathway_analysis(adata, de_results, species="human")

# 2c. Ligand-receptor interactions
# Auto-merges to max 20 cell types, subsamples to 2000 cells/type, 100 permutations
# for tractable runtime (~5-10 min). Increase n_perms for more stable estimates.
from ligand_receptor import run_lr_analysis
lr_results = run_lr_analysis(adata,
                              celltype_key="cell_type",
                              condition_key="condition",
                              max_celltypes=20,
                              max_cells_per_type=2000,
                              n_perms=100)

# 2d. Collect candidate gene list from DE results (for genetic + OT queries)
sig_genes = get_disease_signature_genes(de_results, padj_threshold=0.05, log2fc_threshold=0.25)
candidate_genes = list(set(g for genes in sig_genes.values() for g in genes))[:200]

# 2e. Genetic evidence (queries Open Targets GWAS/ClinVar + TWAS + eQTL + L2G)
from genetic_evidence import collect_genetic_evidence
genetic_results = collect_genetic_evidence(
    gene_list=candidate_genes,
    disease_name="systemic sclerosis",
    include_genebass=True)

# 2f. Target scoring
# CRITICAL: Use score_targets_simple() — DO NOT write custom scoring code.
# Custom scorers miss: convergence bonus, cross-compartment L-R bridging,
# adaptive reweighting, NES-weighted pathway scoring, and DE cap logic.
from target_scoring import score_targets_simple
scores = score_targets_simple({
    "de": de_results,
    "pathway": pathway_results,
    "lr": lr_results,
    "genetic": genetic_results,
})
# Druggability auto-queried for top 20 genes. For all: pass "ot_annotations" key.

# 2g. GWAS Gene Landscape (MANDATORY for SSc demo)
# Maps top SSc GWAS genes to their cell-type expression context.
# Separate from the DE-derived target list — bridges immune-fibroblast disconnect.
from genetic_evidence import get_top_gwas_genes, assess_gwas_genes_in_adata
gwas_genes = get_top_gwas_genes("systemic sclerosis", n=20)
gwas_context = assess_gwas_genes_in_adata(adata, gwas_genes, de_results=de_results)

DO NOT write custom scoring code. The score_targets_simple() function handles adaptive reweighting, convergence bonuses, cross-compartment L-R bridging, and NES-weighted pathway scoring. Custom scorers miss these and produce invalid priority tiers.

VERIFICATION: After 2f you MUST see: "Target scoring complete! N targets scored, M HIGH, ..." After 2g: "GWAS gene landscape: N genes mapped, M are DE in at least one cell type" If DE returns 0 DEGs for a cell type: DESeq2 auto-falls back to Wilcoxon. GSEA quality gate skips cell types with failed DE. If LIANA takes >15 min: Normal for large datasets. Partial results saved at each step.

Report structure: The PDF report should have TWO target sections:

Multi-omics targets — DE-derived, scored across all evidence dimensions (from score_targets)
GWAS gene landscape — top SSc genetic targets mapped to cell types (from assess_gwas_genes_in_adata), showing which GWAS genes are expressed where and whether they're DE. This bridges the immune-fibroblast disconnect: GWAS targets (IRF5, STAT4) are immune genes, while DE targets are fibroblast genes. Both are real biology.

Step 3 -- Generate visualizations:

from generate_visualizations import generate_all_plots
generate_all_plots(adata, de_results, pathway_results, lr_results,
                    genetic_results, scores, output_dir="results",
                    gwas_context_df=gwas_context)

DO NOT write inline plotting code. This generates 11 standard visualizations including the GWAS gene landscape.

VERIFICATION: You MUST see: "All plots generated successfully! N visualizations saved" If a plot fails: Non-fatal -- other plots still generated. Check WARNING messages.

Step 4 -- Export results:

from export_results import export_all
export_all(adata, de_results, pathway_results, lr_results,
            genetic_results, scores, output_dir="results")

DO NOT write custom export code. Use export_all().

VERIFICATION: You MUST see: "=== Export Complete ===" If you don't see "Export Complete": The export did not complete. Re-run the export function.

Target Scoring Methodology

See references/target_scoring_methodology.md for full details.

Multi-omics composite score (convergent genetic + transcriptomic evidence):

Component    Weight    Description
Differential expression    0.20    -log10(padj) weighted by log2FC magnitude. Multi-cell-type DE bonus.
Pathway centrality    0.15    Disease-relevant enriched pathways containing the gene (FDR < 0.05).
L-R involvement    0.15    Consensus rank for disease-specific interactions. Reweighted to 0 if unavailable.
Cell-type specificity    0.10    Tau-like specificity of disease effect in disease-relevant cell types.
Genetic evidence    0.25    Open Targets GWAS/ClinVar (primary) + GeneBass + TWAS + eQTL + L2G.
Druggability    0.15    Open Targets tractability, known drugs, genetic constraint.

Convergence bonus (1.2x): Targets with BOTH genetic AND transcriptomic evidence.

Priority tiers: HIGH (>=0.55), MEDIUM (0.35-0.55), LOW (<0.35)

Adaptive reweighting: If L-R or genetic evidence is unavailable, those weights are redistributed to remaining components (weights always sum to 1.0).

Common Issues
Error    Cause    Solution
ImportError: liana    Not installed    pip install liana
ImportError: decoupler    Not installed    pip install decoupler
Pseudobulk DE blocked: N=1    Single sample per condition    Need >=2 replicates. Fallback: cell-level Wilcoxon (exploratory)
DESeq2 degenerate results (all padj = 1.0)    Insufficient pseudobulk replicates for a cell type    Auto-falls back to Wilcoxon for that cell type. GSEA quality gate skips it.
GSEA skipped for a cell type    0 significant DEGs (DE failure)    Expected -- GSEA on failed DE produces artifacts. Only runs on cell types with real signal.
GeneBass data not found    Not on Biomni datalake    Skill uses Open Targets GWAS/ClinVar as primary genetic evidence instead
No significant L-R interactions    Too few cell types or cells    Need >=3 cell types, >=10 cells per type. L-R weight redistributed in scoring.
LIANA takes >15 minutes    Large dataset with many cell types    Normal for >10K cells x 10+ cell types. Partial results saved at each step.
TWAS Atlas timeout    API issues    Retry with backoff (built-in). Falls back to other genetic evidence.
Open Targets rate limit    Too many gene queries    Built-in rate limiting (0.5s between requests)
SVG export failed    Missing svglite/cairocffi    Normal -- PNG always generated. Both created in most environments.

Expected warnings (not errors):

Warning    Meaning    Action
DESeq2 degenerate results, falling back to Wilcoxon    Cell type has too few samples for pseudobulk    Normal for subsampled data. Wilcoxon results are exploratory.
Skipping GSEA for [cell type]    DE failed for that cell type    GSEA quality gate working correctly. No action needed.
L-R consensus_rank is all NaN    liana version mismatch    Auto-falls back to specificity_rank. Scoring reweights.
Suggested Next Steps
Deep-dive on top targets -- Use genetic-target-hypothesis for detailed genetic characterization of top-scored targets
Trajectory analysis -- Use scrna-trajectory-inference to trace disease progression in key cell types
Regulatory networks -- Use grn-pyscenic to identify TF regulators of disease programs
Validation -- Use literature-review to check published evidence for top targets
Related Skills

Upstream: scrnaseq-scanpy-core-analysis (produces input h5ad) | Complementary: genetic-target-hypothesis (genetics-first approach), cell-cell-communication (R/CellChat alternative), functional-enrichment-from-degs (R/clusterProfiler alternative) | Downstream: grn-pyscenic, scrna-trajectory-inference, literature-review

References
Scanpy: Wolf FA, et al. (2018) Genome Biol. 19:15.
PyDESeq2: Muzellec B, et al. (2023) Bioinformatics. 39(9):btad547.
LIANA: Dimitrov D, et al. (2022) Nat Commun. 13:3224.
decoupler: Badia-i-Mompel P, et al. (2022) Bioinformatics. 38(Supplement_2):ii81-ii88.
GeneBass: Karczewski KJ, et al. (2022) Nature. 590:791-797.
Open Targets: Ochoa D, et al. (2023) Nucleic Acids Res. 51(D1):D1302-D1310.
TWAS Atlas: TWAS Atlas 2.0 (2025) Nucleic Acids Res.

Detailed guides: references/workflow-details.md | references/common-patterns.md | references/ssc_biology.md | references/target_scoring_methodology.md | references/genetic_evidence_guide.md | references/dataset_guide.md | references/liana_methods.md

Scripts: scripts/ | Evaluation: assets/eval/

81. scrna-trajectory-inference
Category: TRANSCRIPTOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

Single-Cell Trajectory Inference
When to Use This Skill

Use when you have preprocessed scRNA-seq data and want to:

✅ Order cells along a differentiation or disease trajectory (pseudotime)
✅ Identify branching points and terminal cell fates
✅ Discover genes driving cell state transitions
✅ Visualize RNA velocity (direction of cell state change)
✅ Compute cell fate probabilities with CellRank
✅ Chain from scrnaseq-scanpy-core-analysis output

Do NOT use when:

❌ Data is not yet preprocessed (use scrnaseq-scanpy-core-analysis first)
❌ You have bulk RNA-seq (use disease-progression-longitudinal instead)
❌ Cells are terminally differentiated with no trajectory (e.g., resting PBMCs)
❌ Fewer than 200 cells
Installation
pip install scanpy anndata scvelo cellrank numpy pandas matplotlib seaborn scipy statsmodels reportlab
Package    Version    License    Commercial Use    Notes
scanpy    ≥1.9    BSD-3    ✅ Permitted    Core trajectory (PAGA, DPT)
anndata    ≥0.8    BSD-3    ✅ Permitted    Data container
scvelo    ≥0.2.5    BSD-3    ✅ Permitted    RNA velocity (optional but recommended)
cellrank    ≥2.0    BSD-3    ✅ Permitted    Fate mapping (optional)
matplotlib    ≥3.4    PSF    ✅ Permitted    Plotting
seaborn    ≥0.11    BSD-3    ✅ Permitted    Statistical plotting, heatmaps
scipy    ≥1.7    BSD-3    ✅ Permitted    Statistics
statsmodels    ≥0.13    BSD-3    ✅ Permitted    FDR correction
reportlab    ≥3.6    BSD    ✅ Permitted    PDF report (optional)

Graceful degradation: Core analysis (PAGA + pseudotime) requires only scanpy. scVelo and CellRank are optional — scripts detect availability and skip gracefully.

Inputs

Required:

Preprocessed AnnData (.h5ad) with PCA, UMAP, and cluster annotations
Output from scrnaseq-scanpy-core-analysis (adata_processed.h5ad) works directly
Must have ≥200 cells, ≥100 genes, cluster labels in .obs

For RNA velocity (optional):

Spliced/unspliced count layers (adata.layers['spliced'], adata.layers['unspliced'])
Generated by STARsolo, Cell Ranger, or velocyto
Outputs

Analysis objects (for downstream skills):

adata_trajectory.h5ad — AnnData with pseudotime, PAGA, diffusion map embedded
Load with: adata = sc.read_h5ad('adata_trajectory.h5ad')
Required for: downstream enrichment, regulatory network analysis
trajectory_results.pkl — Full results dict (pseudotime, gene lists, model objects)
Load with: results = pickle.loads(Path('trajectory_results.pkl').read_bytes())

Primary results (CSV):

pseudotime_assignments.csv — Cell barcode, pseudotime, cell type
trajectory_genes.csv — Genes correlated with pseudotime (gene, correlation, FDR, direction)
velocity_genes.csv — Top RNA velocity genes (if scVelo ran)
fate_probabilities.csv — Cell fate probabilities (if CellRank ran)
driver_genes_*.csv — Driver genes per terminal fate (if CellRank ran)

Visualizations (PNG + SVG):

paga_graph.png/.svg — PAGA cluster connectivity + UMAP
pseudotime_umap.png/.svg — UMAP colored by pseudotime
pseudotime_violin.png/.svg — Pseudotime distribution per cell type
diffusion_components.png/.svg — Diffusion map components
gene_heatmap.png/.svg — Top trajectory genes heatmap
gene_trends.png/.svg — Gene expression trends along pseudotime
paga_connectivity.png/.svg — PAGA connectivity heatmap
velocity_stream.png/.svg — RNA velocity stream plot (if scVelo)
velocity_confidence.png/.svg — Velocity confidence (if scVelo)
latent_time.png/.svg — scVelo latent time (if dynamical model)
velocity_top_genes.png/.svg — Phase portraits for top velocity genes (if scVelo)
fate_probabilities.png/.svg — Cell fate UMAP (if CellRank)
fate_heatmap.png/.svg — Fate probability heatmap (if CellRank)
driver_genes.png/.svg — Top driver genes per terminal fate (if CellRank)

Reports:

trajectory_analysis_report.pdf — PDF report created with pdf-report-generation; packaged markdown/script output is a fallback if the dedicated reporting skill is unavailable
trajectory_analysis_report.md — Markdown fallback report
analysis_metadata.json — Parameters and quality metrics
Report Packaging

When the user requests a PDF report, run the analysis first, then load and use the Biomni pdf-report-generation skill for the final PDF deliverable. Build the PDF from this skill's markdown summary, result tables, and generated figures, and save it using the PDF filename listed in Outputs, or a stable descriptive filename when Outputs does not define one.

Keep this skill focused on scientific workflow and artifact content. Do not add custom figure appearance or report layout instructions here; those are handled by the platform prompt and dedicated reporting skills. If pdf-report-generation is unavailable, use the packaged markdown/HTML/script fallback when present and clearly disclose the fallback.

Clarification Questions

🚨 ALWAYS ask Question 1 FIRST. Do not ask about analysis parameters before the user has answered Question 1.

1. Input Files (ASK THIS FIRST)
Do you have a preprocessed scRNA-seq object (.h5ad)?
If uploaded: Is this your processed AnnData file?
Expected: .h5ad with PCA, UMAP, and cluster annotations
Or use example/demo data?
Pancreatic endocrinogenesis (3,696 cells, branching trajectory into alpha/beta/delta/epsilon cells)

🚨 IF EXAMPLE DATA SELECTED: All parameters are pre-defined. Only ask Question 2. Then proceed to Step 1.

2. Analysis Scope (structured — works for both demo and user data)
a) Core trajectory only — PAGA + pseudotime (~3 min)
b) Core + RNA velocity — adds scVelo streams (~5 min) (recommended)
c) Full analysis — adds CellRank fate mapping (~8 min)

Questions 3-5 are ONLY for users providing their own data:

3. Root Cell Type
Which cell type represents the starting point of the trajectory?
(For demo data: Ductal cells are the progenitors — pre-selected)
4. Cluster Key
Which column in .obs contains your cell type annotations?
Common: clusters, cell_type, leiden, louvain
5. Expected Trajectory Structure
a) Linear differentiation (one lineage)
b) Branching (multiple fates from one progenitor)
c) Not sure — let the data decide
Standard Workflow

🚨 MANDATORY: USE SCRIPTS EXACTLY AS SHOWN — DO NOT WRITE INLINE CODE 🚨

Step 1 — Load data:

from scripts.load_example_data import load_example_data
adata = load_example_data()

DO NOT write inline data loading code. Just use the script.

✅ VERIFICATION: You MUST see: "✓ Data loaded successfully!"

Step 2 — Run trajectory analysis:

from scripts.run_trajectory_analysis import run_trajectory
results = run_trajectory(adata, root_cell_type="Ductal", cluster_key="clusters")

DO NOT write inline trajectory code. Just use the script.

✅ VERIFICATION: You MUST see: "✓ Trajectory analysis completed successfully!"

Step 3 — Generate visualizations:

from scripts.generate_all_plots import generate_all_plots
generate_all_plots(adata, results, output_dir="trajectory_results", cluster_key="clusters")

🚨 DO NOT write inline plotting code. Just use the script. 🚨

✅ VERIFICATION: You MUST see: "✓ All plots generated successfully!"

Step 4 — Export results:

from scripts.export_results import export_all
export_all(adata, results, output_dir="trajectory_results")

DO NOT write custom export code. Use export_all().

✅ VERIFICATION: You MUST see: "=== Export Complete ==="

⚠️ CRITICAL — DO NOT:

❌ Write inline data loading code → STOP: Use load_example_data() or load_user_data()
❌ Write inline PAGA/DPT/scVelo code → STOP: Use run_trajectory()
❌ Write inline plotting code (plt.savefig, sc.pl, etc.) → STOP: Use generate_all_plots()
❌ Write custom export code → STOP: Use export_all()

⚠️ IF SCRIPTS FAIL — Script Failure Hierarchy:

Fix and Retry (90%) — Install missing package, re-run script
Modify Script (5%) — Edit the script file itself, document changes
Use as Reference (4%) — Read script, adapt approach, cite source
Write from Scratch (1%) — Only if genuinely impossible, explain why

NEVER skip directly to writing inline code without trying the script first.

Common Issues
Error    Cause    Solution
"Root cell type not found"    Cluster name mismatch    Check adata.obs['clusters'].unique() for exact names
"scvelo not installed"    Missing optional dependency    pip install scvelo — or skip velocity (core trajectory still works)
"cellrank not installed"    Missing optional dependency    pip install cellrank — or skip fate mapping
scVelo dynamical model fails    Insufficient spliced/unspliced counts    Script auto-falls back to stochastic model
SVG export failed    Missing system library    Normal — PNG still generated. Script handles fallback.
"Too few cells"    Dataset too small    Need ≥200 cells for meaningful trajectory
CellRank terminal states incorrect    Auto-detection picked wrong states    Check PAGA graph to verify expected terminal fates
Suggested Next Steps

Functional enrichment → Use functional-enrichment-from-degs skill

Input: trajectory_genes.csv (top up/down genes along pseudotime)
Find pathways driving differentiation

Gene regulatory networks → Use grn-pyscenic skill

Input: adata_trajectory.h5ad
Identify transcription factors controlling cell fate decisions

Upstream regulator analysis → Use upstream-regulator-analysis skill

Input: trajectory_genes.csv
Predict upstream regulators of trajectory dynamics

Differential expression at branch points → Use scrnaseq-scanpy-core-analysis (marker finding)

Compare cells at branch points to identify fate-determining genes
Related Skills

Upstream (data generation):

scrnaseq-scanpy-core-analysis — Preprocessing, clustering, UMAP → feeds .h5ad into this skill
scrnaseq-seurat-core-analysis — R alternative (convert with SeuratDisk)

Downstream (interpretation):

functional-enrichment-from-degs — Pathway analysis of trajectory genes
grn-pyscenic — Gene regulatory networks
upstream-regulator-analysis — Upstream regulators of trajectory genes

Alternative trajectory methods:

disease-progression-longitudinal — Bulk/multi-omics longitudinal trajectories (TimeAx)
References
Primary Citations

PAGA: Wolf FA, Hamey FK, Plass M, et al. PAGA: graph abstraction reconciles clustering with trajectory inference through a topology preserving map of single cells. Genome Biol. 2019;20:59.

Diffusion Pseudotime: Haghverdi L, Büttner M, Wolf FA, et al. Diffusion pseudotime robustly reconstructs lineage branching. Nat Methods. 2016;13:845-848.

scVelo: Bergen V, Lange M, Peidli S, et al. Generalizing RNA velocity to transient cell states through dynamical modeling. Nat Biotechnol. 2020;38:1408-1414.

CellRank: Lange M, Bergen V, Klein M, et al. CellRank for directed single-cell fate mapping. Nat Methods. 2022;19:159-170.

Example dataset: Bastidas-Ponce A, Tritschler S, Dony L, et al. Comprehensive single cell mRNA profiling reveals a detailed roadmap for pancreatic endocrinogenesis. Development. 2019;146:dev173849.

Software
Software    Version    License    Commercial Use
scanpy    ≥1.9    BSD-3    ✅ Permitted
scVelo    ≥0.2.5    BSD-3    ✅ Permitted
CellRank    ≥2.0    BSD-3    ✅ Permitted
seaborn    ≥0.11    BSD-3    ✅ Permitted
reportlab    ≥3.6    BSD    ✅ Permitted

82. scrnaseq-scanpy-core-analysis
Category: TRANSCRIPTOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

Single-Cell RNA-seq Core Analysis (Scanpy)

Complete workflow for single-cell RNA-seq analysis using Scanpy and the scverse ecosystem. Process raw data through quality control, normalization, clustering, and cell type annotation with analysis-ready visualizations.

When to Use This Skill
Analyze 10X Chromium data (CellRanger output, H5 files, raw/filtered matrices)
Process Drop-seq, Smart-seq2, or inDrop single-cell RNA-seq data
Integrate multi-batch data using scVI, scANVI, or Harmony
Annotate cell types manually or with automated reference-based methods
Compare conditions using pseudobulk differential expression (multi-sample data)

Don't use for: Bulk RNA-seq (use bulk-rnaseq-counts-to-de-deseq2), R-based scRNA-seq (use scrnaseq-seurat-core-analysis), Spatial transcriptomics (coming soon)

Installation
Package    Version    License    Commercial Use    Installation
scanpy    ≥1.9    BSD-3-Clause    Permitted    pip install scanpy
anndata    ≥0.8    BSD-3-Clause    Permitted    pip install anndata
numpy    ≥1.20    BSD-3-Clause    Permitted    pip install numpy
pandas    ≥1.3    BSD-3-Clause    Permitted    pip install pandas
matplotlib    ≥3.4    PSF    Permitted    pip install matplotlib
seaborn    ≥0.12    BSD-3-Clause    Permitted    pip install seaborn
adjustText    ≥0.8    MIT    Permitted    pip install adjustText
scrublet    ≥0.2.3    MIT    Permitted    pip install scrublet
scvi-tools    ≥1.0    BSD-3-Clause    Permitted    pip install scvi-tools
harmonypy    ≥0.0.9    GPL-3    Permitted    pip install harmonypy
celltypist    ≥1.0    MIT    Permitted    pip install celltypist
pydeseq2    ≥0.4    MIT    Permitted    pip install pydeseq2

Install all: pip install scanpy anndata numpy pandas matplotlib seaborn adjustText scrublet

Minimum versions: Python ≥3.8, scanpy ≥1.9, anndata ≥0.8

Inputs

Required:

Raw or filtered count matrix: CellRanger output (filtered_feature_bc_matrix/), H5 files (.h5), AnnData (.h5ad), or count matrices (CSV/TSV)

Optional: Sample metadata (CSV/TSV) with sample IDs, conditions, batches, donor IDs

Data requirements: Min 500 cells/sample (1000+ recommended), Human or Mouse, UMI-based or read counts. See references/qc_guidelines.md for tissue-specific thresholds.

Outputs

Analysis objects:

adata_processed.h5ad - Complete annotated AnnData object
Load with: import scanpy as sc; adata = sc.read_h5ad('adata_processed.h5ad')
Contains: raw counts, normalized data, QC metrics, clusters, cell types, UMAP/PCA
Note: adata.X contains log-normalized (not scaled) data. Scaled data is used internally for PCA but not stored in .X. This is correct for downstream analysis (DE, visualization).
Required for: trajectory inference, cell-cell communication, downstream analyses

Reports:

scrna_analysis_report.pdf - PDF report created with pdf-report-generation from the generated single-cell artifacts
analysis_summary.txt - Text summary of dataset, QC, clustering, integration (generated by export_anndata_results())

Tables: cell_metadata.csv, expression_matrix_counts.csv, expression_matrix_normalized.csv, pca_coordinates.csv, umap_coordinates.csv, cluster_markers_all.csv, {celltype}_deseq2_results.csv

Visualizations (PNG + SVG): QC violins, UMAP plots, marker heatmaps, dot plots, volcano/MA plots

Report Packaging

Generate a PDF report using pdf-report-generation unless otherwise specified, with the available scientific outputs, generated figures, and relevant references. The workflow is not complete until the report is generated.

Clarification Questions

Default settings (use unless user specifies otherwise):

Format: Filtered 10X CellRanger output | Species: Human | Tissue: PBMC
Normalization: Standard (target sum + log1p) | Clustering: Test 0.4, 0.6, 0.8, 1.0
1. Input Files (ASK THIS FIRST):
Do you have specific single-cell data file(s) to analyze?
Expected: CellRanger output, H5, H5AD, or count matrix
Or use example/demo data? (PBMC 3k dataset available)
2. Data format and species:
(If using your own data) What format? Filtered 10X (default), Raw 10X, H5, H5AD? Human or Mouse? Tissue type?
(If using example data) Defaults apply: filtered 10X, human, PBMC — skip to Q3
3. Batch structure:
a) Single sample (no integration needed)
b) Multiple batches (scVI recommended, Harmony for speed)
4. Analysis scope:
a) Standard: QC + normalize + cluster + annotate (recommended)
b) Standard + pseudobulk DE (requires ≥2 samples per condition)
c) Custom: specify which steps
5. Clustering granularity:
a) Coarse (0.3-0.5) — major cell types only
b) Standard (0.6-0.8) — recommended
c) Fine (1.0-1.5) — subtypes
d) Test multiple: 0.4, 0.6, 0.8, 1.0 (recommended)
Standard Workflow

🚨 MANDATORY: USE SCRIPTS EXACTLY AS SHOWN - DO NOT WRITE INLINE CODE 🚨

Detailed step-by-step code: references/workflow-details.md

CRITICAL - DO NOT:

Write inline analysis code → STOP: Use the script functions
Write custom export code → STOP: Use export_anndata_results()
Skip verification messages → STOP: Check for "✓" messages after each step

IF SCRIPTS FAIL - Script Failure Hierarchy:

Fix and Retry (90%) - Install missing package, re-run script
Modify Script (5%) - Edit the script file itself, document changes
Use as Reference (4%) - Read script, adapt approach, cite source
Write from Scratch (1%) - Only if genuinely impossible, explain why

NEVER skip directly to writing inline code without trying the script first.

Step 1 — Load and QC | scripts/setup_and_import.py, scripts/qc_metrics.py, scripts/filter_cells.py

# Load data (Option A: example, Option B: your data)
from load_example_data import load_example_data
adata = load_example_data("pbmc3k")

# QC metrics + adaptive filtering + doublet detection
from qc_metrics import calculate_qc_metrics, batch_mad_outlier_detection
from filter_cells import run_scrublet_detection, filter_by_mad_outliers
adata = calculate_qc_metrics(adata, species="human")
adata = batch_mad_outlier_detection(adata, batch_key="batch")  # creates 'outlier' column
adata = run_scrublet_detection(adata, batch_key="batch")
adata = filter_by_mad_outliers(adata, remove_doublets=True)

DO NOT write inline QC code. Doublet rate auto-scales per batch (~0.8% per 1,000 cells). Aim for >70% cell retention. For raw data, prepend ambient RNA correction: references/ambient_rna_correction.md

✅ VERIFICATION: "✓ Data loaded successfully!" → QC metrics added → filtering summary with retention %.

Step 2 — Normalize, reduce, integrate | scripts/normalize_data.py, scripts/scale_and_pca.py, scripts/integrate_scvi.py

from normalize_data import run_standard_normalization
from find_variable_genes import find_highly_variable_genes
from scale_and_pca import scale_data, run_pca_analysis
adata = run_standard_normalization(adata, target_sum=1e4)
adata = find_highly_variable_genes(adata, n_top_genes=2000)
adata = scale_data(adata, vars_to_regress=["total_counts", "pct_counts_mt"])
adata = run_pca_analysis(adata, n_pcs=50)

# Multi-batch only: integration + diagnostics
from integrate_scvi import run_scvi_integration
from integration_diagnostics import compute_lisi_scores
adata = run_scvi_integration(adata, batch_key="batch", condition_key="condition")
lisi = compute_lisi_scores(adata, batch_key="batch", use_rep="X_scVI")

DO NOT write inline normalization or integration code. The integration script auto-detects batch-condition confounding. Details →

✅ VERIFICATION:

Normalization: "✓ Normalization complete"
PCA: "PCA loadings verified: N HVG rows have non-zero loadings" — if you see a WARNING about zero loadings, re-run PCA with use_highly_variable=True
After PCA, call suggest_n_pcs(adata) to get recommended PC count for Step 3
Integration (multi-batch): LISI scores printed

Step 3 — Cluster, annotate, visualize | scripts/cluster_cells.py, scripts/find_markers.py, scripts/annotate_celltypes.py

from cluster_cells import build_neighbor_graph, cluster_leiden_multiple_resolutions
from run_umap import run_umap_reduction
from find_markers import find_all_cluster_markers
from plot_dimreduction import plot_umap_clusters
use_rep = "X_scVI" if "X_scVI" in adata.obsm else "X_pca"
# Default n_pcs=30 is standard. NEVER use <15 PCs.
adata = build_neighbor_graph(adata, use_rep=use_rep, n_neighbors=10, n_pcs=30)
adata = cluster_leiden_multiple_resolutions(adata, resolutions=[0.4, 0.6, 0.8, 1.0])
adata = run_umap_reduction(adata)
markers = find_all_cluster_markers(adata, cluster_key="leiden_0.8")
plot_umap_clusters(adata, cluster_key="leiden_0.8", output_dir="results/umap")

# Annotate (manual or CellTypist)
from annotate_celltypes import annotate_clusters_manual
annotations = {"0": "CD4 T cells", "1": "CD14+ Monocytes", ...}
adata = annotate_clusters_manual(adata, annotations, cluster_key="leiden_0.8")

DO NOT write inline clustering or annotation code. CellTypist validates labels post-hoc (flags suspect ILC/HSC, contamination, low-complexity). Markers →

⚠️ n_pcs for neighbor graph: Default is 30 PCs (standard). Using <15 PCs risks collapsing distinct populations. If you used suggest_n_pcs() in Step 2, pass that value here.

For pseudobulk DE (multi-sample, ≥2 replicates/condition): scripts/pseudobulk_de.py. Script blocks with N=1. Details →

✅ VERIFICATION:

Cluster counts → UMAP plots saved → marker genes identified → cell type annotations added
After find_all_cluster_markers(): verify the returned DataFrame columns and print markers.head() to confirm values are sensible before saving to CSV.

Step 4 — Export results | scripts/export_results.py

from export_results import export_anndata_results

export_anndata_results(adata, output_dir="results", cluster_key="cell_type")

DO NOT write custom export code. Use export_anndata_results().

Exports: H5AD, expression matrices (raw + normalized CSV), cell metadata, UMAP/PCA coordinates, text summary.

✅ VERIFICATION: You MUST see:

=== Export Complete ===

If you don't see "Export Complete": The export did not complete. Re-run the export function.

⚠️ Large datasets (>20k cells): H5AD export may take 10-60 seconds depending on dataset size. The script prints progress updates (size estimate, compression method, elapsed time). If export appears stuck for >2 minutes, interrupt and retry with save_h5ad(adata, path, compression=None) to skip compression.

Decision Guide
Decision    Quick Guide    Reference
Ambient RNA    Skip for filtered/PBMC. CellBender for raw/high-soup (brain, lung, tumor)    ambient_rna_correction.md
QC Strategy    MAD (multi-batch). Fixed (single batch, tissue-specific)    qc_guidelines.md
Normalization    Standard (most data). Pearson (heteroscedastic)    scanpy_best_practices.md
Integration    scVI (complex batches). Harmony (fast, simple)    integration_methods.md
Resolution    Test 0.4, 0.6, 0.8, 1.0. Choose by biology and stability    scanpy_best_practices.md
Annotation    Manual (accurate). CellTypist (fast). Both (validate)    marker_gene_database.md

Complete working examples: references/common-patterns.md

Common Issues
Issue    Cause    Solution
ImportError: No module named 'scanpy'    Not installed    pip install scanpy anndata numpy pandas matplotlib seaborn
Low cell retention (<70%)    Strict QC thresholds    Use MAD (nmads=5→7) or tissue-specific thresholds
Out of memory    Large dataset (>50k cells)    Use backed mode or subsample
Clusters driven by batch    Insufficient integration    Use scVI, increase n_latent, check confounding
Poor UMAP separation    Wrong parameters    Check PCA elbow, use 20-40 PCs, adjust n_neighbors
High MT% in all cells    Degradation or tissue-specific    Check distribution — bimodal: stricter filter; uniform: may be biological
FileNotFoundError: barcodes.tsv.gz    Wrong directory    Verify 10X output files present. Use import_h5_data() for .h5
H5AD export hangs or is very slow    Large file write with compression    Normal for >50 MB files. Script uses fast lzf compression. If still slow, pass compression=None to save_h5ad().
NameError after export interruption    Kernel restart lost variables    Re-run from Step 1 to restore adata. Export is idempotent — safe to re-run.

Expected warnings (not errors):

Warning    Meaning    Action
SVG export failed    Optional SVG dependency unavailable    Normal — PNG always generated. Both created in most environments.
Detected doublet rate differs from expected    Scrublet threshold or pre-filtering    Inspect adata.obs['doublet_score'].hist(). Adjust threshold if needed.
Pseudobulk DE blocked: N=1    Insufficient replicates    Need ≥2 per condition. Use cell-level Wilcoxon for exploratory only.
Batch-condition confounding    Condition has 1 sample    Clustering valid. Composition comparisons need caveats.
CellTypist labels suspect (ILC, HSC)    Automated misclassification    Cross-check markers. Relabel ILC→NK or HSC→Unassigned.
Multimodal data detected    RNA-only workflow on CITE-seq    Note in reports: "RNA modality only; ADT not analyzed."

Detailed troubleshooting: references/troubleshooting_guide.md

Suggested Next Steps
Functional Enrichment — functional-enrichment-from-degs for pathway analysis of DE results
Trajectory Analysis — PAGA, Palantir, or scVelo for developmental datasets
Cell-Cell Communication — CellPhoneDB, LIANA, or NicheNet for ligand-receptor interactions
Related Skills

Alternative: scrnaseq-seurat-core-analysis (R-based) | Downstream: functional-enrichment-from-degs, de-results-to-plots, de-results-to-gene-lists | Complementary: bulk-omics-clustering, experimental-design-statistics

References
Scanpy: Wolf FA, et al. (2018) Genome Biol. 19:15.
Best Practices: Luecken MD, Theis FJ. (2019) Mol Syst Biol. 15:e8746.
Pseudobulk DE: Squair JW, et al. (2021) Nat Commun. 12:5692.
scVI: Lopez R, et al. (2018) Nat Methods. 15:1053-1058.

Detailed guides: workflow-details.md | common-patterns.md | scanpy_best_practices.md | qc_guidelines.md | integration_methods.md | pseudobulk_de_guide.md | marker_gene_database.md | troubleshooting_guide.md

Scripts: scripts/ | Evaluation: assets/eval/complete_example_analysis.py

83. scrnaseq-seurat-core-analysis
Category: TRANSCRIPTOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

Single-Cell RNA-seq Core Analysis (Seurat)

Complete workflow for single-cell RNA-seq analysis using Seurat v5. Process raw data through quality control, normalization, clustering, and cell type annotation with publication-ready visualizations.

When to Use This Skill

Use this skill when you need to:

✅ Analyze 10X Chromium data (CellRanger output, H5 files, raw/filtered matrices)
✅ Process Drop-seq, Smart-seq2, or inDrop single-cell RNA-seq data
✅ Perform complete QC workflow with adaptive thresholds and doublet detection
✅ Integrate multi-batch data using Harmony or Seurat CCA/RPCA
✅ Discover cell populations via graph-based clustering with validation
✅ Annotate cell types manually or with automated reference-based methods
✅ Compare conditions using pseudobulk differential expression (multi-sample data)

Don't use this skill for:

❌ Bulk RNA-seq data → Use bulk-rnaseq-counts-to-de-deseq2
❌ Python-based scRNA-seq analysis → Use scrnaseq-scanpy-core-analysis
❌ Spatial transcriptomics → Use spatial-transcriptomics-seurat (coming soon)

Key Concept: Single-cell RNA-seq captures individual cell transcriptomes, revealing cell type heterogeneity, rare populations, and cell states invisible to bulk methods. This workflow implements Seurat v5 best practices for robust, reproducible analysis.

Installation
Required Software
Package    Version    License    Commercial Use    Installation
Seurat    ≥5.0    MIT    ✅ Permitted    install.packages("Seurat")
ggplot2    ≥3.4    MIT    ✅ Permitted    install.packages("ggplot2")
ggprism    ≥1.0.4    GPL-3    ✅ Permitted    install.packages("ggprism")
dplyr    ≥1.0    MIT    ✅ Permitted    install.packages("dplyr")
patchwork    ≥1.1    MIT    ✅ Permitted    install.packages("patchwork")
DoubletFinder    ≥2.0.3    CC0    ✅ Permitted    install.packages("DoubletFinder")
harmony    ≥0.1.0    GPL-3    ✅ Permitted    install.packages("harmony")
SoupX    ≥1.5    GPL-2    ✅ Permitted    install.packages("SoupX")
DESeq2    ≥1.36    LGPL    ✅ Permitted    BiocManager::install("DESeq2")
muscat    ≥1.10    GPL-3    ✅ Permitted    BiocManager::install("muscat")
SingleR    ≥2.0    GPL-3    ✅ Permitted    BiocManager::install("SingleR")
celldex    ≥1.8    GPL-3    ✅ Permitted    BiocManager::install("celldex")

License Compliance: All packages use permissive licenses (MIT, GPL, LGPL, CC0) that permit commercial use in AI agent applications. GPL allows commercial use and distribution.

Minimum versions: R ≥4.1, Seurat ≥5.0

Inputs

Required:

Raw or filtered count matrix from:
CellRanger output (filtered_feature_bc_matrix/ or raw_feature_bc_matrix/)
H5 files (.h5 from 10X)
Seurat objects (.rds)
Count matrices (genes × cells, CSV/TSV)
SeuratData packages (pbmc3k, ifnb)

Optional but recommended:

Sample metadata (CSV/TSV): Sample IDs, conditions, batches, donor IDs

Data requirements:

Minimum 500 cells per sample (1000+ recommended)
Human (GRCh38) or Mouse (GRCm39)
UMI-based (10X, Drop-seq) or read counts (Smart-seq2)

Tissue types: PBMC, brain, tumor, lung, liver, kidney, muscle, custom. See references/qc_guidelines.md for tissue-specific QC thresholds.

Outputs

Processed data:

seurat_processed.rds - Annotated Seurat object for downstream use
Load with: seurat_obj <- readRDS('seurat_processed.rds')
Note: The default assay data slot contains log-normalized (not scaled) data. Scaled data is used internally for PCA but stored separately. This is correct for downstream analysis (DE, visualization).
Required for: trajectory analysis, cell-cell communication, advanced visualizations
normalized_counts.csv - Normalized expression matrix
normalized_counts.rds - Normalized counts (sparse format, faster loading)
cell_metadata.csv - Cell annotations, clusters, QC metrics
umap_coordinates.csv - UMAP embeddings
pca_coordinates.csv - PCA embeddings

Visualizations (PNG + SVG at 300 DPI):

QC plots (violin, scatter, per-batch)
UMAP plots (clusters, batches, cell types, QC metrics)
Heatmaps of cluster markers
Dot plots for cell type markers
Volcano/MA plots for pseudobulk DE

Differential expression:

cluster_markers_all.csv - Marker genes per cluster (exploratory)
{celltype}_deseq2_results.csv - Pseudobulk DE per cell type (inferential)

Integration diagnostics (multi-batch):

LISI/ASW scores, before/after UMAPs
analysis_report.pdf — Comprehensive PDF report with Introduction, Methods, Results, Conclusions, and embedded figures; use pdf-report-generation unless otherwise specified
Clarification Questions

Default settings (use unless user specifies otherwise):

Format: Filtered 10X CellRanger output
Species: Human
Tissue: PBMC
Normalization: SCTransform
Clustering: Test resolutions 0.4, 0.6, 0.8, 1.0
Annotation: Manual

Questions to ask only if ambiguous:

1. Input Files (ASK THIS FIRST):
Do you have specific single-cell data file(s) to analyze?
If uploaded: Is this the scRNA-seq data you'd like to process?
Expected formats: 10X CellRanger output (filtered_feature_bc_matrix/), H5 files (.h5), Seurat objects (.rds), count matrices (CSV/TSV)
Or use example data? (pbmc3k from SeuratData package - see Quick Start below)
2. What format is your data?
Filtered 10X matrix (default, filtered_feature_bc_matrix/)
Raw 10X matrix (needs ambient RNA correction)
H5 file (.h5)
Seurat object (.rds)
SeuratData (dataset name)
3. Species and tissue type?
Human (default) or Mouse
Tissue: PBMC (default), brain, tumor, lung, liver, kidney, other
4. Multiple samples or batches?
Single sample (no integration)
Multiple batches (requires integration: Harmony recommended)
5. Which analyses?
Ambient RNA correction (raw data or high-soup tissues)
Doublet detection (recommended)
Batch integration (multi-batch: Harmony, CCA, or RPCA)
Cell type annotation (manual, SingleR, or both)
Pseudobulk DE (condition comparisons)
6. Clustering granularity?
Coarse (major types): 0.3-0.5
Standard (default): 0.6-0.8
Fine (subtypes): 1.0-1.5
Test multiple: 0.4, 0.6, 0.8, 1.0 (recommended)
Quick Start

Test the workflow with example data in ~15 minutes:

# Load example data
source("scripts/load_example_data.R")
seurat_obj <- load_seurat_data("pbmc3k")

# Load required core scripts
source("scripts/setup_and_import.R")
source("scripts/qc_metrics.R")
source("scripts/filter_cells.R")
source("scripts/normalize_data.R")
source("scripts/scale_and_pca.R")
source("scripts/cluster_cells.R")
source("scripts/run_umap.R")
source("scripts/find_markers.R")
source("scripts/plot_dimreduction.R")
source("scripts/annotate_celltypes.R")
source("scripts/export_results.R")

setup_seurat_libraries()

# QC and filter
seurat_obj <- calculate_qc_metrics(seurat_obj, species = "human") |>
  filter_cells_by_qc(min_features = 200, max_features = 2500, max_mt_percent = 5)

# Normalize and reduce dimensions
seurat_obj <- run_sctransform(seurat_obj, vars_to_regress = "percent.mt") |>
  run_pca_analysis(n_pcs = 30) |>
  run_umap_reduction(dims = 1:30)

# Cluster and find markers
seurat_obj <- cluster_multiple_resolutions(seurat_obj, dims = 1:30, resolutions = c(0.6, 0.8))
all_markers <- find_all_cluster_markers(seurat_obj, resolution = 0.8)

# Visualize
plot_umap_clusters(seurat_obj, output_dir = "results/umap")
plot_top_markers_heatmap(seurat_obj, all_markers, n_top = 10, output_dir = "results/markers")

# Export all results
export_all(seurat_obj, output_dir = "results")

Expected results: ~2,700 PBMC cells in 8-9 major cell types (T cells, B cells, monocytes, NK cells, dendritic cells)

For complete analysis with all QC steps: See assets/eval/complete_example_analysis.R

Standard Workflow

Complete scRNA-seq analysis in 10 steps using modular scripts. CRITICAL: Use relative paths (scripts/, references/). DO NOT construct absolute paths like /mnt/knowhow/

Detailed code examples and explanations: references/workflow-details.md

Phase 1: QC and Filtering (Steps 1-3)

Step 1: Ambient RNA Correction (Optional - Raw Data Only)

🚨 Execute these function calls directly - do not reimplement:

scripts/remove_ambient_rna.R

source("scripts/remove_ambient_rna.R")
seurat_obj <- run_soupx_correction(raw_matrix_dir, filtered_matrix_dir)

✅ VERIFICATION: You should see: "✓ SoupX correction completed successfully!"

When to use: Raw matrices or high-soup tissues (brain, lung, tumor). See references/ambient_rna_correction.md

⚠️ DO NOT write inline SoupX correction code → causes parameter mismatches and inconsistent results

Step 2: Load Data and Calculate QC

🚨 Execute these function calls directly - do not reimplement:

scripts/setup_and_import.R, scripts/qc_metrics.R

source("scripts/setup_and_import.R")
source("scripts/qc_metrics.R")
seurat_obj <- import_10x_data("filtered_feature_bc_matrix/")
seurat_obj <- calculate_qc_metrics(seurat_obj, species = "human")
seurat_obj <- batch_mad_outlier_detection(seurat_obj, batch_col = "batch", nmads = 5)

✅ VERIFICATION: You should see: "✓ QC metrics calculated successfully" and "✓ MAD outlier detection completed"

QC Metrics calculated: nFeature_RNA (genes/cell), nCount_RNA (UMIs/cell), percent.mt (mitochondrial %)

Decision: MAD (adapts to batches) or fixed tissue thresholds. See references/qc_guidelines.md

⚠️ DO NOT write inline QC calculation code → missing mitochondrial gene patterns, incorrect species handling

Step 3: Doublet Detection and Filtering

🚨 Execute these function calls directly - do not reimplement:

scripts/filter_cells.R

source("scripts/filter_cells.R")
seurat_obj <- run_doubletfinder(seurat_obj, batch_col = "batch")
seurat_obj <- filter_by_mad_outliers(seurat_obj, remove_doublets = TRUE)

✅ VERIFICATION: You should see: "✓ DoubletFinder completed successfully" and "✓ Cell filtering completed successfully"

QC checkpoint: Aim for >70% cell retention

⚠️ DO NOT write inline doublet detection code → DoubletFinder has complex parameterization that requires batch-aware setup

Phase 2: Normalization and Dimensionality Reduction (Steps 4-5)

Step 4: Normalize and Select Features

🚨 Execute these function calls directly - choose ONE normalization method:

scripts/normalize_data.R

source("scripts/normalize_data.R")

# SCTransform (recommended for UMI data)
seurat_obj <- run_sctransform(seurat_obj, vars_to_regress = "percent.mt")

# Alternative: LogNormalize (faster, classic workflow)
seurat_obj <- run_lognormalize(seurat_obj)

✅ VERIFICATION: You should see: "✓ SCTransform normalization completed" or "✓ LogNormalize completed"

Decision: SCTransform (UMI, batch effects) or LogNormalize (speed, non-UMI). See references/seurat_best_practices.md

⚠️ DO NOT write inline normalization code → SCTransform has complex variance stabilization; LogNormalize requires proper scaling

Step 5: PCA and Determine Dimensionality

🚨 Execute these function calls directly:

scripts/scale_and_pca.R

source("scripts/scale_and_pca.R")
seurat_obj <- run_pca_analysis(seurat_obj, n_pcs = 50)
plot_elbow(seurat_obj, output_dir = "results/pca")

✅ VERIFICATION:

"PCA loadings verified: N variable features used" — if you see a WARNING about feature count mismatch, check feature selection
Cumulative variance printed for PC1-10, PC1-20, PC1-30
After PCA, call suggest_n_pcs(seurat_obj) to get recommended PC count for Step 7

Decision: Look for "elbow" in scree plot. Standard: 20-30 PCs. NEVER use <15 PCs. Use suggest_n_pcs() for data-driven recommendation.

⚠️ DO NOT write inline PCA code → missing proper feature selection and scaling steps

Phase 3: Integration (Step 6 - Multi-Batch Only)

Step 6: Batch Integration

🚨 Execute these function calls directly - skip if single-batch data:

scripts/integrate_batches.R, scripts/integration_diagnostics.R

source("scripts/integrate_batches.R")
source("scripts/integration_diagnostics.R")

# Harmony (fast, recommended)
seurat_obj <- run_harmony_integration(seurat_obj, batch_var = "batch", dims_use = 1:30)

# Validate integration
lisi_scores <- compute_lisi_scores(seurat_obj, batch_var = "batch", reduction = "harmony")

✅ VERIFICATION: You should see: "✓ Harmony integration completed successfully" and LISI score summary

Success criteria: Batch LISI ≈1 (good mixing), cell type LISI preserved. See references/integration_methods.md

⚠️ DO NOT write inline Harmony/CCA integration code → complex parameter tuning and batch handling required

Phase 4: Clustering and Visualization (Steps 7-8)

Step 7: Clustering and UMAP

🚨 Execute these function calls directly:

scripts/cluster_cells.R, scripts/run_umap.R

source("scripts/cluster_cells.R")
source("scripts/run_umap.R")

reduction <- if ("harmony" %in% names(seurat_obj@reductions)) "harmony" else "pca"
# Default dims=1:30 is standard. NEVER use <15 PCs.
seurat_obj <- cluster_multiple_resolutions(seurat_obj, dims = 1:30, reduction = reduction, resolutions = c(0.4, 0.6, 0.8, 1.0))
seurat_obj <- run_umap_reduction(seurat_obj, dims = 1:30, reduction = reduction)

⚠️ dims for clustering: Default is 1:30 (standard). Using <15 PCs risks collapsing distinct populations. If you used suggest_n_pcs() in Step 5, pass 1:suggested_pcs here.

✅ VERIFICATION: You should see: "✓ Clustering completed at X resolutions" and "✓ UMAP completed successfully"

⚠️ DO NOT write inline clustering code → graph construction and Louvain algorithm have many hyperparameters

Step 8: Find Markers and Visualize

🚨 Execute these function calls directly:

scripts/find_markers.R, scripts/plot_dimreduction.R

source("scripts/find_markers.R")
source("scripts/plot_dimreduction.R")

all_markers <- find_all_cluster_markers(seurat_obj, resolution = 0.8)
plot_umap_clusters(seurat_obj, output_dir = "results/umap")
plot_top_markers_heatmap(seurat_obj, all_markers, n_top = 10)

✅ VERIFICATION:

"✓ Found markers for X clusters" and plots saved in results/umap/
After find_all_cluster_markers(): verify the returned DataFrame and print head(all_markers) to confirm values are sensible before saving to CSV.

Important: Exploratory DE for characterizing clusters. For condition comparisons, use pseudobulk (Step 10).

⚠️ DO NOT write inline marker finding or plotting code (ggsave, ggplot, DimPlot, FeaturePlot, etc.) → publication-quality plots require ggprism/ggrepel; marker tests need proper multiple testing correction. Scripts handle PNG + SVG export with graceful fallback.

Phase 5: Annotation and Differential Expression (Steps 9-10)

Step 9: Annotate Cell Types

scripts/annotate_celltypes.R

For manual annotation (recommended):

source("scripts/annotate_celltypes.R")

# Define annotations based on marker genes
annotations <- c("0" = "CD4 T cells", "1" = "CD14+ Monocytes", ...)
seurat_obj <- annotate_clusters_manual(seurat_obj, annotations, resolution = 0.8)

For automated annotation:

seurat_obj <- annotate_with_singler(seurat_obj, reference = "HPCA")

✅ VERIFICATION: You should see: "✓ Cell type annotation completed" and updated metadata

Decision: Manual (accurate) vs Automated (fast). See references/marker_gene_database.md

Step 10: Pseudobulk DE (Multi-Sample Only)

🚨 Execute these function calls directly:

scripts/pseudobulk_de.R

source("scripts/pseudobulk_de.R")

pseudobulk_data <- aggregate_to_pseudobulk(seurat_obj, sample_col = "sample_id", celltype_col = "cell_type")
de_results <- run_pseudobulk_deseq2(pseudobulk_data, formula = "~ batch + condition", contrast = c("condition", "treated", "control"))

✅ VERIFICATION: You should see: "✓ Pseudobulk aggregation completed" and "✓ DESeq2 analysis completed"

Critical: Exploratory (Step 8, Wilcoxon on cells) vs Inferential (Step 10, DESeq2 on pseudobulk). See references/pseudobulk_de_guide.md

⚠️ DO NOT write inline pseudobulk aggregation or DESeq2 code → requires proper sample-level aggregation and statistical modeling

Phase 6: Export Results (Step 11)

Step 11: Export All Results

🚨 MANDATORY: USE export_all() - DO NOT WRITE CUSTOM EXPORT CODE 🚨

scripts/export_results.R

source("scripts/export_results.R")
export_all(seurat_obj, output_dir = "results", all_markers = all_markers)

DO NOT write custom export code. Use export_all().

✅ VERIFICATION: You MUST see: "=== Export Complete ==="

What gets exported:

Seurat object (RDS) for downstream analysis
Normalized counts (CSV + RDS)
Cell metadata with clusters and annotations
UMAP/PCA coordinates
Marker gene tables (if all_markers provided)
Summary statistics

⚠️ DO NOT write inline export code → missing RDS objects breaks downstream skills

That's it! The scripts handle all complex operations automatically.

What the scripts provide:

scripts/setup_and_import.R - Data import functions for 10X, H5, and matrix formats
scripts/qc_metrics.R - Comprehensive QC with species-aware mitochondrial detection
scripts/filter_cells.R - DoubletFinder integration and MAD-based filtering
scripts/normalize_data.R - SCTransform and LogNormalize workflows
scripts/integrate_batches.R - Harmony, CCA, RPCA integration methods
scripts/plot_dimreduction.R - Publication-quality plots with automatic SVG fallback handling
scripts/pseudobulk_de.R - Proper pseudobulk aggregation and DESeq2 analysis

⚠️ CRITICAL ENFORCEMENT RULES:

DO NOT:

❌ Write inline plotting code (ggsave, DimPlot, FeaturePlot, etc.) → Use plotting scripts
❌ Write inline analysis code → Use provided workflow scripts
❌ Try to install svglite → scripts handle SVG fallback automatically

⚠️ IF SCRIPTS FAIL - Script Failure Hierarchy:

Fix and Retry (90%) - Install missing package, re-run script
Modify Script (5%) - Edit the script file itself, document changes
Use as Reference (4%) - Read script, adapt approach, cite source
Write from Scratch (1%) - Only if genuinely impossible, explain why

NEVER skip directly to writing inline code without trying the script first.

Decision Guide

Make six critical decisions during analysis:

Decision    Options    Quick Guide    Detailed Reference
Ambient RNA    Skip / SoupX    Skip for filtered/PBMC. Use for raw/high-soup tissues (brain, lung, tumor)    ambient_rna_correction.md
QC Strategy    MAD / Fixed    MAD (multi-batch, adapts). Fixed (single batch, tissue-specific)    qc_guidelines.md
Normalization    SCTransform / LogNormalize    SCTransform (UMI, batch effects). LogNormalize (speed, non-UMI)    seurat_best_practices.md
Integration    Harmony / CCA / RPCA    Harmony (fast, simple). CCA (complex batches). RPCA (>100k cells)    integration_methods.md
Resolution    0.4-1.5    Test multiple (0.4, 0.6, 0.8, 1.0). Choose by biology and stability    seurat_best_practices.md#clustering
Annotation    Manual / SingleR / Both    Manual (accurate, needs expertise). SingleR (fast, may misclassify). Both (validate)    marker_gene_database.md

Comprehensive decision guidance: references/decision-guide.md

Common Issues
Issue    Cause    Solution
"Cannot find package 'Seurat'"    Package not installed    install.packages("Seurat") or check R version ≥4.1
Low cell retention (<50%)    Too strict QC thresholds    Use MAD-based filtering instead of fixed thresholds. Review tissue-specific QC guidelines: references/qc_guidelines.md
"No harmony reduction found"    Trying to cluster on harmony before integration    Skip integration step for single-batch data, or run run_harmony_integration() before clustering
Clusters don't separate on UMAP    Wrong reduction used or insufficient PCs    Verify using correct reduction (harmony for integrated, pca for single-batch). Increase dims to 30-40 PCs
Memory error during SCTransform    Dataset too large (>50k cells)    Use run_lognormalize() instead, or process in batches
All cells marked as doublets    DoubletFinder parameters incorrect    Check expected doublet rate (typically 0.075 per 1000 cells). Use batch-aware processing
"Cannot find mitochondrial genes"    Wrong species or gene format    Specify correct species in calculate_qc_metrics(). Check if genes use gene symbols (MT-) or Ensembl IDs

Detailed troubleshooting: references/troubleshooting_guide.md

Common Patterns
Pattern 1: Standard 10X PBMC Analysis
# QC and filter
seurat_obj <- import_10x_data("filtered_feature_bc_matrix/") |>
  calculate_qc_metrics(species = "human") |>
  run_doubletfinder() |>
  filter_by_mad_outliers(remove_doublets = TRUE)

# Normalize and cluster
seurat_obj <- seurat_obj |>
  run_sctransform(vars_to_regress = "percent.mt") |>
  run_pca_analysis(n_pcs = 50) |>
  cluster_multiple_resolutions(dims = 1:30, resolutions = c(0.4, 0.6, 0.8)) |>
  run_umap_reduction(dims = 1:30)

# Annotate
all_markers <- find_all_cluster_markers(seurat_obj, resolution = 0.8)
seurat_obj <- annotate_clusters_manual(seurat_obj, annotations)
Pattern 2: Multi-Batch Integration
# After QC/filtering and normalization
seurat_obj <- seurat_obj |>
  run_pca_analysis(n_pcs = 50) |>
  run_harmony_integration(batch_var = "batch", dims_use = 1:30)

lisi_scores <- compute_lisi_scores(seurat_obj, batch_var = "batch", reduction = "harmony")

# Cluster on integrated space
seurat_obj <- seurat_obj |>
  cluster_multiple_resolutions(dims = 1:30, reduction = "harmony") |>
  run_umap_reduction(dims = 1:30, reduction = "harmony")
Pattern 3: Condition Comparison with Pseudobulk
# After clustering and annotation
pseudobulk_data <- aggregate_to_pseudobulk(seurat_obj, sample_col = "sample_id", celltype_col = "cell_type")
de_results <- run_pseudobulk_deseq2(pseudobulk_data, formula = "~ donor + condition", contrast = c("condition", "disease", "healthy"))

Additional patterns and complete code examples: references/common-patterns.md

Suggested Next Steps

After completing core scRNA-seq analysis:

Functional Enrichment - Use functional-enrichment-from-degs to test pseudobulk DE results for enriched pathways and interpret biological differences
Trajectory Analysis - Monocle3, Slingshot, or RNA velocity for developmental/differentiation datasets
Cell-Cell Communication - CellChat, CellPhoneDB, or NicheNet for ligand-receptor interactions
Advanced Visualization - Alluvial diagrams, proportional bar plots, gene regulatory networks
Related Skills

Alternative single-cell: scrnaseq-scanpy-core-analysis (Python-based)

Downstream: functional-enrichment-from-degs, de-results-to-plots, de-results-to-gene-lists

Complementary: bulk-omics-clustering (non-scRNA-seq), experimental-design-statistics (plan experiments)

References
Primary Citations
Seurat v5: Hao Y, et al. (2024) Dictionary learning for integrative, multimodal and scalable single-cell analysis. Nat Biotechnol. 42:293-304.
SCTransform: Hafemeister C, Satija R. (2019) Normalization and variance stabilization of single-cell RNA-seq data. Genome Biol. 20:296.
Pseudobulk DE: Squair JW, et al. (2021) Confronting false discoveries in single-cell differential expression. Nat Commun. 12:5692.
Harmony: Korsunsky I, et al. (2019) Fast, sensitive and accurate integration of single-cell data. Nat Methods. 16:1289-1296.
Detailed Documentation

Reference guides:

references/decision-guide.md - Comprehensive decision guidance for all workflow choices
references/workflow-details.md - Detailed code examples for all workflow steps
references/common-patterns.md - Complete code patterns and use cases
references/seurat_best_practices.md - Comprehensive best practices
references/qc_guidelines.md - Tissue-specific QC thresholds
references/integration_methods.md - Batch integration comparison
references/pseudobulk_de_guide.md - Pseudobulk methodology
references/ambient_rna_correction.md - SoupX guidance
references/marker_gene_database.md - Cell type markers
references/troubleshooting_guide.md - Common issues

Scripts: See scripts/ for all modular R functions

Evaluation: assets/eval/complete_example_analysis.R - Full PBMC 3k example

Online resources:

Official Seurat tutorials: https://satijalab.org/seurat/articles/
Seurat GitHub: https://github.com/satijalab/seurat

84. sgrna-design
Category: MOLECULAR DESIGN
Source: https://biomni.phylo.bio/skills?section=marketplace

sgRNA Design: Three-Tiered Approach

Find or design sgRNAs by prioritizing validated sequences before computational predictions. Always start at Option 1 and only descend to the next tier when the current one yields nothing usable. Ported from the Biomni sgRNA_design_guide.md (snap-stanford/Biomni), with the data parsing corrected and the literature step wired to this environment's search tools.

When to use
"Give me an sgRNA to knock out TP53 in human cells"
"Design CRISPR guides to activate OCT4" / "CRISPRi guides for MYC"
"What guide RNA should I use for <gene> with SpCas9 / SaCas9 / Cas12a?"
Selecting guides for an arrayed or pooled CRISPR screen
Inputs
Gene symbol (required), e.g. TP53, BRCA1, AAVS1.
Organism (default human), e.g. human/mouse/rat or NCBI TAXID.
Application (default knockout): knockout / activation (CRISPRa) / inhibition (CRISPRi).
Cas enzyme (default SpCas9): SpCas9, SaCas9, AsCas12a, enAsCas12a.
Outputs
<GENE>_selected_sgRNAs.csv — unified table of 3–4 recommended guides (sequence, source, rank/score, exon/position, PAM, citation/dataset, notes).
<GENE>_sgRNA_summary.md — which tier was used and why, the picks, and caveats.

Save both to the user's results directory. Generate a PDF report using pdf-report-generation unless otherwise specified, with the selected guides, methods, results, caveats, figures, and relevant references. The workflow is not complete until the report is generated.

Bundled resources (work offline; refresh via references/refresh_resources.md)
references/resource/addgene_grna_sequences.csv — 321 validated sgRNAs, 197 genes (Addgene).
references/resource/CRISPick_download_links.txt — 238 CRISPick dataset URLs, 13 organisms.
Scripts
Script    Purpose
scripts/search_addgene.py    Tier 1 / Method 1 — search the Addgene database (handles the HTML-wrapped IDs and messy species values).
scripts/find_crispick_dataset.py    Tier 2 / Step 1 — resolve the correct CRISPick download URL for organism+enzyme+application.
scripts/select_crispick_sgrnas.py    Tier 2 / Step 3 — filter a downloaded CRISPick file to your gene, rank, pick 3–4.
scripts/check_design_rules.py    Tier 3 — sanity-check a candidate guide (length, GC, TTTT, PAM).
scripts/export_results.py    Write the unified CSV + markdown summary.
Option 1 — Validated sequences (ALWAYS try first)

You MUST complete both Method 1 and Method 2 before considering Option 2. Do not skip Method 2 even if Method 1 finds nothing — many validated guides live only in the literature.

Method 1 — Bundled Addgene database
import sys; sys.path.insert(0, "scripts")
from search_addgene import search_addgene

hits = search_addgene("TP53", species="human", application="knockout")
print(len(hits))   # 0 for TP53 -> still do Method 2 before Option 2

Each hit carries a clean Target Sequence, pubmed_id/pubmed_url, plasmid_id/plasmid_url, and Depositor. Cite the PubMed ID of the original publication in your methods.

Material Transfer Agreement (needs_commercial_review). The bundled CSV contains only public sequence metadata (20-nt genomic guides, target genes, plasmid IDs) — not the physical plasmids. Obtaining and using actual Addgene plasmids requires a Material Transfer Agreement: a UBMTA for academic/non-commercial use, or an Industry MTA for commercial use. Depositor-specific terms may apply. See https://www.addgene.org/agreement/1/ (UBMTA) and https://www.addgene.org/agreement/5/ (Industry MTA). When reporting commercial-use status for plasmid acquisition, label it needs_commercial_review pending the applicable MTA.

application accepts intent words and maps them to Addgene's vocabulary: knockout→cut, activation→activate, inhibition/CRISPRi→interfere/RNA targeting.

Method 2 — Literature & web search (REQUIRED)

This environment does not expose advanced_web_search_claude; use the available tools instead. Run both for coverage:

LiteratureSearch — peer-reviewed papers (validated guides, supplements).
WebSearch — vendor/database hits (GenScript, Horizon, lab protocols).

Query templates (substitute the gene):

"sgRNA" OR "guide RNA" "<GENE>" validated experimental
"CRISPR knockout" "<GENE>" sgRNA sequence validated
"<GENE>" sgRNA "cutting efficiency" OR "on-target"

Scan ≥10–15 results and check supplementary materials. For any validated guide, record the sequence, citation (PMID/DOI), and validation details (cell line, cutting efficiency).

Decision: if either method yields usable validated guides, select 3–4 and export. Only if both come up empty, go to Option 2.

Option 2 — CRISPick precomputed designs

Use when no validated guides exist, you need genome-wide coverage, or you want ranked options.

Commercial-use restriction (needs_commercial_review). CRISPick and the Broad GPP Web Portal are provided for research purposes only. The GPP Terms of Service (effective 2025-12-08) state that "Commercial use (or other use for profit-making purposes) of the GPP Web Portal and its tools, is not permitted under these terms and may require a separate license agreement from Broad or its contributors." Commercial use therefore requires a separate license from the Broad Institute (partnering@broadinstitute.org). The 20-nt guide sequences themselves are genomic sequences not subject to IP, but the precomputed scoring/ranking data and the CRISPick tool are governed by these terms. See https://portals.broadinstitute.org/gpp/public/terms_and_conditions. When reporting commercial-use status, label CRISPick as prohibited (or needs_commercial_review) — never no_prohibition_found or allowed.

Step 1 — Resolve the dataset URL
from find_crispick_dataset import find_crispick_dataset
info = find_crispick_dataset("human", cas="SpCas9", application="knockout")
print(info["matches"])   # GRCh38 + GRCh37 dataset URLs
print(info["warning"])   # Cas12a variant warning, if applicable

AsCas12a vs enAsCas12a are different enzymes. Guides for one may not work with the other. The finder matches the exact enzyme token so datasets never cross-contaminate.

Step 2 — Download & extract (files are 50–700 MB; not bundled)
wget '<URL from Step 1>'
gunzip sgRNA_design_*.txt.gz
Step 3 — Filter, rank, select
from select_crispick_sgrnas import select_crispick_sgrnas
picks = select_crispick_sgrnas("sgRNA_design_..._CRISPRko_....txt", "TP53", n=4)

Ranks by Combined Rank (lower = better) by default; rank_by="on_target" or "off_target" to prioritize efficiency or specificity. Spreads picks across distinct exons for redundancy. Optional filters: exon=, cut_position_range=, max_target_cut_pct= (knockout). Column names are resolved defensively (handles both real CRISPick and abbreviated layouts); see references/crispick_file_format.md. If the gene is absent → Option 3.

Option 3 — De-novo design (last resort)

For genes/organisms not covered above. Follow references/design_rules.md:

Length: 20 bp (SpCas9/SaCas9), 23–25 bp (Cas12a). PAM: SpCas9 NGG, SaCas9 NNGRRT, Cas12a TTTV (5').
GC 40–60%; avoid TTTT and homopolymer runs >4 nt.
KO → early exons (first ~50%); CRISPRa → −200 to +1 of TSS; CRISPRi → −50 to +300 of TSS.
from check_design_rules import check_design_rules, format_report
print(format_report(check_design_rules("GAGGTTGTGAGGCGCTGCCC", "SpCas9", pam="AGG")))

This checks rules only — for real off-target assessment use Cas-OFFinder/CRISPOR or CRISPick ranks.

Export (all tiers)
from export_results import from_addgene, from_crispick, export
unified = from_addgene(hits, application="knockout", enzyme="SpCas9")  # or from_crispick(...)
export(unified, gene="TP53", tier="Option 1 (validated Addgene)",
       outdir="/path/to/results", rationale="Validated guides found via Method 1.")
Universal best practice

Test 3–4 sgRNAs per gene experimentally regardless of predicted scores, and validate edits (Sanger sequencing; TIDE/T7E1 for indels). Prediction scores guide selection but do not replace empirical validation.

Citations & acknowledgments (preserve in user methods)
Validated guides (Option 1): Addgene (https://www.addgene.org). Cite the PubMed ID of each guide's original publication. Acknowledge: "Validated sgRNA sequences obtained from Addgene."
Commercial-use note: Addgene plasmids are distributed under a Material Transfer Agreement (UBMTA for academic/non-commercial use; Industry MTA for commercial use). Depositor-specific terms may apply. The bundled snapshot contains only public sequence metadata. See https://www.addgene.org/agreement/1/ and https://www.addgene.org/agreement/5/.
CRISPick (Option 2): "Guide designs provided by the CRISPick web tool of the GPP at the Broad Institute."
Commercial-use note: CRISPick and the Broad GPP Web Portal are provided for research purposes only. Commercial use is not permitted under the GPP Terms of Service and may require a separate license from the Broad Institute (partnering@broadinstitute.org). See https://portals.broadinstitute.org/gpp/public/terms_and_conditions.
Cas9 (SpCas9, SaCas9): Sanson KR, et al. Nat Commun. 2018;9(1):5416. PMID: 30575746.
Cas12a (AsCas12a, enAsCas12a): DeWeirdt PC, et al. Nat Biotechnol. 2021;39(1):94–104. PMID: 32661438. (Specify which Cas12a variant you used.)
Scientific caveats
Bundled Addgene/CRISPick files are a fixed snapshot (197 genes / 238 datasets); literature search (Method 2) is mandatory precisely because the snapshot is incomplete.
Genome build matters: human defaults GRCh38 (GRCh37 also available), mouse GRCm38 — match coordinates to your reference.
The skill does not perform genome-wide off-target alignment beyond CRISPick's precomputed ranks.

85. signature-response-enrichment
Category: TRANSCRIPTOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

signature-response-enrichment

What this skill does

Answers one recurring question: does residual activity of a gene signature, on treatment, mark patients who fail a drug? It generalizes a psoriasis/TYK2/adalimumab replication into a drug-, disease-, and signature-agnostic workflow.

The logic: score each sample for the signature(s) with GSVA, track change from baseline over on-treatment timepoints, and test whether non-responders (NR) retain higher signature activity than responders (R) at the treatment endpoint — then ask whether that direction reproduces across independently discovered cohorts.

Inputs (user contract)

Required:

drug — e.g. adalimumab. Drives discovery queries and cohort/arm filtering. gene_signatures — one or more named gene sets. Accept: inline symbol lists, a GMT file, or MSigDB set IDs. Ambiguous tokens must be resolved and documented (worked example: IFNA -> IFNA1+IFNA2, IL18R -> IL18R1). disease — e.g. psoriasis. Scopes discovery, tissue, and severity-metric expectations.

Optional (documented defaults):

response_threshold = 0.75 (75% improvement from baseline) response_threshold_sensitivity = 0.90 — a stricter threshold re-run reported alongside the primary (set to none to skip). Run and report this by default. response_metric = auto-detect the cohort's continuous severity field (PASI, SLEDAI, DAS28, tumor burden, ...); fall back to a categorical responder/non-responder label tissue = target tissue (e.g. lesional skin) context_panel = MSigDB Hallmark (50 sets) + keyword-filtered Reactome immune sets focused_panel = a curated, disease/pathway-relevant subset of the signatures + context sets (worked example: 2 TYK2 signatures + ~15 immune modules). Reported per-module in the results, not just used for interpretation. Defaults to the signatures plus the most disease-relevant context sets when not supplied. pharmacodynamic_cohorts = all — analyze every qualifying paired-pre/post or drug-arm comparator cohort as a pharmacodynamic control, not just one. (first to keep the legacy single-cohort behavior.) pd_comparator_timepoint = ask — for a pharmacodynamic comparator arm with more than one on-treatment timepoint, which timepoint to use for the pre/post contrast (see Stage 5.6). ask = prompt the user (recommending the latest timepoint with adequate n); latest_adequate_n = auto-pick the latest timepoint meeting the n floor (non-interactive fallback); match_paired_window = align to the paired PD cohort's sampling window for cross-cohort comparability; or an explicit timepoint label. min_set_size = 3, fdr_alpha = 0.05 fisher_shared_parent = ask — how to headline the cross-cohort Fisher combination when two or more input cohorts share a parent study (see Stage 5.2). ask = pause and ask the user; independent = independence-aware headline (rigorous default if non-interactive); all = combine all splits as the headline (pseudo-replicated — discouraged). Regardless of choice, both the independent-only and all-splits values are always reported. primary_cohort / validation_cohort overrides

Scope & assumptions

Bulk transcriptomics (RNA-seq or microarray) with longitudinal baseline + on-treatment sampling. Single-cell / spatial are out of scope for v1. Discovery uses public repositories (GEO via NCBI eutils + ArrayExpress/BioStudies) through their standard APIs; the agent curates the candidate list (this is not fully autonomous dataset selection). Helper scripts under scripts/ are starting-point implementations you adapt to each dataset's real (often messy) metadata. This file (SKILL.md) is the authoritative procedure. Never fabricate data or citations. Every external fact (PMID/DOI/accession) must be confirmed against the primary source before it enters a report.

Validation status (honest disclosure)

The helper scripts have been syntax/parse-checked (R parse(), Python --help) and the statistical parameters were verified against the worked-example run, but the packaged scripts have not been executed end-to-end on real data as an integrated pipeline — the worked example was produced by the original bespoke analysis, then generalized into these helpers. Treat the first run on any new dataset as a shakedown: expect to adapt each script to that cohort's real (messy) metadata, and confirm at runtime that the Bioconductor stack resolves (GSVA 1.50.5, limma, GSEABase, edgeR) and that each stage's outputs are sane before trusting the report. The Stage 7 verify-before-trust gate is what catches integration problems — do not skip it.

Environment note (read before running)

GSVA on Bioconductor >= 3.19 pulls SpatialExperiment -> magick, which needs the libmagick system library that is frequently unavailable. Pin GSVA 1.50.5 (Bioconductor 3.18) — it keeps the classic gsva() / gsvaParam() API used here and has no SpatialExperiment dependency. scripts/run_gsva.R documents the source install.

Version enforcement (do not skip). The GSVA version materially changes absolute scores and therefore borderline p-values (in the worked example, the pivotal cross-platform cohort's one-sided p moved from ~0.04 under 1.50.5 to ~0.095 under 2.0.0 — enough to flip a headline across 0.05). Stage 0 must hard-fail if the resolved version is not 1.50.5; never silently proceed on a fallback version. If 1.50.5 cannot be installed, stop and surface the problem rather than running on another version.

Compute sizing: discovery + per-cohort GSVA / limma / CAMERA on bulk expression is light (minutes, < 8 GB RAM) and runs on the default worker-0. Escalate with ManageMachine only when many or very large RNA-seq count matrices must be processed at once.

Procedure (8 stages)

Track progress with TodoWrite. Run the verify-before-trust gate (Stage 7) before declaring done.

Stage 0 — Inputs & environment

Parse drug, disease, gene_signatures (+ optional params). Echo them back. Confirm/install GSVA 1.50.5 (see scripts/run_gsva.R). Assert the version: fail loudly and stop if packageVersion("GSVA") != "1.50.5" — do not proceed on any other version (see Environment note). Confirm limma, GSEABase, edgeR. Create the output tree under /mnt/results/<run>/: data/, figures/, tables/, and the report path.

Stage 1 — Automated discovery

Run scripts/discover_datasets.py --drug <drug> --disease <disease>. It queries:

NCBI GEO via eutils esearch/esummary on the gds database, and ArrayExpress / BioStudies (REST) — do not skip this; pivotal cohorts (e.g. PSORT E-MTAB-14509) are not in GEO.

Cast a wide net. Capture per candidate: accession, platform, organism, treatment(s), tissue/design, timepoints, whether a per-patient severity metric is present, PMID. Also retain right-disease / right-tissue but wrong-drug cohorts (other biologics for the same disease) — they belong in the audit trail as documented exclusions, not silent drops. Write the discovery catalog CSV (data/<disease>_<drug>_catalog.csv) — all candidates, before filtering.

Stage 2 — Agent curation

Apply inclusion rules to each candidate:

(a) the drug is present as an arm, (b) longitudinal baseline + on-treatment sampling in the target tissue, (c) a recoverable per-patient response (numeric severity preferred; categorical R/NR acceptable).

Mark each Included/Excluded with a one-line reason, and assign a role: primary, validation (e.g. an internal discovery/refinement split, or a cross-platform cohort), or pharmacodynamic (paired pre/post OR a drug-arm comparator, used to show the signature is drug-responsive even without response labels).

List near-miss cohorts explicitly. Right-disease/right-tissue but wrong-drug series must appear in the catalog with an explicit "Excluded — not <drug> (<actual drug>)" reason, so Table 1 documents the full landscape screened, not only the winners. Include all qualifying pharmacodynamic cohorts when pharmacodynamic_cohorts = all (the default): every paired pre/post cohort and every same-drug comparator arm with on-treatment sampling gets the pharmacodynamic role and is carried into Stage 5.6 — do not defer them to "next steps." A cohort marked pharmacodynamic in the catalog must actually be analyzed, or its row must say Excluded, never a contradictory "Included but unused."

Write decisions + reasons back into the catalog CSV. This catalog becomes Table 1 of the report.

Stage 3 — Response definition

For each included, response-labeled cohort run scripts/build_response_table.py:

pct_improve = (baseline - endpoint) / baseline on the severity metric; responder if pct_improve >= response_threshold - 1e-9 (the -1e-9 avoids floating-point boundary flips — this materially changed one boundary patient in the worked example); if only categorical labels exist, use them and flag the cohort as label-based.

Repeat the split at response_threshold_sensitivity (default 0.90) if set, saving it as a parallel labeling for the Stage 5 sensitivity pass. Save per-patient response tables (both thresholds) to data/ (part of the rerunnable bundle). Report the R/NR split per cohort per threshold.

Stage 4 — GSVA scoring

Run scripts/run_gsva.R per cohort:

Alias-map each signature to the cohort's feature space; report per-cohort coverage (e.g. 21/21, 19/20); drop any set with < min_set_size mapped genes and flag it. Score all samples with GSVA: gsvaParam(..., kcdf="Gaussian", minSize=3, maxSize=500) on log-normalized / log-CPM expression. Fractional tximport counts use the log-CPM + Gaussian route (not a Poisson kernel). Add the context_panel sets (Hallmark + Reactome immune) scored the same way, and tag the focused_panel subset for per-module reporting. Save GSVA score matrices to data/ (bundle).

Stage 5 — Statistics (full template; extras auto-skip)

Run scripts/delta_gsva_stats.R, then scripts/camera_endpoint.R and scripts/gene_de.R:

Primary — change-from-baseline ΔGSVA. Two steps: (i) form each patient's paired difference dGSVA(t) = GSVA(t) - GSVA(baseline) (within-patient change), then (ii) at the endpoint compare the NR patients' ΔGSVA values against the R patients' ΔGSVA values with a two-sample Wilcoxon rank-sum test (wilcox.test(nr, r)), plus a t-test alongside. Direction = NR - R (positive => higher in non-responders). This is an unpaired between-group test (NR and R are different, usually unequal-size groups — e.g. 9 NR vs 16 R); the only "paired" element is the per-patient baseline subtraction in step (i). Do not call it a "paired Wilcoxon" and do not pass paired=TRUE here — label figures and tables "Wilcoxon rank-sum (unpaired, NR vs R)". (A genuinely paired Wilcoxon is used only in the separate pharmacodynamic module, step 6, where the same patients are measured pre and post.) Report the primary signatures and every focused_panel module, one row per set × cohort. Cross-cohort concordance — Fisher's method on one-sided p-values testing the NR > R hypothesis:

X <- -2 * sum(log(pvals)); p <- pchisq(X, df = 2 * length(pvals), lower.tail = FALSE)

With a single cohort, report this as n/a (nothing to combine).

Independence caveat (must check and disclose). Fisher's method assumes the combined p-values come from independent cohorts. Sub-cohorts that are splits of one parent dataset (e.g. a discovery/refinement split of the same consortium study, as with PSORT E-MTAB-14509) are not independent — combining them inflates the apparent evidence (pseudo-replication). scripts/delta_gsva_stats.R accepts a --cohort-parent map and flags shared-parent inputs in its concordance output.

Always compute and report both an independent-only value (one representative cohort per parent + all genuinely independent cohorts) and an all-splits value, side by side, with per-cohort effects and one-sided p-values so a reader can see whether the signal is broad or driven by one cohort.

Which one carries the headline is governed by fisher_shared_parent, and this decision is only live when shared-parent splits are actually detected:

ask (default) — when the run detects that two or more contributing cohorts share a parent study, pause and ask the user (via AskUserQuestion) which value should be the headline: the independence-aware value (rigorous; recommended) or the all-splits value (reproduces a larger apparent effect but is pseudo-replicated). Present the two numbers in the prompt so the choice is informed. If the run is non-interactive, fall back to independent. independent — headline the independence-aware value; all-splits reported only as a sensitivity check. all — headline the all-splits value. Permitted but discouraged; when chosen, the report must state prominently that the headline is pseudo-replicated and show the independence-aware value beside it.

If no inputs share a parent, all contributing cohorts are independent and the distinction is moot (report the single combined value). Never let a borderline Fisher p (just under 0.05) carry the headline on its own — pair it with the ΔGSVA direction and the CAMERA/DE evidence, and state the caveat, regardless of the setting chosen.

CAMERA — competitive gene-set test at the endpoint, accounting for inter-gene correlation (limma::camera). Auto-skip a cohort that lacks a usable design; note that the absolute endpoint contrast is partly confounded by residual disease activity (state this in the report). Per-gene DE — limma-voom for RNA-seq (voom(dge) -> lmFit(E, model.matrix(~grp)) -> eBayes) / limma for microarray. Auto-skip if unsupported. Multiplicity — dual FDR. Report Benjamini-Hochberg FDR two ways, in separate columns, throughout: (a) a focused-family FDR across the focused_panel sets × timepoints, and (b) a global-family FDR across the full scored set list × timepoints. Report nominal (* p<0.05) and FDR (** FDR<0.05) separately — never conflate, and never collapse the two FDR families into one number. Pharmacodynamic module — for each cohort assigned the pharmacodynamic role (all of them when pharmacodynamic_cohorts = all): show the signature moves with treatment as drug-responsiveness evidence. For a paired pre/post cohort (same patients before and on treatment, e.g. GSE74697) a genuinely paired test is appropriate: wilcox.test(pre, post, paired = TRUE) on the matched pairs. For a drug-arm comparator with longitudinal on-treatment sampling (e.g. a VOYAGE-1-style ADA arm), test the on-treatment timepoint vs baseline (paired where patients are matched, else report means +/- SEM descriptively). Timepoint selection for a multi-timepoint comparator arm (pd_comparator_timepoint). When such an arm has more than one on-treatment timepoint, the choice materially changes the result — early timepoints can show incomplete suppression and understate drug-responsiveness, so the timepoint must not be picked silently. Behavior:

ask (default) — pause and ask the user (via AskUserQuestion) which on-treatment timepoint to use, presenting the available timepoints with their matched-pair n, and phrasing the recommendation as: "For a comparator arm with multiple on-treatment timepoints, use the latest timepoint with adequate n (deepest expected suppression); alternatively match the paired-cohort window for cross-cohort comparability." latest_adequate_n — auto-pick the latest on-treatment timepoint whose matched-pair n still meets the n floor (guarding against dropout); the non-interactive fallback for ask. match_paired_window — align to the paired PD cohort's sampling window (e.g. ~wk4) for comparability across PD cohorts. an explicit timepoint label — use exactly that timepoint.

Regardless of the choice, always report the full on-treatment trajectory (means ± SEM) alongside the chosen contrast, so the timepoint decision is transparent and a reader can see whether the signal depends on it. This is the only place paired = TRUE is correct; it is distinct from the unpaired NR-vs-R endpoint test in step 1. Threshold sensitivity — repeat steps 1–2 (and, where cheap, 3) using the response_threshold_sensitivity labels (default 0.90). Report as an explicit sensitivity section: direction concordance, strongest single signals, and whether anything survives FDR. Flag that stricter thresholds shrink responder groups and widen intervals, so these are fragile.

Stage 6 — Figures & report

Figures via scripts/make_figures.R (each PNG and SVG, editable text):

NR-vs-R ΔGSVA heatmap — main body = change-from-baseline per timepoint × cohort across the focused panel (signatures + modules); optional right strip = absolute endpoint contrast, explicitly labeled as confounded. Volcano(es) — per-gene DE (limma-voom). Pharmacodynamic — pre/post (or arm-trajectory) signature change, one panel per pharmacodynamic cohort. Trajectories — ΔGSVA over on-treatment timepoints, NR vs R, mean +/- SEM.

Report via scripts/build_report.py (ReportLab). Order:

Title Table 1 = discovery catalog (all screened datasets + include/exclude reasons, including near-miss wrong-drug cohorts) — evidence base before claims Summary + headline callout Methods — datasets, signatures+coverage, GSVA settings (incl. version), and a "which test produced which result" mapping block Results — analysed-cohort table, ΔGSVA endpoint (signatures + focused-panel modules, with dual-FDR columns), CAMERA, per-gene DE, pharmacodynamic (all cohorts), threshold-sensitivity section Limitations, Next steps, References

Label every figure, table, and results subheading with the method that produced it (GSVA ΔGSVA / CAMERA / limma-voom / Fisher). Framing: present the ΔGSVA concordance and the FDR-adjusted results side by side; report both the independent-only and all-splits Fisher values and name which one is the headline (per fisher_shared_parent); state sensitivity to small samples and boundary patients honestly. Do not let the headline rest solely on a confounded absolute endpoint or a near-null effect — report both and caveat.

Stage 7 — Verify-before-trust (MANDATORY gate)

Run scripts/validate_report.py and the media-check loop:

Reconcile every headline number in the PDF against the source CSVs; fail loudly on any mismatch. Include the GSVA version and both Fisher values in this reconciliation. Table-numbering integrity — tables contiguous, no duplicates; every in-text Table N resolves. Inspect every figure page — render with pymupdf, load with ordinary Read, and inspect the returned images. Regenerate on fail (glyph/layout/clipping) and re-check. Do not ship a figure that fails. Confirm every external fact (PMID / DOI / accession) against the primary source or the run record. Never reconstruct a citation from memory. Consistency check on test labeling: confirm the NR-vs-R test is described as unpaired Wilcoxon rank-sum everywhere (no stray "paired Wilcoxon" on the endpoint contrast), and that "paired" appears only in the pharmacodynamic module. Glyph safelist (ReportLab/Helvetica):

SAFE: — – Δ(Δ) α(α) β(β) γ(γ) κ(κ) •(•) − ×(×) ±(±) ≈(≈) ≥(≥) ′(′) →(→) < > & ‘ ’ UNSAFE — never use (render as .notdef black squares):  , ‑ (non-breaking hyphen). Use plain ASCII space / hyphen instead.

Deliverables (every run)

Media-checked PDF report (primary). Standalone figures + tables — PNG + SVG figures and all result tables as CSV in figures/ and tables/. Discovery-catalog CSV — the full screened-dataset catalog with include/exclude reasons (auditable on its own). Rerunnable analysis bundle — saved GSVA score matrices, per-patient response tables (both thresholds), per-gene DE tables, dual-FDR stat outputs, and both Fisher values, so the analysis can be re-inspected/extended without recomputation.

Defaults reference

See references/METHODS.md for the verbatim parameter/formula reference and references/worked_example.md for the TYK2/adalimumab/psoriasis walkthrough and expected artifacts. Statistical defaults are all configurable via the optional inputs above.

Graceful degradation (documented behavior)

Signature doesn't map (coverage < min_set_size) -> drop the set, flag in coverage report and Methods. No numeric severity metric -> use categorical R/NR labels, flag cohort as label-based. Single cohort only -> run per-cohort tests; concordance (Fisher) reported n/a; fisher_shared_parent is moot. No shared-parent splits -> all cohorts independent; report the single combined Fisher value; skip the ask prompt. Non-interactive run with fisher_shared_parent = ask -> fall back to independent (rigorous) and note the fallback. CAMERA / limma-voom unsupported for a cohort -> auto-skip with an explicit note; the ΔGSVA headline still stands. No paired/comparator pharmacodynamic cohort -> omit the pharmacodynamic module (note its absence). Comparator PD arm with a single on-treatment timepoint -> use it; pd_comparator_timepoint is moot (no prompt). Non-interactive run with pd_comparator_timepoint = ask -> fall back to latest_adequate_n and note the fallback. response_threshold_sensitivity = none -> skip the Stage 5.7 sensitivity pass (note its absence).

86. signature-reversal-lincs
Category: DRUG DISCOVERY
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

87. single-cell-census-query
Category: TRANSCRIPTOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

Single-Cell Census Query: Expression Atlas + Pseudobulk Differential Expression

Query the CZ CELLxGENE Census for how a gene panel is expressed across cell types in one or more tissues, then run a rigorous donor-level pseudobulk differential expression (DE) analysis comparing a disease (case) against a control condition — all from public single-cell atlases — and deliver a Phylo-branded PDF report.

This skill encodes a tested, generalizable procedure. Every biological specific (which genes, tissue, disease) is a parameter, not a hard-coded value. It was validated end-to-end on a real allergic-airway analysis; the scripts here are the generalized versions of that proven run.

Scope

Does:

Expression atlas — pull a gene panel across all cell types in chosen tissue(s) from the Census normalized layer; summarize mean expression + % of cells expressing per cell type.
Pseudobulk DE — aggregate raw counts to donor × cell_type pseudobulk samples and run DESeq2 (global + per-cell-type) for case vs. control, with donor as the replicate unit.
Report — a Phylo PDF (infographic summary, intro, methods, results, figures, references, next steps), delegating the PDF mechanics to the pdf-report-generation skill.

Does NOT (delegates to sibling skills — reference, don't reimplement):

Functional enrichment / pathway analysis of the DE results → functional-enrichment-from-degs, pathway-enrichment.
Drug-target prioritization / genetic-evidence integration → scrna-disease-drug-discovery.
Full scRNA preprocessing (QC, clustering, annotation) from raw droplet data → scrnaseq-scanpy-core-analysis.
Finding datasets when the Census lacks the disease → omics-dataset-retrieval (GEO, etc.).
Generic counts→DE on a user's own matrix (no Census) → bulk-rnaseq-counts-to-de-deseq2.
Inputs (parameters — replace the placeholders, do not hard-code biology)
Parameter    Meaning    Example
GENE_PANEL    HGNC gene symbols of interest (resolved to Ensembl IDs at runtime)    ["IL13","TSLP"]
TISSUES    Census tissue_general value(s) for the atlas    ["lung","nose"]
CASE_LABEL    Census disease value for the case group    "chronic rhinitis"
CONTROL_LABEL    Census disease value for the control group    "normal"
ORGANISM    Census organism    "Homo sapiens" (default)
CENSUS_VERSION    Pinned Census release (record for reproducibility)    e.g. "2025-11-08"
MIN_CELLS_PER_SAMPLE    Drop pseudobulk samples with fewer cells    10 (default)
MIN_DONORS_PER_GROUP    Min donors per group for a cell type to be testable    3 (default)
DONOR_BATCH    Donors per streaming read (memory control)    8 (default)
COVARIATES    Optional design covariates (see extension)    [] or ["sex"]

Alternate input (extensible): if the user has their own single-cell .h5ad or a donor × cell_type raw-count matrix, skip Step 3 (Census pull) and feed the matrix directly to Step 4's pseudobulk build / Step 5's DESeq2. See references/parameters.md → "Bring-your-own data".

Outputs (saved to /mnt/results/)
data/<panel>_expression_by_celltype.csv — per-cell-type mean expression + % expressing.
data/pseudobulk_counts.csv, pseudobulk_coldata.csv, pseudobulk_var.csv — pseudobulk matrix.
data/pseudobulk_DE_all_results.csv, pseudobulk_DE_significant.csv — full + significant DE.
data/<panel>_DE_by_celltype.csv — the gene-panel DE table across cell types.
figures/*.png + *.svg — dotplots, volcano, gene-panel forest, DEG-count barplot, boxplots, heatmap (Phylo palette).
report_<title>.pdf — the final Phylo-branded report.
CRITICAL pre-flight: verify labels BEFORE analysis (missing-label protocol)

The single most important lesson from the source analysis: the requested disease may not exist in the Census. (In the original run, "asthma" had zero cells — all 259 disease labels were enumerated to confirm — so a documented proxy, chronic rhinitis, was used with user confirmation.)

You MUST, before committing to any comparison:

Enumerate available disease labels for the target tissue(s) and confirm CASE_LABEL and CONTROL_LABEL both exist with primary-data cells. Use scripts/enumerate_labels.py.
Enumerate available tissue_general values and confirm TISSUES exist.
Report per-(cell_type × group) donor counts so the user sees which cell types are testable (≥ MIN_DONORS_PER_GROUP donors per group) and how imbalanced the groups are.

If CASE_LABEL is absent: do NOT silently substitute. Surface the absence plainly, then either

propose a documented biological proxy (a related condition present in the Census) and get the user's explicit confirmation before running, or
point the user to omics-dataset-retrieval to source the disease from GEO/other repositories.

Prefer a single shared dataset. When both groups are available inside one dataset_id, run the comparison within that dataset — this removes assay/batch confounding (the source run did exactly this). If groups only exist across different datasets, say so and add dataset/assay as a covariate (see extension) or flag the batch confound as a limitation.

Workflow

Use TodoWrite to track these steps. Language policy: Python only where required (Census access via cellxgene-census/tiledbsoma has no R equivalent), R (DESeq2 + ggplot2) for statistics and figures.

Step 1 — Resolve inputs & scope
Resolve GENE_PANEL symbols → Ensembl feature_ids from the Census var table; warn on any unresolved/deprecated symbol (do not proceed with a silently-dropped gene).
Pin and record CENSUS_VERSION (default to the latest stable release; print it into the report methods). Reproducibility depends on this.
Step 2 — Pre-flight label verification (mandatory)
Run scripts/enumerate_labels.py for the missing-label protocol above. Get user confirmation on any proxy. Decide single- vs multi-dataset comparison.
Step 3 — Expression atlas query
Run scripts/query_expression_atlas.py: pull an AnnData restricted to GENE_PANEL across TISSUES for disease == CONTROL_LABEL (normal reference) using the normalized layer. Restricting var to the panel keeps this tiny even across millions of cells.
Compute per-cell-type mean expression and % cells expressing; save the CSV.
Step 4 — Build donor × cell_type pseudobulk (raw counts)
Run scripts/build_pseudobulk.py: stream the raw X matrix in donor-batches of DONOR_BATCH, summing counts per donor_id || cell_type || disease via a sparse group-indicator matmul (never load the full cells × genes matrix). Keep samples with ≥ MIN_CELLS_PER_SAMPLE cells.
Compute/memory: this is the dominant cost. See "Compute guidance" — provision ≥32 GB and run as a background job for large datasets; estimate total time from the first donor-batch.
Step 5 — Pseudobulk DESeq2 DE
Run scripts/run_pseudobulk_deseq2.R: GLOBAL (collapse cell types within donor) + per cell type (only cell types with ≥ MIN_DONORS_PER_GROUP donors in both groups). Design ~ disease (or ~ <covariates> + disease if COVARIATES set), contrast case vs control, BH-FDR < 0.05. Save all + significant + the gene-panel-focused table.
Step 6 — Figures
Run scripts/make_figures.py: gene-panel dotplots (mean expr + % expressing across cell types), volcano (global DE), gene-panel forest (log2FC ± SE across cell types), DEG-count barplot, pseudobulk boxplots for the panel genes, top-DEG heatmap. Phylo palette; editable SVG text.
MANDATORY: after saving each figure, run Read(...) on the PNG and regenerate anything blank/clipped/overlapping before continuing (this caught real overlap bugs in the source run).
Step 7 — Literature grounding (required)
Run LiteratureSearch on the top DE genes and the gene-panel biology in the disease context to ground the interpretation in real papers. Cite with inline [N]; verify specifics before writing. Populate the report's References and inform Next Steps.
Step 8 — Assemble the PDF report
Load and follow the pdf-report-generation skill for all Phylo branding, layout, and validation mechanics — do not re-derive them. The report must contain, in order: an infographic summary (one-glance visual of the headline result), Introduction, Methods (incl. the pinned Census version, filters, thresholds, and any proxy/limitation), Results (figures + tables with captions), Conclusions, References (from Step 7), and Next Steps.
Image sizing (learned bug): tall stacked figures overflow the frame at large widths. In the figure helper, bound both width and height (e.g. scale so height ≤ ~560 pt) — see references/parameters.md → "PDF figure sizing".
Validate: page count ≥ 2, size > 5 KB, extractable text, then visual inspection with Read on the PDF.
Scientific caveats (state the relevant ones in the report)
Donor is the replicate unit. Pseudobulk avoids pseudoreplication; never run per-cell DE across cells from few donors and call it powered.
Atlas uses normalized; DE uses raw. DESeq2 requires integer counts. Do not feed normalized values to DESeq2.
Group imbalance / small case N. Public atlases often have far more controls than cases (the source run had 15 case vs. 227 control donors). Report per-group donor N honestly and flag results as discovery-limited when the case group is small.
Batch/assay confounding. Prefer within-dataset comparisons; otherwise adjust for dataset/assay or flag the confound.
Proxy conditions are proxies. If a proxy disease is used, say so prominently — it is not the originally requested disease.
Gene symbol drift & genome build. Resolve symbols → Ensembl IDs explicitly; the Census is a fixed build per version, so record the version.
Organism. Defaults to human; other organisms are an untested extension.
Compute guidance (size from evidence, not intuition)
Atlas query (Step 3): minutes; memory scales with #cells × panel size (panels are small, so this stays light even across millions of cells).
Pseudobulk streaming (Step 4): the dominant cost. As a real datapoint, a ~1M-cell / ~240-donor / ~60k-gene dataset took ~65 min and needed a 32 GB machine. Use ManageMachine to provision ≥ 32 GB, run the build as a background job, and estimate total runtime from the first donor-batch rather than guessing. The dense group×gene accumulator is n_groups × n_genes × 8 bytes — check it fits before starting.
DESeq2 (Step 5): minutes to tens of minutes, scales with #cell-types × #genes.
Small pre-flight label queries (Step 2) are seconds–minutes on the default worker.
Reference files
scripts/enumerate_labels.py — pre-flight: disease/tissue labels + per-(cell_type×group) donor counts.
scripts/query_expression_atlas.py — gene-panel × cell-type expression (normalized layer).
scripts/build_pseudobulk.py — streaming donor×cell_type raw-count aggregation.
scripts/run_pseudobulk_deseq2.R — global + per-cell-type DESeq2 with the confirmed filters.
scripts/make_figures.py — all figures, Phylo palette, media-check ready.
references/parameters.md — every threshold/default, rationale, and how to change it; BYO-data path; PDF figure-sizing fix.
references/resource_map.md — Biomni resources this skill uses and the sibling skills it defers to.

88. single-cell-multimodal-integration
Category: INTEGRATION
Source: https://biomni.phylo.bio/skills?section=marketplace

<!-- archetype: analysis-workflow --> <!-- contract: evidence-v1 -->
Single Cell Multimodal Integration
Input Selection and Provenance

Launch scripts/run_once.py with an external config and explicit modality and metadata selections. The Python, shell, and R entrypoints verify the same sealed schema-v2 input_selection.json before science. Downloaded inputs require source, tool, version, command, and retrieval evidence; uploaded inputs record acquisition as not_applicable. Inference, substitution, package data, symlink escapes, incomplete role maps, and reused non-empty results roots are hard stops. Facts, report, and receipt bind the canonical manifest hash and selected dataset.

When to Use This Skill

For paired CITE-seq integration; unpaired/diagonal and mosaic RNA+ATAC are detected only to hard-stop as unsupported.

Why This, Not The Obvious Thing (READ FIRST)

Establishing the design regime before choosing a method is the field's most common error: a paired CITE-seq bundle is confirmed to carry Gene Expression and Antibody Capture (not Peaks) before integration, and paired RNA+ATAC is routed to scatac-multiome-analysis rather than force-integrated.

Inputs
A 10x CITE-seq filtered_feature_bc_matrix.h5 with both Gene Expression and Antibody Capture feature types (paired CITE-seq route).
raw_feature_bc_matrix.h5 (unfiltered droplets) for requested dsb ambient background estimation; without a sufficient validated captured low-depth non-cell population, the requested dsb route fails loudly. CLR remains an explicit user/configuration choice.
metadata.csv with per-cell or per-sample replicate and condition columns for replicate-aware differential abundance.
Unpaired/diagonal or mosaic RNA+ATAC inputs are not accepted for integration; the router records an unsupported stop.
A config file (scripts/config.example.yaml) naming isotype-control antibodies and setting the route, QC, WNN, totalVI, integration, and differential-abundance parameters.
Outputs
report_single_cell_multimodal_integration.pdf — provider-selected PDF built from provider-neutral report_content.json; pdf-report-generation is the contract default, while an immutable explicit user choice may select an installed enterprise styling provider
report_content.json — provider-neutral report facts, ordered narrative blocks, exact tables, and exact figure references; styling providers consume it without changing the science
joint_cluster_celltype_assignment.csv — the machine-readable paired-CITE-seq result: one row per joint WNN cluster with cluster id, supported cell type or explicit unassigned state, top RNA markers, top surface-protein (ADT) markers, mean RNA/ADT modality weight, and cell count
integrated.h5mu — the integrated multimodal object (RNA + ADT assays, joint embedding, clusters, annotations, modality weights)
joint_qc_scorecard.csv — integration metrics (batch-mixing, silhouette, and label purity only when an independent reference exists — see label_purity_status.json) in one table
label_purity_status.json — machine-readable label-purity metric state: the reference source/join/coverage and its ARI/NMI, or not_evaluable_independent_labels with the reason; the report and receipt bind to this so a circular or non-evaluable metric is never narrated as integration quality
annotation_concordance.csv — reference × marker-annotation confusion, surfacing novel/spurious labels and cluster split/merge instead of a single scalar
rna_markers.csv / protein_markers.csv — per-cluster RNA log-fold-change markers and surface-protein normalized-score differences; declared isotype controls never appear as biological ADT markers
modality_weights_summary.csv — per-cell WNN RNA/ADT modality-weight summary (weights in the closed unit interval)
report_facts.json — evidence-bearing claims, operational definitions, provenance, and validated denominator/completion partitions

Write the report to the results root under the name above. Data tables, figures and intermediates go in data/, figures/, tables/. Note that GenerateImage strips directory components, so schematics always land at the root regardless of the path you pass it.

Clarification Questions
How should the run obtain its input bundle? (select one)
user_citeseq — Use a user-provided 10x CITE-seq bundle; runtime branch ID input_mode:user_citeseq
Which integration route should run? (select one)
auto — Detect the design regime automatically (recommended); runtime branch ID route_override:auto
citeseq — Force the paired CITE-seq RNA+ADT route; runtime branch ID route_override:citeseq
unpaired — Confirm an unpaired/diagonal RNA+ATAC request and hard-stop it as unsupported; runtime branch ID route_override:unpaired
mosaic — Confirm a mosaic RNA+ATAC request and hard-stop it as unsupported; runtime branch ID route_override:mosaic
How should antibody-derived tags be normalized? (select one)
dsb — dsb background denoising (needs a validated background; uses isotype controls when available); runtime branch ID adt_norm:dsb
clr — CLR normalization (no empty droplets/isotypes required); runtime branch ID adt_norm:clr
Standard Workflow

Mandatory immutable one-shot boundary. Treat the attached skill directory as read-only. Never create config.yaml, helper scripts, notebooks, caches, or outputs inside it. Copy scripts/config.example.yaml to a fresh external run workspace, edit only that external copy, and set both project.outdir and project.results_dir to fresh external directories. Then invoke the package-owned launcher exactly once:

python -B /path/to/attached/single-cell-multimodal-integration/scripts/run_once.py \
  --config /workspace/scmi-run/config.yaml

run_once.py verifies the packaged member manifest before analysis, records a full package-tree snapshot outside the package, refuses a non-fresh results root, calls run_all.sh exactly once, seals every scientific artifact, and verifies that the full package tree is unchanged. Do not call run_all.sh directly, delete outputs, reset qc_run_log.json, rerun, or substitute a package-local helper. A failure is terminal for that task and must be reproduced in a new local workspace. Steps 1–9 below describe what that single launcher invocation performs; do not execute them as a second analysis path.

Step 1 — Load and validate the input. Enforce every item in ## Inputs; stop with not_computable on a mismatch.

Step 2 — Validate modality identity and resolve the route. Run scripts/00_route.R to detect the 10x feature types (Gene Expression, Antibody Capture, Peaks), barcode structure, and isotype-control presence. Proceed only with paired CITE-seq, route paired RNA+ATAC to scatac-multiome-analysis, and hard-stop unpaired/diagonal or mosaic RNA+ATAC because genuine GLUE/StabMap integration is not implemented. Stop with a specific reason on trimodal or scRNA-only bundles rather than force-integrating.

Step 3 — QC each modality. Run scripts/02_rna_qc.R for RNA QC (counts, features, percent mitochondrial) and scripts/03_adt_qc_dsb.R for ADT QC (total protein counts, isotype signal) with modality-specific thresholds; export per-modality QC tables and figures.

Step 4 — Denoise antibody-derived tags with dsb. At ingest, exclude the complete filtered-cell barcode set and any per-cell metadata barcodes from the raw matrix, then select only non-cell droplets with positive ADT capture inside the declared low-depth RNA/ADT bounds. Record the selection flow and assert zero called-cell overlap. Run scripts/03_adt_qc_dsb.R with that validated background and the named isotype controls when available. An explicit dsb request fails loudly when no valid background exists; it never treats all raw-minus-post-QC barcodes as ambient and never silently substitutes CLR. CLR remains an explicit normalization choice.

Step 5 — Build the WNN joint embedding. Run scripts/04_wnn_joint.R: compute RNA PCA and ADT PCA, run FindMultiModalNeighbors, and produce a joint UMAP, joint clusters, and per-cell modality weights asserted to lie in the closed unit interval.

Step 6 — Compute the totalVI alternative and integration metrics. Run scripts/05_totalvi.py and scripts/06_integrate_metrics.py: assemble an integrated .h5mu and compute batch-mixing, silhouette, and label-purity integration metrics into a joint QC scorecard. Label purity is scored (via scripts/label_purity.py) ONLY between the WNN clusters and an INDEPENDENT reference label preserved from user metadata before any annotation join, with verified alignment, coverage, and non-cluster-derived independence; otherwise it writes label_purity_status.json state not_evaluable_independent_labels with null ARI/NMI and claims no label purity. The marker-derived annotation is scored separately as annotation_concordance.csv (confusion surfacing novel/spurious labels and split/merge), never overwritten onto the reference. Run the totalVI probabilistic alternative only when its assumptions hold, otherwise record a documented skip.

Step 7 — Annotate cells and rank RNA and protein markers. Run scripts/07_annotate_markers.R for marker-based annotation on the joint clusters using the bundled PBMC panel. Package-owned canonicalization matches standard TotalSeq suffixes and R/Python separator variants; if no panel marker matches, export unassigned with null score/margin rather than selecting an arbitrary lineage. RNA markers retain log2 fold change. ADT markers use the arithmetic difference on the selected normalized-output scale with raw-count detection fractions and adjusted Wilcoxon P values; do not compute or label a log2 fold change on DSB standardized scores. Exclude declared isotype controls from biological marker tables, top-marker exports, and the annotation heatmap.

Step 8 — Test replicate-aware differential abundance. Run scripts/08_diff_abundance.R: build Milo neighborhoods on the joint embedding and test differential abundance with spatial FDR when at least two biological replicates per condition exist, and skip and flag rather than fabricate when replication is insufficient.

Step 9 — Generate and validate figures. Regenerate every figure from the current underlying data rather than reusing stale figures. The one-shot launcher renders only results produced by the preceding validated steps, writes figures/manifest.json, and calls the package-owned figure gate before it seals the scientific artifacts. Do not recreate or replace figures after this point.

Figures

One representative figure per result-producing step, showing this run's actual result — not a schematic, not an illustrative example. Every figure needs a caption stating what it shows. If a step genuinely has nothing to plot, replace its row with a one-line reason. A caption is required at run time, so fill these in before the first run.

Step    File    What it must make visible
3    figures/figure_3_qc_each_modality.png    Per-modality QC after filtering: RNA counts, genes per cell, and percent mitochondrial; ADT total protein counts and isotype signal, with the retained-cell thresholds marked.
4    figures/figure_4_denoise_antibody_derived.png    ADT signal before vs after normalization for the named isotype control and a matched surface marker when available; state the measured post-normalization isotype median without inferring a universal near-zero threshold (or state that the isotype diagnostic is not evaluable).
5    figures/figure_5_build_the_wnn.png    WNN joint UMAP colored by joint cluster, alongside the per-cell RNA/ADT modality-weight distribution with weights shown to lie in the closed unit interval.
6    figures/figure_6_compute_the_totalvi.png    Joint integration metrics (batch-mixing, silhouette, and label purity only when an independent reference exists — else flagged not-evaluable) beside the annotation-vs-reference confusion, which exposes any novel/spurious label and cluster split/merge.
7    figures/figure_7_annotate_cells_and.png    Per-cluster surface-protein signal heatmap, excluding declared isotype controls, with the supported cell type or explicit unassigned state and the confidence/margin flag.
8    figures/figure_8_test_replicate_aware.png    Milo neighborhood differential-abundance beeswarm across conditions with spatial-FDR significance, or the insufficient-replication skip flag when fewer than two biological replicates per condition.

The report reads this inventory from report_facts.json's figures array rather than restating it, so it cannot claim a figure that was never produced. Every data-bearing figure owns an adjacent four-part paragraph labeled Claim:, Evidence:, Interpretation:, and Limitation:. The report model nests those fields inside the figure block, the default renderer keeps them with the image and caption, and final QC checks structural ownership plus the exact ordered paragraphs in the current PDF text.

Step 10 — Write report_facts.json from the runtime payload. run_once.py reconstructs this artifact from facts_payload.json and the validated figure inventory through the package-owned semantic gate, then includes it in the one-shot seal. Do not hand-author facts or rerun this step.

Step 11 — Final report (MANDATORY TERMINAL STEP)

The run is not complete until this step has produced report_single_cell_multimodal_integration.pdf at the results root. Resolve the report-style provider from immutable user-message evidence. The contract default is pdf-report-generation; an explicitly selected installed enterprise provider overrides it. Both paths consume the same provider-neutral report_content.json and exact figure files. The bundled ReportLab renderer is default-only and must stop before writing when an explicit provider is selected.

Produce one combined PDF with a short narrative. Place the qualitative GenerateImage infographic near the beginning as the first substantive visual; rendered page images are inspection evidence only, never substitutes for the PDF. End the task with a concise conclusion and links to the PDF and supporting artifacts, not a bare file listing.

The PDF must use these visible top-level sections in this order, adapting their contents to this skill rather than adding generic filler. Cite sources inline with numbered markers like [1] and include matching exact numbered references. Regenerate every figure from the current underlying data rather than reusing stale figures:

Task Context — the research or practitioner question, supplied inputs, scope, and decision the output informs.
Methods & Sources — Methods & Sources covers data provenance, filtering, parameters, software, and the analysis design; Results reports validated quantitative findings and figures.
Results — the run's actual outputs and evidence, never a description of what the skill could do.
Conclusions & Interpretation — supported takeaways, their practical meaning, and appropriate next steps.
Next Steps — concrete validation or follow-up work warranted by this run's evidence.
Limitations — run-specific uncertainty, missing coverage, failed or unavailable checks, and claims the evidence does not support.
References — exact numbered entries matching every inline [N] citation.

Include references and a compact output-artifact table where applicable. Empty boilerplate does not satisfy a section.

Generate report_single_cell_multimodal_integration_infographic.png with Biomni GenerateImage before report preparation by submitting assets/infographic_prompt.txt verbatim. Resolve the report provider first and load its complete installed instructions and assets, then apply only the resolved provider's palette and typography. The infographic must remain a five-stage directional workflow with minimal text: no logo, wordmark, watermark, table, dashboard, result plot, or run-specific value. Immediately after the tool returns—and before any transformation or replacement—snapshot its trace and pixels:

from report_qc import record_generated_infographic
record_generated_infographic(
    "report_single_cell_multimodal_integration_infographic.png",
    log_path="qc_run_log.json",
)

Run the import-safe report workflow from the same external config and run workspace:

# Default style: prepare, build a fresh workspace PDF, publish it, and render every page.
python -B /path/to/attached/single-cell-multimodal-integration/scripts/make_report.py \
  --config /workspace/scmi-run/config.yaml --phase all

# Explicit provider: prepare only, then let that installed provider consume report_content.json
# and its exact figure paths into a fresh workspace PDF.
python -B /path/to/attached/single-cell-multimodal-integration/scripts/make_report.py \
  --config /workspace/scmi-run/config.yaml --phase prepare

# After every rendered page has actually been inspected and recorded:
python -B /path/to/attached/single-cell-multimodal-integration/scripts/make_report.py \
  --config /workspace/scmi-run/config.yaml --phase finalize \
  [--provider-rendered-report /workspace/fresh-provider-report.pdf]

prepare freezes the content, source/figure hashes, immutable provider selection, and installed provider-source hash in report_preparation.json. finalize re-resolves the selection and rechecks every hash, verifies the selected-provider PDF, refuses to overwrite an existing provider PDF, and writes receipt-v3. An explicit provider may either supply a fresh workspace candidate to finalize or publish the canonical results-root PDF itself; the bundled renderer never replaces it.

The one-shot launcher owns run_bundled, the QC command event, and the sealed scientific-artifact inventory; do not call it separately, author events, or copy transcript identifiers. --phase all performs record_pdf_render for the default provider; an explicit provider must call it after publishing its PDF. Use ordinary Read to inspect the current PDF when supported or every rendered page PNG with an image-capable model. Loading media is not a passing review; inspect the pixels and fix defects. If visual input is unavailable, state that limitation. The receipt verifies rendering and hashes but does not attest visual quality. The finalizer also rejects changed content, figures, provider source, provider selection, PDF bytes, scientific artifacts, package members, duplicate execution, unmatched hashes, or source-value disagreement.

Record each answer from ## Clarification Questions in selected_branch_ids using the displayed <question_id>:<choice_id> value. The receipt derives its required outputs only from those selected branches; do not union mutually exclusive branch artifacts.

--phase all returns the current page manifest. Open every returned page image with the native Read/media inspection tool. Do not replace that action with authored observations or file-size checks. Then run make_report.py --phase finalize; the receipt checks rendering and hashes. GenerateImage lineage and explicit report-style selection use that same literal read-only platform trace captured once. A results/workspace transcript cannot verify either. If the platform trace is not exposed, the contract-default provider is retained (no override is invented), GenerateImage lineage is recorded not_evaluable_platform_trace, and independent post-run evidence review is required.

For contract-audit purposes, the ordered package-owned wiring across run_once.py and the finalizer is equivalent to the block below. Do not run this block separately or hand-author facts or the receipt: run_once.py owns the figure/facts phase, and --phase finalize owns publication and the receipt after first re-verifying the preparation record:

from report_qc import (
    assert_figures,
    finalize_delivery,
    staged_copy,
    write_facts_from_artifact,
)

# run_once.py, before the immutable scientific-artifact seal
figures = assert_figures("figures/manifest.json")
write_facts_from_artifact(
    "report_facts.json",
    source="facts_payload.json",
    figures=figures,
    contract="skill_contract.json",
)

# make_report.py --phase finalize, after current preparation/hash verification
staged_copy(provider_workspace_pdf, "report_single_cell_multimodal_integration.pdf")
delivery = finalize_delivery(
    "report_single_cell_multimodal_integration.pdf",
    figures,
    figure_not_applicable_reason=None,
    bundled_files=["scripts/run_all.sh"],
    outputs=selected_outputs + [
        "report_content.json",
        "report_preparation.json",
        "report_style_selection.json",
    ],
    infographics=["report_single_cell_multimodal_integration_infographic.png"],
    style_provider=selected_provider,
    style_selection_record="report_style_selection.json",
    qc_run_log="qc_run_log.json",
    package_snapshot="attached_package_snapshot.json",
    execution_seal="one_shot_execution.json",
    contract="skill_contract.json",
    receipt_path="run_receipt.json",
)
print(delivery["terminal_message"])

The receipt is run_receipt.json at the results root, not beside this SKILL.md. It records attached_package_tree_unchanged, one_shot_execution_verified, execution_contract_satisfied, outputs_appeared, report_at_results_root, figure_contract_satisfied, facts_artifact_verified, report_style_verified, text_extracted, pages_rendered, visual_review_attested, report_sections_present, report_citations_numbered, figure_local_narrative_verified, source_assertions_verified, and infographic_lineage_verified, each with concrete evidence. visual_review_attested is not_applicable: the receipt does not attest visual inspection. Finalization then writes delivery_authorization.json, binding the current package, sealed science artifacts, facts, totalVI status, scorecard, receipt, and PDF hashes. End the task with exactly the returned delivery["terminal_message"]; do not report first-pass or remembered values.

Do not write this file by hand. check_skill.py --require-run-receipt requires the schema marker and per-outcome evidence, so a hand-written block of trues fails. Whatever did not hold is recorded false with a <key>_reason; fix the run rather than the receipt.

Scientific caveats
Establishing the design regime before choosing a method is the field's most common error: a paired CITE-seq bundle is confirmed to carry Gene Expression and Antibody Capture (not Peaks) before integration, and paired RNA+ATAC is routed to scatac-multiome-analysis rather than force-integrated. Evidence: provenance_manifest.json (assay.identity_violations).
Antibody-derived tags carry ambient background: dsb denoising uses a captured low-depth non-cell population that excludes every filtered/metadata cell barcode, plus named isotype controls when available. The full selection diagnostics and measured post-normalization isotype median are recorded without a universal near-zero acceptance threshold. An explicit dsb request fails if no valid background exists; CLR is never silently substituted. Evidence: adt_normalization_status.json (background_selection, isotype_background_median, isotype_background_interpretation).
DSB standardized scores are not log-normalized counts. protein_markers.csv reports avg_normalized_adt_difference and raw-count detection fractions; declared isotype controls remain normalization diagnostics and are excluded from biological marker outputs. Evidence: protein_marker_status.json and protein_markers.csv.
Per-cell WNN modality weights lie in the closed unit interval and describe how much each modality drove the joint neighbor graph; a near-degenerate distribution means one modality dominated and the joint embedding is close to a single-modality result. Evidence: modality_weights_summary.csv.
Label purity (cluster ARI/NMI) is meaningful only against an INDEPENDENT reference label: the reference is preserved before any annotation join and scored only when cell-level alignment, non-missing coverage, and non-cluster-derived independence hold; otherwise not_evaluable_independent_labels is recorded and no ARI/NMI is claimed. Scoring clusters against a marker annotation derived from those clusters is circular and inflates the score — the annotation is instead evaluated separately as annotation-vs-reference concordance that surfaces novel/spurious labels and cluster split/merge. Evidence: label_purity_status.json (state, circular_metric_emitted, metrics).
totalVI outputs are model predictions, not measurements, and run only when their assumptions are met; otherwise a documented skip is recorded rather than a fabricated latent space. Evidence: totalvi_status.json.
Unpaired/diagonal GLUE and mosaic StabMap are unsupported: the router hard-stops before preprocessing because no genuine guidance graph/shared bridge, model fit, or label transfer exists in the package. Evidence: route_decision.json (route=stop, stop=true, reason).
Milo differential abundance requires at least two biological replicates per condition and more than one condition; with insufficient replication it is skipped and flagged, never reported with a fabricated FDR. Evidence: diffabund_status.json.
This skill is hypothesis-generating: joint clusters, integration metrics, and neighborhoods are exploratory and are not validated at any threshold. Evidence: report_facts.json.

Each caveat must name the artifact field or the number that says whether it fired. An unbound caveat is prose; a bound one is a gate.

Evidence Tier

Derive the reportable evidence tier from the current run's sealed inputs, completed scientific gates, report facts, provenance, and accepted receipt. Never exceed what those run artifacts support.

Data Sources & Licenses
Seurat (>=5.0): https://github.com/satijalab/seurat — license MIT; commercial use allowed (MIT license (GitHub LICENSE); WNN joint embedding and RNA analysis.); included false; verify with references/licenses.md.
dsb (>=1.0): https://github.com/niaid/dsb — license CC0-1.0; commercial use allowed (CRAN/GitHub dsb DESCRIPTION is CC0-1.0 (public domain dedication); commercial use permitted. Re-verify at authoritative source.); included false; verify with references/licenses.md.
scvi-tools (totalVI) (>=1.1): https://github.com/scverse/scvi-tools — license BSD-3-Clause; commercial use allowed (BSD 3-Clause (GitHub LICENSE); totalVI probabilistic RNA+ADT latent space.); included false; verify with references/licenses.md.
mudata / muon (>=0.2): https://github.com/scverse/mudata — license BSD-3-Clause; commercial use allowed (BSD 3-Clause (GitHub LICENSE); .h5mu container.); included false; verify with references/licenses.md.
scanpy / anndata (>=1.9): https://github.com/scverse/scanpy — license BSD-3-Clause; commercial use allowed (BSD 3-Clause (GitHub LICENSE).); included false; verify with references/licenses.md.
miloR (>=1.10): https://github.com/MarioniLab/miloR — license GPL-3; commercial use allowed (GPL-3 (Bioconductor DESCRIPTION); copyleft, commercial use allowed under GPL terms.); included false; verify with references/licenses.md.
presto (>=1.0): https://github.com/immunogenomics/presto — license GPL-3.0-only; commercial use allowed (GPL-3.0-only (GitHub); copyleft, commercial use allowed under GPL terms. Optional accelerator; Seurat Wilcoxon runs without it.); included false; verify with references/licenses.md.
scglue (GLUE) (>=0.3): https://github.com/gao-lab/GLUE — inventoried for method context only; included false; unavailable in this package and installing it does not enable the hard-stopped route; verify license context with references/licenses.md.
StabMap (>=0.1): https://github.com/MarioniLab/StabMap — inventoried for method context only; included false; unavailable in this package and installing it does not enable the hard-stopped route; verify license context with references/licenses.md.
reportlab (>=4): https://pypi.org/project/reportlab/ — license BSD-3-Clause; commercial use allowed (BSD (reportlab source LICENSE); PDF rendering via the delegated report skill.); included false; verify with references/licenses.md.
CellMarker 2.0 (2.0): http://bio-bigdata.hrbmu.edu.cn/CellMarker/ — license Ambiguous (paper CC-BY-NC-4.0; mirrors CC0; site copyright, no explicit reuse grant); commercial use not_checked (Conflicting signals; commercial reuse could not be unambiguously verified. Optional only; a built-in PBMC marker panel ships as fallback.); included false; verify with references/licenses.md.
Resource Identity

Resolve assay.declared_regime against https://www.10xgenomics.com/support/software/cell-ranger/latest/analysis/outputs/cr-outputs-h5-matrices and compare assay.observed_feature_types, assay.isotype_controls_present. Write decisions to provenance_manifest.json and require assay.identity_violations = 0 through a source-assertion witness. A valid identifier attached to mismatched metadata is a failure, not a resolved resource; exclude it or finalize not_computable before facts or the report are written.

Common Issues
Symptom    Cause    Fix
Route resolves to handoff for paired RNA+ATAC    The bundle is genuinely paired RNA+ATAC multiome (Gene Expression + Peaks), not CITE-seq    Run scatac-multiome-analysis; this skill integrates paired CITE-seq only
Route resolves to stop (scRNA-only or trimodal)    The matrix carries only Gene Expression, or carries all three of GEX/ADT/Peaks    Use a scRNA-seq skill for single-modality RNA; trimodal (TEA/DOGMA-seq) is a documented out-of-scope future mode
Explicit DSB normalization stops    The raw matrix is absent, called/metadata cells cannot be excluded, or fewer than adt.dsb_background.min_droplets captured low-depth non-cell droplets survive    Correct the input identity or tune the declared assay-specific background bounds; choose adt.normalization: clr explicitly if ambient modeling is not intended
Near-degenerate modality weights (median ≈ 0 or 1)    One modality (usually RNA) dominates the joint graph    Inspect modality_weights_summary.csv; the joint embedding is close to single-modality — check ADT depth/denoising before interpreting
totalVI skipped    Fewer joint cells than totalvi.min_cells, or scvi-tools/torch unavailable    WNN remains the headline embedding; lower totalvi.min_cells only with justification (totalvi_status.json records the reason)
Milo differential abundance skipped and flagged    Fewer than two biological replicates per condition, or a single condition    Add replicates/conditions, or accept the documented skip in diffabund_status.json; DA is never fabricated
Route stops as unsupported for GLUE/StabMap    The package has no genuine guidance graph/shared bridge, model fit, or label transfer for that design    Do not install a backend and retry; use a separately validated integration workflow or implement and review the missing scientific route first
Suggested Next Steps
Confirm exploratory joint clusters, modality weights, and differential abundance in an independent replicate cohort with orthogonal annotation before treating them as validated.
Feed per-cluster RNA differential-expression results into functional-enrichment-from-degs for pathway context.
For paired RNA+ATAC, continue in scatac-multiome-analysis for WNN, peak-to-gene linking, and chromVAR on chromatin.
Treat totalVI cross-modality imputation as a hypothesis and validate against measured data; this package emits no GLUE/StabMap imputation.
Related Skills
scatac-multiome-analysis — the workflow for genuinely paired RNA+ATAC multiome; this skill stops and points there rather than duplicating its joint workflow.
scrnaseq-seurat-core-analysis / scrnaseq-scanpy-core-analysis — single-modality RNA QC, normalization, clustering, and annotation.
multi-omics-integration — MOFA+ factor analysis for bulk / general 2+ omics (this skill is single-cell).
functional-enrichment-from-degs — enrichment on per-cluster RNA differential expression.

89. small-molecule-featurization
Category: DRUG DISCOVERY
Source: https://biomni.phylo.bio/skills?section=marketplace

Small-Molecule Featurization

Computes up to three feature families for every molecule and writes one Parquet file per family, all aligned row-for-row with the input. Defaults are sound general-purpose choices. Change them when the downstream task calls for it; references/choosing-features.md explains the trade-offs.

Use the printed Skill Directory as SKILL_DIR.

1. Get the molecules into a table
Input    What to do
SMILES pasted in chat    Write them to input.csv with columns id,smiles, using any names the user gave as ids. Offer QC through the confirmation below when the list is long or looks messy (salts, charges, duplicates).
CSV, TSV, TXT (delimited, or one column with or without a header), SDF or MOL file    Load and follow molecular-dataset-qc, but replace its step-0 questions with the single confirmation below, and iterate until its status is complete. Featurize its cleaned_data/cleaned_data.parquet, which has a smiles column and the original id and metadata columns. If the user declines QC, featurize the file as given.
MOL2 file    Convert to SDF first (obabel in.mol2 -O in.sdf, or RDKit Chem.MolFromMol2File for a single molecule), then treat it as SDF. Tell the user that MOL2 atom typing can change charges or bond orders, and spot-check a few structures.
QC confirmation

Do not ask QC's step and format questions. Decide, and confirm with the family question:

Format. Use Parquet: featurize.py reads cleaned_data/cleaned_data.parquet. QC writes the other formats too, so hand them over if asked.

Steps. Inspect the columns, then recommend validity,standardize,deduplicate. Describe them by what they do:

check every structure parses;
remove salts and solvents and neutralize charges;
merge duplicate structures.

Add labels (label review) only when the user plans to model a label or property column.

Label column. When the file has an activity or property column (e.g. IC50, pKi), name it and pass it as label-col, even when label review is not selected. QC auto-detects only a column called label. Without label-col, duplicate structures with different values are merged silently and keep the first record. With it, they come back for the user's decision.

With the family question. Put the QC plan in the message text above the round-1 family question (step 2), so the user answers both at once. For example:

Before featurizing, I'll clean the dataset: check every structure parses, remove salts and neutralize charges, and merge duplicate structures. Duplicates with different IC50 values will come back to you rather than being merged. Comment if you want anything different. (family question)

Follow-up when needed. Never guess a fact QC needs that cannot be read from the file. Ask all missing facts as one free-text question (no options), in the round-2 message of step 2, or on its own if there is no round 2. For example: "Which column holds the activity values, and which columns define comparable measurements (assay, units)? Or are all values from one assay?" What can be missing:

Ambiguous label column: ask which column holds the label.
Label review without measurement context: the file has no columns that say which measurements are comparable (assay, units, conditions). Ask for those columns (context-cols), or for confirmation that every value comes from one assay (single-context).

Dropped steps. If the user drops a step, say in one line what that weakens, as QC describes. For example, deduplication without standardization does not merge salt or charge forms.

After the run. Decisions QC raises after it runs still go to the user through QC's resolution loop: duplicates with differing labels, mixtures, quarantines.

The script featurizes structures exactly as given. Standardization, salt stripping and deduplication are QC decisions, so they are made in molecular-dataset-qc, not here.

Feature rows align with the table that was featurized. After QC, that is the cleaned table, not the original upload, because QC can remove or merge rows. To map back to the upload, use qc_details/row_audit.csv from the QC run: its source_row gives the original row and status says what happened to it.

2. Choose the features

Always ask before running, in two rounds: first which families to compute, then, after that answer, which method to use for each chosen family. Never ask about a method for a family the user has not chosen.

Rules for both rounds:

Recommendation. In each question, list the recommended option first and label it "(Recommended)".
Earlier choices. If the request already named families or methods, say so in the question text (e.g. "You asked for MiniMol") and list that option first. Still ask the question.
Answers. The question UI cannot pre-tick options and requires an answer to every question shown.

Round 1: Which features should be computed? This is a single multi-select question; any combination is allowed, and the recommendation is all three. When QC runs, the QC plan goes in the message text above it. Wait for the answer before round 2.

Morgan fingerprints (Recommended): substructure bits, for similarity search and machine learning
Molecular descriptors (Recommended): named physicochemical properties, interpretable
Foundation-model embeddings (Recommended): learned vectors from a pretrained model

Round 2: Which method for each chosen family? Ask one single-select question for each family chosen in round 1, so 1 to 3 questions, recommended option first. QC follow-ups (step 1) are added as one free-text question, so round 2 never exceeds the question tool's limit of four.

Family    Options
Fingerprint    ECFP4, binary (Recommended): standard for similarity and activity models · ECFP4 counts: keeps how often each substructure occurs, often better for regression and tree models · FCFP4: pharmacophore-typed atoms, fuzzier, suits scaffold hopping · ECFP6: larger substructures, for close-analogue series
Descriptors    RDKit 2D, ~217 (Recommended): interpretable, robust default · Compact panel (10): MW, cLogP, TPSA, HBD/HBA and similar, for property plots and small models · Mordred 2D, ~1600: broad QSAR set, quick extra install
Embedding    CheMeleon, 2048-d (Recommended): strong on small property datasets, installed, fast on CPU · MiniMol, 512-d: strong on ADMET benchmarks, needs a separate environment (several minutes to set up) · MoLFormer-XL, 768-d: SMILES transformer, cannot tell stereoisomers apart

When fingerprints are chosen, add: "Fingerprints use 2048 bits and include stereochemistry; comment to change either."

Map the answers to flags; options not chosen keep their defaults:

Answer    Flags
Families (round 1)    --families with the chosen subset, e.g. --families morgan,descriptors
Fingerprint    ECFP4 binary: none · ECFP4 counts: --morgan-type count · FCFP4: --morgan-invariants feature · ECFP6: --morgan-radius 3
Descriptors    RDKit 2D: none · Compact: --descriptors compact · Mordred: --descriptors mordred
Embedding    CheMeleon: none · MiniMol: --embedding minimol plus setup below · MoLFormer: --embedding molformer
Comments    --morgan-bits 1024/4096, --no-chirality, or any combination above

Full option reference:

Family    Default    Options
Morgan fingerprint    ECFP4-like: radius 2, 2048 bits, binary, chirality on    --morgan-type count; --morgan-invariants feature (FCFP); --morgan-radius 3 (ECFP6); --morgan-bits 1024/4096; --no-chirality
Descriptors    RDKit 2D, all ~217 descriptors    --descriptors compact (MW, cLogP, TPSA, HBD, HBA, rotatable bonds, aromatic rings, Fsp3, heavy atoms, formal charge); --descriptors mordred (~1600 2D descriptors)
Embedding    CheMeleon, 2048-d    --embedding minimol (512-d); --embedding molformer (768-d)

Setup per option, installing only what is needed:

CheMeleon: runs on chemprop, which is already installed. The first run downloads chemeleon_mp.pt (about 35 MB, MIT) from Zenodo into ~/.chemprop/.

MoLFormer: runs on transformers, which is already installed. It downloads ibm-research/MoLFormer-XL-both-10pct from Hugging Face with trust_remote_code.

The script picks the model card's branch: compat-v4 on transformers 4.x, main on 5.
It resolves that branch to a commit, so weights, tokenizer and remote code load from one recorded revision.
To embed new molecules for a model trained on earlier MoLFormer features, pass that run's recorded commit with --embedding-revision <sha> (revision in featurization_summary.json). This also skips the network lookup when the weights are cached.

Mordred: uv pip install mordredcommunity.

MiniMol: it pins graphium and an older scipy, so keep it out of the session environment. Install it in its own environment and pass that interpreter:

uv venv /tmp/minimol-env --python 3.11
export VIRTUAL_ENV=/tmp/minimol-env
uv pip install "torch==2.4.0" "setuptools<81"
uv pip install "torch==2.4.0" "setuptools<81" minimol rdkit "scipy<1.15" "numpy<2" \
  torch-scatter torch-sparse torch-cluster \
  -f https://data.pyg.org/whl/torch-2.4.0+cpu.html --no-build-isolation

Then add --embedding-python /tmp/minimol-env/bin/python. These pins matter:

Torch is pinned so the PyG wheels match it.
minimol imports pkg_resources, so setuptools must stay below 81.
graphium's float16 sparse code fails on newer scipy.

If the install still fails, report the error and offer CheMeleon or MoLFormer. Never substitute another model silently.

3. Run
python3 "$SKILL_DIR/scripts/featurize.py" \
  --input input.csv \
  --output-dir /mnt/results/featurization
Option    Use
--smiles-col, --id-col    When auto-detection picks the wrong column. The id defaults to the first id-like column, then to the row number.
--color-col    Numeric input column (an activity or property) used to colour the report's feature maps.
--batch-size    Embedding batch size (default 64).
--embedding-revision    MoLFormer commit to load, to reproduce an earlier run.

The script:

Parses every row with RDKit.
Computes each selected family.
Writes the outputs below and prints the counts.

A molecule that fails to parse or to featurize keeps its row, with null features and a reason in molecules.parquet. Use a fresh output directory per run.

4. Report back

Answer with a table of the output files, giving for each what it holds, its number of columns, and how many molecules were featurized and failed (from featurization_summary.json). Point to featurization_report.html first. Also report:

rows that failed, with their reasons;
molecules with an embedding_warning: MoLFormer inputs beyond its 202-token pretraining range, which are embedded without truncation. The HTML report lists them too;
descriptors with missing or non-finite values;
the mean Morgan bit-collision rate, when it is high (above ~10%).

When QC ran, also link qc_details/qc_report.md and qc_details/row_audit.csv, and say that feature rows follow the cleaned table.

Show how to load a family for modeling:

molecules = pd.read_parquet("molecules.parquet")
features = pd.read_parquet("morgan.parquet")
keep = molecules["morgan_ok"].to_numpy()
X = features.drop(columns=["row", "id"]).to_numpy()[keep]

Join labels or predictions on row, not id, because ids can repeat. Drop rows whose <family>_ok is false before modeling.

5. PDF (on request)

Build a PDF only when the user asks for one. Load and follow pdf-report-generation with default Phylo styling, and write report_small-molecule-featurization.pdf next to the outputs.

Content: the input and QC summary, the output-file table, the methods from featurization_methods.md, the failures, and the caveats below.
Figures: export the report's PCA maps with matplotlib from the Parquet files.
Numbers: take every number from featurization_summary.json.
Outputs (under --output-dir)
File    Content
featurization_report.html    Self-contained report: counts, file guide, PCA map per family with structures on hover, descriptor histograms, failures
molecules.parquet    row, id, smiles, input metadata, parsed, parse_error, and per family <family>_ok, <family>_error and <family>_warning. Input columns that clash with these names get an input_ prefix.
morgan.parquet    row, id, fp_0000… (nullable uint8 bits, or uint32 counts)
descriptors.parquet    row, id, one float column per named descriptor
embeddings_<model>.parquet    row, id, emb_0000… (float32)
featurization_methods.md    Methods paragraph with exact settings, versions, weight sources and references, ready to paste
featurization_summary.json    Parameters, counts, input hash, software versions and model provenance
Caveats
Embeddings are frozen pretrained models, not fine-tuned. They are strong baselines for small datasets but carry no task information. Fine-tuning, for example chemprop train --from-foundation CheMeleon, belongs to a modeling workflow.
Only some families tell enantiomers apart. Checked on (R)- and (S)-lactic acid:
Morgan with chirality on and CheMeleon give different vectors. Morgan encodes CIP labels in its atom environments. CheMeleon receives chiral tags as atom features. Neither guarantees a distinct vector for every stereoisomer pair, because folding and symmetric environments can coincide.
RDKit, compact and Mordred descriptors give identical vectors. Stereocentre counts do not encode configuration.
MiniMol gives identical embeddings.
MoLFormer gives identical embeddings by design. It is fed SMILES without stereochemistry, as it was pretrained.
Undefined stereocentres are never assigned.
Folding collides environments. Folding into a fixed bit length merges distinct environments. The collision rate is in the summary.
Descriptors are raw. Values are unscaled and keep NaN or inf where RDKit or Mordred cannot compute them. Scale them and handle missing values in the downstream pipeline rather than imputing silently.
Not validated for any endpoint. No family is best for every endpoint. Compare families on the user's own task with a proper split before choosing one.
Sources
RDKit (BSD-3-Clause), https://www.rdkit.org.
Morgan generator: rdFingerprintGenerator.
Descriptors: Descriptors._descList.
ECFP/FCFP: D. Rogers and M. Hahn, J. Chem. Inf. Model. 2010, 50, 742–754.
CheMeleon: J. W. Burns et al., arXiv:2506.15792 (2025).
Code: github.com/JacksonBurns/chemeleon (MIT).
Weights: Zenodo record 15460715.
Runs on chemprop 2.2 (MIT).
MiniMol: K. Kläser et al., arXiv:2404.14986 (2024).
Code: github.com/graphcore-research/minimol (MIT).
MoLFormer-XL: J. Ross et al., Nat. Mach. Intell. 2022, 4, 1256–1264.
Model: ibm-research/MoLFormer-XL-both-10pct (Apache-2.0).
Mordred: H. Moriwaki et al., J. Cheminform. 2018, 10, 4.
Package: mordredcommunity (BSD-3-Clause).

90. spatial-transcriptomics
Category: TRANSCRIPTOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

91. survival-analysis-clinical
Category: MULTI-OMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

Clinical Survival & Outcome Analysis

Kaplan-Meier survival estimation, Cox proportional hazards regression, and risk stratification for clinical and real-world evidence (RWE) datasets.

Scope

This skill performs standard right-censored survival analysis: Kaplan-Meier estimation, Cox proportional hazards regression, Schoenfeld residual PH testing, and risk stratification via the Cox linear predictor.

What this skill does NOT do:

Competing-risks / Fine-Gray models — standard Cox treats competing events as censored, which can overestimate cause-specific event probabilities
Interval censoring — only right-censored data is supported
Multi-state / illness-death models — only a single absorbing event is modeled
Multiple imputation — the Cox model is complete-case; patients with missing covariates are excluded
External validation cohort — the C-index is computed on the same data used to fit the model (optimism-corrected via bootstrap, but no external validation is performed)
RMST (restricted mean survival time) — not implemented; use landmark rates when medians are unreliable
Time-dependent covariates as a primary model — the PH sensitivity analysis (survSplit / stratified Cox) is a diagnostic, not a replacement for the primary model
Scientific Caveats
Risk score is discovery-only. The risk score and risk groups are fitted and evaluated on the same patients. The optimism-corrected C-index is the headline discrimination metric; the apparent C-index is optimistically biased.
Breast-cancer OS with non-cancer deaths. When the endpoint is overall survival, non-cancer deaths are treated as events. This is formally a competing-risks setting; standard Cox treats them as the event of interest. Interpret OS HRs accordingly.
Cox model is complete-case. Patients with missing covariate values are excluded from the Cox model. If >20% are excluded, a warning banner is emitted. No imputation is performed.
When to Use This Skill

Use this skill when you need to:

Estimate survival curves (Kaplan-Meier) with confidence intervals and risk tables
Identify prognostic factors via Cox proportional hazards regression
Stratify patients by risk using Cox model linear predictor
Test proportional hazards assumption with Schoenfeld residuals
Compare survival between groups (molecular subtypes, treatment arms, biomarker levels)
Generate forest plots of hazard ratios for multi-covariate models

Don't use this skill for:

❌ Biomarker panel selection from omics → use elastic-net-biomarker-panel
❌ Differential expression analysis → use bulk-rnaseq-counts-to-de-deseq2
❌ Disease trajectory / longitudinal modeling → use disease-progression-longitudinal
❌ Genetic association / Mendelian randomization → use mendelian-randomization-twosamplemr
Installation

Before selecting tools or packages, review references/biomni_supported_resources.md for preinstalled packages and Biomni-native tools. Check package availability with requireNamespace(). Use Biomni LiteratureSearch when literature context or citations are needed.

The example cohort for this workflow comes from load_example_data() only. Do not substitute a cohort from cBioPortal, GEO, a TCGA API, or any other database. If no packaged dataset is usable, stop and ask the user.

options(repos = c(CRAN = "https://cloud.r-project.org"))
if (!require('BiocManager', quietly = TRUE)) install.packages('BiocManager')

# Core (required)
install.packages(c('survival', 'ggplot2', 'ggprism', 'scales'))

# Enhanced KM curves with risk tables (recommended)
install.packages('survminer')

# Example data: TCGA BRCA (optional, needed for tcga_brca demo)
BiocManager::install('RTCGA.clinical')

Software    Version    License    Commercial Use    Installation
survival    >=3.5    LGPL (>=2)    ✅ Permitted    install.packages('survival')
ggplot2    >=3.4    MIT    ✅ Permitted    install.packages('ggplot2')
ggprism    >=1.0.3    GPL (>=3)    ✅ Permitted    install.packages('ggprism')
scales    >=1.2    MIT    ✅ Permitted    install.packages('scales')
survminer    >=0.4.9    GPL (>=2)    ✅ Permitted    install.packages('survminer')
Inputs

Required:

Clinical data with columns for:
Time-to-event (numeric: days, months, or years)
Event indicator (binary: 0 = censored, 1 = event)
Minimum 50 patients recommended (20+ events for reliable Cox estimates)

Optional:

Stratification variable (e.g., molecular subtype, treatment arm, biomarker group)
Covariates for Cox model (age, stage, receptor status, etc.)
Pre-computed risk scores from upstream skills (e.g., elastic-net-biomarker-panel)

Formats: CSV/TSV with headers, or R data frame

Outputs

Each analysed endpoint gets its own results/<endpoint>/ subdirectory (e.g. results/OS/, results/RFS/) containing the full set of artifacts below; the final PDF (see Reports) combines all endpoints. Paths below are shown relative to one endpoint's subdirectory.

Primary results:

cox_coefficients.csv — Hazard ratios with 95% CI and p-values for all covariates
risk_scores.csv — Patient-level risk scores and risk group assignments
clinical_annotated.csv — Full clinical data with added risk group column
survival_summary.csv — Summary statistics per risk group (N, events, event rate, median survival)
ph_assumption_test.csv — Schoenfeld residual test results (chi-sq, p-value per covariate)
key_metrics.csv — Single-row headline metrics table (all N, HR, C-index, p-values, reference levels in one row — the canonical source for report numbers)
reference_levels.csv — Covariate reference levels and the selection rule that chose them
missingness_assessment.csv — Per-covariate missingness counts and informative-missingness Fisher test
ph_sensitivity.csv — Time-varying coefficient sensitivity analysis (generated only when global PH test p < 0.05)

Analysis objects (RDS):

survival_model.rds — Complete analysis object for downstream use
Load with: model <- readRDS('results/<endpoint>/survival_model.rds') (e.g. results/OS/survival_model.rds)
Contains: KM fits, Cox model, PH test, risk groups, clinical data, metadata
Access risk scores: model$cox$risk_scores
Access Cox model: model$cox$model
Required for: elastic-net-biomarker-panel (risk scores as features), downstream integration

Plots (PNG + SVG):

km_overall.png/.svg — Overall Kaplan-Meier curve with confidence interval
km_stratified.png/.svg — Stratified survival curves with log-rank p-value
forest_plot.png/.svg — Forest plot of hazard ratios with significance markers
km_risk_groups.png/.svg — Risk group survival curves with log-rank test
schoenfeld_diagnostics.png/.svg — PH assumption diagnostic plots
cumulative_hazard.png/.svg — Cumulative hazard function

Reports:

survival_report.md — Markdown summary of one endpoint's results, written into that endpoint's results/<endpoint>/ subdirectory; the machine-readable source the PDF is assembled from (one per analysed endpoint).
survival_report.pdf — Use the pdf-report-generation skill to generate a pdf report with infographics (use the Biomni GenerateImage tool), methods, results, conclusions, figures, references, and next steps from all of the analyses.
Clarification Questions

🚨 ALWAYS ask Question 1 FIRST.

1. Example or Own Data? (ASK THIS FIRST):
a) Rotterdam Breast Cancer (recommended)
2,982 patients with overall survival (OS) and recurrence-free survival (RFS) endpoints, grade, tumor size, nodal status, hormone/chemotherapy, ER/PGR
Ships with the survival R package — no download, runs instantly
b) TCGA Breast Cancer (requires RTCGA.clinical)
1,100+ patients with overall survival, molecular subtypes, stage, age, ER/PR/HER2 status
Requires download (~50MB via RTCGA.clinical, frequently unavailable). If the package is missing, the loader errors with a named fallback to load_example_data(dataset = "rotterdam")
c) NCCTG Lung Cancer (quick demo, no download)
228 advanced lung cancer patients, sex stratification, ECOG performance status
Built-in R dataset — runs instantly
d) I have my own clinical data to analyze
Continue to Questions 2-3 below

IF EXAMPLE SELECTED (option a, b, or c): Proceed to Question 2 for analysis options. Skip Question 3.

2. Analysis Options (structured — for all datasets):
Endpoint(s)? (analysed automatically — not a single choice)
Rotterdam carries two endpoints (OS and RFS); both are analysed and presented together in one report. The workflow never analyses just one endpoint when the cohort carries more than one. OS = death from any cause; RFS = recurrence or death, whichever comes first. (TCGA BRCA and Lung carry overall survival only.)
Stratification variable?
a) Default for dataset (grade for Rotterdam, mol_subtype for TCGA BRCA, sex for Lung)
b) Stage
c) Age group
Risk stratification method?
a) Median split — 2 groups (recommended)
b) Tertiles — 3 groups
c) Quartiles — 4 groups
3. Data Details (own data only — free-text OK):
What is the time column name? Units (days/months/years)?
What is the event column name? What does 1 represent (death/relapse/progression)?
What stratification variable? What covariates for the Cox model?
Standard Workflow

🚨 MANDATORY: USE SCRIPTS EXACTLY AS SHOWN - DO NOT WRITE INLINE CODE 🚨

Analyse every endpoint the cohort carries. A cohort may define more than one time-to-event endpoint (Rotterdam carries both OS and RFS). Derive the set from the data with available_endpoints(dataset) and analyse each endpoint — never silently pick one. Each endpoint's outputs are written to its own results/<endpoint>/ subdirectory, and the final report (Step 5) presents all endpoints together. If an endpoint is ever skipped (e.g. genuinely too expensive), state which was run, which was skipped, and why — these example cohorts are small, so run them all. All results/... paths in the sections below refer to each endpoint's results/<endpoint>/ subdirectory.

Step 1 - Enumerate endpoints and identify the cohort: The endpoint definition determines what each hazard ratio means — an OS HR estimates the risk of death from any cause, while an RFS HR estimates the risk of recurrence or death. Analysing both when both exist answers the full clinical question instead of half of it.

source("scripts/load_example_data.R")

dataset   <- "rotterdam"                    # or "tcga_brca" / "lung"
endpoints <- available_endpoints(dataset)   # derived from the data, e.g. c("OS", "RFS")
# Own data: set endpoints to the time/event pair(s) you have and load with
#   load_user_data("path/to/clinical.csv", time_col = "time", event_col = "status")
# inside the loop below (one iteration per endpoint).

DO NOT write custom data loading code. Use the loader functions.

✅ VERIFICATION: endpoints lists every endpoint the cohort carries (Rotterdam: OS, RFS).

Steps 2-4 - Analyse, visualize, and export EACH endpoint: Loop over the endpoints; for each, run the survival analysis, generate all plots, and export all artifacts into that endpoint's results/<endpoint>/ subdirectory. The Cox model assumes proportional hazards — that the hazard ratio between any two patients is constant over time; the workflow tests this automatically and, when violated, runs a time-split and stratified sensitivity analysis. Reference levels for categorical covariates are selected by clinical convention (not largest group), so HRs are interpretable relative to the clinically standard baseline (e.g., low grade, no treatment). Exporting produces the canonical CSVs (key_metrics, reference_levels, missingness_assessment) the report must cite — every N, HR, CI, p-value, and C-index is copied from these files, never recomputed from memory. The consistency gate verifies row-count invariants before the export token is printed.

source("scripts/basic_workflow.R")
source("scripts/survival_plots.R")
source("scripts/export_results.R")

results <- list()
for (ep in endpoints) {
    data   <- load_example_data(dataset = dataset, endpoint = ep)
    result <- run_survival_analysis(data)
    # Optional: run_survival_analysis(data, risk_strata_method = "tertiles")
    # Optional: run_survival_analysis(data, covariates = c("age", "stage"))

    outdir <- file.path("results", ep)      # e.g. results/OS, results/RFS
    generate_all_plots(result, output_dir = outdir)
    export_all(result, output_dir = outdir)
    results[[ep]] <- result
}

DO NOT write inline Cox/KM code (coxph, survfit), inline plotting code (ggsave, ggplot, ggsurvplot), or custom export code. Source the scripts and call the functions.

The plotting script handles PNG + SVG export with graceful fallback for SVG dependencies.

✅ VERIFICATION (per endpoint): For each endpoint you MUST see:

"✓ Survival analysis completed successfully!"
"✓ All survival plots generated successfully!"
"=== Export Complete ==="

❌ IF YOU DON'T SEE THESE: You wrote inline code, or skipped an endpoint. Stop, use source(), and analyse every endpoint in endpoints.

⚠️ CRITICAL - DO NOT:

❌ Analyse only one endpoint when the cohort carries several → STOP: loop over available_endpoints(dataset)
❌ Write inline Cox/KM code (coxph, survfit) → STOP: Use source("scripts/basic_workflow.R")
❌ Write inline plotting code (ggsave, ggplot, ggsurvplot) → STOP: Use generate_all_plots()
❌ Write custom export code → STOP: Use export_all()
❌ Try to install svglite → script handles SVG fallback automatically

⚠️ IF SCRIPTS FAIL - Script Failure Hierarchy:

Fix and Retry (90%) - Install missing package, re-run script
Modify Script (5%) - Edit the script file itself, document changes
Use as Reference (4%) - Read script, adapt approach, cite source
Write from Scratch (1%) - Only if genuinely impossible, explain why

NEVER skip directly to writing inline code without trying the script first.

Step 5 - Generate final report (MANDATORY terminal step — the run is not complete until this has happened): Use the pdf-report-generation skill to generate a pdf report with infographics (use the Biomni GenerateImage tool), methods, results, conclusions, figures, references, and next steps from all of the analyses.

Every number in the report MUST be copied from each endpoint's results/<endpoint>/key_metrics.csv, results/<endpoint>/reference_levels.csv, or the other exported CSVs — never recomputed from memory.

✅ VERIFICATION: A PDF report exists in the output directory.

Common Issues
Error    Cause    Fix
"No valid covariates found"    All columns have >20% missing or single value    Provide covariates explicitly: run_survival_analysis(data, covariates = c("age", "stage"))
"Cox model failed with all covariates"    Collinear or non-convergent covariates    Script auto-falls back to stepwise. Inspect individual p-values.
PH assumption violated (global p < 0.05)    Time-varying effects    Note in report. Consider stratified analysis. See references/cox-regression-guide.md.
"Event column must be binary (0/1)"    Non-standard event coding    Recode: e.g., survival::lung uses 1=censored, 2=dead → script handles this.
RTCGA.clinical unavailable    Package not installed / download blocked    Use dataset = "rotterdam" (breast cancer, 2,982 patients, no download) or dataset = "lung" as fallback.
SVG export failed    Missing optional dependency    Normal — generate_all_plots() falls back automatically. PNG always generated.
KM curve drops steeply despite low event rate    Heavy censoring (correct behavior)    NOT A BUG. With heavy censoring (e.g., 90% censored), the at-risk set shrinks so each late event causes a large survival drop. The KM tail (N at risk < 30) is unreliable. Report landmark survival rates instead.
Subtype medians have upper CI = NA    KM never crosses 50% for that group    The median is an unreliable extrapolation. The script flags this — use landmark rates instead. Do NOT report these medians as reliable point estimates.
Agent Summary Guidelines

When presenting final results to the user, the agent MUST:

Read results/key_metrics.csv and results/reference_levels.csv. Every N, HR, CI, p-value, C-index, and reference level in the report MUST be copied from those files or from the other exported CSVs (cox_coefficients.csv, survival_summary.csv, ph_assumption_test.csv, missingness_assessment.csv, ph_sensitivity.csv). If a number is not in a file, re-run the relevant step. Do NOT estimate, round from memory, or recalculate.
Never fabricate survival curve descriptions — reference the actual generated plots
Never report unreliable medians as if they are reliable — when key_metrics.csv shows median_reliable = FALSE, report "Median survival: Not reached" and use landmark survival rates instead
Methods section MUST match actual model — list only covariates from cox_coefficients.csv. Check key_metrics.csv for n_dropped_covariates and report what was excluded and why. NEVER list covariates from memory.
Report informative missingness — if missingness_assessment.csv has any row with informative = TRUE, report the event rate comparison prominently and note selection bias risk
Report follow-up anomalies — if result$diagnostics$followup_anomaly is TRUE, investigate and explain prominently. Do NOT dismiss as "expected" without evidence.

⚠️ CRITICAL REPORTING RULES:

EPV < 10 + C-index: If key_metrics.csv shows epv < 10, you MUST describe the C-index as "potentially overfitted" or "unreliable". NEVER use "good" or "moderate discrimination" without this caveat. The C-index is optimistically biased when EPV is low. Report the optimism-corrected C-index as the headline.
PH violation + forest plot/Cox table: If key_metrics.csv shows ph_violated = TRUE, you MUST include a prominent warning on the forest plot caption AND any Cox results table: "PH assumption violated (p=X) — HRs represent time-averaged effects and may be misleading." Do NOT present HRs as primary findings without this warning.
Small reference groups: If reference_levels.csv shows a reference group with N < 50, flag the estimate as unstable. State the reference group N explicitly.
Complete-case warning: If key_metrics.csv shows complete_case_warning = TRUE, report that >20% of patients were excluded due to missing covariates and note the selection bias risk.
Never fabricate group sizes or statistics. All Ns, HRs, CIs, and p-values in the report text MUST be copied from the exported CSV files. If a number is not in a file, re-run the relevant step.
Interpretation Guidelines
C-index > 0.7: Good model discrimination — ONLY if EPV >= 10. If EPV < 10, say "potentially overfitted (EPV = X)"
C-index 0.6-0.7: Moderate — useful combined with clinical factors
C-index ~ 0.5: No better than chance
HR > 1: Higher hazard (worse prognosis) per unit increase
HR < 1: Lower hazard (protective effect)
HR 95% CI includes 1.0: Not statistically significant
PH global p < 0.05: Proportional hazards assumption violated — HRs are time-averaged and may be misleading. Must be stated prominently on forest plots and Cox tables, not buried in a later section.
EPV < 10: Model underpowered — C-index likely optimistically biased; consider fewer covariates. NEVER call the C-index "good" when EPV < 10.
Median survival "Not reached": KM curve never crosses 50% — use landmark survival rates instead
Low event rate (<15%): KM curves may drop steeply in the tail due to small at-risk set (heavy censoring), not because most patients die. Always check N at risk at each timepoint.
Median follow-up < 2 yr with max obs > 5 yr: Likely a data quality artifact — investigate completeness of follow-up times for censored patients before interpreting results.
Suggested Next Steps
Biomarker panel discovery — Use risk scores as features → elastic-net-biomarker-panel
Pathway enrichment — If molecular subtypes differ → functional-enrichment-from-degs
Multi-omics integration — Combine clinical + omics → multi-omics-integration-mofa
Disease trajectory — Map temporal progression → disease-progression-longitudinal
Clinical trial landscape — Search related interventional trials → clinicaltrials-landscape
Related Skills
Skill    Relationship
elastic-net-biomarker-panel    Downstream — Use risk scores as features for biomarker selection
disease-progression-longitudinal    Complementary — Trajectory analysis on same clinical data
multi-omics-integration-mofa    Upstream — Factor scores as Cox covariates
bulk-rnaseq-counts-to-de-deseq2    Upstream — DE results inform covariate selection
coexpression-network    Upstream — Module eigengenes as survival predictors
References
Cox DR. Regression Models and Life-Tables. J R Stat Soc B. 1972;34(2):187-220.
Kaplan EL, Meier P. Nonparametric Estimation from Incomplete Observations. JASA. 1958;53(282):457-481.
Cancer Genome Atlas Network. Comprehensive molecular portraits of human breast tumours. Nature. 2012;490:61-70.
Loprinzi CL, et al. Prospective evaluation of prognostic variables from patient-completed questionnaires. J Clin Oncol. 1994;12:601-607.
Therneau TM. A Package for Survival Analysis in R. R package survival.
See references/cox-regression-guide.md for detailed Cox PH interpretation
See references/risk-stratification-guide.md for risk group methodology
See references/biomni_supported_resources.md for Biomni-native tools, queryable databases, data-lake datasets, and preinstalled packages

92. synthesizability-and-building-block-scoring
Category: MOLECULAR DESIGN
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

93. target-tractability-druggability
Category: DRUG DISCOVERY
Source: https://biomni.phylo.bio/skills?section=marketplace

Target Tractability & Druggability Assessment

Given a human protein-coding target, this skill answers a focused drug-discovery question: is it druggable, and by which modality? It composes existing evidence sources into one reproducible verdict:

Open Targets tractability buckets (per modality), essentiality (DepMap), known drugs / clinical precedent, and safety liabilities.
Structural pocket analysis with fpocket on the best experimental structure (auto-selected from the PDB), falling back to the AlphaFold model, then skipping gracefully if neither exists.
LiteratureSearch for the modality/mechanism context that databases miss.
A transparent, target-agnostic modality scorecard (0-3 per dimension) that names the most viable modality and the emerging frontier.
A Phylo-branded PDF report (infographic + intro + methods + results + figures
conclusions + references + next steps).

This is a "search + compose" skill: it queries the Open Targets Platform GraphQL API directly (via opentargets_druggability.py), reuses the DepMap sign convention documented in the gene-essentiality skill, and ships its own reportlab-based PDF builder (build_druggability_report.py) inspired by the pdf-report-generation skill pattern rather than invoking that skill as a subprocess. The thin helper scripts handle only the fiddly, bug-prone parts (Open Targets v26+ drug query, structure retrieval/cleaning, fpocket parsing, scorecard, figures, PDF). LiteratureSearch and GenerateImage are used as Biomni-native tools in Steps 5 and 7.

When to Use This Skill

Use it when the user wants a druggability / tractability verdict for a specific human protein-coding target, e.g.:

"Is KRAS druggable? Which modality?"
"Assess EGFR / PCSK9 / BCL2 tractability across modalities."
"Does this target have a druggable pocket?"
"Small molecule vs antibody vs degrader for TARGET X?"
"Give me a druggability report for TARGET, in the context of DISEASE."

Scope — this skill is ONLY for human protein-coding targets. Do not use it for:

Non-human targets (mouse, pathogen, viral proteins) — Open Targets tractability and DepMap are human-centric.
Non-protein targets (RNA, lipids, metabolites) — the pocket/tractability model does not apply.
Disease-first questions ("what are the best targets for disease X?") — use the open-targets skill's associatedTargets query first to pick a target, then bring it here.
Bulk screening of hundreds of targets — this is a per-target deep dive. For systematic extraction use Open Targets FTP/BigQuery downloads.

If the target is not protein-coding (check biotype from step 1), stop and tell the user rather than forcing a druggability call.

Inputs

Required:

A target identifier: gene symbol (e.g. EGFR) or Ensembl gene ID (e.g. ENSG00000146648). The symbol is resolved automatically.

Optional:

--disease "<name>" or --efo <EFO/MONDO id> — adds the target-disease association score for disease context. The core assessment is target-centric and works without it.
--pdb <ID> — force a specific PDB structure instead of auto-selecting.
Modality focus — by default all Open Targets modalities are assessed; narrow in the narrative only if the user asks.
Outputs

Everything the user should see goes under /mnt/results/:

report_<SYMBOL>_druggability.pdf — the primary deliverable.
<SYMBOL>_druggability.json — Open Targets evidence bundle.
<SYMBOL>_scorecard.json — per-modality scores + most-viable / frontier verdict.
<SYMBOL>_pockets.json — fpocket results (if a structure was available).
figures (*_tractability_buckets, *_pocket_druggability, *_modality_scorecard, plus the generated infographic) as .png + .svg.

Write intermediate/scratch files to /workspace/ first, then copy finished deliverables to /mnt/results/.

Reference Docs (read before running)
references/opentargets_tractability.md — what each tractability bucket means per modality, the interpretation rubric, the antibody-intracellular deal-breaker, and Open Targets field-name stability warnings.
references/structure_and_pockets.md — structure source priority, RCSB/AlphaFold endpoints, PDB cleaning, running fpocket, the critical fpocket 1-indexing gotcha, and the druggability-score guide.
references/scorecard_rubric.md — the 0-3 scoring dimensions and how the verdict (most viable modality + frontier) is derived.
Workflow

Run the scripts in order. All paths below assume the skill dir is SKILL=/mnt/skills/user/target-tractability-druggability (adjust if staged elsewhere) and a working dir W=/workspace. Replace EGFR with the real target.

Step 0 — Environment check (once)

fpocket is required for the structural step. It is usually preinstalled (/opt/conda/bin/fpocket). If missing:

conda install -n base -y -c conda-forge -c bioconda fpocket

If fpocket cannot be installed, the skill still runs — the structural section is skipped with an explicit note.

Step 1 — Open Targets evidence

Resolves the symbol, pulls all-modality tractability, DepMap essentiality, known drugs, safety liabilities, and (optionally) a disease association.

python $SKILL/scripts/opentargets_druggability.py \
  --target EGFR \
  --out $W/EGFR_druggability.json
# optional disease context:
#   --disease "lung carcinoma"   (or --efo EFO_0001071)

Check target.biotype in the output. If it is not protein_coding, stop and tell the user this skill does not apply. Also note data_version (report which Open Targets release the numbers came from).

Step 2 — Structure retrieval (auto PDB -> AlphaFold)

Selects the best experimental structure for the target's UniProt accession (prefers ligand-bound, high-resolution), classifies bound ligands by heavy-atom count (a robust, target-agnostic way to find a drug-like reference ligand), and cleans a single chain for fpocket. Falls back to the AlphaFold model if no suitable PDB exists.

# 2a. pick + download the best structure (uniprot comes from step 1 output)
python $SKILL/scripts/fetch_structure.py \
  --uniprot P00533 \
  --outdir $W/EGFR_struct \
  --alphafold-fallback \
  --out $W/EGFR_struct.json

# 2b. clean the chosen structure for fpocket (chosen.pdb_path + keep_ligand
#     come from EGFR_struct.json; keeps the drug-like ligand as the reference)
python $SKILL/scripts/fetch_structure.py \
  --clean $W/EGFR_struct/<chosen>.pdb \
  --keep-ligand FMM \
  --clean-out $W/EGFR_struct/EGFR_holo.pdb \
  --out $W/EGFR_struct_clean.json

The clean step reports the reference-ligand centroid — pass it to fpocket so pockets can be labelled "drug/ligand-engaged" vs "distinct/allosteric-type" generically (no hardcoded residues).

If source == "none" (no PDB and no AlphaFold), skip Step 3 and record that the structural analysis was not possible.

Step 3 — Pocket detection with fpocket
python $SKILL/scripts/run_fpocket.py \
  --pdb $W/EGFR_struct/EGFR_holo.pdb \
  --ref-ligand-centroid 17.182 33.932 38.428 \
  --label "EGFR (1XKK, holo)" \
  --out $W/EGFR_pockets.json

Optional apo/holo contrast: pass a second cleaned structure via --pdb-holo to detect cryptic pockets (a large apo->holo jump in druggability score signals a pocket that only opens on ligand binding — a key finding for "undruggable"-looking targets). Druggability score guide: >0.5 druggable, 0.2-0.5 borderline, <0.2 poorly druggable.

Step 4 — Modality scorecard

Combines tractability + structure + clinical precedent into a 0-3 score per modality and names the verdict. Antibodies against a target with no surface-accessibility evidence are forced to 0 (deal-breaker).

python $SKILL/scripts/compute_scorecard.py \
  --ot $W/EGFR_druggability.json \
  --pockets $W/EGFR_pockets.json \
  --out $W/EGFR_scorecard.json

Output gives most_viable (best modality) and frontier (best emerging modality among those not yet clinically mature) — see references/scorecard_rubric.md.

Step 5 — Literature context (LiteratureSearch tool)

Use the LiteratureSearch tool (not a script) to gather real, citable evidence for the narrative and references. Run a few targeted queries, e.g.:

"<TARGET> druggability" / "<TARGET> small molecule inhibitor"
"<TARGET> antibody therapy" / "<TARGET> PROTAC degrader"
"<TARGET> allosteric OR cryptic pocket"
"<TARGET> <disease>" when a disease context was given

Collect the real citations (authors, year, journal) for the report's reference list. Never invent citations — the report builder only prints references you pass to it.

Step 6 — Figures
python $SKILL/scripts/make_figures.py \
  --ot $W/EGFR_druggability.json \
  --pockets $W/EGFR_pockets.json \
  --scores $W/EGFR_scorecard.json \
  --outdir $W/EGFR_figs

Produces three data figures (tractability matrix, pocket druggability bars, modality scorecard) as .png + .svg.

Step 7 — Infographic (GenerateImage tool)

Use the GenerateImage tool to create a one-page summary infographic (a left-to-right pipeline: TARGET -> TRACTABILITY -> STRUCTURE+POCKET -> VERDICT, plus a modality verdict strip). Fill the labels with the real numbers from steps 1-4. Save as <SYMBOL>_infographic.png. Verify it with a direct visual inspection using ordinary Read before embedding. (AI-rendered text can garble the Ångström symbol — an ASCII "A" for Å in the image is acceptable.)

Step 8 — Build the PDF report

Write a report_config.json (see the schema the script prints and the EGFR example below), then:

python $SKILL/scripts/build_druggability_report.py --config $W/EGFR_report_config.json
cp $W/report_EGFR_druggability.pdf /mnt/results/report_EGFR_druggability.pdf

The config wires together the JSON outputs, the figures, the infographic, the narrative text (which you write from the evidence + literature), the real references, and the optional disease. The builder validates page count and text extractability. Always run a direct visual inspection using ordinary Read on the final PDF and fix any defects before delivering.

Report config schema (Step 8)
{
  "target_symbol": "EGFR",
  "ot_json":       "/workspace/EGFR_druggability.json",
  "pockets_json":  "/workspace/EGFR_pockets.json",
  "scores_json":   "/workspace/EGFR_scorecard.json",
  "disease":       null,
  "figures": {
    "tractability": "/workspace/EGFR_figs/fig1_tractability_buckets.png",
    "pockets":      "/workspace/EGFR_figs/fig2_pocket_druggability.png",
    "scorecard":    "/workspace/EGFR_figs/fig3_modality_scorecard.png",
    "infographic":  "/mnt/results/EGFR_infographic.png"
  },
  "narrative": {
    "executive_summary": "...",
    "intro": "...",
    "tractability_note": "...",
    "structure_context": "...",
    "modality_discussion": "...",
    "caveats": ["...", "..."],
    "next_steps": ["...", "..."]
  },
  "references": [
    {"n": 1, "text": "Author et al. Journal Year. Title."}
  ],
  "out": "/workspace/report_EGFR_druggability.pdf"
}

caveats and next_steps may be a list of strings or a single string. Omit any figure key that does not exist (e.g. no pockets when the structure step was skipped) — the builder degrades gracefully.

Mandatory caveats (include in every report)

The report builder ships a default caveats block; keep it and add target-specific ones. Always communicate:

Open Targets tractability buckets are heuristic flags, not proof a program will succeed. Field names change between releases — always state the data version.
fpocket scores are geometry- and conformation-dependent. A high score on a drug-bound crystal partly reflects the pocket being captured open; a low apo score does not rule out a cryptic pocket.
AlphaFold-model pockets (fallback) are less reliable than experimental ones.
The known-drugs list is a snapshot, not an exhaustive competitive landscape.
A favourable pocket/tractability signal is a hypothesis for experimental follow-up, not a validated druggable site.
Antibodies require surface accessibility. An intracellular target with no accessibility evidence is not antibody-tractable regardless of other signals.
Interpretation notes
DepMap sign convention (from gene-essentiality): negative gene-effect = essential. More negative = more essential. Do not flip this.
Most viable vs frontier: "most viable" is the highest-scoring modality overall (often the clinically mature one); "frontier" is the most promising emerging modality (e.g. a degrader for a target only drugged by small molecules today). Report both — the frontier is usually the more interesting scientific insight.
Cryptic-pocket story: if the orthosteric/effector surface scores poorly but a ligand-engaged or apo->holo pocket scores high, that is the headline — it explains how a "flat, undruggable" target became druggable.
Worked examples (illustrative — do not hardcode these numbers)

KRAS (the canonical hard target). The WT effector-binding surface is shallow (fpocket ~0.195, poorly druggable), but a WT allosteric α3/loop7 pocket scores ~0.646, and the mutant G12C switch-II pocket scores ~0.838 apo and ~0.993 when sotorasib-bound. Verdict: small molecule = most viable (High, driven by covalent G12C drugs); degrader = emerging frontier (Medium); antibody = not viable (None, intracellular). This is the cryptic/allosteric-pocket story in action.

EGFR (a well-drugged receptor kinase). Small molecule and antibody both clear clinical-precedent buckets; the ectodomain is surface-accessible (so antibodies are viable, unlike KRAS). The best structure (PDB 1XKK, 2.4 Å, bound to lapatinib/FMM) yields a druggable ATP-site pocket (fpocket ~0.981). Verdict: small molecule = most viable (High), antibody = High, degrader = emerging.

Common pitfalls
Forcing a verdict on a non-protein-coding or non-human target. Check biotype; refuse politely if out of scope.
fpocket 1-indexing. Pocket files start at pocket1 (there is no pocket0). Parse the integer from the filename directly — do not add an offset. See references/structure_and_pockets.md.
Trusting RCSB REST ligand flags. They are unreliable; classify ligands by heavy-atom count from coordinates (the fetch_structure.py approach).
Inventing citations. Only pass references gathered via LiteratureSearch.
Skipping the visual inspection on figures and the final PDF.

94. targeted-degrader-design
Category: MOLECULAR DESIGN
Source: https://biomni.phylo.bio/skills?section=marketplace

Targeted Degrader (PROTAC) Design

Design and triage bifunctional degraders against a protein target with a workflow that keeps genuinely computed results (chemistry, docking, ADMET) explicitly separate from precedent-reasoned heuristics (candidate prioritization). The single most important habit this skill enforces: never present a prioritization score as a calibrated potency prediction.

Scope
Does: target/E3/warhead/linker selection, warhead docking for exit-vector analysis, combinatorial RDKit assembly of a degrader library, physicochemical / bRo5 + ADMET profiling, transparent multi-component prioritization scoring, a branded PDF report, and (advanced) ternary-complex structural modeling.
Does NOT: predict absolute DC50 / Dmax; model degradation kinetics or ubiquitin transfer; guarantee synthetic accessibility of assembled linkages; perform de novo molecular-glue discovery (a distinct problem — see the ternary tier and references/ternary_modeling.md for how glues differ).
Inputs
A target (gene/protein name or ChEMBL/UniProt ID). If unspecified, ask; do not silently pick one.
Optional user constraints: E3 ligase(s), warhead source, linker preferences, oral vs non-oral intent.
Optional: a target PDB structure (or let the skill choose one from RCSB).
Outputs (save under /mnt/results/<TARGET>_PROTAC/)
tables/ — building blocks, full library + descriptors, ADMET-merged, scored, shortlist, reference degraders (all CSV).
figures/ — building blocks, docking pose, property envelope, ADMET heatmap, score decomposition, shortlist structures, linker trends (PNG + SVG).
data/ — receptor/pocket files, ADMET raw log, score weights, envelope JSON.
report_<TARGET>_PROTAC_design.pdf — Phylo-branded report (see the pdf-report-generation skill for the template).
Environment (verified Biomni tools)

Confirm availability before relying on any tool. The following are in the Biomni catalog / installed and are the intended engines for this skill:

Purpose    Tool    Notes
Cheminformatics    RDKit    assembly, descriptors, substructure QC
Docking (warhead)    AutoDock Vina (CLI vina), AutoSite, pyscreener    pocket detection + docking
Receptor/ligand prep    ADFR Suite (prepare_receptor/prepare_ligand)    PDBQT prep — prohibited for commercial use: the MGLTOOLS SOFTWARE LICENSE AGREEMENT states "The programs received by you will be used only for NON COMMERCIAL purposes" and defines commercial usage as "revenues generating activities... using this software for consulting activities and selling applications built on top of, or using this software." Free for academic/non-commercial use only. A commercial license from Scripps Research / Michel Sanner is required for any commercial deployment, or substitute an open-source PDBQT-prep alternative (e.g. Meeko, OpenBabel, or RDKit-based prep).
ADMET    DeepPurpose (Python package, pip install deeppurpose; from deeppurpose import ...)    16 endpoints from SMILES. Note: predict_admet_properties is not exported by biomni.tool — use the DeepPurpose package directly.
Descriptors/ML    descriptastorus, deeppurpose    feature generation
Target / bioactivity    ChEMBL, PubChem (REST), RCSB PDB    IDs, SMILES, structures
Report    reportlab    PDF (via pdf-report-generation skill)
Ternary (advanced)    boltz-2, chai-1, boltzgen (HPC)    see ternary tier

PubChem SMILES note (2025 schema): the property field was renamed. Request SMILES by trying, in order: IsomericSMILES, SMILES, ConnectivitySMILES, CanonicalSMILES — older code that only asks for CanonicalSMILES returns empty.

FUSE write note: AutoDock receptor/ligand prep and any random-access binary writes fail on /mnt/results/ and /mnt/shared-workspace/. Do prep in /workspace/, then copy finished files to /mnt/results/. R's file.copy() produces 0-byte files on /mnt/results/ — use a shell cp instead.

External Data Sources & Licenses

This skill retrieves data from public scientific databases. Record and honor each source's license — some are public-domain/CC0 (no obligations), but others are CC BY-SA, which permits commercial use only if you provide attribution and share any derived/redistributed data under the same license (share-alike). See DATA_SOURCES.md for the full detail; the summary table is below.

Data source    Used in skill for    License    Commercial use    Obligations
ChEMBL (EMBL-EBI)    Target confirmation (ChEMBL IDs), bioactivity, SMILES    CC BY-SA 3.0    Yes    Attribution + share-alike required. Credit ChEMBL/EMBL-EBI and license any redistributed or derived dataset under CC BY-SA 3.0.
Human Protein Atlas (HPA)    Normal-tissue expression / selectivity context (when tissue-selectivity or off-tissue liability is assessed)    Current: CC BY 4.0; archived/versioned data (older releases): CC BY-SA 3.0    Yes    Credit the Human Protein Atlas (proteinatlas.org) + a primary HPA publication. Attribution required; share-alike applies if you use CC BY-SA-era (archived/versioned) HPA data — verify the license of the exact HPA release you pull, since it changed from CC BY-SA 3.0 to CC BY 4.0.
PubChem (NCBI)    Warhead / E3-ligand / reference-degrader SMILES    Public domain (U.S. Gov / NCBI; works are not copyrighted)    Yes    No license restriction; attribution appreciated as good practice.
RCSB PDB    Target 3D structures for docking    Public domain / CC0 1.0    Yes    No restriction; cite the specific PDB ID(s) and primary depositors as good practice.
UniProt    Target identity / accession cross-reference    CC BY 4.0    Yes    Attribution required (no share-alike).
Literature metadata (LiteratureSearch / DOIs)    Precedent degraders (E3, warhead, exit vector, DC50/Dmax)    Per-publisher (metadata generally reusable)    Varies    Cite each work by DOI; do not redistribute full-text beyond fair use.

Attribution + share-alike (CC BY-SA) — explicit note (mandatory). ChEMBL is CC BY-SA 3.0 and the Human Protein Atlas is CC BY-SA for its archived/versioned releases (its current release is CC BY 4.0). Both resources permit commercial use. For any CC BY-SA data you must (1) attribute the source, and (2) share-alike — any dataset you derive from or redistribute that incorporates CC BY-SA data must itself be licensed under the same CC BY-SA terms. This is "viral" for a redistributed dataset, so if you export a table that embeds ChEMBL (or CC BY-SA-era HPA) values, carry the CC BY-SA license and attribution with it. For CC BY 4.0 data (current HPA, UniProt), attribution is required but there is no share-alike obligation — always verify the license of the exact HPA release you pull, since HPA changed from CC BY-SA 3.0 to CC BY 4.0. Public-domain/CC0 sources (PubChem, RCSB PDB) carry no obligation. ChEMBL caveat: some ChEMBL fields are compound-property calculations derived from commercial software and carry additional restrictions (e.g., do not extract them in isolation to replicate the commercial process) — this skill uses ChEMBL only for target IDs / SMILES / bioactivity, not those restricted calculations. This is a data-license matter, separate from the software-dependency licenses (RDKit BSD-3-Clause, AutoDock Vina Apache 2.0, OpenBabel GPL-2.0, ADMET-AI/Chemprop, ReportLab BSD) and from the ADFR Suite's non-commercial restriction documented above.

Core Workflow
1. Target & precedent dossier

Confirm the target ID in ChEMBL. Search the literature for existing degraders of the target using the Biomni LiteratureSearch tool (not generic web search): capture the E3 used, warhead chemotype, exit vector, and any reported DC50/Dmax for each precedent. These facts drive warhead/E3/exit-vector choices downstream. Record every precedent with a citation (DOI).

LiteratureSearch visibility guardrail — mandatory. The LiteratureSearch tool call MUST be visible in the execution-trace notebook (a real tool call, not a docstring mention or a PDF-generation comment). Do not claim in the PDF or any artifact that "a literature search via the Biomni LiteratureSearch tool" was performed unless the tool call is evidenced in the trace. If LiteratureSearch is unavailable, state that explicitly and fall back to model-knowledge precedents with a clear "not tool-verified" label — never fabricate the tool call.

No hardcoded reference data — mandatory. Do not define the reference degraders (or any precedent table) as a Python dict literal in a code cell, even with a comment claiming it was "compiled from LiteratureSearch results." Instead: (1) call the LiteratureSearch tool, (2) read the returned records from /mnt/results/execution_trace/references.jsonl, and (3) parse those records into tables/reference_degraders.csv. The references.jsonl read must appear in the execution trace. If you must use model-knowledge precedents as a fallback (e.g. LiteratureSearch returns no results), label every entry with "not tool-verified" in the citation/evidence column — do not claim tool use that did not occur.

DOI consistency guardrail — mandatory. Every DOI recorded in tables/reference_degraders.csv (or any table) MUST match the DOI for the same reference in the PDF References section. Before writing the report, cross-check each [N] citation's DOI across all artifacts (CSV tables, PDF references, figure captions). A mismatch (e.g. a CSV DOI pointing to a different journal than the PDF cites for the same degrader) is a grounding error — fix it at the source so all artifacts agree.

2. Select & validate warheads

Choose warheads spanning the relevant mechanisms/chemotypes for the target (e.g., allosteric vs ATP-site for a kinase). Fetch each from PubChem, validate in RDKit, and mark the intended linker attachment atom with a dummy [*]. Place attachment points at solvent-exposed peripheries so target binding is preserved — justify each exit vector from docking (step 3) or published SAR (state which).

Warhead-uniqueness guardrail — mandatory, run before assembly. After defining each warhead's attachment SMILES (with the [*] dummy in place), canonicalize every attachment SMILES with RDKit (Chem.MolToSmiles(Chem.MolFromSmiles(attach_smi))) and compare all pairs for uniqueness. No two warheads may produce the same canonical attachment SMILES — if they do, the assembled PROTACs will be identical molecules scored differently, inflating the library and corrupting the ranking. This happens when two inhibitors share a core and differ only in a pendant group that is the leaving group replaced by the linker (e.g. JQ1 and OTX015 share a triazolo-diazepine BET core; their distinct pendant chloroacetamide vs. acrylamide groups are both the attachment-leaving group, so the assembled PROTACs are identical). If a collision is found, either (a) choose a genuinely different attachment point on one warhead that yields a distinct canonical SMILES, or (b) drop the duplicate warhead and document why. Report the canonical-SMILES uniqueness check result (N unique / N warheads) alongside the step-5 QC counts.

3. Dock the warhead → exit vector

Pick a target structure from RCSB (right domain, good resolution, ligand-bound if possible). Prepare the receptor in /workspace/ (strip waters/ions/cryoprotectants: HOH, SO4, GOL, EDO, Cl, Na, Mg, PO4, ACT; add polar H). Dock the warhead with AutoDock Vina into a box centered on the co-crystal ligand (grid 0.375 Å; --exhaustiveness 16 --num_modes 9 --seed 42). Validate the pose against the crystallographic ligand centroid (report distance in Å), then identify the exit vector by counting receptor heavy atoms within 5.0 Å of each warhead atom via a KD-tree (low count = solvent-exposed = good conjugation point).

Only warheads you actually dock have a computed exit vector. For warheads whose vector you assign from literature SAR, say so explicitly.

4. Select E3 ligands + build linker library

Pick E3 recruiters to compare (typically CRBN — pomalidomide/lenalidomide — and VHL — VH032), each with a defined attachment atom. Build a linker library spanning PEG (PEG2–PEG5), alkyl (C4/C6/C8), and rigid/semi-rigid motifs (piperazine dicarboxamide, triazole, piperazine-PEG). Encode linkers with two dummies [*]...[*].

Junction-chemistry guardrail — read before defining any linker SMILES. Linker attachment-point atoms must not duplicate the heteroatom already present in the warhead or E3 attachment SMILES, or the joined product will contain a chemically invalid/instable bond. Known failure modes:

Perester C(=O)O-O — when a PEG linker starts with O ([*:1]OCCO[*:2]) is joined to a warhead ester attachment CC(=O)O[*:1].
Hydroxylamine O-N — when a PEG linker ends with O is joined to an E3 glutarimide-N attachment N([*:2]).
Peroxide O-O / hydrazine N-N — analogous duplications at either junction.
Anhydride C(=O)O-C(=O) — when a dicarboxamide linker retains both acyl oxygens and is joined to an ester warhead attachment.

Fix at definition time: place carbon (not O/N) at linker attachment points so the heteroatom sits in the linker interior. For PEG linkers use [*:1]CCOCC[*:2] (C at ends, O in middle) instead of [*:1]OCCO[*:2]; extend the same pattern for PEG3–PEG5, Triazole-PEG, and Piperazine-PEG. For piperazine-dicarboxamide, use amide C(=O)N junctions, not retained acyl-O.

Mandatory junction validation (step 5 QC): after assembly, scan every product SMILES for perester C(=O)O-O, peroxide O-O, hydroxylamine O-N, and hydrazine N-N bonds at the warhead-linker and linker-E3 junctions. Flag and exclude any candidate that contains one. Report N chemically-valid / N total alongside the existing RDKit-validity and core-intact counts.

5. Combinatorially assemble in RDKit

Assemble warhead × linker × E3. Use atom-map-labeled dummies to avoid the common multi-dummy join bug: label warhead attach [*:1], linker [*:1] and [*:2], E3 [*:2]; bond matched labels via their heavy-atom neighbors, remove dummies, clear map numbers, sanitize. QC every product: valid molecule AND both pharmacophore cores intact (SMARTS substructure match of warhead scaffold and E3 scaffold) AND no invalid junction bonds (perester C(=O)O-O, peroxide O-O, hydroxylamine O-N, hydrazine N-N — see the step-4 junction-chemistry guardrail). Report N valid / N total, N both-cores / N total, and N chemically-valid-junctions / N total.

6. Physicochemical + ADMET profiling

Compute RDKit descriptors (MW, cLogP, TPSA, HBD, HBA, RotB, aromatic rings, Fsp3, heavy atoms). Predict 16 ADMET endpoints for all candidates with DeepPurpose (from deeppurpose import ...; predict_admet_properties is not a biomni.tool function — use the DeepPurpose package directly).

ADMET honesty: DeepPurpose models are trained on drug-like chemical space. Degraders are bRo5, so these predictions are extrapolations — use them as relative rankings, not absolute values. State this wherever ADMET is reported.

ADMET failure-log accuracy guardrail. When recording which candidates failed ADMET prediction (NaN / encoding failure), describe the failure pattern by canonical SMILES, not by warhead label. If two warhead labels map to the same canonical SMILES (see the step-2 warhead-uniqueness guardrail), a failure attributed to one label actually affects both. Log the unique failing SMILES and the set of candidate labels that share each, so the failure count is not double-counted or mis-attributed to a single warhead.

7. Prioritize (transparent score) + shortlist

Rank with an explicit, weighted, documented score (0–100). A defensible default, combining precedent-based and prior-free components:

W = {"c1_warhead":0.22, "c2_e3ligand":0.15, "c3_exitvector":0.15,
     "c4_bro5":0.22, "c5_admet":0.16, "c6_similarity":0.10}
# Degradability_Assessability = sum(df[c]*W[c] for c in W) * 100
c1 warhead precedent, c2 E3-ligand suitability — encode known priors (assign best-in-class chemotypes high values by design).
c3 exit-vector quality (from docking), c4 bRo5 envelope conformity, c5 ADMET desirability, c6 similarity to validated degraders — the prior-free part.

Anchor the bRo5 envelope on real oral degraders (e.g. ARV-471, ARV-110): MW 700–1100, cLogP 2–6, TPSA 90–180, HBD 0–4, RotB 6–18. Build a balanced shortlist (e.g. top-3 CRBN + top-3 VHL) and flag liabilities explicitly (TPSA/HBD over the oral envelope, high RotB, etc.).

Critical honesty boundary — read before writing any result. This score is a prioritization heuristic, NOT a calibrated DC50/Dmax predictor. Because c1/c2 deliberately encode literature priors, a top ranking that matches a known best-in-class degrader reflects that prior by construction — it is an internal-consistency check, not an independent rediscovery. Never claim otherwise. Docking (step 3) models the warhead only, not the productive ternary E3–degrader–target complex that actually determines degradation.

8. Figures + report

Generate the seven figures (above) as PNG+SVG (font.family=['Liberation Sans', 'DejaVu Sans'], svg.fonttype='none'; run a visual inspection on each). Build the PDF with the pdf-report-generation skill (load it via Skill and follow its template — do not build the PDF by calling reportlab directly). The report MUST include an Introduction section (use that exact section name, not "Executive Summary" or a synonym), a Methods "honesty boundary" callout, and a Limitations section covering: heuristic score, embedded priors, ADMET extrapolation, warhead-only docking, literature-based exit vectors, simplified conjugation chemistry, and real permeability liabilities.

Figure-format guardrail — mandatory. Every figure MUST be saved in both PNG and SVG. Use matplotlib savefig() for all figures (including building-block montages and shortlist structure grids) — call savefig() twice with .png and .svg extensions. Do not use PIL Image.save() for any figure: it cannot emit SVG, so figures produced with PIL will be missing the required SVG version. If a figure is assembled from multiple images (e.g. a structure grid), lay it out on a matplotlib Figure with imshow/AxesImage and save that figure to both formats. After saving, verify each figure has both a .png and a .svg file before proceeding to the report.

Report-engine guardrail — mandatory. The PDF MUST be built by loading the pdf-report-generation skill via Skill(action="load", name="pdf-report-generation") and following its template. Importing reportlab directly (SimpleDocTemplate, Paragraph, etc.) and building the PDF programmatically is a skill-instruction deviation even if the output is branded and complete — do not do it. The pdf-report-generation skill ensures consistent branding, section structure, and reference formatting.

Pre-flight check (run before any reportlab import): verify that Skill(action="load", name="pdf-report-generation") has been called in this session. If it has not, call it now. Do not proceed to any reportlab import or PDF-building code until the skill is loaded. A markdown cell that mentions the skill is not sufficient — the Skill() call must appear as a real tool call in the execution trace before the code cell that builds the PDF.

Post-generation self-check: after the PDF is written, verify in the execution trace that a Skill() call for pdf-report-generation appears before any reportlab import. If the trace shows a reportlab import with no preceding Skill() load, the guardrail was violated — stop and rebuild the PDF via the skill before finishing.

References section — mandatory. The PDF MUST include a References section listing every cited [N] reference with authors, title, journal, year, and DOI (or URL if no DOI). Do not cite any [N] in the report body without defining it in the References section. The pdf-report-generation skill template already provides a References section — populate it with the full citations captured in step 1.

NaN-safe text guardrail: when passing DataFrame values to Paragraph() (or any reportlab text flowable), coerce nullable/NaN values to safe strings first (e.g. str(v) if pd.notna(v) else "N/A"). Raw float('nan') / None in Paragraph() text raises or renders literal nan, corrupting the report.

Advanced tier: ternary-complex structural modeling (optional)

Steps 1–8 model the warhead only. The productive ternary complex (E3–degrader–target) is what actually determines degradation, and modeling it is a harder, fast-moving problem. Add this tier when the user wants a credible ternary pose or physics-based potency ranking. Full detail and citations are in references/ternary_modeling.md; the essentials:

Structural engine (ternary pose): use a cofolding model. In-platform: Boltz-2 or Chai-1 (both handle protein + small-molecule complexes). AlphaFold3 is often cited as best for glue ternaries but is not in this platform (only AlphaFold v2 is), and the "best engine" is genuinely benchmark-dependent and unsettled — some 2025 benchmarks rank AF3 first, a 2026 head-to-head found Boltz-2 beat AF3 on 40 PROTAC/glue complexes. Try more than one engine and inspect poses; do not assume one winner.
Modality routing: small-molecule glue/PROTAC → cofold (Boltz-2/Chai-1); peptide or protein binder → BoltzGen (universal binder design vs proteins/ peptides/small molecules/nucleic acids).
Ranking / optimization: cofolding scores rank potency poorly; use physics-based free energy for ranking analogs. Published degrader-specific approaches include ensemble/FEP-style ternary methods (e.g. GlueMap; cooperativity-via-binding-free-energy). FEP substantially outperforms cofolding scores for ternary ranking in reported benchmarks.
Experimental / un-verified models: named glue-enhancement tools sometimes cited (e.g. steered/guided-diffusion variants) are not validated in this environment — treat them as candidates to evaluate individually, not as dependencies.

PROTAC vs glue caveat: a molecular-glue ternary has a small, cooperative interface; a PROTAC ternary is dominated by linker conformational sampling and is the harder case (benchmarks flag degrader complexes and large interfaces as failure modes). If you built a PROTAC library in steps 1–8, the ternary step needs PROTAC-aware conformational sampling and explicit linker treatment — a glue-only pipeline will under-serve it.

Scientific caveats (always surface these)
The prioritization score is a heuristic, not a DC50/Dmax model.
It embeds literature priors (c1/c2) — top hits partly reflect precedent by construction.
ADMET is extrapolated to bRo5 space — relative rankings only.
Docking models the warhead only unless the ternary tier is run.
Assembly uses simplified direct-bond conjugation; confirm synthetic routes.
Common real liability for polar warheads: TPSA and HBD above the oral envelope → oral-permeability risk to resolve experimentally.
All designs are prioritizations for wet-lab validation, not conclusions.
Commercial-use caveat: the ADFR Suite (prepare_receptor/prepare_ligand) is PROHIBITED for commercial use per the MGLTOOLS SOFTWARE LICENSE AGREEMENT (non-commercial only; "revenues generating activities" including consulting and selling applications built on top of this software are commercial usage). It is free for academic/non-commercial use only. A commercial license from Scripps Research / Michel Sanner is required for any commercial deployment, or substitute an open-source PDBQT-prep alternative (Meeko, OpenBabel, or RDKit-based prep). Other software dependencies (RDKit BSD-3-Clause, AutoDock Vina Apache 2.0, DeepPurpose BSD-3-Clause, OpenBabel GPL-2.0, ADMET-AI/Chemprop, ReportLab BSD) permit commercial use under their respective licenses.
Data-source licenses (separate from software) — see the "External Data Sources & Licenses" section and DATA_SOURCES.md. PubChem and RCSB PDB are public domain / CC0 (no obligations); UniProt is CC BY 4.0 (attribution only). ChEMBL (CC BY-SA 3.0) and the Human Protein Atlas (CC BY-SA) permit commercial use but require attribution + share-alike: credit the source and license any derived/redistributed dataset that embeds their data under the same CC BY-SA terms.
Final response (mandatory)

Your final chat response MUST be non-empty. Do not end the run after writing the PDF and artifacts without producing a final text response. Summarize:

Skill used — name the skill and confirm it was loaded.
Inputs — target, E3 ligase(s), warhead/linker choices, any user constraints.
Workflow steps — the steps executed (target/precedent, warhead selection, docking, assembly, ADMET, scoring, figures, report).
Output artifacts — list the key files written (tables, figures, PDF) with filenames.
Material dependencies and commercial-use status — name the engines used (RDKit, AutoDock Vina, DeepPurpose, OpenBabel/Meeko) and confirm ADFR Suite was avoided; flag any needs_commercial_review dependency.
Failures or limitations — any step that did not complete, any guardrail that required a fallback, and the honesty-boundary caveats (heuristic score, ADMET extrapolation, warhead-only docking).
Files in this skill
references/ternary_modeling.md — the advanced-tier landscape (engines, benchmarks, ranking methods) with verified citations and DOIs.

95. tissue-expression-specificity
Category: DRUG DISCOVERY
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

96. tusoai
Category: DATA ANALYSIS
Source: https://biomni.phylo.bio/skills?section=marketplace

TusoAI — autonomous, persistent, multi-machine method development

This skill runs the bundled TusoAI system inside Biomni as a durable scientific optimization service. Its job is not merely to call optimize(): it must build a faithful evaluator, translate every user constraint into TusoAI-visible context, calibrate resources, launch a cooperative multi-machine search, survive sandbox lifecycle events, monitor search health, resume automatically, and return a revalidated method rather than an unexamined high score.

The bundled repository is the user-supplied TusoAI revision plus Biomni-specific filesystem, evaluator-import, shared-history, and test hardening. Treat repo/README.md as the API reference and this file as the orchestration contract.

0. Resolve the installed skill root once

At activation, resolve SKILL_ROOT and record it in the run state. Prefer, in order:

/mnt/results/skills/tusoai
the unique directory under /mnt/results/skills/ whose SKILL.md starts with # TusoAI and which contains repo/tusoai/optimization.py.

Never assume the archive's local folder name. Verify these paths before acting:

$SKILL_ROOT/repo/tusoai/optimization.py
$SKILL_ROOT/scripts/audit_setup.py
$SKILL_ROOT/templates/task_spec.json

Add $SKILL_ROOT/repo to PYTHONPATH or sys.path when importing TusoAI. Never install or import an older system copy ahead of the bundled repository. Record $SKILL_ROOT/VERSION and the SHA-256 of repo/tusoai/optimization.py in run_state.json.

Mission and completion standard

Build the highest-quality method TusoAI can find within the authorized global cost and wall-clock budget while preserving the scientific contract. A run is complete only after:

evaluator fidelity and candidate reachability have been verified;
by default the objective is evaluated on a diverse set of at least two datasets (distinct cohorts/conditions/tasks, not merely folds or seeds of a single dataset). A single-dataset objective is permitted only with an explicit justification recorded in task_spec.json and RUNBOOK.md; otherwise emit a prominent warning and prefer adding a second dataset;
every user constraint has an explicit enforcement route;
all compatible provisioned CPUs and GPUs have been used without unsafe oversubscription;
the active global budget is exhausted, the user interrupts, or a genuine unrecoverable blocker is documented;
the best candidates are rerun from clean source, checked for leakage and robustness, and exported with the history, task spec, state, and exact launch configuration.

A plateau, one good result, one failed machine, a callback, or the end of an epoch is not completion. If budget remains, diagnose and continue in the same task.

Non-negotiable invariants
A. Never hibernate an active cluster

Once a leader, follower, evaluator, checkpoint process, or GPU node participates in an active TusoAI epoch, do not call hibernate, suspend, stop, release, scale-down, or delete on that machine. Apparent idleness between candidate jobs is part of the search and is not permission to hibernate it.

A machine may be released or hibernated only after all of the following are true:

its managed TusoAI job is terminal or has been deliberately stopped at a checkpoint boundary;
shared history.json, node status, stdout/stderr, selected code, and run_state.json have been durably checkpointed;
no other active node depends on local-only state from that machine; and
the run is globally complete, or the machine is being replaced immediately by a compatible node that resumes the same shared history.

Never use GPU hibernation as a way to survive a timeout. Use bounded epochs, managed jobs, checkpoints, and resume. If the platform itself pauses a machine, resume or replace it and continue from shared history; do not restart the search.

B. Use managed background execution only

Long TusoAI nodes must be launched with Biomni's tracked background mechanism, with a distinct background_name and machine_id. Forbidden: shell &, nohup, screen, tmux, subprocess.Popen used as an unmanaged daemon, or any process invisible to Biomni's job lifecycle.

Use callback-driven completion. While jobs are active, make a real tool call at least every 8–10 minutes to checkpoint history, update state, or report health. Log lines alone are not a watchdog heartbeat. Do not leave a multi-hour job running while the agent is silent.

C. Persistent state is authoritative

Treat process memory and /workspace/ as disposable. The authoritative task workspace is:

/mnt/shared-workspace/tusoai/<task_id>/

Use /mnt/results/tusoai/<task_id>/ for user-visible mirrors and final outputs. Use /workspace/ only for formats that require local random-access writes; copy completed files back immediately.

Never broadly clean or delete a workspace. On conflicts, preserve artifacts under recovery/<timestamp>/ and reconstruct from the newest valid state.

D. Multi-machine means one shared search, not unrelated runs

For more than one optimizer process, every node must use all of the following:

multi_machine=True;
the same absolute shared output_dir;
the same non-empty history_name;
the same task bundle hash, evaluator hash, source/repository fingerprint, dependency lock, model settings, and immutable constraints;
a unique node ID and unique stdout/stderr path, but not a unique history name;
a shared filesystem that has passed the cross-machine probe in scripts/shared_fs_probe.py.

multi_machine=True without an identical non-empty history_name creates separate histories and is a configuration failure.

E. Global budgets must be enforced outside each process

TusoAI's TIME_LIMIT and COST_LIMIT are process-local. Maintain one persisted global budget in run_state.json. Divide each epoch's remaining cost across active nodes with safety headroom; never give every node the full global limit. Use an absolute cluster deadline and derive each node's TIME_LIMIT from the remaining time minus a shutdown/checkpoint reserve.

Default execution policy when the user does not specify a budget:

4-hour resumable epochs;
a 45-minute reserve before the platform's hard wall-clock boundary;
continue epochs until the authorized task budget is exhausted;
do not schedule a single 24-hour call exactly at a 24-hour sandbox cap.
F. The evaluator and hidden data are protected

Do not modify scoring code, splits, labels, held-out data, benchmark definitions, or test expectations to improve the score. Candidate functions may not read hidden labels, evaluator internals, previous expected outputs, or network data. Do not weaken validation, sample counts, seeds, precision, or convergence criteria unless the user explicitly changes the scientific contract.

G. Search-space and LLM configuration are protected
max_islands passed to optimize() must be an explicit positive integer, never None. The skill default is 3. A None value silently disables island clustering and is a configuration failure.
build_ai() in task_factory.py must not override model_settings. The per-stage models (pdf = gpt-5.4-nano, construction = gpt-5.4, optimization = gpt-5.4-mini) and their thinking, thinking_tokens, and reasoning_mode must stay at the Tusoai / from_api_key constructor defaults. temperature and max_tokens remain tunable.
Enforcement routes: task_spec.json search_policy and llm_policy blocks, scripts/validate_task_spec.py, templates/task_factory.py, and the runtime guard in templates/launch_tusoai_node.py.
Canonical package map

Read a referenced file in full before performing that operation.

Trigger    Canonical file
Evaluator setup, baseline/noise, candidate reachability    skills/evaluator-and-reachability.md
Translate instructions into MethodTasks/DataTasks and a serialized bundle    skills/task-construction.md
New external/orthogonal data or benchmark data staging    skills/data-tasks.md
Resource sizing, shared-FS proof, leader/follower launch    skills/multi-machine.md
Active run health, heartbeats, cost, checkpoints, epoch continuation    skills/monitoring-and-checkpointing.md
Select, inspect, and revalidate history candidates    skills/history-selection.md
Cold-start resume, machine loss, wiped workspace, rerun decisions    skills/recovery-and-rerun.md
A concrete error or pathological run symptom    skills/troubleshooting.md
Public API and source behavior    repo/README.md

There is one canonical copy of each sub-skill. Do not use stale root-level duplicates from earlier TusoAI skill archives.

Persistent layout and required artifacts

Create the following without deleting prior runs:

/mnt/shared-workspace/tusoai/<task_id>/
├── run_state.json                 # authoritative state machine
├── events.jsonl                   # append-only decisions and failures
├── RUNBOOK.md                     # concise human-readable context
├── task_spec.json                 # immutable scientific/context contract
├── task_factory.py                # constructs AI client and tasks
├── task_bundle.pkl                # tasks built once, shared by all nodes
├── task_bundle_manifest.json      # hash + target names + evaluator
├── cluster_manifest.json          # nodes, resources, budgets, deadline
├── environment/                   # persistent venv/conda environment
├── source/                        # protected baseline source/repository
├── runner.py                      # verified evaluator
├── data/                          # staged immutable/processed data
├── cache/                         # TusoAI construction/literature caches
├── run/                           # shared TusoAI output_dir
├── logs/                          # one log per node and epoch
├── status/                        # one status JSON per node
├── checkpoints/                   # periodic history/code/state snapshots
└── recovery/                      # preserved conflicting/corrupt artifacts

/mnt/results/tusoai/<task_id>/
├── status.json
├── history.json
├── history/                       # end-of-run full history-folder export (sidecars included)
├── history_rebuild/               # examine_results.ipynb materialized selected-method codebase
├── best_score.py
├── selected.py
├── final_method/
├── final_validation.json
├── report.md
├── plots/                         # history_tree.png + history_progress.png from examine_results.ipynb
├── examine_results_executed.ipynb # executed provenance copy of the export notebook
└── logs/                          # concise or final log mirrors

After every material phase transition and every checkpoint, atomically update run_state.json and append one event to events.jsonl. Use templates/run_state.json as the schema. scripts/run_state.py provides atomic init, patch, event, and show operations. Record hashes, not just paths.

The context packet: make instructions actually reach TusoAI

Every task must have a validated task_spec.json, based on templates/task_spec.json. It is the single source of truth for:

objective and score direction;
exact evaluator and metric semantics;
editable targets and source locations;
available inputs/data/dependencies;
immutable scientific, API, shape, ordering, seed, privacy, and leakage constraints;
global budget and hardware policy;
search-space policy (search_policy.max_islands, never None) and LLM configuration policy (llm_policy.model_settings_locked);
an explicit coverage row for every immutable constraint.

No important instruction may live only in this skill, a chat message, or RUNBOOK.md. Before task construction, map each instruction to at least one actual enforcement route:

objective and scientific context → task_description;
per-target inputs → data_available or DataTask file_description / data_usage;
target-specific constraints → each task's hints;
cross-target constraints → global_hints;
edit location → source_path and repo_root;
correctness, leakage, schema, and score direction → evaluator assertions;
external data access → staged absolute paths and DataTask read_cmd;
dependencies/resource limits → installed environment plus hints and launch configuration.

Run:

python "$SKILL_ROOT/scripts/validate_task_spec.py" \
  /mnt/shared-workspace/tusoai/<task_id>/task_spec.json

Do not construct tasks until it passes. After construction, persist the exact MethodTask/DataTask objects once in task_bundle.pkl; every machine loads that same hash. Reconstructing tasks independently on followers wastes model calls and can give nodes divergent search spaces.

Phase state machine
Phase 0 — Discover, fingerprint, and resume before creating anything
Derive a stable, filesystem-safe <task_id>.
Resolve SKILL_ROOT and bundled source version.
Inspect the persistent task directory, results mirror, managed job registry, machine registry, and existing histories.
If run_state.json describes the same repository/evaluator/task-spec hashes, follow skills/recovery-and-rerun.md and resume at the recorded phase. Never rebuild a valid task bundle or restart seeding merely because process state was lost.
On a clean start, copy templates, initialize state/events, record the original user request verbatim in RUNBOOK.md, fingerprint source and evaluator, and protect a baseline source snapshot.

Phase exit gate: state is durable; clean-start versus resume is unambiguous; source, evaluator, and task identity are recorded.

Phase 1 — Build and prove the evaluator

Read skills/evaluator-and-reachability.md in full. Build the smallest faithful runner that exercises the real method and exact metric. By default the runner should aggregate the score across a diverse set of at least two datasets (distinct cohorts/conditions/tasks, not merely folds or seeds of one dataset); a single-dataset objective requires an explicit recorded justification, otherwise warn prominently and prefer adding a second dataset. Run the evaluator audit for at least three baseline repetitions, estimate score noise/runtime/RSS, and verify exactly one finite tuso_evaluate line.

Perform a candidate reachability test: in a temporary copied source tree, apply a deliberate, reversible sentinel change to the intended target and prove the evaluator result or an explicit assertion changes. If it does not, stop and fix imports/call sites. A runner that silently imports the original repository cannot guide optimization.

Use relative runner-to-repository imports. Never insert the original repository's absolute path into sys.path. Make the verified evaluator and protected data read-only where practical.

Phase exit gate: baseline is reproducible; noise-informed min_improvement is chosen; candidate edits reach the score; timeout and memory envelope are known.

Choosing Biomni's initial method (when Biomni builds it)

This applies only when Biomni itself constructs the initial method that TusoAI will then optimize. It is distinct from two other things and must not be confused with either:

it is not TusoAI's own seed — i.e., not the starting method repository / baseline source you begin from; and
it is not TusoAI's internal initialization/seeding of baseline descriptions produced during its search.

When Biomni is authoring that first method from scratch, it is recommended to start from a simpler form of a family of solutions already known to work well in the relevant field rather than an exotic or bespoke first attempt. Prefer a lean, well-understood instance of an established approach for the problem type — for example optimal transport for coupling/alignment problems, a graph/network model for relational or spatial structure, a matrix-factorization or regularized-regression baseline for factorized or predictive problems, or the canonical statistical model for the domain. Keep this initial version deliberately simple and correct; TusoAI's search is what elaborates and specializes it. A strong-but-simple, field-appropriate starting point gives TusoAI a productive, well-behaved region to improve from, whereas an idiosyncratic or over-engineered first method tends to waste early search budget.

Phase 2 — Build the task/context bundle once

Read skills/task-construction.md; read skills/data-tasks.md if any external data could add orthogonal signal.

Complete and validate task_spec.json.
Choose a small set of high-value, uniquely named editable targets. Prefer 1–4 coherent targets over a broad repository-wide edit surface.
Put constraints in model-visible fields and evaluator assertions using the context-packet mapping above.
Use shared persistent cache/data paths.
Implement task_factory.py from the template.
Build tasks once with templates/build_task_bundle.py; store and verify the SHA-256 manifest.
Smoke-test task serialization/deserialization in the persistent environment.

Phase exit gate: the task spec validates; the bundle hash is fixed; all nodes will use identical task objects; no user constraint lacks an enforcement route.

Phase 3 — Calibrate and prove the cluster

Read skills/multi-machine.md in full.

Inventory all available CPU machines and GPU nodes. Inspect the actual method and evaluator for CUDA/JAX/CuPy/PyTorch GPU use before provisioning GPU nodes.
Provision compatible machines aggressively enough to use the authorized compute, normally at the largest useful CPU/RAM shape. Do not provision GPUs for a CPU-only evaluator.
Compute each node's n_jobs from measured CPU, RAM, API, and GPU limits. Do not equate logical CPU count with safe worker count.
Install or reuse the exact same persistent environment on every node and verify source/task/evaluator hashes.
Run shared_fs_probe.py concurrently from every proposed node. Multi-machine launch is forbidden if any entry is lost, JSON is corrupted, locks remain, or atomic replacement fails.
Write cluster_manifest.json with an absolute deadline, per-node cost limit, n_jobs, cpu_threads_per_job, local gpu_ids, and machine IDs.

Phase exit gate: every node is compatible and hash-identical; shared filesystem semantics pass; resource and budget arithmetic fit with headroom.

Phase 4 — Leader bootstrap, then follower fan-out

Use templates/launch_tusoai_node.py from the persistent task workspace.

Start exactly one leader as a managed background job with multi_machine=True, stable shared output_dir, and stable non-empty history_name.
Keep the leader machine awake. Monitor until the shared history contains at least one valid candidate record and checkpoint it.
Start all followers as managed jobs. Followers load the exact task bundle and shared history; they do not rebuild tasks or seed independently.
Give each node a unique log/status path and background name. Use local GPU IDs on each machine.
Immediately record all job handles, machine IDs, deadline, and node budgets in run_state.json.

Do not launch multiple leaders into an empty history. Duplicate seeding increases cost, races initialization, and reduces useful search time.

Phase 5 — Monitor, checkpoint, and continue until the global budget ends

Read skills/monitoring-and-checkpointing.md in full.

At least every 8–10 minutes while any node is active:

make a real Biomni tool call;
inspect node terminal/running state without destructive intervention;
run scripts/checkpoint_history.py against the shared history;
mirror status/history/selected code to /mnt/results/;
update cluster cost estimate, best score, candidate throughput, recent failure modes, last heartbeat, and next action in run_state.json;
emit a concise progress line to the user when appropriate.

At an epoch callback, checkpoint first, then assess whether failures reflect bad candidates or bad infrastructure. If the global budget remains, the legal next action is to resume another epoch or repair/relaunch failed nodes—not to ask the user whether to continue. Reuse the same history and task bundle.

Change the meta-setup only at a checkpoint boundary and only with evidence: misaligned evaluation, unreachable target, high infrastructure-failure rate, poor task context, insufficient data, unsafe resource pressure, or sustained search pathology. Preserve the old history and write a new comparable run ID if the score contract changes.

Phase exit gate: global cost/deadline exhausted, explicit user interruption, or a recorded unrecoverable blocker after honest repair attempts.

Phase 6 — Select, revalidate, and report

Read skills/history-selection.md in full.

Preserve the full shared history and all node logs.
The final deliverable is TusoAI's complexity-aware near-best selection, not the raw highest-score candidate. Compute it with TusoAI's own selector (pick_history_solution from repo/examine_results.ipynb, i.e. the _dm_history_close_set + _dm_history_complexity_score logic) using the run's min_improvement. Also extract the raw highest-score candidate, but keep it only for comparison/provenance — do not ship it as the final method unless the complexity-aware pick fails revalidation (see step 5).
Inspect code for leakage, evaluator exploitation, hard-coded paths, hidden labels, nondeterminism, writes/network, brittle imports, and unnecessary complexity.
Rebuild from the protected source and apply each finalist cleanly. Apply the complexity-aware selection as the primary finalist and the raw best as the comparison finalist.
Rerun baseline plus finalists for multiple repetitions and, where relevant, folds/seeds/full datasets. Confirm the improvement exceeds measured noise. Ship the complexity-aware selection as final; fall back to the raw best (or the next-best reproducible complexity-aware candidate) only if the complexity-aware pick fails to reproduce or fails an integrity check.
Export final source, exact patch, environment, commands, task spec, bundle and evaluator hashes, history, validation table, resource/cost summary, accepted method rationale, and remaining uncertainties.
Export the complete history folder and run the bundled analysis notebook — once, at end of run, not during:

copy the shared output_dir history folder (history.json plus dev_*.json, prompt_io_*.json, and related sidecars) to /mnt/results/tusoai/<task_id>/history/ using full-file copies (never POSIX append — /mnt/results is S3-backed and appends can fail silently);

execute repo/examine_results.ipynb non-interactively against the exported history, with min_improvement read from the run's recorded optimize_kwargs:

MPLBACKEND=Agg PYTHONPATH="$SKILL_ROOT/repo" \
TUSOAI_HISTORY_PATH=<shared output_dir>/history.json \
TUSOAI_REBUILD_DIR=/mnt/results/tusoai/<task_id>/history_rebuild \
TUSOAI_PLOTS_DIR=/mnt/results/tusoai/<task_id>/plots \
TUSOAI_MIN_IMPROVEMENT=<run min_improvement> \
jupyter nbconvert --to notebook --execute \
  "$SKILL_ROOT/repo/examine_results.ipynb" \
  --output /mnt/results/tusoai/<task_id>/examine_results_executed.ipynb

This writes history_tree.png and history_progress.png into plots/ and the materialized selected-method codebase plus selected_summary.json into history_rebuild/. Skip regeneration when these outputs already exist and are newer than the source history.json ("if not already"). Record exported paths and notebook execution status in run_state.json and events.jsonl.

Only after durable final outputs exist may cluster machines be released or hibernated.
Resource utilization rules
CPU-only evaluator: use multiple CPU machines when shared-FS and API concurrency permit. On each host, cap n_jobs by CPU threads, 75% usable RAM, evaluator RSS × 1.35 headroom, and provider concurrency.
GPU evaluator: provision GPU nodes only after a CUDA smoke test. Start with one evaluation job per GPU; increase only after measured GPU-memory headroom. gpu_ids are local indices on each node. Keep enough CPU threads per GPU to feed preprocessing and data loading.
Nested parallelism: explicitly set cpu_threads_per_job; TusoAI propagates it to OMP/MKL/OpenBLAS/NumExpr/BLIS. Avoid n_jobs × BLAS_threads exceeding the host's available CPUs.
Mixed hardware: do not combine CPU-only and GPU-required nodes in one history unless candidate code is contractually portable across both and the evaluator has been tested on both. Hardware-dependent scores are not directly comparable.
Memory limit: memory_limit_gb is per evaluation process, not per host. Ensure n_jobs × expected_RSS plus parent/cache overhead fits physical RAM.
API throughput: more CPU processes do not help after model-provider rate limits saturate. Use observed 429s/latency to set the cluster concurrency cap.
Progress format

Use a compact heartbeat such as:

TusoAI epoch E | nodes R/T | candidates N (+Δ) | best S | selected S2 | est. cluster cost $C/$B | deadline YYYY-MM-DD HH:MM TZ | action

For failures, identify node, stage, error class, whether shared history remains valid, and the automatic recovery action. Do not report an infrastructure failure as a scientific plateau.

Stop conditions

Before the global budget is exhausted, the run may stop only for:

explicit user interruption;
platform hard-stop with no replacement capacity;
invalid or unavailable credentials/data that cannot be repaired;
shared filesystem semantics that make multi-machine unsafe and no usable single-machine fallback;
no legal editable target that reaches the evaluator;
a safety/privacy restriction that forbids continuation.

When multi-machine is unsafe but one machine is usable, fall back to the largest compatible single machine, maximize safe n_jobs, preserve the same history, and continue. A cluster problem is not permission to abandon the task.

Start now

On every invocation:

resolve SKILL_ROOT and read the relevant canonical sub-skill;
run the cold-start/resume check before creating or deleting anything;
persist or validate the context packet;
prove evaluator reachability;
build one task bundle;
calibrate and prove the shared cluster;
launch leader then followers without hibernating active machines;
checkpoint and continue across bounded epochs until the global budget ends;
revalidate and export the final method before releasing resources.

97. tusoskill
Category: DATA ANALYSIS
Source: https://biomni.phylo.bio/skills?section=marketplace

tusoskill
Purpose

Use this skill whenever Biomni is asked to create, improve, optimize, audit, or package a computational biology or biomedical method. Biomni is the method developer. It must understand the biological task, set up a trustworthy benchmark, gather relevant evidence and data, formulate method hypotheses, write and restructure code, run evaluations, diagnose failures, simplify successful ideas, and deliver a reproducible method.

A good result is not merely a higher benchmark number. A good biological method is principled, efficient, concise, reproducible, calibrated when uncertainty matters, robust across realistic subgroups and perturbations, frugal with hyperparameters, and honest about assumptions. It can use new features, priors, embeddings, auxiliary datasets, foundation models, and packages when they improve real scientific utility, but it must justify and test the added complexity.

Non-negotiable operating rules
Biomni owns the full method-development loop. Do not delegate the search process to an external method-search framework. Use Biomni's reasoning, coding, biomedical knowledge, data tools, and evaluation tools directly.
Freeze the evaluator before optimization. Define the primary metric, direction, data splits, runtime/memory limits, protected files, and leakage rules before repeated search. If the user provides an evaluator, preserve its contract.
Optimize for real generalization, not metric artifacts. Never inspect hidden labels, tune on final test outputs, exploit file names, dataset order, benchmark bugs, duplicate leakage, or evaluator-specific shortcuts. If a suspicious shortcut improves the score, reject or quarantine it.
Maintain durable state. Record every important hypothesis, code change, metric, runtime, memory usage, diagnostic insight, ablation result, and decision in the durable workspace and mirror compact status to /mnt/results or the requested output directory. Resume from this state when possible.
Search broadly enough to avoid local optima. Maintain a diversity portfolio of method families, representations, data sources, objectives, and simplification paths. Do not repeatedly make small edits to only one current best solution.
Prefer useful simplicity. When two methods have similar validated performance, choose the one with lower runtime, memory, code length, dependency burden, and conceptual complexity.
Be willing to make large changes. If the evidence suggests the current representation, model family, objective, or code structure is limiting, restructure the method. Preserve the benchmark interface and keep the final method maintainable.
Use external biological information responsibly. Literature, ontologies, curated databases, pretrained embeddings, and public datasets can be decisive. Record provenance, licenses, preprocessing, leakage checks, and whether information was available only from training-safe sources.
When theory matters, keep a derivation. If a method has theoretical assumptions or guarantees, write the derivation or invariants, stay close to them, and explicitly test any approximation that weakens them.
Stop only after a defensible final audit. Re-evaluate finalists, run ablations and guardrails, remove dead code, document failure modes, and package reproducibly.
Use Biomni's full capability stack

During method development, actively use the capabilities available in the Biomni environment rather than limiting the work to local code edits. Useful actions include inspecting repositories and datasets, running statistical analyses, creating controlled evaluators, searching literature and biomedical resources, identifying public datasets and pretrained representations, checking package ecosystems, deriving models, profiling code, running parallel experiments, making diagnostic plots, and packaging reproducible artifacts.

Convert external information into testable method components. A paper, database, ontology, embedding, or package is useful only when it produces a concrete feature, prior, objective, baseline, diagnostic, or guardrail that can be evaluated under the benchmark without leakage.

Default budget and execution style

Unless the user specifies otherwise, the active development budget is 50 substantive method iterations per round, with no wall-clock limit. Treat the 50-iteration count as a firm floor: do not stop before it is exhausted or a hard blocker occurs. Explicitly do not stop early because the current method seems good, improvements have plateaued, recent attempts failed, the benchmark is noisy, the backlog looks thin, implementation is inconvenient, the remaining ideas appear incremental, or a natural "wrap-up" point seems to have arrived. A thin backlog is an instruction — never permission to halt — to replenish it through diagnosis, ablation, data/literature search, profiling, simplification, derivation, or a new algorithmic family.

Definition of a "hard blocker" (closed list — the ONLY reasons that permit stopping before iteration >= max_iterations). A hard blocker is exactly one of the following, and nothing else:

Infrastructure / compute exhausted — no machine can be provisioned, repeated OOM that cannot be resolved by right-sizing the machine upward, GPU quota denied (e.g. 429), or the sandbox cannot be (re)created — i.e. it is physically impossible to run another candidate.
Benchmark / evaluator broken and unrepairable — the harness cannot score any new candidate and cannot be fixed within the run.
Explicit user stop — the user directly instructs the agent to stop or to lower the target. (Convergence, plateau, "good enough," or "this looks done" volunteered by the agent is not a user stop.)
Required data unavailable — the data needed to run any further candidate cannot be loaded or downloaded at all.

Any real hard blocker MUST be recorded in state before stopping (python scripts/biomni_method_state.py record-blocker --root <run_dir> --kind <infra|benchmark|user|data> --detail "<exact error>"), so the stop is auditable. If the blocker is later resolved (e.g. compute restored), lift it with python scripts/biomni_method_state.py clear-blocker --root <run_dir> and resume iterating — the gate will again require the floor.

These are NOT hard blockers and NEVER permit stopping: diminishing returns; the search "has converged"; a performance plateau; "no credible path past the current best"; the current method already beats the baseline; a thin or empty backlog; near-duplicate or "merely incremental" remaining ideas; benchmark noise; running low on obviously-novel architectures; or a feeling that a natural wrap-up point has arrived. Each of these is an instruction to replenish the backlog (diagnosis, ablation, orthogonal-information candidate, complete refactor, literature/data search, simplification, derivation) and continue — not permission to halt. If you catch yourself writing any phrase like "diminishing returns," "converged," or "burn compute without a credible path," that is a signal you are about to violate the floor: replenish and continue instead.

Iteration counting and continuation. Biomni must track iterations completed against the current target in state/state.json (field: iteration) and refuse to stop the round until iteration >= max_iterations. Counting rule: one substantive candidate = exactly +1. Every candidate that is scored, diagnosed, or ablated and recorded with a decision of accept, reject, or archive increments the counter by exactly one — rejects and archived failures count the same as accepts, because an informative failure is a real iteration. Only pure infrastructure retries do not increment: records logged with --decision infrastructure, or any record passed with the --non-substantive flag. The counter must always equal the number of substantive records in experiments/results.jsonl; scripts/biomni_method_state.py stop-check reports any drift between the two and must be reconciled, not ignored. Do not hand-set a lower iteration value to "reserve" numbers — the helper advances the counter automatically per substantive record, and a smaller manual value will no longer stall it. When the user prompts "keep iterating" (or any equivalent continuation instruction), extend the target by another 50 and continue from the current counter — do not reset. For example, after finishing round 1 the state shows iteration=50, max_iterations=50; on "keep iterating" set max_iterations=100 and resume at iteration 51. The ledgers (experiments/results.jsonl, logs/iteration_log.jsonl) are append-only across rounds so total history is preserved as a single run.

Termination gate (mechanical, non-optional). Stopping the round, entering final selection/delivery, or otherwise producing final deliverables is permitted only when the termination gate passes. The gate is python scripts/biomni_method_state.py stop-check --root <run_dir>; it exits 0 only if iteration >= max_iterations or a hard blocker (closed list above) has been recorded, and exits non-zero otherwise. Immediately before any finalize step you MUST emit this exact one-line self-audit so the decision is visible in the transcript:

STOP-GATE: iteration=<N>/<max>; hard_blocker=<none|infra|benchmark|user|data>; may_finalize=<yes|no>

may_finalize=yes is allowed only when N >= max or a listed hard blocker is named. Emitting may_finalize=yes (or building the final report / package / method lock) while N < max with hard_blocker=none is a protocol violation.

Because there is no wall-clock cap, the run must still survive sandbox deaths: keep all durable state in /mnt/shared-workspace/tusoskill/<run_id>/, use atomic append-only ledgers for experiments and decisions, keep resumable checkpoints for every in-flight candidate, and provide an auto-resume entrypoint that on cold start reads state/state.json, recomputes remaining iterations from experiments/results.jsonl, and immediately re-fans out to a full machine set without waiting for user prompting.

A substantive iteration changes or investigates a meaningful modeling, representation, data, objective, inference, diagnostic, robustness, efficiency, or simplification component and records evidence. Infrastructure iterations count when they make the benchmark or search more reliable.

Use every available machine, continuously, and every layer of parallelism inside each machine. Whenever compute is available — the default state during an active run — saturate compute at three levels simultaneously.

Level 1 — session machines (CPU workers). Provision the full session machine budget up front with ManageMachine (default plan: up to 5 machines, up to 16 CPU / 64 GB each) and keep every worker occupied. Never run the search on a single worker while others are idle. When a candidate finishes, immediately dispatch the next backlog item to the freed worker — no CPU cycles wasted between candidates. Each worker uses an isolated working copy, writes compact result records to shared state under /mnt/shared-workspace/, and avoids creating excessive files.

Level 2 — GPU machines. Whenever a candidate touches training, fine-tuning, embedding computation, structure prediction, or any GPU-eligible workload, create a GPU machine with ManageMachine (type: "gpu", choosing spec.gpu from the offered types and spec.gpu_count only for genuinely multi-GPU work) and run the job on it with Bash and its machine_id, in the background for anything long. Run independent GPU candidates in parallel across GPU machines up to the session's GPU cap (ManageMachine reports the cap when a create would exceed it), and reuse a machine between runs instead of deleting it: an idle machine hibernates and wakes with /workspace state and cached weights restored. Checkpoint durable artifacts (weights, logs, metrics) to /mnt/results/ from inside the GPU job so a machine loss never loses progress.

Level 3 — inside each machine. Push each worker toward its resource ceiling before adding another candidate. Use process-level parallelism (multiprocessing, joblib, concurrent.futures) or vectorized/BLAS/threaded libraries to occupy all CPU cores; use batched GPU inference and gradient accumulation to occupy VRAM; use memory-mapped IO, sparse structures, float16/bfloat16/int8 where numerics permit, and streaming/chunked processing to fit larger problems in the 64 GB per-machine cap. Profile the first candidate of each family with time, psutil, and nvidia-smi and record CPU%, RAM peak, and VRAM peak in the experiment record. Treat consistent under-utilization (< ~70% CPU or GPU while a candidate runs) as a bug to fix, not a normal state.

Memory maximization discipline. Cache freezable intermediates aggressively (see the "Freeze components" section) so RAM is spent on new work, not recomputation. Prefer on-disk memmapped arrays and Arrow/Parquet over in-memory dicts for large tables. When a candidate OOMs, first try streaming / chunking / dtype reduction before shrinking the problem. Configure ManageMachine to right-size a machine upward for memory-heavy candidates rather than degrading the method to fit the default worker.

Keep /mnt/results below 10,000 files by using JSONL ledgers, compressed artifacts, and periodic pruning of failed transient outputs.

If a platform constraint forces a shortened run, still perform the strongest feasible miniature version of the full loop: benchmark, baseline, multiple diverse candidates, diagnosis, ablation, final selection, audit, and packaging.

Keeping track of a long run

A multi-round 50-iteration run is only useful if the user can see progress at any moment and if you, on a fresh sandbox, can resume without asking questions. Make the run legible from the outside and reconstructable from the inside.

User-facing status, refreshed continuously. Maintain /mnt/results/tusoskill/<run_id>/status.json and /mnt/results/tusoskill/<run_id>/reports/status.md and rewrite them after every completed candidate (never less than every 15 minutes when work is active). Both files must include: run_id, ISO start time, wall-clock elapsed, iterations completed / target, current primary metric on the leader with 95% CI, second- and third-place candidates and their metrics, active machines (id, type, current candidate, CPU/RAM/VRAM utilization from the last probe), current backlog depth by family, most recent decision, next scheduled candidate, count of orthogonal-information candidates and complete-refactor candidates so far, and any active blocker with the exact error and the planned recovery. Never overwrite historical status — snapshot the previous file into reports/status_history/<timestamp>.json first. The complete iteration history (all ledgers, state, leaderboard, and checkpoints) is mirrored alongside to /mnt/results/tusoskill/<run_id>/history/ after every state write — see Durable ledgers below.

Durable ledgers. All progress lives in append-only JSONL files under /mnt/shared-workspace/tusoskill/<run_id>/: experiments/results.jsonl (one line per finished candidate with full record), state/backlog.jsonl (one line per queued item), feedback/feedback.jsonl (structured lessons), data_sources/data_sources.jsonl, derivations/derivations.jsonl, and logs/iteration_log.jsonl (the one-line summary from Phase 4). Never truncate or rewrite these files in place. On resume, replay them to reconstruct portfolio, diversity counters, and remaining budget. After every ledger write, the state helper (scripts/biomni_method_state.py) mirrors the complete history to /mnt/results/tusoskill/<run_id>/history/ using full-file copies — never POSIX append, because /mnt/results is S3-backed and appends can fail silently. The mirror is accumulative; nothing is deleted from it during a run.

Iteration ledger contract. Every finished candidate — accepted, rejected, or archived — produces one JSON line with at minimum: iter, run_id, candidate_id, parent_id, family, intervention_type, orthogonal_info_sources (list; empty if none), is_complete_refactor (bool), hypothesis, edited_files (hashes), primary_metric, metric_analysis (brief — why the metrics came out as they did), analysis_verdict + analysis_ref (analysis mode only), guardrails (calibration, subgroup, robustness), runtime_s, peak_ram_mb, peak_vram_mb, cpu_pct_mean, gpu_pct_mean, machine_id, seed(s), leakage_audit_result, decision (accept / reject / archive), reason, next_actions. Missing fields are recorded explicitly as null — never omitted.

Checkpoint on the clock. Every finished candidate triggers a state flush. On top of that, every 30 minutes and every 25 iterations write a rollup checkpoint into state/checkpoint_<timestamp>.json capturing: full strategy weights, diversity portfolio counters, top-K candidates with pointers to their working copies, cache manifest (frozen-component hashes and locations), and the deterministic RNG state for candidate sampling. On resume, load the latest rollup checkpoint before replaying ledgers.

Auto-resume entrypoint. Provide a single script that, on a cold sandbox, (1) locates /mnt/shared-workspace/tusoskill/<run_id>/ (prefer the most recent run_id when the user does not specify one), (2) loads the latest rollup checkpoint, (3) replays the ledgers to compute remaining iterations, (4) re-provisions CPU and GPU machines via ManageMachine up to the plan cap, (5) restarts fan-out immediately, and (6) refreshes status.json. The script must complete resume within a few minutes and must not require user input for the routine case.

Scheduled human check-in points. At 25%, 50%, 75%, and 90% of the current round's iteration budget (computed against the window [max_iterations - 50, max_iterations]), write a compact reports/checkin_<pct>.md summarizing what changed since the previous check-in, which orthogonal-information and refactor candidates have been tried, current leader, expected trajectory, and any decisions worth flagging to the user. These are for the user to skim on their own time — never a reason to stop the run.

Failure discipline. When a worker or GPU machine dies mid-candidate, mark the candidate failed_infra in the ledger with the full traceback and re-queue it (up to a per-candidate retry cap). Do not silently drop it. A GPU machine the user deleted must not be replaced unless the user explicitly re-authorizes GPU work (per platform rule).

Standard workspace

Use the user-requested output location if provided. Otherwise keep durable working state and user-facing deliverables separate:

/mnt/shared-workspace/tusoskill/<run_id>/
  benchmark/
  state/
  source_snapshots/
  candidates/
  experiments/
  feedback/
  data_sources/
  derivations/
  diagnostics/
  ablations/
  robustness/
  final_method/
  logs/

/mnt/results/tusoskill/<run_id>/
  status.json
  current_best/
  method_repo_package/
  reports/
  figures/
  manifests/
  history/

history/ holds the complete mirrored iteration history (ledgers, state, leaderboard, checkpoints) refreshed after every state write — see Durable ledgers above.

Use the shared workspace for resumable state, data, caches, and experiment artifacts. Use results for compact deliverables the user should inspect or download. Keep append-only ledgers where possible:

state/state.json
state/strategy_weights.json
state/diversity_portfolio.json
state/backlog.jsonl
experiments/results.jsonl
feedback/feedback.jsonl
data_sources/data_sources.jsonl
derivations/derivations.jsonl
reports/status.json
reports/final_report.md

Each record should include timestamp, iteration, candidate ID, parent ID when applicable, method family, intervention type, edited files, hypothesis, expected effect, metrics, runtime, memory, validation protocol, leakage audit, decision, and next action.

Phase 1: understand the task and freeze the benchmark

First identify the scientific problem, input/output contract, allowed data, target users, evaluation metric, constraints, and failure costs. Translate ambiguous task descriptions into a benchmark card. If the benchmark is incomplete, build a development benchmark scaffold rather than optimizing blindly.

The benchmark card must specify:

Primary metric, direction, and tie-breakers.
Validation split or resampling protocol.
Guardrail metrics such as calibration, subgroup behavior, runtime, memory, and code size.
Protected files and data that method code must not read.
Allowed auxiliary data and package installation policy.
Random seeds and repeated-run requirements.
Baseline command and candidate command interface.
Maximum runtime and memory per evaluation.

Before method search, run the baseline and at least one trivial sanity candidate. Verify that the evaluator can distinguish a real signal from constant, shuffled, or leakage-prone outputs.

Phase 2: gather biological and computational evidence

Spend time up front learning what should matter biologically and statistically. Use Biomni's available tools to inspect files, read documentation, search relevant biomedical literature, query databases, and examine the data. Record only useful, actionable evidence.

Evidence gathering should answer:

What biological entities, pathways, cell types, assays, perturbations, phenotypes, modalities, and confounders matter?
What prior methods, model classes, features, normalization schemes, and losses are known to work?
Which public resources could provide safe priors, features, embeddings, labels, gene sets, ontologies, structural information, sequences, perturbation data, or pathway context?
What are the likely data pathologies: batch effects, missingness, censoring, class imbalance, covariate shift, duplicates, label noise, leakage, small sample size, or outliers?
Which assumptions are scientifically plausible, and which are only benchmark conveniences?

Convert evidence into a compact hypothesis map: components to edit, biological priors to test, data sources to integrate, risks to avoid, and candidate families worth exploring.

Phase 3: create the method blueprint

Write a method blueprint before broad search. It should include the current baseline, bottlenecks, interfaces, protected invariants, candidate components, and a diversity portfolio. The portfolio should span meaningfully different method families instead of cosmetic variations.

Useful portfolio dimensions include:

Representation: raw features, learned embeddings, sparse biological features, graph/ontology features, sequence/structure features, temporal features, perturbation signatures, pathway summaries.
Model family: statistical baseline, regularized linear model, tree/boosting model, probabilistic model, graph model, neural model, retrieval/nearest-neighbor model, ensemble, rule-augmented model.
Objective: supervised loss, ranking loss, survival/likelihood objective, contrastive/self-supervised proxy, calibration penalty, robustness penalty, multi-task objective, early validation proxy.
Data strategy: train-only augmentation, auxiliary public data, curated priors, weak labels, pretrained embeddings, synthetic controls, cross-modal transfer.
Inference strategy: calibration, uncertainty, ensembling, post-processing, constrained decoding, threshold optimization under validation-only rules.
Efficiency strategy: vectorization, caching, approximate computation, reduced features, smaller models, early stopping, compiled kernels, simpler algorithms.

For each proposed family, state why it could work, what would falsify it, and what minimal experiment can test it.

Phase 4: adaptive method-development loop

Repeat this loop until the termination gate (step 11) passes. The gate passes only when iteration >= max_iterations or a recorded hard blocker exists (closed list in "Default budget and execution style"). There is no wall-clock budget; a plateau, convergence, or thin backlog is never a reason to leave the loop — it is a reason to replenish the backlog (step 1) and continue.

Select an opportunity. Use the feedback memory, error analysis, data inspection, and diversity portfolio to choose a component and intervention type.
State a hypothesis. Write the expected mechanism of improvement, the risk, and the smallest evaluation that can test it.
Implement cleanly. Make the smallest coherent code change that tests the hypothesis, or deliberately restructure when a larger change is justified. Keep interfaces stable unless changing them is part of the method.
Run checks. Execute unit checks, smoke tests, data-shape checks, protected-file checks, and the benchmark or proxy benchmark.
Evaluate honestly. Record primary metric, guardrails, runtime, memory, variance across seeds if relevant, and comparison to baseline and current leaders.
Analyze the metrics, then diagnose. Every iteration includes a brief metrics analysis — a few sentences, not a report — explaining why the primary metric and guardrails came out as they did: which component or mechanism plausibly drove the result, whether it is consistent with the hypothesis, and whether noise, subgroup composition, or a data artifact could explain it instead. Record this as metric_analysis in the experiment record. When behavior is unclear or surprising, go deeper: inspect residuals, subgroup errors, calibration, feature importance, learning curves, data distributions, memory/time profiles, and representative failures. Convert the analysis into a concrete next intervention.
Ablate. Remove or neutralize one meaningful component at a time to test whether it actually matters. Keep components that survive ablation and simplify or remove components that do not.
Update the portfolio. Promote robust improvements, archive instructive failures, and add nearby hypotheses when a change works. Decay unproductive directions only after fair tests.
Preserve diversity. Continue allocating a meaningful fraction of iterations to underexplored plausible families, especially when all current improvements are small.
Summarize compactly. Keep a one-line iteration log and a structured experiment record. Recording the candidate with add-experiment advances the counter by exactly one (see the counting rule).
Termination gate — mandatory, every pass. After recording the iteration, run python scripts/biomni_method_state.py stop-check --root <run_dir>. You may leave the loop only if it exits 0 (i.e. iteration >= max_iterations, or a hard blocker from the closed list has been recorded). If it exits non-zero, you MUST return to step 1 and start the next candidate — do not summarize, do not "wrap up," do not begin deliverables. If the backlog is empty, replenishing it (diagnosis / ablation / orthogonal-information candidate / complete refactor / literature or data search / simplification / derivation) is the next iteration; an empty backlog is never a stop condition.

A useful iteration log format is:

Iter N | family=<method_family> | intervention=<type> | accept|reject|archive | primary=<value> | guardrails=<summary> | reason=<one line>
Intervention types to sample adaptively

Do not use a rigid schedule. Adapt the mix to the task and evidence, while keeping diversity floors.

Benchmark and infrastructure: repair evaluator setup, add missing sanity checks, stabilize runtime, fix reproducibility.
Representation: normalization, feature construction, embeddings, biological aggregation, graph features, sequence/structure descriptors, missingness handling.
Model form: new algorithm family, architecture, regularization, probabilistic structure, constraints, ensemble design.
Objective and optimization: loss, weighting, ranking, calibration, uncertainty, multi-task learning, early stopping, proxy objectives, search over automatically estimated hyperparameters.
Data integration: safe auxiliary datasets, ontologies, gene sets, pathways, priors, pretrained representations, weak labels, transfer learning.
Diagnosis and error analysis: subgroup behavior, residuals, false positives/negatives, learning curves, calibration, data quality, shift, runtime profile.
Ablation and simplification: remove components, reduce hyperparameters, collapse duplicated logic, prune features, choose faster equivalent algorithms.
Robustness: seed variance, perturbation tests, out-of-domain checks, duplicate handling, noisy labels, missingness, batch effects.
Theory and derivation: formulate a new scoring rule, likelihood, regularizer, bound, approximation, or biological constraint.
Foundation-model workflow: pretraining/fine-tuning objective, representation extraction, retrieval, adaptation schedule, early validation proxy, memory-efficient training.
Packaging: interfaces, documentation, reproducible scripts, dependency minimization, final audit.

When a change clearly improves performance, test nearby variants that share the same mechanism. When a change fails, record why and whether a modified version remains plausible.

Freeze components to accelerate iterations

Iteration speed is a first-class resource. Actively look for parts of the pipeline that can be frozen — computed once, cached, and reused across many candidates — so each new hypothesis only pays the cost of the change it is testing, not the whole pipeline.

Candidates for freezing include: data loading and preprocessing, train/validation splits, feature extraction, embedding computation from pretrained models, expensive normalization or batch-correction transforms, distance/similarity matrices, graph construction, and shared baseline predictions. Cache the outputs (parquet, npz, memmap, sqlite, on-disk arrow) under /workspace/ for hot access and under /mnt/shared-workspace/ for cross-machine reuse, keyed by a content hash of the inputs and the code that produced them so stale caches are detected automatically.

Once a component is frozen, do not silently re-derive it in later iterations. Explicitly mark it as frozen in the method blueprint, and only unfreeze when a candidate genuinely requires modifying that stage — in which case fork a new cache key rather than invalidating the shared one. Freezing must never leak information: cache only from training-safe sources and re-fit any component that depends on the training split when the split changes.

If an iteration is dominated by re-running work that has not changed, that is a signal to freeze more aggressively, not to slow the search. Aim for the marginal cost of a new candidate to approach the cost of the single component it modifies.

Backlog replenishment and algorithmic diversity

If the next action is unclear, do not summarize and stop. Replenish the backlog by sampling a different source of ideas: inspect failure cases, compare against a strong baseline, run a targeted ablation, profile bottlenecks, search for biological priors or public resources, derive a simpler objective, simplify a bloated component, or create a candidate from a different algorithmic family. Reserve a meaningful fraction of the budget for approaches that are scientifically plausible but under-tested, even when they are not the current leader.

Aggressive expansion of search is a primary strategy, not a fallback. Integrating orthogonal information and performing complete architectural refactors are core moves alongside local edits — schedule them proactively while the current best is still improving, not only when it stalls. In particular:

Orthogonal information integration. Actively hunt for information sources the current method does not use at all: a different modality (sequence, structure, expression, imaging, perturbation, clinical), an external database or ontology, a pretrained foundation-model embedding, curated pathway/gene-set priors, adjacent public datasets, physics/mechanistic constraints, or literature-derived features. Convert each into at least one concrete candidate that combines the orthogonal signal with the current best, and one candidate that uses the orthogonal signal alone as a baseline. Do this on a recurring cadence — for example, at least once every N iterations reserved from the budget — so orthogonal information keeps entering the portfolio throughout the week, not just during stalls.
Complete refactors as scheduled candidates. A full rewrite — new representation, new model family, new objective, new inference pipeline, or a rebuild from a fundamentally different derivation — is a legitimate scheduled candidate whenever the current architecture may be structurally limiting, regardless of whether it is currently the leader. Do not gate refactors behind "the current method has clearly stalled." Launch them in parallel with continued incremental work on the leader, using separate machines/sandboxes and isolated working copies. Make each refactor auditable by treating it as a distinct candidate family with its own lineage, preserving the benchmark contract, and evaluating it against the same guardrails.
Diversity floor. Enforce a diversity floor across the run: at any point, a defined minimum fraction of ongoing and recent candidates must come from families that are not descendants of the current best. If that floor is violated, the next scheduled candidate must be an orthogonal-information integration or a complete refactor, not another local edit to the leader.
Diagnostics and ablations

Use diagnosis when the reason for failure or success is unclear. Good diagnostics are structured, cheap, and action-oriented. They can inspect:

Data shape, missingness, distribution drift, label balance, duplicates, batch effects, assay artifacts, confounders.
Error slices by biological entity, cohort, tissue, condition, perturbation, time point, modality, or other relevant strata.
Learning curves, validation curves, overfitting, underfitting, optimization instability, gradient pathologies.
Feature importance, attention/retrieval examples, nearest neighbors, pathway-level contributions, model uncertainty.
Runtime, peak memory, I/O bottlenecks, repeated computation, avoidable serialization.

Use ablation to distinguish real signal from accidental complexity. Change one meaningful factor at a time when possible: feature group, prior, data source, post-processing rule, regularizer, architecture block, augmentation, calibration step, or ensemble member. If a component does not help robustly, remove or simplify it.

Biological data and knowledge integration

Biomni should actively consider whether new data or prior knowledge can improve the method. Integration is especially valuable when the provided data are small, noisy, sparse, imbalanced, multimodal, or biologically structured.

Candidate resources include curated gene sets, pathways, ontologies, protein/domain annotations, sequences, structures, interaction networks, perturbation signatures, expression atlases, variant annotations, phenotype ontologies, drug/compound databases, cell-type markers, literature-derived relationships, and pretrained biomedical embeddings.

For every auxiliary resource, record provenance, license or usage restrictions when available, version/date, preprocessing, join keys, missing coverage, leakage risk, and whether it is train-safe. Prefer features and priors that would be available in realistic deployment.

Derivation and model formulation

When a task calls for a new statistical, mechanistic, or optimization method, spend time deriving it. A derivation record should include:

Variables, assumptions, objective, constraints, and notation.
Biological interpretation of each term.
Optimization or inference procedure.
Expected computational complexity.
Hyperparameters and how to estimate or eliminate them.
Failure modes and diagnostics.
Which theoretical properties must be preserved.

If an approximation is introduced for speed or stability, state what property is weakened and test the practical effect. Do not add mathematically decorative terms that lack an implementation path or evaluation plan.

For lengthy derivations, follow references/derivation_and_model_formulation.md: derive stepwise with a per-step check (units, limiting cases, special-case recovery, symbolic/numeric checks), keep the derivation history (add-derivation --parent-id for revisions), keep the implementation faithful to the derivation with divergences recorded, and distinguish estimation-procedure changes (ordinary experiments) from derivation changes (new derivation record). Validate the derived model with simulation-based calibration, identifiability analysis, and ground-truth simulation before trusting it.

Foundation-model and large-model workflows

For foundation-model work, optimize the metric that predicts useful final performance under realistic compute. Often this is validation loss or downstream validation score after a short fixed budget, such as a five-minute training or adaptation proxy. Use small-scale experiments to rank objectives, data mixtures, tokenization/feature schemes, adapters, retrieval methods, and schedules before committing to expensive runs.

Track tokens/examples processed, wall time, memory, checkpoint size, validation loss, downstream metric, and stability. Prefer approaches that improve early learning curves and can scale without hidden data leakage. Use caching, mixed precision, gradient accumulation, adapters, frozen encoders, distilled features, and smaller proxy models when they preserve the relevant signal.

When target-scale training is too expensive to iterate on directly, follow the scale-ladder protocol in references/foundation_model_optimization.md: rank ideas across 3-4 small scales, fit the Chinchilla-form scaling law with proper design and uncertainty, transfer hyperparameters via muP (never copy LR/batch size upward untuned), and commit to a large run only when the fitted law predicts a gain that justifies its cost.

Analysis mode (tasks without a robust performance metric)

Some tasks — molecular design, synthetic DNA generation, other generative work — have no single number that can decide whether a candidate is better. For these, activate analysis mode at run start: init --mode analysis (default is metric; use analysis mode only when no defensible metric exists). In analysis mode every substantive iteration runs an in-depth comparative analysis of the candidate against the current best and baseline — an open-ended battery that may take dozens of steps and hours — and the experiment record must carry a written verdict (--analysis-verdict improved|not-improved|inconclusive plus --analysis-ref to the artifacts); the helper enforces this. Proxy metrics are evidence, never the sole arbiter; inconclusive never means accept. The full protocol, example batteries, and anti-self-deception rules are in references/analysis_mode.md. Analysis mode defaults to 20 iterations; the stop-check gate is unchanged.

Efficiency, simplification, and code quality

A method that is too slow, memory-heavy, fragile, or sprawling is usually not a good method. Profile after major changes. Common fixes include vectorization, sparse operations, caching immutable features, eliminating repeated I/O, reducing feature dimensionality, precomputing safe artifacts, batching, approximate nearest neighbors, simpler objectives, smaller models, and early stopping.

Limit manual hyperparameters. Prefer defaults estimated from data, validation-only selection, or theoretically grounded constants. Remove unused flags, dead branches, debug prints, heavyweight dependencies, and components that fail ablation.

Anti-gaming and leakage audit

Before accepting any improvement, ask whether it could be caused by a benchmark artifact. Reject or quarantine methods that rely on:

Hidden test labels, final leaderboard feedback, protected files, or evaluator internals.
Sample order, file names, row IDs, path conventions, timestamps, or duplicate leakage.
Target leakage through preprocessing, normalization, feature selection, imputation, augmentation, or auxiliary joins performed before splitting.
Over-tuning to a single random split without repeated validation when variance is high.
Post-processing that encodes benchmark-specific constants without scientific justification.
Excessive complexity that only improves one measured number while harming guardrails.

A promoted method should pass sanity checks: shuffled-label degradation, no-signal baseline comparison, train-only preprocessing, subgroup review, repeated seeds when relevant, and protected hash verification.

Prevent overfitting by optimizing on a smaller validation subset and testing on all of the data, including the validation set. During iteration, evaluate candidates on the smaller validation subset for speed. Before accepting a candidate as an improvement — and always for the final method — re-run it on the full dataset (which includes the validation subset). A candidate that only wins on the subset but does not hold up on the full data is treated as overfitting to the subset and rejected.

Final selection and delivery

Entry precondition (hard gate). Do not enter this phase until the termination gate passes: python scripts/biomni_method_state.py stop-check --root <run_dir> exits 0, i.e. iteration >= max_iterations or a hard blocker from the closed list has been recorded. Immediately before starting any deliverable (final report, package, method lock, or "wrap-up" summary), emit the one-line self-audit STOP-GATE: iteration=<N>/<max>; hard_blocker=<none|infra|benchmark|user|data>; may_finalize=<yes|no>. Building any final deliverable while iteration < max_iterations with hard_blocker=none is a protocol violation — return to Phase 4 instead. (Producing intermediate status snapshots and check-in reports during the run is fine and expected; this gate is specifically about final selection, packaging, and stopping.)

At the end, build a close set of finalists from different method families and simplification levels. Re-run them under the frozen benchmark. Prefer the simplest method whose improvement is robust and whose failure modes are understood. Run final ablations to trim nonessential components.

The final package must include:

final_method/
  README.md
  method code
  reproduce.sh
  run_manifest.json
  benchmark_card.md
  method_card.md
  final_report.md
  dependency notes

The final report should include the problem, data, benchmark, baseline, final method, biological rationale, derivation if applicable, auxiliary resources, experiments, ablations, diagnostics, runtime/memory, leakage audit, limitations, and exact reproduction commands. Generate it with python scripts/biomni_method_state.py render-report --root <run_dir> --out final_method/final_report.md so the complete attempt history (every accepted, rejected, and archived iteration, with metric analyses and reasons) and the derivation history are pre-filled from the ledgers, then write the prose sections.

Do not hide failures. Instructive rejected ideas should remain in the experiment ledger so the user can understand why the final method was chosen.

Reference files in this skill
references/method_development_loop.md: detailed loop and decision rules.
references/benchmark_and_evaluation.md: benchmark setup, metrics, protected files, repeated runs.
references/biological_reasoning_and_priors.md: biological priors and representation ideas.
references/data_integration_and_search.md: safe auxiliary data integration.
references/diagnostics_ablations_and_error_analysis.md: diagnosis and ablation playbook.
references/derivation_and_model_formulation.md: derivation records and theory-preserving changes.
references/foundation_model_optimization.md: foundation-model proxy objectives, scale-ladder protocol, and scaling-law fitting.
references/analysis_mode.md: operating protocol for tasks without a robust performance metric (generative tasks).
references/efficiency_simplification_and_scaling.md: speed, memory, and simplification guidance.
references/integrity_and_reproducibility.md: anti-gaming, leakage, and reproducibility audit.
references/state_and_memory.md: durable state schema.
references/final_delivery_contract.md: final artifact requirements.

Use the helper scripts and templates when useful, but do not let them constrain scientific creativity. They provide scaffolding; Biomni provides the method-development intelligence.

Start now

Create or resume the durable run, freeze or scaffold the benchmark, gather actionable biological and computational evidence, build baselines and a diverse method portfolio, run the active development loop under the budget, select and trim finalists, audit for leakage and robustness, simplify and accelerate the locked method, then package the complete reproducible repository and report.

98. upstream-regulator-analysis
Category: MULTI-OMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

Upstream Regulator Analysis

Identify transcription factors (TFs) driving observed differential expression by integrating ChIP-Atlas TF binding data (epigenomics) with RNA-seq DE results (transcriptomics). Ranks TFs by a combined regulatory score incorporating binding enrichment, target-DE overlap (Fisher's exact test), and directional concordance (activator vs repressor).

When to Use This Skill

Use when you:

Have DE results and want to identify TFs driving expression changes
Need to go beyond simple gene list enrichment to mechanistic TF-level evidence
Want to distinguish activators (targets upregulated) from repressors (targets downregulated)
Want to integrate epigenomics (ChIP-seq) with transcriptomics (RNA-seq) in one analysis

Don't use for:

Single-cell DE results (designed for bulk RNA-seq DE)
Organisms not in ChIP-Atlas (see supported genomes below)
Histone mark analysis (use chip-atlas-peak-enrichment directly)
When you only need TF binding enrichment without target gene integration

Requires: Internet access (ChIP-Atlas API + data server). Runtime: 15-25 minutes (API polling + target gene downloads).

Installation
pip install pandas numpy scipy requests matplotlib seaborn reportlab
Package    Version    License    Commercial Use
pandas    ≥1.5    BSD-3    ✅ Permitted
numpy    ≥1.21    BSD-3    ✅ Permitted
scipy    ≥1.9    BSD-3    ✅ Permitted
requests    ≥2.28    Apache-2.0    ✅ Permitted
matplotlib    ≥3.6    PSF    ✅ Permitted
seaborn    ≥0.12    BSD-3    ✅ Permitted
reportlab    ≥3.6    BSD    ✅ Permitted

Sibling skill dependencies: Requires chip-atlas-peak-enrichment and chip-atlas-target-genes directories at the same level.

Inputs
DE results CSV/TSV with columns: gene symbol, log2 fold change, adjusted p-value
Supports DESeq2 (log2FoldChange, padj), edgeR (logFC, FDR), limma (logFC, adj.P.Val)
Column names auto-detected; override with parameters if needed
Genome: hg38, hg19, mm10, mm9, rn6, dm6, dm3, ce11, ce10, sacCer3
Outputs

Analysis objects:

analysis_object.pkl - Complete analysis for downstream use
Load with: import pickle; obj = pickle.load(open('analysis_object.pkl', 'rb'))
Contains: regulon_scores, enrichment results, target gene data, DE data, parameters

CSV results:

regulon_scores_all.csv - All scored TFs with regulatory score, Fisher's p-value, concordance, direction
regulon_scores_top.csv - Top 20 TFs
target_overlaps.csv - Per-TF target gene overlap with DE status (up/down)
enrichment_up.csv / enrichment_down.csv - ChIP-Atlas peak enrichment results

Visualizations (PNG + SVG):

upstream_regulators_top_regulators - Bar chart: TFs ranked by regulatory score
upstream_regulators_target_overlap - Stacked bar: TF targets classified as up/down/unchanged
upstream_regulators_evidence_scatter - Scatter: ChIP enrichment vs Fisher significance
upstream_regulators_heatmap - Clustermap: TFs × regulatory evidence metrics

Reports:

summary_report.md - Human-readable analysis summary
analysis_report.pdf - Publication-quality PDF with Introduction, Methods, Results, Conclusions
Requires: pip install reportlab (optional — markdown report generated regardless)
Clarification Questions

Input Files (ASK THIS FIRST):

Do you have DE results (CSV/TSV) to analyze?
If uploaded: Is this the DE results file you'd like to find upstream regulators for?
Expected columns: gene symbol + log2FoldChange + adjusted p-value
Or use example data? Three options:
a) Estrogen/MCF7 dataset (recommended) — real DE results from GSE51403 (estradiol-treated MCF7 breast cancer cells, ~58K genes). Expected top regulator: ESR1
b) Airway dataset — real DE results from GSE52778 (dexamethasone-treated airway smooth muscle cells, ~58K genes). Expected top regulator: NR3C1
c) Synthetic TP53-driven data (~200 genes, fast, offline)

Analysis Options:

(If using example data) Choose analysis parameters:
a) Standard analysis (top 10 TFs, q < 0.05) (recommended)
b) Comprehensive analysis (top 15 TFs, q < 0.1)
(If using your own data) What species/genome?
a) Human (hg38)
b) Human (hg19)
c) Mouse (mm10)
d) Other (specify)
Standard Workflow

🚨 MANDATORY: USE SCRIPTS EXACTLY AS SHOWN - DO NOT WRITE INLINE CODE 🚨

Step 1 - Load data:

# For example data (real estrogen/MCF7 dataset, downloads from EBI Expression Atlas):
from scripts.load_example_data import load_example_data
de_data = load_example_data(source="estrogen")

# Alternative: airway dataset (dexamethasone, real data):
de_data = load_example_data(source="airway")

# For synthetic data (offline, fast, TP53-driven):
de_data = load_example_data(source="synthetic")

# For user data:
from scripts.load_de_results import load_de_results
de_data = load_de_results("path/to/de_results.csv")

✅ VERIFICATION: "✓ Data loaded successfully: N total genes, M DE genes (X up, Y down)"

Step 2 - Run integration analysis:

from scripts.run_integration_workflow import run_integration_workflow
results = run_integration_workflow(de_data, genome="hg38", output_dir="regulator_results")

DO NOT write inline API code or custom scoring. Just call the workflow function.

⏱️ This step takes 15-25 minutes (ChIP-Atlas API polling + target gene downloads).

✅ VERIFICATION: "✓ Integration analysis completed successfully!"

Step 3 - Generate visualizations:

from scripts.generate_all_plots import generate_all_plots
generate_all_plots(results, output_dir="regulator_results")

🚨 DO NOT write inline plotting code (ggplot, ggsave, etc.). Just use the script. 🚨

✅ VERIFICATION: "✓ All visualizations generated successfully!"

Step 4 - Export results:

from scripts.export_all import export_all
export_all(results, output_dir="regulator_results")

DO NOT write custom export code. Use export_all().

✅ VERIFICATION: "=== Export Complete ==="

⚠️ CRITICAL - DO NOT:

❌ Write inline API code → STOP: Use run_integration_workflow()
❌ Write inline plotting code → STOP: Use generate_all_plots()
❌ Write custom export code → STOP: Use export_all()
❌ Write custom Fisher's test code → STOP: Built into score_regulons()

⚠️ IF SCRIPTS FAIL - Script Failure Hierarchy:

Fix and Retry (90%) - Install missing package, re-run script
Modify Script (5%) - Edit the script file itself, document changes
Use as Reference (4%) - Read script, adapt approach, cite source
Write from Scratch (1%) - Only if genuinely impossible, explain why

NEVER skip directly to writing inline code without trying the script first.

Common Issues
Error    Cause    Solution
ImportError: sibling skill not found    Missing chip-atlas-peak-enrichment or chip-atlas-target-genes    Ensure both sibling skills are installed at the same directory level
API 400 error    Empty cellClass or invalid parameters    Use cell_class="All cell types" (must be non-empty)
Both enrichment analyses failed    Too few DE genes per direction    Need ≥3 genes in at least one direction (up or down)
No TFs passed enrichment threshold    Stringent cutoff or few DE genes    Try min_enrichment_qvalue=0.1 or add more DE genes
Target gene download timeout    Large TF file or slow connection    Script retries; if persistent, reduce max_tfs
No TFs with target gene data    Enriched TFs are histone marks    Filter with antigen_class="TFs and others" (default)
SVG export failed    Missing svglite/cairo    Normal - PNG always generated; SVG is optional
Interpretation Guidelines
Regulatory Score

Combined evidence: -log10(Fisher P) × Concordance × -log10(ChIP Q)

Score    Evidence
>100    Very strong — high ChIP enrichment + significant target overlap + high concordance
50-100    Strong
20-50    Moderate
<20    Weak — interpret with caution
Direction Classification
Activator (concordance >60%, majority up): TF likely activates these genes
Repressor (concordance >60%, majority down): TF likely represses these genes
Mixed (concordance ≤60%): No clear directional bias — context-dependent regulation
Key Caveats
Results biased toward well-studied TFs/cell types in ChIP-Atlas
Binding enrichment ≠ regulatory causation (validate with perturbation)
Directional labels assume simple activation/repression (ignores context-dependent regulation)
Combined score is a heuristic ranking, not a formal multi-test correction
Fisher's test assumes independence (may be violated if targets cluster in pathways)
Suggested Next Steps

After identifying upstream regulators:

Validate binding: Use chip-atlas-target-genes to examine cell-type-specific binding patterns for top TFs
Functional enrichment: Use functional-enrichment-from-degs on TF-target gene subsets
Co-expression: Use gene-correlation-archs4 to check if TF and targets co-express
Network inference: Use grn-pyscenic for single-cell GRN validation
Literature review: Use literature-review to validate TF-disease associations
Related Skills
chip-atlas-peak-enrichment - Component: TF binding enrichment analysis
chip-atlas-target-genes - Component: TF target gene retrieval
bulk-rnaseq-counts-to-de-deseq2 - Upstream: generates DE results input
de-results-to-gene-lists - Upstream: generates filtered gene lists
functional-enrichment-from-degs - Complementary: pathway-level enrichment
References
Zou Z, et al. (2024) ChIP-Atlas 3.0: a gene regulation data-mining platform. Nucleic Acids Res. 52(W1):W159-W166
Oki S, et al. (2018) ChIP-Atlas: a data-mining suite. EMBO Rep. 19(12):e46255
Fisher RA (1922) On the interpretation of chi-squared. J R Stat Soc. 85(1):87-94

99. variant-calling-from-sequencing
Category: GENOMICS & GENETICS
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

100. virtual-cell-perturbation
Category: TRANSCRIPTOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

Virtual Cell Perturbation Benchmark

Predict single-cell transcriptional responses to genetic perturbations and benchmark predicted vs. measured differential expression on held-out perturbations, then write a polished Phylo-branded PDF report.

This skill is generalized along three axes:

Any GEARS dataset — norman, adamson, dixit, replogle_k562_essential, replogle_rpe1_essential, or a user-supplied AnnData in GEARS/PertData format.
Any perturbation model — a small adapter interface with three built-in predictors: scGPT (foundation model), GEARS (graph neural net), and a control-mean baseline ("predict no change"). New models plug in via one function (see references/model_adapters.md).
Any split / evaluation regime — GEARS simulation / simulation_single split with a seed, or an explicit train/test perturbation list, plus a configurable metric set.
Scope

Does: load a Perturb-seq dataset, build a held-out split, run one or more perturbation predictors, compute the canonical GEARS metrics (per-perturbation and stratified by generalization regime) against held-out cells and a control-mean baseline, make figures, pull benchmark-context literature, and assemble a PDF report.

Does NOT: reimplement scGPT/GEARS internals, design wet-lab CRISPR screens, call differential expression on raw counts (GEARS handles DE-gene bookkeeping), or ship any non-commercial data or weights.

When to use vs. other skills
Use this for predicting/benchmarking perturbation responses (a model produces a post-perturbation expression profile that you score against held-out cells).
Use pooled-crispr-screens instead for screen hit-calling (MAGeCK/enrichment of guides).
Use scrnaseq-scanpy-core-analysis / scrnaseq-seurat-core-analysis for general scRNA-seq QC/clustering with no perturbation-prediction model.
Inputs
Dataset: a GEARS dataset name, or a path to an AnnData (.h5ad) with the GEARS-required fields (condition, cell_type/covariate, gene names in var). See references/datasets_licensing.md for the exact schema and how to run a custom dataset.
Model(s): any of scgpt, gears, baseline (default scgpt,baseline).
Weights (scGPT): either train_from_base (fine-tune scGPT_human, MIT — default) or checkpoint (path or HuggingFace id of a pre-trained fine-tune, faster).
Split: simulation (default) + --split_seed (default 42), or explicit --train_perts / --test_perts files.
Outputs
report_<dataset>_perturbation_benchmark.pdf — Phylo-branded, with an infographic summary panel, intro, methods, results (embedded figures), conclusions, references, and next steps.
figures/F1..F6 as PNG (150 dpi) + editable SVG.
Intermediate arrays / summary JSON / per-perturbation table stay in the working/trace area (not surfaced as user deliverables unless asked).
CRITICAL prerequisites (read before running)
1. GPU + from-scratch environment

scGPT and GEARS are NOT pre-installed in Biomni. You must:

Run on a GPU machine: ManageMachine with action: "create" and a machine of type: "gpu" (e.g. {"name": "gpu-1", "type": "gpu", "spec": {"gpu": "A10G"}}), then run each step with Bash and machine_id: "gpu-1". Prior validated runs used NVIDIA A10G (~23 GB). The baseline-only path is CPU-feasible.
Bootstrap the environment with scripts/setup_env.sh (verified conda/pip recipe; ~7–8 min, I/O-bound).
2. Run long steps in the background on the GPU machine

A foreground Bash call is capped at 60 minutes, so start prediction (~30 min at batch 32 plus setup) and fine-tuning (~15 min/epoch) with run_in_background: true on the GPU machine and check progress with BashOutput. A running background job keeps the machine awake; an idle machine hibernates and wakes with /workspace restored. Deleting the machine loses /workspace, so keep checkpoints and prediction arrays copied to /mnt/results as the scripts do.

3. Memory: use batch_size = 32 for prediction

scGPT attention is O(seq²) over the full gene panel (~5000 genes). batch 64 OOMs; batch 32 is safe (~8 GB). Always export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True.

4. S3-FUSE has no random-access writes

.pt / .npy / .h5ad must be written to local /workspace first, then copied to /mnt/results. All scripts already do this. (R's file.copy to /mnt/results yields 0-byte files — use a shell cp.)

5. Only use open / commercial-use data

Default to open deposited datasets and the train-from-base scGPT_human (MIT) weights so the whole pipeline is unambiguously commercial-safe. If a user dataset's license is unknown or restricted, flag it before running. See references/datasets_licensing.md.

Workflow

Run the numbered steps. Each script takes CLI args; defaults reproduce the validated scGPT-on-Norman benchmark.

Step 0 — Provision GPU + bootstrap env
# With Bash on the GPU machine (machine_id: "gpu-1"):
bash scripts/setup_env.sh          # conda env at /workspace/scgpt_env (~7-8 min)
Step 1 — Data + split
PY=/workspace/scgpt_env/bin/python
$PY scripts/prepare_data.py --dataset norman --split simulation --split_seed 42 \
    --batch_size 32 --data_dir /workspace/data
# Prints & asserts split regime composition (provenance). Verifies dataset is open.
Step 2 — Get weights (scGPT only; choose ONE path)

First get the base scGPT_human checkpoint (needed for either path — it provides args.json + vocab.json + base weights):

$PY scripts/get_checkpoint.py --which base --out_dir /workspace/save/scGPT_human

Then either fine-tune from base, or fetch a ready fine-tune:

# (a) train-from-base (default, MIT, license-clean; ~90+ min with a time cap):
$PY scripts/train_scgpt.py --dataset norman --split_seed 42 --max_epochs 6 \
    --time_cap_min 105 --load_model /workspace/save/scGPT_human \
    --save_dir /workspace/save/ft         # -> /workspace/save/ft/best_model.pt (+ state.json)
# (b) OR Norman-only fast path: download a published fine-tune (reuses base args/vocab):
$PY scripts/get_checkpoint.py --which norman-ft --out_dir /workspace/save/ft \
    --base_dir /workspace/save/scGPT_human

GEARS trains quickly inside its adapter; the baseline needs no weights.

Step 3 — Predict (ONE model per call; arrays saved immediately)

predict.py takes a single --model; run it once per model you want to compare. The baseline is also recomputed for free inside Step 4, so a single scGPT run is usually enough — add explicit baseline/gears runs only if you want their arrays saved.

export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
$PY scripts/predict.py --model scgpt --dataset norman --split_seed 42 \
    --batch_size 32 --base_model /workspace/save/scGPT_human \
    --ft_ckpt /workspace/save/ft/best_model.pt --out_dir /mnt/results/execution_trace/preds
# optional extra models (separate out_dirs):
# $PY scripts/predict.py --model gears    --dataset norman --gears_epochs 15 --out_dir .../preds_gears
# $PY scripts/predict.py --model baseline --dataset norman --out_dir .../preds_baseline
Step 4 — Metrics vs. held-out DE + baseline
$PY scripts/aggregate_metrics.py --dataset norman --split_seed 42 \
    --preds_dir /mnt/results/execution_trace/preds \
    --out /mnt/results/execution_trace/benchmark_metrics.json \
    --pkl /mnt/results/execution_trace/benchmark_full.pkl

Uses verbatim GEARS compute_metrics (mse, mse_de, pearson, pearson_de) and deeper_analysis (pearson_delta, pearson_delta_de, frac_correct_direction_{20,50,100,200,all}), per-perturbation and stratified by regime.

Step 5 — Figures (worker-0, no GPU; run media check after each)
python scripts/make_figures.py --pkl /mnt/results/execution_trace/benchmark_full.pkl \
    --metrics /mnt/results/execution_trace/benchmark_metrics.json \
    --preds_dir /mnt/results/execution_trace/preds --figdir /mnt/results/figures \
    --named_example JUN+CEBPA \
    --curve /workspace/save/ft/state.json   # optional: real training curve for provenance (F2)

--curve is optional: include it ONLY if you actually fine-tuned (Step 2a). For a downloaded checkpoint, omit it — F2 falls back to a provenance table, never a fake curve.

Step 6 — Literature (benchmark context)

Use the LiteratureSearch tool (NOT a script) to pull published perturbation-prediction benchmarks for the intro/discussion + references, e.g. queries like "single-cell perturbation response prediction benchmark", "scGPT perturbation Norman", "GEARS genetic perturbation prediction", "CellFlow perturbation". LiteratureSearch appends structured records to execution_trace/references.jsonl. Then format them for the report:

python scripts/literature_search.py \
    --refs_jsonl /mnt/results/execution_trace/references.jsonl \
    --out /mnt/results/execution_trace/references.json

This de-dupes and keeps the verified anchor papers (scGPT, GEARS, and the dataset paper) first. Verify every cited number against the returned records; never fabricate citations.

Step 7 — PDF report (leverages the pdf-report-generation skill)

Load and follow the pdf-report-generation skill for ReportLab styling conventions (Phylo gold-accent palette, title page, per-page header/footer, validation). scripts/build_report.py implements that template — it consumes benchmark_metrics.json + figures/ + references.json and assembles the sections infographic summary → intro → methods → results → conclusions → next steps → references:

python scripts/build_report.py \
    --metrics /mnt/results/execution_trace/benchmark_metrics.json \
    --figdir /mnt/results/figures \
    --references /mnt/results/execution_trace/references.json \
    --curve /workspace/save/ft/state.json \
    --out /mnt/results/report_norman_perturbation_benchmark.pdf

It self-validates (page count, size, extractable text). After it runs, also do a visual Read(file_path=...) on the PDF; regenerate if anything is blank or clipped.

Metrics & scientific caveats
Judge perturbation skill on the delta metrics. Absolute-expression correlations (pearson, pearson_de) are misleadingly high for any method because most genes don't move; a trivial control-mean baseline matches a real model on them. Real skill shows up in pearson_delta (change-from-control correlation) and top-k DE direction match.
Control-mean baseline nuance (do not misreport). For the "predict no change" baseline, Δ-correlations and top-k direction metrics are exactly 0 by construction, but frac_correct_direction_all is a small nonzero (~0.26) artifact — the sign of a near-zero predicted change coincidentally matches a near-zero true change for unchanged genes. Compare models on top-k DE direction, not the all-gene one.
Generalization is regime-dependent. GEARS simulation split stratifies test perturbations into combo_seen0/1/2 and unseen_single. Accuracy is highest for combinations of previously seen genes and lowest when a gene was never seen; report the stratified breakdown, and treat tiny regimes (e.g. combo_seen0, often n≈2) as illustrative.
Genome/vocab overlap. scGPT only scores genes present in its vocabulary (~90% for Norman). Report the match fraction.
Provenance, not fabrication. Only plot a training curve if you actually trained (--curve state.json). Never synthesize a curve for a downloaded checkpoint.
Reproducibility. GEARS splits are deterministic per seed; record the seed and the split regime counts so results are reproducible.
Compute / resource summary
Stage    Target    Time (validated)    Memory
Env bootstrap    GPU machine    ~7–8 min (I/O)    small
Fine-tune scGPT    GPU (A10G)    ~15 min/epoch    ~8 GB @ batch 32
Predict    GPU (A10G)    ~30 min    ~8 GB @ batch 32
Metrics + figures + report    worker-0 (CPU)    minutes    small

Run predict and train as background Bash jobs on the GPU machine. Chunk long work and checkpoint to persistent storage.

Files
scripts/setup_env.sh — verified conda/pip environment recipe.
scripts/prepare_data.py — load GEARS dataset / user AnnData, build split, licensing guard.
scripts/train_scgpt.py — fine-tune scGPT_human (train-from-base path).
scripts/get_checkpoint.py — fetch a pre-trained checkpoint (fast path).
scripts/predict.py — pluggable adapters (scgpt / gears / baseline); saves arrays immediately.
scripts/aggregate_metrics.py — verbatim GEARS metrics, per-pert + regime-stratified.
scripts/make_figures.py — generalized F1–F6 with mandatory media checks.
scripts/literature_search.py — format LiteratureSearch records into references.json.
scripts/build_report.py — Phylo PDF template (use with pdf-report-generation).
references/model_adapters.md — how to add a new model in one function.
references/metrics.md — exact metric definitions and interpretation.
references/datasets_licensing.md — dataset schema, available datasets, licenses.
references/gpu_platform_notes.md — the timeout/OOM/S3-FUSE gotchas in detail.