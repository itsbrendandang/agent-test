# clinical-and-experimental-design-analyst

**Scope:** Trial-design simulation, plate layout, population PK/PD, real-world-evidence cohorts and survival analysis.

**Skills owned:** 6 (5 full instructions, 1 index only). Status: instructions only, packages not installed, not wired into any solver.

## Route to this agent when

- Power and operating characteristics of a two-arm confirmatory design from assumptions (skill 17).
- 96/384-well plate map, edge effects, randomization (skill 54).
- Concentration-time data to population PK, exposure-response (skill 67).
- Retrospective cohort from EHR/claims-style codes: Table 1, treatment patterns, survival (skill 75).
- Kaplan-Meier / Cox on a cleaned time-to-event table (skill 91; skill 75 says use 91 for single-cohort survival without cohort building).
- Skill 30 (experimental-design statistics) is index only; skill 54 redirects genomics power analysis and cross-experiment batching to it.

## Do not route here when

- Skill 17 is not for completed-trial analysis, multi-arm/platform, Bayesian, dose-finding, basket/umbrella designs.
- Skill 67 is not clinical dosing guidance and has no invented target windows, no NONMEM control streams, no PBPK, no cross-study meta-analysis.
- Skill 75 is descriptive, not formal causal estimation or target-trial emulation. Skill 91 excludes competing risks, interval censoring, multi-state, multiple imputation, external validation, RMST.
- The work needs one of this agent's index-only skills to do anything beyond what its name says.

## Skills owned

### 17. clinical-trial-design-simulation: full instructions

- Category (hub): Experimental design
- Scope (its own text): Simulate and evaluate two-arm confirmatory trial designs with one primary endpoint: power, operating characteristics under user effect scenarios, two validation gates (FWER and rpact benchmark), PDF.
- Declared inputs: JSON config of assumptions, no patient data
- Declared outputs: gate and operating-characteristic tables, sensitivity table, figures, PDF
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none stated. This is silence in the Overview, not a clearance.

### 30. experimental-design-statistics: index only

- Category (hub): Experimental design
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 54. microplate-layout-design: full instructions

- Category (hub): Experimental design
- Scope (its own text): Optimized 96/384-well layouts: randomization, edge effects, covariate balance, control placement; lab-ready plate maps. Redirects genomics power analysis and cross-experiment batching to experimental-design-statistics.
- Declared inputs: `define_experiment()` with plate_format (96/384), treatments (>=2 labels) and more
- Declared outputs: plate maps (PNG/SVG, CSV, Excel), tidy export
- Hub URL: https://biomni.phylo.bio/skills/skill_ea62d879a7384219a92cf683a8b63013?section=marketplace
- package: not installed
- Licence / commercial-use flag: none raised (all R packages permitted). This is silence in the Overview, not a clearance.

### 67. pkpd-pharmacometrics: full instructions

- Category (hub): Drug discovery
- Scope (its own text): Staged population PK/PD and exposure-response modelling in R with nlmixr2/rxode2: validate data, diagnose delay, fit PK, optionally PD, evaluate (GOF, VPC), dose simulation. Not clinical dosing guidance, no invented target windows, no NONMEM control streams, no PBPK, no cross-study meta-analysis.
- Declared inputs: Long-format NONMEM-style table (ID, time, concentration, dose, optional response...)
- Declared outputs: tables, figures, report_<drug>_popPKPD.pdf, .rds model objects
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none raised. Text warns the pharmacometric stack is not preinstalled (needs compilers). This is silence in the Overview, not a clearance.

### 75. real-world-evidence: full instructions

- Category (hub): Data analysis
- Scope (its own text): Config-driven retrospective cohort study on structured EHR/claims-style data: cohort by codes vs comparator, Table 1, treatment patterns, Kaplan-Meier/landmark/log-rank, multivariable Cox only if events-per-variable gate passes. Descriptive; not formal causal estimation or target-trial emulation.
- Declared inputs: Patient-level CSV/parquet mapped via a single CFG list
- Declared outputs: tables (cohort_flow, table1, treatment summaries, survival), infographic, PDF
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: **Data-source guardrail (hard constraint)**: only the 100-patient MIMIC-IV demo is open (ODbL v1.0); full MIMIC-IV is credentialed under the PhysioNet Credentialed Health Data Use Agreement 1.5.0 and must not be taken from unauthorized mirrors. If unreachable, report the blocker or use a synthetic schema-matching fixture

### 91. survival-analysis-clinical: full instructions

- Category (hub): Multi-omics
- Scope (its own text): Right-censored Kaplan-Meier, Cox PH, Schoenfeld PH testing, and risk stratification by the Cox linear predictor. Explicitly not competing risks, interval censoring, multi-state, multiple imputation, external validation, RMST. Risk score is discovery-only; Cox is complete-case.
- Declared inputs: Clinical table with time-to-event and event columns plus covariates
- Declared outputs: `results/<endpoint>/` per endpoint, combined PDF
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none raised. This is silence in the Overview, not a clearance.

## What this agent cannot do

- Take full MIMIC-IV from unauthorized mirrors (skill 75's hard guardrail: only the 100-patient demo is open under ODbL; the rest is PhysioNet-credentialed).
- Use skill 67 without a pharmacometric R stack: its text says it is not preinstalled (needs compilers).
- Describe skill 30 beyond its name.
- Packages (scripts, references, assets) are not installed: nothing here can be executed. These are instructions only and nothing routes work to this agent yet. Many Overviews assume Biomni tools and paths (/mnt/results, GenerateImage, LiteratureSearch, pdf-report-generation, ManageMachine) whose availability in GLHF is not stated. Their text does not address the AGENTS.md rules (no answer sources, documentation-only search allow-list, no billed cloud runs), so any skill that searches literature, fetches public data or uses machines must be checked against them before use in a benchmark solver.
