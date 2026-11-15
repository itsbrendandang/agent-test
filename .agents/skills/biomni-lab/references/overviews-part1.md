Observation 9bf12ccb2b6b is dropped from active memory but remains recallable.

[User @ 2026-11-14 16:52]: Set up the new skills: Biomni Lab — Complete Skills Reference
Part 1 of 2 · Skills 1–50 · Copied November 14, 2026

Full Overview instructions for all 100 skills listed in the Biomni Skill Hub. Original wording and code text are preserved as displayed. Supporting scripts, datasets, and reference-file contents are not reproduced; open each source skill’s Files tab for those package materials.

Continue in Part 2: https://docs.google.com/document/d/1dnXwEvBXq6OsuJ6GchtZ5EwF84MTeKZZyivS_3BAsQE/edit
Skill Hub: https://biomni.phylo.bio/skills

1. adme-ml-modeling
Category: DRUG DISCOVERY
Source: https://biomni.phylo.bio/skills/skill_9fd3e0632ea54e148757bb2469292ab8?section=marketplace

ADME ML modeling

Run the deterministic tools in scripts/biomni_tools.py. Keep scientific meaning in an explicit dataset specification; do not infer assay compatibility from a filename or endpoint name.

Scope

Build, honestly evaluate, save, and apply supervised single-endpoint small-molecule in-vitro ADME models from a labelled assay table. One endpoint and one compatible assay signature per run; nested inner selection with a locked outer prospective-style assessment; censor-aware AFT fitting; MAPIE conformal intervals or sets; applicability-domain flags; and model-bundle scoring of new molecules.

Do not use for:

unlabelled pretrained ADMET prediction (no labels to audit or assess);
atom-level metabolism or metabolite-identification (regioselectivity, CYP site-of-metabolism);
biologics (antibodies, peptides, proteins — the molecular features and assay context differ);
in-vivo PK time series (concentration-vs-time profiles require PK/PD modelling, not a single endpoint);
population PK / popPK (covariate-level mixed-effects modelling, not endpoint prediction).
Inputs

Accepted table formats (read by read_table): CSV, TSV, SDF, and SMI/SMILES. The SMILES column is required; its name defaults to smiles but can be set via smiles_column.

Required columns:

smiles_column — a valid SMILES string per row.
endpoint.label_column — the measurement column (numeric for regression, two-valued for classification).

Optional but recommended columns:

date_column — measurement date; enables temporal splitting (the preferred default).
assay_context_columns — assay/protocol ID, species, matrix, pH, etc.; the audit treats distinct combinations as distinct assay signatures and blocks mixed signatures.
endpoint.unit_column — units; the audit blocks mixed or mismatched units.
endpoint.qualifier_column — <, >, <=, >= censor qualifiers; preserved as intervals.
series_column — project/series label for grouped random splits.
compound_id_column — external compound identifier.

Bundled asset: assets/sample-test-set.csv — 100 real molecules with smiles, design_source, design_regime, and measured_logD columns, built by scripts/build_sample_test_set.py against the real Lipophilicity_AstraZeneca benchmark to span both applicability-domain regimes: 50 in-domain molecules (lipophilicity_holdout) randomly held out of the Lipophilicity training set — same endpoint and chemical space, real measured logD, not verbatim reference members — and 50 out-of-domain molecules (aqsoldb_external) from a distinct database (AqSolDB), restricted to molecular weights outside the training set's drug-like MW window (a chemical-property criterion that does not use the AD metric). Scoring it exercises the in-domain prediction path and the extrapolation-warning path. design_regime records the intended regime only; the achieved nearest-neighbour similarity and in-domain fraction are measured at runtime (predictions.csv / prediction_manifest.json), never assumed and never tuned to a target. At the last regeneration the measured overall in-domain fraction was 0.72 (in-domain block 0.96, out-of-domain block 0.48). See references/example_data.md for composition, data sources, licences (CC BY 4.0), and the recorded numbers.

Operating rules
Model one endpoint and one compatible assay signature per run.
Call inspect_adme_dataset before training. Resolve status=blocked; never guess through mixed units, mixed assays, invalid class mappings, or contradictory censoring.
Prefer a temporal split when complete measurement dates exist. Otherwise use scaffold. Use deployment/MOOD when the actual prospective structures are supplied. Treat random as an interpolation diagnostic only.
Keep the locked outer test partition out of feature/model selection, calibration, threshold choice, and the locked-test applicability-domain assessment. The AD threshold and the locked-test AD flags are fitted on outer-training molecules only. The deployment bundle's AD reference set is deliberately different — all audited molecules (train+test) — and is used only to score new molecules, never in the locked assessment.
Preserve <, >, <=, and >= labels as intervals. The runtime uses XGBoost AFT for censored positive quantities; set scale: log10 when labels are log10 values of a positive physical endpoint.
Report the locked outer result, the 1-NN baseline, uncertainty coverage, and domain status. Do not present inner-CV performance as prospective performance.
Deliverables describe the analysis, not this skill. A report — its title, subtitle, executive summary, and body — states the endpoint, units, task, split, and assessment, and must never name this skill, state its version, or reference its development, revision, or repair history. Provenance lives only in run_manifest.json.
The locked outer intervals and the deployment-bundle intervals come from different conformal estimators — outer is split conformal (single calibration quantile, constant symmetric width), deployment is CV+ (per-molecule, asymmetric) — so do not carry a width statement from model_card.md over to predictions.csv. The card describes each estimator separately.
When the prediction manifest reports a domain_warning, lead the summary with it.
Do not install dependencies into an active Biomni session. Build the pinned runtime from pyproject.toml/uv.lock in an isolated environment. Run preflight first: it returns unsafe_environment and refuses to proceed when a virtual-env marker (VIRTUAL_ENV / UV_PROJECT_ENVIRONMENT) points inside the live session workspace, and missing_dependencies when the pinned stack is absent. Route to the isolated environment instead of installing into the session; override the guard only with ADME_SKILL_ACK_SESSION_ENV=1 for a genuinely isolated environment that happens to live under the session workspace.
Workflow
Construct a dataset specification. Read references/assay_schema.md when endpoint units, class semantics, assay context, or censor qualifiers need framing. Declaring the assay context up front matters because ADME measurements are protocol-dependent: a solubility value measured at pH 7.4 is not interchangeable with one at pH 2, and merging them silently destroys the label scale.
Run inspect_adme_dataset(dataset_spec, output_dir). The audit standardises structures, blocks mixed assays/units, preserves censoring, and checks for sufficient data — all before any model sees the data, so a blocked audit never leaks into a misleading model.
If ready, construct a run configuration and run train_adme_model(dataset_spec, run_config, output_dir). The runtime locks the outer partition first, then selects candidates only on outer-training data. A temporal split is the right default for ADME because assay protocols, instruments, and project chemistry drift over time — a model validated on random splits over-estimates performance on the later, structurally dissimilar molecules that actually arrive in deployment.
Read model_card.md, evaluation.json, and outer_test_predictions.csv. Distinguish model selection (inner CV) from locked assessment (outer test). The card now describes both the outer split-conformal estimator and the deployment CV+ estimator separately.
For new structures, run predict_adme_model(model_bundle_path, data_path, smiles_column, output_dir). The prediction manifest reports applicability-domain counts, interval-width stats, and a domain_warning when most scored molecules are out of domain.
Surface out-of-domain rows and wide intervals or ambiguous class sets before summarizing individual predictions. When the manifest carries a domain_warning, lead with it.
Mandatory terminal step — the run is not complete until it has happened. Use the pdf-report-generation skill to generate a pdf report with infographics (use the Biomni GenerateImage tool), methods, results, conclusions, figures, references, and next steps from all of the analyses.

Ask the user only when a missing scientific choice changes the problem: endpoint identity, units/transformation, class mapping, assay compatibility, or deployment question. Make routine implementation choices autonomously and record them.

Default demonstration (real public benchmark)

The default demonstration and every headline number use real measured assay data. Fetch a real single-endpoint benchmark with the standard library only (no credentials, no added dependency), then run the ordinary audit → train → predict workflow:

python scripts/fetch_benchmark.py --name lipophilicity_astrazeneca --out /workspace/lipophilicity.csv

fetch_benchmark.py downloads Lipophilicity_AstraZeneca — 4,200 real experimental logD₇.₄ values (AstraZeneca 2016 via MoleculeNet; Harvard Dataverse/TDC; CC BY 4.0) — and dataset_spec_for(...) frames it as task=regression, scale=linear (logD is a log-ratio that can be negative; not log10) with a scaffold split (no dates). Feed that spec through inspect_adme_dataset → train_adme_model (feature sets ecfp + desc2d) → predict_adme_model on assets/sample-test-set.csv. Headline metrics then come from real labels (a deterministic build at authoring selected XGBoost on 2-D descriptors with locked-outer R² ≈ 0.64, MAE ≈ 0.61 logD, Spearman ≈ 0.79). fetch_benchmark.py also exposes AqSolDB (aqueous solubility, CC BY 4.0); it records source, licence, and citation on every run.

The synthetic scripts/make_example_data.py generator is retained only as an offline, network-free smoke test — it is not real measurements and its metrics must never be reported as real-assay performance. There is no synthetic fallback for the demonstration: if the real fetch cannot run unattended, stop and say so rather than substituting synthetic data. See references/example_data.md for sources, licences, and the recorded numbers.

Dataset specification

Pass a JSON-compatible object:

{
  "data_path": "/workspace/caco2.csv",
  "smiles_column": "smiles",
  "date_column": "measured_at",
  "assay_context_columns": ["assay_id", "species", "matrix", "pH"],
  "series_column": "project_series",
  "endpoint": {
    "label_column": "log10_papp",
    "task": "regression",
    "scale": "log10",
    "unit": "log10 cm/s",
    "unit_column": "unit",
    "qualifier_column": "qualifier"
  }
}

For classification, provide an explicit mapping unless the source is already numeric 0/1:

{
  "label_column": "call",
  "task": "classification",
  "unit": "class",
  "class_mapping": {"inactive": 0, "active": 1},
  "positive_class": "active"
}

Do not set allow_mixed_assays: true merely to bypass an audit. Use it only after documented harmonization establishes that the assay contexts share a response scale.

Run configuration

Use conservative defaults:

{
  "split": "auto",
  "test_fraction": 0.2,
  "inner_splits": 3,
  "feature_sets": ["ecfp", "desc2d"],
  "confidence_level": 0.9,
  "calibration_fraction": 0.2,
  "probability_threshold": 0.5,
  "n_bootstrap": 300,
  "seed": 0
}
auto: time when a date column is declared, otherwise scaffold.
deployment: require deployment_path; Splito MOOD selects the candidate split whose distance profile best matches those prospective structures.
cluster: hold out molecular feature clusters.
random: use only when interpolation among similar compounds is the deployment question.
models: optionally restrict the maintained ladder. Uncensored tasks support dummy, true Morgan/Tanimoto 1-NN, ridge/logistic, and XGBoost. Censored tasks support only bound-aware aft_constant and aft_xgb.

Read references/validation_design.md before overriding the split or interpreting selection.

Biomni registration

Register the functions, not the markdown workflow:

from biomni_tools import inspect_adme_dataset, predict_adme_model, train_adme_model

agent.add_tool(inspect_adme_dataset)
agent.add_tool(train_adme_model)
agent.add_tool(predict_adme_model)

Use tool_descriptions() from the same module when generating Biomni tool-description entries. See references/biomni_runtime.md for environment and deployment details.

Required outputs

A training run must provide:

dataset_audit.json and split_assignments.csv
model_comparison.csv with an explicit selected row
evaluation.json with locked outer metrics and grouped bootstrap intervals
outer_test_predictions.csv with uncertainty and domain columns when supported
model_bundle.joblib and model_card.md
run_manifest.json with input, artifact, configuration, and dependency hashes/versions
report_adme_model.pdf — Use the pdf-report-generation skill to generate a pdf report with infographics (use the Biomni GenerateImage tool), methods, results, conclusions, figures, references, and next steps from all of the analyses.

Prediction runs must provide predictions.csv plus prediction_manifest.json. The manifest reports applicability-domain counts, interval-width stats, and a domain_warning when most scored molecules are out of domain. Preserve rows with invalid structures and label them invalid_structure instead of silently dropping them.

Scientific caveats
Assay-context non-transferability. A model trained on one assay signature (protocol, species, matrix, pH) does not transfer to another, even if both are called "solubility" or "Papp". The audit blocks mixed signatures by default; do not bypass it without documented harmonization.
Conformal validity under shift. Conformal coverage guarantees rely on exchangeability. Temporal or chemical distribution shift weakens them — under-coverage on a time/scaffold test is a shift warning, not a calibration bug to relabel as a guarantee.
In-domain flag is not proof of accuracy. The applicability-domain flag checks nearest-neighbour similarity against a threshold; it is a support indicator, not a correctness guarantee. An out-of-domain flag means the prediction is an extrapolative hypothesis requiring experimental confirmation.
Censored limits are intervals, not measurements. < and > values are modelled as intervals via XGBoost AFT, never converted to exact values. MAE/RMSE are reported only on exact observations; interval C-index is the primary metric when censoring is material.
Interpretation

Read references/interpretation.md before communicating model quality or individual predictions. Always state:

the outer split and intended deployment question;
lift over dummy and 1-NN baselines from inner selection results;
uncertainty coverage on the locked test set, not just nominal confidence;
the fraction and identity of out-of-domain predictions;
assay, unit, censoring, sample-size, and distribution-shift limitations.

2. antibody-developability-humanization
Category: MOLECULAR DESIGN
Source: https://biomni.phylo.bio/skills/skill_1428c3775e3d807bc46446cc90c2a6a0?section=marketplace

Antibody humanization & liability assessment

End-to-end, sequence-based assessment and humanization of a monoclonal antibody. Given a VH + VL (or a single chain), it runs four always-on analyses — developability liabilities, aggregation propensity (named AGGRESCAN a3v predictor), MHC-II immunogenicity, and (for non-human antibodies) humanization with acceptor comparison — and emits a Phylo-branded PDF report plus a machine-readable master table. It requires no clinical reference; a blind benchmark against a known reference antibody is an optional add-on, not the default.

Aggregation is scored with a named predictor, not a surrogate. Aggregation risk uses the published AGGRESCAN aggregation-propensity scale (a3v; Sanchez de Groot et al., FEBS J 2006 / Conchillo-Sole et al., BMC Bioinformatics 2007) — an experimentally-derived, sequence-based scale — to compute a windowed aggregation profile, call aggregation-prone regions (APRs; runs of >=5 residues above the hot-spot threshold with no proline, since AGGRESCAN treats proline as an aggregation breaker), and roll up a CDR-weighted aggregation burden. GRAVY hydrophobicity / pI / net charge are still reported but only as descriptive context, never as the aggregation metric. This is deliberately a sequence-based predictor (no 3D structure required, keeping the skill structure-free and fully reproducible); it does not model 3D spatial aggregation patches or colloidal effects. When a folded Fv is available, a structure-based predictor is the recommended upgrade — see "Aggregation: sequence-based vs structure-based" below.

When to use this skill

Use it for any antibody-sequence engineering question, e.g.:

"Is this antibody developable / what are its liabilities?"
"Humanize this murine antibody / graft these CDRs onto a human framework."
"How immunogenic is this sequence / what are its T-cell epitopes?"
"Compare humanization strategies (nearest germline vs consensus framework)."
"Score the framework humanness of these constructs."

It auto-detects the input type and does the right thing:

non-human paired Fv -> humanize (compare acceptors) + assess all constructs
already-human paired Fv -> assess only (no humanization proposed)
single domain (VHH / lone VH or VL) -> assess as-is
Setup (once per environment)

The antibody-numbering stack is not in the default image. Install it first:

bash scripts/00_setup_env.sh

This installs ANARCI + abnumber (numbering), HMMER (ANARCI backend), pyteomics (pI/charge), and confirms biopython/pandas/reportlab/pypdf are present. NetMHCIIpan is licensed and never auto-downloaded — if a local install exists, point at it with export NETMHCIIPAN_BIN=/path/to/netMHCIIpan; otherwise the immunogenicity step uses the IEDB web API, and if there is no egress it marks that section unavailable rather than fabricating numbers.

Fastest path — the orchestrator

scripts/run_pipeline.py runs the whole pipeline (gate -> ingest -> humanize -> reassess -> benchmark? -> figures -> PDF). Run scripts from the scripts/ directory (they import each other by module name).

cd scripts

# Bundled demo A: murine muMAb 4D5, reference-present benchmark vs trastuzumab
python run_pipeline.py --example mumab4d5 --outdir /path/out_4d5

# Bundled demo B: adalimumab (already human) -> assess-only
python run_pipeline.py --example adalimumab --outdir /path/out_ada

# Your antibody from a FASTA with two records (VH then VL):
python run_pipeline.py --fasta my_ab.fasta --name MyAb --outdir /path/out_myab

# Or pass sequences directly:
python run_pipeline.py --vh "EVQL..." --vl "DIQM..." --name MyAb --outdir /path/out

# Optional reference-present benchmark (only if you have a validated counterpart):
python run_pipeline.py --fasta my_ab.fasta --name MyAb \
    --ref-vh "EVQL..." --ref-vl "DIQM..." --ref-name trastuzumab \
    --outdir /path/out

# Fast developability-only pass (skip MHC-II, report axis as unavailable):
python run_pipeline.py --example adalimumab --no-immuno --outdir /path/out

Useful flags: --level {aggressive|moderate|conservative|maximal} (back-mutation aggressiveness, default conservative; note "aggressive" = FEWEST back-mutations = most human), --scheme {kabat|imgt} (default kabat), --dr-panel (comma- separated HLA-DR alleles; default is the 7-allele IEDB reference set).

Outputs written to --outdir: report_<name>.pdf, master_frontier.csv, payload_<name>.json, and a figures/ folder.

Programmatic use
import run_pipeline
res = run_pipeline.run(
    vh=MY_VH, vl=MY_VL, name="MyAb", outdir="/path/out",
    reference=None,           # or {"name":..., "VH":..., "VL":...} for benchmark
    level="conservative", scheme="kabat",
    run_immunogenicity=True,  # False -> degrade honestly, no epitope numbers
)
# res -> {branch, mode, master (DataFrame), reassess, humanize, benchmark,
#         pdf_path, csv_path, payload_path, figures}
The pipeline modules (verified interfaces)

Call these directly only for custom workflows; otherwise use the orchestrator.

species_format_gate.gate(vh, vl, scheme) -> {branch, do_humanize, do_assess, ...} where branch in {paired_nonhuman, paired_human, single_domain}.
ingest_sequences.ingest(vh=None, vl=None, fasta_text=None, name=...) -> {VH, VL, warnings, source, needs_confirmation} (pass FASTA content, not a path).
humanize_backmutate.humanize(vh, vl, scheme="kabat", level="conservative") -> {constructs, backmutations, acceptors, derived_acceptors, scheme, level}. Builds donor, hu_consensus_graft, hu_consensus_bmut, hu_nearest_graft, hu_nearest_bmut.
ab_core.aggregation_scan(chain, chain_name, cdr_weight=1.6) -> (apr_df, rollup). Named AGGRESCAN a3v aggregation assessment for one domain: computes the windowed a4v profile, calls APRs (runs of >=5 residues above the hot-spot threshold), and rolls up agg_score, n_APR, APR_in_CDR, APR_in_FR, agg_weighted, max_a4v, window. ab_core.aggregation_profile(seq) exposes the raw (a4v, window); A3V, A3V_HST, MIN_APR_LEN are the scale/thresholds.
reassess_constructs.reassess(constructs, scheme="kabat", dr_panel=None, run_immunogenicity=True) -> keys incl. developability_summary, liabilities, biophysical, aggregation_aprs, humanness, immunogenicity_fv, immunogenicity_chain, immunogenicity_status, immunogenicity_reason, master. The master frontier now also carries the aggregation columns agg_score_Fv, n_APR, APR_in_CDR, APR_in_FR, agg_weighted, and aggregation_aprs is the per-APR detail table. (Note: developability_scan.scan_construct / scan_all now return an extra trailing apr_df element.)
benchmark_reveal.benchmark(constructs, ref_vh, ref_vl, lead_key, graft_key, scheme, canonical, ref_name) -> {identity, concordance, scores}. Also identity_vs_reference(constructs, ref_vh, ref_vl, design_keys=None).
make_figures.make_all(master, dev_summ, fv_immuno, immuno_status, humanness, outdir, order, ref_key, benchmark) -> {fig_name: [png, svg]}.
build_report.serialize_payload(...) then build_report.build_report(payload, out_path); build_report.validate_pdf(path) sanity-checks the result.
load_example_data.get_example(name) — bundled examples (mumab4d5, adalimumab; aliases 4d5, humira).
Report modes (see references/report-modes-guide.md)
reference_absent (DEFAULT) — no benchmark language at all.
reference_present (OPTIONAL) — adds a blind convergence test vs a supplied reference (identity, back-mutation concordance, canonical recovery). The benchmark only scores a blind design; it never chooses it.
The report is also branch-aware: already-human input yields an assess-only report that states no humanization is proposed; non-human input yields a grafting report. When the MHC-II axis is unavailable the report says so and shows no epitope numbers.
Aggregation: sequence-based (default) vs structure-based (upgrade)

Why sequence-based is the default here. The whole skill is designed to run from sequence alone (no folding step), which keeps it fast, deterministic, fully reproducible, and free of any structure-prediction/FoldX dependency. The AGGRESCAN a3v predictor fits that design: it is a named, experimentally-derived, peer-reviewed aggregation scale (unlike the GRAVY/charge surrogates it replaces), yet it needs only the linear sequence. For a first-pass developability triage and for comparing humanized constructs against the parent, this is the right tool.

Its honest limitation. A purely sequence-based scale cannot see the folded structure: it may flag aggregation-prone stretches that are actually buried in the native fold, and it misses 3D aggregation patches formed by residues far apart in sequence but close in space, as well as colloidal/charge-network effects. The report states this explicitly and never over-claims.

The structure-based upgrade path (optional, when a folded Fv exists). For a confirmatory, structure-aware read, run a structure-based predictor on a predicted or experimental Fv:

AggreScan3D (A3D) — the structure-based extension of this exact a3v scale (Kuriata et al., NAR 2019). pip install aggrescan3d; needs a PDB (fold the Fv first, e.g. via the HPC folding tools ESMFold/Boltz-2 available in this environment), and FoldX for its dynamic/mutation mode (static mode works on a fixed model).
TAP (Therapeutic Antibody Profiler) — antibody-specific developability flags incl. patches of surface hydrophobicity, via SAbPred (web); also needs an Fv model. These are documented rather than run by default because they add a structure step; wire one in when a structure is on hand or 3D-patch confirmation is required.
Reference guides (read before non-trivial changes)
references/humanization-guide.md — acceptor philosophies (consensus vs nearest), Vernier/interface/canonical position sets, back-mutation levels.
references/liability-rules.md — the exact motif set, severities, and 1.6x CDR weighting.
references/aggregation-rules.md — the AGGRESCAN a3v scale, hot-spot threshold, APR calling, window sizing, CDR-weighting, and the sequence-vs- structure scope.
references/immunogenicity-guide.md — the 3-tier predictor, epitope-calling thresholds, honest degradation, and the HLA-DR panel.
references/report-modes-guide.md — the four report configurations and the lead-selection policy.
Guardrails
Never fabricate immunogenicity numbers. If no predictor is available, the axis is reported as unavailable and ranking uses developability + humanness only.
Aggregation uses the named AGGRESCAN a3v scale, not GRAVY/charge. Do not silently substitute a hydrophobicity/charge surrogate for the aggregation metric; GRAVY/pI/charge are context only. Do not re-tune the a3v values, the hot-spot threshold, or the >=5-residue APR rule without noting the deviation. Report the sequence-based scope honestly and do not present it as a structure-aware 3D-patch result.
Keep the benchmark blind. Humanization is built without reference to any known counterpart; the reference is used only for post-hoc scoring in reference-present mode.
CDRs are grafted verbatim; back-mutations touch framework only (Vernier / interface / canonical positions), never CDRs.
Compare constructs only when scanned against the same HLA-DR panel and scheme.
Data sources & attribution

MHC-II epitope predictions use the Immune Epitope Database (IEDB). Please acknowledge and cite it when you present results (commercial use is permitted; a citation is expected):

Epitope data and MHC-II binding predictions from the Immune Epitope Database (IEDB, https://www.iedb.org), a free public resource funded by NIAID.

IEDB database: Vita R, Blazeska N, Marrama D, et al. The Immune Epitope Database (IEDB): 2024 update. Nucleic Acids Res. 2025 Jan 6;53(D1):D436-D443. doi:10.1093/nar/gkae1092.
IEDB prediction tools (used here for MHC-II binding): Dhanda SK, Mahajan S, Paul S, et al. IEDB-AR: immune epitope database-analysis resource in 2019. Nucleic Acids Res. 2019 Jul 2;47(W1):W502-W506. doi:10.1093/nar/gkz452.

Data handling — read before running proprietary sequences. When no local NetMHCIIpan is installed, the immunogenicity step falls back to the hosted IEDB web API and transmits your input VH/VL sequences to iedb.org for prediction. To keep sequences on-machine, install NetMHCIIpan locally and point the skill at it with export NETMHCIIPAN_BIN=/path/to/netMHCIIpan (the local predictor is always preferred over the API). See NOTICES.md for the full data-flow description.

3. binder-antibody-design
Category: MOLECULAR DESIGN
Source: https://biomni.phylo.bio/skills/skill_af98a09aa8536dce4a7157f8f270a880?section=marketplace

Binder & Antibody Design (RFdiffusion / RFantibody → ProteinMPNN → co-fold validation)

Design binders against a protein target and deliver ranked candidates with sequences, an epitope map, figures, and a PDF report. Two tracks share the same target-prep, interface-analysis, figure, and report tooling:

Track A — de novo mini-protein binder (typically 60–90 aa): RFdiffusion → ProteinMPNN → Boltz-2. Fully scripted and validated (see PCSK9 worked example).
Track B — antibody / nanobody (CDR-loop design onto a framework): the RFantibody pipeline (RFdiffusion_Ab → ProteinMPNN interface design → RF2 prediction/filtering).

Pick the track from what the user wants to make. If they say "binder", "mini-binder", or "de novo protein" → Track A. If they say "antibody", "nanobody", "VHH", "scFv", or "CDR" → Track B. If unclear, ask which modality they want.

Scope

Does: end-to-end structure-based binder design against a single protein target, in two modalities. Shared for both: crop the target epitope, design sequences with ProteinMPNN, predict/validate the complex, rank by interface confidence (ipTM/pAE, interface PAE, contacts) and on-target epitope recovery (hotspot recovery), map the epitope in native numbering, and build a PDF report.

Track A (de novo mini-binder): generate binder backbones with RFdiffusion, co-fold each candidate with the target using Boltz-2. Fully scripted and reproduced (PCSK9 example).
Track B (antibody/nanobody): dock + diversify CDR loops onto an antibody framework with RFantibody's antibody-finetuned RFdiffusion, then predict/filter with RF2. Uses the RFantibody container's own pipeline scripts (documented in references/hpc_commands.md).

Does NOT: predict experimental binding affinity (ipTM/PAE are confidence, not Kd), optimize small molecules, design multi-specifics or conjugates, or run wet-lab validation. It produces prioritized computational hypotheses for experimental testing, not validated binders. Track B does de novo CDR design onto an existing framework — it is not antibody humanization, affinity maturation of an existing mAb, or epitope binning of known antibodies.

Inputs
Target structure: a PDB/mmCIF file (local or fetched by PDB ID), OR a UniProt/AlphaFold model. The user should indicate which chain and which residue range (domain/epitope) to target.
Optional epitope/hotspots: specific target residues to bias the interface toward. If the user does not specify, ask whether to target a defined epitope or let RFdiffusion choose (unrestrained). Track any functional site (e.g., a catalytic triad, a receptor-binding loop) to report overlap.
Binder length range (Track A): default 60–90 aa (override per request).
Framework + CDR loop ranges (Track B): an HLT-formatted antibody framework (nanobody VHH or scFv; RFantibody ships example frameworks) and the CDR loop-length ranges to diversify (e.g. H3:5-13). Epitope hotspots are effectively required for the antibody track.
Scale preset: Track A — quick (~8 backbones), standard (~15), thorough (~30–50). Track B — pilot 20–100 designs to tune hotspots/loop lengths, full campaigns 1k–10k.
Outputs (saved to /mnt/results/)
A ranked candidate table (source of truth): boltz2_validation_ranking.csv (Track A) or the RF2 score/pAE table (Track B). Includes hotspot recovery and epitope_status columns.
all_candidate_metrics.json — full per-candidate metrics: ipTM/confidence, PAE, contacts, target contact residues (native numbering), binder/CDR interface positions, sequence, confidence tier, hotspot recovery, epitope_status, domain_start, target_range.
construct_scope.json — sidecar from prepare_target.py recording domain_start, target_range (the realised construct span), core_range/margin/margin_mode/min_segment (the crop that produced it), is_truncated, hotspots, hotspots_present_after_crop, hotspots_dropped_by_crop. This is the single source of the construct span for the report.
structure_metadata.json — sidecar from fetch_structure_metadata.py recording the PDB entry's fetched resolution, experimental method, deposition/release date, title, and chain composition, plus a provenance block (source URL + fetch timestamp). Structure facts in the report come from here, never hand-typed.
Figures (PNG + SVG): design-score distribution, 4-panel confidence metrics, target contact occupancy map with hotspot guides.
report_content.json — the validated, style-free report content (sections, tables, callouts, caveats, sequences) emitted by build_report.py after its consistency gate. It is the single source the final PDF is rendered from, not a separate report.
Use the pdf-report-generation skill to generate a pdf report with infographics (use the Biomni GenerateImage tool), methods, results, conclusions, figures, references, and next steps from all of the analyses.
The selected candidate sequences as FASTA.
Prerequisites
HPC helpers: from biomni.tool import hpc_search_tools, hpc_run_tool, hpc_get_job_results, hpc_get_logs, hpc_cancel_job
A Python env with: biopython, numpy, scipy, pandas, matplotlib, pillow, reportlab.
GPU tools accessed via HPC — Track A: RFdiffusion, ProteinMPNN, Boltz-2; Track B: the rfantibody tool (bundles antibody-finetuned RFdiffusion, ProteinMPNN interface design, RF2). See references/hpc_commands.md for exact commands, mandatory flags, and failure modes.
Report Packaging

Report styling is owned by the platform: the final PDF is rendered by the Biomni pdf-report-generation skill (the terminal Workflow step), which supplies the running-header and footer rules and all layout. This skill does not style or render its own PDF.

scripts/build_report.py prepares and validates the report before rendering. It implements the pilot-scale disclosure, truncated-construct disclosure, hotspot-spread check, and a provenance consistency gate that verifies report claims against the produced artifacts — including that structure facts were fetched from the PDB (not hand-typed) and that the construct span was derived from construct_scope.json (not restated in the config). It then writes the report's content style-free to report_content.json for pdf-report-generation to render. Structure facts (resolution, experimental method, deposition date) come from fetch_structure_metadata.py; the construct span comes from prepare_target.py's construct_scope.json; campaign counts (n_backbones, n_sequences, n_passed, n_validated) are derived from the pipeline artifacts. None of these are hand-typed in the config.

Producing the final PDF report is a required terminal step of this workflow, not optional. The report must not be skipped — it is the deliverable that communicates the ranked candidates, their on-target status, and the limitations to the user.

Workflow — Track A (de novo mini-protein binder)

Run these in order. Each helper is in scripts/ and self-checks its inputs (exits non-zero on a problem). Verify every stage's output before launching the next HPC job — GPU jobs are slow and rate-limited (max 3 concurrent), so a silent mistake is expensive.

Step 0 — Prepare the target (scripts/prepare_target.py)

Crop the target to the domain/epitope of interest so RFdiffusion docks binders to the right surface, and emit the RFdiffusion contig string.

python scripts/prepare_target.py \
  --in <target>.pdb --chain <A> --range <lo-hi> \
  --margin 10 --margin-mode spatial --min-segment 4 \
  --key-residues <r1,r2,...> --hotspots <h1,h2,...> \
  --out target_cropped.pdb --contig-out contig.txt --scope-out construct_scope.json
--margin-mode spatial keeps residues within N Å of the core (captures a real 3D surface patch); sequence keeps a contiguous residue window. --min-segment prunes scattered singleton residues that would fragment the contig (bad for RFdiffusion). Runs containing a --key-residue are always kept, and the script fails if a key residue would be dropped.
--hotspots records the declared epitope hotspot set in the construct_scope.json sidecar (the same set passed to analyze_interface.py --hotspots and to ppi.hotspot_res). It is distinct from --key-residues (hotspots = epitope-bias set; key-residues = must-survive-crop).
--scope-out writes a construct_scope.json sidecar with domain_start, target_range (the realised span), core_range/margin/margin_mode/min_segment (the crop that produced it), is_truncated, hotspots, hotspots_present_after_crop, hotspots_dropped_by_crop. build_report.py derives the reported construct span from this sidecar (it is never restated in the config) and uses core_range/margin to explain nominal-vs-realised when the crop pulled in extra residues.
Biological point: targeting the wrong face (or leaving a blocking prodomain in) wastes the whole campaign. Confirm the domain range and any functional site with the user.
Copy the printed contigmap.contigs=[...] line — you pass it to RFdiffusion verbatim.
Step 1 — Generate binder backbones (RFdiffusion, HPC)

Submit with the contig from Step 0. See references/hpc_commands.md §1.

Use Complex_base_ckpt.pt (protein–protein), noise_scale_ca=0.5, noise_scale_frame=0.5.
Set inference.num_designs from the scale preset. Add ppi.hotspot_res=[...] with the same hotspot residues passed to prepare_target.py --hotspots (only if the user specified an epitope).
Output: N two-chain PDBs (binder = chain A, target = chain B). Compute a quick per-backbone interface-contact count and save a backbone_summary.json mapping design id → {contacts}.
Step 2 — Design sequences (ProteinMPNN, HPC)

Redesign the binder chain with the target held fixed. See §2.

Pass all backbones as one tar.gz (avoids the 8192-char container-override limit).
--chain_list 'A' = chain to DESIGN (the binder). Getting this backwards silently redesigns the target. --num_seq_per_target 4 --sampling_temp '0.1 0.2' → 8 sequences/backbone. --use_soluble_model for soluble binders.
Step 3 — Filter and select (scripts/filter_sequences.py)
python scripts/filter_sequences.py \
  --seq-dir <mpnn_out>/seqs --backbone-json backbone_summary.json \
  --out-csv analysis/all_sequences.csv --top-n 6
Skips the first FASTA record per file (the original backbone sequence).
Default filters: entropy >= 2.0, top1_frac <= 0.42, n_cys <= 2, interface_contacts >= 8 — reject low-complexity/repetitive designs, disulfide/oxidation liabilities, and tiny interfaces.
Selects the best sequence per backbone, then the top-N backbones, for topological diversity (avoids N near-clones from one backbone).
Step 4 — Co-fold validation (Boltz-2, HPC)

One YAML per candidate: binder = chain A (single sequence), target = chain B. See §3.

Mandatory flags: --no_kernels (Ada sm_89 segfault), --num_workers 0 (OOM), --use_msa_server (target MSA). Submit in waves of ≤3 (GPU concurrency cap; 429 = limit hit).
The de novo binder has no natural MSA and folds single-sequence — expected.
Step 5 — Analyze interfaces + rank (scripts/analyze_interface.py)
python scripts/analyze_interface.py \
  --candidates-csv cand_specs.csv \
  --domain-start <native_first_residue> --hotspots <h1,h2,...> \
  [--catalytic-triad <r1,r2,r3>] [--functional-site <r1,r2,...>] \
  --out-json all_candidate_metrics.json --out-csv boltz2_validation_ranking.csv
Boltz renumbers the target 1..N — pass --domain-start (native number of the target's first modeled residue) to recover native epitope numbering. Getting this wrong mislabels every reported residue number — it is the highest-consequence single argument.
--hotspots (the same set passed to prepare_target.py --hotspots and ppi.hotspot_res) scores each candidate for hotspot recovery and assigns an epitope_status: ON_TARGET (≥ --min-hotspot-recovery hotspots recovered), PARTIAL (>0 but fewer), OFF_TARGET (0 recovered), or NOT_ASSESSED (no --hotspots given — never falls back to ON_TARGET).
--catalytic-triad and --functional-site are optional functional-site overlap checks; use --catalytic-triad only when the target has a catalytic triad (e.g. a protease). For a receptor-blocking target like PD-L1, use --hotspots and omit --catalytic-triad.
Interface PAE uses the binder-rows × target-cols PAE block (directional; do not symmetrize).
Ranks by ipTM (default). Reports a confidence tier per candidate (see below).
Step 6 — Fetch structure metadata, figures, and validated report content (fetch_structure_metadata.py, make_figures.py, build_report.py)
# 6a. Read the target structure's facts FROM the PDB (resolution, method, deposition date,
#     chains) so the report never carries a hand-typed number. Use the target's real PDB id.
python scripts/fetch_structure_metadata.py --pdb 5O45 --out structure_metadata.json

python scripts/make_figures.py --metrics-json all_candidate_metrics.json \
  --ranking-csv boltz2_validation_ranking.csv \
  --all-sequences analysis/all_sequences.csv --selected-csv analysis/all_sequences_selected.csv \
  --outdir figures --prefix fig

python scripts/build_report.py --config report_config.json \
  --ranking-csv boltz2_validation_ranking.csv --metrics-json all_candidate_metrics.json \
  --all-sequences-csv analysis/all_sequences.csv --selected-csv analysis/all_sequences_selected.csv \
  --structure-metadata structure_metadata.json --construct-scope construct_scope.json \
  --out report_content.json   # runs the consistency gate, then emits style-free report content
Structure facts are fetched, never typed. fetch_structure_metadata.py reads resolution, experimental method, and deposition date from the RCSB entry for the target PDB and writes a provenance-stamped structure_metadata.json. build_report.py renders those values (or "unavailable" if the fetch failed) — the config has no resolution/method field to hand-type. This closes the one class of hallucination that config review cannot catch: an external-database fact written by hand (e.g. a structure logged at 2.10 Å that RCSB reports at 0.99 Å).
The construct span is derived, not restated. Pass --construct-scope construct_scope.json (or set construct_scope in the config). build_report.py takes the reported residue range from the scope sidecar's target_range, and when the crop pulled in residues beyond the requested core it states both ("nominal <domain_label> core <core_range>; the built construct spans <target_range> after a <margin> Å <mode> margin"). Put only the domain name in domain_label — never a residue range.
Fill the rest of report_config.json from references/report_config_template.json (target name/PDB/UniProt, rationale, figure paths, hotspots). Campaign counts are derived from the artifacts (--all-sequences-csv, --selected-csv, the ranking CSV) — do not hand-type them.
build_report.py runs a consistency gate automatically before emitting the report content. It fails (exit 2) if: the config hand-types any structure fact or a domain_range; a PDB is named but no fetched structure_metadata.json is supplied (or it is for a different PDB, or lacks provenance); the scope's target_range disagrees with the metrics records; or the ranking CSV and metrics JSON disagree on candidate sets, ipTM/iface_pae, hotspots, or figures. Use --no-strict to downgrade to warnings + a 'Provenance warnings' callout carried into the content.
The validated report_content.json (headings, paragraphs, tables, callouts, figures, sequences) is the single source the final PDF is rendered from — the report's styling is applied by pdf-report-generation in the terminal step, not here.
Always run a direct visual inspection using ordinary Read on each figure PNG; fix and re-check.
Step 7 — Generate the PDF report, then verify before returning (mandatory terminal step)

This step is mandatory: the run is not complete until the PDF report has been produced.

Use the pdf-report-generation skill to generate a pdf report with infographics (use the Biomni GenerateImage tool), methods, results, conclusions, figures, references, and next steps from all of the analyses.

Render from the validated report_content.json (Step 6) so the report says exactly what the consistency gate verified. Then, before presenting the PDF to the user, confirm:

The ranked table's hotspot column (k/N) matches the metrics JSON for every candidate.
The derived counts (n_backbones, n_sequences, n_passed, n_validated) in the report match the all-sequences CSV and the ranking CSV.
The construct range in the report is the target_range derived from construct_scope.json (and equals the target_range on the metrics records). Where it differs from the requested core_range, the report states both and explains the margin.
The structure facts (resolution, method, deposition date) shown in the report came from structure_metadata.json (fetched from RCSB, with a provenance line) — or read "unavailable" if the fetch failed. There is no hand-typed resolution anywhere.
Any OFF_TARGET candidates are flagged in the report's off-target (danger) callout.
Any NOT_ASSESSED candidates are flagged in the report's not-assessed (warning) callout.
Run a direct visual inspection using ordinary Read on a couple of report pages; fix and re-check. build_report.py runs its consistency gate automatically, but the agent must visually confirm these items in the produced PDF before returning it.
Workflow — Track B (antibody / nanobody, RFantibody)

Track B uses the RFantibody container's own pipeline (RFdiffusion_Ab → ProteinMPNN interface design → RF2), submitted through the rfantibody HPC tool. There are no local scripts/ for the design steps — RFantibody bundles them — so this track is documented as verified HPC commands in references/hpc_commands.md §4. The shared target-prep, epitope mapping, figures, and report tooling from Track A still apply to the final ranked hits.

Step A0 — Prepare HLT inputs
Target: crop to ~10 Å around the epitope (reuse scripts/prepare_target.py with --hotspots and --scope-out), then relabel the target chain to T for HLT format. The hotspot set recorded in the scope sidecar is the same set passed to ppi.hotspot_res and later to analyze_interface.py --hotspots.
Framework: supply an HLT-formatted antibody framework — chain H (heavy), L (light, omit for a nanobody), target T, in that chain order, with REMARK PDBinfo-LABEL CDR annotations. RFantibody ships ready-made frameworks (nanobody h-NbBCII10.pdb, scFv hu-4D5-8_Fv.pdb) baked into the container — prefer these unless the user provides one.
Hotspots: identify epitope residues as [T<res>,...] (target chain T numbering). Effectively required for antibodies — without them the CDRs have no surface to dock to. The biological reason: CDR loops are diversified to contact a specific epitope patch; without hotspots the diffusion has no target surface and produces non-functional loops.
Step A1 — Dock + diversify CDRs (RFantibody RFdiffusion, HPC)

Antibody-finetuned RFdiffusion with inference.ckpt_override_path=.../RFdiffusion_Ab.pt, antibody.design_loops=[...] for CDR length ranges, and ppi.hotspot_res=[...]. See §4.1. Pilot with 20–100 designs to tune hotspots/loop lengths before scaling. The antibody-finetuned checkpoint produces CDR backbones that are geometrically compatible with the framework's canonical loop scaffolds — a plain RFdiffusion checkpoint cannot do this.

Step A2 — Design CDR sequences (RFantibody ProteinMPNN interface design, HPC)

scripts/proteinmpnn_interface_design.py -pdbdir ... -outpdbdir ... — designs the CDR-loop sequences at the interface while keeping the framework fixed. See §4.2. Holding the framework fixed preserves the antibody's structural integrity while exploring sequence space only where the CDR contacts the target.

Step A3 — Predict + filter (RF2, HPC)

scripts/rf2_predict.py with model.num_recycles=10 and +model.hotspot_fraction=0.1 (the leading + is mandatory — it appends a key absent from the struct config; omitting it errors). See §4.3. Filter: RF2 pAE < 10, RMSD(design vs RF2-predicted) < 2 Å, optional Rosetta ddG < −20. The self-consistency RMSD checks that the designed CDR structure is recoverable by an independent predictor — a design that RF2 cannot reproduce is likely an artifact of the design process.

Step A4 — Analyze, rank, report (shared)

Map the epitope in native numbering and build the PDF report as in Track A Steps 5–7. Rank by RF2 pAE / RMSD instead of Boltz ipTM. (analyze_interface.py is written for Boltz-2 CIF/PAE output; for RF2 outputs, rank on the RF2 score file and reuse the report scaffold rather than the Boltz-specific parser.) The hotspot recovery and consistency-gate logic from Track A applies identically — pass --hotspots to analyze_interface.py so off-target CDR designs are flagged.

Track B outputs (in addition to Track A outputs): RFdiffusion_Ab design PDBs, ProteinMPNN interface-design PDBs, RF2 prediction PDBs + score files. The final ranked table, metrics JSON, figures, and PDF report use the same formats as Track A.

Confidence interpretation (report these honestly)
metric    HIGH / confident    MODERATE / uncertain    LOW / unreliable
ipTM    > 0.8    0.6 – 0.8    < 0.6
interface PAE (Å)    < 5    5 – 10    > 10
hotspot recovery    all N declared hotspots recovered    partial (1 to N−1)    0 of N (off-target)

ipTM/PAE report predicted-geometry confidence, not measured affinity. On-target epitope recovery is a separate axis from ipTM/PAE: a high-ipTM design that recovers 0 of N declared hotspots is an off-target fold, not a hit, and must be reported as such (OFF_TARGET). A candidate can legitimately be labelled MODERATE on ipTM while recovering zero hotspots — that is exactly why hotspot recovery is reported as its own column and callout, not folded into the confidence tier. Present high-confidence designs as prioritized hypotheses for experimental validation (expression, SPR/BLI, functional/competition assay), never as confirmed binders.

Scientific caveats
MPNN score ≠ binding. ProteinMPNN score is sequence recoverability of a backbone, not an affinity predictor — that is exactly why Boltz-2 co-folding is an independent filter.
Correlation sign trap (important for figures/reports). MPNN score is better when LOW; ipTM is better when HIGH. A scatter of mpnn_score vs ipTM therefore slopes DOWNWARD when the metrics AGREE, and the raw Spearman is NEGATIVE. Report the raw correlation (with its negative sign, matching the plot) and then interpret it ("negative = metrics agree"). Do NOT report only a flipped "+ρ (quality-aligned)" value with no plot context — it reads as contradicting the figure. Also check whether the top-N / bottom-N candidate sets agree even when fine ordering differs.
Native numbering. Always set --domain-start so the reported epitope uses the target's real residue numbers, not Boltz's 1..N renumbering. Getting --domain-start wrong mislabels every reported residue number — it is the highest-consequence single argument in the workflow.
Charged-sequence tendency. ProteinMPNN interface designs are often E/R/K-rich; flag solubility/developability before synthesis.
Pick the right track. Track A designs a fresh mini-protein backbone (no framework); Track B designs CDR loops onto a fixed antibody framework. Do not run a plain-backbone binder workflow when the user wants an antibody/nanobody, or vice versa.
Track B confidence ≠ Track A metrics. RFantibody hits are filtered by RF2 pAE (< 10) and self-consistency RMSD (design vs RF2-predicted < 2 Å), not Boltz ipTM. Developability of a de novo CDR set (immunogenicity, aggregation, expressibility) is not assessed here.
This is compute, not proof. No claim of experimental binding should be made from these outputs.
References
references/hpc_commands.md — exact commands, mandatory flags, container limits, GPU concurrency, and output paths. §1–3 Track A (RFdiffusion / ProteinMPNN / Boltz-2); §4 Track B (RFantibody: RFdiffusion_Ab / ProteinMPNN interface design / RF2, HLT format).
references/worked_example_pcsk9.md — a fully reproduced Track A PCSK9 catalytic-domain run (15 backbones → 120 sequences → 83 pass → 6 validated → cand2 wins, ipTM 0.9466, PAE 1.76 Å, convergent epitope 260–296). The helper scripts reproduce these numbers exactly.
references/quick_start_pdl1.md — a PD-L1 quick-start example showing the hotspot-based workflow (no catalytic triad): --hotspots 115,116,121,122,123, --domain-start 18.
references/report_config_template.json — template config for build_report.py.

4. binding-affinity-ml-model
Category: MOLECULAR DESIGN
Source: https://biomni.phylo.bio/skills/skill_5b530f17e1aaedd0139286faf1950c3c?section=marketplace

ChEMBL QSAR / Novel-Scaffold Discovery

Turn a target name into a curated ChEMBL dataset, an honestly-benchmarked affinity model, and a ranked list of novel-scaffold candidates — with the correctness guardrails that separate a real result from a misleading one.

Scope
Does: pull ChEMBL bioactivity for a target, curate a drug-like small-molecule regression dataset (pooled pAffinity), benchmark models under a scaffold-split CV (Morgan-fingerprint Random Forest / Gradient Boosting, an optional message-passing GNN, and — when explicitly requested — a DeepPurpose deep model as a first-class competitor), select the best model, screen an external library (ChEMBL clinical/approved compounds or a user CSV), assign every novel-scaffold compound to a three-tier applicability-domain confidence (high / borderline / out-of-domain), and build a Phylo-styled PDF report.
Does NOT: handle biologics/peptides/macrocycles as the modeling set (they are filtered out — see caveats), classification tasks, docking, ADMET, de-novo generation, or multi-target selectivity. This is single-endpoint small-molecule affinity regression.
Requested modeling frameworks — NO SILENT SUBSTITUTION

If the user explicitly names a modeling framework (e.g. DeepPurpose), the skill must either use it or state prominently that it was unavailable and what was used instead — it must never quietly swap in a different method and present it as if it were the requested one.

DeepPurpose is supported directly. Pass --framework deeppurpose to benchmark_models.py (or model_framework: "deeppurpose" in the config). A DeepPurpose compound-property model (deeppurpose_drug_encoding, default CNN) is then trained and benchmarked as a first-class model on the same scaffold/random CV folds as the fingerprint baselines.
If the framework cannot run (import failure, runtime error), the run does NOT silently substitute: it prints a prominent notice, records the reason in data/framework_provenance.json, falls back to the native models, and the PDF report states plainly that the requested framework was requested-but-unavailable and which models were used instead.
Any other named framework that the skill does not implement must be handled the same way: attempt it, or refuse-and-disclose. Do not present native-model results as the requested framework's results.
Selection of the production (screening) model is still by best scaffold-split Spearman; DeepPurpose competes on equal footing but the fingerprint Random Forest is preferred for screening when it wins, because it yields a native uncertainty estimate (per-tree spread) used by the applicability domain and cannot extrapolate beyond the training range.
Inputs
A target gene/protein symbol (e.g. PCSK9, EGFR) to auto-resolve, OR explicit ChEMBL target IDs (e.g. CHEMBL2929). Symbols are resolved to candidate targets with activity counts — confirm the right record(s) before committing (PPI targets, mutants, and orthologs all appear).
Optional config JSON overriding any default (endpoints, MW cutoff, CV repeats, applicability-domain tier thresholds, model_framework, deeppurpose_* settings, library definition). See scripts/common.py::DEFAULTS.
Optional external library as a CSV with a smiles column (otherwise ChEMBL clinical/approved small molecules are fetched).
Outputs (under <outdir>, default /mnt/results/qsar_run)
data/curated_dataset.csv — curated compounds + scaffolds + assay group
data/cv_summary.csv, data/cv_fold_metrics.csv — benchmark metrics (includes a DeepPurpose row when the framework is requested and runs)
data/rf_scaffold_oof.csv — selected-model out-of-fold predictions
data/framework_provenance.json — what framework was requested, whether it ran, and (if not) why — so the report can disclose any fallback
data/all_scored_candidates.csv — every novel-scaffold compound with its ad_tier (high / borderline / out_of_domain) and ad_flags
data/high_confidence_candidates.csv — the high-confidence (in-domain) shortlist only; data/top25_high_confidence.csv — best per scaffold
data/ad_tier_summary.json — tier counts + thresholds used
(Back-compat: data/novel_scaffold_candidates.csv and data/top25_novel_candidates.csv still exist but now contain only high-confidence rows — never borderline/out-of-domain.)
figures/fig1..fig5 (.png + .svg) — data plots (fig5 = AD-tier bar)
report_<TARGET>_qsar.pdf — the deliverable
Environment

Python 3.10+, with rdkit, torch, torch_geometric, scikit-learn, scipy, pandas, numpy, matplotlib, reportlab, pypdf, Pillow, and (for --framework deeppurpose) DeepPurpose. The GNN/DeepPurpose CV is CPU-friendly for a few hundred compounds (~20-30 s/fold); for large datasets or many folds prefer an 8-core machine, use a single 5-fold CV (cv_repeats=1) and a bounded deeppurpose_train_epoch, or benchmark the deep model on a representative subsample (stated transparently in the report). Install PyG with uv pip install torch_geometric and DeepPurpose with uv pip install DeepPurpose if absent.

Data sources & license (see references/DATA_SOURCES.md)

This skill's only external data source is ChEMBL (bioactivity, structures, clinical/approved library) via the EBI ChEMBL REST API. ChEMBL is licensed CC BY-SA 3.0: commercial use is permitted but requires attribution (cite the ChEMBL release used — the skill records it per run — and preserve ChEMBL IDs) and share-alike (any redistributed derivative dataset, e.g. the curated CSVs, must carry CC BY-SA 3.0). The skill does not use ChEMBL's commercial-software-derived property calculations. Human Protein Atlas is not used by this skill.

Workflow

Run the scripts in order. Each writes into <outdir> and the next reads from it, so --outdir must be the same throughout. All scripts accept --config myconfig.json and CLI overrides.

Step 1-2 — Curate the dataset AND pass the data-reality gate
python scripts/curate_dataset.py --symbol PCSK9 --outdir /mnt/results/pcsk9
# or explicit targets:
python scripts/curate_dataset.py --target_ids CHEMBL2929,CHEMBL4523996 --outdir /mnt/results/pcsk9

This fetches =-relation nM affinities (IC50/Ki/Kd/EC50), standardizes structures (largest fragment, neutralize, canonicalize), filters to drug-like space (MW ≤ 650, organic), aggregates replicates by median, computes Bemis-Murcko scaffolds, and labels each compound's assay group.

Why the gate is the most important step. ChEMBL activity counts are misleading: a target can show thousands of activities but only tens of drug-like small molecules, because its chemical matter is peptides/macrocycles (common for protein-protein-interaction targets) or the obvious endpoint is sparse. The script prints a per-target / per-endpoint breakdown and exits non-zero if the final set is below min_compounds (default 100). If it fails, re-scope before modeling:

pool more endpoints (already pools IC50/Ki/Kd/EC50),
add the single-protein target alongside a PPI target,
reconsider whether the target is tractable for small molecules at all.

Decision rule: N < 100 → do not run the GNN; either re-scope or drop to fingerprint-only. N < ~200 → proceed but expect modest scaffold-split performance; fingerprint baselines often win (that is a valid result).

Step 3 — Benchmark models honestly (scaffold + random CV)
python scripts/benchmark_models.py --outdir /mnt/results/pcsk9
# fingerprint-only (faster, or when N is small):
python scripts/benchmark_models.py --outdir /mnt/results/pcsk9 --no_gnn
# honor an explicitly requested framework (first-class, no silent substitution):
python scripts/benchmark_models.py --outdir /mnt/results/pcsk9 --framework deeppurpose

Runs CV (default repeats × folds from config; use cv_repeats=1 for a single 5-fold CV on large data) for the available models on identical folds, under a scaffold split (headline) and a random split (optimistic reference only). With --framework deeppurpose, a DeepPurpose model competes on the same folds. Reports mean ± SD (SD is across folds; state "single 5-fold CV" in the report when cv_repeats=1 — do NOT call it "repeated CV") and recommends the best scaffold-split model. Writes data/framework_provenance.json.

Critical correctness property: every deep model's early stopping uses an inner validation split carved from the training indices only; the test fold is used solely for the final prediction, and target scaling is fit on training data only. This avoids the subtle leakage that makes scaffold-split metrics optimistic and the model comparison unfair.

No silent substitution: if --framework deeppurpose is requested but cannot run, the script prints a prominent notice, records the reason in framework_provenance.json, and continues with native models — the report then discloses this. It never presents native-model results as DeepPurpose's.

Decision rule — model selection: pick the model with the best scaffold-split Spearman, not R². Do NOT assume a deep model (GNN / DeepPurpose) wins; at small-to-moderate N the fingerprint models usually generalize as well or better. If a deep model loses, select the fingerprint model and say so plainly.

Step 4 — Train final model + screen the library
python scripts/screen_library.py --outdir /mnt/results/pcsk9            # RF (default)
python scripts/screen_library.py --outdir /mnt/results/pcsk9 --model gnn  # only if GNN won
python scripts/screen_library.py --outdir /mnt/results/pcsk9 --library_csv mylib.csv

Trains the selected model on all curated compounds, scores the library, and assigns every novel-scaffold compound to an applicability-domain confidence tier. Random Forest is the default because tree ensembles do not extrapolate beyond the training range (predictions stay physically sensible) and give a native per-tree uncertainty used by the tiers.

Three-tier applicability domain (replaces the old single "confident" band). Each novel-scaffold compound's nearest-neighbour Tanimoto to the training set, prediction range, and per-tree disagreement determine its tier:

high (in-domain): NN-Tanimoto ∈ [ad_high_tanimoto_min, ad_high_tanimoto_max] (default [0.40, 0.70]) AND prediction ≤ training max AND per-tree std ≤ the ad_std_quantile cutoff. Only this tier is a shortlist.
borderline (low-confidence): NN-Tanimoto ∈ [ad_borderline_tanimoto_min, ad_high_tanimoto_min) (default [0.30, 0.40)) — weakly similar; reported for transparency but never called a confident hit.
out_of_domain (unreliable): NN-Tanimoto < 0.30 (extrapolation into unseen chemistry) or > 0.70 (trivial near-analog, not novel) or prediction out of range or high disagreement.

Why this matters: the previous single band [0.25, 0.55] labelled weakly-similar compounds (NN-Tanimoto ~0.26–0.43, i.e. barely above the extrapolation floor) as "confident," dramatically over-claiming reliability. A low nearest-neighbour Tanimoto means the model is extrapolating and the compound must be flagged low-confidence / out-of-domain — not nominated as confident. Tier counts and thresholds are written to data/ad_tier_summary.json; all compounds with tiers to data/all_scored_candidates.csv; the high-confidence subset to data/high_confidence_candidates.csv.

Step 5 — Figures + report
python scripts/make_figures.py --outdir /mnt/results/pcsk9
python scripts/build_report.py --outdir /mnt/results/pcsk9 --target PCSK9 --chembl_version ChEMBL_37

make_figures.py draws the data plots (pred-vs-actual, model comparison incl. DeepPurpose when present, dataset landscape, and the AD-tier bar, fig5). build_report.py auto-detects the selected model from cv_summary.csv, reads framework_provenance.json and ad_tier_summary.json, and assembles the PDF with honest, discovery-grade framing — reporting the three AD tiers, disclosing any requested-framework fallback, and describing the CV as a single 5-fold CV (SD across folds) rather than "repeated." (Conceptual/mechanism figures, if wanted, should be made with an image-generation tool, not matplotlib.)

After building, validate the PDF (pypdf page count) and visually check the figures rendered (not blank/clipped) before delivering.

Scientific caveats (carry these into any report)
Data-scale sets the ceiling. A few hundred compounds is small for affinity modeling (scaffold Spearman often ~0.3-0.4, high fold variance → strictly discovery-grade). Well-populated targets (thousands of drug-like compounds, e.g. major kinases) can reach much higher scaffold-split performance, but that is still bounded to the populated chemical space — state the regime honestly rather than assuming either extreme.
Report CV honestly. With cv_repeats=1 the reported SD is across the five folds of a single 5-fold CV — describe it that way, NOT as "repeated CV."
No silent framework substitution. If a specific framework was requested (e.g. DeepPurpose) but not used, the report MUST say so and name what was used instead. Never present native-model results as the requested framework's.
Applicability domain is three-tier, and most library compounds fall outside it. Only the high tier (reliable NN-Tanimoto window + in-range + low disagreement) is a shortlist. Weakly-similar compounds (low NN-Tanimoto) are borderline or out-of-domain — extrapolations, not confident hits. Never label a low-Tanimoto compound "confident."
Pooled heterogeneous label. IC50/Ki/Kd/EC50 are combined into one pAffinity. The curation step checks that assay-group means match (no batch offset), but pooling still mixes functional inhibition with direct binding. Track assay_group and report within-group signal.
Drug-like filter excludes real chemistry. MW ≤ 650 removes peptides and macrocycles. For PPI targets this can remove most of the actives — that is the point of the data-reality gate, not a bug. If the target's therapeutics are biologics (antibodies, siRNA), a small-molecule affinity model is inherently limited; state this.
Predictions are unvalidated hypotheses. Applicability-domain tiering reduces but does not eliminate unreliability. Predicted potencies are a ranking, not calibrated affinities. Even high-confidence compounds need experimental confirmation before any activity claim.
ChEMBL version + license. Record the ChEMBL release used (counts/candidates change between versions) AND honor CC BY-SA 3.0 (attribution + share-alike; see references/DATA_SOURCES.md).
Confirm target resolution. Auto-resolution returns candidates by activity count; always confirm the intended single-protein vs PPI vs mutant record.
Files
scripts/common.py — config (incl. tiered-AD + framework knobs), ChEMBL access, RDKit helpers, and the ad_tier() classifier (one source of truth for the drug-like/scaffold/fingerprint/AD-tier definitions)
scripts/curate_dataset.py — Step 1-2 (fetch, curate, data-reality gate)
scripts/models.py — featurization, MPNN, scaffold folds, leakage-free trainer
scripts/models_deeppurpose.py — guarded DeepPurpose wrapper (raises FrameworkUnavailable so callers disclose + fall back, never substitute)
scripts/benchmark_models.py — Step 3 (CV; --framework deeppurpose, writes framework provenance)
scripts/screen_library.py — Step 4 (final model + three-tier applicability domain)
scripts/make_figures.py, scripts/build_report.py — Step 5
references/METHODS.md — reusable methods text, thresholds, and rationale
references/DATA_SOURCES.md — external data sources and licenses (ChEMBL CC BY-SA 3.0)

5. biomol-structure-prep
Category: MOLECULAR DESIGN
Source: https://biomni.phylo.bio/skills/skill_ecfd93fed75ef0dd731cba9a5bab2812?section=marketplace

Biomolecular Structure Preparation

Turn a deposited or uploaded structure into a clean starting model for one of two uses:

    Simulation (MD, MC, FEP, docking)    Design target (Boltz, RFdiffusion, ProteinMPNN, BindCraft, ...)
Hydrogens    All atoms    None
Protein protonation    PROPKA 3 at the pH (default 7.4)    Not assigned
Ligands, cofactors, glycans, adducts    Protonated at the pH; mol2 + SDF with hydrogens    CCD chemistry; heavy-atom mol2 + SDF
Waters    Within 4.0 A of protein/ligand heavy atoms    Removed (--keep HOH keeps them)
Modified residues (SEP, ...)    Kept    Replaced by the parent (--ptm keep keeps them)

Always: first model only, deposited hydrogens stripped, highest-occupancy altloc, buffers and additives removed, missing internal residues and atoms modelled, unresolved termini dropped, observed heavy-atom coordinates kept exactly. The skill does not predict structures, dock, parameterise force fields, build missing glycan residues, optimise Asn/Gln/His flips or hydrogen orientations, or model missing ligand atoms.

Step 0 — Ask first

In one message, ask:

Simulation or design target? Never assume it.
pH (simulation; default 7.4).
Asymmetric unit or biological assembly, and which chains. The asymmetric unit can hold several copies (2HYY) or part of the functional unit (1STP, one streptavidin monomer). inspect lists the assemblies; recommend one and pass --assembly NAME (default asu).
Step 1 — Environment

gemmi, pdbfixer, openmm, rdkit and openbabel-wheel are preinstalled. Add the rest without upgrading RDKit:

uv pip install --no-deps "propka==3.5.1" "dimorphite-dl==2.1.0" "loguru>=0.7.2,<0.8"

Run python -B "$SKILL_DIR/scripts/prepare_structure.py" with the printed Skill Directory as SKILL_DIR; set --out-dir /mnt/results/<run>/ for delivered outputs. Each invocation computes and validates files in a unique local directory under /workspace (or the OS temporary directory outside Biomni). Override that local parent with --work-dir PATH; never put it inside the skill or on an S3-backed mount. Complete outputs are copied to --out-dir and SHA-256 checked by reading back the delivered files. Working files are retained at the printed local path, including on failure; local paths in provenance describe execution, not downloads. Entries and CCD definitions are fetched from files.rcsb.org.

Step 2 — Inspect
python -B "$SKILL_DIR/scripts/prepare_structure.py" inspect --input 4RQK --mode simulation --out-dir /mnt/results/4rqk

Read inventory.json: assemblies, components and their default fate, SEQRES gaps (internal ones are modelled, terminal ones dropped), missing atoms, modified residues, side-chain crosslinks, heterogen groups (ligands, metal ligands, covalent adducts, glycan trees) with their links, warhead rules and, in simulation mode, a provisional protonation state with review flags, and blocking_issues. Resolve with the user:

Components (references/components.md). Keep a removed component that matters with --keep CODE (it is then prepared as a ligand); remove one with --remove CODE.
Ligands without a CCD definition block the run: ask for the SMILES, pass --ligand-smiles CODE=SMILES (or LABEL=SMILES, labels look like R1S_A404). Partially modelled ligands block too.
Covalent adducts and glycans (references/covalent-and-glycans.md): check the warhead rules; give bond orders with --adduct-smiles LABEL=SMILES ([*] at each protein link) if they are wrong.
Metal ligands: oxidation states come from the CCD net charge and are flagged; confirm redox cofactors with the user and set them with --metal-charge LABEL:ATOM=CHARGE (e.g. HEM_A201:FE=3).
Crosslinks (isopeptides, thioethers) are kept as bonds; atoms rebuilt next to one are flagged.
Long gaps (> 10 residues) are built but are placeholders; see Step 4.
Protonation (simulation)

Each heterogen group is protonated as one molecule (covalent groups with the linked side chain). PROPKA's in-situ ligand sites, checked against the bond-order graph, are compared with Dimorphite-DL's solution states; where they disagree the script decides from the models' known biases and PROPKA's environment shift (references/protonation-and-tautomers.md). Strong acids, untyped carboxylic acids and metal donors follow rules; untyped groups keep Dimorphite-DL's state; the CCD tautomer is kept. Protein residues follow PROPKA, metal coordination and disulfides; kept modified residues are cross-checked the same way as ligands.

You make the final call on every flagged site and tell the user. Flags mark disagreements (with the call made), shared model biases (e.g. both N of a piperazine protonated), pKas near the pH, Dimorphite-only sites and residues near the pH or PROPKA-coupled (e.g. the Asp25/Asp25' dyad of HIV protease). Use the chemotype's measured pKas and the polar contacts listed per group: a protonated N, a carboxylate or a ring N-H needs a partner that fits; the bound form can differ from the solution form. Set states explicitly and record why:

--ligand-state 'R1S=O=S(=O)([N-]c1nc2ccc(Cl)cc2s1)c1csc2ccccc12' --note "R1S: sulfonamide NH taken as anionic (pKa ~6-7)"
--adduct-state 'glycan_A101=...'   # covalent groups and glycans, [*] at each protein link; multi-residue groups by group label
--residue-state A:25=ASH           # ASP/ASH, GLU/GLH, HID/HIE/HIP, LYS/LYN, CYS/CYX/CYM

The automatic decision stays in the report next to a user state. When two states are close, ask the user and, for FEP or docking, offer both (one run each). If OpenEye QUACPAC or Schrodinger Epik is available, prefer it and pass its states the same way. Metal-site proton placements (e.g. Zn-OH2 vs Zn-OH-) are flagged; a QM cluster study is separate work.

Step 3 — Prepare
python -B "$SKILL_DIR/scripts/prepare_structure.py" prepare --input 4RQK --mode simulation --ph 7.4 \
  --out-dir /mnt/results/4rqk [--assembly NAME] [--chains A] [--keep CODE] [--remove CODE] [--ptm keep|replace] \
  [--ligand-smiles|--ligand-state|--adduct-smiles|--adduct-state KEY=SMILES] [--residue-state A:25=ASH] \
  [--metal-charge LABEL:ATOM=Q] [--loop-model CHAIN=model.cif] [--loop-ensemble N] [--work-dir LOCAL_PATH] [--note "..."]

PDBFixer builds gaps and missing atoms (heterogens as fixed obstacles); Amber14 refines the modelled atoms with observed atoms fixed; the best of up to 8 seeded builds is kept, deterministically (references/missing-loops.md). Then protonation as above; hydrogens are placed geometrically (OpenMM Modeller, RDKit) without moving heavy atoms. Runtime is seconds for most entries, minutes for multi-chain entries with many gaps (restrict with --chains).

Step 4 — Check QC, then deliver

Read Quality checks in preparation_report.md and report every flag:

Modelled residues with clashes, cis/twisted peptides or D centres did not converge; a cis X-Pro is not an error. These are screens: validate a loop that matters with MolProbity (ask before uploading). For a flagged, long or binding-site loop, offer grafting from a full-chain model: fold the seqres sequence with protein-structure-prediction or fetch AlphaFold DB, then rerun with --loop-model A=model.cif (flank RMSD and pLDDT are reported; experimental donors are detected).
Final model: hydrogen contacts (from deposited heavy atoms closer than ~2.4 A, or unoptimised polar hydrogens the setup minimisation resolves), polymer residues without an Amber14 template, SDF charges.
Unmodelled chain breaks (no SEQRES), long loops, weak-density waters, metal ions and metal-bound waters (catalytic Zn water is often hydroxide).

Deliver:

<ID>_<mode>_prepared.pdb (.cif above the PDB atom limit): standard residue names, protonation encoded by the hydrogens present, CONECT for ligands and crosslinks, deposited occupancy/B kept (modelled atoms 1.00/0.00).
ligands/<label>.mol2|.sdf (covalent: <label>_adduct.* with the capped side chain; glycans in glycans/; metal ligands disconnected). Simulation files have hydrogens and informational Gasteiger charges.
loops/ with --loop-ensemble; preparation_report.md and change_log.json.
Design targets: report the sequences; use ligand CCD codes or SDF SMILES for Boltz/Chai; keep a ligand only if the design must respect its pocket; most design models want --ptm replace; avoid hotspots on modelled loops and design against the biological assembly.

Summarise what was removed, kept and modelled, non-default protonation, ligand states and why, and every QC flag. Never call the system simulation- or force-field-ready.

Stop conditions

The script exits with STOPPED: <reason> (status 2) on blocking issues, which include: ligands without CCD or SMILES, incomplete ligands, covalent groups that cannot be built (ask for --adduct-smiles), impossible crosslink valences, head-to-tail cyclic polymers (exclude the chain or use a dedicated workflow), His bound to a metal through both ring N, override keys that name no group, and selections above the PDB atom limit. Also stop when the assembly, chain or ligand choice is ambiguous. I/O or delivery failures also return a nonzero status; preserve the local working directory and exact error. Never automatically rerun a failed canonical command. Resolve flags or inputs within the task's authority; a single-execution validation task requires separately authorized recovery. Never edit coordinates. Capture Python's exit status directly, not the status of tail or another command in a logging pipeline.

References
references/components.md: categories, buffer list, ions, waters, assemblies.
references/protonation-and-tautomers.md: residue rules, ligand decision and bias table, metal conventions, review checklist, typical pKas, tautomer-prone chemotypes, commercial tools.
references/covalent-and-glycans.md: adduct protocol, warhead rules, glycans, crosslinks.
references/missing-loops.md: loop building, QC and grafting.

6. bulk-omics-clustering
Category: MULTI-OMICS
Source: https://biomni.phylo.bio/skills/skill_51a601b71a454a00aa0d378fe8e3205c?section=marketplace

Bulk Omics Clustering Analysis

Systematic workflow for clustering biological samples, features, or any quantitative data matrix. Implements multiple clustering algorithms with rigorous validation, comparison, and interpretation to identify meaningful data groupings.

When to Use This Skill

Use clustering analysis when you need to:

✅ Group biological samples by gene expression profiles (bulk RNA-seq, proteomics)
✅ Identify feature patterns (genes/proteins with similar expression across conditions)
✅ Discover subtypes in disease or treatment response groups
✅ Analyze trajectories in time-series or developmental data
✅ Quality control by detecting batch effects or outliers
✅ Compare methods by systematically evaluating multiple clustering approaches

Don't use this skill for:

❌ Single-cell RNA-seq clustering → Use scrnaseq-scanpy-core-analysis or scrnaseq-seurat-core-analysis
❌ Gene co-expression network analysis → Use coexpression-network

Key Concept: Clustering reveals natural groupings in data without prior labels. Different algorithms make different assumptions—this workflow helps you choose and validate the right approach for your data.

Language Support: This skill supports both Python and R implementations. Choose based on your preference and existing analysis pipeline. Python offers scikit-learn ecosystem integration; R offers ComplexHeatmap and rich Bioconductor tools.

Quick Start (5-Minute Example)

Test the workflow with the Bioconductor ALL (Acute Lymphoblastic Leukemia) dataset as a demo/validation fixture when no user dataset is available. This example contains 128 ALL samples with B-cell and T-cell subtype labels. Do not describe it as a user analysis dataset or as pediatric-only; the Bioconductor phenotype data includes a mixed-age cohort.

R (Recommended for ALL dataset):

# 1. Load example data (Bioconductor ALL demo dataset)
# Use this only when no user data was provided or when validating the workflow.
source("scripts/load_example_data.R")
data_list <- load_example_clustering_data()
data <- data_list$data
sample_names <- data_list$sample_names
feature_names <- data_list$feature_names
metadata <- data_list$metadata

# 2. Run clustering
source("scripts/hierarchical_clustering.R")
result <- hierarchical_clustering(data, n_clusters = 2)
cluster_labels <- result$cluster_labels
hclust_obj <- result$clustering_object

# 3. Visualize
source("scripts/plot_cluster_heatmap.R")
plot_cluster_heatmap(
  data,
  cluster_labels,
  output_dir = "quick_test_results"
)

# 4. Export results
# Results automatically saved by plotting functions
cat("
✓ Quick start complete!
")
cat(sprintf("Cell types: B-cell ALL (n=%d), T-cell ALL (n=%d)
",
            sum(metadata$cell_type == "B"),
            sum(metadata$cell_type == "T")))

Python users: The Python implementation can use the same ALL demo dataset via rpy2, or use your own data. For ALL examples in Python, you'll need pip install rpy2 and R installed. See full workflow below.

Expected output: Dendrogram distinguishing B-cell vs T-cell ALL, PCA plots, silhouette plots, heatmaps in quick_test_results/

Note: For your own data, follow the full workflow below with the Clarification Questions.

Installation
Language Choice

This workflow supports both Python and R. Choose one based on:

Python: Better for large-scale data (>10k samples), integration with machine learning pipelines, modern plotting (plotnine)
R: Better for heatmap visualization (ComplexHeatmap), Bioconductor integration, traditional bioinformatics workflows

You can also mix: use R for visualization (heatmaps) and Python for clustering algorithms.

Python Installation
Required Software
Software    Version    License    Commercial Use    Installation
numpy    ≥1.20    BSD-3-Clause    ✅ Permitted    pip install numpy
pandas    ≥1.3    BSD-3-Clause    ✅ Permitted    pip install pandas
scikit-learn    ≥1.0    BSD-3-Clause    ✅ Permitted    pip install scikit-learn
scipy    ≥1.7    BSD-3-Clause    ✅ Permitted    pip install scipy
hdbscan    ≥0.8.28    BSD-3-Clause    ✅ Permitted    pip install hdbscan
umap-learn    ≥0.5    BSD-3-Clause    ✅ Permitted    pip install umap-learn
plotnine    ≥0.10    MIT    ✅ Permitted    pip install plotnine
plotnine-prism    Latest    MIT    ✅ Permitted    pip install plotnine-prism
seaborn    ≥0.11    BSD-3-Clause    ✅ Permitted    pip install seaborn
matplotlib    ≥3.4    PSF-based    ✅ Permitted    pip install matplotlib
adjustText    ≥0.8    MIT    ✅ Permitted    pip install adjustText
statsmodels    ≥0.13    BSD-3-Clause    ✅ Permitted    pip install statsmodels

Optional: gap-stat (Apache 2.0), yellowbrick (Apache 2.0) - both permitted for commercial use

Minimum Python version: Python ≥3.8

License Compliance: All software packages use BSD-3-Clause, MIT, or similar permissive licenses that allow commercial use in AI agent applications.

R Installation

Minimum R version: R ≥4.0

Required packages: cluster, factoextra, NbClust, ComplexHeatmap, pheatmap, dendextend, dbscan, mclust, ggplot2, ggprism (all GPL/MIT licensed, commercial use permitted)

Quick install:

install.packages(c('cluster', 'factoextra', 'NbClust', 'pheatmap',
                   'dendextend', 'dbscan', 'mclust', 'ggplot2', 'ggprism'))
if (!require('BiocManager')) install.packages('BiocManager')
BiocManager::install('ComplexHeatmap')

Detailed R installation guide: references/r-quick-start.md#r-installation

Inputs
Required Input

1. Data Matrix (CSV, TSV, Excel, or HDF5):

Sample clustering: Rows = samples, Columns = features (genes/proteins)
Feature clustering: Rows = features, Columns = samples
Values should be normalized and comparable (TPM, FPKM, VST, Z-scores)
Missing values: handle by imputation or removal before clustering

2. Sample/Feature Metadata (CSV or TSV, optional but recommended):

IDs matching data matrix rows/columns
Annotations for validation (tissue type, condition, known groups)
Used to interpret and validate clustering results
Data Requirements
Minimum samples/features: 10+ (20+ recommended for robust clustering)
Normalization: Required—use appropriate method for data type
Batch effects: Remove or regress out before clustering
Outliers: Identify and consider removing extreme outliers
Dimensionality: High-dimensional data (>1000 features) benefits from PCA first
Supported Data Types
Transcriptomics: Bulk RNA-seq (normalized counts, TPM, FPKM)
Proteomics: Protein abundance data
Metabolomics: Metabolite concentrations
Multi-omics: Integrated features from multiple assays
Clinical: Patient feature matrices
Any quantitative matrix: General-purpose application
Outputs

Cluster assignments:

clustering_assignments.csv - Sample/feature IDs with cluster labels
clustering_statistics.csv - Size, centroids, and characteristics per cluster

Validation metrics:

clustering_validation_metrics.json - Silhouette, Davies-Bouldin, Calinski-Harabasz scores
stability_results.csv - Bootstrap resampling stability scores (if run)

Characterization:

clustering_cluster*_features.csv - Top distinguishing features for each cluster (ANOVA/Kruskal-Wallis)
clustering_all_cluster_features.csv - Combined features for all clusters

Analysis objects (pickle/RDS):

clustering_analysis_object.pkl - Complete clustering object for downstream use
Load with: import pickle; obj = pickle.load(open('clustering_analysis_object.pkl', 'rb'))
Contains: linkage matrix (hierarchical), fitted model (k-means, GMM, HDBSCAN)
Required for: Advanced analysis, re-cutting dendrograms, model inspection
clustering_data_matrix.csv - Normalized/transformed data matrix used for clustering

Visualizations (PNG + SVG):

Dendrogram (hierarchical clustering)
PCA/UMAP scatter plots with cluster colors
Silhouette plots
Cluster heatmaps
Cluster size barplots
Optimal k determination plots (if run)

Supporting data:

clustering_parameters.json - All parameters used in analysis
Report Packaging

Generate a PDF report using pdf-report-generation unless otherwise specified, with the available scientific outputs, generated figures, and relevant references. The workflow is not complete until the report is generated.

Clarification Questions

Before starting analysis, gather the following information:

1. Input Files (ASK THIS FIRST):
Do you have specific gene expression or omics data file(s) to cluster?
If you've uploaded a file, is it the data matrix (samples × features or features × samples) you'd like to analyze?
Expected file types: CSV, TSV, Excel (.xlsx), HDF5 (.h5), or RDS (R data objects)
Or use the ALL (Acute Lymphoblastic Leukemia) demo dataset? Use this only when no user dataset is provided or for workflow validation. It dynamically loads 128 Bioconductor ALL samples with B-cell and T-cell subtype labels and selects the 1000 most variable genes via scripts/load_example_data.R. The cohort is mixed-age in the Bioconductor phenotype data, so do not report it as pediatric-only. R recommended for this dataset.
2. Which programming language do you prefer?
Python: Modern ecosystem with scikit-learn, better for large datasets (>10k samples), machine learning integration
R: Rich Bioconductor tools, excellent heatmap visualization (ComplexHeatmap), traditional bioinformatics workflows
Both: Use Python for clustering algorithms, R for heatmap visualization (recommended for best of both worlds)
No preference: Will use Python (default, more comprehensive scripts available)
3. What are you clustering?
Samples (rows = samples, columns = features like genes)
Example: Group patients by gene expression profiles
Features (rows = features, columns = samples)
Example: Group genes by expression patterns across conditions
Both (explore both clustering directions)
4. What is your data format and normalization status?
Bulk RNA-seq: TPM, FPKM, VST, rlog
Proteomics: TMT/iTRAQ normalized intensities, LFQ
Metabolomics: Normalized peak areas
Already normalized: Z-scores, scaled values
Raw data: Needs normalization (specify data type)
5. What clustering approach do you prefer?
Hierarchical (recommended for exploration): Creates a tree-like dendrogram showing relationships at all scales. You can cut the tree at any height to get different numbers of clusters after seeing the structure. Best for visualization and when you don't know k. Deterministic (same results every run). Works well for small-medium datasets (<5k samples).
K-means: Fast partitioning method that requires specifying k upfront. Best for large datasets (>5k samples) with spherical/compact clusters. Results may vary between runs, so use high n_init.
Density-based (HDBSCAN): Automatically finds k by identifying dense regions. Can detect arbitrary cluster shapes and marks outliers. No need to specify k. Best when clusters have varying densities or you want outlier detection.
Model-based (GMM): Probabilistic soft clustering where samples have membership probabilities for each cluster. Useful when clusters overlap or you need uncertainty estimates. Requires specifying k.
Compare all methods: Systematic comparison (recommended for exploratory analysis)
6. Do you know the expected number of clusters (k)?
Yes, k = [number]: Will validate this choice with quality metrics
No, exploratory: Will test multiple k values (2-15) and help determine optimal k
Approximate range: k between [min] and [max]
Not needed: Hierarchical clustering lets you choose k later; HDBSCAN finds k automatically
7. What distance metric is most appropriate?
Euclidean: Default for most continuous data
Correlation: For gene expression (focuses on pattern similarity)
Manhattan: Robust to outliers
Cosine: For high-dimensional sparse data
Unsure: Will use Euclidean (default)
8. Should we apply dimensionality reduction first?
Yes, use PCA: Recommended for >1000 features
Yes, use UMAP: For visualization and manifold learning
No: Keep original feature space (<100 features)
Both: PCA for clustering, UMAP for visualization
9. How should cluster quality be validated?
Internal metrics only: Silhouette, Davies-Bouldin, Calinski-Harabasz
Known labels available: Compare to known groups (adjusted Rand index)
Stability analysis: Bootstrap resampling to test robustness
Biological validation: Check for differential features between clusters
Standard Workflow

🚨 MANDATORY: USE SCRIPTS EXACTLY AS SHOWN - DO NOT WRITE INLINE CODE 🚨

Note: This skill requires decisions (algorithm, distance metric, k value) - adapt parameters to your data using guidance in references/decision-guide.md.

Step 1 - Load data:

For ALL demo/example data (R recommended):

source("scripts/load_example_data.R")
data_list <- load_example_clustering_data()
data <- data_list$data
sample_names <- data_list$sample_names
feature_names <- data_list$feature_names
metadata <- data_list$metadata

For your own data (Python or R):

# Python
from scripts.prepare_data import load_and_prepare_data
data, sample_names, feature_names = load_and_prepare_data(
    "your_data.csv",
    normalize_method="zscore"
)
# R
source("scripts/prepare_data.R")
data_list <- load_and_prepare_data("your_data.csv", normalize_method = "zscore")
data <- data_list$data

DO NOT write custom data loading code. Use the provided functions.

Step 2 - Run clustering analysis:

# Choose ONE clustering method and run it:

# Option A: Hierarchical clustering (recommended for exploration)
from scripts.hierarchical_clustering import hierarchical_clustering
linkage_matrix, cluster_labels = hierarchical_clustering(
    data,
    n_clusters=2,  # For ALL dataset: B-cell vs T-cell; adjust for your data
    linkage_method="ward",
    distance_metric="euclidean"
)
clustering_object = linkage_matrix

# Option B: K-means clustering (fast, for large datasets)
from scripts.kmeans_clustering import kmeans_clustering
cluster_labels, kmeans_model = kmeans_clustering(
    data,
    n_clusters=2,  # For ALL dataset: B-cell vs T-cell; adjust for your data
    n_init=50
)
clustering_object = kmeans_model

# Option C: HDBSCAN (automatic k detection)
from scripts.density_clustering import hdbscan_clustering
cluster_labels, hdbscan_model = hdbscan_clustering(
    data,
    min_cluster_size=10
)
clustering_object = hdbscan_model

# Validate clustering quality
from scripts.cluster_validation import validate_clustering
validation_results = validate_clustering(data, cluster_labels, metrics="all")
print(f"Silhouette score: {validation_results['silhouette']:.3f}")

DO NOT write custom clustering code. Use one of the provided methods.

Step 3 - Generate visualizations:

# Generate comprehensive plots
from scripts.plot_clustering_results import plot_all_results
from scripts.dimensionality_reduction import apply_pca, apply_umap

# Optional: compute PCA/UMAP for visualization
pca_data = apply_pca(data, n_components=2)
umap_data = apply_umap(data, n_components=2)

# Create all plots
plot_all_results(
    data=data,
    cluster_labels=cluster_labels,
    sample_names=sample_names,
    feature_names=feature_names,
    pca_data=pca_data,
    umap_embedding=umap_data,
    linkage_matrix=clustering_object if 'linkage_matrix' in locals() else None,
    output_dir="clustering_results"
)

🚨 DO NOT write inline plotting code (matplotlib.pyplot.savefig, seaborn.clustermap, etc.). Use plot_all_results(). 🚨

The script handles PNG + SVG export with graceful fallback for optional dependencies.

Step 4 - Export results:

# Export all results including analysis objects for downstream use
from scripts.export_results import export_all

export_all(
    data=data,
    cluster_labels=cluster_labels,
    sample_names=sample_names,
    feature_names=feature_names,
    validation_results=validation_results,
    clustering_object=clustering_object,
    output_dir="clustering_results"
)

DO NOT write custom export code. Use export_all().

✅ VERIFICATION - You should see:

After Step 1: "✓ Data loaded successfully!"
After Step 2: "✓ Clustering completed successfully!"
After Step 3: "✓ Plots saved to clustering_results"
After Step 4: "=== Export Complete ==="

❌ IF YOU DON'T SEE THESE: You wrote inline code. Stop and use the scripts as shown.

⚠️ CRITICAL - DO NOT:

❌ Write inline clustering algorithms → STOP: Use provided clustering functions
❌ Write inline plotting code (matplotlib.pyplot.savefig, seaborn.clustermap, etc.) → STOP: Use plot_all_results()
❌ Write custom export code → STOP: Use export_all()
❌ Try to install plotting dependencies manually → scripts handle fallback automatically
❌ Upgrade numpy in-place to satisfy optional plotting dependencies → this can break the existing numpy/numba/umap-learn stack. Prefer Biomni's installed packages; if UMAP import fails, check the Common Issues table before changing versions.

⚠️ IF SCRIPTS FAIL - Script Failure Hierarchy:

Fix and Retry (90%) - Install missing package, re-run script
Modify Script (5%) - Edit the script file itself, document changes
Use as Reference (4%) - Read script, adapt approach, cite source
Write from Scratch (1%) - Only if genuinely impossible, explain why

NEVER skip directly to writing inline code without trying the script first.

For detailed parameter guidance and decision-making, see:

Algorithm selection: references/decision-guide.md#algorithm
Distance metrics: references/decision-guide.md#distance
Optimal k: references/decision-guide.md#optimal-k
Common Issues
Error    Cause    Solution
ValueError: n_clusters exceeds n_samples    Too many clusters requested for dataset size    Reduce k or ensure data has ≥10 samples
Ward linkage requires euclidean distance    Incompatible linkage method and distance metric    Use euclidean distance with ward, or switch to average/complete linkage
ModuleNotFoundError: No module named 'plotnine_prism'    Missing optional visualization dependency    Install: pip install plotnine-prism
Numba needs NumPy 2.2 or less or UMAP import fails after package installation    In-place package installation upgraded numpy beyond the numba version used by umap-learn    Do not pin numpy in the skill. Prefer the existing Biomni-compatible stack. If this occurs in a run, restore a compatible numpy/numba/umap-learn environment or run the visualization step in a fresh process after resolving the environment.
Silhouette score < 0.25    Poor cluster separation, k may be wrong    Try different k values, check data quality, use optimal k methods
HDBSCAN returns only noise (-1 labels)    min_cluster_size too large for dataset    Reduce min_cluster_size (try 5-10 for small datasets) or increase min_samples
ValueError: Input contains NaN    Missing values in data matrix    Impute or remove NaN values before clustering
Clusters of very unequal sizes    Algorithm bias or true biological structure    Validate with biology; try HDBSCAN for density-based approach
Different runs give different clusters (k-means)    Random initialization varies    Increase n_init (50-100) for stable results, or use hierarchical clustering

Debugging checklist:

Check data shape and missing values: data.shape, np.isnan(data).sum()
Verify normalization: Data should be comparable across features (z-scores, scaled)
Check cluster labels: Should range from 0 to k-1 (or include -1 for noise in HDBSCAN)
Validate with metrics: Silhouette >0.3 is decent, >0.5 is good
Inspect visually: PCA/UMAP plots should show clear groupings
Decision Guide

Make three critical decisions before clustering:

Decision    Quick Guide    Detailed Reference
Algorithm    Hierarchical (<5k samples, exploration), K-means (>5k, speed), HDBSCAN (unknown k, outliers), GMM (soft clustering)    decision-guide.md#algorithm
Distance    Correlation (gene expression), Euclidean (normalized data), Manhattan (outliers), Cosine (sparse)    decision-guide.md#distance
Cluster # (k)    Use multiple metrics (elbow, silhouette, gap), prioritize silhouette, consider biology    decision-guide.md#optimal-k

Comprehensive decision guidance: references/decision-guide.md

Common Patterns

Pattern 1: Sample Subtype Discovery - references/common-patterns.md#pattern-1 Pattern 2: Gene Co-clustering - references/common-patterns.md#pattern-2 Pattern 3: Method Comparison - references/common-patterns.md#pattern-3 Additional: QC/outlier detection, stability testing, batch validation - references/common-patterns.md

Suggested Next Steps

After completing clustering:

Differential Analysis - Use bulk-rnaseq-counts-to-de-deseq2 to identify cluster-specific signatures
Functional Enrichment - Use functional-enrichment-from-degs to interpret cluster biology
Refinement - If unclear: try different metrics, adjust k, remove outliers, use variable features subset
Related Skills

Prerequisite: bulk-rnaseq-counts-to-de-deseq2 (normalize RNA-seq data) Alternatives: scrnaseq-scanpy-core-analysis, scrnaseq-seurat-core-analysis (single-cell), coexpression-network Downstream: de-results-to-gene-lists, functional-enrichment-from-degs, de-results-to-plots

References

Reference documentation:

references/decision-guide.md - Comprehensive decision guidance (algorithm, distance, k)
references/common-patterns.md - Additional use case patterns
references/clustering_methods_comparison.md - Algorithm selection guide
references/validation_metrics_guide.md - Metric interpretation
references/distance_metrics_guide.md - Distance metric selection
references/parameter_guide.md - Parameter tuning details
references/best_practices.md - Workflow best practices

Python scripts:

scripts/prepare_data.py - Data loading and preprocessing
scripts/distance_metrics.py - Distance calculations
scripts/dimensionality_reduction.py - PCA, UMAP
scripts/hierarchical_clustering.py - Hierarchical methods
scripts/kmeans_clustering.py - K-means variants
scripts/density_clustering.py - DBSCAN, HDBSCAN
scripts/model_based_clustering.py - GMM
scripts/optimal_clusters.py - Optimal k determination
scripts/cluster_validation.py - Quality metrics
scripts/stability_analysis.py - Bootstrap validation
scripts/characterize_clusters.py - Feature importance
scripts/plot_clustering_results.py - Visualizations
scripts/export_results.py - Export functions

R scripts:

scripts/hierarchical_clustering.R - Hierarchical clustering with dendextend
scripts/plot_cluster_heatmap.R - ComplexHeatmap visualization (recommended for publication figures)
Additional R implementations available upon request

Evaluation:

eval/complete_example_analysis.py - Full workflow example

Online resources:

Python:

scikit-learn clustering
HDBSCAN documentation

R:

factoextra clustering
ComplexHeatmap vignettes
dendextend tutorial

Key papers:

Rousseeuw (1987) - Silhouettes for cluster validation
Tibshirani et al. (2001) - Gap statistic
McInnes et al. (2017) - HDBSCAN algorithm
D'haeseleer (2005) - Clustering in genomics

7. bulk-rnaseq-counts-to-de-deseq2
Category: TRANSCRIPTOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

8. cancer-cohort-genomics
Category: GENOMICS & GENETICS
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

9. cell-cell-communication
Category: TRANSCRIPTOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

10. cell-surface-antigen-discovery
Category: DRUG DISCOVERY
Source: https://biomni.phylo.bio/skills?section=marketplace

Cell-Surface Antigen Discovery (ADC / CAR-T / Bispecific)

Nominate antibody-accessible cell-surface antigens for ADC, CAR-T, bispecific T-cell engager, and radioligand development. The pipeline prioritizes targets by tumor-surface specificity + normal-tissue safety (therapeutic index), NOT by tumor essentiality — validated surface antigens (TROP2, c-MET, HER2) are typically non-essential, so essentiality is reported as an annotation only.

Scope

This skill nominates antibody-accessible cell-surface antigens for ADC, CAR-T, bispecific T-cell engager, and radioligand development. It integrates single-cell tumor specificity across atlases, the surfaceome with extracellular-topology accessibility, a Human Protein Atlas normal-tissue therapeutic index, and antibody tractability — then scores known validated targets alongside novel candidates as a validation harness and produces a tiered, ranked target list with a PDF report.

What it does NOT do:

Isoform or glycoform selection — the surfaceome seed is at the gene level; tumor-specific isoforms or glycoforms (e.g. MUC1 TN glycoform) are not distinguished.
Quantitative shedding / soluble-antigen assessment — ectodomain shedding is flagged qualitatively in the surfaceome notes but not quantified; a separate soluble-antigen assay is needed.
Mutation- or fusion-status stratification — the pipeline scores pan-tumor surface expression; it does not stratify by driver mutation, fusion, or subtype beyond the Census disease label.
Antigen density estimation — the score uses expression magnitude and prevalence from scRNA-seq, not absolute protein copy number (flow cytometry or quantitative IHC is needed for that).
Essentiality-driven target discovery — DepMap essentiality is annotation only, never a gate (see Why Specificity + Safety below).
When to Use This Skill
You want cell-surface targets for an antibody modality (ADC, CAR-T, bispecific, radioligand) in a defined tumor type
You have (or can pull) single-cell tumor data and want compartment-specific surface antigens (malignant vs stroma vs immune vs endothelial)
You need a therapeutic-index-aware ranking that flags normal-tissue (on-target/off-tumor) liabilities using real Human Protein Atlas protein + RNA data
You want a credibility check — known validated targets are scored alongside novel candidates (recall harness), and negative controls must rank low
You want per-candidate literature evidence folded into the report

Don't use for:

Small-molecule / degrader target discovery (essentiality-driven) → use scrna-disease-drug-discovery or genetic-target-hypothesis
General disease target prioritization with genetic evidence → use scrna-disease-drug-discovery
Cell-type annotation only → use scrnaseq-scanpy-core-analysis
Why Specificity + Safety, Not Essentiality (READ FIRST)

Antibody modalities recognize an antigen on the cell surface; the mechanism (payload delivery, T-cell redirection) does not require the target to be essential for tumor survival. Gating on tumor essentiality (e.g. DepMap CRISPR) systematically enriches for housekeeping genes (ion pumps, pan-epithelial adhesion) that are broadly expressed in normal tissues → severe on-target/off-tumor toxicity → undruggable, while discarding the best targets (TROP2, c-MET, HER2 are all non-essential). This skill therefore:

Uses tumor-surface specificity and normal-tissue therapeutic index as the primary prioritization axes.
Applies an extracellular-topology filter so cytoplasmic (e.g. cingulin/CGN), ER/organelle (e.g. ITPR3), and secreted-ECM (e.g. laminins) proteins cannot be nominated as "surface" antigens.
Reports DepMap essentiality as an annotation (informative for biology, not a gate).

See references/scoring_methodology.md.

Step 0 — Check the Environment First

Before installing anything or writing code, confirm what the Biomni environment already provides. Many dependencies of this skill are preinstalled, and several data sources are available as datalake datasets or queryable databases — use them instead of re-fetching where possible.

Check Python packages directly:

from importlib.util import find_spec

for package in ("cellxgene_census", "scanpy", "anndata"):
    print(package, "available" if find_spec(package) else "missing")

This workflow uses Human Protein Atlas, DepMap, and optional GTEx resources.

What you will typically find already present (verify at runtime; do not assume):

Need    Usually available as    Notes
Single-cell tumor atlases    cellxgene-census, scanpy, anndata (preinstalled packages)    No install needed in most Biomni environments
Normal-tissue protein/RNA    Human Protein Atlas    The script pulls the full dual-signal baseline (see below)
Essentiality annotation    DepMap    Annotation only, never a gate
Normal-tissue RNA cross-check    GTEx    Optional orthogonal baseline
Tractability / known drugs / locations    Open Targets Platform GraphQL (public API)    Called by scripts/annotate_targets.py
PDF report    pdf-report-generation skill    See report step
Report figures    matplotlib, seaborn (preinstalled)    Data plots only

Only pip install what is genuinely missing. If cellxgene-census is absent: pip install -U cellxgene-census (needs Python 3.10–3.12, ≥16 GB RAM for typical use).

Inputs

Tumor expression source (choose one):

CZ CELLxGENE Census (default) — a verified disease label, or a list of labels. The demo targets "lung adenocarcinoma" specifically. Census splits lung cancer by subtype, so the umbrella "non-small cell lung carcinoma" is a separate label — pass ["lung adenocarcinoma", "non-small cell lung carcinoma"] to union them (keep squamous separate to preserve adenocarcinoma specificity). The skill integrates multiple whole-cell scRNA-seq datasets (suspension_type == 'cell'); single-nucleus is de-weighted. Coverage varies — for single-nucleus-only or thin labels, supply a curated whole-cell atlas via the own-.h5ad path. See references/census_atlas_guide.md.
Your own annotated AnnData (.h5ad) — must contain a cell-type/compartment column and (ideally) a malignant-cell annotation; supply column names.

Surface-gene universe: bundled surfaceome (references/surfaceome_seed.csv, load_surfaceome()) + optional live cross-check via Open Targets subcellularLocations. For a genome-wide run, use surfaceome_filter.load_surfy_surfaceome() — it downloads SURFY Table S3 (Bausch-Fluck 2018) and assigns per-gene topology, ectodomain accessibility, and localization from SURFY's own topology string / Almen class / evidence source. Do NOT assign every SURFY member localization='plasma_membrane' — that makes the topology gate inert (the gate then raises; see Common Issues). See references/census_atlas_guide.md.

Normal-tissue baseline: built by scripts/hpa_baseline.py from two Human Protein Atlas bulk downloads (RNA consensus nTPM + IHC protein levels). See references/hpa_baseline_guide.md.

Validation harness: bundled references/known_surface_targets.csv (clinically validated targets + cautionary negative controls). Used for recall@K; edit to add tumor-specific known targets.

Outputs

Ranked targets:

ranked_surface_targets.csv — all scored candidates: per-compartment expression, specificity ratios, n_datasets, topology/accessibility, surface_confirmation (confirmed_experimental / confirmed_ot / unconfirmed) + is_unconfirmed_surface, normal-tissue safety score, antibody tractability, known-drug flag, DepMap essentiality (annotation), composite surface-target score, tier
target_evidence_cards.json — per-target evidence summaries (incl. literature) for the report

Intermediate evidence (read from disk for the report — never from memory):

cohort_cell_counts.csv + cohort_summary.json — per-atlas × per-compartment cell counts actually analysed (post-subsampling), plus discovered-vs-analysed totals and the subsample cap. This is the source of the honest headline cohort number.
compartment_expression.csv / compartment_expression_consensus.csv — per-dataset and cross-dataset compartment expression (the analysed matrices)
surfaceome_topology.csv — surfaceome membership + ectodomain accessibility per candidate
target_annotations.csv — Open Targets tractability, subcellular location, known drugs, DepMap essentiality
target_baseline_expression_long.csv — HPA dual-signal normal-tissue baseline (from hpa_baseline.py)
therapeutic_index.csv — normal-tissue safety score + vital-organ flags
validation_harness.csv + validation_metrics.json — known-target ranks, provenance (pre_registered / added_post_ranking), pre-registered recall@K (headline) + augmented recall@K (when applicable), harness lock date, negative-control verdict, holdout caveat
therapeutic_index_stability.csv + therapeutic_index_stability.json — rank-stability check over TI safety-aggregation rules and tumor-quality weight alternatives (with derived verdict)
coverage_report.csv — per-column annotation coverage (n_annotated/percent_annotated) and, for boolean columns, positive rate (n_positive/percent_positive)
report_facts.json — pre-derived headline numbers and pre-formatted sentences for the report (cohort discovered-vs-analysed, tier counts, topology confirmed/unconfirmed counts, pre-registered + augmented recall, negative-control verdict, stability verdict, protein-evidence counts, safety counts, coverage figures, warnings). The report MUST quote these verbatim.
literature_evidence.json — per-candidate literature hits (from the LiteratureSearch pass)

Analysis object:

analysis_objects.pkl — all tables + metadata for downstream/custom use (import pickle; objs = pickle.load(open('analysis_objects.pkl','rb')))
analysis_manifest.json — provenance: Census version, datasets, filters, parameters, HPA download dates, step timing

Visualizations (PNG + SVG, 300 DPI):

Compartment specificity heatmap (candidates × malignant/CAF/immune/endothelial)
Therapeutic-index map (tumor specificity x-axis vs normal-tissue safety y-axis; known targets labeled)
Validation-harness recall plot (where known targets rank)
Top-target ranking bar chart with tier coloring

Report:

report_surface_antigen_discovery.pdf — PDF report generated with pdf-report-generation unless otherwise specified, using the analysis results, figures, and references.
Clarification Questions

Default settings (use unless user specifies otherwise): Organism: human | Tumor source: CZI Census | Surfaceome: bundled seed + Open Targets cross-check | Normal-tissue baseline: HPA dual-signal (RNA + IHC) | Essentiality: annotation only | Validation harness: enabled | Literature evidence: enabled

1. Input / data source (ASK THIS FIRST):
Pull tumor single-cell data from the CZI Census by disease label, or use your own annotated .h5ad?
Or use demo data? — pinned Census run on lung adenocarcinoma (whole-cell, multi-atlas). All other parameters pre-defined.

🚨 IF DEMO DATA SELECTED: All parameters are pre-defined (human, lung adenocarcinoma, Census 2025-11-08, bundled surfaceome + harness, HPA dual-signal baseline). DO NOT ask questions 2–4. Proceed directly to Step 1.

Questions 2–4 are ONLY for users providing their own data / disease:

2. Tumor type & modality: Which tumor type (disease label / EFO)? Which modality emphasis — ADC, CAR-T, bispecific (affects shedding/homogeneity weighting)?
3. Compartments (own h5ad only): Which column holds cell-type labels, and how is the malignant/epithelial compartment identified (label value or marker set)?
4. Scope: Bundled surfaceome seed (fast, ~hundreds of genes) or full in-silico surfaceome (comprehensive, ~2,800 genes, slower Census pull)?
Data Integrity Rules

🚨 NEVER reconstruct results from memory, notes, or session summaries. 🚨

Every quantitative value in the report must be read from a CSV on disk, not from session memory.
If outputs are missing after a crash: STOP, check results/, re-run the step that produced the missing CSV. The consensus expression CSV, target_baseline_expression_long.csv, and analysis_objects.pkl are checkpoints.
NEVER fabricate Census expression, normal-tissue values, tractability buckets, or literature citations. Missing values stay null/NaN and are reported as missing (the surfaceome filter and annotators emit "Removed N / Missing N" counts). Genes absent from HPA get safety_score = NaN → the scorer applies a neutral 0.7 and flags them safety_unassessed — this must be stated honestly in the report (see Safety Honesty below).
Standard Workflow

🚨 MANDATORY: USE SCRIPTS EXACTLY AS SHOWN — DO NOT WRITE INLINE CODE 🚨

CRITICAL — DO NOT:

❌ Write inline Census / API code → STOP: use the script functions
❌ Write a custom scorer → STOP: use score_surface_targets() (custom scorers drop the topology gate, therapeutic-index weighting, cross-dataset consensus, and the validation harness)
❌ Use DepMap essentiality as a filter → STOP: it is an annotation only
❌ Reconstruct values from memory after a crash → STOP: read CSVs or re-run
❌ Fabricate a normal-tissue baseline → STOP: run hpa_baseline.py; missing genes stay NaN

⚠️ IF SCRIPTS FAIL — Script Failure Hierarchy:

Fix and Retry (90%) — install missing package, run discover to fix Census labels, re-run the script
Modify Script (5%) — edit the script file, document the change, keep provenance + no-simulation behavior
Use as Reference (4%) — read the script, adapt the official API call, cite the source
Write from Scratch (1%) — only if genuinely impossible; explain why. NEVER substitute simulated values.

Step 0 — Environment check: confirm cellxgene-census/scanpy/anndata with direct imports. Install only what is missing.

Step 1 — Load surface-gene universe + tumor expression source:

from scripts.load_example_data import load_demo_inputs        # demo
inputs = load_demo_inputs()   # disease_label, census_version, surfaceome df, known_targets df

# (own data) instead:
# from scripts.surfaceome_filter import load_surfaceome
# surfaceome = load_surfaceome(include_in_silico=False)   # bundled seed

VERIFICATION: You MUST see: "✓ Inputs loaded: N surface genes, M known targets"

Step 2 — Tumor specificity → surfaceome/topology → annotation:

from scripts.census_pull import discover_datasets, pull_compartment_expression
from scripts.surfaceome_filter import apply_topology_filter
from scripts.annotate_targets import annotate

datasets = discover_datasets(inputs["disease_label"], inputs["census_version"])   # whole-cell atlases
spec = pull_compartment_expression(inputs["surfaceome"]["gene_symbol"].tolist(),
                                   disease_label=inputs["disease_label"],
                                   census_version=inputs["census_version"], output_dir="results")
surf = apply_topology_filter(spec, inputs["surfaceome"])  # per-gene topology gate: excludes cytoplasmic/ER/secreted-ECM/no-ectodomain
ann  = annotate(surf["gene_symbol"].tolist(), output_dir="results")   # Open Targets tractability/locations/drugs + DepMap (annotation)

# GENOME-SCALE run (instead of the bundled seed):
#   from scripts.surfaceome_filter import load_surfy_surfaceome
#   surfaceome = load_surfy_surfaceome()               # ~2,800 SURFY genes, PER-GENE topology (downloads Table S3)
#   spec = pull_compartment_expression(surfaceome["gene_symbol"].tolist(), disease_label=..., ...)
#   surf = apply_topology_filter(spec, surfaceome)     # RAISES if a genome-scale set excludes nothing (inert gate)

⚠️ Open Targets v4 note: annotate() no longer returns a normal-tissue baseline (OT removed Target.expressions). The baseline now comes from HPA in Step 3. Do not add an expressions field back to the OT query — it will break the call.

⚠️ Topology gate must be live. apply_topology_filter gates on per-gene localization/accessibility. On a genome-scale set (≥200 genes) it raises if it excludes nothing — a blanket plasma_membrane assignment is the bug it guards against. It also carries a surface_confirmation call (experimental CSPA/GPI or Open Targets PM = confirmed; machine-learning-only = unconfirmed); the count of unconfirmed candidates is reported in Step 8, not folded into the pass list.

VERIFICATION: the topology filter prints "N retained (M excluded of K)" with M > 0 for a genome-scale run; annotate() prints an annotation count and reminds you to build the HPA baseline separately.

Step 3 — Build the HPA normal-tissue baseline, then the therapeutic index:

from scripts.hpa_baseline import build_hpa_baseline_long
from scripts.normal_tissue_safety import compute_therapeutic_index

# Dual-signal HPA baseline (bulk download + cache on first run: RNA consensus + IHC protein)
build_hpa_baseline_long(surf["gene_symbol"].tolist(), output_dir="results")
#   -> results/target_baseline_expression_long.csv (gene_symbol,tissue,organs,rna_value,rna_level,protein_level)

ti = compute_therapeutic_index(ann, output_dir="results",
                               baseline_long_path="results/target_baseline_expression_long.csv")

The safety score is the conservative min of a protein-derived and an RNA-derived safety per gene, so a target that looks clean on RNA but is HIGH by IHC in a vital organ (or vice versa) is correctly demoted. Genes lacking HPA data → safety_score = NaN. See references/hpa_baseline_guide.md. VERIFICATION: "✓ HPA dual baseline: ... rows" then "✓ Therapeutic index: N gene(s) with favorable normal-tissue safety ..."

Step 4 — Score (topology gate + therapeutic-index weighting + consensus + harness):

from scripts.score_targets import score_surface_targets
scores = score_surface_targets(spec, surf, ann, ti, inputs["known_targets"], output_dir="results")

DO NOT write a custom scorer. score_surface_targets() applies the topology gate, cross-dataset consensus, therapeutic-index weighting, and the validation harness. VERIFICATION: You MUST see: "✓ Scoring complete: N candidates, T tier-1; validation recall@20 = X/Y known targets; stability verdict: <verdict>". The reported recall is the pre-registered headline (locked before ranking); if you later add a validated target to the harness, both pre-registered and augmented recall are emitted (see Step 5). If recall@20 is low (<50%): check that whole-cell (not only snRNA) datasets were pulled and the disease label matched — see Common Issues.

Step 5 — Literature evidence for top candidates (LiteratureSearch): Run a LiteratureSearch pass on the top candidates (Tier 1/2 and any novel Tier-3 of interest) to attach real citations, then persist them for the report and harness curation.

Per-candidate evidence: for each top gene, search e.g. "<GENE> <tumor type> antibody-drug conjugate OR CAR-T OR surface antigen". Record whether it is a validated/known target, in clinical development, or genuinely novel. Save a compact record per gene (title, year, one-line finding, DOI/URL) to results/literature_evidence.json.
Harness curation (anti-circularity): the validated-target set is pre-registered — locked before ranking (references/known_surface_targets.csv carries date_added + provenance; lock date = score_targets.HARNESS_LOCK_DATE). If a candidate turns out to be a clinically validated antigen not already in the harness, you MAY add it — but set provenance=added_post_ranking and date_added=<today>. The harness then reports both the pre-registered recall (headline) and an augmented recall that includes the promoted target, labelled as such. Never report the augmented figure alone — a benchmark that admits the discovery it validates is circular. Adding a post-ranking target while reporting a single recall figure makes the export gate raise. Conversely, confirm the negative controls are still non-targets.
Report references: every literature claim in the PDF must map to a citation captured here — do not write mechanistic/clinical claims from memory.

Grounding rule: treat one-line search summaries as discovery signals; before making a specific clinical/mechanistic claim, verify it from the richer paper record. Never fabricate a citation, DOI, or trial ID.

VERIFICATION: results/literature_evidence.json exists and covers the candidates you cite.

Step 6 — Generate visualizations:

from scripts.generate_visualizations import generate_all_plots
generate_all_plots(spec, surf, ann, ti, scores, inputs["known_targets"], output_dir="results")

🚨 DO NOT write inline plotting code. The script handles PNG + SVG with graceful fallback. 🚨 VERIFICATION: You MUST see: "✓ All plots generated successfully!" MANDATORY: after plots are written, visually inspect the rendered media (Read(file_path=...)) on the therapeutic-index map and the ranking bar chart; regenerate if blank/clipped.

Step 7 — Export results:

from scripts.export_results import export_all
export_all(spec, surf, ann, ti, scores, inputs["known_targets"], output_dir="results")

DO NOT write custom export code. Use export_all(). VERIFICATION: You MUST see: "✓ Export consistency gate: all invariants satisfied." (or a ⚠ EXPORT CONSISTENCY GATE — WARNINGS: block) followed by "=== Export Complete ==="

Step 8 — Generate the PDF report (MANDATORY terminal step — the run is not complete until this is done):

🚨 This step is required. The skill does not end until report_surface_antigen_discovery.pdf is written and validated. 🚨

Use pdf-report-generation unless otherwise specified, with the analysis results, figures, infographic, and references.

Load results/report_facts.json. Every headline count, cohort cell count, recall figure, topology confirmed/unconfirmed count, negative-control verdict, stability verdict, protein-evidence count and coverage figure in the report MUST be the value or pre-formatted sentence from this file, quoted verbatim. Do not recompute, re-round, or rephrase. If report_facts.json carries a non-empty warnings list, every warning must appear in the Discussion. Do not describe the ranking as robust, or the negative controls as behaving correctly, unless report_facts.json says so — those words are computed, not chosen.

🚨 Three honesty rules baked into report_facts.json (quote it; do not derive your own):

Cohort: the headline cell count is the analysed cohort (cohort.cohort_statement / cohort.n_cells_analyzed), NOT the discovery catalogue. Report discovered vs analysed side by side and include the per-atlas × per-compartment breakdown (cohort.per_atlas_compartment_counts) so a reader can see any atlas contributing very few cells to a compartment. (The export gate raises if the analysed count does not match the analysed matrices.)
Topology confirmation: quote topology.topology_statement — state how many scored candidates are independently confirmed plasma-membrane vs unconfirmed machine-learning predictions, and name any unconfirmed candidate in the top 20. Do not present unconfirmed hits with the same confidence as confirmed antigens.
Recall: the headline is the pre-registered recall (validation.recall_pre_registered_at_10_str/_20_str). If validation.harness_augmented_after_ranking is true, also report the augmented recall and label it; never the augmented figure alone (the export gate raises otherwise).

Skill-specific content the report MUST carry (quote report_facts.json verbatim where noted):

Executive summary — built from report_facts.json tiering_statement and validation_statement (verbatim).
Methods — the data sources actually used (Census version + datasets from analysis_manifest.json, HPA download build, Open Targets, DepMap) and the specificity/topology/safety/consensus logic and parameters; emit source attribution in Methods/References (see DATA_SOURCES.md).
Results — open with the cohort: discovered vs analysed cells (report_facts.json cohort.cohort_statement) plus the per-atlas × per-compartment table (cohort.per_atlas_compartment_counts), so any atlas contributing few cells to a compartment is visible, not averaged away; the four analysis figures with captions; a top-20 ranked table (with the surface_confirmation column; note "full results in ranked_surface_targets.csv"); the topology-confirmation count (report_facts.json topology.topology_statement — confirmed vs unconfirmed, naming unconfirmed top-20 hits); and the validation-harness recall (report_facts.json validation — pre-registered headline, plus augmented if harness_augmented_after_ranking).
Discussion / Interpretation — biological meaning and why the top candidates are attractive; reproduce every entry from report_facts.json warnings; quote negative_controls.statement verbatim (and if negative_controls.verdict is FAIL, say so plainly); quote stability.statement verbatim (do not call the ranking "robust" unless stability.verdict says robust).
Safety-honesty subsection (REQUIRED). Quote report_facts.json safety.safety_statement verbatim; state how many scored candidates carry a computed HPA safety score vs how many fall back to the neutral 0.7 default because they are un-annotated, and scope every safety distribution to the correct set (assessed subset vs full scored set — never attribute the assessed-subset distribution to the full scored set).
Protein-evidence subsection. Quote report_facts.json protein_evidence.protein_evidence_statement verbatim; HPA nTPM is bulk RNA and is NOT protein-level validation — only has_ihc_protein_measurement is. Do not claim "all top-ranked candidates have protein-level validation" unless report_facts.json says so.
Literature evidence — per-candidate citations from literature_evidence.json, with inline references.

Name the file report_surface_antigen_discovery.pdf and write it directly to the results directory. Validate the report using the requirements in pdf-report-generation. The skill is not complete until this verification passes.

Scoring Methodology

Full details: references/scoring_methodology.md.

Score shape: final = tumor_quality × safety_factor × consensus_multiplier. Normal-tissue therapeutic index is a multiplicative safety factor, not a linear term — a great tumor antigen that is also expressed in heart/liver/lung is not a target, however tumor-specific it looks within the microenvironment. This is what demotes broadly-expressed housekeeping genes like CDH1 / ATP1A1.

Tumor-quality components (weights sum to 1.0):

Component    Weight    Description
Tumor-surface specificity    0.30    Epithelial/malignant enrichment over CAF and immune (min of the two ratios, log-scaled)
Tumor expression magnitude    0.20    Mean expression in malignant/epithelial cells
Expression homogeneity / prevalence    0.20    % of malignant cells expressing (antigen-negative-escape risk for ADC/CAR-T)
Surface accessibility    0.15    Ectodomain accessibility from topology (high=1.0 / partial=0.6 / low=0.3); none gated out upstream
Antibody tractability    0.15    Open Targets antibody tractability bucket

× Safety factor (therapeutic index): normal-tissue safety in [0,1] (1 = low vital-organ expression), from the HPA dual-signal baseline (conservative min of protein and RNA). Unassessed → neutral 0.7 and flagged safety_unassessed. × Consensus multiplier: 0.5 + 0.5·min(n_datasets_enriched, 3)/3 — reproducibility across atlases (3+ enriched datasets → full weight; single dataset → 0.67). Annotation only (NOT scored): DepMap essentiality; known-drug flag (raises confidence, does not inflate the novelty-oriented score). Tiers: Tier 1 (≥0.55), Tier 2 (0.35–0.55), Tier 3 (<0.35). Topology none → excluded before scoring.

Validation harness: the curated known targets are scored by the identical pipeline; the report states recall@10/@20 (how many known targets land in the top K) as a QC metric. Cautionary negative controls (CDH1, ATP1A1, CGN) should rank low — if they rank high, the safety/topology layers are misconfigured.

Safety Honesty (READ BEFORE WRITING THE REPORT)

The therapeutic-index safety score is only as good as HPA coverage. Two rules prevent the most common reporting error:

Scope every safety distribution to the correct set. Report separately (a) the distribution over candidates that carry a computed HPA safety score, and (b) the full scored set, in which un-annotated genes sit at the neutral 0.7 default. Never present the assessed-subset distribution as if it described the full scored set.
State the neutral-default count. Give the number (and %) of scored candidates at the 0.7 neutral default (safety_unassessed = True). When you highlight a top-N composite list, note how many of those N have a computed safety score vs sit at the default — a high composite score driven by an un-assessed safety factor is a weaker claim than one backed by real HPA data.

Compute these directly from therapeutic_index.csv / ranked_surface_targets.csv; do not estimate.

Scientific Caveats

These assumptions and edge cases must be reflected honestly in the report. They are factual constraints, not limitations to soften.

Held-out recall is a small-n single fixed split, not cross-validated. Recall@K is computed on the recall_core=1 validated targets (9 in the bundled harness) on one fixed partition. One target moves recall by 100/n_core percentage points (see report_facts.json validation.holdout_caveat). No repeated cross-validation or bootstrap interval is computed. A statistical reviewer will ask about this; state the caveat explicitly in the report.
Cautionary negative controls are an empirical check that CAN FAIL. If report_facts.json negative_controls.verdict is FAIL, say so plainly — do not soften it. A FAIL means one or more housekeeping/pan-epithelial controls (CDH1, ATP1A1, EPCAM) ranked in the top 25% of scored candidates, indicating the safety or topology layers did not fully demote them.
Tier cutoffs are absolute thresholds on the composite scale. An empty Tier 1/2 is a legitimate outcome and must be framed as "highest-ranked candidates", not "candidates clearing the nomination bar." The report_facts.json warnings list will flag n_tier1 + n_tier2 == 0 if it occurs.
HPA nTPM is bulk RNA and is NOT protein-level validation. Only has_ihc_protein_measurement (a non-null vital_protein_max from the HPA IHC download) counts as protein evidence. A computed HPA safety score derived from RNA alone is a category error if cited as protein validation. See report_facts.json protein_evidence.
The bundled surfaceome seed is a subset, not a genome-wide screen. references/surfaceome_seed.csv contains ~65 validated surface genes. For a comprehensive run, fetch the full in-silico surfaceome (~2,800 genes) via the scope option. Novel candidates outside the seed will not appear unless the full surfaceome is used.
snRNA-seq under-detects surface transcripts and is de-weighted. Single-nucleus data systematically misses membrane-encoding transcripts. The pipeline prefers whole-cell assays (suspension_type == 'cell'); coverage varies by Census disease label. For snRNA-only labels, supply a curated whole-cell atlas via the own-.h5ad path.
The specificity axis is epithelial-vs-stroma/immune, NOT verified malignant-vs-normal. Tumor cells are grouped into the epithelial compartment, but the demo Census data carries no malignant-cell annotation, so "tumor specificity" here means enrichment in the epithelial compartment over CAF/immune/endothelial — it does NOT distinguish malignant epithelium from normal epithelium within the tumor. A target that is uniformly epithelial (malignant + normal) can look specific on this axis yet have a poor therapeutic window. State this prominently in the report; for a true malignant-vs-normal contrast, supply an .h5ad with a malignant-cell annotation. (The normal-tissue HPA safety axis partly compensates, but is not a substitute.)
The reported cell count is the ANALYSED cohort, not the discovery catalogue. Each atlas is subsampled (default ≤20,000 cells) before analysis, and atlases with <20 epithelial cells are dropped. report_facts.json cohort reports discovered vs analysed side by side with a per-atlas × per-compartment breakdown; the export gate raises if the headline analysed count does not match the analysed matrices. Never headline the multi-hundred-thousand-cell discovery total as the statistical basis.
Genome-scale surface membership is a SURFY prediction, not proof of a plasma-membrane epitope. load_surfy_surfaceome() assigns per-gene topology/accessibility/localization from SURFY Table S3; each candidate is labelled confirmed_experimental (CSPA/GPI), confirmed_ot (Open Targets plasma-membrane), or unconfirmed (machine-learning-only, no independent confirmation). The count of unconfirmed candidates is in report_facts.json topology and must be reported. An unconfirmed hit (e.g. an ER–PM contact-site protein) is a hypothesis requiring wet-lab surface confirmation (flow/IHC), not a validated antigen.
Held-out recall is pre-registered, and augmentation is disclosed (anti-circularity). The validated-target set is locked before ranking (known_surface_targets.csv date_added/provenance; HARNESS_LOCK_DATE). The headline recall is computed on the pre-registered set only. If a novel candidate is promoted into the harness after ranking, an augmented recall is reported alongside — and labelled — never as the headline alone; a benchmark that admits the discovery it validates is circular. The export gate raises if the harness was augmented but only one recall figure is reported.
Common Issues
Issue    Cause    Solution
Census returns no cells    Disease/tissue label mismatch    Run discover_datasets() / the czi-cellxgene-census discover command; copy labels exactly (disease may be `
Malignant compartment mislabeled as immune    Cell-type string contains a substring of another compartment (e.g. "malignant cell" ⊃ "t cell")    Fixed: assign_compartment uses word-boundary matching with epithelial checked first. Do not revert to substring in matching
Low known-target recall    Only snRNA-seq datasets pulled, or wrong disease label    Confirm whole-cell assays present; snRNA under-detects surface transcripts and is de-weighted
Malignant compartment empty    Census labels tumor cells as epithelial subtypes, not "malignant cell"    Use the compartment mapping in census_pull.py; for own data pass the malignant label/markers
annotate() returns no baseline / KeyError expressions    Open Targets v4 removed Target.expressions    Expected — build the baseline with hpa_baseline.py (Step 3). Do not re-add expressions to the OT query
HPA download returns a tiny file / not-a-zip error    Deprecated normal_tissue.tsv.zip (now HTTP 404, HTML page)    Use the current endpoints (already in hpa_baseline.py): rna_tissue_consensus.tsv.zip + normal_ihc_data.tsv.zip
Gene missing from surfaceome    Not in bundled seed    Use load_surfy_surfaceome() (genome-scale, per-gene topology), or rely on Open Targets subcellularLocations cross-check
RuntimeError: Topology gate excluded 0 of N genome-scale candidates    SURFY members were blanket-assigned plasma_membrane/high (inert gate)    Load the surfaceome with load_surfy_surfaceome() so localization/accessibility are per-gene; do NOT overwrite them with a constant
RuntimeError: Recall-reporting gate ...    A target was added to the harness after ranking but only one recall figure is reported    Report both pre-registered and augmented recall (see Step 5); set the post-hoc target's provenance=added_post_ranking
RuntimeError: Cohort gate ...    Headline cell count ≠ the analysed matrices (e.g. the discovery catalogue was used)    Quote cohort_summary.json / report_facts.json cohort — report the analysed count, not the catalogue
Could not download SURFY Table S3    wlab.ethz.ch migrated / serves a Git-LFS pointer    load_surfy_surfaceome() falls back to a byte-identical mirror; or pass a local path via source= (download from wollscheidlab.org/SURFY, cite Bausch-Fluck 2018)
Open Targets rate limit    Too many gene queries    Built-in 0.5s throttle + retry; annotate top candidates first
cellxgene_census import error    Not installed / unsupported Python    pip install -U cellxgene-census; needs Python 3.10–3.12
SVG export failed    Missing cairo backend    Normal — PNG always written; both created in most environments
Suggested Next Steps
Protein-level validation — IHC / flow on tumor microarrays for Tier-1 candidates; confirm membrane localization and homogeneity
Shedding / sink assessment — for high-ectodomain mucins (MUC1/MUC16), check soluble-antigen liability
Normal-tissue deep dive — tissue-expression-from-degs for full GTEx/HPA/cell-type breakdown of top candidates
Bispecific pairing — co-expression analysis of Tier-1 pairs for dual-antigen or logic-gated CAR-T
Genetic / disease evidence — open-targets and scrna-disease-drug-discovery for orthogonal support
Related Skills

Upstream/data: czi-cellxgene-census (Census access), scrnaseq-scanpy-core-analysis (own-data annotation) | Complementary: open-targets (tractability/safety/known drugs), tissue-expression-from-degs (normal-tissue baseline) | Reporting: pdf-report-generation (used in Step 8) | Contrast: scrna-disease-drug-discovery (essentiality/genetics-driven, for non-surface modalities)

Data Sources & Licenses

This skill integrates public biomedical data. Full details, required attribution strings, and share-alike compatibility notes are in DATA_SOURCES.md — the authoritative license record. Emit attribution in the report's Methods/References and in analysis_manifest.json.

Source    Used for    License    Commercial    Attribution    Share-alike
CZ CELLxGENE Census    Tumor scRNA-seq expression    Data CC BY 4.0; code (cellxgene-census) MIT    Yes    Yes    No
Human Protein Atlas    Normal-tissue RNA + IHC safety baseline    CC BY-SA (download files; site parts now CC BY 4.0)    Yes    Yes    Yes
Open Targets Platform    Tractability, locations, known drugs    CC0 1.0 (integration layer)    Yes    Good practice    No
ChEMBL (via Open Targets, drugs)    Known-drug / mechanism evidence    CC BY-SA 3.0 Unported    Yes    Yes (URL + release version)    Yes
DepMap    Essentiality — annotation only, never a gate    CC BY 4.0    Yes    Yes    No
SURFY in-silico surfaceome    Genome-wide surfaceome + topology    Journal supplementary (Bausch-Fluck 2018) — cite    Cite    Yes    N/A
GTEx (optional)    Orthogonal normal-tissue RNA    CC BY 4.0    Yes    Yes    No

⚠️ Share-alike sources (commercial use OK, but conditions apply): ChEMBL (CC BY-SA 3.0) and Human Protein Atlas (CC BY-SA). Both permit commercial use but require attribution + share-alike: any redistributed adaptation that embeds their data (e.g. a table carrying HPA nTPM/IHC values or ChEMBL drug records) must itself be released under a compatible CC BY-SA license with the required attributions. A report that merely cites these sources and reports derived scores (the normal deliverable) satisfies the license with attribution — share-alike only bites when you redistribute an adaptation of the underlying data. See DATA_SOURCES.md.

References
CZ CELLxGENE Census — CZI. https://chanzuckerberg.github.io/cellxgene-census/
Surfaceome — Bausch-Fluck D, et al. (2018) PNAS 115(46):E10988–E10997 (in-silico human surfaceome / SURFY).
Human Protein Atlas — Uhlén M, et al. (2015) Science 347(6220):1260419 (normal-tissue RNA + IHC protein baseline). https://www.proteinatlas.org/
Open Targets — Ochoa D, et al. (2023) Nucleic Acids Res 51(D1):D1302–D1310 (tractability, subcellular location, known drugs).
DepMap — Tsherniak A, et al. (2017) Cell 170(3):564–576 (essentiality — used here as annotation, not a gate).
NSCLC surface-antigen ADCs — c-MET (telisotuzumab vedotin) and TROP2 (datopotamab deruxtecan) — clinical proof of concept that validated surface antigens are non-essential.

Detailed guides: references/scoring_methodology.md | references/census_atlas_guide.md | references/hpa_baseline_guide.md | references/tnbc_worked_example.md Scripts: scripts/

11. cell-therapy-car-design
Category: FUNCTIONAL GENOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

CAR-T Target Discovery + Receptor Design (Biomni-native)

Two linked capabilities that combine into a next-generation CAR-T design — a receptor plus a prioritized, essentiality-filtered list of knockout targets:

CRISPR screen reanalysis — reanalyze a pooled loss-of-function screen in primary human T cells (SLICE-style) with the authentic MAGeCK workflow, then validate hits against DepMap to separate context-specific regulators from broadly essential genes.
CAR design — build clinically-validated second-generation CAR constructs from a validated scFv as an annotated protein map, a human codon-optimized ORF, and a complete lentiviral expression cassette with GenBank annotation.

Worked example throughout: FMC63 anti-CD19 CAR + the Shifrut 2018 SLICE screen (GEO GSE119450). The workflow generalizes to any scFv-based CAR and any pooled CRISPR-knockout proliferation/fitness screen — swap the antigen/scFv and the dataset accession.

Native-first principle (read this first)

Prefer Biomni-native tools, databases, and data-lake datasets for every step; fall back to external CLIs/REST only where there is genuinely no native equivalent (this is called out at each such step). Two consequences:

Verify software directly before use: import the documented biomni.tool functions and check packages/CLIs with imports or command -v.
Do not promise tools that are not installed. In this environment, design_crispr_knockout_guides appears in some inventories but is NOT in the installed biomni.tool package — there is no native sgRNA guide-design tool. Source guides from the published library / an Addgene KO library / a validated published set, and use compare_knockout_cas_systems() to guide KO strategy.
Biomni resources this skill uses
LiteratureSearch — confirm the screen's experimental design, ground the report Introduction/Background, and corroborate each top hit's known T-cell role. Use this for all literature actions (never assert citations from memory).
Direct environment checks — import documented functions and check packages/CLIs.
DepMap — broad-essentiality cross-check for screen hits.
biomni.tool.integrations — search_plasmids, get_plasmid_with_sequences, get_addgene_sequence_files for Addgene-deposited CAR plasmids/parts.
biomni.tool.molecular_biology — fetch_gene_coding_sequence (NCBI CDS), compare_knockout_cas_systems, get_lentivirus_production_protocol, get_facs_sorting_protocol for design parts and wet-lab handoff.
Packages — GEOparse (GEO metadata/SRA linkage), pandas/numpy, Biopython (GenBank), mageck CLI (screen stats), reportlab+pypdf (report). gseapy is optional (uv pip install gseapy) for pathway corroboration.
pdf-report-generation skill — load it for the final PDF (styling + build).
External fallback (no native equivalent): sra-tools for FASTQ download.
When to use this skill
"Design a CD19 (or other target) CAR construct" — especially when both a 4-1BB and a CD28 version are wanted, or GenBank/codon-optimized DNA is required.
"Reanalyze / run MAGeCK on a T-cell CRISPR screen" (Shifrut SLICE, GSE119450, or any CFSE/fitness proliferation screen) and nominate editing targets.
Any task that wants a receptor and an essentiality-filtered menu of KO targets.
Especially when the screen's guide-to-gene library table is paywalled or missing — the read-driven reconstruction below recovers it from the reads.
Critical decision points (ask the user if unclear)
Antigen / scFv source: which target, and from which validated source? Always take the scFv from an experimentally-validated reference (Addgene deposit, a PDB structure, or a published clinical sequence), never a reconstruction. For FMC63, PDB 7URV chain D is the validated scFv. (Native sourcing order in references/car_design.md.)
Costimulatory domain: 4-1BB (BBz, tisagenlecleucel-style, slow/persistent) vs. CD28 (28z, axicabtagene-style, fast/intense). Default to building BOTH.
Screen contrast: confirm from the paper via LiteratureSearch. For a CFSE proliferation screen, treatment = CFSE-low (dividing, "Div"), control = CFSE-high (non-dividing, "NonDiv"); guides enriched in Div → knockout ENHANCES proliferation (brake). Wrong direction silently inverts every hit.
Normalization: use non-targeting controls (NTCs) for MAGeCK size-factor and null-model estimation when present (--control-sgrna + --norm-method control); always add a median-norm sensitivity run.
Hit-validation reference: default = DepMap broad essentiality (flags genes that deplete in almost any cell). Ask whether the user prefers an alternative — a lineage-restricted DepMap subset, a published primary-T-cell screen, or pathway enrichment. Proceed with DepMap only if unspecified. (references/hit_validation.md.)
Part 1 — CRISPR screen reanalysis + hit validation

Full detail: references/screen_reanalysis.md, references/hit_validation.md, references/read_driven_library_reconstruction.md. Helper scripts: scripts/reconstruct_library.py, scripts/run_mageck.sh, scripts/depmap_crosscheck.py.

Confirm design with LiteratureSearch (phenotype, treatment fraction, donor structure, library). Cite in the report.
Get data (native-first). Resolve series/samples/SRA linkage with GEOparse (GEOparse.get_GEO("GSE119450")); download raw FASTQ with sra-tools (prefetch/fasterq-dump) — the one unavoidable external fallback. Map SRR→sample from the GEOparse metadata.
Inspect read structure first (zcat file | head). Pooled-screen reads are short (~50 bp) with a constant vector anchor flanking the 20-nt spacer — do NOT assume the spacer is at position 0.
Reconstruct the library from reads if the guide table is missing/paywalled (the novel technique — references/read_driven_library_reconstruction.md): find the anchor, extract the 20-nt spacer, reverse-complement to match the reference (e.g., Brunello), keep genes with enough guides observed, recover NTCs as top non-library spacers (U6 G-start signature).
Write the MAGeCK library file: CSV sgRNA,sequence,gene, NO header.
Run MAGeCK (scripts/run_mageck.sh): mageck count (auto-detect guide length for bare-spacer reads) then mageck test (treatment vs control, NTCs via --control-sgrna, --norm-method control) + a --norm-method median sensitivity run.
QC: mapping rate (~70-80% typical; Shifrut ~76%), zero-count guides (few), Gini index (< ~0.1 = even library; Shifrut ~0.05), NTC centering (median LFC ~0).
Internal biology check: confirm known brakes enrich (CBLB, CD5, PTEN) and TCR-essential genes deplete (CD3D, LCP2, ITK).
Validate hits vs DepMap (scripts/depmap_crosscheck.py): read ONLY the queried gene columns (memory-safe) from the 430 MB matrix; report per-gene mean gene-effect + fraction of dependent lines; flag pan-essential genes. Interpret: a screen hit that is pan-essential in DepMap is a weaker CAR-T target; a hit that is NOT pan-essential (e.g., CD3D is essential in the T-cell screen but not pan-essential in cancer lines) is context-specific. Caveat: DepMap lines are cancer cell lines, not primary T cells — use only to flag broad essentiality.
Interpreting hits
Positive selection (enriched in Div, pos|*) = knockout ENHANCES proliferation = a brake. Actionable KO candidates: CBLB, CD5, PTEN (and, in genome-wide screens, RASA2, SOCS1, TCEB2/ELOB).
Negative selection (depleted in Div, neg|*) = knockout IMPAIRS proliferation = essential/effector (CD3D, LCP2, ITK) — the boundaries of safe editing; do not knock these out.
gene_summary note: pos|lfc == neg|lfc = the gene-median LFC.
Part 2 — CAR design workflow

Full detail: references/car_design.md. Helper: scripts/design_car.py (assembles protein + codon-optimized ORF + lentiviral cassette GenBank for BBz and 28z given an scFv).

Obtain the scFv (native-first): search Addgene (search_plasmids(genes=<antigen>) → get_plasmid_with_sequences / get_addgene_sequence_files) and/or fetch the validated structure from RCSB PDB (FMC63 = 7URV chain D). Arrange as VL-(G4S)3 linker-VH.
Assemble the ORF: CD8a signal + scFv + hinge + TM + costim + CD3z. CD8a hinge/TM for BBz; CD28 hinge/TM for 28z. Canonical human domain sequences in references/car_design.md; use fetch_gene_coding_sequence for gene-level CDS when needed.
Codon-optimize the ORF for Homo sapiens (keeps Kozak + stop; verify the translation is identical to the intended protein).
Build the transfer cassette: EFS promoter + Kozak + CAR ORF + WPRE.
Emit per construct: protein FASTA, codon-optimized ORF FASTA, CAR-ORF GenBank, full-cassette GenBank, domain-boundary table, scaled architecture figure.
Wet-lab handoff (native): get_lentivirus_production_protocol(), get_facs_sorting_protocol(), compare_knockout_cas_systems() for the validation plan.
Final deliverable (required): Phylo-branded PDF with a summary infographic

Full spec: references/reporting.md. Load the pdf-report-generation skill and build ONE PDF that:

Opens with a data-driven summary infographic (scripts/build_infographic.py, a ReportLab Drawing of KPI cards + diverging hit-ranking bars). It visualizes only verified, computed numbers. This is a data plot — do not use GenerateImage for it (reserve GenerateImage for an optional conceptual MOA cartoon in the background section).
Then includes, in order: Introduction/Background (cited via LiteratureSearch), Methods (tool-attributed), Results (CAR design figures/tables + screen QC/hits + the DepMap cross-check table), Conclusions, Figures, References (inline [N]; no hand-written bibliography), Next steps (wet-lab validation path), and Limitations.
Validate before finishing: pypdf page/text check + direct visual inspection with Read on the infographic and each figure page; fix blanks/clipping/ overlaps and re-check. Save to /mnt/results/report_<task>.pdf.
Honest limitations to state in any report
A targeted pilot sub-library is discovery-grade, not genome-wide.
Few donors (e.g., n=2) → underpowered for stringent genome-wide FDR; often only the single strongest hit clears FDR<0.05. Report other hits as ranked nominations backed by effect size + cross-donor concordance.
A read-driven / reference-subsetted library is a transparent reconstruction, not the original supplementary table; it may differ at the margins.
DepMap cross-check uses cancer cell lines, not primary T cells — it flags broad essentiality only; it does not confirm T-cell-specific biology.
There is no native guide-design tool here; guides must come from the library/ Addgene/a published set.
CAR constructs assembled from canonical domains are computational designs requiring experimental validation (expression, cytotoxicity, in vivo potency).
Deliverables checklist
Screen: reconstructed sgRNA library, MAGeCK count matrix (raw + normalized), count summary, gene + sgRNA summaries, positive/negative hit tables, DepMap cross-check table, QC + volcano + top-hits figures.
Per CAR: protein FASTA, codon-optimized ORF FASTA, CAR-ORF .gb, cassette .gb, domain table, architecture figure.
Report: one Phylo-branded PDF opening with the summary infographic and containing intro, methods, results, conclusions, figures, references, next steps, and limitations.
Reference files
references/screen_reanalysis.md — MAGeCK commands, QC thresholds, contrast setup, native retrieval.
references/read_driven_library_reconstruction.md — the paywall-circumventing technique (most novel part).
references/hit_validation.md — DepMap cross-check (default) + alternatives, with caveats.
references/car_design.md — native-first part sourcing, domain sequence catalog, scFv provenance, cassette layout.
references/reporting.md — Phylo PDF structure + summary-infographic spec + validation.
scripts/reconstruct_library.py — anchor-based spacer extraction + reference matching + NTC recovery.
scripts/run_mageck.sh — count + test + sensitivity commands.
scripts/depmap_crosscheck.py — memory-safe DepMap broad-essentiality cross-check for hits.
scripts/design_car.py — CAR assembly + codon optimization + GenBank writer.
scripts/build_infographic.py — data-driven ReportLab summary-infographic panel for the report.

12. cell-therapy-qc-scorecard
Category: TRANSCRIPTOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

13. chembl-hit-series-sar-docking
Category: DRUG DISCOVERY
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

14. chip-atlas-diff-analysis
Category: EPIGENOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

15. chip-atlas-peak-enrichment
Category: EPIGENOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

16. chip-atlas-target-genes
Category: EPIGENOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

ChIP-Atlas Target Genes

Find target genes for any transcription factor using pre-computed ChIP-Atlas public ChIP-seq data.

When to Use This Skill

Use ChIP-Atlas target genes when you need to:

Identify target genes of a specific TF from all public ChIP-seq experiments
Rank potential targets by MACS2 binding score across hundreds of experiments
Compare TF binding across cell types using per-experiment binding scores
Validate known TF-target relationships with independent ChIP-seq evidence
Cross-reference with STRING protein interaction data for high-confidence targets

Don't use for:

Finding which TFs bind near your genes (use chip-atlas-peak-enrichment instead)
Histone mark targets (only non-histone antigens/TFs available)
Offline analysis (requires internet for data download)
Raw ChIP-seq analysis from FASTQ/BAM files

Key Concept: Downloads pre-computed TSV files containing MACS2 binding scores for every gene, across all public ChIP-seq experiments for the specified protein. Genes are ranked by average binding score. No API job submission needed — data is served as static files. STRING protein interaction scores are pre-embedded columns in the ChIP-Atlas TSV — no separate STRING API query is performed.

Installation
Software    Version    License    Commercial Use    Installation
pandas    >=1.3    BSD-3-Clause    Permitted    pip install pandas
requests    >=2.25    Apache-2.0    Permitted    pip install requests
numpy    >=1.20    BSD-3-Clause    Permitted    pip install numpy
plotnine    >=0.12    MIT    Permitted    pip install plotnine
plotnine_prism    >=0.1    MIT    Permitted    pip install plotnine_prism
matplotlib    >=3.4    PSF-based    Permitted    pip install matplotlib
seaborn    >=0.12    BSD-3-Clause    Permitted    pip install seaborn
pip install pandas requests numpy plotnine plotnine_prism matplotlib seaborn

System requirements: Internet connection (downloads from ChIP-Atlas data server)

Inputs

Query parameters:

Protein/TF name: Case-sensitive gene symbol (e.g., "TP53", "CTCF", "MYC")
Genome: hg38 (default), hg19, mm10, mm9, rn6, dm6, dm3, ce11, ce10, sacCer3
Distance from TSS: 1kb, 5kb (default), or 10kb

Optional filters:

min_score: Minimum average MACS2 binding score (default: 0)
top_n: Keep top N genes (default: 500)
cell_types: List of cell types to subset (recalculates averages)
min_string_score: Minimum STRING interaction score
min_binding_rate: Minimum fraction of experiments with binding
Outputs

Analysis objects (Pickle):

analysis_object.pkl - Complete results for downstream use
Load with: import pickle; obj = pickle.load(open('analysis_object.pkl', 'rb'))
Contains: target_genes, experiment_data, cell_types, protein, parameters, metadata

Results (CSV):

target_genes_all.csv - All target genes (gene, avg_score, string_score, binding_rate, num_bound, max_score, colocated_group)
target_genes_top50.csv - Top 50 by average binding score
target_genes_with_string.csv - Genes with STRING interaction evidence
experiment_scores_top50.csv - Wide-format per-experiment scores for top 50

Visualizations (PNG + SVG, packaged plotting scripts):

target_genes_top_targets.png/.svg - Top target genes barplot
target_genes_score_distribution.png/.svg - Binding score distribution histogram
target_genes_heatmap.png/.svg - Binding heatmap (top genes × experiments)
target_genes_string_vs_binding.png/.svg - STRING vs binding scatter

Reports:

summary_report.md - Human-readable analysis summary
Report Packaging

Generate a PDF report using pdf-report-generation unless otherwise specified, with the available scientific outputs, generated figures, and relevant references. The workflow is not complete until the report is generated.

Clarification Questions

🚨 ALWAYS ask Question 1 FIRST. Do not ask about species, genome, or analysis parameters before the user has answered Question 1.

1. Query (ASK THIS FIRST):
Which transcription factor / protein do you want to find target genes for?
Protein name is case-sensitive (e.g., "TP53" not "tp53")
Or use example data? tp53 (large, ~16K genes), e2f1 (cell cycle), myc (moderate)

🚨 IF EXAMPLE DATA SELECTED: All parameters are pre-defined (human hg38, ±5kb TSS, all cell types, no score threshold). DO NOT ask question 2. Proceed directly to Step 1.

Question 2 is ONLY for users providing their own query:

2. Analysis parameters:
Species/genome? Human hg38 (default), hg19, mouse mm10/mm9, rat rn6, fly, worm, yeast
Distance from TSS? ±5kb (default), ±1kb (proximal only), ±10kb (distal included)
Cell type filter? All cell types (default), or specific types to get cell-type-specific rankings
Score threshold? No minimum (default), or set min_score to focus on strong targets
Standard Workflow

🚨 MANDATORY: USE SCRIPTS EXACTLY AS SHOWN - DO NOT WRITE INLINE CODE 🚨

Step 1 - Load query:

# Option 1: Example query
from scripts.load_example_query import load_example_query
query = load_example_query("tp53")

# Option 2: Your own protein
# from scripts.load_user_query import load_user_query
# query = load_user_query("TP53", genome="hg38", distance=5)

VERIFICATION: "✓ Query loaded: TP53 target genes (hg38, ±5kb)"

Step 2 - Run target genes analysis:

from scripts.run_target_genes_workflow import run_target_genes_workflow

results = run_target_genes_workflow(
    protein=query['protein'],
    genome=query['genome'],
    distance=query['distance'],
    top_n=500,
    output_dir="target_genes_results"
)

DO NOT write inline download/parsing code. Just use the script.

VERIFICATION: "✓ Target genes analysis completed successfully!"

Step 3 - Generate visualizations:

from scripts.generate_all_plots import generate_all_plots
generate_all_plots(results, output_dir="target_genes_results", top_n=25)

DO NOT write inline plotting code. The script handles PNG + SVG with graceful fallback.

VERIFICATION: "✓ All visualizations generated successfully!"

Step 4 - Export results:

from scripts.export_all import export_all
export_all(results, output_dir="target_genes_results")

DO NOT write custom export code. Use export_all().

VERIFICATION: "=== Export Complete ==="

⚠️ CRITICAL - DO NOT:

❌ Write inline download/parsing code → STOP: Use run_target_genes_workflow()
❌ Write inline plotting code → STOP: Use generate_all_plots()
❌ Write custom export code → STOP: Use export_all()

⚠️ IF SCRIPTS FAIL - Script Failure Hierarchy:

Fix and Retry (90%) - Install missing package, check internet, re-run
Modify Script (5%) - Edit the script file itself, document changes
Use as Reference (4%) - Read script, adapt approach, cite source
Write from Scratch (1%) - Only if genuinely impossible, explain why

NEVER skip directly to writing inline code without trying the script first.

Common Issues
Error    Cause    Solution
HTTP 404 for protein    Invalid or unavailable antigen    Check case sensitivity ("TP53" not "tp53"). Histone marks not available. See references/target_genes_data_format.md.
Download timeout    Large file or slow connection    TP53 is ~13MB; allow up to 2 minutes. Try smaller TF first (e.g., MYC).
Memory error on large file    Very wide TSV (100s of columns)    Use top_n parameter to limit genes. Cell-type filter reduces columns.
No STRING data (all zeros)    Protein not in STRING database    Normal for less-studied TFs. Binding scores still valid without STRING.
Empty results after filtering    Filters too strict    Lower min_score, remove cell_type filter, increase top_n.
SVG export error    Missing optional dependency    Normal - generate_all_plots() handles fallback. PNG always created.
Interpretation Guidelines

Average Binding Score (MACS2): −10 × log10(Q-value). Higher = stronger binding evidence.

≥500: Very strong binding (Q ≤ 1e-50) — high-confidence direct target
100-500: Strong binding — likely direct target
50-100: Moderate binding — possible target, may be cell-type-specific
<50: Weak binding — marginal evidence

Note: The Q-value thresholds above apply to individual experiment scores. Average scores include zeros from non-binding experiments, so an average of 500 reflects a consensus level — not that every experiment shows Q ≤ 1e-50.

Binding Rate: Fraction of experiments with any binding, shown as % with n/N count (e.g., "66.3% (260/392)"). >50% = consistent across cell types; <10% = cell-type-specific.

STRING Score: Independent evidence of regulatory interaction. >400 = medium confidence; >700 = high confidence. Genes with BOTH high binding + high STRING = highest-confidence targets. STRING score of 0 does NOT mean "not a target" — even well-characterized targets (e.g., BBC3/PUMA for TP53) can have STRING score 0 due to gaps in STRING coverage.

Caveats:

Averaging includes zeros: Average scores are computed across ALL experiments (including those with score 0). Use max_score and binding_rate for complementary views.
Cell-type bias: Experiments are unevenly distributed — a few well-studied cell lines dominate. See the "Experiment Composition" section in summary_report.md for exact distribution.
Co-located genes: Some genes share identical binding scores because they sit at the same genomic locus within the TSS window. The colocated_group column in the CSV flags these genes. For pathway enrichment, consider collapsing co-located groups to avoid double-counting loci. See summary_report.md Caveats for exact counts.
External annotations: ChIP-Atlas provides binding data only. Any biological role descriptions in the agent's summary are from general knowledge, not from this analysis output. Always cite the actual data columns (avg_score, binding_rate, string_score) when reporting results.
Reporting Results

🚨 CRITICAL: Follow these rules when presenting results to the user.

Rankings MUST come from the data files. Read summary_report.md or target_genes_all.csv for exact gene names, ranks, and scores. NEVER construct ranking tables from general biological knowledge — even if a gene is a well-known target, its rank must match the data.
Do NOT substitute biologically famous genes into top-N lists where the data ranks them lower. If a well-known target is not in the top 10, say so explicitly (e.g., "BAX, a well-characterized target, ranks #17 with avg_score 368.8").
Use exact values from the CSV/report (1 decimal place for scores, 1 decimal for percentages). Do not round to integers.
Cite the data source as: ChIP-Atlas (Zou et al., 2024) with the DOI from the References section.
Mention co-located gene groups if the summary report flags them — they affect the effective number of independent targets.
Label biological annotations: When describing gene functions or pathway roles, explicitly note these come from general knowledge (e.g., "CDKN1A — known cell cycle arrest effector — ranks #1"), not from ChIP-Atlas output.
Suggested Next Steps
Run peak enrichment with top target genes to find co-regulatory factors (chip-atlas-peak-enrichment)
Cell-type-specific analysis — re-run with cell_types filter matching your experimental system
Gene regulatory network construction using top targets as nodes
Functional enrichment of top target genes (GO, pathway analysis)
Related Skills
chip-atlas-peak-enrichment - Find enriched TFs near YOUR gene list (reverse query)
gene-correlation-archs4 - Co-expression across 600K RNA-seq samples
grn-pyscenic - Gene regulatory networks from single-cell data
References
Zou et al. (2024). ChIP-Atlas 3.0: a data-mining suite to explore chromosome architecture. Nucleic Acids Research. doi:10.1093/nar/gkad884
Zou et al. (2022). ChIP-Atlas 2021 update. Nucleic Acids Research. doi:10.1093/nar/gkab933
Oki et al. (2018). ChIP-Atlas: a data-mining suite. EMBO Reports 19(12):e46255. doi:10.15252/embr.201846255
ChIP-Atlas: https://chip-atlas.org
Target Genes documentation: See references/target_genes_data_format.md
MACS2 binding scores: See references/macs2_binding_scores.md
STRING integration: See references/string_scores.md

17. clinical-trial-design-simulation
Category: EXPERIMENTAL DESIGN
Source: https://biomni.phylo.bio/skills?section=marketplace

Clinical Trial Design & Simulation
Scope

Simulate and evaluate two-arm confirmatory trial designs (one primary endpoint) end-to-end: it powers designs, computes operating characteristics under user-specified effect scenarios, enforces two validation gates (type-I/FWER control and agreement with the rpact analytic benchmark), and renders a Phylo-branded PDF. It does NOT analyze completed-trial data, compute a final p-value for real patients, or handle multi-arm/platform, Bayesian, dose-finding, or basket/umbrella designs (see references/caveats.md).

Inputs
A JSON config (see references/config_schema.md and the three runnable examples in scripts/config_examples/). It specifies the endpoint, design and adaptation parameters, the effect scenarios to evaluate, the validation grids, runtime preset, and the report narrative/branding.
No patient data. Everything is generated from the config's assumptions (control-arm parameters, treatment effects per biomarker subgroup, prevalence, accrual, dropout).
Analysis population & internal consistency (define once, use everywhere)

The design's structure is defined once in the config, and the tables, figures, and report prose are derived from those same values so they cannot drift apart:

Analysis hypotheses are set by prevalence. prevalence = 1.0 (or allow_enrich = false) ⇒ a single full-population hypothesis H_F: the report/figures show one power series ("Power") and a "Type-I rate", and never mention a biomarker subgroup, H_S, "any", enrichment, or a closed test. prevalence < 1 with allow_enrich = true ⇒ the {H_F, H_S} closed test, and the report shows both hypotheses plus enrichment. You do not restate the subgroup anywhere else; it follows from prevalence. (An explicit design.single_hypothesis boolean overrides the inference if ever needed.)
Operating parameters are reported from the config actually simulated. The Methods text derives the interim timing from info_frac (one interim at that information fraction, else a single final look) and states the exact dropout_rate used — it never hard-codes timing or dropout that could disagree with the simulation.
The target effect size is specified once. Give the effect label in report.effect_label (authoritative). If design.effect_label is also present and disagrees, the report build fails loudly so the ambiguity is fixed at the source rather than showing two different effects. The infographic's power/E[N] cards are read from the headline_scenario row, so keep that scenario consistent with the effect label.
Outputs (saved under an output dir; copy user-facing files to results)
tables/gate_fwer.csv, tables/gate_power.csv — the two validation gates.
tables/operating_characteristics.csv — power (full-population H_F; plus the subgroup H_S and "any" only when the design uses a biomarker subgroup), expected N, expected duration, and adaptation probabilities per scenario, with Monte-Carlo SE.
tables/sensitivity_analysis.csv — one-parameter sweep (optional).
figures/*.png + *.svg — power-by-scenario, expected N/duration, adaptation probabilities, and sensitivity figures (Okabe-Ito, editable SVG).
report.pdf — Phylo-branded report: at-a-glance infographic, introduction, methods, results (validation + OC + figures), conclusions, references, next steps.
Environment
R with rpact (boundaries + analytic benchmark), survival, data.table, ggplot2, svglite, jsonlite. Python with reportlab + pypdf for the PDF.
Statistical details are in references/design_methods.md; the validation philosophy in references/validation_guide.md.
Workflow

The fastest path is the turnkey driver — one config in, validated tables + figures out, then render the PDF.

cd scripts
# 1. Validate + simulate everything from a config (quick = iterate; thorough = quote)
Rscript run_pipeline.R config_examples/nsclc_egfr_enrichment.json /workspace/run1 quick
# -> runs BOTH gates (halts if a gate fails), then OC grid + sensitivity + figures.
# 2. Render the Phylo PDF (command is printed at the end of step 1)
python3 build_report.py --config config_examples/nsclc_egfr_enrichment.json \
    --tables /workspace/run1/tables --figures /workspace/run1/figures \
    --out /mnt/results/<name>/report.pdf
Step-by-step (what each step is for, and why it matters)
Write/adapt the config. Start from the closest example. Set the endpoint, control-arm assumptions, the target effect(s) per biomarker subgroup (hr_pos/hr_neg, p_trt_*, mean_trt_*/delta_*), prevalence, and which adaptations to enable. Prevalence 1.0 ⇒ a single full-population hypothesis.
Run the validation gates FIRST (enforced). run_pipeline.R runs gate_fwer (FWER ≤ alpha under the global + least-favorable nulls) and gate_power_vs_rpact (simulated power matches rpact for the reduced, single-hypothesis design). If either fails, stop and fix the design — do not report operating characteristics from an unvalidated design. This is the step that makes the numbers trustworthy, and the step that catches bugs in any new adaptation logic.
Compute operating characteristics. The grid simulates every effect scenario (always include a null) and reports power for the full population, the biomarker+ subgroup, and either, plus expected N/duration and the probability of each adaptive decision (enrichment, futility, early efficacy, SSR).
Sensitivity analysis. Sweep the one or two assumptions you are least sure about (prevalence, control rate, effect size, SSR target) — design conclusions should be robust to these, and reviewers will ask.
Render the PDF. build_report.py turns the tables + figures + config narrative into a self-contained report with an infographic and the standard sections. It re-checks page count and text before declaring success.
Iterate on quick (nsim = 1000), finalize on thorough (nsim = 10000). Every reported proportion has Monte-Carlo SE sqrt(p(1-p)/nsim); quote numbers only from a thorough run.
Using the pieces directly (R)
source("scripts/validate_design.R"); source("scripts/run_grid.R")
gate_fwer(base_null_scenario, null_variants = list(...), nsim = 10000)   # -> list(table,pass,worst)
gate_power_vs_rpact("tte", median_ctrl = 18.9, hr_grid = c(.60,.65,.70)) # -> list(table,pass,worst)
run_grid(base, scenarios, preset = "thorough")                          # OC table
Statistical caveats (read before quoting results)
Assumptions in, operating characteristics out. Results are only as valid as the config's assumptions; always state them and show sensitivity.
Type-I error is verified by simulation, not proven — choose least-favorable nulls deliberately (prevalence extremes for enrichment designs).
TTE designs are event-driven. Power depends on reaching the target events; the validation harness uses a large subject pool with no administrative cap so the simulated and rpact designs refer to the same trial. A finite follow-up cap that prevents reaching the events causes a spurious power shortfall (a sizing artifact, not a bug) — see references/validation_guide.md.
Adaptations (enrichment, SSR) preserve alpha only through the fixed-weight inverse-normal combination. The allow_ssr path is new code; Gate 1 is where its FWER is confirmed for your specific design.
Parametric generators (exponential/Weibull, Bernoulli, normal); no non-proportional hazards, over-dispersion, or informative dropout. Asymptotic tests degrade at very small information. Full list in references/caveats.md.
Reference files
references/design_methods.md — endpoint score/information map, combination test, boundaries, closed testing, enrichment, futility, SSR formulas.
references/validation_guide.md — the two gates, tolerances, and troubleshooting.
references/config_schema.md — every config field with defaults.
references/caveats.md — assumptions, scope limits, interpretation guidance.
scripts/config_examples/ — nsclc_egfr_enrichment.json (TTE + enrichment), binary_response_gs.json (binary + group-sequential + futility), continuous_ssr.json (continuous + sample-size re-estimation).

18. clinical-variant-allelic-series
Category: GENOMICS & GENETICS
Source: https://biomni.phylo.bio/skills?section=marketplace

Clinical Variant Allelic Series

Turn a single human gene symbol into an integrated, position-resolved catalogue of every clinically observed variant, annotated with germline/somatic significance and curated therapy evidence, tiered by actionability, and packaged as figures + a PDF report.

This skill was validated end-to-end on BRAF (rich actionability, single hotspot cluster), KIT (two separated hotspots, multi-domain receptor), and STK11 (sparse tumor suppressor), plus a zero-CIViC degradation test.

Scope

Does: For one human gene, fetch the full ClinVar record set and CIViC curated evidence, reconcile them into one allele table keyed by residue position, assign an actionability tier + mechanism to each allele, generate adaptive figures, and build a config-driven PDF.

Does NOT: call variants from sequencing data; interpret a patient's specific genotype; replace guideline-based clinical interpretation (AMP/ASCO/CAP, ACMG); compute functional class de novo; or cover non-human genes (identifier resolution is human-only, organism_id:9606).

Inputs
Required: one HGNC gene symbol (e.g. EGFR, BRAF, KIT). That's it.
Optional: NCBI email + API key (raises E-utilities rate limit from 3 to 10 req/s; pass --email/--api-key or set NCBI_EMAIL/NCBI_API_KEY); a UniProt accession override for make_figures.py (--uniprot, useful when a symbol is ambiguous).
For the report: a report_config.json that the agent assembles (see Step 5). The agent writes the narrative and grounds key claims with LiteratureSearch.
Outputs (written to --outdir)
File    Content
<GENE>_clinvar_full_catalog.csv    Every ClinVar record: variation ID, protein change, molecular consequence, classifications, conditions
<GENE>_clinvar_summary.json    Counts by classification/consequence
<GENE>_civic_variants.csv    CIViC variants for the gene (with clinvar_ids bridge)
<GENE>_civic_evidence_long.csv    One row per CIViC evidence item (single-variant flagged)
<GENE>_allelic_series_master.csv    The core deliverable — one row per allele, joined, positioned, tiered
<GENE>_summary_stats.json    Allele counts, tier counts, join-method breakdown, position-discrepancy check
figures/F1_lollipop.{png,svg}    Protein-domain lollipop (adaptive single- or two-panel)
figures/F2_landscape.{png,svg}    Actionability landscape (tiers × mechanism)
figures/F3_evidence.{png,svg}    CIViC evidence distribution — skipped if no CIViC evidence
figures/F4_therapy_matrix.{png,svg}    Allele × therapy matrix — skipped if no predictive evidence
figures/figures_manifest.json    Which figures were produced + UniProt metadata
report_<GENE>_allelic_series.pdf    Phylo-styled PDF (validated: >=3 pages, extractable text)
Quick start

Run the five scripts in order (all live in scripts/). Use a persistent --outdir (prefer /mnt/shared-workspace/<run> for intermediates; copy final deliverables to /mnt/results/). ClinVar fetch time scales with record count (~300 records/batch, ~0.3 s/batch without an API key): EGFR ~4k, BRAF ~1.6k, KIT/STK11 ~3k records.

GENE=BRAF
OUT=/mnt/shared-workspace/allelic_${GENE}
python scripts/fetch_clinvar.py       --gene $GENE --outdir $OUT
python scripts/fetch_civic.py         --gene $GENE --outdir $OUT
python scripts/build_allelic_series.py --gene $GENE --outdir $OUT
python scripts/make_figures.py        --gene $GENE --outdir $OUT
# assemble $OUT/report_config.json (see Step 5), then:
python scripts/build_report.py        --gene $GENE --outdir $OUT --config $OUT/report_config.json

Before starting, verify the documented variant-annotation helpers by importing them, and use LiteratureSearch to ground the gene's biology (functional classes, key alleles, targeted therapies) for the report narrative.

Workflow steps (and why each matters)

Fetch ClinVar (fetch_clinvar.py). esearch on db=clinvar with term=<GENE>[gene] and retmax=100000 to get all UIDs, then batched esummary (XML v2.0). Captures the ClinVar Variation ID = the uid (this is the join key to CIViC), protein change, molecular consequence, and the new ClinVar classification schema (germline_classification, oncogenicity_classification, clinical_impact_classification). Why: ClinVar is the comprehensive record of observed variants and their asserted significance; the new tripartite schema separates germline pathogenicity from somatic oncogenicity, which matters for correct mechanism labels.

Fetch CIViC (fetch_civic.py). Downloads the three nightly TSV exports (Variant, MolecularProfile, ClinicalEvidence; cached 24 h) and joins Variant→MolecularProfile→Evidence. Keeps single-variant molecular profiles as the primary evidence set; multi-variant (complex) profiles are tabulated separately. Why: CIViC is the expert-curated layer of clinical meaning (therapy response, prognosis, diagnosis) that ClinVar lacks; single-variant profiles are the ones that map cleanly onto individual alleles.

Build the allelic series (build_allelic_series.py). Reconciles ClinVar and CIViC by four keys (Variation ID; normalized protein change; both; categorical descriptors like "exon 19 deletion"), derives residue positions, assigns tiers + mechanism, and asserts zero position discrepancies. Why: this is where the two sources become one queryable table; the position-consistency assertion is the main correctness guardrail.

Make figures (make_figures.py). Resolves the gene to its reviewed human UniProt entry (accession, length, domains), then renders adaptive figures. The lollipop auto-detects whether notable alleles are concentrated (→ two-panel overview+zoom) or spread (→ single panel), and F3/F4 self-skip when the underlying evidence is absent. Why: the domain context and hotspot structure are the biological story; adaptivity keeps it readable for both hotspot-driven oncogenes and diffusely-mutated tumor suppressors.

Assemble config + build report (build_report.py). The agent writes report_config.json — title, executive summary, introduction, methods, results blocks (each optionally referencing a figure by filename), a key_allele_table, conclusions, limitations, next_steps, and references. Ground the narrative and the references with LiteratureSearch (do not invent citations). Optionally generate a front-page infographic with GenerateImage. build_report.py renders a Phylo-styled PDF and self-validates. Why: the report is the human-readable deliverable; grounding + validation keep it trustworthy. This step leverages the pdf-report-generation skill's patterns.

Database reference
Source    Endpoint    Key identifiers    Notes
ClinVar    NCBI E-utilities (esearch/esummary, db=clinvar)    Variation ID (uid), accession VCV…    retmax=100000; batch esummary 300; rate limit 3/s (10/s with API key)
CIViC    Nightly TSV exports (civicdb.org/downloads/nightly/…)    variant_id, molecular_profile_id, clinvar_ids    clinvar_ids = ClinVar Variation IDs = the bridge to ClinVar uid
UniProt    REST (/uniprotkb/search, /uniprotkb/{acc}.json)    primary accession    human-only (organism_id:9606, reviewed:true); domains for the lollipop track
Scientific caveats & hard-won lessons

These are baked into the scripts; do not "simplify" them away.

Residue position comes from the variant NAME, never a linked record. pos_from_name = first residue number after a letter in the HGVS protein change (start codon for both substitutions and range indels). Taking position from a linked ClinVar record produces silent mismatches; the build asserts 0 discrepancies.
ClinVar Variation ID = the uid (numeric part of VCV000666267 → 666267), not the measure_id. Using measure_id breaks the CIViC join.
molecular_consequence lives at the DocumentSummary level (molecular_consequence_list/string), not inside variation_set.
Top-level <protein_change> is comma-separated across transcripts — take the first token.
CSV round-trip pitfalls (both are real bugs that silently corrupt tiers):
Booleans become the strings "True"/"False" when read with dtype=str. Compare with the _as_bool() helper, never == True.
NaN becomes the truthy string "nan". Use the _s() safe-string helper in any truthiness test (tiering, mechanism inference), or everything collapses into Tier 1.
Evidence absence ≠ benign. CIViC coverage is deepest for recurrent hotspots; rare alleles are under-annotated. Tier 3 means "not evidenced here", not "safe".
Actionability is often lineage-dependent (e.g. BRAF V600E responds differently in melanoma vs. colorectal cancer). The series is tumor-type-agnostic; say so in the report.
Functional classes are literature-annotated, not computed. If you cite BRAF Class I/II/III or similar, ground it with LiteratureSearch.
Lollipop label density: notable alleles are capped (~22) and labels are thinned by a minimum gap and placed with a deterministic fan-out (evenly spaced label slots + leader lines) so hotspot clusters stay readable. adjustText (if used elsewhere) is v1.3.0 — use iter_lim/time_lim, not the old lim, and suppress its verbose stdout.
UniProt domains: prefer structural Domain/Transmembrane features over broad Region/Topological domain spans (the latter overlap and clutter the track); labels are collision-filtered.
PDF text must be ASCII. build_report.py runs ascii_clean(); never emit unicode sub/superscripts or smart quotes into the PDF.
Error handling / graceful degradation
Gene absent from CIViC → empty CIViC files → F3/F4 skip, build + report still succeed (Tier 1 will be 0). Verified.
UniProt resolution fails → figures fall back (no domain track / length inferred from data); pass --uniprot to override.
E-utilities transient failures → esummary retries 3× with backoff.
Always keep intermediates in a persistent path (/mnt/shared-workspace/…); sandbox /workspace is per-machine and is lost on machine restart.
Related skills / tools
pdf-report-generation — the PDF styling/validation patterns build_report.py follows.
LiteratureSearch — ground the report narrative and populate real references.
Python imports — verify documented in-environment variant-annotation helpers before use.
GenerateImage — optional front-page infographic (verify text with a media check).

19. clinicaltrials-landscape
Category: LITERATURE
Source: https://biomni.phylo.bio/skills?section=marketplace

Clinicaltrials Landscape
When to Use This Skill

Use this skill to map a bounded set of registered ClinicalTrials.gov records for a declared query (one or more conditions, plus optional intervention/status/phase/sponsor filters), classified by study purpose and record-grounded intervention type, with auditable coverage provenance.

Not for exhaustive target-development, asset, or company-pipeline inventories. If the request is an exhaustive asset/program inventory, route to a target-oriented capability (for example a target- or pipeline-inventory skill) and deliver only the bounded ClinicalTrials.gov component here. The scope_fit clarification question makes this explicit and returns not_computable for the out-of-scope branch.

Interpretation boundary

Classification is generic (no disease config ships); generic buckets are not a target-development taxonomy.

Inputs
One or more ClinicalTrials.gov condition terms (required).
Optional intervention term, status list, phase list, and sponsor term.
Alternatively, a compiled trials CSV for offline/deterministic classification.
For a simple PSMA-in-prostate-cancer prompt, use the bundled psma-prostate-cancer profile; it supplies the reviewed three-condition, 59-alias, all-14-status query without further questions.
Outputs
report_clinicaltrials-landscape.pdf — Generate the PDF report with pdf-report-generation by default. When the user explicitly selects a compatible report-styling skill, use that provider instead for presentation only; keep every report, evidence, artifact, infographic, and review requirement unchanged. Include a Biomni GenerateImage infographic when required, task context, methods or sources, results, conclusions, figures where applicable, references, and next steps
trials_all.csv — the compiled per-record dataset; one row per retrieved ClinicalTrials.gov record, including expanded-access records when selected (identity, sponsor, phase, study type, study_purpose, intervention_category, geography, enrollment).
trials_by_category.csv — intervention-category x phase counts; one row per intervention category, with explicit Not Applicable, Phase-applicable subtotal, and All retrieved denominator columns (no bare "Total").
trials_by_sponsor.csv — one row per lead sponsor: registered-record count, distinct categories, and industry/academic class (full sponsor names).
trials_match_evidence.csv — one row per registered record recording how it matched the declared query and which source fields were available (absent fields never implied present).
coverage_scope.json — the auditable coverage fingerprint (declared query, denominators, dataset SHA-256, coverage/limitation and record-versus-asset boundary statements) binding the report to the exported dataset.
figures/manifest.json — one entry per analysis step naming the figure file and its data-driven caption, or a recorded reason when a figure is not applicable.
report_facts.json — evidence-bearing claims, operational definitions, provenance, and validated denominator/completion partitions
report_spec.json — deterministic report section, wording, figure-order, and pagination contract derived from the exact report_facts.json bytes.

Write the report to the results root under the name above. Data tables, figures and intermediates go in data/, figures/, tables/. Note that GenerateImage strips directory components, so schematics always land at the root regardless of the path you pass it.

Clarification Questions

Resolve unambiguous requests without asking. A plain landscape/report request with no uploaded CSV uses scope_fit:bounded_landscape and data_source:live_api. Record those branch IDs and proceed. Ask only when the user explicitly requests exhaustive/global asset coverage, supplies a compiled table, or gives inputs that genuinely fit more than one branch.

Is this a bounded registered-record landscape for a disease/mechanism, or an exhaustive target/asset/company-pipeline inventory? (select one)
bounded_landscape — Bounded registered-record landscape (proceed); runtime branch ID scope_fit:bounded_landscape
exhaustive_inventory — Exhaustive asset/program inventory (out of scope; deliver only the bounded ClinicalTrials.gov component); runtime branch ID scope_fit:exhaustive_inventory
Query the live ClinicalTrials.gov API v2, or classify an existing compiled trials table? (select one)
live_api — Live ClinicalTrials.gov API v2 query (recommended for real use); runtime branch ID data_source:live_api
compiled_csv — An existing compiled trials CSV (offline / deterministic); runtime branch ID data_source:compiled_csv
Standard workflow

This is a general retrieval and synthesis workflow. Resolve scope and source first, execute the production helpers, then assemble and inspect a report. Do not replace it with an unattended file-in analysis contract.

Record the verbatim request, approved query conditions/filters, source choice and scope boundary in run_context.json. Use a fresh results directory for each run. Stop on out-of-scope requests, ambiguous conditions, partial pagination, or missing offline provenance; do not silently relax filters or assert completeness.
For a recognized PSMA-in-prostate-cancer prompt, run python3 "$SKILL_DIR/scripts/run_pipeline.py" --live --prompt "<verbatim user prompt>" --results-dir /mnt/results/<run>. Other live requests use --conditions and optional --intervention/--statuses. For offline input use --input <supplied.csv> --coverage <supplied-coverage.json>. The coverage JSON must supply conditions and statuses as nonempty arrays of nonblank strings; malformed values stop processing before data export. $SKILL_DIR is the mounted directory printed when the skill loads. Record the command, exit status and full logs outside the package.
The pipeline queries or loads, classifies study purpose and intervention category, compiles records, exports all tables and coverage provenance, creates analytical figures, validates accounting and writes report_facts.json and report_spec.json. Do not repeat these stages with independently reconstructed inputs. Failed retrieval or accounting blocks report claims.
scripts/landscape_evidence.py binds the facts to the source payload and nonblank, captioned figures, checking the production definitions in assets/fact_definitions.json. If report_spec.json has a stale facts_sha256, rerun the pipeline; never patch facts or the report specification by hand.
Follow the report assembly and final inspection instructions below. Keep runtime data, reports, logs, receipts and evidence outside the extracted package.

Retries are bounded and apply only to the same idempotent retrieval after transient failure. Disclose package defects or required changes to scope/method, and stop for the appropriate decision; a modified package or fresh task is not the original run.

Figures

One representative figure per result-producing step, showing this run's actual result — not a schematic, not an illustrative example. Every figure needs a caption stating what it shows. If a step genuinely has nothing to plot, replace its row with a one-line reason. A caption is required at run time, so fill these in before the first run.

Step    File    What it must make visible
1    figures/figure_1_study_composition.png    Study-purpose composition (Therapeutic / Diagnostic-Imaging / Observational / Other-Supportive / Unresolved) with per-bar counts over all retrieved records.
2    figures/figure_2_intervention_category.png    Record-grounded intervention-category distribution, including the count labeled Unclassified rather than assigned an invented modality.
3    figures/figure_3_phase_distribution.png    Phase distribution with Not Applicable shown explicitly; phase-applicable and all-retrieved denominators kept distinct.
4    figures/figure_4_category_by_phase.png    Intervention category x phase for the phase-applicable subset (Not Applicable records excluded by definition).
5    figures/figure_5_top_sponsors.png    Top lead sponsors by registered-record count with full (wrapped, non-truncated) names and industry vs academic/other class.
6    figures/figure_6_geography.png    Top countries by number of retrieved records with a site there (multi-site studies counted once per country).
7    figures/figure_7_enrollment.png    Registry-reported enrollment (actual or estimated; log scale) by study purpose for interventional trials with usable enrollment; registry mega-study outliers excluded.

The report reads this inventory from report_facts.json's figures array rather than restating it, so it cannot claim a figure that was never produced.

Report assembly and final inspection

The run is not complete until this step has produced report_clinicaltrials-landscape.pdf at the results root. Generate the PDF report with pdf-report-generation by default. When the user explicitly selects a compatible report-styling skill, use that provider instead for presentation only; keep every report, evidence, artifact, infographic, and review requirement unchanged. Include a Biomni GenerateImage infographic when required, task context, methods or sources, results, conclusions, figures where applicable, references, and next steps

When the user explicitly selects a compatible report-styling skill, use that provider for presentation only; keep every report, evidence, artifact, infographic, and review requirement unchanged.

Produce one combined PDF with a short narrative. Follow report_spec.json exactly: place the qualitative GenerateImage infographic on page 1 after Task Context as the first substantive visual and caption it as Figure 1; number any later analytical figures after it. Set keepWithNext=1 on protected heading styles. When a heading precedes a KeepTogether figure or callout, put the heading inside that same KeepTogether block because keepWithNext alone does not reliably cross the boundary. Keep every figure with its caption. Rendered page images are inspection evidence only, never substitutes for the PDF. End the task with a concise conclusion and links to the PDF and supporting artifacts, not a bare file listing.

Registered-record activity is not an asset-development pipeline. Quote record_asset_boundary_statement verbatim and keep phase/status conclusions at the record level. Never turn record counts into a pipeline, emerging/early-stage agents, unique assets, or development programs in the PDF or final answer. The post-render gate rejects those substitutions.

The PDF must use these visible top-level sections in this order, adapting their contents to this skill rather than adding generic filler:

Task Context — the research or practitioner question, supplied inputs, scope, and decision the output informs.
Methods & Sources — Methods & Sources covers data provenance, filtering, parameters, software, and the analysis design; Results reports validated quantitative findings and figures.
Results — the run's actual outputs and evidence, never a description of what the skill could do.
Conclusions & Interpretation — supported takeaways, their practical meaning, and appropriate next steps.
Limitations — run-specific uncertainty, missing coverage, failed or unavailable checks, and claims the evidence does not support.

Include references and a compact output-artifact table where applicable. Empty boilerplate does not satisfy a section.

Use report_spec.json as the assembly contract and report_facts.json as the sole quantitative report source. In both Methods & Sources and Results, quote match_evidence_availability_sentence verbatim instead of reconstructing field- availability counts from nested keys. The flat availability fields are also present for tables; treat any missing value, None, null, or NaN as a report-build failure. Escape literal artifact text before inserting it into XML/HTML-aware layout components (especially intervention aliases containing &), then confirm the extracted PDF text preserves the displayed query terms and contains no unresolved placeholders.

Quote sponsor_composition_sentence verbatim wherever sponsor class is summarized. n_industry and n_academic count records by lead-sponsor class, while n_sponsors counts unique lead sponsors; never label record counts as sponsor counts. An offline --input CSV must carry sponsor_class (registry lead-sponsor class) or is_industry; without either the pipeline stops rather than reporting an unknown split as "0 industry" records. After extracting the actual PDF text, run validate_report_output() before recording completion. It rejects unsupported strategic or commercial inference, record-to-asset/pipeline inference, sponsor-denominator mistakes, unresolved placeholders, corrupted ampersand aliases, missing canonical fact sentences, an infographic that is not Figure 1/the first substantive visual, registered-trial wording for a dataset containing expanded-access records, and effectively blank/orphaned PDF pages or headings stranded at a page bottom.

Generate infographic.png with Biomni GenerateImage before assembly. Retain the original tool-returned file and the actual task/tool reference in run_context.json; never fabricate transcript IDs or claim independently verified lineage from a filename. Keep unsupported interpretations out of the illustration as well as prose. The independent campaign reviewer checks the task trace and the delivered PDF.

Read the complete installed pdf-report-generation instructions and assets, or the compatible provider explicitly selected by the user. Record provider identity and the user message authorizing an override. Do not infer styling from customer, account or project context. Missing or conflicting provider instructions require clarification. Construct the PDF in a fresh local workspace path, close it, then copy the completed file to the results directory; do not truncate an existing PDF on the object-backed results mount.

Use landscape_evidence.prepare_report_review(results_dir) to render every PDF page and extract text from the final PDF. It returns the exact text and page paths to inspect; retain its snapshot. Actually inspect every rendered image at readable resolution, including figures, labels, captions, page breaks and the first-page infographic. Text extraction, pixel statistics and automated layout checks do not prove visual inspection. If images cannot be inspected, record fail with the reason. Repair and rerender visual defects before recording pass; limitations cannot turn a failed visual review into approval.

Run the domain checks using the actual extracted text and your truthful inspection record:

import os, sys
os.environ["BIOMNI_RESULTS"] = results_dir
sys.path.insert(0, f"{SKILL_DIR}/scripts")
from validate_report_output import validate_report_output
from landscape_evidence import write_report_review
checks = validate_report_output(
    extracted_text_file,
    review_attestation=review_attestation,
    review_verdict=review_verdict,
    review_performed=review_performed,
    review_issues=review_issues,
)
write_report_review(
    results_dir, report_file="report_clinicaltrials-landscape.pdf",
    text_file=extracted_text_file, rendered_page_files=rendered_page_files,
    reviewed_page_numbers=reviewed_page_numbers, checks=checks,
)

Set review_performed to the explicit boolean True only after actual image inspection, otherwise False; prose cannot authorize a pass. Supply actual paths and page numbers; never generate an affirmative attestation before inspection. report_review.json binds the PDF, extracted text, rendered pages, facts and report spec by hash. It distinguishes mechanical checks from the reviewer's attestation and refuses completion for incomplete page coverage or a failed review. These checks are not scientific acceptance.

Before the final answer, apply the same record-versus-asset and denominator restrictions to its prose. Deliver a concise supported conclusion with links to the PDF, tables, query provenance and review record. State unresolved limitations. Do not call the skill deployed or independently accepted based on completing this run.

References
Registry API parameters for query filters and pagination.
Classification rules for record-grounded purpose and modality labels.
Output schema for accounting, provenance and field availability.

Offline boundary requirements: is_industry, when supplied, must contain boolean True/False values (CSV boolean columns are accepted); use sponsor_class for registry labels rather than Y/N or INDUSTRY/OTHER flag strings. Coverage phases must be an array of nonblank strings; use [] for no phase filter.

20. coexpression-network
Category: TRANSCRIPTOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

Weighted Gene Co-expression Network Analysis (WGCNA)
Overview

Build weighted gene co-expression networks to identify modules of coordinately expressed genes and discover hub genes that may be key regulators. This workflow uses WGCNA (Weighted Gene Co-expression Network Analysis) to group genes into modules based on their expression patterns across samples, then correlates these modules with experimental conditions or traits.

Key Concept: Unlike single-gene analysis, WGCNA identifies groups of genes that behave similarly across samples, revealing biological pathways and potential regulatory relationships.

Use Cases:

Identify gene modules associated with experimental conditions
Discover hub genes (highly connected genes within modules)
Find genes with similar expression patterns to known genes of interest
Reduce dimensionality of gene expression data for downstream analysis
Generate hypotheses about gene function based on co-expression

Default Prompt: "Build a co-expression network to identify gene modules and hub genes from my RNA-seq data"

When to Use This Skill

Use WGCNA when you want to:

Identify gene modules associated with experimental conditions or phenotypes
Discover hub genes that are highly connected within modules and may be key regulators
Find co-expressed genes with similar expression patterns to known genes of interest
Reduce dimensionality of large gene expression datasets for downstream analysis
Generate hypotheses about gene function based on co-expression patterns

Requirements:

≥15 samples (20+ recommended for robust results)
Normalized expression data (VST, rlog, TPM, or FPKM - NOT raw counts)
5,000-15,000 most variable genes
Batch effects removed or corrected

Not suitable for:

Small sample sizes (<15 samples) - consider alternative approaches
Raw count data - normalize first using DESeq2 or similar
Data with uncorrected batch effects - correct before WGCNA
Installation

Core WGCNA packages:

if (!requireNamespace("BiocManager", quietly = TRUE))
    install.packages("BiocManager")

BiocManager::install("WGCNA")

Visualization packages:

install.packages(c("ggplot2", "ggprism"))
BiocManager::install("ComplexHeatmap")

Enrichment analysis (optional):

BiocManager::install(c("clusterProfiler", "org.Hs.eg.db"))  # Human
# BiocManager::install("org.Mm.eg.db")  # Mouse
# BiocManager::install("org.Rn.eg.db")  # Rat
Software    Version    License    Commercial Use    Installation
WGCNA    ≥1.70    GPL-2+    ✅ Permitted    BiocManager::install('WGCNA')
ggplot2    ≥3.3.0    MIT    ✅ Permitted    install.packages('ggplot2')
ComplexHeatmap    ≥2.10.0    MIT    ✅ Permitted    BiocManager::install('ComplexHeatmap')
clusterProfiler    ≥4.0.0    Artistic-2.0    ✅ Permitted    BiocManager::install('clusterProfiler')
Inputs

Required:

Normalized expression matrix (CSV/TSV):

Rows: Genes, Columns: Samples
Values: VST, rlog, TPM, or FPKM (NOT raw counts)
5,000-15,000 most variable genes recommended

Sample metadata (CSV/TSV):

Sample IDs matching expression matrix columns
Traits/conditions for module-trait correlation

Optional:

Differential expression results (to highlight DEGs)
Gene annotations for enrichment analysis

Data Requirements:

≥15 samples (20+ recommended)
Batch effects removed or corrected
No missing values in expression matrix
Outputs

CSV Files:

wgcna_gene_modules.csv - Gene-module assignments with connectivity metrics
wgcna_hub_genes.csv - Top hub genes per module
wgcna_module_trait_cor.csv - Module-trait correlations with p-values
wgcna_eigengenes.csv - Module eigengene values per sample
wgcna_report.md - Summary report with interpretation

Plots (PNG + SVG): 6. soft_power_selection.png/.svg - Power selection diagnostic plot 7. module_dendrogram.png/.svg - Gene dendrogram with module colors 8. module_trait_correlation.png/.svg - Module-trait heatmap 9. eigengene_heatmap.png/.svg - Module eigengene expression patterns 10. hub_genes_barplot.png/.svg - Hub genes by connectivity

Analysis Objects (RDS): 11. wgcna_network.rds - Complete network object from blockwiseModules - Load with: net <- readRDS('wgcna_network.rds') - Required for: module preservation analysis, advanced network visualization 12. wgcna_module_colors.rds - Module color assignments per gene - Load with: colors <- readRDS('wgcna_module_colors.rds') - Required for: downstream module-specific analyses 13. wgcna_expression_matrix.rds - Filtered expression matrix used for analysis - Load with: expr <- readRDS('wgcna_expression_matrix.rds') - Required for: reanalysis, module preservation testing 14. wgcna_full_results.rds - Complete results object with all components - Load with: results <- readRDS('wgcna_full_results.rds') - Required for: replotting, additional analyses

Key Metrics:

module: Module color assignment (grey = unassigned)
kWithin: Intramodular connectivity (higher = more connected)
MM: Module membership (correlation with eigengene)
hub_score: Combined connectivity metric (MM × kWithin)
Report Packaging

Generate a PDF report using pdf-report-generation unless otherwise specified, with the markdown summary, result tables, generated figures, and relevant references. The workflow is not complete until the report is generated.

Clarification Questions

Input Files (ASK THIS FIRST):

Do you have specific normalized expression data and sample metadata files to analyze?
If uploaded: Are these the expression matrix and metadata you'd like to analyze?
Expected formats: CSV or TSV with genes as rows, samples as columns
Or use example data? Female mouse liver dataset (135 samples, liver tissue, multiple traits)

What is your normalized expression data format?

VST (variance stabilizing transformation) from DESeq2
rlog (regularized log) from DESeq2
TPM (transcripts per million)
FPKM/RPKM
If unsure or raw counts: normalize first using DESeq2

How many samples do you have?

15-30 samples (minimum for WGCNA, results may be less robust)
30-50 samples (good power for network detection)
50+ samples (excellent power, most reliable results)

What traits/conditions do you want to correlate with modules?

Treatment vs control (binary)
Disease status or phenotype
Continuous variables (age, dose, time, weight)
Multiple traits (all will be tested)

Gene filtering strategy?

Top 5,000 most variable genes (default, recommended)
Top 10,000-15,000 genes (for larger datasets)
All genes passing expression threshold
Pre-filtered gene list (e.g., from DE analysis)
Standard Workflow

🚨 MANDATORY: USE SCRIPTS EXACTLY AS SHOWN - DO NOT WRITE INLINE CODE 🚨

Step 1 - Load data:

library(WGCNA)
allowWGCNAThreads()

source("scripts/load_example_data.R")
wgcna_data <- load_example_wgcna_data()
datExpr <- wgcna_data$datExpr
meta <- wgcna_data$meta

# For your own data:
# source("scripts/prepare_wgcna_data.R")
# data <- prepare_wgcna_data("expression.csv", "metadata.csv", top_n_genes = 5000)
# datExpr <- data$datExpr
# meta <- data$meta

Step 2 - Run WGCNA analysis:

source("scripts/wgcna_workflow.R")
results <- run_wgcna_analysis(
  datExpr,
  meta,
  traits = c("weight_g", "Glucose_mg_dl"),  # Adjust to your traits
  organism = "mouse"  # or "human", "rat", or NULL to skip enrichment
)

DO NOT write inline WGCNA code. Just source the script.

Step 3 - Generate visualizations:

source("scripts/plot_all_wgcna.R")
plot_all_wgcna(results, output_dir = "wgcna_results")

🚨 DO NOT write inline plotting code (png, svg, plotDendroAndColors, etc.). Just use the script. 🚨

The script handles PNG + SVG export with graceful fallback for SVG dependencies.

Step 4 - Export results:

source("scripts/export_wgcna_results.R")
export_all(results, output_dir = "wgcna_results")

DO NOT write custom export code. Use export_all().

✅ VERIFICATION - You should see:

After Step 1: "✓ Successfully loaded female mouse liver dataset"
After Step 2: "✓ WGCNA analysis completed successfully!"
After Step 3: "✓ All WGCNA plots generated successfully!"
After Step 4: "=== Export Complete ==="

⚠️ CRITICAL - DO NOT:

❌ Write inline WGCNA code → STOP: Use source("scripts/wgcna_workflow.R")
❌ Write inline plotting code (png, svg, plotDendroAndColors, etc.) → STOP: Use plot_all_wgcna()
❌ Write custom export code → STOP: Use export_all()
❌ Try to install svglite → script handles SVG fallback automatically
❌ Use absolute paths like /mnt/knowhow/ → use relative paths scripts/
❌ Skip soft power selection → required for scale-free topology
❌ Use raw counts → normalize first with DESeq2 VST or rlog

⚠️ IF SCRIPTS FAIL - Script Failure Hierarchy:

Fix and Retry (90%) - Install missing package, re-run script
Modify Script (5%) - Edit the script file itself, document changes
Use as Reference (4%) - Read script, adapt approach, cite source
Write from Scratch (1%) - Only if genuinely impossible, explain why

NEVER skip directly to writing inline code without trying the script first.

What the scripts provide:

scripts/load_example_data.R - Auto-fetch tutorial data (~135 samples)
scripts/prepare_wgcna_data.R - Load and filter your data
scripts/wgcna_workflow.R - Complete WGCNA analysis (power selection, network building, module-trait correlation, hub genes, enrichment)
scripts/plot_all_wgcna.R - All analysis-ready plots (PNG + SVG)
scripts/plotting_helpers.R - Plot saving functions with automatic SVG fallback handling
scripts/export_wgcna_results.R - Export results and analysis objects
Parameter Customization

When customization is needed:

Soft power selection: Read references/parameter-tuning-guide.md to understand how to choose appropriate power values for your data
Module detection parameters: See references/parameter-tuning-guide.md#module-detection for guidance on min_module_size and merge_cut_height
Complete custom workflow: Read references/wgcna-reference.md for detailed code examples with explanations (only if you need full control)
Common Issues
Issue    Cause    Solution
Too few samples error    <15 samples    WGCNA requires ≥15 samples; combine replicates or use alternative methods
Scale-free R² never exceeds 0.75    Batch effects or poor data quality    Check for batch effects; try different normalization; inspect PCA
All genes assigned to grey module    minModuleSize too large or poor gene filtering    Lower minModuleSize to 20-30; increase top_n_genes to 10,000-15,000
No significant module-trait correlations    Weak biological signal or incorrect traits    Check trait coding (numeric for continuous, 0/1 for binary); try more samples
Soft power recommended is very high (>20)    Data not suitable for scale-free network    Check normalization; consider signed vs unsigned network
Hub gene identification fails    Module colors not provided correctly    Ensure module_colors matches gene order in datExpr
Enrichment analysis returns no results    Wrong organism or gene ID format    Verify organism parameter matches data; convert gene IDs if needed
Memory errors during network construction    Too many genes    Reduce to 5,000-10,000 most variable genes; increase RAM
Interpretation Guidelines

Module colors:

Each color = distinct co-expression module
Grey = genes not assigned to any module
Larger modules may represent broader biological processes

Hub genes:

High kWithin = highly connected within module
High MM = strong correlation with module eigengene
Hub genes are candidates for experimental validation

Module-trait correlations:

|r| > 0.5 and p < 0.05 = significant association
Positive correlation = module genes increase with trait
Negative correlation = module genes decrease with trait
Focus on modules with strongest associations
Suggested Next Steps

After identifying modules and hub genes:

Functional validation - Validate hub genes experimentally (qPCR, knockdown, overexpression)
Enrichment analysis - Test modules for GO/KEGG enrichment to understand biological processes
Compare with DE results - Overlay DE genes on network to see which modules are enriched
Network visualization - Export to Cytoscape for detailed network visualization
Cross-dataset validation - Test module preservation in independent datasets
Related Skills
bulk-rnaseq-counts-to-de-deseq2 - Normalize counts and perform differential expression analysis (run before WGCNA)
de-results-to-gene-lists - Extract gene lists from DE results to overlay on network
functional-enrichment-from-degs - Perform GO/KEGG enrichment on modules
References

Documentation:

WGCNA Best Practices Guide - Comprehensive guide on data preparation, QC, and troubleshooting
Parameter Tuning Guide - Detailed parameter selection guidance
WGCNA Reference - Complete code examples with explanations
Troubleshooting Guide - Common errors and solutions

Example Data:

Example Datasets - Public datasets for WGCNA analysis

Key Papers:

Key WGCNA Papers - Essential publications
Langfelder & Horvath (2008). WGCNA: an R package for weighted correlation network analysis. BMC Bioinformatics. doi:10.1186/1471-2105-9-559
Zhang & Horvath (2005). A general framework for weighted gene co-expression network analysis. Statistical Applications in Genetics and Molecular Biology. doi:10.2202/1544-6115.1128

21. consensus-disease-signature
Category: TRANSCRIPTOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

Consensus Expression Meta-Signature
What this skill does

Given two or more bulk-transcriptome cohorts comparing a condition to a control, this skill derives the consensus transcriptional signature: the genes that change in the same direction across independent cohorts and platforms, quantified by a formal random-effects effect-size meta-analysis. It then characterizes the signature (GO + Reactome over-representation, Hallmark GSEA), validates it against the literature, and assembles a self-contained PDF report with a visual-abstract infographic.

When cohorts use different control groups (e.g. histologically normal vs osteoarthritis vs trauma), the skill does not silently pool them into one contrast: each cohort's control type is recorded, the heterogeneity is flagged, and a sensitivity meta-analysis restricted to non-inflammatory-control cohorts quantifies how much of the consensus signature is preserved.

The method is condition-agnostic. Only the inputs (which cohorts, which contrast) and the literature validation query change between diseases. Nothing in the pipeline is hard-coded to any specific disease.

Scope

In scope

Any human disease/condition with >= 2 bulk-transcriptome cohorts.
Cohorts from GEO (retrieved automatically) and/or user-supplied expression matrices (proprietary cohorts, or ArrayExpress/BioStudies E-MTAB-* flat files fed through the matrix path).
Microarray (limma on log2 intensities) and RNA-seq (limma-voom on counts).
A two-group contrast (disease vs control is the default instantiation; any two metadata-defined groups work).

Explicitly NOT in scope (keep the skill focused; do not silently expand it)

Single-study differential expression with no meta-analysis (use limma directly).
Meta-analysis by p-value combination or vote-counting (this skill uses effect sizes only).
Cell-type deconvolution, single-cell integration, eQTL, or network inference.
More than two contrast groups modeled jointly (pick the two levels via config instead).
Non-human organisms out of the box (documented extension: swap the annotation OrgDb and platform packages; not implemented by default).
Inputs

A single YAML config drives everything (see references/example_config.yaml):

disease, output_dir, global contrast (case/control values + column), fdr, core_lfc.
cohorts[]: for each cohort an id, source (geo or matrix), platform, type (microarray/rnaseq), and how to assign the two groups (group_column, case_values, control_values, optional filters for tissue/timepoint).

Full field reference: references/parameters.md.

Outputs (under output_dir)
tables/summary.json — headline numbers + top genes (consumed by the report builder). Reports n_fdr_sig (FDR-significant, either direction) and n_consensus (that AND sign-consistent) as distinct keys, plus per-cohort control_type, data_types, heterogeneous_controls, and a sensitivity block.
tables/meta_analysis_full.csv — every gene: pooled estimate, SE, z, p, FDR, I2, tau2, k, per-cohort log2FC, direction, consensus, core.
tables/consensus_UP_genes.csv, consensus_DOWN_genes.csv.
tables/sensitivity_noninflammatory_meta.csv — the meta-analysis restricted to non-inflammatory-control cohorts (only when >= 2 such cohorts exist; see step 7).
tables/enrichment_GO_BP_{UP,DOWN}.csv, enrichment_Reactome_{UP,DOWN}.csv, GSEA_hallmark.csv. (KEGG ORA was removed — not licensed for commercial use; Reactome replaces it. See DATA_SOURCES.md.)
figures/ (PNG @150dpi + editable SVG): QC distributions, per-study volcano, cross-cohort concordance scatter, consensus heatmap, forest plot, ORA dotplots (GO + Reactome), Hallmark GSEA barplot, and (when a sensitivity meta ran) sensitivity_preservation.
A schematic infographic (via GenerateImage) and the final <disease>_consensus_signature_report.pdf.
Workflow

Run the R engine, generate the infographic, then build the PDF. Each step below notes its biological/statistical rationale so the reasoning is transferable.

Ingest each cohort. GEO series via GEOquery, or a user matrix + metadata table. Why: multiple independent cohorts are the whole point — one study is underpowered and confounded by cohort-specific technical variation.

Select samples for the contrast. Apply filters (e.g. tissue == colon, visit == baseline) and keep only the two contrast groups. Why: mixing tissues, timepoints, or on-treatment samples injects variance unrelated to the disease contrast. (In the UC reference run this meant colon-only, baseline-visit-only, and excluding dysplasia.) Also set each cohort's control_type (e.g. normal, osteoarthritis, trauma) so heterogeneous baselines are handled explicitly downstream (step 7b) rather than silently pooled.

QC + cross-cohort duplicate check. Inspect per-sample distributions; cross-correlate mean expression between every cohort pair and flag r > 0.999. Why: GEO frequently hosts re-deposits of the same data under different accessions; counting them twice fakes replication and biases the pooled estimate. (This is exactly how a duplicate of one UC cohort was caught and dropped.)

Annotate probes -> gene symbols and collapse. Map with the platform's Bioconductor .db package (strip the _PM infix for GPL13158/GPL16311); collapse multi-probe genes to the probe with the highest mean expression. Why: meta-analysis needs a shared feature space; SYMBOL is the common denominator; max-mean picks the most reliably measured probe.

Per-cohort differential expression. The engine dispatches on each cohort's declared type: limma moderated t-test for microarray (log2 intensities) or limma-voom for rnaseq (filterByExpr + TMM-normalized counts). Retain log2FC and its standard error (stdev.unscaled * sqrt(s2.post)). Why: the (log2FC, SE) pair is the effect size + precision the meta-analysis combines — not p-values, which are not comparable across platforms/sample sizes. The report Methods text is generated from the cohorts' actual types (via summary.json$data_types) so it never mis-describes an all-RNA-seq run as microarray, or vice versa.

Random-effects effect-size meta-analysis. For each gene in >= 2 cohorts, metafor::rma(yi=log2FC, sei=SE, method="REML") (DerSimonian-Laird fallback); BH-FDR across all tested genes; record I2 heterogeneity. Why: random effects allow the true effect to vary across cohorts (biological + technical heterogeneity) and yield a pooled estimate with calibrated uncertainty; I2 quantifies cross-cohort consistency.

Define the consensus and core sets. consensus = FDR < fdr AND same sign in all contributing cohorts; core = consensus AND |pooled log2FC| >= core_lfc. Why: statistical significance alone can be driven by one cohort; requiring direction consistency is what makes the signature reproducible. Core adds an effect-size floor for the highest-confidence genes. Count discipline: n_fdr_sig (FDR-significant, either direction) and n_consensus (that AND sign-consistent) are different quantities — n_consensus <= n_fdr_sig by construction. The engine asserts this and summary.json/the report keep them as distinct, separately-labelled numbers (never substitute one for the other, as an earlier version's report text did).

7b. Handle heterogeneous control groups. If cohorts declare more than one distinct control_type, set heterogeneous_controls = true, record every cohort's control type, and — when >= 2 cohorts share a non-inflammatory control (noninflammatory_control_types, default normal/trauma/healthy/control) — re-run the same effect-size meta-analysis on that subset and report the fraction of primary consensus genes preserved (direction-consistent & FDR < fdr) in the subset. Why: different controls are not equivalent baselines (e.g. OA synovium carries its own inflammation), so pooling them silently can conflate case-vs-normal with case-vs-other-disease. Random effects absorb control-type differences as heterogeneity, and the sensitivity subset checks that the signature is disease-driven, not comparator-driven. If only one control type is present this step is a no-op; if heterogeneity exists but < 2 non-inflammatory cohorts, the heterogeneity is still flagged and caveated but the subset meta is skipped with a reason.

Functional enrichment. ORA (enrichGO BP simplified at 0.7 + ReactomePA::enrichPathway) on core up/down separately, with the universe = all meta-tested genes; Hallmark GSEA (fgsea) on the z-score-ranked list. Why: separating directions keeps up/down biology distinct; the correct background is the tested-gene universe, not the whole genome; GSEA captures coordinated shifts ORA misses. KEGG ORA was removed because the KEGG API is not licensed for commercial use; Reactome (open, commercially usable) replaces it — see DATA_SOURCES.md. Load only Hallmark / small MSigDB subcollections — loading full C2 (~7000 sets) caused OOM in the reference run.

Literature validation (LiteratureSearch). Search e.g. "<disease> transcriptome meta-analysis marker genes"; extract explicitly named up/down markers from returned records; report the fraction recovered with correct direction. Save records to execution_trace/references.jsonl for the report. Why: independent confirmation that the signature recapitulates known biology. If few named markers are recoverable, say so — never invent genes or citations (fabrication guard).

Report. Generate a schematic infographic with GenerateImage (the workflow + headline numbers as a visual abstract), then build the PDF with scripts/build_report.py following the pdf-report-generation skill: executive summary, introduction, methods, results (all figures + top-gene tables), conclusions, suggested next steps, and references.

How to run
# 0. One-time deps (see Environment). metafor + any missing platform .db packages.
# 1. Core analysis  (writes tables/ + figures/ + summary.json)
Rscript scripts/run_meta_signature.R  my_config.yaml

# 2. Literature validation + infographic are agent-driven:
#    - call LiteratureSearch for "<disease> ... marker genes", check top genes' concordance
#    - call GenerateImage to render a schematic visual abstract PNG (workflow + headline numbers)

# 3. Assemble the PDF
python scripts/build_report.py \
   --results /mnt/results \
   --infographic /mnt/results/figures/infographic.png \
   --out /mnt/results/<disease>_consensus_signature_report.pdf

Then verify every figure and the final PDF with a direct visual inspection using ordinary Read (no black-box glyphs, figures embedded, nothing clipped or blank) before delivering.

Scientific caveats
Human default. Uses org.Hs.eg.db and human platform packages. Other species require swapping the annotation packages (documented, not automated).
Two-group contrast only. For designs with >2 groups, choose the two comparison levels in the config; this skill does not fit multi-level or interaction models.
Heterogeneous control groups. When cohorts use different controls (e.g. normal vs OA vs trauma), the pooled estimate is an average over non-equivalent baselines; genes separating the case specifically from an inflammatory comparator can be attenuated. Always set control_type per cohort, read the heterogeneous_controls flag, and interpret the non-inflammatory-control sensitivity result. Prefer a consistent control where the data allow it.
Effect-size meta-analysis only. No p-value combination, vote-counting, or single-study mode.
Independence matters. Always run the duplicate check; drop re-deposited cohorts. Cohorts from the same lab/platform may still share batch structure — interpret low I2 accordingly.
Batch/covariate adjustment is per-cohort via the design; cross-cohort batch is handled by the meta-analysis (random effects), not by merging raw data (avoid naive matrix concatenation).
MSigDB memory. Load only Hallmark or small subcollections; full C2 can OOM.
No fabrication. Literature validation reports exactly what was found; if markers or citations are not recoverable, state that rather than inventing them.
Environment & dependencies
Pre-installed (verified): R — limma, clusterProfiler, org.Hs.eg.db, fgsea, msigdbr, GEOquery, ComplexHeatmap, ggplot2. Python — standard scientific stack. Skills — pdf-report-generation.
Install if missing: R — metafor, edgeR (RNA-seq), ReactomePA + reactome.db (Reactome ORA; replaces KEGG), patchwork, svglite, reshape2, circlize, and the platform annotation packages you need (hgu133plus2.db, hugene10sttranscriptcluster.db, illuminaHumanv4.db, ...). Python — reportlab, pypdf, pillow. Install R packages to a persistent lib: .libPaths(c("/workspace/.Rlib", .libPaths())). (reactome.db is a ~1 GB annotation download — budget a few minutes on first install.)
Biomni tools used: LiteratureSearch (validation + references), GenerateImage (infographic), direct visual inspection using ordinary Read (figure/PDF QC).
Optional datalake reference: LINCS1000/RNAseq_transcriptomics_genesets/*.gmt (disease_signatures-v1.0.gmt, human_GEO.gmt) as a secondary enrichment reference.
Commercial-use restrictions (needs_commercial_review)

The following runtime dependencies have commercial-use restrictions that must be reviewed before any non-academic deployment. They are not cleared for commercial use by this skill and require a separate license or a substitute pathway.

KEGG — REMOVED (was not licensed for commercial use). Earlier versions ran clusterProfiler::enrichKEGG(), which downloads KEGG pathway annotations from rest.kegg.jp at runtime; the KEGG API is "made available only for academic use by academic users" and "non-academic use of KEGG requires a commercial license" (KEGG copyright page, updated Oct 1, 2024; license via Pathway Solutions). KEGG ORA has been removed from this skill and replaced with Reactome (ReactomePA::enrichPathway), which is open and commercially usable (see DATA_SOURCES.md). No KEGG API call remains and no enrichment_KEGG_* table is produced; the outputs are now enrichment_Reactome_{UP,DOWN}.csv.
MSigDB Hallmark gene sets (via msigdbr). The Hallmark (H) collection used for GSEA appears to be CC-BY-4.0 on individual gene-set pages, but the broader MSigDB has mixed licensing — the Broad Institute notes that "a significant portion of the data requires a commercial license for any commercial application." This skill loads only msigdbr(species='Homo sapiens', category='H'). For commercial deployments: confirm that the Hallmark collection specifically carries no additional restriction beyond CC-BY-4.0, or obtain a MSigDB commercial license. Do not assume the full MSigDB is cleared because Hallmark appears to be.

No other material dependency in this skill has a known commercial-use prohibition (metafor: GPL >=2; limma, clusterProfiler, GEOquery, fgsea, ReactomePA, Bioconductor annotation packages incl. reactome.db: Artistic-2.0 / MIT; Reactome pathway data: CC0 (the Reactome knowledgebase is released to the public domain, CC-BY for attribution of figures); GO: CC-BY 4.0; reportlab: BSD; GEO data: no restrictions per NCBI). However, "no prohibition found" is not the same as explicit commercial clearance — verify each dependency independently for your deployment context. See DATA_SOURCES.md for the full data-source + license inventory.

Compute

Bulk meta-analysis is light: the reference UC run (3 cohorts, ~490 samples, meta over 21,358 genes) completed in ~100 s. The default sandbox handles <= ~5 microarray cohorts; for many cohorts or RNA-seq counts use a 16 GB worker (ManageMachine). No HPC needed. Write tables/figures to /mnt/results incrementally — the reference run survived two container restarts because outputs were saved as they were produced.

Trigger examples
"Build a consensus RNA expression signature for <disease> from GEO series GSE_A, GSE_B, GSE_C."
"Meta-analyze differential expression across these psoriasis cohorts and give me the consensus up/down genes."
"I have three expression matrices for <condition>; make a cross-cohort meta-analysis signature and a PDF report."
"Integrate these datasets into one disease signature with enrichment and literature validation."

22. deconvolution-bulk-rnaseq
Category: TRANSCRIPTOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

Bulk RNA-seq Cell-Type Deconvolution (single-cell reference)
When to Use This Skill

Use when:

You have bulk RNA-seq (genes x samples) and want to estimate cell-type proportions within each sample
You have (or can build) an annotated single-cell reference covering the cell types in the bulk
You want to test which cell types differ between groups (e.g., responders vs non-responders), optionally over timepoints
You need a commercially-licensed workflow on Biomni — CIBERSORTx-style estimation without the CIBERSORTx license

Don't use when:

You have single-cell data already (no deconvolution needed — use scrnaseq-scanpy-core-analysis)
You want spatial spot deconvolution (use spatial-transcriptomics)
You want differential expression, not composition (use bulk-rnaseq-counts-to-de-deseq2)
You have no reference and cannot build one (reference-free methods are out of scope)
Installation

The license is the design constraint — every method below permits commercial use. See references/license-notes.md.

Package    Source    License    Commercial Use    Installation
BayesPrism    GitHub    GPL-3    Permitted    remotes::install_github("Danko-Lab/BayesPrism/BayesPrism")
DWLS    CRAN    GPL-2    Permitted    install.packages("DWLS")
MuSiC (optional)    GitHub    GPL-3    Permitted    remotes::install_github("xuranw/MuSiC")
BisqueRNA (optional)    CRAN    GPL-3    Permitted    install.packages("BisqueRNA")
SingleCellExperiment    Bioc    GPL-3    Permitted    BiocManager::install("SingleCellExperiment")
zellkonverter (.h5ad input)    Bioc    MIT    Permitted    BiocManager::install("zellkonverter")
Seurat (.rds input)    CRAN    MIT    Permitted    install.packages("Seurat")
ggplot2    CRAN    MIT    Permitted    install.packages("ggplot2")
ggprism    CRAN    GPL-3    Permitted    install.packages("ggprism")
lmerTest (optional, longitudinal)    CRAN    GPL    Permitted    install.packages("lmerTest")
SimBu (eval only)    Bioc    GPL-3    Permitted    BiocManager::install("SimBu")
CIBERSORTx    ---    non-commercial    DO NOT USE    Stanford license; off-limits on Biomni
EPIC    ---    academic-only    DO NOT USE    for-profit needs separate license
BSeq-sc    ---    wraps CIBERSORT    DO NOT USE    Inherits CIBERSORT's restriction

Optional reference builder (Python): cellxgene-census, scanpy, anndata — only needed for scripts/census_reference.py.

Why no omnideconv: Earlier versions of this skill routed methods through the omnideconv framework. In practice the direct-call paths (BayesPrism, DWLS, MuSiC, Bisque) do the real work and omnideconv's changing kwarg signatures added install bulk and noisy fallback messages. The rebuild calls the methods directly.

NEVER use CIBERSORTx, EPIC, or BSeq-sc. run_deconvolution() hard-errors if requested — this is intentional, not a bug. See references/license-notes.md.

Inputs

Required:

Bulk matrix (genes x samples) — .csv / .tsv / .rds; gene symbols as row names (must match the reference's gene IDs). Linear or log scale (auto-detected; converted to linear).
Annotated single-cell reference — .h5ad (CELLxGENE/AnnData), Seurat .rds, or SingleCellExperiment .rds, with a cell_type annotation column (and ideally donor_id for MuSiC/Bisque).

Optional (for group testing):

Sample metadata — sample_id, group, and optionally timepoint, subject_id.

Accepted sources for the reference:

One-step Census fallback: scripts/census_reference.py (pulls a CELLxGENE Census slice → .h5ad)
An annotated .h5ad / Seurat .rds / SCE .rds you already have
Example data (auto-generated synthetic immune cohort with known proportions)
Outputs

All user-facing outputs land in /mnt/results/deconvolution/ so the Biomni results panel surfaces them automatically. Use a custom output_dir only if you have a reason to.

Proportion tables (CSV):

proportions_<method>.csv — per-method cell-type fractions (samples x cell type)
consensus_proportions.csv — cross-method mean fractions
method_concordance.csv — pairwise Pearson r (overall + per cell type); flags method-fragile types
composition_summary.csv — mean +/- SD fraction per group (x timepoint)
proportion_contrasts.csv — group contrasts with BH-FDR (+ mixed_model_anova.csv if longitudinal)
ground_truth_recovery.csv — per-cell-type r + RMSE vs known truth (example data only)

Figures (PNG + SVG):

composition_stacked — mean composition per group x timepoint
celltype_boxplots — per-cell-type fractions by group (top differential types)
composition_trajectories — mean fraction over timepoints by group (if timepoints present)
method_concordance_scatter — first method vs second method, points = (sample, cell type)
ground_truth_recovery — estimated vs true proportions (example data only)

Analysis object (RDS):

cell_type_deconvolution.rds — complete results (all proportions, consensus, concordance, contrasts, metadata)
Load with: res <- readRDS('/mnt/results/deconvolution/cell_type_deconvolution.rds')
Required for: downstream functional enrichment / target prioritisation, re-plotting, re-testing

Reports:

analysis_report.md — markdown summary (always generated by export_all())
analysis_report.pdf — you (the agent) generate this comprehensive PDF (Intro, Methods, Results with embedded figures, Conclusions, References)

PDF style rules:

US Letter page size (8.5 x 11 in) — always set page dimensions explicitly; do not rely on library defaults
No Unicode superscripts — use 3.36e-06 or 3.36 x 10^(-6), not Unicode superscript chars (they render as boxes in PDF fonts)
No half-empty pages — group headings with their content; only page-break before major sections (Results, Conclusions)
Figures >=80% page width — multi-panel figures must be large enough to read; never embed below 50% width
Clarification Questions

ALWAYS ask Question 1 FIRST. Do not proceed before the user answers.

1. Input Files (ASK THIS FIRST):
Do you have a bulk RNA-seq matrix (genes x samples)? Provide the path (.csv/.tsv/.rds) and the scale (raw counts / TPM / log2).
Do you have an annotated single-cell reference? Provide the path (.h5ad / Seurat .rds / SCE .rds), or:
Build one from the CELLxGENE Census (scripts/census_reference.py), or
Use example data? — a synthetic immune cohort (6 cell types; 24 bulk samples = responder vs non-responder x baseline/week12) with known ground-truth proportions for recovery checks.

IF EXAMPLE DATA SELECTED: All parameters are pre-defined (human immune cell types, two groups, two timepoints, known truth). Skip to Question 4, then proceed to Step 1. Do NOT ask Questions 2-3.

2. Reference & scale (own data only):
Which metadata column holds the cell-type labels? (default cell_type)
Is the bulk on raw/TPM (linear) or log2 scale? (auto-detected, but confirm if unsure)
3. Grouping (own data only):
Which metadata column defines the groups to contrast (e.g., response)?
Is there a timepoint and a subject_id (enables the longitudinal mixed model)?
4. Methods (structured — works for demo and own data):
a) BayesPrism + DWLS (recommended default — robust + collinear-aware, with concordance)
b) Add MuSiC + Bisque for a 4-method concordance panel (only when reference has >=3 donors)
c) BayesPrism only (fastest single method)

CIBERSORTx and EPIC are excluded by license and never offered.

Standard Workflow (R)

MANDATORY: USE SCRIPTS EXACTLY AS SHOWN — DO NOT WRITE INLINE CODE

Step 1 — Load data: (~5 s)

source("scripts/load_data.R")
ex <- load_example_data()                       # synthetic cohort with known truth
reference <- ex$reference; bulk <- ex$bulk; metadata <- ex$metadata
# --- OR your own data: ---
# reference <- load_reference("reference.h5ad", cell_type_col = "cell_type")
# bulk      <- load_bulk("bulk_counts.csv")
# metadata  <- read.csv("metadata.csv")         # sample_id, group, [timepoint, subject_id]

Step 2 — Deconvolve + test composition: (~3-8 min on 8 cores; BayesPrism dominates)

source("scripts/run_deconvolution.R")
deconv <- run_deconvolution(bulk, reference, methods = c("bayesprism", "dwls"))
# n_cores auto-detects (capped at 8); pass n_cores = N to override.

source("scripts/deconv_stats.R")
contrasts <- proportion_contrasts(deconv$consensus, metadata, group_col = "group",
                                  timepoint_col = "timepoint", subject_col = "subject_id")

DO NOT write inline deconvolution or statistics code. Just source the scripts and call the functions.

Step 3 — Generate visualizations: (~10-30 s)

source("scripts/deconv_plots.R")
generate_all_plots(deconv, metadata = metadata, contrasts = contrasts,
                   ground_truth = ex$ground_truth,
                   output_dir = "/mnt/results/deconvolution")

DO NOT write inline plotting code (ggplot, ggsave). Just use the script. (Omit ground_truth = for your own data — it's for the example's recovery plot.)

Step 4 — Export results: (~5 s)

source("scripts/export_results.R")
export_all(deconv, metadata = metadata, contrasts = contrasts,
           ground_truth = ex$ground_truth,
           output_dir = "/mnt/results/deconvolution")

DO NOT write custom export code. Use export_all(). Then write the comprehensive analysis_report.pdf (see PDF style rules above).

VERIFICATION — You should see:

After Step 1: "[OK] Example data loaded successfully!" (or "[OK] Reference loaded successfully!" + "[OK] Bulk loaded successfully!")
After Step 2: "[OK] Deconvolution completed!" then "[OK] Proportion contrasts completed!"
After Step 3: "[OK] All plots generated successfully!"
After Step 4: "=== Export Complete ==="

IF YOU DON'T SEE THESE: You wrote inline code. Stop and use source().

CRITICAL — DO NOT:

Write inline deconvolution code -> STOP: Use run_deconvolution()
Write inline statistics/plotting code -> STOP: Use proportion_contrasts() / generate_all_plots()
Write custom export code -> STOP: Use export_all()
Use CIBERSORTx or EPIC -> non-commercial licenses; run_deconvolution() rejects them
Try to install svglite -> scripts handle SVG fallback automatically (writes to /workspace then copies to /mnt/results when the output dir is S3-FUSE-backed)

IF SCRIPTS FAIL — Script Failure Hierarchy:

Fix and Retry (90%) — Install the missing package, re-run the script
Modify Script (5%) — Edit the script file itself, document changes
Use as Reference (4%) — Read the script, adapt the approach, cite the source
Write from Scratch (1%) — Only if genuinely impossible, explain why

NEVER skip directly to writing inline code without trying the script first.

Python entry point (optional)

Python-first agents can run the same workflow via a single subprocess wrapper that returns parsed CSVs as pandas DataFrames. No rpy2 dependency.

import sys; sys.path.insert(0, "scripts")
from deconvolution import run_deconvolution, load_example

# load_example() returns kwargs ready to splat into run_deconvolution().
paths = load_example(output_dir="/mnt/results/deconvolution")     # writes example inputs + returns paths

res = run_deconvolution(
    **paths,                                                       # bulk_path, reference_path, metadata_path, ground_truth_path
    output_dir="/mnt/results/deconvolution",
    methods=["bayesprism", "dwls"],
    group_col="group",
    timepoint_col="timepoint",
    subject_col="subject_id",
)
print(res["consensus"].head())                                     # pd.DataFrame
print(res["contrasts"].query("significant").head())

Under the hood: subprocess.run(["Rscript", "scripts/run_full_workflow.R", ...]). The R workflow writes the same CSVs/PNGs/RDS as the R API; the Python wrapper parses them into dict[str, pd.DataFrame]. Logs from R stream through unchanged.

Common Issues
Issue    Cause    Solution
A bulk cell type is missing from the reference    Reference doesn't cover all populations in the bulk    Most important failure mode — biases all methods. Rebuild the reference to include every expected cell type (see references/parameter-tuning.md)
Proportions look random / all methods disagree    Log-scale bulk fed as linear, or gene-ID mismatch    Confirm scale (script auto-detects & exponentiates log2); ensure bulk and reference use the same gene IDs (symbols vs Ensembl)
"only N shared genes" warning    Gene-ID type mismatch bulk ↔ reference    Convert one side so both use gene symbols (the reference builder sets symbols as var_names)
BayesPrism slow    Single-core or many reference cells    run_deconvolution(..., n_cores = 8) (default auto-detects), max_cells_per_type = 200 to downsample further
A cell type flips across methods    Closely-related / collinear types    Reported as method-fragile in method_concordance.csv — interpret with caution (DWLS handles collinearity best)
CIBERSORTx/EPIC requested    Non-commercial license    Excluded by design; run_deconvolution() errors. Use BayesPrism/DWLS/MuSiC/Bisque
Metadata column missing (group)    Default group_col = "group" doesn't match user's metadata    Pass group_col = "<your_column>" explicitly to proportion_contrasts() and generate_all_plots()
Auto-picked group_levels surprise    group_col has >2 levels; defaults to two most frequent    Pass group_levels = c("A", "B") to proportion_contrasts() to lock the contrast
SVG export error "svglite required"    Missing optional dependency    generate_all_plots() handles the fallback to base-R svg() automatically. DO NOT install svglite manually
Mixed model skipped    lmerTest missing or no subject_id/timepoint    Optional — Wilcoxon + BH-FDR still run. install.packages("lmerTest") to enable
BisqueRNA returns flat 1/K proportions    Reference has near-equal cell-type counts across all batch donors (no inter-donor variance for ReferenceBasedDecomposition to regress on)    Expected on very balanced reference designs (including the bundled synthetic example). On real scRNA-seq references with natural inter-donor variation, Bisque works as designed. If you see this on real data, check batch_col actually varies — e.g. set batch_col = "donor_id" only when donors differ in composition
Suggested Next Steps

After deconvolution, consider:

Functional enrichment — feed the cell types that shift between groups into functional-enrichment-from-degs
Target prioritisation — connect composition changes to candidate targets / pathways
Pseudobulk DE within a cell type — combine with bulk-rnaseq-counts-to-de-deseq2 to ask whether a population also changes expression, not just abundance
Cell-cell communication — reuse the same single-cell reference in cell-cell-communication
Longitudinal modelling — re-run proportion_contrasts(..., mixed_model = TRUE) for prop ~ group*timepoint + (1|subject)
Related Skills
Skill    Relationship
scrnaseq-scanpy-core-analysis / scrnaseq-seurat-core-analysis    Upstream — QC + annotate the reference (cell_type labels)
omics-dataset-retrieval / bulk-rnaseq-counts-to-de-deseq2    Upstream — source the bulk matrix
cell-cell-communication    Complementary — same reference, intercellular signalling
functional-enrichment-from-degs    Downstream — interpret the cell types that change
spatial-transcriptomics    Alternative — spatial spot deconvolution
pdf-report-generation    Used by the agent to assemble analysis_report.pdf
Validation Scope

Bundled tests are self-consistency checks, not real-world accuracy validation.

The skill ships with assets/eval/simple_test.R and assets/eval/simbu_ground_truth.R. Both run against the bundled synthetic immune cohort (.simulate_immune_data()), and SimBu builds its pseudobulk from the same synthetic reference. Reported Pearson r values (typically > 0.99) reflect the pipeline correctly recovering proportions it itself generated -- they do not certify accuracy on real bulk RNA-seq cohorts.

What the bundled tests do prove:

Pipeline integration is intact (load -> deconvolve -> contrasts -> figures -> export).
The bayesprism+dwls default panel agrees on the engineered biology (Monocyte up, CD8_T down in non-responders at week12).
Cross-method concordance (r > 0.95 on the example) holds across method changes -- a real regression signal.
The SimBu acceptance threshold (r > 0.8) protects against pipeline regressions but not modelling assumptions.

What they do not prove:

Absolute accuracy on real cohorts where ground truth comes from flow cytometry, mass cytometry, or an orthogonal reference.
Robustness when the bulk contains cell types absent from the reference (the single largest failure mode -- see Common Issues).
Cross-dataset generalisation when the single-cell reference is built from a different tissue, donor, or platform than the bulk.
Per-method coverage in the validated build

All four optional methods were exercised end-to-end against the bundled synthetic cohort. Behaviour on this example:

Method    Wallclock    Concordance vs BayesPrism    Per-sample rowsum    Notes
BayesPrism    ~113 s    -- (anchor)    1.000    Default panel member
DWLS    ~23 s    r = 0.993    1.000    Default panel member
MuSiC    ~1 s    r = 0.993    1.000    Tracks DWLS r=1.000 on this example
BisqueRNA    < 1 s    r = 0.607    1.000    Returns ~uniform 1/K on this very balanced reference -- see Common Issues

The default panel (bayesprism + dwls) is the recommendation. MuSiC and BisqueRNA stay in the optional panel; both install and run, but treat BisqueRNA output cautiously when the single-cell reference has near-equal cell counts across every donor.

For publication-grade use, validate against (a) an external cohort with experimental cell-type proportions (e.g. PBMC fractions from flow), or (b) pseudobulk built from an independent scRNA-seq dataset of the same tissue (not the same dataset used as the reference). Pass your own truth table as the ground_truth argument to generate_all_plots() and export_all() (same shape as ex$ground_truth: sample_id column + one column per cell type, fractions summing to ~1) -- the existing recovery scatter and ground_truth_recovery.csv will be computed against it. The Avila Cobos et al. 2020 benchmark paper is the canonical reference.

References
Avila Cobos F, et al. Benchmarking of cell type deconvolution pipelines for transcriptomics data. Nat Commun. 2020;11:5650.
Chu T, et al. Cell type and gene expression deconvolution with BayesPrism. Nat Cancer. 2022;3:505-517.
Tsoucas D, et al. Accurate estimation of cell-type composition from gene expression data (DWLS). Nat Commun. 2019;10:2975.
Wang X, et al. Bulk tissue cell type deconvolution with multi-subject single-cell expression reference (MuSiC). Nat Commun. 2019;10:380.
Jew B, et al. Accurate estimation of cell composition in bulk expression through robust integration of single-cell information (Bisque). Nat Commun. 2020;11:1971.
Method selection: references/method-selection-guide.md
License rationale: references/license-notes.md
Reference & preprocessing tuning: references/parameter-tuning.md

23. direction-of-effect-concordance
Category: DRUG DISCOVERY
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

24. disease-progression-longitudinal
Category: MULTI-OMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

Disease Progression Trajectory Analysis
When to Use This Skill

Use this skill when you have longitudinal patient omics data and want to:

✅ Reconstruct disease progression trajectories from time-series data
✅ Order samples by disease stage (pseudotime) with irregular sampling
✅ Identify biomarkers changing along disease trajectory
✅ Stratify patients as fast vs. slow progressors
✅ Predict clinical outcomes from trajectory position
✅ Validate computational staging against clinical measures

Required data:

Minimum 10 patients with 3+ timepoints each
Omics data: RNA-seq, proteomics, metabolomics, or clinical biomarkers
Metadata: Patient IDs, timepoints (days/months/years), optional outcomes

Primary method: TimeAx multiple trajectory alignment (handles irregular sampling)

Feature identification: Polynomial regression (linear/quadratic/cubic) per the TimeAx paper (Frishberg et al., Nat Commun 2023), with FDR-corrected Q-value filtering. Captures both monotonic and non-monotonic dynamics.

Alternative methods: Linear Mixed Models (regular sampling), Hidden Markov Models (discrete stages)

Installation

R ≥ 4.0 with the TimeAx package (primary trajectory method):

# Install TimeAx from GitHub
install.packages("remotes")
remotes::install_github("amitfrish/TimeAx")

# Required for plotting
install.packages(c("ggplot2", "ggprism"))

# Required for demo dataset (GSE128959 batch correction)
BiocManager::install("sva")

Python ≥ 3.9 for the workflow wrapper and analysis pipeline:

# Core analysis packages
pip install numpy pandas scipy scikit-learn statsmodels lifelines

# Visualization packages
pip install seaborn matplotlib

# PDF report generation (optional)
pip install reportlab

# Optional
pip install hmmlearn        # Hidden Markov Models alternative

For Linear Mixed Models alternative: R packages lme4, lmerTest

License compliance: All packages use permissive licenses (MIT, BSD, Apache 2.0) - commercial AI agent use permitted.

For detailed installation and troubleshooting, see troubleshooting_guide.md

Inputs

Required files:

Data matrix (features × samples)

CSV/TSV format with features as rows, samples as columns
Feature types: genes, proteins, metabolites, or clinical biomarkers
Normalized counts or continuous measurements
⚠️ TimeAx requires all-positive values (e.g., log2-normalized, RMA). Do NOT Z-score normalize before TimeAx — it creates negative values that disable the ratio mechanism.

Sample metadata (CSV/TSV)

Required columns: sample_id, patient_id, timepoint
Optional: outcome, treatment, batch, clinical covariates
Timepoints: numeric values (days, months, years from baseline)

Data requirements:

≥10 patients minimum (20+ recommended)
≥3 timepoints per patient minimum
Handles irregular sampling (different timepoints per patient)
Works with cross-sectional + longitudinal cohorts
Outputs

Primary results:

pseudotime_assignments.csv - Disease pseudotime for each sample
trajectory_features.csv - Features changing along trajectory, with polynomial degree, R², and direction
patient_summaries.csv - Per-patient progression statistics
all_feature_statistics.csv - Statistics for all tested features

Analysis objects (for downstream use):

timeax_model.pkl - Complete TimeAx model object
Load with: model = pickle.load(open('timeax_model.pkl', 'rb'))
Required for: Projecting new samples, downstream trajectory analysis

Reports:

analysis_report.pdf - PDF report created with pdf-report-generation; packaged markdown/script output is a fallback if the dedicated reporting skill is unavailable
SUMMARY.txt - Plain-text summary report

TimeAx R plots (PNG + SVG, generated in Step 2):

timeax_pseudotime_vs_time.png/.svg - Per-patient pseudotime vs actual time trajectories
timeax_progression_rates.png/.svg - Patient progression rate comparison (fast vs slow)
timeax_seed_dynamics.png/.svg - Seed feature expression trends along pseudotime
timeax_uncertainty.png/.svg - Pseudotime uncertainty distribution

Python plots (PNG + SVG, generated in Step 3):

patient_trajectories_pca.png/.svg - PCA with pseudotime coloring and patient trajectory lines
patient_trajectories_umap.png/.svg - UMAP nonlinear projection
trajectory_heatmap.png/.svg - Feature expression clustermap
trajectory_trends.png/.svg - Polynomial fit trends for top features
pseudotime_vs_stage.png/.svg - Pseudotime vs clinical tumor stage (biological validation)
patient_progression.png/.svg - Per-patient pseudotime spaghetti plot
seed_feature_heatmap.png/.svg - TimeAx seed feature dynamics heatmap

Metadata:

model_metadata.json - Analysis parameters, quality metrics (monotonicity, robustness)
Report Packaging

When the user requests a PDF report, run the analysis first, then load and use the Biomni pdf-report-generation skill for the final PDF deliverable. Build the PDF from this skill's markdown summary, result tables, and generated figures, and save it using the PDF filename listed in Outputs, or a stable descriptive filename when Outputs does not define one.

Keep this skill focused on scientific workflow and artifact content. Do not add custom figure appearance or report layout instructions here; those are handled by the platform prompt and dedicated reporting skills. If pdf-report-generation is unavailable, use the packaged markdown/HTML/script fallback when present and clearly disclose the fallback.

Clarification Questions

🚨 ALWAYS ask Question 1 FIRST. Do not ask about data type, study design, or analysis parameters before the user has answered Question 1.

1. Input Files (ASK THIS FIRST)
Do you have longitudinal patient omics data to analyze?
If uploaded: Are these your data matrix and sample metadata files?
Expected: Data matrix (features × samples) + metadata (sample_id, patient_id, timepoint)
Or use example/demo data?
GSE128959 bladder cancer recurrence (18 patients, 84 samples, 17K genes) — from the TimeAx paper (Frishberg et al. 2023). Requires R + sva package. Downloads ~5MB on first run.

🚨 IF EXAMPLE DATA SELECTED: All parameters are pre-defined (bladder cancer microarray, 18 patients, 4-6 timepoints, tumor recurrence, TimeAx method with ComBat batch correction). DO NOT ask questions 2-6. Proceed directly to Step 1.

Questions 2-6 are ONLY for users providing their own data:

2. Data Type: Bulk RNA-seq, proteomics, metabolomics, clinical biomarkers, or multi-omics?
3. Study Design: Number of patients (min 10, recommend 20+)? Timepoints per patient (min 3)? Sampling pattern (regular/irregular)? Time units and range?
4. Disease Context: Disease type? Treatment status? Available clinical outcomes (survival, relapse, response)? Known clinical staging?
5. Analysis Goals: Pseudotime ordering, patient stratification, biomarker discovery, outcome prediction, or trajectory comparison?
6. Method Preference: TimeAx (recommended), Linear Mixed Models, Hidden Markov Models, or not sure?
Standard Workflow

🚨 MANDATORY: USE SCRIPTS EXACTLY AS SHOWN - DO NOT WRITE INLINE CODE 🚨

Step 1 - Load and preprocess data:

For example/demo data (GSE128959 bladder cancer):

from scripts.load_and_preprocess import load_example_data, load_and_preprocess_data

# Load GSE128959 (downloads and preprocesses via R on first run)
data, metadata = load_example_data()

# Save to files for the standard pipeline
data.to_csv('gse128959_expression.csv')
metadata.to_csv('gse128959_metadata.csv', index=False)

# Run through standard preprocessing
data, metadata, preprocessing_stats = load_and_preprocess_data(
    data_file='gse128959_expression.csv',
    metadata_file='gse128959_metadata.csv',
    data_type='rnaseq',
    min_patients=10,
    min_timepoints=3
)

For your own data:

from scripts.load_and_preprocess import load_and_preprocess_data

data, metadata, preprocessing_stats = load_and_preprocess_data(
    data_file="patient_expression.csv",
    metadata_file="sample_metadata.csv",
    data_type='rnaseq',  # 'rnaseq', 'proteomics', 'metabolomics', 'clinical'
    min_patients=10,
    min_timepoints=3
)

DO NOT write inline data loading or preprocessing code. Just use the script.

✅ VERIFICATION: You MUST see: "✓ Data loaded and preprocessed successfully!"

Step 2 - Run trajectory analysis:

from scripts.run_trajectory_analysis import run_trajectory_analysis

# Run TimeAx alignment and identify trajectory features
results = run_trajectory_analysis(
    data,
    metadata,
    method='timeax',  # 'timeax', 'lmm', 'hmm'
    patient_column='patient_id',
    time_column='timepoint'
)
# Extract: pseudotime, trajectory_features, model, robustness_score

DO NOT write inline TimeAx or trajectory code. Just use the script.

✅ VERIFICATION: You MUST see: "✓ Trajectory analysis completed successfully!"

Step 3 - Generate visualizations:

from scripts.generate_all_plots import generate_all_plots

# Generate all plots (PNG + SVG with graceful fallback)
generate_all_plots(
    data,
    metadata,
    results,
    output_dir='trajectory_results'
)

🚨 DO NOT write inline plotting code (plt.savefig, seaborn, etc.). Just use the script. 🚨

The script handles PNG + SVG export with graceful fallback for SVG dependencies.

✅ VERIFICATION: You MUST see: "✓ All visualizations generated successfully!"

Step 4 - Export results:

from scripts.export_results import export_all

# Export all results, model object, and metadata
export_all(
    data=data,
    metadata=metadata,
    results=results,
    output_dir='trajectory_results'
)

DO NOT write custom export code. Use export_all().

✅ VERIFICATION: You MUST see: "=== Export Complete ==="

⚠️ CRITICAL - DO NOT:

❌ Write inline data loading code → STOP: Use load_and_preprocess_data()
❌ Write inline TimeAx/trajectory code → STOP: Use run_trajectory_analysis()
❌ Write inline plotting code → STOP: Use generate_all_plots()
❌ Write custom export code → STOP: Use export_all()

⚠️ IF SCRIPTS FAIL - Script Failure Hierarchy:

Fix and Retry (90%) - Install missing package, re-run script
Modify Script (5%) - Edit the script file itself, document changes
Use as Reference (4%) - Read script, adapt approach, cite source
Write from Scratch (1%) - Only if genuinely impossible, explain why

NEVER skip directly to writing inline code without trying the script first.

Detailed Methodology

For comprehensive details on algorithms, parameters, and methods:

TimeAx algorithm: timeax_methodology.md
Alternative methods (LMM, HMM): lmm_hmm_alternatives.md
Method comparison and selection: method_comparison.md
Data preprocessing by type: data_preprocessing_guide.md
Validation framework: validation_framework.md
Quality Control

Quick checklist:

✅ ≥10 patients with ≥3 timepoints each
✅ Within-patient monotonicity >0.5 (good) or 0.3-0.5 (moderate)
✅ Pseudotime correlates with clinical measures (r >0.2, p <0.05)
✅ Trajectory features identified (seed feature fallback if FDR <0.05 yields 0)
✅ Samples don't cluster by batch (check PCA)

Note on robustness: The TimeAx robustness() function (v0.1.1) can produce misleading negative values even on valid data. Use within-patient monotonicity as the primary quality metric instead.

For comprehensive QC guidelines, see validation_framework.md

Common Issues
Error    Cause    Solution
Negative robustness score    Known TimeAx v0.1.1 bug    Normal. The robustness() function is unreliable. Use within-patient monotonicity (>0.5 = good) as the primary quality metric instead.
0 trajectory features (FDR <0.05)    FDR too stringent for genome-wide test    Normal with real data. The script automatically falls back to testing TimeAx seed features (reduced FDR burden) and nominal p < 0.05.
Memory error during alignment    Too many features (>20,000)    Reduce to 5000-10000 most variable features before TimeAx. Script does this automatically.
SVG export failed    Missing cairo system library    Normal - PNG still generated. Script handles fallback automatically. DO NOT try to install cairo manually.
Samples cluster by batch not time    Uncorrected batch effects    Run ComBat batch correction before trajectory analysis. Set batch_correction=True in preprocessing.
Negative values disable ratio mode    Z-score or log-fold-change normalization    TimeAx ratio=TRUE requires positive values. Use log2 counts, RMA, or TPM — NOT Z-scores.
"R TimeAx not available"    R or TimeAx R package not installed    STOP: Install R, then run: Rscript -e 'remotes::install_github("amitfrish/TimeAx")'. See Installation section.
PDF report not generated    reportlab not installed    Normal. Install with pip install reportlab. SUMMARY.txt is always generated as fallback.

For complete troubleshooting, see troubleshooting_guide.md

Suggested Next Steps

After trajectory analysis, consider these downstream analyses:

Functional enrichment → Use functional-enrichment-gprofiler skill

Input: trajectory_features.csv (top up/down-regulated features)
Find pathways changing along disease trajectory

Tissue expression analysis → Use tissue-expression-from-degs skill

Input: trajectory_features.csv
Identify tissue-specific trajectory markers

Transcription factor activity → Use tf-activity-dorothea skill

Input: pseudotime_assignments.csv + original expression data
Find TFs driving disease progression

Survival analysis → Built into clinical validation

Input: pseudotime_assignments.csv + survival data
Stratify patients by pseudotime tertiles/quartiles

Project new samples → Use scripts/timeax_inference.py

Load: timeax_model.pkl
Stage new patients on trained trajectory
Related Skills

Upstream (data generation):

bulk-rnaseq-counts-to-de-deseq2 - Generate expression data
proteomics-differential-expression - Proteomics quantification
metabolomics-preprocessing - Metabolite data

Downstream (interpretation):

functional-enrichment-gprofiler - Pathway analysis of trajectory features
tissue-expression-from-degs - Tissue-specific markers
tf-activity-dorothea - Transcription factor drivers
grn-pyscenic - Gene regulatory networks along trajectory

Alternative trajectory methods:

pseudotime-monocle - For single-cell RNA-seq trajectories
trajectory-inference-slingshot - Branching trajectories
References
Primary Citations

TimeAx: Frishberg A, van den Munckhof ICL, Ter Horst R, et al. Reconstructing disease dynamics for mechanistic insights and clinical benefit. Nat Commun. 2023;14(1):6940. https://doi.org/10.1038/s41467-023-42354-8

Linear Mixed Models: Bates D, Mächler M, Bolker B, Walker S. Fitting Linear Mixed-Effects Models Using lme4. J Stat Softw. 2015;67(1):1-48.

Disease Trajectories Review: Schmidt AF, Heerspink HJL, Denig P, et al. Disease trajectory browser for exploring temporal, population-wide disease progression patterns. Nat Commun. 2020;11:4952.

Software
Software    Version    License    Commercial Use
TimeAx    ≥0.1.0    MIT    ✅ Permitted
NumPy    ≥1.21    BSD    ✅ Permitted
Pandas    ≥1.3    BSD    ✅ Permitted
scikit-learn    ≥1.0    BSD    ✅ Permitted
seaborn    ≥0.11    BSD    ✅ Permitted
matplotlib    ≥3.5    BSD    ✅ Permitted
ggprism (R)    ≥1.0.3    GPL (≥3)    ✅ Permitted
sva (R)    ≥3.40    Artistic-2.0    ✅ Permitted
reportlab    ≥3.6    BSD    ✅ Permitted
Online Resources
TimeAx GitHub: https://github.com/amitfrish/TimeAx
TimeAx Documentation: https://timeax.readthedocs.io/
Disease Progression Modeling Review: https://www.annualreviews.org/content/journals/10.1146/annurev-biodatasci-110123-041001

25. drug-bioactivity-chembl
Category: DRUG DISCOVERY
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

26. drug-repurposing-indication-expansion
Category: DRUG DISCOVERY
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

27. drug-seq-analysis
Category: TRANSCRIPTOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

<!-- archetype: analysis-workflow --> <!-- contract: evidence-v1 -->
Drug Seq Analysis
When to Use This Skill

Use for DRUG-seq or plate-based bulk RNA-seq compound screens (counts+platemap or barcoded FASTQ): per-well QC, compound/dose differential expression, perturbational signatures with MoA clustering, dose-response/tPOD, and pathway/TF activity. Not for single-cell or Perturb-seq data; wells are samples, not cells.

Why This, Not The Obvious Thing (READ FIRST)

Treating each well as a single cell (running a scRNA/Perturb-seq pipeline on well pseudobulk), or ranking hits by raw p-value with no vehicle-versus-vehicle null, lets plate position and library-size differences read as compound biology; this skill uses well-level bulk DESeq2 against per-plate matched vehicle and a mandatory null contrast that must return about zero DEGs.

Inputs
counts.tsv - genes (rows) by wells (columns) matrix of integer UMI counts; the header lists well IDs matching platemap.csv.
platemap.csv - one row per well with columns well_id, compound, dose_uM, timepoint_h, replicate, plate_id, row, col, and semantic is_control. Flag the matched negative-control vehicle independently of its compound name. Use one vehicle identity across the run; mixed vehicle identities stop before modeling.
Optional FASTQ front end - R1 (well barcode + UMI) and R2 (cDNA) FASTQ, a barcode whitelist (barcodes.txt), and a reference.tsv of probe/target genes.
Wells are experimental units (samples), not cells; dose is in micromolar; counts are UMI-deduplicated integers.
The production entrypoint seals caller-selected inputs and their origin, source, path, byte count, SHA-256, and acquisition provenance in input_selection.json; it rejects undeclared substitutes, package-owned data, and symlink escapes.
Outputs
report_drug-seq-analysis.pdf — the single canonical PDF, rendered by the provider selected from immutable user messages; defaults to pdf-report-generation, with task context, methods/sources, results, conclusions, data-bearing figures, references, and next steps
infographic.png — one qualitative DRUG-seq workflow overview, generated from the exact prompt selected by the same immutable report-style decision and embedded once as the PDF's first substantive visual
infographic_prompt_binding.json — provider, exact prompt hash, same-ID GenerateImage evidence, and image byte/pixel hashes captured before report assembly
tables/de_all_contrasts.csv — machine-readable result: one row per gene x contrast (compound x dose vs matched vehicle) with baseMean, log2FoldChange, padj, is_sig, and low_expr_hit, including the vehicle-vs-vehicle null contrast
tables/de_model_specification.csv — executed treatment and vehicle-null formulas, including their shared plate/edge adjustment terms
tables/null_contrast_gate.json — machine gate state for the pre-specified maximum of 5 apparent null DEGs
tables/well_qc.csv — one row per well: total UMIs, genes detected, pass/drop flag, and the depth/complexity floors
tables/activity_scores.csv — gene-set x compound ULM activity t-values
tables/dose_response.csv — per compound x dose aggregate response and the transcriptomic point of departure (tPOD)
tables/moa_clusters.csv — per-compound mechanism-of-action cluster assignment
tables/query_signatures.json — exported up/down query signatures for optional connectivity analysis in signature-reversal-lincs
data/analysis_platemap.csv — derived plate map carrying the normalized control role and resolved vehicle identity used by every consumer
report_facts.json — evidence-bearing claims, operational definitions, provenance, and validated denominator/completion partitions

Write the report to the results root under the name above. Data tables, figures and intermediates go in data/, figures/, tables/.

Clarification Questions
Which DRUG-seq input do you have? (select one)
counts — My own counts.tsv plus platemap.csv; runtime branch ID qinput:counts
fastq — Barcoded FASTQ plus whitelist and reference (demultiplexing front end); runtime branch ID qinput:fastq
Adjust differential expression for plate row/column (edge) position? (select one)
none — No positional covariate (use when position diagnostics are clean); runtime branch ID qcovariate:none
edge — Include an edge/position covariate in the DESeq2 model; runtime branch ID qcovariate:edge
Standard Workflow

Step 1 — Load and validate the input. Enforce every item in ## Inputs; stop with not_computable on a mismatch.

Step 2 — Per-well and plate QC. Run scripts/well_qc.py for per-well UMI/gene metrics, data-driven low-quality-well dropping, and plate row/column/edge positional diagnostics; stop with not_computable when the barcode assignment rate is below threshold. Success: tables/well_qc.csv with one row per well and the dropped-well list.

Step 3 — Experimental design and normalization. Run scripts/design_preflight.py to check per-condition replicate wells and design identifiability, stopping when a condition is confounded with a whole plate; normalize with a plate (and optional position) covariate. Success: tables/design_preflight.csv and an identifiable design.

Step 4 — Differential expression contrasts with FDR control. Run the bundled scripts/de_deseq2.R for each compound-by-dose versus matched vehicle at padj<0.05 and absolute log2 fold-change above 1, applying a baseMean floor so low-count genes are flagged not ranked. Success: tables/de_all_contrasts.csv and tables/de_summary.csv. When DESeq2 is used, de_deseq2.R also queries and persists the DESeq2 package version (packageVersion("DESeq2")) to tables/software_versions.csv, kept separate from the R interpreter version; run_analysis.py surfaces both as distinct fields in the facts payload (software.r.version, software.deseq2.version), so a report or summary never prints the R interpreter version as DESeq2's (the "DESeq2 4.4.3" conflation, where 4.4.3 is R's version).

Step 5 — Vehicle-versus-vehicle null contrast. Fit the mandatory NULL_VEHICLE_vs_VEHICLE contrast by splitting the is_control-flagged vehicle wells under the same plate and optional edge adjustment terms used for treatment contrasts. At least four QC-passing vehicle wells, both null groups, and a full-rank null design are required. Apply the version-controlled, pre-specified scientific_logic.MAX_NULL_DEGS=5 gate immediately after DESeq2; more than 5 apparent DEGs hard-stops the run before activity, tPOD, figures, facts, or report generation. Success: tables/de_model_specification.csv, tables/null_contrast_gate.json, and null_contrast.status=passed with null_contrast.n_deg<=5.

Step 6 — Concentration-response and transcriptomic POD. Run scripts/dose_response.py to orient top-dose DEGs by their signed top-dose direction, subtract the lowest tested dose as a within-compound reference, and interpolate the tPOD at BMR=1 only for compounds with at least four doses and positive dose association. Fewer than four doses is reported as not_estimable_insufficient_doses, not as a null response; observed differential-expression evidence remains visible. A flat, downward, or non-crossing response with an otherwise sufficient series is explicitly null rather than assigned an absolute-value noise floor. Success: tables/dose_response.csv with the version-controlled method, response state, tPOD, or an explicit non-estimable/null reason.

Step 7 — Perturbational signatures, MOA clustering, and connectivity export. Run scripts/signatures_moa.py to build per-compound signatures, cluster compounds by signature correlation, and export query signatures that can be analyzed with signature-reversal-lincs. Success: tables/moa_clusters.csv and tables/query_signatures.json.

Step 8 — Pathway and TF-activity scoring. Run the bundled scripts/activity_ulm.R to score gene-set and TF activity per compound by univariate linear model over the supplied gene sets. Headline sets are ranked only by the version-controlled maximum absolute ULM t-value in scientific_logic.PATHWAY_RANKING_METRIC; the selected value retains its sign for direction, and there is no runtime or review-time ranking branch. Success: tables/activity_scores.csv with signed activity t-values.

Step 9 — Generate and validate figures. Render only results produced by the preceding validated steps, write figures/manifest.json, then validate every declared artifact before facts or the receipt can use it.

from report_qc import assert_figures
figures = assert_figures("figures/manifest.json")
Figures

One representative figure per result-producing step, showing this run's actual result — not a schematic, not an illustrative example. Every figure needs a caption stating what it shows and a short adjacent block labelled Claim:, Evidence:, Interpretation:, and Limitation:. Keep that block on the same PDF page as its figure and exact manifest caption. If a step genuinely has nothing to plot, replace its row with a one-line reason. Both narrative fields are required at run time.

Step    File    What it must make visible
2    figures/figure_2_per_well_and.png    Per-well sequencing depth with the QC floor marked, and the plate-position heatmap, so dropped low-quality wells and any edge/positional gradient are obvious
3    figures/figure_3_experimental_design_and.png    PCA of QC-passing wells colored by compound, with the exact caption returned by scientific_logic.positional_caption(...), derived from the executed positional-confounding flag and selected DE-model edge covariate
4    figures/figure_4_differential_expression_contrasts.png    Volcano of the strongest compound x dose contrast, with called DEGs (padj<0.05, absolute log2FC above 1) highlighted and the up/down counts readable
5    figures/figure_5_vehicle_versus_vehicle.png    Volcano of the vehicle-vs-vehicle null contrast, which exists only after its apparent DEG count passes the pre-specified maximum of 5
6    figures/figure_6_concentration_response_and.png    Lowest-dose-referenced, top-dose-direction-aligned signed response versus dose, with the benchmark line and either the interpolated tPOD or explicit null state
7    figures/figure_7_perturbational_signatures_moa.png    Pairwise compound signature-correlation heatmap with the mechanism-of-action cluster structure visible
8    figures/figure_8_pathway_and_tf.png    Gene-set / TF activity (ULM t-value) per compound, with headline sets selected by the pinned maximum-absolute-t metric and their signed t-values shown

The report reads this inventory from report_facts.json's figures array rather than restating it, so it cannot claim a figure that was never produced.

Step 10 — Write report_facts.json from the runtime payload. The workflow must produce facts_payload.json with every headline, denominator, and partition-member field declared in skill_contract.json. Semantic gates run before the facts artifact is written, so a failing run never produces claims a report could quote.

from report_qc import write_facts_from_artifact
write_facts_from_artifact('report_facts.json', source='facts_payload.json', figures=figures, contract="skill_contract.json")
Step 11 — Final report (MANDATORY TERMINAL STEP)

The run is not complete until this step has produced report_drug-seq-analysis.pdf at the results root. Resolve the provider with report_qc.report_render_plan() before creating any PDF bytes. The resolver reads immutable user-message evidence only; a provider name in an assistant message, CLI argument, customer name, tenant, project, account, folder, or dataset is not selection evidence.

from report_qc import RESULTS, report_render_plan
from infographic_style import resolve_prompt
render_plan = report_render_plan()
selected_infographic_prompt_file = resolve_prompt(render_plan, RESULTS)
With no explicit user style request, follow the default pdf-report-generation path and render the report sections and data-bearing figures specified below.
With an explicit compatible provider, load that provider's complete instructions and required assets and render the same canonical filename.
Missing, malformed, conflicting, revoked, or incompatible provider selection blocks completion. Never fall back, approximate a requested style, or produce an unverified companion PDF.
The selected provider owns presentation only. Preserve every fact, table, figure, caption, adjacent interpretation, threshold, claim, reference, limitation, provenance record, artifact path, and non-PDF output.

Produce one combined PDF with a short narrative. rendered page images are inspection evidence only, never substitutes for the PDF. End the task with a concise conclusion and links to the PDF and supporting artifacts, not a bare file listing.

Regenerate any figure whenever its underlying data change; do not reuse a figure derived from stale inputs or tables.

The PDF must use these visible top-level sections in this order, adapting their contents to this skill rather than adding generic filler:

Task Context — the research or practitioner question, supplied inputs, scope, and decision the output informs.
Methods & Sources — Methods & Sources covers data provenance, filtering, parameters, software, and the analysis design; Results reports validated quantitative findings and figures.
Results — the run's actual outputs and evidence, never a description of what the skill could do.
Conclusions & Interpretation — supported takeaways, their practical meaning, and appropriate next steps.
Limitations — run-specific uncertainty, missing coverage, failed or unavailable checks, and claims the evidence does not support.
References — the complete numbered user-facing entries returned by scripts/report_references.py; do not substitute the internal review IDs used in the on-demand reference notes.

Load citation_marker() and reference_paragraphs() from scripts/report_references.py. Cite each catalog source at least once outside the References section using its returned canonical inline marker ([1], [2], ...), and render every returned numbered paragraph unchanged in References. Catalog order is the only numbering source: do not freehand, renumber, omit, rewrite, or invent citations. The receipt rejects missing or unmatched inline numbers, an unnumbered or reordered bibliography, and incomplete entries. The selected report provider controls presentation only; it must not select, omit, rewrite, or invent these scientific sources. Include a compact output-artifact table where applicable. Empty boilerplate does not satisfy a section.

The Results or Limitations prose must quote report_facts.json:headline_sentences.positional verbatim. That sentence is derived from caveats_fired.positional_confounded; do not freehand a claim that an edge or positional gradient was detected, absent, or flagged. The receipt rejects the current report when any additional run-specific positional claim contradicts that boolean. Build the Figure 3 manifest caption by calling scientific_logic.positional_caption(...) with that same boolean, the executed positional covariate, and the computed PC1/PC2 variance fractions; keep the returned caption unchanged in the PDF. The contradiction gate understands the helper's explicit negative wording ("was not flagged") as a negative claim, while still rejecting affirmative claims when the Boolean is false.

The Results or Limitations prose must also quote report_facts.json:headline_sentences.cytotoxicity verbatim. It is derived from the strongest top-dose signature, its tested-gene denominator, and whether the plate map contains a nonmissing viability measurement. It discloses cytotoxicity, global transcription/translation inhibition, and general stress as plausible confounds; the receipt rejects a report that omits this limitation.

Generate exactly one qualitative workflow image at infographic.png. Submit the complete contents of selected_infographic_prompt_file to one GenerateImage call verbatim, with file_name="infographic.png"; do not append facts or visual instructions. The default prompt keeps Phylo presentation inside the pdf-report-generation route. An explicit enterprise route instead uses the selected provider's complete palette, typography, spacing, and logo guidance and contains no Phylo styling.

The infographic must remain a workflow overview: counts and plate map → well/plate QC → differential expression and vehicle-null gate → dose response and signatures → MoA/pathway interpretation → evidence-bound report. It must visibly say that it is a typical workflow rather than run-specific results. It must not contain run-specific numbers, compound results, identifiers, plots, axes, data encodings, pass/fail badges, inferred findings, or claims that an analysis outcome occurred.

Immediately after the same-ID GenerateImage result succeeds, bind the exact selected provider and prompt to that call/result and snapshot the generated bytes and decoded pixels before report assembly:

from infographic_style import record_provider_bound_infographic
record_provider_bound_infographic(
    "infographic.png", render_plan, selected_infographic_prompt_file,
    results=RESULTS,
)

Embed infographic.png exactly once, on page 1, as the first substantive PDF visual. Give it a plain workflow caption that says it is qualitative and not a results figure. The existing seven data-bearing figures must follow it and retain their existing captions and result associations.

Render the PDF to a fresh workspace file named by workspace_report_file; do not open or truncate an existing PDF on the object-backed results mount. The staged_copy call below publishes the completed file under its declared results-root name.

Then verify the run with report_qc.write_receipt. It derives obligations from skill_contract.json: report verification and infographic_lineage_verified are both required, with infographics=["infographic.png"]. It also verifies execution, outputs, facts, figures, selected-provider markers, source witnesses, report sections, and review evidence. It raises after writing diagnostic reasons when a required surface fails.

Record each answer from ## Clarification Questions in selected_branch_ids using the displayed <question_id>:<choice_id> value. The receipt derives its required outputs only from those selected branches; do not union mutually exclusive branch artifacts.

from report_qc import (outputs_for_selected_branches, record_pdf_review, staged_copy,
                       write_receipt)
selected_outputs = outputs_for_selected_branches(selected_branch_ids)
selected_outputs.append("infographic_prompt_binding.json")
staged_copy(workspace_report_file, "report_drug-seq-analysis.pdf")
record_pdf_review(
    report_name="report_drug-seq-analysis.pdf", text_artifact=extracted_text_file,
    rendered_page_files=rendered_page_files,
    reviewed_page_numbers=reviewed_page_numbers,
    review_attestation=visual_review_notes,
)
write_receipt(
    report_name="report_drug-seq-analysis.pdf",
    figures=figures,
    figure_not_applicable_reason=None,
    bundled_files=['scripts/de_deseq2.R', 'scripts/activity_ulm.R'],
    outputs=selected_outputs,
    infographics=["infographic.png"],
    qc_run_log="qc_run_log.json",
)

The receipt is run_receipt.json at the results root, not beside this SKILL.md — once this skill is installed its own directory is read-only, so a per-run receipt written there cannot work. It uses phylo-run-receipt/3 and records execution_contract_satisfied, outputs_appeared, report_at_results_root, figure_contract_satisfied, facts_artifact_verified, report_style_verified, text_extracted, pages_rendered, visual_review_attested, report_sections_present, source_assertions_verified, infographic_lineage_verified, each with the path, byte count, selected-provider markers, source hashes, or transcript record the outcome was read from. The prompt-binding artifact is also a declared output, so the receipt hashes its selected provider, exact prompt, same-ID call/result, and image identity alongside the existing infographic snapshot and single-embedding lineage check.

Do not write this file by hand. check_skill.py --require-run-receipt requires the schema marker and per-outcome evidence, so a hand-written block of trues fails. Whatever did not hold is recorded false with a <key>_reason; fix the run rather than the receipt.

Scientific caveats
Treating each well as a single cell (running a scRNA/Perturb-seq pipeline on well pseudobulk), or ranking hits by raw p-value with no vehicle-versus-vehicle null, lets plate position and library-size differences read as compound biology; this skill uses well-level bulk DESeq2 against per-plate matched vehicle and a mandatory null contrast under the same plate/edge adjustment terms. More than the pre-specified maximum of 5 apparent null DEGs hard-stops delivery. Evidence: report_facts.json:null_contrast.n_deg, report_facts.json:null_contrast.maximum_acceptable_degs, and tables/de_model_specification.csv.
A wrong barcode whitelist or a transposed plate map collapses the barcode assignment rate; below threshold the run stops and asks you to reconcile the whitelist and plate map rather than mislabeling wells. Evidence: report_facts.json:qc.barcode_assignment_rate.
Plate row/column/edge gradients can masquerade as dose effects; the run flags positional confounding when plate position explains an outsized share of well-to-well variance. Evidence: report_facts.json:caveats_fired.positional_confounded.
Low-count genes yield unstable, inflated fold-changes; hits below the baseMean floor are flagged as low-expression rather than ranked as effects. Evidence: report_facts.json:caveats_fired.low_expression_hits.
High-dose signatures can reflect cytotoxicity, global transcription/translation inhibition, or a general stress response rather than compound-specific pharmacology. The report quotes the artifact-derived limitation and discloses whether a viability measurement was available; this workflow does not silently claim a viability-adjusted analysis. Evidence: report_facts.json:headline_sentences.cytotoxicity and report_facts.json:top_dose_signature.viability_measurement_available.
When a treatment condition is confounded with a whole plate the effect is not identifiable; the run stops rather than reporting a plate effect as compound biology. Evidence: report_facts.json:design.identifiable.
The transcriptomic point of departure is method-sensitive by roughly an order of magnitude and requires at least four doses, a positive signed dose association, and a BMR crossing after lowest-dose referencing; the method and benchmark are recorded, and flat/nonresponsive data yield an explicit null. Evidence: report_facts.json:dose_response.tpod_method and tables/dose_response.csv:response_status.
On targeted panels, off-panel genes are absent rather than zero; the run discloses whether values are measured or imputed so absent genes are not read as unchanged. Evidence: report_facts.json:panel.measured_vs_imputed.
Connectivity/MoA against CMap or LINCS is not computed offline here. The exported signatures can be analyzed with signature-reversal-lincs, which reports at least two metrics under its own data-use terms. Evidence: report_facts.json:connectivity.status.
The R interpreter version and the DESeq2 package version are different identifiers (for example R 4.4.3 versus DESeq2 1.46.0); when DESeq2 is used the run queries and persists the DESeq2 package version separately and never prints the R interpreter version or an installed boolean as the package version. Evidence: report_facts.json:software.deseq2.version.

Each caveat must name the artifact field or the number that says whether it fired. An unbound caveat is prose; a bound one is a gate.

Evidence Tier

Contract maturity: evidence_validated. Run-specific support is limited to the hash-bound facts, provenance, figures, report, and receipt produced from the selected inputs.

Data Sources & Licenses
DESeq2 (Bioconductor 3.x): https://bioconductor.org/packages/DESeq2/ — license LGPL (>=3); commercial use allowed (LGPL permits commercial use with the usual copyleft obligations for modifications to the library itself.); included true; verify with scripts/de_deseq2.R.
Python scientific stack (numpy, pandas, scipy, scikit-learn, matplotlib, seaborn) (Biomni environment): https://scipy.org/ — license BSD-3-Clause; commercial use allowed (BSD-3-Clause permits commercial use.); included true; verify with scripts/run_analysis.py.
ReportLab (via pdf-report-generation) (Biomni environment): https://www.reportlab.com/ — license BSD-3-Clause; commercial use allowed (BSD-3-Clause permits commercial use.); included true; verify with scripts/report_qc.py.
LINCS L1000 / CMap (GSE92742 / GSE70138): https://clue.io/ — license clue.io / CMap data-use terms; commercial use no_prohibition_found (clue.io terms permit research use; commercial use is not explicitly prohibited but must be verified before commercial deployment.); included false; verify with references/connectivity_handoff.md.
MSigDB (2024.1): https://www.gsea-msigdb.org/ — license MSigDB registration terms (varies by collection); commercial use not_checked (Registration and per-collection terms not verified for commercial use.); included false; verify with references/targeted_panel.md.
Resource Identity
Common Issues
Symptom    Cause    Fix
Run stops with "barcode assignment rate below threshold"    Wrong barcode whitelist or a transposed plate map    Reconcile barcodes.txt and platemap.csv against the wet-lab layout and confirm the barcode/UMI lengths
Run stops with "design not identifiable"    A condition is confounded with a whole plate (batch = condition)    Rebalance the layout so each condition spans at least two plates, or place matched vehicle on every plate
Run stops on mixed vehicle identities    More than one compound identity is flagged is_control=true    Model separate matched strata in an appropriate workflow; this package intentionally does not pool distinct vehicles
Null (vehicle-vs-vehicle) contrast returns more than 5 DEGs    Library-size or positional artifact, or a mis-specified design    The run hard-stops; inspect the positional diagnostic/model specification and correct the design before retrying
No tPOD reported for a compound    Fewer than four doses, no top-dose DEGs, flat/non-associated signed response, or no BMR crossing    Expected null behavior — inspect response_reason; extend or redesign the dose range only when scientifically justified
DESeq2 step fails to run    DESeq2 is not installed in the R environment    Install DESeq2 from Bioconductor; it is a declared dependency, not optional
Connectivity / tau is empty    No CMap/LINCS reference was supplied to this run    Expected — continue with signature-reversal-lincs using tables/query_signatures.json
Suggested Next Steps
Analyze tables/query_signatures.json with signature-reversal-lincs for connectivity/MoA scoring against CMap/LINCS, reporting at least two metrics under its data-use terms.
Extend the dose range to at least four doses per compound to estimate a tPOD where this run reported none.
Confirm hits with orthogonal evidence (independent compounds, CRISPR concordance, or dose extension) before moving past hypothesis-generating strength.
Related Skills
signature-reversal-lincs — consumes the exported query signatures for connectivity/MoA (CMap/LINCS) scoring.
bulk-rnaseq-counts-to-de-deseq2 — general bulk RNA-seq DESeq2 differential expression; this skill adds the DRUG-seq plate/well front end, null contrast, and dose-response.
functional-enrichment-from-degs — downstream pathway enrichment on the differential-expression gene lists.
pdf-report-generation — used by the terminal step to render the branded PDF report.

28. elastic-net-biomarker-panel
Category: MULTI-OMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

29. evidence-synthesis-meta-analysis
Category: DATA ANALYSIS
Source: https://biomni.phylo.bio/skills?section=marketplace

Evidence Synthesis & Meta-Analysis

Pool effect estimates across studies into a rigorous random-effects meta-analysis with a full robustness suite and a publication-grade PDF report (with a visual infographic). Works for any intervention or exposure question — the source workflow was GLP-1 receptor agonists for weight loss, but nothing here is drug- or disease-specific.

Scope
Does: study discovery (optional), PRISMA-style screening, structured effect-size extraction, generic-inverse-variance random-effects pooling, heterogeneity + prediction interval, subgroups / meta-regression, leave-one-out + influence + small-study diagnostics, 4 media-checked figures, and a Phylo-branded PDF (infographic, intro, methods, results, discussion, limitations, next steps, references, appendix).
Effect measures: continuous (MD, SMD) and binary/time-to-event (OR, RR, HR), one measure per analysis, pooled on the correct scale (ratios logged then back-transformed).
Does NOT (v1): single-arm proportion/prevalence meta-analysis, network/multivariate meta-analysis, individual-participant-data meta-analysis, or diagnostic-test-accuracy (bivariate) models. Flag these and stop rather than approximating them.
Inputs (two modes)
User-supplied extraction table — a CSV matching references/extraction_table_template.csv (one row per comparison: study, year, measure, effect, ci_lo, ci_hi, se, n_trt, n_ctrl, subgroup, design, source_id, notes). Go straight to pooling.
Literature-driven — start from a research question, discover studies with the Biomni LiteratureSearch tool, screen them, and extract effects from the papers into that same table.

Either way the analysis engine consumes data/extraction_table.csv.

Outputs (saved under a run folder in /mnt/results/)
data/: extraction_table.csv, screening_log.csv, meta_results.csv, meta_model.rds, leaveoneout.csv, influence_diagnostics.csv, smallstudy_test.txt, risk_of_bias.csv, references_used.csv.
figures/ (PNG + SVG, each media-checked): forest_main, funnel, leaveoneout, heterogeneity_panel, plus infographic.png (from GenerateImage).
report_<topic>_meta.pdf — the final report.
Workflow
0. Confirm the analysis is in scope

Confirm the effect measure and that one measure will be pooled (never mix MD with OR). If the request is a proportion/network/IPD/diagnostic meta-analysis, say it's out of scope for this skill.

1. Get the data
Mode 1 (table given): validate it against references/extraction_table_template.csv. Check every row has an effect + (CI or SE), a consistent measure, and a source_id.
Mode 2 (literature-driven):
Use LiteratureSearch with the research question (apply year_min, study_types such as RCT/Meta-Analysis, sjr_max, human filters as appropriate). Records land in references.jsonl.
Screen records (PRISMA): record every INCLUDE/EXCLUDE with a reason in screening_log.csv. Common exclusions: wrong population, wrong comparator, duplicate cohort (same participants in an extension — do not double-count), different estimand (e.g. randomized-withdrawal or post-lead-in designs), no extractable effect + dispersion.
Extract the between-group effect + 95% CI from each included paper into extraction_table.csv. Read references/methodology_notes.md for SE derivation, per-arm-CI combination, and log-scale rules. Prefer the intention-to-treat / treatment-policy estimand and one arm per study.
2. VERIFY every number and citation (non-negotiable)

Before anything enters the report, verify each extracted effect and each citation (title, authors, year, journal, DOI, NCT/PMID) against its source. If a verbatim transcript artifact exists, regex-check each key value: rg -i "<keyword>" /mnt/results/execution_trace/transcript.jsonl. If the transcript is missing, verify directly against the fetched source and say exact-wording recovery is unavailable — never reconstruct numbers or references from memory. Fabricated effect sizes or citations are the worst possible failure here.

3. Run the meta-analysis

Run scripts/run_meta_analysis.R. Set the config block or pass env vars:

META_INPUT=data/extraction_table.csv META_OUTDIR=/mnt/results/<run> \
META_MEASURE=MD META_SUBGROUP=subgroup META_TOPIC="<topic>" \
Rscript scripts/run_meta_analysis.R

Defaults (opinionated, documented in references/methodology_notes.md): random-effects, REML, Hartung-Knapp CI, prediction interval, subgroup Q test. The script auto-installs meta/metafor to /workspace/.Rlib if missing and emits all CSVs + 4 figures. Escape hatches: META_TAU=DL, META_HK=FALSE (document any deviation).

4. Robustness (already produced by the script — interpret it)
Leave-one-out (leaveoneout.csv): confirm no single study flips the conclusion.
Influence (influence_diagnostics.csv): note influential studies (Cook's D, studentized residual) but investigate rather than delete — usually genuine effect variation, not error.
Small-study effects (smallstudy_test.txt): Egger reported for completeness; only call it publication bias when k >= 10. With fewer studies, asymmetry is confounded by true heterogeneity.
5. Risk of bias

Write a structured narrative data/risk_of_bias.csv (columns: study, randomization, deviations, missing_data, measurement, selective_report, overall; Low / Some concerns / High). This is a narrative aid, not an automated RoB2 score — say so in the report.

6. Media-check every figure

For each PNG in figures/, run the Read tool and directly inspect the returned media. If a figure is blank, clipped, unreadable, or low quality, fix and regenerate before continuing. (In the source workflow the funnel plot needed back="white" and a solid reference line; the leave-one-out needed wrapped labels and wider margins.)

7. Build the infographic (GenerateImage)

Create a one-page conceptual infographic with the GenerateImage tool summarizing: the headline pooled effect + CI, the direction/magnitude, the effect ordering by subgroup (if any), heterogeneity in plain words, and the take-home message. Save it as figures/infographic.png. Media-check it. This is a schematic visual, so it MUST use GenerateImage, not plotting code. If GenerateImage is unavailable, the report still builds without it (documented fallback).

8. Build the PDF report

This skill chains the pdf-report-generation skill's conventions (brand palette, ReportLab Platypus patterns, <super>/<sub> tags never Unicode, hAlign='CENTER', KeepTogether for figures). Write a config.json (see the header of scripts/build_report.py for all keys: title, subtitle, measure, effect_word, outdir, out_pdf, infographic, narrative with background/interpretation/limitations/next_steps, and references with real DOIs). Then:

python scripts/build_report.py config.json

The report includes the infographic, intro, methods, results (all 4 figures + tables), discussion, limitations, next steps, references, and a PRISMA appendix. The script validates the PDF (pypdf: pages, size, extractable text). Then media-check the rendered PDF pages and regenerate on any defect.

9. Save a computational-record notebook

Save the code + key outputs to /mnt/results/execution_trace/<machine_id>.ipynb for reproducibility.

Environment resources this skill uses
Resource    Role
LiteratureSearch (Biomni)    Study discovery; filters by year, study type, journal quality, human-only
Direct Python/R imports and CLI checks    Confirm required packages/tools before running
R: meta, metafor    Pooling engine + diagnostics (auto-installed to /workspace/.Rlib if absent)
R: ggplot2, ggrepel, patchwork    Leave-one-out & heterogeneity/influence figures (base-R fallback if absent)
Python: reportlab, pypdf, Pillow    PDF assembly + validation + figure sizing
GenerateImage    Executive infographic (schematic visual)
pdf-report-generation skill    Brand conventions the report follows
Scientific caveats
One measure per pool. Log-transform OR/RR/HR before pooling; the script does this automatically when measure is a ratio.
Random-effects, not fixed, is the default; under heterogeneity a fixed/common-effect CI is overconfident. The prediction interval is often more decision-relevant than the CI.
Do not mix estimands or designs naively. Separate RCT vs observational (use design subgroup); keep change-from-baseline distinct from post-lead-in "additional" change.
Egger/funnel need k >= 10 to interpret as publication bias.
Never fabricate or impute an effect size or citation; verify everything (Step 2).
Worked example

The evidence-synthesis-meta-analysis skill was distilled from a full GLP-1-receptor-agonist weight-loss review (8 RCTs, pooled MD -10.93 percentage points, I-squared 98.5%). Use that as a mental template for a continuous-outcome, literature-driven run; the same scripts handle a user-supplied OR table with only a config change.

Test prompts (representative triggers)
"Meta-analyze the effect of SGLT2 inhibitors on HbA1c versus placebo across published RCTs." (continuous MD, literature-driven)
"Here's a CSV of 12 trials with odds ratios and 95% CIs for statins and new-onset diabetes — pool them and give me a forest plot and PDF." (binary OR, user table)
"Synthesize the evidence on whether Mediterranean diet reduces cardiovascular events; include heterogeneity and a publication-bias check." (ratio outcome, full robustness)

30. experimental-design-statistics
Category: EXPERIMENTAL DESIGN
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

31. fine-mapping-susie
Category: GENOMICS & GENETICS
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

32. flow-cytometry-analysis
Category: PROTEOMICS & METABOLOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

33. free-wilson-analysis
Category: DRUG DISCOVERY
Source: https://biomni.phylo.bio/skills?section=marketplace

Free-Wilson Analysis

Free-Wilson (Free & Wilson, 1964) models activity as a constant plus one additive contribution per substituent at each R position. It answers "which substituents help or hurt at each position" and "which unmade combinations of known substituents should be most active". It cannot propose new substituents or extrapolate beyond the ones measured.

Use the printed Skill Directory as SKILL_DIR.

1. Decompose with r-group-decomposition

Load and follow the installed r-group-decomposition skill. It settles one comparable measurement, runs molecular-dataset-qc when needed, chooses or accepts the core and writes rgroup_table.csv. For Free-Wilson:

An activity column is required, on a log scale (pIC50, pKi, ...). Use its relation handling and activity-transform so censored values stay bounds.
Free-Wilson needs every substituent to recur across compounds and positions to be fixed, so a user-supplied Markush core with labelled attachment points ([*:1], [*:2]) and only-match-at-rgroups=true is preferable to an automatic core when the user has one in mind.
Its PDF question covers both skills: when the user wants a PDF, build one (step 4) that includes the decomposition.
Check its coverage, scaffolds and core figure before continuing. Model one realized scaffold at a time; never pool scaffolds.
2. Fit the model
python3 "$SKILL_DIR/scripts/free_wilson.py" \
  --input "$RGD_RESULTS/rgroup_table.csv" \
  --output-dir /mnt/results/free_wilson \
  --activity-label pIC50

RGD_RESULTS is the results directory of the step 1 run. Use a separate output directory per run.

Option    Use
--scaffold-id    Another realized scaffold (1 is the largest).
--cv-folds k    k-fold instead of the default leave-one-out.
--group-column    Hold out groups together (leave-one-group-out, or group k-fold with --cv-folds). Add the column to a workspace copy of rgroup_table.csv by joining on id: a series, batch or chemotype. Groups are exchangeable, so later groups train predictions of earlier ones: this is not chronological validation, which the script does not support.
--alphas    Comma-separated ridge alphas instead of the default 13 values from 1e-3 to 1e3.
--no-enumerate    Fit only.
--max-products    Enumeration ceiling (default 200,000 combinations); above it enumeration is skipped and every fit output is still written.

The defaults (leave-one-out, the alpha grid) suit small congeneric series. When size or grouping make another design more honest, choose it, and record the choice and the reason. When the user needs forward-in-time validation, say that this script does not provide it.

What the script does:

Takes the scaffold's rows; exactly measured compounds form the training set. Censored and unmeasured compounds are predicted, never fitted.
Builds one 0/1 column per substituent observed at each label among exact compounds, as in Walters' and RDKit's Free-Wilson implementations, and fits ridge regression (one-hot columns are collinear, so plain least squares is ill-posed) with alpha chosen by efficient leave-one-out.
Cross-validates with alpha re-tuned inside every training set. A held-out compound is cv_supported only when its training fold carries information on all of its substituents; a compound with a substituent seen nowhere else is unsupported in leave-one-out.
Checks identifiability. A prediction is determined by the data only when its design vector lies in the row space of the measured design; otherwise it depends on how ridge shares effects. rank_deficiency counts what the data cannot separate, comparable_group splits each label into substituents whose differences are determined, confounded_with names substituents that always occur together, and estimable marks determined predictions.
Rebuilds every measured compound from its own R-groups to check the assembly (reconstruction), then enumerates untested combinations of measured substituents, joins them to the core with Chem.molzip (geminal pairs included), and merges equivalent assignments of one molecule into a single row with their prediction range.
Writes the tables, figures and the interactive report below. With zero variance in the exact activities, R² and q² are undefined (model.status = "zero_variance"), not 1.
3. Read the results

Quote every number from fw_summary.json and the CSVs.

Model quality: q² and cross-validated RMSE against training R² and the activity SD, with the supported-only q². Poor prediction can come from sparse coverage, singleton substituents, rank deficiency, shrinkage, measurement noise or nonadditivity; the fit alone does not say which, so name the likely causes the diagnostics support rather than concluding one.
Contributions: per label, the most positive and negative substituents with n_exact. Every substituent has its own column and ridge shrinks toward zero, so compare substituents only within one label and one comparable_group. A coefficient from one exact compound mostly absorbs that compound's residual.
Compounds to investigate: large residuals among cv_supported compounds, and censored compounds whose prediction contradicts the bound. They may reflect interacting substituents, a changed binding mode or a measurement problem. Unsupported residuals carry no information. Nonadditivity is common (about every second AstraZeneca in-house assay and every third public ChEMBL assay show significant cases, Gogishvili et al., 2021), but establishing it needs double-transformation cycles and an experimental-uncertainty estimate (Kramer, 2019); say that rather than labelling a compound nonadditive.
Proposals: prefer estimable rows with good min_support; flag rows with several assignments and a wide prediction range, and compare predictions with activity_max, the best measured value. If reconstruction shows mismatches, say the assembled structures need checking.

Point the user first to fw_report.html, then show both figures inline.

4. PDF report (on request)

Build a PDF only when the user asks for one, following references/pdf-report.md.

Outputs (under the chosen output directory)
Output    Content
fw_report.html    Self-contained interactive report: contributions with structures, observed vs cross-validated plot (unsupported points hollow), compound table, ranked proposals; filter by substituent or to estimable proposals
fw_coefficients.csv    label, substituent, coefficient, n, n_exact, comparable_group, confounded_with
fw_predictions.csv    every scaffold compound: observed, relation, fitted, cv_predicted, cv_residual, cv_supported; for unfitted compounds predicted, estimable, consistent_with_bound; R-groups
fw_enumeration.csv    untested molecules (when enumerated): rank, SMILES, predicted with min/max over assignments, estimable, min_support, n_assignments, assignments, R-groups
fw_summary.json    counts, identifiability, validation design, model metrics and status, reconstruction, enumeration status, software versions
figures/fw_observed_vs_predicted.png    cross-validated predictions against observed values
figures/fw_coefficients.png    per-label coefficient bars with n_exact and comparable groups
report_free-wilson-analysis.pdf    only when requested (step 4)
Caveats
Additivity is an assumption of the model, not a result of the fit.
Only measured substituents are recombined. A substituent seen only in censored or unmeasured compounds has no coefficient, and compounds carrying it get no prediction.
Labels come from the decomposition: a symmetric core can place equivalent substituents under different labels (merged in the proposals), and a substituent attached at two core positions couples those labels. Combinations that cannot form one molecule are counted as n_not_assemblable and skipped.
Small series give unstable q² whatever the design.
Sources
S. M. Free and J. W. Wilson, J. Med. Chem. 1964, 7, 395–399.
P. Walters, Free-Wilson analysis notebook, practical_cheminformatics_tutorials (MIT), and Practical Cheminformatics blog, 2018: one-hot encoding, ridge regression, enumeration with molzip.
B. Kelley, RDKit Contrib FreeWilson (BSD-3-Clause), 2021.
C. Kramer, J. Chem. Inf. Model. 2019, 59, 4034–4042 (nonadditivity analysis); D. Gogishvili et al., J. Cheminform. 2021, 13, 47; L. Guasch et al., J. Comput. Aided Mol. Des. 2024, 38, 26.
Software: RDKit and scikit-learn (BSD-3-Clause), Matplotlib (PSF-based licence).

34. functional-enrichment-from-degs
Category: FUNCTIONAL ANALYSIS
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

35. generative-molecule-design
Category: MOLECULAR DESIGN
Source: https://biomni.phylo.bio/skills?section=marketplace

Generative Small-Molecule Design

An agent-led workflow for computational molecular ideas. Choose the method and evidence appropriate to the question. Use existing skills for molecular QC, medicinal-chemistry filters and reporting when needed; write small run-local glue yourself. A target name alone does not supply an activity model. Searching an existing library belongs in a virtual-screening workflow.

Use the printed Skill Directory as SKILL_DIR; add its scripts/ to Python's import path. Local helpers require Python 3.11+, RDKit (including bundled SA_Score), NumPy and pandas. Install only missing dependencies for the selected path: SELFIES for STONED; medchem through med-chem-filters. REINVENT uses the existing HPC tool, with no local model installation. See sources and provenance; record versions actually used.

1. Agree on the design task

Establish reference/seed structures, task, target evidence, desired properties, fixed features, candidate count and compute budget. Reuse answers already supplied. Ask unless already answered or explicitly delegated:

How should we balance new chemical ideas with synthetic constraints?

Balanced (recommended): explore with a modest preference for lower synthetic complexity.
Exploration-first: allow broader changes and annotate accessibility concerns.
Synthesis-constrained: favor conservative changes and enforce supplied structural or reaction constraints. Which scaffold, stereochemistry, attachment points, reactions or starting materials must stay fixed? Are reactive motifs intentional, such as covalent warheads or prodrug groups?

Record the choice, rationale and hard constraints. A delegated choice defaults to balanced. Also ask, unless already answered: "An interactive HTML report and CSVs are included. Would you also like a PDF report?" Combine this with the other intake questions when practical. Search breadth and SA preference are separate choices: suggest one SELFIES mutation for conservative analogs, two for balanced exploration, or three for broader ideas; adjust to the task. Use chirality-aware DesignConstraints(required_smarts=..., forbidden_smarts=...) and project-specific heavy-atom bounds (helper defaults 8–50). A SMARTS without stereochemical labels does not preserve configuration. Apply hard constraints in every mode, without automatic relaxation.

Preserve three synthesis-related capabilities: SA heuristics, optional reaction-constrained generation, and handoff to a separate retrosynthesis workflow. SA and a fixed scaffold do not prove makeability. Stock membership or complete routes require explicit checks in that other workflow.

2. Choose scoring and generation

Use a qualified target-specific scorer when available; retain its assay definition, units, evaluation and applicability domain. Reuse existing property/ADMET or modeling skills when applicable.

If a supplied file pairs molecular structures with properties of interest (such as potency, solubility or logP), inspect its labels and data quality. Unless the user has already chosen a scorer or decided whether to train a model, ask before defaulting to similarity or property-only exploration. When asking, explain that model training, validation and REINVENT RL usually require more compute than the cheaper alternatives. Give a brief comparison of the relevant options:

Approach    Typical relative compute    Advantages and limitations
Train Chemprop + REINVENT RL    Higher; GPU training and iterative optimization    Uses the supplied endpoint to steer generation; needs suitable labels and useful validation, and can exploit model errors.
Local GA or STONED with similarity or cheap property scores    Lower; CPU, no model training    Fast analog exploration or direct property optimization; similarity and general properties alone do not optimize or establish potency.
REINVENT sampling + local scoring    Usually lower than training + RL; still uses HPC    Generates ideas from a learned prior and can reuse an existing scorer; sampling does not adapt to the objective, and potency ranking still needs a suitable predictor.

Compare the proposed budgets: data size, sample/step counts and scorer cost affect the tradeoff. Recommend a route for the user's goal, data and compute budget; training is appropriate when a predictor would be useful and the data look suitable.

Your file includes [endpoint and units]. Would you like us to train and evaluate a property model on these data, then use it to guide REINVENT optimization if validation supports it? This is the more computationally expensive route. Cheaper options are local GA/STONED exploration or REINVENT sampling with local scoring, with the tradeoffs above. I recommend [option and why]. Which approach fits your goals and budget?

Combine this with intake questions when practical; reuse prior answers or explicit delegation. If training is selected, confirm the endpoint, label provenance, units and optimization direction. Use molecular-dataset-qc if curation is needed, then the existing Chemprop HPC tool to train and evaluate a compatible property predictor with a leakage-aware held-out split appropriate to the design task. Use a suitable model through REINVENT's ChemProp2 scorer for goal-directed RL; see the HPC reference. If data or validation do not support a useful predictor, explain the limitation and agree another strategy. Existing TDC/model callables can also be supplied directly; do not treat decoys or unlabeled compounds as known inactives.

Without activity evidence, offer ligand similarity or property-driven exploration and label it accurately. scoring.make_similarity_backend(references) returns the maximum sparse binary Morgan radius-2 Tanimoto across references. These references alone cannot establish chemical or patent novelty.

ScoringFunction(primary_fn=..., primary_transform=..., sa_weight=0.35) combines normalized primary desirability, QED and a lower-SA preference by weighted geometric mean. Primary values must be [0,1] or have an explicit transform; raw regression predictions must not be clipped to this interval. Suggest SA weights 0 for exploration, 0.35 balanced, 1 synthesis-constrained. These are adjustable design preferences, with no default hard QED/SA cut. Omit primary_fn for properties only; adjust QED or primary weights if needed. SA remains annotated at weight zero. For other objectives, wrap a small normalized batch scorer as primary_fn with qed_weight=0 and sa_weight=0.

Task    Starting choice
Goal-directed de novo ideas    REINVENT de novo or local graph GA
Analogs around a lead    REINVENT Mol2Mol or STONED/SELFIES
Decorate a fixed scaffold    REINVENT LibInvent
Connect two fragments    REINVENT LinkInvent; assess 3D geometry separately
Explore scaffold changes    GA, STONED or suitable REINVENT prior with explicit core checks

Run one engine by default. For local generation, call graph_ga.run_ga(seeds, scorer, constraints=...) or stoned.run_stoned(seeds, scorer, constraints=..., max_mutations=2). Both return (history, archive, first_seen): progress, canonical SMILES-to-fitness, and first iteration. Use explicit population/generation budgets and random seed. Archives can include starting seeds. STONED is a bounded, training-free SELFIES search, not a reproduction of published benchmarks. See the small local example.

For REINVENT, read the HPC reference and the live reinvent4 catalogue. Author a native sampling or single-stage RL config; prepare_reinvent(config) returns a checked copy with isomeric_smiles=true; baked-in LibInvent priors also use randomize_smiles=false to retain scaffold stereo. It does not write files or submit jobs. RL needs an offline in-image scorer. For a local-only scorer or multi-reference maximum-similarity objective, use sampling then local scoring. Never substitute an unrelated RL objective without agreement. For LibInvent, optional native ReactionFilter checks supplied attachment reactions using selective or nonselective rules. LinkInvent reaction filtering and definedselective are unsupported in this image. Check a small chemically reviewed pilot in the deployed image before a larger constrained campaign; retain its evidence. Reaction compatibility does not establish routes, conditions or stock availability.

3. Assess candidates

Retain raw generator records. For REINVENT, call import_reinvent(csv_path, submitted_config, constraints) with the exact submitted config: it returns accepted and excluded native rows. Persist both. It enforces native reaction/alert filter outcomes before deduplication; missing filter evidence stops import. Assess only accepted products, using their canonical_smiles; keep native scores and attachment context separately. Independent local scores must be labeled as such if objectives differ.

Use select_and_filter.assess_candidates(smiles, scorer, references, constraints) for unique exact structures, stable design_id, cached raw/desirability/composite scores, properties, scaffold, reference similarity and constraint reasons. Use the same immutable scorer instance throughout a local run. Identity uses design_constraints.canonical_smiles, ignoring maps while retaining stereochemistry, isotopes and charges. Keep raw inputs and conditional-generator attachment labels intact. For local archives, join generation_fitness and gen_first_seen by canonical SMILES into the delivered candidate table and verify generation_fitness matches combined. Label independent reassessments separately. Apply agreed gates to form a larger eligible pool before final top-N selection; record exclusions in the candidate table. Exclude exact seed/reference structures from proposed new designs by default. Do not impose a universal novelty cutoff. If normalization is needed, use molecular-dataset-qc and rescore changed structures; preserve stereochemistry and structure identity across handoffs.

4. Recommend a gentle medicinal-chemistry assessment

Load med-chem-filters and follow its profiling, user decision and removal-review workflow. The scope here is the lightweight panel only, including scratch profiling: no Lilly installation, strict property cuts or blanket reactive-group rejection.

Recommend consensus rejection at 5 of 9 expert sets: Glaxo, Dundee/Brenk (one vote), BMS, pooled PAINS, SureChEMBL, MLSMR, Inpharmatica, LINT and NIH. NIBR and chemical-sanity checks are annotations. Individual alert hits remain visible; list agreement is a heuristic because rules overlap. For intentional reactive motifs, unusual modalities or tight series, suggest annotations only or context-specific roles.

Have that skill profile the chosen panel and ask once, using actual counts:

I recommend a gentle pass: remove candidates flagged by at least five of nine expert sets; retain other alerts, NIBR and sanity checks as annotations. This would remove X of N. Choose gentle filtering (recommended), annotations only, skip, or customize.

Reuse an existing decision or explicit delegation; otherwise wait for the answer. A failed assessment is not a skip. Pass only design_id,smiles to avoid column collisions; join the sibling's results by unique ID and verify complete coverage and unchanged canonical isomeric structures. Its rejecting modes produce pass/fail tables; annotation-only produces annotated_all.csv. Retain reasons and follow its review of removed molecules. No custom bridge or copied alert logic is needed.

5. Select and deliver

Call select_top(eligible, top_n=10, max_similarity=0.85) on the agreed, assessed pool. It ranks by composite score and greedily applies the optional pairwise similarity cap (None disables it). There is no scaffold quota. State the chosen cap, counts and any shortfall; never relax gates silently.

Deliver generated_candidates.csv with scores, assessment decisions and exclusion reasons; selected_candidates.csv; an interactive report.html; and concise run metadata recording task, structures, objective/units/transforms, synthesis balance, constraints, generator/model versions, seed, budget and filter choice. Retain raw HPC files and the sibling filter outputs when used; avoid duplicate intermediate exports. An empty shortlist is valid and should be explained.

The shortlist and metadata are also the handoff to a separate retrosynthesis skill when requested. State synthetic routes not assessed. This skill does not install or invoke AiZynthFinder.

Create the HTML report by default with run-local code and default Phylo styling. Make it self-contained for offline use, embedding data and molecule drawings. Include a concise scientific interpretation, run settings and selection/filter counts, and a sortable, filterable candidate table with structures, scores, properties, alerts, exclusion reasons and shortlist membership. Use the delivered tables and metadata as the source of truth, and link the CSV downloads. Inspect it in a browser and check that structures, sorting, filtering and displayed counts work. Explain an empty shortlist in the report. Generate task-specific plots only when they add information; sampling has no convergence history.

If the user requests a PDF, load pdf-report-generation and produce it from the same results, using default Phylo styling and that skill's rendering and visual-validation workflow. Provide the PDF alongside the default HTML and CSV outputs. State that scores, QED, SA and alerts are heuristics susceptible to optimizer exploitation; designs are experimentally untested. Cite evidence used for target rationale and model/data provenance.

36. genetic-constraint-gating
Category: GENOMICS & GENETICS
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

37. genetic-variant-annotation
Category: GENOMICS & GENETICS
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

38. grn-pyscenic
Category: TRANSCRIPTOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

39. gwas-to-function-twas
Category: GENOMICS & GENETICS
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

40. immune-repertoire-airr
Category: TRANSCRIPTOMICS
Source: https://biomni.phylo.bio/skills?section=marketplace

TCR/BCR Immune Repertoire Analysis (AIRR)

Descriptive repertoire profiling of one or more adaptive-immune-receptor samples with the R package immunarch, plus a Phylo-branded PDF report. Covers the four canonical axes — clonality, diversity, V/J gene usage, and repertoire overlap — with interpretation that adapts to data modality (single-cell vs. bulk) and receptor (TCR vs. BCR).

The skill ships two tested, parameterized scripts. Run them as the default path; do not regenerate the analysis logic ad hoc (the immunarch return structures and the modality/Chao1 handling are subtle and already verified — see references/immunarch_api_notes.md).

Scope

Does: load AIRR/repertoire files (auto-detecting format), compute per-sample clonality, diversity (richness + evenness + rarefaction), V/J gene-segment usage with cross-sample similarity, and pairwise clonotype overlap; run optional group comparisons; and produce a PDF report (infographic + intro + methods + results + conclusions + figures + references + next steps).

Does NOT: reconstruct B-cell somatic-hypermutation lineages (Change-O / Immcantation territory), integrate paired single-cell gene expression / phenotype, assemble raw FASTQ into clonotypes (assumes clonotypes are already called by Cell Ranger / MiXCR / immunoSEQ), or perform disease-outcome inference on underpowered cohorts. It is descriptive/exploratory unless the cohort has a real biological contrast with adequate n.

Inputs

Any format immunarch::repLoad() auto-detects, one file (or Cell Ranger output folder) per sample in a single directory:

Source    Typical file    Modality
10x Genomics Cell Ranger V(D)J    filtered_contig_annotations.csv    single-cell
Adaptive Biotechnologies immunoSEQ    *.tsv    bulk
MiXCR    *.clones.txt / *.clns export    bulk
AIRR-C Rearrangement    *_airr.tsv (_rearrangement.tsv)    either
immunarch native    .txt/.tsv    either
Optional metadata: metadata.txt (tab-separated, first column Sample) in the same directory, giving group columns (e.g. Group, Timepoint, Response) for comparisons. If absent, the skill runs descriptively and can build simple grouping from sample-name tokens.
Receptor/chain: auto-detected from V-gene prefixes; override if needed.
Expected size: designed for up to a few dozen samples; each sample thousands to ~10⁵ clonotypes. Larger cohorts still run but keep figures legible.

If the user has no data, offer a bounded public fallback (e.g. 10x Genomics demo V(D)J samples such as sc5p_v2_hs_PBMC_1k, sc5p_v2_hs_PBMC_10k) purely to demonstrate the workflow — state clearly it is a demo, not the user's biology.

Outputs

Written under REP_OUT_DIR (default /mnt/results/repertoire/):

tables/ — sample_summary.csv, diversity_metrics.csv, clonality_top.csv, clonality_homeo.csv, geneusage_V.csv, geneusage_J.csv, overlap_public.csv, overlap_morisita.csv, overlap_flagged_pairs.csv, and wilcoxon_tests.csv (if groups defined).
figures/ — clonality (homeostasis, top-clones), diversity (all-metrics, rarefaction), gene usage (V, J, JS heatmap, correlation heatmap), overlap (shared- clonotype heatmap, Morisita-Horn heatmap). Both PNG and editable SVG.
analysis_metrics.json — machine-readable receptor/chain/modality flags + key ranges (consumed by the report generator).
report_repertoire_analysis.pdf — the final report.
Environment / installation (READ THIS FIRST)

immunarch is not preinstalled. Install version 0.9.1 (the classic in-memory loader) — NOT current CRAN, which pulls immundata→duckdb and compiles pathologically slowly (>40 min) for zero benefit here.

Provision a multi-core machine with ManageMachine (8 CPU). worker-0 (1 CPU) is too slow for the build.
Install:
.libPaths("/workspace/.Rlib")
options(repos = "https://cloud.r-project.org", Ncpus = 8)
Sys.setenv(MAKEFLAGS = "-j8")
install.packages("ggraph")                          # dep that fails if skipped
remotes::install_version("immunarch", version = "0.9.1",
                         dependencies = NA, upgrade = "never")
dependencies = NA (not FALSE) installs required deps only. Full detail and the "why" are in references/immunarch_api_notes.md.
ggplot2, dplyr, tidyr, jsonlite are preinstalled. reportlab, pypdf, pandas, PIL are preinstalled for the PDF step.
Workflow

Use McPAS-TCR or VDJdb for optional antigen annotation and hpc_search_tools for HPC capabilities such as ImmuneBuilder.

Stage inputs. Put one file/folder per sample in REP_DATA_DIR (default /mnt/shared-workspace/shared/rep_data/). Add metadata.txt if group comparisons are wanted. Confirm the source format with the user.

Install immunarch 0.9.1 on an 8-core machine (see Environment above). Skip if already present in /workspace/.Rlib.

Run the analysis script. scripts/repertoire_analysis.R is fully parameterized via environment variables (all optional; sensible defaults):

REP_DATA_DIR=/mnt/shared-workspace/shared/rep_data \
REP_OUT_DIR=/mnt/results/repertoire \
REP_RECEPTOR=auto REP_CHAIN=auto REP_MODALITY=auto \
REP_GROUP_COLS=Group REP_SPECIES=hs \
Rscript scripts/repertoire_analysis.R

The script auto-detects receptor (TR* → TCR, IG* → BCR), chain (default TRB for TCR, IGH for BCR), and modality (singleton fraction ≥ 0.85 → single-cell), then writes all tables, figures, and analysis_metrics.json. Override any auto value if you know better.

Modality branch — the scientific crux. How results are interpreted depends on modality (the script records it; the report enforces it):

Single-cell (e.g. 10x): abundance = cells. Nearly every clonotype is a singleton, so Chao1 richness is inflated and unreliable (verified: up to ~3×10⁵ vs. hundreds–thousands of observed clonotypes). Rank samples by evenness (Shannon, inverse Simpson, Gini-Simpson, D50) and rarefaction. Frame "clonality" as clonal-space homeostasis / top-clone occupancy, NOT PCR expansion.
Bulk (e.g. immunoSEQ, MiXCR): abundance = templates/reads. Chao1 and richness estimators are trustworthy; clonal expansion is real biology (report top-clone fractions and the hyperexpanded bin). Depth-normalize before comparing richness.

Overlap interpretation. The script flags sample pairs whose shared-clonotype count is far above the cross-sample background (overlap_flagged_pairs.csv). Because an individual's repertoire is essentially private, a flagged pair almost always means a shared biological source (same donor / replicate / contamination) — a built-in consistency check, not a biological discovery. (Verified example: two chemistries of one donor shared 202 clonotypes vs. ≤14 for unrelated pairs.)

Group comparison (optional). If a 2-level group column exists, the script runs two-sided Wilcoxon rank-sum tests on scalar metrics (exact=FALSE) and labels them exploratory when the smaller group has n < 4 (small n cannot yield small p-values).

Gather citations. Use LiteratureSearch for methods/interpretation references. references/citations_seed.json provides a verified starting set (immunarch, diversity metrics, evenness robustness, BCR clonal definition). Save the citations you use as <REP_OUT_DIR>/citations.json (a list of {"n":int,"text":str}).

Build the infographic (schematic). Generate the one-page visual summary with the GenerateImage tool (it is a schematic — workflow + headline finding — NOT a data plot). Save it as <REP_OUT_DIR>/infographic.png. If GenerateImage is unavailable, skip it; the report degrades gracefully.

Generate the PDF report. scripts/make_report.py reads analysis_metrics.json, the tables, the figures, citations.json, and the optional infographic, and writes a modality/receptor-aware report:

python3 scripts/make_report.py --out-dir /mnt/results/repertoire \
  --pdf /mnt/results/report_repertoire_analysis.pdf \
  --title "Immune Repertoire Analysis"

It follows the pdf-report-generation skill (load that skill for branding/layout conventions): Phylo palette, infographic summary, Introduction, Methods, Results, Conclusions (with modality/BCR limitations), References, and Next steps, and it runs a validation gate (pages ≥ 5, size > 20 kB, extractable text).

QC every figure and the PDF. Run the direct visual inspection using ordinary Read on each key figure PNG and on rendered PDF pages; regenerate anything blank, clipped, or unreadable before delivering.

Scientific caveats
Single-cell Chao1 is an artifact. Never report inflated single-cell Chao1 as richness. Evenness indices (Gini-Simpson, Pielou/Shannon, inverse Simpson) are the most robust across data types [4]; prefer them plus rarefaction for cross-sample ranking.
BCR ≠ TCR. For BCR, somatic hypermutation means an exact-CDR3 clonotype is not a clonal lineage [5]; isotype/class-switch structure is not modeled. Never silently call exact-CDR3 matches "clones/lineages" for BCR. Full SHM lineage reconstruction is out of scope (use Immcantation/Change-O separately).
Depth confounds diversity. Deeper samples look more diverse. Use rarefaction (and, for bulk, depth-matched subsampling) before comparing.
Overlap ≠ biology by default. High overlap almost always flags shared source, not a shared antigen response — verify sample provenance first.
Small n = exploratory. Group tests on a few samples per arm are descriptive; do not over-interpret p-values. Move to inference only with adequate, balanced n.
repDiversity(.method="entropy") is invalid in 0.9.1 — Shannon is computed manually from clonotype proportions (handled by the script).
10x rows are paired chains (TRA;TRB); gene usage uses .ambig="exc" so only the requested chain contributes.
FUSE writes: figures are written to /workspace then copied to /mnt/results (R's file.copy to S3 FUSE yields 0-byte files); the script handles this.
Optional enrichment (graceful-skip)
Antigen specificity: annotate public/expanded CDR3β against McPAS-TCR (Biomni datalake) or VDJdb to suggest antigen associations. If the database is not mounted / resolvable, skip and say so — do not fabricate antigen calls.
Receptor structure: for a few clones of interest, predict 3D structure with ImmuneBuilder (Biomni HPC: TCRBuilder2 / antibody models). Optional; not part of the default path.
Bundled files
scripts/repertoire_analysis.R — parameterized, modality-aware immunarch analysis.
scripts/make_report.py — parameterized ReportLab PDF generator.
references/immunarch_api_notes.md — verified 0.9.1 API return structures, install recipe, modality/Chao1 rationale, FUSE gotchas. Read before editing the R script.
references/citations_seed.json — verified starting citations.
Test prompts
"I have 10x Cell Ranger TCR filtered_contig_annotations.csv files for 6 PBMC samples — analyze the repertoires and make a report." (single-cell TCR; expect Chao1 flagged as artifact, evenness emphasized.)
"Run clonality and diversity on my Adaptive immunoSEQ TCRβ bulk samples, responders vs non-responders." (bulk TCR + group test; expect Chao1 trusted, clonal expansion reported, Wilcoxon.)
"Profile my 10x BCR (IGH) repertoires." (BCR edge case; expect IGH auto-detection and explicit SHM / exact-CDR3-≠-lineage caveats.)
"Annotate the expanded clonotypes with antigen specificity" when no antigen DB is mounted. (Expect graceful skip with a clear message, not fabricated antigens.)

41. knowledge-graph-target-reasoning
Category: DRUG DISCOVERY
Source: https://biomni.phylo.bio/skills?section=marketplace

Knowledge-Graph Target Reasoning

Rank therapeutic targets (genes/proteins) for a disease by propagating disease seed genes across PrimeKG with Random-Walk-with-Restart, folding in an optional TxGNN drug-target evidence layer, explaining every top hit with explicit multi-hop evidence paths, validating the ranking against known drug targets, attaching literature support, and rendering a Phylo-branded PDF report.

This skill is disease-agnostic — the disease is specified only by its PrimeKG disease node id(s), which the skill resolves from a plain name.

Scope
Does: produce a prioritized, auditable ranking of candidate targets for a disease, with evidence paths, a face-validity check, per-target literature support, figures, and a PDF report.
Does NOT: perform statistical inference or causal testing (no p-values/FDR); it is discovery/hypothesis-generation. Human targets only. The RWR network is PrimeKG (+ TxGNN drug-target layer in academic mode); it does not merge STRING or other networks into the propagation (those are recommended follow-up cross-checks). Commercial mode does use Open Targets for two license-clean layers — genetic-association seeds (replacing DisGeNET) and the clinical known-target label — but not as additional network edges.
When to use

Target/gene prioritization or discovery for a disease; "what to drug", "which genes drive <disease>", network/KG-based target ranking, repurposing-informed target hypotheses.

When NOT to use / hand off:

Association-database lookup for a target–disease pair → open-targets skill.
Variant/GWAS-to-gene mapping → genetics/variant-annotation skills.
Pure literature synthesis → literature-review skill.
Compound/chemistry work → ChEMBL / pharmacology tools.
Inputs
Input    Source    Notes
PrimeKG CSV    PrimeKG    The knowledge graph.
TxGNN prediction pkl    TxGNN    Academic mode only; drug-target layer, dict keyed by disease name. Ignored in commercial mode (DrugBank-derived).
TxGNN name-mapping pkl    TxGNN    Academic mode only; find the TxGNN key for a disease.
Open Targets API    https://api.platform.opentargets.org (no key)    Commercial mode; supplies the CC0 genetic-association seeds via ot_disease_seeds.py (replacing DisGeNET seeds) and the CC0 clinical known-target label via ot_known_targets.py.
Disease seeds    PrimeKG disease_protein (academic; DisGeNET-derived) or Open Targets genetics (commercial; CC0)    Academic uses PrimeKG's DisGeNET seeds; commercial replaces them with OT genetics (Step 0b).
Disease name(s)    user    One or more; include subtypes/umbrella terms when relevant (e.g. a disease + its subtypes).

See references/resources.md for schemas/compute footprint (runs in ~seconds on the default machine — no GPU/HPC needed) and references/DATA_SOURCES.md for source-by-source licensing and the --edge-license modes.

Outputs (saved to /mnt/results/<disease>_target_ranking/)
ranked_targets.csv — all genes ranked, with scores + known/novel/ADME columns (commercial runs also add known_target_ot + ot_assoc_score from Open Targets).
meta.json — run provenance (anchors, seed counts, params, RWR iterations, runtime, edge_license, restricted_sources, and a provenance block of kept/dropped edges per relation and source); consumed by make_figures.py --meta and the report.
ot_seeds.json — (commercial) Open Targets genetic-association seeds (CC0) used to replace the DisGeNET-derived PrimeKG seeds (disease id, data version, seed list).
ot_known_targets.json — (commercial) Open Targets clinical label provenance (disease id, data version, #known targets).
evidence_paths.json — enumerated multi-hop paths for the top targets.
enrichment_check.json — face-validity self-check numbers (records label_kind: known_drug_target, seed_recovery, or the OT label column).
figures/ — core figures as PNG + editable SVG.
report_<disease>_target_prioritization[_commercial].pdf — the report.
Clarification questions (ask only what's missing)
Disease + subtypes — which disease? Any subtypes/related terms to include as separate anchors (umbrella terms often appear as multiple PrimeKG nodes)?
Edge license — commercial (default; RWR over commercially-usable sources, Open-Targets validation) or academic (adds DrugBank + TxGNN drug-target layer, needs_commercial_review)? Only ask if commercial-use intent is unclear.
How many top hits to explain with evidence paths + literature (default 10–12).
Report audience — internal triage vs. shareable deliverable (both use the same structure; affects tone/length).

If the user already gave a disease and a clear goal, proceed with sensible defaults and record assumptions.

Workflow

All scripts are in scripts/. Run them in order; each writes into the output dir.

Step 0 — Resolve disease name → PrimeKG anchor id(s)

The one manual step, automated. Discover candidate disease nodes and their seed counts (a node with ~0 seeds cannot drive a useful ranking):

python scripts/find_disease_anchors.py \
    --primekg "${PRIMEKG_CSV}" \
    --name "Parkinson"        # repeat --name for subtypes/related terms

Review the printed candidates; pick the id(s) with meaningful seed counts. Merge several PrimeKG nodes for one clinical entity by underscore-joining ids (e.g. "5011_5535"). Do not blindly take the first row — confirm the disease name matches intent. For the TxGNN layer, find the matching disease-name key in the TxGNN prediction dict (use txgnn_name_mapping.pkl).

Anchor-id caveat (underscore collision). PrimeKG disease node ids can themselves contain underscores — they are composite UMLS CUI groupings (e.g. the "Parkinson disease" node id is the single string 11764_11658_..._13167). This conflicts with the underscore-join convention for merging multiple nodes. The ranker and evidence-path scripts resolve this by checking the full raw anchor-id string against the parsed PrimeKG graph first: if the full string is itself a known disease node, it is kept verbatim; it is only split on _ when the full string is not a known single node. Use the find_disease_anchors.py output verbatim as the --anchor-id — do not manually split or reformat ids.

Licensing — read before running. This skill defaults to commercial mode, which is safe only when both of two independent steps are done: (1) it drops DrugBank-sourced PrimeKG edges via the x_source/y_source node-source columns, and (2) it replaces the disease seeds with Open Targets genetics (CC0) via --seeds-file, because PrimeKG's disease_protein seeds are DisGeNET-derived (non-commercial) and DisGeNET is invisible to the node-source filter (those columns record node vocabularies, not edge-evidence sources — see the critical note below). Commercial mode also disables the TxGNN layer (it needs DrugBank edges) and validates with Open Targets (CC0). Use --edge-license academic only for internal/non-commercial work — it keeps the DisGeNET seeds + DrugBank + TxGNN and is flagged needs_commercial_review. See the Licensing & edge-license modes section and references/DATA_SOURCES.md.

CRITICAL — node vocabularies ≠ edge-evidence sources. PrimeKG's x_source/y_source record the ontology each endpoint node came from (gene=NCBI, disease=MONDO, drug=DrugBank, pathway=Reactome), not the database that supplied the relationship's evidence. So the edge filter catches DrugBank (drug nodes) but cannot catch DisGeNET or KEGG, which are edge-evidence sources — DisGeNET is PrimeKG's source for the disease_protein seed associations yet those edges read NCBI/MONDO. Filtering alone therefore cannot make the seeds commercial-safe; the seeds must be replaced (Step 0b/1).

Step 0b — Commercial-safe seeds (Open Targets genetics; commercial mode only)

Because PrimeKG's disease_protein seeds are DisGeNET-derived (non-commercial) and cannot be cleared by the edge filter, commercial mode replaces them with Open Targets genetic-association targets (CC0 1.0):

python scripts/ot_disease_seeds.py \
    --disease-name "Parkinson disease" \
    --top-n 100 \
    --out /mnt/results/PD_target_ranking/ot_seeds.json

Writes a --seeds-file (JSON seeds: [[symbol, ensembl], ...]) from OT's genetic_association datatype (top-N by score, or --min-genetic <score>). This is an independent evidence type from the OT clinical label used in Step 1b/2, so the downstream enrichment check stays non-circular. (Skip in academic mode — it uses the PrimeKG DisGeNET seeds.)

Step 1 — Rank targets

Commercial (default) — RWR over commercially-usable sources, OT-replaced seeds:

python scripts/rank_kg_targets.py \
    --primekg "${PRIMEKG_CSV}" \
    --anchor-id "<id>" --anchor-name PD \
    --edge-license commercial \
    --seeds-file /mnt/results/PD_target_ranking/ot_seeds.json \
    --seeds-source-name "Open Targets genetic association (CC0 1.0)" \
    --out /mnt/results/PD_target_ranking

Academic (internal only) — DisGeNET seeds + DrugBank/TxGNN drug-target layer:

python scripts/rank_kg_targets.py \
    --primekg "${PRIMEKG_CSV}" \
    --txgnn-pred "${TXGNN_PREDICTIONS}" \
    --anchor-id "<id>" --anchor-name PD --anchor-tx-key "parkinson disease" \
    --edge-license academic \
    --out /mnt/results/PD_target_ranking

--edge-license defaults to commercial; --restricted-sources defaults to DrugBank,DisGeNET,KEGG (note: only DrugBank is catchable via node-source columns; DisGeNET/KEGG entries document intent but are handled by seed replacement, not filtering). In commercial mode always pass --seeds-file — running commercial mode without it falls back to the DisGeNET-derived PrimeKG seeds and the ranker emits a WARNING (the run is then not commercial-safe). In commercial mode the TxGNN layer is force-disabled even if --txgnn-pred is supplied. Other defaults: restart 0.30, weights 0.70/0.30, top-50 drugs — all exposed as flags. The script keeps the tie-aware rank_norm (average ranks); this is deliberate — see references/methods.md §6. The ranker records seeds_replaced/seeds_provenance, a provenance_note (node-vocab caveat), and a provenance block (kept/dropped edges per relation and source) in meta.json.

Step 1b — Commercial known-target label (Open Targets; commercial mode only)

In commercial mode the DrugBank known_drug_target label is dropped, so build a commercially-usable label from Open Targets (CC0 1.0) for the face-validity check and figures:

python scripts/ot_known_targets.py \
    --ranked /mnt/results/PD_target_ranking/ranked_targets.csv \
    --disease-name "Parkinson disease" \
    --meta-out /mnt/results/PD_target_ranking/ot_known_targets.json \
    --skip-on-error

Adds a known_target_ot column (targets with Open-Targets clinical-datatype evidence) + an ot_assoc_score column. --skip-on-error leaves the label absent if OT is unreachable, so Step 2 can fall back to a self-contained seed-recovery check. (Skip this step in academic mode — use the DrugBank label.)

Step 2 — Face-validity self-check (REQUIRED)

Commercial (Open-Targets label, with offline fallback):

python scripts/check_enrichment.py --ranked /mnt/results/PD_target_ranking/ranked_targets.csv \
    --label-col known_target_ot --fallback-seed-recovery \
    --out /mnt/results/PD_target_ranking/enrichment_check.json

Academic (DrugBank label): omit --label-col/--fallback-seed-recovery (defaults to known_drug_target). Known targets should be strongly enriched in the top bin and enrichment should decrease down the list. If the script prints FACE-VALIDITY CHECK FAILED, stop and re-examine the anchors (wrong disease, too few seeds, poor PrimeKG coverage) before reporting. If OT is unreachable and --fallback-seed-recovery is set, the check runs on is_seed (source-free seed recovery) and records label_kind: seed_recovery. Report the numbers either way.

Step 3 — Enumerate evidence paths for top hits
python scripts/enumerate_evidence_paths.py \
    --primekg "${PRIMEKG_CSV}" \
    --ranked /mnt/results/PD_target_ranking/ranked_targets.csv \
    --anchor-id "<id>" --anchor-name PD --anchor-disease-name "Parkinson disease" \
    --edge-license commercial \
    --top 12 --out /mnt/results/PD_target_ranking/evidence_paths.json

Pass the same --edge-license as Step 1. In commercial mode the DrugBank drug_target path template is not emitted (only direct_seed / ppi_bridge / shared_concept).

Step 4 — Literature validation of top hits (REQUIRED)

For each of the top-N targets, use the Biomni LiteratureSearch tool to find support for the target in that disease, e.g. query "<GENE> <disease> therapeutic target" (and mechanism-specific variants). For each target, record one grounded supporting sentence + citation(s). This feeds the report's "Literature support" section. Do not fabricate citations — only cite returned sources; if nothing solid is found for a target, say so (a genuinely novel candidate may have little literature, which is itself informative).

Step 5 — Figures
python scripts/make_figures.py \
    --ranked /mnt/results/PD_target_ranking/ranked_targets.csv \
    --evidence /mnt/results/PD_target_ranking/evidence_paths.json \
    --enrichment /mnt/results/PD_target_ranking/enrichment_check.json \
    --meta /mnt/results/PD_target_ranking/meta.json \
    --disease "Parkinson disease" \
    --out /mnt/results/PD_target_ranking/figures \
    --seed-venn --txgnn-fig --hero

Produces the core set (infographic, top-20 bar, score-distribution + enrichment-by-bin, evidence-path grid). The conditional flags add a seed-Venn (auto-skips with <2 anchors), a TxGNN-support bar (auto-skips with no TxGNN), and a #1-hit "convergence" hero figure. In commercial mode omit --txgnn-fig (there is no TxGNN support); the known/novel coloring uses the known_target_ot column automatically when present. --meta is optional: the ranker (Step 1) writes meta.json automatically, so just point --meta at it to show real provenance (graph scale, seed counts, params) on the infographic. If absent, all keys fall back to values computed from the ranked CSV / enrichment JSON. MEDIA-CHECK every figure (Read(...)) and regenerate any that come back blank, clipped, or unreadable. Legends are placed below the plot area by design.

Step 6 — PDF report

Assemble the report and render it with the pdf-report-generation skill (load it, follow its Phylo branding, tables, hAlign="CENTER", KeepTogether, <sub>/<super> not Unicode, and its validation steps). This skill defines the structure (below); the PDF skill owns the rendering.

Report specification (structure — render via pdf-report-generation)

Produce report_<disease>_target_prioritization.pdf with these sections in order:

Title + summary infographic (fig1) — one-glance overview.
Introduction — the disease, why target prioritization matters, and the knowledge-graph reasoning approach in 2–3 sentences.
Methods — data sources (PrimeKG; TxGNN in academic mode; Open Targets genetic-association seeds + clinical label in commercial mode), the edge_license mode used and (commercial) both the provenance-based edge filter with kept/dropped counts and the seed replacement (state that PrimeKG disease_protein seeds are DisGeNET-derived and were replaced with OT genetics, with the node-vocab-vs-edge-evidence rationale), seed definition, RWR (restart), the score, and annotation. Pull from references/methods.md; state the actual parameters used.
Results
Ranked table (top ~25 of N) with combined/RWR/TxGNN, anchors, degree, status.
Top-20 ranking figure (fig2).
Score-distribution + enrichment-by-bin figure (fig3) with the self-check verdict.
Per-target evidence paths for the top hits (fig4 + prose "why X ranks high").
Conditional figures if generated (seed-Venn, TxGNN-support, hero).
Literature support — the per-target grounded sentences + citations from Step 4.
Discussion / interpretation — what the ranking recovers (known biology) and the most credible novel candidates; where RWR and TxGNN agree/disagree.
Conclusions — the headline: a credible, auditable target shortlist.
Limitations — from references/methods.md §10 (discovery not inference; hub bias; TxGNN is repurposing; tunable defaults; graph-derived known labels; KG coverage).
References — the literature citations (inline, handled by the platform).
Next steps — orthogonal validation of top hits (Open Targets, human genetics/GWAS, DepMap dependency, predict_admet_properties for druggability), and experimental follow-up.
Data sources & licensing (required for commercial deliverables) — a table of every source that fed the ranking + its license/commercial status, the excluded restricted sources, and the residual restriction (see references/DATA_SOURCES.md).

Always run the PDF skill's validation (pypdf page/text check + visual media-check) and fix layout issues before delivering.

Scientific caveats (surface these; never hide them)
Discovery, not inference — a ranking, not a test; no p-values/FDR. Scores are rank-normalized and cluster near 1.0 at the top by construction, not by effect size.
Degree/hub bias — hub genes can rank up topologically; mitigated (concept down-weighting + size cap + ADME flag) but not eliminated. Watch the degree column on very high-ranked hits.
TxGNN is repurposing, not target inference (academic mode only) — target support is indirect (drug→target); some predicted drugs are early-stage/tool compounds; it is weighted below RWR. Disabled in commercial mode (needs DrugBank edges), which is then RWR-only.
Tunable defaults — restart 0.30 and 0.70/0.30 weighting are defaults, not optimized; report them and note sensitivity.
Seed provenance depends on mode — academic seeds are PrimeKG's disease_protein edges, whose disease→gene associations are DisGeNET-derived (non-commercial); commercial replaces them with Open Targets genetic associations (CC0). The node-source columns cannot distinguish these (both read NCBI/MONDO), which is exactly why commercial mode replaces rather than filters the seeds.
"Known target" label depends on mode — in academic mode it is graph-derived from PrimeKG (DrugBank) indication/off-label edges, so the enrichment check is a self-consistency check (same source defines ranking edges and label). In commercial mode the label comes from Open Targets clinical evidence (CC0), which is independent of both the network backbone and the OT genetic seeds, making the check a genuine external validation. Either way, "known" is a moving annotation that may lag clinical practice.
KG coverage — results inherit PrimeKG's gaps; absence of an edge ≠ absence of biology.
Licensing & edge-license modes

PrimeKG integrates ~20 upstream resources, some not licensed for commercial use. Rather than shipping restricted-source edges silently, this skill is provenance-aware and exposes --edge-license. Full source-by-source licensing is in references/DATA_SOURCES.md — read it before any commercial use.

What actually feeds the ranking (with the important node-vocab-vs-evidence distinction): the RWR network backbone uses NCBI (PPI) and GO + Reactome (concept edges) — all commercial-usable. Two things are not clean as-shipped: (1) the disease seeds — PrimeKG's disease_protein edges read NCBI/MONDO in the node-source columns but their disease→gene associations are curated from DisGeNET (CC BY-NC-SA, non-commercial), which is therefore invisible to the edge filter and must be replaced with Open Targets genetics (CC0), not filtered; and (2) DrugBank, which supplies the drug nodes and is caught by the edge filter (drug_protein / indication / off-label use — the TxGNN layer + the DrugBank "known target" label). KEGG is not a node-source string in this build (pathways are Reactome) and, like DisGeNET, could not be caught by column filtering anyway; both remain in the default restricted list to document intent. Net: commercial safety requires seed replacement (Step 0b) AND the DrugBank edge drop — filtering alone is insufficient.

Mode    Seeds    Edges    TxGNN    Known-target label    Commercial
commercial (default)    Open Targets genetics (CC0) — DisGeNET seeds replaced    NCBI PPI + GO/Reactome concepts; DrugBank dropped    disabled    Open Targets clinical (CC0)    Safe — attribute PrimeKG/GO/MONDO (CC BY 4.0)
academic    PrimeKG disease_protein (DisGeNET-derived)    all of the above + DrugBank    enabled    DrugBank (indication/off-label)    Restricted — needs_commercial_review
commercial (default) is safe for commercial deployment only when the seeds are replaced (Step 0b, --seeds-file) and the DrugBank edges are dropped, and provided the attribution terms of PrimeKG (CC BY 4.0), GO (CC BY 4.0), and MONDO (CC BY 4.0) are honored (Reactome, NCBI, Open Targets are CC0 / public domain and need no attribution). To treat a run as commercial-safe, assert both (a) no restricted source in meta.json → provenance.edges_kept_by_source (DrugBank dropped), and (b) meta.json → seeds_replaced == true with a commercial seeds_provenance. Passing only (a) is not sufficient — the DisGeNET-derived seeds are invisible to the edge filter.
academic keeps the DisGeNET-derived seeds and DrugBank-derived edges (and, when supplied, the TxGNN layer) and is therefore needs_commercial_review — use it only for internal / non-commercial work. Do not use academic-mode outputs in a commercial deliverable.
PrimeKG dataset license — the published Nature Scientific Data dataset (Chandak, Huang, Zitnik 2023) is CC BY 4.0; the bioRxiv preprint carries CC BY-NC 4.0, but that is the preprint license, not the dataset license — do not label the dataset non-commercial based on the preprint.
TxGNN — code is MIT-licensed; the precomputed prediction pickle is derived from PrimeKG (incl. DrugBank) and is only used in academic mode.
Residual restriction — the edge filter is only as accurate as PrimeKG's x_source/y_source node-source labels, and by design it does not clear edge-evidence sources (DisGeNET/KEGG) — that is what seed replacement handles; re-verify both the node-source set and the disease→gene evidence source on a different PrimeKG build. CTD (present in PrimeKG, commercially restricted) is not consumed by the ranker, so it does not affect commercial runs.
Related Biomni resources
Resources: PrimeKG is required and TxGNN is optional (see references/resources.md).
Tools: LiteratureSearch (top-hit validation), predict_admet_properties (druggability triage; verify by import before use).
Skills: pdf-report-generation (required — report rendering); open-targets (recommended orthogonal validation); literature-review (deeper synthesis).

42. large-scale-virtual-screening
Category: DRUG DISCOVERY
Source: https://biomni.phylo.bio/skills?section=marketplace

Large-Scale Virtual Screening (structure-based)

Dock a compound library against a protein target with AutoDock Vina, validate the pose, rank and triage hits, summarize preliminary SAR, and write a Phylo-branded PDF. The workflow adapts to two situations automatically and scales from a few hundred to tens of thousands of compounds.

Scope

Does: receptor prep + box definition, native-ligand redock validation (pose sanity), ligand 3D prep (RDKit + Meeko), parallel Vina docking, enrichment benchmarking when activity labels exist (ROC-AUC, EF, BEDROC), hit triage, Bemis-Murcko / Butina scaffold SAR, optional advisory ADMET, optional bounded literature context, and a PDF report.

Does NOT: free-energy perturbation / MM-PBSA absolute affinities, covalent docking, metalloprotein-specific parameterization, ternary-complex / PROTAC modeling, or molecular dynamics. Docking prioritizes compounds for follow-up; it does not confirm binding or potency. Vina scores carry ~2-3 kcal/mol error and are unreliable as absolute affinities.

Inputs
Target — a PDB id (fetched from RCSB) or a local .pdb. A co-crystal ligand is strongly preferred: it defines the box and enables redock validation.
Library — auto-detected (see Decision Guide). One of:
user SMILES/CSV (first-class, prospective)
ChEMBL target-pull of bioactives (first-class, prospective)
DUD-E-style actives/decoys (labeled benchmark branch)
Enamine REAL / datalake subset (heavier at-scale mode; degrades gracefully)
Optional — activity labels (a label/activity column), a box override, an infographic, literature toggle, ADMET toggle.
Outputs (under a run dir, e.g. /mnt/results/<run>/)
report_<name>.pdf — Phylo-branded report (infographic + Executive Summary, Background & Context [walled-off literature], Methods, Results, Discussion, Limitations, Next Steps, References, Data Files).
Data: master_library.csv, all_scores_merged.csv, molecular_descriptors.csv, redock_validation.json, docking_box.json, tables/top_hits.csv, tables/scaffold_clusters.csv, and — labeled runs only — enrichment_metrics.json, roc_curve.csv. Figures in figures/.
Decision Guide
Labeled vs label-free (automatic). build_library.py writes library_meta.json with labeled. If labeled=true (DUD-E, or a CSV/ChEMBL benchmark with decoys), run enrichment.py (ROC/EF/BEDROC) plus triage + SAR. If labeled=false, skip enrichment and the report states it was omitted because there is no ground truth; deliver triage + SAR + property/ADMET flags.
Fan-out vs local (automatic). Small library or no ManageMachine access → dock on one machine (run_docking.py --mode local). Larger library → pilot, estimate, confirm, then fan out (see Compute & Scaling). Local is a graceful fallback, never a user choice.
ADMET / Literature (optional). Run for top hits when the user wants drug-likeness or background; skip for pure at-scale compute to stay fast.
Environment setup (once per run)
# Install the Python bindings INTO the interpreter the scripts actually run under.
# The base image ships a `/workspace/.venv` whose `python` can be a broken symlink,
# so a bare `uv pip install` may land packages where imports won't find them. Pin the
# target to the conda interpreter and invoke every script with that same interpreter.
uv pip install --python /opt/conda/bin/python vina meeko gemmi
# meeko + gemmi + the vina Python module are NOT in the base image.
# receptor prep also needs ADFR `prepare_receptor` on PATH (/opt/conda/bin:/usr/local/bin);
# it falls back to Meeko/OpenBabel if absent.
export PATH=/opt/conda/bin:/usr/local/bin:$PATH   # so vina / prepare_receptor / obabel resolve

Scripts live in scripts/. Invoke them with /opt/conda/bin/python <script>.py (not a bare python) so the imports resolve to the environment you just installed into. Every script has a --self-check dry-run (no heavy compute) — run them first to confirm the environment before a real screen. (The python ... in the workflow steps below is shorthand for /opt/conda/bin/python ....)

Workflow

Run from scripts/. Paths below assume a run dir RUN=/mnt/results/<run>.

Fetch receptor & isolate protein/native ligand — why: a clean single-chain receptor and the co-crystal ligand anchor both the box and the pose check.

python fetch_receptor.py --pdb-id 2ITY --outdir $RUN/receptor
# or --pdb-file my_receptor.pdb ; --chain / --ligand-resname to override picks

Prepare receptor PDBQT + define box — why: Vina needs PDBQT; a pocket-scale box (~16-22 A cube around the native ligand) balances accuracy and speed.

python prepare_receptor.py --protein-pdb $RUN/receptor/2ITY_protein.pdb \
    --from-ligand $RUN/receptor/2ITY_ligand.pdb --outdir $RUN/receptor
# or --center X Y Z --size S for an explicit box

Validate the box by native-ligand redock — why: this is the single most failure-prone step; if the box/scoring can't reproduce a known pose, the whole screen is suspect. Uses a core-aware, two-tier, warn-not-fail gate: passes if the rigid, buried core RMSD < 2 A even when a flexible tail moves; the exact core atoms are recorded.

python redock_validate.py --receptor-pdbqt $RUN/receptor/2ITY.pdbqt \
    --receptor-pdb $RUN/receptor/2ITY_protein.pdb \
    --ligand-pdb $RUN/receptor/2ITY_ligand.pdb --box $RUN/receptor/docking_box.json \
    --outdir $RUN/redock

If it does not pass, do not silently proceed — surface the warning to the user, put it in the report's Limitations, and consider re-checking protonation/box/chain.

Build the library (+ labels) — why: auto-detection routes to the right branch and records provenance.

python build_library.py --smiles-csv my_compounds.csv --outdir $RUN/library
# or --chembl-target CHEMBL203  |  --dude-dir dude/egfr  |  --datalake enamine_subset.smi

Prepare ligands (3D + PDBQT) — why: Vina needs 3D PDBQT; a fixed seed makes it reproducible. Target ≥95% prep success; failures are logged and auditable.

python prepare_ligands.py --library $RUN/library/master_library.csv \
    --outdir $RUN/ligands --nproc 8

Dock — pilot, plan, confirm, then execute — why: measure real throughput before committing a fleet. See Compute & Scaling.

# (a) measure + plan
python run_docking.py --mode plan --library $RUN/library/master_library.csv \
    --pdbqt-dir $RUN/ligands/pdbqt --receptor-pdbqt $RUN/receptor/2ITY.pdbqt \
    --box $RUN/receptor/docking_box.json --outdir $RUN
#   -> report ETA/worker-hours from fanout_plan.json to the user; get an OK if large.
# (b1) small / no ManageMachine -> local fallback:
python run_docking.py --mode local --library ... --pdbqt-dir ... --receptor-pdbqt ... \
    --box ... --scores-dir $RUN/scores
# (b2) fan-out: provision N workers with ManageMachine, run the shard template from the
#      plan on each (dock_worker.py --shard i --nshards N), then:
python run_docking.py --mode collect --library $RUN/library/master_library.csv \
    --scores-dir $RUN/scores --outdir $RUN

Enrichment (labeled runs only) — why: quantifies whether docking separates known actives from decoys.

python enrichment.py --scores $RUN/all_scores_merged.csv --outdir $RUN

Triage + preliminary SAR — why: turns a score list into a prioritized, scaffold-aware hit set and flags scoring-function property bias.

python triage_sar.py --scores $RUN/all_scores_merged.csv --outdir $RUN --top-n 50

ADMET advisory (optional) — why: drug-likeness/tox context for the shortlist — advisory only, never a filter.

python admet_annotate.py --top $RUN/tables/top_hits.csv

Figures — why: reviewers read plots first. Data plots only; make the workflow infographic separately with GenerateImage (conceptual diagram, not matplotlib).

python make_figures.py --run $RUN --outdir $RUN/figures

Literature context (optional, walled-off) — why: cited background without contaminating computed results. Use the Biomni LiteratureSearch tool for a few targeted queries (target biology; known inhibitor chemotypes; docking/benchmark caveats), then write $RUN/literature.json:

{"summary": "<2-4 sentence cited background with [1],[2] markers>",
 "references": [{"n": 1, "text": "Author et al., Journal, Year."}]}

Keep this separate from the numeric results; the report renders it under a callout that labels it external context. Skip entirely for pure-compute runs.

Report — why: the standalone deliverable.

python build_report.py --run $RUN --title "EGFR virtual screen" \
    --subtitle "DUD-E benchmark vs PDB 2ITY" \
    --infographic $RUN/figures/workflow_infographic.png \
    --literature-json $RUN/literature.json \
    --out $RUN/report_virtual_screen.pdf

The script validates the PDF (pypdf: ≥2 pages, extractable text). Also run the direct visual inspection using ordinary Read on the PDF/figures; regenerate anything blank or clipped.

Compute & Scaling (adaptive fan-out with a confirm beat)
Pilot first. run_docking.py --mode plan docks ~20 ligands and measures real throughput on this receptor/library/box. Do not assume a constant; ~13 s/ligand/core is only a starting point and swings with ligand flexibility, box size, and exhaustiveness.
Report before you scale. The plan writes fanout_plan.json with measured rate, a recommended worker count, estimated wall time, and worker-hours (a cost proxy). Tell the user "~X h on N workers (~W worker-hours), proceed?" and get confirmation before provisioning a fleet, especially when exceeds_abort_threshold is true.
Fan out. On approval, provision N workers with ManageMachine (e.g. 8-core each, up to the session's 5-machine limit) and run dock_worker.py --shard i --nshards N on each, writing shards to a shared/$RUN/scores dir. Then --mode collect.
Graceful fallback. Small library or no ManageMachine → --mode local (process pool on one machine). This is automatic, not a separate user-facing mode.
FUSE-safe I/O. /mnt/results and /mnt/shared-workspace are S3-backed and reject append/streaming writes. Workers write scores to local /workspace first and copy once at the end (handled inside the scripts). Never point per-ligand streaming output at /mnt.

See references/compute_and_scaling.md for the full procedure.

Scientific caveats (MUST appear in every report's Limitations)
Single rigid receptor conformation — no induced fit / side-chain flexibility.
Vina scoring error ~2-3 kcal/mol; poor absolute affinity — use for ranking only.
One tautomer / protonation / conformer per ligand; no explicit waters.
Labeled runs: decoys are presumed-inactive (property-matched or DUD-E), not confirmed non-binders — enrichment is optimistic relative to a real prospective screen.
Redock warnings (if the native pose was not reproduced) must be stated prominently.
Docking prioritizes, it does not confirm — top hits need orthogonal rescoring and experimental validation.
Reusing platform capabilities (don't reinvent)
ADMET: this skill calls the Biomni predict_admet_properties tool (DeepPurpose-backed) as an advisory annotator. At authoring time there is no dedicated tox/ADMET skill; if one becomes available, prefer it and pass its output into the top-N table instead.
Literature: use the Biomni LiteratureSearch tool; keep results in the walled-off section only.
PDF styling: build_report.py mirrors the pdf-report-generation skill's Phylo visual language (gold #D4A04A primary accent, Helvetica, Letter, gold table headers). If you extend the report, load that skill and keep them visually aligned.
Data Sources & Licenses

This skill retrieves data from public external sources at run time. Downstream/commercial use must honor each source's license. DATA_SOURCES.md holds the full details; this is the summary.

Source    Used by    License    Commercial use    Key obligation
ChEMBL (bioactivities)    build_library.py --chembl-target    CC BY-SA 3.0 Unported    Yes    Attribution + Share-Alike
RCSB PDB (structures)    fetch_receptor.py --pdb-id    Public domain (CC0 1.0)    Yes    None required (citation appreciated)
DUD-E (actives/decoys benchmark)    build_library.py --dude-dir    Free for research (dude.docking.org)    Verify before commercial use    Cite Mysinger et al. 2012
TDC / DeepPurpose ADMET models    admet_annotate.py (advisory)    TDC data CC BY 4.0; DeepPurpose BSD‑3‑Clause    Yes    Attribution; advisory outputs only
Enamine REAL / datalake (optional; off by default)    build_library.py --datalake/--enamine    Enamine terms of use    Check Enamine terms    Per Enamine license
ChEMBL is commercial-use-friendly but "copyleft." CC BY-SA 3.0 permits commercial use, but requires attribution AND share-alike: any redistributed dataset derived from ChEMBL (e.g. a master_library.csv built from a ChEMBL target pull, or its docking-scored derivatives) must (a) credit ChEMBL with the resource URL and release/version (e.g. "ChEMBL data from https://www.ebi.ac.uk/chembl, ChEMBL_35"), (b) preserve the ChEMBL IDs, and (c) be licensed under the same CC BY-SA 3.0 terms. Plan for this in any product that ships ChEMBL-derived compound sets.
Human Protein Atlas (HPA) is not used by this skill. If an HPA-derived layer is ever added (HPA is CC BY-SA 4.0), the same commercial-OK + attribution + share-alike obligations apply and must be documented here.
References
references/worked_example_egfr.md — a fully-worked, honestly-reported EGFR/DUD-E run (including a deliberately weak enrichment result) as a template for interpretation.
references/method_reference.md — docking parameters, box sizing, and exact enrichment metric definitions/conventions.
references/compute_and_scaling.md — pilot → fan-out procedure, cost/ETA math, FUSE rules.
references/troubleshooting.md — RMSD atom mismatches, FUSE errors, 1-CPU autoscaling, meeko/gemmi install, prepare_receptor PATH, ChEMBL/datalake degradation.

43. library-design-enumeration
Category: MOLECULAR DESIGN
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

44. ligand-binding-mode-analysis
Category: MOLECULAR DESIGN
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

45. literature-deep-review
Category: LITERATURE
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

46. literature-review
Category: GENERAL
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

47. long-read-assembly
Category: GENOMICS & GENETICS
Source: https://biomni.phylo.bio/skills?section=marketplace

No markdown preview is available for this skill yet.

48. long-read-structural-variants
Category: GENOMICS & GENETICS
Source: https://biomni.phylo.bio/skills/skill_3c74126c13f23c21c90c86e80818ba16?section=marketplace

Long Read Structural Variants
When to Use This Skill

Use this skill for dual-caller descriptive analysis from an already aligned, sorted, indexed ONT or PacBio BAM. It runs Sniffles2 plus installed cuteSV, or compares Sniffles2 with an explicitly selected user VCF. Alignment and read QC are upstream. Caller agreement is descriptive robustness evidence, not accuracy or clinical interpretation.

Inputs

Before running scripts/run_sv.py --execution-mode analysis --second-caller cutesv|user_vcf, seal schema-v2 input_selection.json with scripts/input_selection.py. Explicitly select the BAM, reference FASTA, upstream run.json, completed QC identity_check.json, and any user-provided second callset. Validate and hash-bind their identities and indexes. Partial acquisition, inferred or package data, symlink escapes, missing/failed identity evidence, and reused non-empty results roots are hard stops.

sample.bam and adjacent .bai: long reads aligned to the exact reference, coordinate-sorted and indexed.

reference.fasta and adjacent .fai: exact reference used for alignment.

run.json: upstream platform, chemistry, basecaller, model, molecule type, and non-empty reference_build.

Completed upstream identity_check.json: normalized platform/read type, successful identity verdict, QC hashes, and coverage_estimate_status=computed with positive coverage.

Either installed cuteSV selected with --second-caller cutesv, or an explicitly selected VCF sealed as second_caller_vcf and passed with --second-caller user_vcf --second-caller-vcf ....

The public entrypoint is intentionally two-stage within one Biomni task. First run it without an infographic; it computes science, freezes every science output and imported scientific support-source hash in sv/science_stage_receipt.json, writes the exact facts-derived claim ledger/prompt, and exits successfully with explicit state awaiting_infographic. Create the image with Biomni GenerateImage from that exact prompt. Then rerun the same command with --resume --infographic-file FILE; resume revalidates selected inputs, support-source identity, and every frozen science-output hash before finalization.

Keep optional benchmark scratch outside the results root. If a benchmark_addon/ evidence tree is present at finalization, the entrypoint preserves every file and hash in a deterministic benchmark_addon_evidence.zip plus manifest, then removes the expanded duplicate so the published inventory remains fully enumerable by deterministic QA.

Do not paraphrase or extend sv/infographic_prompt.txt; it is derived from the exact current-run facts and contains the only allowed claim texts.

The BAM header sequence dictionary must match the reference lengths. If an assembly tag is present it must agree with run.json.reference_build; otherwise the run stops before calling.

Report Styling Provider Policy

The contract default is pdf-report-generation. Resolve an override only from an affirmative, immutable end-user message naming an installed compatible report-styling provider. Customer, tenant, project, account, folder, dataset, assistant, or caller context is not selection evidence. A missing, malformed, conflicting, revoked, incompatible, or unavailable requested provider stops report completion; never fall back or approximate the requested style.

The selected provider owns report presentation only: typography, layout, page chrome, palette, logo, and PDF metadata. It must consume the same report_content.json, figures, infographic, facts, references, limitations, provenance, and non-PDF outputs. Render report_content.json through the selected provider and pass its completed PDF with --provider-rendered-report.

Workflow
Seal and verify input selection; require a fresh external results root.
Audit the installed commercial-use license evidence for required Python/runtime dependencies.
Validate and hash-bind upstream QC identity; cross-check --platform (ont|hifi) against its normalized platform/read type, then check BAM/reference/run-metadata identity.
Derive effective support from validated upstream coverage (Sniffles2: ceil 10%, minimum 2; cuteSV: ceil 10%, minimum 10), record it, and execute the selected caller routes.
Normalize, sort, bgzip, and tabix-index both VCFs through pysam/bcftools bindings.
Validate both indexed VCFs and summarize PASS calls by SV class, non-breakend size, and class-aware breakpoint concordance.
Derive report_facts.json, report_content.json, and report_structure.json from the current facts, provenance, validated figure inventory, and complete user-facing references/report_references.json catalog. Do not restate remembered values in report prose, omit catalog entries, or substitute internal review identifiers.
Pause after the science stage, generate the infographic from exact sv/infographic_prompt.txt, then resume. Resolve the report provider before creating PDF bytes. Render report_content.json through the selected provider and pass its completed PDF with --provider-rendered-report, with the unchanged infographic as the first substantive visual on page 1. Extract text and render every PDF page beneath report_review/.
Call the strict receipt gate last. A missing, undersized, stale, unstyled, structurally incomplete, or hash-inconsistent PDF/report artifact is a failed run. Standard execution records visual quality honestly as not_evaluable and leaves visual acceptance to post-run review; an explicit visual defect remains blocking. GenerateImage lineage is evaluated only from a platform-provided, read-only trace for the current task. execution_trace/transcript.jsonl under the results root is agent-writable and never satisfies lineage, regardless of its IDs or contents. When the native trace is unavailable, incomplete, or cannot prove one exact call/result pair, the receipt records not_evaluable_platform_trace and keeps infographic_lineage_verified release-blocking. Do not report task success unless run_receipt.json exists and has an empty release_blocking_gates array.
Outputs
sv/calls_sniffles2.norm.vcf.gz and .tbi
sv/calls_second.norm.vcf.gz and .tbi
sv/sv_counts.tsv and sv/concordance.tsv
sv/provenance.json, sv/identity_check.json, sv/dependency_licenses.json
sv/facts_payload.json
sv/sv_calls.tsv with one row per delivered call and its FILTER, QUAL, genotype, genotype quality, and read support when present in the caller VCF
sv/infographic_claims.json, whose allowed claims are each bound to an exact facts field/value
sv/infographic_prompt.txt, generated only from those bound claim texts and a fixed forbidden-claims list
sv/science_stage_receipt.json, whose exact output inventory and SHA-256 values must all verify on resume
figures/figure_2_call_svs.{png,svg}, figures/figure_3_normalize_and_index.{png,svg}, and figures/figure_4_compare_callers_concordance.{png,svg}
figures/manifest.json
workflow_infographic_long_read_sv.png
report_facts.json, report_content.json, and report_structure.json
report_long-read-structural-variants.pdf
report_review/report.txt and every rendered page under report_review/pages/
When optional benchmarking was retained, benchmark_addon_evidence.zip and its exact hash/inventory ledger benchmark_addon_evidence_manifest.json
qc_run_log.json and run_receipt.json

Each data figure must be kept with its caption and adjacent claim-evidence-interpretation paragraph from figures/manifest.json. The paragraph must state what the current plot means and its main limitation; a detached caption-only gallery is not acceptable.

If reference identity fails, only the diagnostic sv/not_computable.json is emitted after the identity record and the public entrypoint exits nonzero without claiming report completion. Facts must not claim accuracy, sensitivity, precision, or external validation.

Scientific Limitations
Low depth, low variant-allele fraction, tandem repeats, segmental duplications, and alignment artifacts can reduce sensitivity or breakpoint precision.
Counts and caller concordance are descriptive and depend on caller versions, the recorded coverage-scaled support thresholds, alignment, coverage, and reference build; agreement does not establish correctness.
BND and complex rearrangement representations are not directly comparable to length-bearing INS/DEL/DUP/INV records.
Review candidate calls with read-level evidence and orthogonal methods before biological or translational decisions.
Common Issues
Reference identity failure: BAM contigs or lengths, the alignment assembly tag, run.json, and the selected FASTA disagree. Realign to the declared reference or select the matching files; never rename contigs to force a pass.
Insufficient or missing coverage evidence: support thresholds cannot be derived without the validated upstream coverage artifact. Complete long-read QC first.
Second caller unavailable: install the selected cuteSV version or provide a separately sealed second VCF. Do not substitute another caller silently.
Large caller disagreement: inspect support, FILTER, genotype, repeats, and breakpoint representation before interpreting unique calls. Agreement is not a truth label.
Breakend/complex representation mismatch: BNDs and complex events are not directly comparable to simple length-bearing variants and require event-level review.
Infographic resume failure: any changed science artifact invalidates the frozen receipt. Start a fresh science stage rather than modifying outputs between stages.
Suggested Next Steps
Review prioritized shared and caller-unique variants in a genome browser with read-level support.
Confirm biologically important events with an orthogonal assay or an independently generated callset; use a matched truth set only in a separately declared benchmarking workflow.
Annotate genes and regulatory elements only after reference build and breakpoint identity are resolved.
Re-run at adequate depth when coverage-scaled support or low variant allele fraction limits detection.
Use a dedicated small-variant workflow for SNVs/indels and retain this skill's SV scope.
Related Skills
long-read-qc-basecalling — establish read identity, quality, and coverage before SV calling.
long-read-assembly — assemble long reads de novo rather than call variants from alignments.
variant-calling-from-sequencing — call and benchmark SNVs/indels.
long-read-methylation — analyze modified bases from compatible long-read data.
Reference

See references/sv_calling.md for dual-caller scope, matching rules, and citations.

49. matched-molecular-pairs
Category: DRUG DISCOVERY
Source: https://biomni.phylo.bio/skills/skill_907fb984a34e5e38b4497a8966da9ff6?section=marketplace

Matched-Molecular-Pair SAR Analysis

Turn an existing bioactivity series into defensible matched-molecular-pair (MMP) transformations — which single structural changes move potency/property, by how much, with what support and uncertainty — and identify where the SAR is discontinuous (activity cliffs) and context-dependent.

Scope

Does: standardize a bioactivity series; generate matched molecular pairs with mmpdb; compute per-transformation delta distributions with support counts and bootstrap CIs; flag activity cliffs (configurable MoleculeACE consensus rule); detect context-dependent transformations (effect reverses across cores); suppress low-support rules; propose next compounds; and deliver a PDF report.

Does NOT: train or benchmark a QSAR/GNN affinity model (use binding-affinity-ml-model); do de novo/generative design or retrosynthesis (use generative-molecule-design); predict ADMET from structure (use molecular-property-admet / adme-ml-modeling). An MMP is an association in the observed data — not causation, transferability to a new core, or a mechanism.

Installation
uv pip install mmpdb rdkit numpy pandas scipy rapidfuzz tqdm
mmpdb requires Python ≥ 3.10 and rdkit ≥ 2025.3 (both typically present in Biomni).
The activity-cliff definition is vendored (scripts/cliffs.py, MoleculeACE, MIT) and needs no deep-learning stack. Do not import MoleculeACE (its package __init__ eagerly imports torch/tensorflow/torch-geometric and will fail).
Inputs

One tidy table (CSV/TSV), one row per (compound × measurement), with columns: compound_id, smiles, endpoint, value, unit, assay_context, censored (=/>/<). See references/datasets.md. Potency is analyzed in log space (pKi/pIC50). Endpoints from different assays are kept separate unless the user harmonizes them; censored (>/<) rows are carried in the table and excluded from delta statistics (and counted). For multiproperty analysis supply ≥2 endpoints (e.g. hERG_pIC50 and CYP3A4_pIC50). Alternatively pull one or several ChEMBL targets with scripts/acquire_chembl_data.py with explicit target IDs (single --target or comma-separated --targets).

Before chemistry calculations, seal schema-v2 input_selection.json. Bioactivity inputs must be explicit user-selected uploads or complete downloads from user-supplied ChEMBL target identifiers. A partial acquisition requires confirmation and stops; a failed acquisition never creates a substitute. Downloaded inputs require source, tool, version, command, and retrieval evidence; uploaded inputs use acquisition status not_applicable. Reject package data, inferred or substituted inputs, symlink escapes, and reused non-empty results roots. Bind facts, report, and receipt to the canonical manifest hash with package_data_used: false.

Outputs

Written to a results subfolder (CSV/PNG write directly to the S3-backed results dir). The PDF report is the exception -- it goes at the results root, not in the subfolder. The single-endpoint runner writes bare filenames; the multiproperty runner suffixes per-endpoint files with __<endpoint> and adds two cross-endpoint tables:

transformation_table[.__<ep>].csv (+ _supported) — per-transform n, median Δ, mean Δ, bootstrap 95% CI, direction, cliff fraction, suppressed flag.
suppressed_transformations[.__<ep>].csv — rules withheld for low support.
activity_cliff_pairs[.__<ep>].csv (+ cliff_transform_summary) — cliff pairs / enrichment.
cliff_sensitivity_by_criterion.csv — cliff counts under every similarity criterion (Tanimoto-only / scaffold-only / SMILES-only / consensus), each row naming its criterion.
context_dependent_transformations[.__<ep>].csv (+ _example_pairs) — sign-reversal transforms.
multiproperty_transformation_table.csv — per-endpoint effect/CI joined on transformation SMIRKS.
pair_examples[.__<ep>].csv, next_compounds[.__<ep>].csv, summary.json.
report_facts.json — the keyed report-fact artifact every narrative/PDF claim is quoted from: one entry per transformation key (SMIRKS) carrying its label, support n, median Δ and bootstrap CI per endpoint, plus ranked key lists (not row lists). The report binds to this by key; a claim whose label and quoted numbers resolve to different keys fails validation. It carries the report's numbers, not a scientific result table.
Figures (Δ distributions, effect forest with CIs, cliff scatter).
A PDF report at the results root -- e.g. report_matched_molecular_pairs.pdf, never inside a run subdirectory. Always produced; there is no configuration in which it is skipped. The contract, restated verbatim:

Generate the PDF with pdf-report-generation by default, or with an installed compatible provider that the user explicitly selected, while preserving all scientific content, infographics, figures, evidence, references, conclusions, and non-PDF outputs.

In summary.json every numeric metric is nested under the endpoint/run that produced it (runs.<endpoint>.…), so a value can never be mis-attributed to a different run.

Clarification Questions

Ask about the input FIRST, then parameters:

Input: a CSV/TSV bioactivity table (confirm the 7 columns), or a ChEMBL target ID + endpoint to pull? Which endpoint and assay context?
Endpoint handling: analyze in log space (pKi/pIC50)? Keep assays separate or harmonize?
Cut rules / size limits: the production workflow explicitly invokes mmpdb with --num-cuts 1 for interpretable single-cut MMPs. Max variable heavy atoms (default 10)?
Thresholds: minimum support n to report a transformation (default 5); activity-cliff similarity (default 0.9) and fold-change (default 10)?
Standard Workflow

Run scripts from the package scripts/ directory (or add it to sys.path). mmpdb writes a .mmpdb SQLite DB and .fragdb files (random-access) — build them on local disk (a temp dir / /workspace); write only CSV/figure/report deliverables to the results dir.

Treat the extracted attached package as immutable. Before importing any package module or starting analysis, record its complete file-tree identity outside the package. Run package Python with -B (or PYTHONDONTWRITEBYTECODE=1) so imports cannot add __pycache__. Never create, edit, download, or copy a helper into the extracted package; use the bundled scripts as shipped and write all generated code, databases, facts, figures, and reports under /workspace or /mnt/results.

import sys; sys.path.insert(0, "scripts")
from report_qc import write_attached_package_snapshot
PACKAGE_SNAPSHOT = write_attached_package_snapshot("attached_package_snapshot.json")

Ingest & validate. Load the 7-column table. Separate rows by endpoint × assay_context; convert potency to log space; set aside censored (>/<) rows. To pull a multiproperty series from ChEMBL instead (exact values via pchembl, censored via the relation filter, keyset-shallow paging):

python scripts/acquire_chembl_data.py \
  --targets "$TARGET_IDS" --standard-types "$STANDARD_TYPES" \
  --endpoint-names "$ENDPOINT_NAMES" --out series.csv

Time budget. A multiproperty ChEMBL pull for large targets can take 10–15+ minutes via the public API. Launch it with timeout_minutes >= 30 (or as a background job) and write the series CSV to /mnt/shared-workspace/ (not just /workspace/) so fetched data survives a session boundary and can be resumed if the pull is interrupted.

Standardize & de-duplicate structures. RDKit largest-fragment (salt strip), neutralize, canonical SMILES; de-duplicate by InChIKey with median aggregation of replicate potencies (handled inside acquire_chembl_data.py; apply the same to user tables).

Generate matched pairs, deltas, cliffs, and tables — the engine runs mmpdb (fragment → index → loadprops), extracts radius-0 pairs, computes Δ = value(to) − value(from), bootstraps per-transform CIs, flags cliffs, finds context-dependent and suppressed transforms, and proposes next compounds:

import sys; sys.path.insert(0, "scripts")
import run_method as rm
# single endpoint:
summary = rm.run("series.csv", "results_dir", prop_name="pKi",
                 min_support=5, sim_thresh=0.9, fold_thresh=10.0, max_variable_heavies=10)
# multiproperty (one mmpdb carrying both endpoints, per-endpoint + joined tables):
summary = rm.run_multi("series.csv", "results_dir",
                       endpoints=["hERG_pIC50", "CYP3A4_pIC50"],
                       min_support=5, sim_thresh=0.9, fold_thresh=10.0)

The engine records, per endpoint, a sign/scale guard (per-rule mean Δ vs mmpdb's stored avg) and a cliff cross-check (vectorized rule vs vendored MoleculeACE is_cliff) under summary.json → runs.<endpoint>.

Review the transformation table. Report each transformation with its support n, median Δ effect size, and bootstrap 95% CI. Transformations with n below the threshold are suppressed and must never be surfaced as findings.

Activity cliffs & context dependence. Cliffs use the configurable consensus rule (similarity ≥ threshold in ≥1 of Tanimoto/scaffold/SMILES AND fold ≥ threshold, with fold = 10**|Δ|). Cliff counts are highly definition-sensitive, so report cliff_sensitivity_by_criterion.csv — the count under every criterion side by side, each row and figure caption naming its criterion. Never surface a bare "%cliff" without its criterion attached, and keep the thresholds as exposed parameters. Flag transformations whose per-core median Δ reverses sign across cores and present their counterexample pairs — do not average them into a single rule.

Nominate next compounds. From next_compounds.csv (mmpdb transform on potent references), prioritize predicted improvements with adequate support in the endpoint's declared direction (higher for potency; lower for hERG and CYP3A4 liabilities) — as hypotheses to test, not validated potencies.

Validate. Rely on the bootstrap CIs; where metadata allows, check stability by scaffold (Bemis–Murcko) or time split. If a predictive model is fitted downstream, report cliff-restricted error (RMSE on cliff compounds) alongside global error — a model with good global error but poor cliff error is not fit for lead optimization.

Figures. Produce data plots (per the system visualization policy): per-transformation Δ distributions, an effect-size forest plot with bootstrap CIs, and a similarity-vs-|Δ| cliff scatter. NOTE: the report's workflow infographic is NOT produced here -- it is produced in the final report step, which constrains its geometry. Do not pre-empt it.

Bind every report claim to a keyed row — do this before writing any narrative. The transformation tables are keyed by SMIRKS; the report must read every named transformation's support n, median Δ and CI from that one key and never by list position. A ranking is a list of keys: pick a key by rank, then pull all of its values together (this is what went wrong — the sample report named top[0] but read the number from top[-1], printing a real value that belonged to a different transformation).

import sys; sys.path.insert(0, "scripts")
from report_qc import (build_report_facts, select_claim, claim_for_key,
                       assert_claims_resolve, write_facts)
facts = build_report_facts(
    "results_dir/multiproperty_transformation_table.csv",       # or transformation_table__<ep>.csv
    "results_dir/summary.json",                                 # executed method + counts
    endpoints=["hERG_pIC50", "CYP3A4_pIC50"],
    rankings={"hERG_lowering": {"endpoint": "hERG_pIC50", "direction": "lower",
                                "supported_only": True, "top": 10}})
strongest = select_claim(facts, "hERG_lowering", 0)   # KEY chosen by rank; label + numbers from IT
claims = [strongest]                                  # one entry per transformation the report NAMES
assert_claims_resolve(facts, claims)                 # HARD gate: label & numbers → the SAME key
facts["claims"] = claims
write_facts("report_facts.json", facts)              # the report quotes ONLY from this file

Quote the fragmentation method and every analysis count only from facts["executed_analysis"]. The builder cross-checks n_transformations against the keyed table and hard-stops unless the executed summary records single-cut mmpdb fragmentation with mmpdb_num_cuts == 1; do not reconstruct either the method or counts in report prose. Never build a list of row-dicts and index it (top[-1], top[0]) to fill a sentence. Every figure caption and every sentence that names a transformation must quote a value that came through assert_claims_resolve; a claim whose label and quoted values resolve to different transformation keys is a failed report, not a wording choice.

Generate and verify the PDF with pdf-report-generation and normal Phylo branding by default. If the user explicitly selects an installed compatible report-styling provider, load and follow that provider's complete instructions and assets for PDF presentation only. Do not change scientific content, figures, evidence, artifacts, conclusions, or non-PDF outputs. Customer, tenant, project, account, or dataset context alone does not select a style provider.

Before rendering, resolve the provider only from immutable user-message evidence and retain the returned selection for finalization:

import sys; sys.path.insert(0, "scripts")
from report_qc import resolve_report_style_selection
STYLE_POLICY = "report_style_policy.json"
style_selection = resolve_report_style_selection(STYLE_POLICY)

Load the resolved provider's complete SKILL.md and applicable assets as a unit. Missing, malformed, conflicting, revoked, or unavailable provider evidence blocks the run rather than falling back.

Style the infographic explicitly, and fix its geometry. The resolved provider governs the PDF's presentation, and its complete palette and brand treatment must also be put into the GenerateImage prompt so the companion visual matches the report.

Geometry preference. Prefer a banner rather than a poster:

Prefer aspect_ratio="3:2" (1536x1024). A portrait or square result is still acceptable when it remains legible, scientifically consistent, and correctly embedded; do not regenerate solely to change its orientation.
Lay the content out as a horizontal, left-to-right flow. If there are more stages than fit in one row, use two rows of equal length -- never a single vertical stack.
It sits as a captioned banner directly under the page-1 title block, at close to full text width. Do not repeat the report title, subtitle or attribution inside the image -- the page already carries them.
Check before embedding: record the returned PNG dimensions. Place it with the same captioned-figure helper used for every other figure so it receives a visible caption; Figure N. and Infographic: caption formats are both acceptable.

Palette: use the resolved provider's complete, installed instructions and assets. Do not reconstruct a provider from receipt marker colours. For the default provider this preserves normal Phylo presentation; an explicit compatible provider owns palette, typography, logo treatment, and page chrome for this run.

Use a structural workflow prompt that contains no run-specific values or identities.

Write the PDF to the results root. The report goes at /mnt/results/report_<subject>.pdf -- NOT inside a run subdirectory. It is the deliverable a reader opens first and it must be visible without navigating into folders. Intermediate data, per-figure PNG/SVG files and the infographic source may still live in subdirectories; the PDF may not.

Wire the gates. This block is mandatory, not illustrative. A gate is only a gate when something calls it. Run it immediately after the report is assembled, from the package's scripts/ directory, so a wrong-shaped or incorrectly styled report fails the run instead of passing silently:

import sys, json; sys.path.insert(0, "scripts")
from report_qc import (RESULTS, TRANSCRIPT, assert_generated_by_tool, assert_infographic_landscape,
                       assert_report_exists, assert_claims_resolve, report_claims_in_pdf,
                       staged_copy, write_style_receipt)

# Names must match what you passed to GenerateImage / rendered the PDF as.
INFOGRAPHIC = "workflow_infographic.png"
REPORT = "report_matched_molecular_pairs.pdf"

# Publish the PDF the object-mount-safe way: render to /workspace, then staged_copy to the RESULTS ROOT
# (reopening a PDF directly on the S3-backed mount can truncate).
workspace_pdf = "/workspace/report_matched_molecular_pairs.pdf"     # resolved provider renders here
staged_copy(workspace_pdf, "report_matched_molecular_pairs.pdf")   # publish to the results root

# File-only gates first, so an environment-dependent gate can never stop them running.
print(assert_infographic_landscape(INFOGRAPHIC))  # 3:2 landscape, never portrait
assert_report_exists(REPORT)                      # produced, at the RESULTS ROOT, declared name

# The SEMANTIC BINDING gate (hard): re-assert the persisted claims are self-consistent -- every named
# transformation's label and its quoted values resolve to the SAME transformation key. This is what
# stops a label from one ranked row being printed with a number from another.
facts = json.loads((RESULTS / "report_facts.json").read_text())
assert_claims_resolve(facts, facts.get("claims", []))

# Soft backstop: does the rendered PDF actually carry each validated claim's number? Degrades to
# 'not evaluable' without pypdf; a real miss means the report did not quote from report_facts.json.
ok, detail = report_claims_in_pdf(REPORT, facts.get("claims", []))
print("PDF claims backstop:", detail)
if not ok and not detail.startswith("NOT-EVALUABLE"):
    raise AssertionError("PDF text is missing a validated claim -- render every number from report_facts.json")

# Provenance needs the session transcript, which not every runtime writes. Its absence is a
# property of the environment, not a defect in the run -- report it, do not fail on it.
if TRANSCRIPT.exists():
    assert_generated_by_tool(INFOGRAPHIC)         # really from GenerateImage, not matplotlib
else:
    print(f"NOTE: {TRANSCRIPT} absent -- GenerateImage provenance unverifiable on this runtime")

# Finalize only after the package's existing scientific and lineage gates. This re-resolves the
# immutable selection, verifies the final PDF against the installed provider, and binds both hashes.
write_style_receipt(
    REPORT,
    policy=STYLE_POLICY,
    selection=style_selection,
    package_snapshot="attached_package_snapshot.json",
)

If a gate raises, fix the artifact and re-run it. Do not delete the gate, and do not report success with a gate failing.

Figures

Every analysis step that produces a result names one representative figure showing THAT result (not a schematic). Captions state what the figure shows, and every number in a caption is quoted from report_facts.json, never from memory.

Step    File    What it must make visible
3–4    figures/effect_forest[.__<ep>].png    per-transformation median Δ with bootstrap 95% CIs, so a supported effect whose CI excludes 0 is distinguishable from noise
5    figures/cliff_sensitivity_by_criterion.png    activity-cliff count under each similarity criterion side by side, so no single %cliff is read without its criterion
5    figures/cliff_scatter[.__<ep>].png    pairwise structural similarity vs |Δ|, so cliffs (high-similarity, high-Δ pairs) stand out
3 (multi)    figures/multiproperty_tradeoff.png    each shared transform's effect on both endpoints, so a hERG-lowering change that also lowers CYP3A4 is visible

The report's workflow infographic is separate: it is produced by GenerateImage in the final report step (landscape 3:2, captioned banner), not by the analysis steps above.

When Scripts Fail
mmpdb not installed / won't install. Fall back to the RDKit-native path (rdkit.Chem.rdMMPA.FragmentMol, in the wheel) or the Contrib/mmpa scripts (Hussain–Rea) for fragmentation/indexing, and label outputs as the RDKit fallback.
ChEMBL API unavailable. Retry with backoff; otherwise stop and ask the user for a CSV. Never synthesize or substitute activity data.
ChEMBL pull slow / exceeds runtime budget. The multiproperty pull for large targets can exceed a default runtime budget. Launch it with timeout_minutes >= 30 or as a background job, and write the series CSV to /mnt/shared-workspace/ so partial fetches survive a session boundary and can be resumed. Do not block the entire session on the pull — if it cannot complete in time, preserve the typed partial acquisition record and stop for user confirmation; incomplete data never enter analysis.
import MoleculeACE fails (no TensorFlow). Expected — use the vendored scripts/cliffs.py (DL-free); the pipeline already does.
Few/no matched pairs. Loosen max_variable_heavies or allow 2 cuts; confirm SMILES standardized and the series is congeneric enough.
Task cannot complete within runtime budget. Still deliver a structured final response with five sections: (1) the skill used and whether it matched the request, (2) inputs interpreted, (3) workflow steps completed, (4) output artifacts produced with exact filenames (if any), and (5) failures, limitations, or missing evidence. A status update ("waiting for data") is not a final response — the reader must be able to tell what was and was not accomplished.
Common Issues
Units / log space. Analyze potency as pKi/pIC50; a positive Δ means the "to" analog is more potent. Mixing linear and log values corrupts effect sizes.
Structure standardization. Salts, mixtures, inconsistent protonation or tautomer forms, and unspecified stereochemistry can create false differences or hide valid pairs. Review standardization decisions and retain stereochemical distinctions that matter to the assay.
Duplicate or discordant measurements. Replicate aggregation can hide assay variability. Inspect discordant replicates and do not interpret a delta that is comparable to the measurement uncertainty as a reliable transformation effect.
Assay context. Do not pool different assays into one assay_context silently — it manufactures spurious transformations. Keep them separate unless harmonized.
Censored values. >/< measurements give bounds, not deltas; excluded from stats by default and reported separately.
%cliff is definition-sensitive. Consensus similarity (esp. the generic-scaffold arm) can flag far more cliffs than a Tanimoto-only rule; report the criterion explicitly and anchor conclusions on MMP-pair cliffs. Thresholds are parameters, not universal constants.
Support & context. Never present an average transform as a universal rule; report n and its bootstrap interval for every transformation, inspect per-core reversals, and account for experimental uncertainty.
Few or no matched pairs. The series may not be congeneric, structures may not be standardized consistently, or the single-cut/size limits may be too restrictive. Confirm the chemistry before changing fragmentation parameters, and document any change.
Incomplete ChEMBL acquisition. Public API interruption can leave a typed partial result, but partial data must not enter analysis. Resume the acquisition or ask for a user-supplied table rather than synthesizing or substituting measurements.
Suggested Next Steps
Inspect exemplar pairs for the highest-support transformations and every claimed activity cliff; verify structures, assay context, endpoint direction, and replicate consistency.
For transformations whose effect reverses across cores or whose bootstrap interval spans zero, collect additional same-assay analogs in the relevant cores instead of applying a global medicinal-chemistry rule.
Confirm priority transformations prospectively in a matched assay and treat next_compounds as synthesis/test hypotheses, not validated potencies.
If a downstream predictive model is needed, use scaffold- or time-aware validation and report performance on cliff compounds alongside global performance.
For multiproperty trade-offs, review each endpoint's direction and uncertainty separately; do not collapse potency and liability effects into an unsupported composite score.
Related Skills
binding-affinity-ml-model — train and validate a predictive affinity model after the SAR evidence and endpoint definitions are suitable for modeling.
generative-molecule-design — propose broader de novo chemical designs when the task goes beyond observed MMP transformations.
molecular-property-admet — estimate structure-based molecular and ADMET properties; keep those predictions distinct from measured MMP effects.
adme-ml-modeling — build endpoint-specific ADME models when sufficient curated data exist.
References
Full method grounding and citations: references/methods.md.
Input contract & ChEMBL pull: references/datasets.md.
Reuse map, licences, scope boundaries: references/biomni-usage.md.
Key sources: Dalke et al. 2018 (mmpdb, doi:10.1021/acs.jcim.8b00173); Hussain & Rea 2010 (doi:10.1021/ci900450m); van Tilborg et al. 2022 + 2024 correction (MoleculeACE, doi:10.1021/acs.jcim.2c01073, doi:10.1021/acs.jcim.3c01576); Dossetter et al. 2013; Kramer et al. 2014/2015. Data: ChEMBL (CC BY-SA).

50. med-chem-filters
Category: DRUG DISCOVERY
Source: https://biomni.phylo.bio/skills/skill_9a8b4beff5684acd83e423d019d4ead1?section=marketplace

Med-Chem Filters

Applies structural-alert, drug-likeness and sanity filters to a molecule set and splits it into molecules that pass and molecules that fail, with every score and the reason for each failure kept.

These filters are expert opinion, not fact. The rule sets were written by different groups for different purposes and often disagree: in Pat Walters' comparison, 4 of the 8 ChEMBL alert sets reject a given sulfonic acid and the other 4 do not ("a lot of these filters are somewhat subjective and based on people's experience"). Many marketed drugs and good probes carry alerts, and PAINS came from one assay technology (Baell & Holloway, 2010; Capuzzi et al., 2017). A single hit is therefore a prompt for a chemist's review, not a verdict, and the skill rejects only what the user chooses to reject. When the user leaves the decision to the agent, it applies the consensus: only what a majority of the expert rule sets agree on (a heuristic; the lists overlap, so it is not independent corroboration). Never every available filter.

Use the printed Skill Directory as SKILL_DIR.

Installation
uv pip install "medchem>=2.1.1" openpyxl   # openpyxl only for .xlsx input
medchem install-lilly --no-test             # only when Lilly filters are wanted

medchem install-lilly downloads and compiles LillyMol with make and a C++ compiler (about a minute; not supported on native Windows). If it fails, run without lilly and say so.

1. Read and interpret the input

Accepted: a SMILES list or .smi, CSV/TSV/.xlsx with a SMILES or InChI column (--smiles-col if the name is not smiles, canonical_smiles, structure, smi or inchi), SDF. .csv is comma and .tsv/.txt tab separated; leading # comment lines are skipped. SMILES pasted in chat go to a .smi file first. Records that cannot be parsed, including invalid SDF records, are kept in the failing table as unparsable structure with their other fields. For SDF the structure column is smiles and replaces any property of that name. Keep an identifier column and give it with --id-col (default: id, compound_id, name or compound_name if present); it shows in the report and links every row back to the input.

Then look at the data and form a view of what it is: how many molecules, the structure, ID, name and label columns, whether it looks raw (salts or mixtures, odd charge states, duplicates, parse failures), and the kind of set: marketed or reference drugs (recognisable names, drug-like property ranges), screening or commercial library, generated molecules, hit list or optimization series, or natural products, peptides, PROTACs and macrocycles. State what you see and why in two or three lines. The kind of set decides what to suggest in step 3.

2. Profile the set

Install the dependencies (Lilly too, unless it fails; then drop lilly and say so). Run the script twice into a scratch directory, never the results directory, and do not deliver these files, once with --mode consensus and once with --mode strict, both over --filters interference reactive-toxic nibr lilly druglike sanity. For sets above 2,000 molecules profile a random sample of 2,000 written to a scratch file. In summary.json, filters[].n_hit and groups are the molecules each filter and group hit, n_fail is how many each mode would remove, and expert_panel.vote_distribution (parsable molecules only) says how many molecules the expert sets agree on (flagged by many sets) and how many they contest (flagged by one or two). This tells the user what rejecting costs on their own data before they choose.

3. Stop and ask

Stop here. Do not clean or run the final filter until the user has answered. This holds even when the request names filters or a purpose: pre-tick what they named and confirm it. There are two exceptions. The user says explicitly to go ahead without questions, or the user delegates the decision ("you decide", "best practice", "whatever you think", "defaults"). Then skip the questionnaire: ask only the cleaning question if the set looks raw, run the consensus mode (step 5), and say plainly what you applied and why. Delegation is never a licence to apply every filter.

Otherwise ask in one message, as checkbox and single-choice questions worded as below, with the dataset-specific parts filled in from steps 1 and 2. Each filter line gives its one-line description and reference from the filter catalog below.

I read your file as <n> <kind of set> (<why>). <Only if raw: It looks uncleaned: <salts, mixtures, duplicates, parse failures>.> The nine expert rule sets agree on <a> of N molecules (flagged by at least 5), contest <b> (flagged by one to four) and flag none of <c>. Applying every filter I offer would remove <y> of N.

Filters are expert opinion and the sets often disagree, so unless you prefer otherwise I would only reject what they agree on.

Clean the dataset first with QC? (only when it looks raw) yes or no, and what it would change.

Who decides which filters apply? (choose one)

You decide (recommended): consensus. I reject molecules flagged by at least 5 of the 9 expert rule sets (a heuristic: the lists overlap, and you can change the threshold or drop a set). Everything else is flagged or scored but kept. This would remove <x> of N.
I choose the filters: answer the next two questions.

Which filters should be applied? (multi-select; pre-ticked from the table below)

Assay interference: <description, reference>; <n> molecules flagged
Reactive and toxic alerts: <description, references>; <n> molecules flagged
NIBR: <description, reference>; <n> molecules flagged
Lilly MedChem: <description, reference>; <n> molecules flagged
Drug-likeness rules: one profile, suggested <profile>; <n> molecules flagged
Chemical sanity: <description>; <n> molecules flagged

What should the filters do? (choose one; or name the ones that reject and the ones that only flag)

Strict pass/fail: every hit rejects the molecule.
Scores only: nothing is removed; Lilly demerits, NIBR severity, alert counts and QED are attached so you can rank or set thresholds later.
Consensus: reject only on the agreement of the expert sets; the filters you ticked are flagged and scored.

Rejecting filters use a Lilly demerit cutoff of 100 and NIBR severity 10 unless you give others; lower is stricter.

Is the set expected to contain anything the filters usually reject? (covalent warheads, prodrugs, PROTACs or macrocycles, fragments, natural products, known drugs.) I assumed <inferred>.

What to suggest, by the kind of set:

Looks like    Suggest
Marketed or approved drugs, clinical candidates, reference or known actives    Alerts are expected: in a test on 31 common marketed drugs, rejecting on every filter removed nearly all, while consensus removed one (captopril). Suggest consensus or scores only; offer one rule profile (Ro5 + Veber) as the only other thing that rejects. Say that rejecting on single filters removes many known drugs.
Commercial or HTS screening library    Consensus. A stricter library cut can add NIBR, Lilly or a rule profile as rejecting filters if the user wants it.
Generated molecules    Consensus, with the sanity checks as flags to review, then a drug-like rule profile as rejecting if the user wants it.
Hit list or optimization series    Scores and flags; reject only what the user names.
Natural products, peptides, PROTACs, macrocycles    Scores and flags; see the exceptions table.
4. Clean first when the user said yes

SMARTS alerts are sensitive to salts, charge states, tautomers and duplicates. The question is part of step 3; skip it when the input is cleaned_data/cleaned_data.csv from a complete molecular-dataset-qc run, or the user says it is already clean. On yes, load and follow molecular-dataset-qc in its own results directory. Run only validity,standardize; add deduplicate only when the user wants unique molecules or duplicates would distort the counts, since it changes the number of rows. Choose each other policy yourself from the context, state the choice and its reason in one line, and do not relay QC's questions. Mixtures need judgement: salts and solvates usually mean the largest fragment is the molecule to screen, but a genuine multi-component entry may not. Filter only the cleaned_data.csv of a run whose status is complete; if QC reports needs_resolution, settle it through QC's own review loop rather than filtering its candidate rows. Run the filters on that file with --qc-dir <QC results directory> so both reports state what QC removed or quarantined (rows in qc_details/removed_data.csv and quarantined_data.csv) apart from filter failures. QC's row_audit.csv maps the retained rows back to raw rows through the identifier column.

5. Run

Use the user's answers: --filters from the ticked groups, --mode from their choice (it is required), --reject, --flag and the cutoffs from what they asked for, --context from the expected chemistry.

python3 "$SKILL_DIR/scripts/med_chem_filters.py" \
  --input "$INPUT" --output-dir /mnt/results/med_chem_filters \
  --filters interference reactive-toxic nibr lilly druglike \
  --mode consensus \
  --context "covalent series, acrylamide warheads expected" --flag lilly

Other options: --smiles-col, --id-col, --qc-dir, --min-agree (consensus threshold), --reject and --flag (tokens or groups, not both for one filter), --context, --n-jobs (default all cores), --sdf for SDF copies of the pass and fail sets. Cost is roughly 0.5 ms per molecule per alert set (NIBR ~1.3 ms); for libraries beyond ~100k molecules select fewer sets. Use a new output directory per run.

6. Review what was removed

The filters cannot be used blindly: look at what they remove. After the run, and before presenting the result as final, show about ten removed molecules from filtered_fail.csv (ID, SMILES, fail_reasons, which names the sets that agreed) and the number of contested molecules (flagged by some sets but kept). Ask whether anything removed looks wrong, or anything kept looks bad, and offer a different --min-agree, --flag or --reject and a rerun. Do this for every mode that rejects.

7. Read the results

Quote every number from summary.json. When filters reject (pass_fail is true), start with how many molecules were removed or flagged. In a score-only run (pass_fail is false) nothing passes or fails: do not use those words; report the scores, the score distributions and the molecules flagged per filter, and suggest thresholds. Point the user to report.html first, then give the counts and the two or three filters that removed or flagged the most. Describe alert hits as things to look at: name the alert (hit_details lists every match, fail_reasons what rejected, when anything rejects) and, for borderline molecules, whether a chemist would likely accept it. Mention when Lilly hard-rejects (small size, reactive groups) removed molecules that had no demerit score, and state QC's removals separately.

If the user wants a PDF, follow pdf-report-generation using summary.json and the tables.

Filter catalog

Source for the descriptions in the step 3 question. What rejects is set by the mode, not by the group.

interference: compounds that give false positives in assays.

pains_a, pains_b, pains_c: PAINS families, 480 substructures from AlphaScreen frequent hitters (Baell & Holloway, J Med Chem 2010). They transfer poorly to other assay types (Capuzzi et al., J Chem Inf Model 2017).
alarm-nmr: thiol-reactive false positives found by ALARM NMR (Huth et al., JACS 2005).
alphascreen-hitters, gst-hitters, his-hitters: frequent hitters in AlphaScreen, GST/GSH and His-tag/Ni-chelate assay technologies.
luciferaseinhibitor, chelator, frequent-hitter: likely luciferase inhibitors, metal chelators and general frequent hitters.

reactive-toxic: reactive, unstable or toxic groups.

brenk: unwanted reactive, toxic or pharmacokinetically poor groups, from Dundee's library design for neglected diseases (Brenk et al., ChemMedChem 2008).
nih: NIH reactive, aggregation and fluorescence artifact groups (Jadhav et al., J Med Chem 2010).
glaxo, bms, mlsmr, inpharmatica, lint, surechembl: pharma and screening-center alert sets collected in ChEMBL: Glaxo Wellcome hard filters (Hann et al., J Chem Inf Comput Sci 1999), BMS HTS deck filters (Pearce et al., J Chem Inf Model 2006), NIH MLSMR excluded functionality, Inpharmatica unwanted fragments, Pfizer LINT and the SureChEMBL list of groups unfriendly to medicinal chemistry.
electrophilic, toxicophore: electrophiles that bind proteins unselectively; general toxicophores.
genotoxic-carcinogenicity: Benigni-Bossa mutagenicity and carcinogenicity rules (JRC, 2008).

nibr (rejects at severity 10 when set to reject): 444 Novartis substructures, each marked exclude, flag or annotation. nibr_severity is 10 for any exclude, otherwise the number of flags; nibr_covalent_motifs counts covalent warheads (Schuffenhauer et al., J Med Chem 2020).

lilly (rejects at demerits ≥ 100 or a hard reject when set to reject): Lilly MedChem Rules, 275 queries for reactive, interfering or promiscuous groups. Hard rejects remove a molecule outright; demerits accumulate and rank the rest. Molecules under 7 or over 40 heavy atoms are rejected (Bruns & Watson, J Med Chem 2012).

druglike: property rules; pick one profile that suits the project.

rule_of_five (Lipinski et al., Adv Drug Deliv Rev 1997) with rule_of_veber (Veber et al., J Med Chem 2002): the default pair for oral small molecules.
rule_of_leadlike_soft, rule_of_druglike_soft: FAF-Drugs4 lead-like and drug-like profiles (Lagorce et al., Bioinformatics 2017).
rule_of_three: fragments (Congreve et al., Drug Discov Today 2003).
rule_of_five_beyond: bRo5 space for macrocycles and PROTACs (Doak et al., J Med Chem 2016).
rule_of_cns: CNS-penetrant ranges (Jeffrey & Summerfield, Trends Pharmacol Sci 2010).
rule_of_reos: HTS hit filter (Walters & Namchuk, Nat Rev Drug Discov 2003).
rule_of_gsk_4_400 (Gleeson, J Med Chem 2008), rule_of_pfizer_3_75 (Hughes et al., Bioorg Med Chem Lett 2008): ADMET and toxicity rules of thumb.
rule_of_generative_design(_strict): medchem's profile for generative-model output.
Also rule_of_four, rule_of_ghose, rule_of_egan and others; an unknown token lists them all.

sanity, mostly for generated molecules, always flags to review and never an automatic reject in consensus: graph (strained ring topologies; it also matches real scaffolds such as bicyclo[1.1.1]pentane, spiro[3.3]heptane and cubane), bredt (anti-Bredt bridgehead double bonds; medchem's version also fails every cumulated double bond, such as azides, isocyanates, allenes and ketenes, e.g. zidovudine, so check what it removes before letting it reject), complexity (Bertz complexity above the ZINC 99th percentile for the molecule's weight).

Other tokens: pains (A+B+C), zinc (ZINC drug-likeness and functional-group filters) and the remaining medchem alert sets (dundee, dnabinder, skin, ld50-oral, reactive-unstable-toxic, ...). Overlapping sets (Brenk is Dundee) add noise, not information.

Expected exceptions

Filters encode what is usually unwanted, and some projects want it. The step 3 question asks whether the set is expected to contain any of the rows below; adjust roles with --flag (demote to flag only) and --reject, pick the matching rule profile, and pass a short --context text so the reports say why filters were relaxed.

Expected    Adjustment
Covalent ligands    electrophilic, alarm-nmr and the reactive sets stay flags; demote lilly, which hard-rejects Michael acceptors (michael_rejected). Read nibr_covalent_motifs and report molecules whose only failures are warhead alerts.
Prodrugs    Esters, carbamates and phosphates trip Lilly and Brenk (aspirin is rejected as phenolic_ester_or_carbamate); demote lilly and review the reasons.
PROTACs, macrocycles, bRo5    Demote druglike, lilly (40 heavy-atom limit) and complexity to flags. rule_of_five_beyond is itself bounded (MW up to 1000, at most 20 rotatable bonds) and PROTACs can exceed it, so use it as a flag unless the project adopts those bounds.
Fragments    Use rule_of_three; demote lilly (7 heavy-atom minimum).
Natural products, peptides    Demote complexity and nibr.
Dyes, probes, known assay artifacts    Keep interference as flags and say interference is expected.
Modes and thresholds

The modes offered in step 3. In every mode --reject promotes tokens or groups to reject (for example --reject pains_a for a hard PAINS cut) and --flag demotes them, so "these reject, those only flag" is a mode plus the user's own lists.

strict: every selected filter rejects on any hit: NIBR severity of at least 1 and any Lilly demerit or hard reject (Lilly scores are the same as in the other modes). Annotation-only NIBR matches (severity 0) are reported but do not reject.
score: nothing is rejected; each molecule gets alert names, NIBR severity, Lilly demerits, QED, rule results and a hit count, so the user can rank or threshold later. Only unparsable rows fail.
consensus: rejects a molecule flagged by at least --min-agree of the voting expert rule sets and nothing else; every other filter is flagged and scored but never rejects. Panel: Glaxo, Dundee, BMS, PAINS (A/B/C pooled), SureChEMBL, MLSMR, Inpharmatica, LINT and NIH (Brenk is the Dundee set). The default threshold is a majority of the voting sets (5 of 9). --flag <set> removes that set's vote and --reject <set> makes it reject on its own; a role given to brenk or dundee covers both (one list, two implementations), so --flag reactive-toxic demotes Dundee too. At least two sets must vote, and --min-agree must be between 1 and the number of voting sets. The column n_expert_sets_hit and the reason consensus: flagged by N of M expert rule sets (...) show who agreed. The sanity filters stay flags: graph also matches real scaffolds (bicyclo[1.1.1]pentane, spiro[3.3]heptane, cubane) and medchem's bredt also fails every cumulated double bond (azides, isocyanates, allenes; e.g. zidovudine). It is a heuristic, not independent corroboration. The lists overlap: Glaxo and MLSMR share 46 of Glaxo's 55 SMARTS, Glaxo and SureChEMBL 31, SureChEMBL and MLSMR about a quarter; captopril's six votes all trace to its thiol. ChEMBL's own documentation keeps five of these sets (Glaxo, Dundee, BMS, PAINS, MLSMR) because it removed poorly documented ones, so SureChEMBL, Inpharmatica and LINT carry less documentation. The default was checked on a small set only: 30 of 31 common marketed drugs survive (captopril is removed) and 18 of 20 uncontroversially bad molecules (acyl and sulfonyl halides, isocyanates, azide, peroxide, alkylators, quinone, ene-rhodanine, organomercury, ...) are rejected, while a threshold of 4 would remove three more drugs (penicillin G, amoxicillin, warfarin). Known drugs that carry a widely disliked group still fall out (captopril's thiol, zidovudine's azide), which is why step 6 matters.

Thresholds reject at or above the value: --nibr-max-severity (default 10) and --max-demerits (integer, default 100); strict mode rejects from 1 unless they are given. Lilly reject rules (reason "rejected by a Lilly reject rule") reject at any cutoff. --max-demerits is the Lilly engine's own cutoff: demerits are exact below it, a rule that reaches it becomes a reject scored at the cutoff, and it also scales the molecule-size penalty. Compare lilly_demerits only between runs with the same cutoff, and leave it at 100 when the scores matter.

Outputs (under the output directory)
File    Content
filtered_pass.csv / filtered_fail.csv (only when some filter rejects)    Original columns, unchanged, plus calc_qed, one column per filter (matched alerts, empty if clean), nibr_severity, nibr_status, nibr_covalent_motifs, lilly_demerits, lilly_status, the descriptors the rules read (calc_mw, calc_clogp, calc_tpsa, calc_n_hbd, ... when a rule is selected), flags (flag-role filters that matched), hit_details (every match with its reason, whatever the role), n_filters_hit, n_expert_sets_hit (how many of the nine expert sets flagged it, when the whole panel ran), fail_reasons, pass_filters. Input columns that collide with these names or the calc_ prefix stop the run: rename them in a copy
annotated_all.csv    Every input row with the same columns, the one table of a score-only run (without pass_filters; fail_reasons then only marks unparsable structures)
*.sdf    Pass and fail sets (or the one scored table in a score-only run) as SDF with the same properties (with --sdf)
summary.json    pass_fail (false for a score-only run, which then has no n_pass, n_fail or roles), counts per filter and group, thresholds, expected chemistry, QC row accounting, software versions
report.md, report.html    Summary; the html adds bars of molecules flagged per filter, score histograms and a sortable, searchable molecule table with IDs, SMILES, structures (first 300 rows) and matched alerts
Caveats
Filters see the structures as given; salts, counter-ions and charge states change alert hits.
Lilly hard rejects have no lilly_demerits value; use lilly_status. Strict mode also rejects any single demerit, which is far stricter than the Lilly default.
Property-rule failures name only the rule; compare the descriptor columns with the rule's bounds.
rdkit PAINS A/B/C and medchem sets overlap in part; compare per-filter columns, not totals.
Property rules are guidelines for oral small molecules; see Expected exceptions for chemistry that needs other profiles or flag-only filters.
Complexity percentiles are relative to ZINC purchasable compounds.
Sources

References are given with each filter in the filter catalog; datamol-io/medchem (Apache-2.0); RDKit FilterCatalog.


Biomni Lab — Complete Skills Reference
