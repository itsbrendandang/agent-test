# workflow-and-method-engineer

**Scope:** Nextflow pipelines, skill-package authoring and method-development loops.

**Skills owned:** 6 (5 full instructions, 1 index only). Status: instructions only, packages not installed, not wired into any solver.

## Route to this agent when

- Turn the session's analysis into a Nextflow pipeline (skill 64).
- Author one nf-core-style Nextflow component (skill 66).
- Create or repair a skill package (skill 63).
- Autonomous multi-machine optimization with an evaluator (skill 96); 'create, improve, optimize, audit, or package' a method (skill 97).
- Skill 65 is index only; other skills' text names it as the HPC-validation / submission.py staging step.

## Do not route here when

- Skills 96 and 97 describe multi-machine CPU/GPU compute; skill 96 names three paid LLM stages. Do not route to them for any run that is not an approved billed run.
- The work needs one of this agent's index-only skills to do anything beyond what its name says.

## Skills owned

### 63. phylo-create-skill: full instructions

- Category (hub): General
- Scope (its own text): Create one production-only skill package (not a transcript of a run) that can later be refined, frozen, tested, reviewed and shipped. Two authoring paths: executable analysis vs general workflow; a repair path for supplied skills.
- Declared inputs: A brief, or a supplied skill to repair
- Declared outputs: package under `/mnt/results/skills/<slug>/`
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: Mentions only that licensing files may be added when concretely useful, and that licensing sufficiency needs external review. No licence flag on data

### 64. pipeline-from-analysis: full instructions

- Category (hub): Data analysis
- Scope (its own text): Turn the session's analysis into a Nextflow pipeline: extract steps from the notebook trace, map to nf-core components, write plan.json, compose, lint/stub-run locally, validate on HPC (via pipeline-hpc-validate), package a zip. Works with pipeline-module-author and pipeline-hpc-validate.
- Declared inputs: `execution_trace/*.ipynb` (+ transcript.jsonl) or user scripts
- Declared outputs: `steps.json`, `plan.json`, reports, staged repo, zip
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none raised. This is silence in the Overview, not a clearance.

### 65. pipeline-hpc-validate: index only

- Category (hub): Data analysis
- Scope, inputs, outputs: **index only.** The hub showed "No markdown preview is available for this skill yet." Nothing about what it does is known here; route by name and category only.
- Pointer from other skills' text: Other skills' text names it as the HPC validation and submission.py staging step; its own Overview was not shown.
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: unknown (no text shown).

### 66. pipeline-module-author: full instructions

- Category (hub): Data analysis
- Scope (its own text): Author one Nextflow component the nf-core way: search the nf-core registry/offline index first, never guess parameters, vendor modules/subworkflows, or scaffold a local module with a generated argument parser.
- Declared inputs: Step description / nf-core component name
- Declared outputs: vendored or local module in the pipeline repo, modules.json entries
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: none raised. This is silence in the Overview, not a clearance.

### 96. tusoai: full instructions

- Category (hub): Data analysis
- Scope (its own text): Runs the bundled TusoAI repository as a durable, persistent, multi-machine scientific optimization service for method development; the skill is "the orchestration contract", `repo/README.md` is the API reference.
- Declared inputs: A task and evaluator, constraints, budget
- Declared outputs: `/mnt/shared-workspace/tusoai/<task_id>/` state, `/mnt/results/tusoai/<task_id>/` mirrors, best method exported with history, task spec, state and launch config
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: No data licence flag. Text says to record provenance and licences of external resources. **Cost/platform flags:** names specific LLM models for stages (gpt-5.4-nano, gpt-5.4, gpt-5.4-mini), uses multi-machine and GPU compute; that is billed, not free (see section 4)

### 97. tusoskill: full instructions

- Category (hub): Data analysis
- Scope (its own text): Biomni itself runs the whole method-development loop (benchmark, baseline, hypotheses, code changes, ablations, simplification, leakage audit, packaging) without an external search framework.
- Declared inputs: Method/benchmark/evaluator (or builds one)
- Declared outputs: `final_method/` package (README, code, reproduce.sh, run_manifest.json, benchmark_card.md, method_card.md, final_report.md, dependency notes) plus ledgers and status files
- Hub URL: https://biomni.phylo.bio/skills?section=marketplace (the hub's general skill listing; a skill-specific link was not captured)
- package: not installed
- Licence / commercial-use flag: No data licence flag; says record licences of auxiliary data. **Compute flags:** default plan up to 5 machines (16 CPU/64 GB each) plus GPU machines via ManageMachine

## What this agent cannot do

- Start any 96/97 run here: it would breach AGENTS.md's rule against billed cloud runs unless the user asks for it.
- Register, publish, deploy, open a PR or upload a skill: skill 63's text forbids it without explicit approval.
- Put test data, fixtures, expected values or run outputs in a skill package (skill 63).
- Describe skill 65 beyond its name and the pointer.
- Packages (scripts, references, assets) are not installed: nothing here can be executed. These are instructions only and nothing routes work to this agent yet. Many Overviews assume Biomni tools and paths (/mnt/results, GenerateImage, LiteratureSearch, pdf-report-generation, ManageMachine) whose availability in GLHF is not stated. Their text does not address the AGENTS.md rules (no answer sources, documentation-only search allow-list, no billed cloud runs), so any skill that searches literature, fetches public data or uses machines must be checked against them before use in a benchmark solver.
